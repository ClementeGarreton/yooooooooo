'use client'

import { useState, useEffect, useCallback } from 'react'
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
  Link2
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import PdfDownloadMenu from './PdfDownloadMenu'
import {
  bookingToAdminQuoteData,
  type AdminBookingQuoteSource,
} from '@/lib/adminBookingQuoteData'
import { getSourceLabel, getSourceBadge } from '@/lib/prospectSource'
import { buildGoogleCalendarUrl, buildIcsContent, icsFileName } from '@/lib/calendarLinks'

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
  payment_type?: string
  payment_status?: string
  is_provisional?: boolean
  total_price?: number
  original_price?: number
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
  is_flexible?: boolean
  recommended_vehicle?: string
  total_volume?: number
  total_weight?: number
  total_distance?: number
  items_summary?: Array<{ name: string; quantity: number; volume: number }>
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
  payment_method: 'flow',
  payment_paid: false,
  total_price: '',
  original_price: '',
  origin_address: '',
  destination_address: '',
  notes: '',
}

/** Normaliza un teléfono chileno a formato wa.me (569XXXXXXXX). */
function toWhatsAppNumber(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('56')) return digits
  // 9 dígitos locales (9XXXXXXXX) => prefijo país
  if (digits.length === 9) return `56${digits}`
  return digits
}

interface BookingsManagementProps {
  /** Búsqueda precargada (p. ej. al abrir una reserva desde el dashboard con ?q=). */
  initialSearch?: string
}

