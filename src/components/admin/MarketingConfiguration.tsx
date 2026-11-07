'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { couponValueLabel, type AdminCoupon, type CouponKind, type MarketingConfig } from '@/lib/couponTypes'

/**
 * Configuración → Marketing: el programa de referidos y los cupones.
 *
 * Los cupones se usan solo en el panel del cliente, al reservar una cotización. Un uso
 * cuenta cuando esa reserva se pagó. Crear, activar y configurar es del perfil
 * Administrador; la secretaría puede mirar.
 */

const KIND_OPTIONS = [
  { value: '', label: 'Sin definir' },
  { value: 'porcentaje', label: 'Porcentaje (%)' },
  { value: 'monto', label: 'Monto fijo ($)' },
]

const ORIGIN_LABEL = { manual: 'Campaña', referido: 'Código de referido', premio: 'Premio por referir' } as const

const EMPTY_COUPON = { code: '', kind: 'porcentaje', value: '', minAmount: '', maxDiscount: '', maxUses: '', validFrom: '', validUntil: '', description: '' }

const fmtDate = (d: string | null) => {
  if (!d) return ''
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'No se pudo completar la acción')
  return data
}

export default function MarketingConfiguration() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'manual' | 'referido' | 'premio'>('manual')

  const [enabled, setEnabled] = useState(false)
  const [referredKind, setReferredKind] = useState('')
  const [referredValue, setReferredValue] = useState('')
  const [rewardKind, setRewardKind] = useState('')
  const [rewardValue, setRewardValue] = useState('')
  const [rewardDays, setRewardDays] = useState('180')
  // Reglas copiadas de AppleFix (add_referral_rules.sql).
  const [referredCap, setReferredCap] = useState('')
  const [onlyNew, setOnlyNew] = useState(true)
  const [pesosPerToken, setPesosPerToken] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_COUPON })
  // Cupón de campaña que se está editando (solo sus condiciones). null = se crea uno nuevo.
  const [editingId, setEditingId] = useState<string | null>(null)
  const openEdit = (c: AdminCoupon) => {
    setEditingId(c.id)
    setForm({
      code: c.code,
      kind: c.kind || 'porcentaje',
      value: c.value ? String(c.value) : '',
      minAmount: c.minAmount ? String(c.minAmount) : '',
      maxDiscount: c.maxDiscount ? String(c.maxDiscount) : '',
      maxUses: c.maxUses ? String(c.maxUses) : '',
      validFrom: c.validFrom || '',
      validUntil: c.validUntil || '',
      description: c.description || '',
    })
    setShowCreate(true)
  }

  const load = useCallback(async () => {
    try {
      const [couponData, configData] = await Promise.all([
        api('/api/admin/coupons', 'GET'),
        api('/api/admin/marketing-config', 'GET'),
      ])
      setCoupons(couponData.coupons || [])
      setAvailable(couponData.available !== false && configData.available !== false)
      const c: MarketingConfig = configData.config
      setEnabled(c.referralEnabled)
      setReferredKind(c.referredKind || '')
      setReferredValue(c.referredValue ? String(c.referredValue) : '')
      setRewardKind(c.rewardKind || '')
      setRewardValue(c.rewardValue ? String(c.rewardValue) : '')
      setRewardDays(String(c.rewardValidDays))
      setReferredCap(c.referredCap ? String(c.referredCap) : '')
      setOnlyNew(c.onlyNew !== false)
      setPesosPerToken(c.pesosPerToken ? String(c.pesosPerToken) : '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar marketing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async (action: () => Promise<unknown>, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo completar la acción')
    } finally {
      setBusy(false)
    }
  }

  const saveConfig = () =>
    run(
      () =>
        api('/api/admin/marketing-config', 'PUT', {
          referralEnabled: enabled,
          referredKind: referredKind || null,
          referredValue: referredValue ? Number(referredValue) : null,
          rewardKind: rewardKind || null,
          rewardValue: rewardValue ? Number(rewardValue) : null,
          rewardValidDays: Number(rewardDays) || 180,
          referredCap: referredCap ? Number(referredCap) : null,
          onlyNew,
          pesosPerToken: pesosPerToken ? Number(pesosPerToken) : null,
        }),
      'Programa de referidos guardado'
    )

  const createCoupon = () =>
    run(async () => {
      const terms = {
        minAmount: form.minAmount ? Number(form.minAmount) : 0,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        validFrom: form.validFrom,
        validUntil: form.validUntil,
        description: form.description,
      }
      if (editingId) await api(`/api/admin/coupons/${editingId}`, 'PATCH', terms)
      else await api('/api/admin/coupons', 'POST', { ...form, ...terms, value: Number(form.value) })
      setShowCreate(false)
      setEditingId(null)
      setForm({ ...EMPTY_COUPON })
    }, editingId ? 'Cupón actualizado' : 'Cupón creado')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  if (!available) {
    return (
      <Card className="p-6">
        <p className="text-sm text-gray-600">
          Falta correr la migración <code>database/migrations/add_coupons.sql</code> para habilitar cupones y referidos.
        </p>
      </Card>
    )
  }

  const shown = coupons.filter((c) => c.origin === filter)
  const benefit = (
    label: string,
    kind: string,
    setKind: (v: string) => void,
    value: string,
    setValue: (v: string) => void
  ) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTIONS} />
        <Input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          placeholder={kind === 'porcentaje' ? 'Ej. 10' : kind === 'monto' ? 'Pesos' : ''}
        />
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="text-lg font-bold text-gray-900">Programa de referidos</h3>
        <p className="text-sm text-gray-600">
          Igual que en AppleFix: cada cliente ya atendido tiene un código propio para recomendar. Quien llega con ese
          código tiene descuento; cuando paga su servicio, quien lo recomendó gana créditos según lo que pagó el referido.
          Cada crédito vale $1 y se retira en plata. El código se usa en el panel del cliente o lo aplica quien atiende, en
          el detalle de la reserva.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {benefit('Descuento para quien llega referido', referredKind, setReferredKind, referredValue, setReferredValue)}
          {benefit('Premio para quien refirió', rewardKind, setRewardKind, rewardValue, setRewardValue)}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Días de vigencia del premio</label>
            <Input type="text" inputMode="numeric" value={rewardDays} onChange={(e) => setRewardDays(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Pesos pagados que dan 1 crédito</label>
            <Input
              type="text"
              inputMode="numeric"
              value={pesosPerToken}
              onChange={(e) => setPesosPerToken(e.target.value.replace(/\D/g, ''))}
              placeholder="Ej. 20"
            />
            <p className="mt-1 text-xs text-gray-500">
              {Number(pesosPerToken) > 0
                ? `Quien refiere gana el ${(100 / Number(pesosPerToken)).toLocaleString('es-CL', { maximumFractionDigits: 2 })} % de lo que pague su referido: por un servicio de $200.000, ${Math.floor(200000 / Number(pesosPerToken)).toLocaleString('es-CL')} créditos ($${Math.floor(200000 / Number(pesosPerToken)).toLocaleString('es-CL')}).`
                : 'Vacío = se usa el «Premio para quien refirió» de arriba.'}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Tope del descuento del referido ($)</label>
            <Input
              type="text"
              inputMode="numeric"
              value={referredCap}
              onChange={(e) => setReferredCap(e.target.value.replace(/\D/g, ''))}
              placeholder="Sin tope"
            />
          </div>
          <label className="flex items-start gap-2 pt-6 text-sm font-medium text-gray-700">
            <input type="checkbox" className="mt-1" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            <span>
              Solo clientes nuevos
              <span className="block text-xs font-normal text-gray-500">El código no sirve a quien ya tuvo un servicio.</span>
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Programa encendido (los clientes ven su código y los códigos se aceptan)
          </label>
          <Button size="sm" onClick={saveConfig} disabled={busy}>
            Guardar referidos
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Cupones</h3>
            <p className="text-sm text-gray-600">
              Se usan al reservar una cotización desde el panel del cliente. Un uso cuenta cuando la reserva se pagó.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null)
              setForm({ ...EMPTY_COUPON })
              setShowCreate(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Nuevo cupón
          </Button>
        </div>

        <div className="mt-4 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {(['manual', 'referido', 'premio'] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setFilter(o)}
              className={`rounded-md px-3 py-1.5 font-medium ${filter === o ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600'}`}
            >
              {ORIGIN_LABEL[o]} ({coupons.filter((c) => c.origin === o).length})
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No hay cupones de este tipo.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {shown.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className={`font-mono text-sm font-bold ${c.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{c.code}</p>
                  <p className="text-xs text-gray-500">
                    {[
                      c.origin === 'referido' ? 'Descuento según el programa' : `${couponValueLabel(c.kind, c.value)} de descuento`,
                      c.ownerLabel,
                      c.minAmount > 0 ? `servicios desde $${c.minAmount.toLocaleString('es-CL')}` : null,
                      c.maxDiscount ? `máximo $${c.maxDiscount.toLocaleString('es-CL')}` : null,
                      c.validFrom ? `desde ${fmtDate(c.validFrom)}` : null,
                      c.validUntil ? `hasta ${fmtDate(c.validUntil)}` : null,
                      c.description && c.origin === 'manual' ? c.description : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700">
                    {c.uses} uso{c.uses === 1 ? '' : 's'}
                    {c.maxUses ? ` de ${c.maxUses}` : ''}
                  </span>
                  {c.origin === 'manual' && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => openEdit(c)}>
                      Editar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api(`/api/admin/coupons/${c.id}`, 'PATCH', { active: !c.active }),
                        c.active ? 'Cupón desactivado' : 'Cupón activado'
                      )
                    }
                  >
                    {c.active ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={editingId ? `Editar ${form.code}` : 'Nuevo cupón'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Código (4 a 20 letras o números)</label>
              <Input
                value={form.code}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) })}
                placeholder="Ej. PRIMAVERA10"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Descuento</label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  disabled={Boolean(editingId)}
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as CouponKind })}
                  options={KIND_OPTIONS.slice(1)}
                />
                <Input
                  type="text"
                  inputMode="numeric"
                  disabled={Boolean(editingId)}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value.replace(/\D/g, '') })}
                  placeholder={form.kind === 'porcentaje' ? '% (1 a 100)' : 'Pesos'}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Usos máximos (vacío = sin tope)</label>
              <Input type="text" inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Monto mínimo del servicio (vacío = sin mínimo)</label>
              <Input type="text" inputMode="numeric" value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Descuento máximo en pesos (vacío = sin tope)</label>
              <Input
                type="text"
                inputMode="numeric"
                value={form.maxDiscount}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value.replace(/\D/g, '') })}
                placeholder="Ej. 100000"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Válido desde (opcional)</label>
              <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Válido hasta (opcional)</label>
              <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Nota interna (campaña, a quién se le dio)</label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Cada cliente lo puede usar una vez, en el cotizador web o al reservar desde «Mi cuenta». El código y el descuento no se
            pueden cambiar después (si hay un error, desactívalo y crea otro); el mínimo, el máximo, los usos y las fechas sí.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button onClick={createCoupon} disabled={busy || form.code.length < 4 || !form.value}>
              {busy ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear cupón'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
