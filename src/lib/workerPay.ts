/**
 * Pago a trabajadores por trabajos realizados (add_worker_pay.sql).
 *
 * «Trabajo realizado» = una reserva real cuya fecha ya pasó o es hoy, que no se canceló, y
 * en la que el trabajador iba: porque estaba en la cuadrilla o porque el camión de la
 * reserva es su camión habitual. No se exige el estado «completada», porque en la práctica
 * casi ninguna reserva se marca así.
 *
 * Cuánto gana por cada trabajo lo decide una regla: un monto fijo, o un porcentaje del valor
 * del servicio. Hay una regla general (Configuración → Pago a trabajadores) y cada trabajador
 * puede tener la suya, que manda sobre la general. Si dos personas van al mismo trabajo, cada
 * una gana según su regla: el porcentaje no se reparte entre ellas.
 *
 * La regla también puede ser por m³ y por kilómetro (Tomás, 10-10-2026): cada trabajo paga
 * sus m³ × tarifa + sus km × tarifa, con los m³ y km de la reserva (los puestos a mano o, si
 * no, los de la cotización). A eso se suman los gastos que el trabajador rindió y se le
 * aprobaron (se le devuelven) y las bonificaciones que se le carguen a mano.
 *
 * Los pagos se registran a mano (el panel no transfiere nada) y se descuentan de lo que se
 * debe en ese período.
 *
 * Desde el 15-10-2026 (Tomás, add_nomina_y_pago_por_trabajo.sql): por m³ la persona puede
 * tener un mínimo por trabajo; los km solo suman en los trabajos marcados «fuera de Santiago»;
 * y cada trabajo de cada persona se puede pagar con un monto escrito a mano o por pallets
 * entregados (`worker_job_pay`), en vez de por su regla. Lo ya pagado queda con el monto que
 * se guardó en su pago.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import {
  BANK_PAYROLL_HEADERS,
  bankDataMissing,
  buildPayStatement,
  configRule,
  DEFAULT_HONORARIOS_RATE,
  jobGroup,
  honorariosRetention,
  jobPay,
  monthName,
  payRuleLabel,
  type BankAccountType,
  type JobPayMode,
  type PayClosing,
  type PayConfig,
  type PayItem,
  type PayItemKind,
  type PayMode,
  type PayRule,
  type PayStatement,
  type WorkerPayData,
  type WorkerPayJob,
  type WorkerPayRow,
} from '@/lib/workerPayTypes'

export class WorkerPayError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'WorkerPayError'
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function todayChile(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

/**
 * Todo lo que entró en pagos registrados (add_payment_items.sql), de a 1000 filas: PostgREST
 * corta cada respuesta en 1000 aunque se pida más, y un ítem que no se lee aparece como «sin
 * pagar» (y volvería a entrar en la nómina).
 */
async function readPaidItems(): Promise<{ items: any[]; error: boolean }> {
  const items: any[] = []
  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabaseAdmin
      .from('worker_payment_items')
      .select('payment_id, worker_id, kind, ref, label, amount')
      .order('payment_id', { ascending: true })
      .order('ref', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) return { items, error: true }
    items.push(...((data || []) as any[]))
    if ((data || []).length < 1000) break
  }
  return { items, error: false }
}

