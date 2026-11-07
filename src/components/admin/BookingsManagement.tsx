'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import { 
  Search, 
  Filter, 
  Eye, 
  Edit, 
  Trash2, 
  CheckCircle, 
  XCircle, 
  Clock,
  Calendar,
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  DollarSign,
  Plus,
  Download,
  Star,
  UserX,
  Copy,
  Link2,
  AlertTriangle,
  CalendarClock
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { isValidEmail } from '@/lib/emailFormat'
import QuickRescheduleModal from './QuickRescheduleModal'
import RegisterPaymentModal from './RegisterPaymentModal'
import { TaxDocumentBadge, TaxDocumentDetail, TaxDocumentSelect } from './TaxDocument'
import { ivaBreakdown, taxDocumentLabel } from '@/lib/taxDocument'
import {
  buildWhatsAppLink,
  bookingFollowUpMessage,
  openWhatsApp,
  paymentLinkMessage,
  whatsAppUnavailableReason,
} from '@/lib/whatsapp'
import PdfDownloadMenu from './PdfDownloadMenu'
import BookingDocuments from './BookingDocuments'
import BookingOperationalSummary from './BookingOperationalSummary'
import BookingCouponBox from './BookingCouponBox'
import { toHiddenFileUrl } from '@/lib/fileLinks'
import PeriodFilter from './PeriodFilter'
import { chileDayOf, inPeriod, periodOf, resolvePeriod, type Period } from '@/lib/period'
import BookingHistory from './BookingHistory'
import RowMenu from './RowMenu'
import { SERVICE_TYPE_LABEL, type ServiceRequestView } from '@/lib/serviceRequestTypes'
import QuoteItemsPricing from './QuoteItemsPricing'
import {
  bookingVolumeM3,
  bookingToAdminQuoteData,
  normalizeAdminPdfItemsWithIndex,
  type AdminBookingQuoteSource,
} from '@/lib/adminBookingQuoteData'
import {
  actualPaidAmount,
  pendingAmount,
  servicePrice,
  MIN_ABONO_CLP,
} from '@/lib/revenueBreakdown'
import {
  SOURCE_OPTIONS,
  getSourceLabel,
  getSourceBadge,
  normalizeOrigin,
} from '@/lib/prospectSource'
import { buildGoogleCalendarUrl, buildIcsContent, icsFileName } from '@/lib/calendarLinks'
import { resolveVehicleColor, UNASSIGNED_COLOR, type VehicleColor } from '@/lib/vehicleColors'
import { normalizeStops, formatStopAddress, summarizeStops, type QuoteStop } from '@/lib/stops'
import { BOOKING_ORIGIN_LABEL, bookingOrigin } from '@/lib/bookingOrigin'

/**
 * Paradas tal como se están editando. Sin normalizar a propósito: `normalizeStops` descarta
 * las que no tienen calle y comuna, y una parada recién agregada (todavía vacía) se borraría
 * al primer render.
 */
const paradasEnEdicion = (b: { stops?: unknown }): QuoteStop[] =>
  Array.isArray(b.stops) ? (b.stops as QuoteStop[]) : normalizeStops(b.stops)

const MAX_PARADAS = 10

interface FleetVehicleOption {
  id: number
  name: string
  driver?: string
  status?: string
  color: VehicleColor
}

interface CustomerOption {
  email: string
  name: string
  phone: string
  origin: string
  isCompany?: boolean
  companyName?: string
  companyRut?: string
  isFrequent?: boolean
}

interface CapacityWarning {
  message: string
  reason: 'blocked' | 'full'
  activeBookings: number
  capacity: number
  /** Cuántas de las que ocupan el horario están sin confirmar. */
  unconfirmed?: number
}

interface Booking extends AdminBookingQuoteSource {
  id: string
  quote_id: string
  client_name: string
  client_email: string
  client_phone: string
  scheduled_date: string
  scheduled_time: string
  duration_hours: number
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  notes?: string
  /** RES-000001. Lo asigna la base (add_public_ids.sql); ausente sin la migración. */
  code?: string
  /** Cliente al que pertenece, en la tabla customers. */
  customer_id?: string
  /** Paradas intermedias entre origen y destino (JSONB). */
  stops?: unknown
  /** Lo que escribieron los choferes desde su link, sobre el trabajo realizado. */
  driver_notes?: Array<{
    id: string
    note: string
    vehicle_label?: string | null
    created_at: string
  }>
  payment_type?: string
  payment_status?: string
  payment_method?: string
  is_provisional?: boolean
  total_price?: number
  original_price?: number
  adjusted_price?: number | null
  amount_paid?: number | null
  adjustment_comment?: string | null
  /** Boleta, factura o sin documento. null = sin definir (ver lib/taxDocument). */
  tax_document?: string | null
  adjusted_at?: string | null
  adjusted_by?: string | null
  origin_address?: string
  destination_address?: string
  is_company?: boolean
  company_name?: string
  company_rut?: string
  pdf_url?: string
  pdf_generated_at?: string
  photo_urls?: string | string[] // Puede ser JSON string o array
  booking_type?: 'online' | 'domicilio' // Tipo de reserva
  visit_address?: string // Dirección para visita a domicilio
  service_completed_at?: string // Fecha de completación del servicio
  vehicle_id?: number | null // Camión asignado (color en el link de choferes)
  is_flexible?: boolean
  recommended_vehicle?: string
  total_volume?: number
  total_weight?: number
  total_distance?: number
  items_summary?: Array<{
    name: string
    quantity: number
    volume: number
    packaging?: { type: string; pricePerUnit?: number }
  }>
  additional_services?: Record<string, any>
  created_at: string
  confirmed_at?: string
  completed_at?: string
  cancelled_at?: string
}

// Estado inicial del formulario de nueva reserva. Centralizado para que al resetear no
// se olvide ningún campo nuevo.
const EMPTY_NEW_BOOKING = {
  quote_id: '',
  client_name: '',
  client_email: '',
  client_phone: '',
  scheduled_date: '',
  scheduled_time: '',
  duration_hours: 4,
  status: 'pending',
  payment_type: '',
  tax_document: '',
  payment_method: 'flow',
  payment_paid: false,
  total_price: '',
  original_price: '',
  /** Lo que el cliente YA pagó. Distinto de total_price, que es el precio del servicio. */
  amount_paid: '',
  origin_address: '',
  destination_address: '',
  notes: '',
  customer_origin: 'web',
  /** 'auto' = lo decide el reparto; si no, el id del camión elegido. */
  vehicle_choice: 'auto',
  // Datos operacionales: las reservas a mano no pasan por el cotizador, así que si no se
  // cargan acá el detalle queda sin volumen, distancia ni personas.
  people_needed: '',
  volume_m3: '',
  distance_km: '',
  origin_floor: '',
  origin_has_elevator: '',
  destination_floor: '',
  destination_has_elevator: '',
}

/**
 * Ascensor: tres estados, no dos. Sin dato ≠ "no hay".
 * La orden de trabajo escribe "SIN ascensor" en rojo, así que afirmarlo sin haberlo
 * preguntado manda al equipo a cargar por escaleras una mudanza que quizás tiene ascensor.
 */
const OPCIONES_ASCENSOR = [
  { value: '', label: 'Ascensor: sin dato' },
  { value: 'true', label: 'Con ascensor' },
  { value: 'false', label: 'Sin ascensor' },
]
const ascensorValor = (v: boolean | null | undefined) =>
  v === true ? 'true' : v === false ? 'false' : ''
const ascensorDesdeValor = (v: string) => (v === 'true' ? true : v === 'false' ? false : null)

interface BookingsManagementProps {
  /** Búsqueda precargada (p. ej. al abrir una reserva desde el dashboard con ?q=). */
  initialSearch?: string
  /** Rango precargado: lo manda el clic en un mes del gráfico del dashboard. */
  initialDateRange?: { desde: string; hasta: string } | null
  /** Permiso derivado del perfil firmado; el backend vuelve a validarlo al guardar. */
  canAdjustAmounts?: boolean
  /** Reserva a abrir directo en «Editar» (el «Editar todo lo demás» del Dashboard). */
  initialEditId?: string | null
  /**
   * Solicitud del panel del cliente que se está aprobando: abre «Nueva reserva» con sus
   * datos. Al guardar, el servidor la deja aprobada y enlazada a la reserva.
   */
  approvingRequest?: ServiceRequestView | null
  /** Se llama cuando la solicitud ya se usó (o se descartó cerrando el formulario). */
  onRequestHandled?: () => void
}

