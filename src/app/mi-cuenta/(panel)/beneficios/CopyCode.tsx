'use client'

import { useState } from 'react'

/** El código en grande con un botón para copiarlo. */
export default function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="rounded-xl bg-slate-100 px-5 py-3 font-mono text-2xl font-bold tracking-widest text-slate-900">{code}</span>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard
            .writeText(code)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
            .catch(() => null)
        }
        className="rounded-lg border-2 border-slate-200 px-4 py-2 text-sm font-bold text-brand-blue-dark hover:border-brand-blue"
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
