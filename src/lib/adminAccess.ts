// Permisos del panel: qué puede ver y hacer un usuario según su perfil, y a qué módulo
// pertenece cada ruta de la API. Lógica PURA —sin base de datos, sin Next— para que la
// usen por igual el middleware (candado por ruta), las rutas (acciones delicadas) y el
// menú. Las claves de módulos y acciones salen del registro único (adminModules.ts).
//
// Reglas:
//   - Perfil de sistema («Administrador») y acceso de emergencia: todo.
//   - Un módulo `fixed` (Inicio) está siempre encendido.
//   - Una acción vale solo si está marcada Y su módulo está encendido.
//   - Usuario sin perfil (todavía no se corrió add_admin_profiles.sql, o se borró su
//     perfil): se comporta como hoy — 'administrator' tiene todo; 'staff', todos los
//     módulos y ninguna acción delicada.

import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_MODULE,
  ADMIN_MODULES,
  ADMIN_SECTION_KEYS,
  sectionModule,
  type AdminActionId,
  type AdminModuleId,
} from '@/lib/adminModules'

/** Id sintético del usuario de emergencia definido por variables de entorno. Siempre tiene todo. */
export const ENV_ADMIN_ID = 'env-admin'

export interface AdminAccess {
  /** Todo permitido (Administrador). */
  full: boolean
  modules: AdminModuleId[]
  actions: AdminActionId[]
  /** Subpaneles encendidos, como «finance.income». Solo de módulos encendidos. */
  sections: string[]
  profileName: string
}

export interface StoredPermissions {
  modules?: Record<string, unknown>
  actions?: Record<string, unknown>
  /** Subpaneles. Solo pesa un `false` explícito: lo que no está escrito, está encendido. */
  sections?: Record<string, unknown>
}

const ALL_MODULES = ADMIN_MODULES.map((m) => m.id)

export const FULL_ACCESS: AdminAccess = {
  full: true,
  modules: ALL_MODULES,
  actions: ADMIN_ACTIONS,
  sections: ADMIN_SECTION_KEYS,
  profileName: 'Administrador',
}

/**
 * Módulos que nacieron DESPUÉS de que un perfil se guardó. Si el perfil no tiene la clave
 * (ni encendida ni apagada), vale lo que tenga el módulo del que salió: Marketing vivía
 * dentro de Configuración, así que quien veía Configuración sigue viendo Marketing. Apenas
 * el perfil se guarda desde el editor, la clave queda escrita y esto deja de aplicar.
 */
const MODULE_INHERITS: Partial<Record<AdminModuleId, AdminModuleId>> = {
  marketing: 'settings',
  // La facturación nació dentro de la ficha de Empresas.
  finance: 'companies',
  // La emisión de facturas era una sección de Finanzas.
  invoicing: 'finance',
  // La cuadrilla y el camión se asignaban desde el detalle de la reserva.
  jobs: 'bookings',
  'ai-conversations': 'prospects',
}

/** ¿Está encendido este módulo en los permisos guardados de un perfil? */
export function storedModuleOn(permissions: StoredPermissions | null | undefined, id: AdminModuleId): boolean {
  const value = permissions?.modules?.[id]
  // En cadena: Emisión de facturas → Finanzas → Empresas.
  if (value === undefined && MODULE_INHERITS[id]) return storedModuleOn(permissions, MODULE_INHERITS[id]!)
  return value === true
}

/** Acceso de un usuario a partir de su rol heredado y su perfil (si tiene). */
export function resolveAccess(
  role: unknown,
  profile: { name?: string | null; is_system?: boolean | null; permissions?: StoredPermissions | null } | null | undefined
): AdminAccess {
  if (profile) {
    if (profile.is_system) return { ...FULL_ACCESS, profileName: profile.name || 'Administrador' }
    const on = (bag: Record<string, unknown> | undefined, key: string) => bag?.[key] === true
    const modules = ADMIN_MODULES.filter((m) => m.fixed || storedModuleOn(profile.permissions, m.id)).map((m) => m.id)
    const actions = ADMIN_ACTIONS.filter(
      (a) => on(profile.permissions?.actions, a) && modules.includes(ADMIN_ACTION_MODULE[a])
    )
    const sections = ADMIN_SECTION_KEYS.filter((key) => modules.includes(sectionModule(key)) && profile.permissions?.sections?.[key] !== false)
    return { full: false, modules, actions, sections, profileName: profile.name || 'Sin nombre' }
  }
  if (role === 'administrator') return FULL_ACCESS
  return { full: false, modules: ALL_MODULES, actions: [], sections: ADMIN_SECTION_KEYS, profileName: 'Secretaría' }
}

