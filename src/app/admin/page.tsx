'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import BookingsManagement from '@/components/admin/BookingsManagement'
import FleetManagement from '@/components/admin/FleetManagement'
import ScheduleManagement from '@/components/admin/ScheduleManagement'
import PricingConfiguration from '@/components/admin/PricingConfiguration'
import ScheduleConfiguration from '@/components/admin/ScheduleConfiguration'
import ItemsManagement from '@/components/admin/ItemsManagement'
import ProspectsManagement from '@/components/admin/ProspectsManagement'
import DashboardCharts from '@/components/admin/DashboardCharts'
import AttendedCustomers from '@/components/admin/AttendedCustomers'
import DriverAccessCard from '@/components/admin/DriverAccessCard'
import ChangePasswordModal from '@/components/admin/ChangePasswordModal'
import ActivityLog from '@/components/admin/ActivityLog'
import UsersManagement from '@/components/admin/UsersManagement'
import AiConversations from '@/components/admin/AiConversations'
import AdminShell from '@/components/admin/AdminShell'
import AgendaSemanal from '@/components/admin/AgendaSemanal'
import { 
  Calendar, 
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
  TrendingDown,
  LogOut,
  KeyRound,
  History,
  ShieldCheck,
  Package,
  UserPlus,
  MessageSquareText
} from 'lucide-react'
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
}

