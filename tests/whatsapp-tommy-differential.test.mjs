import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTommyDifferential } from '../src/lib/whatsapp/tommyDifferential.ts'
import {
  TOMMY_QUOTE_START, tommyDifferentialResult, tommyAnswerOnlyForAI,
  applyTommyAnswers, tommyMissing, tommyPendingMessage,
} from '../src/lib/whatsapp/tommyFlow.ts'
const form = TOMMY_QUOTE_START
function state() {
  const address = () => ({ street: 'Sebastián Piñera', number: '342', commune: 'Las Condes', region: 'metropolitana', additionalInfo: null })
  const details = () => ({ propertyType: null, floor: null, hasElevator: null, parkingDistance: null })
  return {
    personalInfo:{ name:null,email:null,phone:null,isCompany:false,companyName:null,companyRut:null },
    schedule:{ date:'2026-11-16', time:'10:00', isFlexible:false },
    origin:{address:address(),details:details()}, destination:{address:address(),details:details()},
    taxDocument:null, items:[{catalogItemId:'escritorio',quantity:2}], pendingInventory:[],
    inventoryPhotos:[],inventoryCollectionDone:true, additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'__pending__',photos:[]},
    intake:{stage:'describe',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{}}, confirmed:false,
  }
}
test('copia idéntica no aporta información aunque la plantilla incluya Sí / No', () => {
  const r = tommyDifferentialResult(form)
  assert.equal(r.copiedForm, true)
  assert.equal(r.answers.length, 0)
  assert.equal(tommyAnswerOnlyForAI(form), '')
  assert.deepEqual(tommyMissing(applyTommyAnswers(state(), form)), ['escaleras','acarreo','embalaje'])
})
test('seis perturbaciones se separan del formulario completo sin repetir preguntas a la IA', () => {
  const reply = form
    .replace('calle, número, comuna y número de departamento si corresponde.', 'calle Piñera 342 a Camino el Alba 9184, en Las Condes.')
    .replace('2) Lista de artículos a trasladar.', '2) Lista de artículos a trasladar. 2 escritorios y 1 refrigerador')
    .replace('3) Fecha del flete o mudanza.', '3) Fecha del flete o mudanza. el 16 de noviembre 10am')
    .replace('Si no hay, responde No.', 'Si no hay, responde No. No no hay')
    .replace('(Sí / No)', '(Sí / No) no')
    .replace('Si es así, indícanos qué artículos.', 'Si es así, indícanos qué artículos. los 2 escritorios')
  const d = tommyDifferentialResult(reply)
  assert.deepEqual(d.answers.map(x=>x.field), ['direcciones','articulos','fecha','escaleras','acarreo','embalaje'])
  assert.equal(d.answers[3].value, 'No no hay')
  assert.equal(d.answers[4].value, 'no')
  assert.equal(d.answers[5].value, 'los 2 escritorios')
  assert.doesNotMatch(tommyAnswerOnlyForAI(reply), /Si no hay, responde No|Copia este mensaje/)
  assert.deepEqual(tommyMissing(applyTommyAnswers(state(),reply)),[])
})
test('respuestas insertadas en la mitad del enunciado también se detectan',()=>{
  const reply = '5) Distancia de carga: no, ¿hay que caminar un tramo largo desde el camión hasta el lugar de carga o descarga? (Sí / No)'
  const d = tommyDifferentialResult(reply)
  assert.equal(d.answers.find(x=>x.field==='acarreo')?.value, 'no')
  assert.ok(applyTommyAnswers(state(),reply).intake.tommyAnswers.includes('acarreo'))
})
test('los campos independientes no se completan por copiar un recordatorio',()=>{
  const st = state()
  const text = tommyPendingMessage(st)
  const d = tommyDifferentialResult(text,st)
  assert.equal(d.answers.length,0)
  assert.deepEqual(tommyMissing(applyTommyAnswers(st,text)),['escaleras','acarreo','embalaje'])
})
test('pendientes separados: sí/no por número, sin atribuir respuestas de ascensor a escaleras',()=>{
  const st=state()
  const base=tommyPendingMessage(st)
  assert.match(base,/4\.1\)/)
  assert.match(base,/4\.4\)/)
  // El comparador antiguo sigue leyendo los otros campos, nunca las subpreguntas 4.x.
  const reply=base.replace(/(4\.1\)[^\n]*?\| Respuesta:)/,'$1 Sí')
    .replace(/(4\.2\)[^\n]*?\| Respuesta:)/,'$1 No')
    .replace(/(4\.3\)[^\n]*?\| Respuesta:)/,'$1 No')
    .replace(/(4\.4\)[^\n]*?\| Respuesta:)/,'$1 No')
    .replace(/((?:Acarreo|Distancia de carga):[^\n]*?\| Respuesta:)/,'$1 no')
    .replace(/(Embalaje:[^\n]*?\| Respuesta:)/,'$1 mis dos maceteros pintados')
  const nonAccess=reply.split('\n').filter(line=>!/^\s*4\.[1-7]\)/.test(line)).join('\n')
  const d=tommyDifferentialResult(nonAccess,st)
  assert.equal(d.answers.filter(a=>a.field!=='escaleras').length,2)
  assert.match(tommyAnswerOnlyForAI(nonAccess,st),/mis dos maceteros pintados/)
})
test('títulos con erratas siguen alineándose por número sin inventar un Sí',()=>{
  const reply=form.replace('4) Escaleras: indícanos', '4) Ecaleeras: indicanos')
    .replace('responde No.', 'responde No. no no hay')
    .replace('6) Embalaje:', '6) Enbalaje:')
    .replace('Si es así, indícanos qué artículos.', 'Si es así, indícanos qué artículos. no')
  const d=tommyDifferentialResult(reply)
  assert.equal(d.answers.find(x=>x.field==='escaleras')?.value,'no no hay')
  assert.equal(d.answers.find(x=>x.field==='embalaje')?.value,'no')
  assert.ok(d.undecided.includes('acarreo'))
})
test('Sí sin el lado del acarreo NO se considera suficiente',()=>{
  const st = applyTommyAnswers(state(),'5) Distancia de carga: Si')
  assert.deepEqual(tommyMissing(st),['escaleras','acarreo','embalaje'])
  assert.deepEqual(tommyMissing(applyTommyAnswers(st,'5) Distancia de carga: Sí en el destino')),['escaleras','embalaje'])
})
test('Sí sin indicar objetos a embalar queda pendiente; objetos libres se aceptan',()=>{
  const st=applyTommyAnswers(state(),'6) Embalaje: Sí')
  assert.ok(tommyMissing(st).includes('embalaje'))
  const st2=applyTommyAnswers(st,'6) Embalaje: los 3 instrumentos científicos')
  assert.equal(st2.additionalServices.packing,true)
  assert.equal(st2.intake.tommyDetails.embalaje,'los 3 instrumentos científicos')
})
test('respuestas opuestas para un mismo campo no se resuelven arbitrariamente',()=>{
  const d=tommyDifferentialResult('5) Distancia de carga: Sí, en destino\n5) Distancia de carga: No')
  assert.ok(d.undecided.includes('acarreo'))
  assert.equal(d.answers.length,0)
  const st=applyTommyAnswers(state(),'5) Distancia de carga: Sí, en destino\n5) Distancia de carga: No')
  assert.ok(tommyMissing(st).includes('acarreo'))
})
test('no considerar una errata interna como respuesta añadida',()=>{
  const modified=form.replace('indícanos qué artículos', 'indícanos qué artculos')
  const d=tommyDifferentialResult(modified)
  assert.equal(d.answers.find(x=>x.field==='escaleras'),undefined)
})
test('respuestas directas sin copiar, conservan la vía natural',()=>{
  assert.equal(tommyAnswerOnlyForAI('Mi flete es de Las Condes a Ñuñoa el lunes.'), 'Mi flete es de Las Condes a Ñuñoa el lunes.')
})