/** ¿Ve este subpanel? `key` como «finance.income». Una clave desconocida no tiene candado. */
export function canSeeSection(access: AdminAccess, key: string): boolean {
  if (access.full || !ADMIN_SECTION_KEYS.includes(key)) return true
  return access.sections.includes(key)
}

export function canSeeModule(access: AdminAccess, id: AdminModuleId): boolean {
  return access.full || access.modules.includes(id)
}

export function canDoAction(access: AdminAccess, id: AdminActionId): boolean {
  return access.full || access.actions.includes(id)
}

/** Deja solo claves conocidas y valores booleanos: lo que se guarda en un perfil. */
export function sanitizePermissions(input: unknown): Required<StoredPermissions> {
  const raw = (input && typeof input === 'object' ? input : {}) as StoredPermissions
  const modules: Record<string, boolean> = {}
  for (const m of ADMIN_MODULES) if (!m.fixed) modules[m.id] = raw.modules?.[m.id] === true
  const actions: Record<string, boolean> = {}
  for (const a of ADMIN_ACTIONS) actions[a] = raw.actions?.[a] === true && modules[ADMIN_ACTION_MODULE[a]] === true
  // Se guarda cada subpanel conocido: encendido salvo que venga apagado a propósito.
  const sections: Record<string, boolean> = {}
  for (const key of ADMIN_SECTION_KEYS) sections[key] = raw.sections?.[key] !== false
  return { modules, actions, sections }
}

// ───────────────────────── Candado por ruta ─────────────────────────
//
// El panel es una sola página con módulos, así que el candado va en la API: una ruta de
// un módulo apagado responde 403 aunque se llame a mano.
//
// Cada regla dice qué módulos habilitan una ruta (basta UNO encendido). Hay dos listas:
//   write -> POST/PUT/PATCH/DELETE. Es la que importa: nadie cambia nada de un módulo
//            que no tiene.
//   read  -> GET. Solo se cierra lo que es propio de un módulo. Muchas lecturas las
//            comparten varias pantallas (las reservas las leen Inicio, Calendario y
//            Reservas): esas quedan abiertas a cualquier usuario del panel.
// Gana la primera regla cuyo prefijo coincide: de la más específica a la más general.
// Una ruta sin regla no tiene candado de módulo (sigue exigiendo sesión de admin).

interface RouteRule {
  prefix: string
  /** Además del prefijo, la ruta completa tiene que calzar con esto. */
  match?: RegExp
  write?: AdminModuleId[]
  read?: AdminModuleId[]
  /**
   * Subpaneles a los que pertenece la ruta. Si un módulo de la lista tiene subpaneles acá,
   * no basta con tener el módulo: hace falta al menos uno de esos subpaneles. Un módulo de
   * la lista que no tiene subpaneles acá (por ejemplo Emisión de facturas leyendo los datos
   * de Finanzas) habilita la ruta por sí solo.
   */
  sections?: string[]
}

