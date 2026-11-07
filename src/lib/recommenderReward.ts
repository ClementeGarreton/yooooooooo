/**
 * Premio de los recomendadores (conserjes), aparte del de los clientes (Francisco,
 * 23-10-2026: «deja los créditos de los montos configurables desde settings»). Se edita en
 * Configuración → Precios. Sin él, ganan lo mismo que un cliente que recomienda (Marketing →
 * Programa de referidos). Vive en `app_settings` (clave 'recommender_reward').
 */

import { supabaseAdmin } from '@/lib/supabase'
import { parseChileNumber } from '@/lib/chileNumber'

export interface RecommenderReward {
  /** 'monto' = pesos fijos por referido pagado; 'porcentaje' = % de lo que pagó el referido. */
  kind: 'monto' | 'porcentaje'
  value: number
}

const KEY = 'recommender_reward'

/** La descripción del código de un recomendador empieza así (ver recommenders.ts). */
export const RECOMMENDER_PREFIX = 'Recomendador'

export async function getRecommenderReward(): Promise<{ available: boolean; reward: RecommenderReward | null }> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  if (error) return { available: false, reward: null }
  const v = (data?.value || {}) as Record<string, unknown>
  const value = Number(v.value)
  if ((v.kind !== 'monto' && v.kind !== 'porcentaje') || !(value > 0)) return { available: true, reward: null }
  return { available: true, reward: { kind: v.kind, value } }
}

/** Body: `{ kind, value }`; `value` vacío = volver al premio de los clientes. */
export async function setRecommenderReward(body: any, actor: string): Promise<RecommenderReward | null> {
  const raw = body?.value
  const empty = raw === null || raw === undefined || String(raw).trim() === ''
  const kind = body?.kind === 'porcentaje' ? 'porcentaje' : 'monto'
  const value = empty ? null : Math.round(parseChileNumber(raw) * 100) / 100
  if (value !== null) {
    if (!(Number.isFinite(value) && value > 0)) throw new Error('El premio debe ser un número mayor que cero.')
    if (kind === 'porcentaje' && value > 100) throw new Error('El porcentaje no puede pasar de 100.')
  }
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: KEY, value: value === null ? {} : { kind, value }, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error('No se pudo guardar el premio.')
  return value === null ? null : { kind, value }
}

export const rewardLabel = (r: RecommenderReward) =>
  r.kind === 'monto' ? `$${Math.round(r.value).toLocaleString('es-CL')} por referido pagado` : `${r.value.toLocaleString('es-CL')} % de lo que paga el referido`
