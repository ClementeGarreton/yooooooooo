import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyLabelEdits, formatIntakeNextPrompt, nextIntakePending, intakeMissing, inferSinglePendingEdit, ambiguousGroupedReply } from '../src/lib/whatsapp/freeformIntake.ts'

function session() {
  const address = () => ({street:null,number:null,commune:null,region:null,additionalInfo:null})
  const details = () => ({propertyType:null,floor:null,hasElevator:null,parkingDistance:null})
  return {
    personalInfo:{name:'Usuario de prueba',email:'test@example.org',phone:'56912345678',isCompany:false},
    schedule:{date:'2026-11-16',time:'10:00',isFlexible:false},
    origin:{address:address(),details:details()},
    destination:{address:address(),details:details()},
    taxDocument:'boleta',items:[],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:true,
    additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'',photos:[]},
    intake:{stage:'review',serviceAnswers:['packing','disassembly','assembly','unpacking']},confirmed:false,
  }
}

test('tras seis sí/no, agrupa TODOS los datos restantes sin 17 turnos de chat',()=>{
 const s=session()
 s.origin.details.hasElevator=true; s.destination.details.hasElevator=false
 s.origin.address.street='Calle Origen';s.origin.address.number='342'
 s.destination.address.street='Calle Destino';s.destination.address.number='9184'
 const prompt=formatIntakeNextPrompt(s)
 for (const term of ['*Origen:*','*Destino:*','*Inventario:*','comuna','piso','camión']) assert.ok(prompt.toLowerCase().includes(term.toLowerCase()))
 assert.equal(nextIntakePending(s).label,'DATOS PENDIENTES')
 assert.ok(prompt.length<900)
 assert.doesNotMatch(prompt,/Pendiente: COMUNA ORIGEN/)
 assert.doesNotMatch(prompt,/FICHA INTERPRETADA/)
})

test('el bot no regresa a una pregunta por cada dato tras una corrección individual',()=>{
 const initial=session();initial.origin.details.hasElevator=false;initial.destination.details.hasElevator=false
 const edited=applyLabelEdits(initial,'COMUNA ORIGEN: Las Condes')
 assert.deepEqual(edited.errors,[])
 assert.equal(edited.state.origin.address.region,'metropolitana')
 const prompt=formatIntakeNextPrompt(edited.state)
 assert.match(prompt,/Origen:/)
 assert.match(prompt,/Destino:/)
 const origen = prompt.split('\n').find((line)=>line.includes('*Origen:*')) || ''
 assert.ok(!origen.includes('región'))
})

test('relato con ORIGEN/DESTINO y varios atributos pasa al parser multi-campo',()=>{
 const result=applyLabelEdits(session(),'Origen: departamento en Las Condes, piso 5, camión a 15 metros\nDestino: casa en Las Condes, piso 0, camión a 0 metros')
 assert.equal(result.recognized,false)
 assert.equal(result.changed.length,0)
 assert.deepEqual(result.errors,[])
})

test('no asigna a un lugar dudoso respuestas de una palabra',()=>{
 const s=session();s.origin.details.hasElevator=false;s.destination.details.hasElevator=false
 assert.equal(inferSinglePendingEdit(s,'Las Condes'),null)
 assert.equal(inferSinglePendingEdit(s,'5'),null)
 assert.equal(inferSinglePendingEdit(s,'RM'),null)
})

test('nombre, correo y opciones sólo se solicitan si faltan',()=>{
 const s=session();s.origin.details.hasElevator=false;s.destination.details.hasElevator=false
 const next=formatIntakeNextPrompt(s)
 assert.doesNotMatch(next,/• \*Datos:\*/)
 assert.ok(intakeMissing(s).includes('INVENTARIO'))
})

test('para seguimiento, no se dispara ficha extensa si el usuario no escribe FICHA',()=>{
 const src=readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts',import.meta.url),'utf8')
 assert.match(src,/if \(mode === 'next'\)/)
 assert.match(src,/formatIntakeNextPrompt\(session\.state\)/)
 assert.match(src,/formatIntakeReview\(session\.state, itemNames\)/)
 assert.doesNotMatch(src,/✓ Corrección registrada/)
})

test('solicita lado/campo cuando mensajes aislados podrían corromper datos de precio',()=>{
  const s=session()
  s.origin.details.hasElevator=false;s.destination.details.hasElevator=false
  for(const value of ['Las Condes','RM','5','casa']) {
    assert.ok(ambiguousGroupedReply(s,value),`Debe desambiguar: ${value}`)
  }
  assert.equal(ambiguousGroupedReply(s,'Origen: Las Condes; Destino: Las Condes'),null)
})