export async function getWorkerPay(rawFrom: unknown, rawTo: unknown): Promise<WorkerPayData> {
  const today = todayChile()
  let from = typeof rawFrom === 'string' && DAY_RE.test(rawFrom) ? rawFrom : `${today.slice(0, 8)}01`
  let to = typeof rawTo === 'string' && DAY_RE.test(rawTo) ? rawTo : today
  if (from > to) [from, to] = [to, from]
  // Solo lo ya ocurrido: un trabajo de mañana todavía no se hizo.
  const upTo = to > today ? today : to

  // Todo lo que no depende de los trabajos sale en una sola tanda, y lo que sí depende de
  // ellos en una segunda (Tomás, 27-10-2026: «es lento, carga más de lo necesario»). Antes
  // eran ~10 consultas una detrás de otra.
  // Un gasto cuenta por la fecha de su trabajo, que es anterior a cuando se rinde: se toman
  // los rendidos desde 120 días antes del período, los más nuevos primero.
  const expensesSince = new Date(Date.parse(`${from}T00:00:00Z`) - 120 * 86_400_000).toISOString()
  const [config, { data: workers, error: workersError }, { data: bookings }, paymentsResult, { data: expenseDocs }, bonusResult, closingResult, paidItemsResult] =
    await Promise.all([
      getPayConfig(),
      supabaseAdmin.from('workers').select('*').order('name'),
      // `fetchAllRows`: con `.limit(2000)` el techo real era 1000 filas (`max-rows` de
      // PostgREST) y un período largo liquidaba trabajos de menos → plata de menos.
      fetchAllRows<any>((rfrom, rto) =>
        supabaseAdmin
          .from('bookings')
          .select('*')
          .gte('scheduled_date', from)
          .lte('scheduled_date', upTo)
          .not('status', 'in', '(cancelled,no_show)')
          .order('scheduled_date', { ascending: true })
          .order('id', { ascending: true })
          .range(rfrom, rto)
      ),
      supabaseAdmin.from('worker_payments').select('*').gte('period_from', from).lte('period_to', to).order('paid_at', { ascending: false }),
      // Ídem: los gastos rendidos son fotos por trabajo; 1000 reales se alcanzaban fácil
      // y la plancha quedaba con gastos de menos.
      fetchAllRows<any>((rfrom, rto) =>
        supabaseAdmin
          .from('documents')
          .select('*')
          .eq('kind', 'gasto')
          .eq('uploaded_by_type', 'trabajador')
          .gte('created_at', expensesSince)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(rfrom, rto)
      ),
      supabaseAdmin.from('worker_bonuses').select('*').gte('bonus_date', from).lte('bonus_date', to).order('bonus_date', { ascending: true }),
      // Cierres vigentes que tocan el período.
      supabaseAdmin.from('worker_pay_closings').select('*').is('reopened_at', null).lte('period_from', to).gte('period_to', from),
      readPaidItems(),
    ])
  if (workersError) throw new WorkerPayError('No se pudieron cargar los trabajadores', 500)
  const available = !paymentsResult.error && (workers || []).every((w: any) => 'pay_per_job' in w)

  const jobs = ((bookings || []) as any[]).filter((b) => !b.is_provisional && !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-'))
  const jobIds = jobs.map((j) => j.id)
  const chileDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(iso))
  const approved = ((expenseDocs || []) as any[]).filter((d) => d.expense_status === 'aprobado' && d.uploaded_by_id)
  const expenseBookingIds = Array.from(new Set(approved.map((d) => d.booking_id).filter(Boolean)))
  const { items: paidItems, error: itemsError } = paidItemsResult
  const paymentIds = Array.from(new Set(paidItems.map((i) => i.payment_id)))
  const quoteIds = Array.from(new Set(jobs.map((j) => j.quote_id).filter(Boolean)))
  const jobCompanyIds = Array.from(new Set(jobs.map((j) => j.company_id).filter(Boolean)))

  const [{ data: crew }, { data: quotes }, overridesResult, { data: unitCompanies }, { data: expenseBookings }, { data: detailedPayments }] = await Promise.all([
    jobIds.length
      ? supabaseAdmin.from('booking_workers').select('booking_id, worker_id').in('booking_id', jobIds)
      : Promise.resolve({ data: [] as { booking_id: string; worker_id: string }[] }),
    // m³ y km de cada trabajo: lo puesto a mano en la reserva manda; si no, lo de la cotización.
    quoteIds.length
      ? supabaseAdmin.from('quote_prospects').select('quote_id, total_volume, total_distance, created_at').in('quote_id', quoteIds).order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    // Cómo se paga cada trabajo a cada persona cuando no es por su regla (add_nomina_y_pago_por_trabajo.sql).
    jobIds.length
      ? supabaseAdmin.from('worker_job_pay').select('worker_id, booking_id, mode, amount').in('booking_id', jobIds)
      : supabaseAdmin.from('worker_job_pay').select('worker_id').limit(1),
    // Empresas que se cierran por unidad (add_cierre_empresas.sql): sus trabajos con pallets se pagan por pallet.
    jobCompanyIds.length ? supabaseAdmin.from('companies').select('*').in('id', jobCompanyIds) : Promise.resolve({ data: [] as any[] }),
    expenseBookingIds.length
      ? supabaseAdmin.from('bookings').select('id, scheduled_date').in('id', expenseBookingIds)
      : Promise.resolve({ data: [] as any[] }),
    // Los pagos con detalle que cubrieron algo (fecha de pago y, para listarlos en cada fila, el pago entero).
    paymentIds.length
      ? supabaseAdmin.from('worker_payments').select('*').in('id', paymentIds).order('paid_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ])

  const crewByBooking = new Map<string, Set<string>>()
  for (const r of (crew || []) as { booking_id: string; worker_id: string }[]) {
    if (!crewByBooking.has(r.booking_id)) crewByBooking.set(r.booking_id, new Set())
    crewByBooking.get(r.booking_id)!.add(r.worker_id)
  }
  const quoteById = new Map(((quotes || []) as any[]).map((q) => [q.quote_id, q]))
  const positive = (v: unknown) => (Number(v) > 0 ? Number(v) : null)
  const jobPayAvailable = !overridesResult.error && config.jobPayAvailable
  const palletCompanies = new Set(((unitCompanies || []) as any[]).filter((c) => c.closing_unit === 'pallets' || c.closing_unit === 'kg').map((c) => c.id))
  const overrideOf = new Map<string, { mode: JobPayMode; amount: number | null }>(
    ((overridesResult.error ? [] : overridesResult.data || []) as any[])
      .filter((o) => o.booking_id)
      .map((o) => [
        `${o.worker_id}|${o.booking_id}`,
        { mode: o.mode === 'pallets' ? 'pallets' : o.mode === 'regla' ? 'regla' : 'fijo', amount: o.amount === null ? null : Number(o.amount) },
      ])
  )
  const measures = (job: any) => {
    const quote = quoteById.get(job.quote_id)
    return {
      volumeM3: positive(job.volume_m3) ?? positive(quote?.total_volume),
      distanceKm: positive(job.distance_km) ?? positive(quote?.total_distance),
    }
  }

  // Gastos aprobados y bonificaciones del período, por trabajador.
  const bookingDate = new Map(((expenseBookings || []) as any[]).map((b) => [b.id, b.scheduled_date as string | null]))
  // Un gasto cuenta en el período del trabajo al que pertenece; sin trabajo, el día que se rindió.
  const expenses = approved
    .map((d) => {
      const payment = d.expense_payment === 'credito' ? ('credito' as const) : ('contado' as const)
      const reimbursed = Boolean(d.expense_reimbursed_at)
      return {
        workerId: d.uploaded_by_id as string,
        id: d.id as string,
        bookingId: (d.booking_id as string | null) || null,
        name: (d.note || d.file_name || 'Gasto') as string,
        amount: Math.round(Number(d.amount) || 0),
        date: (d.booking_id && bookingDate.get(d.booking_id)) || chileDay(d.created_at),
        payment,
        reimbursed,
        // Se le debe lo que pagó de su bolsillo. Si quedó «reembolsado» por un cierre, sigue
        // contando: lo cubre el pago de ese cierre. Si se marcó reembolsado aparte (se le
        // entregó la plata por fuera), ya no se le debe.
        owed: payment === 'contado' && (!reimbursed || Boolean(d.expense_closing_id) || Boolean(d.expense_payment_id)),
      }
    })
    .filter((e) => e.amount > 0 && e.date >= from && e.date <= to)
  const bonuses = (bonusResult.error ? [] : bonusResult.data || []) as any[]
  const closings = (closingResult.error ? [] : closingResult.data || []) as any[]

  // Qué ya entró en un pago registrado (add_payment_items.sql). Clave: funcionario|tipo|ref.
  const paidAtOf = new Map(((detailedPayments || []) as any[]).map((p) => [p.id, p.paid_at as string]))
  const paidAtByKey = new Map<string, string>(paidItems.map((i) => [`${i.worker_id}|${i.kind}|${i.ref}`, paidAtOf.get(i.payment_id) || '']))
  const paidAt = (workerId: string, kind: PayItemKind, ref: string) => paidAtByKey.get(`${workerId}|${kind}|${ref}`) || null
  // Lo pagado queda con el monto que se guardó al pagarlo, aunque después cambie la regla o el trabajo.
  const paidAmountByKey = new Map<string, number>(paidItems.map((i) => [`${i.worker_id}|${i.kind}|${i.ref}`, Number(i.amount) || 0]))
  const frozen = (workerId: string, kind: PayItemKind, ref: string, amount: number) => paidAmountByKey.get(`${workerId}|${kind}|${ref}`) ?? amount
  const paymentRowsById = new Map<string, any[]>()
  for (const p of (detailedPayments || []) as any[]) paymentRowsById.set(p.worker_id, [...(paymentRowsById.get(p.worker_id) || []), p])
  const itemsByPayment = new Map<string, any[]>()
  for (const i of paidItems) itemsByPayment.set(i.payment_id, [...(itemsByPayment.get(i.payment_id) || []), i])

  // Meses que toca el período, para el sueldo base (uno por mes). Solo hasta el mes en curso:
  // una semana que cruza al mes siguiente no puede cobrar por adelantado el base de ese mes.
  const monthsInRange: string[] = []
  for (let m = from.slice(0, 7); m <= upTo.slice(0, 7); ) {
    monthsInRange.push(m)
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }

  let unassignedJobs = 0
  const missingData = new Set<string>()
  const jobsByWorker = new Map<string, WorkerPayJob[]>()
  for (const job of jobs) {
    const assigned = crewByBooking.get(job.id)
    let anyone = false
    for (const w of (workers || []) as any[]) {
      const inCrew = assigned?.has(w.id) || false
      const byTruck = w.active && typeof job.vehicle_id === 'number' && w.vehicle_id === job.vehicle_id
      if (!inCrew && !byTruck) continue
      anyone = true
      const list = jobsByWorker.get(w.id) || []
      const servicePrice = Math.round(Number(job.adjusted_price) || Number(job.original_price) || Number(job.total_price) || 0)
      const { volumeM3, distanceKm } = measures(job)
      const rule = ruleOf(w, config).rule
      const override = overrideOf.get(`${w.id}|${job.id}`) || null
      const outsideSantiago = jobPayAvailable ? Boolean(job.outside_santiago) : null
      const pallets = jobPayAvailable && job.pallets !== null && job.pallets !== undefined ? Number(job.pallets) : null
      const fixedAmount = override?.mode === 'fijo' ? override.amount : null
      // Trabajos de una empresa que se cierra por unidad (Monfiza) y que se cobran por pallets:
      // se pagan por pallets salvo que en el trabajo se haya elegido otra cosa (Tomás, 19-10-2026).
      const byCompanyPallets = Boolean(palletCompanies.has(job.company_id) && job.delivery_unit !== 'kg' && pallets && pallets > 0)
      const payMode: JobPayMode = override?.mode || (byCompanyPallets ? 'pallets' : 'regla')
      // Tope de pallets pagados: por dirección de entrega (destino + paradas).
      const addresses = 1 + (Array.isArray(job.stops) ? job.stops.length : 0)
      const palletCap = config.maxPalletsPerAddress ? config.maxPalletsPerAddress * addresses : null
      const pay = jobPay({ mode: payMode, rule, servicePrice, volumeM3, distanceKm, outsideSantiago, minPerJob: minOf(w) ?? config.minJob, minM3: config.minM3, fixedAmount, pallets, perPallet: config.perPallet, palletCap })
      const jobPaidAt = paidAt(w.id, 'trabajo', job.id)
      if (pay.missing && !jobPaidAt) missingData.add(job.id)
      list.push({
        id: job.id,
        code: job.code ?? null,
        date: job.scheduled_date,
        clientName: job.client_name || '',
        via: inCrew ? 'cuadrilla' : 'camion',
        servicePrice,
        volumeM3,
        distanceKm,
        outsideSantiago,
        pallets,
        payMode,
        fixedAmount,
        basis: pay.basis,
        amount: pay.amount === null && !jobPaidAt ? null : frozen(w.id, 'trabajo', job.id, pay.amount || 0),
        paidAt: jobPaidAt,
      })
      jobsByWorker.set(w.id, list)
    }
    if (!anyone) unassignedJobs++
  }

  const payments = (paymentsResult.error ? [] : paymentsResult.data || []) as any[]
  const rows: WorkerPayRow[] = ((workers || []) as any[])
    .map((w) => {
      const own = jobsByWorker.get(w.id) || []
      // Pagos antiguos sin detalle: cuentan por su período. Los pagos con detalle cuentan por
      // lo que cubrieron de ESTE período, aunque se hayan registrado desde otra vista.
      const legacy = payments.filter((p) => p.worker_id === w.id && !itemsByPayment.has(p.id))
      const { rule, source } = ruleOf(w, config)
      const ownExpenses = expenses.filter((e) => e.workerId === w.id)
      const ownBonuses = bonuses.filter((b) => b.worker_id === w.id)
      const jobsDue = rule || own.some((j) => j.amount !== null) ? own.reduce((sum, j) => sum + (j.amount || 0), 0) : null
      const expensesTotal = ownExpenses.filter((e) => e.owed).reduce((sum, e) => sum + e.amount, 0)
      const ownClosings = closings.filter((c) => c.worker_id === w.id)
      const exact = ownClosings.find((c) => c.period_from === from && c.period_to === to)
      const bonusTotal = ownBonuses.reduce((sum, b) => sum + (Number(b.amount) || 0), 0)
      const basePay = typeof w.pay_base === 'number' && w.pay_base > 0 ? w.pay_base : null
      const baseMonths = basePay ? monthsInRange.map((month) => ({ month, amount: frozen(w.id, 'base', month, basePay), paidAt: paidAt(w.id, 'base', month) })) : []
      const baseTotal = baseMonths.reduce((sum, b) => sum + b.amount, 0)
      const items: PayItem[] = [
        ...own
          .filter((j) => j.amount !== null)
          .map((j): PayItem => ({
            kind: 'trabajo',
            group: jobGroup(j.payMode, rule),
            ref: j.id,
            date: j.date,
            label: [j.code, j.clientName].filter(Boolean).join(' · ') || 'Trabajo',
            detail: j.basis,
            amount: j.amount || 0,
            paidAt: j.paidAt,
          })),
        ...ownExpenses
          .filter((e) => e.owed)
          .map((e): PayItem => ({ kind: 'gasto', group: 'gasto', ref: e.id, date: e.date, label: e.name, detail: 'Gasto de contado por reembolsar', amount: frozen(w.id, 'gasto', e.id, e.amount), paidAt: paidAt(w.id, 'gasto', e.id) })),
        ...ownBonuses.map(
          (b): PayItem => ({
            kind: 'ajuste',
            group: 'ajuste',
            ref: b.id,
            date: b.bonus_date,
            label: Number(b.amount) < 0 ? 'Descuento' : 'Bonificación',
            detail: b.note || '',
            amount: frozen(w.id, 'ajuste', b.id, Number(b.amount) || 0),
            paidAt: paidAt(w.id, 'ajuste', b.id),
          })
        ),
        ...baseMonths.map((b): PayItem => ({ kind: 'base', group: 'base', ref: b.month, date: `${b.month}-01`, label: `Sueldo base ${monthName(b.month)}`, detail: 'Mensual', amount: b.amount, paidAt: b.paidAt })),
      ].sort((a, b) => a.date.localeCompare(b.date))
      return {
        workerId: w.id,
        name: w.name,
        code: w.code,
        active: w.active,
        rut: w.rut || null,
        email: w.email || null,
        bank: {
          code: typeof w.bank_code === 'number' ? w.bank_code : null,
          accountType: w.bank_account_type === 'CCT' || w.bank_account_type === 'CTV' ? w.bank_account_type : null,
          accountNumber: w.bank_account_number || null,
        },
        minPerJob: minOf(w),
        honorariosRate: w.issues_boleta === true ? config.honorariosRate : null,
        retentionPending: honorariosRetention(items.filter((i) => !i.paidAt), w.issues_boleta === true ? config.honorariosRate : null),
        retentionDue: honorariosRetention(items, w.issues_boleta === true ? config.honorariosRate : null),
        rule,
        ruleSource: source,
        jobs: own,
        jobsDue,
        expenses: ownExpenses.map(({ workerId: _owner, ...expense }) => ({ ...expense, paidAt: paidAt(w.id, 'gasto', expense.id) })),
        expensesTotal,
        bonuses: ownBonuses.map((b) => ({ id: b.id, amount: Number(b.amount) || 0, date: b.bonus_date, note: b.note ?? null, createdBy: b.created_by ?? null, paidAt: paidAt(w.id, 'ajuste', b.id) })),
        bonusTotal,
        basePay,
        baseMonths,
        baseTotal,
        items,
        pending: items.filter((i) => !i.paidAt).reduce((sum, i) => sum + i.amount, 0),
        due: jobsDue !== null || expensesTotal !== 0 || bonusTotal !== 0 || baseTotal !== 0 ? (jobsDue || 0) + expensesTotal + bonusTotal + baseTotal : null,
        closing: exact
          ? ({ id: exact.id, closedBy: exact.closed_by ?? null, closedAt: exact.closed_at, note: exact.note ?? null, statement: exact.detail } as PayClosing)
          : null,
        locked: ownClosings.length > 0,
        paid: items.filter((i) => i.paidAt).reduce((sum, i) => sum + i.amount, 0) + legacy.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
        payments: [
          ...legacy,
          ...((paymentRowsById.get(w.id) || []) as any[]).filter((p) => (itemsByPayment.get(p.id) || []).some((i: any) => items.some((it) => it.kind === i.kind && it.ref === i.ref && it.paidAt))),
        ].map((p) => ({
          id: p.id,
          amount: p.amount,
          jobs: p.jobs,
          from: p.period_from,
          to: p.period_to,
          paidAt: p.paid_at,
          method: p.method,
          note: p.note,
          createdBy: p.created_by,
          items: (itemsByPayment.get(p.id) || []).map((i) => ({ kind: i.kind as PayItemKind, label: i.label || '', amount: Number(i.amount) || 0 })),
        })),
      }
    })
    .filter((r) => r.active || r.jobs.length > 0 || r.paid > 0 || r.expenses.length > 0 || r.bonuses.length > 0 || r.closing !== null)

  return {
    from,
    to,
    available,
    config,
    rows,
    totalJobs: jobs.length,
    totalDue: rows.reduce((sum, r) => sum + (r.due || 0), 0),
    totalPaid: rows.reduce((sum, r) => sum + r.paid, 0),
    unassignedJobs,
    jobsMissingData: missingData.size,
    closingsAvailable: !closingResult.error,
    itemsAvailable: !itemsError && ((workers || []) as any[]).every((w) => 'pay_base' in w),
    jobPayAvailable,
    honorariosAvailable: ((workers || []) as any[]).every((w) => 'issues_boleta' in w),
  }
}

/** Mínimo por trabajo (por m³) de un funcionario, o null. */
function minOf(worker: any): number | null {
  return typeof worker.pay_min_job === 'number' && worker.pay_min_job > 0 ? worker.pay_min_job : null
}

// ───────────────────────── Cierre de un período ─────────────────────────

/** ¿Esa fecha cae en un cierre vigente de ese funcionario? Los ajustes de un período cerrado no se tocan. */
async function isDateClosed(workerId: string, date: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('worker_pay_closings')
    .select('id')
    .eq('worker_id', workerId)
    .is('reopened_at', null)
    .lte('period_from', date)
    .gte('period_to', date)
    .limit(1)
  return !error && (data || []).length > 0
}

/**
 * Cierra el período para los funcionarios elegidos. Por cada uno guarda los totales, la glosa
 * y una copia del detalle tal como está en ese momento, y deja como reembolsados los gastos
 * de contado que entran en el cierre. Body: `{ workerIds, from, to, notes: { [workerId]: glosa } }`.
 */
export async function closeWorkerPeriods(body: any, actor: string): Promise<{ closed: string[]; skipped: string[] }> {
  const from = String(body?.from || '')
  const to = String(body?.to || '')
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new WorkerPayError('El período no es válido.')
  if (to > todayChile()) throw new WorkerPayError('El período termina después de hoy: se cierra cuando ya pasó.')
  const ids: string[] = Array.isArray(body?.workerIds) ? body.workerIds.filter((id: unknown) => typeof id === 'string' && UUID_RE.test(id)) : []
  if (ids.length === 0) throw new WorkerPayError('Elige al menos un funcionario.')

  const data = await getWorkerPay(from, to)
  if (!data.closingsAvailable) throw new WorkerPayError('Falta correr la migración add_pay_closings.sql.', 409)

  const closed: string[] = []
  const skipped: string[] = []
  for (const row of data.rows.filter((r) => ids.includes(r.workerId))) {
    // Ya cerrado, o el período se cruza con otro cierre: no se cierra dos veces lo mismo.
    if (row.locked) {
      skipped.push(row.name)
      continue
    }
    const statement = buildPayStatement(row, from, to)
    const rawNote = body?.notes && typeof body.notes[row.workerId] === 'string' ? body.notes[row.workerId] : ''
    const { data: closing, error } = await supabaseAdmin
      .from('worker_pay_closings')
      .insert({
        worker_id: row.workerId,
        period_from: from,
        period_to: to,
        jobs_total: statement.jobsTotal,
        expenses_total: statement.expensesTotal,
        adjustments_total: statement.adjustmentsTotal,
        total: statement.total,
        note: rawNote.trim().slice(0, 1000) || null,
        detail: statement,
        closed_by: actor,
      })
      .select('id')
      .single()
    if (error || !closing) throw new WorkerPayError(`No se pudo cerrar el período de ${row.name}.`, 500)
    // Dos clics o dos pestañas pueden cerrar a la vez: si quedó otro cierre abierto que se
    // cruza con este, gana el primero y este se deshace.
    const { data: overlapping } = await supabaseAdmin
      .from('worker_pay_closings')
      .select('id, closed_at')
      .eq('worker_id', row.workerId)
      .is('reopened_at', null)
      .lte('period_from', to)
      .gte('period_to', from)
      .order('closed_at', { ascending: true })
    if ((overlapping || []).length > 1 && overlapping![0].id !== closing.id) {
      await supabaseAdmin.from('worker_pay_closings').delete().eq('id', closing.id)
      skipped.push(row.name)
      continue
    }

    const pending = row.expenses.filter((e) => e.owed && !e.reimbursed).map((e) => e.id)
    if (pending.length > 0) {
      await supabaseAdmin
        .from('documents')
        .update({ expense_reimbursed_at: new Date().toISOString(), expense_reimbursed_by: actor, expense_closing_id: closing.id })
        .in('id', pending)
    }
    closed.push(row.name)
  }
  return { closed, skipped }
}

/** Reabre un cierre (solo Administrador; lo valida la ruta). Sus gastos vuelven a «por reembolsar». */
export async function reopenClosing(closingId: unknown, actor: string): Promise<{ name: string; from: string; to: string }> {
  if (typeof closingId !== 'string' || !UUID_RE.test(closingId)) throw new WorkerPayError('Cierre no encontrado', 404)
  const { data: closing } = await supabaseAdmin
    .from('worker_pay_closings')
    .update({ reopened_by: actor, reopened_at: new Date().toISOString() })
    .eq('id', closingId)
    .is('reopened_at', null)
    .select('id, worker_id, period_from, period_to')
    .maybeSingle()
  if (!closing) throw new WorkerPayError('Ese cierre no existe o ya estaba reabierto.', 404)
  await supabaseAdmin
    .from('documents')
    .update({ expense_reimbursed_at: null, expense_reimbursed_by: null, expense_closing_id: null })
    .eq('expense_closing_id', closingId)
  const { data: worker } = await supabaseAdmin.from('workers').select('name').eq('id', closing.worker_id).maybeSingle()
  return { name: worker?.name || 'funcionario', from: closing.period_from, to: closing.period_to }
}

/**
 * Regla propia de un trabajador. Body: `{ mode: 'general' | 'fijo' | 'porcentaje' | 'm3km', value, perM3, perKm }`.
 * 'general' borra la suya y vuelve a la de Configuración.
 */
export async function setWorkerRate(
  workerId: unknown,
  rawMode: unknown,
  rawValue: unknown,
  rawRates: { perM3?: unknown; perKm?: unknown } = {}
): Promise<{ name: string; from: string; to: string }> {
  if (typeof workerId !== 'string' || !UUID_RE.test(workerId)) throw new WorkerPayError('Trabajador no encontrado', 404)
  const { data: worker } = await supabaseAdmin.from('workers').select('*').eq('id', workerId).maybeSingle()
  if (!worker) throw new WorkerPayError('Trabajador no encontrado', 404)
  const describe = (w: any) => (ownRule(w) ? payRuleLabel(ownRule(w)) : 'regla general')

  let update: Record<string, number | null>
  const noRates = { pay_rate_m3: null, pay_rate_km: null }
  if (rawMode === 'm3km') {
    const perM3 = rate(rawRates.perM3)
    const perKm = rate(rawRates.perKm)
    if (perM3 === 0 && perKm === 0) throw new WorkerPayError('Escribe la tarifa por m³, por km o ambas.')
    const { error: ratesError } = await supabaseAdmin
      .from('workers')
      .update({ pay_per_job: null, pay_percent: null, pay_rate_m3: perM3, pay_rate_km: perKm })
      .eq('id', workerId)
    if (ratesError) throw new WorkerPayError('Para pagar por m³ y km falta correr la migración add_worker_pay_m3km.sql.', 409)
    return { name: worker.name, from: describe(worker), to: describe({ ...worker, pay_per_job: null, pay_percent: null, pay_rate_m3: perM3, pay_rate_km: perKm }) }
  }
  if (rawMode === 'general') update = { pay_per_job: null, pay_percent: null }
  else if (rawMode === 'fijo') {
    const value = Math.round(Number(rawValue))
    if (!Number.isFinite(value) || value < 0 || value > 5_000_000) throw new WorkerPayError('El monto por trabajo no es válido.')
    update = { pay_per_job: value, pay_percent: null }
  } else if (rawMode === 'porcentaje') {
    const value = Math.round(Number(String(rawValue).replace(',', '.')) * 100) / 100
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new WorkerPayError('El porcentaje debe estar entre 0 y 100.')
    update = { pay_per_job: null, pay_percent: value }
  } else throw new WorkerPayError('Elige regla general, monto fijo, porcentaje o m³ y km.')

  // Al cambiar de regla se limpia también la tarifa por m³/km (si esas columnas ya existen).
  let { error } = await supabaseAdmin.from('workers').update({ ...update, ...noRates }).eq('id', workerId)
  if (error) ({ error } = await supabaseAdmin.from('workers').update(update).eq('id', workerId))
  if (error && rawMode !== 'porcentaje') {
    // Sin add_worker_pay_config.sql no existe `pay_percent`: el monto fijo igual se puede guardar.
    ;({ error } = await supabaseAdmin.from('workers').update({ pay_per_job: update.pay_per_job }).eq('id', workerId))
  }
  if (error) {
    throw new WorkerPayError(
      rawMode === 'porcentaje'
        ? 'Para usar porcentaje falta correr la migración add_worker_pay_config.sql.'
        : 'No se pudo guardar: falta correr la migración add_worker_pay.sql.',
      409
    )
  }
  return { name: worker.name, from: describe(worker), to: describe({ ...worker, ...update, ...noRates }) }
}

// ───────────────────────── Regla general ─────────────────────────

/** Tarifa en pesos, con hasta dos decimales. Vacío = 0. */
function rate(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  // «2.500» es dos mil quinientos (punto de miles), no 2,5.
  const text = String(raw).trim()
  const plain = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text) ? text.replace(/\./g, '') : text
  const value = Math.round(Number(plain.replace(',', '.')) * 100) / 100
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new WorkerPayError('La tarifa no es válida.')
  return value
}

/** La regla general de pago (Configuración). Tolera que falten las migraciones. */
export async function getPayConfig(): Promise<PayConfig> {
  const { data, error } = await supabaseAdmin.from('worker_pay_config').select('*').eq('id', 1).maybeSingle()
  const none = { jobPayAvailable: false, perPallet: null, maxPalletsPerAddress: null, minJob: null, minJobAvailable: false, minM3: null, minM3Available: false, originAccountType: null, originAccountNumber: null, honorariosRate: DEFAULT_HONORARIOS_RATE, honorariosConfigAvailable: false }
  if (error) return { available: false, m3kmAvailable: false, mode: 'fijo', value: null, perM3: null, perKm: null, ...none }
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  // Sin fila todavía no se sabe por las columnas si corrió la migración: se pregunta por una.
  const jobPayAvailable = data ? 'rate_pallet' in (data as object) : !(await supabaseAdmin.from('worker_pay_config').select('rate_pallet').limit(1)).error
  return {
    available: true,
    m3kmAvailable: Boolean(data) && 'rate_m3' in (data as object),
    mode: data?.mode === 'porcentaje' || data?.mode === 'm3km' ? data.mode : 'fijo',
    value: num(data?.value),
    perM3: num(data?.rate_m3),
    perKm: num(data?.rate_km),
    jobPayAvailable,
    perPallet: num(data?.rate_pallet),
    maxPalletsPerAddress: num(data?.max_pallets_per_address),
    minJob: num(data?.min_job),
    minJobAvailable: Boolean(data) && 'min_job' in (data as object),
    minM3: num(data?.min_m3),
    minM3Available: Boolean(data) && 'min_m3' in (data as object),
    honorariosRate: num(data?.honorarios_rate) || DEFAULT_HONORARIOS_RATE,
    honorariosConfigAvailable: Boolean(data) && 'honorarios_rate' in (data as object),
    originAccountType: data?.origin_account_type === 'CCT' || data?.origin_account_type === 'CTV' ? data.origin_account_type : null,
    originAccountNumber: data?.origin_account_number || null,
  }
}

/** Cuenta bancaria: solo dígitos (se quitan puntos, guiones y espacios). Vacío = null. */
export function accountNumber(raw: unknown, what: string): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const digits = String(raw).replace(/[\s.\-]/g, '')
  if (!/^\d{4,20}$/.test(digits)) throw new WorkerPayError(`El número de ${what} debe tener solo dígitos.`)
  return digits
}

export function accountType(raw: unknown): BankAccountType | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (raw !== 'CCT' && raw !== 'CTV') throw new WorkerPayError('El tipo de cuenta debe ser corriente (CCT) o vista (CTV).')
  return raw
}