export default function AdminDashboard() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('dashboard')
  // Búsqueda inicial para la pestaña Reservas (viene por ?q= al abrir desde el dashboard).
  const [bookingsSearch, setBookingsSearch] = useState('')
  const [currentUser, setCurrentUser] = useState<{
    username: string
    displayName: string
    mustChangePassword: boolean
    canChangePassword: boolean
  } | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState('pricing')
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [todayBookings, setTodayBookings] = useState<TodayBooking[]>([])
  const [tomorrowBookings, setTomorrowBookings] = useState<TodayBooking[]>([])
  const [weekBookings, setWeekBookings] = useState<TodayBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [dashboardRange, setDashboardRange] = useState<'all' | 'today' | 'tomorrow' | 'week'>('all')

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
    if (tab && tabs.some((t) => t.id === tab)) setActiveTab(tab)
    if (q) setBookingsSearch(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Guardar la pestaña elegida en la URL para conservarla al refrescar y compartir enlaces.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('tab') !== activeTab) {
      url.searchParams.set('tab', activeTab)
      if (activeTab !== 'bookings') url.searchParams.delete('q')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [activeTab])

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

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      
      // Fetch stats
      const statsResponse = await fetch('/api/admin/stats')
      if (!statsResponse.ok) throw new Error('No se pudieron consultar las estadísticas')
      const statsData = await statsResponse.json()
      setStats(statsData)

      // Trae reservas de hoy hasta 6 días adelante y las separa en Hoy / Mañana / Esta semana
      const bookingsResponse = await fetch('/api/admin/today-bookings')
      if (!bookingsResponse.ok) throw new Error('No se pudieron consultar las reservas')
      const bookingsData: TodayBooking[] = await bookingsResponse.json()
      if (!Array.isArray(bookingsData)) throw new Error('Formato de reservas inesperado')

      const todayStr = format(new Date(), 'yyyy-MM-dd')
      const tomorrowDate = new Date()
      tomorrowDate.setDate(tomorrowDate.getDate() + 1)
      const tomorrowStr = format(tomorrowDate, 'yyyy-MM-dd')

      setTodayBookings(bookingsData.filter((b) => b.scheduled_date === todayStr))
      setTomorrowBookings(bookingsData.filter((b) => b.scheduled_date === tomorrowStr))
      setWeekBookings(bookingsData.filter((b) => b.scheduled_date > tomorrowStr))

    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const tabs = [
    { id: 'dashboard', name: 'Dashboard', icon: BarChart3 },
    { id: 'calendar', name: 'Calendario', icon: Calendar },
    { id: 'bookings', name: 'Reservas', icon: Calendar },
    { id: 'jobs', name: 'Trabajos', icon: Truck },
    { id: 'finance', name: 'Finanzas', icon: DollarSign },
    { id: 'prospects', name: 'Prospectos', icon: UserPlus },
    { id: 'customers', name: 'Clientes', icon: Users },
    { id: 'fleet', name: 'Flota', icon: Truck },
    { id: 'schedule', name: 'Horarios', icon: Clock },
    { id: 'activity', name: 'Actividad', icon: History },
    { id: 'ai-conversations', name: 'Conversaciones IA', icon: MessageSquareText },
    { id: 'settings', name: 'Configuración', icon: Settings },
  ]

  const settingsTabs = [
    { id: 'pricing', name: 'Precios', icon: DollarSign },
    { id: 'schedule-config', name: 'Horarios', icon: Clock },
    { id: 'inventory', name: 'Inventario', icon: Package },
    { id: 'users', name: 'Usuarios', icon: ShieldCheck },
  ]

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

  // Abre la reserva en una pestaña nueva, ya filtrada en la pestaña Reservas, para tener
  // ahí los botones de acción (editar, marcar pagado, completar, PDF, etc.).
  const openBookingInNewTab = (booking: Pick<TodayBooking, 'quote_id' | 'client_name'>) => {
    const term = booking.quote_id || booking.client_name
    const url = `/admin?tab=bookings&q=${encodeURIComponent(term)}`
    window.open(url, '_blank', 'noopener')
  }

  const renderBookingRow = (booking: TodayBooking) => (
    <div
      key={booking.id}
      onClick={() => openBookingInNewTab(booking)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openBookingInNewTab(booking)
        }
      }}
      role="button"
      tabIndex={0}
      title="Abrir en Reservas (pestaña nueva) para ver acciones"
      className="flex items-center justify-between gap-3 p-4 bg-slate-50 border border-slate-100 rounded-lg cursor-pointer transition-colors hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
    <AdminShell
      activeTab={activeTab}
      onSelect={setActiveTab}
      onRefresh={() => window.location.reload()}
      onLogout={handleLogout}
      onChangePassword={() => setShowChangePassword(true)}
      canChangePassword={currentUser?.canChangePassword}
      displayName={currentUser?.displayName}
    >
      <div className="w-full space-y-6">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="admin-section-toolbar">
              <div>
                <h2>Resumen de operación</h2>
                <p>Indicadores generales y agenda de los próximos siete días</p>
              </div>
              <div className="admin-range-tabs" role="group" aria-label="Filtrar período de reservas">
                {([
                  ['all', 'Todos'], ['today', 'Hoy'], ['tomorrow', 'Mañana'], ['week', 'Semana']
                ] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setDashboardRange(key)} className={dashboardRange === key ? 'is-active' : ''} aria-pressed={dashboardRange === key}>{label}</button>
                ))}
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

            {/* Ingresos del mes, separados por estado de cobro */}
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Ingresos</h3>
                {stats?.revenue ? (
                  <span className="text-sm text-gray-500">
                    Reservado este mes: ${stats.revenue.booked.toLocaleString('es-CL')}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 1. Cobrado */}
                <Card className="p-6 border-l-4 border-l-green-500">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-600">Pagado · este mes</p>
                      <p className="text-3xl font-archivo font-extrabold text-gray-900">
                        ${(stats?.revenue?.paid ?? 0).toLocaleString('es-CL')}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {stats?.revenue?.paidCount ?? 0} reserva
                        {(stats?.revenue?.paidCount ?? 0) === 1 ? '' : 's'} · plata recibida
                      </p>
                    </div>
                    <div className="p-3 rounded-full bg-green-50 shrink-0">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    </div>
                  </div>

                  {stats?.revenue?.paidByChannel && (
                    <div className="mt-4 space-y-1 border-t border-gray-100 pt-3">
                      {([
                        ['flow', 'Pago online'],
                        ['transfer', 'Transferencia'],
                        ['cash', 'Efectivo'],
                        ['otro', 'Otro'],
                      ] as const).map(([key, label]) => {
                        const value = stats.revenue!.paidByChannel[key]
                        if (!value) return null
                        return (
                          <div key={key} className="flex justify-between text-xs">
                            <span className="text-gray-500">{label}</span>
                            <span className="font-medium text-gray-700">
                              ${value.toLocaleString('es-CL')}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </Card>

                {/* 2. Por cobrar */}
                <Card className="p-6 border-l-4 border-l-amber-500">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-600">Por cobrar · este mes</p>
                      <p className="text-3xl font-archivo font-extrabold text-gray-900">
                        ${(stats?.revenue?.pending ?? 0).toLocaleString('es-CL')}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {stats?.revenue?.pendingCount ?? 0} reserva
                        {(stats?.revenue?.pendingCount ?? 0) === 1 ? '' : 's'} con saldo
                      </p>
                    </div>
                    <div className="p-3 rounded-full bg-amber-50 shrink-0">
                      <Clock className="w-6 h-6 text-amber-600" />
                    </div>
                  </div>
                  <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
                    Incluye el 50% restante de quienes abonaron la mitad y las reservas sin
                    pago confirmado.
                  </p>
                </Card>

                {/* 3. Cotizado vigente (sin reserva) */}
                <Card className="p-6 border-l-4 border-l-blue-500">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-600">Cotizado vigente · a futuro</p>
                      <p className="text-3xl font-archivo font-extrabold text-gray-900">
                        ${(stats?.outstandingQuotes?.total ?? 0).toLocaleString('es-CL')}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {stats?.outstandingQuotes?.count ?? 0} cotización
                        {(stats?.outstandingQuotes?.count ?? 0) === 1 ? '' : 'es'} sin reserva
                      </p>
                    </div>
                    <div className="p-3 rounded-full bg-blue-50 shrink-0">
                      <TrendingUp className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('prospects')}
                    className="mt-4 w-full border-t border-gray-100 pt-3 text-left text-xs text-blue-600 hover:text-blue-800"
                  >
                    Todas las fechas futuras, no solo este mes → ver leads
                  </button>
                </Card>
              </div>
            </div>

            {/* Reservas de Hoy */}
            {(dashboardRange === 'all' || dashboardRange === 'today') && renderBookingSection(
              `Reservas de Hoy (${format(new Date(), 'dd/MM/yyyy', { locale: es })})`,
              todayBookings,
              'No hay reservas para hoy'
            )}

            {/* Reservas de Mañana */}
            {(dashboardRange === 'all' || dashboardRange === 'tomorrow') && renderBookingSection('Reservas de Mañana', tomorrowBookings, 'No hay reservas para mañana')}

            {/* Resto de la semana, agrupado por día para más claridad */}
            {(dashboardRange === 'all' || dashboardRange === 'week') && <Card className="p-6">
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
            </Card>}

            {/* Gráficos analíticos (mensual) — debajo de lo operativo (hoy/mañana/semana) */}
            {dashboardRange === 'all' && <DashboardCharts />}

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

        {activeTab === 'calendar' && (
          <AgendaSemanal bookings={[...todayBookings, ...tomorrowBookings, ...weekBookings]} onOpen={openBookingInNewTab} />
        )}

        {activeTab === 'jobs' && (
          <div className="space-y-5">
            <AgendaSemanal bookings={[...todayBookings, ...tomorrowBookings, ...weekBookings]} onOpen={openBookingInNewTab} mode="jobs" />
            <div className="flex flex-wrap gap-3 rounded-xl border border-blue-100 bg-white p-4">
              <Button variant="outline" onClick={() => setActiveTab('bookings')}><Calendar className="mr-2 h-4 w-4" />Gestionar reservas</Button>
              <Button variant="outline" onClick={() => setActiveTab('fleet')}><Truck className="mr-2 h-4 w-4" />Administrar flota</Button>
            </div>
          </div>
        )}

        {activeTab === 'finance' && (
          <div className="space-y-5">
            <div className="admin-section-toolbar"><div><h2>Finanzas</h2><p>Indicadores existentes · no se modificaron fórmulas ni datos</p></div></div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card className="p-5"><p className="text-sm text-gray-600">Cobrado este mes</p><p className="mt-3 text-2xl font-bold text-green-700">${(stats?.revenue?.paid ?? 0).toLocaleString('es-CL')}</p><p className="mt-2 text-xs text-gray-500">{stats?.revenue?.paidCount ?? 0} reservas pagadas</p></Card>
              <Card className="p-5"><p className="text-sm text-gray-600">Por cobrar</p><p className="mt-3 text-2xl font-bold text-amber-700">${(stats?.revenue?.pending ?? 0).toLocaleString('es-CL')}</p><p className="mt-2 text-xs text-gray-500">{stats?.revenue?.pendingCount ?? 0} reservas con saldo</p></Card>
              <Card className="p-5"><p className="text-sm text-gray-600">Cotizaciones pendientes</p><p className="mt-3 text-2xl font-bold text-blue-700">${(stats?.outstandingQuotes?.total ?? 0).toLocaleString('es-CL')}</p><p className="mt-2 text-xs text-gray-500">{stats?.outstandingQuotes?.count ?? 0} cotizaciones sin reserva</p></Card>
            </div>
            <DashboardCharts />
          </div>
        )}

        {/* Bookings Tab */}
        {activeTab === 'bookings' && <BookingsManagement initialSearch={bookingsSearch} />}

        {/* Prospects Tab */}
        {activeTab === 'prospects' && <ProspectsManagement />}

        {activeTab === 'customers' && <AttendedCustomers />}

        {activeTab === 'activity' && <ActivityLog />}

        {activeTab === 'ai-conversations' && <AiConversations />}

        {/* Fleet Tab */}
        {activeTab === 'fleet' && (
          <div className="space-y-6">
            <DriverAccessCard />
            <FleetManagement />
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
                    ${activeSettingsTab === tab.id
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
            {activeSettingsTab === 'pricing' && <PricingConfiguration />}
            {activeSettingsTab === 'schedule-config' && <ScheduleConfiguration />}
            {activeSettingsTab === 'inventory' && <ItemsManagement />}
            {activeSettingsTab === 'users' && <UsersManagement />}
          </div>
        )}
      </div>

      <ChangePasswordModal
        isOpen={showChangePassword}
        required={Boolean(currentUser?.mustChangePassword)}
        onClose={() => setShowChangePassword(false)}
        onChanged={() => {
          setShowChangePassword(false)
          fetchCurrentUser()
        }}
      />
    </AdminShell>
  )
}
