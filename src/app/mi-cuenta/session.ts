import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { CUSTOMER_SESSION_COOKIE, verifyCustomerSessionToken } from '@/lib/customerSession'
import { getActivePreview } from '@/lib/adminPreviewServer'

/**
 * customer_id de la sesión del Panel del Cliente, o redirige a ingresar. Lo usan el
 * layout y cada página del panel: cada una valida la sesión por su cuenta, porque un
 * layout de Next no protege a las páginas que renderiza.
 *
 * Si hay una vista de administrador activa («Ver como», adminPreview.ts), manda esa: las
 * páginas se pintan con los datos de la persona elegida. Solo las PÁGINAS: las rutas de
 * la API siguen exigiendo la sesión real y el middleware las bloquea durante la vista.
 */
export async function requireCustomerId(): Promise<string> {
  const preview = await getActivePreview('customer')
  if (preview) return preview.id
  const customerId = await verifyCustomerSessionToken(cookies().get(CUSTOMER_SESSION_COOKIE)?.value)
  if (!customerId) redirect('/mi-cuenta/ingresar')
  return customerId
}