export default function BookingsManagement({
  initialSearch = '',
  initialDateRange = null,
  canAdjustAmounts = false,
  initialEditId = null,
  approvingRequest = null,
  onRequestHandled,
}: BookingsManagementProps) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState('all')
  const [bookingTypeFilter, setBookingTypeFilter] = useState('all') // Nuevo filtro
  const [clientTypeFilter, setClientTypeFilter] = useState('') // '' | company | person
  const [sourceFilter, setSourceFilter] = useState('all')
  const [vehicleFilter, setVehicleFilter] = useState('all') // 'all' | 'unassigned' | id
  const [fleet, setFleet] = useState<FleetVehicleOption[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  // Filtro de fecha: el mismo control y las mismas reglas de todo el panel (PeriodFilter).
  const [period, setPeriod] = useState<Period>(
    initialDateRange ? periodOf('custom', initialDateRange.desde, initialDateRange.hasta) : periodOf('all')
  )
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [financialEdit, setFinancialEdit] = useState({
    adjustedPrice: '',
    amountPaid: '',
    comment: '',
  })
  const [creating, setCreating] = useState(false)
  const [capacityWarning, setCapacityWarning] = useState<CapacityWarning | null>(null)
  // Disponibilidad por camión para el selector de Nueva Reserva. La calcula el servidor
  // con la misma función que valida al guardar, así lo que se ofrece es lo que se acepta.
  const [fleetAvailability, setFleetAvailability] = useState<{
    vehicles: Array<{
      id: number
      name: string
      status: 'active' | 'maintenance'
      available: boolean
      overlapping: Array<{ from: string; to: string }>
    }>
    recommendedVehicleId: number | null
    recommendedFits: boolean
  } | null>(null)
  const [fleetAvailabilityLoading, setFleetAvailabilityLoading] = useState(false)
  // Choque de camión en el modal Editar. Editar NO valida (decisión de Tomás, 16-sep-2026:
  // el admin puede saber que un trabajo termina antes), pero avisa: si el camión elegido
  // ya tiene otro trabajo que se pisa con la fecha/hora de esta reserva, se muestra acá.
  // Abre «Editar» de la reserva pedida por ?edit= apenas llega la lista, una sola vez.
  const initialEditDone = useRef(false)
  useEffect(() => {
    if (!initialEditId || initialEditDone.current || bookings.length === 0) return
    const target = bookings.find((b) => b.id === initialEditId)
    if (target) {
      initialEditDone.current = true
      openEditBooking(target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId, bookings])

  // Aprobar una solicitud = crear su reserva: se abre «Nueva reserva» con lo que pidió el
  // cliente y quien aprueba le pone el precio. Si cierra sin guardar, sigue pendiente.
  const [requestInForm, setRequestInForm] = useState<ServiceRequestView | null>(null)
  useEffect(() => {
    if (!approvingRequest) return
    const r = approvingRequest
    setBlockOnly(false)
    setSelectedCustomerEmail('manual')
    setNewBooking({
      ...EMPTY_NEW_BOOKING,
      client_name: r.customer.name || '',
      client_email: r.customer.email || '',
      client_phone: r.customer.phone || '',
      scheduled_date: r.requestedDate,
      scheduled_time: r.requestedTime ? r.requestedTime.slice(0, 5) : '',
      origin_address: r.origin,
      destination_address: r.destination,
      notes: [
        `Solicitud ${r.code} · ${SERVICE_TYPE_LABEL[r.serviceType]}`,
        r.isPriority ? 'PRIORITARIA: pedida con menos de 24 h, el cliente aceptó la tarifa prioritaria.' : '',
        r.fixedTime ? 'HORARIO FIJO de retiro o entrega.' : '',
        r.serviceType === 'pallets'
          ? `Pallets: ${r.pallets ?? 'sin indicar'}${r.repalletize ? ' · con repaletizado' : ''}`
          : '',
        r.description,
        r.contact ? `Contacto en origen: ${r.contact}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    })
    setRequestInForm(r)
    setShowAddModal(true)
    onRequestHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvingRequest])
  // Solo al CERRAR el formulario (no al montar, cuando todavía está cerrado): si no, este
  // efecto borraría la solicitud que el de arriba acaba de cargar.
  const addModalWasOpen = useRef(false)
  useEffect(() => {
    if (addModalWasOpen.current && !showAddModal) setRequestInForm(null)
    addModalWasOpen.current = showAddModal
  }, [showAddModal])

  /** Reserva abierta en el pop-up de «Registrar pago» (suma al pagado, no toca el precio). */
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null)
  /** Reserva abierta en el pop-up de «Cambiar fecha y hora» (solo eso, sin el resto). */
  const [quickReschedule, setQuickReschedule] = useState<Booking | null>(null)
  const [editTruckConflict, setEditTruckConflict] = useState<
    null | { vehicleName: string; ranges: string }
  >(null)
  /**
   * Aviso de horario ocupado al REPROGRAMAR. Va aparte de `capacityWarning`, que vive en
   * el modal de Nueva Reserva: son dos pantallas distintas y podrían estar abiertas en
   * momentos distintos.
   */
  const [editCapacityWarning, setEditCapacityWarning] = useState<CapacityWarning | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  /**
   * Origen del cliente mientras se edita la reserva. Va aparte de `selectedBooking`
   * porque NO es un campo de la reserva: es del CLIENTE, vive en `quote_prospects` y se
   * aplica a todas sus reservas. Se guarda por la misma ruta que usa la pestaña
   * Clientes, para que siga existiendo una sola clasificación por email.
   */
  const [editCustomerOrigin, setEditCustomerOrigin] = useState<string>('web')
  const [blockOnly, setBlockOnly] = useState(false)
  const [newBooking, setNewBooking] = useState({ ...EMPTY_NEW_BOOKING })
  const [selectedCustomerEmail, setSelectedCustomerEmail] = useState('manual')
  // Link de pago recién generado, para copiarlo o mandarlo por WhatsApp.
  const [paymentLink, setPaymentLink] = useState<{
    url: string
    clientName: string
    clientPhone: string
    amount: number
    /** 'nueva' = link al crear la reserva; 'saldo' = cobro de lo que falta. */
    kind: 'nueva' | 'saldo'
  } | null>(null)
  const [generandoSaldo, setGenerandoSaldo] = useState<string | null>(null)
  /** Monto a cobrar del saldo. Vacío = el saldo entero. */
  const [montoCobro, setMontoCobro] = useState('')

  // El monto es de la reserva que se está mirando: si queda pegado al abrir otra, se
  // generaría un link por una cifra que no tiene nada que ver con ese saldo.
  useEffect(() => {
    setMontoCobro('')
  }, [selectedBooking?.id])

  /**
   * Pide al backend un link de Flow por lo que falta cobrar.
   *
   * El monto lo calcula el servidor con `pendingAmount()`, no el navegador: es la misma
   * función del dashboard y sabe que quien pagó "completo" no debe el 5% de descuento.
   */
  const generarLinkDeSaldo = async (booking: Booking, monto?: number) => {
    setGenerandoSaldo(booking.id)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sin monto se cobra el saldo entero; el servidor valida el piso del abono.
        body: JSON.stringify(monto ? { amount: monto } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'No se pudo generar el link')
      }
      setPaymentLink({
        url: data.url,
        clientName: data.clientName || booking.client_name,
        clientPhone: data.clientPhone || booking.client_phone,
        amount: data.amount,
        kind: 'saldo',
      })
      setMontoCobro('')
    } catch (error) {
      console.error('Error generando el link de saldo:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo generar el link')
    } finally {
      setGenerandoSaldo(null)
    }
  }

  const openEditBooking = (booking: Booking) => {
    setSelectedBooking(booking)
    setEditCustomerOrigin(normalizeOrigin(booking.source))
    // El aviso es de la reserva anterior: si queda pegado, bloquea el botón de guardar
    // de una reserva que no tiene ningún conflicto.
    setEditCapacityWarning(null)
    setFinancialEdit({
      adjustedPrice: String(servicePrice(booking) || ''),
      amountPaid: String(actualPaidAmount(booking) || 0),
      comment: booking.adjustment_comment || '',
    })
    setShowEditModal(true)
  }

  // Último contacto con el cliente de cada reserva (WhatsApp o correo abierto desde acá).
  const [contacts, setContacts] = useState<Record<string, { at: string; by: string | null; channel: 'whatsapp' | 'email' }>>({})
  const loadContacts = async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      const res = await fetch('/api/admin/bookings/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.contacts) setContacts(body.contacts)
    } catch {
      // Sin esto la lista funciona igual, solo sin la marca de contacto.
    }
  }
  /** Marca la reserva como contactada en la pantalla y lo registra en el servidor. */
  const markContacted = (b: Booking, channel: 'whatsapp' | 'email') => {
    setContacts((prev) => ({ ...prev, [b.id]: { at: new Date().toISOString(), by: null, channel } }))
    fetch(`/api/admin/bookings/${b.id}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) }).catch(() => {})
  }

  const fetchBookings = async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setLoading(true)
      const response = await fetch('/api/admin/bookings')
      const data = await response.json()
      console.log('[Admin] Bookings cargadas:', data.length)
      console.log('[Admin] Bookings con PDF:', data.filter((b: Booking) => b.pdf_url).length)
      setBookings(data)
      if (Array.isArray(data)) loadContacts(data.map((b: Booking) => b.id))
    } catch (error) {
      console.error('Error fetching bookings:', error)
      if (!options.silent) toast.error('Error al cargar las reservas')
    } finally {
      if (!options.silent) setLoading(false)
    }
  }

  // La flota se lee aparte de las reservas: nombre y color del camión viven en
  // fleet_config, y la reserva solo guarda el vehicle_id.
  const fetchFleet = async () => {
    try {
      const response = await fetch('/api/admin/fleet-config')
      const data = await response.json()
      const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : []
      setFleet(
        vehicles.map((v: any, i: number) => ({
          id: v.id,
          name: v.name || `Camión ${i + 1}`,
          driver: v.driver || '',
          status: v.status,
          color: resolveVehicleColor(v, i),
        }))
      )
    } catch (error) {
      console.error('Error fetching fleet config:', error)
    }
  }

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/admin/customers/attended')
      const data = await response.json().catch(() => ([]))
      if (response.ok && Array.isArray(data)) setCustomers(data)
    } catch (error) {
      console.error('Error fetching customers for booking form:', error)
    }
  }

  const selectExistingCustomer = (email: string) => {
    setSelectedCustomerEmail(email)
    const customer = customers.find((item) => item.email === email)
    if (!customer) return
    setNewBooking((previous) => ({
      ...previous,
      client_name: customer.name,
      client_email: customer.email,
      client_phone: customer.phone,
      customer_origin: normalizeOrigin(customer.origin),
    }))
  }

  const vehicleOf = useCallback(
    (booking: Booking): FleetVehicleOption | null =>
      booking.vehicle_id == null ? null : fleet.find((v) => v.id === booking.vehicle_id) || null,
    [fleet]
  )

  const filterBookings = useCallback(() => {
    let filtered = [...bookings]

    // Filtrar por búsqueda
    if (searchTerm) {
      filtered = filtered.filter(booking =>
        booking.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        booking.client_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        booking.client_phone.includes(searchTerm) ||
        booking.quote_id.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Filtrar por estado (incluye opción especial 'provisional' = pre-reservas sin pagar)
    if (statusFilter === 'provisional') {
      filtered = filtered.filter(booking => booking.is_provisional === true)
    } else if (statusFilter === 'por_cobrar') {
      // A quién hay que ir a cobrar: toda reserva real con plata pendiente, pagara algo o
      // nada. Es la MISMA cuenta que «Falta cobrar» en la fila y en el detalle
      // (`pendingAmount`), así que la lista y los montos no pueden contradecirse.
      //
      // Hacía falta porque los dos filtros que había dejaban afuera a la mayoría: «Sin
      // pagar» solo mira pre-reservas web y «Abonó 50%» exige ese tipo de pago. Medido el
      // 15-sep-2026: 46 reservas deben $5.594.633, y 30 de ellas ($4.891.314) no salían
      // en ninguno — casi todas confirmadas a mano que todavía no pagaron nada.
      //
      // `pendingAmount` ya devuelve 0 para pre-reservas, canceladas y no atendidas, y para
      // quien pagó completo (el 5% es descuento, no deuda). Una reserva sin precio cargado
      // tampoco aparece: no se puede deber un monto que no existe.
      filtered = filtered.filter(
        booking =>
          !String(booking.quote_id || '').startsWith('ADMIN-BLOQUEO-') &&
          pendingAmount(booking) > 0
      )
    } else if (statusFilter === 'saldo_pendiente') {
      // Abonos del 50% ya cobrados: falta el saldo. Es la lista de a quién hay que ir a
      // cobrar, así que se excluyen las canceladas y las que nunca pagaron el abono.
      filtered = filtered.filter(
        booking =>
          booking.is_provisional !== true &&
          booking.payment_type === 'mitad' &&
          booking.payment_status === 'approved' &&
          pendingAmount(booking) > 0 &&
          !['cancelled', 'no_show'].includes(booking.status)
      )
    } else {
      // Las pre-reservas provisionales sin pagar son cotizaciones no concretadas (no
      // ocupan cupo): solo se ven con el filtro "Sin pagar", nunca mezcladas con las
      // reservas reales (antes se colaban al filtrar por "Pendiente").
      filtered = filtered.filter(booking => booking.is_provisional !== true)
      if (statusFilter !== 'all') {
        filtered = filtered.filter(booking => booking.status === statusFilter)
      } else {
        // En "Todos" ocultamos los "No atendido": son cierres sin servicio que
        // ensucian la operación diaria. Se ven con su propio filtro.
        filtered = filtered.filter(booking => booking.status !== 'no_show')
      }
    }

    // Filtrar por tipo de reserva (soporta detección por prefijo si no hay campo booking_type)
    if (bookingTypeFilter !== 'all') {
      filtered = filtered.filter(booking => {
        const isDomicilio = booking.booking_type === 'domicilio' || 
                           (booking.quote_id && booking.quote_id.startsWith('DOMICILIO-'))
        const detectedType = isDomicilio ? 'domicilio' : 'online'
        return detectedType === bookingTypeFilter
      })
    }

    // Filtrar por fecha del servicio ('YYYY-MM-DD': se compara como texto, sin husos).
    const range = resolvePeriod(period)
    filtered = filtered.filter((booking) => inPeriod(booking.scheduled_date, range))

    // Filtrar por camión asignado
    if (vehicleFilter === 'unassigned') {
      filtered = filtered.filter(booking => booking.vehicle_id == null)
    } else if (vehicleFilter !== 'all') {
      filtered = filtered.filter(booking => String(booking.vehicle_id) === vehicleFilter)
    }

    // Filtrar por tipo de cliente (empresa vs persona natural)
    if (clientTypeFilter === 'company') {
      filtered = filtered.filter(b => b.is_company === true)
    } else if (clientTypeFilter === 'person') {
      filtered = filtered.filter(b => b.is_company !== true)
    }

    if (sourceFilter !== 'all') {
      filtered = filtered.filter((booking) => normalizeOrigin(booking.source) === sourceFilter)
    }

    // Orden por fecha del TRABAJO (no por cuándo se creó el registro): las próximas primero
    // (la más cercana arriba), y más abajo las pasadas (la más reciente primero). Antes
    // dependía del orden de llegada de la API (created_at), mezclando un trabajo de hoy con
    // uno de dentro de un mes sin ningún criterio operativo.
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    filtered.sort((a, b) => {
      const aFuture = a.scheduled_date >= todayStr
      const bFuture = b.scheduled_date >= todayStr
      if (aFuture !== bFuture) return aFuture ? -1 : 1
      const aKey = `${a.scheduled_date}T${a.scheduled_time || ''}`
      const bKey = `${b.scheduled_date}T${b.scheduled_time || ''}`
      return aFuture ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey)
    })

    setFilteredBookings(filtered)
  }, [bookings, searchTerm, statusFilter, bookingTypeFilter, clientTypeFilter, sourceFilter, vehicleFilter, period])

  useEffect(() => {
    const date = newBooking.scheduled_date
    const time = newBooking.scheduled_time
    if (!showAddModal || !date || !time) {
      setFleetAvailability(null)
      return
    }
    let vigente = true
    const timer = setTimeout(async () => {
      setFleetAvailabilityLoading(true)
      try {
        const params = new URLSearchParams({
          date,
          time,
          duration: String(Number(newBooking.duration_hours) || 4),
        })
        const res = await fetch(`/api/admin/fleet-availability?${params}`)
        const data = await res.json().catch(() => null)
        if (!vigente) return
        if (!res.ok || !data) {
          setFleetAvailability(null)
          return
        }
        setFleetAvailability(data)
        // Si el camión elegido dejó de servir con la fecha/hora nueva, se vuelve a
        // «Automático» en vez de dejar seleccionada una opción que el servidor rechazará.
        setNewBooking((prev) => {
          if (prev.vehicle_choice === 'auto') return prev
          const elegido = data.vehicles?.find((v: any) => String(v.id) === prev.vehicle_choice)
          return elegido?.available ? prev : { ...prev, vehicle_choice: 'auto' }
        })
      } finally {
        if (vigente) setFleetAvailabilityLoading(false)
      }
    }, 300)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [showAddModal, newBooking.scheduled_date, newBooking.scheduled_time, newBooking.duration_hours])

  useEffect(() => {
    const b = selectedBooking
    const ocupaCamion = b && !['cancelled', 'no_show'].includes(String(b.status || ''))
    if (!showEditModal || !b || !ocupaCamion || b.vehicle_id == null || !b.scheduled_date || !b.scheduled_time) {
      setEditTruckConflict(null)
      return
    }
    let vigente = true
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          date: b.scheduled_date,
          time: String(b.scheduled_time).slice(0, 5),
          duration: String(Number(b.duration_hours) || 4),
          excludeId: b.id,
        })
        const res = await fetch(`/api/admin/fleet-availability?${params}`)
        const data = await res.json().catch(() => null)
        if (!vigente || !res.ok || !data) return
        const camion = data.vehicles?.find((v: any) => v.id === b.vehicle_id)
        setEditTruckConflict(
          camion && camion.status === 'active' && !camion.available
            ? {
                vehicleName: camion.name,
                ranges: camion.overlapping.map((o: any) => `${o.from}–${o.to}`).join(', '),
              }
            : null
        )
      } catch {
        if (vigente) setEditTruckConflict(null)
      }
    }, 300)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [
    showEditModal,
    selectedBooking?.id,
    selectedBooking?.scheduled_date,
    selectedBooking?.scheduled_time,
    selectedBooking?.vehicle_id,
    selectedBooking?.status,
  ])

  useEffect(() => {
    fetchBookings()
    fetchFleet()
    fetchCustomers()
    // Refresco silencioso al volver a la pestaña/ventana: los pagos confirmados por el
    // webhook aparecen sin necesidad de pulsar "Actualizar".
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') fetchBookings({ silent: true })
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    filterBookings()
  }, [filterBookings])

  const updateBookingStatus = async (bookingId: string, newStatus: string) => {
    try {
      const updateData: any = { status: newStatus }
      
      // Si se marca como completado un servicio a domicilio, agregar timestamp
      if (newStatus === 'completed') {
        updateData.service_completed_at = new Date().toISOString()
      }

      const response = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (!response.ok) {
        throw new Error('Error al actualizar el estado')
      }

      toast.success('Estado actualizado correctamente')
      fetchBookings()
    } catch (error) {
      console.error('Error updating booking status:', error)
      toast.error('Error al actualizar el estado')
    }
  }

  const toggleBookingSelection = (id: string) => {
    setSelectedBookingIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllBookings = () => {
    setSelectedBookingIds(prev => {
      const allSelected =
        filteredBookings.length > 0 && filteredBookings.every(b => prev.has(b.id))
      return allSelected ? new Set() : new Set(filteredBookings.map(b => b.id))
    })
  }

  // Cambio masivo de estado para las reservas seleccionadas.
  const bulkUpdateBookingStatus = async (newStatus: string) => {
    const ids = Array.from(selectedBookingIds)
    if (ids.length === 0) return
    setBulkUpdating(true)
    const results = await Promise.allSettled(
      ids.map(id => {
        const updateData: any = { status: newStatus }
        if (newStatus === 'completed') updateData.service_completed_at = new Date().toISOString()
        return fetch(`/api/admin/bookings/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }).then(r => {
          if (!r.ok) throw new Error('fail')
        })
      })
    )
    const ok = results.filter(r => r.status === 'fulfilled').length
    const fail = results.length - ok
    if (ok) toast.success(`${ok} reserva${ok !== 1 ? 's' : ''} actualizada${ok !== 1 ? 's' : ''}`)
    if (fail) toast.error(`${fail} con error`)
    setSelectedBookingIds(new Set())
    setBulkUpdating(false)
    fetchBookings()
  }

  // Guarda estado + notas juntos desde el modal Editar (antes las notas no se
  // persistían: el botón solo mandaba el estado y el texto se perdía).
  const saveBookingEdits = async (booking: Booking, overrideCapacity = false) => {
    try {
      setSavingEdit(true)
      const esDomicilio =
        booking.booking_type === 'domicilio' ||
        Boolean(booking.quote_id?.startsWith('DOMICILIO-'))

      const updateData: any = {
        status: booking.status,
        notes: booking.notes ?? '',
        // Reprogramación: el backend valida que haya cupo en el horario nuevo.
        scheduled_date: booking.scheduled_date,
        scheduled_time: booking.scheduled_time,
        // Solo se manda el campo de dirección que corresponde al tipo. Mandar los tres
        // haría que una visita a domicilio escribiera null en origen y destino cada vez
        // que se guarda, y al revés.
        ...(esDomicilio
          ? { visit_address: booking.visit_address ?? '' }
          : {
              origin_address: booking.origin_address ?? '',
              destination_address: booking.destination_address ?? '',
              origin_floor: booking.origin_floor ?? '',
              origin_has_elevator: booking.origin_has_elevator ?? null,
              destination_floor: booking.destination_floor ?? '',
              destination_has_elevator: booking.destination_has_elevator ?? null,
            }),
      }

      // El camión solo se manda si realmente cambió. Si no, editar las notas de una
      // reserva que quedó apuntando a un camión en mantención fallaría con 409.
      const original = bookings.find((b) => b.id === booking.id)
      // Paradas: solo si cambiaron. Una parada a medio llenar no se descarta en silencio:
      // sin calle o comuna no se puede recorrer, así que se pide completarla.
      if (!esDomicilio) {
        const paradas = paradasEnEdicion(booking).map((p) => ({
          ...p,
          street: String(p.street || '').trim(),
          number: String(p.number || '').trim(),
          commune: String(p.commune || '').trim(),
          note: String(p.note || '').trim() || undefined,
        }))
        const tocadas = paradas.filter((p) => p.street || p.number || p.commune || p.note)
        const incompleta = tocadas.findIndex((p) => !p.street || !p.commune)
        if (incompleta >= 0) {
          toast.error(`A la parada ${paradas.indexOf(tocadas[incompleta]) + 1} le falta la calle o la comuna`)
          return false
        }
        const resumen = (v: unknown) => JSON.stringify(normalizeStops(v))
        if (resumen(tocadas) !== resumen(original?.stops)) updateData.stops = tocadas
      }
      // El documento tributario solo se manda si cambió: así editar cualquier otra cosa
      // funciona aunque todavía no esté corrida add_booking_tax_document.sql.
      if ((original?.tax_document ?? null) !== (booking.tax_document || null)) {
        updateData.tax_document = booking.tax_document || null
      }
      if ((original?.vehicle_id ?? null) !== (booking.vehicle_id ?? null)) {
        // null desasigna: el reparto automático la vuelve a tomar en la próxima lectura.
        updateData.vehicle_id = booking.vehicle_id ?? null
      }
      // Montos del servicio. Antes esto sólo se podía tocar si la reserva estaba
      // `approved` Y con `payment_type = 'mitad'`, o sea nunca en una reserva creada a
      // mano (que nace pendiente y sin tipo de pago): por eso no había forma de corregir
      // cuánto pagó alguien que transfirió o pagó en efectivo. Ahora depende sólo del
      // permiso; el registro en Actividad sigue igual.
      if (canAdjustAmounts) {
        const rawAdjusted = String(financialEdit.adjustedPrice).trim()
        const rawPaid = String(financialEdit.amountPaid).trim()
        // El monto final es OPCIONAL: una reserva puede no tener precio cargado todavía
        // y aun así haber recibido un abono. Vacío = no se toca.
        const adjustedPrice = rawAdjusted === '' ? null : Math.round(Number(rawAdjusted))
        const amountPaid = rawPaid === '' ? 0 : Math.round(Number(rawPaid))

        if (adjustedPrice !== null && (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0)) {
          toast.error('El monto final debe ser mayor que cero, o déjalo vacío')
          return false
        }
        if (!Number.isFinite(amountPaid) || amountPaid < 0) {
          toast.error('El monto pagado no puede ser negativo')
          return false
        }

        const priceChanged =
          adjustedPrice !== null && adjustedPrice !== servicePrice(original || booking)
        const paidChanged = amountPaid !== actualPaidAmount(original || booking)
        const commentChanged =
          financialEdit.comment.trim() !== String(original?.adjustment_comment || '')

        if (priceChanged || paidChanged || commentChanged) {
          if (priceChanged) updateData.adjusted_price = adjustedPrice
          updateData.amount_paid = amountPaid
          updateData.adjustment_comment = financialEdit.comment.trim()
        }
      }
      if (booking.status === 'completed') {
        updateData.service_completed_at = new Date().toISOString()
      }
      const response = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updateData, override_capacity: overrideCapacity }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        // El horario está ocupado, pero se puede agendar igual: en vez de un error se
        // muestra el aviso y, si el admin confirma, se reintenta con el sobrecupo.
        if (response.status === 409 && err?.requiresOverride) {
          setEditCapacityWarning({
            message: err.warning || 'Ese horario ya está ocupado.',
            reason: err.reason === 'blocked' ? 'blocked' : 'full',
            activeBookings: Number(err.activeBookings) || 0,
            capacity: Number(err.capacity) || 0,
            unconfirmed: Number(err.unconfirmed) || 0,
          })
          return false
        }
        throw new Error(err?.error || 'Error al guardar')
      }
      setEditCapacityWarning(null)

      // El origen del cliente va por su propia ruta: no es un campo de la reserva sino
      // del cliente, y se aplica por email a todo su histórico. Se manda solo si cambió.
      const origenOriginal = normalizeOrigin(booking.source)
      if (editCustomerOrigin !== origenOriginal && booking.client_email) {
        try {
          const res = await fetch('/api/admin/customers', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: booking.client_email,
              name: booking.client_name,
              phone: booking.client_phone,
              source: editCustomerOrigin,
              is_company: booking.is_company === true,
              company_name: booking.company_name || null,
              company_rut: booking.company_rut || null,
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data?.error || 'No se pudo cambiar el origen')
        } catch (originErr) {
          // La reserva YA se guardó: no se revierte por esto, pero hay que decirlo.
          console.error('Error cambiando el origen del cliente:', originErr)
          toast.error(
            originErr instanceof Error
              ? `Reserva guardada, pero el origen no cambió: ${originErr.message}`
              : 'Reserva guardada, pero el origen no cambió'
          )
          fetchBookings()
          return true
        }
      }

      toast.success(
        overrideCapacity
          ? 'Reserva guardada — quedaron dos en el mismo horario'
          : 'Reserva actualizada correctamente'
      )
      fetchBookings()
      return true
    } catch (error) {
      console.error('Error saving booking edits:', error)
      toast.error(error instanceof Error ? error.message : 'Error al guardar los cambios')
      return false
    } finally {
      setSavingEdit(false)
    }
  }

  const updatePaymentType = async (bookingId: string, newPaymentType: string) => {
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_type: newPaymentType })
      })

      if (!response.ok) {
        throw new Error('Error al actualizar el tipo de pago')
      }

      toast.success('Tipo de pago actualizado correctamente')
      fetchBookings()
    } catch (error) {
      console.error('Error updating payment type:', error)
      toast.error('Error al actualizar el tipo de pago')
    }
  }

  const updatePaymentStatus = async (bookingId: string, newPaymentStatus: string) => {
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: newPaymentStatus })
      })

      if (!response.ok) {
        throw new Error('Error al actualizar el estado del pago')
      }

      toast.success('Estado del pago actualizado correctamente')
      fetchBookings()
    } catch (error) {
      console.error('Error updating payment status:', error)
      toast.error('Error al actualizar el estado del pago')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-green-700 bg-green-100 border-green-300'
      case 'pending': return 'text-yellow-800 bg-yellow-100 border-yellow-300'
      case 'completed': return 'text-blue-700 bg-blue-100 border-blue-300'
      case 'cancelled': return 'text-red-700 bg-red-100 border-red-300'
      case 'no_show': return 'text-orange-800 bg-orange-100 border-orange-300'
      default: return 'text-gray-700 bg-gray-100 border-gray-300'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'confirmed': return 'Confirmado'
      case 'pending': return 'Pendiente'
      case 'completed': return 'Completado'
      case 'cancelled': return 'Cancelado'
      case 'no_show': return 'No atendido'
      default: return status
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="w-4 h-4" />
      case 'pending': return <Clock className="w-4 h-4" />
      case 'completed': return <CheckCircle className="w-4 h-4" />
      case 'cancelled': return <XCircle className="w-4 h-4" />
      case 'no_show': return <UserX className="w-4 h-4" />
      default: return <Clock className="w-4 h-4" />
    }
  }

  /** Link de WhatsApp de una reserva, o null si el teléfono no sirve. */
  const buildWhatsappLink = (b: Booking) =>
    buildWhatsAppLink(b.client_phone, bookingFollowUpMessage(b))

  // Email: arma un mailto: con asunto y mensaje prellenado (mismo criterio que WhatsApp).
  const buildEmailLink = (b: Booking) => {
    const firstName = b.client_name?.split(' ')[0] || ''
    let fechaTxt = ''
    if (b.scheduled_date) {
      const [y, m, d] = b.scheduled_date.split('-').map(Number)
      fechaTxt = format(new Date(y, (m || 1) - 1, d || 1), "d 'de' MMMM", { locale: es })
    }
    const cuando = fechaTxt ? ` del ${fechaTxt}${b.scheduled_time ? ` a las ${b.scheduled_time.slice(0, 5)}` : ''}` : ''
    const subject = `Tu reserva de mudanza con Yo me Encargo${cuando}`
    const body = `Hola ${firstName},\n\nTe contactamos de Yo me Encargo por tu reserva de mudanza${cuando}. Quería coordinar contigo los detalles del traslado.\n\nSaludos,\nYo me Encargo`
    return `mailto:${b.client_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  // Descarga un archivo .ics (calendario) de la reserva, compatible con Apple/Outlook/Google.
  const downloadIcs = (b: Booking) => {
    const blob = new Blob([buildIcsContent(b)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = icsFileName(b)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Marca/desmarca al cliente de la reserva como frecuente (se aplica por email a todas
  // sus reservas y fichas de prospecto). Actualización optimista + revertir si falla.
  const toggleFrequentCustomer = async (booking: Booking) => {
    const next = !booking.is_frequent
    const sameEmail = (b: Booking) =>
      (b.client_email || '').toLowerCase().trim() === (booking.client_email || '').toLowerCase().trim()
    setBookings((prev) => prev.map((b) => (sameEmail(b) ? { ...b, is_frequent: next } : b)))
    try {
      const res = await fetch('/api/admin/customers/toggle-frequent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: booking.client_email,
          is_frequent: next,
          name: booking.client_name,
          phone: booking.client_phone,
        }),
      })
      if (!res.ok) throw new Error('Error')
      toast.success(next ? 'Cliente marcado como frecuente' : 'Cliente quitado de frecuentes')
    } catch (e) {
      setBookings((prev) => prev.map((b) => (sameEmail(b) ? { ...b, is_frequent: !next } : b)))
      toast.error('No se pudo actualizar el cliente')
    }
  }

  const addHoursToTime = (time: string, hoursToAdd: number) => {
    if (!time) return ''
    const [h, m] = time.split(':').map(Number)
    const date = new Date()
    date.setHours(h, m || 0, 0, 0)
    date.setHours(date.getHours() + (Number(hoursToAdd) || 0))
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }

  const handleCreate = async (overrideCapacity = false) => {
    try {
      setCreating(true)
      if (blockOnly) {
        // Reservar un cupo (1 camión) sin cliente: crear una reserva mínima
        const timestamp = Date.now()
        const payload: any = {
          quote_id: `ADMIN-BLOQUEO-${timestamp}`,
          client_name: 'Bloqueo manual (admin)',
          client_email: 'bloqueo+admin@example.com',
          client_phone: '0000000000',
          scheduled_date: newBooking.scheduled_date,
          scheduled_time: newBooking.scheduled_time,
          duration_hours: Number(newBooking.duration_hours) || 4,
          status: 'confirmed',
          payment_type: newBooking.payment_type || null,
          total_price: newBooking.total_price ? Number(newBooking.total_price) : null,
          original_price: newBooking.original_price ? Number(newBooking.original_price) : null,
          origin_address: null,
          destination_address: null,
          notes: newBooking.notes || 'Reserva de cupo sin cliente (admin)',
          skip_customer_record: true,
          override_capacity: overrideCapacity,
          vehicle_id: newBooking.vehicle_choice === 'auto' ? 'auto' : Number(newBooking.vehicle_choice),
        }
        const response = await fetch('/api/admin/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          if (response.status === 409 && err?.requiresOverride) {
            setCapacityWarning({
              message: err.warning || 'El horario ya no tiene disponibilidad normal.',
              reason: err.reason === 'blocked' ? 'blocked' : 'full',
              activeBookings: Number(err.activeBookings) || 0,
              capacity: Number(err.capacity) || 0,
            })
            return
          }
          throw new Error(err?.error || 'Error al reservar el cupo')
        }
        toast.success('Cupo reservado correctamente (1 camión)')
        setShowAddModal(false)
        setBlockOnly(false)
        setNewBooking({ ...EMPTY_NEW_BOOKING })
        setSelectedCustomerEmail('manual')
        fetchBookings()
        return
      }

      // Crear reserva normal
      if (!isValidEmail(newBooking.client_email)) {
        toast.error('Ingresa un correo válido del cliente (ej. nombre@gmail.com): sin eso no recibe ningún aviso.')
        return
      }
      const timestamp = Date.now()
      const method = newBooking.payment_method || 'flow'
      const amount = newBooking.total_price ? Number(newBooking.total_price) : 0

      const payload: any = {
        quote_id: newBooking.quote_id || `ADMIN-${timestamp}`,
        client_name: newBooking.client_name,
        client_email: newBooking.client_email,
        client_phone: newBooking.client_phone,
        scheduled_date: newBooking.scheduled_date,
        scheduled_time: newBooking.scheduled_time,
        duration_hours: Number(newBooking.duration_hours) || 4,
        status: newBooking.status,
        payment_type: newBooking.payment_type || null,
        payment_method: method,
        // Con link de pago, Flow confirma después por webhook: siempre nace pendiente.
        // Con transferencia/efectivo el admin declara si ya se pagó.
        payment_status: method === 'flow' ? 'pending' : (newBooking.payment_paid ? 'approved' : 'pending'),
        total_price: newBooking.total_price ? Number(newBooking.total_price) : null,
        original_price: newBooking.original_price ? Number(newBooking.original_price) : null,
        // El monto real es obligatorio cuando se marca «ya pagó»; el backend ya no
        // inventa un cobro desde la modalidad mitad/completo.
        amount_paid:
          String(newBooking.amount_paid).trim() !== ''
            ? Math.max(0, Math.round(Number(newBooking.amount_paid) || 0))
            : undefined,
        origin_address: newBooking.origin_address || null,
        destination_address: newBooking.destination_address || null,
        notes: newBooking.notes || null,
        customer_origin: newBooking.customer_origin,
        override_capacity: overrideCapacity,
        vehicle_id: newBooking.vehicle_choice === 'auto' ? 'auto' : Number(newBooking.vehicle_choice),
        // Vacío = sin definir (no se manda, así funciona aunque falte la migración).
        tax_document: newBooking.tax_document || undefined,
        // Operacional: solo lo que se llenó.
        peopleNeeded: newBooking.people_needed.trim() || undefined,
        volumeM3: newBooking.volume_m3.trim() || undefined,
        distanceKm: newBooking.distance_km.trim() || undefined,
        origin_floor: newBooking.origin_floor.trim() === '' ? undefined : Number(newBooking.origin_floor),
        destination_floor: newBooking.destination_floor.trim() === '' ? undefined : Number(newBooking.destination_floor),
        origin_has_elevator: ascensorDesdeValor(newBooking.origin_has_elevator) ?? undefined,
        destination_has_elevator: ascensorDesdeValor(newBooking.destination_has_elevator) ?? undefined,
      }
      if (requestInForm) {
        payload.service_request_id = requestInForm.id
        if (requestInForm.company) {
          payload.is_company = true
          payload.company_name = requestInForm.company.razon_social
          payload.company_rut = requestInForm.company.rut
        }
      }

      const response = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        if (response.status === 409 && err?.requiresOverride) {
          setCapacityWarning({
            message: err.warning || 'El horario ya no tiene disponibilidad normal.',
            reason: err.reason === 'blocked' ? 'blocked' : 'full',
            activeBookings: Number(err.activeBookings) || 0,
            capacity: Number(err.capacity) || 0,
          })
          return
        }
        throw new Error(err?.error || 'Error al crear la reserva')
      }

      const created = await response.json().catch(() => ({}))
      const createdQuoteId: string = created?.booking?.quote_id || payload.quote_id
      if (created.operationalWarning) toast(created.operationalWarning, { icon: '⚠️', duration: 8000 })
      if (created.paymentLedgerRecorded === false) {
        toast.error(`Reserva ${createdQuoteId} creada, pero el cobro no entró al libro de pagos. Revisa la reserva antes de registrar otro cobro.`)
      }

      // Con link de pago: generamos la orden en Flow y mostramos el link para enviarlo.
      // IMPORTANTE: a Flow se le pasa el quote_id (no el id), porque el webhook de
      // confirmación resuelve la reserva por quote_id.
      if (method === 'flow') {
        if (!amount || amount <= 0) {
          toast.success('Reserva creada. Sin monto no se pudo generar el link de pago.')
        } else {
          try {
            const payRes = await fetch('/api/payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId: createdQuoteId,
                amount,
                email: newBooking.client_email,
                subject: `Mudanza ${createdQuoteId} - Yo Me Encargo`,
                paymentType: newBooking.payment_type || 'completo',
              })
            })
            const payData = await payRes.json().catch(() => ({}))
            if (!payRes.ok || !payData?.paymentUrl) {
              throw new Error(payData?.error || 'No se pudo generar el link de pago')
            }
            setPaymentLink({
              url: payData.paymentUrl,
              clientName: newBooking.client_name,
              clientPhone: newBooking.client_phone,
              amount,
              kind: 'nueva',
            })
            toast.success('Reserva creada y link de pago generado')
          } catch (payErr) {
            console.error('Error generando link de pago:', payErr)
            toast.error(
              payErr instanceof Error
                ? `Reserva creada, pero el link falló: ${payErr.message}`
                : 'Reserva creada, pero falló el link de pago'
            )
          }
        }
      } else {
        const label = method === 'transfer' ? 'transferencia' : 'efectivo'
        if (created.paymentLedgerRecorded !== false) toast.success(
          newBooking.payment_paid
            ? `Reserva creada y marcada como pagada (${label})`
            : `Reserva creada, pago pendiente por ${label}`
        )
      }

      setShowAddModal(false)
      setNewBooking({ ...EMPTY_NEW_BOOKING })
      setSelectedCustomerEmail('manual')
      fetchBookings()
    } catch (error) {
      console.error('Error creating booking:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear la reserva')
    } finally {
      setCreating(false)
    }
  }

  const escapeCsvValue = (value: any) => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    // Escapar comillas y envolver en comillas si contiene coma, comilla o salto de línea
    const needsQuotes = /[",\n]/.test(str)
    const escaped = str.replace(/"/g, '""')
    return needsQuotes ? `"${escaped}"` : escaped
  }

  const handleExportCSV = () => {
    // Timestamps ISO (created_at, confirmed_at, ...) -> fecha/hora legibles en hora de Chile.
    const fmtDateCL = (value: any) => {
      if (!value) return ''
      const dt = new Date(value)
      if (Number.isNaN(dt.getTime())) return ''
      return new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(dt)
    }
    const fmtTimeCL = (value: any) => {
      if (!value) return ''
      const dt = new Date(value)
      if (Number.isNaN(dt.getTime())) return ''
      return new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(dt)
    }
    // scheduled_date es 'YYYY-MM-DD' (fecha sin hora): se reformatea como string para
    // evitar el corrimiento de día que produciría new Date() al interpretarla en UTC.
    const fmtSchedDate = (value: any) => {
      if (!value) return ''
      const [y, m, d] = String(value).slice(0, 10).split('-')
      return y && m && d ? `${d}-${m}-${y}` : String(value)
    }
    const fmtSchedTime = (value: any) => (value ? String(value).slice(0, 5) : '')

    const columns: { header: string; value: (b: any) => any }[] = [
      // El código va primero: es el que se usa para hablar de una reserva. El UUID y el
      // quote_id quedan porque sirven para cruzar con Flow y con el histórico.
      { header: 'Código', value: (b) => b.code || '' },
      { header: 'ID cliente', value: (b) => b.customer_id || '' },
      { header: 'ID', value: (b) => b.id },
      { header: 'Reserva', value: (b) => b.quote_id },
      { header: 'Cliente', value: (b) => b.client_name },
      { header: 'Email', value: (b) => b.client_email },
      { header: 'Teléfono', value: (b) => b.client_phone },
      { header: 'Origen cliente', value: (b) => getSourceLabel(b.source) },
      { header: 'Tipo cliente', value: (b) => (b.is_company ? 'Empresa' : 'Persona') },
      { header: 'Razón social', value: (b) => b.company_name || '' },
      { header: 'RUT empresa', value: (b) => b.company_rut || '' },
      {
        header: 'Tipo',
        value: (b) =>
          b.booking_type ||
          (String(b.quote_id || '').startsWith('DOMICILIO-') ? 'domicilio' : 'online'),
      },
      { header: 'Fecha mudanza', value: (b) => fmtSchedDate(b.scheduled_date) },
      { header: 'Hora mudanza', value: (b) => fmtSchedTime(b.scheduled_time) },
      { header: 'Duración (horas)', value: (b) => b.duration_hours },
      { header: 'Camión', value: (b) => vehicleOf(b)?.name || 'Sin asignar' },
      { header: 'Estado', value: (b) => b.status },
      { header: 'Estado de pago', value: (b) => b.payment_status },
      { header: 'Tipo de pago', value: (b) => b.payment_type },
      { header: 'Volumen m³', value: (b) => bookingVolumeM3(b) },
      { header: 'Precio cotizado', value: (b) => b.original_price ?? b.total_price },
      { header: 'Precio final reajustado', value: (b) => servicePrice(b) },
      { header: 'Monto pagado real', value: (b) => actualPaidAmount(b) },
      { header: 'Saldo pendiente', value: (b) => pendingAmount(b) },
      { header: 'Documento', value: (b) => taxDocumentLabel(b.tax_document) },
      { header: 'Neto', value: (b) => ivaBreakdown(servicePrice(b), b.tax_document)?.neto ?? '' },
      { header: 'IVA 19%', value: (b) => ivaBreakdown(servicePrice(b), b.tax_document)?.iva ?? '' },
      { header: 'Pagado neto', value: (b) => ivaBreakdown(actualPaidAmount(b), b.tax_document)?.neto ?? '' },
      { header: 'Pagado IVA', value: (b) => ivaBreakdown(actualPaidAmount(b), b.tax_document)?.iva ?? '' },
      { header: 'Motivo reajuste', value: (b) => b.adjustment_comment || '' },
      { header: 'Dirección origen', value: (b) => b.origin_address },
      { header: 'Dirección destino', value: (b) => b.destination_address },
      { header: 'Notas', value: (b) => b.notes },
      { header: 'Paradas', value: (b) => summarizeStops(normalizeStops(b.stops)) },
      {
        header: 'Notas del chofer',
        value: (b) =>
          (b.driver_notes || [])
            .map((n: { note: string }) => n.note)
            .join(' | '),
      },
      { header: 'Fecha creación', value: (b) => fmtDateCL(b.created_at) },
      { header: 'Hora creación', value: (b) => fmtTimeCL(b.created_at) },
      { header: 'Fecha confirmación', value: (b) => fmtDateCL(b.confirmed_at) },
      { header: 'Hora confirmación', value: (b) => fmtTimeCL(b.confirmed_at) },
      { header: 'Fecha completada', value: (b) => fmtDateCL(b.completed_at) },
      { header: 'Hora completada', value: (b) => fmtTimeCL(b.completed_at) },
      { header: 'Fecha cancelación', value: (b) => fmtDateCL(b.cancelled_at) },
      { header: 'Hora cancelación', value: (b) => fmtTimeCL(b.cancelled_at) },
    ]

    const headerRow = columns.map((c) => escapeCsvValue(c.header)).join(',')
    const rows = filteredBookings.map((b) => columns.map((c) => escapeCsvValue(c.value(b))).join(','))
    // BOM para que Excel interprete bien los acentos de los encabezados.
    const csv = '\uFEFF' + [headerRow, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    link.href = url
    link.download = `reservas_${y}-${m}-${d}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleDelete = async (bookingId: string) => {
    try {
      const ok = confirm('¿Eliminar esta reserva? Esta acción no se puede deshacer.')
      if (!ok) return
      const response = await fetch(`/api/admin/bookings/${bookingId}`, { method: 'DELETE' })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.error || 'Error al eliminar la reserva')
      }
      toast.success('Reserva eliminada')
      fetchBookings()
    } catch (error) {
      console.error('Error deleting booking:', error)
      toast.error(error instanceof Error ? error.message : 'Error al eliminar la reserva')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando reservas...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-archivo font-extrabold tracking-tight text-gray-900">Gestión de Reservas</h2>
          <p className="text-sm text-gray-500">
            {filteredBookings.length} de {bookings.length} reservas · {resolvePeriod(period).label}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodFilter value={period} onChange={setPeriod} presets={['all', 'day', 'tomorrow', 'week', 'month', 'custom']} />
          <Button onClick={() => fetchBookings()} variant="outline" size="sm">
            🔄 Actualizar
          </Button>
          <Button onClick={handleExportCSV} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" /> Exportar CSV
          </Button>
          <Button onClick={() => setShowAddModal(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" /> Nueva Reserva
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Buscar
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Cliente, email, teléfono..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Servicio
            </label>
            <Select
              value={bookingTypeFilter}
              onChange={(e) => setBookingTypeFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Todos los tipos' },
                { value: 'online', label: 'Mudanza Online' },
                { value: 'domicilio', label: 'Cotización a Domicilio' },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estado
            </label>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Todos los estados' },
                { value: 'por_cobrar', label: 'Por cobrar (falta pagar)' },
                { value: 'provisional', label: 'Sin pagar (provisional)' },
                { value: 'saldo_pendiente', label: 'Abonó 50% — falta el saldo' },
                { value: 'pending', label: 'Pendiente' },
                { value: 'confirmed', label: 'Confirmado' },
                { value: 'completed', label: 'Completado' },
                { value: 'no_show', label: 'No atendido' },
                { value: 'cancelled', label: 'Cancelado' },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de cliente
            </label>
            <Select
              value={clientTypeFilter}
              onChange={(e) => setClientTypeFilter(e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                { value: 'company', label: 'Empresa' },
                { value: 'person', label: 'Persona' },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Origen cliente
            </label>
            <Select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              options={[{ value: 'all', label: 'Todos los orígenes' }, ...SOURCE_OPTIONS]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Camión
            </label>
            <Select
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Todos los camiones' },
                ...fleet.map((v) => ({
                  value: String(v.id),
                  label: v.driver ? `${v.name} · ${v.driver}` : v.name,
                })),
                { value: 'unassigned', label: 'Sin asignar' },
              ]}
            />
          </div>

          <div className="flex items-end justify-end">
            <Button
              onClick={() => {
                setSearchTerm('')
                setStatusFilter('all')
                setBookingTypeFilter('all')
                setClientTypeFilter('')
                setSourceFilter('all')
                setVehicleFilter('all')
                setPeriod(periodOf('all'))
              }}
              variant="outline"
              size="sm"
              className="whitespace-nowrap px-3"
            >
              <Filter className="w-4 h-4 mr-2" />
              Limpiar Filtros
            </Button>
          </div>
        </div>
      </Card>

      {selectedBookingIds.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2">
          <span className="text-sm font-medium text-gray-700">
            {selectedBookingIds.size} seleccionada{selectedBookingIds.size !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-gray-500">Cambiar estado a:</span>
          <Button onClick={() => bulkUpdateBookingStatus('confirmed')} variant="outline" size="sm" disabled={bulkUpdating}>
            Confirmado
          </Button>
          <Button onClick={() => bulkUpdateBookingStatus('completed')} variant="outline" size="sm" disabled={bulkUpdating}>
            Completado
          </Button>
          <Button onClick={() => bulkUpdateBookingStatus('no_show')} variant="outline" size="sm" disabled={bulkUpdating}>
            No atendido
          </Button>
          <Button onClick={() => bulkUpdateBookingStatus('cancelled')} variant="outline" size="sm" disabled={bulkUpdating}>
            Cancelado
          </Button>
          <button
            onClick={() => setSelectedBookingIds(new Set())}
            className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline"
            disabled={bulkUpdating}
          >
            Limpiar selección
          </button>
        </div>
      )}

      {/* Bookings Table */}
      <Card className="overflow-hidden">
        {filteredBookings.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No se encontraron reservas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left w-8">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todas"
                      className="w-4 h-4 rounded border-gray-300 text-secondary-600 focus:ring-secondary-500"
                      checked={filteredBookings.length > 0 && filteredBookings.every(b => selectedBookingIds.has(b.id))}
                      onChange={toggleSelectAllBookings}
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cliente
                  </th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tipo
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha y Hora
                  </th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Camión
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Volumen
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Montos
                  </th>
                  <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contacto
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredBookings.map((booking) => {
                  // Detectar tipo por campo booking_type o por prefijo del quote_id
                  const isDomicilio = booking.booking_type === 'domicilio' || 
                                     (booking.quote_id && booking.quote_id.startsWith('DOMICILIO-'))
                  const bookingType = isDomicilio ? 'domicilio' : 'online'
                  const isLegacyCustomer = normalizeOrigin(booking.source) === 'cliente_antiguo'
                  
                  return (
                  <tr
                    key={booking.id}
                    className={isLegacyCustomer
                      ? 'bg-emerald-50/70 hover:bg-emerald-100/80 transition-colors'
                      : 'hover:bg-gray-50 transition-colors'}
                  >
                    <td className="px-4 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${booking.client_name}`}
                        className="w-4 h-4 rounded border-gray-300 text-secondary-600 focus:ring-secondary-500"
                        checked={selectedBookingIds.has(booking.id)}
                        onChange={() => toggleBookingSelection(booking.id)}
                      />
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      <div>
                        <div className="flex items-center gap-1.5">
                          {/* El nombre abre el detalle de la reserva (lo mismo que el ojo). */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedBooking(booking)
                              setShowDetailsModal(true)
                            }}
                            title="Ver el detalle de la reserva"
                            className="text-left text-sm font-medium text-gray-900 hover:text-primary-600 hover:underline"
                          >
                            {booking.client_name}
                          </button>
                          {!['cancelled', 'completed', 'no_show'].includes(booking.status) &&
                            (contacts[booking.id] ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700"
                                title={`Contactado por ${contacts[booking.id].channel === 'email' ? 'correo' : 'WhatsApp'} el ${new Date(contacts[booking.id].at).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${contacts[booking.id].by ? ` por ${contacts[booking.id].by}` : ''}`}
                              >
                                <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
                                Contactado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-700" title="Nadie ha abierto su WhatsApp o correo desde el panel">
                                <span className="h-2 w-2 rounded-full bg-orange-500" aria-hidden />
                                Sin contactar
                              </span>
                            ))}
                          {booking.is_frequent && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200" title="Cliente frecuente">
                              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" /> Frecuente
                            </span>
                          )}
                          {isLegacyCustomer && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Cliente antiguo
                            </span>
                          )}
                          {booking.is_company ? (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700 border border-purple-200"
                              title={`${booking.company_name || ''} ${booking.company_rut ? `(${booking.company_rut})` : ''}`.trim()}
                            >
                              Empresa
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                              Persona
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <span title={`ID: ${booking.quote_id}`}>{booking.code || booking.quote_id}</span>
                          <OriginBadge booking={booking} />
                          {/* El origen «Cliente antiguo» ya va como etiqueta junto al nombre. */}
                          {booking.from_prospect && !isLegacyCustomer && (
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${getSourceBadge(booking.source)}`}
                              title="Origen comercial del cliente"
                            >
                              {getSourceLabel(booking.source)}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                      <td className="hidden md:table-cell px-4 py-2 align-top whitespace-nowrap">
                        {isDomicilio ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                            🏠 Domicilio
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                            📦 Online
                          </span>
                        )}
                      </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {(() => {
                          const [y, m, d] = booking.scheduled_date.split('-').map(Number)
                          const localDate = new Date(y, (m || 1) - 1, d || 1)
                          return format(localDate, 'dd/MM/yyyy', { locale: es })
                        })()}
                      </div>
                      <div className="text-sm text-gray-500">
                        {booking.scheduled_time}
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-2 align-top whitespace-nowrap">
                      {(() => {
                        const vehicle = vehicleOf(booking)
                        const color = vehicle ? vehicle.color : UNASSIGNED_COLOR
                        return (
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold"
                            style={{ backgroundColor: color.soft, color: color.ink }}
                            title={vehicle?.driver ? `Chofer: ${vehicle.driver}` : undefined}
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: color.hex }}
                              aria-hidden
                            />
                            {vehicle ? vehicle.name : 'Sin asignar'}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(booking.status)}`}>
                          {getStatusIcon(booking.status)}
                          {getStatusLabel(booking.status)}
                        </span>
                        {booking.is_provisional && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600 border border-gray-300" title="Pre-reserva: el cliente aún no paga. No ocupa cupo.">
                            Sin pagar
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      {(() => {
                        const volume = bookingVolumeM3(booking)
                        return volume !== undefined ? (
                          <div>
                            <div className="text-sm font-bold text-gray-900">
                              {volume.toFixed(2)} m³
                            </div>
                            <div className="text-[11px] text-gray-500">
                              {booking.items_summary?.reduce(
                                (sum, item) => sum + (Number(item.quantity) || 0),
                                0
                              ) || 0}{' '}
                              bultos
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      {servicePrice(booking) > 0 ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">
                              ${servicePrice(booking).toLocaleString('es-CL')}
                            </span>
                            <TaxDocumentBadge document={booking.tax_document} total={servicePrice(booking)} />
                          </div>
                          {booking.adjusted_price != null && (
                            <div className="text-[11px] font-medium text-purple-700">
                              Reajustado · antes ${Number(
                                booking.original_price || booking.total_price || 0
                              ).toLocaleString('es-CL')}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span className="font-semibold text-green-700">
                              Pagado ${actualPaidAmount(booking).toLocaleString('es-CL')}
                            </span>
                            {pendingAmount(booking) > 0 ? (
                              <>
                                <span className="font-bold text-orange-700">
                                  Falta ${pendingAmount(booking).toLocaleString('es-CL')}
                                </span>
                                {!String(booking.quote_id || '').startsWith('ADMIN-BLOQUEO-') && (
                                  <button
                                    type="button"
                                    onClick={() => setPayingBooking(booking)}
                                    className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-green-700 hover:bg-green-50"
                                    title="Anotar un pago recibido por transferencia o efectivo"
                                  >
                                    <DollarSign className="h-3 w-3" />
                                    Registrar pago
                                  </button>
                                )}
                              </>
                            ) : actualPaidAmount(booking) > 0 ? (
                              <span className="font-medium text-green-700">✓ Sin saldo</span>
                            ) : booking.payment_status === 'pending' ? (
                              <span className="font-medium text-yellow-700">⏳ Pago pendiente</span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-2 align-top whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {booking.client_phone}
                      </div>
                      <div className="text-sm text-gray-500">
                        {booking.client_email}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap text-sm font-medium">
                      {/* A la vista, lo de todos los días: ver, WhatsApp, editar y PDF. Lo
                          ocasional va en «Más», para que la fila no se estire. */}
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          onClick={() => {
                            setSelectedBooking(booking)
                            setShowDetailsModal(true)
                          }}
                          variant="outline"
                          size="sm"
                          title="Ver detalles"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {(() => {
                          const waLink = buildWhatsappLink(booking)
                          const motivo = whatsAppUnavailableReason(booking.client_phone)
                          return (
                            <Button
                              onClick={() => {
                                if (!waLink) return
                                openWhatsApp(waLink, booking.client_phone)
                                markContacted(booking, 'whatsapp')
                              }}
                              variant="outline"
                              size="sm"
                              disabled={!waLink}
                              className="text-green-700 border-green-300 bg-green-50 hover:bg-green-100 disabled:opacity-40"
                              title={motivo || 'Contactar por WhatsApp'}
                            >
                              <MessageCircle className="w-4 h-4" />
                            </Button>
                          )
                        })()}
                        <Button
                          onClick={() => openEditBooking(booking)}
                          variant="outline"
                          size="sm"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <PdfDownloadMenu
                          data={bookingToAdminQuoteData(booking)}
                          compact
                        />
                        <RowMenu
                          items={[
                            { label: 'Cambiar fecha y hora', icon: CalendarClock, onClick: () => setQuickReschedule(booking) },
                            // Pago y cierre: solo lo que aplica al estado de esta reserva.
                            !isDomicilio && booking.payment_status === 'pending' && {
                              label: 'Marcar como pagado',
                              icon: DollarSign,
                              onClick: () => {
                                if (confirm('¿Marcar este pago como pagado?')) updatePaymentStatus(booking.id, 'approved')
                              },
                            },
                            booking.payment_type === 'mitad' && booking.payment_status === 'approved' && !isDomicilio && {
                              label: 'Marcar pago completo',
                              icon: DollarSign,
                              onClick: () => {
                                if (confirm('¿Cambiar el estado de pago de "mitad" a "completo"?')) updatePaymentType(booking.id, 'completo')
                              },
                            },
                            isDomicilio && booking.status !== 'completed' && booking.payment_status === 'approved' && {
                              label: 'Marcar visitado',
                              icon: Eye,
                              onClick: () => {
                                if (confirm('¿Marcar este servicio a domicilio como completado?')) updateBookingStatus(booking.id, 'completed')
                              },
                            },
                            !['completed', 'cancelled', 'no_show'].includes(booking.status) && {
                              label: 'No atendido',
                              icon: UserX,
                              hint: 'El cliente no se presentó o no se pudo atender',
                              onClick: () => {
                                if (confirm('¿Marcar como "No atendido"? Úsalo cuando el cliente no se presentó o no fue posible atenderlo. Saldrá de la vista principal.')) {
                                  updateBookingStatus(booking.id, 'no_show')
                                }
                              },
                            },
                            {
                              label: 'Escribir por correo',
                              icon: Mail,
                              onClick: () => {
                                markContacted(booking, 'email')
                                window.open(buildEmailLink(booking), '_self')
                              },
                            },
                            {
                              label: booking.is_frequent ? 'Quitar de frecuentes' : 'Marcar cliente frecuente',
                              icon: Star,
                              onClick: () => toggleFrequentCustomer(booking),
                            },
                            { label: 'Agregar a Google Calendar', icon: Calendar, onClick: () => window.open(buildGoogleCalendarUrl(booking), '_blank') },
                            { label: 'Descargar .ics', icon: Calendar, hint: 'Apple, Outlook o Google', onClick: () => downloadIcs(booking) },
                            { label: 'Eliminar', icon: Trash2, danger: true, onClick: () => handleDelete(booking.id) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          if (capacityWarning) setCapacityWarning(null)
          else setShowAddModal(false)
        }}
        title={capacityWarning ? 'Confirmar sobrecupo' : (blockOnly ? 'Bloquear Horario' : 'Nueva Reserva')}
      >
        {capacityWarning ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <AlertTriangle className="mt-0.5 h-6 w-6 flex-none text-amber-700" />
              <div>
                <p className="font-semibold text-amber-950">
                  {capacityWarning.reason === 'blocked'
                    ? 'Este horario está bloqueado'
                    : 'Este horario alcanzó su capacidad'}
                </p>
                <p className="mt-1 text-sm text-amber-900">{capacityWarning.message}</p>
                <p className="mt-3 text-sm text-amber-900">
                  Estás por agendar igualmente el{' '}
                  <strong>{newBooking.scheduled_date}</strong> a las{' '}
                  <strong>{newBooking.scheduled_time}</strong>. La reserva quedará registrada como
                  sobrecupo administrativo.
                </p>
                {capacityWarning.reason === 'full' && (
                  <p className="mt-2 text-xs text-amber-800">
                    Ocupación actual: {capacityWarning.activeBookings}/{capacityWarning.capacity}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setCapacityWarning(null)} variant="outline" disabled={creating}>
                Volver y cambiar horario
              </Button>
              <Button
                onClick={() => {
                  setCapacityWarning(null)
                  void handleCreate(true)
                }}
                disabled={creating}
                className="bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-500"
              >
                {creating ? 'Guardando...' : 'Agendar de todos modos'}
              </Button>
            </div>
          </div>
        ) : (
        <div className="space-y-4">
          {requestInForm && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <strong>Aprobando la solicitud {requestInForm.code}</strong> ({SERVICE_TYPE_LABEL[requestInForm.serviceType]}
              {requestInForm.company ? ` · ${requestInForm.company.razon_social}` : ''}). Revisa fecha y hora, ponle el
              precio y guarda: la solicitud queda aprobada y el cliente la ve como reserva en su panel.
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              id="blockOnly"
              type="checkbox"
              checked={blockOnly}
              onChange={(e) => setBlockOnly(e.target.checked)}
            />
            <label htmlFor="blockOnly" className="text-sm text-gray-700">Reservar cupo (1 camión) sin cliente</label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
              <Input
                type="date"
                value={newBooking.scheduled_date}
                onChange={(e) => setNewBooking({ ...newBooking, scheduled_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hora</label>
              <Input
                type="time"
                value={newBooking.scheduled_time}
                onChange={(e) => setNewBooking({ ...newBooking, scheduled_time: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duración (horas)</label>
              <Input
                type="number"
                min="1"
                max="12"
                value={String(newBooking.duration_hours)}
                onChange={(e) => setNewBooking({ ...newBooking, duration_hours: Number(e.target.value) as any })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Camión</label>
              {/* Select nativo: el componente Select del sistema no admite opciones
                  deshabilitadas, y acá hace falta mostrar el camión ocupado y POR QUÉ no
                  se puede elegir, no esconderlo. */}
              <select
                value={newBooking.vehicle_choice}
                onChange={(e) => setNewBooking({ ...newBooking, vehicle_choice: e.target.value })}
                disabled={!newBooking.scheduled_date || !newBooking.scheduled_time}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="auto">
                  {(() => {
                    const rec = fleetAvailability?.vehicles.find(
                      (v) => v.id === fleetAvailability?.recommendedVehicleId
                    )
                    return rec ? `Automático (recomendado: ${rec.name})` : 'Automático'
                  })()}
                </option>
                {(fleetAvailability?.vehicles || []).map((v) => {
                  const motivo =
                    v.status === 'maintenance'
                      ? ' — en mantención'
                      : !v.available
                        ? ` — ocupado ${v.overlapping.map((o) => `${o.from}–${o.to}`).join(', ')}`
                        : ''
                  return (
                    <option key={v.id} value={String(v.id)} disabled={Boolean(motivo)}>
                      {v.name}
                      {motivo}
                    </option>
                  )
                })}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {!newBooking.scheduled_date || !newBooking.scheduled_time
                  ? 'Elige fecha y hora para ver qué camiones están libres.'
                  : fleetAvailabilityLoading
                    ? 'Revisando camiones…'
                    : fleetAvailability && !fleetAvailability.recommendedFits
                      ? 'Ningún camión está libre a esa hora: «Automático» asignará el de menos choques.'
                      : 'Automático llena primero un camión antes de usar el siguiente.'}
              </p>
            </div>
            {!blockOnly && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <Select
                  value={newBooking.status}
                  onChange={(e) => setNewBooking({ ...newBooking, status: e.target.value })}
                  options={[
                    { value: 'pending', label: 'Pendiente' },
                    { value: 'confirmed', label: 'Confirmado' },
                    { value: 'completed', label: 'Completado' },
                    { value: 'cancelled', label: 'Cancelado' },
                  ]}
                />
              </div>
            )}
          </div>

          {!blockOnly && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cliente existente (opcional)</label>
                  <Select
                    value={selectedCustomerEmail}
                    onChange={(e) => selectExistingCustomer(e.target.value)}
                    options={[
                      { value: 'manual', label: 'Ingresar datos manualmente' },
                      ...customers.map((customer) => ({
                        value: customer.email,
                        label: `${customer.name}${customer.isFrequent ? ' · Frecuente' : ''}`,
                      })),
                    ]}
                  />
                  <p className="mt-1 text-xs text-gray-500">Al elegirlo se completan sus datos y origen.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Origen del cliente</label>
                  <Select
                    value={newBooking.customer_origin}
                    onChange={(e) => setNewBooking({ ...newBooking, customer_origin: e.target.value })}
                    options={SOURCE_OPTIONS}
                  />
                  <p className="mt-1 text-xs text-gray-500">Define dónde se contabilizará esta reserva.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Cliente</label>
                <Input
                  type="text"
                  value={newBooking.client_name}
                  onChange={(e) => setNewBooking({ ...newBooking, client_name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <Input
                  type="email"
                  value={newBooking.client_email}
                  onChange={(e) => setNewBooking({ ...newBooking, client_email: e.target.value })}
                />
                {newBooking.client_email.trim() !== '' && !isValidEmail(newBooking.client_email) && (
                  <p className="mt-1 text-xs text-red-600">
                    No es un correo válido. Con un nombre en este campo el cliente no recibe avisos.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                <Input
                  type="tel"
                  value={newBooking.client_phone}
                  onChange={(e) => setNewBooking({ ...newBooking, client_phone: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ID Cotización (opcional)</label>
                <Input
                  type="text"
                  value={newBooking.quote_id}
                  onChange={(e) => setNewBooking({ ...newBooking, quote_id: e.target.value })}
                />
              </div>
              </div>
            </div>
          )}

          {!blockOnly && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dirección Origen</label>
                <Input
                  type="text"
                  value={newBooking.origin_address}
                  onChange={(e) => setNewBooking({ ...newBooking, origin_address: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dirección Destino</label>
                <Input
                  type="text"
                  value={newBooking.destination_address}
                  onChange={(e) => setNewBooking({ ...newBooking, destination_address: e.target.value })}
                />
              </div>
            </div>
          )}

          {!blockOnly && (
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Datos del trabajo</p>
                <p className="text-xs text-gray-500">
                  Opcionales, pero son los que usa el detalle de la reserva para saber qué recursos pide el trabajo.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex gap-2">
                  <div className="w-24 shrink-0">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Piso origen</label>
                    <Input
                      type="number"
                      min="0"
                      max="80"
                      value={newBooking.origin_floor}
                      onChange={(e) => setNewBooking({ ...newBooking, origin_floor: e.target.value })}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Ascensor en origen</label>
                    <Select
                      value={newBooking.origin_has_elevator}
                      onChange={(e) => setNewBooking({ ...newBooking, origin_has_elevator: e.target.value })}
                      options={OPCIONES_ASCENSOR}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-24 shrink-0">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Piso destino</label>
                    <Input
                      type="number"
                      min="0"
                      max="80"
                      value={newBooking.destination_floor}
                      onChange={(e) => setNewBooking({ ...newBooking, destination_floor: e.target.value })}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Ascensor en destino</label>
                    <Select
                      value={newBooking.destination_has_elevator}
                      onChange={(e) => setNewBooking({ ...newBooking, destination_has_elevator: e.target.value })}
                      options={OPCIONES_ASCENSOR}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Personas (con chofer)</label>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    value={newBooking.people_needed}
                    onChange={(e) => setNewBooking({ ...newBooking, people_needed: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Volumen (m³)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={newBooking.volume_m3}
                    onChange={(e) => setNewBooking({ ...newBooking, volume_m3: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Distancia (km)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={newBooking.distance_km}
                    onChange={(e) => setNewBooking({ ...newBooking, distance_km: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {!blockOnly && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Método de cobro
                  </label>
                  <Select
                    value={newBooking.payment_method}
                    onChange={(e) =>
                      setNewBooking({ ...newBooking, payment_method: e.target.value })
                    }
                    options={[
                      { value: 'flow', label: '💳 Link de pago (Flow)' },
                      { value: 'transfer', label: '🏦 Transferencia' },
                      { value: 'cash', label: '💵 Efectivo' },
                    ]}
                  />
                </div>

                {newBooking.payment_method !== 'flow' && (
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700 pb-2">
                      <input
                        type="checkbox"
                        checked={newBooking.payment_paid}
                        onChange={(e) =>
                          setNewBooking({ ...newBooking, payment_paid: e.target.checked })
                        }
                        className="w-4 h-4 rounded border-gray-300 text-secondary-600 focus:ring-secondary-500"
                      />
                      El cliente ya pagó
                    </label>
                  </div>
                )}
              </div>

              {newBooking.payment_method === 'flow' && (
                <p className="text-xs text-gray-600">
                  Al crear la reserva se genera el link de pago con el{' '}
                  <strong>precio del servicio</strong> y podrás copiarlo o enviarlo por WhatsApp.
                  El pago se confirma solo cuando el cliente paga.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Pago</label>
              <Select
                value={newBooking.payment_type}
                onChange={(e) => setNewBooking({ ...newBooking, payment_type: e.target.value })}
                options={[
                  { value: '', label: 'Seleccionar' },
                  { value: 'completo', label: 'Completo' },
                  { value: 'mitad', label: 'Mitad' },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio Original</label>
              <Input
                type="number"
                value={newBooking.original_price}
                onChange={(e) => setNewBooking({ ...newBooking, original_price: e.target.value })}
              />
            </div>
            <div>
              {/* Antes decía "Total Pagado", pero este campo es `total_price`: el precio
                  del servicio, no lo que el cliente entregó. El nombre hacía que se
                  cargara acá el monto pagado y quedara mal en todos lados. */}
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Precio del servicio
              </label>
              <Input
                type="number"
                value={newBooking.total_price}
                onChange={(e) => setNewBooking({ ...newBooking, total_price: e.target.value })}
              />
            </div>
          </div>

          {!blockOnly && (
            <TaxDocumentSelect
              value={newBooking.tax_document}
              onChange={(value) => setNewBooking({ ...newBooking, tax_document: value })}
              total={Number(newBooking.total_price) || 0}
            />
          )}

          {!blockOnly && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monto ya pagado{' '}
                <span className="font-normal text-gray-500">{newBooking.payment_paid ? '(obligatorio si ya pagó)' : '(dejar vacío si no pagó)'}</span>
              </label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Lo que el cliente ya entregó"
                value={newBooking.amount_paid}
                onChange={(e) => setNewBooking({ ...newBooking, amount_paid: e.target.value })}
              />
              <p className="mt-1 text-xs text-gray-500">
                Si lo dejas vacío, el sistema lo deduce del tipo de pago (mitad = 50%,
                completo = 100%). Cárgalo cuando el cliente pagó un monto distinto, por
                transferencia o efectivo. Después se puede corregir desde Editar.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{blockOnly ? 'Motivo del bloqueo' : 'Notas'}</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={3}
              value={newBooking.notes}
              onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
              placeholder={blockOnly ? 'Ej: Mantención, fuera de servicio, etc.' : 'Detalles de la reserva...'}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setShowAddModal(false)} variant="outline">Cancelar</Button>
            <Button onClick={() => void handleCreate(false)} disabled={creating}>{creating ? 'Guardando...' : (blockOnly ? 'Bloquear' : 'Crear Reserva')}</Button>
          </div>
        </div>
        )}
      </Modal>

      {/* Link de pago recién generado */}
      <Modal
        isOpen={!!paymentLink}
        onClose={() => setPaymentLink(null)}
        title="Link de pago generado"
      >
        {paymentLink && (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-start gap-3">
                <Link2 className="w-5 h-5 text-green-700 mt-0.5" />
                <div className="text-sm text-green-900">
                  {paymentLink.kind === 'saldo' ? (
                    <>
                      Link por el <strong>saldo</strong> de{' '}
                      <strong>{paymentLink.clientName || 'el cliente'}</strong>:{' '}
                      <strong>${paymentLink.amount.toLocaleString('es-CL')}</strong>. Cuando pague,
                      el monto se <strong>suma</strong> a lo ya cobrado en esta misma reserva.
                    </>
                  ) : (
                    <>
                      Reserva creada para <strong>{paymentLink.clientName || 'el cliente'}</strong>{' '}
                      por <strong>${paymentLink.amount.toLocaleString('es-CL')}</strong>. Envíale
                      este link para que pague. La reserva queda <strong>pendiente</strong> hasta
                      que Flow confirme el pago.
                    </>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link</label>
              <input
                type="text"
                readOnly
                value={paymentLink.url}
                onFocus={(e) => e.target.select()}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(paymentLink.url)
                    toast.success('Link copiado')
                  } catch {
                    toast.error('No se pudo copiar')
                  }
                }}
                variant="outline"
                size="sm"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copiar link
              </Button>

              {buildWhatsAppLink(paymentLink.clientPhone) && (
                <a
                  href={
                    buildWhatsAppLink(
                      paymentLink.clientPhone,
                      paymentLinkMessage(paymentLink.clientName, paymentLink.amount, paymentLink.url)
                    ) as string
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-green-700 border-green-300 hover:bg-green-50"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Enviar por WhatsApp
                  </Button>
                </a>
              )}

              <Button onClick={() => setPaymentLink(null)} size="sm" className="ml-auto">
                Listo
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Details Modal */}
      <Modal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        title="Detalles de la Reserva"
        size="xl"
      >
        {selectedBooking && (
          <div className="space-y-4">
            {/* Código de la reserva: es el número con el que se habla de ella por
                teléfono o en una planilla. No se dibuja si falta la migración. */}
            {selectedBooking.code && (
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-gray-900 px-2.5 py-1 font-mono text-sm font-semibold tracking-wide text-white">
                  {selectedBooking.code}
                </span>
                <OriginBadge booking={selectedBooking} />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(selectedBooking.code || '')
                      .then(() => toast.success('Código copiado'))
                      .catch(() => toast.error('No se pudo copiar'))
                  }}
                  className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
                >
                  copiar
                </button>
              </div>
            )}

            {/* Indicador de tipo de servicio */}
            {(() => {
              const isDomicilioDetail = selectedBooking.booking_type === 'domicilio' || 
                                       (selectedBooking.quote_id && selectedBooking.quote_id.startsWith('DOMICILIO-'))
              return (
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border-2 border-purple-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Servicio</label>
                      {isDomicilioDetail ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 border border-purple-300">
                          🏠 Cotización a Domicilio
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 border border-blue-300">
                          📦 Mudanza Online
                        </span>
                      )}
                    </div>
                    {selectedBooking.service_completed_at && (
                      <div className="text-right">
                        <label className="block text-xs font-medium text-gray-600">Servicio completado</label>
                        <p className="text-xs text-green-700 font-semibold">
                          {format(new Date(selectedBooking.service_completed_at), "dd/MM/yyyy HH:mm", { locale: es })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Resumen operacional: ruta, carga, recursos, operación, comercial e indicaciones.
                Reemplaza a los datos sueltos que había acá y trae el cambio de camión. */}
            <BookingOperationalSummary
              booking={selectedBooking}
              fleet={fleet}
              volumeM3={bookingVolumeM3(selectedBooking)}
              price={servicePrice(selectedBooking)}
              paid={actualPaidAmount(selectedBooking)}
              pending={pendingAmount(selectedBooking)}
              statusLabel={getStatusLabel(selectedBooking.status)}
              onVehicleChanged={(vehicleId) => {
                setSelectedBooking((prev) => (prev ? { ...prev, vehicle_id: vehicleId } : prev))
                setBookings((prev) => prev.map((b) => (b.id === selectedBooking.id ? { ...b, vehicle_id: vehicleId } : b)))
              }}
            />

            {/* Código de referido o cupón, aplicado por quien atiende (como en AppleFix). Al
                cambiar el precio se vuelve a leer la reserva. */}
            <BookingCouponBox
              bookingId={selectedBooking.id}
              onChanged={async () => {
                try {
                  const res = await fetch('/api/admin/bookings')
                  const list = await res.json()
                  if (!res.ok || !Array.isArray(list)) return
                  setBookings(list)
                  const fresh = list.find((b: Booking) => b.id === selectedBooking.id)
                  if (fresh) setSelectedBooking(fresh)
                } catch {
                  /* la lista se refresca sola al volver a la pestaña */
                }
              }}
            />

            <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Total del servicio
                </label>
                <p className="text-lg font-bold text-gray-900">
                  ${servicePrice(selectedBooking).toLocaleString('es-CL')}
                </p>
                {selectedBooking.adjusted_price != null && (
                  <p className="text-xs font-medium text-purple-700">
                    Reajustado desde ${Number(
                      selectedBooking.original_price || selectedBooking.total_price || 0
                    ).toLocaleString('es-CL')}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Monto pagado real
                </label>
                <p className="text-lg font-bold text-green-700">
                  ${actualPaidAmount(selectedBooking).toLocaleString('es-CL')}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Saldo pendiente
                </label>
                <p className={`text-lg font-bold ${pendingAmount(selectedBooking) > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                  ${pendingAmount(selectedBooking).toLocaleString('es-CL')}
                </p>
              </div>
              <div className="sm:col-span-2 border-t border-gray-200 pt-3">
                <TaxDocumentDetail
                  document={selectedBooking.tax_document}
                  total={servicePrice(selectedBooking)}
                  paid={actualPaidAmount(selectedBooking)}
                />
              </div>
              {selectedBooking.adjustment_comment && (
                <div className="sm:col-span-2 border-t border-gray-200 pt-3 text-sm text-gray-700">
                  <strong>Motivo del reajuste:</strong> {selectedBooking.adjustment_comment}
                  {selectedBooking.adjusted_by ? ` · ${selectedBooking.adjusted_by}` : ''}
                </div>
              )}
            </div>

            {/* Detalle de artículos por tipo de embalaje (solo consulta: los precios se
                corrigen sobre la cotización, en Prospectos). */}
            <QuoteItemsPricing
              items={normalizeAdminPdfItemsWithIndex(
                selectedBooking.items_summary,
                selectedBooking.total_volume
              )}
            />

            {selectedBooking.is_company && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <label className="block text-sm font-medium text-blue-900 mb-2">
                  📋 Información de Facturación
                </label>
                <div className="space-y-1">
                  <p className="text-sm text-blue-800">
                    <strong>Razón Social:</strong> {selectedBooking.company_name}
                  </p>
                  <p className="text-sm text-blue-800">
                    <strong>RUT:</strong> {selectedBooking.company_rut}
                  </p>
                </div>
              </div>
            )}

            {/* Lo que escribió el chofer DESPUÉS del trabajo, desde su link. Es de solo
                lectura acá: se agregan desde /trabajos, no se editan desde el panel. */}
            {(selectedBooking.driver_notes?.length || 0) > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Notas del chofer
                </label>
                <ul className="space-y-2">
                  {selectedBooking.driver_notes!.map((n) => (
                    <li key={n.id} className="border-l-2 border-slate-300 pl-3">
                      <p className="whitespace-pre-line text-sm text-slate-800">{n.note}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {new Date(n.created_at).toLocaleString('es-CL', {
                          timeZone: 'America/Santiago',
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {n.vehicle_label ? ` · ${n.vehicle_label}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Cobro del saldo. Solo aparece si queda algo por cobrar de verdad:
                `pendingAmount` devuelve 0 cuando se pagó completo, porque ahí el 5% de
                diferencia es el descuento por pagar por adelantado, no una deuda. */}
            {(() => {
              const saldo = pendingAmount(selectedBooking)
              if (saldo <= 0) return null
              const precio = servicePrice(selectedBooking)
              const pagado = actualPaidAmount(selectedBooking)
              return (
                <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-amber-900">Falta cobrar</p>
                      <p className="mt-0.5 text-2xl font-bold text-amber-900">
                        ${saldo.toLocaleString('es-CL')}
                      </p>
                      <p className="mt-0.5 text-xs text-amber-700">
                        Servicio ${precio.toLocaleString('es-CL')} · pagado $
                        {pagado.toLocaleString('es-CL')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-amber-900">
                            $
                          </span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1000}
                            value={montoCobro}
                            onChange={(e) => setMontoCobro(e.target.value)}
                            placeholder={String(saldo)}
                            className="w-36 rounded-lg border border-amber-300 bg-white py-1.5 pl-5 pr-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                          />
                        </div>
                        <Button
                          onClick={() => {
                            const n = Math.round(Number(montoCobro))
                            const parcial = montoCobro.trim() !== '' && n !== saldo
                            if (montoCobro.trim() !== '') {
                              if (!Number.isFinite(n) || n <= 0) {
                                toast.error('El monto a cobrar no es válido')
                                return
                              }
                              if (n > saldo) {
                                toast.error(
                                  `No se puede cobrar más que el saldo ($${saldo.toLocaleString('es-CL')})`
                                )
                                return
                              }
                              if (parcial && n < MIN_ABONO_CLP) {
                                toast.error(
                                  `El abono mínimo es $${MIN_ABONO_CLP.toLocaleString('es-CL')}`
                                )
                                return
                              }
                            }
                            void generarLinkDeSaldo(
                              selectedBooking,
                              montoCobro.trim() === '' ? undefined : n
                            )
                          }}
                          disabled={generandoSaldo === selectedBooking.id}
                          size="sm"
                        >
                          <Link2 className="mr-2 h-4 w-4" />
                          {generandoSaldo === selectedBooking.id ? 'Generando…' : 'Generar link'}
                        </Button>
                      </div>
                      <p className="text-[11px] text-amber-700">
                        Vacío cobra el saldo entero. Abono mínimo $
                        {MIN_ABONO_CLP.toLocaleString('es-CL')} — la reserva queda confirmada y
                        el resto sigue como saldo.
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Galería de fotos */}
            {(() => {
              // Parsear photo_urls (puede venir como string JSON o array)
              let photoUrls: string[] = []
              try {
                if (typeof selectedBooking.photo_urls === 'string') {
                  photoUrls = JSON.parse(selectedBooking.photo_urls)
                } else if (Array.isArray(selectedBooking.photo_urls)) {
                  photoUrls = selectedBooking.photo_urls
                }
              } catch (e) {
                console.error('Error parsing photo_urls:', e)
              }

              if (photoUrls.length > 0) {
                return (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <label className="block text-sm font-medium text-purple-900 mb-3">
                      📸 Fotos del Cliente ({photoUrls.length})
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {photoUrls.map((u) => toHiddenFileUrl(u)).map((url, index) => (
                        <div
                          key={index}
                          className="relative group rounded-lg overflow-hidden border-2 border-purple-200 hover:border-purple-400 transition-all cursor-pointer"
                          onClick={() => window.open(url, '_blank')}
                        >
                          <div className="aspect-square bg-gray-100">
                            <img
                              src={url}
                              alt={`Foto ${index + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm font-medium">
                              Ver en tamaño completo
                            </span>
                          </div>
                          <div className="absolute top-2 left-2 bg-white bg-opacity-90 px-2 py-1 rounded text-xs font-semibold text-gray-700">
                            #{index + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-purple-700 mt-2">
                      💡 Haz clic en cualquier foto para verla en tamaño completo
                    </p>
                  </div>
                )
              }
              return null
            })()}

            <BookingDocuments bookingId={selectedBooking.id} />

            <BookingHistory bookingId={selectedBooking.id} />

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="block text-sm font-medium text-green-900 mb-1">
                    📄 Comprobante de Reserva
                  </label>
                  <p className="text-xs text-green-700">
                    Elige la versión con precios (cliente) o sin precios (trabajadores).
                  </p>
                </div>
                <PdfDownloadMenu
                  data={bookingToAdminQuoteData(selectedBooking)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={() => setShowDetailsModal(false)}
                variant="outline"
              >
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Pago recibido fuera de Flow sobre el saldo. Ambos perfiles. */}
      <RegisterPaymentModal
        booking={payingBooking}
        total={payingBooking ? servicePrice(payingBooking) : 0}
        paid={payingBooking ? actualPaidAmount(payingBooking) : 0}
        pending={payingBooking ? pendingAmount(payingBooking) : 0}
        onClose={() => setPayingBooking(null)}
        onSaved={(id, result) => {
          setBookings((prev) =>
            prev.map((b) =>
              b.id === id ? { ...b, amount_paid: result.amount_paid, payment_status: 'approved' } : b
            )
          )
          setPayingBooking(null)
          fetchBookings({ silent: true })
        }}
      />

      {/* Cambio rápido: solo fecha y hora. Para lo demás, «Editar todo lo demás». */}
      <QuickRescheduleModal
        booking={quickReschedule}
        onClose={() => setQuickReschedule(null)}
        onSaved={(id, changes) => {
          setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...changes } : b)))
          setQuickReschedule(null)
          // Relee en silencio: el reparto de camiones puede haber cambiado con el horario.
          fetchBookings({ silent: true })
        }}
        onOpenFullEdit={() => {
          const booking = quickReschedule
          setQuickReschedule(null)
          if (booking) openEditBooking(booking)
        }}
      />

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Editar Reserva"
      >
        {selectedBooking && (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Fecha y hora del servicio</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                  <Input
                    type="date"
                    value={selectedBooking.scheduled_date || ''}
                    onChange={(e) =>
                      setSelectedBooking({ ...selectedBooking, scheduled_date: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hora</label>
                  <Input
                    type="time"
                    value={(selectedBooking.scheduled_time || '').slice(0, 5)}
                    onChange={(e) =>
                      setSelectedBooking({ ...selectedBooking, scheduled_time: e.target.value })
                    }
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Si el horario ya está ocupado, se avisa y puedes confirmar para dejar dos
                reservas a la misma hora.
              </p>
            </div>

            {/* Origen del cliente. OJO: no es un dato de la reserva, es del CLIENTE —
                se aplica por email a todas sus reservas, pasadas y futuras. Se edita acá
                porque Tomás lo busca en el contexto de la reserva, pero escribe en la
                misma ficha que la pestaña Clientes: una sola clasificación por persona. */}
            {selectedBooking.client_email && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Origen del cliente
                </label>
                <Select
                  value={editCustomerOrigin}
                  onChange={(e) => setEditCustomerOrigin(e.target.value)}
                  options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
                <p className="mt-2 text-xs text-gray-500">
                  Clasifica a <strong>{selectedBooking.client_name}</strong> y se aplica a
                  todas sus reservas, no solo a esta. Es la misma clasificación que se ve
                  en la pestaña Clientes.
                </p>
              </div>
            )}

            {/* Direcciones. Las de una visita a domicilio viven en otro campo
                (`visit_address`) y no tienen origen ni destino, así que se muestra el
                campo que corresponde al tipo de reserva y no dos casillas vacías. */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              {(() => {
                const esDomicilio =
                  selectedBooking.booking_type === 'domicilio' ||
                  Boolean(selectedBooking.quote_id?.startsWith('DOMICILIO-'))

                if (esDomicilio) {
                  return (
                    <>
                      <p className="mb-3 text-sm font-medium text-gray-700">
                        Dirección de la visita
                      </p>
                      <Input
                        type="text"
                        placeholder="Calle, número, comuna"
                        value={selectedBooking.visit_address || ''}
                        onChange={(e) =>
                          setSelectedBooking({ ...selectedBooking, visit_address: e.target.value })
                        }
                      />
                    </>
                  )
                }

                return (
                  <>
                    <p className="mb-3 text-sm font-medium text-gray-700">Direcciones</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Origen
                        </label>
                        <Input
                          type="text"
                          placeholder="Calle, número, comuna"
                          value={selectedBooking.origin_address || ''}
                          onChange={(e) =>
                            setSelectedBooking({
                              ...selectedBooking,
                              origin_address: e.target.value,
                            })
                          }
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            min="0"
                            placeholder="Piso"
                            value={
                              selectedBooking.origin_floor === null ||
                              selectedBooking.origin_floor === undefined
                                ? ''
                                : String(selectedBooking.origin_floor)
                            }
                            onChange={(e) =>
                              setSelectedBooking({
                                ...selectedBooking,
                                origin_floor:
                                  e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                          <Select
                            value={ascensorValor(selectedBooking.origin_has_elevator)}
                            onChange={(e) =>
                              setSelectedBooking({
                                ...selectedBooking,
                                origin_has_elevator: ascensorDesdeValor(e.target.value),
                              })
                            }
                            options={OPCIONES_ASCENSOR}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Destino
                        </label>
                        <Input
                          type="text"
                          placeholder="Calle, número, comuna"
                          value={selectedBooking.destination_address || ''}
                          onChange={(e) =>
                            setSelectedBooking({
                              ...selectedBooking,
                              destination_address: e.target.value,
                            })
                          }
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            min="0"
                            placeholder="Piso"
                            value={
                              selectedBooking.destination_floor === null ||
                              selectedBooking.destination_floor === undefined
                                ? ''
                                : String(selectedBooking.destination_floor)
                            }
                            onChange={(e) =>
                              setSelectedBooking({
                                ...selectedBooking,
                                destination_floor:
                                  e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                          <Select
                            value={ascensorValor(selectedBooking.destination_has_elevator)}
                            onChange={(e) =>
                              setSelectedBooking({
                                ...selectedBooking,
                                destination_has_elevator: ascensorDesdeValor(e.target.value),
                              })
                            }
                            options={OPCIONES_ASCENSOR}
                          />
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Piso y ascensor salen en la orden de trabajo, y “sin ascensor” va
                      destacado en rojo. Cambiar la dirección no recalcula la distancia ni
                      el precio: si el viaje cambia de largo, ajusta el monto en “Montos
                      del servicio”.
                    </p>
                    {(() => {
                      const paradas = paradasEnEdicion(selectedBooking)
                      const cambiarParadas = (nuevas: QuoteStop[]) =>
                        setSelectedBooking({ ...selectedBooking, stops: nuevas })
                      const cambiarParada = (i: number, campo: keyof QuoteStop, valor: string) =>
                        cambiarParadas(paradas.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)))
                      return (
                        <div className="mt-4 space-y-2">
                          <p className="text-sm font-medium text-gray-700">
                            Paradas entre origen y destino
                          </p>
                          {paradas.length === 0 && (
                            <p className="text-xs text-gray-500">Sin paradas.</p>
                          )}
                          {paradas.map((parada, i) => (
                            <div key={i} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-600">
                                  Parada {i + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => cambiarParadas(paradas.filter((_, j) => j !== i))}
                                  className="text-gray-400 hover:text-red-600"
                                  aria-label={`Quitar parada ${i + 1}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <Input
                                  type="text"
                                  placeholder="Calle"
                                  value={parada.street || ''}
                                  onChange={(e) => cambiarParada(i, 'street', e.target.value)}
                                />
                                <Input
                                  type="text"
                                  placeholder="Número"
                                  value={parada.number || ''}
                                  onChange={(e) => cambiarParada(i, 'number', e.target.value)}
                                />
                                <Input
                                  type="text"
                                  placeholder="Comuna"
                                  value={parada.commune || ''}
                                  onChange={(e) => cambiarParada(i, 'commune', e.target.value)}
                                />
                              </div>
                              <Input
                                type="text"
                                placeholder="Qué hay que hacer (ej. descargar unas cajas en una bodega)"
                                value={parada.note || ''}
                                onChange={(e) => cambiarParada(i, 'note', e.target.value)}
                              />
                            </div>
                          ))}
                          {paradas.length < MAX_PARADAS && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                cambiarParadas([...paradas, { street: '', number: '', commune: '' }])
                              }
                            >
                              <Plus className="mr-2 h-4 w-4" /> Agregar parada
                            </Button>
                          )}
                          <p className="text-xs text-gray-500">
                            Salen en la orden de trabajo y en el link del chofer, en orden. Igual
                            que las direcciones, no recalculan la distancia ni el precio.
                          </p>
                        </div>
                      )
                    })()}
                  </>
                )
              })()}
            </div>

            {/* Camión asignado: es el color con el que los choferes ven este trabajo. */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Camión asignado</label>
              <div className="flex flex-wrap gap-2">
                {fleet.map((vehicle) => {
                  const selected = selectedBooking.vehicle_id === vehicle.id
                  // Un camión en mantención está fuera de servicio: se muestra (para que
                  // se entienda de dónde salió una asignación vieja) pero no se puede elegir.
                  const inMaintenance = vehicle.status === 'maintenance'
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      disabled={inMaintenance}
                      title={inMaintenance ? 'En mantención: actívalo en Flota para usarlo' : undefined}
                      onClick={() =>
                        setSelectedBooking({ ...selectedBooking, vehicle_id: vehicle.id })
                      }
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                        selected ? 'ring-2 ring-offset-1 ring-gray-900' : 'opacity-70 hover:opacity-100'
                      } ${inMaintenance ? 'cursor-not-allowed line-through opacity-40 hover:opacity-40' : ''}`}
                      style={{ backgroundColor: vehicle.color.soft, color: vehicle.color.ink }}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: vehicle.color.hex }}
                        aria-hidden
                      />
                      {vehicle.name}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setSelectedBooking({ ...selectedBooking, vehicle_id: null })}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                    selectedBooking.vehicle_id == null
                      ? 'ring-2 ring-offset-1 ring-gray-900'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: UNASSIGNED_COLOR.soft, color: UNASSIGNED_COLOR.ink }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: UNASSIGNED_COLOR.hex }}
                    aria-hidden
                  />
                  Sin asignar
                </button>
              </div>
              {editTruckConflict && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>Atención:</strong> {editTruckConflict.vehicleName} ya tiene otro trabajo
                  que se pisa con esta reserva ({editTruckConflict.ranges}). Editar no bloquea
                  los choques de camión: si guardas, queda así.
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Lo que elijas acá manda. &quot;Sin asignar&quot; devuelve la reserva al reparto
                automático, que la pone en el primer camión libre a esa hora (llena uno antes
                de usar el siguiente).
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estado
              </label>
              <Select
                value={selectedBooking.status}
                onChange={(e) => {
                  setSelectedBooking({
                    ...selectedBooking,
                    status: e.target.value as any
                  })
                }}
                options={[
                  { value: 'pending', label: 'Pendiente' },
                  { value: 'confirmed', label: 'Confirmado' },
                  { value: 'completed', label: 'Completado' },
                  { value: 'no_show', label: 'No atendido' },
                  { value: 'cancelled', label: 'Cancelado' },
                ]}
              />
            </div>

            <TaxDocumentSelect
              value={selectedBooking.tax_document}
              onChange={(value) => setSelectedBooking({ ...selectedBooking, tax_document: value || null })}
              total={servicePrice(selectedBooking)}
            />

            {canAdjustAmounts && (
                <div className="space-y-4 rounded-lg border-2 border-purple-200 bg-purple-50 p-4">
                  <div>
                    <p className="font-semibold text-purple-900">Montos del servicio</p>
                    <p className="text-xs text-purple-700">
                      Sirve para reajustar el precio en terreno y para registrar lo que el
                      cliente pagó por fuera (transferencia o efectivo). Cada cambio queda
                      registrado en Actividad con el usuario, el monto anterior y el nuevo.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Monto final del servicio{' '}
                        <span className="font-normal text-gray-500">(opcional)</span>
                      </label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Déjalo vacío para no cambiarlo"
                        value={financialEdit.adjustedPrice}
                        onChange={(e) =>
                          setFinancialEdit({ ...financialEdit, adjustedPrice: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Monto pagado real
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={financialEdit.amountPaid}
                        onChange={(e) =>
                          setFinancialEdit({ ...financialEdit, amountPaid: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Motivo del reajuste
                    </label>
                    <textarea
                      className="w-full rounded-md border border-purple-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      rows={2}
                      value={financialEdit.comment}
                      onChange={(e) =>
                        setFinancialEdit({ ...financialEdit, comment: e.target.value })
                      }
                      placeholder="Ej: se agregaron 4 m³ y un ayudante en terreno"
                    />
                  </div>
                  <div className="flex justify-between rounded-md bg-white px-3 py-2 text-sm">
                    <span className="text-gray-600">Saldo resultante</span>
                    <strong className="text-purple-900">
                      ${Math.max(
                        0,
                        (Number(financialEdit.adjustedPrice) || 0) -
                          (Number(financialEdit.amountPaid) || 0)
                      ).toLocaleString('es-CL')}
                    </strong>
                  </div>
                </div>
              )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notas
              </label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={3}
                value={selectedBooking.notes || ''}
                onChange={(e) => {
                  setSelectedBooking({
                    ...selectedBooking,
                    notes: e.target.value
                  })
                }}
                placeholder="Agregar notas sobre esta reserva..."
              />
            </div>


            {/* Horario ocupado: se puede agendar igual, con confirmación explícita.
                NO sobrescribe la reserva que ya estaba — quedan las dos. */}
            {editCapacityWarning && (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
                  <div className="flex-1">
                    <p className="font-semibold text-amber-900">
                      {editCapacityWarning.reason === 'blocked'
                        ? 'Atención: ese horario está bloqueado en la agenda'
                        : 'Atención: ya existe una reserva en ese horario'}
                    </p>
                    <p className="mt-1 text-sm text-amber-900">{editCapacityWarning.message}</p>
                    {editCapacityWarning.reason === 'full' &&
                      (editCapacityWarning.unconfirmed || 0) > 0 && (
                        <p className="mt-1 text-sm text-amber-800">
                          Si esas reservas sin confirmar no se van a hacer, conviene
                          cancelarlas en vez de dejar dos en el mismo horario.
                        </p>
                      )}
                    <p className="mt-2 text-sm font-medium text-amber-900">
                      {editCapacityWarning.reason === 'blocked'
                        ? '¿Deseas agendar igual sobre el bloqueo?'
                        : '¿Deseas agregar otra reserva al mismo horario?'}
                    </p>
                    <p className="mt-1 text-xs text-amber-700">
                      {editCapacityWarning.reason === 'blocked'
                        ? 'El bloqueo se mantiene; esta reserva queda agendada igual.'
                        : 'La reserva que ya estaba no se toca: quedan las dos agendadas a la misma hora.'}{' '}
                      Queda registrado en Actividad.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={savingEdit}
                        onClick={async () => {
                          const saved = await saveBookingEdits(selectedBooking, true)
                          if (saved) setShowEditModal(false)
                        }}
                      >
                        {savingEdit ? 'Guardando…' : 'Sí, agendar igual'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingEdit}
                        onClick={() => setEditCapacityWarning(null)}
                      >
                        Elegir otro horario
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={() => {
                  setEditCapacityWarning(null)
                  setShowEditModal(false)
                }}
                variant="outline"
              >
                Cancelar
              </Button>
              <Button
                onClick={async () => {
                  // Solo cerramos si guardó: si el horario nuevo no tiene cupo, el modal
                  // queda abierto con el error para poder elegir otra hora.
                  const saved = await saveBookingEdits(selectedBooking)
                  if (saved) setShowEditModal(false)
                }}
              >
                Guardar Cambios
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/** «Web» o «Ingresada a mano»: cómo entró la reserva. */
function OriginBadge({ booking }: { booking: { created_via?: string | null; quote_id?: string | null } }) {
  const origin = bookingOrigin(booking)
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
        origin === 'web' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-700 border-slate-300'
      }`}
      title={origin === 'web' ? 'La reservó el cliente en la web' : 'La ingresó alguien del equipo desde el panel'}
    >
      {BOOKING_ORIGIN_LABEL[origin]}
    </span>
  )
}
