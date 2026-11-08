/** Cotización por declaración libre y correcciones de etiquetas.
 * Solo modifica el JSONB ya existente; no altera el motor de precios.
 */
import type { QuoteSessionState, PropertyType } from '../quoteSession'

export type IntakeService = 'packing' | 'disassembly' | 'assembly' | 'unpacking'
export const INTAKE_SERVICES: IntakeService[] = ['packing', 'disassembly', 'assembly', 'unpacking']

export const FREEFORM_START = [
  '¡Vamos con tu cotización! 🙂',
  'Cuéntame en un solo mensaje: nombre, correo, boleta/factura, fecha, hora, origen, destino y muebles con cantidades.',
  'Si conoces pisos, ascensores y servicios adicionales, inclúyelos también. Puedes enviar fotos.',
  'Iremos completando solo lo pendiente; al final podrás revisar tu *ficha con variables*.',
  'Escribe *ASESOR* si prefieres atención humana.',
].join('\n')

const noAccent = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const normalizeLabel = (value: string) => noAccent(value).replace(/\*/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== ''
const printable = (value: unknown): string => value === null || value === undefined || value === '' ? 'PENDIENTE' : typeof value === 'boolean' ? (value ? 'SÍ' : 'NO') : String(value)
const yesNo = (input: string): boolean | null => {
  const value = noAccent(input).trim().toLowerCase()
  if (/^(si|yes|claro|con|necesito|requiere|incluye|hay)\b/.test(value)) return true
  if (/^(no|sin|ninguno|ninguna|no necesito)\b/.test(value)) return false
  return null
}

const regionCodes = new Set(['arica', 'tarapaca', 'antofagasta', 'atacama', 'coquimbo', 'valparaiso', 'metropolitana', 'ohiggins', 'maule', 'nuble', 'biobio', 'araucania', 'losrios', 'loslagos', 'aysen', 'magallanes'])
const propertyTypes = new Set(['casa', 'departamento', 'oficina', 'bodega', 'otro'])

export function hasFreeformIntake(state: QuoteSessionState): boolean {
  return Boolean(state.intake)
}

/** Los nombres de campo que aparecen aquí SON los nombres que se aceptan al corregir. */
export function intakeMissing(state: QuoteSessionState): string[] {
  const missing: string[] = []
  if (!present(state.personalInfo.name)) missing.push('NOMBRE')
  if (!present(state.personalInfo.email)) missing.push('CORREO')
  if (!present(state.taxDocument)) missing.push('DOCUMENTO (BOLETA o FACTURA)')
  if (state.taxDocument === 'factura') {
    if (!present(state.personalInfo.companyName)) missing.push('RAZÓN SOCIAL')
    if (!present(state.personalInfo.companyRut)) missing.push('RUT EMPRESA')
  }
  if (!present(state.schedule.date)) missing.push('FECHA (AAAA-MM-DD)')
  if (!present(state.schedule.time)) missing.push('HORA (HH:MM)')
  for (const [prefix, side] of [['ORIGEN', state.origin], ['DESTINO', state.destination]] as const) {
    if (!present(side.address.street)) missing.push(`CALLE ${prefix}`)
    if (!present(side.address.number)) missing.push(`NÚMERO ${prefix}`)
    if (!present(side.address.commune)) missing.push(`COMUNA ${prefix}`)
    if (!present(side.address.region)) missing.push(`REGIÓN ${prefix}`)
    if (!present(side.details.propertyType)) missing.push(prefix)
    if (side.details.floor === null) missing.push(`PISO ${prefix} SI APLICA`)
    if (side.details.hasElevator === null) missing.push(`ASCENSOR ${prefix}`)
    if (side.details.parkingDistance === null) missing.push(`DISTANCIA ENTRADA/ESTACIONAMIENTO ${prefix} (M)`)
  }
  if (!state.items.length || state.pendingInventory.length) missing.push('INVENTARIO')
  for (const key of INTAKE_SERVICES) {
    if (!state.intake?.serviceAnswers?.includes(key)) {
      missing.push(({ packing: 'EMBALAJE', disassembly: 'DESARMADO', assembly: 'ARMADO', unpacking: 'DESEMBALAJE' } as const)[key])
    }
  }
  return missing
}

export function intakeCanConfirm(state: QuoteSessionState): boolean {
  return intakeMissing(state).length === 0
    && !(state.inventoryPhotos || []).some((photo) => photo.status !== 'done')
}

export function markServiceAnswers(state: QuoteSessionState, answers: IntakeService[]): QuoteSessionState {
  const next: QuoteSessionState = structuredClone(state)
  if (!next.intake) return next
  next.intake.serviceAnswers = [...new Set([...(next.intake.serviceAnswers || []), ...answers])]
  if (INTAKE_SERVICES.every((service) => next.intake?.serviceAnswers.includes(service))) {
    if (next.additionalServices.observations === '__pending__') next.additionalServices.observations = ''
    next.additionalServices.extrasStep = 'done'
  }
  return next
}

export type InventoryLabelUpdate = { mode: 'replace' | 'add'; description: string }
export interface LabelEditResult {
  state: QuoteSessionState
  changed: string[]
  errors: string[]
  inventory: InventoryLabelUpdate | null
  recognized: boolean
}

/** Correcciones exactas y auditables. Un campo ambiguo NO se aplica a otra dirección. */
export function applyLabelEdits(state: QuoteSessionState, input: string): LabelEditResult {
  const next: QuoteSessionState = structuredClone(state)
  const changed: string[] = []
  const errors: string[] = []
  let inventory: InventoryLabelUpdate | null = null
  // Atajo solicitado: una respuesta marca NO en ambos ascensores y en los
  // cuatro servicios. Los demás campos (piso, distancia, inventario) NO se inventan.
  if (/^(?:no a todo|todo no|todos no)[.!\s]*$/i.test(noAccent(input.trim()))) {
    next.origin.details.hasElevator = false
    next.destination.details.hasElevator = false
    for (const service of INTAKE_SERVICES) next.additionalServices[service] = false
    next.additionalServices.observations = ''
    if (next.intake) next.intake.serviceAnswers = [...INTAKE_SERVICES]
    next.additionalServices.extrasStep = 'done'
    return { state: next, changed: ['ASCENSOR ORIGEN', 'ASCENSOR DESTINO', 'EMBALAJE', 'DESARMADO', 'ARMADO', 'DESEMBALAJE'], errors, inventory, recognized: true }
  }
  const rawLines = input.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (!rawLines.length || !rawLines.every((line) => /^[^:]{2,90}:\s*.*$/.test(line) || /^[-•]\s*.+/.test(line))) {
    return { state: next, changed, errors, inventory, recognized: false }
  }
  // Un encabezado de inventario puede tener varias líneas, incluso con viñetas.
  const entries: Array<{ label: string; value: string }> = []
  for (const line of rawLines) {
    const match = /^([^:]{2,90}):\s*(.*)$/.exec(line)
    if (match) entries.push({ label: normalizeLabel(match[1]), value: match[2].trim() })
    else if (entries.length && ['INVENTARIO', 'AGREGAR INVENTARIO'].includes(entries[entries.length - 1].label)) {
      entries[entries.length - 1].value += `${entries[entries.length - 1].value ? '\n' : ''}${line.replace(/^[-•]\s*/, '')}`
    } else errors.push(`Línea sin variable: ${line}`)
  }
  if (!entries.length) return { state: next, changed, errors, inventory, recognized: false }
  // Los relatos de ubicación con "Origen: depto en Las Condes, piso 5..."
  // contienen VARIAS propiedades, no son una asignación ORIGEN=tipo de inmueble.
  // Delegar el texto completo al parser estructurado en vez de rechazarlo.
  if (entries.some(({ label, value }) =>
    (label === 'ORIGEN' || label === 'DESTINO') &&
    !propertyTypes.has(normalizeLabel(value).toLowerCase()))) {
    return { state: structuredClone(state), changed: [], errors: [], inventory: null, recognized: false }
  }
  const focus = entries.some((row) => row.label === 'ORIGEN') && !entries.some((row) => row.label === 'DESTINO') ? 'ORIGEN'
    : entries.some((row) => row.label === 'DESTINO') && !entries.some((row) => row.label === 'ORIGEN') ? 'DESTINO' : null
  const assign = (target: object, key: string, value: unknown, label: string) => {
    ;(target as Record<string, unknown>)[key] = value
    changed.push(label)
  }
  const assignService = (key: IntakeService, value: string, label: string) => {
    const direct = yesNo(value)
    // "Solo vajilla" / "dos camas" expresa intención afirmativa y la selección específica.
    const enabled = direct === null ? !/^(ninguno|ninguna|sin servicio|no aplica)$/i.test(value) : direct
    assign(next.additionalServices, key, enabled, label)
    const withDetails = direct === null || /^s[ií]\s*[,;:—-]\s*\S/i.test(value)
      || /\b(solo|únicamente|unicamente|camas?|vajilla|cajas?|muebles?)\b/i.test(value)
    if (enabled && withDetails) {
      const note = `${label}: ${value}`
      const current = next.additionalServices.observations === '__pending__' ? '' : next.additionalServices.observations
      if (!current.includes(note)) next.additionalServices.observations = [current, note].filter(Boolean).join('\n')
    }
    if (next.intake) next.intake.serviceAnswers = [...new Set([...(next.intake.serviceAnswers || []), key])]
  }
  for (const { label, value } of entries) {
    if (!value) { errors.push(`${label}: falta un valor`); continue }
    if (label === 'INVENTARIO' || label === 'AGREGAR INVENTARIO') {
      if (inventory) { errors.push('Solo una modificación de INVENTARIO por mensaje'); continue }
      inventory = { mode: label === 'INVENTARIO' ? 'replace' : 'add', description: value }
      changed.push(label)
      continue
    }
    if (label === 'SERVICIOS') {
      const plain = noAccent(value).toLowerCase()
      if (/^(ninguno|ninguna|no necesito|sin servicios)([.!\s]|$)/.test(plain)) {
        for (const service of INTAKE_SERVICES) assignService(service, 'NO', 'SERVICIOS')
        continue
      }
      if (/^solo\b/.test(plain)) {
        const named: Record<IntakeService, RegExp> = {
          packing: /\b(embalar|embalaje|empaquetar|empacar)\b/,
          disassembly: /\b(desarmar|desarme|desmontar|desarmado)\b/,
          assembly: /\b(armar|armado|montar)\b/,
          unpacking: /\b(desembalar|desembalaje|desempaquetar)\b/,
        }
        if (!INTAKE_SERVICES.some((key) => named[key].test(plain))) {
          errors.push('SERVICIOS: indica qué servicios necesitas después de SOLO')
        } else {
          for (const key of INTAKE_SERVICES) assignService(key, named[key].test(plain) ? 'SÍ' : 'NO', 'SERVICIOS')
          const note = `SERVICIOS: ${value}`
          const old = next.additionalServices.observations === '__pending__' ? '' : next.additionalServices.observations
          if (!old.includes(note)) next.additionalServices.observations = [old, note].filter(Boolean).join('\n')
        }
        continue
      }
      errors.push('SERVICIOS: escribe NINGUNO o SOLO seguido de los servicios; también puedes usar EMBALAJE, DESARMADO, ARMADO y DESEMBALAJE')
      continue
    }
    if (label === 'NOMBRE') { assign(next.personalInfo, 'name', value, label); continue }
    if (label === 'CORREO' || label === 'EMAIL') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push(`${label}: correo inválido`)
      else assign(next.personalInfo, 'email', value, label)
      continue
    }
    if (label === 'TELEFONO' || label === 'TELÉFONO') { assign(next.personalInfo, 'phone', value.replace(/[^\d+]/g, ''), label); continue }
    if (label === 'DOCUMENTO') {
      const doc = normalizeLabel(value)
      if (doc !== 'BOLETA' && doc !== 'FACTURA') errors.push('DOCUMENTO: debe ser BOLETA o FACTURA')
      else {
        assign(next, 'taxDocument', doc.toLowerCase(), label)
        next.personalInfo.isCompany = doc === 'FACTURA'
      }
      continue
    }
    if (label === 'RAZON SOCIAL' || label === 'RAZÓN SOCIAL') { assign(next.personalInfo, 'companyName', value, label); continue }
    if (label === 'RUT EMPRESA') { assign(next.personalInfo, 'companyRut', value, label); continue }
    if (label === 'FECHA') {
      let date = value
      const latam = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(value)
      if (latam) date = `${latam[3]}-${latam[2]}-${latam[1]}`
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) errors.push('FECHA: usa AAAA-MM-DD')
      else assign(next.schedule, 'date', date, label)
      continue
    }
    if (label === 'HORA') {
      const m = /^(\d{1,2}):(\d{2})$/.exec(value)
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) errors.push('HORA: usa HH:MM')
      else assign(next.schedule, 'time', `${m[1].padStart(2, '0')}:${m[2]}`, label)
      continue
    }
    if (label === 'FLEXIBILIDAD') {
      const b = yesNo(value)
      if (b === null) errors.push('FLEXIBILIDAD: responde SÍ o NO')
      else assign(next.schedule, 'isFlexible', b, label)
      continue
    }
    if (label === 'EMBALAJE') { assignService('packing', value, label); continue }
    if (label === 'DESARMADO') { assignService('disassembly', value, label); continue }
    if (label === 'ARMADO') { assignService('assembly', value, label); continue }
    if (label === 'DESEMBALAJE') { assignService('unpacking', value, label); continue }
    if (label === 'OBSERVACIONES') {
      assign(next.additionalServices, 'observations', value, label)
      continue
    }
    const sideName = label.includes('ORIGEN') ? 'ORIGEN' : label.includes('DESTINO') ? 'DESTINO' : focus
    const side = sideName === 'ORIGEN' ? next.origin : sideName === 'DESTINO' ? next.destination : null
    if (['PISO SI APLICA', 'ASCENSOR', 'DISTANCIA DE LA ENTRADA/ESTACIONAMIENTO', 'DISTANCIA ENTRADA/ESTACIONAMIENTO'].includes(label) && !side) {
      errors.push(`${label}: indica ORIGEN o DESTINO para evitar confusiones`)
      continue
    }
    if (side) {
      if (label === sideName) {
        const kind = normalizeLabel(value).toLowerCase()
        if (!propertyTypes.has(kind)) errors.push(`${label}: tipo de inmueble no reconocido (casa, departamento, oficina, bodega, otro)`)
        else {
          assign(side.details, 'propertyType', kind as PropertyType, label)
          if (kind === 'casa' && side.details.floor === null) {
            // Una casa no implica necesariamente un solo piso: exigir confirmación.
          }
        }
        continue
      }
      if (label.startsWith('CALLE ')) { assign(side.address, 'street', value, label); continue }
      if (label.startsWith('NUMERO ') || label.startsWith('NÚMERO ')) { assign(side.address, 'number', value, label); continue }
      if (label.startsWith('COMUNA ')) {
        assign(side.address, 'commune', value, label)
        const metro = new Set(['lascondes','providencia','nunoa','santiago','lareina','vitacura','lo barnechea'.replace(/\s/g,''),'macul','penalolen','estacioncentral','maipu','puentealto','quilicura','independencia','recoleta','sanmiguel','sanjoaquin','huechuraba'])
        if (!present(side.address.region) && metro.has(normalizeLabel(value).toLowerCase().replace(/\s/g,''))) {
          assign(side.address, 'region', 'metropolitana', `REGIÓN ${sideName}`)
        }
        continue
      }
      if (label.startsWith('REGION ') || label.startsWith('REGIÓN ')) {
        const rawRegion = normalizeLabel(value).toLowerCase().replace(/\s+/g, '')
        const region = rawRegion === 'rm' || rawRegion === 'regionmetropolitana' || rawRegion === 'santiago'
          ? 'metropolitana' : rawRegion
        if (!regionCodes.has(region)) errors.push(`${label}: región no reconocida`)
        else assign(side.address, 'region', region, label)
        continue
      }
      if (label.startsWith('PISO ') || label === 'PISO SI APLICA') {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0 || n > 100) errors.push(`${label}: usa un número de piso entre 0 y 100`)
        else assign(side.details, 'floor', n, label)
        continue
      }
      if (label.startsWith('ASCENSOR')) {
        const b = yesNo(value)
        if (b === null) errors.push(`${label}: responde SÍ o NO`)
        else assign(side.details, 'hasElevator', b, label)
        continue
      }
      if (label.includes('DISTANCIA') && (label.includes('ESTACIONAMIENTO') || label.includes('ENTRADA'))) {
        const n = Number(value.replace(/\s*(m|metros?)$/i, '').replace(',', '.'))
        if (!Number.isFinite(n) || n < 0 || n > 10000) errors.push(`${label}: indica metros (por ejemplo 15)`)
        else assign(side.details, 'parkingDistance', n, label)
        continue
      }
    }
    errors.push(`No reconozco la variable «${label}». Copia el nombre tal como aparece en la ficha.`)
  }
  return { state: markServiceAnswers(next, []), changed, errors, inventory, recognized: true }
}

