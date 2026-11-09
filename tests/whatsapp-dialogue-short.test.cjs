const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')
function loadPure(relative) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',relative),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  const module = {exports:{}}
  vm.runInNewContext(code,{module,exports:module.exports,require:()=>({}),console,structuredClone},
    {filename:relative})
  return module.exports
}
const flow = loadPure('src/lib/whatsapp/quoteConversation.ts')
const engine = loadPure('src/lib/whatsapp/rawNlpQuote.ts')
const cron = loadPure('src/lib/whatsapp/idleReminder.ts')
const address = (label, details={propertyType:'departamento',floor:5,hasElevator:true,parkingDistance:15})=>({
  address:{street:label,number:'342',commune:'Las Condes',region:'Metropolitana',additionalInfo:null}, details
})
const state = () => ({
  intake:{stage:'review',serviceAnswers:[],quoteFlowVersion:2,quoteFlowStep:'questions',answeredQuoteFields:['isFlexible','packing','disassembly','assembly']},
  personalInfo:{name:'Clemente',email:'correo@ejemplo.cl',rut:'20.677.123-2',phone:'569',isCompany:false},taxDocument:'boleta',
  schedule:{date:'2026-11-16',time:'10:00',isFlexible:false},
  origin:address('Sebastián Piñera'),destination:address('Camino el Alba',{propertyType:'casa',floor:0,hasElevator:false,parkingDistance:0}),
  stops:[],items:[{catalogItemId:'a',quantity:2}],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:true,
  additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'',photos:[],extraHelpers:0,fridgeDisassembly:false,priority:false,stairsCarry:false},confirmed:false,
})
assert.match(flow.QUOTE_FIRST_MESSAGE,/1\. Nombre, Email y Rut/)
assert.match(flow.QUOTE_FIRST_MESSAGE,/4\. Fecha y hora/)
assert.doesNotMatch(flow.QUOTE_FIRST_MESSAGE,/5\. ¿Hay ascensor/)
assert.match(flow.QUOTE_SECOND_MESSAGE,/5\. ¿Hay ascensor/)
assert.match(flow.QUOTE_SECOND_MESSAGE,/8\. ¿Necesitas que desarmemos/)
assert.doesNotMatch(flow.QUOTE_FIRST_MESSAGE+flow.QUOTE_SECOND_MESSAGE,/Respuesta:/)
assert.ok(flow.QUOTE_FIRST_MESSAGE.length < 650 && flow.QUOTE_SECOND_MESSAGE.length < 650)
assert.equal(flow.missingQuoteQuestions(state()).length,0,'No pedir servicios optativos como paradas')
const totallyEmpty=state();totallyEmpty.personalInfo.name=null;totallyEmpty.personalInfo.email=null;totallyEmpty.personalInfo.rut=null;totallyEmpty.taxDocument=null;totallyEmpty.schedule.date=null;totallyEmpty.schedule.time=null;totallyEmpty.intake.answeredQuoteFields=[];totallyEmpty.origin.address.street=null;totallyEmpty.origin.details.floor=null;totallyEmpty.origin.details.hasElevator=null;totallyEmpty.destination.address.street=null;totallyEmpty.destination.details.floor=null;totallyEmpty.destination.details.hasElevator=null;totallyEmpty.items=[]
assert.ok(flow.missingQuoteQuestions(totallyEmpty).length <= 7,'Máximo siete grupos, no 23 repreguntas')
const pending=state(); pending.origin.details.hasElevator=null;pending.personalInfo.email=null;pending.destination.details.parkingDistance=null
const questions=flow.missingQuoteQuestions(pending)
assert.equal(questions.length,3,'Repregunta agrupada por tema, no por variable')
const pendingMessage=flow.missingQuoteMessage(pending)
assert.doesNotMatch(pendingMessage,/Respuesta:|paradas intermedias|prioritario|ayudantes adicionales/i)
assert.match(pendingMessage,/ascensor/)
assert.match(pendingMessage,/correo/)
assert.match(pendingMessage,/caminar/)
assert.doesNotMatch(pendingMessage,/boleta|fecha/i)
assert.match(flow.paraphraseQuoteQuestion('¿Hay ascensor en destino?'),/departamento, piso 5, con ascensor/)
assert.match(flow.paraphraseQuoteQuestion('¿A cuántos metros estaciona?'),/camión/)
assert.equal(flow.isQuoteConfusion('No a la primera, y la segunda pregunta no se entiende'),true)
assert.equal(flow.isQuoteConfusion('No entendí'),true)
const contextual=state();contextual.destination.details.hasElevator=null
const understood=flow.applyContextualYesNo(contextual,'No a la primera, la segunda pregunta no se entiende', ['¿Hay ascensor en destino?','¿A cuántos metros estaciona?'])
assert.equal(understood.destination.details.hasElevator,false,'Negación contextual a primera pregunta')
assert.equal(flow.isPhotoFinish('NO'),true)
assert.equal(flow.isInventoryConfirm('confirmar'),true)
assert.match(flow.inventoryMessage('• 1 × cama'),/Quitar: lista/)
// Regresión: «Indica ascensor y piso 5» no es un mueble.
const wrong=state(); wrong.pendingInventory=[{sourceLabel:'Indica ascensor y piso 5, sin especificar',quantity:1,question:'',suggestions:[]}]
assert.equal(flow.missingQuoteQuestions(wrong).length,0)
const patch={name:null,email:null,rut:null,taxDocument:null,companyName:null,companyRut:null,date:null,time:null,isFlexible:null,
  originStreet:null,originNumber:null,originCommune:null,originRegion:null,originAdditionalInfo:null,
  destinationStreet:null,destinationNumber:null,destinationCommune:null,destinationRegion:null,destinationAdditionalInfo:null,
  originPropertyType:null,destinationPropertyType:'casa',originFloor:null,destinationFloor:0,
  originElevator:null,destinationElevator:null,originParkingMeters:null,destinationParkingMeters:null,
  stopsSpecified:null,stops:[],inventoryAction:'none',inventory:[],unresolved:['Indica ascensor y piso 5'],
  disassembly:null,assembly:null,packing:null,unpacking:null,extraHelpers:null,fridgeDisassembly:null,priority:null,stairsCarry:null,
  observations:null,stairsAnswer:null,stairsDetail:null,carryAnswer:null,carryDetail:null,packingAnswer:null,packingDetail:null}
