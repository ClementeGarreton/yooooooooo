// Registro ÚNICO de los módulos del panel: una entrada por ítem del menú lateral, en el
// orden en que se muestran. Es la misma idea de Ordenox (config/permisos_modulos.php): el
// menú, los perfiles con permisos y el candado por ruta salen de esta lista, para que no
// haya tres listas que se desincronicen.
//
// Sin dependencias de servidor ni de React: lo importan el menú (cliente), el editor de
// perfiles y el middleware.

export type AdminModuleId =
  | 'dashboard'
  | 'calendar'
  | 'bookings'
  | 'jobs'
  | 'approvals'
  | 'prospects'
  | 'ai-conversations'
  | 'new-quote'
  | 'marketing'
  | 'customers'
  | 'companies'
  | 'finance'
  | 'invoicing'
  | 'fleet'
  | 'schedule'
  | 'activity'
  | 'settings'

/**
 * Acciones delicadas: van aparte del interruptor del módulo, una casilla cada una. Solo
 * valen si su módulo está encendido.
 */
export type AdminActionId = 'users.manage' | 'marketing.manage' | 'invoices.emit' | 'inventory.adjust' | 'pricing.edit'

export interface AdminModule {
  id: AdminModuleId
  label: string
  /** Para qué sirve, en una línea. Lo muestra el editor de perfiles. */
  description: string
  /** Siempre encendido: es donde aterriza cualquier usuario. */
  fixed?: boolean
  /** Acciones delicadas de este módulo (clave → etiqueta). */
  actions?: Partial<Record<AdminActionId, string>>
  /**
   * Subpaneles del módulo: las pestañas que tiene adentro. Cada uno se puede apagar por
   * perfil. Su clave completa es `<módulo>.<id>` (ver `sectionKey`). Un subpanel que el
   * perfil no menciona está encendido: así un perfil guardado antes de que existiera un
   * subpanel no lo pierde.
   */
  sections?: { id: string; label: string }[]
}

/** Clave con que se guarda y se consulta un subpanel: «finance.income». */
export const sectionKey = (moduleId: AdminModuleId, sectionId: string) => `${moduleId}.${sectionId}`

export interface AdminModuleGroup {
  label: string
  modules: AdminModule[]
}

