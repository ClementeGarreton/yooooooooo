import test from 'node:test'
import assert from 'node:assert/strict'
import { TOMMY_QUOTE_START, tommyPendingMessage, tommyMissing, applyTommyAnswers, tommyDifferentialResult, tommyAnswerOnlyForAI, isOnlyTommyServiceAnswers } from '../src/lib/whatsapp/tommyFlow.ts'
function session(){
 const addr=()=>({street:'Calle X',number:'123',commune:'Las Condes',region:null,additionalInfo:null})
 const place=()=>({address:addr(),details:{propertyType:'departamento',floor:null,hasElevator:null,parkingDistance:null}})
 return {personalInfo:{name:null,email:null,phone:null,isCompany:false},schedule:{date:'2026-11-16',time:null,isFlexible:false},origin:place(),destination:place(),taxDocument:null,items:[{catalogItemId:'cama',quantity:1}],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:true,additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'__pending__',photos:[]},intake:{stage:'describe',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{}},confirmed:false}
}
test('pregunta explícitamente ASCENSOR apto para muebles, no solo escaleras',()=>{
 assert.match(TOMMY_QUOTE_START,/Acceso por ascensor o escalera/)
 assert.match(TOMMY_QUOTE_START,/ascensor utilizable para los muebles en origen y destino/)
})
test('5 pisos en origen se conserva parcialmente, sin inferir que falta ascensor',()=>{
 const s=applyTommyAnswers(session(),'4) Acceso por ascensor o escalera: | Respuesta: Sí, 5 pisos en origen')
 assert.equal(s.intake.tommyDetails.escaleras,'Sí, 5 pisos en origen')
 assert.ok(tommyMissing(s).includes('escaleras'))
 const prompt=tommyPendingMessage(s)
 assert.match(prompt,/Ya indicaste 5 pisos en origen/)
 assert.match(prompt,/¿Hay ascensor utilizable/)
 assert.equal(s.origin.details.hasElevator,null)
 assert.equal(s.origin.details.floor,null)
})
test('ascensor confirmado en ambos lados resuelve el campo sin preguntar muebles por escalera',()=>{
 const s=applyTommyAnswers(session(),'4) Acceso por ascensor o escalera: | Respuesta: Ascensor en origen y destino')
 assert.ok(!tommyMissing(s).includes('escaleras'))
})
test('sin ascensor NO se confunde con sin escaleras',()=>{
 const s=applyTommyAnswers(session(),'4) Acceso por ascensor o escalera: | Respuesta: No hay ascensor en origen')
 assert.ok(tommyMissing(s).includes('escaleras'))
 assert.match(s.intake.tommyDetails.escaleras,/No hay ascensor/)
})
test('copia vacía no cuenta; acceso ya conocido evita preguntar por origen',()=>{
 const s=session(); s.origin.details.floor=5; s.origin.details.hasElevator=true
 assert.equal(tommyDifferentialResult(TOMMY_QUOTE_START,s).answers.length,0)
 const p=tommyPendingMessage(s)
 assert.match(p,/En destino, ¿hay ascensor/)
 assert.doesNotMatch(p,/En origen, ¿hay ascensor/)
})
test('respuesta posterior aprovecha antecedente parcial en vez de exigir repetir pisos',()=>{
 const s=applyTommyAnswers(session(),'4) Acceso por ascensor o escalera: | Respuesta: 5 pisos en origen')
 const edited=applyTommyAnswers(s,'4) Acceso por ascensor o escalera: | Respuesta: cama matrimonial por escaleras en origen')
 assert.ok(!tommyMissing(edited).includes('escaleras'))
 assert.match(edited.intake.tommyDetails.escaleras,/5 pisos en origen; cama matrimonial por escaleras en origen/)
})
test('un mensaje de acceso que habla de ascensores sí pasa por IA para actualizar los datos de precios',()=>{
 assert.equal(isOnlyTommyServiceAnswers('4) Acceso por ascensor o escalera: | Respuesta: Ascensor en origen y destino'),false)
 assert.match(tommyAnswerOnlyForAI('4) Acceso por ascensor o escalera: | Respuesta: Ascensor en origen y destino'),/Ascensor en origen y destino/)
})
