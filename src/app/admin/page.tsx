'use client'

import PeriodFilter from '@/components/admin/PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import type { AdminJob, AdminJobsData } from '@/lib/adminJobsTypes'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import dynamic from 'next/dynamic'
import { buildWhatsAppLink, bookingFollowUpMessage } from '@/lib/whatsapp'
import QuickRescheduleModal from '@/components/admin/QuickRescheduleModal'

// Cada pestaña baja su código recién cuando se abre. Antes iban todas en un solo paquete
// (460 kB de JavaScript en la primera carga, medido el 24-sep-2026) aunque se usara una:
// el cotizador interno completo, los gráficos, Reservas con sus 3.000 líneas…
function CargandoPestana() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
    </div>
  )
}
const AiConversations = dynamic(() => import('@/components/admin/AiConversations'), { loading: CargandoPestana, ssr: false })
const BookingsManagement = dynamic(() => import('@/components/admin/BookingsManagement'), { loading: CargandoPestana, ssr: false })
const CalendarView = dynamic(() => import('@/components/admin/CalendarView'), { loading: CargandoPestana, ssr: false })
const FleetManagement = dynamic(() => import('@/components/admin/FleetManagement'), { loading: CargandoPestana, ssr: false })
const ScheduleManagement = dynamic(() => import('@/components/admin/ScheduleManagement'), { loading: CargandoPestana, ssr: false })
const PricingConfiguration = dynamic(() => import('@/components/admin/PricingConfiguration'), { loading: CargandoPestana, ssr: false })
const ScheduleConfiguration = dynamic(() => import('@/components/admin/ScheduleConfiguration'), { loading: CargandoPestana, ssr: false })
const ItemsManagement = dynamic(() => import('@/components/admin/ItemsManagement'), { loading: CargandoPestana, ssr: false })
const ProspectsManagement = dynamic(() => import('@/components/admin/ProspectsManagement'), { loading: CargandoPestana, ssr: false })
const AdminQuoteBuilder = dynamic(() => import('@/components/admin/AdminQuoteBuilder'), { loading: CargandoPestana, ssr: false })
const AttendedCustomers = dynamic(() => import('@/components/admin/AttendedCustomers'), { loading: CargandoPestana, ssr: false })
const CompaniesManagement = dynamic(() => import('@/components/admin/CompaniesManagement'), { loading: CargandoPestana, ssr: false })
const WorkersCard = dynamic(() => import('@/components/admin/WorkersCard'), { loading: CargandoPestana, ssr: false })
const ApprovalsInbox = dynamic(() => import('@/components/admin/ApprovalsInbox'), { loading: CargandoPestana, ssr: false })
const MarketingPanel = dynamic(() => import('@/components/admin/MarketingPanel'), { loading: CargandoPestana, ssr: false })
import AdminSidebar from '@/components/admin/AdminSidebar'
import GlobalSearch from '@/components/admin/GlobalSearch'
import { ADMIN_MODULES, type AdminActionId, type AdminModuleId } from '@/lib/adminModules'
import { canDoAction, canSeeModule, canSeeSection, type AdminAccess } from '@/lib/adminAccess'
const ProfilesManagement = dynamic(() => import('@/components/admin/ProfilesManagement'), { loading: CargandoPestana, ssr: false })
const FinancePanel = dynamic(() => import('@/components/admin/FinancePanel'), { loading: CargandoPestana, ssr: false })
const WorkerExpensesInbox = dynamic(() => import('@/components/admin/WorkerExpensesInbox'), { ssr: false })
const WorkerSignupInbox = dynamic(() => import('@/components/admin/WorkerSignupInbox'), { ssr: false })
const WorkerPayConfiguration = dynamic(() => import('@/components/admin/WorkerPayConfiguration'), { loading: CargandoPestana, ssr: false })
const LegalConfiguration = dynamic(() => import('@/components/admin/LegalConfiguration'), { loading: CargandoPestana, ssr: false })
const JobsPanel = dynamic(() => import('@/components/admin/JobsPanel'), { loading: CargandoPestana, ssr: false })
const InvoicingPanel = dynamic(() => import('@/components/admin/InvoicingPanel'), { loading: CargandoPestana, ssr: false })
const FleetOdometerCard = dynamic(() => import('@/components/admin/FleetOdometerCard'), { loading: CargandoPestana, ssr: false })
const DriverAccessCard = dynamic(() => import('@/components/admin/DriverAccessCard'), { loading: CargandoPestana, ssr: false })
const ChangePasswordModal = dynamic(() => import('@/components/admin/ChangePasswordModal'), { ssr: false })
const ActivityLog = dynamic(() => import('@/components/admin/ActivityLog'), { loading: CargandoPestana, ssr: false })
const UsersManagement = dynamic(() => import('@/components/admin/UsersManagement'), { loading: CargandoPestana, ssr: false })
import {
  Calendar,
  CalendarDays,
  Truck,
  Clock, 
  BarChart3, 
  Settings, 
  Users, 
  DollarSign,
  AlertCircle,
  CheckCircle,
  XCircle,
  TrendingUp,
  LogOut,
  KeyRound,
  History,
  ShieldCheck,
  FileText,
  Package,
  UserPlus,
  FilePlus,
  Building2,
  Inbox
} from 'lucide-react'
import type { ServiceRequestView } from '@/lib/serviceRequestTypes'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'