export const ADMIN_MODULE_GROUPS: AdminModuleGroup[] = [
  {
    label: 'Operación',
    modules: [
      { id: 'dashboard', label: 'Inicio', description: 'Reservas de hoy, pendientes y ocupación.', fixed: true },
      // Segundo en el menú: lo pendiente por aprobar es lo más urgente (Tomás, 21-10-2026).
      {
        id: 'approvals',
        label: 'Por aprobar',
        description: 'Solicitudes de clientes y modificaciones en terreno.',
        sections: [
          { id: 'requests', label: 'Solicitudes de clientes' },
          { id: 'modifications', label: 'Diferencias en terreno' },
          { id: 'expenses', label: 'Gastos de trabajadores' },
          { id: 'workers', label: 'Trabajadores nuevos' },
        ],
      },
      { id: 'calendar', label: 'Calendario', description: 'La agenda por día y por camión.' },
      { id: 'bookings', label: 'Reservas', description: 'Todas las reservas: crear, editar, cobrar y cerrar.' },
      {
        id: 'jobs',
        label: 'Trabajos',
        description: 'Asignar camión y cuadrilla a cada trabajo, y avisar a los trabajadores.',
        sections: [
          { id: 'upcoming', label: 'Por asignar' },
          { id: 'history', label: 'Historial' },
          { id: 'tasks', label: 'Tareas' },
        ],
      },
    ],
  },
  {
    label: 'Ventas',
    modules: [
      { id: 'prospects', label: 'Prospectos', description: 'Cotizaciones y leads todavía sin reserva.' },
      { id: 'new-quote', label: 'Nueva cotización', description: 'Armar una cotización desde el panel.' },
      { id: 'ai-conversations', label: 'Conversaciones IA', description: 'Auditar chats, sesiones y cotizaciones de WhatsApp, Instagram y web.' },
      {
        id: 'marketing',
        label: 'Marketing',
        description: 'Correos automáticos enviados, cupones y programa de referidos.',
        actions: { 'marketing.manage': 'Crear cupones y configurar referidos' },
        sections: [
          { id: 'emails', label: 'Correos' },
          { id: 'coupons', label: 'Cupones y referidos' },
        ],
      },
    ],
  },
  {
    label: 'Clientes',
    modules: [
      { id: 'customers', label: 'Clientes', description: 'Personas atendidas y sus fichas.' },
      { id: 'companies', label: 'Empresas', description: 'Cuentas empresa, sus personas y sus reservas.' },
    ],
  },
  {
    label: 'Finanzas',
    modules: [
      {
        id: 'finance',
        label: 'Finanzas',
        description: 'Lo reservado, cobrado y por cobrar del mes, ingresos por origen y gráfico mensual.',
        sections: [
          { id: 'summary', label: 'Resumen' },
          { id: 'income', label: 'EERR' },
          { id: 'expenses', label: 'Gastos' },
          { id: 'accounting', label: 'IVA y banco' },
          { id: 'workers', label: 'Pago a trabajadores' },
          { id: 'closing', label: 'Cierre de pagos' },
        ],
      },
      {
        id: 'invoicing',
        label: 'Emisión de facturas',
        description: 'Facturar a empresas con Emisso y ver las facturas del mes.',
        actions: { 'invoices.emit': 'Previsualizar y emitir facturas ante el SII' },
      },
    ],
  },
  {
    label: 'Equipo',
    modules: [
      { id: 'fleet', label: 'Flota y equipo', description: 'Camiones, trabajadores y sus accesos.' },
      { id: 'schedule', label: 'Horarios', description: 'Bloqueos y disponibilidad de la agenda.' },
    ],
  },
  {
    label: 'Sistema',
    modules: [
      { id: 'activity', label: 'Actividad', description: 'Registro de quién hizo cada cambio.' },
      {
        id: 'settings',
        label: 'Configuración',
        description: 'Precios, horarios, inventario y usuarios.',
        actions: {
          'users.manage': 'Crear usuarios y editar perfiles',
          // Sin esto, quien ve Inventario solo puede agregar ítems nuevos (Tomás, 15-10-2026).
          'inventory.adjust': 'Editar, desactivar y borrar ítems del inventario (sin esto solo se pueden agregar)',
          // Sin esto, Precios y el valor UF se ven en solo lectura (Tomás, 21-10-2026).
          'pricing.edit': 'Cambiar precios, tarifas y el valor UF (sin esto se ven en solo lectura)',
        },
        sections: [
          { id: 'pricing', label: 'Precios' },
          { id: 'schedule-config', label: 'Horarios' },
          { id: 'inventory', label: 'Inventario' },
          { id: 'worker-pay', label: 'Pago a trabajadores' },
          { id: 'legal', label: 'Políticas y términos' },
        ],
      },
    ],
  },
]

export const ADMIN_MODULES: AdminModule[] = ADMIN_MODULE_GROUPS.flatMap((g) => g.modules)

export function isAdminModuleId(value: unknown): value is AdminModuleId {
  return ADMIN_MODULES.some((m) => m.id === value)
}

/** Módulo al que pertenece cada acción delicada. */
export const ADMIN_ACTION_MODULE = Object.fromEntries(
  ADMIN_MODULES.flatMap((m) => Object.keys(m.actions || {}).map((a) => [a, m.id]))
) as Record<AdminActionId, AdminModuleId>

export const ADMIN_ACTIONS = Object.keys(ADMIN_ACTION_MODULE) as AdminActionId[]

/** Todas las claves de subpanel que existen: «finance.income», «settings.pricing»… */
export const ADMIN_SECTION_KEYS: string[] = ADMIN_MODULES.flatMap((m) => (m.sections || []).map((sec) => sectionKey(m.id, sec.id)))

/** Módulo dueño de una clave de subpanel. */
export const sectionModule = (key: string) => key.slice(0, key.indexOf('.')) as AdminModuleId
