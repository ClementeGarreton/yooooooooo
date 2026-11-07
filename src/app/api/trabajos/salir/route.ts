import { NextResponse } from 'next/server'
import { WORKER_SESSION_COOKIE } from '@/lib/workerSession'

export const dynamic = 'force-dynamic'

/** Cierra la sesión del trabajador en este dispositivo. */
export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(WORKER_SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
  return response
}
