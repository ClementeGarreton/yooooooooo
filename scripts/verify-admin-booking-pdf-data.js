const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const helperPath = path.join(root, 'src/lib/adminBookingQuoteData.ts')

function loadHelper() {
  const source = fs.readFileSync(helperPath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: helperPath,
  }).outputText

  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    require: (id) => {
      throw new Error(`Unexpected runtime import in adminBookingQuoteData test: ${id}`)
    },
  }

  vm.runInNewContext(output, sandbox, { filename: helperPath })
  return module.exports
}

const { bookingToAdminQuoteData, mergeBookingQuoteDetails } = loadHelper()

const booking = {
  id: 'booking-1',
  quote_id: 'Q-123',
  client_name: 'Cliente Test',
  client_email: 'cliente@example.com',
  client_phone: '+56911111111',
  scheduled_date: '2026-07-01',
  scheduled_time: '09:30',
  total_price: 150000,
  origin_address: 'Origen 123',
  destination_address: 'Destino 456',
}

const prospect = {
  quote_id: 'Q-123',
  converted_booking_id: 'booking-1',
  email: 'cliente@example.com',
  scheduled_date: '2026-07-01',
  scheduled_time: '09:30',
  is_flexible: true,
  recommended_vehicle: 'Furgon Mediano',
  total_volume: 3,
  total_weight: 80,
  total_distance: 12.4,
  items_summary: [
    { name: 'Caja mediana', quantity: 3, volume: 1.5 },
    { name: 'Sofa', quantity: 1, volume: 1.5 },
  ],
  additional_services: {
    disassembly: true,
    assembly: false,
    packing: true,
    unpacking: false,
    observations: 'Retirar por conserjeria',
    extraHelpers: 2,
    requiredCrew: 2,
    totalCrew: 4,
  },
}

const legacyCustomer = {
  email: 'cliente@example.com',
  source: 'cliente_antiguo',
  status: 'converted',
  lead_key: 'manual_customer:cliente@example.com',
}

const [enriched] = mergeBookingQuoteDetails([booking], [prospect, legacyCustomer])
const pdfData = bookingToAdminQuoteData(enriched)

assert.equal(pdfData.name, 'Cliente Test')
assert.equal(pdfData.recommendedVehicle, 'Furgon Mediano')
assert.equal(pdfData.totalVolume, 3)
assert.equal(pdfData.totalWeight, 80)
assert.equal(pdfData.totalDistance, 12.4)
assert.equal(pdfData.isFlexible, true)
assert.equal(enriched.source, 'cliente_antiguo')

const [reclassifiedAsWeb] = mergeBookingQuoteDetails(
  [booking],
  [
    { ...prospect, source: 'cliente_antiguo' },
    { ...legacyCustomer, source: 'web' },
  ]
)
assert.equal(reclassifiedAsWeb.source, 'web')
assert.deepEqual(pdfData.additionalServices, prospect.additional_services)
assert.equal(pdfData.additionalServices.extraHelpers, 2)
assert.equal(pdfData.additionalServices.totalCrew, 4)

assert.equal(pdfData.items.length, 2)
assert.equal(pdfData.items[0].name, 'Caja mediana')
assert.equal(pdfData.items[0].quantity, 3)
assert.equal(pdfData.items[0].volume, 0.5)
assert.equal(pdfData.items[1].name, 'Sofa')
assert.equal(pdfData.items[1].quantity, 1)
assert.equal(pdfData.items[1].volume, 1.5)

const totalRenderedVolume = pdfData.items.reduce(
  (sum, item) => sum + item.volume * item.quantity,
  0
)
assert.equal(totalRenderedVolume, 3)

console.log('admin booking PDF data verification passed')
