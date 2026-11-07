'use client'

/**
 * Módulos recuperados visualmente del panel de referencia (captura autorizada de /admin).
 * ÚNICAMENTE consultan las API existentes en este proyecto. No crean endpoints
 * falsos, no usan los datos personales estáticos de la captura ni simulan pagos,
 * envíos de correo, facturas, aprobación de trabajadores o movimientos bancarios.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import DashboardCharts from './DashboardCharts'
import AttendedCustomers from './AttendedCustomers'
import './modulos-recuperados.css'
import {
  AlertCircle, Copy, Download, RefreshCw, Search, ShieldAlert,
} from 'lucide-react'

type Booking = {
  id: string
  quote_id?: string | null
  client_name?: string | null
  client_email?: string | null
  client_phone?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  status?: string | null
  is_company?: boolean | null
  company_name?: string | null
  company_rut?: string | null
  payment_type?: string | null
  payment_status?: string | null
  payment_method?: string | null
  total_price?: number | null
  original_price?: number | null
}
type Prospect = {
  id: string
  quote_id?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  status?: string | null
  total_price?: number | null
  adjusted_price?: number | null
  created_at?: string | null
  scheduled_date?: string | null
}
type Stats = {
  revenue?: { paid?: number; paidCount?: number; pending?: number; pendingCount?: number; booked?: number }
  monthlyRevenue?: number
  pendingBookings?: number
  outstandingQuotes?: { count?: number; total?: number }
}
type Open = (booking: { quote_id?: string | null; client_name?: string | null }) => void

type Resource<T> = { rows: T[]; loading: boolean; error: string; reload: () => Promise<void> }
function useAdminRows<T>(endpoint: string): Resource<T> {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) throw new Error(response.status === 401 ? 'Tu sesión ha expirado; vuelve a iniciar sesión.' : `No se pudieron consultar los datos (HTTP ${response.status}).`)
      const body: unknown = await response.json()
      if (!Array.isArray(body)) throw new Error('La API no devolvió una lista.')
      setRows(body as T[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }, [endpoint])
  useEffect(() => { void reload() }, [reload])
  return { rows, loading, error, reload }
}
function useAdminStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/admin/stats', { cache: 'no-store', signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error('No fue posible consultar las estadísticas'); return res.json() })
      .then(data => setStats(data as Stats))
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Error') })
    return () => controller.abort()
  }, [])
  return { stats, error }
}
const money = (n?: number | null) => n == null || !Number.isFinite(Number(n)) ? '—' : `$${Math.round(Number(n)).toLocaleString('es-CL')}`
const date = (d?: string | null) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'
const todayCL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const safe = (v?: string | null) => (v || '').trim()
const lower = (v?: string | null) => safe(v).toLocaleLowerCase('es')
const csvEsc = (value: unknown) => { const s = String(value ?? ''); return /^[=+@\-\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"` }
function downloadCsv(name: string, headers: string[], records: unknown[][]) {
  const csv = '\uFEFF' + [headers, ...records].map(row => row.map(csvEsc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
function Tabs({ options, value, onChange, label }: { options: { id: string; label: string }[]; value: string; onChange: (value: string) => void; label: string }) {
  return <div className="admin-recovered-tabs" role="tablist" aria-label={label}>{options.map(item => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} className={value === item.id ? 'active' : ''} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>
}
function Toolbar({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="admin-recovered-toolbar"><div><h2>{title}</h2><p>{description}</p></div><div className="admin-recovered-actions">{children}</div></div>
}
function Reload({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return <button type="button" className="admin-recovered-outline" onClick={onClick} disabled={loading}><RefreshCw size={14}/>{loading ? 'Cargando…' : 'Actualizar'}</button>
}
function Export({ onClick, label = 'Exportar CSV' }: { onClick: () => void; label?: string }) {
  return <button type="button" className="admin-recovered-outline" onClick={onClick}><Download size={14}/>{label}</button>
}
function Notice({ title, text }: { title: string; text: string }) {
  return <div className="admin-recovered-notice"><ShieldAlert size={19}/><div><strong>{title}</strong><p>{text}</p></div></div>
}
function Problem({ error }: { error: string }) { return error ? <div role="alert" className="admin-recovered-error"><AlertCircle size={16}/>{error}</div> : null }
function Empty({ text }: { text: string }) { return <p className="admin-recovered-empty">{text}</p> }
function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="admin-recovered-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
}
function SearchInput({ search, onChange, placeholder }: { search: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="admin-recovered-search"><Search size={16}/><input aria-label="Buscar" placeholder={placeholder || 'Buscar…'} value={search} onChange={e => onChange(e.target.value)}/></label>
}

/* Marketing — utiliza prospectos reales, no falsifica una API de campañas o cupones. */
export function MarketingRecuperado() {
  const [tab, setTab] = useState('emails')
  const [search, setSearch] = useState('')
  const { rows, error, loading, reload } = useAdminRows<Prospect>('/api/admin/prospects')
  const filtered = useMemo(() => rows.filter(p => `${p.name} ${p.email} ${p.status} ${p.source}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))), [rows, search])
  const sources = useMemo(() => {
    const counts = new Map<string, number>()
    rows.forEach(row => { const key = safe(row.source) || 'Sin origen'; counts.set(key, (counts.get(key) || 0) + 1) })
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [rows])
  return <div className="admin-recovered-view">
    <Toolbar title="Marketing" description="Contactos comerciales, cupones y referidos."><Reload onClick={() => void reload()} loading={loading}/></Toolbar>
    <Tabs label="Marketing" options={[{ id:'emails', label:'Correos' },{ id:'coupons', label:'Cupones y referidos' }]} value={tab} onChange={setTab}/>
    <Problem error={error}/>
    {tab === 'emails' ? <>
      <div className="admin-recovered-metrics"><Metric label="Prospectos registrados" value={rows.length}/><Metric label="Con correo" value={rows.filter(p => Boolean(safe(p.email))).length}/><Metric label="Fuentes identificadas" value={sources.length}/><Metric label="Con cotización" value={rows.filter(p => p.total_price != null).length}/></div>
      <Notice title="Módulo de campañas no conectado" text="Este proyecto permite consultar prospectos, pero no contiene las API de campañas ni de envío de correos del panel de referencia. No se enviará ningún correo desde esta pantalla."/>
      <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Contactos y oportunidades</h3><div className="admin-recovered-actions"><Export onClick={() => downloadCsv('marketing_prospectos.csv',['Nombre','Email','Origen','Estado','Fecha'], filtered.map(p => [p.name,p.email,p.source,p.status,p.created_at]))}/></div></div><SearchInput search={search} onChange={setSearch} placeholder="Buscar contacto, estado u origen"/>
      {loading ? <Empty text="Cargando prospectos…"/> : <div className="admin-recovered-table-wrap"><table className="admin-recovered-table"><thead><tr><th>Prospecto</th><th>Correo</th><th>Origen</th><th>Estado</th><th>Registro</th></tr></thead><tbody>{filtered.slice(0, 250).map((p, i) => <tr key={p.id || i}><td>{p.name || '—'}</td><td>{p.email || '—'}</td><td>{p.source || '—'}</td><td><span className="admin-recovered-pill">{p.status || 'Sin estado'}</span></td><td>{date(p.created_at)}</td></tr>)}</tbody></table>{filtered.length === 0 && <Empty text="No se encontraron contactos."/>}</div>}
      </div>
    </> : <>
      <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Cupones y referidos</h3><span className="admin-recovered-pill">Referencia visual</span></div><p className="admin-recovered-muted">Organización de fuentes comerciales registrada en las cotizaciones.</p>
      <div className="admin-recovered-metrics"><Metric label="Fuentes comerciales" value={sources.length}/><Metric label="Prospectos" value={rows.length}/><Metric label="Sin origen informado" value={sources.find(s => s[0] === 'Sin origen')?.[1] || 0}/></div>
      <h3 className="admin-recovered-subtitle">Origen de las oportunidades</h3><div className="admin-recovered-table-wrap"><table className="admin-recovered-table"><thead><tr><th>Origen</th><th>Contactos</th></tr></thead><tbody>{sources.map(([source, count]) => <tr key={source}><td>{source}</td><td>{count}</td></tr>)}</tbody></table></div>
      <Notice title="Cupones, descuentos y recomendadores" text="La captura muestra estas funciones, pero las API de cupones, saldos de referidos y enlaces de recomendación no forman parte del proyecto. Se conserva el diseño sin habilitar altas o cobros ficticios."/></div>
    </>}
  </div>
}

/* Empresas — agrupa reservas reales de empresas; no presupone una tabla separada. */
export function EmpresasRecuperado({ onOpen }: { onOpen: Open }) {
  const [search, setSearch] = useState('')
  const { rows, error, loading, reload } = useAdminRows<Booking>('/api/admin/bookings')
  const companies = useMemo(() => {
    const grouped = new Map<string,{ name: string; rut: string; bookings: Booking[] }>()
    rows.filter(b => b.is_company || safe(b.company_name)).forEach(booking => {
      const name = safe(booking.company_name) || 'Empresa sin razón social'
      const key = lower(name)
      const entry = grouped.get(key) || { name, rut: safe(booking.company_rut), bookings: [] }
      entry.bookings.push(booking)
      if (!entry.rut) entry.rut = safe(booking.company_rut)
      grouped.set(key, entry)
    })
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [rows])
  const filtered = companies.filter(c => `${c.name} ${c.rut}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="admin-recovered-view"><Toolbar title="Empresas" description="Clientes empresa identificados en las reservas del sistema."><Reload onClick={() => void reload()} loading={loading}/><Export onClick={() => downloadCsv('empresas_servicios.csv',['Empresa','RUT','Reservas','Último servicio'],filtered.map(c=>[c.name,c.rut,c.bookings.length,[...c.bookings].sort((a,b)=>safe(b.scheduled_date).localeCompare(safe(a.scheduled_date)))[0]?.scheduled_date]))}/></Toolbar>
    <Problem error={error}/><div className="admin-recovered-metrics"><Metric label="Empresas identificadas" value={companies.length}/><Metric label="Reservas empresariales" value={companies.reduce((s, c) => s + c.bookings.length, 0)}/></div>
    <Notice title="Portal de empresas no conectado" text="Esta cartera se obtiene de las reservas reales; el registro de empresas con claves, permisos y asignaciones del panel capturado requiere endpoints que no existen en esta versión."/>
    <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Cartera de empresas</h3></div><SearchInput search={search} onChange={setSearch} placeholder="Buscar empresa o RUT"/>{loading ? <Empty text="Consultando empresas…"/> : <div className="admin-recovered-table-wrap"><table className="admin-recovered-table"><thead><tr><th>Empresa</th><th>RUT</th><th>Servicios</th><th>Último servicio</th><th>Reserva</th></tr></thead><tbody>{filtered.map(c => { const last = [...c.bookings].sort((a,b)=>safe(b.scheduled_date).localeCompare(safe(a.scheduled_date)))[0]; return <tr key={c.name}><td><strong>{c.name}</strong></td><td>{c.rut || '—'}</td><td>{c.bookings.length}</td><td>{date(last?.scheduled_date)}</td><td><button className="admin-recovered-link" type="button" onClick={()=>onOpen(last)}>Ver reserva</button></td></tr> })}</tbody></table>{filtered.length === 0 && <Empty text="Sin empresas que coincidan con la búsqueda."/>}</div>}</div>
  </div>
}

/* Emisión de facturas — previsualización desde reservas. Nada se envía al SII. */
export function FacturasRecuperado({ onOpen }: { onOpen: Open }) {
  const [month, setMonth] = useState(todayCL().slice(0,7))
  const { rows, error, loading, reload } = useAdminRows<Booking>('/api/admin/bookings')
  const selected = useMemo(() => rows.filter(b => (b.is_company || safe(b.company_name)) && b.scheduled_date?.startsWith(month)), [rows,month])
  const grouped = useMemo(() => {
    const map = new Map<string, Booking[]>()
    selected.forEach(b => { const key = safe(b.company_name) || 'Empresa sin razón social'; map.set(key, [...(map.get(key) || []), b]) })
    return [...map]
  }, [selected])
  return <div className="admin-recovered-view"><Toolbar title="Emisión de facturas" description="Servicios empresariales registrados en el mes."><label className="admin-recovered-month">Mes <input aria-label="Mes" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><Reload onClick={()=>void reload()} loading={loading}/><Export label="Exportar base CSV" onClick={() => downloadCsv(`base_facturacion_${month}.csv`,['Empresa','RUT','Cotización','Fecha','Monto registrado','Pago'],selected.map(b=>[b.company_name,b.company_rut,b.quote_id,b.scheduled_date,b.original_price ?? b.total_price,b.payment_status]))}/></Toolbar>
    <Problem error={error}/><div className="admin-recovered-metrics"><Metric label="Empresas con servicios" value={grouped.length}/><Metric label="Servicios del mes" value={selected.length}/></div>
    <Notice title="No emite documentos tributarios" text="Esta pantalla prepara la base de servicios con datos reales. No hay integración de facturación electrónica/SII en las API actuales; no se inventarán números de factura ni estados tributarios."/>
    <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Empresas con servicios en el mes</h3></div>{loading ? <Empty text="Cargando servicios…"/> : grouped.length === 0 ? <Empty text="No hay servicios empresariales registrados en este mes."/> : grouped.map(([company, bookings])=><div className="admin-recovered-group" key={company}><div className="admin-recovered-group-head"><strong>{company}</strong><span>{bookings.length} servicio(s)</span></div>{bookings.map(b=><div className="admin-recovered-item" key={b.id}><span>{b.quote_id || 'Reserva'} · {date(b.scheduled_date)} · {b.client_name || ''}</span><button className="admin-recovered-link" type="button" onClick={()=>onOpen(b)}>Ver reserva</button></div>)}</div>)}</div>
  </div>
}


/* Clientes — integra contactos de reservas y prospectos actuales, no una copia
 * estática de personas de las capturas del navegador. */
export function ClientesRecuperados({ onOpen, onSelect }: { onOpen: Open; onSelect: (tab: string) => void }) {
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'all' | 'bookings' | 'prospects'>('all')
  const bookings = useAdminRows<Booking>('/api/admin/bookings')
  const prospects = useAdminRows<Prospect>('/api/admin/prospects')
  type Customer = { key: string; name: string; email: string; phone: string; bookingRows: Booking[]; prospectRows: Prospect[] }
  const customers = useMemo(() => {
    const map = new Map<string, Customer>()
    const makeKey = (email?: string | null, phone?: string | null, fallback?: string) => {
      const e = lower(email)
      const p = safe(phone).replace(/\D/g, '')
      return e ? `email:${e}` : p ? `phone:${p}` : fallback || 'sin-contacto'
    }
    bookings.rows.forEach((b, i) => {
      const key = makeKey(b.client_email, b.client_phone, `reserva:${b.id || i}`)
      const entry: Customer = map.get(key) || { key, name: b.client_name || '', email: b.client_email || '', phone: '', bookingRows: [], prospectRows: [] }
      entry.name = entry.name || b.client_name || ''
      entry.email = entry.email || b.client_email || ''
      entry.bookingRows.push(b)
      map.set(key, entry)
    })
    prospects.rows.forEach((p, i) => {
      const key = makeKey(p.email, p.phone, `prospecto:${p.id || i}`)
      const entry: Customer = map.get(key) || { key, name: p.name || '', email: p.email || '', phone: p.phone || '', bookingRows: [], prospectRows: [] }
      entry.name = entry.name || p.name || ''
      entry.email = entry.email || p.email || ''
      entry.phone = entry.phone || p.phone || ''
      entry.prospectRows.push(p)
      map.set(key, entry)
    })
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [bookings.rows, prospects.rows])
  const visible = useMemo(() => customers.filter(c => {
    const matches = `${c.name} ${c.email} ${c.phone}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))
    return matches && (category === 'all' || (category === 'bookings' && c.bookingRows.length > 0) || (category === 'prospects' && c.prospectRows.length > 0))
  }), [customers, search, category])
  const loading = bookings.loading || prospects.loading
  return <div className="admin-recovered-view">
    <Toolbar title="Clientes" description="Personas registradas en reservas y cotizaciones.">
      <Reload onClick={() => { void bookings.reload(); void prospects.reload() }} loading={loading}/>
      {tab === 'all' && <Export onClick={() => downloadCsv('clientes_admin.csv', ['Nombre','Correo','Teléfono','Reservas','Cotizaciones'], visible.map(c => [c.name,c.email,c.phone,c.bookingRows.length,c.prospectRows.length]))}/>}
    </Toolbar>
    <Tabs label="Clientes" options={[{id:'all',label:'Todos los contactos'}, {id:'attended',label:'Clientes atendidos'}]} value={tab} onChange={setTab}/>
    {tab === 'attended' ? <AttendedCustomers/> : <>
      <Problem error={bookings.error || prospects.error}/>
      <div className="admin-recovered-metrics"><Metric label="Contactos únicos aproximados" value={customers.length}/><Metric label="Con reserva" value={customers.filter(c => c.bookingRows.length > 0).length}/><Metric label="Con cotización" value={customers.filter(c => c.prospectRows.length > 0).length}/></div>
      <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Cartera de clientes</h3><div className="admin-recovered-actions"><label className="admin-recovered-label">Tipo<select value={category} onChange={e=>setCategory(e.target.value as typeof category)}><option value="all">Todos</option><option value="bookings">Con reserva</option><option value="prospects">Con cotización</option></select></label></div></div>
      <SearchInput search={search} onChange={setSearch} placeholder="Nombre, correo o teléfono"/>
      {loading ? <Empty text="Consultando clientes…"/> : <div className="admin-recovered-table-wrap"><table className="admin-recovered-table"><thead><tr><th>Cliente</th><th>Contacto</th><th>Reservas</th><th>Cotizaciones</th><th>Ficha</th></tr></thead><tbody>{visible.slice(0,300).map(c => <tr key={c.key}><td><strong>{c.name || 'Sin nombre'}</strong></td><td>{c.email || c.phone || '—'}{c.email && c.phone && <small className="admin-recovered-secondary">{c.phone}</small>}</td><td>{c.bookingRows.length}</td><td>{c.prospectRows.length}</td><td>{c.bookingRows.length > 0 ? <button className="admin-recovered-link" type="button" onClick={()=>onOpen(c.bookingRows[0])}>Ver reserva</button> : <button className="admin-recovered-link" type="button" onClick={()=>onSelect('prospects')}>Ir a prospectos</button>}</td></tr>)}</tbody></table>{visible.length === 0 && <Empty text="Sin contactos para este filtro."/>}{visible.length > 300 && <p className="admin-recovered-muted">Se muestran los primeros 300 resultados; usa la búsqueda o exporta el CSV.</p>}</div>}</div>
    </>}
  </div>
}

const financeTabs = [
  { id:'summary',label:'Resumen' }, { id:'income',label:'EERR' }, { id:'expenses',label:'Gastos' },
  { id:'tax',label:'IVA y banco' }, { id:'workers',label:'Pago a trabajadores' }, { id:'closing',label:'Cierre de pagos' },
]
export function FinanzasRecuperadas({ onOpen }: { onOpen: Open }) {
  const [tab, setTab] = useState('summary')
  const [month, setMonth] = useState(todayCL().slice(0,7))
  const [search, setSearch] = useState('')
  const { rows, error, loading, reload } = useAdminRows<Booking>('/api/admin/bookings')
  const { stats, error: statsError } = useAdminStats()
  const monthRows = useMemo(() => rows.filter(b => b.scheduled_date?.startsWith(month)), [rows,month])
  const filtered = useMemo(() => monthRows.filter(b => `${b.quote_id || ''} ${b.client_name || ''} ${b.company_name || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))), [monthRows,search])
  const bookingsValue = monthRows.reduce((sum, b) => sum + Number(b.original_price ?? b.total_price ?? 0), 0)
  const currentMonth = month === todayCL().slice(0, 7)
  const download = () => downloadCsv(`servicios_financieros_${month}.csv`, ['Reserva','Cliente','Empresa','Fecha','Precio registrado','Medio de pago','Estado del pago'],filtered.map(b=>[b.quote_id,b.client_name,b.company_name,b.scheduled_date,b.original_price ?? b.total_price,b.payment_method,b.payment_status]))
  return <div className="admin-recovered-view"><Toolbar title="Finanzas" description="Resumen de reservas, cobros y documentos del período."><label className="admin-recovered-month">Período <input aria-label="Mes financiero" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><Reload onClick={()=>void reload()} loading={loading}/></Toolbar>
    <Tabs options={financeTabs} value={tab} onChange={setTab} label="Finanzas"/>
    <Problem error={error || statsError}/>
    {tab==='summary' ? <>
      <div className="admin-recovered-metrics"><Metric label="Servicios del mes" value={monthRows.length}/><Metric label="Valor de servicios registrados" value={money(bookingsValue)} note="No equivale a caja cobrada"/><Metric label="Cobrado según API" value={currentMonth ? money(stats?.revenue?.paid) : '—'} note={currentMonth ? 'Mes actual' : 'API sólo resume el mes actual'}/><Metric label="Por cobrar según API" value={currentMonth ? money(stats?.revenue?.pending) : '—'} note={currentMonth ? 'Mes actual' : 'API sólo resume el mes actual'}/></div>
      <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Servicios del período</h3><Export onClick={download}/></div><SearchInput search={search} onChange={setSearch} placeholder="Buscar reserva, cliente o empresa"/>{loading ? <Empty text="Consultando reservas…"/> : <div className="admin-recovered-table-wrap"><table className="admin-recovered-table"><thead><tr><th>Reserva</th><th>Cliente</th><th>Fecha</th><th>Servicio registrado</th><th>Pago</th></tr></thead><tbody>{filtered.slice(0,250).map(b=><tr key={b.id}><td><button className="admin-recovered-link" onClick={()=>onOpen(b)} type="button">{b.quote_id || b.id.slice(0,8)}</button></td><td>{b.client_name || '—'}{b.company_name && <small className="admin-recovered-secondary">{b.company_name}</small>}</td><td>{date(b.scheduled_date)}</td><td>{money(b.original_price ?? b.total_price)}</td><td><span className="admin-recovered-pill">{b.payment_status || 'Sin informar'}</span></td></tr>)}</tbody></table>{filtered.length===0 && <Empty text="No hay servicios para este mes."/>}</div>}</div>
      <DashboardCharts/>
    </> : tab==='income' ? <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Estado de resultados — vista preliminar</h3></div><div className="admin-recovered-metrics"><Metric label="Servicios registrados" value={money(bookingsValue)}/><Metric label="Cobrado (mes actual)" value={currentMonth ? money(stats?.revenue?.paid) : '—'}/><Metric label="Por cobrar (mes actual)" value={currentMonth ? money(stats?.revenue?.pending) : '—'}/></div><Notice title="No es un EERR contable" text="Un resultado financiero confiable requiere gastos, impuestos, remuneraciones y conciliación bancaria. La API disponible sólo entrega reservas y el resumen de cobros del mes actual; por eso no calculamos utilidades ficticias."/></div>
    : <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>{financeTabs.find(item=>item.id===tab)?.label}</h3><span className="admin-recovered-pill">Vista recuperada</span></div>
      {tab==='expenses' && <><div className="admin-recovered-metrics"><Metric label="Gastos contabilizados" value="—" note="Sin API de egresos"/><Metric label="Servicios del período" value={monthRows.length}/></div><Notice title="Gastos y rendiciones" text="El panel capturado incluye categorías, cargas y rendiciones de trabajadores. Este backend no tiene rutas para gastos ni comprobantes. La interfaz está disponible, pero no se pueden registrar ni aprobar gastos sin guardar los datos en el servidor."/></>}
      {tab==='tax' && <><div className="admin-recovered-metrics"><Metric label="IVA débito" value="—"/><Metric label="IVA crédito" value="—"/><Metric label="Movimientos bancarios" value="—"/></div><Notice title="IVA y banco" text="Sin documentos tributarios ni movimientos bancarios no es posible calcular IVA o conciliaciones reales. No derivamos esos valores de las reservas porque sería incorrecto."/></>}
      {tab==='workers' && <><div className="admin-recovered-metrics"><Metric label="Trabajadores con servicios" value="—"/><Metric label="Pagos por liquidar" value="—"/></div><Notice title="Pago a trabajadores" text="Faltan registros de asignación, tarifas por trabajador, abonos y estados de liquidación. El panel original dispone de ellos, pero la API de esta versión no. Consulta las reservas desde Trabajos mientras se conecta una fuente autorizada."/></>}
      {tab==='closing' && <><div className="admin-recovered-metrics"><Metric label="Reservas del período" value={monthRows.length}/><Metric label="Total de servicios registrados" value={money(bookingsValue)}/></div><Export onClick={download} label="Exportar servicios CSV"/><Notice title="Cierre de pagos no habilitado" text="Se puede exportar el detalle de reservas para conciliación manual. No cerramos períodos, pagamos personas ni enviamos correos porque esas operaciones carecen de backend en este proyecto."/></>}
    </div>}
  </div>
}

/* Editor de borradores local explícito. No publica ni modifica BD. */
export function PoliticasBorrador() {
  const [kind,setKind] = useState<'guarantee'|'terms'>('guarantee')
  const [text,setText] = useState('')
  const [status,setStatus] = useState('')
  useEffect(() => {
    try { setText(window.localStorage.getItem(`ym-admin-borrador-${kind}`) || '') }
    catch { setText('') }
    setStatus('')
  },[kind])
  const save = () => { try { window.localStorage.setItem(`ym-admin-borrador-${kind}`, text); setStatus('Borrador guardado sólo en este navegador.') } catch { setStatus('No fue posible guardar en este navegador.') } }
  const copy = async () => { try { await navigator.clipboard.writeText(text); setStatus('Texto copiado.') } catch { setStatus('No fue posible copiar.') } }
  return <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Políticas y términos</h3><span className="admin-recovered-pill">Borrador local</span></div><Tabs value={kind} onChange={value=>setKind(value as 'guarantee'|'terms')} label="Documento legal" options={[{id:'guarantee',label:'Políticas de garantía'},{id:'terms',label:'Términos y condiciones'}]}/>
    <Notice title="Editor de trabajo, no publicación" text="Los borradores se guardan exclusivamente en este navegador. No alteran la web pública, las políticas contractuales ni la base de datos."/>
    <label className="admin-recovered-label" htmlFor="admin-legal-draft">Texto del borrador</label><textarea id="admin-legal-draft" className="admin-recovered-textarea" value={text} onChange={e=>setText(e.target.value)} placeholder="Redactar el documento…" rows={12}/><div className="admin-recovered-actions"><button type="button" className="admin-recovered-outline" onClick={()=>void copy()}><Copy size={14}/> Copiar</button><button type="button" className="admin-recovered-primary" onClick={save}>Guardar borrador local</button></div>{status && <p className="admin-recovered-muted" role="status">{status}</p>}</div>
}
export function ReglaPagoBorrador() {
  const [base,setBase]=useState('')
  const [extra,setExtra]=useState('')
  const [status,setStatus]=useState('')
  const copy=async()=>{ try { await navigator.clipboard.writeText(`BORRADOR NO VIGENTE\nBase por servicio: ${base || 'Sin definir'}\nAdicional por hora: ${extra || 'Sin definir'}`);setStatus('Borrador copiado') } catch { setStatus('No fue posible copiar') } }
  return <div className="admin-recovered-card"><div className="admin-recovered-card-head"><h3>Pago a trabajadores</h3><span className="admin-recovered-pill">Simulador local</span></div><Notice title="Configuración no aplicada" text="La captura original contiene reglas de remuneración. Aquí sólo puedes preparar valores para una futura integración: ni tarifas ni pagos se guardan en el servidor."/>
    <div className="admin-recovered-input-grid"><label className="admin-recovered-label">Base por servicio ($)<input type="number" min="0" value={base} onChange={e=>setBase(e.target.value)} placeholder="Monto en CLP"/></label><label className="admin-recovered-label">Adicional por hora ($)<input type="number" min="0" value={extra} onChange={e=>setExtra(e.target.value)} placeholder="Monto en CLP"/></label></div><div className="admin-recovered-actions"><button className="admin-recovered-outline" type="button" onClick={()=>void copy()}><Copy size={14}/> Copiar borrador</button></div>{status && <p role="status" className="admin-recovered-muted">{status}</p>}</div>
}
