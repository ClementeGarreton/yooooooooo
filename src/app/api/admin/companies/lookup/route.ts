import { NextRequest, NextResponse } from 'next/server'
import { lookupCompany } from '@/lib/companyLookup'

export const dynamic = 'force-dynamic'

/** Lo que el sistema ya sabe de una empresa por su RUT (`?rut=`): SII y reservas. Solo lectura. */
export async function GET(request: NextRequest) {
  const result = await lookupCompany(request.nextUrl.searchParams.get('rut'))
  if (!result) return NextResponse.json({ error: 'RUT inválido' }, { status: 400 })
  return NextResponse.json(result)
}
