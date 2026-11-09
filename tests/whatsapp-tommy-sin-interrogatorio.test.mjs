import test from 'node:test'
import assert from 'node:assert/strict'
import { isTommyAccessReply, applyAccessForm } from '../src/lib/whatsapp/tommyAccess.ts'
import { applyTommyAnswers, normalizeTommyNumberedReply, tommyMissing, tommyPendingMessage } from '../src/lib/whatsapp/tommyFlow.ts'
import { readFileSync } from 'node:fs'
function session({ firstRound = false } = {}) {
  const address = () => ({ street: firstRound ? null : 'Calle A', number: firstRound ? null : '1', commune: firstRound ? null : 'Santiago', region: 'RM' })
  const details = () => ({ propertyType: null, floor: null, hasElevator: null, parkingDistance: null })
  return {
    personalInfo: { name: null, email: null, phone: null, isCompany: false },
    schedule: { date: firstRound ? null : '2026-11-16', time: null, isFlexible: false },
    origin: { address: address(), details: details() }, destination: { address: address(), details: details() },
    items: firstRound ? [] : [{ catalogItemId: 'escritorio', quantity: 2 }], pendingInventory: [], inventoryPhotos: [], inventoryCollectionDone: true,
    additionalServices: { packing: false, observations: '', photos: [], disassembly: false, assembly: false, unpacking: false },
    intake: { stage: 'review', serviceAnswers: [], tommyVersion: 1, tommyAnswers: [], tommyDetails: {} }, confirmed: false,
  }
}
test('la primera ronda tiene seis preguntas, no cuatro subpreguntas nuevas', () => {
  const pending = tommyPendingMessage(session({ firstRound: true }))
  assert.equal((pending.match(/\| Respuesta:/g) || []).length, 6)
  assert.doesNotMatch(pending, /4\.1\)/)
  assert.doesNotMatch(pending, /17 campos/)
})
test('50 mts, 50mts y 50 metros se conservan y NO se vuelven a preguntar', () => {
  for (const value of ['50 mts', '50mts', '50 metros', '50m']) {
    const state = applyTommyAnswers(session(), `5) Distancia de carga: ${value}\n6) Embalaje: No`)
    assert.equal(state.intake.tommyDetails.acarreo, value)
    assert.deepEqual(tommyMissing(state), ['escaleras'])
    assert.doesNotMatch(tommyPendingMessage(state), /Acarreo: metros/)
  }
})
test('respuestas cortas por número NO necesitan copiar el mensaje', () => {
  for (const text of ['1 Sí, 2 No, 3 No, 4 Sí', '4.1 sí; 4.2 no; 4.3 no; 4.4 sí', '4.1 si\n4.2 no\n4.3 no\n4.4 si']) {
    const start = session()
    assert.equal(isTommyAccessReply(text, start), true, text)
    const result = applyAccessForm(start, text)
    assert.equal(result.intake.tommyAccess.originElevator, true)
    assert.equal(result.intake.tommyAccess.destinationElevator, false)
    assert.equal(result.intake.tommyAccess.originStairs, false)
    assert.equal(result.intake.tommyAccess.destinationStairs, true)
    const pending = tommyPendingMessage(result)
    assert.doesNotMatch(pending, /4\.1\)/)
    assert.match(pending, /4\.5\)/)
    assert.match(pending, /4\.7\)/)
  }
})
test('solo se pregunta qué parte del inventario va por escalera, sin repetirlo entero', () => {
  let state = applyAccessForm(session(), '4.1 sí; 4.2 no; 4.3 no; 4.4 sí')
  const prompt = tommyPendingMessage(state)
  assert.match(prompt, /TODOS o solo cuáles/)
  state = applyAccessForm(state, '4.5) ¿Qué muebles irán por escalera? | Respuesta: TODOS\n4.7) ¿Cuántos pisos por escalera en destino? | Respuesta: 1')
  assert.equal(state.intake.tommyAccess.stairsItems, 'TODOS')
  assert.equal(state.intake.tommyAccess.destinationFloors, 1)
  assert.deepEqual(tommyMissing(state), ['acarreo', 'embalaje'])
})
test('contestar 5 y 6 sin copiar el formulario respeta los campos anteriores', () => {
  const input = normalizeTommyNumberedReply('5: 50mts\n6: no')
  const result = applyTommyAnswers(session(), input)
  assert.equal(result.intake.tommyDetails.acarreo, '50mts')
  assert.equal(result.intake.tommyDetails.embalaje, 'no')
  assert.equal(result.intake.tommyAnswers.includes('escaleras'), false)
})
test('las subpreguntas 4.x nunca se reescriben como el grupo 4', () => {
  assert.equal(normalizeTommyNumberedReply('4.1 sí\n4.2 no'), '4.1 sí\n4.2 no')
  const src = readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts', import.meta.url), 'utf8')
  assert.match(src, /isTommyAccessReply\(text, nextState\)/)
  assert.match(src, /generatePreliminaryWhatsAppQuote/)
})
