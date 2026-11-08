import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tommyMissing, applyTommyAnswers } from '../src/lib/whatsapp/tommyFlow.ts'
import { applyAccessForm } from '../src/lib/whatsapp/tommyAccess.ts'
const incoming = readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts',import.meta.url), 'utf8')
const engine = readFileSync(new URL('../src/lib/serverQuoteEngine.ts',import.meta.url), 'utf8')
function state() {
 const addr = (street, number) => ({street,number,commune:'Las Condes',region:'RM',additionalInfo:null})
 const details = () => ({propertyType:null,floor:null,hasElevator:null,parkingDistance:null})
 return {personalInfo:{name:null,email:null,phone:'56912345678',isCompany:false,companyName:null,companyRut:null},
  schedule:{date:'2026-11-16',time:null,isFlexible:false},origin:{address:addr('Sebastián Piñera','342'),details:details()},
  destination:{address:addr('Camino El Alba','9184'),details:details()},
  items:[{catalogItemId:'escritorio',quantity:2}],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:true,
  additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'',photos:[]},confirmed:false,
  intake:{stage:'review',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{}}}
}
test('respuestas explícitas en un formulario de seis grupos completan datos sin nombre ni email',()=> {
 let s=state()
 const q=['4) Escaleras: No','5) Distancia de carga: No','6) Embalaje: Sí, los 2 escritorios'].join('\n')
 s=applyTommyAnswers(s,q)
 assert.deepEqual(tommyMissing(s),[])
 assert.equal(s.personalInfo.name,null)
 assert.equal(s.personalInfo.email,null)
 assert.equal(s.schedule.time,null)
})
test('las subpreguntas 4.x terminan sin volver a solicitar los artículos iniciales',()=> {
 let s=state()
 s=applyTommyAnswers(s,'5) Distancia de carga: no\n6) Embalaje: sí, los dos escritorios')
 const form=[
 '4.1) ¿Hay ascensor utilizable en origen? | Respuesta: sí',
 '4.2) ¿Hay ascensor utilizable en destino? | Respuesta: no',
 '4.3) ¿Hay escaleras en origen? | Respuesta: no',
 '4.4) ¿Hay escaleras en destino? | Respuesta: sí',
 '4.5) ¿Qué muebles por escaleras? | Respuesta: todos los muebles',
 '4.7) ¿Cuántos pisos por escalera en destino? | Respuesta: 1',
 ].join('\n')
 s=applyAccessForm(s,form)
 assert.deepEqual(tommyMissing(s),[])
 assert.match(s.intake.tommyDetails.escaleras,/Pisos por escalera destino: 1/)
})
test('no se consulta handoff_requests al cerrar la cotización',()=>{
 const start=incoming.indexOf('async function finishTommyQuote(')
 const end=incoming.indexOf('async function processTommyQuoteTurn(',start)
 const finish=incoming.slice(start,end)
 assert.match(finish,/generatePreliminaryWhatsAppQuote/)
 assert.doesNotMatch(finish,/createHandoffRequest|handoff_requests/)
 const catchStart=incoming.indexOf('Falló interpretación de IA; conservamos respuestas:')
 const catchEnd=incoming.indexOf('nextState = applyTommyAnswers(nextState, text)',catchStart)
 assert.ok(catchStart>0 && catchEnd>catchStart)
 assert.doesNotMatch(incoming.slice(catchStart,catchEnd),/createHandoffRequest/)
})
test('PDF estimativo funciona sin correo ni nombre y reutiliza el bucket existente',()=>{
 const prelim=engine.slice(engine.indexOf('export async function generatePreliminaryWhatsAppQuote('))
 assert.match(prelim,/calculateSessionQuote/)
 assert.match(prelim,/generateQuotePdfBuffer/)
 assert.match(prelim,/storage\.from\('bookings'\)/)
 assert.match(prelim,/status: 'quoted'/)
 assert.doesNotMatch(prelim,/upsertProspect\(|createHandoffRequest|name\s*\|\|\s*!email/)
 assert.match(engine,/Nombre:.*No informado/)
 assert.match(engine,/Hora:.*Por confirmar/)
})
