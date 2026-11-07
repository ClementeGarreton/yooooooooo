import type { ReactNode } from 'react'
import { parseLegalText } from '@/lib/legalDocumentTypes'

/**
 * Pinta un texto legal editado desde el panel con el mismo aspecto que las páginas
 * originales. Arma elementos de React, nunca HTML crudo: lo que se escriba en el panel no
 * puede inyectar código en el sitio. Los enlaces solo aceptan http(s), mailto, tel y rutas
 * internas.
 */

const safeHref = (href: string) => (/^(https?:\/\/|mailto:|tel:|\/(?!\/))/i.test(href) ? href : null)

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    if (match[1] !== undefined) out.push(<strong key={match.index}>{match[1]}</strong>)
    else {
      const href = safeHref(match[3])
      out.push(
        href ? (
          <a key={match.index} href={href} className="font-semibold text-primary-600 hover:underline">
            {match[2]}
          </a>
        ) : (
          match[2]
        )
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function LegalText({ content }: { content: string }) {
  return (
    <>
      {parseLegalText(content).map((block, i) => {
        if (block.type === 'h2') {
          return (
            <h2 key={i} className={`text-2xl font-bold text-gray-900 mb-4 ${i > 0 ? 'mt-10' : ''}`}>
              {inline(block.text)}
            </h2>
          )
        }
        if (block.type === 'h3') {
          return (
            <h3 key={i} className="text-xl font-semibold text-gray-800 mb-3 mt-6">
              {inline(block.text)}
            </h3>
          )
        }
        if (block.type === 'ul') {
          return (
            <ul key={i} className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="text-gray-700 leading-relaxed mb-4">
            {inline(block.text)}
          </p>
        )
      })}
    </>
  )
}