/** Pesos por pallet y cuenta de origen de la nómina. Solo cambia lo que viene en el body. */
async function savePayExtras(body: any, actor: string): Promise<void> {
  const update: Record<string, unknown> = {}
  if ('honorariosRate' in (body || {})) {
    const value = Math.round(Number(String(body.honorariosRate).replace(',', '.')) * 100) / 100
    if (!Number.isFinite(value) || value <= 0 || value >= 100) throw new WorkerPayError('El % de retención de la boleta debe estar entre 0 y 100.')
    update.honorarios_rate = value
  }
  if ('minJob' in (body || {})) {
    const raw = body.minJob
    const value = raw === null || raw === '' ? null : Math.round(Number(raw))
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 5_000_000)) throw new WorkerPayError('El mínimo por trabajo no es válido.')
    update.min_job = value
  }
  if ('minM3' in (body || {})) {
    const raw = body.minM3
    const value = raw === null || raw === '' ? null : Math.round(Number(String(raw).replace(',', '.')) * 100) / 100
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 100)) throw new WorkerPayError('El mínimo de m³ no es válido.')
    update.min_m3 = value
  }
  if ('maxPalletsPerAddress' in (body || {})) {
    const raw = body.maxPalletsPerAddress
    const value = raw === null || raw === '' ? null : Math.round(Number(raw))
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1000)) throw new WorkerPayError('El tope de pallets por dirección no es válido.')
    update.max_pallets_per_address = value
  }
  if ('perPallet' in (body || {})) update.rate_pallet = body.perPallet === null || body.perPallet === '' ? null : rate(body.perPallet)
  if ('originAccountType' in (body || {})) update.origin_account_type = accountType(body.originAccountType)
  if ('originAccountNumber' in (body || {})) update.origin_account_number = accountNumber(body.originAccountNumber, 'cuenta de origen')
  if (Object.keys(update).length === 0) return
  const { data: existing } = await supabaseAdmin.from('worker_pay_config').select('id').eq('id', 1).maybeSingle()
  const stamp = { updated_by: actor, updated_at: new Date().toISOString() }
  const { error } = existing
    ? await supabaseAdmin.from('worker_pay_config').update({ ...update, ...stamp }).eq('id', 1)
    : await supabaseAdmin.from('worker_pay_config').insert({ id: 1, mode: 'fijo', value: null, ...update, ...stamp })
  if (error) throw new WorkerPayError('Falta correr una migración: add_nomina_y_pago_por_trabajo.sql (pallets y cuenta de origen) o add_honorarios.sql (retención).', 409)
}

