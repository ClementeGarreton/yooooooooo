import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseClosestInventoryCandidate, isInventoryAddition } from '../src/lib/whatsapp/inventoryResolution.ts'

const candidates = (...labels) => labels.map((label, index) => ({ catalogItemId: String(index + 1), label, confidence: 0.72 }))

test('sofá de tres cuerpos se asocia a tres cuerpos, sin cuestionario de módulos', () => {
  const selected = chooseClosestInventoryCandidate('sofa de 3 cuerpos', candidates('Módulo sofá 150 cm', 'Sillón de 3 cuerpos'))
  assert.equal(selected.label, 'Sillón de 3 cuerpos')
})
test('rack sin medidas se aproxima al mediano, sin tres opciones', () => {
  const selected = chooseClosestInventoryCandidate('rack para tv', candidates('Rack pequeño', 'Rack grande', 'Rack mediano'))
  assert.equal(selected.label, 'Rack mediano')
})
test('una medida explícita prevalece sobre la variante estándar', () => {
  const selected = chooseClosestInventoryCandidate('sofá de 2 cuerpos', candidates('Sofá de 3 cuerpos', 'Sofá de 2 cuerpos'))
  assert.equal(selected.label, 'Sofá de 2 cuerpos')
})
test('no inventa un ID si no hay candidatos', () => {
  assert.equal(chooseClosestInventoryCandidate('mueble único', []), null)
})
test('incorporar un mueble en sección de extras se interpreta como inventario', () => {
  assert.equal(isInventoryAddition('Agrega también una cajonera de tres cajones'), true)
  assert.equal(isInventoryAddition('Además llevo dos cajas'), true)
  assert.equal(isInventoryAddition('Quiero agregar embalaje'), false)
  assert.equal(isInventoryAddition('ninguno'), false)
})

test('cama matrimonial se resuelve como cama 2 plazas, nunca una plaza distinta', () => {
  const selected = chooseClosestInventoryCandidate('cama matrimonial', candidates('Cama 1 Plaza', 'Cama 1.5 Plazas', 'Cama 2 Plazas'))
  assert.equal(selected?.label, 'Cama 2 Plazas')
  assert.equal(chooseClosestInventoryCandidate('cama matrimonial', candidates('Cama 1 Plaza')), null)
})
