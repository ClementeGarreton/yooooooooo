/**
 * Pruebas puras del flujo nuevo. Se pueden ejecutar con node directamente
 * cuando TypeScript está instalado, sin credenciales de WhatsApp/Supabase.
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
function loadPure(relative) {
  const source = fs.readFileSync(path.join(__dirname,'..',relative),'utf8')
  const code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  const module = {exports:{}}
  vm.runInNewContext(code,{module,exports:module.exports,require,console,structuredClone},{filename:relative})
  return module.exports
}
const flow = loadPure('src/lib/whatsapp/quoteConversation.ts')
const inv = loadPure('src/lib/whatsapp/inventoryEdits.ts')
function full() {
  const addr=(street)=>({address:{street,number:'123',commune:'Las Condes',region:'Metropolitana',additionalInfo:null},details:{propertyType:'departamento',floor:3,hasElevator:true,parkingDistance:20}})
  return {
    intake:{stage:'review',serviceAnswers:[],quoteFlowVersion:2,quoteFlowStep:'questions',answeredQuoteFields:['isFlexible','packing','assembly','disassembly','stops','unpacking','extraHelpers','fridgeDisassembly','priority','stairsCarry']},
    personalInfo:{name:'Pedro',email:'p@ejemplo.cl',rut:'12.345.678-9',phone:'569',isCompany:false},taxDocument:'boleta',
    schedule:{date:'2026-12-01',time:'10:00',isFlexible:false},origin:addr('Uno'),destination:addr('Dos'),
    items:[{catalogItemId:'c1',quantity:1}],pendingInventory:[],inventoryPhotos:[],
    additionalServices:{packing:false,assembly:false,disassembly:false,unpacking:false,observations:'',photos:[]},confirmed:false,
  }
}
const s=full()
assert.equal(flow.missingQuoteMessage(s),null,'Con todos los datos no hay repregunta')
const extrasMissing=full(); extrasMissing.intake.answeredQuoteFields=['isFlexible','packing','assembly','disassembly']
assert.equal(flow.missingQuoteQuestions(extrasMissing).length,0,'Los servicios opcionales no se convierten en confirmaciones obligatorias')
assert.match(flow.QUOTE_FIRST_MESSAGE,/1\. Nombre, Email y Rut/)
assert.match(flow.QUOTE_SECOND_MESSAGE,/8\. ¿Necesitas que desarmemos y armemos muebles/)
assert.doesNotMatch(flow.QUOTE_FIRST_MESSAGE,/Puedes enviar fotos al reconocedor/)
assert.match(flow.QUOTE_PHOTO_MESSAGE,/«NO»/) // Solo compatibilidad; ya no se envía
assert.match(flow.inventoryMessage('• 2 × Sillas'),/• 2 × Sillas/)
assert.match(flow.inventoryMessage('• 2 × Sillas'),/confirmar/)
const pending=full()
pending.destination.details.parkingDistance=null
pending.personalInfo.email=null
const text=flow.missingQuoteMessage(pending)
assert.equal(flow.missingQuoteQuestions(pending).length,2)
assert.equal((text.match(/^[0-9]+\. /gm)||[]).length,2)
assert.doesNotMatch(text,/Respuesta:/)
assert.doesNotMatch(text,/origen/)
assert.match(text,/correo/)
assert.match(text,/destino/)
assert.equal(flow.quoteFlowStep(s),'questions')
assert.equal(flow.quoteFlowStep(flow.withQuoteFlowStep(s,'photos')),'inventory')
assert.equal(flow.quoteFlowStep(flow.withQuoteFlowStep(s,'inventory')),'inventory')
assert.equal(flow.isPhotoFinish('NO'),true)
assert.equal(flow.isPhotoFinish('LISTO'),true)
assert.equal(flow.isInventoryConfirm('confirmar'),true)
assert.equal(flow.isInventoryConfirm('confirmo'),false)
const copied=`1. Nombre, Email y Rut. | Respuesta: Pedro, pedro@correo.cl, 12.345.678-9\n\n2. Direcciones | Respuesta:\nCalle A 10 a Calle B 20\n\n3. Artículos | Respuesta: 2 sillas`
const normalized=flow.normalizeQuoteCustomerReply(copied)
assert.match(normalized,/Pregunta 1: Pedro/)
assert.match(normalized,/Pregunta 2: Calle A 10 a Calle B 20/)
assert.match(normalized,/Pregunta 3: 2 sillas/)
assert.doesNotMatch(normalized,/Nombre, Email y Rut/)
assert.equal(flow.normalizeQuoteCustomerReply('Mudo una cama y 3 cajas'),'Mudo una cama y 3 cajas')
const edits=inv.parseInventoryEdits('Quitar: una silla, 2 cajas\nAgregar: una mesa')
assert.equal(edits.length,3)
assert.equal(edits[0].action,'remove')
assert.equal(edits[1].quantity,2)
assert.equal(edits[2].action,'add')
const applied=inv.applyInventoryEdits(
  [{catalogItemId:'a',quantity:3},{catalogItemId:'b',quantity:3}],edits,
  [{id:'a',name:'silla'},{id:'b',name:'cajas'},{id:'c',name:'mesa'}]
)
assert.equal(applied.ok,true)
assert.deepEqual(Array.from(applied.items.map(i=>[i.catalogItemId,i.quantity])),[['a',2],['b',1],['c',1]])
console.log('OK: dos mensajes de preguntas, faltantes agrupados, fotos opcionales sin pantalla, inventario y confirmación.')
