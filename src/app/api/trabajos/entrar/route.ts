import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeRut } from '@/lib/rut'
import { hashPassword, verifyPassword } from '@/lib/passwordHash'
import { WORKER_SESSION_COOKIE, WORKER_SESSION_MAX_AGE, createWorkerSessionToken } from '@/lib/workerSession'

export const dynamic = 'force-dynamic'

// Hash de relleno: cuando el RUT no existe se verifica igual contra esto, para que la
// respuesta tarde lo mismo y no se pueda averiguar qué RUT son de trabajadores.
let dummyHash: Promise<string> | null = null

/**
 * Entrada del trabajador a `/trabajos`: RUT + PIN personal. El mensaje de error es el
 * mismo para RUT inexistente, trabajador desactivado y PIN equivocado. El tope anti
 * fuerza bruta está en el middleware (ver RATE_LIMIT_RULES).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const rut = normalizeRut(body?.rut)
    const pin = String(body?.pin || '').trim()

    const { data: worker } = rut
      ? await supabaseAdmin.from('workers').select('id, active, pin_hash').eq('rut', rut).maybeSingle()
      : { data: null }

    dummyHash = dummyHash || hashPassword('000000')
    const ok = await verifyPassword(pin, worker?.pin_hash || (await dummyHash))
    if (!worker || !worker.active || !ok) {
      return NextResponse.json({ error: 'RUT o PIN incorrecto' }, { status: 401 })
    }

    const response = NextResponse.json({ success: true })
    response.cookies.set(WORKER_SESSION_COOKIE, await createWorkerSessionToken(worker.id, worker.pin_hash), {
      httpOnly: true,
      secure: request.url.startsWith('https://'),
      sameSite: 'lax',
      maxAge: WORKER_SESSION_MAX_AGE,
      path: '/',
    })
    return response
  } catch (error) {
    console.error('[trabajos/entrar] Error:', error)
    return NextResponse.json({ error: 'No se pudo verificar. Intenta de nuevo.' }, { status: 500 })
  }
}
