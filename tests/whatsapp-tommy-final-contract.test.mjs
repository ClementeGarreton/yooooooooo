import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { botCommand, decideBotAction, WHATSAPP_WELCOME } from '../src/lib/whatsapp/botRouter.ts'
import {
  TOMMY_QUOTE_START, TOMMY_FOLLOWUP, TOMMY_EXECUTIVE,
  tommyMissing, tommyPendingMessage, applyTommyAnswers, tommyCaseSummary, isTommyFormReply, isOnlyTommyServiceAnswers,
} from '../src/lib/whatsapp/tommyFlow.ts'

function state() {
  const address = () => ({street:null,number:null,commune:null,region:null,additionalInfo:null})
  const details = () => ({propertyType:null,floor:null,hasElevator:null,parkingDistance:null})
  return {
    personalInfo:{ name:null,email:null,phone:'56987654321',isCompany:false,companyName:null,companyRut:null },
    schedule:{ date:null,time:null,isFlexible:false },
    origin:{address:address(),details:details()}, destination:{address:address(),details:details()},
    taxDocument:null,items:[],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:false,
    additionalServices:{ packing:false,disassembly:false,assembly:false,unpacking:false,observations:'__pending__',photos:[] },
    intake:{ stage:'describe',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{} }, confirmed:false,
  }
}
const fill = state => {
  state.origin.address = {street:'Av. Apoquindo',number:'111',commune:'Las Condes',region:'metropolitana',additionalInfo:null}
  state.destination.address = {street:'Av. Grecia',number:'222',commune:'Ñuñoa',region:'metropolitana',additionalInfo:null}
  state.schedule.date='2026-11-15'
  state.items=[{catalogItemId:'cama-1',quantity:2}]
  state.inventoryCollectionDone=true
  return state
}

test('exactamente tres opciones y rutas numéricas, sin botones de salida',()=>{
  assert.equal((WHATSAPP_WELCOME.match(/\d\) /g)||[]).length, 3)
  assert.doesNotMatch(WHATSAPP_WELCOME,/SALIR/i)
  assert.equal(botCommand('1'),'COTIZAR')
  assert.equal(botCommand('2'),'SEGUIMIENTO')
  assert.equal(botCommand('3'),'ASESOR')
  assert.equal(decideBotAction('1', {mode:'idle',greeted_at:'2026-11-07T00:00:00.000Z',last_activity_at:new Date().toISOString()}, Date.now()),'start_quote')
})

test('textos de seguimiento y ejecutivo son los acordados, sin 17 campos',()=>{
  assert.match(TOMMY_FOLLOWUP,/Correo con el que hiciste la reserva/)
  assert.match(TOMMY_FOLLOWUP,/Número de teléfono/)
  assert.match(TOMMY_FOLLOWUP,/Qué necesitas/)
  assert.match(TOMMY_EXECUTIVE,/Breve detalle de lo que necesitas/)
  assert.doesNotMatch(TOMMY_EXECUTIVE,/ascensor|piso origen|inventario/i)
})

test('cotización pide únicamente seis grupos, con instrucción de copiar',()=>{
  assert.equal((TOMMY_QUOTE_START.match(/\d\) /g) || []).length,6)
  for(const word of ['Direcciones de origen y destino','Lista de artículos','Fecha','Acceso por ascensor o escalera','Distancia de carga','Embalaje']) assert.match(TOMMY_QUOTE_START,new RegExp(word))
  assert.match(TOMMY_QUOTE_START,/Copia este mensaje/)
  assert.doesNotMatch(TOMMY_QUOTE_START,/boleta|RUT|razón social|documento tributario|17 campos/i)
})

test('ningún dato del cliente: faltan los seis, no 17 preguntas',()=>{
  const missing=tommyMissing(state())
  assert.deepEqual(missing,['direcciones','articulos','fecha','escaleras','acarreo','embalaje'])
  const text=tommyPendingMessage(state())
  assert.equal((text.match(/^-/gm) || []).length,6)
  assert.match(text,/solo nos falta/)
  assert.doesNotMatch(text,/nombre completo|boleta|RUT/i)
})

test('tres campos positivos no se suponen respondidos por defecto false',()=>{
  const s=fill(state())
  assert.deepEqual(tommyMissing(s),['escaleras','acarreo','embalaje'])
  assert.equal(s.additionalServices.packing,false)
  assert.match(tommyPendingMessage(s),/Embalaje/)
})

test('NO A TODO responde solo las tres preguntas pertinentes',()=>{
  const s=applyTommyAnswers(state(),'NO A TODO')
  assert.deepEqual(s.intake.tommyAnswers.sort(),['acarreo','embalaje','escaleras'])
  assert.deepEqual(tommyMissing(s).slice(0,3),['direcciones','articulos','fecha'])
  assert.equal(s.origin.details.hasElevator,null)
  assert.equal(s.origin.details.parkingDistance,null)
  assert.equal(s.additionalServices.packing,false)
})

test('un bloque de tres respuestas negativas se conserva completo',()=>{
  const msg='4) Escaleras: No\n5) Distancia de carga: No\n6) Embalaje: No'
  const s=applyTommyAnswers(fill(state()),msg)
  assert.deepEqual(tommyMissing(s),[])
  assert.equal(tommyPendingMessage(s),null)
})