interface DashboardStats {
  todayBookings: number
  monthlyRevenue: number
  pendingBookings: number
  totalVehicles: number
  occupancyRate: number
  averageTicket: number
  revenue?: {
    paid: number
    paidCount: number
    paidByChannel: { flow: number; transfer: number; cash: number; otro: number }
    pending: number
    pendingCount: number
    booked: number
    byOrigin?: Array<{
      source: string
      label: string
      paid: number
      paidCount: number
      pending: number
      pendingCount: number
      booked: number
    }>
  }
  outstandingQuotes?: { total: number; count: number }
}

interface TodayBooking {
  id: string
  quote_id?: string
  client_name: string
  client_phone: string
  scheduled_date: string
  scheduled_time: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled'
  estimated_price: number | null
  client_email?: string | null
  /** Horas estimadas del servicio. */
  duration_hours?: number | null
  /** Volumen a mover. Sale de la cotización, no de la reserva. */
  volume_m3?: number | null
  /** Resumen de embalaje ya contado por tipo, p. ej. "3x caja, 2x film". */
  packaging_summary?: string | null
  origin_address?: string | null
  destination_address?: string | null
  visit_address?: string | null
  /** Personas que pide el trabajo según la cotización. */
  people_needed?: number | null
  /** Lo que falta cobrar. Misma función que las tarjetas de Ingresos. */
  pending_amount?: number | null
  /** Camión asignado, con el color con el que lo ven los choferes. */
  vehicle?: {
    id: number
    name: string
    driver?: string
    color: { hex: string; soft: string; ink: string }
  } | null
}