export async function savePayConfig(body: any, actor: string): Promise<PayConfig> {
  // La regla se guarda solo si viene `mode`; pallets y cuenta de origen, si vienen.
  if (body?.mode) await saveRule(body, actor)
  await savePayExtras(body, actor)
  return getPayConfig()
}

async function saveRule(body: any, actor: string): Promise<void> {
  const stamp = { updated_by: actor, updated_at: new Date().toISOString() }
  if (body?.mode === 'm3km') {
    const perM3 = rate(body?.perM3)
    const perKm = rate(body?.perKm)
    if (perM3 === 0 && perKm === 0) throw new WorkerPayError('Escribe la tarifa por m³, por km o ambas.')
    const { error } = await supabaseAdmin
      .from('worker_pay_config')
      .upsert({ id: 1, mode: 'm3km', value: null, rate_m3: perM3, rate_km: perKm, ...stamp }, { onConflict: 'id' })
    if (error) throw new WorkerPayError('Para pagar por m³ y km falta correr la migración add_worker_pay_m3km.sql.', 409)
    return
  }
  const mode: PayMode = body?.mode === 'porcentaje' ? 'porcentaje' : 'fijo'
  const raw = body?.value
  let value: number | null = null
  if (raw !== null && raw !== undefined && raw !== '') {
    value = mode === 'fijo' ? Math.round(Number(raw)) : Math.round(Number(String(raw).replace(',', '.')) * 100) / 100
    if (!Number.isFinite(value) || value < 0) throw new WorkerPayError('El valor no es válido.')
    if (mode === 'porcentaje' && value > 100) throw new WorkerPayError('El porcentaje no puede pasar de 100.')
    if (mode === 'fijo' && value > 5_000_000) throw new WorkerPayError('El monto por trabajo es demasiado alto.')
  }
  const { error } = await supabaseAdmin.from('worker_pay_config').upsert({ id: 1, mode, value, ...stamp }, { onConflict: 'id' })
  if (error) throw new WorkerPayError('No se pudo guardar: falta correr la migración add_worker_pay_config.sql.', 409)
}

