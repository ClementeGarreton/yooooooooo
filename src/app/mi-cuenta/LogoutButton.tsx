'use client'

import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()

  async function logout() {
    await fetch('/api/cuenta/salir', { method: 'POST' }).catch(() => null)
    router.replace('/mi-cuenta/ingresar')
  }

  return (
    <button type="button" onClick={logout} className="text-sm font-semibold text-slate-200 hover:text-white">
      Salir
    </button>
  )
}