test('al borrar la alternativa en Sí/No se registra la selección visible',()=>{
  const msg='5) Distancia de carga: ¿hay que caminar un tramo largo desde el camión hasta el lugar de carga o descarga? (No)'
  const r=tommyDifferentialResult(msg)
  assert.equal(r.answers.find(x=>x.field==='acarreo')?.value,'No')
  assert.ok(applyTommyAnswers(state(),msg).intake.tommyAnswers.includes('acarreo'))
})
test('al borrar el texto de escaleras y dejar No no se descarta la respuesta',()=>{
  const msg='4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. No'
  const r=tommyDifferentialResult(msg)
  assert.equal(r.answers.find(x=>x.field==='escaleras')?.value,'No')
})

test('mensaje copiado pegado en una sola línea preserva los seis campos',()=>{
 const reply = form
   .replace('calle, número, comuna y número de departamento si corresponde.', 'calle X 100 a Calle Y 200, Las Condes.')
   .replace('2) Lista de artículos a trasladar.', '2) Lista de artículos a trasladar. dos camas')
   .replace('3) Fecha del flete o mudanza.', '3) Fecha del flete o mudanza. 16 noviembre 10am')
   .replace('responde No.', 'responde No. no')
   .replace('(Sí / No)', '(Sí / No) no')
   .replace('Si es así, indícanos qué artículos.', 'Si es así, indícanos qué artículos. los cuadros')
   .replaceAll('\n',' ')
 const d=tommyDifferentialResult(reply)
 assert.deepEqual(d.answers.map(x=>x.field),['direcciones','articulos','fecha','escaleras','acarreo','embalaje'])
})
