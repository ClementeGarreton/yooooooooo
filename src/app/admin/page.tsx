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
import CalendarioMensual from '@/components/admin/CalendarioMensual'
import TrabajosPorFecha from '@/components/admin/TrabajosPorFecha'
import InicioOperativo from '@/components/admin/InicioOperativo'
import PanelAprobaciones from '@/components/admin/PanelAprobaciones'
import { MarketingRecuperado, EmpresasRecuperado, FacturasRecuperado, FinanzasRecuperadas, PoliticasBorrador, ReglaPagoBorrador, ClientesRecuperados } from '@/components/admin/ModulosRecuperados'
import { 
  Calendar, 
  Truck, 
  Clock, 
  BarChart3, 
  Settings, 
  Users, 
  DollarSign,
  FileText,
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
    { id: 'approvals', name: 'Por aprobar', icon: AlertCircle },
    { id: 'calendar', name: 'Calendario', icon: Calendar },
    { id: 'bookings', name: 'Reservas', icon: Calendar },
    { id: 'jobs', name: 'Trabajos', icon: Truck },
    { id: 'finance', name: 'Finanzas', icon: DollarSign },
    { id: 'marketing', name: 'Marketing', icon: MessageSquareText },
    { id: 'companies', name: 'Empresas', icon: Users },
    { id: 'invoicing', name: 'Emisión de facturas', icon: DollarSign },
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
    { id: 'worker-pay', name: 'Pago a trabajadores', icon: DollarSign },
    { id: 'policies', name: 'Políticas y términos', icon: FileText },
    { id: 'users', name: 'Usuarios y permisos', icon: ShieldCheck },
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
  const openBookingInNewTab = (booking: { quote_id?: string | null; client_name?: string | null }) => {
    const term = booking.quote_id || booking.client_name
    if (!term) return
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
        {activeTab === 'dashboard' && (
          <InicioOperativo
            stats={stats}
            todayBookings={todayBookings}
            tomorrowBookings={tomorrowBookings}
            weekBookings={weekBookings}
            onSelect={setActiveTab}
            onOpen={openBookingInNewTab}
            onRefresh={() => void fetchDashboardData()}
          />
        )}

        {activeTab === 'approvals' && (
          <PanelAprobaciones onOpen={openBookingInNewTab} />
        )}

        {activeTab === 'calendar' && (
          <CalendarioMensual onOpen={openBookingInNewTab} />
        )}

        {activeTab === 'jobs' && (
          <div className="space-y-5">
            <TrabajosPorFecha onOpen={openBookingInNewTab} />
            <div className="flex flex-wrap gap-3 rounded-xl border border-blue-100 bg-white p-4">
              <Button variant="outline" onClick={() => setActiveTab('bookings')}><Calendar className="mr-2 h-4 w-4" />Gestionar reservas</Button>
              <Button variant="outline" onClick={() => setActiveTab('fleet')}><Truck className="mr-2 h-4 w-4" />Administrar flota</Button>
            </div>
          </div>
        )}

        {activeTab === 'finance' && <FinanzasRecuperadas onOpen={openBookingInNewTab} />}

        {activeTab === 'marketing' && <MarketingRecuperado />}

        {activeTab === 'companies' && <EmpresasRecuperado onOpen={openBookingInNewTab} />}

        {activeTab === 'invoicing' && <FacturasRecuperado onOpen={openBookingInNewTab} />}

        {/* Bookings Tab */}
        {activeTab === 'bookings' && <BookingsManagement initialSearch={bookingsSearch} />}

        {/* Prospects Tab */}
        {activeTab === 'prospects' && <ProspectsManagement />}

        {activeTab === 'customers' && <ClientesRecuperados onOpen={openBookingInNewTab} onSelect={setActiveTab} />}

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
            <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
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
            {activeSettingsTab === 'worker-pay' && <ReglaPagoBorrador />}
            {activeSettingsTab === 'policies' && <PoliticasBorrador />}
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
