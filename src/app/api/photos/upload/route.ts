import { siteBaseUrl, toHiddenFileUrl } from '@/lib/fileLinks'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sniffFileType } from '@/lib/documents'

/**
 * API endpoint para subir fotos de items/propiedades a Supabase Storage
 * Las fotos se almacenan en el bucket 'bookings' bajo la carpeta 'photos/'
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[upload-photos] Iniciando proceso de subida de fotos...')

    // Cortar peticiones gigantes ANTES de recibir el body completo (endpoint público
    // sin auth): 10 fotos x 5MB + margen para overhead de multipart.
    const MAX_TOTAL_BYTES = 60 * 1024 * 1024
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > MAX_TOTAL_BYTES) {
      console.error('[upload-photos] ERROR: Petición demasiado grande:', contentLength)
      return NextResponse.json(
        { error: 'La petición excede el tamaño máximo permitido' },
        { status: 413 }
      )
    }

    const formData = await request.formData()
    const files = formData.getAll('photos') as File[]

    console.log('[upload-photos] Número de archivos recibidos:', files.length)

    if (!files || files.length === 0) {
      console.error('[upload-photos] ERROR: No se recibieron archivos')
      return NextResponse.json(
        { error: 'No se recibieron archivos' },
        { status: 400 }
      )
    }

    // Tope de archivos por petición: endpoint público sin auth, sin este límite
    // una sola petición puede mandar cientos de archivos de 5MB cada uno.
    const MAX_FILES_PER_REQUEST = 10
    if (files.length > MAX_FILES_PER_REQUEST) {
      console.error('[upload-photos] ERROR: Demasiados archivos en una petición:', files.length)
      return NextResponse.json(
        { error: `Máximo ${MAX_FILES_PER_REQUEST} fotos por vez` },
        { status: 400 }
      )
    }

    // Validar que sean imágenes
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    const invalidFiles = files.filter(file => !validImageTypes.includes(file.type))
    
    if (invalidFiles.length > 0) {
      console.error('[upload-photos] ERROR: Archivos con formato inválido')
      return NextResponse.json(
        { error: 'Solo se permiten archivos JPG, PNG o WEBP' },
        { status: 400 }
      )
    }

    // Validar tamaño (máximo 5MB por archivo)
    const maxSize = 5 * 1024 * 1024 // 5MB
    const oversizedFiles = files.filter(file => file.size > maxSize)
    
    if (oversizedFiles.length > 0) {
      console.error('[upload-photos] ERROR: Archivos muy pesados')
      return NextResponse.json(
        { error: 'Cada foto debe pesar menos de 5MB' },
        { status: 400 }
      )
    }

    const uploadedUrls: string[] = []

    // Subir cada archivo
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      console.log(`[upload-photos] Subiendo archivo ${i + 1}/${files.length}: ${file.name}`)

      // Convertir File a ArrayBuffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // (Auditoría 2026-11-04 §6.6/N10) El nombre que declara el navegador no prueba
      // nada y el timestamp anterior hacía las rutas enumerables: el tipo real sale de
      // los primeros bytes y la ruta de un UUID, así que nadie puede adivinar la foto
      // de otra persona probando marcas de tiempo.
      const sniffed = sniffFileType(buffer)
      if (!sniffed || !['image/jpeg', 'image/png', 'image/webp'].includes(sniffed.mime)) {
        return NextResponse.json(
          { error: 'Solo se permiten archivos JPG, PNG o WEBP' },
          { status: 400 }
        )
      }
      const filePath = `photos/${globalThis.crypto.randomUUID()}.${sniffed.ext}`

      // Subir a Supabase Storage
      const { data: uploadData, error: uploadError } = await supabaseAdmin
        .storage
        .from('bookings')
        .upload(filePath, buffer, {
          contentType: sniffed.mime,
          upsert: false
        })

      if (uploadError) {
        console.error(`[upload-photos] ERROR al subir archivo ${i + 1}:`, uploadError)
        // Si ya subimos algunos archivos, eliminarlos
        if (uploadedUrls.length > 0) {
          console.log('[upload-photos] Limpiando archivos ya subidos...')
          // TODO: Implementar limpieza de archivos parciales si es necesario
        }
        return NextResponse.json(
          { error: `Error al subir foto ${i + 1}: ${uploadError.message}` },
          { status: 500 }
        )
      }

      // Obtener URL pública
      const { data: urlData } = supabaseAdmin
        .storage
        .from('bookings')
        .getPublicUrl(filePath)

      // Se devuelve (y después se guarda) el link del sitio, no el del almacenamiento.
      uploadedUrls.push(toHiddenFileUrl(urlData.publicUrl, siteBaseUrl() || request.nextUrl.origin))
      console.log(`[upload-photos] Foto ${i + 1} subida exitosamente`)
    }

    console.log('[upload-photos] Todas las fotos subidas exitosamente:', uploadedUrls.length)

    return NextResponse.json({
      success: true,
      urls: uploadedUrls,
      count: uploadedUrls.length,
      message: `${uploadedUrls.length} foto(s) subida(s) exitosamente`
    })

  } catch (error) {
    console.error('[upload-photos] Error general:', error)
    return NextResponse.json(
      { 
        error: 'Error al procesar las fotos', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
