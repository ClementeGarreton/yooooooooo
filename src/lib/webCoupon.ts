import { supabaseAdmin } from '@/lib/supabase'
import { isValidEmail } from '@/lib/emailFormat'

/**
 * Ficha de cliente de quien cotiza en la web, por su correo. null = todavía no tiene (es
 * nuevo): la ficha la crea la base sola al guardar su cotización o su pre-reserva.
 */
export async function customerIdByEmail(rawEmail: unknown): Promise<string | null> {
  const email = String(rawEmail || '').trim().toLowerCase()
  if (!isValidEmail(email)) return null
  const { data } = await supabaseAdmin.from('customers').select('id').eq('email', email).maybeSingle()
  return data?.id || null
}
