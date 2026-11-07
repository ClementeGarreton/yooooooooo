import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { flowService } from '@/lib/flowService'
import { applyFlowPaymentByCommerceOrder } from '@/lib/paymentSync'
import { logAdminAction } from '@/lib/activityLog'

// Edad mínima (en horas) de una pre-reserva provisional para considerarla abandonada.
const PROVISIONAL_MAX_AGE_HOURS = 24

interface CleanupResult {
  deleted: number
  rescued: number
}

/** Fecha 'YYYY-MM-DD' en zona horaria de Chile (Flow indexa los pagos por día local). */
function chileDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** ¿El commerceOrder de Flow corresponde a este quote_id? (online lleva sufijo, domicilio no). */
function orderMatchesQuote(commerceOrder: string, quoteId: string): boolean {
  return commerceOrder === quoteId || commerceOrder.startsWith(`${quoteId}-`)
}

// Limpia SOLO pre-reservas provisionales abandonadas: nunca pagadas y con más de 24h.
// RED DE SEGURIDAD: antes de borrar, consulta Flow por los pagos de esos días. Si una
// pre-reserva tiene en realidad un pago APROBADO (p. ej. el webhook falló y el cliente no
// volvió por el navegador), NO se borra: se rescata aplicando el pago como lo haría el
// webhook. Si no se puede verificar contra Flow, NO se borra nada (ante la duda, no perder
// una reserva pagada).
/** Retención del log de actividad: 12 meses (ver docs/DISENO_USUARIOS_Y_AUDITORIA.md). */
const ACTIVITY_LOG_RETENTION_DAYS = 365

/**
 * Borra registros de auditoría más viejos que la retención acordada.
 * Nunca lanza: si falla, la limpieza de reservas debe seguir su curso igual.
 */