export default function AdminDashboard() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('dashboard')
  // Búsqueda inicial para la pestaña Reservas (viene por ?q= al abrir desde el dashboard).
  const [bookingsSearch, setBookingsSearch] = useState('')
  // Cambia con cada reserva elegida en el buscador general: vuelve a montar Reservas con
  // esa búsqueda aunque ya se esté en la pestaña.
  const [bookingsSearchNonce, setBookingsSearchNonce] = useState(0)
  // Reserva que Reservas abre directo en «Editar» (viene por ?edit= desde el pop-up).
  const [bookingsEditId, setBookingsEditId] = useState<string | null>(null)
  // Solicitud del panel del cliente que se está aprobando: Reservas abre «Nueva reserva»
  // con sus datos.
  const [approvingRequest, setApprovingRequest] = useState<ServiceRequestView | null>(null)
  // Solicitudes y modificaciones en terreno pendientes, para el globo de «Por aprobar».
  const [pendingRequests, setPendingRequests] = useState(0)
  // Gastos de trabajadores por aprobar: se suman al mismo globo.
  const [pendingExpenses, setPendingExpenses] = useState(0)
  // Trabajadores registrados por el link que esperan aprobación: al mismo globo.
  const [pendingSignups, setPendingSignups] = useState(0)
  useEffect(() => {
    Promise.all(
      ['/api/admin/service-requests', '/api/admin/modifications'].map((url) =>
        fetch(url)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
      )
    ).then((results) => setPendingRequests(results.reduce((sum, d) => sum + (Number(d?.pending) || 0), 0)))
    fetch('/api/admin/expenses')
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setPendingExpenses(Number(d?.pending) || 0))
      .catch(() => {})
    fetch('/api/admin/workers/pending')
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setPendingSignups(Array.isArray(d?.pending) ? d.pending.length : 0))
      .catch(() => {})
    // Se vuelve a contar al cambiar de pestaña: aprobar una solicitud termina en Reservas.
  }, [activeTab])
  // Reserva del Dashboard abierta en el pop-up de «Cambiar fecha y hora».
  const [quickBooking, setQuickBooking] = useState<TodayBooking | null>(null)
  const [bookingsRange, setBookingsRange] = useState<{ desde: string; hasta: string } | null>(null)
  const [currentUser, setCurrentUser] = useState<{
    username: string
    displayName: string
    mustChangePassword: boolean
    canChangePassword: boolean
    role: 'administrator' | 'staff'
    /** Módulos y acciones de su perfil. Sin esto (respuesta antigua) se muestra todo. */
    access?: AdminAccess
  } | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState('pricing')
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [todayBookings, setTodayBookings] = useState<TodayBooking[]>([])
  /** Flota activa, para el selector de camión de cada fila. */
  const [fleet, setFleet] = useState<Array<{ id: number; name: string; status?: string }>>([])
  /** id de la reserva sobre la que hay una acción en curso. */
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [tomorrowBookings, setTomorrowBookings] = useState<TodayBooking[]>([])
  const [weekBookings, setWeekBookings] = useState<TodayBooking[]>([])
  // Trabajadores y cuadrillas de los próximos días (panel Trabajos), para asignar desde Inicio.
  const [jobsData, setJobsData] = useState<AdminJobsData | null>(null)
  const [crewOpenId, setCrewOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
    fetchCurrentUser()
  }, [])

  // Quién está en sesión. Si arrastra una contraseña temporal, el cambio es obligatorio.
  const fetchCurrentUser = async () => {
    try {
      const res = await fetch('/api/admin/auth/me')
      if (!res.ok) return
      const data = await res.json()
      setCurrentUser(data)
      if (data?.mustChangePassword) setShowChangePassword(true)
    } catch (error) {
      console.error('Error obteniendo el usuario en sesión:', error)
    }
  }

  // Permite entrar directo a una pestaña con un filtro ya aplicado:
  // /admin?tab=bookings&q=<quote_id>. Se usa al hacer click en una reserva del dashboard.
  // Leemos window.location en vez de useSearchParams para no necesitar un <Suspense>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    const q = params.get('q')
    // Rango de fechas: lo usa el clic en una barra del gráfico mensual para abrir las
    // reservas de ese mes.
    const desde = params.get('desde')
    const hasta = params.get('hasta')
    if (tab && tabs.some((t) => t.id === tab)) setActiveTab(tab)
    if (q) setBookingsSearch(q)
    const edit = params.get('edit')
    if (edit) setBookingsEditId(edit)
    if (desde && hasta) setBookingsRange({ desde, hasta })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/admin/auth/logout', {
        method: 'POST'
      })

      if (response.ok) {
        toast.success('Sesión cerrada correctamente')
        router.push('/admin/login')
      } else {
        toast.error('Error al cerrar sesión')
      }
    } catch (error) {
      console.error('Error logging out:', error)
      toast.error('Error al cerrar sesión')
    }
  }

  // Período del resumen de Inicio. El control y sus reglas son los mismos de todo el panel
  // (PeriodFilter / lib/period). Filtra por la fecha del servicio.
  const [period, setPeriod] = useState<Period>(periodOf('month'))
  const periodPreset = period.preset
  const range = (() => {
    const resolved = resolvePeriod(period)
    // El resumen necesita las dos puntas: con un rango a medio escribir se queda en el mes.
    if (resolved.from && resolved.to) return { from: resolved.from, to: resolved.to, label: resolved.label }
    const month = resolvePeriod(periodOf('month'))
    return { from: month.from as string, to: month.to as string, label: month.label }
  })()

  // Al cambiar de período se vuelve a pedir el resumen (la primera carga la hace el
  // efecto de arriba).
  const firstRange = useRef(true)
  useEffect(() => {
    if (firstRange.current) {
      firstRange.current = false
      return
    }
    fetchDashboardData({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to])

  const fetchDashboardData = async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setLoading(true)
      
      // Los tres pedidos salen a la vez: antes el de reservas esperaba a que terminara
      // el resumen, y el Dashboard mostraba el cargando la suma de los dos.
      fetch('/api/admin/fleet-config')
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => {
          const vs = Array.isArray(cfg?.vehicles) ? cfg.vehicles : []
          setFleet(vs.filter((v: any) => v?.status !== 'maintenance'))
        })
        .catch(() => setFleet([]))

      // Trae reservas de hoy hasta 6 días adelante y las separa en Hoy / Mañana / Esta semana
      const [statsData, bookingsData] = await Promise.all([
        fetch(`/api/admin/stats?desde=${range.from}&hasta=${range.to}`).then((r) => r.json()),
        fetch('/api/admin/today-bookings').then((r) => r.json()) as Promise<TodayBooking[]>,
      ])
      setStats(statsData)

      const todayStr = format(new Date(), 'yyyy-MM-dd')
      const tomorrowDate = new Date()
      tomorrowDate.setDate(tomorrowDate.getDate() + 1)
      const tomorrowStr = format(tomorrowDate, 'yyyy-MM-dd')

      setTodayBookings(bookingsData.filter((b) => b.scheduled_date === todayStr))
      setTomorrowBookings(bookingsData.filter((b) => b.scheduled_date === tomorrowStr))
      setWeekBookings(bookingsData.filter((b) => b.scheduled_date > tomorrowStr))

      // Cuadrilla de cada trabajo y lista de trabajadores, para asignar desde la fila. Sale
      // del panel Trabajos; si el perfil no lo tiene, Inicio queda sin esa parte.
      fetch('/api/admin/jobs')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: AdminJobsData | null) => setJobsData(d))
        .catch(() => setJobsData(null))

    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Los módulos del menú viven en el registro único (src/lib/adminModules.ts).
  const tabs = ADMIN_MODULES

  // Permisos del perfil del usuario. Esto solo decide qué se MUESTRA; el que manda es el
  // servidor, que rechaza las llamadas de un módulo apagado.
  const access = currentUser?.access
  const sees = (id: AdminModuleId) => !access || canSeeModule(access, id)
  const can = (id: AdminActionId) => (access ? canDoAction(access, id) : currentUser?.role === 'administrator')
  /** ¿Ve este subpanel de un módulo? Mientras el perfil no carga, sí. */
  const seesSection = (moduleId: AdminModuleId, section: string) => !access || canSeeSection(access, `${moduleId}.${section}`)

  // Si la pestaña abierta es de un módulo que el perfil no tiene (llegó por ?tab= o le
  // cambiaron el perfil), se vuelve a Inicio.
  useEffect(() => {
    if (access && ADMIN_MODULES.some((m) => m.id === activeTab) && !canSeeModule(access, activeTab as AdminModuleId)) {
      setActiveTab('dashboard')
    }
  }, [access, activeTab])

  const settingsTabs = [
    ...[
      { id: 'pricing', name: 'Precios', icon: DollarSign },
      { id: 'schedule-config', name: 'Horarios', icon: Clock },
      { id: 'inventory', name: 'Inventario', icon: Package },
      { id: 'worker-pay', name: 'Pago a trabajadores', icon: Users },
      { id: 'legal', name: 'Políticas y términos', icon: FileText },
    ].filter((tab) => seesSection('settings', tab.id)),
    ...(can('users.manage')
      ? [
          { id: 'users', name: 'Usuarios y permisos', icon: ShieldCheck },
        ]
      : []),
  ]

  // Si la pestaña elegida no está permitida para el perfil, se muestra la primera que sí.
  const settingsTab = settingsTabs.some((tab) => tab.id === activeSettingsTab) ? activeSettingsTab : settingsTabs[0]?.id

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-green-600 bg-green-50'
      case 'pending': return 'text-yellow-600 bg-yellow-50'
      case 'completed': return 'text-blue-600 bg-blue-50'
      case 'cancelled': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  // Agrupa una lista (ya viene ordenada por fecha/hora desde la API) por scheduled_date,
  // para mostrar un encabezado de día en el bloque "Esta Semana".
  const groupByDate = (bookings: TodayBooking[]) => {
    const groups: Array<{ date: string; items: TodayBooking[] }> = []
    bookings.forEach((b) => {
      const last = groups[groups.length - 1]
      if (last && last.date === b.scheduled_date) {
        last.items.push(b)
      } else {
        groups.push({ date: b.scheduled_date, items: [b] })
      }
    })
    return groups
  }

  const formatDateLabel = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    return format(new Date(y, m - 1, d), "EEEE d 'de' MMMM", { locale: es })
  }

  // «Editar todo lo demás» del pop-up: abre la reserva en una pestaña nueva, ya filtrada
  // en Reservas y con su edición completa abierta. La pestaña nueva es a propósito: el
  // Dashboard queda donde estaba.
  const openBookingInNewTab = (booking: TodayBooking) => {
    const term = booking.quote_id || booking.client_name
    const url = `/admin?tab=bookings&q=${encodeURIComponent(term)}&edit=${encodeURIComponent(booking.id)}`
    window.open(url, '_blank', 'noopener')
  }


  /** Cambia el camión sin salir del dashboard. Misma ruta que usa Reservas. */
  /** Deja la cuadrilla de un trabajo en `workerIds` (mismo camino que el panel Trabajos: avisa al trabajador). */
  const cambiarCuadrilla = async (job: AdminJob, workerIds: string[]) => {
    setRowBusy(job.id)
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar la asignación')
      setJobsData((prev) => prev && { ...prev, jobs: prev.jobs.map((j) => (j.id === job.id ? { ...j, crew: body.crew || workerIds } : j)) })
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo guardar la asignación')
    } finally {
      setRowBusy(null)
    }
  }

  const cambiarCamion = async (booking: TodayBooking, vehicleId: number | null) => {
    setRowBusy(booking.id)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || 'No se pudo cambiar el camión')
      }
      // El cambio no se valida (decisión de Tomás, 16-sep-2026), pero se avisa si el camión
      // elegido ya tenía otro trabajo que se pisa con este.
      if (vehicleId !== null && booking.scheduled_date && booking.scheduled_time) {
        const params = new URLSearchParams({
          date: booking.scheduled_date,
          time: String(booking.scheduled_time).slice(0, 5),
          duration: String(Number(booking.duration_hours) || 4),
          excludeId: booking.id,
        })
        const disp = await fetch(`/api/admin/fleet-availability?${params}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        const camion = disp?.vehicles?.find((v: any) => v.id === vehicleId)
        if (camion && !camion.available) {
          alert(
            `Atención: ${camion.name} ya tiene otro trabajo que se pisa con este (${camion.overlapping
              .map((o: any) => `${o.from}–${o.to}`)
              .join(', ')}). El cambio quedó guardado igual.`
          )
        }
      }
      await fetchDashboardData()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo cambiar el camión')
    } finally {
      setRowBusy(null)
    }
  }

  /** Link de Flow por el saldo. El monto lo calcula el servidor, no esta pantalla. */
  const linkDeSaldo = async (booking: TodayBooking) => {
    setRowBusy(booking.id)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/payment-link`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) throw new Error(data?.error || 'No se pudo generar el link')
      await navigator.clipboard.writeText(data.url).catch(() => {})
      alert(`Link por $${Number(data.amount).toLocaleString('es-CL')} copiado al portapapeles.`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo generar el link')
    } finally {
      setRowBusy(null)
    }
  }

  const renderBookingRow = (booking: TodayBooking) => (
    <div
      key={booking.id}
      onClick={() => setQuickBooking(booking)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setQuickBooking(booking)
        }
      }}
      role="button"
      tabIndex={0}
      title="Cambiar fecha y hora (para lo demás, «Editar todo lo demás»)"
      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer transition-colors hover:bg-gray-100 hover:ring-1 hover:ring-secondary-300 focus:outline-none focus:ring-2 focus:ring-secondary-400"
    >
      <div className="flex items-center gap-4">
        <div className={`p-2 rounded-full ${getStatusColor(booking.status)}`}>
          {getStatusIcon(booking.status)}
        </div>
        <div>
          <p className="font-semibold text-gray-900">
            {booking.client_name}
          </p>
          <p className="text-sm text-gray-600">
            {booking.client_phone} • {booking.scheduled_time?.slice(0, 5)}
          </p>
          {booking.vehicle && (
            <span
              className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: booking.vehicle.color.soft,
                color: booking.vehicle.color.ink,
              }}
              title={booking.vehicle.driver ? `Chofer: ${booking.vehicle.driver}` : undefined}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: booking.vehicle.color.hex }}
                aria-hidden
              />
              {booking.vehicle.name}
            </span>
          )}

          {/* Direcciones del trabajo. */}
          {(booking.visit_address || booking.origin_address || booking.destination_address) && (
            <p className="mt-1 max-w-xl text-xs text-gray-600">
              {booking.visit_address
                ? booking.visit_address
                : [booking.origin_address, booking.destination_address].filter(Boolean).join(' → ')}
            </p>
          )}

          {/* Quiénes van: los del camión habitual más los puestos a mano. */}
          {(() => {
            const job = jobsData?.jobs.find((j) => j.id === booking.id)
            if (!jobsData || !job) {
              return booking.people_needed ? (
                <p className="mt-1 text-xs text-gray-600">{booking.people_needed} personas según la cotización</p>
              ) : null
            }
            const habitual = jobsData.workers.filter((w) => w.active && w.vehicle_id !== null && w.vehicle_id === job.vehicleId)
            const habitualIds = new Set(habitual.map((w) => w.id))
            const extra = jobsData.workers.filter((w) => job.crew.includes(w.id) && !habitualIds.has(w.id))
            const team = [...habitual, ...extra]
            const open = crewOpenId === booking.id
            return (
              <div className="mt-1 text-xs" onClick={(e) => e.stopPropagation()}>
                <p className={team.length === 0 ? 'font-semibold text-amber-700' : 'text-gray-700'}>
                  {team.length === 0 ? 'Nadie asignado' : `${team.length} asignado${team.length === 1 ? '' : 's'}: ${team.map((w) => w.name).join(', ')}`}
                  {booking.people_needed ? <span className="font-normal text-gray-500"> · pide {booking.people_needed} personas</span> : null}
                  <button
                    type="button"
                    onClick={() => setCrewOpenId(open ? null : booking.id)}
                    className="ml-2 font-semibold text-primary-600 hover:underline"
                  >
                    {open ? 'Listo' : 'Asignar chofer y equipo'}
                  </button>
                </p>
                {open && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {jobsData.workers.length === 0 && <span className="text-gray-500">No hay trabajadores creados (Flota y equipo).</span>}
                    {jobsData.workers.map((w) => {
                      const byTruck = habitualIds.has(w.id)
                      const on = byTruck || job.crew.includes(w.id)
                      return (
                        <button
                          key={w.id}
                          type="button"
                          disabled={rowBusy === booking.id || byTruck}
                          title={byTruck ? 'Va por su camión habitual' : undefined}
                          onClick={() => void cambiarCuadrilla(job, job.crew.includes(w.id) ? job.crew.filter((id) => id !== w.id) : [...job.crew, w.id])}
                          className={`rounded-full border px-2.5 py-1 font-medium disabled:cursor-default ${
                            on ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-primary-400'
                          } ${byTruck ? 'opacity-80' : ''}`}
                        >
                          {w.name}
                          {byTruck ? ' · por camión' : ''}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Datos operativos que antes obligaban a abrir Reservas. */}
          {(booking.volume_m3 || booking.duration_hours || booking.packaging_summary) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              {booking.volume_m3 ? <span>{booking.volume_m3.toFixed(1)} m³</span> : null}
              {booking.duration_hours ? <span>{booking.duration_hours} h estimadas</span> : null}
              {booking.packaging_summary ? (
                <span>Embalaje: {booking.packaging_summary}</span>
              ) : null}
            </div>
          )}

          {/* Acciones directas. `stopPropagation` en todas: la fila entera es un botón
              que abre Reservas, y sin esto cualquier acción abriría además esa pestaña. */}
          <div
            className="mt-2 flex flex-wrap items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              // Mismo mensaje y mismas reglas de teléfono que el botón de Reservas: antes
              // este link iba sin `?text=`, así que desde el Dashboard el mensaje no salía.
              const waLink = buildWhatsAppLink(booking.client_phone, bookingFollowUpMessage(booking))
              if (!waLink) return null
              return (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-green-300 px-2 py-1 text-[11px] font-medium text-green-700 hover:bg-green-50"
                >
                  WhatsApp
                </a>
              )
            })()}
            {booking.client_email && (
              <a
                href={`mailto:${booking.client_email}`}
                className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
              >
                Email
              </a>
            )}
            {(booking.pending_amount || 0) > 0 && (
              <button
                type="button"
                disabled={rowBusy === booking.id}
                onClick={() => void linkDeSaldo(booking)}
                className="rounded-md border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                Link por ${Number(booking.pending_amount).toLocaleString('es-CL')}
              </button>
            )}
            {fleet.length > 0 && (
              <select
                value={booking.vehicle?.id ?? ''}
                disabled={rowBusy === booking.id}
                onChange={(e) =>
                  void cambiarCamion(booking, e.target.value === '' ? null : Number(e.target.value))
                }
                className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 disabled:opacity-50"
              >
                <option value="">Sin asignar</option>
                {fleet.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
      <div className="text-right">
        <p className="font-semibold text-gray-900">
          {booking.estimated_price ? `$${booking.estimated_price.toLocaleString()}` : 'N/A'}
        </p>
        <p className={`text-xs font-medium capitalize ${getStatusColor(booking.status)}`}>
          {booking.status}
        </p>
      </div>
    </div>
  )

  const renderBookingSection = (title: string, bookings: TodayBooking[], emptyText: string) => (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">
          {title} {bookings.length > 0 && <span className="text-gray-400 font-normal">({bookings.length})</span>}
        </h3>
        <Button onClick={() => setActiveTab('bookings')} variant="outline" size="sm">
          Ver Todas
        </Button>
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-8">
          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">{emptyText}</p>
        </div>
      ) : (
        <div className="space-y-3">{bookings.map(renderBookingRow)}</div>
      )}
    </Card>
  )

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="w-4 h-4" />
      case 'pending': return <Clock className="w-4 h-4" />
      case 'completed': return <CheckCircle className="w-4 h-4" />
      case 'cancelled': return <XCircle className="w-4 h-4" />
      default: return <AlertCircle className="w-4 h-4" />
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando panel de administración...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="theme-panel min-h-screen bg-slate-50 lg:flex">
      <AdminSidebar
        active={activeTab}
        onSelect={setActiveTab}
        badges={{ approvals: pendingRequests + pendingExpenses + pendingSignups }}
        visible={sees}
        userName={currentUser?.displayName || currentUser?.username || 'Administración'}
        userRole={access?.profileName || (currentUser?.role === 'administrator' ? 'Administrador' : 'Secretaría')}
        canChangePassword={Boolean(currentUser?.canChangePassword)}
        onChangePassword={() => setShowChangePassword(true)}
        onLogout={handleLogout}
        search={
          <GlobalSearch
            onPick={(hit) => {
              if (!sees(hit.tab)) return
              if (hit.tab === 'bookings' && hit.bookingSearch) {
                setBookingsSearch(hit.bookingSearch)
                setBookingsSearchNonce((n) => n + 1)
              }
              setActiveTab(hit.tab)
            }}
          />
        }
      />

      <div className="min-w-0 flex-1">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Inicio</h2>
                <p className="text-gray-600">Lo de hoy y lo pendiente. La ocupación es de {range.label}.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PeriodFilter value={period} onChange={setPeriod} presets={['day', 'tomorrow', 'week', 'month', 'custom']} />
                <Button onClick={() => fetchDashboardData()} variant="outline" size="sm">
                  Actualizar
                </Button>
              </div>
            </div>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Reservas Hoy</p>
                    <p className="text-3xl font-archivo font-extrabold text-gray-900">
                      {stats?.todayBookings || 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-full bg-primary-50">
                    <Calendar className="w-6 h-6 text-primary-600" />
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Pendientes</p>
                    <p className="text-3xl font-archivo font-extrabold text-gray-900">
                      {stats?.pendingBookings || 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-full bg-yellow-50">
                    <AlertCircle className="w-6 h-6 text-yellow-600" />
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-xs text-yellow-600 font-semibold">
                    Requieren atención
                  </span>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Ocupación</p>
                    <p className="text-3xl font-archivo font-extrabold text-gray-900">
                      {stats?.occupancyRate || 0}%
                    </p>
                  </div>
                  <div className="p-3 rounded-full bg-blue-50">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-xs text-blue-600 font-semibold">
                    Promedio diario
                  </span>
                </div>
              </Card>
            </div>

            {/* Los montos (ingresos, por cobrar, cotizado, gráfico mensual) viven en Finanzas:
                Inicio es operación del día, sin plata. */}

            {/* Con el filtro en «Hoy» o «Mañana» se ve solo ese día; con los demás, todo. */}
            {/* Reservas de Hoy */}
            {periodPreset !== 'tomorrow' &&
              renderBookingSection(
                `Reservas de Hoy (${format(new Date(), 'dd/MM/yyyy', { locale: es })})`,
                todayBookings,
                'No hay reservas para hoy'
              )}

            {/* Reservas de Mañana */}
            {periodPreset !== 'day' && renderBookingSection('Reservas de Mañana', tomorrowBookings, 'No hay reservas para mañana')}

            {/* Resto de la semana, agrupado por día para más claridad */}
            {periodPreset !== 'day' && periodPreset !== 'tomorrow' && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">
                  Esta Semana {weekBookings.length > 0 && <span className="text-gray-400 font-normal">({weekBookings.length})</span>}
                </h3>
                <Button onClick={() => setActiveTab('bookings')} variant="outline" size="sm">
                  Ver Todas
                </Button>
              </div>

              {weekBookings.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No hay más reservas el resto de la semana</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {groupByDate(weekBookings).map((group) => (
                    <div key={group.date}>
                      <p className="text-sm font-semibold text-gray-500 capitalize mb-2">
                        {formatDateLabel(group.date)}
                      </p>
                      <div className="space-y-3">{group.items.map(renderBookingRow)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            )}

            {/* Quick Actions */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Acciones Rápidas
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Button
                  onClick={() => setActiveTab('schedule')}
                  className="h-16 flex-col gap-2"
                  variant="outline"
                >
                  <Clock className="w-6 h-6" />
                  Bloquear Horario
                </Button>
                <Button
                  onClick={() => setActiveTab('fleet')}
                  className="h-16 flex-col gap-2"
                  variant="outline"
                >
                  <Truck className="w-6 h-6" />
                  Configurar Flota
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && <CalendarView />}

        {/* Bookings Tab */}
        {activeTab === 'bookings' && (
          <BookingsManagement
            key={`bookings-${bookingsSearchNonce}`}
            initialSearch={bookingsSearch}
            initialDateRange={bookingsRange}
            initialEditId={bookingsEditId}
            approvingRequest={approvingRequest}
            onRequestHandled={() => setApprovingRequest(null)}
            // Todos los perfiles reajustan montos (28-sep-2026); queda en Actividad.
            canAdjustAmounts
          />
        )}

        {/* Prospects Tab */}
        {activeTab === 'approvals' && (
          // Las secciones con algo pendiente van arriba; las que no tienen nada, al final.
          <div className="flex flex-col">
          <div style={{ order: pendingRequests > 0 ? 0 : 1 }}>
          <ApprovalsInbox
            onPendingCount={setPendingRequests}
            onApprove={(request) => {
              setApprovingRequest(request)
              setActiveTab('bookings')
            }}
            onOpenBooking={(quoteId) => {
              setBookingsSearch(quoteId)
              setActiveTab('bookings')
            }}
          />
          </div>
          {seesSection('approvals', 'workers') && (
            <div className="mt-6" style={{ order: pendingSignups > 0 ? 0 : 1 }}>
              <WorkerSignupInbox onPendingCount={setPendingSignups} />
            </div>
          )}
          {seesSection('approvals', 'expenses') && (
          <div style={{ order: pendingExpenses > 0 ? 0 : 1 }}>
          <WorkerExpensesInbox
            onPendingCount={setPendingExpenses}
            onOpenBooking={(quoteId) => {
              setBookingsSearch(quoteId)
              setActiveTab('bookings')
            }}
          />
          </div>
          )}
          </div>
        )}

        {activeTab === 'prospects' && <ProspectsManagement onEditQuote={sees('new-quote') ? () => setActiveTab('new-quote') : undefined} />}

        {activeTab === 'marketing' && <MarketingPanel allowed={(section) => seesSection('marketing', section)} />}

        {activeTab === 'new-quote' && (
          <AdminQuoteBuilder onGoToProspects={() => setActiveTab('prospects')} />
        )}

        {activeTab === 'customers' && (
          <AttendedCustomers
            onOpenBooking={(quoteId) => {
              setBookingsSearch(quoteId)
              setActiveTab('bookings')
            }}
          />
        )}

        {activeTab === 'companies' && <CompaniesManagement />}

        {activeTab === 'finance' && (
          <FinancePanel
            allowed={(section) => seesSection('finance', section)}
            onSeeLeads={() => setActiveTab('prospects')}
            onOpenBooking={(quoteId) => {
              setBookingsSearch(quoteId)
              setActiveTab('bookings')
            }}
          />
        )}

        {activeTab === 'jobs' && (
          <JobsPanel
            allowed={(section) => seesSection('jobs', section)}
            onOpenBooking={(quoteId) => {
              setBookingsSearch(quoteId)
              setActiveTab('bookings')
            }}
          />
        )}

        {activeTab === 'invoicing' && <InvoicingPanel />}

        {activeTab === 'activity' && <ActivityLog />}

        {activeTab === 'ai-conversations' && <AiConversations />}

        {/* Fleet Tab */}
        {activeTab === 'fleet' && (
          <div className="space-y-6">
            <DriverAccessCard />
            <WorkersCard />
            <FleetManagement />
            <FleetOdometerCard />
          </div>
        )}

        {/* Schedule Tab */}
        {activeTab === 'schedule' && <ScheduleManagement />}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            {/* Settings Sub-tabs */}
            <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSettingsTab(tab.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${settingsTab === tab.id
                      ? 'bg-white text-primary-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                    }
                  `}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.name}
                </button>
              ))}
            </div>

            {/* Settings Content */}
            {settingsTab === 'pricing' && <PricingConfiguration canEdit={can('pricing.edit')} />}
            {settingsTab === 'schedule-config' && <ScheduleConfiguration />}
            {settingsTab === 'inventory' && <ItemsManagement canAdjust={can('inventory.adjust')} />}
            {settingsTab === 'worker-pay' && <WorkerPayConfiguration />}
            {settingsTab === 'legal' && <LegalConfiguration />}
            {settingsTab === 'users' && can('users.manage') && (
              <div className="space-y-10">
                <UsersManagement />
                {/* Qué ve y qué puede hacer cada perfil (Secretaría, etc.). */}
                <ProfilesManagement />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center mt-12 py-6 border-t border-gray-200">
        <p className="text-xs text-gray-400">
          ©2025 - Crafted by{' '}
          <a 
            href="https://vanlookstudio.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
          >
            vanlookstudio.com
          </a>
        </p>
      </div>
      </div>

      {/* Cambio rápido de fecha y hora desde el Dashboard. */}
      <QuickRescheduleModal
        booking={quickBooking ? { ...quickBooking, vehicle_id: quickBooking.vehicle?.id ?? null } : null}
        onClose={() => setQuickBooking(null)}
        onSaved={() => {
          setQuickBooking(null)
          // La reserva puede haber cambiado de día (Hoy / Mañana / Esta semana) y de camión.
          fetchDashboardData({ silent: true })
        }}
        onOpenFullEdit={() => {
          const booking = quickBooking
          setQuickBooking(null)
          if (booking) openBookingInNewTab(booking)
        }}
      />

      <ChangePasswordModal
        isOpen={showChangePassword}
        required={Boolean(currentUser?.mustChangePassword)}
        onClose={() => setShowChangePassword(false)}
        onChanged={() => {
          setShowChangePassword(false)
          fetchCurrentUser()
        }}
      />
    </div>
  )
}
