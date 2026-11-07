import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { PUBLIC_FILE_BUCKET, PUBLIC_FILE_FOLDERS } from '@/lib/fileLinks'

export const dynamic = 'force-dynamic'

/**
 * Entrega fotos del cliente y PDF de cotizaciones y reservas desde el dominio del sitio, para
 * que ningún link muestre la dirección del proyecto de base de datos. El archivo se lee con
 * la credencial del servidor y se devuelve tal cual.
 *
 * Solo sirve el bucket `bookings` y sus tres carpetas conocidas: no es una puerta al resto
 * del almacenamiento (los documentos privados van por sus propias rutas, con sesión).
 * Igual que antes, quien tiene el link ve el archivo: esto oculta la dirección, no agrega un
 * candado. `?download=nombre.pdf` lo baja con ese nombre.
 */
export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  const [bucket, folder, ...rest] = params.path || []
  const name = rest.join('/')
  const allowed =
    bucket === PUBLIC_FILE_BUCKET &&
    (PUBLIC_FILE_FOLDERS as readonly string[]).includes(folder) &&
    name.length > 0 &&
    name.length < 300 &&
    !name.includes('..') &&
    // Sin `%`: Next ya decodificó la ruta una vez y ningún archivo guardado lo lleva. Aceptarlo y
    // decodificar de nuevo dejaba pasar un `../` con doble codificación, que salía del bucket con
    // la credencial del servidor.
    /^[\w\-.@ +()]+$/.test(name)
  if (!allowed) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })

  const { data, error } = await supabaseAdmin.storage.from(PUBLIC_FILE_BUCKET).download(`${folder}/${name}`)
  if (error || !data) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })

  const headers = new Headers({
    'Content-Type': data.type || 'application/octet-stream',
    'Content-Length': String(data.size),
    // El archivo de una ruta no cambia: el navegador puede guardarlo un día.
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  })
  const download = request.nextUrl.searchParams.get('download')
  if (download) {
    const safe = download.replace(/[^\w\-. ]/g, '').slice(0, 120) || 'archivo'
    headers.set('Content-Disposition', `attachment; filename="${safe}"`)
  }
  return new NextResponse(data.stream(), { status: 200, headers })
}
