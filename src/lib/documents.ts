/**
 * Documentos y fotos de clientes, empresas y trabajadores (etapa 2 del panel).
 *
 * Tres decisiones que conviene tener presentes:
 *
 *  1) EL BUCKET ES PRIVADO ('documentos'). Acá van facturas, boletas de gastos y fotos de
 *     casas: nada se sirve por URL pública. Se entrega con una URL firmada que vence en
 *     minutos, generada en el servidor después de validar quién la pide.
 *
 *  2) EL TIPO SE MIRA EN LOS BYTES, NO EN LO QUE DICE EL NAVEGADOR. `file.type` lo pone
 *     el cliente y se falsifica en una línea; se comparan los primeros bytes del archivo
 *     con la firma de JPG, PNG, WEBP, HEIC o PDF. Lo que no calza, no se guarda.
 *
 *  3) LA RUTA LA ARMA EL SERVIDOR. El nombre que trae el archivo solo se guarda como dato
 *     (`file_name`); la ruta es <dueño>/<año>/<mes>/<uuid>, así nadie puede pisar el archivo
 *     de otro ni escribir fuera de su carpeta.
 *
 *  4) LOS ARCHIVOS NO PASAN POR EL SERVIDOR. Se suben directo al bucket con un permiso
 *     firmado de un solo uso (ver createUploadTickets); el servidor solo los revisa y los
 *     registra al final (confirmUploads).
 */

import { supabaseAdmin } from '@/lib/supabase'

export const DOCUMENTS_BUCKET = 'documentos'
export const MAX_FILE_BYTES = 15 * 1024 * 1024
export const MAX_FILES_PER_UPLOAD = 10
/** Minutos que dura un link para ver o descargar un documento. */
export const SIGNED_URL_SECONDS = 5 * 60

export type DocumentKind = 'foto' | 'documento' | 'gasto'
export type UploaderType = 'cliente' | 'trabajador' | 'admin'

export interface StoredDocument {
  id: string
  booking_id: string | null
  customer_id: string | null
  company_id: string | null
  uploaded_by_type: UploaderType
  uploaded_by_label: string | null
  kind: DocumentKind
  storage_path: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  note: string | null
  amount: number | null
  created_at: string
}

export const DOCUMENT_FIELDS =
  'id, booking_id, customer_id, company_id, uploaded_by_type, uploaded_by_label, kind, storage_path, file_name, mime_type, size_bytes, note, amount, created_at'

const SNIFFERS: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP',
  },
  {
    // HEIC/HEIF (fotos de iPhone): caja 'ftyp' en el byte 4 con una marca HEIF.
    mime: 'image/heic',
    ext: 'heic',
    test: (b) => ascii(b, 4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heif'].includes(ascii(b, 8, 4)),
  },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => ascii(b, 0, 5) === '%PDF-' },
]

function ascii(b: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...Array.from(b.slice(start, start + len)))
}

/** Tipo real de un archivo por sus primeros bytes, o null si no es uno permitido. */
export function sniffFileType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const hit = SNIFFERS.find((s) => s.test(bytes))
  return hit ? { mime: hit.mime, ext: hit.ext } : null
}

export class DocumentUploadError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'DocumentUploadError'
  }
}

/** Tipos que el navegador puede declarar al pedir permiso de subida. */
const DECLARABLE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

/** Mismo tipo, distinto nombre: JPG/JPEG y HEIC/HEIF se comparan como iguales. */
function sameType(a: string, b: string): boolean {
  const n = (m: string) => m.toLowerCase().replace('image/jpg', 'image/jpeg').replace('image/heif', 'image/heic')
  return n(a) === n(b)
}

export interface UploadTicket {
  path: string
  /** URL firmada de un solo uso: el navegador sube el archivo directo al bucket. */
  uploadUrl: string
}

/**
 * Paso 1 de una subida: permisos para subir los archivos DIRECTO al bucket.
 *
 * Los archivos no pasan por el servidor a propósito: Vercel corta el cuerpo de una
 * petición a una función en 4,5 MB, y dos o tres fotos de celular ya lo superan. El
 * servidor solo decide la ruta (dentro de la carpeta del dueño) y la firma.
 */
