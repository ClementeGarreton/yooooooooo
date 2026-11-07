import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyLabelEdits, formatIntakeReview, intakeMissing, intakeCanConfirm, FREEFORM_START, markServiceAnswers } from '../src/lib/whatsapp/freeformIntake.ts'

function empty() {
  const details = () => ({ propertyType: null, floor: null, hasElevator: null, parkingDistance: null })
  const address = () => ({ street: null, number: null, commune: null, region: null, additionalInfo: null })
  return {
    personalInfo: { name: null, email: null, phone: '56998765432', isCompany: false, companyName: null, companyRut: null },
    schedule: { date: null, time: null, isFlexible: false },
    origin: { address: address(), details: details() },
    destination: { address: address(), details: details() },
    taxDocument: null,
    items: [], pendingInventory: [], inventoryPhotos: [], inventoryCollectionDone: true,
    additionalServices: { disassembly: false, assembly: false, packing: false, unpacking: false, observations: '__pending__', photos: [] },
    intake: { stage: 'review', serviceAnswers: [] }, confirmed: false,
  }
}

test('inicio pide declaración libre en un solo mensaje, no seven-step interrogatorio', () => {
  assert.match(FREEFORM_START, /un solo mensaje/i)
  assert.match(FREEFORM_START, /ficha con variables/i)
  assert.doesNotMatch(FREEFORM_START, /1\/7/)
})
test('corrige ORIGEN + piso + metros sin tocar DESTINO', () => {
  const state = empty()
  const result = applyLabelEdits(state, 'ORIGEN: DEPARTAMENTO\nPISO SI APLICA: 5\nDISTANCIA DE LA ENTRADA/ESTACIONAMIENTO: 15\nASCENSOR ORIGEN: Sí')
  assert.deepEqual(result.errors, [])
  assert.equal(result.state.origin.details.propertyType, 'departamento')
  assert.equal(result.state.origin.details.floor, 5)
  assert.equal(result.state.origin.details.parkingDistance, 15)
  assert.equal(result.state.origin.details.hasElevator, true)
  assert.equal(result.state.destination.details.floor, null)
  assert.equal(state.origin.details.floor, null)
})
test('variable sin lado se rechaza cuando no hay origen/destino explícito', () => {
  const result = applyLabelEdits(empty(), 'PISO SI APLICA: 5')
  assert.match(result.errors.join(' '), /indica ORIGEN o DESTINO/)
  assert.equal(result.state.origin.details.floor, null)
})
test('formato de ficha coincide exactamente con el parser de etiquetas', () => {
  const a = empty()
  const formatted = formatIntakeReview(a)
  assert.match(formatted, /DISTANCIA ENTRADA\/ESTACIONAMIENTO ORIGEN:/)
  assert.match(formatted, /EMBALAJE: PENDIENTE/)
  assert.doesNotMatch(formatted, /Datos completos/)
  const result = applyLabelEdits(a, 'DISTANCIA ENTRADA/ESTACIONAMIENTO ORIGEN: 25 m')
  assert.equal(result.state.origin.details.parkingDistance, 25)
})
test('desarmado selectivo no fuerza embalaje ni armado', () => {
  const result = applyLabelEdits(empty(), 'DESARMADO: Sí, solo las camas')
  assert.deepEqual(result.errors, [])
  assert.equal(result.state.additionalServices.disassembly, true)
  assert.equal(result.state.additionalServices.packing, false)
  assert.deepEqual(result.state.intake.serviceAnswers, ['disassembly'])
  assert.ok(intakeMissing(result.state).includes('EMBALAJE'))
})
test('SERVICIOS NINGUNO resuelve las cuatro decisiones en un mensaje', () => {
  const result = applyLabelEdits(empty(), 'SERVICIOS: NINGUNO')
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.state.intake.serviceAnswers.sort(), ['assembly','disassembly','packing','unpacking'])
  assert.equal(result.state.additionalServices.observations, '')
  assert.ok(!intakeMissing(result.state).includes('EMBALAJE'))
})
test('inventario estructurado se destina a validación sin alterar estado antes de catálogo', () => {
  const result = applyLabelEdits(empty(), 'INVENTARIO: 2 camas y 1 refrigerador')
  assert.deepEqual(result.inventory, { mode: 'replace', description: '2 camas y 1 refrigerador' })
  assert.deepEqual(result.state.items, [])
})
test('bloque inventario con varias viñetas se recopila íntegro', () => {
  const result = applyLabelEdits(empty(), 'INVENTARIO:\n- 2 camas\n- 1 refrigerador')
  assert.deepEqual(result.errors, [])
  assert.match(result.inventory.description, /2 camas/)
  assert.match(result.inventory.description, /1 refrigerador/)
})
test('si hay un error de campo la ruta debe rechazar el bloque sin guardar parcialmente', () => {
  const processor = readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts', import.meta.url),'utf8')
  assert.match(processor, /if \(labels\.errors\.length\) \{[\s\S]*?return/)
  assert.deepEqual(applyLabelEdits(empty(), 'NOMBRE: Ana\nPISO ORIGEN SI APLICA: -9').changed, ['NOMBRE'])
})
test('no se puede confirmar con variables pendientes', () => {
  assert.equal(intakeCanConfirm(empty()), false)
  const s = markServiceAnswers(empty(), ['packing','disassembly','assembly','unpacking'])
  assert.equal(s.additionalServices.observations, '')
  assert.equal(intakeCanConfirm(s), false)
})
test('variables bien formadas reemplazan datos existentes, no agregan duplicados', () => {
  const a = applyLabelEdits(empty(), 'PISO DESTINO SI APLICA: 3\nASCENSOR DESTINO: NO')
  const b = applyLabelEdits(a.state, 'PISO DESTINO SI APLICA: 4\nASCENSOR DESTINO: SÍ')
  assert.equal(b.state.destination.details.floor, 4)
  assert.equal(b.state.destination.details.hasElevator, true)
  assert.equal(b.state.origin.details.floor, null)
})
test('un solo SERVICIOS: SOLO puede configurar los cuatro sin preguntas binarias', () => {
  const result = applyLabelEdits(empty(), 'SERVICIOS: solo desarmar dos camas y embalar vajilla')
  assert.deepEqual(result.errors, [])
  assert.equal(result.state.additionalServices.packing, true)
  assert.equal(result.state.additionalServices.disassembly, true)
  assert.equal(result.state.additionalServices.assembly, false)
  assert.equal(result.state.additionalServices.unpacking, false)
  assert.match(result.state.additionalServices.observations, /dos camas y embalar vajilla/)
})
test('un inventario completamente detallado puede pasar a confirmación sin siete pasos', () => {
  const s = empty()
  s.personalInfo.name = 'Clemente'
  s.personalInfo.email = 'cliente@example.com'
  s.taxDocument = 'boleta'
  s.schedule.date = '2026-11-10'
  s.schedule.time = '10:00'
  for (const side of [s.origin,s.destination]) {
    Object.assign(side.address, {street: 'Los Alerces', number: '100', commune:'Las Condes', region:'metropolitana'})
    Object.assign(side.details, {propertyType:'departamento',floor:5,hasElevator:true,parkingDistance:15})
  }
  s.items = [{catalogItemId:'real-id', quantity:2}]
  const complete = markServiceAnswers(s, ['packing','disassembly','assembly','unpacking'])
  assert.deepEqual(intakeMissing(complete), [])
  assert.equal(intakeCanConfirm(complete), true)
  assert.match(formatIntakeReview(complete, ['2 × Cama 2 Plazas']), /Datos completos/)
})