const ROUTE_RULES: RouteRule[] = [
  // Sesión propia y «Ver como»: de todos.
  { prefix: '/api/admin/auth/' },
  { prefix: '/api/admin/preview' },

  { prefix: '/api/admin/ai-conversations', read: ['ai-conversations'], write: ['ai-conversations'] },
  { prefix: '/api/admin/activity', read: ['activity'], write: ['activity'] },
  { prefix: '/api/admin/users', read: ['settings'], write: ['settings'] },
  { prefix: '/api/admin/profiles', read: ['settings'], write: ['settings'] },
  { prefix: '/api/admin/coupons', read: ['marketing'], write: ['marketing'], sections: ['marketing.coupons'] },
  { prefix: '/api/admin/credits', read: ['marketing'], write: ['marketing'], sections: ['marketing.coupons'] },
  { prefix: '/api/admin/marketing-config', read: ['marketing'], write: ['marketing'], sections: ['marketing.coupons'] },
  { prefix: '/api/admin/emails', read: ['marketing'], write: ['marketing'], sections: ['marketing.emails'] },
  // Precios, agenda y catálogo: la lectura es pública (la usa el cotizador web).
  { prefix: '/api/admin/pricing-config', write: ['settings'], sections: ['settings.pricing'] },
  // UF puesta a mano: la leen también el cierre de empresas y la facturación.
  // Premio de los recomendadores (conserjes): se edita en Configuración → Precios.
  { prefix: '/api/admin/settings/recomendadores', read: ['settings', 'marketing'], write: ['settings'], sections: ['settings.pricing', 'marketing.coupons'] },
  { prefix: '/api/admin/settings/uf', read: ['settings', 'companies', 'invoicing'], write: ['settings'], sections: ['settings.pricing'] },
  { prefix: '/api/admin/schedule-config', write: ['settings'], sections: ['settings.schedule-config'] },
  { prefix: '/api/admin/catalog-items', write: ['settings'], sections: ['settings.inventory'] },
  // Textos legales del sitio (Políticas de Garantía, Términos y Condiciones).
  { prefix: '/api/admin/legal-documents', read: ['settings'], write: ['settings'], sections: ['settings.legal'] },
  // Estado de la conexión del asistente de WhatsApp (qué variables están cargadas, sin valores).
  { prefix: '/api/admin/whatsapp', read: ['settings'], write: ['settings'] },

  // Facturar a una empresa se hace desde «Emisión de facturas» (o se mira desde su ficha).
  // Ese panel lee los mismos datos del mes que Finanzas.
  // Gráfico mensual de reservas e ingresos (vive en Finanzas). Los montos de
  // `/api/admin/stats` se filtran dentro de la ruta: Inicio necesita sus conteos.
  { prefix: '/api/admin/analytics', read: ['finance'], write: ['finance'], sections: ['finance.summary'] },
  // Contabilidad (IVA del SII, banco) y pago a trabajadores: son parte de Finanzas.
  { prefix: '/api/admin/accounting/income-statement', read: ['finance'], write: ['finance'], sections: ['finance.income'] },
  // El cruce con el banco se ve dentro del EERR.
  { prefix: '/api/admin/accounting/reconciliation', read: ['finance'], write: ['finance'], sections: ['finance.income'] },
  { prefix: '/api/admin/accounting/expense-categories', read: ['finance'], write: ['finance'], sections: ['finance.expenses'] },
  { prefix: '/api/admin/accounting/expenses', read: ['finance'], write: ['finance'], sections: ['finance.expenses'] },
  // Lo que queda de contabilidad: IVA del SII, banco y Flow.
  { prefix: '/api/admin/accounting', read: ['finance'], write: ['finance'], sections: ['finance.accounting'] },
  // La regla general de pago se define en Configuración; Finanzas la lee.
  {
    prefix: '/api/admin/worker-pay/config',
    read: ['finance', 'settings'],
    write: ['settings'],
    sections: ['settings.worker-pay', 'finance.workers', 'finance.closing'],
  },
  { prefix: '/api/admin/worker-pay/closing', read: ['finance'], write: ['finance'], sections: ['finance.closing'] },
  { prefix: '/api/admin/worker-pay/email', read: ['finance'], write: ['finance'], sections: ['finance.closing'] },
  // Los datos del pago los leen las dos pestañas; registrar pagos y ajustes, también.
  { prefix: '/api/admin/worker-pay', read: ['finance'], write: ['finance'], sections: ['finance.workers', 'finance.closing'] },
  // El resumen (con pago por persona y gastos) es solo de Finanzas: Emisión de facturas lee
  // /api/admin/finance para el mes, pero no este reporte.
  { prefix: '/api/admin/finance/report', read: ['finance'], write: ['finance'], sections: ['finance.summary'] },
  { prefix: '/api/admin/finance', read: ['finance', 'invoicing'], write: ['finance'], sections: ['finance.summary'] },
  { prefix: '/api/admin/invoices', read: ['invoicing', 'finance', 'companies'], write: ['invoicing'] },
  // Rutas sueltas de Empresas que no son «la ficha» (el regex de abajo las confundiría con un id):
  // asignar una reserva sin empresa y buscar datos por RUT son del módulo Empresas.
  { prefix: '/api/admin/companies/sin-empresa', read: ['companies'], write: ['companies'] },
  { prefix: '/api/admin/companies/lookup', read: ['companies', 'invoicing'], write: ['companies'] },
  {
    prefix: '/api/admin/companies',
    match: /^\/api\/admin\/companies\/[^/]+\/billing$/,
    read: ['invoicing', 'finance', 'companies'],
    write: ['invoicing'],
  },
  // Los datos de facturación de la empresa también se corrigen desde «Emisión de facturas».
  // Solo la ficha misma: personas y reservas de la empresa siguen siendo del módulo Empresas.
  {
    prefix: '/api/admin/companies',
    match: /^\/api\/admin\/companies\/[^/]+$/,
    read: ['companies', 'finance', 'invoicing'],
    write: ['companies', 'invoicing'],
  },
  { prefix: '/api/admin/companies', read: ['companies', 'finance', 'invoicing'], write: ['companies'] },
  // Link de registro de empresas: solo quien administra Empresas.
  { prefix: '/api/admin/company-signup', read: ['companies'], write: ['companies'] },

  { prefix: '/api/admin/service-requests', read: ['approvals'], write: ['approvals'], sections: ['approvals.requests'] },
  { prefix: '/api/admin/modifications', read: ['approvals'], write: ['approvals'], sections: ['approvals.modifications'] },
  { prefix: '/api/admin/expenses', read: ['approvals'], write: ['approvals'], sections: ['approvals.expenses'] },

  // Trabajadores que se registraron solos por el link: se aprueban en «Por aprobar».
  { prefix: '/api/admin/workers/pending', read: ['approvals', 'fleet'], write: ['approvals', 'fleet'], sections: ['approvals.workers'] },
  {
    prefix: '/api/admin/workers',
    match: /^\/api\/admin\/workers\/[^/]+\/approval$/,
    read: ['approvals', 'fleet'],
    write: ['approvals', 'fleet'],
    sections: ['approvals.workers'],
  },
  // La cuadrilla de una reserva se arma desde Reservas, con gente que se crea en Flota.
  { prefix: '/api/admin/workers', read: ['fleet', 'bookings'], write: ['fleet'] },
  // Panel Trabajos: asignar camión y cuadrilla (no edita nada más de la reserva).
  { prefix: '/api/admin/jobs/tasks', read: ['jobs'], write: ['jobs'], sections: ['jobs.tasks'] },
  { prefix: '/api/admin/jobs/history', read: ['jobs'], write: ['jobs'], sections: ['jobs.history'] },
  { prefix: '/api/admin/jobs', read: ['jobs'], write: ['jobs'], sections: ['jobs.upcoming'] },
  { prefix: '/api/admin/fleet-config', write: ['fleet'] },
  { prefix: '/api/admin/fleet-km', read: ['fleet'], write: ['fleet'] },
  { prefix: '/api/admin/driver-link', read: ['fleet'], write: ['fleet'] },

  { prefix: '/api/admin/blocked-slots', write: ['schedule', 'calendar', 'bookings'] },

  // El origen del cliente y «frecuente» también se cambian desde una reserva.
  { prefix: '/api/admin/customers', write: ['customers', 'bookings'] },

  { prefix: '/api/admin/prospects', write: ['prospects', 'new-quote'] },
  { prefix: '/api/admin/quotes', write: ['prospects', 'new-quote'] },

  // Reservas: se editan desde Reservas y desde el Calendario.
  { prefix: '/api/admin/bookings', write: ['bookings', 'calendar'] },
]

