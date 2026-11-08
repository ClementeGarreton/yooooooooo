import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTommyAnswers, tommyAnswerOnlyForAI, tommyMissing, isOnlyTommyServiceAnswers } from '../src/lib/whatsapp/tommyFlow.ts'
function session(){
const address=()=>({street:'Calle X',number:'123',commune:'Las Condes',region:null,additionalInfo:null});
const d=()=>({propertyType:null,floor:null,hasElevator:null,parkingDistance:null});
return { personalInfo:{name:null,email:null,phone:null,isCompany:false,companyName:null,companyRut:null},
 schedule:{date:'2026-11-16',time:'10:00',isFlexible:false}, origin:{address:address(),details:d()},destination:{address:address(),details:d()},
 taxDocument:null,items:[{catalogItemId:'escritorio',quantity:2}],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:true,
 additionalServices:{packing:false,disassembly:false,assembly:false,unpacking:false,observations:'__pending__',photos:[]},
 intake:{stage:'describe',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{}},confirmed:false}
}
const full=`¡Hola! 👋 Para cotizar tu flete o mudanza, por favor envíanos esta información:
1) Direcciones de origen y destino: calle Sebastián Piñera y Camino el Alba, número 342 y 9184, comuna Las Condes.
2) Lista de artículos a trasladar. 2 refrigeradores 2 camas individuales 1 cama matrimonial y 2 escritorios.
3) Fecha del flete o mudanza. 16 de noviembre a las 10am
4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. Si no hay, responde No. No no hay
5) Distancia de carga: ¿hay que caminar un tramo largo desde el camión hasta el lugar de carga o descarga? (Sí / No) no
6) Embalaje: ¿necesitas que embalemos algo? Si es así, indícanos qué artículos. los 2 escritorios
Copia este mensaje y cámbiale las respuestas para contestar más fácil y rápido.
¡Gracias! Con esto te enviamos tu cotización a la brevedad 🚚`;
const pending=`¡Gracias por la información! 🙌 Para enviarte el presupuesto solo nos falta:

- Escaleras: artículos, pisos y si corresponde a origen, destino o ambos (o indica No) No no
- Distancia de carga: ¿hay que caminar un tramo largo desde el camión? (Sí/No) no
- Embalaje: ¿qué artículos debemos embalar? (o indica No) los 2 escritorios

Copia este mensaje y cambia las respuestas para responder más fácil y rápido.
Apenas nos respondas, te enviamos tu cotización 🚚`;
test('formulario completo copiado con respuestas coloquiales',()=>{
 const s=applyTommyAnswers(session(),full)
 assert.deepEqual(tommyMissing(s),[])
 assert.equal(s.intake.tommyDetails.escaleras,'No no hay')
 assert.equal(s.intake.tommyDetails.acarreo,'no')
 assert.equal(s.intake.tommyDetails.embalaje,'los 2 escritorios')
 assert.equal(s.additionalServices.packing,true)
 const clean=tommyAnswerOnlyForAI(full)
 assert.match(clean,/escaleras: No no hay/i)
 assert.doesNotMatch(clean,/Si no hay, responde No/)
 assert.doesNotMatch(clean,/Copia este mensaje/)
 assert.match(clean,/Artículos para trasladar: 2 refrigeradores/)
 assert.match(clean,/Fecha del flete: 16 de noviembre/)
})
test('copiar el mensaje de pendientes entero sin borrar el texto',()=>{
 assert.equal(isOnlyTommyServiceAnswers(pending),true)
 const s=applyTommyAnswers(session(),pending)
 assert.deepEqual(tommyMissing(s),[])
 assert.equal(s.additionalServices.packing,true)
 assert.match(s.additionalServices.observations,/escritorios/)
})
test('copiar preguntas intactas NO equivale a responder Sí o No',()=>{
 const msg=`4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. Si no hay, responde No.
5) Distancia de carga: ¿hay que caminar un tramo largo desde el camión hasta el lugar de carga o descarga? (Sí / No)
6) Embalaje: ¿necesitas que embalemos algo? Si es así, indícanos qué artículos.`
 assert.deepEqual(tommyMissing(applyTommyAnswers(session(),msg)),['escaleras','acarreo','embalaje'])
})
test('si hay escaleras y solo dice Sí, pide datos sin inventarlos',()=>{
 const msg=`4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. Si no hay, responde No. Si`;
 assert.ok(tommyMissing(applyTommyAnswers(session(),msg)).includes('escaleras'))
})
