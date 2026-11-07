const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

function loadTs(relativePath, dependencies = {}) {
  const filePath = path.join(root, relativePath)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText

  const module = { exports: {} }
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: (id) => {
        if (dependencies[id]) return dependencies[id]
        throw new Error(`Unexpected runtime import in ${relativePath}: ${id}`)
      },
    },
    { filename: filePath }
  )
  return module.exports
}

const prospectSource = loadTs('src/lib/prospectSource.ts')
const revenueBreakdown = loadTs('src/lib/revenueBreakdown.ts')
const analytics = loadTs('src/lib/adminAnalytics.ts', {
  './prospectSource': prospectSource,
  './revenueBreakdown': revenueBreakdown,
})

const rows = [
  { email: 'CLIENTE@EXAMPLE.COM ', source: 'web', status: 'converted' },
  { email: 'cliente@example.com', source: 'cliente_antiguo', status: 'new' },
  {
    email: 'cliente@example.com',
    source: 'cliente_antiguo',
    status: 'converted',
    lead_key: 'manual_customer:cliente@example.com',
    is_frequent: true,
  },
]

const identity = prospectSource.buildCustomerIdentityIndex(rows).get('cliente@example.com')
assert.equal(identity.origin, 'cliente_antiguo')
assert.equal(identity.isCustomer, true)
assert.equal(identity.isFrequent, true)
assert.equal(identity.hasManualOrigin, true)
assert.equal(prospectSource.resolveIncomingCustomerSource('web', identity), 'cliente_antiguo')

const manualWeb = prospectSource
  .buildCustomerIdentityIndex([
    { email: 'cliente@example.com', source: 'cliente_antiguo', status: 'new' },
    {
      email: 'cliente@example.com',
      source: 'web',
      status: 'converted',
      lead_key: 'manual_customer:cliente@example.com',
    },
  ])
  .get('cliente@example.com')
assert.equal(manualWeb.origin, 'web')
assert.equal(prospectSource.resolveIncomingCustomerSource('email_quote', manualWeb), 'web')
assert.equal(prospectSource.resolveIncomingCustomerSource('email_quote'), 'email_quote')

const customers = analytics.buildUnifiedCustomers(
  [
    {
      client_email: 'CLIENTE@example.com',
      client_name: 'Cliente',
      status: 'completed',
      scheduled_date: '2026-08-01',
      total_price: 100000,
      source: 'cliente_antiguo',
    },
    {
      client_email: 'cliente@example.com ',
      client_name: 'Cliente actualizado',
      status: 'completed',
      scheduled_date: '2026-08-10',
      total_price: 150000,
      source: 'cliente_antiguo',
    },
  ],
  rows
)

assert.equal(customers.length, 1)
assert.equal(customers[0].email, 'cliente@example.com')
assert.equal(customers[0].movesCount, 2)
assert.equal(customers[0].totalSpent, 250000)
assert.equal(customers[0].origin, 'cliente_antiguo')

const grouped = analytics.groupCustomersBySource([
  ...customers,
  { ...customers[0], email: 'nuevo@example.com', origin: 'web' },
])
assert.equal(grouped.find((item) => item.source === 'cliente_antiguo').count, 1)
assert.equal(grouped.find((item) => item.source === 'web').count, 1)

console.log('customer identity verification passed')
