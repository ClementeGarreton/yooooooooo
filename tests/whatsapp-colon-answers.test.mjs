import test from 'node:test'
import assert from 'node:assert/strict'
import { TOMMY_QUOTE_START, tommyDifferentialResult, tommyAnswerOnlyForAI, applyTommyAnswers, tommyMissing, tommyPendingMessage } from '../src/lib/whatsapp/tommyFlow.ts'
import { extractTommyDifferential } from '../src/lib/whatsapp/tommyDifferential.ts'

const form=TOMMY_QUOTE_START
const end = (index, value, text=form) => text.replace(new RegExp(`(${index}\\) [^\\n]*?\\| Respuesta:)`), `$1 ${value}`)
function state() {
  const address=()=>({street:'Sebastián Piñera',number:'342',commune:'Las Condes',region:'metropolitana',additionalInfo:null})
  const details=()=>({propertyType:null,floor:null,hasElevator:null,parkingDistance:null})
  return {
    personalInfo:{name:null,email:null,phone:null,isCompany:false,companyName:null,companyRut:null},
    schedule:{date:'2026-11-16',time:'10:00',isFlexible:false},
    origin:{address:address(),details:details()},destination:{address:address(),details:details()},
    taxDocument:null,items:[{catalogItemId:'escritorio',quantity:2}],pendingInventory:[],
    inventoryPhotos:[],inventoryCollectionDone:true,
    additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'__pending__',photos:[]},
    intake:{stage:'describe',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{}},confirmed:false,
  }
}

test('formulario explícito tiene Respuesta después de cada pregunta', () => {
  assert.equal((form.match(/\| Respuesta:/g)||[]).length,6)
  assert.match(form,/Copia este mensaje y escribe tu respuesta/)
})
test('copia sin editar NO se convierte en datos', () => {
  const diff=tommyDifferentialResult(form)
  assert.equal(diff.answers.length,0)
  assert.equal(tommyAnswerOnlyForAI(form),'')
})
test('reconoce seis respuestas añadidas tras dos puntos y reduce la entrada a la IA', () => {
  const answers=['De Sebastián Piñera 342 Las Condes a Camino El Alba 9184 Las Condes','2 refrigeradores y 2 escritorios','16 noviembre 2026 10:00','no no hay','no','los 2 escritorios porque son de vidrio']
  const updated=answers.reduce((s,val,i)=>end(i+1,val,s),form)
  const result=tommyDifferentialResult(updated)
  assert.deepEqual(result.answers.map(a=>a.field), ['direcciones','articulos','fecha','escaleras','acarreo','embalaje'])
  assert.equal(result.answers[5].value,'los 2 escritorios porque son de vidrio')
  assert.equal(tommyMissing(applyTommyAnswers(state(),updated)).length,0)
  const stripped=tommyAnswerOnlyForAI(updated)
  assert.doesNotMatch(stripped,/Copia este mensaje|indícanos qué artículos/)
  assert.match(stripped,/Sebastián Piñera/)
})
test('permite un punto y coma explícito con respuesta, sin reglas sobre vocabulario', () => {
  const d=tommyDifferentialResult('6) Embalaje: ¿necesitas que embalemos algo? Si es así, indícanos qué artículos. ; Respuesta: tres microscopios y 2 piezas azules')
  assert.equal(d.answers.find(x=>x.field==='embalaje')?.value,'tres microscopios y 2 piezas azules')
})
test('No inventa Sí/No en campos no contestados aunque las preguntas mencionen esas palabras', () => {
  const d=tommyDifferentialResult(end(2,'2 sofas') )
  assert.equal(d.answers.length,1)
  assert.equal(d.answers[0].field,'articulos')
  assert.ok(d.undecided.includes('acarreo'))
  assert.ok(d.undecided.includes('embalaje'))
})
test('puede responder solamente el recordatorio de pendientes, sin repetir los otros datos', () => {
  let st=state()
  const base=tommyPendingMessage(st)
  assert.equal((base.match(/\| Respuesta:/g)||[]).length,3)
  assert.equal(tommyDifferentialResult(base, st).answers.length,0)
  const reply=base.replace('Si se requieren escaleras, indica qué muebles; de lo contrario, responde No | Respuesta:', 'Si se requieren escaleras, indica qué muebles; de lo contrario, responde No | Respuesta: no')
    .replace('(Sí/No) | Respuesta:', '(Sí/No) | Respuesta: no')
    .replace('Embalaje: ¿qué artículos debemos embalar? (o indica No) | Respuesta:', 'Embalaje: ¿qué artículos debemos embalar? (o indica No) | Respuesta: dos computadores antiguos')
  const d=tommyDifferentialResult(reply,st)
  assert.equal(d.answers.length,3)
  st=applyTommyAnswers(st,reply)
  assert.deepEqual(tommyMissing(st),[])
})
test('respeta respuestas escritas con erratas y número 5 aunque el rótulo esté mal', () => {
 const d=tommyDifferentialResult('5) Distanica de carrga: ¿hay que caminar un tramo largo desde el camión? ; Respuesta: Nop nada')
 assert.equal(d.answers.find(a=>a.field==='acarreo')?.value,'Nop nada')
})
test('dos respuestas distintas del mismo campo se marcan en conflicto, sin decidir por el cliente',()=>{
 const d=tommyDifferentialResult('5) Distancia de carga: ¿hay que caminar lejos? | Respuesta: Sí, en origen\n5) Distancia de carga: ¿hay que caminar lejos? | Respuesta: No')
 assert.ok(d.conflicted.includes('acarreo'))
 assert.equal(d.answers.find(a=>a.field==='acarreo'),undefined)
})
test('formulario antiguo sigue funcionando sin campo Respuesta',()=>{
 const msg='4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. Si no hay, responde No. no no hay'
 assert.equal(tommyDifferentialResult(msg).answers.find(a=>a.field==='escaleras')?.value,'no no hay')
})