export async function createUploadTickets(
  folder: string,
  files: { name: string; size: number; type: string }[]
): Promise<UploadTicket[]> {
  if (files.length === 0) throw new DocumentUploadError('Elige al menos un archivo.')
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new DocumentUploadError(`Puedes subir hasta ${MAX_FILES_PER_UPLOAD} archivos a la vez.`)
  }
  for (const f of files) {
    if (!f.size || f.size > MAX_FILE_BYTES) throw new DocumentUploadError(`«${f.name}» pesa más de 15 MB.`)
    if (!DECLARABLE_TYPES.includes(String(f.type).toLowerCase())) {
      throw new DocumentUploadError(`«${f.name}» no es una foto (JPG, PNG, WEBP, HEIC) ni un PDF.`)
    }
  }

  const now = new Date()
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const tickets: UploadTicket[] = []
  for (let i = 0; i < files.length; i++) {
    const path = `${folder}/${month}/${globalThis.crypto.randomUUID()}`
    const { data, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path)
    if (error || !data?.signedUrl) throw new DocumentUploadError('No pudimos preparar la subida. Intenta de nuevo.', 500)
    tickets.push({ path, uploadUrl: data.signedUrl })
  }
  return tickets
}

export interface ConfirmInput {
  /** Carpeta del dueño: solo se aceptan rutas dentro de ella. */
  folder: string
  items: { path: string; fileName: string }[]
  uploader: { type: UploaderType; id: string; label: string }
  bookingId?: string | null
  customerId?: string | null
  companyId?: string | null
  kind: DocumentKind
  note?: string | null
  amount?: number | null
  /** N° de boleta o factura de un gasto (columna de add_operacion_terreno.sql). */
  docNumber?: string | null
  /** Cómo se pagó un gasto: 'contado' o 'credito' (columna de add_pay_closings.sql). */
  expensePayment?: 'contado' | 'credito' | null
}

/** N° de comprobante en forma comparable: mayúsculas, sin espacios ni puntos. */
export function normalizeDocNumber(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z-]/g, '')
    .slice(0, 40)
}

/**
 * ¿Ya se rindió un gasto con este N° de comprobante? Devuelve los que existen (sin los
 * rechazados, que se pueden volver a rendir). Vacío también si falta la columna.
 */
export async function findExpensesByDocNumber(
  docNumber: string
): Promise<{ id: string; amount: number; label: string; createdAt: string }[]> {
  if (!docNumber) return []
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('kind', 'gasto')
    .eq('doc_number', docNumber)
    .limit(20)
  if (error) return []
  return ((data || []) as Record<string, any>[])
    .filter((r) => r.expense_status !== 'rechazado')
    .map((r) => ({ id: r.id, amount: Number(r.amount) || 0, label: r.uploaded_by_label || 'Trabajador', createdAt: r.created_at }))
}

/** Primeros bytes de un objeto del bucket, sin bajarlo entero. */
async function headBytes(path: string): Promise<Uint8Array | null> {
  const { data } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 60)
  if (!data?.signedUrl) return null
  const res = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-31' } })
  if (!res.ok) return null
  return new Uint8Array(await res.arrayBuffer()).slice(0, 32)
}

/** Tamaño y tipo declarado de un objeto, según el bucket. */
async function objectInfo(path: string): Promise<{ size: number; mimetype: string } | null> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const name = path.slice(path.lastIndexOf('/') + 1)
  const { data } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).list(dir, { search: name, limit: 5 })
  const hit = (data || []).find((o) => o.name === name)
  if (!hit?.metadata) return null
  return { size: Number(hit.metadata.size) || 0, mimetype: String(hit.metadata.mimetype || '') }
}

/**
 * Paso 3 de una subida: el navegador avisa que subió; el servidor revisa cada archivo
 * DE VERDAD (está en la carpeta del dueño, pesa ≤ 15 MB y sus primeros bytes son de una
 * foto o un PDF del mismo tipo que declaró) y recién ahí lo registra.
 *
 * O se registran todos o ninguno: si uno no pasa, se borran del bucket todos los de la
 * tanda, para que no queden archivos huérfanos ni una subida a medias.
 */
