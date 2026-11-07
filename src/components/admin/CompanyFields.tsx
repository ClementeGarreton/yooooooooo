'use client'

import Input from '@/components/ui/Input'
import { formatRut, isValidRut } from '@/lib/rut'
import type { Company } from '@/lib/companies'

/**
 * Formulario de los datos de facturación de una empresa. Lo usan la ficha de Empresas y
 * «Emisión de facturas» (donde se corrige un dato justo antes de facturar): un solo
 * formulario para que los dos lugares editen exactamente los mismos campos.
 */

export const EMPTY_FORM = {
  razon_social: '',
  rut: '',
  giro: '',
  direccion: '',
  comuna: '',
  ciudad: '',
  email_facturacion: '',
  facturacion_mensual: true,
  notes: '',
}
export type CompanyForm = typeof EMPTY_FORM

export function companyToForm(c: Company): CompanyForm {
  return {
    razon_social: c.razon_social,
    rut: formatRut(c.rut),
    giro: c.giro || '',
    direccion: c.direccion || '',
    comuna: c.comuna || '',
    ciudad: c.ciudad || '',
    email_facturacion: c.email_facturacion || '',
    facturacion_mensual: c.facturacion_mensual,
    notes: c.notes || '',
  }
}

export default function CompanyFields({ form, onChange }: { form: CompanyForm; onChange: (f: CompanyForm) => void }) {
  const set = (key: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value })
  const field = (key: keyof CompanyForm, label: string, type = 'text') => (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <Input type={type} value={String(form[key])} onChange={set(key)} />
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {field('razon_social', 'Razón social')}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">RUT</label>
          <Input value={form.rut} onChange={set('rut')} placeholder="76.452.118-9" />
          {form.rut.trim() && !isValidRut(form.rut) && (
            <p className="mt-1 text-xs text-red-600">El dígito verificador no calza.</p>
          )}
        </div>
        {field('giro', 'Giro')}
        {field('email_facturacion', 'Correo de facturación', 'email')}
        {field('direccion', 'Dirección')}
        {field('comuna', 'Comuna')}
        {field('ciudad', 'Ciudad')}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={form.facturacion_mensual}
          onChange={(e) => onChange({ ...form, facturacion_mensual: e.target.checked })}
        />
        Facturación mensual (una factura por mes en vez de una por servicio)
      </label>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Notas internas</label>
        <textarea
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          rows={2}
          value={form.notes}
          onChange={(e) => onChange({ ...form, notes: e.target.value })}
        />
      </div>
    </div>
  )
}
