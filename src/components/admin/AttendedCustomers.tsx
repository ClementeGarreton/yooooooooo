'use client'

import { useEffect, useMemo, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import { Users, Download, Star, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AttendedCustomer } from '@/lib/adminAnalytics'
import CustomerFicha from './CustomerFicha'
import {
  SOURCE_OPTIONS,
  getSourceBadge,
  getSourceLabel,
  normalizeOrigin,
} from '@/lib/prospectSource'

interface Customer extends AttendedCustomer {
  isFrequent?: boolean
  notes?: string
}

const EMPTY_CUSTOMER = {
  name: '',
  email: '',
  phone: '',
  source: 'cliente_antiguo',
  is_company: false,
  company_name: '',
  company_rut: '',
  notes: '',
}

const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return y && m && day ? `${day}-${m}-${y}` : d
}

const escapeCsv = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function AttendedCustomers({
  onOpenBooking,
}: {
  /** Lleva a una reserva en la pestaña Reservas (la usa la ficha del cliente). */
  onOpenBooking?: (quoteId: string) => void
} = {}) {
  // Correo del cliente cuya ficha está abierta.
  const [fichaEmail, setFichaEmail] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [originFilter, setOriginFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ ...EMPTY_CUSTOMER })

  useEffect(() => {
    fetchCustomers()
  }, [])

  const fetchCustomers = async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setLoading(true)
      const res = await fetch('/api/admin/customers/attended')
      const data = await res.json().catch(() => ([]))
      if (!res.ok) throw new Error(data?.error || 'fetch failed')
      setCustomers(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching customers:', error)
      toast.error('Error al cargar clientes')
    } finally {
      if (!options.silent) setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter((customer) => {
      const matchesSearch =
        !q ||
        customer.name.toLowerCase().includes(q) ||
        customer.email.toLowerCase().includes(q) ||
        customer.phone.toLowerCase().includes(q) ||
        (customer.companyName || '').toLowerCase().includes(q)
      const matchesOrigin =
        originFilter === 'all' || normalizeOrigin(customer.origin) === originFilter
      return matchesSearch && matchesOrigin
    })
  }, [customers, search, originFilter])

  const createCustomer = async () => {
    if (!newCustomer.name.trim() || !newCustomer.email.trim() || !newCustomer.phone.trim()) {
      toast.error('Completa nombre, email y teléfono')
      return
    }
    try {
      setCreating(true)
      const response = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCustomer),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'No se pudo guardar el cliente')
      toast.success('Cliente guardado sin crear una reserva')
      setShowAddModal(false)
      setNewCustomer({ ...EMPTY_CUSTOMER })
      await fetchCustomers({ silent: true })
    } catch (error) {
      console.error('Error creating customer:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el cliente')
    } finally {
      setCreating(false)
    }
  }

  const updateCustomerOrigin = async (customer: Customer, source: string) => {
    const previous = customer.origin
    setCustomers((rows) =>
      rows.map((row) => (row.email === customer.email ? { ...row, origin: source } : row))
    )
    try {
      const response = await fetch('/api/admin/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: customer.email,
          name: customer.name,
          phone: customer.phone,
          source,
          is_company: customer.isCompany,
          company_name: customer.companyName,
          company_rut: customer.companyRut,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'No se pudo actualizar el origen')
      toast.success('Origen del cliente actualizado')
    } catch (error) {
      setCustomers((rows) =>
        rows.map((row) => (row.email === customer.email ? { ...row, origin: previous } : row))
      )
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el origen')
    }
  }

  const handleExportCSV = () => {
    const columns: { header: string; value: (c: Customer) => unknown }[] = [
      { header: 'Nombre', value: (c) => c.name },
      { header: 'Email', value: (c) => c.email },
      { header: 'Teléfono', value: (c) => c.phone },
      { header: 'Origen', value: (c) => getSourceLabel(c.origin) },
      { header: 'Tipo cliente', value: (c) => (c.isCompany ? 'Empresa' : 'Persona') },
      { header: 'Razón social', value: (c) => c.companyName },
      { header: 'RUT empresa', value: (c) => c.companyRut },
      { header: 'Mudanzas', value: (c) => c.movesCount },
      { header: 'Primera mudanza', value: (c) => fmtDate(c.firstMoveDate) },
      { header: 'Última mudanza', value: (c) => fmtDate(c.lastMoveDate) },
      { header: 'Frecuente', value: (c) => (c.isFrequent ? 'Sí' : 'No') },
      { header: 'Notas', value: (c) => c.notes || '' },
    ]
    const header = columns.map((c) => escapeCsv(c.header)).join(',')
    const rows = filtered.map((c) => columns.map((col) => escapeCsv(col.value(c))).join(','))
    const csv = '﻿' + [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando clientes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Clientes</h2>
          <p className="text-gray-600">
            Fichas independientes y clientes con mudanzas atendidas
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExportCSV} variant="outline" size="sm" disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-2" /> Exportar CSV
          </Button>
          <Button onClick={() => setShowAddModal(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" /> Agregar cliente
          </Button>
        </div>
      </div>

      {/* Sin montos (Francisco, 20-10-2026): lo que factura cada cliente se ve en Finanzas. */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Clientes</p>
          <p className="text-2xl font-bold text-gray-900">{customers.length}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, teléfono o razón social..."
          />
          <Select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value)}
            options={[{ value: 'all', label: 'Todos los orígenes' }, ...SOURCE_OPTIONS]}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No hay clientes para estos filtros</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contacto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origen</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mudanzas</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Última</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.map((customer) => (
                  <tr key={customer.email} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setFichaEmail(customer.email)}
                          className="text-left text-sm font-medium text-gray-900 hover:text-primary-600 hover:underline"
                        >
                          {customer.name || customer.email}
                        </button>
                        {customer.isFrequent && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" /> Frecuente
                          </span>
                        )}
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                          {customer.isCompany ? 'Empresa' : 'Persona'}
                        </span>
                      </div>
                      <div className="md:hidden text-xs text-gray-500">{customer.email}</div>
                      <button
                        type="button"
                        onClick={() => setFichaEmail(customer.email)}
                        className="mt-1 text-xs font-semibold text-primary-600 underline underline-offset-2"
                      >
                        Abrir ficha
                      </button>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 align-top">
                      <div className="text-sm text-gray-500">{customer.email}</div>
                      <div className="text-xs text-gray-400">{customer.phone}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Select
                        value={normalizeOrigin(customer.origin)}
                        onChange={(e) => updateCustomerOrigin(customer, e.target.value)}
                        options={SOURCE_OPTIONS}
                        className={`min-w-[170px] text-xs font-medium ${getSourceBadge(customer.origin)}`}
                      />
                    </td>
                    <td className="px-4 py-3 align-top text-sm font-semibold text-gray-900">{customer.movesCount}</td>
                    <td className="hidden sm:table-cell px-4 py-3 align-top text-sm text-gray-600">{fmtDate(customer.lastMoveDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Agregar cliente sin reserva"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            La ficha quedará en Clientes. No ocupará fecha ni camión hasta que crees una reserva.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Origen del cliente</label>
              <Select value={newCustomer.source} onChange={(e) => setNewCustomer({ ...newCustomer, source: e.target.value })} options={SOURCE_OPTIONS} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <Input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
              <Input type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={newCustomer.is_company} onChange={(e) => setNewCustomer({ ...newCustomer, is_company: e.target.checked })} />
            Es empresa
          </label>
          {newCustomer.is_company && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input placeholder="Razón social" value={newCustomer.company_name} onChange={(e) => setNewCustomer({ ...newCustomer, company_name: e.target.value })} />
              <Input placeholder="RUT empresa" value={newCustomer.company_rut} onChange={(e) => setNewCustomer({ ...newCustomer, company_rut: e.target.value })} />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" rows={3} value={newCustomer.notes} onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddModal(false)}>Cancelar</Button>
            <Button onClick={createCustomer} disabled={creating}>{creating ? 'Guardando...' : 'Guardar cliente'}</Button>
          </div>
        </div>
      </Modal>

      <CustomerFicha
        email={fichaEmail}
        onClose={() => setFichaEmail(null)}
        onOpenBooking={
          onOpenBooking
            ? (quoteId) => {
                setFichaEmail(null)
                onOpenBooking(quoteId)
              }
            : undefined
        }
      />
    </div>
  )
}
