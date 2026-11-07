import Link from 'next/link'
import type { ReactNode } from 'react'
import type { BlogBlock } from '@/lib/blogPosts'

/** `[texto](/ruta)` → enlace interno; el resto, texto tal cual. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\[([^\]]+)\]\((\/[^)\s]*)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <Link key={m.index} href={m[2]} className="font-semibold text-[#2F7A1F] underline underline-offset-2 hover:text-[#1F5414]">
        {m[1]}
      </Link>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function BlogText({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <div className="space-y-5 text-[17px] leading-[1.7] text-[#374151]">
      {blocks.map((b, i) => {
        if ('h2' in b) {
          return (
            <h2 key={i} className="font-archivo text-2xl font-extrabold text-[#111827] pt-4">
              {b.h2}
            </h2>
          )
        }
        if ('p' in b) return <p key={i}>{inline(b.p)}</p>
        const items = 'ul' in b ? b.ul : b.ol
        const Tag = 'ul' in b ? 'ul' : 'ol'
        return (
          <Tag key={i} className={`${'ul' in b ? 'list-disc' : 'list-decimal'} pl-6 space-y-2`}>
            {items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </Tag>
        )
      })}
    </div>
  )
}
