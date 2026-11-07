'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import LegalText from '@/components/LegalText'
import { LEGAL_DOCUMENTS, type LegalDocument, type LegalSlug } from '@/lib/legalDocumentTypes'

/**
 * Configuración → Políticas y términos: el texto de «Políticas de Garantía» y de «Términos
 * y Condiciones» que se ve en el sitio (y al que enlazan el cotizador y los correos).
 * Mientras no se edite, el sitio muestra el texto original; «Partir del texto publicado»
 * lo trae al editor para cambiarlo desde ahí en vez de escribirlo de cero.
 */

/** Pasa a texto editable lo que hoy muestra la página (títulos, párrafos, listas, negritas). */
function pageToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.querySelector('[data-legal-original]')
  if (!root) return ''
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ')
    if (!(node instanceof Element)) return ''
    const inner = Array.from(node.childNodes).map(inline).join('')
    if (node.tagName === 'STRONG' || node.tagName === 'B') return inner.trim() ? `**${inner.trim()}**` : ''
    if (node.tagName === 'A') return `[${inner.trim()}](${node.getAttribute('href') || ''})`
    return inner
  }
  const out: string[] = []
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName
      const text = inline(child).trim()
      if (tag === 'H2') out.push(`## ${text}`)
      else if (tag === 'H3') out.push(`### ${text}`)
      else if (tag === 'P') {
        // Los rótulos («Incluye:») son párrafos en negrita en la página original.
        if (text) out.push(/font-semibold/.test(child.className) && !text.startsWith('**') ? `**${text}**` : text)
      } else if (tag === 'UL' || tag === 'OL') {
        out.push(Array.from(child.children).map((li) => `- ${inline(li).trim()}`).join('\n'))
      } else walk(child)
    }
  }
  walk(root)
  return out.join('\n\n')
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))

export default function LegalConfiguration() {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [slug, setSlug] = useState<LegalSlug>('politicas-de-garantia')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)

  const current = documents?.find((d) => d.slug === slug) || null

  useEffect(() => {
    fetch('/api/admin/legal-documents')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar los textos')
        setDocuments(body.documents)
        setAvailable(body.available)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los textos'))
  }, [])

  // Al cambiar de documento, el editor muestra lo guardado (vacío si nunca se editó).
  useEffect(() => {
    setText(current?.content || '')
    setPreview(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, documents])

  const loadPublished = async () => {
    if (text.trim() && !window.confirm('Esto reemplaza lo que hay en el editor por el texto publicado hoy. ¿Continuar?')) return
    setBusy(true)
    try {
      const res = await fetch(`/${slug}`, { cache: 'no-store' })
      const converted = current?.content || pageToText(await res.text())
      if (!converted) throw new Error('No se pudo leer el texto publicado')
      setText(converted)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo leer el texto publicado')
    }
    setBusy(false)
  }

  const save = async () => {
    if (!window.confirm('El texto se publica en el sitio de inmediato. ¿Publicar?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/legal-documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, content: text }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      setDocuments((list) => (list || []).map((d) => (d.slug === slug ? body.document : d)))
      toast.success('Texto publicado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    }
    setBusy(false)
  }

  const reset = async () => {
    if (!window.confirm('Se borra el texto editado y el sitio vuelve a mostrar el original. ¿Continuar?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/legal-documents?slug=${slug}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo restaurar')
      setDocuments((list) => (list || []).map((d) => (d.slug === slug ? { ...d, content: null, updatedBy: null, updatedAt: null } : d)))
      toast.success('Texto original restaurado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo restaurar')
    }
    setBusy(false)
  }

  if (!documents) return <p className="text-sm text-gray-500">Cargando…</p>

  return (
    <Card className="p-6">
      <h3 className="text-lg font-bold text-gray-900">Políticas y términos</h3>
      <p className="text-sm text-gray-600">
        El texto que se ve en el sitio. El cotizador y los correos enlazan a estas páginas, así que un cambio acá vale para todos.
      </p>
      {!available && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración add_legal_documents.sql: se puede ver el editor, pero no guardar.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {LEGAL_DOCUMENTS.map((d) => (
          <button
            key={d.slug}
            type="button"
            onClick={() => setSlug(d.slug)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              slug === d.slug ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        {current?.content
          ? `Editado por ${current.updatedBy || '—'}${current.updatedAt ? ` el ${when(current.updatedAt)}` : ''}.`
          : 'Sin editar: el sitio muestra el texto original.'}{' '}
        <a href={`/${slug}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-600 hover:underline">
          Ver la página
        </a>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={loadPublished}>
          Partir del texto publicado
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !text.trim()} onClick={() => setPreview((v) => !v)}>
          {preview ? 'Volver a editar' : 'Vista previa'}
        </Button>
      </div>

      {preview ? (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-6">
          <LegalText content={text} />
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={24}
          spellCheck
          placeholder="Usa «Partir del texto publicado» para traer el texto actual y editarlo."
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      )}
      <p className="mt-2 text-xs text-gray-500">
        Formato: «## Título», «### Subtítulo», «- elemento de lista», «**negrita**», «[texto](enlace)». Un renglón en blanco separa párrafos.
      </p>

      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button size="sm" variant="outline" disabled={busy || !current?.content} onClick={reset}>
          Volver al texto original
        </Button>
        <Button size="sm" disabled={busy || !available || !text.trim() || text.trim() === (current?.content || '')} onClick={save}>
          {busy ? 'Guardando…' : 'Publicar'}
        </Button>
      </div>
    </Card>
  )
}
