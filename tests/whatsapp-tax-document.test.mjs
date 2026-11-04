import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTaxDocumentChoice } from '../src/lib/whatsapp/taxDocument.ts'
import { readFileSync } from 'node:fs'

test('se acepta la respuesta natural de la captura, sin repetir la pregunta', () => {
  assert.equal(parseTaxDocumentChoice('Como soy persona natural solo necesito boleta'), 'boleta')
  assert.equal(parseTaxDocumentChoice('boleta'), 'boleta')
  assert.equal(parseTaxDocumentChoice('Boleta por favor.'), 'boleta')
  assert.equal(parseTaxDocumentChoice('quiero una factura'), 'factura')
})

test('no infiere una elección desde una negación o pregunta ambigua', () => {
  assert.equal(parseTaxDocumentChoice('No quiero factura, solo boleta'), 'boleta')
  assert.equal(parseTaxDocumentChoice('No quiero boleta, prefiero factura'), 'factura')
  assert.equal(parseTaxDocumentChoice('¿Boleta o factura?'), null)
  assert.equal(parseTaxDocumentChoice('No quiero boleta'), null)
  assert.equal(parseTaxDocumentChoice('Me gustaría cotizar'), null)
})

test('el webhook incorpora parser tributario en respuesta pendiente y en datos conjuntos', () => {
  const file = readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts', import.meta.url), 'utf8')
  assert.match(file, /const choice = parseTaxDocumentChoice\(message\.text\)/)
  assert.match(file, /if \(section === 1 && !state\.taxDocument && state\.personalInfo\.name && state\.personalInfo\.email\)/)
})
