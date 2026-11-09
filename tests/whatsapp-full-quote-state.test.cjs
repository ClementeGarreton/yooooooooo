/* Validación sin API, DB ni node_modules: pipeline de merge y exhaustividad. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
function load(relative) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',relative),'utf8'), {
    compilerOptions: { target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, esModuleInterop:true },
  }).outputText
  const module = { exports:{} }
  vm.runInNewContext(code, {module,exports:module.exports,structuredClone,Date,console,process,Buffer,
    require: name => name === 'crypto' ? require('crypto') : {},
  }, {filename:relative})
  return module.exports
}
const {createEmptyQuoteState} = load('src/lib/quoteSession.ts')
const {rawQuoteGaps,mergeRawQuote,nextShortQuestion,QUOTE_INTAKE_QUESTIONS} = load('src/lib/whatsapp/rawNlpQuote.ts')
const base = () => createEmptyQuoteState('56912345678')
const data = () => ({
 name:'Carmen Pérez',email:'carmen@example.com',taxDocument:'boleta',companyName:null,companyRut:null,
 date:'2026-11-16',time:'10:00',isFlexible:false,
 originStreet:'Sebastián Piñera',originNumber:'342',originCommune:'Las Condes',originRegion:'Metropolitana',originAdditionalInfo:'depto 31',
 destinationStreet:'Camino El Alba',destinationNumber:'9184',destinationCommune:'Las Condes',destinationRegion:'Metropolitana',destinationAdditionalInfo:null,
 originPropertyType:'departamento',destinationPropertyType:'casa',originFloor:5,destinationFloor:0,
 originElevator:false,destinationElevator:false,originParkingMeters:12,destinationParkingMeters:0,
 stopsSpecified:false,stops:[],inventoryAction:'replace',inventory:[{catalogItemId:'refri',quantity:2,source:'2 refrigeradores'}],unresolved:[],
 disassembly:false,assembly:false,packing:true,unpacking:false,extraHelpers:0,
 fridgeDisassembly:false,priority:false,stairsCarry:true,observations:'Embalaje de 2 escritorios',
 stairsAnswer:true,stairsDetail:'Origen, 5 pisos',carryAnswer:true,carryDetail:'12 m en origen',
 packingAnswer:true,packingDetail:'2 escritorios',
})
test('el mensaje inicial solicita los campos faltantes del cotizador web agrupados',()=>{
  const text = QUOTE_INTAKE_QUESTIONS
  assert.match(text,/ascensor/)
  assert.match(text,/camión/)
  assert.match(text,/parada intermedia/)
  assert.match(text,/ayudantes adicionales/)
  assert.match(text,/boleta o factura/)
  assert.ok(rawQuoteGaps(base()).length >= 20)
})
test('una respuesta completa llena quote state y no produce nuevas preguntas',()=>{
  const s = mergeRawQuote(base(),data())
  assert.equal(s.origin.details.floor,5)
  assert.equal(s.origin.details.hasElevator,false)
  assert.equal(s.origin.details.parkingDistance,12)
  assert.equal(s.additionalServices.packing,true)
  assert.equal(s.additionalServices.extraHelpers,0)
  assert.equal(s.additionalServices.stairsCarry,true)
  assert.equal(s.stops.length,0)
  assert.equal(s.items[0].quantity,2)
  assert.deepEqual([...rawQuoteGaps(s)],[])
})
test('la repregunta enumera todos los pendientes en un solo mensaje sin repetir los respondidos',()=>{
  const partial=data()
  partial.destinationElevator=null; partial.destinationParkingMeters=null; partial.priority=null
  const s=mergeRawQuote(base(),partial)
  const gaps=[...rawQuoteGaps(s)]
  assert.deepEqual(gaps,['destinationElevator','destinationParkingMeters','priority'])
  const q=nextShortQuestion(s)
  assert.match(q,/ascensor en destino/)
  assert.match(q,/metros entre camión y acceso en destino/)
  assert.match(q,/servicio prioritario/)
  assert.doesNotMatch(q,/ascensor en origen/)
  assert.doesNotMatch(q,/tu nombre/)
})
test('se diferencia 0 y NO de dato no respondido, sin borrar respuestas previas',()=>{
  const old=mergeRawQuote(base(),data())
  const edit=data(); edit.originFloor=0; edit.originElevator=true; edit.originParkingMeters=null
  edit.inventoryAction='none';edit.inventory=[]
  const next=mergeRawQuote(old,edit)
  assert.equal(next.origin.details.floor,0)
  assert.equal(next.origin.details.hasElevator,true)
  assert.equal(next.origin.details.parkingDistance,12)
  assert.equal(next.items.length,1)
  assert.deepEqual([...rawQuoteGaps(next)],[])
})
test('factura exige razón social y RUT; cero paradas explícitas no exige nuevas',()=>{
  const input=data();input.taxDocument='factura';input.companyName=null;input.companyRut=null
  const s=mergeRawQuote(base(),input)
  assert.deepEqual([...rawQuoteGaps(s)],['companyName','companyRut'])
  assert.equal(s.stops.length,0)
})