/**
 * Agrupa todas las respuestas pendientes: el usuario puede resolverlas EN UN mensaje.
 * No hacer un ping-pong de hasta 17 preguntas aisladas por WhatsApp.
 */
export function nextIntakePending(state: QuoteSessionState): { label: string; question: string; remaining: number } | null {
  const missing = intakeMissing(state)
  if (!missing.length) return null
  const booleanPending: string[] = []
  if (state.origin.details.hasElevator === null) booleanPending.push('ASCENSOR ORIGEN')
  if (state.destination.details.hasElevator === null) booleanPending.push('ASCENSOR DESTINO')
  const serviceNames: Record<IntakeService, string> = {
    packing: 'EMBALAJE', disassembly: 'DESARMADO', assembly: 'ARMADO', unpacking: 'DESEMBALAJE',
  }
  for (const service of INTAKE_SERVICES) {
    if (!state.intake?.serviceAnswers?.includes(service)) booleanPending.push(serviceNames[service])
  }
  if (booleanPending.length) {
    return {
      label: 'CONFIRMACIONES', remaining: missing.length,
      question: [
        '*Confirmemos los servicios de una vez:*',
        ...booleanPending.map((label) => `${label}: SÍ/NO`),
        'Puedes responder todo junto, indicando los muebles si pides un servicio.',
        'Si todo es NO, escribe *NO A TODO*.',
        'Si solo rechazas los servicios: *SERVICIOS: NINGUNO*.',
      ].join('\n'),
    }
  }

  // Mostrar lo que falta POR GRUPOS, no una pregunta por cada variable.
  // Las etiquetas completas siguen disponibles con el comando FICHA.
  const basics: Array<[string, string]> = [
    ['NOMBRE', 'nombre'], ['CORREO', 'correo'],
    ['DOCUMENTO (BOLETA o FACTURA)', 'boleta o factura'],
    ['RAZÓN SOCIAL', 'razón social'], ['RUT EMPRESA', 'RUT empresa'],
    ['FECHA (AAAA-MM-DD)', 'fecha'], ['HORA (HH:MM)', 'hora'],
  ]
  const locationFields = (side: 'ORIGEN' | 'DESTINO'): Array<[string, string]> => [
    [`CALLE ${side}`, 'calle'], [`NÚMERO ${side}`, 'número'],
    [`COMUNA ${side}`, 'comuna'], [`REGIÓN ${side}`, 'región'],
    [side, 'casa/depto/oficina/bodega'], [`PISO ${side} SI APLICA`, 'piso (0 para planta baja)'],
    [`DISTANCIA ENTRADA/ESTACIONAMIENTO ${side} (M)`, 'metros desde camión a entrada (0 si estaciona en la puerta)'],
  ]
  const selections = (pairs: Array<[string, string]>) =>
    pairs.filter(([key]) => missing.includes(key)).map(([, name]) => name)
  const lines = [
    '*Completemos lo que falta en un solo mensaje:*',
  ]
  const b = selections(basics)
  if (b.length) lines.push(`• *Datos:* ${b.join(', ')}.`)
  const origin = selections(locationFields('ORIGEN'))
  if (origin.length) lines.push(`• *Origen:* ${origin.join(', ')}.`)
  const destination = selections(locationFields('DESTINO'))
  if (destination.length) lines.push(`• *Destino:* ${destination.join(', ')}.`)
  if (missing.includes('INVENTARIO')) {
    lines.push(state.pendingInventory.length
      ? `• *Inventario:* aclara este artículo: ${state.pendingInventory[0].question}`
      : '• *Inventario:* muebles y cantidades (también puedes enviar fotos).')
  }
  lines.push('Escribe en tus palabras, pero separa claramente *origen* y *destino*. Si prefieres revisar cada variable, escribe *FICHA*.')
  return { label: 'DATOS PENDIENTES', remaining: missing.length, question: lines.join('\n') }
}

