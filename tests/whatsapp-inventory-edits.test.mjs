import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInventoryEdits, applyInventoryEdits } from '../src/lib/whatsapp/inventoryEdits.ts'

const catalog = [
  { id: 'frigo', name: 'Refrigerador', is_active: true },
  { id: 'sofa2', name: 'Sillón de 2 Cuerpos', is_active: true },
  { id: 'sofa3', name: 'Sillón de 3 Cuerpos', is_active: true },
  { id: 'rack', name: 'Rack Mediano', is_active: true },
]
const original = [{ catalogItemId: 'frigo', quantity: 1 }, { catalogItemId: 'rack', quantity: 1 }]

test('QUITAR refrigerador Y AGREGAR un sofá de 2 cuerpos: ambas operaciones', () => {
  const edits = parseInventoryEdits('quitar refrigerador y agregar un sofá de 2 cuerpos')
  assert.equal(edits.length, 2)
  const result = applyInventoryEdits(original, edits, catalog)
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [{ catalogItemId: 'rack', quantity: 1 }, { catalogItemId: 'sofa2', quantity: 1 }])
  assert.deepEqual(original, [{ catalogItemId: 'frigo', quantity: 1 }, { catalogItemId: 'rack', quantity: 1 }])
})

test('un comando de agregar no elige el sofá de 3 cuerpos en lugar del de 2', () => {
  const result = applyInventoryEdits(original, parseInventoryEdits('agregar un sofá de 2 cuerpos'), catalog)
  assert.equal(result.ok, true)
  assert.ok(result.items.some(x => x.catalogItemId === 'sofa2'))
  assert.ok(!result.items.some(x => x.catalogItemId === 'sofa3'))
})

test('si falla AGREGAR, QUITAR también se revierte', () => {
  const result = applyInventoryEdits(original, parseInventoryEdits('quitar refrigerador y agregar un dragón'), catalog)
  assert.equal(result.ok, false)
  assert.deepEqual(original, [{ catalogItemId: 'frigo', quantity: 1 }, { catalogItemId: 'rack', quantity: 1 }])
})

test('si falla QUITAR, AGREGAR tampoco se aplica', () => {
  const result = applyInventoryEdits(original, parseInventoryEdits('quitar cama King y agregar sofá de 2 cuerpos'), catalog)
  assert.equal(result.ok, false)
})

test('QUITAR simple funciona y no deja inventario vacío', () => {
  const edits = parseInventoryEdits('QUITAR refrigerador')
  const result = applyInventoryEdits(original, edits, catalog)
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [{ catalogItemId: 'rack', quantity: 1 }])
  const onlyFridge = [{ catalogItemId: 'frigo', quantity: 1 }]
  assert.equal(applyInventoryEdits(onlyFridge, edits, catalog).ok, false)
})

test('si hay dos sillones, QUITAR sofá sin tamaño es ambiguo', () => {
  const items = [{ catalogItemId: 'sofa2', quantity: 1 }, { catalogItemId: 'sofa3', quantity: 1 }]
  const result = applyInventoryEdits(items, parseInventoryEdits('quitar sofá'), catalog)
  assert.equal(result.ok, false)
})

test('al eliminar cantidad explícita, se conserva el resto', () => {
  const items = [{ catalogItemId: 'rack', quantity: 3 }]
  const result = applyInventoryEdits(items, parseInventoryEdits('quitar 2 rack mediano'), catalog)
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [{ catalogItemId: 'rack', quantity: 1 }])
})

test('no interpreta charla ordinaria como edición', () => {
  assert.equal(parseInventoryEdits('Me gustaría cotizar una mudanza'), null)
  assert.equal(parseInventoryEdits('CONFIRMAR'), null)
})

const catalogCamas = [
  { id: 'frigo', name: 'Refrigerador', is_active: true },
  { id: 'cama2', name: 'Cama 2 Plazas', is_active: true },
  { id: 'cama1', name: 'Cama 1 Plaza', is_active: true },
  { id: 'cama15', name: 'Cama 1.5 Plazas', is_active: true },
]

test('reproduce caso real: QUITAR refrigerador y AÑADIR otra cama matrimonial', () => {
  const edits = parseInventoryEdits('quitar refrigerador y añadir otra cama matrimonial')
  assert.equal(edits.length, 2)
  const initial = [{ catalogItemId: 'frigo', quantity: 1 }, { catalogItemId: 'cama2', quantity: 1 }, { catalogItemId: 'cama1', quantity: 2 }]
  const result = applyInventoryEdits(initial, edits, catalogCamas)
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [{ catalogItemId: 'cama2', quantity: 2 }, { catalogItemId: 'cama1', quantity: 2 }])
  assert.deepEqual(initial[0], { catalogItemId: 'frigo', quantity: 1 }, 'no modifica la cotización original')
})

test('cama matrimonial, cama doble y cama individual mantienen su tamaño', () => {
  for (const description of ['otra cama matrimonial', 'una cama de matrimonio', 'cama doble', 'camas matrimoniales']) {
    const edits = parseInventoryEdits(`agregar ${description}`)
    const result = applyInventoryEdits([{ catalogItemId: 'frigo', quantity: 1 }], edits, catalogCamas)
    assert.equal(result.ok, true, description)
    assert.ok(result.items.some(x => x.catalogItemId === 'cama2'), description)
  }
  const solo = applyInventoryEdits([{ catalogItemId: 'frigo', quantity: 1 }], parseInventoryEdits('añadir una cama individual'), catalogCamas)
  assert.equal(solo.ok, true)
  assert.ok(solo.items.some(x => x.catalogItemId === 'cama1'))
})

test('si la cama matrimonial no está en el catálogo, NO quita el refrigerador', () => {
  const initial = [{ catalogItemId: 'frigo', quantity: 1 }]
  const result = applyInventoryEdits(initial, parseInventoryEdits('quitar refrigerador y añadir otra cama matrimonial'), catalogCamas.filter(x => x.id !== 'cama2'))
  assert.equal(result.ok, false)
  assert.deepEqual(initial, [{ catalogItemId: 'frigo', quantity: 1 }])
})