/** La regla propia de un trabajador, o null si usa la general. */
function ownRule(worker: any): PayRule | null {
  if (worker.pay_rate_m3 != null || worker.pay_rate_km != null) {
    return { mode: 'm3km', value: 0, perM3: Number(worker.pay_rate_m3) || 0, perKm: Number(worker.pay_rate_km) || 0 }
  }
  if (typeof worker.pay_per_job === 'number') return { mode: 'fijo', value: worker.pay_per_job }
  if (worker.pay_percent !== null && worker.pay_percent !== undefined) return { mode: 'porcentaje', value: Number(worker.pay_percent) }
  return null
}

/** La regla que le toca a un trabajador: la suya si tiene, si no la general. */
function ruleOf(worker: any, config: PayConfig): { rule: PayRule | null; source: 'propia' | 'general' | null } {
  const own = ownRule(worker)
  if (own) return { rule: own, source: 'propia' }
  const general = configRule(config)
  return general ? { rule: general, source: 'general' } : { rule: null, source: null }
}

/** Carga una bonificación a un trabajador. Body: `{ workerId, amount, date, note? }`. */
export async function addWorkerBonus(body: any, actor: string): Promise<{ name: string; amount: number }> {
  const workerId = body?.workerId
  if (typeof workerId !== 'string' || !UUID_RE.test(workerId)) throw new WorkerPayError('Trabajador no encontrado', 404)
  // Positivo = bonificación; negativo = descuento o ajuste en contra.
  const amount = Math.round(Number(body?.amount))
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 50_000_000) throw new WorkerPayError('Escribe el monto, en pesos.')
  const date = String(body?.date || '')
  if (!DAY_RE.test(date)) throw new WorkerPayError('La fecha no es válida.')
  if (await isDateClosed(workerId, date)) throw new WorkerPayError('Esa fecha está en un período cerrado. Para ajustarlo, un Administrador tiene que reabrirlo.', 409)
  const { data: worker } = await supabaseAdmin.from('workers').select('id, name').eq('id', workerId).maybeSingle()
  if (!worker) throw new WorkerPayError('Trabajador no encontrado', 404)
  const { error } = await supabaseAdmin.from('worker_bonuses').insert({
    worker_id: workerId,
    bonus_date: date,
    amount,
    note: typeof body?.note === 'string' ? body.note.trim().slice(0, 300) || null : null,
    created_by: actor,
  })
  if (error) {
    throw new WorkerPayError(
      amount < 0 ? 'Para cargar un descuento falta correr la migración add_pay_closings.sql.' : 'No se pudo guardar: falta correr la migración add_worker_pay_m3km.sql.',
      409
    )
  }
  return { name: worker.name, amount }
}

