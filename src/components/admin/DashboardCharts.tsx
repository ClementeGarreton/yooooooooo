'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Cell,
} from 'recharts'
import type { MonthlyPoint, SourceCount, FunnelStage } from '@/lib/adminAnalytics'

interface AnalyticsData {
  monthly: MonthlyPoint[]
  sources: SourceCount[]
  funnel: FunnelStage[]
}

/**
 * Abre la pestaña Reservas filtrada por ese mes.
 *
 * Reusa el filtro de rango que ya existe en Reservas en vez de inventar uno nuevo: se
 * pasa desde/hasta por la URL, igual que el `?q=` con el que el dashboard ya abre una
 * reserva puntual. El último día se calcula con `new Date(año, mes, 0)`, que devuelve el
 * último del mes anterior al que se le pasa — o sea el correcto, sin tabla de 30/31.
 */
function abrirMesEnReservas(month: string) {
  const [anio, mes] = month.split('-').map(Number)
  if (!anio || !mes) return
  const ultimo = new Date(anio, mes, 0).getDate()
  const desde = `${month}-01`
  const hasta = `${month}-${String(ultimo).padStart(2, '0')}`
  window.location.href = `/admin?tab=bookings&desde=${desde}&hasta=${hasta}`
}

const BRAND = '#ff6a2c'
const SOURCE_COLORS: Record<string, string> = {
  web: '#2c7fff',
  rrss: '#ec4899',
  recomendacion: '#14b8a6',
  cliente_antiguo: '#16a34a',
}
const FUNNEL_COLORS = ['#ff6a2c', '#2c7fff', '#22c55e']

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

export default function DashboardCharts() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/analytics')
        if (!res.ok) throw new Error('fetch failed')
        const json = await res.json()
        if (active) setData(json)
      } catch {
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-gray-500">Cargando gráficos…</p>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="p-6">
        <p className="text-sm text-gray-500">No se pudo cargar la analítica.</p>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="p-6 lg:col-span-2">
        <h3 className="mb-1 text-lg font-semibold text-gray-900">Reservas e ingresos por mes</h3>
        <p className="mb-4 text-sm text-gray-500">
          Últimos 6 meses · por fecha de mudanza · mismo criterio que las tarjetas de
          arriba (excluye canceladas, no atendidas y pre-reservas sin pagar) ·{' '}
          <span className="font-medium text-gray-600">clic en un mes para ver sus reservas</span>
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart
            data={data.monthly}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            onClick={(e: any) => {
              const punto = e?.activePayload?.[0]?.payload as MonthlyPoint | undefined
              if (punto?.month) abrirMesEnReservas(punto.month)
            }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${Math.round(Number(v) / 1000).toLocaleString('es-CL')}k`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              allowDecimals={false}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              formatter={(value: unknown, name: unknown) =>
                name === 'Reservas' ? String(value) : clp(Number(value))
              }
            />
            {/* Apiladas: cobrado abajo y por cobrar arriba. Juntas NO siempre suman el
                valor reservado — a quien pagó completo se le descontó un 5%, y ese
                descuento no es deuda de nadie. Por eso el total va en el tooltip como
                línea aparte y no como la altura de la barra. */}
            <Bar
              yAxisId="left"
              dataKey="paid"
              name="Cobrado"
              stackId="dinero"
              fill="#16a34a"
            />
            <Bar
              yAxisId="left"
              dataKey="pending"
              name="Por cobrar"
              stackId="dinero"
              fill={BRAND}
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="count"
              name="Reservas"
              stroke="#2c7fff"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-900">Clientes por origen</h3>
        <p className="mb-4 text-sm text-gray-500">
          Clientes atendidos o agregados manualmente · un cliente por email
        </p>
        {data.sources.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={data.sources}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="label" width={92} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" name="Clientes" radius={[0, 4, 4, 0]}>
                {data.sources.map((source) => (
                  <Cell key={source.source} fill={SOURCE_COLORS[source.source] || '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-900">Embudo</h3>
        <p className="mb-4 text-sm text-gray-500">Leads → Reservas → Completadas</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.funnel} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="count" name="Cantidad" radius={[4, 4, 0, 0]}>
              {data.funnel.map((_, i) => (
                <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}