export default function BookingsManagement({ initialSearch = '' }: BookingsManagementProps) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState('all')
  const [bookingTypeFilter, setBookingTypeFilter] = useState('all') // Nuevo filtro
  const [clientTypeFilter, setClientTypeFilter] = useState('') // '' | company | person
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [dateFilter, setDateFilter] = useState('all')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [blockOnly, setBlockOnly] = useState(false)
  const [newBooking, setNewBooking] = useState({ ...EMPTY_NEW_BOOKING })
  // Link de pago recién generado, para copiarlo o mandarlo por WhatsApp.
  const [paymentLink, setPaymentLink] = useState<{
    url: string
    clientName: string
    clientPhone: string
    amount: number
  } | null>(null)

  const fetchBookings = async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setLoading(true)
      const response = await fetch('/api/admin/bookings')
      const data = await response.json()
      console.log('[Admin] Bookings cargadas:', data.length)
      console.log('[Admin] Bookings con PDF:', data.filter((b: Booking) => b.pdf_url).length)
      setBookings(data)
    } catch (error) {
      console.error('Error fetching bookings:', error)
      if (!options.silent) toast.error('Error al cargar las reservas')
    } finally {
      if (!options.silent) setLoading(false)
    }
  }

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

    // Filtrar por fecha
    if (dateFilter !== 'all') {
      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const nextWeek = new Date(today)
      nextWeek.setDate(nextWeek.getDate() + 7)

      filtered = filtered.filter(booking => {
        // Parsear fecha como local para evitar desfase por UTC
        const [y, m, d] = booking.scheduled_date.split('-').map(Number)
        const bookingDate = new Date(y, (m || 1) - 1, d || 1)
        
        switch (dateFilter) {
          case 'today':
            return bookingDate.toDateString() === today.toDateString()
          case 'tomorrow':
            return bookingDate.toDateString() === tomorrow.toDateString()
          case 'week':
            return bookingDate >= today && bookingDate <= nextWeek
          case 'month':
            return bookingDate.getMonth() === today.getMonth() && 
                   bookingDate.getFullYear() === today.getFullYear()
          case 'range': {
            if (!customStartDate && !customEndDate) return true
            let inRange = true
            if (customStartDate) {
              const [sy, sm, sd] = customStartDate.split('-').map(Number)
              const start = new Date(sy, (sm || 1) - 1, sd || 1)
              inRange = inRange && bookingDate >= start
            }
            if (customEndDate) {
              const [ey, em, ed] = customEndDate.split('-').map(Number)
              const end = new Date(ey, (em || 1) - 1, ed || 1)
              // Incluir el día final completo
              end.setHours(23, 59, 59, 999)
              inRange = inRange && bookingDate <= end
            }
            return inRange
          }
          default:
            return true
        }
      })
    }

    // Filtrar por tipo de cliente (empresa vs persona natural)
    if (clientTypeFilter === 'company') {
      filtered = filtered.filter(b => b.is_company === true)
    } else if (clientTypeFilter === 'person') {
      filtered = filtered.filter(b => b.is_company !== true)
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
  }, [bookings, searchTerm, statusFilter, bookingTypeFilter, clientTypeFilter, dateFilter, customStartDate, customEndDate])

  useEffect(() => {
    fetchBookings()
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
  const saveBookingEdits = async (booking: Booking) => {
    try {
      const updateData: any = {
        status: booking.status,
        notes: booking.notes ?? '',
        // Reprogramación: el backend valida que haya cupo en el horario nuevo.
        scheduled_date: booking.scheduled_date,
        scheduled_time: booking.scheduled_time,
      }
      if (booking.status === 'completed') {
        updateData.service_completed_at = new Date().toISOString()
      }
      const response = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.error || 'Error al guardar')
      }
      toast.success('Reserva actualizada correctamente')
      fetchBookings()
      return true
    } catch (error) {
      console.error('Error saving booking edits:', error)
      toast.error(error instanceof Error ? error.message : 'Error al guardar los cambios')
      return false
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

  // WhatsApp: normaliza teléfono chileno y arma mensaje según la reserva
  const normalizePhoneCL = (raw?: string) => {
    const digits = (raw || '').replace(/\D/g, '')
    if (!digits) return ''
    if (digits.startsWith('56')) return digits
    if (digits.length === 9 && digits.startsWith('9')) return '56' + digits
    if (digits.length === 8) return '569' + digits
    return '56' + digits
  }

  const buildWhatsappLink = (b: Booking) => {
    const phone = normalizePhoneCL(b.client_phone)
    const firstName = b.client_name?.split(' ')[0] || ''
    let fechaTxt = ''
    if (b.scheduled_date) {
      const [y, m, d] = b.scheduled_date.split('-').map(Number)
      fechaTxt = format(new Date(y, (m || 1) - 1, d || 1), "d 'de' MMMM", { locale: es })
    }
    const cuando = fechaTxt ? ` del ${fechaTxt}${b.scheduled_time ? ` a las ${b.scheduled_time.slice(0, 5)}` : ''}` : ''
    const msg = `Hola ${firstName}, te contacto de Yo me Encargo por tu reserva de mudanza${cuando}. ¿Cómo estás? Quería coordinar contigo los detalles del traslado.`
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

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

  const handleCreate = async () => {
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
          notes: newBooking.notes || 'Reserva de cupo sin cliente (admin)'
        }
        const response = await fetch('/api/admin/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          throw new Error(err?.error || 'Error al reservar el cupo')
        }
        toast.success('Cupo reservado correctamente (1 camión)')
        setShowAddModal(false)
        setBlockOnly(false)
        setNewBooking({ ...EMPTY_NEW_BOOKING })
        fetchBookings()
        return
      }

      // Crear reserva normal
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
        origin_address: newBooking.origin_address || null,
        destination_address: newBooking.destination_address || null,
        notes: newBooking.notes || null,
      }

      const response = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.error || 'Error al crear la reserva')
      }

      const created = await response.json().catch(() => ({}))
      const createdQuoteId: string = created?.booking?.quote_id || payload.quote_id

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
        toast.success(
          newBooking.payment_paid
            ? `Reserva creada y marcada como pagada (${label})`
            : `Reserva creada, pago pendiente por ${label}`
        )
      }

      setShowAddModal(false)
      setNewBooking({ ...EMPTY_NEW_BOOKING })
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
      { header: 'ID', value: (b) => b.id },
      { header: 'Reserva', value: (b) => b.quote_id },
      { header: 'Cliente', value: (b) => b.client_name },
      { header: 'Email', value: (b) => b.client_email },
      { header: 'Teléfono', value: (b) => b.client_phone },
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
      { header: 'Estado', value: (b) => b.status },
      { header: 'Estado de pago', value: (b) => b.payment_status },
      { header: 'Tipo de pago', value: (b) => b.payment_type },
      { header: 'Precio total', value: (b) => b.total_price },
      { header: 'Precio original', value: (b) => b.original_price },
      { header: 'Dirección origen', value: (b) => b.origin_address },
      { header: 'Dirección destino', value: (b) => b.destination_address },
      { header: 'Notas', value: (b) => b.notes },
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
    <div className="space-y-6 admin-bookings-layout">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-archivo font-extrabold tracking-tight text-gray-900">Gestión de Reservas</h2>
          <p className="text-sm text-gray-500">
            {filteredBookings.length} de {bookings.length} reservas
          </p>
        </div>
        <div className="flex gap-2">
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
                { value: 'provisional', label: 'Sin pagar (provisional)' },
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

          <div className={dateFilter === 'range' ? 'md:col-span-2' : ''}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha
            </label>
            <Select
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value)
                if (e.target.value !== 'range') {
                  setCustomStartDate('')
                  setCustomEndDate('')
                }
              }}
              options={[
                { value: 'all', label: 'Todas las fechas' },
                { value: 'today', label: 'Hoy' },
                { value: 'tomorrow', label: 'Mañana' },
                { value: 'week', label: 'Esta semana' },
                { value: 'month', label: 'Este mes' },
                { value: 'range', label: 'Rango personalizado' },
              ]}
            />
            {dateFilter === 'range' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="text-sm min-w-[160px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="text-sm min-w-[160px]"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-end justify-end">
            <Button
              onClick={() => {
                setSearchTerm('')
                setStatusFilter('all')
                setBookingTypeFilter('all')
                setClientTypeFilter('')
                setDateFilter('all')
                setCustomStartDate('')
                setCustomEndDate('')
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Precio
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
                  
                  return (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${booking.client_name}`}
                        className="w-4 h-4 rounded border-gray-300 text-secondary-600 focus:ring-secondary-500"
                        checked={selectedBookingIds.has(booking.id)}
                        onChange={() => toggleBookingSelection(booking.id)}
                      />
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-900">{booking.client_name}</span>
                          {booking.is_frequent && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200" title="Cliente frecuente">
                              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" /> Frecuente
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
                        <div className="text-sm text-gray-500">
                          ID: {booking.quote_id}
                        </div>
                        {booking.from_prospect && (
                          <span
                            className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${getSourceBadge(booking.source)}`}
                            title="Reserva originada desde un prospecto"
                          >
                            👤 Prospecto · {getSourceLabel(booking.source)}
                          </span>
                        )}
                      </div>
                    </td>
                      <td className="hidden md:table-cell px-4 py-3 align-top whitespace-nowrap">
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
                    <td className="px-4 py-3 align-top whitespace-nowrap">
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
                    <td className="px-4 py-3 align-top whitespace-nowrap">
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
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      {(booking.original_price || booking.total_price) ? (
                        <div>
                          {booking.payment_status === 'approved' ? (
                            <>
                              <div className="text-sm font-semibold text-green-700">
                                ${booking.total_price?.toLocaleString()}
                              </div>
                              {/* Si el precio cotizado difiere de lo pagado (hubo un reajuste
                                  manual en el camino), se muestra aparte — antes solo se veía
                                  el precio cotizado y parecía que el cliente pagó esa cifra,
                                  aunque no fuera ni el 50% ni el 100% de ella. */}
                              {booking.original_price != null && booking.original_price !== booking.total_price && (
                                <div className="text-xs text-gray-500">
                                  Cotizado: ${booking.original_price.toLocaleString()}
                                </div>
                              )}
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                                ✓ Pagado {booking.payment_type === 'mitad' ? '(abono 50%)' : '(completo)'}
                              </span>
                            </>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-green-700">
                                ${(booking.original_price || booking.total_price)?.toLocaleString()}
                              </div>
                              {booking.payment_status === 'pending' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
                                  ⏳ Pago pendiente
                                </span>
                              )}
                              {booking.payment_status === 'rejected' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                                  ✗ Pago rechazado
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 align-top whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {booking.client_phone}
                      </div>
                      <div className="text-sm text-gray-500">
                        {booking.client_email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
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
                          <Button
                            onClick={() => window.open(buildWhatsappLink(booking), 'whatsapp_yme')}
                            variant="outline"
                            size="sm"
                            className="text-green-700 border-green-300 bg-green-50 hover:bg-green-100"
                            title="Contactar por WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() => window.open(buildEmailLink(booking), '_self')}
                            variant="outline"
                            size="sm"
                            className="text-blue-700 border-blue-300 bg-blue-50 hover:bg-blue-100"
                            title="Contactar por Email"
                          >
                            <Mail className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() => toggleFrequentCustomer(booking)}
                            variant="outline"
                            size="sm"
                            className={booking.is_frequent
                              ? 'text-amber-600 border-amber-300 bg-amber-50 hover:bg-amber-100'
                              : 'text-gray-400 border-gray-200 hover:bg-gray-50'}
                            title={booking.is_frequent ? 'Quitar de clientes frecuentes' : 'Marcar como cliente frecuente'}
                          >
                            <Star className={`w-4 h-4 ${booking.is_frequent ? 'fill-amber-400 text-amber-500' : ''}`} />
                          </Button>
                          <Button
                            onClick={() => {
                              setSelectedBooking(booking)
                              setShowEditModal(true)
                            }}
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
                          <Button
                            onClick={() => window.open(buildGoogleCalendarUrl(booking), '_blank')}
                            variant="outline"
                            size="sm"
                            className="text-indigo-700 border-indigo-300 bg-indigo-50 hover:bg-indigo-100"
                            title="Agregar a Google Calendar"
                          >
                            <Calendar className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() => downloadIcs(booking)}
                            variant="outline"
                            size="sm"
                            className="text-gray-700 border-gray-300 bg-gray-50 hover:bg-gray-100"
                            title="Descargar .ics (Apple / Outlook / Google)"
                          >
                            <span className="text-xs font-semibold">.ics</span>
                          </Button>
                          <Button
                            onClick={() => handleDelete(booking.id)}
                            variant="outline"
                            size="sm"
                            className="text-red-700 border-red-300 bg-red-50 hover:bg-red-100"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                          {/* Botones de pago para reservas ONLINE */}
                          {!isDomicilio && booking.payment_status === 'pending' && (
                            <Button
                              onClick={() => {
                                if (confirm('¿Marcar este pago como pagado?')) {
                                  updatePaymentStatus(booking.id, 'approved')
                                }
                              }}
                              variant="outline"
                              size="sm"
                              className="text-xs bg-green-100 text-green-800 border-green-300 hover:bg-green-200 font-medium"
                            >
                              ✓ Marcar como pagado
                            </Button>
                          )}

                          {booking.payment_type === 'mitad' && !isDomicilio && (
                            <Button
                              onClick={() => {
                                if (confirm('¿Cambiar el estado de pago de "mitad" a "completo"?')) {
                                  updatePaymentType(booking.id, 'completo')
                                }
                              }}
                              variant="outline"
                              size="sm"
                              className="text-xs bg-green-100 text-green-800 border-green-300 hover:bg-green-200 font-medium"
                            >
                              ✓ Marcar completo
                            </Button>
                          )}

                          {/* Botones para reservas a DOMICILIO */}
                          {isDomicilio && booking.status !== 'completed' && booking.payment_status === 'approved' && (
                            <Button
                              onClick={() => {
                                if (confirm('¿Marcar este servicio a domicilio como completado?')) {
                                  updateBookingStatus(booking.id, 'completed')
                                }
                              }}
                              variant="outline"
                              size="sm"
                              className="text-xs bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200 font-medium"
                            >
                              ✓ Marcar visitado
                            </Button>
                          )}

                          {/* No atendido / cliente perdido: cierra la reserva sin servicio */}
                          {!['completed', 'cancelled', 'no_show'].includes(booking.status) && (
                            <Button
                              onClick={() => {
                                if (confirm('¿Marcar como "No atendido"? Úsalo cuando el cliente no se presentó o no fue posible atenderlo. Saldrá de la vista principal.')) {
                                  updateBookingStatus(booking.id, 'no_show')
                                }
                              }}
                              variant="outline"
                              size="sm"
                              className="text-xs bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200"
                            >
                              <UserX className="w-3.5 h-3.5 mr-1" />
                              No atendido
                            </Button>
                          )}
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
        onClose={() => setShowAddModal(false)}
        title={blockOnly ? 'Bloquear Horario' : 'Nueva Reserva'}
      >
        <div className="space-y-4">
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
                  Al crear la reserva se genera el link de pago con el monto de{' '}
                  <strong>Total Pagado</strong> y podrás copiarlo o enviarlo por WhatsApp.
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Pagado</label>
              <Input
                type="number"
                value={newBooking.total_price}
                onChange={(e) => setNewBooking({ ...newBooking, total_price: e.target.value })}
              />
            </div>
          </div>

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
            <Button onClick={handleCreate} disabled={creating}>{creating ? 'Guardando...' : (blockOnly ? 'Bloquear' : 'Crear Reserva')}</Button>
          </div>
        </div>
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
                  Reserva creada para <strong>{paymentLink.clientName || 'el cliente'}</strong> por{' '}
                  <strong>${paymentLink.amount.toLocaleString('es-CL')}</strong>. Envíale este link
                  para que pague. La reserva queda <strong>pendiente</strong> hasta que Flow
                  confirme el pago.
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

              {toWhatsAppNumber(paymentLink.clientPhone) && (
                <a
                  href={`https://wa.me/${toWhatsAppNumber(paymentLink.clientPhone)}?text=${encodeURIComponent(
                    `Hola ${paymentLink.clientName}, aquí está el link para pagar tu mudanza con Yo Me Encargo por $${paymentLink.amount.toLocaleString('es-CL')}:\n${paymentLink.url}`
                  )}`}
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
      >
        {selectedBooking && (
          <div className="space-y-4">
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Cliente</label>
                <p className="text-sm text-gray-900">{selectedBooking.client_name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">ID Cotización</label>
                <p className="text-sm text-gray-900">{selectedBooking.quote_id}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <p className="text-sm text-gray-900">{selectedBooking.client_email}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Teléfono</label>
                <p className="text-sm text-gray-900">{selectedBooking.client_phone}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Fecha</label>
                <p className="text-sm text-gray-900">
                  {(() => {
                    const [y, m, d] = selectedBooking.scheduled_date.split('-').map(Number)
                    const localDate = new Date(y, (m || 1) - 1, d || 1)
                    return format(localDate, 'dd/MM/yyyy', { locale: es })
                  })()}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Hora</label>
                <p className="text-sm text-gray-900">{selectedBooking.scheduled_time}</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Estado</label>
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(selectedBooking.status)}`}>
                {getStatusIcon(selectedBooking.status)}
                {getStatusLabel(selectedBooking.status)}
              </span>
            </div>

            {selectedBooking.original_price && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Precio Cotizado</label>
                <p className="text-sm font-semibold text-green-700">
                  ${selectedBooking.original_price.toLocaleString()}
                </p>
                {/* Se muestra el monto pagado siempre que difiera del cotizado (no solo
                    cuando payment_type==='mitad'): un reajuste manual de precio también
                    puede hacer que no coincidan sin que sea un abono del 50%. */}
                {selectedBooking.total_price != null && selectedBooking.total_price !== selectedBooking.original_price && (
                  <p className="text-xs text-gray-600 mt-1">
                    Pagado: ${selectedBooking.total_price.toLocaleString()}
                    {selectedBooking.payment_type === 'mitad' ? ' (abono 50%)' : ''}
                  </p>
                )}
              </div>
            )}

            {selectedBooking.payment_type && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Tipo de Pago</label>
                <p className="text-sm text-gray-900 capitalize">{selectedBooking.payment_type}</p>
              </div>
            )}

            {selectedBooking.origin_address && (
              <div>
                <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  Dirección Origen
                </label>
                <p className="text-sm text-gray-900">{selectedBooking.origin_address}</p>
                {typeof selectedBooking.origin_floor === 'number' && selectedBooking.origin_floor > 0 && (
                  <p className={`text-xs mt-0.5 ${selectedBooking.origin_has_elevator === false ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                    Piso {selectedBooking.origin_floor}
                    {selectedBooking.origin_has_elevator === false ? ' · SIN ascensor (escaleras)' : selectedBooking.origin_has_elevator === true ? ' · con ascensor' : ''}
                  </p>
                )}
              </div>
            )}

            {selectedBooking.destination_address && (
              <div>
                <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-green-600" />
                  Dirección Destino
                </label>
                <p className="text-sm text-gray-900">{selectedBooking.destination_address}</p>
                {typeof selectedBooking.destination_floor === 'number' && selectedBooking.destination_floor > 0 && (
                  <p className={`text-xs mt-0.5 ${selectedBooking.destination_has_elevator === false ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                    Piso {selectedBooking.destination_floor}
                    {selectedBooking.destination_has_elevator === false ? ' · SIN ascensor (escaleras)' : selectedBooking.destination_has_elevator === true ? ' · con ascensor' : ''}
                  </p>
                )}
              </div>
            )}

            {/* Dirección de visita para cotizaciones a domicilio */}
            {(() => {
              const isDomicilioVisit = selectedBooking.booking_type === 'domicilio' || 
                                      (selectedBooking.quote_id && selectedBooking.quote_id.startsWith('DOMICILIO-'))
              if (isDomicilioVisit && selectedBooking.visit_address) {
                return (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <label className="block text-sm font-medium text-purple-900 mb-2 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-purple-600" />
                      Dirección de Visita a Domicilio
                    </label>
                    <p className="text-sm text-purple-800">{selectedBooking.visit_address}</p>
                  </div>
                )
              }
              return null
            })()}

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

            {selectedBooking.notes && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Notas</label>
                <p className="text-sm text-gray-900">{selectedBooking.notes}</p>
              </div>
            )}

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
                      {photoUrls.map((url, index) => (
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
                Si mueves la reserva a un horario sin camiones disponibles, se avisará y no se
                guardará el cambio.
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

            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={() => setShowEditModal(false)}
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