/** Quita una bonificación cargada por error. */
export async function removeWorkerBonus(bonusId: unknown): Promise<{ name: string; amount: number }> {
  if (typeof bonusId !== 'string' || !UUID_RE.test(bonusId)) throw new WorkerPayError('Bonificación no encontrada', 404)
  const { data: bonus } = await supabaseAdmin.from('worker_bonuses').select('id, amount, worker_id, bonus_date').eq('id', bonusId).maybeSingle()
  if (!bonus) throw new WorkerPayError('Bonificación no encontrada', 404)
  if (await isDateClosed(bonus.worker_id, bonus.bonus_date)) {
    throw new WorkerPayError('Ese ajuste está en un período cerrado. Para quitarlo, un Administrador tiene que reabrirlo.', 409)
  }
  const { data: paidItem } = await supabaseAdmin
    .from('worker_payment_items')
    .select('id')
    .eq('worker_id', bonus.worker_id)
    .eq('kind', 'ajuste')
    .eq('ref', bonus.id)
    .maybeSingle()
  if (paidItem) throw new WorkerPayError('Ese ajuste ya entró en un pago registrado: no se puede quitar.', 409)
  const { data: worker } = await supabaseAdmin.from('workers').select('name').eq('id', bonus.worker_id).maybeSingle()
  const { error } = await supabaseAdmin.from('worker_bonuses').delete().eq('id', bonusId)
  if (error) throw new WorkerPayError('No se pudo quitar la bonificación', 500)
  return { name: worker?.name || 'trabajador', amount: Number(bonus.amount) || 0 }
}

/**
 * Registra un pago hecho a un funcionario. El panel no transfiere nada: deja constancia.
 *
 * Con `items` (lo normal): se pagan exactamente los trabajos, gastos, ajustes y sueldos base
 * que se marcaron. El monto NO viene del navegador: se vuelve a calcular acá con los valores
 * vigentes, y cada ítem queda guardado con su monto para saber después qué cubrió cada pago.
 * Lo que no se marca queda pendiente para un pago posterior. Un ítem ya pagado no se puede
 * pagar de nuevo (lo impide además la restricción única de la tabla).
 *
 * Sin `items`: el registro antiguo, un monto a mano para el período.
 */
export async function recordWorkerPayment(body: any, actor: string): Promise<{ name: string; amount: number; items: number }> {
  const workerId = body?.workerId
  if (typeof workerId !== 'string' || !UUID_RE.test(workerId)) throw new WorkerPayError('Trabajador no encontrado', 404)
  const from = String(body?.from || '')
  const to = String(body?.to || '')
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new WorkerPayError('El período del pago no es válido.')
  const method = typeof body?.method === 'string' ? body.method.trim().slice(0, 40) || null : null
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) || null : null
  const { data: worker } = await supabaseAdmin.from('workers').select('id, name').eq('id', workerId).maybeSingle()
  if (!worker) throw new WorkerPayError('Trabajador no encontrado', 404)

  const wanted: { kind: string; ref: string }[] = Array.isArray(body?.items) ? body.items : []
  if (wanted.length === 0) {
    const amount = Math.round(Number(body?.amount))
    if (!Number.isFinite(amount) || amount <= 0 || amount > 50_000_000) throw new WorkerPayError('Escribe el monto pagado, en pesos.')
    const { error } = await supabaseAdmin.from('worker_payments').insert({
      worker_id: workerId,
      period_from: from,
      period_to: to,
      jobs: Math.max(0, Math.round(Number(body?.jobs) || 0)),
      amount,
      method,
      note,
      created_by: actor,
    })
    if (error) throw new WorkerPayError('No se pudo registrar: falta correr la migración add_worker_pay.sql.', 409)
    return { name: worker.name, amount, items: 0 }
  }

  const data = await getWorkerPay(from, to)
  if (!data.itemsAvailable) throw new WorkerPayError('Falta correr la migración add_payment_items.sql.', 409)
  const row = data.rows.find((r) => r.workerId === workerId)
  if (!row) throw new WorkerPayError('Ese funcionario no tiene nada que pagar en el período.')
  const chosen = wanted.map((w) => row.items.find((i) => i.kind === w?.kind && i.ref === w?.ref))
  if (chosen.some((i) => !i)) throw new WorkerPayError('Algo de lo marcado ya no está en el período. Vuelve a cargar y revisa.', 409)
  const items = chosen as PayItem[]
  if (new Set(items.map((i) => `${i.kind}|${i.ref}`)).size !== items.length) throw new WorkerPayError('Hay ítems repetidos en el pago.')
  if (items.some((i) => i.paidAt)) throw new WorkerPayError('Algo de lo marcado ya estaba pagado. Vuelve a cargar y revisa.', 409)
  const amount = items.reduce((sum, i) => sum + i.amount, 0)
  if (amount <= 0) throw new WorkerPayError('Lo marcado suma cero o menos: no hay nada que pagar.')

  const { data: payment, error } = await supabaseAdmin
    .from('worker_payments')
    .insert({
      worker_id: workerId,
      period_from: from,
      period_to: to,
      jobs: items.filter((i) => i.kind === 'trabajo').length,
      amount,
      method,
      note,
      created_by: actor,
    })
    .select('id')
    .single()
  if (error || !payment) throw new WorkerPayError('No se pudo registrar el pago.', 500)

  const { error: itemsError } = await supabaseAdmin.from('worker_payment_items').insert(
    items.map((i) => ({ payment_id: payment.id, worker_id: workerId, kind: i.kind, ref: i.ref, label: `${i.label}${i.detail ? ` — ${i.detail}` : ''}`.slice(0, 300), amount: i.amount }))
  )
  if (itemsError) {
    // Sin su detalle el pago no puede quedar: se deshace. 23505 = otro pago se adelantó con un mismo ítem.
    await supabaseAdmin.from('worker_payments').delete().eq('id', payment.id)
    throw new WorkerPayError(
      itemsError.code === '23505' ? 'Algo de lo marcado ya se pagó en otro registro. Vuelve a cargar y revisa.' : 'No se pudo guardar el detalle del pago.',
      itemsError.code === '23505' ? 409 : 500
    )
  }

  // Los gastos que entran en el pago quedan reembolsados, atados a este pago.
  const expenseIds = items.filter((i) => i.kind === 'gasto').map((i) => i.ref)
  if (expenseIds.length > 0) {
    await supabaseAdmin
      .from('documents')
      .update({ expense_reimbursed_at: new Date().toISOString(), expense_reimbursed_by: actor, expense_payment_id: payment.id })
      .in('id', expenseIds)
  }
  return { name: worker.name, amount, items: items.length }
}

/** Sueldo base mensual de un funcionario. `null` o 0 = sin base. */
export async function setWorkerBase(workerId: unknown, rawAmount: unknown): Promise<{ name: string; from: number | null; to: number | null }> {
  if (typeof workerId !== 'string' || !UUID_RE.test(workerId)) throw new WorkerPayError('Trabajador no encontrado', 404)
  const amount = rawAmount === null || rawAmount === '' || rawAmount === undefined ? null : Math.round(Number(rawAmount))
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 20_000_000)) throw new WorkerPayError('El sueldo base no es válido.')
  const { data: worker } = await supabaseAdmin.from('workers').select('*').eq('id', workerId).maybeSingle()
  if (!worker) throw new WorkerPayError('Trabajador no encontrado', 404)
  const next = amount && amount > 0 ? amount : null
  const { error } = await supabaseAdmin.from('workers').update({ pay_base: next }).eq('id', workerId)
  if (error) throw new WorkerPayError('No se pudo guardar: falta correr la migración add_payment_items.sql.', 409)
  return { name: worker.name, from: typeof worker.pay_base === 'number' ? worker.pay_base : null, to: next }
}

// ───────────────────────── Pago por trabajo ─────────────────────────

