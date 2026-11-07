'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import { expenseCategoryLabel, type ExpenseCategory, type ExpensesData } from '@/lib/incomeStatementTypes'

/**
 * Finanzas → Gastos: el registro de gastos del negocio, de tres orígenes.
 *  - Los de la empresa, que se cargan a mano acá, cada uno con su categoría.
 *  - Los que rinden los trabajadores (se aprueban en «Por aprobar»): acá se les pone categoría.
 *  - Los cargos del banco que no calzan con nada registrado: se pasan a gasto con un clic.
 * Las categorías son las del panel más las que se creen acá. Todo entra al estado de resultados.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const day = (d: string) => d.slice(0, 10).split('-').reverse().join('-')
const inputClass = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm'

export default function ExpensesPanel() {
  const [period, setPeriod] = useState<Period>(periodOf('month'))
  const resolved = resolvePeriod(period)
  const month = resolvePeriod(periodOf('month'))
  const from = resolved.from && resolved.to ? resolved.from : (month.from as string)
  const to = resolved.from && resolved.to ? resolved.to : (month.to as string)

  const [data, setData] = useState<ExpensesData | null>(null)
  const [busy, setBusy] = useState(false)
  const empty = { date: '', category: 'combustible' as ExpenseCategory, description: '', amount: '', iva: '', provider: '', docNumber: '' }
  const [form, setForm] = useState(empty)
  const [newCategory, setNewCategory] = useState('')
  const [managing, setManaging] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/accounting/expenses?desde=${from}&hasta=${to}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar los gastos')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los gastos')
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const call = async (url: string, init: RequestInit, ok: string) => {
    if (busy) return false
    setBusy(true)
    try {
      const res = await fetch(url, init)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      toast.success(ok)
      await load()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
      return false
    } finally {
      setBusy(false)
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  const add = async () => {
    const saved = await call(
      '/api/admin/accounting/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount), iva: form.iva === '' ? 0 : Number(form.iva) }),
      },
      'Gasto cargado'
    )
    if (saved) setForm({ ...empty, date: form.date, category: form.category })
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">Gastos del {day(data.from)} al {day(data.to)}.</p>
        <PeriodFilter value={period} onChange={setPeriod} presets={['week', 'month', 'custom']} />
      </div>

      {!data.available && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_company_expenses.sql</code> para poder cargar gastos de la empresa.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos de la empresa</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.total)}</p>
          <p className="text-xs text-gray-500">{data.expenses.length} gasto{data.expenses.length === 1 ? '' : 's'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">IVA anotado en esos gastos</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.totalIva)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos de trabajadores aprobados</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.workerExpensesTotal)}</p>
          <p className="text-xs text-gray-500">{data.workerExpenses.length} comprobante{data.workerExpenses.length === 1 ? '' : 's'}</p>
        </Card>
        <Card className="border-l-4 border-l-primary-500 p-4">
          <p className="text-sm text-gray-500">Total de gastos</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.total + data.workerExpensesTotal)}</p>
        </Card>
      </div>

      {data.consolidated.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-gray-100 px-5 py-3">
            <h3 className="text-base font-bold text-gray-900">Por categoría</h3>
            <p className="text-xs text-gray-500">Gastos de la empresa y de trabajadores juntos, con el monto total de cada documento.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-2 font-semibold">Categoría</th>
                  <th className="px-3 py-2 text-right font-semibold">Empresa</th>
                  <th className="px-3 py-2 text-right font-semibold">Trabajadores</th>
                  <th className="px-5 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {data.consolidated.map((g) => (
                  <tr key={g.category || 'sin'} className={g.category ? '' : 'bg-amber-50/60'}>
                    <td className="px-5 py-2 text-gray-900">{g.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{clp(g.company)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{clp(g.workers)}</td>
                    <td className="px-5 py-2 text-right font-semibold tabular-nums text-gray-900">{clp(g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-gray-900">Categorías</h3>
          <button type="button" onClick={() => setManaging((v) => !v)} className="text-sm font-semibold text-primary-600 hover:underline">
            {managing ? 'Cerrar' : 'Agregar o quitar categorías'}
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-600">{data.categories.map((c) => c.label).join(' · ')}</p>
        {managing && (
          <div className="mt-3 space-y-3">
            {!data.categoriesAvailable && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Falta correr la migración <code>database/migrations/add_expense_categories.sql</code> para crear categorías.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">Categoría nueva</label>
                <input value={newCategory} maxLength={60} onChange={(e) => setNewCategory(e.target.value)} placeholder="Ej. Contador, Uniformes, Telefonía" className={inputClass} />
              </div>
              <Button
                size="sm"
                disabled={busy || !data.categoriesAvailable || newCategory.trim().length < 2}
                onClick={async () => {
                  if (await call('/api/admin/accounting/expense-categories', json('POST', { label: newCategory }), 'Categoría creada')) setNewCategory('')
                }}
              >
                Crear
              </Button>
            </div>
            {data.categories.some((c) => c.custom) && (
              <p className="text-sm text-gray-700">
                Creadas por ustedes:{' '}
                {data.categories
                  .filter((c) => c.custom)
                  .map((c) => (
                    <span key={c.value} className="mr-3 whitespace-nowrap">
                      {c.label}{' '}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`¿Quitar «${c.label}» de la lista? Los gastos que ya la usan la conservan.`)) {
                            call(`/api/admin/accounting/expense-categories?slug=${encodeURIComponent(c.value)}`, { method: 'DELETE' }, 'Categoría quitada de la lista')
                          }
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        quitar
                      </button>
                    </span>
                  ))}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-gray-100 px-5 py-3">
          <h3 className="text-base font-bold text-gray-900">Cargos del banco sin registrar</h3>
          <p className="text-xs text-gray-500">
            Salidas de plata de BancoEstado de {data.bankPeriod.split('-').reverse().join('-')} que no calzan con ningún gasto ni pago a trabajador. «Registrar como
            gasto» los pasa al formulario de abajo para ponerles categoría.
          </p>
        </div>
        {!data.bankHasData ? (
          <p className="p-5 text-sm text-gray-500">El banco no entregó movimientos de ese mes. Cuando lleguen, los cargos sin registrar aparecen acá.</p>
        ) : data.bankPending.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Todos los cargos del banco de ese mes tienen su gasto o pago registrado.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.bankPending.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 text-gray-900">
                  {m.description || 'Sin glosa'} <span className="text-xs text-gray-500">· {day(m.date)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-gray-900">{clp(m.amount)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, date: m.date, description: m.description.slice(0, 200), amount: String(m.amount), iva: '', provider: '', docNumber: '' })
                      document.getElementById('cargar-gasto')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Registrar como gasto
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5" id="cargar-gasto">
        <h3 className="text-base font-bold text-gray-900">Cargar un gasto</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Fecha</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Categoría</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className={inputClass}>
              {data.categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">Qué fue</label>
            <input value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Monto total</label>
            <input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/\D/g, '') })} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">IVA incluido (opcional)</label>
            <input inputMode="numeric" value={form.iva} onChange={(e) => setForm({ ...form, iva: e.target.value.replace(/\D/g, '') })} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Proveedor (opcional)</label>
            <input value={form.provider} maxLength={120} onChange={(e) => setForm({ ...form, provider: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">N° boleta o factura (opcional)</label>
            <input value={form.docNumber} maxLength={40} onChange={(e) => setForm({ ...form, docNumber: e.target.value })} className={inputClass} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" disabled={busy || !data.available || !form.date || !form.description.trim() || !(Number(form.amount) > 0)} onClick={add}>
            Guardar gasto
          </Button>
          <p className="text-xs text-gray-500">El IVA se anota tal como viene en el documento: el panel no lo calcula, porque no todos los gastos llevan 19 %.</p>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <h3 className="text-base font-bold text-gray-900">Gastos de la empresa</h3>
          <p className="text-xs text-gray-500">
            {data.byCategory.map((g) => `${g.label} ${clp(g.amount)}`).join(' · ')}
          </p>
        </div>
        {data.expenses.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Sin gastos cargados en este período.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">
                    {e.description} <span className="font-normal text-gray-500">· {expenseCategoryLabel(e.category, data.categories)}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {[day(e.date), e.provider, e.docNumber ? `N° ${e.docNumber}` : null, e.iva > 0 ? `IVA ${clp(e.iva)}` : null, e.createdBy].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-gray-900">{clp(e.amount)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`¿Quitar el gasto «${e.description}» de ${clp(e.amount)}?`)) {
                        call(`/api/admin/accounting/expenses?id=${e.id}`, { method: 'DELETE' }, 'Gasto quitado')
                      }
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-gray-100 px-5 py-3">
          <h3 className="text-base font-bold text-gray-900">Gastos de trabajadores aprobados</h3>
          <p className="text-xs text-gray-500">Se rinden desde el panel del trabajador y se aprueban en «Por aprobar». Acá se les pone la categoría.</p>
        </div>
        {data.workerExpenses.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Ninguno en este período.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.workerExpenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="text-gray-900">
                  {e.name} <span className="text-xs text-gray-500">· {day(e.date)} · {e.worker}</span>
                </span>
                <span className="flex items-center gap-3">
                  <select
                    value={e.category || ''}
                    disabled={busy || !data.categoriesAvailable}
                    onChange={(ev) => call('/api/admin/accounting/expenses', json('PATCH', { workerExpenseId: e.id, category: ev.target.value || null }), 'Categoría guardada')}
                    className={`rounded-lg border px-2 py-1 text-xs ${e.category ? 'border-gray-300 text-gray-700' : 'border-amber-400 bg-amber-50 text-amber-900'}`}
                    aria-label={`Categoría de ${e.name}`}
                  >
                    <option value="">Sin categoría</option>
                    {data.categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                    {e.category && !data.categories.some((c) => c.value === e.category) && <option value={e.category}>{e.category}</option>}
                  </select>
                  <span className="font-semibold tabular-nums text-gray-900">{clp(e.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
