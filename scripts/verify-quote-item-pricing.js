/**
 * Verifica la corrección de precios de embalaje de una cotización ya creada.
 *
 * Lo que se protege acá es que una corrección de precio NO pueda tocar el resto de
 * la receta (nombre, cantidad, volumen) ni terminar aplicada al artículo equivocado,
 * y que el costo por línea siga la misma fórmula que el cotizador.
 *
 * Uso: node scripts/verify-quote-item-pricing.js
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

/** Carga un módulo TS resolviendo a mano los imports '@/lib/...' que necesita. */
function loadModule(relPath, deps = {}) {
  const filePath = path.join(root, relPath)
  const source = fs.readFileSync(filePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText

  const module = { exports: {} }
  const require_ = (id) => {
    if (deps[id]) return deps[id]
    throw new Error(`Dependencia no provista en el test: ${id}`)
  }
  vm.runInNewContext(
    output,
    { module, exports: module.exports, require: require_, console },
    { filename: filePath }
  )
  return module.exports
}

const catalog = loadModule('src/lib/packagingCatalog.ts')
const pricing = loadModule('src/lib/quoteItemPricing.ts', {
  '@/lib/packagingCatalog': catalog,
})

const { applyItemPackagingPrices, describePriceChanges } = pricing

/**
 * Los módulos corren en otro realm de V8, así que sus arreglos y objetos no
 * comparten prototipo con los de este archivo y `deepEqual` (estricto) los daría
 * por distintos aunque el contenido sea idéntico. Se comparan por valor.
 */
const plain = (value) => JSON.parse(JSON.stringify(value))
const { groupItemsByPackaging, itemPackagingCost, packagingLabel, packagingSubtotal } = catalog

// --- Costo por línea: misma fórmula que quoteStore (precio/m³ x volumen x cantidad).
assert.equal(
  itemPackagingCost({ name: 'Alfombra', quantity: 2, volume: 0.15, packaging: { type: 'standard', pricePerUnit: 6000 } }),
  1800
)
assert.equal(itemPackagingCost({ name: 'Cama', quantity: 1, volume: 2 }), 0)
assert.equal(
  itemPackagingCost({ name: 'X', quantity: 1, volume: 1, packaging: { type: 'none', pricePerUnit: 9999 } }),
  0
)

// --- Etiquetas legibles (los datos guardan el id, no el nombre).
assert.equal(packagingLabel('basic'), 'Embalaje Básico')
assert.equal(packagingLabel('none'), 'Sin embalaje')
assert.equal(packagingLabel(undefined), 'Sin embalaje')
assert.equal(packagingLabel('lo_que_sea'), 'lo_que_sea')

// --- Agrupación por tipo: es la respuesta a "¿qué artículos van en cada embalaje?".
const items = [
  { name: 'Alfombra', quantity: 2, volume: 0.15, packaging: { type: 'standard', pricePerUnit: 6000 } },
  { name: 'Mesa', quantity: 1, volume: 0.5, packaging: { type: 'basic', pricePerUnit: 4000 } },
  { name: 'Sillón', quantity: 1, volume: 3, packaging: { type: 'basic', pricePerUnit: 4000 } },
  { name: 'Cama', quantity: 1, volume: 2 },
]
const groups = groupItemsByPackaging(items)
assert.deepEqual(
  plain(groups.map((g) => g.id)),
  ['basic', 'standard', 'none'],
  'el orden sigue el catálogo y "sin embalaje" queda al final'
)
assert.equal(groups[0].items.length, 2)
assert.equal(groups[0].totalVolume, 3.5)
assert.equal(groups[0].totalCost, 14000)
assert.equal(groups[2].totalCost, 0)
assert.equal(packagingSubtotal(items), 1800 + 2000 + 12000)

// --- Aplicación de precios: solo se toma el embalaje del payload.
const stored = [
  { name: 'Alfombra', quantity: 2, volume: 0.3, packaging: { type: 'standard', pricePerUnit: 6000 } },
  { name: 'Cama', quantity: 1, volume: 2 },
]

const ok = applyItemPackagingPrices(stored, [
  { name: 'Alfombra', packaging: { type: 'standard', pricePerUnit: 9000 } },
  { name: 'Cama', packaging: { type: 'basic', pricePerUnit: 5000 } },
])
assert.equal(ok.error, undefined)
assert.deepEqual(plain(ok.items), [
  { name: 'Alfombra', quantity: 2, volume: 0.3, packaging: { type: 'standard', pricePerUnit: 9000 } },
  { name: 'Cama', quantity: 1, volume: 2, packaging: { type: 'basic', pricePerUnit: 5000 } },
])
assert.notEqual(ok.items, stored)
assert.deepEqual(
  plain(stored[0].packaging),
  { type: 'standard', pricePerUnit: 6000 },
  'el arreglo guardado no se muta'
)

// Nombre, cantidad y volumen del payload se ignoran: manda lo guardado.
const untouched = applyItemPackagingPrices(stored, [
  { name: 'Alfombra', quantity: 99, volume: 99, extra: 'x', packaging: { type: 'basic', pricePerUnit: 1000 } },
  { name: 'Cama', packaging: null },
])
assert.equal(untouched.items[0].quantity, 2)
assert.equal(untouched.items[0].volume, 0.3)
assert.equal(untouched.items[0].extra, undefined)
assert.equal(untouched.items[1].packaging, undefined, 'packaging null quita el embalaje')

// Campos ajenos del registro guardado se conservan tal cual.
const withExtras = applyItemPackagingPrices(
  [{ name: 'Alfombra', quantity: 2, volume: 0.3, nota: 'ojo', packaging: { type: 'basic', pricePerUnit: 4000 } }],
  [{ name: 'Alfombra', packaging: { type: 'basic', pricePerUnit: 4500 } }]
)
assert.equal(withExtras.items[0].nota, 'ojo')

// --- Validaciones: lo que debe rebotar con 400.
const rechaza = (incoming, stored_ = stored) => {
  const result = applyItemPackagingPrices(stored_, incoming)
  assert.ok(result.error, `debería rechazar: ${JSON.stringify(incoming)}`)
  assert.equal(result.items, undefined)
  return result.error
}

rechaza([{ name: 'Alfombra', packaging: { type: 'standard', pricePerUnit: 1000 } }]) // largo distinto
rechaza([
  { name: 'Otro Nombre', packaging: { type: 'standard', pricePerUnit: 1000 } },
  { name: 'Cama', packaging: null },
]) // desalineado
rechaza([
  { name: 'Alfombra', packaging: { type: 'standard', pricePerUnit: -1 } },
  { name: 'Cama', packaging: null },
]) // negativo
rechaza([
  { name: 'Alfombra', packaging: { type: 'standard', pricePerUnit: '' } },
  { name: 'Cama', packaging: null },
]) // vacío
rechaza([
  { name: 'Alfombra', packaging: { type: 'standard' } },
  { name: 'Cama', packaging: null },
]) // sin precio
rechaza([
  { name: 'Alfombra', packaging: { type: 'standard', pricePerUnit: 'abc' } },
  { name: 'Cama', packaging: null },
]) // no numérico
rechaza([
  { name: 'Alfombra', packaging: { type: 'inventado', pricePerUnit: 1000 } },
  { name: 'Cama', packaging: null },
]) // tipo desconocido
assert.ok(applyItemPackagingPrices(null, []).error, 'sin lista guardada no hay nada que actualizar')
assert.ok(applyItemPackagingPrices(stored, 'no-es-lista').error)

// Cero es válido: es "embalaje bonificado", no un valor inválido.
const gratis = applyItemPackagingPrices(stored, [
  { name: 'Alfombra', packaging: { type: 'standard', pricePerUnit: 0 } },
  { name: 'Cama', packaging: null },
])
assert.equal(gratis.error, undefined)
assert.equal(gratis.items[0].packaging.pricePerUnit, 0)

// Los decimales se redondean a peso.
const redondeo = applyItemPackagingPrices(stored, [
  { name: 'Alfombra', packaging: { type: 'standard', pricePerUnit: 6000.6 } },
  { name: 'Cama', packaging: null },
])
assert.equal(redondeo.items[0].packaging.pricePerUnit, 6001)

// --- Resumen para el log de actividad.
const changes = describePriceChanges(stored, ok.items)
assert.equal(changes.length, 2)
assert.match(changes[0], /Alfombra: Embalaje Estándar \$6\.000\/m³ → Embalaje Estándar \$9\.000\/m³/)
assert.match(changes[1], /Cama: sin embalaje → Embalaje Básico \$5\.000\/m³/)
assert.deepEqual(plain(describePriceChanges(stored, stored)), [], 'sin cambios no se registra nada')

console.log('OK verify-quote-item-pricing: todas las comprobaciones pasaron')
