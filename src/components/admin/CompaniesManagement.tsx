'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import { ArrowLeft, Building2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import CompanyBilling from './CompanyBilling'
import CompanyClosingPanel from './CompanyClosingPanel'
import CompanySignupPanel from './CompanySignupPanel'
import { CompanyDocumentsTab, CompanyInvoicesTab, CompanyJobsTab, CompanyNotesTab, CompanySummaryTab, type CompanyTab } from './CompanyPanelTabs'
import CompanyFields, { EMPTY_FORM, companyToForm, type CompanyForm } from './CompanyFields'
import { openPreview } from './openPreview'
import { formatRut, isValidRut } from '@/lib/rut'
import type { Company, CompanyBooking, CompanyMember, CompanyRole, UnlinkedCompanyBooking } from '@/lib/companies'
import type { StoredDocument } from '@/lib/documents'
import type { CompanyPanelData } from '@/lib/companyPanel'

/**
 * Pestaña Empresas del admin (etapa 2 del panel de perfiles).
 *
 * Al hacer click en una empresa se abre su PANEL a pantalla completa (Francisco, 27-10-2026),
 * no una ventana: Resumen, Trabajos (con quién los hizo), Cierres (y su PDF para cobrar),
 * Facturas, Documentos, Notas con fecha y autor, y Personas y datos. Queda en la dirección
 * (`?tab=companies&empresa=<id>`): se puede compartir el link y «atrás» vuelve a la lista.
 *
 * La empresa es el ID al que se le factura. En su ficha se decide QUIÉN pertenece a ella
 * (y si ve todo o solo lo suyo en su panel) y QUÉ reservas se le facturan. Las reservas de sus
 * personas y las que traen su RUT se le asignan solas (add_empresa_auto_asignar.sql); a mano
 * se puede asignar o quitar cualquiera.
 */

interface CompanyRow extends Company {
  memberCount: number
  bookingCount: number
}

interface CompanyDetail {
  company: Company
  members: CompanyMember[]
  bookings: CompanyBooking[]
  candidates: CompanyBooking[]
  documents: StoredDocument[]
}

interface FoundCustomer {
  id: string
  code: string
  name: string | null
  email: string
  company_id: string | null
}

const ROLE_OPTIONS = [
  { value: 'miembro', label: 'Miembro — ve solo lo suyo' },
  { value: 'encargado', label: 'Encargado — ve todo lo de la empresa' },
]