/**
 * Cómo se le paga a una persona UN trabajo, y los datos del trabajo que mueven el cálculo.
 * Body: `{ workerId, bookingId, mode?: 'regla' | 'fijo' | 'pallets', amount?, pallets?, outsideSantiago? }`.
 * Solo cambia lo que viene. «Fuera de Santiago» y los pallets son del trabajo: valen para
 * todos los que fueron. No se toca un trabajo ya pagado ni uno de un período cerrado.
 */
export async function setJobPay(body: any, actor: string): Promise<{ name: string; label: string; changes: Record<string, { from: string; to: string }> }> {
  const workerId = body?.workerId
  const bookingId = body?.bookingId
  if (typeof workerId !== 'string' || !UUID_RE.test(workerId)) throw new WorkerPayError('Trabajador no encontrado', 404)
  if (typeof bookingId !== 'string' || !UUID_RE.test(bookingId)) throw new WorkerPayError('Trabajo no encontrado', 404)
  const [{ data: worker }, { data: booking }] = await Promise.all([
    supabaseAdmin.from('workers').select('id, name').eq('id', workerId).maybeSingle(),
    supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle(),
  ])
  if (!worker) throw new WorkerPayError('Trabajador no encontrado', 404)
  if (!booking) throw new WorkerPayError('Trabajo no encontrado', 404)
  if (!('outside_santiago' in booking)) throw new WorkerPayError('Falta correr la migración add_nomina_y_pago_por_trabajo.sql.', 409)
  const label = [booking.code, booking.client_name].filter(Boolean).join(' · ') || 'trabajo'

  if (booking.scheduled_date && (await isDateClosed(workerId, booking.scheduled_date))) {
    throw new WorkerPayError('Ese trabajo está en un período cerrado. Para cambiarlo, un Administrador tiene que reabrirlo.', 409)
  }
  const { data: paid } = await supabaseAdmin.from('worker_payment_items').select('worker_id').eq('kind', 'trabajo').eq('ref', bookingId)
  const paidWorkers = new Set(((paid || []) as any[]).map((p) => p.worker_id))
  const changes: Record<string, { from: string; to: string }> = {}

  // Lo del trabajo: vale para todos los que fueron, así que no se toca si a alguien ya se le pagó.
  const bookingUpdate: Record<string, unknown> = {}
  if ('outsideSantiago' in body) {
    const next = Boolean(body.outsideSantiago)
    if (next !== Boolean(booking.outside_santiago)) {
      bookingUpdate.outside_santiago = next
      changes['fuera de Santiago'] = { from: booking.outside_santiago ? 'sí' : 'no', to: next ? 'sí' : 'no' }
    }
  }
  if ('pallets' in body) {
    const next = body.pallets === null || body.pallets === '' ? null : Math.round(Number(body.pallets))
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100_000)) throw new WorkerPayError('La cantidad de pallets no es válida.')
    if (next !== (booking.pallets ?? null)) {
      bookingUpdate.pallets = next
      changes.pallets = { from: String(booking.pallets ?? '—'), to: String(next ?? '—') }
    }
  }
  if (Object.keys(bookingUpdate).length > 0) {
    if (paidWorkers.size > 0) throw new WorkerPayError('Ese trabajo ya se le pagó a alguien: sus datos ya no se cambian.', 409)
    // Lo del trabajo cambia el pago de toda la cuadrilla: si alguno la tiene en un período
    // cerrado, no se toca (antes solo se miraba a la persona de la fila).
    if (booking.scheduled_date) {
      const [{ data: crew }, { data: byTruck }] = await Promise.all([
        supabaseAdmin.from('booking_workers').select('worker_id').eq('booking_id', bookingId),
        typeof booking.vehicle_id === 'number'
          ? supabaseAdmin.from('workers').select('id').eq('vehicle_id', booking.vehicle_id).eq('active', true)
          : Promise.resolve({ data: [] as { id: string }[] }),
      ])
      const everyone = new Set([...((crew || []) as any[]).map((c) => c.worker_id), ...((byTruck || []) as any[]).map((w) => w.id)])
      for (const id of everyone) {
        if (id !== workerId && (await isDateClosed(id, booking.scheduled_date))) {
          throw new WorkerPayError('Otra persona de este trabajo ya lo tiene en un período cerrado: sus datos ya no se cambian.', 409)
        }
      }
    }
    const { error } = await supabaseAdmin.from('bookings').update(bookingUpdate).eq('id', bookingId)
    if (error) throw new WorkerPayError('No se pudo guardar el trabajo.', 500)
  }

  // Lo de esta persona en este trabajo.
  if ('mode' in body) {
    const mode: JobPayMode = body.mode === 'fijo' || body.mode === 'pallets' ? body.mode : 'regla'
    if (body.mode !== mode) throw new WorkerPayError('Elige según su regla, monto a mano o por pallets.')
    if (paidWorkers.has(workerId)) throw new WorkerPayError('Ese trabajo ya se le pagó: su monto ya no se cambia.', 409)
    const { data: before } = await supabaseAdmin.from('worker_job_pay').select('mode, amount').eq('worker_id', workerId).eq('booking_id', bookingId).maybeSingle()
    const describe = (m: string | undefined, a: number | null | undefined) =>
      m === 'fijo' ? `monto a mano $${Math.round(Number(a) || 0).toLocaleString('es-CL')}` : m === 'pallets' ? 'por pallets' : 'según su regla'
    let error
    // En un trabajo de empresa por pallets lo normal es pagar por pallets: «según su regla» se
    // guarda explícito, porque borrar el ajuste lo devolvía a pallets.
    let palletDefault = false
    if (mode === 'regla' && booking.company_id && booking.delivery_unit !== 'kg' && Number(booking.pallets) > 0) {
      const { data: company } = await supabaseAdmin.from('companies').select('*').eq('id', booking.company_id).maybeSingle()
      palletDefault = (company as any)?.closing_unit === 'pallets' || (company as any)?.closing_unit === 'kg'
    }
    if (mode === 'regla' && palletDefault) {
      ;({ error } = await supabaseAdmin
        .from('worker_job_pay')
        .upsert({ worker_id: workerId, booking_id: bookingId, mode: 'regla', amount: null, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: 'worker_id,booking_id' }))
      if (error) throw new WorkerPayError('Para pagar este trabajo según su regla falta correr la migración add_pago_regla_explicita.sql.', 409)
      changes['se le paga'] = { from: describe(before?.mode ?? 'pallets', before?.amount), to: describe('regla', null) }
    } else if (mode === 'regla') {
      ;({ error } = await supabaseAdmin.from('worker_job_pay').delete().eq('worker_id', workerId).eq('booking_id', bookingId))
      if (before) changes['se le paga'] = { from: describe(before.mode, before.amount), to: describe('regla', null) }
    } else {
      const amount = mode === 'fijo' ? Math.round(Number(body.amount)) : null
      if (mode === 'fijo' && (!Number.isFinite(amount) || (amount as number) < 0 || (amount as number) > 20_000_000)) throw new WorkerPayError('Escribe el monto del trabajo, en pesos.')
      ;({ error } = await supabaseAdmin
        .from('worker_job_pay')
        .upsert({ worker_id: workerId, booking_id: bookingId, mode, amount, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: 'worker_id,booking_id' }))
      changes['se le paga'] = { from: describe(before?.mode, before?.amount), to: describe(mode, amount) }
    }
    if (error) throw new WorkerPayError('No se pudo guardar cómo se paga el trabajo.', 500)
  }
  return { name: worker.name, label, changes }
}

/**
 * Mínimo por trabajo y datos bancarios de un funcionario. Body: `{ workerId, minPerJob?,
 * bankCode?, bankAccountType?, bankAccountNumber? }`. Solo cambia lo que viene.
 */
