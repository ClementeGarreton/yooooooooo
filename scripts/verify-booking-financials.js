const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const helperPath = path.join(root, 'src/lib/revenueBreakdown.ts')

function loadHelper() {
  const source = fs.readFileSync(helperPath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: helperPath,
  }).outputText

  const module = { exports: {} }
  vm.runInNewContext(output, { module, exports: module.exports }, { filename: helperPath })
  return module.exports
}

const {
  actualPaidAmount,
  paidAmount,
  pendingAmount,
  servicePrice,
  summarizeBookings,
  summarizeBookingsByOrigin,
} = loadHelper()

const historicHalf = {
  original_price: 100000,
  total_price: 100000,
  payment_type: 'mitad',
  payment_status: 'approved',
  status: 'confirmed',
}
assert.equal(servicePrice(historicHalf), 100000)
assert.equal(actualPaidAmount(historicHalf), 50000)
assert.equal(pendingAmount(historicHalf), 50000)

const adjustedInField = {
  ...historicHalf,
  adjusted_price: 135000,
  amount_paid: 50000,
}
assert.equal(servicePrice(adjustedInField), 135000)
assert.equal(actualPaidAmount(adjustedInField), 50000)
assert.equal(pendingAmount(adjustedInField), 85000)

const explicitZero = { ...adjustedInField, amount_paid: 0 }
assert.equal(actualPaidAmount(explicitZero), 0)
assert.equal(pendingAmount(explicitZero), 135000)

const paidInFull = {
  ...adjustedInField,
  payment_type: 'completo',
  amount_paid: 135000,
}
assert.equal(pendingAmount(paidInFull), 0)

const cancelledAfterPayment = { ...adjustedInField, status: 'cancelled' }
assert.equal(actualPaidAmount(cancelledAfterPayment), 50000)
assert.equal(paidAmount(cancelledAfterPayment), 0)
assert.equal(summarizeBookings([cancelledAfterPayment]).paid, 0)

const summary = summarizeBookings([adjustedInField])
assert.equal(summary.booked, 135000)
assert.equal(summary.paid, 50000)
assert.equal(summary.pending, 85000)

const [webRevenue, legacyRevenue] = summarizeBookingsByOrigin([
  { ...adjustedInField, source: 'web' },
  { ...paidInFull, source: 'cliente_antiguo' },
])
assert.equal(webRevenue.source, 'web')
assert.equal(webRevenue.paid, 50000)
assert.equal(legacyRevenue.source, 'cliente_antiguo')
assert.equal(legacyRevenue.paid, 135000)

console.log('booking financial verification passed')
