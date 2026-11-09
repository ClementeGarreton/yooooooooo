const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
const source = fs.readFileSync(path.join(__dirname,'../src/lib/whatsapp/quoteConversation.ts'),'utf8')
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const moduleRef = {exports:{}}
vm.runInNewContext(compiled,{module:moduleRef,exports:moduleRef.exports,require:()=>({}),structuredClone,console})
const flow = moduleRef.exports
const details=(propertyType, floor, hasElevator, parkingDistance)=>({propertyType,floor,hasElevator,parkingDistance})
const address=(details)=>({address:{street:'Calle',number:'123',commune:'Las Condes',region:'Metropolitana'},details})
const base=()=>({
  intake:{answeredQuoteFields:['isFlexible','packing','disassembly','assembly']},
  personalInfo:{name:'Clemente',email:'correo@ejemplo.cl',rut:'20.677.123-2',phone:'569',isCompany:false},taxDocument:'boleta',
  schedule:{date:'2026-11-16',time:'10:00',isFlexible:false},
  origin:address(details(null,5,true,15)),destination:address(details(null,null,null,0)),
  items:[{catalogItemId:'c1',quantity:2}],pendingInventory:[],additionalServices:{packing:false,disassembly:false,assembly:false},
})
const example=base()
const questions=flow.missingQuoteQuestions(example)
assert.equal(questions.length,1,'El caso de la captura solo necesita aclarar los accesos')
const q=questions[0]
assert.match(q,/lugar de origen es una casa/)
assert.match(q,/lugar de destino es una casa/)
assert.match(q,/en qué piso dejaremos los muebles/)
assert.match(q,/Hay ascensor allí/)
assert.doesNotMatch(q,/en qué piso retiraremos|ascensor en el origen|salida:|llegada:|piso de los muebles|;|Respuesta:/i)
const explanation=flow.paraphraseQuoteQuestion(q,example)
assert.match(explanation,/Me refiero a los lugares/)
assert.doesNotMatch(explanation,/en qué piso retiraremos|ascensor en el origen|salida:|llegada:|piso de los muebles/i)
const onlyDestination=base();onlyDestination.origin.details.propertyType='departamento'
const destination=flow.missingQuoteQuestions(onlyDestination).join('\n')
assert.doesNotMatch(destination,/lugar de origen|piso retiraremos|ascensor en el origen/i)
const allKnown=base();allKnown.origin.details.propertyType='departamento';allKnown.destination.details=details('casa',0,null,0)
assert.equal(flow.missingQuoteQuestions(allKnown).length,0,'Casa en planta baja no exige ascensor')
const scheduleMissing=base();scheduleMissing.origin.details.propertyType='departamento';scheduleMissing.destination.details=details('casa',0,null,0);scheduleMissing.intake.answeredQuoteFields=[]
assert.match(flow.missingQuoteQuestions(scheduleMissing).join(' '),/¿Podrías cambiar la fecha si fuera necesario\?/)
assert.doesNotMatch(flow.QUOTE_FIRST_MESSAGE+flow.QUOTE_SECOND_MESSAGE,/Respuesta:/)
console.log('OK: redacción natural contextual, sin campos internos ni repreguntas sobre hechos confirmados.')
