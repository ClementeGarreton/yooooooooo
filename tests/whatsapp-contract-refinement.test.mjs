import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FREEFORM_START, applyLabelEdits, formatIntakeNextPrompt,
  inferSinglePendingEdit, isContractClauseReply, nextIntakePending, markServiceAnswers,
} from '../src/lib/whatsapp/freeformIntake.ts'

const make = () => {
  const address = () => ({ street: null, number: null, commune: null, region: null, additionalInfo: null })
  const details = () => ({ propertyType: null, floor: null, hasElevator: null, parkingDistance: null })
  return {
    personalInfo: { name: null, email: null, phone: '56900000000', isCompany: false, companyName: null, companyRut: null },
    schedule: { date: null, time: null, isFlexible: false },
    origin: { address: address(), details: details() },
    destination: { address: address(), details: details() },
    taxDocument: null, items: [], pendingInventory: [], inventoryPhotos: [], inventoryCollectionDone: true,
    additionalServices: { disassembly: false, assembly: false, packing: false, unpacking: false, observations: '__pending__', photos: [] },
    intake: { stage: 'review', serviceAnswers: [] }, confirmed: false,
  }
}

test('presenta orientación natural y servicios agrupados sin mensajes extensos', () => {
  assert.match(FREEFORM_START, /Cuéntame en un solo mensaje/)
  assert.match(FREEFORM_START, /servicios adicionales/)
  assert.match(FREEFORM_START, /ficha con variables/)
  assert.ok(FREEFORM_START.length < 700)
})

test('las seis preguntas binarias quedan agrupadas antes del resto de datos', () => {
  const state = make()
  const pending = nextIntakePending(state)
  assert.equal(pending.label, 'CONFIRMACIONES')
  assert.match(formatIntakeNextPrompt(state), /ASCENSOR ORIGEN: SÍ\/NO/)
  assert.match(formatIntakeNextPrompt(state), /DESEMBALAJE: SÍ\/NO/)
  assert.doesNotMatch(formatIntakeNextPrompt(state), /FICHA INTERPRETADA/)
})

test('respuesta breve al piso pendiente se interpreta determinísticamente, sin cambiar destino', () => {
  const state = make()
  state.personalInfo.name = 'Cliente Prueba'
  state.personalInfo.email = 'demo@example.com'
  state.taxDocument = 'boleta'
  state.schedule.date = '2026-11-09'
  state.schedule.time = '09:00'
  Object.assign(state.origin.address, { street: 'Calle 1', number: '13', commune: 'Las Condes', region: 'metropolitana' })
  Object.assign(state.destination.address, { street: 'Calle 2', number: '22', commune: 'Las Condes', region: 'metropolitana' })
  state.origin.details.propertyType = 'departamento'
  state.origin.details.hasElevator = false
  state.destination.details.hasElevator = false
  // Sólo resta un dato numérico: así no se confunde un piso con un número de casa
  state.destination.details.floor = 0
  state.origin.details.parkingDistance = 15
  state.destination.details.parkingDistance = 0
  state.intake.serviceAnswers = ['packing','disassembly','assembly','unpacking']
  const edit = inferSinglePendingEdit(state, '5')
  assert.equal(edit, 'PISO ORIGEN SI APLICA: 5')
  const result = applyLabelEdits(state, edit)
  assert.deepEqual(result.errors, [])
  assert.equal(result.state.origin.details.floor, 5)
  assert.equal(result.state.destination.details.floor, 0)
})

test('respuesta sí/no al ascensor se procesa sólo para el lado correspondiente', () => {
  const state = make()
  Object.assign(state.personalInfo, { name: 'Cliente Prueba', email: 'demo@example.com' })
  state.taxDocument = 'boleta'; state.schedule.date = '2026-11-09'; state.schedule.time = '09:00'
  Object.assign(state.origin.address, { street: 'Calle 1', number: '13', commune: 'Las Condes', region: 'metropolitana' })
  Object.assign(state.destination.address, { street: 'Calle 2', number: '22', commune: 'Las Condes', region: 'metropolitana' })
  Object.assign(state.origin.details, { propertyType: 'departamento', floor: 5 })
  // Durante el bloque agrupado 'sí' solo sería ambiguo: usar etiqueta.
  const edit = inferSinglePendingEdit(state, 'sí')
  assert.equal(edit, null)
  const next = applyLabelEdits(state, 'ASCENSOR ORIGEN: sí')
  assert.equal(next.state.origin.details.hasElevator, true)
  assert.equal(next.state.destination.details.hasElevator, null)
})

test('mensajes elaborados no quedan reducidos al siguiente campo', () => {
  assert.equal(inferSinglePendingEdit(make(), 'Me mudo el viernes desde un departamento en el centro y llevo tres camas'), null)
  assert.equal(inferSinglePendingEdit(make(), 'NOMBRE: Ana\nCORREO: ana@example.com'), null)
})

test('la ruta incluye revisión completa inicial y edición guiada posterior', () => {
  const src = readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts', import.meta.url), 'utf8')
  assert.match(src, /inferSinglePendingEdit\(session\.state, text\)/)
  assert.match(src, /sendFreeformReview\(session, conversationId, to, availability, 'next'\)/)
  assert.match(src, /if \(\/\^\(ficha\|resumen\|ver ficha\)/)
})

test('respuestas copiadas de las cláusulas se procesan como relato, no como etiquetas inválidas', () => {
  const draft = '1. Solicitante: Ana, ana@example.com\n2. Fecha: mañana 10:00\n5. Inventario: dos camas'
  assert.equal(isContractClauseReply(draft), true)
  assert.equal(isContractClauseReply('PISO ORIGEN SI APLICA: 5'), false)
  const src = readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts', import.meta.url), 'utf8')
  assert.match(src, /labels\.recognized && !isContractClauseReply\(text\)/)
})
