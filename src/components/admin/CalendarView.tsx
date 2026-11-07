'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  RefreshCw,
  Truck,
} from 'lucide-react'
import toast from 'react-hot-toast'

// ── Zona horaria ───────────────────────────────────────────────────────────────
// Todo el calendario razona en hora de Chile, no en la del navegador: el panel se
// abre igual desde España que desde Santiago y "hoy" tiene que ser el mismo día para
// los dos. Misma decisión que /api/admin/today-bookings en el servidor.
const TZ = 'America/Santiago'
const diaFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })
const horaFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Fecha de pared en Chile de un instante ISO, como 'YYYY-MM-DD'. */
function diaEnChile(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return diaFmt.format(d)
}

function horaEnChile(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return horaFmt.format(d)
}

function hoyEnChile(): string {
  return diaFmt.format(new Date())
}

/** 'YYYY-MM-DD' desde los componentes locales de un Date (sin pasar por UTC). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + dias)
  return ymd(date)
}

function etiquetaLarga(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dia = DIAS_CORTOS[(date.getDay() + 6) % 7]
  return `${dia} ${d} de ${MESES[m - 1]} de ${y}`
}

/** Las descripciones de Google vienen con HTML; en el panel se muestran en texto. */
function sinHtml(texto: string): string {
  return texto
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface VehicleColor {
  hex: string
  soft: string
  ink: string
}

interface Reserva {
  id: string
  quote_id?: string | null
  client_name: string | null
  client_phone: string | null
  scheduled_date: string
  scheduled_time: string | null
  duration_hours: number | null
  status: string
  booking_type: string | null
  is_provisional: boolean | null
  payment_status: string | null
  estimated_price: number | null
  origin_address: string | null
  destination_address: string | null
  visit_address: string | null
  vehicle: { id: number; name: string; driver: string; color: VehicleColor } | null
}

interface EventoGoogle {
  id: string
  calendar: 'personal' | 'trabajo' | 'contacto'
  calendarLabel: string
  title: string
  start: string | null
  end: string | null
  allDay: boolean
  location: string | null
  description: string | null
  htmlLink: string | null
}

interface RespuestaCalendario {
  range: { from: string; to: string }
  bookings: Reserva[]
  google: {
    configured: boolean
    connected: boolean
    error: string | null
    events: EventoGoogle[]
  }
}

type CapaId = 'reservas' | 'personal' | 'trabajo' | 'contacto'

interface Chip {
  key: string
  capa: CapaId
  orden: string
  hora: string
  titulo: string
  color: VehicleColor
  punteado: boolean
  reserva?: Reserva
  evento?: EventoGoogle
}

// Paleta por capa. Las reservas usan el color de su camión cuando lo tienen asignado,
// para que el calendario y la vista de choferes hablen el mismo idioma de colores.
const COLOR_RESERVA: VehicleColor = { hex: '#6FA8DC', soft: '#E1F0FA', ink: '#2C5282' }
const COLOR_PERSONAL: VehicleColor = { hex: '#F59E0B', soft: '#FEF3C7', ink: '#92400E' }
const COLOR_TRABAJO: VehicleColor = { hex: '#8B5CF6', soft: '#EDE9FE', ink: '#5B21B6' }
const COLOR_CONTACTO: VehicleColor = { hex: '#0D9488', soft: '#CCFBF1', ink: '#115E59' }

const COLOR_POR_CAPA: Record<Exclude<CapaId, 'reservas'>, VehicleColor> = {
  personal: COLOR_PERSONAL,
  trabajo: COLOR_TRABAJO,
  contacto: COLOR_CONTACTO,
}

const CAPAS: Array<{ id: CapaId; nombre: string; color: VehicleColor }> = [
  { id: 'reservas', nombre: 'Reservas', color: COLOR_RESERVA },
  { id: 'contacto', nombre: 'contacto@yomeencargo.cl', color: COLOR_CONTACTO },
  { id: 'trabajo', nombre: 'tomas@yomeencargo.cl', color: COLOR_TRABAJO },
  { id: 'personal', nombre: 'tomashaichelis@gmail.com', color: COLOR_PERSONAL },
]

const MAX_CHIPS_POR_DIA = 3

export default function CalendarView() {
  const hoy = hoyEnChile()
  const [ancla, setAncla] = useState(() => hoy.slice(0, 7)) // 'YYYY-MM' visible
  const [datos, setDatos] = useState<RespuestaCalendario | null>(null)
  const [cargando, setCargando] = useState(true)
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)
  const [capas, setCapas] = useState<Record<CapaId, boolean>>({
    reservas: true,
    contacto: true,
    trabajo: true,
    personal: true,
  })

  // Rejilla de 6 semanas que empieza en lunes: el rango que se pide al servidor es
  // exactamente lo que se ve, para no traer días que no se pintan.
  const grilla = useMemo(() => {
    const [y, m] = ancla.split('-').map(Number)
    const primero = new Date(y, m - 1, 1)
    const inicio = new Date(primero)
    inicio.setDate(inicio.getDate() - ((primero.getDay() + 6) % 7))
    const dias: string[] = []
    const cursor = new Date(inicio)
    for (let i = 0; i < 42; i++) {
      dias.push(ymd(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return { dias, desde: dias[0], hasta: dias[dias.length - 1], mes: m, anio: y }
  }, [ancla])

  const cargar = useCallback(
    async (mostrarToast = false) => {
      try {
        setCargando(true)
        const res = await fetch(`/api/admin/calendar?from=${grilla.desde}&to=${grilla.hasta}`)
        if (!res.ok) {
          const detalle = await res.json().catch(() => ({}))
          throw new Error(detalle?.error || `HTTP ${res.status}`)
        }
        const json: RespuestaCalendario = await res.json()
        setDatos(json)
        if (mostrarToast) toast.success('Calendario actualizado')
      } catch (error) {
        console.error('Error cargando el calendario:', error)
        toast.error('No se pudo cargar el calendario')
      } finally {
        setCargando(false)
      }
    },
    [grilla.desde, grilla.hasta]
  )

  useEffect(() => {
    cargar()
  }, [cargar])

  // Reparte reservas y eventos por día. Un evento de varios días aparece en cada uno
  // de los días que ocupa dentro de la rejilla, no solo en el primero.
  const porDia = useMemo(() => {
    const mapa = new Map<string, Chip[]>()
    const push = (dia: string, chip: Chip) => {
      if (dia < grilla.desde || dia > grilla.hasta) return
      const lista = mapa.get(dia)
      if (lista) lista.push(chip)
      else mapa.set(dia, [chip])
    }

    for (const r of datos?.bookings || []) {
      const hora = (r.scheduled_time || '').slice(0, 5)
      push(r.scheduled_date, {
        key: `reserva:${r.id}`,
        capa: 'reservas',
        orden: hora || '00:00',
        hora,
        titulo: r.client_name || 'Sin nombre',
        color: r.vehicle?.color || COLOR_RESERVA,
        punteado: Boolean(r.is_provisional),
        reserva: r,
      })
    }

    for (const e of datos?.google.events || []) {
      if (!e.start) continue
      const color = COLOR_POR_CAPA[e.calendar] || COLOR_PERSONAL
      // En Google el `end` de un evento de día completo es EXCLUSIVO: un evento de un
      // solo día llega como start=17, end=18. Sin restar ese día ocuparía dos casillas.
      const primerDia = e.allDay ? e.start.slice(0, 10) : diaEnChile(e.start)
      const ultimoDia = e.allDay
        ? sumarDias((e.end || e.start).slice(0, 10), -1)
        : e.end
          ? diaEnChile(e.end)
          : primerDia
      if (!primerDia) continue

      const hora = e.allDay || !e.start ? '' : horaEnChile(e.start)
      const base: Omit<Chip, 'key'> = {
        capa: e.calendar,
        orden: e.allDay ? '00:00' : hora || '00:00',
        hora,
        titulo: e.title,
        color,
        punteado: false,
        evento: e,
      }

      let dia = primerDia
      let guardia = 0
      while (dia <= (ultimoDia >= primerDia ? ultimoDia : primerDia) && guardia < 60) {
        push(dia, { ...base, key: `${e.id}:${dia}` })
        dia = sumarDias(dia, 1)
        guardia++
      }
    }

    for (const lista of Array.from(mapa.values())) {
      lista.sort((a, b) => a.orden.localeCompare(b.orden) || a.titulo.localeCompare(b.titulo))
    }
    return mapa
  }, [datos, grilla.desde, grilla.hasta])

  const chipsDe = useCallback(
    (dia: string) => (porDia.get(dia) || []).filter((c) => capas[c.capa]),
    [porDia, capas]
  )

  const totales = useMemo(() => {
    const conteo: Record<CapaId, number> = { reservas: 0, contacto: 0, trabajo: 0, personal: 0 }
    for (const dia of grilla.dias) {
      for (const chip of porDia.get(dia) || []) conteo[chip.capa]++
    }
    return conteo
  }, [porDia, grilla.dias])

  const moverMes = (delta: number) => {
    const [y, m] = ancla.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setAncla(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    setDiaAbierto(null)
  }

  // Igual que en el dashboard: la reserva se abre en la pestaña Reservas (en una
  // pestaña nueva) porque ahí están los botones de acción.
  const abrirReserva = (r: Reserva) => {
    const termino = r.quote_id || r.client_name || ''
    window.open(`/admin?tab=bookings&q=${encodeURIComponent(termino)}`, '_blank', 'noopener')
  }

  const google = datos?.google
  const detalle = diaAbierto ? chipsDe(diaAbierto) : []

  return (
    <div className="space-y-6">
      {/* Cabecera: mes, navegación y capas */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => moverMes(-1)}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="min-w-[190px] text-center text-lg font-semibold capitalize text-gray-900">
              {MESES[grilla.mes - 1]} {grilla.anio}
            </h2>
            <button
              onClick={() => moverMes(1)}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <Button
              onClick={() => {
                setAncla(hoy.slice(0, 7))
                setDiaAbierto(hoy)
              }}
              variant="outline"
              size="sm"
              className="ml-2"
            >
              Hoy
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {CAPAS.map((capa) => {
              const activa = capas[capa.id]
              const total = totales[capa.id]
              return (
                <button
                  key={capa.id}
                  onClick={() => setCapas((prev) => ({ ...prev, [capa.id]: !prev[capa.id] }))}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activa ? 'border-transparent' : 'border-gray-200 bg-white text-gray-400'
                  }`}
                  style={
                    activa
                      ? { backgroundColor: capa.color.soft, color: capa.color.ink }
                      : undefined
                  }
                  title={activa ? 'Ocultar en el calendario' : 'Mostrar en el calendario'}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: activa ? capa.color.hex : '#D1D5DB' }}
                    aria-hidden
                  />
                  {capa.nombre}
                  <span className="opacity-60">({total})</span>
                </button>
              )
            })}
            <Button onClick={() => cargar(true)} variant="secondary" size="sm" disabled={cargando}>
              <RefreshCw className={`mr-2 h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>
        </div>

        {google && !google.connected && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold">
                {google.configured
                  ? 'No se pudieron leer los calendarios de Google'
                  : 'Los calendarios de Google todavía no están conectados'}
              </p>
              <p className="text-amber-700">
                {google.configured
                  ? google.error || 'n8n no respondió con eventos.'
                  : 'Falta configurar N8N_CALENDAR_WEBHOOK_URL y N8N_CALENDAR_TOKEN en el entorno.'}{' '}
                Las reservas del cotizador se siguen viendo con normalidad.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Rejilla del mes */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {DIAS_CORTOS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grilla.dias.map((dia) => {
            const delMes = Number(dia.slice(5, 7)) === grilla.mes
            const esHoy = dia === hoy
            const seleccionado = dia === diaAbierto
            const chips = chipsDe(dia)
            const visibles = chips.slice(0, MAX_CHIPS_POR_DIA)
            const resto = chips.length - visibles.length

            return (
              <button
                key={dia}
                onClick={() => setDiaAbierto(seleccionado ? null : dia)}
                className={`min-h-[112px] border-b border-r p-2 text-left align-top transition-colors last:border-r-0 ${
                  delMes ? 'bg-white' : 'bg-gray-50/60'
                } ${seleccionado ? 'ring-2 ring-inset ring-secondary-400' : 'hover:bg-gray-50'}`}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                      esHoy
                        ? 'bg-secondary-500 text-white'
                        : delMes
                          ? 'text-gray-900'
                          : 'text-gray-400'
                    }`}
                  >
                    {Number(dia.slice(8, 10))}
                  </span>
                  {chips.length > 0 && (
                    <span className="text-[10px] font-medium text-gray-400">{chips.length}</span>
                  )}
                </div>

                <div className="space-y-1">
                  {visibles.map((chip) => (
                    <div
                      key={chip.key}
                      className={`truncate rounded px-1.5 py-1 text-[11px] font-medium ${
                        chip.punteado ? 'border border-dashed' : ''
                      }`}
                      style={{
                        backgroundColor: chip.color.soft,
                        color: chip.color.ink,
                        borderColor: chip.punteado ? chip.color.hex : undefined,
                      }}
                      title={`${chip.hora ? chip.hora + ' · ' : ''}${chip.titulo}`}
                    >
                      {chip.hora && <span className="opacity-70">{chip.hora} </span>}
                      {chip.titulo}
                    </div>
                  ))}
                  {resto > 0 && (
                    <div className="px-1.5 text-[11px] font-medium text-gray-500">+{resto} más</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      {/* Detalle del día elegido */}
      {diaAbierto && (
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{etiquetaLarga(diaAbierto)}</h3>
            <Button onClick={() => setDiaAbierto(null)} variant="outline" size="sm">
              Cerrar
            </Button>
          </div>

          {detalle.length === 0 ? (
            <div className="py-8 text-center">
              <CalendarDays className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-gray-600">Nada agendado este día.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {detalle.map((chip) => {
                const r = chip.reserva
                const e = chip.evento
                const lugar = r
                  ? r.booking_type === 'domicilio'
                    ? r.visit_address
                    : [r.origin_address, r.destination_address].filter(Boolean).join(' → ')
                  : e?.location
                const nota = e?.description ? sinHtml(e.description) : ''

                return (
                  <div
                    key={chip.key}
                    className="flex items-start justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 p-4"
                    style={{ borderLeft: `4px solid ${chip.color.hex}` }}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                          {chip.hora || 'Todo el día'}
                        </span>
                        <span className="font-semibold text-gray-900">{chip.titulo}</span>
                        {r?.is_provisional && (
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-semibold text-yellow-800">
                            Provisional
                          </span>
                        )}
                        {e && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: chip.color.soft, color: chip.color.ink }}
                          >
                            {e.calendarLabel}
                          </span>
                        )}
                      </div>

                      {r && (
                        <p className="mt-1 text-sm text-gray-600">
                          {r.client_phone || 'Sin teléfono'}
                          {r.quote_id ? ` · ${r.quote_id}` : ''}
                          {r.booking_type === 'domicilio' ? ' · Visita a domicilio' : ''}
                        </p>
                      )}

                      {lugar && (
                        <p className="mt-1 flex items-start gap-1 text-sm text-gray-600">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="break-words">{lugar}</span>
                        </p>
                      )}

                      {nota && <p className="mt-1 line-clamp-2 text-sm text-gray-500">{nota}</p>}

                      {r?.vehicle && (
                        <span
                          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: r.vehicle.color.soft,
                            color: r.vehicle.color.ink,
                          }}
                          title={r.vehicle.driver ? `Chofer: ${r.vehicle.driver}` : undefined}
                        >
                          <Truck className="h-3 w-3" />
                          {r.vehicle.name}
                        </span>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      {r && (
                        <>
                          <p className="font-semibold text-gray-900">
                            {r.estimated_price
                              ? `$${Math.round(r.estimated_price).toLocaleString('es-CL')}`
                              : 'N/A'}
                          </p>
                          <button
                            onClick={() => abrirReserva(r)}
                            className="mt-1 text-xs font-semibold text-secondary-600 hover:text-secondary-700"
                          >
                            Ver reserva
                          </button>
                        </>
                      )}
                      {e?.htmlLink && (
                        <a
                          href={e.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-secondary-600 hover:text-secondary-700"
                        >
                          Abrir en Google
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