const fixed=engine.mergeRawQuote(wrong,patch)
assert.equal(fixed.pendingInventory.length,0)
assert.equal(fixed.destination.details.hasElevator,false,'Casa piso 0 sin transporte por ascensor')
const consumer=state();consumer.taxDocument=null;consumer.personalInfo.rut=null
const withRut=engine.mergeRawQuote(consumer,{...patch,destinationPropertyType:null,destinationFloor:null,rut:'20.677.123-2'})
assert.equal(withRut.taxDocument,'boleta','Implicatura boleta cliente particular')
const t0=Date.parse('2026-11-09T12:00:00.000Z')
const at=new Date(t0).toISOString()
assert.equal(cron.shouldSendIdleReminder({now:t0+9*60e3,lastActivityAt:at,alreadySentFor:null}),false)
assert.equal(cron.shouldSendIdleReminder({now:t0+10*60e3,lastActivityAt:at,alreadySentFor:null}),true)
assert.equal(cron.shouldSendIdleReminder({now:t0+15*60e3,lastActivityAt:at,alreadySentFor:at}),false)
assert.equal(cron.shouldSendIdleReminder({now:t0+24*3600e3,lastActivityAt:at,alreadySentFor:null}),false)
console.log('OK: dos mensajes breves, implicaturas, dudas reformuladas, máximo 3 aclaraciones en caso probado, sin falso artículo, inventario, recordatorio idempotente.')
