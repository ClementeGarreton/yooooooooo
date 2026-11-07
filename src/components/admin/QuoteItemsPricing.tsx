'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Package, Pencil, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import {
  PACKAGING_TYPES,
  groupItemsByPackaging,
  itemLineVolume,
  itemPackagingCost,
  packagingLabel,
  packagingSubtotal,
  type PackagedItem,
} from '@/lib/packagingCatalog'

interface QuoteItemsPricingProps {
  /** Ítems ya normalizados (volumen UNITARIO) con `normalizeAdminPdfItems`. */
  items: PackagedItem[]
  /**
   * Precio vigente de la cotización (ajustado si lo hay). Con esto se ofrece
   * trasladar la diferencia de embalaje al precio final; sin esto solo se
   * guardan los precios por ítem.
   */
  currentPrice?: number | null
  /**
   * Sin `onSave` el bloque queda de solo lectura: así se reutiliza en Reservas,
   * donde el detalle sirve para consultar y no para recotizar.
   */
  onSave?: (items: PackagedItem[], newPrice: number | null) => Promise<boolean>
}

const money = (value: number) => `$${Math.round(value).toLocaleString('es-CL')}`
const m3 = (value: number) => `${value.toFixed(2)} m³`

/** Tipos ofrecidos en el selector: el catálogo completo, "Sin embalaje" primero. */
const TYPE_OPTIONS = PACKAGING_TYPES

/**
 * Detalle de artículos de una cotización agrupado por tipo de embalaje, con
 * edición de los precios por ítem.
 *
 * Resuelve dos cosas que el panel no permitía:
 *  1. ver QUÉ artículos entran en cada tipo de embalaje (antes la lista era plana
 *     y ni siquiera mostraba el embalaje de cada ítem);
 *  2. corregir el precio de embalaje de un ítem de una cotización ya creada, que
 *     quedaba congelado al momento de cotizar.
 */
