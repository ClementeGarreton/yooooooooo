'use client'

import { openQuoteForEdit } from './quoteEditSession'
import { depositAmount, MIN_ABONO_CLP } from '@/lib/revenueBreakdown'
import { toHiddenFileUrl } from '@/lib/fileLinks'
import PeriodFilter from './PeriodFilter'
import { chileDayOf, inPeriod, periodOf, resolvePeriod, type Period } from '@/lib/period'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import {
  Search,
  Filter,
  Eye,
  Trash2,
  Clock,
  Phone,
  Mail,
  MapPin,
  DollarSign,
  Download,
  UserX,
  MessageSquare,
  MessageCircle,
  Send,
  Users,
  Star,
  Banknote,
  Calendar, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import {
  buildWhatsAppLink,
  openWhatsApp,
  quoteFollowUpMessage,
  whatsAppUnavailableReason,
} from '@/lib/whatsapp'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import RowMenu from './RowMenu'
import PdfDownloadMenu from './PdfDownloadMenu'
import QuoteItemsPricing from './QuoteItemsPricing'
import {
  SOURCE_OPTIONS,
  normalizeOrigin,
  getSourceLabel,
  getSourceBadge,
} from '@/lib/prospectSource'
import { buildGoogleCalendarUrl, buildIcsContent, icsFileName } from '@/lib/calendarLinks'
import { formatDistanceKm } from '@/lib/utils'
import type { AdminQuoteData } from '@/lib/adminQuotePdf'
import {
  normalizeAdminPdfItems,
  normalizeAdminPdfItemsWithIndex,
} from '@/lib/adminBookingQuoteData'
import { normalizeStops, formatStopAddress } from '@/lib/stops'
import { quoteStatePhotos } from '@/lib/quoteState'
import type { PackagedItem } from '@/lib/packagingCatalog'

interface Prospect {
  id: string
  quote_id?: string
  source: string
  name: string
  email: string
  phone: string
  is_company: boolean
  company_name?: string
  company_rut?: string
  origin_address?: string
  destination_address?: string
  origin_floor?: number | null
  origin_has_elevator?: boolean | null
  origin_parking_distance?: number | null
  destination_floor?: number | null
  destination_has_elevator?: boolean | null
  destination_parking_distance?: number | null
  visit_address?: string
  scheduled_date?: string
  scheduled_time?: string
  total_price?: number
  original_price?: number
  is_flexible: boolean
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
  /** Estado completo del cotizador (add_quote_state.sql): de ahí salen las fotos del cliente. */
  quote_state?: unknown
  status: 'new' | 'contacted' | 'no_response' | 'converted' | 'lost'
  notes?: string
  /** COT-000001. Lo asigna la base (add_public_ids.sql); ausente sin la migración. */
  code?: string
  /** Paradas intermedias (JSONB). */
  stops?: unknown
  /** Cliente al que pertenece, en la tabla customers. */
  customer_id?: string
  converted_booking_id?: string
  pdf_url?: string
  pdf_generated_at?: string
  adjusted_price?: number
  adjustment_comment?: string
  quote_sent_at?: string
  is_frequent?: boolean
  customer_origin?: string
  is_existing_customer?: boolean
  /**
   * Lo cobrado y lo que falta de la reserva vinculada, calculados en la API con
   * `revenueBreakdown`. `null` = el lead todavía no tiene reserva.
   */
  booking_paid_amount?: number | null
  booking_pending_amount?: number | null
  created_at: string
  updated_at: string
}

const customerOriginOf = (prospect: Prospect) => prospect.customer_origin || prospect.source

function prospectToQuoteData(p: Prospect): AdminQuoteData {
  return {
    name: p.name,
    email: p.email,
    phone: p.phone,
    isCompany: p.is_company,
    companyName: p.company_name,
    companyRut: p.company_rut,
    originAddress: p.origin_address,
    destinationAddress: p.destination_address,
    originFloor: p.origin_floor,
    originHasElevator: p.origin_has_elevator,
    originParkingDistance: p.origin_parking_distance,
    destinationFloor: p.destination_floor,
    destinationHasElevator: p.destination_has_elevator,
    destinationParkingDistance: p.destination_parking_distance,
    scheduledDate: p.scheduled_date,
    scheduledTime: p.scheduled_time,
    totalPrice: p.adjusted_price ?? p.total_price,
    isFlexible: p.is_flexible,
    recommendedVehicle: p.recommended_vehicle,
    totalVolume: p.total_volume,
    totalWeight: p.total_weight,
    totalDistance: p.total_distance,
    items: normalizeAdminPdfItems(p.items_summary, p.total_volume),
    additionalServices: p.additional_services,
    notes: p.notes,
    code: p.code,
    stops: normalizeStops(p.stops),
  }
}

/** `onEditQuote` = ir a «Nueva cotización» con la cotización ya cargada para editarla. */
export default function ProspectsManagement({ onEditQuote }: { onEditQuote?: () => void } = {}) {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [filteredProspects, setFilteredProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  // Sobre QUÉ fecha filtra el selector de abajo. Son dos preguntas distintas y hasta
  // ahora solo se podía hacer la primera:
  //   'created'   -> "¿quién cotizó hoy?"        (created_at)
  //   'scheduled' -> "¿a quién le toca mañana?"  (scheduled_date, la fecha de la mudanza)
  const [dateField, setDateField] = useState<'created' | 'scheduled'>('created')
  // El mismo control de fecha de todo el panel; `dateField` dice sobre qué fecha se aplica.
  const [period, setPeriod] = useState<Period>(periodOf('all'))
  const [frequentFilter, setFrequentFilter] = useState('all') // all | yes | no
  const [showConverted, setShowConverted] = useState(false) // incluir prospectos ya convertidos
  const [clientTypeFilter, setClientTypeFilter] = useState('') // all | company | person
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [editNotes, setEditNotes] = useState('')
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [quotePrice, setQuotePrice] = useState('')
  const [quoteComment, setQuoteComment] = useState('')
  const [quoteDate, setQuoteDate] = useState('')
  const [quoteTime, setQuoteTime] = useState('')
  const [quoteAlreadyPaid, setQuoteAlreadyPaid] = useState(false)
  const [quotePaymentMethod, setQuotePaymentMethod] = useState<'transferencia' | 'efectivo' | 'otro'>('transferencia')
  /** Lo que el cliente ya entregó. Vacío = el total del precio acordado. */
  const [quotePaidAmount, setQuotePaidAmount] = useState('')
  const [isSavingAdjust, setIsSavingAdjust] = useState(false)
  const [isSendingQuote, setIsSendingQuote] = useState(false)
  const [isCreatingBooking, setIsCreatingBooking] = useState(false)

  // Los convertidos también se necesitan cuando el filtro de estado es 'converted'
  // (no solo con el checkbox "Ver convertidos").
  // Con «Por cobrar» también: quien debe plata ya reservó, así que está convertido
  // (medido el 15-sep-2026, los 21 leads con saldo pendiente lo están).
  const includeConverted =
    showConverted || statusFilter === 'converted' || statusFilter === 'por_cobrar'

  // Memoizado a propósito: el editor de precios usa esta lista como identidad para
  // saber cuándo descartar su borrador. Recalcularla en cada render cancelaría la
  // edición apenas el usuario tipeara.
  const selectedProspectItems = useMemo(
    () =>
      selectedProspect
        ? normalizeAdminPdfItemsWithIndex(
            selectedProspect.items_summary,
            selectedProspect.total_volume
          )
        : [],
    [selectedProspect]
  )

  const fetchProspects = async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setLoading(true)
      const url = includeConverted
        ? '/api/admin/prospects?includeConverted=1'
        : '/api/admin/prospects'
      const response = await fetch(url)
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Error al cargar')
      setProspects(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching prospects:', error)
      if (!options.silent) toast.error('Error al cargar los prospectos')
    } finally {
      if (!options.silent) setLoading(false)
    }
  }

  const filterProspects = useCallback(() => {
    let filtered = [...prospects]

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.email.toLowerCase().includes(term) ||
        p.phone.includes(searchTerm)
      )
    }

    if (statusFilter === 'por_cobrar') {
      // No es un estado del lead: es plata pendiente en su reserva.
      filtered = filtered.filter(p => (Number(p.booking_pending_amount) || 0) > 0)
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter(p => p.status === statusFilter)
    }

    if (sourceFilter !== 'all') {
      filtered = filtered.filter(p => normalizeOrigin(customerOriginOf(p)) === sourceFilter)
    }

    // Fecha: la de cotización (día de Chile de `created_at`) o la de la mudanza. Mirando la
    // mudanza, un prospecto sin fecha no entra: «¿quién se muda mañana?» no es un sí.
    const range = resolvePeriod(period)
    filtered = filtered.filter((p) =>
      inPeriod(dateField === 'created' ? chileDayOf(p.created_at) : (p.scheduled_date || '').slice(0, 10), range)
    )

    if (frequentFilter !== 'all') {
      filtered = filtered.filter(p =>
        frequentFilter === 'yes' ? !!p.is_frequent : !p.is_frequent
      )
    }

    // Filtrar por tipo de cliente (empresa vs persona natural)
    if (clientTypeFilter === 'company') {
      filtered = filtered.filter(p => p.is_company === true)
    } else if (clientTypeFilter === 'person') {
      filtered = filtered.filter(p => p.is_company !== true)
    }

    // Mirando la fecha de la mudanza, el orden por created_at que trae la API no sirve:
    // la lista es una hoja de ruta ("a quién llamo para mañana"), así que se ordena por
    // cuándo toca el servicio. Los que no tienen hora van al final del día.
    if (dateField === 'scheduled') {
      filtered = [...filtered].sort((a, b) => {
        const fa = `${(a.scheduled_date || '').slice(0, 10)} ${(a.scheduled_time || '99:99').slice(0, 5)}`
        const fb = `${(b.scheduled_date || '').slice(0, 10)} ${(b.scheduled_time || '99:99').slice(0, 5)}`
        return fa.localeCompare(fb)
      })
    }

    setFilteredProspects(filtered)
  }, [prospects, searchTerm, statusFilter, sourceFilter, dateField, period, frequentFilter, clientTypeFilter])

  useEffect(() => {
    fetchProspects()
    // Refresco silencioso al volver a la pestaña/ventana: así los prospectos que
    // pagaron mientras el panel estaba abierto desaparecen sin refrescar a mano.
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') fetchProspects({ silent: true })
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeConverted])

  useEffect(() => {
    filterProspects()
  }, [filterProspects])

  /** Abre la cotización en el cotizador interno para editarla (artículos, fecha, precio). */
  const editQuote = async (prospect: Prospect) => {
    if (!onEditQuote) return
    const aviso = prospect.status === 'converted'
      ? 'Esta cotización ya se convirtió en reserva: editarla cambia la cotización y los artículos que ve el equipo, no el precio de la reserva.\n\n'
      : ''
    if (!window.confirm(`${aviso}¿Abrir la cotización de ${prospect.name || prospect.email} para editarla? Reemplaza lo que haya a medias en «Nueva cotización».`)) return
    try {
      await openQuoteForEdit(prospect.id)
      onEditQuote()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo abrir la cotización')
    }
  }

  const updateProspectStatus = async (id: string, newStatus: string) => {
    const before = prospects
    const updateLocal = (rows: Prospect[]) =>
      rows.map((prospect) =>
        prospect.id === id ? { ...prospect, status: newStatus as Prospect['status'] } : prospect
      )

    // Optimista: la tabla nunca se desmonta, así se conserva scroll, filtros y orden.
    setProspects(updateLocal)
    setSelectedProspect((prospect) =>
      prospect?.id === id
        ? { ...prospect, status: newStatus as Prospect['status'] }
        : prospect
    )
    try {
      const response = await fetch('/api/admin/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      })

      if (!response.ok) throw new Error('Error al actualizar')
      toast.success('Estado actualizado')
    } catch (error) {
      console.error('Error updating prospect:', error)
      setProspects(before)
      toast.error('Error al actualizar el estado')
    }
  }

  const toggleProspectSelection = (id: string) => {
    setSelectedProspectIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllProspects = () => {
    setSelectedProspectIds(prev => {
      const allSelected =
        filteredProspects.length > 0 && filteredProspects.every(p => prev.has(p.id))
      return allSelected ? new Set() : new Set(filteredProspects.map(p => p.id))
    })
  }

  // Cambio masivo de estado: aplica el mismo status a todos los seleccionados.
  const bulkUpdateProspectStatus = async (newStatus: string) => {
    const ids = Array.from(selectedProspectIds)
    if (ids.length === 0) return
    setBulkUpdating(true)
    const previousStatuses = new Map(
      prospects.filter((prospect) => selectedProspectIds.has(prospect.id)).map((prospect) => [prospect.id, prospect.status])
    )
    setProspects((rows) =>
      rows.map((prospect) =>
        selectedProspectIds.has(prospect.id)
          ? { ...prospect, status: newStatus as Prospect['status'] }
          : prospect
      )
    )
    const results = await Promise.allSettled(
      ids.map(id =>
        fetch('/api/admin/prospects', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: newStatus }),
        }).then(r => {
          if (!r.ok) throw new Error('fail')
        })
      )
    )
    const ok = results.filter(r => r.status === 'fulfilled').length
    const fail = results.length - ok
    if (fail) {
      const failedIds = new Set(
        results.flatMap((result, index) => (result.status === 'rejected' ? [ids[index]] : []))
      )
      setProspects((rows) =>
        rows.map((prospect) =>
          failedIds.has(prospect.id)
            ? { ...prospect, status: previousStatuses.get(prospect.id) || prospect.status }
            : prospect
        )
      )
    }
    if (ok) toast.success(`${ok} prospecto${ok !== 1 ? 's' : ''} actualizado${ok !== 1 ? 's' : ''}`)
    if (fail) toast.error(`${fail} con error`)
    setSelectedProspectIds(new Set())
    setBulkUpdating(false)
  }

  const toggleFrequent = async (p: Prospect) => {
    const next = !p.is_frequent
    // Optimista: refleja el cambio al instante en la lista
    setProspects(prev => prev.map(x => (x.id === p.id ? { ...x, is_frequent: next } : x)))
    setSelectedProspect(prev => (prev && prev.id === p.id ? { ...prev, is_frequent: next } : prev))
    try {
      const response = await fetch('/api/admin/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, is_frequent: next }),
      })
      if (!response.ok) throw new Error('Error al actualizar')
      toast.success(next ? 'Marcado como cliente frecuente' : 'Quitado de clientes frecuentes')
    } catch (error) {
      console.error('Error toggling frequent:', error)
      toast.error('No se pudo actualizar. Reintenta.')
      // Revertir si falló
      setProspects(prev => prev.map(x => (x.id === p.id ? { ...x, is_frequent: !next } : x)))
      setSelectedProspect(prev => (prev && prev.id === p.id ? { ...prev, is_frequent: !next } : prev))
    }
  }

  /**
   * Guarda los precios de embalaje corregidos de la cotización.
   *
   * Se manda UNA entrada por cada fila del `items_summary` guardado (no solo las
   * que el editor muestra): el endpoint valida posición por posición contra lo
   * almacenado y rechaza el guardado si la lista se movió, así una corrección de
   * precio nunca termina aplicada al artículo equivocado.
   */
  const saveItemPrices = async (
    draft: PackagedItem[],
    newPrice: number | null
  ): Promise<boolean> => {
    if (!selectedProspect) return false

    // Algunos registros históricos guardan el JSON como texto; el normalizador que
    // alimenta al editor ya lo contempla, así que acá también hay que hacerlo o el
    // guardado saldría con una lista vacía.
    const raw: unknown =
      typeof selectedProspect.items_summary === 'string'
        ? (() => {
            try {
              return JSON.parse(selectedProspect.items_summary as unknown as string)
            } catch {
              return null
            }
          })()
        : selectedProspect.items_summary

    if (!Array.isArray(raw)) {
      toast.error('No se pudo leer la lista de ítems de la cotización')
      return false
    }

    const payload = raw.map((row: any) => ({
      name: row?.name,
      packaging: row?.packaging ?? null,
    }))

    for (const item of draft as Array<PackagedItem & { sourceIndex?: number }>) {
      const index = item.sourceIndex
      if (typeof index !== 'number' || !payload[index]) continue
      const type = item.packaging?.type
      payload[index] = {
        name: payload[index].name,
        packaging:
          type && type !== 'none'
            ? { type, pricePerUnit: item.packaging?.pricePerUnit }
            : null,
      }
    }

    try {
      const body: Record<string, unknown> = {
        id: selectedProspect.id,
        items_summary: payload,
      }
      if (newPrice !== null) body.adjusted_price = newPrice

      const response = await fetch('/api/admin/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'No se pudieron guardar los precios')
      }

      const updated = data?.prospect as Prospect | undefined
      if (updated) {
        setProspects((rows) =>
          rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
        )
        setSelectedProspect((prev) =>
          prev && prev.id === updated.id ? { ...prev, ...updated } : prev
        )
      } else {
        fetchProspects({ silent: true })
      }

      toast.success(
        newPrice !== null
          ? `Precios guardados. Precio final: $${newPrice.toLocaleString('es-CL')}`
          : 'Precios de embalaje guardados'
      )
      return true
    } catch (error) {
      console.error('Error saving item prices:', error)
      toast.error(
        error instanceof Error ? error.message : 'No se pudieron guardar los precios'
      )
      return false
    }
  }

  const saveNotes = async () => {
    if (!selectedProspect) return
    try {
      const response = await fetch('/api/admin/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedProspect.id, notes: editNotes }),
      })

      if (!response.ok) throw new Error('Error al guardar')
      toast.success('Notas guardadas')
      setShowNotesModal(false)
      fetchProspects({ silent: true })
    } catch (error) {
      console.error('Error saving notes:', error)
      toast.error('Error al guardar las notas')
    }
  }

  /** Link de WhatsApp del prospecto, o null si el teléfono no sirve. */
  const buildWhatsappLink = (p: Prospect) =>
    buildWhatsAppLink(p.phone, quoteFollowUpMessage(p, p.adjusted_price ?? p.total_price))

  // Contacto por WhatsApp: abre la pestaña de ESE cliente y marca el prospecto como
  // "contactado" si estaba en "nuevo". Si el teléfono no sirve no se marca nada: antes
  // se daba por contactado aunque no se hubiera podido escribir a nadie.
  const contactWhatsApp = (p: Prospect) => {
    const link = buildWhatsappLink(p)
    if (!link) {
      toast.error(whatsAppUnavailableReason(p.phone) || 'No se puede escribir por WhatsApp')
      return
    }
    openWhatsApp(link, p.phone)
    if (p.status === 'new') {
      void updateProspectStatus(p.id, 'contacted')
    }
  }

  // Email: arma un mailto: con asunto y mensaje prellenado (mismo criterio que WhatsApp).
  const buildEmailLink = (p: Prospect) => {
    const price = p.adjusted_price ?? p.total_price
    const precioTxt = price ? ` por $${price.toLocaleString('es-CL')}` : ''
    const firstName = p.name?.split(' ')[0] || ''
    let cuando = ''
    if (p.scheduled_date) {
      const [y, m, d] = p.scheduled_date.split('-').map(Number)
      const fechaTxt = format(new Date(y, (m || 1) - 1, d || 1), "d 'de' MMMM", { locale: es })
      cuando = ` para el ${fechaTxt}${p.scheduled_time ? ` a las ${p.scheduled_time.slice(0, 5)}` : ''}`
    }
    const subject = `Tu cotización de mudanza con Yo me Encargo${cuando}`
    const body = `Hola ${firstName},\n\nTe contactamos de Yo me Encargo por tu cotización de mudanza${cuando}${precioTxt}. Quería coordinar contigo los detalles para asegurar tu fecha.\n\nSaludos,\nYo me Encargo`
    return `mailto:${p.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  // Contacto por email: igual que WhatsApp, marca como "contactado" si estaba "nuevo".
  const contactEmail = (p: Prospect) => {
    window.open(buildEmailLink(p), '_self')
    if (p.status === 'new') {
      void updateProspectStatus(p.id, 'contacted')
    }
  }

  // Agenda tentativa del prospecto para exportar a calendario (misma lógica que Reservas).
  // Usa el precio ajustado si existe. El .ics/Google marcan la fecha/hora cotizada como
  // recordatorio; no implica que el cliente haya pagado.
  const prospectToCalendar = (p: Prospect) => {
    const isDomicilio = p.source === 'domicilio' || (!!p.visit_address && !p.origin_address)
    return {
      quote_id: p.quote_id || `PROSPECTO-${p.id}`,
      client_name: p.name,
      client_phone: p.phone,
      scheduled_date: p.scheduled_date,
      scheduled_time: p.scheduled_time,
      origin_address: p.origin_address,
      destination_address: p.destination_address,
      visit_address: p.visit_address,
      booking_type: isDomicilio ? 'domicilio' : 'online',
      total_price: p.adjusted_price ?? p.total_price,
    }
  }

  const downloadProspectIcs = (p: Prospect) => {
    const cal = prospectToCalendar(p)
    const blob = new Blob([buildIcsContent(cal)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = icsFileName(cal)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const openQuoteModal = (p: Prospect) => {
    setSelectedProspect(p)
    setQuotePrice(String(p.adjusted_price ?? p.total_price ?? ''))
    setQuoteComment(p.adjustment_comment || '')
    setQuoteDate(p.scheduled_date || '')
    setQuoteTime(p.scheduled_time ? p.scheduled_time.slice(0, 5) : '')
    setQuoteAlreadyPaid(false)
    setQuotePaymentMethod('transferencia')
    setQuotePaidAmount('')
    setShowQuoteModal(true)
  }

  const saveAdjustment = async () => {
    if (!selectedProspect) return
    const price = quotePrice === '' ? null : Math.round(Number(quotePrice))
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      toast.error('Precio inválido')
      return
    }
    try {
      setIsSavingAdjust(true)
      const response = await fetch('/api/admin/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedProspect.id,
          adjusted_price: price,
          adjustment_comment: quoteComment,
          scheduled_date: quoteDate || null,
          scheduled_time: quoteTime || null,
        }),
      })
      if (!response.ok) throw new Error('Error al guardar el ajuste')
      toast.success('Ajuste guardado')
      fetchProspects({ silent: true })
    } catch (error) {
      console.error('Error saving adjustment:', error)
      toast.error('No se pudo guardar el ajuste')
    } finally {
      setIsSavingAdjust(false)
    }
  }

  const sendAdjustedQuote = async () => {
    if (!selectedProspect) return
    const price = quotePrice === '' ? null : Math.round(Number(quotePrice))
    if (price === null || !Number.isFinite(price) || price <= 0) {
      toast.error('Ingresa un precio válido antes de enviar')
      return
    }
    try {
      setIsSendingQuote(true)
      const response = await fetch('/api/admin/prospects/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectId: selectedProspect.id,
          price,
          comment: quoteComment,
          date: quoteDate || undefined,
          time: quoteTime || undefined,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo enviar la cotización')
      }
      toast.success('Cotización enviada por correo (50% y 100%)')
      setShowQuoteModal(false)
      fetchProspects({ silent: true })
    } catch (error) {
      console.error('Error sending adjusted quote:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar la cotización')
    } finally {
      setIsSendingQuote(false)
    }
  }

  // Vista previa de lo que se va a guardar: el monto y el saldo que verá Reservas.
  const quotePriceNumber = quotePrice === '' ? 0 : Math.round(Number(quotePrice) || 0)
  const quotePaidPreview = !quoteAlreadyPaid
    ? null
    : String(quotePaidAmount).trim() === ''
      ? null
      : Math.max(0, Math.round(Number(quotePaidAmount) || 0))
  const quotePendingPreview = Math.max(0, quotePriceNumber - (quotePaidPreview ?? 0))

  const createBookingFromProspect = async () => {
    if (!selectedProspect) return
    const price = quotePrice === '' ? null : Math.round(Number(quotePrice))
    if (price === null || !Number.isFinite(price) || price <= 0) {
      toast.error('Ingresa un precio válido')
      return
    }
    if (!quoteDate || !quoteTime) {
      toast.error('Agrega fecha y hora para crear la reserva')
      return
    }
    const montoPagado = String(quotePaidAmount).trim() === ''
      ? 0
      : Math.max(0, Math.round(Number(quotePaidAmount) || 0))
    if (quoteAlreadyPaid && montoPagado <= 0) {
      toast.error('Ingresa cuánto pagó el cliente, o desmarca «Cliente ya pagó»')
      return
    }
    const saldo = Math.max(0, price - montoPagado)
    const paidNote = quoteAlreadyPaid
      ? ` Se registrará como PAGADA $${montoPagado.toLocaleString('es-CL')} (${quotePaymentMethod})${
          saldo > 0 ? ` y quedarán $${saldo.toLocaleString('es-CL')} por cobrar` : ''
        }.`
      : ''
    if (!confirm(`¿Crear una reserva confirmada para ${selectedProspect.name} el ${quoteDate} a las ${quoteTime} por $${price.toLocaleString('es-CL')}? Esta reserva ocupará cupo.${paidNote}`)) return
    try {
      setIsCreatingBooking(true)
      const response = await fetch('/api/admin/prospects/create-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectId: selectedProspect.id,
          price,
          comment: quoteComment,
          date: quoteDate,
          time: quoteTime,
          paid: quoteAlreadyPaid,
          paymentMethod: quoteAlreadyPaid ? quotePaymentMethod : undefined,
          // El monto manda: el servidor deriva de acá si fue pago completo o abono.
          amountPaid: quoteAlreadyPaid ? montoPagado : undefined,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo crear la reserva')
      }
      if (data.paymentLedgerRecorded === false) {
        toast.error(`Reserva creada, pero el cobro no entró al libro de pagos. Revisa la reserva ${data.quoteId || ''} antes de registrar otro cobro.`)
      } else {
        toast.success('Reserva creada y prospecto convertido')
      }
      setShowQuoteModal(false)
      // La fila queda visible y marcada como convertida hasta el próximo refresco
      // explícito/foco. Así el usuario no pierde el contexto de la lista al cerrar.
      setProspects((rows) =>
        rows.map((prospect) =>
          prospect.id === selectedProspect.id
            ? { ...prospect, status: 'converted', converted_booking_id: data.bookingId }
            : prospect
        )
      )
    } catch (error) {
      console.error('Error creating booking:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la reserva')
    } finally {
      setIsCreatingBooking(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este prospecto? Esta acción no se puede deshacer.')) return
    try {
      const response = await fetch(`/api/admin/prospects?id=${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Error al eliminar')
      toast.success('Prospecto eliminado')
      setProspects((rows) => rows.filter((prospect) => prospect.id !== id))
    } catch (error) {
      console.error('Error deleting prospect:', error)
      toast.error('Error al eliminar el prospecto')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'contacted': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'no_response': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'converted': return 'text-green-600 bg-green-50 border-green-200'
      case 'lost': return 'text-red-600 bg-red-50 border-red-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return 'Nuevo'
      case 'contacted': return 'Contactado'
      case 'no_response': return 'Sin respuesta'
      case 'converted': return 'Convertido'
      case 'lost': return 'Perdido'
      default: return status
    }
  }

  // SOURCE_OPTIONS, normalizeOrigin, getSourceLabel, getSourceBadge se importan desde
  // '@/lib/prospectSource' (compartidos con el panel de Reservas).

  const updateProspectSource = async (id: string, newSource: string) => {
    try {
      const response = await fetch('/api/admin/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source: newSource }),
      })
      if (!response.ok) throw new Error('Error al actualizar')
      toast.success('Origen actualizado')
      setSelectedProspect(prev => (prev && prev.id === id ? { ...prev, source: newSource, customer_origin: newSource } : prev))
      setProspects((rows) => rows.map((prospect) => prospect.id === id ? { ...prospect, source: newSource, customer_origin: newSource } : prospect))
    } catch (error) {
      console.error('Error updating source:', error)
      toast.error('No se pudo actualizar el origen')
    }
  }

  const escapeCsvValue = (value: any) => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    const needsQuotes = /[",\n]/.test(str)
    const escaped = str.replace(/"/g, '""')
    return needsQuotes ? `"${escaped}"` : escaped
  }

  const handleExportCSV = () => {
    // created_at es un timestamp ISO -> fecha/hora legibles en hora de Chile.
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

    const columns: { header: string; value: (p: any) => any }[] = [
      { header: 'Código', value: (p) => p.code || '' },
      { header: 'ID cliente', value: (p) => p.customer_id || '' },
      { header: 'Nombre', value: (p) => p.name },
      { header: 'Email', value: (p) => p.email },
      { header: 'Teléfono', value: (p) => p.phone },
      { header: 'Origen del cliente', value: (p) => getSourceLabel(customerOriginOf(p)) },
      { header: 'Estado', value: (p) => p.status },
      { header: 'Tipo cliente', value: (p) => (p.is_company ? 'Empresa' : 'Persona') },
      { header: 'Razón social', value: (p) => p.company_name || '' },
      { header: 'RUT empresa', value: (p) => p.company_rut || '' },
      { header: 'Precio total', value: (p) => p.total_price },
      { header: 'Fecha mudanza', value: (p) => fmtSchedDate(p.scheduled_date) },
      { header: 'Hora mudanza', value: (p) => fmtSchedTime(p.scheduled_time) },
      { header: 'Dirección origen', value: (p) => p.origin_address },
      { header: 'Dirección destino', value: (p) => p.destination_address },
      { header: 'Dirección visita', value: (p) => p.visit_address },
      { header: 'Notas', value: (p) => p.notes },
      { header: 'Fecha creación', value: (p) => fmtDateCL(p.created_at) },
      { header: 'Hora creación', value: (p) => fmtTimeCL(p.created_at) },
    ]

    const headerRow = columns.map((c) => escapeCsvValue(c.header)).join(',')
    const rows = filteredProspects.map((p) => columns.map((c) => escapeCsvValue(c.value(p))).join(','))
    // BOM para que Excel interprete bien los acentos de los encabezados.
    const csv = '\uFEFF' + [headerRow, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const now = new Date()
    link.href = url
    link.download = `prospectos_${format(now, 'yyyy-MM-dd')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Estadísticas rápidas
  const statsNew = prospects.filter(p => p.status === 'new').length
  const statsContacted = prospects.filter(p => p.status === 'contacted').length
  const statsNoResponse = prospects.filter(p => p.status === 'no_response').length
  const statsLost = prospects.filter(p => p.status === 'lost').length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando prospectos...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-archivo font-extrabold tracking-tight text-gray-900">Prospectos / Leads</h2>
          <p className="text-sm text-gray-500">
            {filteredProspects.length} de {prospects.length} prospectos · {dateField === 'scheduled' ? 'se mudan' : 'cotizaron'}:{' '}
            {resolvePeriod(period).label}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodFilter
            value={period}
            onChange={setPeriod}
            presets={dateField === 'scheduled' ? ['all', 'day', 'tomorrow', 'week', 'month', 'custom'] : ['all', 'day', 'week', 'month', 'custom']}
          />
          <Button onClick={() => fetchProspects()} variant="outline" size="sm">
            Actualizar
          </Button>
          <Button onClick={handleExportCSV} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Nuevos</p>
              <p className="text-2xl font-archivo font-extrabold text-blue-600">{statsNew}</p>
            </div>
            <div className="p-2.5 rounded-full bg-blue-50">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Contactados</p>
              <p className="text-2xl font-archivo font-extrabold text-yellow-600">{statsContacted}</p>
            </div>
            <div className="p-2.5 rounded-full bg-yellow-50">
              <Phone className="w-5 h-5 text-yellow-500" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Sin respuesta</p>
              <p className="text-2xl font-archivo font-extrabold text-orange-600">{statsNoResponse}</p>
            </div>
            <div className="p-2.5 rounded-full bg-orange-50">
              <Clock className="w-5 h-5 text-orange-500" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Perdidos</p>
              <p className="text-2xl font-archivo font-extrabold text-red-600">{statsLost}</p>
            </div>
            <div className="p-2.5 rounded-full bg-red-50">
              <UserX className="w-5 h-5 text-red-500" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Nombre, email, tel..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Origen</label>
            <Select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              options={[{ value: 'all', label: 'Todos' }, ...SOURCE_OPTIONS]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'por_cobrar', label: 'Por cobrar (reservó y falta pagar)' },
                { value: 'new', label: 'Nuevo' },
                { value: 'contacted', label: 'Contactado' },
                { value: 'no_response', label: 'Sin respuesta' },
                { value: 'lost', label: 'Perdido' },
                { value: 'converted', label: 'Convertido (pagado)' },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">La fecha de arriba es la de</label>
            <Select
              value={dateField}
              onChange={(e) => setDateField(e.target.value as 'created' | 'scheduled')}
              options={[
                { value: 'created', label: 'Fecha de cotización' },
                { value: 'scheduled', label: 'Fecha de la mudanza' },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Frecuentes</label>
            <Select
              value={frequentFilter}
              onChange={(e) => setFrequentFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'yes', label: 'Solo frecuentes' },
                { value: 'no', label: 'No frecuentes' },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de cliente</label>
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

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700 pb-2" title="Incluir prospectos ya convertidos en reserva">
              <input
                type="checkbox"
                checked={showConverted}
                onChange={(e) => setShowConverted(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-secondary-600 focus:ring-secondary-500"
              />
              Ver convertidos
            </label>
          </div>

          <div className="flex items-end">
            <Button
              onClick={() => {
                setSearchTerm('')
                setStatusFilter('all')
                setSourceFilter('all')
                setPeriod(periodOf('all'))
                setFrequentFilter('all')
                setShowConverted(false)
                setClientTypeFilter('')
              }}
              variant="outline"
              size="sm"
              className="whitespace-nowrap px-3"
            >
              <Filter className="w-4 h-4 mr-2" />
              Limpiar
            </Button>
          </div>
        </div>
      </Card>

      {selectedProspectIds.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2">
          <span className="text-sm font-medium text-gray-700">
            {selectedProspectIds.size} seleccionado{selectedProspectIds.size !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-gray-500">Cambiar estado a:</span>
          <Button onClick={() => bulkUpdateProspectStatus('contacted')} variant="outline" size="sm" disabled={bulkUpdating}>
            Contactado
          </Button>
          <Button onClick={() => bulkUpdateProspectStatus('no_response')} variant="outline" size="sm" disabled={bulkUpdating}>
            Sin respuesta
          </Button>
          <Button onClick={() => bulkUpdateProspectStatus('lost')} variant="outline" size="sm" disabled={bulkUpdating}>
            Perdido
          </Button>
          <button
            onClick={() => setSelectedProspectIds(new Set())}
            className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline"
            disabled={bulkUpdating}
          >
            Limpiar selección
          </button>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        {filteredProspects.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No se encontraron prospectos</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left w-8">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos"
                      className="w-4 h-4 rounded border-gray-300 text-secondary-600 focus:ring-secondary-500"
                      checked={filteredProspects.length > 0 && filteredProspects.every(p => selectedProspectIds.has(p.id))}
                      onChange={toggleSelectAllProspects}
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contacto
                  </th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Origen
                  </th>
                  <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Precio Est.
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProspects.map((prospect) => {
                  const isLegacyCustomer = normalizeOrigin(customerOriginOf(prospect)) === 'cliente_antiguo'
                  return (
                  <tr
                    key={prospect.id}
                    className={isLegacyCustomer
                      ? 'bg-emerald-50/70 hover:bg-emerald-100/80 transition-colors'
                      : 'hover:bg-gray-50 transition-colors'}
                  >
                    <td className="px-4 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${prospect.name}`}
                        className="w-4 h-4 rounded border-gray-300 text-secondary-600 focus:ring-secondary-500"
                        checked={selectedProspectIds.has(prospect.id)}
                        onChange={() => toggleProspectSelection(prospect.id)}
                      />
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {/* El nombre abre el detalle de lo que cotizó (lo mismo que el ojo). */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProspect(prospect)
                            setShowDetailsModal(true)
                          }}
                          title="Ver qué cotizó"
                          className="text-left text-sm font-medium text-gray-900 hover:text-primary-600 hover:underline"
                        >
                          {prospect.name}
                        </button>
                        {prospect.is_frequent && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" /> Frecuente
                          </span>
                        )}
                        {isLegacyCustomer && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            Cliente antiguo
                          </span>
                        )}
                        {prospect.is_company ? (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700 border border-purple-200"
                            title={`${prospect.company_name || ''} ${prospect.company_rut ? `(${prospect.company_rut})` : ''}`.trim()}
                          >
                            Empresa
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                            Persona
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">{prospect.email}</div>
                      <div className="text-xs text-gray-400">{prospect.phone}</div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-2 align-top whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getSourceBadge(customerOriginOf(prospect))}`}>
                        {getSourceLabel(customerOriginOf(prospect))}
                      </span>
                    </td>
                    <td className="hidden lg:table-cell px-4 py-2 align-top whitespace-nowrap">
                      {prospect.total_price ? (
                        <span className="text-sm font-semibold text-green-700">
                          ${prospect.total_price.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(prospect.status)}`}>
                        {getStatusLabel(prospect.status)}
                      </span>
                      {prospect.status === 'converted' && prospect.converted_booking_id && (
                        <div className="text-[11px] text-green-700 mt-1" title={`Reserva ${prospect.converted_booking_id}`}>
                          → en Reservas
                        </div>
                      )}
                      {(Number(prospect.booking_pending_amount) || 0) > 0 && (
                        <div className="text-[11px] font-semibold text-orange-700 mt-1" title="Saldo pendiente de su reserva">
                          Falta ${Number(prospect.booking_pending_amount).toLocaleString('es-CL')}
                        </div>
                      )}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2 align-top whitespace-nowrap text-sm text-gray-500">
                      {format(new Date(prospect.created_at), 'dd/MM/yy HH:mm', { locale: es })}
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap text-sm">
                      {/* A la vista, lo de todos los días: ver, WhatsApp, enviar cotización y
                          PDF, más el siguiente paso del lead. Lo ocasional va en «Más». */}
                      <div className="flex items-center justify-end gap-1.5">
                        {prospect.status === 'new' && (
                          <button
                            type="button"
                            onClick={() => updateProspectStatus(prospect.id, 'contacted')}
                            className="rounded-lg border border-yellow-300 bg-yellow-100 px-2 py-1.5 text-xs font-semibold text-yellow-800 hover:bg-yellow-200"
                          >
                            Marcar contactado
                          </button>
                        )}
                        <Button
                          onClick={() => {
                            setSelectedProspect(prospect)
                            setShowDetailsModal(true)
                          }}
                          variant="outline"
                          size="sm"
                          title="Ver detalles"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => contactWhatsApp(prospect)}
                          variant="outline"
                          size="sm"
                          disabled={!buildWhatsappLink(prospect)}
                          className="text-green-700 border-green-300 bg-green-50 hover:bg-green-100 disabled:opacity-40"
                          title={
                            whatsAppUnavailableReason(prospect.phone) ||
                            'Contactar por WhatsApp (marca como contactado)'
                          }
                        >
                          <MessageCircle className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => openQuoteModal(prospect)}
                          variant="outline"
                          size="sm"
                          className="text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
                          title="Ajustar y enviar cotización por correo"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                        <PdfDownloadMenu
                          data={prospectToQuoteData(prospect)}
                          compact
                        />
                        <RowMenu
                          items={[
                            prospect.status === 'contacted' && {
                              label: 'Sin respuesta',
                              icon: MessageSquare,
                              onClick: () => updateProspectStatus(prospect.id, 'no_response'),
                            },
                            prospect.status === 'no_response' && {
                              label: 'Reintentar contacto',
                              icon: MessageCircle,
                              onClick: () => updateProspectStatus(prospect.id, 'contacted'),
                            },
                            (prospect.status === 'contacted' || prospect.status === 'no_response') && {
                              label: 'Marcar perdido',
                              icon: Trash2,
                              onClick: () => updateProspectStatus(prospect.id, 'lost'),
                            },
                            Boolean(onEditQuote) && prospect.source !== 'domicilio' && {
                              label: 'Editar cotización',
                              icon: Pencil,
                              hint: 'Artículos, fecha, direcciones y precio',
                              onClick: () => editQuote(prospect),
                            },
                            prospect.status !== 'converted' && {
                              label: 'Convertir en reserva',
                              icon: Banknote,
                              hint: 'Pago por transferencia o efectivo, sin Flow',
                              onClick: () => openQuoteModal(prospect),
                            },
                            { label: 'Escribir por correo', icon: Mail, hint: 'Marca como contactado', onClick: () => contactEmail(prospect) },
                            {
                              label: 'Notas',
                              icon: MessageSquare,
                              onClick: () => {
                                setSelectedProspect(prospect)
                                setEditNotes(prospect.notes || '')
                                setShowNotesModal(true)
                              },
                            },
                            {
                              label: prospect.is_frequent ? 'Quitar de frecuentes' : 'Marcar cliente frecuente',
                              icon: Star,
                              onClick: () => toggleFrequent(prospect),
                            },
                            Boolean(prospect.scheduled_date) && {
                              label: 'Agregar a Google Calendar',
                              icon: Calendar,
                              hint: 'Fecha tentativa',
                              onClick: () => window.open(buildGoogleCalendarUrl(prospectToCalendar(prospect)), '_blank'),
                            },
                            Boolean(prospect.scheduled_date) && {
                              label: 'Descargar .ics',
                              icon: Calendar,
                              onClick: () => downloadProspectIcs(prospect),
                            },
                            { label: 'Eliminar', icon: Trash2, danger: true, onClick: () => handleDelete(prospect.id) },
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

      {/* Details Modal */}
      <Modal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        title="Detalle del Prospecto"
        size="lg"
      >
        {selectedProspect && (
          <div className="space-y-4">
            {selectedProspect.code && (
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-gray-900 px-2.5 py-1 font-mono text-sm font-semibold tracking-wide text-white">
                  {selectedProspect.code}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(selectedProspect.code || '')
                      .then(() => toast.success('Código copiado'))
                      .catch(() => toast.error('No se pudo copiar'))
                  }}
                  className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
                >
                  copiar
                </button>
              </div>
            )}

            {/* Estado y source */}
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(selectedProspect.status)}`}>
                {getStatusLabel(selectedProspect.status)}
              </span>
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getSourceBadge(customerOriginOf(selectedProspect))}`}>
                {getSourceLabel(customerOriginOf(selectedProspect))}
              </span>
              <span className="text-sm text-gray-500">
                {format(new Date(selectedProspect.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
              </span>
            </div>

            {/* Origen editable (CRM) */}
            <div className="max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">Origen del cliente</label>
              <Select
                value={normalizeOrigin(customerOriginOf(selectedProspect))}
                onChange={(e) => updateProspectSource(selectedProspect.id, e.target.value)}
                options={SOURCE_OPTIONS}
              />
              <p className="text-xs text-gray-500 mt-1">Si el email ya tiene una ficha en Clientes, esa clasificación prevalece automáticamente.</p>
            </div>

            {/* Contacto */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre</label>
                <p className="text-sm text-gray-900">{selectedProspect.name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <p className="text-sm text-gray-900">{selectedProspect.email}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Teléfono</label>
                <p className="text-sm text-gray-900">{selectedProspect.phone}</p>
              </div>
              {selectedProspect.is_company && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Empresa</label>
                  <p className="text-sm text-gray-900">
                    {selectedProspect.company_name} (RUT: {selectedProspect.company_rut})
                  </p>
                </div>
              )}
            </div>

            {/* Precio */}
            {selectedProspect.total_price && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  <label className="text-sm font-medium text-green-900">Precio Estimado</label>
                </div>
                <p className="text-2xl font-bold text-green-700">
                  ${selectedProspect.total_price.toLocaleString()}
                </p>
                {selectedProspect.is_flexible && (
                  <p className="text-xs text-green-600 mt-1">Con descuento por flexibilidad</p>
                )}
              </div>
            )}

            {/* Direcciones */}
            {(selectedProspect.origin_address || selectedProspect.destination_address || selectedProspect.visit_address) && (
              <div className="space-y-3">
                {selectedProspect.origin_address && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                      <MapPin className="w-4 h-4 text-blue-600" /> Origen
                    </label>
                    <p className="text-sm text-gray-900">{selectedProspect.origin_address}</p>
                    {typeof selectedProspect.origin_floor === 'number' && selectedProspect.origin_floor > 0 && (
                      <p className={`text-xs mt-0.5 ${selectedProspect.origin_has_elevator === false ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                        Piso {selectedProspect.origin_floor}
                        {selectedProspect.origin_has_elevator === false ? ' · SIN ascensor (escaleras)' : selectedProspect.origin_has_elevator === true ? ' · con ascensor' : ''}
                      </p>
                    )}
                  </div>
                )}
                {selectedProspect.destination_address && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                      <MapPin className="w-4 h-4 text-green-600" /> Destino
                    </label>
                    <p className="text-sm text-gray-900">{selectedProspect.destination_address}</p>
                    {typeof selectedProspect.destination_floor === 'number' && selectedProspect.destination_floor > 0 && (
                      <p className={`text-xs mt-0.5 ${selectedProspect.destination_has_elevator === false ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                        Piso {selectedProspect.destination_floor}
                        {selectedProspect.destination_has_elevator === false ? ' · SIN ascensor (escaleras)' : selectedProspect.destination_has_elevator === true ? ' · con ascensor' : ''}
                      </p>
                    )}
                  </div>
                )}
                {selectedProspect.visit_address && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                      <MapPin className="w-4 h-4 text-purple-600" /> Dirección de Visita
                    </label>
                    <p className="text-sm text-gray-900">{selectedProspect.visit_address}</p>
                  </div>
                )}
              </div>
            )}

            {/* Fecha programada */}
            {selectedProspect.scheduled_date && (
              <div>
                <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                  <Clock className="w-4 h-4 text-primary-600" /> Fecha y Hora
                </label>
                <p className="text-sm text-gray-900">
                  {(() => {
                    const [y, m, d] = selectedProspect.scheduled_date.split('-').map(Number)
                    const localDate = new Date(y, (m || 1) - 1, d || 1)
                    return format(localDate, 'dd/MM/yyyy', { locale: es })
                  })()}
                  {selectedProspect.scheduled_time && ` a las ${selectedProspect.scheduled_time}`}
                </p>
              </div>
            )}

            {/* Detalles de mudanza */}
            {(selectedProspect.total_volume || selectedProspect.total_distance || selectedProspect.recommended_vehicle) && (
              <div className="grid grid-cols-3 gap-4 bg-gray-50 rounded-lg p-4">
                {selectedProspect.total_volume && (
                  <div className="text-center">
                    <p className="text-xs text-gray-500">Volumen</p>
                    <p className="font-bold">{selectedProspect.total_volume} m3</p>
                  </div>
                )}
                {selectedProspect.total_distance && (
                  <div className="text-center">
                    <p className="text-xs text-gray-500">Distancia</p>
                    <p className="font-bold">{formatDistanceKm(selectedProspect.total_distance)}</p>
                  </div>
                )}
                {selectedProspect.recommended_vehicle && (
                  <div className="text-center">
                    <p className="text-xs text-gray-500">Vehículo</p>
                    <p className="font-bold">{selectedProspect.recommended_vehicle}</p>
                  </div>
                )}
              </div>
            )}

            {/* Items cotizados, agrupados por tipo de embalaje y con edición de precios */}
            <QuoteItemsPricing
              items={selectedProspectItems}
              currentPrice={selectedProspect.adjusted_price ?? selectedProspect.total_price ?? null}
              onSave={saveItemPrices}
            />

            {/* Servicios adicionales */}
            {selectedProspect.additional_services && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Servicios Adicionales</label>
                <div className="flex flex-wrap gap-2">
                  {selectedProspect.additional_services.disassembly && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">Desarme</span>
                  )}
                  {selectedProspect.additional_services.assembly && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">Armado</span>
                  )}
                  {selectedProspect.additional_services.packing && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">Embalaje</span>
                  )}
                  {selectedProspect.additional_services.unpacking && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">Desembalaje</span>
                  )}
                  {Number(selectedProspect.additional_services.totalCrew) > 1 && (
                    <span className="rounded bg-purple-50 px-2 py-1 text-xs text-purple-700">
                      Cuadrilla: {Number(selectedProspect.additional_services.totalCrew)} personas
                      {Number(selectedProspect.additional_services.extraHelpers) > 0
                        ? ` (${Number(selectedProspect.additional_services.extraHelpers)} ayudantes adicionales)`
                        : ''}
                    </span>
                  )}
                  {selectedProspect.additional_services.observations && (
                    <p className="text-sm text-gray-600 w-full mt-1">
                      Obs: {selectedProspect.additional_services.observations}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Fotos que subió el cliente en el cotizador (viven en quote_state) */}
            {(() => {
              const photos = quoteStatePhotos(selectedProspect.quote_state).map((u) => toHiddenFileUrl(u))
              if (photos.length === 0) return null
              return (
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                  <label className="mb-3 block text-sm font-medium text-purple-900">Fotos del cliente ({photos.length})</label>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {photos.map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="relative block overflow-hidden rounded-lg border-2 border-purple-200 hover:border-purple-400"
                      >
                        <div className="aspect-square bg-gray-100">
                          <img src={url} alt={`Foto ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
                        </div>
                        <span className="absolute left-2 top-2 rounded bg-white/90 px-2 py-1 text-xs font-semibold text-gray-700">#{index + 1}</span>
                      </a>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-purple-700">Haz clic en una foto para verla en tamaño completo.</p>
                </div>
              )
            })()}

            {/* PDF */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="block text-sm font-medium text-green-900 mb-1">
                    PDF de Cotización
                  </label>
                  <p className="text-xs text-green-700">
                    Elige la versión con precios (cliente) o sin precios (trabajadores).
                  </p>
                </div>
                <PdfDownloadMenu
                  data={prospectToQuoteData(selectedProspect)}
                />
              </div>
            </div>

            {/* Notas */}
            {selectedProspect.notes && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <label className="block text-sm font-medium text-yellow-900 mb-1">Notas</label>
                <p className="whitespace-pre-line text-sm text-yellow-800">{selectedProspect.notes}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              {selectedProspect.pdf_url && (
                <Button
                  onClick={() => window.open(toHiddenFileUrl(selectedProspect.pdf_url), '_blank')}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Descargar PDF
                </Button>
              )}
              <Button onClick={() => setShowDetailsModal(false)} variant="outline">
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Notes Modal */}
      <Modal
        isOpen={showNotesModal}
        onClose={() => setShowNotesModal(false)}
        title={`Notas - ${selectedProspect?.name || ''}`}
      >
        <div className="space-y-4">
          <textarea
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            rows={5}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Agregar notas sobre este prospecto..."
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowNotesModal(false)} variant="outline">
              Cancelar
            </Button>
            <Button onClick={saveNotes}>
              Guardar Notas
            </Button>
          </div>
        </div>
      </Modal>

      {/* Quote / Adjust Modal */}
      <Modal
        isOpen={showQuoteModal}
        onClose={() => setShowQuoteModal(false)}
        title={`Cotización - ${selectedProspect?.name || ''}`}
        size="lg"
      >
        {selectedProspect && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              Precio cotizado originalmente:{' '}
              <span className="font-semibold text-gray-900">
                ${(selectedProspect.total_price || 0).toLocaleString('es-CL')}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Precio final (ajustado)
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  type="number"
                  min="0"
                  value={quotePrice}
                  onChange={(e) => setQuotePrice(e.target.value)}
                  className="pl-9"
                  placeholder="Ej: 240000"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Aumenta o baja el precio según corresponda. Se enviarán ambos links de pago.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hora</label>
                <Input type="time" value={quoteTime} onChange={(e) => setQuoteTime(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#F2FBE9] border border-[#8CC63F] rounded-lg p-3 text-center">
                <p className="text-xs text-gray-600">Abono (50%, mínimo ${MIN_ABONO_CLP.toLocaleString('es-CL')})</p>
                <p className="text-lg font-bold text-[#3F6212]">
                  ${depositAmount(Number(quotePrice) || 0).toLocaleString('es-CL')}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-600">Pago 100% (5% dcto)</p>
                <p className="text-lg font-bold text-gray-900">
                  ${Math.round((Number(quotePrice) || 0) * 0.95).toLocaleString('es-CL')}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Comentario de ajuste (se incluye en el correo)
              </label>
              <textarea
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={quoteComment}
                onChange={(e) => setQuoteComment(e.target.value)}
                placeholder="Ej: Ajustamos el valor por piso sin ascensor y volumen adicional..."
              />
            </div>

            {selectedProspect.quote_sent_at && (
              <p className="text-xs text-gray-500">
                Última cotización enviada:{' '}
                {format(new Date(selectedProspect.quote_sent_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
              </p>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={quoteAlreadyPaid}
                  onChange={(e) => setQuoteAlreadyPaid(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Cliente ya pagó (transferencia / efectivo)
              </label>
              {quoteAlreadyPaid && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Medio de pago</label>
                    <Select
                      value={quotePaymentMethod}
                      onChange={(e) => setQuotePaymentMethod(e.target.value as 'transferencia' | 'efectivo' | 'otro')}
                      options={[
                        { value: 'transferencia', label: 'Transferencia' },
                        { value: 'efectivo', label: 'Efectivo' },
                        { value: 'otro', label: 'Otro' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Monto pagado
                    </label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Lo que ya entregó"
                      value={quotePaidAmount}
                      onChange={(e) => setQuotePaidAmount(e.target.value)}
                    />
                  </div>
                  <div className="col-span-2 text-xs text-gray-500 space-y-1">
                    <p>
                      Cárgalo tal como lo pagó: sirve cualquier monto, no solo la mitad o el
                      total. Vacío = pagó el precio completo.
                    </p>
                    {quotePaidPreview !== null && (
                      <p className="font-medium text-gray-700">
                        Queda pagado ${quotePaidPreview.toLocaleString('es-CL')}
                        {quotePendingPreview > 0
                          ? ` y por cobrar $${quotePendingPreview.toLocaleString('es-CL')}, que aparecerá en «Por cobrar».`
                          : ', sin saldo pendiente.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 pt-2">
              <Button onClick={() => setShowQuoteModal(false)} variant="outline">
                Cerrar
              </Button>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={saveAdjustment} variant="outline" isLoading={isSavingAdjust}>
                  Guardar ajuste
                </Button>
                <Button
                  onClick={createBookingFromProspect}
                  isLoading={isCreatingBooking}
                  className="bg-secondary-600 hover:bg-secondary-700"
                  title={
                    quoteAlreadyPaid
                      ? `Crear reserva confirmada y pagada (${quotePaymentMethod})`
                      : 'Crear reserva confirmada, sin pago online (quedará "Pago pendiente")'
                  }
                >
                  {quoteAlreadyPaid ? 'Crear reserva pagada' : 'Crear reserva'}
                </Button>
                <Button onClick={sendAdjustedQuote} isLoading={isSendingQuote}>
                  <Send className="w-4 h-4 mr-2" />
                  Enviar por correo
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