function ruleFor(pathname: string): RouteRule | undefined {
  return ROUTE_RULES.find(
    (r) =>
      (pathname === r.prefix || pathname.startsWith(r.prefix.endsWith('/') ? r.prefix : `${r.prefix}/`)) &&
      (!r.match || r.match.test(pathname))
  )
}

/**
 * Módulos que habilitan esta llamada (basta uno), o null si la ruta no tiene candado.
 * `pathname` es la ruta de la API; `method`, el verbo HTTP.
 */
export function modulesForRoute(pathname: string, method: string): AdminModuleId[] | null {
  const rule = ruleFor(pathname)
  if (!rule) return null
  const list = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' ? rule.read : rule.write
  return list && list.length > 0 ? list : null
}

/** ¿Puede este usuario hacer esta llamada? Mira el módulo y, si la ruta es de un subpanel, también el subpanel. */
export function canCallRoute(access: AdminAccess, pathname: string, method: string): boolean {
  if (access.full) return true
  const needed = modulesForRoute(pathname, method)
  if (!needed) return true
  const sections = ruleFor(pathname)?.sections || []
  return needed.some((m) => {
    if (!access.modules.includes(m)) return false
    const own = sections.filter((key) => sectionModule(key) === m)
    return own.length === 0 || own.some((key) => access.sections.includes(key))
  })
}
