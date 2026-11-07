'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Subida de fotos y documentos, común a los tres paneles (cliente, trabajador, admin).
 * Cada panel pasa sus dos rutas; el flujo es siempre el mismo:
 *
 *  1) `ticketsUrl` devuelve un permiso firmado por archivo (la ruta la decide el servidor).
 *  2) Cada archivo se sube DIRECTO al bucket con ese permiso: no pasa por Vercel, que corta
 *     las peticiones a 4,5 MB.
 *  3) `confirmUrl` revisa los archivos de verdad y recién ahí los registra.
 */

type DocumentKindOption = 'foto' | 'gasto' | 'documento'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif'
const MAX_FILES = 10
const MAX_BYTES = 15 * 1024 * 1024

/** Varios navegadores no reconocen HEIC (fotos de iPhone) y dejan el tipo vacío. */
function declaredType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'heic') return 'image/heic'
  if (ext === 'heif') return 'image/heif'
  if (ext === 'pdf') return 'application/pdf'
  return ''
}

/**
 * Copia el archivo a memoria antes de subirlo.
 *
 * En Android, un archivo elegido desde la galería es una referencia a otra app: si entre que
 * se elige y se sube pasa un rato (el trabajador escribe el nombre y el monto del gasto), o
 * la galería lo vuelve a tocar, Chrome corta la subida con un «Failed to fetch» sin más
 * explicación. Leyéndolo completo al momento de subir, lo que viaja es una copia propia.
 * Si ni siquiera se puede leer, se dice eso en vez de un error de red.
 */
async function toMemory(file: File, type: string): Promise<File> {
  try {
    return new File([await file.arrayBuffer()], file.name, { type })
  } catch {
    throw new Error(`No pudimos leer «${file.name}» desde el teléfono. Elígelo de nuevo, o toma la foto con la cámara.`)
  }
}

/** `fetch` que traduce una caída de red a un mensaje con el paso en que ocurrió. */
async function fetchStep(step: string, url: string, init: RequestInit, retries = 0): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init)
    } catch {
      if (attempt >= retries) throw new Error(`Se cortó la conexión ${step}. Revisa tu señal e intenta de nuevo.`)
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
}

async function putToBucket(uploadUrl: string, file: File) {
  // Mismo formato que `uploadToSignedUrl` de supabase-js. El archivo ya viene etiquetado con
  // su tipo (ver `toMemory`): si fuera vacío, el bucket lo guarda como octet-stream y lo rechaza.
  // El permiso firmado de la URL alcanza: no se manda ninguna otra credencial.
  const body = () => {
    const form = new FormData()
    form.append('cacheControl', '3600')
    form.append('', file)
    return form
  }
  // Un reintento: en terreno la señal se cae a ratos, y el permiso sigue sirviendo.
  let res = await fetchStep(`al subir «${file.name}»`, uploadUrl, { method: 'PUT', body: body(), headers: { 'x-upsert': 'false' } }, 1)
  if (!res.ok && res.status >= 500) {
    res = await fetchStep(`al subir «${file.name}»`, uploadUrl, { method: 'PUT', body: body(), headers: { 'x-upsert': 'false' } })
  }
  if (!res.ok) throw new Error(`No pudimos subir «${file.name}» (error ${res.status}). Intenta de nuevo.`)
}

