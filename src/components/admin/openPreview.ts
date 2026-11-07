import toast from 'react-hot-toast'

/**
 * «Ver como»: abre en una pestaña nueva el panel de un cliente o de un trabajador, en
 * solo lectura (ver src/lib/adminPreview.ts). La pestaña se abre ANTES de la llamada,
 * dentro del clic, para que el navegador no la trate como ventana emergente.
 */
export async function openPreview(
  target: { kind: 'customer'; id?: string; email?: string } | { kind: 'worker'; id: string }
): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const res = await fetch('/api/admin/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.url) throw new Error(data?.error || 'No se pudo abrir el panel')
    if (tab) tab.location.href = data.url
    else window.location.href = data.url
  } catch (error) {
    tab?.close()
    toast.error(error instanceof Error ? error.message : 'No se pudo abrir el panel')
  }
}
