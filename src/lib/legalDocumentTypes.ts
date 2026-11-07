// Textos legales editables. SIN dependencias de servidor.

export type LegalSlug = 'politicas-de-garantia' | 'terminos-y-condiciones'

export const LEGAL_DOCUMENTS: { slug: LegalSlug; label: string }[] = [
  { slug: 'politicas-de-garantia', label: 'Políticas de Garantía' },
  { slug: 'terminos-y-condiciones', label: 'Términos y Condiciones' },
]

export const isLegalSlug = (value: unknown): value is LegalSlug => LEGAL_DOCUMENTS.some((d) => d.slug === value)

export const LEGAL_MAX_CHARS = 100_000

export interface LegalDocument {
  slug: LegalSlug
  /** null = no se ha editado: la página muestra el texto original del sitio. */
  content: string | null
  updatedBy: string | null
  updatedAt: string | null
}

/**
 * Formato del texto (el mínimo que usan las dos páginas):
 *   ## Título de sección        ### Subtítulo
 *   - elemento de lista         **negrita**        [texto](https://enlace)
 * Un renglón en blanco separa párrafos.
 */
export type LegalBlock =
  | { type: 'h2' | 'h3' | 'p'; text: string }
  | { type: 'ul'; items: string[] }

export function parseLegalText(content: string): LegalBlock[] {
  const blocks: LegalBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join(' ') })
    if (list.length) blocks.push({ type: 'ul', items: list })
    paragraph = []
    list = []
  }
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) flush()
    else if (line.startsWith('### ')) {
      flush()
      blocks.push({ type: 'h3', text: line.slice(4).trim() })
    } else if (line.startsWith('## ')) {
      flush()
      blocks.push({ type: 'h2', text: line.slice(3).trim() })
    } else if (/^[-*•]\s+/.test(line)) {
      if (paragraph.length) flush()
      list.push(line.replace(/^[-*•]\s+/, ''))
    } else {
      if (list.length) flush()
      paragraph.push(line)
    }
  }
  flush()
  return blocks
}
