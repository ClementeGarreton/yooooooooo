'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import type { Recommender } from '@/lib/recommenders'
import { buildWhatsAppLink } from '@/lib/whatsapp'

/**
 * Recomendadores (conserjes y otros): se agregan sin que tengan un trabajo, reciben su
 * código y su link para compartir, y acá se sigue cuántas veces se usó, cuántas se pagaron,
 * cuánto ganaron y cuánto se les pagó (Tomás, 23-10-2026).
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const EMPTY = { name: '', email: '', phone: '', place: '' }

export default function RecommendersPanel() {
  const [data, setData] = useState<{ available: boolean; programLive: boolean; recommenders: Recommender[] } | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/coupons/recomendadores')
    const body = await res.json().catch(() => null)
    if (res.ok && body) setData(body)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/coupons/recomendadores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo agregar')
      toast.success(`Listo: su código es ${body.code}`)
      setForm({ ...EMPTY })
      setOpen(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo agregar')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
  const message = (r: Recommender) =>
    `Hola ${r.name.split(' ')[0]}, este es tu código de Yo Me Encargo: ${r.code}. Compártelo con este link: ${r.link}\n` +
    'Quien lo use tiene un descuento, y cuando pague su servicio tú ganas tus créditos. Los ves y los cobras en yomeencargo.cl/mi-cuenta, entrando con este correo.'

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Recomendadores (conserjes)</h3>
          <p className="text-sm text-gray-600">
            Personas que recomiendan sin haber contratado. Tienen su código y su link; ven sus usos y piden sus pagos en «Mi cuenta».
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cerrar' : 'Agregar recomendador'}
        </Button>
      </div>

      {!data.programLive && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          El programa de referidos está apagado o sin montos: los códigos se crean, pero no dan descuento ni créditos hasta encenderlo arriba, en «Programa de referidos».
        </p>
      )}
      <p className="mt-2 text-xs text-gray-500">
        Lo que gana cada recomendador por referido pagado se configura en Configuración → Precios → «Créditos de recomendadores».
      </p>

      {open && (
        <div className="mt-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">
            Nombre
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Correo (con él entra a «Mi cuenta»)
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Teléfono
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Dónde (edificio, condominio)
            <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="Ej: Edificio Los Robles, Providencia" className={input} />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <Button size="sm" disabled={busy} onClick={create}>
              {busy ? 'Guardando…' : 'Crear con su código'}
            </Button>
          </div>
        </div>
      )}

      {data.recommenders.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Todavía no hay recomendadores.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Recomendador</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2 text-right">Usos</th>
                <th className="px-3 py-2 text-right">Pagados</th>
                <th className="px-3 py-2 text-right">Ganado</th>
                <th className="px-3 py-2 text-right">Pagado</th>
                <th className="px-3 py-2 text-right">Por pagar</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recommenders.map((r) => {
                const wa = buildWhatsAppLink(r.phone, message(r))
                return (
                  <tr key={r.customerId} className="align-top">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-gray-900">{r.name}</p>
                      <p className="text-xs text-gray-500">{[r.place, r.email, r.phone].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold">{r.code}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.uses}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.paidUses}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{clp(r.earned)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{clp(r.paidOut)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {clp(r.balance + r.requested)}
                      {r.requested > 0 && <span className="block text-xs font-semibold text-amber-700">pidió {clp(r.requested)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <button type="button" onClick={() => navigator.clipboard.writeText(r.link).then(() => toast.success('Link copiado'))} className="font-semibold text-primary-600 hover:underline">
                        Copiar link
                      </button>
                      {wa && (
                        <>
                          {' · '}
                          <a href={wa} target="_blank" rel="noopener noreferrer" className="font-semibold text-green-700 hover:underline">
                            Enviar por WhatsApp
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">
            «Por pagar» = créditos que todavía no se le transfieren (incluye lo que ya pidió). Los retiros se marcan como pagados en «Retiros de créditos».
          </p>
        </div>
      )}
    </Card>
  )
}