export default function QuoteItemsPricing({
  items,
  currentPrice,
  onSave,
}: QuoteItemsPricingProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PackagedItem[]>(items)
  const [applyDelta, setApplyDelta] = useState(false)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['none']))

  // Al cambiar de cotización (o tras guardar) el borrador vuelve a lo guardado.
  useEffect(() => {
    setDraft(items)
    setEditing(false)
    setApplyDelta(false)
  }, [items])

  const groups = useMemo(() => groupItemsByPackaging(items), [items])
  const savedSubtotal = useMemo(() => packagingSubtotal(items), [items])
  const draftSubtotal = useMemo(() => packagingSubtotal(draft), [draft])
  const delta = draftSubtotal - savedSubtotal

  const invalid = useMemo(
    () =>
      draft.some((item) => {
        const type = item.packaging?.type
        if (!type || type === 'none') return false
        const price = item.packaging?.pricePerUnit
        return price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0
      }),
    [draft]
  )

  const canApplyDelta = typeof currentPrice === 'number' && Number.isFinite(currentPrice)
  const newPrice = canApplyDelta ? Math.round((currentPrice as number) + delta) : null

  if (!items.length) return null

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setItemType = (index: number, type: string) => {
    setDraft((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row
        if (type === 'none') return { ...row, packaging: undefined }
        return { ...row, packaging: { type, pricePerUnit: row.packaging?.pricePerUnit } }
      })
    )
  }

  /**
   * Recibe el texto crudo del input: vaciar el campo tiene que dejarlo vacío (y
   * bloquear el guardado), no revertir al precio anterior por lo bajo.
   */
  const setItemPrice = (index: number, raw: string) => {
    setDraft((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row
        const type = row.packaging?.type
        if (!type || type === 'none') return row
        return {
          ...row,
          packaging: { type, pricePerUnit: raw === '' ? undefined : Number(raw) },
        }
      })
    )
  }

  const startEditing = () => {
    setDraft(items)
    setApplyDelta(false)
    setEditing(true)
  }

  const cancelEditing = () => {
    setDraft(items)
    setApplyDelta(false)
    setEditing(false)
  }

  const save = async () => {
    if (!onSave || invalid) return
    if (applyDelta && newPrice !== null && newPrice <= 0) return
    setSaving(true)
    try {
      const ok = await onSave(draft, applyDelta && newPrice !== null ? newPrice : null)
      if (ok) setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Package className="h-4 w-4 text-primary-600" />
          Artículos por tipo de embalaje
        </label>
        {onSave && !editing && (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Editar precios
          </Button>
        )}
      </div>

      {!editing && (
        <div className="space-y-2">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.id)
            return (
              <div key={group.id} className="overflow-hidden rounded-lg border border-gray-200">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full flex-col gap-0.5 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                    )}
                    <span className="truncate">{group.label}</span>
                    <span className="shrink-0 font-normal text-gray-500">
                      · {group.items.length} artículo{group.items.length !== 1 ? 's' : ''}
                    </span>
                  </span>
                  <span className="pl-5 text-xs text-gray-600 sm:whitespace-nowrap sm:pl-0">
                    {group.totalQuantity} bulto{group.totalQuantity !== 1 ? 's' : ''} ·{' '}
                    {m3(group.totalVolume)}
                    {group.totalCost > 0 ? ` · ${money(group.totalCost)}` : ''}
                  </span>
                </button>

                {!isCollapsed && (
                  <ul className="divide-y divide-gray-100">
                    {group.items.map((item, idx) => (
                      <li
                        key={`${group.id}-${item.name}-${idx}`}
                        className="flex items-start justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-gray-900">
                            {item.name} <span className="text-gray-500">x{item.quantity}</span>
                          </p>
                          <p className="text-xs text-gray-500">
                            {m3(itemLineVolume(item))}
                            {item.packaging?.pricePerUnit
                              ? ` · ${money(Number(item.packaging.pricePerUnit))}/m³`
                              : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="whitespace-nowrap rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                            {packagingLabel(item.packaging?.type)}
                          </span>
                          {itemPackagingCost(item) > 0 && (
                            <p className="mt-0.5 text-xs font-semibold text-gray-900">
                              {money(itemPackagingCost(item))}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}

          {savedSubtotal > 0 && (
            <div className="flex justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="text-gray-600">Total embalaje cotizado</span>
              <span className="font-bold text-gray-900">{money(savedSubtotal)}</span>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
          <p className="text-xs text-gray-600">
            Solo se edita el embalaje de cada artículo. El nombre, la cantidad y el volumen
            de la cotización quedan intactos.
          </p>

          <div className="max-h-72 space-y-2 overflow-y-auto">
            {draft.map((item, index) => {
              const type = item.packaging?.type || 'none'
              const price = item.packaging?.pricePerUnit
              const priceInvalid =
                type !== 'none' &&
                (price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0)
              return (
                <div key={`${item.name}-${index}`} className="rounded-lg border border-gray-200 bg-white p-2">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {item.name} <span className="font-normal text-gray-500">x{item.quantity}</span>
                    </p>
                    <span className="whitespace-nowrap text-xs text-gray-500">
                      {m3(itemLineVolume(item))}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                    <select
                      value={type}
                      onChange={(e) => setItemType(index, e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {TYPE_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                    <div className="w-full sm:w-36">
                      <Input
                        type="number"
                        min="0"
                        step="100"
                        disabled={type === 'none'}
                        value={type === 'none' || price === undefined ? '' : price}
                        onChange={(e) => setItemPrice(index, e.target.value)}
                        placeholder="$/m³"
                        className={`py-1.5 text-sm ${priceInvalid ? 'border-red-500' : ''}`}
                      />
                    </div>
                    <span className="whitespace-nowrap text-right text-sm font-semibold text-gray-900 sm:w-24">
                      {type === 'none' ? '—' : money(itemPackagingCost(item))}
                    </span>
                  </div>
                  {priceInvalid && (
                    <p className="mt-1 text-xs text-red-600">
                      Ingresa un precio por m³ válido (0 o mayor).
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {invalid ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Corrige los precios marcados en rojo para poder guardar.
            </p>
          ) : (
          <div className="space-y-1 rounded-lg bg-white p-3 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Embalaje cotizado</span>
              <span>{money(savedSubtotal)}</span>
            </div>
            <div className="flex justify-between font-semibold text-gray-900">
              <span>Embalaje con los nuevos precios</span>
              <span>{money(draftSubtotal)}</span>
            </div>
            <div
              className={`flex justify-between font-semibold ${
                delta > 0 ? 'text-orange-700' : delta < 0 ? 'text-green-700' : 'text-gray-500'
              }`}
            >
              <span>Diferencia</span>
              <span>
                {delta > 0 ? '+' : ''}
                {money(delta)}
              </span>
            </div>
          </div>
          )}

          {!invalid && canApplyDelta && delta !== 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <input
                type="checkbox"
                checked={applyDelta}
                onChange={(e) => setApplyDelta(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span>
                <span className="font-medium text-gray-900">
                  Aplicar la diferencia al precio final: {money(currentPrice as number)} →{' '}
                  {money(newPrice as number)}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Suma la diferencia tal cual sobre el precio vigente; no recalcula descuentos
                  ni IVA. Desmarcado, solo se corrigen los precios por artículo.
                </span>
                {newPrice !== null && newPrice <= 0 && (
                  <span className="mt-0.5 block text-xs font-medium text-red-600">
                    El precio final quedaría en cero o negativo.
                  </span>
                )}
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={save}
              isLoading={saving}
              disabled={saving || invalid || (applyDelta && newPrice !== null && newPrice <= 0)}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Guardar precios
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