export async function confirmUploads(input: ConfirmInput): Promise<StoredDocument[]> {
  const { items } = input
  const paths = items.map((i) => i.path)
  const discard = () => supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(paths)

  if (items.length === 0 || items.length > MAX_FILES_PER_UPLOAD) throw new DocumentUploadError('Subida inválida.')
  // TODAS las rutas se validan antes de mirar o borrar nada: `discard` borra la tanda
  // entera, así que una ruta ajena colada en la lista borraría el archivo de otra persona.
  const pathRe = new RegExp(`^${input.folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d{4}/\\d{2}/[0-9a-f-]{36}$`)
  if (new Set(paths).size !== paths.length || !paths.every((p) => pathRe.test(p))) {
    throw new DocumentUploadError('Subida inválida.')
  }
  // Un archivo ya registrado no se vuelve a confirmar: si esta tanda fallara, `discard`
  // lo borraría del bucket y su fila quedaría apuntando a la nada.
  const { data: taken, error: takenError } = await supabaseAdmin
    .from('documents')
    .select('id')
    .in('storage_path', paths)
    .limit(1)
  if (takenError || (taken && taken.length > 0)) throw new DocumentUploadError('Subida inválida.')

  const checked: { path: string; fileName: string; mime: string; size: number }[] = []
  for (const item of items) {
    const [info, bytes] = await Promise.all([objectInfo(item.path), headBytes(item.path)])
    const sniffed = bytes ? sniffFileType(bytes) : null
    if (!info || !bytes) {
      await discard()
      throw new DocumentUploadError(`No encontramos «${item.fileName}». Vuelve a subirlo.`)
    }
    if (info.size > MAX_FILE_BYTES) {
      await discard()
      throw new DocumentUploadError(`«${item.fileName}» pesa más de 15 MB.`)
    }
    if (!sniffed || !sameType(sniffed.mime, info.mimetype)) {
      await discard()
      throw new DocumentUploadError(`«${item.fileName}» no es una foto (JPG, PNG, WEBP, HEIC) ni un PDF.`)
    }
    checked.push({ path: item.path, fileName: item.fileName, mime: sniffed.mime, size: info.size })
  }

  const rows = checked.map((c) => ({
    booking_id: input.bookingId || null,
    customer_id: input.customerId || null,
    company_id: input.companyId || null,
    uploaded_by_type: input.uploader.type,
    uploaded_by_id: input.uploader.id,
    uploaded_by_label: input.uploader.label,
    kind: input.kind,
    storage_path: c.path,
    file_name: String(c.fileName || '').slice(0, 200) || null,
    mime_type: c.mime,
    size_bytes: c.size,
    note: input.note?.trim().slice(0, 500) || null,
    amount: input.amount ?? null,
  }))
  const insert = (list: Record<string, unknown>[]) => supabaseAdmin.from('documents').insert(list).select(DOCUMENT_FIELDS)

  // El N° del comprobante va en una columna nueva: si todavía no existe, el gasto se
  // registra igual, sin el número (subir un comprobante no puede depender de la migración).
  const extra = {
    ...(input.docNumber ? { doc_number: input.docNumber } : {}),
    ...(input.expensePayment ? { expense_payment: input.expensePayment } : {}),
  }
  let { data, error } = await insert(Object.keys(extra).length > 0 ? rows.map((r) => ({ ...r, ...extra })) : rows)
  // Si falta la columna de la forma de pago, se reintenta sin ella; si falta también la del
  // número, sin ninguna de las dos.
  if (error && extra.expense_payment && /expense_payment/.test(`${error.message} ${error.details || ''}`)) {
    ;({ data, error } = await insert(input.docNumber ? rows.map((r) => ({ ...r, doc_number: input.docNumber })) : rows))
  }
  if (error && input.docNumber && /doc_number/.test(`${error.message} ${error.details || ''}`)) {
    ;({ data, error } = await insert(rows))
  }

  if (error || !data) {
    await discard()
    throw new DocumentUploadError('No pudimos registrar los archivos. Intenta de nuevo.', 500)
  }
  return data as StoredDocument[]
}

/** URL firmada y de corta duración para ver o descargar un documento. */
export async function signedDocumentUrl(doc: Pick<StoredDocument, 'storage_path' | 'file_name'>, download = false) {
  const { data, error } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, download ? { download: doc.file_name || true } : undefined)
  if (error || !data?.signedUrl) throw new Error('No se pudo firmar el documento')
  return data.signedUrl
}

/**
 * Entrega un documento privado desde el servidor, sin redirigir al almacenamiento: así el
 * navegador nunca ve la dirección del proyecto de base de datos ni un link firmado que se
 * pueda copiar. Quien llama YA validó que la persona puede ver ese documento.
 */
export async function documentResponse(
  doc: Pick<StoredDocument, 'storage_path' | 'file_name'>,
  download = false
): Promise<Response> {
  const { data, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_path)
  if (error || !data) throw new Error('No se pudo leer el documento')
  const name = String(doc.file_name || 'documento').replace(/[\r\n"]/g, '').slice(0, 150)
  return new Response(data.stream(), {
    status: 200,
    headers: {
      'Content-Type': data.type || 'application/octet-stream',
      'Content-Length': String(data.size),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Documento privado: no se guarda en cachés compartidas.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