const fmtDate = (d: string | null) => {
  if (!d) return 'Sin fecha'
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

/** Los campos que la persona escribió mientras se buscaban los datos (no se pisan). */
function pickTyped(current: CompanyForm, before: CompanyForm): Partial<CompanyForm> {
  const out: Partial<CompanyForm> = {}
  for (const k of Object.keys(current) as (keyof CompanyForm)[]) if (current[k] !== before[k]) (out as any)[k] = current[k]
  return out
}

export default function CompaniesManagement() {
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CompanyForm>({ ...EMPTY_FORM })

  const [detail, setDetail] = useState<CompanyDetail | null>(null)
  const [panel, setPanel] = useState<CompanyPanelData | null>(null)
  const [tab, setTab] = useState<CompanyTab>('resumen')
  /** Reserva cuyos documentos se muestran ('' = todos, 'empresa' = sin reserva). */
  const [docFilter, setDocFilter] = useState('')
  const [editForm, setEditForm] = useState<CompanyForm>({ ...EMPTY_FORM })
  const [busy, setBusy] = useState(false)

  const [customerQuery, setCustomerQuery] = useState('')
  const [found, setFound] = useState<FoundCustomer[]>([])
  const [newRole, setNewRole] = useState<CompanyRole>('miembro')

  // Reservas marcadas «es empresa» sin empresa en el panel: no se pueden facturar.
  const [unlinked, setUnlinked] = useState<UnlinkedCompanyBooking[]>([])
  const [assignTo, setAssignTo] = useState<Record<string, string>>({})
  /** Reserva que se asigna a la empresa que se está creando desde la tarjeta. */
  const [createForBooking, setCreateForBooking] = useState<string | null>(null)
  /** De dónde salieron los datos que se llenaron solos (SII, reservas). */
  const [createSources, setCreateSources] = useState<string[] | null>(null)
  const [editSources, setEditSources] = useState<string[] | null>(null)

  /**
   * Lo que el sistema ya sabe de la empresa por su RUT (Tomás, 23-10-2026: «compatibilizar con
   * los datos que ya manejamos»): llena solo los campos vacíos, nunca pisa lo escrito.
   */
  const fillFromKnown = useCallback(async (form: CompanyForm): Promise<{ form: CompanyForm; sources: string[] } | null> => {
    if (!isValidRut(form.rut)) return null
    const res = await fetch(`/api/admin/companies/lookup?rut=${encodeURIComponent(form.rut)}`)
    const found = await res.json().catch(() => null)
    if (!res.ok || !found) return null
    const next = { ...form }
    const fill = (k: keyof CompanyForm, v: string | null) => {
      if (v && typeof next[k] === 'string' && !(next[k] as string).trim()) (next as any)[k] = v
    }
    // La razón social facturada reemplaza la que escribió el cliente al reservar.
    if (found.razonSocial && found.sources.some((x: string) => x.includes('SII'))) next.razon_social = found.razonSocial
    else fill('razon_social', found.razonSocial)
    fill('giro', found.giro)
    fill('direccion', found.direccion)
    fill('comuna', found.comuna)
    fill('email_facturacion', found.email)
    return { form: next, sources: found.sources }
  }, [])

  // Al crear: apenas el RUT es válido, se traen los datos conocidos.
  useEffect(() => {
    if (!showCreate || !isValidRut(createForm.rut)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await fillFromKnown(createForm).catch(() => null)
      if (cancelled || !result) return
      setCreateForm((current) => (current.rut === createForm.rut ? { ...result.form, ...pickTyped(current, createForm) } : current))
      setCreateSources(result.sources)
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // Solo cuando cambia el RUT o se abre el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreate, createForm.rut, fillFromKnown])

  const fetchUnlinked = useCallback(async () => {
    try {
      const data = await api('/api/admin/companies/sin-empresa', 'GET')
      setUnlinked(data.bookings || [])
    } catch {
      setUnlinked([])
    }
  }, [])

  useEffect(() => {
    fetchUnlinked()
  }, [fetchUnlinked])

  const assignUnlinked = async (bookingId: string, companyId: string) => {
    setBusy(true)
    try {
      await api('/api/admin/companies/sin-empresa', 'POST', { bookingId, companyId })
      toast.success('Reserva asignada a la empresa')
      await Promise.all([fetchUnlinked(), fetchCompanies()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo asignar la reserva')
    } finally {
      setBusy(false)
    }
  }

  const fetchCompanies = useCallback(async () => {
    try {
      const data = await api('/api/admin/companies', 'GET')
      setCompanies(data.companies || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cargar empresas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  /** Carga (o recarga) la ficha y el panel de la empresa. */
  const openDetail = useCallback(async (id: string) => {
    try {
      const [data, panelData]: [CompanyDetail, CompanyPanelData] = await Promise.all([
        api(`/api/admin/companies/${id}`, 'GET'),
        api(`/api/admin/companies/${id}/panel`, 'GET'),
      ])
      setDetail(data)
      setPanel(panelData)
      setEditForm(companyToForm(data.company))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo abrir la empresa')
    }
  }, [])

  const resetDetail = () => {
    setDetail(null)
    setPanel(null)
    setTab('resumen')
    setDocFilter('')
    setEditSources(null)
    setCustomerQuery('')
    setFound([])
  }

  /** La empresa abierta vive en la dirección: `?tab=companies&empresa=<id>`. */
  const setUrlCompany = (id: string | null) => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'companies')
    if (id) url.searchParams.set('empresa', id)
    else url.searchParams.delete('empresa')
    window.history.pushState(null, '', url)
  }

  const selectCompany = (id: string) => {
    setUrlCompany(id)
    setTab('resumen')
    setDocFilter('')
    openDetail(id)
  }

  const closeDetail = () => {
    setUrlCompany(null)
    resetDetail()
  }

  // Al entrar con ?empresa= y con «atrás» / «adelante» del navegador.
  useEffect(() => {
    const sync = () => {
      const id = new URLSearchParams(window.location.search).get('empresa')
      if (id) openDetail(id)
      else resetDetail()
    }
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [openDetail])

  /** Corre una acción de la ficha y la vuelve a cargar junto con la lista. */
  const run = async (action: () => Promise<unknown>, ok: string) => {
    if (!detail || busy) return
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      await Promise.all([openDetail(detail.company.id), fetchCompanies()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo completar la acción')
    } finally {
      setBusy(false)
    }
  }

  const createCompany = async () => {
    if (!createForm.razon_social.trim() || !isValidRut(createForm.rut)) {
      toast.error('Completa la razón social y un RUT válido')
      return
    }
    setBusy(true)
    try {
      const data = await api('/api/admin/companies', 'POST', createForm)
      toast.success(`Empresa creada: ${data.company.code}`)
      if (createForBooking) {
        await api('/api/admin/companies/sin-empresa', 'POST', { bookingId: createForBooking, companyId: data.company.id })
        toast.success('Reserva asignada a la empresa nueva')
        setCreateForBooking(null)
        await fetchUnlinked()
      }
      setShowCreate(false)
      setCreateForm({ ...EMPTY_FORM })
      setCreateSources(null)
      await fetchCompanies()
      selectCompany(data.company.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la empresa')
    } finally {
      setBusy(false)
    }
  }

  // Búsqueda de personas para asociar, con una pausa para no consultar en cada tecla.
  useEffect(() => {
    const q = customerQuery.trim()
    if (q.length < 2) {
      setFound([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/api/admin/customers/search?q=${encodeURIComponent(q)}`, 'GET')
        if (!cancelled) setFound(data.customers || [])
      } catch {
        if (!cancelled) setFound([])
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [customerQuery])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return companies
    return companies.filter(
      (c) =>
        c.razon_social.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.rut.toLowerCase().includes(q.replace(/\./g, ''))
    )
  }, [companies, search])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  const base = detail ? `/api/admin/companies/${detail.company.id}` : ''

  if (detail) {
    const company = detail.company
    const tabs: { id: CompanyTab; label: string }[] = [
      { id: 'resumen', label: 'Resumen' },
      { id: 'trabajos', label: `Trabajos (${panel?.jobs.length ?? detail.bookings.length})` },
      { id: 'cierres', label: 'Cierres y PDF' },
      { id: 'facturas', label: `Facturas${panel ? ` (${panel.invoices.length})` : ''}` },
      { id: 'documentos', label: `Documentos (${detail.documents.length})` },
      { id: 'notas', label: `Notas${panel ? ` (${panel.notes.length})` : ''}` },
      { id: 'datos', label: `Personas y datos (${detail.members.length})` },
    ]
    return (
      <div className="space-y-5">
        <div>
          <button type="button" onClick={closeDetail} className="mb-2 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> Empresas
          </button>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-bold text-gray-900">{company.razon_social}</h2>
            <p className="text-sm text-gray-500">
              {[company.code, formatRut(company.rut), company.facturacion_mensual ? 'Facturación mensual' : 'Factura por servicio'].join(' · ')}
            </p>
          </div>
        </div>

        <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-gray-200 px-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                tab === t.id ? 'border-primary-600 font-semibold text-primary-700' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Card className="p-4">
          {!panel && tab !== 'datos' && tab !== 'cierres' ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : tab === 'resumen' && panel ? (
            <CompanySummaryTab panel={panel} members={detail.members} legacyNote={company.notes} onGo={setTab} />
          ) : tab === 'trabajos' && panel ? (
            <CompanyJobsTab
              jobs={panel.jobs}
              candidates={detail.candidates}
              busy={busy}
              onRemove={(job) => {
                if (!window.confirm(`¿Quitar ${job.code || 'esta reserva'} de ${company.razon_social}? Deja de facturársele.`)) return
                run(() => api(`${base}/bookings`, 'POST', { bookingIds: [job.id], assign: false }), 'Reserva quitada')
              }}
              onAssign={(ids, confirmText) => {
                if (confirmText && !window.confirm(confirmText)) return
                run(() => api(`${base}/bookings`, 'POST', { bookingIds: ids, assign: true }), ids.length === 1 ? 'Reserva asignada' : 'Reservas asignadas')
              }}
              onShowFiles={(bookingId) => {
                setDocFilter(bookingId)
                setTab('documentos')
              }}
            />
          ) : tab === 'cierres' ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Elige el mes (o la semana), revisa y completa cada trabajo, y baja el PDF para cobrarle a la empresa. «Cerrar período» lo deja guardado;
                los cierres guardados se pueden volver a bajar en PDF.
              </p>
              <CompanyClosingPanel key={company.id} companyId={company.id} onChanged={() => openDetail(company.id)} />
            </div>
          ) : tab === 'facturas' && panel ? (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">Facturas de la empresa</h3>
                <CompanyInvoicesTab invoices={panel.invoices} />
              </section>
              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">Facturación mensual</h3>
                <CompanyBilling companyId={company.id} companyName={company.razon_social} />
              </section>
            </div>
          ) : tab === 'documentos' ? (
            <CompanyDocumentsTab documents={detail.documents} bookingFilter={docFilter} onBookingFilter={setDocFilter} />
          ) : tab === 'notas' && panel ? (
            <CompanyNotesTab
              notes={panel.notes}
              available={panel.notesAvailable}
              legacyNote={company.notes}
              busy={busy}
              onAdd={async (body) => {
                if (busy) return false
                setBusy(true)
                try {
                  await api(`${base}/notes`, 'POST', { body })
                  toast.success('Nota agregada')
                  await openDetail(company.id)
                  return true
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'No se pudo guardar la nota')
                  return false
                } finally {
                  setBusy(false)
                }
              }}
            />
          ) : (
            <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Datos de facturación</h3>
              <CompanyFields form={editForm} onChange={setEditForm} />
              {editSources && (
                <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-900">
                  {editSources.length > 0 ? `Completado con: ${editSources.join(' · ')}. Falta guardar.` : 'No encontramos facturas ni reservas con este RUT.'}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    const result = await fillFromKnown(editForm).catch(() => null)
                    if (!result) return toast.error('No se pudieron traer los datos')
                    setEditForm(result.form)
                    setEditSources(result.sources)
                  }}
                >
                  Completar con lo que ya tenemos (SII)
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => api(base, 'PATCH', editForm), 'Datos guardados')}
                >
                  Guardar datos
                </Button>
              </div>
            </section>

            <section className="border-t border-gray-200 pt-4">
              <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-500">
                Personas ({detail.members.length})
              </h3>
              <p className="mb-3 text-xs text-gray-500">
                En su panel (Mi cuenta → Empresa), el encargado ve todas las reservas de la empresa y puede pagarlas o
                cambiarles la fecha; un miembro las ve todas, pero en solo lectura. Facturas y documentos, solo el encargado.
              </p>
              {detail.members.length > 0 && (
                <ul className="mb-3 divide-y divide-gray-100">
                  {detail.members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{m.name || m.email}</p>
                        <p className="text-xs text-gray-500">{[m.code, m.email, m.phone].filter(Boolean).join(' · ')}</p>
                        {!String(m.email || '').includes('@') && (
                          <p className="text-xs font-semibold text-amber-700">
                            Sin correo válido: no puede entrar a su cuenta. Corrígelo en Clientes → su ficha → Editar datos.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => openPreview({ kind: 'customer', id: m.id })}>
                          Ver su panel
                        </Button>
                        <Select
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            run(
                              () => api(`${base}/members`, 'POST', { customerId: m.id, role: e.target.value }),
                              'Rol actualizado'
                            )
                          }
                          options={ROLE_OPTIONS}
                          className="text-xs"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`¿Quitar a ${m.name || m.email} de la empresa? Sus reservas no cambian.`)) return
                            run(() => api(`${base}/members`, 'DELETE', { customerId: m.id }), 'Persona quitada')
                          }}
                        >
                          Quitar
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    placeholder="Asociar persona: nombre, correo o código CL-..."
                  />
                  <Select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as CompanyRole)}
                    options={ROLE_OPTIONS}
                  />
                </div>
                {found.length > 0 && (
                  <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
                    {found.map((c) => {
                      const here = c.company_id === detail.company.id
                      const elsewhere = !!c.company_id && !here
                      return (
                        <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">
                            <span className="font-medium text-gray-900">{c.name || c.email}</span>{' '}
                            <span className="text-xs text-gray-500">
                              {c.code} · {c.email}
                            </span>
                          </span>
                          {here ? (
                            <span className="text-xs text-gray-500">Ya está en esta empresa</span>
                          ) : elsewhere ? (
                            <span className="text-xs text-amber-700">Pertenece a otra empresa</span>
                          ) : (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api(`${base}/members`, 'POST', { customerId: c.id, role: newRole })
                                  setCustomerQuery('')
                                }, 'Persona asociada')
                              }
                            >
                              Asociar
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {customerQuery.trim().length >= 2 && found.length === 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    Nadie con ese dato. La persona tiene que existir como cliente (pestaña Clientes) antes de asociarla.
                  </p>
                )}
              </div>
            </section>
            </div>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Empresas</h2>
          <p className="text-gray-600">Cuentas empresa: sus personas, sus reservas y sus documentos</p>
        </div>
        <Button
          onClick={() => {
            // Empresa nueva desde cero: sin datos ni reserva de un intento anterior.
            setCreateForm({ ...EMPTY_FORM })
            setCreateForBooking(null)
            setCreateSources(null)
            setShowCreate(true)
          }}
          size="sm"
        >
          <Plus className="mr-2 h-4 w-4" /> Nueva empresa
        </Button>
      </div>

      <CompanySignupPanel />

      {unlinked.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">
            Reservas marcadas como empresa que no están en ninguna empresa ({unlinked.length})
          </p>
          <p className="mb-3 text-xs text-amber-800">
            Se reservaron como empresa, pero esa empresa no existe en el panel o no se asignó. Hasta asignarlas no aparecen en
            ninguna empresa ni se pueden facturar.
          </p>
          <ul className="divide-y divide-amber-200">
            {unlinked.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {b.code || 'Sin código'} · {fmtDate(b.scheduledDate)} · {b.clientName || 'Sin nombre'}
                  </p>
                  <p className="text-xs text-gray-600">
                    Escribió al reservar: {b.typedName || '—'} · RUT {b.typedRut ? formatRut(b.typedRut) : '—'}
                    {b.profileName || b.profileRut
                      ? ` · En su ficha: ${b.profileName || '—'} · RUT ${b.profileRut ? formatRut(b.profileRut) : '—'}`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={assignTo[b.id] || ''}
                    onChange={(e) => setAssignTo({ ...assignTo, [b.id]: e.target.value })}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">Asignar a…</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.razon_social}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" disabled={busy || !assignTo[b.id]} onClick={() => assignUnlinked(b.id, assignTo[b.id])}>
                    Asignar
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      // La ficha del cliente suele tener la empresa bien escrita; si no, lo de la reserva.
                      const useProfile = Boolean(b.profileName && b.profileRut)
                      setCreateForm({
                        ...EMPTY_FORM,
                        razon_social: (useProfile ? b.profileName : b.typedName) || '',
                        rut: formatRut((useProfile ? b.profileRut : b.typedRut) || ''),
                      })
                      setCreateForBooking(b.id)
                      setShowCreate(true)
                    }}
                  >
                    Crear empresa
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por razón social, RUT o código..."
        />
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <p className="text-gray-600">
              {companies.length === 0 ? 'Todavía no hay empresas creadas' : 'No hay empresas para esa búsqueda'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Empresa', 'RUT', 'Personas', 'Reservas', 'Facturación'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filtered.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => selectCompany(c.id)}>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{c.razon_social}</p>
                      <p className="text-xs text-gray-500">{c.code}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatRut(c.rut)}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{c.memberCount}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{c.bookingCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {c.facturacion_mensual ? 'Mensual' : 'Por servicio'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={showCreate}
        onClose={() => {
          setShowCreate(false)
          setCreateForBooking(null)
          setCreateSources(null)
        }}
        title="Nueva empresa"
        size="lg"
      >
        <div className="space-y-4">
          {createSources && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
              {createSources.length > 0
                ? `Datos completados con lo que ya teníamos: ${createSources.join(' · ')}. Revisa antes de crear.`
                : 'No encontramos facturas ni reservas con este RUT: completa los datos a mano.'}
            </p>
          )}
          {createForBooking && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Al crearla, se le asigna la reserva {unlinked.find((b) => b.id === createForBooking)?.code || ''}. Revisa la razón social y
              el RUT: vienen de lo que escribió el cliente.
            </p>
          )}
          <CompanyFields form={createForm} onChange={setCreateForm} />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowCreate(false)
                setCreateForBooking(null)
                setCreateSources(null)
              }}
            >
              Cancelar
            </Button>
            <Button onClick={createCompany} disabled={busy}>
              {busy ? 'Guardando...' : 'Crear empresa'}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