export async function setWorkerPayProfile(body: any): Promise<{ name: string; changes: Record<string, { from: string; to: string }> }> {
  const workerId = body?.workerId
  if (typeof workerId !== 'string' || !UUID_RE.test(workerId)) throw new WorkerPayError('Trabajador no encontrado', 404)
  const { data: worker } = await supabaseAdmin.from('workers').select('*').eq('id', workerId).maybeSingle()
  if (!worker) throw new WorkerPayError('Trabajador no encontrado', 404)
  if (!('bank_code' in worker)) throw new WorkerPayError('Falta correr la migración add_nomina_y_pago_por_trabajo.sql.', 409)

  const update: Record<string, unknown> = {}
  if ('minPerJob' in body) {
    const min = body.minPerJob === null || body.minPerJob === '' ? null : Math.round(Number(body.minPerJob))
    if (min !== null && (!Number.isFinite(min) || min < 0 || min > 20_000_000)) throw new WorkerPayError('El mínimo por trabajo no es válido.')
    update.pay_min_job = min && min > 0 ? min : null
  }
  if ('bankCode' in body) {
    const code = body.bankCode === null || body.bankCode === '' ? null : Math.round(Number(body.bankCode))
    if (code !== null && (!Number.isFinite(code) || code <= 0 || code > 9999)) throw new WorkerPayError('El código de banco no es válido.')
    update.bank_code = code
  }
  if ('issuesBoleta' in body) {
    if (!('issues_boleta' in worker)) throw new WorkerPayError('Para la boleta de honorarios falta correr la migración add_honorarios.sql.', 409)
    update.issues_boleta = body.issuesBoleta === true
  }
  if ('bankAccountType' in body) update.bank_account_type = accountType(body.bankAccountType)
  if ('bankAccountNumber' in body) update.bank_account_number = accountNumber(body.bankAccountNumber, 'cuenta')

  const labels: Record<string, string> = { issues_boleta: 'emite boleta de honorarios', pay_min_job: 'mínimo por trabajo', bank_code: 'banco', bank_account_type: 'tipo de cuenta', bank_account_number: 'número de cuenta' }
  const changes: Record<string, { from: string; to: string }> = {}
  for (const [key, value] of Object.entries(update)) {
    if ((worker[key] ?? null) === value) continue
    // El número de cuenta no se copia al registro de actividad: solo que cambió.
    changes[labels[key]] = key === 'bank_account_number' ? { from: worker[key] ? 'cargado' : '—', to: value ? 'nuevo' : '—' } : { from: String(worker[key] ?? '—'), to: String(value ?? '—') }
  }
  if (Object.keys(changes).length === 0) return { name: worker.name, changes }
  const { error } = await supabaseAdmin.from('workers').update(update).eq('id', workerId)
  if (error) throw new WorkerPayError('No se pudieron guardar los datos.', 500)
  return { name: worker.name, changes }
}

// ───────────────────────── Nómina para el banco ─────────────────────────

/** RUT para la nómina: número y dígito verificador juntos, sin puntos ni guion (12.345.678-9 → 123456789). */
function payrollRut(rut: string): string {
  return rut.replace(/[^\dkK]/g, '').toUpperCase()
}

/** Un valor numérico va como número (así lo trae la plantilla), salvo que empiece con 0 o tenga letras. */
const asCell = (value: string): string | number => (/^[1-9]\d{0,14}$/.test(value) ? Number(value) : value)

export interface BankPayroll {
  from: string
  to: string
  /** Filas con las 13 columnas de la plantilla del banco. */
  rows: (string | number | null)[][]
  total: number
  /** Funcionarios con saldo que no entran por datos bancarios incompletos. */
  skipped: { name: string; amount: number; missing: string[] }[]
}

/**
 * La nómina del banco del período: una fila por funcionario con saldo por pagar (lo que
 * falta pagar de sus trabajos, gastos, ajustes y sueldo base), en el formato de la plantilla
 * del banco. Quien no tiene completos sus datos bancarios queda fuera y se avisa.
 */
export async function buildBankPayroll(rawFrom: unknown, rawTo: unknown): Promise<BankPayroll> {
  const data = await getWorkerPay(rawFrom, rawTo)
  if (!data.jobPayAvailable) throw new WorkerPayError('Falta correr la migración add_nomina_y_pago_por_trabajo.sql.', 409)
  const { originAccountType, originAccountNumber } = data.config
  if (!originAccountType || !originAccountNumber) {
    throw new WorkerPayError('Falta la cuenta de origen de la empresa: se pone en Configuración → Pago a trabajadores.', 409)
  }
  const ddmm = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}`
  const concept = `Pago ${ddmm(data.from)} al ${ddmm(data.to)}`
  const rows: (string | number | null)[][] = []
  const skipped: BankPayroll['skipped'] = []
  for (const r of data.rows) {
    // Se le transfiere el líquido pactado. Con boleta, la retención la paga la empresa al SII
    // aparte (va encima): no se descuenta de la transferencia.
    const amount = data.itemsAvailable ? r.pending : (r.due || 0) - r.paid
    if (amount <= 0) continue
    const missing = bankDataMissing(r)
    if (missing.length > 0) {
      skipped.push({ name: r.name, amount, missing })
      continue
    }
    rows.push([
      originAccountType,
      asCell(originAccountNumber),
      r.bank.code as number,
      r.bank.accountType as string,
      asCell(r.bank.accountNumber as string),
      asCell(payrollRut(r.rut as string)),
      r.name,
      amount,
      concept,
      'Pago Yo Me Encargo',
      // Celdas vacías, no textos vacíos: así vienen en la plantilla.
      r.email || null,
      null,
      null,
    ])
  }
  if (rows.length > 0 && rows[0].length !== BANK_PAYROLL_HEADERS.length) throw new WorkerPayError('La nómina quedó con columnas de más o de menos.', 500)
  return { from: data.from, to: data.to, rows, total: rows.reduce((sum, row) => sum + (row[7] as number), 0), skipped }
}

// ───────────────────────── Mis pagos (panel del funcionario) ─────────────────────────

/** Un cierre vigente del propio funcionario, para «Mis pagos» en /trabajos. */
export interface OwnPayClosing {
  id: string
  from: string
  to: string
  total: number
  closedAt: string
}

/**
 * Cierres vigentes del funcionario, del más nuevo al más viejo (Francisco, 27-10-2026: que cada
 * trabajador descargue el detalle de lo que se le pagó). Solo períodos cerrados: lo abierto todavía
 * puede cambiar. Sin add_pay_closings.sql devuelve vacío.
 */
export async function listOwnPayClosings(workerId: string): Promise<OwnPayClosing[]> {
  const { data, error } = await supabaseAdmin
    .from('worker_pay_closings')
    .select('id, period_from, period_to, total, closed_at')
    .eq('worker_id', workerId)
    .is('reopened_at', null)
    .order('period_from', { ascending: false })
    .limit(100)
  if (error) return []
  return ((data || []) as any[]).map((c) => ({ id: c.id, from: c.period_from, to: c.period_to, total: Number(c.total) || 0, closedAt: c.closed_at }))
}

/** El detalle de un cierre, igual al que se descarga en Cierre de pagos. */
export interface PayClosingDetail {
  workerId: string
  statement: PayStatement
  note: string | null
  paid: number
  closed: { by: string | null; at: string }
}

/**
 * El detalle de UN cierre del propio funcionario, igual al que descarga el admin en Cierre de
 * pagos: la copia guardada al cerrar, la glosa y lo pagado en el período. Un cierre de otra
 * persona o reabierto responde «no encontrado».
 */
export async function getOwnPayClosing(workerId: string, closingId: unknown): Promise<PayClosingDetail> {
  return getPayClosingDetail(closingId, workerId)
}

/**
 * El detalle de un cierre vigente. Con `workerId`, solo si es de esa persona. `payCache` evita
 * recalcular lo pagado cuando se piden varios cierres del mismo período (envío por correo).
 */
export async function getPayClosingDetail(
  closingId: unknown,
  workerId: string | null = null,
  payCache?: Map<string, Promise<WorkerPayData>>
): Promise<PayClosingDetail> {
  if (typeof closingId !== 'string' || !UUID_RE.test(closingId)) throw new WorkerPayError('Cierre no encontrado', 404)
  let query = supabaseAdmin.from('worker_pay_closings').select('*').eq('id', closingId).is('reopened_at', null)
  if (workerId) query = query.eq('worker_id', workerId)
  const { data: closing } = await query.maybeSingle()
  if (!closing) throw new WorkerPayError('Cierre no encontrado', 404)
  // Lo pagado sale del mismo cálculo que ve el admin, para que el saldo diga lo mismo.
  const key = `${closing.period_from}|${closing.period_to}`
  const pending = payCache?.get(key) || getWorkerPay(closing.period_from, closing.period_to)
  payCache?.set(key, pending)
  const row = (await pending).rows.find((r) => r.workerId === closing.worker_id)
  return {
    workerId: closing.worker_id,
    statement: closing.detail as PayStatement,
    note: closing.note ?? null,
    paid: row?.paid ?? 0,
    closed: { by: closing.closed_by ?? null, at: closing.closed_at },
  }
}