export function formatIntakeNextPrompt(state: QuoteSessionState): string {
  const pending = nextIntakePending(state)
  if (!pending) return '✅ *Datos completos.* Escribe *FICHA* para revisar el detalle o *CONFIRMAR* para generar la cotización estimativa.'
  return pending.question
}

/** Una respuesta organizada según las cláusulas se parsea como relato, no como etiqueta incorrecta. */
export function isContractClauseReply(text: string): boolean {
  return /(?:^|\n)\s*[1-7][.)]\s*(?:solicitante|fecha|trayecto|acceso(?: en cada lugar)?|inventario|servicios|observaciones)\s*:/im.test(text)
}

/** Una respuesta corta sin etiqueta solo se asigna cuando no hay ambigüedad. */
export function inferSinglePendingEdit(state: QuoteSessionState, text: string): string | null {
  if (state.intake?.stage !== 'review') return null
  const pending = nextIntakePending(state)
  if (!pending) return null
  const value = text.trim()
  if (!value || value.length > 100 || value.includes('\n') || (value.includes(':') && !/^\d{1,2}:\d{2}$/.test(value))) return null
  const missing = intakeMissing(state)
  if (pending.label === 'CONFIRMACIONES') return null

  const uniqueMatch = (regex: RegExp, labels: string[]) => {
    if (!regex.test(value)) return null
    const candidates = labels.filter((label) => missing.includes(label))
    return candidates.length === 1 ? `${candidates[0]}: ${value}` : null
  }
  if (/^(boleta|factura)$/i.test(value)) return missing.includes('DOCUMENTO (BOLETA o FACTURA)') ? `DOCUMENTO: ${value}` : null
  if (/^\d{1,2}:\d{2}$/.test(value)) return missing.includes('HORA (HH:MM)') ? `HORA: ${value}` : null
  if (/^(?:\d{4}-\d{2}-\d{2}|\d{2}[-/]\d{2}[-/]\d{4})$/.test(value)) return missing.includes('FECHA (AAAA-MM-DD)') ? `FECHA: ${value}` : null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return missing.includes('CORREO') ? `CORREO: ${value}` : null
  if (/^\d+(?:[.,]\d+)?(?:\s*(?:m|metros?))?$/i.test(value)) {
    const meters = /(?:m|metros?)$/i.test(value)
    const distanceLabels = [
      'DISTANCIA ENTRADA/ESTACIONAMIENTO ORIGEN (M)', 'DISTANCIA ENTRADA/ESTACIONAMIENTO DESTINO (M)',
    ]
    const numericLabels = meters ? distanceLabels : [
      'PISO ORIGEN SI APLICA', 'PISO DESTINO SI APLICA', ...distanceLabels,
      'NÚMERO ORIGEN', 'NÚMERO DESTINO',
    ]
    return uniqueMatch(/^\d+(?:[.,]\d+)?(?:\s*(?:m|metros?))?$/i, numericLabels)
  }
  if (/^(casa|departamento|oficina|bodega|otro)$/i.test(value)) {
    return uniqueMatch(/^(casa|departamento|oficina|bodega|otro)$/i, ['ORIGEN','DESTINO'])
  }
  if (/^(rm|metropolitana|region metropolitana)$/i.test(noAccent(value))) {
    return uniqueMatch(/^(rm|metropolitana|region metropolitana)$/i, ['REGIÓN ORIGEN','REGIÓN DESTINO'])
  }
  if (/^[\p{L}\s'-]{3,40}$/u.test(value) && value.split(' ').length <= 4) {
    return uniqueMatch(/^[\p{L}\s'-]{3,40}$/u, ['COMUNA ORIGEN','COMUNA DESTINO'])
  }
  return null
}

/** No inventar el lado/campo cuando una respuesta breve tiene dos destinos posibles. */
export function ambiguousGroupedReply(state: QuoteSessionState, text: string): string | null {
  if (nextIntakePending(state)?.label !== 'DATOS PENDIENTES') return null
  const value = noAccent(text.trim()).toLowerCase().replace(/\s+/g, ' ')
  if (!value || value.length > 45 || /[:\n;,]/.test(value)) return null
  const missing = intakeMissing(state)
  const both = (a: string, b: string) => missing.includes(a) && missing.includes(b)
  if (/^(rm|metropolitana|region metropolitana)$/.test(value)
      && both('REGIÓN ORIGEN', 'REGIÓN DESTINO')) {
    return '¿La Región Metropolitana corresponde al origen, al destino o a ambos? Puedes responder: ORIGEN: RM; DESTINO: RM.'
  }
  if (/^(casa|departamento|oficina|bodega|otro)$/.test(value)
      && both('ORIGEN', 'DESTINO')) {
    return `¿${text.trim()} corresponde al origen, al destino o a ambos? Indica cada lugar en una frase.`
  }
  if (/^\d+(?:[.,]\d+)?(?:\s*(?:m|metros?))?$/.test(value)) {
    const available = [
      'NÚMERO ORIGEN', 'NÚMERO DESTINO',
      'PISO ORIGEN SI APLICA', 'PISO DESTINO SI APLICA',
      'DISTANCIA ENTRADA/ESTACIONAMIENTO ORIGEN (M)',
      'DISTANCIA ENTRADA/ESTACIONAMIENTO DESTINO (M)',
    ].filter((label) => missing.includes(label) &&
      (!/(?:m|metros?)$/.test(value) || label.startsWith('DISTANCIA')))
    if (available.length > 1) return '¿Ese número indica piso, número de calle o metros desde el camión? ¿Es del origen o del destino? Puedes aclarar ambos en una frase.'
  }
  const knownCommunes = new Set(['las condes','providencia','santiago','nunoa','vitacura','la reina','lo barnechea','macul','maipu','penalolen','puente alto','san miguel'])
  if (knownCommunes.has(value) && both('COMUNA ORIGEN','COMUNA DESTINO')) {
    return `¿${text.trim()} corresponde a la comuna de origen, de destino o de ambas? Puedes responder: «Origen: ${text.trim()}; Destino: ${text.trim()}».`
  }
  return null
}

/** Ficha reversible: el cliente puede copiar exactamente cualquier rótulo. */
export function formatIntakeReview(state: QuoteSessionState, inventoryNames: string[] = []): string {
  const serviceSet = new Set(state.intake?.serviceAnswers || [])
  const service = (key: IntakeService) => serviceSet.has(key)
    ? (state.additionalServices[key] ? 'SÍ' : 'NO') : 'PENDIENTE'
  const addr = (prefix: string, side: QuoteSessionState['origin']) => [
    `*${prefix}:* ${printable(side.details.propertyType)?.toUpperCase()}`,
    `CALLE ${prefix}: ${printable(side.address.street)}`,
    `NÚMERO ${prefix}: ${printable(side.address.number)}`,
    `COMUNA ${prefix}: ${printable(side.address.commune)}`,
    `REGIÓN ${prefix}: ${printable(side.address.region)}`,
    `PISO ${prefix} SI APLICA: ${printable(side.details.floor)}`,
    `ASCENSOR ${prefix}: ${printable(side.details.hasElevator)}`,
    `DISTANCIA ENTRADA/ESTACIONAMIENTO ${prefix}: ${side.details.parkingDistance === null ? 'PENDIENTE' : `${side.details.parkingDistance} M`}`,
  ]
  const inventory = inventoryNames.length ? inventoryNames.map((item) => `- ${item}`).join('\n') : 'PENDIENTE'
  const out = [
    '📋 *FICHA INTERPRETADA — REVISA Y CORRIGE*',
    '',
    `NOMBRE: ${printable(state.personalInfo.name)}`,
    `CORREO: ${printable(state.personalInfo.email)}`,
    `TELÉFONO: ${printable(state.personalInfo.phone)}`,
    `DOCUMENTO: ${printable(state.taxDocument)?.toUpperCase()}`,
    ...(state.taxDocument === 'factura' ? [`RAZÓN SOCIAL: ${printable(state.personalInfo.companyName)}`, `RUT EMPRESA: ${printable(state.personalInfo.companyRut)}`] : []),
    `FECHA: ${printable(state.schedule.date)}`,
    `HORA: ${printable(state.schedule.time)}`,
    `FLEXIBILIDAD: ${printable(state.schedule.isFlexible)}`,
    '',
    ...addr('ORIGEN', state.origin), '', ...addr('DESTINO', state.destination), '',
    `INVENTARIO:\n${inventory}`,
    '',
    `EMBALAJE: ${service('packing')}`,
    `DESARMADO: ${service('disassembly')}`,
    `ARMADO: ${service('assembly')}`,
    `DESEMBALAJE: ${service('unpacking')}`,
    `OBSERVACIONES: ${state.additionalServices.observations === '__pending__' ? 'PENDIENTE' : printable(state.additionalServices.observations || 'SIN OBSERVACIONES')}`,
  ]
  const missing = intakeMissing(state)
  if (missing.length) {
    out.push('', `*PENDIENTES: ${missing.length}* (los campos faltantes están marcados arriba).`,
      '', formatIntakeNextPrompt(state),
      'Si prefieres, también puedes completar varios campos en un solo mensaje. Para rechazar todos los servicios extra, escribe `SERVICIOS: NINGUNO`.')
  } else {
    out.push('', '✅ *Datos completos*. Si todo está correcto, escribe *CONFIRMAR* para generar el PDF.',
      'Si deseas modificar algo, envía `NOMBRE DE VARIABLE: nuevo valor` (puedes cambiar varias variables en un solo mensaje).')
  }
  return out.join('\n')
}
