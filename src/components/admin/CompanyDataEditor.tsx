'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'
import toast from 'react-hot-toast'
import { isValidRut } from '@/lib/rut'
import CompanyFields, { EMPTY_FORM, companyToForm, type CompanyForm } from './CompanyFields'

/**
 * Edita los datos de facturación de una empresa sin salir de «Emisión de facturas». Lee y
 * guarda por las mismas rutas que la ficha de Empresas, así el cambio queda en Actividad.
 */
export default function CompanyDataEditor({ companyId, onSaved }: { companyId: string; onSaved: () => void }) {
  const [form, setForm] = useState<CompanyForm | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setForm(null)
    fetch(`/api/admin/companies/${companyId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'No se pudo abrir la empresa')
        if (alive) setForm(body.company ? companyToForm(body.company) : { ...EMPTY_FORM })
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'No se pudo abrir la empresa'))
    return () => {
      alive = false
    }
  }, [companyId])

  if (!form) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  const save = async () => {
    if (!form.razon_social.trim() || !isValidRut(form.rut)) {
      toast.error('Revisa la razón social y el RUT.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      toast.success('Datos guardados')
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    }
    setSaving(false)
  }

  return (
    <div>
      <CompanyFields form={form} onChange={setForm} />
      <div className="mt-4 flex justify-end">
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar datos'}
        </Button>
      </div>
    </div>
  )
}