export default function DocumentUploader({
  ticketsUrl,
  confirmUrl,
  extra = {},
  title = 'Subir fotos o documentos',
  hint = 'Fotos (JPG, PNG, HEIC) o PDF, hasta 15 MB cada uno y 10 a la vez.',
  kinds,
}: {
  ticketsUrl: string
  confirmUrl: string
  /** Campos que van en ambos pasos, p. ej. `{ bookingId }`. */
  extra?: Record<string, unknown>
  title?: string
  hint?: string
  /**
   * Si viene, quien sube elige qué es (panel del trabajador: foto, gasto o documento) y un
   * gasto pide su monto. Si no viene, se deduce: todo imágenes = foto; si no, documento.
   */
  kinds?: { value: DocumentKindOption; label: string }[]
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [kind, setKind] = useState<DocumentKindOption>(kinds?.[0]?.value || 'foto')
  const [amount, setAmount] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [expensePayment, setExpensePayment] = useState<'' | 'contado' | 'credito'>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function pick(list: FileList | null) {
    setError(null)
    setDone(null)
    const picked = Array.from(list || [])
    if (picked.length > MAX_FILES) return setError(`Puedes subir hasta ${MAX_FILES} archivos a la vez.`)
    const tooBig = picked.find((f) => f.size > MAX_BYTES)
    if (tooBig) return setError(`«${tooBig.name}» pesa más de 15 MB.`)
    const wrong = picked.find((f) => !declaredType(f))
    if (wrong) return setError(`«${wrong.name}» no es una foto (JPG, PNG, WEBP, HEIC) ni un PDF.`)
    setFiles(picked)
  }

  async function upload() {
    if (files.length === 0 || busy) return
    setError(null)
    setDone(null)
    const amountValue = Number(amount.replace(/\D/g, ''))
    if (kinds && kind === 'gasto') {
      // Un gasto = un comprobante con su nombre y su monto: así se aprueba o rechaza entero.
      if (files.length > 1) return setError('Sube un comprobante por gasto.')
      if (!note.trim()) return setError('Escribe el nombre del gasto (por ejemplo: peaje, bencina, estacionamiento).')
      if (!(amountValue > 0)) return setError('Escribe el monto del gasto, en pesos.')
      // El N° del comprobante es lo que permite detectar un gasto rendido dos veces.
      if (!docNumber.trim()) return setError('Escribe el N° de la boleta o factura.')
      if (!expensePayment) return setError('Indica cómo se pagó: contado (lo pagaste tú) o crédito (lo pagó la empresa).')
    }
    try {
      setBusy('Preparando…')
      const types = files.map(declaredType)
      // Primero se leen los archivos: si el teléfono no los entrega, se sabe antes de pedir nada.
      const ready: File[] = []
      for (let i = 0; i < files.length; i++) ready.push(await toMemory(files[i], types[i]))
      const ticketsRes = await fetchStep('al preparar la subida', ticketsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...extra, files: files.map((f, i) => ({ name: f.name, size: f.size, type: types[i] })) }),
      })
      const ticketsData = await ticketsRes.json().catch(() => ({}))
      if (!ticketsRes.ok) throw new Error(ticketsData.error || 'No pudimos preparar la subida.')
      const tickets: { path: string; uploadUrl: string }[] = ticketsData.tickets

      for (let i = 0; i < files.length; i++) {
        setBusy(files.length === 1 ? 'Subiendo…' : `Subiendo ${i + 1} de ${files.length}…`)
        await putToBucket(tickets[i].uploadUrl, ready[i])
      }

      setBusy('Revisando…')
      const allImages = types.every((t) => t.startsWith('image/'))
      const confirmRes = await fetchStep('al registrar el archivo', confirmUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...extra,
          kind: kinds ? kind : allImages ? 'foto' : 'documento',
          amount: kinds && kind === 'gasto' ? amountValue : null,
          docNumber: kinds && kind === 'gasto' ? docNumber.trim() : null,
          expensePayment: kinds && kind === 'gasto' ? expensePayment : null,
          note: note.trim() || null,
          items: tickets.map((t, i) => ({ path: t.path, fileName: files[i].name })),
        }),
      })
      const confirmData = await confirmRes.json().catch(() => ({}))
      if (!confirmRes.ok) throw new Error(confirmData.error || 'No pudimos registrar los archivos.')

      setDone(files.length === 1 ? 'Archivo subido.' : `${files.length} archivos subidos.`)
      setFiles([])
      setNote('')
      setAmount('')
      if (input.current) input.current.value = ''
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo falló. Intenta de nuevo.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
      <p className="font-bold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-6 text-center hover:border-brand-blue-dark">
        <span className="text-sm font-semibold text-brand-blue-dark">
          {files.length === 0
            ? 'Elegir archivos o tomar una foto'
            : files.length === 1
              ? files[0].name
              : `${files.length} archivos elegidos`}
        </span>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          disabled={!!busy}
          onChange={(e) => pick(e.target.files)}
        />
      </label>

      {files.length > 0 && (
        <>
          {kinds && (
            <div className="mt-3 flex flex-wrap gap-2">
              {kinds.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    kind === k.value
                      ? 'border-brand-blue-dark bg-brand-blue-dark text-white'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}
          {kinds && kind === 'gasto' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px_160px]">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={120}
                placeholder="Nombre del gasto (peaje, bencina…)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none"
              />
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Monto en pesos"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none"
              />
              <input
                type="text"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                maxLength={40}
                placeholder="N° boleta o factura"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none"
              />
              <select
                value={expensePayment}
                onChange={(e) => setExpensePayment(e.target.value as '' | 'contado' | 'credito')}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none sm:col-span-3"
              >
                <option value="">¿Cómo se pagó?</option>
                <option value="contado">Contado: lo pagué yo y me lo tienen que devolver</option>
                <option value="credito">Crédito: se pagó con tarjeta o cuenta de la empresa</option>
              </select>
            </div>
          ) : (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Nota (opcional): qué es o para qué sirve"
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none"
            />
          )}
          <button
            type="button"
            onClick={upload}
            disabled={!!busy}
            className="mt-3 w-full rounded-xl bg-brand-green px-4 py-3 font-bold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy || (files.length === 1 ? 'Subir archivo' : `Subir ${files.length} archivos`)}
          </button>
        </>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
      {done && <p className="mt-3 text-sm font-semibold text-green-700">{done}</p>}
    </div>
  )
}
