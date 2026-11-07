'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import {
  BANKS,
  BANK_ACCOUNT_TYPES,
  PAY_GROUP_LABEL,
  PAY_GROUP_ORDER,
  PAY_ITEM_LABEL,
  bankDataMissing,
  bankName,
  honorariosRetention,
  configRule,
  monthName,
  payRuleLabel,
  type BankAccountType,
  type JobPayMode,
  type PayItem,
  type WorkerPayData,
  type WorkerPayJob,
  type WorkerPayRow,
} from '@/lib/workerPayTypes'

/**
 * Pago a trabajadores. Un bloque por persona con sus trabajos del período, cómo se paga cada
 * uno (según su regla, un monto a mano o por pallets), lo demás que se le debe (sueldo base,
 * gastos por devolver, bonificaciones y descuentos), el total, lo pagado y el saldo. Arriba se
 * descarga la nómina para el banco con el saldo de cada uno. Los pagos se registran a mano:
 * el panel no transfiere nada.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
// Una fecha AAAA-MM-DD se muestra tal cual; un instante (pago, cierre) en el día de Chile.
const day = (d: string) =>
  (d.length > 10 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(d)) : d.slice(0, 10)).split('-').reverse().join('-')
type RateMode = 'general' | 'fijo' | 'porcentaje' | 'm3km'
const num = (n: number | null, unit: string) => (n === null ? `sin ${unit}` : `${n.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ${unit}`)
const digits = (v: string) => v.replace(/\D/g, '')

interface ProfileDraft {
  id: string
  mode: RateMode
  value: string
  perM3: string
  perKm: string
  base: string
  min: string
  bankCode: string
  otherBank: boolean
  accountType: BankAccountType | ''
  accountNumber: string
  /** Emite boleta de honorarios (la tasa es la de Configuración). */
  honorarios: boolean
}

/** Un color por persona, para distinguir los bloques de un vistazo (Tomás: «contraste para no confundir»). */
const WORKER_COLORS = ['#2C5282', '#2F855A', '#B7791F', '#6B46C1', '#C53030', '#2C7A7B', '#B83280', '#4A5568']
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('')

/** Totales por grupo (fijo, variable, pallets…): lo del período y lo que falta pagar. */
function groupTotals(items: PayItem[]) {
  return PAY_GROUP_ORDER.map((group) => {
    const own = items.filter((i) => i.group === group)
    return {
      group,
      count: own.length,
      total: own.reduce((sum, i) => sum + i.amount, 0),
      pending: own.filter((i) => !i.paidAt).reduce((sum, i) => sum + i.amount, 0),
    }
  }).filter((g) => g.count > 0)
}