async function purgeOldActivityLog(): Promise<number> {
  try {
    const cutoff = new Date(
      Date.now() - ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()

    const { data, error } = await supabaseAdmin
      .from('admin_activity_log')
      .delete()
      .lt('created_at', cutoff)
      .select('id')

    if (error) {
      console.error('[CLEANUP] Error purgando el log de actividad:', error)
      return 0
    }

    const purged = data?.length || 0
    if (purged) console.log(`[CLEANUP] ${purged} registros de actividad purgados (>12 meses).`)
    return purged
  } catch (err) {
    console.error('[CLEANUP] Excepción purgando el log de actividad:', err)
    return 0
  }
}

async function runCleanup(): Promise<CleanupResult> {
  const cutoff = new Date(
    Date.now() - PROVISIONAL_MAX_AGE_HOURS * 60 * 60 * 1000
  ).toISOString()

  const { data: stale, error: fetchError } = await supabaseAdmin
    .from('bookings')
    .select('id, quote_id, client_name, created_at')
    .eq('is_provisional', true)
    .eq('payment_status', 'pending')
    .eq('status', 'pending')
    .lt('created_at', cutoff)

  if (fetchError) {
    throw new Error(`Error al buscar reservas: ${fetchError.message}`)
  }

  if (!stale || stale.length === 0) return { deleted: 0, rescued: 0 }

  // Sin Flow no podemos distinguir "abandonada" de "pagada pero no sincronizada":
  // preferimos dejar basura provisional antes que borrar una reserva realmente pagada.
  if (!flowService.isConfigured()) {
    console.warn('[CLEANUP] Flow no configurado: se omite el borrado por seguridad.')
    return { deleted: 0, rescued: 0 }
  }

  // Días a consultar en Flow: el de creación de cada candidata y el siguiente (el pago pudo
  // cruzar la medianoche respecto a la creación de la pre-reserva).
  const days = new Set<string>()
  for (const b of stale) {
    const created = new Date(b.created_at)
    days.add(chileDateStr(created))
    days.add(chileDateStr(new Date(created.getTime() + 24 * 60 * 60 * 1000)))
  }

  const approvedOrders: string[] = []
  try {
    for (const day of days) {
      const payments = await flowService.getPaymentsByDate(day)
      for (const p of payments) {
        if (p?.status === 2 && typeof p.commerceOrder === 'string') {
          approvedOrders.push(p.commerceOrder)
        }
      }
    }
  } catch (flowErr) {
    console.error('[CLEANUP] No se pudo verificar contra Flow; se aborta el borrado:', flowErr)
    return { deleted: 0, rescued: 0 }
  }

  // Separa las que tienen pago aprobado (rescatar) de las realmente abandonadas (borrar).
  const idsToDelete: string[] = []
  const toRescue: string[] = [] // commerceOrders aprobados que matchean una candidata
  for (const b of stale) {
    const paidOrder = approvedOrders.find((co) => orderMatchesQuote(co, b.quote_id))
    if (paidOrder) toRescue.push(paidOrder)
    else idsToDelete.push(b.id)
  }

  // Rescatar: misma fuente de verdad que el webhook (approved/confirmed, no provisional,
  // prospecto convertido). Cada fallo se registra pero NO provoca borrado.
  let rescued = 0
  for (const commerceOrder of toRescue) {
    try {
      await applyFlowPaymentByCommerceOrder(commerceOrder)
      rescued++
      console.log(`[CLEANUP] Reserva rescatada desde Flow (commerceOrder=${commerceOrder}).`)
    } catch (rescueErr) {
      console.error(`[CLEANUP] Error rescatando ${commerceOrder}; no se borra:`, rescueErr)
    }
  }

  // La limpieza la corre Vercel, no una persona, pero lo que borra o rescata también
  // tiene que quedar en Actividad (pedido del 28-sep-2026: «todo debe quedar en los logs
  // de movimientos»). Queda a nombre de «sistema».
  if (rescued > 0) {
    await logAdminAction({
      actor: null,
      action: 'booking.cleanup_rescued',
      entityType: 'booking',
      summary: `Rescató ${rescued} pre-reserva${rescued === 1 ? '' : 's'} con pago aprobado en Flow que no se había sincronizado (${toRescue.join(', ')})`,
    })
  }

  if (idsToDelete.length === 0) {
    console.log(`[CLEANUP] 0 borradas, ${rescued} rescatadas.`)
    return { deleted: 0, rescued }
  }

  // Guarda de seguridad final: jamás eliminar algo con pago aprobado.
  const { error: deleteError } = await supabaseAdmin
    .from('bookings')
    .delete()
    .in('id', idsToDelete)
    .eq('is_provisional', true)
    .neq('payment_status', 'approved')

  if (deleteError) {
    throw new Error(`Error al eliminar reservas: ${deleteError.message}`)
  }

  const borradas = stale.filter((b) => idsToDelete.includes(b.id))
  await logAdminAction({
    actor: null,
    action: 'booking.cleanup_deleted',
    entityType: 'booking',
    summary:
      `Borró ${borradas.length} pre-reserva${borradas.length === 1 ? '' : 's'} abandonada${borradas.length === 1 ? '' : 's'} ` +
      `(sin pago y con más de ${PROVISIONAL_MAX_AGE_HOURS} h): ` +
      borradas.map((b) => [b.quote_id, b.client_name].filter(Boolean).join(' · ')).join(', '),
    changes: {
      deleted: { from: borradas.map((b) => ({ id: b.id, quote_id: b.quote_id, client_name: b.client_name })), to: null },
    },
  })

  console.log(`[CLEANUP] ${idsToDelete.length} pre-reservas abandonadas eliminadas, ${rescued} rescatadas.`)
  return { deleted: idsToDelete.length, rescued }
}

// Disparo manual desde el admin.
export async function POST() {
  try {
    const { deleted, rescued } = await runCleanup()
    return NextResponse.json({
      success: true,
      deletedCount: deleted,
      rescuedCount: rescued,
      message: `Limpieza completada. ${deleted} pre-reservas abandonadas eliminadas` +
        (rescued ? `, ${rescued} rescatadas (tenían pago aprobado en Flow).` : '.'),
    })
  } catch (error) {
    console.error('[CLEANUP] Exception:', error)
    return NextResponse.json(
      { error: 'Error en limpieza', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

// Disparo automático por Vercel Cron (GET). Se exige el header Authorization: Bearer <CRON_SECRET> (Vercel lo envía automáticamente).
export async function GET(request: NextRequest) {
  // Sin el secreto configurado no corre: quedaría abierta a cualquiera.
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET no está configurado' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { deleted, rescued } = await runCleanup()
    const purgedLogs = await purgeOldActivityLog()
    return NextResponse.json({
      success: true,
      deletedCount: deleted,
      rescuedCount: rescued,
      purgedActivityLogs: purgedLogs,
    })
  } catch (error) {
    console.error('[CLEANUP] Exception:', error)
    return NextResponse.json(
      { error: 'Error en limpieza', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
