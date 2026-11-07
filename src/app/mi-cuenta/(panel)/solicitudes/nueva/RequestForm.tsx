'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRIORITY_HOURS, SERVICE_TYPES, isPriorityRequest, type ServiceType } from '@/lib/serviceRequestTypes'

const inputClass =
  'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 focus:border-brand-blue-dark focus:outline-none'
const labelClass = 'text-xs font-bold uppercase tracking-wide text-slate-500'

/**
 * Formulario de «Nueva solicitud»: mudanza, transporte, carga o pallets desde la misma cuenta.
 * En «Pallets» solo se piden la cantidad y notas (ninguna obligatoria) y repaletizar. Si la
 * fecha y hora quedan a menos de 24 h, se avisa la tarifa prioritaria y hay que aceptarla.
 */
export default function RequestForm({
  today,
  companyName,
  repalletizePrice = 0,
  priorityLabel = null,
}: {
  today: string
  companyName: string | null
  /** Monto de repaletizar (Configuración → Precios). 0 = se cotiza aparte. */
  repalletizePrice?: number
  /** Recargo de urgencia pactado con la empresa, ya formateado. Sin él, se confirma al aprobar. */
  priorityLabel?: string | null
}) {
  const router = useRouter()
  const [serviceType, setServiceType] = useState<ServiceType>('mudanza')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [contact, setContact] = useState('')
  const [description, setDescription] = useState('')
  const [volumeM3, setVolumeM3] = useState('')
  const [peopleNeeded, setPeopleNeeded] = useState('')
  const [pallets, setPallets] = useState('')
  const [repalletize, setRepalletize] = useState(false)
  const [acceptPriority, setAcceptPriority] = useState(false)
  const [fixedTime, setFixedTime] = useState(false)
  const isPallets = serviceType === 'pallets'
  const isPriority = date !== '' && isPriorityRequest(date, time || null)
  const [forCompany, setForCompany] = useState(Boolean(companyName))
  const [sending, setSending] = useState(false)
  // En un servicio de empresa los m³ y el personal son obligatorios.
  const isCompany = Boolean(companyName) && forCompany && !isPallets
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/cuenta/solicitudes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType,
          origin,
          destination,
          date,
          time,
          contact,
          description,
          forCompany,
          ...(isPallets ? { pallets, repalletize } : { volumeM3, peopleNeeded }),
          acceptPriority: isPriority && acceptPriority,
          fixedTime: fixedTime && time !== '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No pudimos enviar la solicitud.')
      router.push('/mi-cuenta/solicitudes?enviada=1')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos enviar la solicitud.')
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
        <h2 className="text-lg font-bold text-slate-900">1. ¿Qué necesitas?</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICE_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setServiceType(t.value)}
              aria-pressed={serviceType === t.value}
              className={`rounded-xl border-2 p-4 text-left transition ${
                serviceType === t.value ? 'border-brand-green bg-brand-green/10' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="block font-bold text-slate-900">{t.label}</span>
              <span className="block text-sm text-slate-500">{t.hint}</span>
            </button>
          ))}
        </div>

        <h2 className="mt-8 text-lg font-bold text-slate-900">2. Detalle</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Origen</span>
            <input required value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={300} placeholder="Dirección y comuna" className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Destino</span>
            <input required value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={300} placeholder="Dirección y comuna" className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Fecha</span>
            <input required type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Hora (opcional)</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
            {time && (
              <span className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={fixedTime} onChange={(e) => setFixedTime(e.target.checked)} />
                Es horario fijo de retiro o entrega (no se puede llegar después)
              </span>
            )}
          </label>
          <label className="block sm:col-span-2">
            <span className={labelClass}>Contacto en origen (opcional)</span>
            <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} placeholder="Quién recibe al equipo y su teléfono" className={inputClass} />
          </label>
          {isPallets ? (
            <>
              <label className="block">
                <span className={labelClass}>Cantidad de pallets (opcional)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="10000"
                  step="1"
                  value={pallets}
                  onChange={(e) => setPallets(e.target.value)}
                  placeholder="Ej: 4"
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={repalletize} onChange={(e) => setRepalletize(e.target.checked)} />
                Repaletizar ({repalletizePrice > 0 ? `+$${Math.round(repalletizePrice).toLocaleString('es-CL')}` : 'se cotiza aparte'})
              </label>
              <label className="block sm:col-span-2">
                <span className={labelClass}>Notas adicionales (opcional)</span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  placeholder="Lo que ayude al equipo: tipo de pallet, horario de recepción, acceso"
                  className={inputClass}
                />
              </label>
            </>
          ) : (
            <>
          <label className="block">
            <span className={labelClass}>Volumen en m³{isCompany ? '' : ' (opcional)'}</span>
            <input
              required={isCompany}
              type="number"
              inputMode="decimal"
              min="0.1"
              max="500"
              step="0.1"
              value={volumeM3}
              onChange={(e) => setVolumeM3(e.target.value)}
              placeholder="Ej: 12"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Personas que necesitas{isCompany ? '' : ' (opcional)'}</span>
            <input
              required={isCompany}
              type="number"
              inputMode="numeric"
              min="1"
              max="20"
              step="1"
              value={peopleNeeded}
              onChange={(e) => setPeopleNeeded(e.target.value)}
              placeholder="Ej: 3"
              className={inputClass}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelClass}>{serviceType === 'mudanza' ? 'Qué hay que mudar' : 'Qué se transporta'}</span>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="Cantidad, tamaño, peso aproximado, pisos, ascensor: todo lo que ayude a cotizar"
              className={inputClass}
            />
          </label>
            </>
          )}
        </div>

        {isPriority && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold">Servicio con menos de {PRIORITY_HOURS} horas de anticipación: va con tarifa prioritaria.</p>
            <p className="mt-1">
              {priorityLabel
                ? `Se suma el recargo prioritario de ${priorityLabel}.`
                : 'Te confirmamos el monto del recargo al aprobar la solicitud.'}{' '}
              Revisa bien la fecha y la hora antes de enviar.
            </p>
            <label className="mt-3 flex items-start gap-2 font-semibold">
              <input type="checkbox" required checked={acceptPriority} onChange={(e) => setAcceptPriority(e.target.checked)} className="mt-0.5" />
              <span>
                Acepto la tarifa prioritaria y los{' '}
                <a href="/terminos-y-condiciones" target="_blank" rel="noopener noreferrer" className="underline">
                  términos y condiciones
                </a>
                .
              </span>
            </label>
          </div>
        )}

        {companyName && (
          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={forCompany} onChange={(e) => setForCompany(e.target.checked)} />
            Es para {companyName} (se factura a la empresa)
          </label>
        )}
      </section>

      <aside className="h-fit rounded-2xl bg-[#1B3A5C] p-6 text-white">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Cómo sigue</p>
        <ol className="mt-4 space-y-3 text-sm">
          {['Envías la solicitud.', 'El equipo la cotiza y la aprueba.', 'Se asigna el equipo que la ejecuta.', 'Sigues cada paso hasta el cierre.'].map(
            (step, i) => (
              <li key={step} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2A5A85] text-xs font-bold">
                  {i + 1}
                </span>
                {step}
              </li>
            )
          )}
        </ol>
        {error && <p className="mt-4 rounded-lg bg-red-500/20 px-3 py-2 text-sm font-semibold">{error}</p>}
        <button
          type="submit"
          disabled={sending}
          className="mt-6 w-full rounded-xl bg-brand-green px-4 py-3 font-bold text-slate-900 hover:opacity-90 disabled:opacity-60"
        >
          {sending ? 'Enviando…' : 'Enviar solicitud'}
        </button>
        <p className="mt-3 text-xs text-slate-300">Enviarla no agenda ni cobra nada: primero te confirmamos precio y fecha.</p>
      </aside>
    </form>
  )
}
