const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/whatsapp/quoteConversation.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText
const moduleStub = { exports: {} }
vm.runInNewContext(code, { module: moduleStub, exports: moduleStub.exports, require, structuredClone, console })
const flow = moduleStub.exports
const questionList = flow.QUOTE_INITIAL_QUESTIONS
const initial = { intake: { initialQuestionBatch: 0, quoteFlowStep: 'questions', quoteFlowVersion: 2 } }
assert.equal(flow.initialQuestionBatch(initial), 0)
assert.equal(flow.QUOTE_FIRST_MESSAGE.match(/^\d+\./gm)?.length, 4)
assert.deepEqual(Array.from(flow.QUOTE_FIRST_MESSAGE.matchAll(/^\d+\./gm)).map(m => m[0]), ['1.', '2.', '3.', '4.'])
assert.deepEqual(Array.from(flow.QUOTE_SECOND_MESSAGE.matchAll(/^\d+\./gm)).map(m => m[0]), ['5.', '6.', '7.', '8.'])
assert.doesNotMatch(flow.QUOTE_FIRST_MESSAGE + flow.QUOTE_SECOND_MESSAGE, /Respuesta:/)
const firstSent = { intake: { ...initial.intake, initialQuestionBatch: 1, lastQuestionContext: questionList.slice(0, 4) } }
assert.equal(flow.initialQuestionBatch(firstSent), 1)
assert.equal(flow.advanceInitialQuestionBatch(initial), initial, 'Antes de la respuesta, no avanzar')
const afterFirstReply = flow.advanceInitialQuestionBatch(firstSent)
assert.equal(flow.initialQuestionBatch(afterFirstReply), 2, 'Tras contestar 1-4, pasar a 5-8')
assert.equal(JSON.stringify(afterFirstReply.intake.lastQuestionContext), JSON.stringify(questionList.slice(4)))
const afterSecondReply = flow.advanceInitialQuestionBatch(afterFirstReply)
assert.equal(flow.initialQuestionBatch(afterSecondReply), 3, 'Tras contestar 5-8, habilitar faltantes')
assert.equal(flow.initialQuestionBatch({ intake: { quoteFlowVersion: 2 } }), 3, 'Sesiones antiguas no reciben los bloques de nuevo')
assert.equal(flow.advanceInitialQuestionBatch(afterSecondReply), afterSecondReply, 'No retroceder tras ambos mensajes')
// Contrato de integración: no dos sendAndLog seguidos al iniciar; el segundo
// bloque se envía únicamente después del análisis NLP o al retomar la etapa.
const processor = fs.readFileSync(path.join(root, 'src/lib/whatsapp/incomingProcessor.ts'), 'utf8')
const sendFn = processor.slice(processor.indexOf('async function sendApprovedQuestions('), processor.indexOf('/** GPT reformula'))
assert.match(sendFn, /if \(initial\)\s*\{[\s\S]*?initialQuestionBatch = 1[\s\S]*?sendAndLog\(conversationId, to, QUOTE_FIRST_MESSAGE\)[\s\S]*?return/)
const initialBranch = sendFn.slice(sendFn.indexOf('if (initial) {'), sendFn.indexOf('const batch = initialQuestionBatch'))
assert.doesNotMatch(initialBranch, /sendAndLog\(conversationId, to, QUOTE_SECOND_MESSAGE\)/)
const replyFn = processor.slice(processor.indexOf('async function processApprovedQuoteTurn('), processor.indexOf('/** Flujo simple de Tommy'))
assert.match(replyFn, /parseRawCustomerQuote\(session\.state, normalized, context\)/)
assert.match(replyFn, /advanceInitialQuestionBatch\(merged\)/)
assert.match(replyFn, /if \(movedToSecondBatch\)\s*\{[\s\S]*?sendAndLog\(conversationId, to, QUOTE_SECOND_MESSAGE\)[\s\S]*?return/)
assert.ok(replyFn.indexOf('sendAndLog(conversationId, to, QUOTE_SECOND_MESSAGE)') < replyFn.indexOf('pendingWithoutInventory(session.state)'), 'No repreguntar faltantes antes de la segunda respuesta')
console.log('OK: bloque 1 -> respuesta NLP -> bloque 2 -> respuesta NLP -> faltantes; reanudación segura.')
