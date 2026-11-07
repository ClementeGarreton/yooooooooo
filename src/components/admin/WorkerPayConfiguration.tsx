'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { BANK_ACCOUNT_TYPES, payForJob, type BankAccountType, type PayConfig, type PayMode } from '@/lib/workerPayTypes'

/**
 * Configuración → Pago a trabajadores: la regla general con que se calcula lo que gana cada
 * persona por un trabajo realizado. Monto fijo por trabajo, porcentaje del valor del
 * servicio, o una tarifa por m³ y por kilómetro. Un trabajador puede tener una regla propia, que se pone en Finanzas → Pago a
 * trabajadores y manda sobre esta. Aquí también van los pesos por pallet (para los trabajos que se pagan por pallets) y la
 * cuenta de la empresa desde la que sale la nómina del banco.
 */
export default function WorkerPayConfiguration() {
  const [config, setConfig] = useState<PayConfig | null>(null)
  const [mode, setMode] = useState<PayMode>('fijo')
  const [value, setValue] = useState('')
  const [perM3, setPerM3] = useState('')
  const [perKm, setPerKm] = useState('')
  const [perPallet, setPerPallet] = useState('')
  const [maxPallets, setMaxPallets] = useState('')
  const [minJob, setMinJob] = useState('')
  const [minM3, setMinM3] = useState('')
  const [retention, setRetention] = useState('')
  const [originType, setOriginType] = useState<BankAccountType | ''>('')
  const [originNumber, setOriginNumber] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/admin/worker-pay/config')
      .then((res) => res.json())
      .then((c: PayConfig) => {
        setConfig(c)
        setMode(c.mode)
        setValue(c.value !== null ? String(c.value) : '')
        setPerM3(c.perM3 !== null ? String(c.perM3) : '')
        setPerKm(c.perKm !== null ? String(c.perKm) : '')
        setPerPallet(c.perPallet !== null ? String(c.perPallet) : '')
        setMaxPallets(c.maxPalletsPerAddress !== null ? String(c.maxPalletsPerAddress) : '')
        setMinJob(c.minJob !== null ? String(c.minJob) : '')
        setMinM3(c.minM3 !== null && c.minM3 !== undefined ? String(c.minM3).replace('.', ',') : '')
        setRetention(String(c.honorariosRate).replace('.', ','))
        setOriginType(c.originAccountType || '')
        setOriginNumber(c.originAccountNumber || '')
      })
      .catch(() => toast.error('No se pudo cargar la regla de pago'))
  }, [])

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/worker-pay/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          value: value === '' ? null : value,
          perM3,
          perKm,
          ...(config?.jobPayAvailable
            ? {
                perPallet: perPallet === '' ? null : perPallet,
                maxPalletsPerAddress: maxPallets === '' ? null : maxPallets,
                originAccountType: originType || null,
                originAccountNumber: originNumber || null,
              }
            : {}),
          ...(config?.honorariosConfigAvailable && retention !== '' ? { honorariosRate: retention } : {}),
          ...(config?.minJobAvailable && mode === 'm3km' ? { minJob: minJob === '' ? null : minJob } : {}),
          ...(config?.minM3Available && mode === 'm3km' ? { minM3: minM3 === '' ? null : minM3 } : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      setConfig(body.config)
      toast.success('Regla de pago guardada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!config) return <p className="text-sm text-gray-500">Cargando…</p>
  const numeric = Number(String(value).replace(',', '.'))
  const toNumber = (v: string) => Number(v.replace(',', '.')) || 0
  const example =
    mode === 'm3km'
      ? perM3 !== '' || perKm !== ''
        ? payForJob({ mode, value: 0, perM3: toNumber(perM3), perKm: toNumber(perKm) }, 0, 20, 15)
        : null
      : value !== '' && Number.isFinite(numeric)
        ? payForJob({ mode, value: numeric }, 200000)
        : null

  return (
    <Card className="p-6">
      <h3 className="text-lg font-bold text-gray-900">Pago a trabajadores</h3>
      <p className="text-sm text-gray-600">
        Cuánto gana cada persona por un trabajo realizado. Es la regla general: en Finanzas → Pago a trabajadores se le puede
        poner una regla propia a quien tenga un trato distinto.
      </p>
      {!config.available && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_worker_pay_config.sql</code> para poder guardar esta regla.
        </p>
      )}
      {config.available && !config.m3kmAvailable && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Para pagar por m³ y kilómetro falta correr la migración <code>database/migrations/add_worker_pay_m3km.sql</code>.
        </p>
      )}
      <div className="mt-4 grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Se paga</label>
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as PayMode)
              setValue('')
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="fijo">Un monto fijo por trabajo</option>
            <option value="porcentaje">Un porcentaje del valor del servicio</option>
            <option value="m3km" disabled={!config.m3kmAvailable}>
              Por m³ y por kilómetro
            </option>
          </select>
        </div>
        {mode === 'm3km' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Pesos por m³</label>
              <input
                inputMode="decimal"
                value={perM3}
                onChange={(e) => setPerM3(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="Ej. 3000"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Pesos por km</label>
              <input
                inputMode="decimal"
                value={perKm}
                onChange={(e) => setPerKm(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="Ej. 400"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {config.minJobAvailable && (
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Mínimo por trabajo, para todos</label>
                <input
                  inputMode="numeric"
                  value={minJob}
                  onChange={(e) => setMinJob(e.target.value.replace(/\D/g, ''))}
                  placeholder="Sin mínimo"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Si los m³ de un trabajo dan menos que esto (o el trabajo no tiene m³), se paga el mínimo. Un trabajador con mínimo propio usa el suyo.
                </p>
              </div>
            )}
            {config.minM3Available && (
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Mínimo de m³ por trabajo</label>
                <input
                  inputMode="decimal"
                  value={minM3}
                  onChange={(e) => setMinM3(e.target.value.replace(/[^\d,]/g, ''))}
                  placeholder="Sin mínimo"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Un trabajo con menos m³ (o sin m³) se paga como si tuviera este mínimo. Por ejemplo, con 1 m³, un trabajo de 0,5 m³ se paga como 1 m³.
                </p>
              </div>
            )}
          </div>
        ) : (
        <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{mode === 'fijo' ? 'Pesos por trabajo' : 'Porcentaje (%)'}</label>
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(mode === 'fijo' ? e.target.value.replace(/\D/g, '') : e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder={mode === 'fijo' ? 'Ej. 25000' : 'Ej. 8'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {mode === 'm3km'
          ? example !== null
            ? `Ejemplo: un trabajo de 20 m³ y 15 km le paga $${example.toLocaleString('es-CL')} a cada persona que fue. `
            : 'Sin tarifas, a quien no tenga regla propia no se le calcula pago. '
          : example !== null
            ? `Ejemplo: por un servicio de $200.000, cada persona que fue gana $${example.toLocaleString('es-CL')}. `
            : 'Sin valor, a quien no tenga regla propia no se le calcula pago. '}
        {mode === 'porcentaje' && 'El porcentaje es sobre el valor del servicio con IVA y no se reparte: si van dos personas, cada una gana ese porcentaje. '}
        {mode === 'm3km' &&
          `Los m³ y km son los de cada reserva (los puestos a mano o, si no, los de la cotización).${config.jobPayAvailable ? ' Los km solo suman en los trabajos marcados «fuera de Santiago», y cada persona puede tener un mínimo por trabajo.' : ''} Además se suman los gastos aprobados que rindió la persona y las bonificaciones que se le carguen en Finanzas.`}
      </p>
      {config.jobPayAvailable ? (
        <div className="mt-5 grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Pesos por pallet</label>
            <input
              inputMode="numeric"
              value={perPallet}
              onChange={(e) => setPerPallet(e.target.value.replace(/\D/g, ''))}
              placeholder="Sin definir"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Máx. pallets pagados por dirección</label>
            <input
              inputMode="numeric"
              value={maxPallets}
              onChange={(e) => setMaxPallets(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Sin tope"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Cuenta de origen (nómina)</label>
            <select value={originType} onChange={(e) => setOriginType(e.target.value as BankAccountType | '')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Sin definir</option>
              {BANK_ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} ({t.value})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Número de la cuenta de origen</label>
            <input
              inputMode="numeric"
              value={originNumber}
              onChange={(e) => setOriginNumber(e.target.value.replace(/\D/g, '').slice(0, 20))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <p className="text-xs text-gray-500 sm:col-span-2">
            Los pesos por pallet (líquidos) se pagan en los trabajos «por pallets»: los de empresas que se cierran por pallets (Monfiza) lo son solos, y
            cualquier otro se puede marcar en Finanzas → Pago a trabajadores. Por cada dirección de entrega se pagan como máximo los pallets del tope. La
            cuenta de origen es la de la empresa desde la que sale la nómina del banco.
          </p>
        </div>
      ) : (
        config.available && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Para pagar por pallets y descargar la nómina del banco falta correr la migración <code>database/migrations/add_nomina_y_pago_por_trabajo.sql</code>.
          </p>
        )
      )}
      {config.honorariosConfigAvailable && (
        <div className="mt-5 max-w-xl">
          <label className="mb-1 block text-sm font-medium text-gray-700">Retención de la boleta de honorarios (%)</label>
          <input
            inputMode="decimal"
            value={retention}
            onChange={(e) => setRetention(e.target.value.replace(/[^\d,.]/g, ''))}
            className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            A quien emite boleta se le paga el líquido pactado; la boleta va por el bruto (líquido ÷ (1 − tasa)) y la diferencia la paga la empresa al SII.
            2026: 15,25 %. Sube a 16 % en 2027 y a 17 % en 2028: hay que cambiarla aquí cada año.
          </p>
        </div>
      )}
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={busy}>
          Guardar regla
        </Button>
      </div>
    </Card>
  )
}
