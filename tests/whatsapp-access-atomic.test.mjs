import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isTommyAccessReply, extractAccessAnswers, applyAccessForm, accessPendingLines, accessIsComplete } from '../src/lib/whatsapp/tommyAccess.ts'
import { tommyPendingMessage, tommyMissing } from '../src/lib/whatsapp/tommyFlow.ts'
function state() {
  const address=()=>({street:'Apoquindo',number:'342',commune:'Las Condes',region:'RM',additionalInfo:null})
  const details=()=>({propertyType:'departamento',floor:5,hasElevator:null,parkingDistance:null})
  return {origin:{address:address(),details:details()},destination:{address:address(),details:details()},
    personalInfo:{name:null,email:null,phone:'56998765432',isCompany:false,companyName:null,companyRut:null},
    schedule:{date:'2026-11-16',time:'10:00',isFlexible:false},items:[{catalogItemId:'escritorio',quantity:2}],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:true,
    additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'__pending__',photos:[]},
    intake:{stage:'describe',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{}}, confirmed:false }
}
const withAnswers=(st, answers) => {
  const form=tommyPendingMessage(st)
  const filled=form.split('\n').map(line => {
    const id=/4\.(\d)\)/.exec(line)?.[1]
    return id && answers[id] ? line.replace(/Respuesta:\s*$/, `Respuesta: ${answers[id]}`) : line
  }).join('\n')
  return applyAccessForm(st,filled)
}
test('preguntas distintas para ascensor origen/destino y escaleras origen/destino',()=> {
  const prompt=tommyPendingMessage(state())
  assert.match(prompt,/4\.1\) ¿Ascensor en origen\?/)
  assert.match(prompt,/4\.2\) ¿Ascensor en destino\?/)
  assert.match(prompt,/4\.3\) ¿Se usarán escaleras en origen\?/)
  assert.match(prompt,/4\.4\) ¿Se usarán escaleras en destino\?/)
  assert.doesNotMatch(prompt,/¿Hay ascensor.*destino.*escaleras\?/)
})
test('si copian el formulario sin respuestas ningún campo se da por contestado',()=> {
  const before=state();const copied=tommyPendingMessage(before)
  assert.ok(isTommyAccessReply(copied))
  assert.deepEqual(extractAccessAnswers(copied),[])
  assert.deepEqual(applyAccessForm(before,copied).intake.tommyAnswers,[])
})
test('un sí solamente contesta la pregunta 4.1; no se propaga a las otras tres',()=> {
  const s=withAnswers(state(),{'1':'Sí'})
  assert.equal(s.intake.tommyAccess.originElevator,true)
  assert.equal(s.intake.tommyAccess.destinationElevator,undefined)
  assert.equal(s.intake.tommyAccess.originStairs,undefined)
  assert.equal(s.intake.tommyAccess.destinationStairs,undefined)
  assert.equal(s.intake.tommyAnswers.length,0)
  const pending=tommyPendingMessage(s)
  assert.doesNotMatch(pending,/4\.1\)/)
  assert.match(pending,/4\.2\)/)
})
test('cuatro respuestas Sí/No negativas bastan, sin repetir preguntas ni exigir muebles',()=> {
  const s=withAnswers(state(),{'1':'Sí, hay ascensor','2':'No','3':'No hay','4':'No'})
  assert.ok(accessIsComplete(s.intake.tommyAccess))
  assert.deepEqual(tommyMissing(s),['acarreo','embalaje'])
  assert.doesNotMatch(tommyPendingMessage(s),/4\.1\)/)
  assert.equal(s.origin.details.hasElevator,true)
  assert.equal(s.destination.details.hasElevator,false)
})
test('si usan escaleras pregunta muebles y número de pisos, cada dato por separado',()=> {
  let s=withAnswers(state(),{'1':'No','2':'Sí','3':'Sí','4':'No'})
  let pending=tommyPendingMessage(s)
  assert.match(pending,/4\.5\).*Qué muebles/)
  assert.match(pending,/4\.6\).*Cuántos pisos/)
  assert.doesNotMatch(pending,/4\.7\)/)
  assert.doesNotMatch(pending,/4\.1\)/)
  s=withAnswers(s,{'5':'dos escritorios y un refrigerador','6':'5 pisos'})
  assert.deepEqual(tommyMissing(s),['acarreo','embalaje'])
  assert.match(s.intake.tommyDetails.escaleras,/dos escritorios/)
  assert.match(s.intake.tommyDetails.escaleras,/Pisos por escalera origen: 5/)
})
test('respuesta ambigua no se interpreta como respuesta binaria',()=> {
  let s=withAnswers(state(),{'1':'quizás'})
  assert.equal(s.intake.tommyAccess.originElevator,undefined)
  assert.match(tommyPendingMessage(s),/4\.1\)/)
  s=withAnswers(s,{'1':'Sí','2':'No','3':'No','4':'No'})
  assert.deepEqual(tommyMissing(s),['acarreo','embalaje'])
})
test('el procesador atiende preguntas atómicas ANTES del detector de formulario antiguo',()=> {
  const src=readFileSync(new URL('../src/lib/whatsapp/incomingProcessor.ts',import.meta.url),'utf8')
  const index=src.indexOf('if (isTommyAccessReply(text, nextState))')
  assert.ok(index>0 && index < src.indexOf('if (isOnlyTommyServiceAnswers(text))'))
  assert.ok(index < src.indexOf('const differential = tommyDifferentialResult(text, nextState)'))
})
test('una sola copia puede responder accesos, acarreo y embalaje sin perder respuestas', async ()=> {
  const st=state()
  const composite=tommyPendingMessage(st)
    .replace(/(4\.1\)[^\n]*?\| Respuesta:)/,'$1 Sí')
    .replace(/(4\.2\)[^\n]*?\| Respuesta:)/,'$1 Sí')
    .replace(/(4\.3\)[^\n]*?\| Respuesta:)/,'$1 No')
    .replace(/(4\.4\)[^\n]*?\| Respuesta:)/,'$1 No')
    .replace(/((?:Acarreo|Distancia de carga):[^\n]*?\| Respuesta:)/,'$1 No')
    .replace(/(Embalaje:[^\n]*?\| Respuesta:)/,'$1 Dos escritorios')
  const s1=applyAccessForm(st,composite)
  const onlyOther=composite.split('\n').filter(line=>!/^\s*(?:[-•]\s*)?4\.[1-7]\s*[).:-]/.test(line)).join('\n')
  const { applyTommyAnswers } = await import('../src/lib/whatsapp/tommyFlow.ts')
  const s2=applyTommyAnswers(s1,onlyOther)
  assert.deepEqual(tommyMissing(s2),[])
  assert.equal(s2.intake.tommyDetails.embalaje,'Dos escritorios')
  assert.equal(s2.intake.tommyDetails.acarreo,'No')
})
