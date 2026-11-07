/**
 * Valor de la UF puesto a mano (Tomás, 21-10-2026: «lugar en el sistema donde actualizar el
 * valor de la UF»). Si está puesto, es el que usan el cierre de empresas y la facturación;
 * si no, se usa el del día (mindicador.cl). Vive en `app_settings` (add_pendientes_oct.sql).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { parseChileNumber } from '@/lib/chileNumber'

export interface UfSetting {
  /** null = automático (el del día). */
  value: number | null
  updatedBy: string | null
  updatedAt: string | null
}

export async function getUfSetting(): Promise<UfSetting & { available: boolean }> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value, updated_by, updated_at').eq('key', 'uf').maybeSingle()
  if (error) return { available: false, value: null, updatedBy: null, updatedAt: null }
  const value = Number((data?.value as any)?.value)
  return {
    available: true,
    value: Number.isFinite(value) && value > 0 ? value : null,
    updatedBy: data?.updated_by ?? null,
    updatedAt: data?.updated_at ?? null,
  }
}

/** Pone (o con `null`, saca) la UF manual. */
export async function setUfSetting(raw: unknown, actor: string): Promise<{ from: number | null; to: number | null }> {
  const before = await getUfSetting()
  if (!before.available) throw new Error('Falta correr la migración add_pendientes_oct.sql.')
  const value = raw === null || raw === '' ? null : Math.round(parseChileNumber(raw) * 100) / 100
  if (value !== null && !(Number.isFinite(value) && value > 1_000 && value < 1_000_000)) {
    throw new Error('El valor de la UF no es válido (por ejemplo, 39.500,25).')
  }
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'uf', value: { value }, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error('No se pudo guardar la UF.')
  return { from: before.value, to: value }
}