const pct = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })} %`

export default function WorkerPayPanel() {
  // Se paga por semana: el panel abre en la semana en curso.
  const [period, setPeriod] = useState<Period>(periodOf('week'))
  const resolved = resolvePeriod(period)
  const week = resolvePeriod(periodOf('week'))
  const from = resolved.from && resolved.to ? resolved.from : (week.from as string)
  const to = resolved.from && resolved.to ? resolved.to : (week.to as string)

  const [data, setData] = useState<WorkerPayData | null>(null)
  const [only, setOnly] = useState('')
  const [withBalance, setWithBalance] = useState(false)
  const [showPayments, setShowPayments] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null)
  const [bonusDraft, setBonusDraft] = useState<{ id: string; amount: string; date: string; note: string } | null>(null)
  const [payDraft, setPayDraft] = useState<{ id: string; amount: string; method: string; note: string } | null>(null)
  // Pago con detalle: qué ítems (trabajos, gastos, ajustes, base) entran. Clave = tipo|ref.
  const [itemsDraft, setItemsDraft] = useState<{ id: string; selected: Set<string>; method: string; note: string } | null>(null)
  // Monto a mano o pallets de un trabajo mientras se escriben. Clave = funcionario|trabajo.
  const [jobDraft, setJobDraft] = useState<{ key: string; mode: 'fijo' | 'pallets'; value: string } | null>(null)
  const itemKey = (i: PayItem) => `${i.kind}|${i.ref}`
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/worker-pay?desde=${from}&hasta=${to}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cargar')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar')
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const request = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, body === null ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error || 'No se pudo guardar')
    return json
  }

  const send = async (url: string, method: string, body: unknown, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      await request(url, method, body)
      toast.success(ok)
      setProfileDraft(null)
      setPayDraft(null)
      setItemsDraft(null)
      setBonusDraft(null)
      setJobDraft(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  /** Guarda todo lo de «cómo se le paga»: tarifa, sueldo base, mínimo por trabajo y datos bancarios. */
  const saveProfile = async (r: WorkerPayRow) => {
    if (!profileDraft || busy || !data) return
    setBusy(true)
    try {
      const d = profileDraft
      await request('/api/admin/worker-pay/rate', 'PUT', { workerId: r.workerId, mode: d.mode, value: d.value, perM3: d.perM3, perKm: d.perKm })
      const base = d.base === '' ? null : Number(d.base)
      if (data.itemsAvailable && (base || null) !== (r.basePay || null)) await request('/api/admin/worker-pay/base', 'PUT', { workerId: r.workerId, amount: base })
      if (data.jobPayAvailable || data.honorariosAvailable) {
        await request('/api/admin/worker-pay/profile', 'PUT', {
          workerId: r.workerId,
          ...(data.jobPayAvailable
            ? {
                minPerJob: d.min === '' ? null : Number(d.min),
                bankCode: d.bankCode === '' ? null : Number(d.bankCode),
                bankAccountType: d.accountType || null,
                bankAccountNumber: d.accountNumber || null,
              }
            : {}),
          ...(data.honorariosAvailable ? { issuesBoleta: d.honorarios } : {}),
        })
      }
      toast.success('Forma de pago guardada')
      setProfileDraft(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  const saveJob = (r: WorkerPayRow, j: WorkerPayJob, body: Record<string, unknown>, ok: string) =>
    send('/api/admin/worker-pay/job', 'PUT', { workerId: r.workerId, bookingId: j.id, ...body }, ok)

  /** Nómina para el banco: avisa quién queda fuera por datos bancarios incompletos y baja el CSV de BancoEstado. */
  const downloadPayroll = async () => {
    if (busy || !data) return
    setBusy(true)
    try {
      const summary = await (async () => {
        const res = await fetch(`/api/admin/worker-pay/nomina?desde=${data.from}&hasta=${data.to}&resumen=1`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error || 'No se pudo armar la nómina')
        return json as { count: number; total: number; skipped: { name: string; amount: number; missing: string[] }[] }
      })()
      const left = summary.skipped.map((s) => `• ${s.name} (${clp(s.amount)}): falta ${s.missing.join(', ')}`).join('\n')
      if (summary.count === 0) throw new Error(left ? `Nadie tiene sus datos bancarios completos:\n${left}` : 'No hay saldos por pagar en este período.')
      if (left && !window.confirm(`La nómina lleva ${summary.count} pagos por ${clp(summary.total)}.\n\nQuedan fuera por datos bancarios incompletos:\n${left}\n\n¿Descargar igual?`)) return
      const res = await fetch(`/api/admin/worker-pay/nomina?desde=${data.from}&hasta=${data.to}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'No se pudo descargar la nómina')
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `nomina_banco_${data.from}_${data.to}.csv`
      link.click()
      URL.revokeObjectURL(url)
      toast.success(`Nómina descargada: ${summary.count} pagos por ${clp(summary.total)}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo descargar la nómina', { duration: 8000 })
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  // Con el detalle por pago, el saldo es lo que queda sin pagar; sin él, lo de antes.
  const balance = (r: WorkerPayRow) => (data.itemsAvailable ? (r.due !== null ? r.pending : null) : r.due !== null ? r.due - r.paid : null)
  const rows = data.rows.filter((r) => (!only || r.workerId === only) && (!withBalance || (balance(r) || 0) > 0))

  const openProfile = (r: WorkerPayRow) =>
    setProfileDraft({
      id: r.workerId,
      mode: r.ruleSource === 'propia' && r.rule ? r.rule.mode : 'general',
      value: r.ruleSource === 'propia' && r.rule && r.rule.mode !== 'm3km' ? String(r.rule.value) : '',
      perM3: r.ruleSource === 'propia' && r.rule?.mode === 'm3km' ? String(r.rule.perM3 || '') : '',
      perKm: r.ruleSource === 'propia' && r.rule?.mode === 'm3km' ? String(r.rule.perKm || '') : '',
      base: r.basePay ? String(r.basePay) : '',
      min: r.minPerJob ? String(r.minPerJob) : '',
      bankCode: r.bank.code !== null ? String(r.bank.code) : '',
      otherBank: r.bank.code !== null && !BANKS.some((b) => b.code === r.bank.code),
      accountType: r.bank.accountType || '',
      accountNumber: r.bank.accountNumber || '',
      honorarios: r.honorariosRate !== null,
    })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">Trabajos realizados entre el {day(data.from)} y el {day(data.to)}, y lo que se le debe a cada persona.</p>
        <PeriodFilter value={period} onChange={setPeriod} presets={['week', 'month', 'custom']} />
      </div>

      <p className="text-sm text-gray-600">
        Regla general: <span className="font-semibold text-gray-900">{payRuleLabel(configRule(data.config))}</span>
        {data.config.minJob ? (
          <>
            {' '}· mínimo <span className="font-semibold text-gray-900">{clp(data.config.minJob)}</span> por trabajo
          </>
        ) : null}
        {data.jobPayAvailable && (
          <>
            {' '}· pallet: <span className="font-semibold text-gray-900">{data.config.perPallet !== null ? clp(data.config.perPallet) : 'sin definir'}</span>
          </>
        )}
        . Se cambia en Configuración → Pago a trabajadores.
        {data.jobPayAvailable && data.config.mode === 'm3km' && ' Los km solo suman en los trabajos marcados «fuera de Santiago».'}
      </p>

      {data.available && !data.itemsAvailable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_payment_items.sql</code>: sin ella no se puede elegir qué trabajos entran en cada pago ni poner
          sueldo base.
        </p>
      )}
      {data.available && !data.jobPayAvailable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_nomina_y_pago_por_trabajo.sql</code>: sin ella no se puede pagar un trabajo con monto a mano o
          por pallets, marcar «fuera de Santiago», poner mínimo por trabajo ni descargar la nómina del banco.
        </p>
      )}
      {!data.available && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_worker_pay.sql</code>: se ven los trabajos, pero todavía no se
          pueden poner tarifas ni registrar pagos.
        </p>
      )}

      {data.jobsMissingData > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {data.jobsMissingData} trabajo{data.jobsMissingData === 1 ? '' : 's'} del período {data.jobsMissingData === 1 ? 'tiene' : 'tienen'} datos incompletos (m³, km,
          pallets o monto a mano) y por eso {data.jobsMissingData === 1 ? 'paga' : 'pagan'} de menos. Los m³ y km se completan en el detalle de la reserva (Resumen
          operacional); los pallets y montos, aquí en cada trabajo.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Trabajos realizados</p>
          <p className="text-2xl font-bold text-gray-900">{data.totalJobs}</p>
        </Card>
        <Card className={`p-4 ${data.unassignedJobs > 0 ? 'border-l-4 border-l-amber-500' : ''}`}>
          <p className="text-sm text-gray-500">Sin nadie asignado</p>
          <p className="text-2xl font-bold text-gray-900">{data.unassignedJobs}</p>
          <p className="text-xs text-gray-500">No se le pagan a nadie hasta asignarlos</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Total a pagar</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.totalDue)}</p>
        </Card>
        <Card className="border-l-4 border-l-green-500 p-4">
          <p className="text-sm text-gray-500">Pagado</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.totalPaid)}</p>
          <p className="text-xs text-gray-500">Falta {clp(Math.max(0, data.totalDue - data.totalPaid))}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Ver</label>
          <select value={only} onChange={(e) => setOnly(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Todos los trabajadores ({data.rows.length})</option>
            {data.rows.map((r) => (
              <option key={r.workerId} value={r.workerId}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={withBalance} onChange={(e) => setWithBalance(e.target.checked)} />
          Solo con saldo por pagar
        </label>
        <div className="ml-auto">
          <Button size="sm" disabled={busy || !data.jobPayAvailable} onClick={downloadPayroll}>
            Descargar nómina para el banco (CSV BancoEstado)
          </Button>
          <p className="mt-1 text-right text-xs text-gray-500">El saldo por pagar de cada uno, en el formato de la plantilla del banco.</p>
        </div>
      </div>

      {data.rows.length === 0 && (
        <Card className="p-5">
          <p className="text-sm text-gray-500">No hay trabajadores creados. Se agregan en Flota y equipo.</p>
        </Card>
      )}

      {rows.map((r, index) => {
        const owed = balance(r)
        const missingBank = bankDataMissing(r)
        const others = r.items.filter((i) => i.kind !== 'trabajo')
        const color = WORKER_COLORS[index % WORKER_COLORS.length]
        const groups = groupTotals(r.items)
        return (
          <Card key={r.workerId} className="overflow-hidden border-l-[6px] p-0 shadow-md" style={{ borderLeftColor: color }}>
            {/* Encabezado: quién es, cómo se le paga y los totales */}
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-gray-200 px-5 py-4" style={{ backgroundColor: `${color}12` }}>
              <div className="flex min-w-0 flex-1 basis-56 gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: color }} aria-hidden>
                  {initials(r.name)}
                </span>
                <div className="min-w-0">
                <p className="text-lg font-bold" style={{ color }}>
                  {r.name} <span className="text-sm font-normal text-gray-500">· {r.code}{r.active ? '' : ' · inactivo'}</span>
                </p>
                <p className="text-sm text-gray-700">
                  {payRuleLabel(r.rule)}
                  <span className="text-xs text-gray-500">
                    {' '}
                    · {r.ruleSource === 'propia' ? 'tarifa propia' : r.ruleSource === 'general' ? 'regla general' : 'sin definir'}
                    {r.minPerJob ? ` · mínimo propio ${clp(r.minPerJob)} por trabajo` : data.config.minJob && r.rule?.mode === 'm3km' ? ` · mínimo general ${clp(data.config.minJob)}` : ''}
                    {r.basePay ? ` · base ${clp(r.basePay)} al mes` : ''}
                    {r.honorariosRate !== null ? ` · boleta de honorarios, retención ${pct(r.honorariosRate)}` : ''}
                  </span>
                </p>
                {data.jobPayAvailable && (
                  <p className={`text-xs ${missingBank.length > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                    {missingBank.length > 0
                      ? `Para la nómina del banco falta: ${missingBank.join(', ')}`
                      : `${bankName(r.bank.code)} · ${r.bank.accountType === 'CCT' ? 'cuenta corriente' : 'cuenta vista'} ${r.bank.accountNumber} · RUT ${r.rut}`}
                    {r.email ? ` · ${r.email}` : ' · sin correo'}
                  </p>
                )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!data.available} onClick={() => openProfile(r)}>
                  Forma de pago y banco
                </Button>
                <Button
                  size="sm"
                  disabled={!data.available}
                  onClick={() =>
                    data.itemsAvailable
                      ? setItemsDraft({ id: r.workerId, selected: new Set(r.items.filter((i) => !i.paidAt).map(itemKey)), method: 'transferencia', note: '' })
                      : setPayDraft({ id: r.workerId, amount: owed !== null && owed > 0 ? String(owed) : '', method: 'transferencia', note: '' })
                  }
                >
                  Registrar pago
                </Button>
                <Button size="sm" variant="outline" disabled={!data.config.m3kmAvailable} onClick={() => setBonusDraft({ id: r.workerId, amount: '', date: data.to, note: '' })}>
                  Bonificación
                </Button>
              </div>
              <dl className="grid basis-full grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
                {[
                  [`Trabajos (${r.jobs.length})`, r.jobsDue !== null ? clp(r.jobsDue) : '—'],
                  ['Sueldo base', clp(r.baseTotal)],
                  ['Gastos por devolver', clp(r.expensesTotal)],
                  ['Bonos y descuentos', clp(r.bonusTotal)],
                  ['Total del período', r.due !== null ? clp(r.due) : '—'],
                  ['Pagado', clp(r.paid)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
                  </div>
                ))}
                <div className={`rounded-lg px-2 py-1 ${owed !== null && owed > 0 ? 'bg-orange-100' : 'bg-green-100'}`}>
                  <dt className="text-xs text-gray-600">Saldo por pagar</dt>
                  <dd className={`text-lg font-bold tabular-nums ${owed !== null && owed > 0 ? 'text-orange-800' : 'text-green-800'}`}>{owed !== null ? clp(owed) : '—'}</dd>
                  {r.honorariosRate !== null && owed !== null && owed > 0 && (
                    <dd className="text-xs text-gray-500">
                      + retención {clp(r.retentionPending)} que paga la empresa al SII
                    </dd>
                  )}
                </div>
              </dl>
              {groups.length > 1 && (
                <div className="basis-full">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Desglose</p>
                  <div className="flex flex-wrap gap-2">
                    {groups.map((g) => (
                      <span key={g.group} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700">
                        {PAY_GROUP_LABEL[g.group]}: <span className="font-semibold tabular-nums text-gray-900">{clp(g.total)}</span>
                        {g.pending !== 0 && g.pending !== g.total && <span className="text-orange-700"> · falta {clp(g.pending)}</span>}
                        {g.pending === 0 && <span className="text-green-700"> · pagado</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {profileDraft?.id === r.workerId && (
              <div className="space-y-4 border-b border-gray-100 bg-primary-50/40 px-5 py-4">
                <p className="text-sm font-semibold text-gray-900">Cómo se le paga a {r.name}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Por cada trabajo</label>
                    <select
                      value={profileDraft.mode}
                      onChange={(e) => setProfileDraft({ ...profileDraft, mode: e.target.value as RateMode, value: '', perM3: '', perKm: '' })}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="general">Lo de la regla general ({payRuleLabel(configRule(data.config))})</option>
                      <option value="m3km" disabled={!data.config.m3kmAvailable}>
                        Tarifa propia por m³ y km
                      </option>
                      <option value="fijo">Monto fijo propio por trabajo</option>
                      <option value="porcentaje">Porcentaje propio del servicio</option>
                    </select>
                  </div>
                  {profileDraft.mode === 'm3km' && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Pesos por m³</label>
                        <input
                          inputMode="decimal"
                          value={profileDraft.perM3}
                          onChange={(e) => setProfileDraft({ ...profileDraft, perM3: e.target.value.replace(/[^\d.,]/g, '') })}
                          className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Pesos por km</label>
                        <input
                          inputMode="decimal"
                          value={profileDraft.perKm}
                          onChange={(e) => setProfileDraft({ ...profileDraft, perKm: e.target.value.replace(/[^\d.,]/g, '') })}
                          className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                    </>
                  )}
                  {(profileDraft.mode === 'fijo' || profileDraft.mode === 'porcentaje') && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">{profileDraft.mode === 'fijo' ? 'Pesos por trabajo' : 'Porcentaje (%)'}</label>
                      <input
                        inputMode="decimal"
                        value={profileDraft.value}
                        onChange={(e) =>
                          setProfileDraft({ ...profileDraft, value: profileDraft.mode === 'fijo' ? digits(e.target.value) : e.target.value.replace(/[^\d.,]/g, '') })
                        }
                        className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Mínimo por trabajo (por m³)</label>
                    <input
                      inputMode="numeric"
                      value={profileDraft.min}
                      disabled={!data.jobPayAvailable}
                      placeholder="Vacío = sin mínimo"
                      onChange={(e) => setProfileDraft({ ...profileDraft, min: digits(e.target.value) })}
                      className="w-40 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Sueldo base al mes</label>
                    <input
                      inputMode="numeric"
                      value={profileDraft.base}
                      disabled={!data.itemsAvailable}
                      placeholder="Vacío = sin base"
                      onChange={(e) => setProfileDraft({ ...profileDraft, base: digits(e.target.value) })}
                      className="w-36 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
                    />
                  </div>
                </div>

                {data.honorariosAvailable && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex items-center gap-2 pb-1.5 text-sm text-gray-700">
                      <input type="checkbox" checked={profileDraft.honorarios} onChange={(e) => setProfileDraft({ ...profileDraft, honorarios: e.target.checked })} />
                      Emite boleta de honorarios
                    </label>
                    <p className="pb-1.5 text-xs text-gray-500">
                      Se le paga el líquido pactado. La boleta se hace por el bruto (líquido ÷ (1 − {pct(data.config.honorariosRate)})) y la diferencia la paga la
                      empresa al SII: es un costo adicional. La tasa se cambia en Configuración → Pago a trabajadores.
                    </p>
                  </div>
                )}

                {data.jobPayAvailable && (
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Datos bancarios (para la nómina)</p>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Banco</label>
                        <select
                          value={profileDraft.otherBank ? 'otro' : profileDraft.bankCode}
                          onChange={(e) =>
                            setProfileDraft({ ...profileDraft, otherBank: e.target.value === 'otro', bankCode: e.target.value === 'otro' ? '' : e.target.value })
                          }
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">Sin banco</option>
                          {BANKS.map((b) => (
                            <option key={b.code} value={String(b.code)}>
                              {b.name} ({b.code})
                            </option>
                          ))}
                          <option value="otro">Otro: escribir el código</option>
                        </select>
                      </div>
                      {profileDraft.otherBank && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600">Código del banco</label>
                          <input
                            inputMode="numeric"
                            value={profileDraft.bankCode}
                            onChange={(e) => setProfileDraft({ ...profileDraft, bankCode: digits(e.target.value).slice(0, 4) })}
                            className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                          />
                        </div>
                      )}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Tipo de cuenta</label>
                        <select
                          value={profileDraft.accountType}
                          onChange={(e) => setProfileDraft({ ...profileDraft, accountType: e.target.value as BankAccountType | '' })}
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">Sin definir</option>
                          {BANK_ACCOUNT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label} ({t.value})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Número de cuenta</label>
                        <input
                          inputMode="numeric"
                          value={profileDraft.accountNumber}
                          onChange={(e) => setProfileDraft({ ...profileDraft, accountNumber: digits(e.target.value).slice(0, 20) })}
                          className="w-44 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <p className="pb-1.5 text-xs text-gray-500">
                        RUT: {r.rut || 'falta'} · correo: {r.email || 'falta'} (se cambian en Flota y equipo)
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      ((profileDraft.mode === 'fijo' || profileDraft.mode === 'porcentaje') && profileDraft.value === '') ||
                      (profileDraft.mode === 'm3km' && profileDraft.perM3 === '' && profileDraft.perKm === '')
                    }
                    onClick={() => saveProfile(r)}
                  >
                    Guardar
                  </Button>
                  <button type="button" onClick={() => setProfileDraft(null)} className="text-sm text-gray-500">
                    Cancelar
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  La tarifa propia manda sobre la regla general solo para esta persona. Con pago por m³, si un trabajo da menos que el mínimo se le paga el
                  mínimo. El sueldo base se suma a lo que gana por trabajo y se paga una vez por mes. Un trabajo puede pagarse distinto (monto a mano o por
                  pallets) desde su fila.
                </p>
              </div>
            )}

            {bonusDraft?.id === r.workerId && (
              <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 bg-primary-50/40 px-5 py-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Monto</label>
                  <input
                    autoFocus
                    inputMode="numeric"
                    value={bonusDraft.amount}
                    onChange={(e) => setBonusDraft({ ...bonusDraft, amount: digits(e.target.value) })}
                    className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Fecha</label>
                  <input type="date" value={bonusDraft.date} onChange={(e) => setBonusDraft({ ...bonusDraft, date: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Motivo (opcional)</label>
                  <input value={bonusDraft.note} maxLength={300} onChange={(e) => setBonusDraft({ ...bonusDraft, note: e.target.value })} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                </div>
                <Button
                  size="sm"
                  disabled={busy || !(Number(bonusDraft.amount) > 0) || !bonusDraft.date}
                  onClick={() => send('/api/admin/worker-pay/bonus', 'POST', { workerId: r.workerId, amount: Number(bonusDraft.amount), date: bonusDraft.date, note: bonusDraft.note }, 'Bonificación cargada')}
                >
                  Guardar bonificación
                </Button>
                <button type="button" onClick={() => setBonusDraft(null)} className="pb-1.5 text-sm text-gray-500">
                  Cancelar
                </button>
                <p className="basis-full text-xs text-gray-500">Se suma a lo que se le debe en el período que incluya esa fecha.</p>
              </div>
            )}

            {itemsDraft?.id === r.workerId &&
              (() => {
                const unpaid = r.items.filter((i) => !i.paidAt)
                const chosen = unpaid.filter((i) => itemsDraft.selected.has(itemKey(i)))
                const sum = chosen.reduce((total, i) => total + i.amount, 0)
                const toggle = (key: string) => {
                  const next = new Set(itemsDraft.selected)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  setItemsDraft({ ...itemsDraft, selected: next })
                }
                return (
                  <div className="space-y-3 border-b border-gray-100 bg-primary-50/40 px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">Qué entra en este pago</p>
                      <span className="flex gap-3 text-xs font-semibold text-primary-600">
                        <button type="button" onClick={() => setItemsDraft({ ...itemsDraft, selected: new Set(unpaid.map(itemKey)) })} className="hover:underline">
                          Marcar todo
                        </button>
                        <button type="button" onClick={() => setItemsDraft({ ...itemsDraft, selected: new Set() })} className="hover:underline">
                          Desmarcar todo
                        </button>
                      </span>
                    </div>
                    {unpaid.length === 0 ? (
                      <p className="text-sm text-gray-500">No queda nada por pagar en este período.</p>
                    ) : (
                      <div className="max-h-96 space-y-2 overflow-auto">
                        {PAY_GROUP_ORDER.filter((group) => unpaid.some((i) => i.group === group)).map((group) => {
                          const own = unpaid.filter((i) => i.group === group)
                          const keys = own.map(itemKey)
                          const all = keys.every((k) => itemsDraft.selected.has(k))
                          const groupSum = own.filter((i) => itemsDraft.selected.has(itemKey(i))).reduce((t, i) => t + i.amount, 0)
                          return (
                      <ul key={group} className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                        <li className="flex items-center gap-3 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">
                          <input
                            type="checkbox"
                            aria-label={`Marcar todo ${PAY_GROUP_LABEL[group]}`}
                            checked={all}
                            onChange={() => {
                              const next = new Set(itemsDraft.selected)
                              for (const k of keys) {
                                if (all) next.delete(k)
                                else next.add(k)
                              }
                              setItemsDraft({ ...itemsDraft, selected: next })
                            }}
                          />
                          <span className="flex-1 uppercase tracking-wide">{PAY_GROUP_LABEL[group]}</span>
                          <span className="tabular-nums">{clp(groupSum)}</span>
                        </li>
                        {own.map((i) => (
                          <li key={itemKey(i)}>
                            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                              <input type="checkbox" checked={itemsDraft.selected.has(itemKey(i))} onChange={() => toggle(itemKey(i))} />
                              <span className="w-20 shrink-0 text-xs text-gray-500">{i.kind === 'base' ? 'Mes' : day(i.date)}</span>
                              <span className="min-w-0 flex-1 text-gray-900">
                                {i.label}
                                <span className="block text-xs text-gray-500">{[PAY_ITEM_LABEL[i.kind], i.detail].filter(Boolean).join(' · ')}</span>
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums text-gray-900">{clp(i.amount)}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                          )
                        })}
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Forma</label>
                        <select value={itemsDraft.method} onChange={(e) => setItemsDraft({ ...itemsDraft, method: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                          <option value="transferencia">Transferencia</option>
                          <option value="efectivo">Efectivo</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-xs font-medium text-gray-600">Nota (opcional)</label>
                        <input value={itemsDraft.note} maxLength={300} onChange={(e) => setItemsDraft({ ...itemsDraft, note: e.target.value })} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                      </div>
                      {r.honorariosRate !== null && sum > 0 && (
                        <p className="basis-full text-xs text-gray-600">
                          Se le transfiere el líquido: <span className="font-semibold">{clp(sum)}</span>. Boleta de honorarios por{' '}
                          {clp(chosen.filter((i) => i.kind !== 'gasto').reduce((t, i) => t + i.amount, 0) + honorariosRetention(chosen, r.honorariosRate))}: la retención de {clp(honorariosRetention(chosen, r.honorariosRate))} (
                          {pct(r.honorariosRate)}) la paga la empresa al SII.
                        </p>
                      )}
                      <Button
                        size="sm"
                        disabled={busy || chosen.length === 0 || sum <= 0}
                        onClick={() =>
                          send(
                            '/api/admin/worker-pay',
                            'POST',
                            { workerId: r.workerId, from: data.from, to: data.to, items: chosen.map((i) => ({ kind: i.kind, ref: i.ref })), method: itemsDraft.method, note: itemsDraft.note },
                            'Pago registrado'
                          )
                        }
                      >
                        Registrar pago de {clp(sum)}
                      </Button>
                      <button type="button" onClick={() => setItemsDraft(null)} className="pb-1.5 text-sm text-gray-500">
                        Cancelar
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      Se guarda qué cubrió este pago y con qué monto. Lo que dejes sin marcar queda pendiente para el siguiente. El panel solo lo registra: la
                      transferencia la haces tú.
                    </p>
                  </div>
                )
              })()}

            {payDraft?.id === r.workerId && (
              <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 bg-primary-50/40 px-5 py-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Monto pagado</label>
                  <input
                    autoFocus
                    inputMode="numeric"
                    value={payDraft.amount}
                    onChange={(e) => setPayDraft({ ...payDraft, amount: digits(e.target.value) })}
                    className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Forma</label>
                  <select value={payDraft.method} onChange={(e) => setPayDraft({ ...payDraft, method: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="transferencia">Transferencia</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div className="min-w-0 flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Nota (opcional)</label>
                  <input value={payDraft.note} maxLength={300} onChange={(e) => setPayDraft({ ...payDraft, note: e.target.value })} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                </div>
                <Button
                  size="sm"
                  disabled={busy || !(Number(payDraft.amount) > 0)}
                  onClick={() =>
                    send(
                      '/api/admin/worker-pay',
                      'POST',
                      { workerId: r.workerId, from: data.from, to: data.to, jobs: r.jobs.length, amount: Number(payDraft.amount), method: payDraft.method, note: payDraft.note },
                      'Pago registrado'
                    )
                  }
                >
                  Guardar pago
                </Button>
                <button type="button" onClick={() => setPayDraft(null)} className="pb-1.5 text-sm text-gray-500">
                  Cancelar
                </button>
                <p className="basis-full text-xs text-gray-500">Queda como pago del período {day(data.from)} al {day(data.to)}. El panel solo lo registra: la transferencia la haces tú.</p>
              </div>
            )}

            {/* Trabajos del período, cada uno con cómo se le paga */}
            <div className="px-5 py-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Trabajos del período</p>
              {r.jobs.length === 0 ? (
                <p className="text-sm text-gray-500">Ninguno. Los trabajos cuentan cuando la persona está en la cuadrilla o el camión es el suyo.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                        <th className="py-1.5 pr-3 font-medium">Fecha</th>
                        <th className="py-1.5 pr-3 font-medium">Trabajo</th>
                        <th className="py-1.5 pr-3 font-medium">m³ · km</th>
                        <th className="py-1.5 pr-3 font-medium">Fuera de Santiago</th>
                        <th className="py-1.5 pr-3 font-medium">Cómo se paga</th>
                        <th className="py-1.5 text-right font-medium">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {r.jobs.map((j) => {
                        const key = `${r.workerId}|${j.id}`
                        const locked = Boolean(j.paidAt) || !data.jobPayAvailable || busy
                        const draft = jobDraft?.key === key ? jobDraft : null
                        const shownMode: JobPayMode = draft ? draft.mode : j.payMode
                        return (
                          <tr key={j.id} className={`align-top ${j.paidAt ? 'bg-green-50' : ''}`}>
                            <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{day(j.date)}</td>
                            <td className="py-2 pr-3 text-gray-900">
                              {j.code || 'Reserva'} · {j.clientName}
                              <span className="block text-xs text-gray-500">{j.via === 'camion' ? 'por su camión' : 'en la cuadrilla'}</span>
                            </td>
                            <td className="py-2 pr-3 whitespace-nowrap text-gray-700">
                              {num(j.volumeM3, 'm³')} · {num(j.distanceKm, 'km')}
                            </td>
                            <td className="py-2 pr-3">
                              {j.outsideSantiago === null ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : (
                                <input
                                  type="checkbox"
                                  aria-label="Fuera de Santiago"
                                  checked={j.outsideSantiago}
                                  disabled={locked}
                                  onChange={(e) => saveJob(r, j, { outsideSantiago: e.target.checked }, e.target.checked ? 'Marcado fuera de Santiago: suman los km' : 'Marcado en Santiago')}
                                />
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={shownMode}
                                  disabled={locked}
                                  onChange={(e) => {
                                    const mode = e.target.value as JobPayMode
                                    if (mode === 'regla') {
                                      setJobDraft(null)
                                      if (j.payMode !== 'regla') saveJob(r, j, { mode: 'regla' }, 'Vuelve a pagarse según su regla')
                                    } else {
                                      setJobDraft({ key, mode, value: mode === 'fijo' ? String(j.fixedAmount ?? j.amount ?? '') : String(j.pallets ?? '') })
                                    }
                                  }}
                                  className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100"
                                >
                                  <option value="regla">Según su regla</option>
                                  <option value="fijo">Monto a mano</option>
                                  <option value="pallets">Por pallets</option>
                                </select>
                                {draft && (
                                  <>
                                    <input
                                      autoFocus
                                      inputMode="numeric"
                                      placeholder={draft.mode === 'fijo' ? 'Pesos' : 'Pallets'}
                                      value={draft.value}
                                      onChange={(e) => setJobDraft({ ...draft, value: digits(e.target.value) })}
                                      className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                                    />
                                    <Button
                                      size="sm"
                                      disabled={busy || draft.value === ''}
                                      onClick={() =>
                                        saveJob(
                                          r,
                                          j,
                                          draft.mode === 'fijo' ? { mode: 'fijo', amount: Number(draft.value) } : { mode: 'pallets', pallets: Number(draft.value) },
                                          draft.mode === 'fijo' ? 'Monto del trabajo guardado' : 'Pallets guardados'
                                        )
                                      }
                                    >
                                      Guardar
                                    </Button>
                                    <button type="button" onClick={() => setJobDraft(null)} className="text-xs text-gray-500">
                                      Cancelar
                                    </button>
                                  </>
                                )}
                                {!draft && j.payMode === 'pallets' && !j.paidAt && (
                                  <button
                                    type="button"
                                    disabled={locked}
                                    onClick={() => setJobDraft({ key, mode: 'pallets', value: String(j.pallets ?? '') })}
                                    className="text-xs text-primary-600 hover:underline"
                                  >
                                    cambiar pallets
                                  </button>
                                )}
                              </div>
                              <span className="mt-0.5 block text-xs text-gray-500">{j.basis}</span>
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              <span className="font-semibold tabular-nums text-gray-900">{j.amount !== null ? clp(j.amount) : '—'}</span>
                              {j.paidAt && <span className="mt-0.5 block text-xs text-green-700">pagado {day(j.paidAt)}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200">
                        <td colSpan={5} className="py-2 pr-3 text-right text-xs font-semibold text-gray-600">
                          Total por trabajos
                        </td>
                        <td className="py-2 text-right font-bold tabular-nums text-gray-900">{r.jobsDue !== null ? clp(r.jobsDue) : '—'}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {(others.length > 0 || r.expenses.some((e) => !e.owed)) && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Además</p>
                  <ul className="space-y-1 text-sm text-gray-700">
                    {others.map((i) => {
                      const bonus = i.kind === 'ajuste' ? r.bonuses.find((b) => b.id === i.ref) : null
                      return (
                        <li key={itemKey(i)} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="w-20 shrink-0 text-xs text-gray-500">{i.kind === 'base' ? monthName(i.ref) : day(i.date)}</span>
                          <span className="min-w-0 flex-1">
                            {i.label}
                            <span className="text-xs text-gray-500"> {[PAY_ITEM_LABEL[i.kind], i.detail, bonus?.createdBy].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="font-semibold tabular-nums">{clp(i.amount)}</span>
                          {i.paidAt ? (
                            <span className="text-xs text-green-700">pagado {day(i.paidAt)}</span>
                          ) : (
                            bonus && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  if (window.confirm(`¿Quitar ${i.label.toLowerCase()} de ${clp(i.amount)}?`)) send(`/api/admin/worker-pay/bonus?id=${bonus.id}`, 'DELETE', null, 'Ajuste quitado')
                                }}
                                className="text-xs text-red-600 hover:underline"
                              >
                                quitar
                              </button>
                            )
                          )}
                        </li>
                      )
                    })}
                    {r.expenses
                      .filter((e) => !e.owed)
                      .map((e) => (
                        <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-gray-500">
                          <span className="w-20 shrink-0 text-xs">{day(e.date)}</span>
                          <span className="min-w-0 flex-1">
                            {e.name} <span className="text-xs">· Gasto · {e.payment === 'credito' ? 'crédito, lo pagó la empresa' : 'ya reembolsado'}</span>
                          </span>
                          <span className="text-xs tabular-nums">{clp(e.amount)} (no suma)</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {r.payments.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowPayments(showPayments === r.workerId ? null : r.workerId)}
                    className="text-xs font-bold uppercase tracking-wide text-primary-600 hover:underline"
                    aria-expanded={showPayments === r.workerId}
                  >
                    Pagos registrados ({r.payments.length}) · {showPayments === r.workerId ? 'ocultar' : 'ver'}
                  </button>
                  {showPayments === r.workerId && (
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {r.payments.map((p) => (
                        <li key={p.id}>
                          {clp(p.amount)} · {day(p.paidAt)} · {p.method || 'sin forma'}
                          <span className="text-xs text-gray-500"> {[`${p.jobs} trabajos`, p.createdBy, p.note].filter(Boolean).join(' · ')}</span>
                          {p.items.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5 pl-3 text-xs text-gray-500">
                              {p.items.map((i, n) => (
                                <li key={n}>
                                  {PAY_ITEM_LABEL[i.kind]}: {i.label} · {clp(i.amount)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Card>
        )
      })}

      {data.rows.length > 0 && rows.length === 0 && (
        <Card className="p-5">
          <p className="text-sm text-gray-500">Nadie con saldo por pagar en este período.</p>
        </Card>
      )}
    </div>
  )
}
