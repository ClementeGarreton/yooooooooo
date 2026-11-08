import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { botCommand, decideBotAction, WHATSAPP_WELCOME } from '../src/lib/whatsapp/botRouter.ts'
import { applyLabelEdits, formatIntakeNextPrompt, intakeMissing, nextIntakePending, FREEFORM_START } from '../src/lib/whatsapp/freeformIntake.ts'

function empty() {
  const details = () => ({ propertyType:null, floor:null, hasElevator:null, parkingDistance:null })
  const address = () => ({ street:null, number:null, commune:null, region:null, additionalInfo:null })
  return {
    personalInfo:{ name:null,email:null,phone:'56998765432',isCompany:false,companyName:null,companyRut:null },
    schedule:{ date:null,time:null,isFlexible:false },
    origin:{address:address(), details:details()}, destination:{address:address(), details:details()},
    taxDocument:null,items:[],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:true,
    additionalServices:{disassembly:false,assembly:false,packing:false,unpacking:false,observations:'__pending__',photos:[]},
    intake:{stage:'review', serviceAnswers:[]},confirmed:false,
  }
}

test('el menú definitivo de Tommy tiene tres opciones numeradas', () => {
  for(const option of ['1) Cotizar','2) Seguimiento de un servicio','3) Proveedores, solicitudes especiales o hablar con un ejecutivo']) assert.ok(WHATSAPP_WELCOME.includes(option))
  for(const [input,cmd] of [['reclamo','RECLAMO'],['Seguimiento de cotización','SEGUIMIENTO'],['trabajo en curso','TRABAJO'],['2','SEGUIMIENTO'],['3','ASESOR']]) {
    assert.equal(botCommand(input),cmd)
    assert.equal(decideBotAction(input,{greeted_at:'2026-11-07',mode:'idle',last_activity_at:'2026-11-07'},Date.now()),'human')
  }
})

test('agrupación binaria realmente pregunta las 6 juntas', () => {
  const prompt = formatIntakeNextPrompt(empty())
  for(const option of ['ASCENSOR ORIGEN','ASCENSOR DESTINO','EMBALAJE','DESARMADO','ARMADO','DESEMBALAJE']) {
    assert.match(prompt,new RegExp(`${option}: SÍ/NO`))
  }
  assert.match(prompt,/NO A TODO/)
  assert.doesNotMatch(prompt,/NOMBRE: PENDIENTE/)
  assert.equal(nextIntakePending(empty()).label,'CONFIRMACIONES')
})

test('NO A TODO desmarca exactamente las 6 decisiones sin suponer otros datos', () => {
  const result = applyLabelEdits(empty(),'No a todo')
  assert.equal(result.recognized,true)
  assert.deepEqual(result.errors,[])
  assert.equal(result.state.origin.details.hasElevator,false)
  assert.equal(result.state.destination.details.hasElevator,false)
  assert.equal(result.state.origin.details.floor,null)
  assert.equal(result.state.destination.details.parkingDistance,null)
  for(const key of ['packing','disassembly','assembly','unpacking']) assert.equal(result.state.additionalServices[key],false)
  assert.deepEqual(result.state.intake.serviceAnswers.sort(),['assembly','disassembly','packing','unpacking'])
  assert.ok(!intakeMissing(result.state).includes('EMBALAJE'))
  assert.equal(nextIntakePending(result.state).label,'DATOS PENDIENTES')
})

test('acepta seis respuestas con etiqueta en un único mensaje, conservando detalles de los muebles', () => {
  const lines=['ASCENSOR ORIGEN: NO','ASCENSOR DESTINO: SÍ','EMBALAJE: NO','DESARMADO: SÍ, sillón y mesa','ARMADO: SÍ, sillón y mesa','DESEMBALAJE: NO']
  const result = applyLabelEdits(empty(),lines.join('\n'))
  assert.deepEqual(result.errors,[])
  assert.equal(result.state.origin.details.hasElevator,false)
  assert.equal(result.state.destination.details.hasElevator,true)
  assert.equal(result.state.additionalServices.disassembly,true)
  assert.equal(result.state.additionalServices.packing,false)
  assert.match(result.state.additionalServices.observations,/sillón y mesa/)
  assert.equal(nextIntakePending(result.state).label,'DATOS PENDIENTES')
})

test('el flujo nuevo envía solo el siguiente pendiente, no ficha inmensa', () => {
  assert.match(FREEFORM_START,/un solo mensaje/)
  const source=readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts',import.meta.url),'utf8')
  assert.match(source,/sendFreeformReview\(session, conversationId, to, availability, 'next'\)/)
  assert.match(source,/reasonFromCommand\(botCommand\(message\.text\)\)/)
})
