/* Ensayos TDD con diálogos naturales y contraejemplos: no inventar datos. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')
function load(relative) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',relative),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const mod = {exports:{}}
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:()=>({}),console,structuredClone})
  return mod.exports
}
const flow=load('src/lib/whatsapp/quoteConversation.ts')
const prag=load('src/lib/whatsapp/pragmaticInference.ts')
const inv=load('src/lib/whatsapp/inventoryResolution.ts')
const address=()=>({address:{street:null,number:null,commune:null,region:null,additionalInfo:null},
  details:{propertyType:null,floor:null,hasElevator:null,parkingDistance:null}})
const state=()=>({intake:{answeredQuoteFields:[],quoteFlowVersion:2,quoteFlowStep:'questions'},
  personalInfo:{name:'Cliente',email:'c@ejemplo.cl',rut:'20.677.123-2',isCompany:false,phone:'569'},taxDocument:'boleta',
  schedule:{date:'2026-11-16',time:'10:00',isFlexible:false},origin:address(),destination:address(),
  items:[],pendingInventory:[],inventoryPhotos:[],inventoryCollectionDone:false,
  additionalServices:{packing:false,assembly:false,disassembly:false,unpacking:false,observations:'',photos:[]},confirmed:false})
const askAccess=flow.QUOTE_INITIAL_QUESTIONS.slice(4)
function infer(s,t,q=askAccess){return prag.applyGroundedImplicatures(s,t,q)}
let s=state()
let out=infer(s,'Es departamento y casa respectivamente.')
assert.equal(out.state.origin.details.propertyType,'departamento')
assert.equal(out.state.destination.details.propertyType,'casa')
assert.equal(out.evidence.length,2)
assert.equal(s.origin.details.propertyType,null,'Inmutabilidad del estado anterior')

s=state();out=infer(s,'Casa y departamento.')
assert.equal(out.state.origin.details.propertyType,null,'No extrapolar orden sin respectivamente')
assert.equal(out.state.destination.details.propertyType,null)

s=state();s.destination.details.propertyType='casa'
out=infer(s,'En destino es una casa de un piso, sin escaleras.')
assert.equal(out.state.destination.details.floor,0)
assert.equal(out.state.destination.details.hasElevator,false)
assert.equal(out.state.origin.details.floor,null)

s=state();s.destination.details.propertyType='casa';s.destination.details.floor=1
out=infer(s,'Casa de un piso, sin escaleras.')
assert.equal(out.state.destination.details.floor,0,'Corregir piso 1 entendido como nivel superior si el cliente dice sin escaleras')

s=state();s.destination.details.propertyType='casa'
out=infer(s,'Llegamos a una casa de tres pisos.')
assert.equal(out.state.destination.details.floor,null,'Casa de tres pisos no prueba piso de carga')
assert.equal(out.state.destination.details.hasElevator,null)

s=state();out=infer(s,'El camión queda junto a la entrada en destino.')
assert.equal(out.state.destination.details.parkingDistance,0)
assert.equal(out.state.origin.details.parkingDistance,null)

s=state();out=infer(s,'El camión queda cerca.')
assert.equal(out.state.destination.details.parkingDistance,null,'Cerca no es un número')
assert.equal(out.state.origin.details.parkingDistance,null)

s=state();out=infer(s,'Ambas comunas son Las Condes, la misma región.')
assert.equal(out.state.destination.address.commune,'Las Condes')
assert.equal(out.state.origin.address.commune,'Las Condes')
assert.equal(out.state.origin.address.region,'metropolitana')

s=state();out=infer(s,'Las Condes.',[])
assert.equal(out.state.origin.address.commune,null,'Una comuna sin lado no basta')
assert.equal(out.state.destination.address.commune,null)

s=state();s.intake.answeredQuoteFields=['isFlexible']
out=infer(s,'Sí, hay ascensor en el piso 5.\n15 metros en origen y ninguno en destino.\nNo gracias.\nNo gracias tampoco.')
assert.equal(out.state.additionalServices.packing,false)
assert.equal(out.state.additionalServices.assembly,false)
assert.equal(out.state.additionalServices.disassembly,false)
assert.ok(out.state.intake.answeredQuoteFields.includes('packing'))
assert.ok(out.state.intake.answeredQuoteFields.includes('assembly'))
assert.ok(out.state.intake.answeredQuoteFields.includes('disassembly'))

s=state();out=infer(s,'No, tampoco.')
assert.equal(out.state.intake.answeredQuoteFields.length,0,'No suponer a qué se refiere un NO aislado')

s=state();s.origin.details.propertyType='departamento';s.destination.details.propertyType='casa';
s.destination.details.floor=0;s.destination.details.hasElevator=false
out=infer(s,'No entendí lo de los pisos.')
assert.equal(out.state.origin.details.floor,null)
assert.equal(out.state.origin.details.hasElevator,null)

s=state();s.items=[{catalogItemId:'frigo',quantity:2}];s.pendingInventory=[]
let merged=inv.mergePhotoInventory(s,{items:[{catalogItemId:'frigo',quantity:2}],pendingInventory:[]})
assert.equal(merged.items[0].quantity,2,'No duplicar refrigeradores ya enumerados cuando llegan sus fotos')
merged=inv.mergePhotoInventory(merged,{items:[{catalogItemId:'frigo',quantity:2}],pendingInventory:[]})
assert.equal(merged.items[0].quantity,2,'No contar dos veces vistas del mismo mueble')
merged=inv.mergePhotoInventory(merged,{items:[{catalogItemId:'mesa',quantity:1}],pendingInventory:[]})
assert.equal(merged.items.find(v=>v.catalogItemId==='mesa').quantity,1,'Foto añade artículo nuevo')
merged=inv.mergePhotoInventory(merged,{items:[{catalogItemId:'mesa',quantity:1}],pendingInventory:[]},'otra mesa adicional')
assert.equal(merged.items.find(v=>v.catalogItemId==='mesa').quantity,2,'El cliente aclara que es adicional')

s=state();s.inventoryPhotos=[{messageId:'foto',status:'processing',recognized:[]}]
assert.equal(flow.readyToReviewInventory(s),false)
s.items=[{catalogItemId:'mesa',quantity:1}];s.inventoryPhotos[0].status='done'
assert.equal(flow.readyToReviewInventory(s),true)
assert.equal(flow.quoteFlowStep({...s,intake:{...s.intake,quoteFlowStep:'photos'}}),'inventory',
  'Sesiones antiguas avanzan sin NO/LISTO')

const processor=fs.readFileSync(path.join(__dirname,'../src/lib/whatsapp/incomingProcessor.ts'),'utf8')
const main=processor.slice(processor.indexOf('async function processApprovedQuoteTurn('),processor.indexOf('/** Flujo simple de Tommy'))
assert.match(main,/if \(message\.type === 'image'\) \{[\s\S]*?processApprovedPhoto\(session/)
assert.doesNotMatch(main,/await sendAndLog\(conversationId, to, QUOTE_PHOTO_MESSAGE\)/)
assert.doesNotMatch(main,/withQuoteFlowStep\(current, 'photos'\)/)
assert.match(main,/withQuoteFlowStep\(current, 'inventory'\)/)
assert.match(main,/applyGroundedImplicatures\(extracted, text, context\)/)
const router=processor.slice(processor.indexOf("if (decision === 'human')"),processor.indexOf("if (decision === 'exit'"))
assert.doesNotMatch(router,/await\s+(?:setBotMode|createHandoffRequest)\s*\(/,'No activar derivación')
console.log('OK: 17 escenarios TDD: implicaturas con evidencia, contraejemplos, fotos sin pantalla y sin duplicados, secretaría dormida.')