test('un SÍ en escaleras necesita artículos, pisos y lado',()=>{
  const s=applyTommyAnswers(fill(state()),'4) Escaleras: Sí\n5) Distancia de carga: No\n6) Embalaje: No')
  assert.deepEqual(tommyMissing(s),['escaleras'])
  assert.equal((tommyPendingMessage(s).match(/^-/gm) || []).length,1)
  const s2=applyTommyAnswers(s,'4) Escaleras: Cama al destino hasta el 3er piso')
  assert.deepEqual(tommyMissing(s2),[])
})

test('un SÍ en embalaje sin artículos requiere precisión',()=>{
  const s=applyTommyAnswers(fill(state()),'4) Escaleras: No\n5) Distancia de carga: Sí\n6) Embalaje: Sí')
  assert.deepEqual(tommyMissing(s),['acarreo','embalaje'])
  const s2=applyTommyAnswers(s,'6) Embalaje: Sí, solo vajilla')
  assert.deepEqual(tommyMissing(s2),['acarreo'])
  const s3=applyTommyAnswers(s2,'5) Distancia de carga: Sí, en destino')
  assert.deepEqual(tommyMissing(s3),[])
  assert.equal(s2.additionalServices.packing,true)
  assert.match(s2.additionalServices.observations,/vajilla/)
})

test('copiar las preguntas sin responderlas no marca respuestas',()=>{
  const s=applyTommyAnswers(fill(state()),'4) Escaleras: indícanos qué artículos\n5) Distancia de carga: ¿hay que caminar?\n6) Embalaje: ¿necesitas que embalemos algo?')
  assert.deepEqual(tommyMissing(s),['escaleras','acarreo','embalaje'])
})

test('solo se piden los campos pendientes, no los ya entregados',()=>{
  const s=fill(state()); s.origin.address.number=null
  const completed=applyTommyAnswers(s,'4) Escaleras: No\n5) Distancia de carga: No\n6) Embalaje: No')
  assert.deepEqual(tommyMissing(completed),['direcciones'])
  const prompt=tommyPendingMessage(completed)
  assert.equal((prompt.match(/^-/gm) || []).length,1)
  assert.doesNotMatch(prompt,/^- Lista de artículos/m)
})

test('el resumen de secretaría mantiene los antecedentes sin inventar tarifas',()=>{
  const s=applyTommyAnswers(fill(state()),'4) Escaleras: No\n5) Distancia de carga: No\n6) Embalaje: No')
  const info=tommyCaseSummary(s,null)
  assert.match(info,/No calculable automáticamente/)
  assert.match(info,/REVISIÓN HUMANA/)
  assert.match(info,/Av. Apoquindo/)
  assert.match(tommyCaseSummary(s,123456),/\$123.456/)
})

test('las seis respuestas no generan PDF ni inventan datos tributarios',()=>{
  const src=readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts',import.meta.url),'utf8')
  const start=src.indexOf('async function finishTommyQuote(')
  const end=src.indexOf('async function processTommyQuoteTurn(',start)
  const code=src.slice(start,end)
  assert.match(code,/calculateSessionQuote/)
  assert.match(code,/createHandoffRequest/)
  assert.match(code,/tommyPendingMessage/)
  assert.doesNotMatch(code,/generateQuoteFromSession|sendWhatsAppDocument|uploadPdf/)
})

test('el formulario numerado no se interpreta como etiqueta técnica desconocida',()=>{
  const reply='1) Direcciones de origen y destino: Apoquindo 111 Las Condes / Grecia 222 Ñuñoa\n2) Lista de artículos: dos camas\n4) Escaleras: No\n5) Distancia de carga: No\n6) Embalaje: No'
  assert.equal(isTommyFormReply(reply),true)
  const source=readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts',import.meta.url),'utf8')
  assert.match(source,/const labels = \(differential\.copiedForm \|\| isTommyFormReply\(text\)\)/)
  assert.equal(isTommyFormReply('NOMBRE: Camila'),false)
})

test('respuestas del bloque de escaleras/acarreo/embalaje se procesan sin IA',()=>{
  assert.equal(isOnlyTommyServiceAnswers('4) Escaleras: No\n5) Distancia de carga: No\n6) Embalaje: No'),true)
  assert.equal(isOnlyTommyServiceAnswers('4) Escaleras: No\nOrigen: Apoquindo 123'),false)
  const source=readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts',import.meta.url),'utf8')
  assert.match(source,/if \(isOnlyTommyServiceAnswers\(text\)\)/)
})

test('si hay escaleras exige qué artículos, pisos y lado; no acepta respuestas ambiguas',()=>{
  const s=fill(state())
  const missing=applyTommyAnswers(s,'4) Escaleras: Sí, al destino 3 pisos')
  assert.ok(tommyMissing(missing).includes('escaleras'))
  const complete=applyTommyAnswers(s,'4) Escaleras: Sí, una cama al destino 3 pisos')
  assert.ok(!tommyMissing(complete).includes('escaleras'))
})
