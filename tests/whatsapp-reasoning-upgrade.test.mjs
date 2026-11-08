import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStructuredResponseWithUsage } from '../src/lib/ai/openai.ts'

const options = {
  instructions: 'Return value',
  input: [{ role: 'user', content: 'hola' }],
  schemaName: 'test',
  schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
  maxOutputTokens: 6000,
}
const stored = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: process.env.OPENAI_MODEL, OPENAI_REASONING_EFFORT: process.env.OPENAI_REASONING_EFFORT, OPENAI_INPUT_COST_PER_MILLION: process.env.OPENAI_INPUT_COST_PER_MILLION, OPENAI_OUTPUT_COST_PER_MILLION: process.env.OPENAI_OUTPUT_COST_PER_MILLION }
async function inspectRequest(env, verify) {
  const oldFetch = globalThis.fetch
  for (const key of Object.keys(stored)) delete process.env[key]
  process.env.OPENAI_API_KEY = 'dummy-test-key'
  Object.assign(process.env, env)
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    verify(body)
    return { ok: true, status: 200, json: async () => ({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: '{"value":"ok"}' }] }],
      usage: { input_tokens: 1000, output_tokens: 2000 },
    }) }
  }
  try { return await createStructuredResponseWithUsage(options) }
  finally {
    globalThis.fetch = oldFetch
    for (const [key, value] of Object.entries(stored)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('el modelo por defecto sube a Terra y razonamiento medio', async () => {
  const result = await inspectRequest({}, body => {
    assert.equal(body.model, 'gpt-6.1-terra')
    assert.equal(body.reasoning.effort, 'medium')
    assert.equal(body.max_output_tokens, 6000)
    assert.equal(body.store, false)
    assert.equal(body.text.format.type, 'json_schema')
  })
  assert.equal(result.usage.model, 'gpt-6.1-terra')
  assert.ok(Math.abs(result.usage.estimatedCostUsd - 0.011) < 0.000001)
})

test('Vercel puede configurar un esfuerzo high para ensayos controlados', async () => {
  await inspectRequest({ OPENAI_REASONING_EFFORT: 'high' }, body => {
    assert.equal(body.model, 'gpt-6.1-terra')
    assert.equal(body.reasoning.effort, 'high')
  })
})

test('un esfuerzo no reconocido no rompe el parser ni envía parámetros inválidos', async () => {
  await inspectRequest({ OPENAI_REASONING_EFFORT: 'super-duper' }, body => {
    assert.equal(body.reasoning.effort, 'medium')
  })
})

test('ambas rutas de análisis WhatsApp utilizan medium y reserva suficiente de tokens', () => {
  const content = readFileSync(new URL('../src/lib/ai/whatsappQuoteAssistant.ts', import.meta.url), 'utf8')
  assert.equal((content.match(/reasoningEffort:\s*'medium'/g) || []).length, 2)
  assert.match(content, /maxOutputTokens:\s*6000/)
  assert.match(content, /maxOutputTokens:\s*4000/)
  assert.doesNotMatch(content, /reasoningEffort:\s*'none'/)
})
