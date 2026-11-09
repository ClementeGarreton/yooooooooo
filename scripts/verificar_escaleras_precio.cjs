const assert = require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const ts=require('typescript');
const root=path.resolve(__dirname,'..');const cache={};
function load(rel){rel=rel.endsWith('.ts')?rel:rel+'.ts'; if(cache[rel])return cache[rel].exports;const src=fs.readFileSync(path.join(root,rel),'utf8');const js=ts.transpileModule(src,{fileName:rel,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}}; cache[rel]=mod; const req=(x)=>{if(x.startsWith('@/'))return load('src/'+x.slice(2));if(x.startsWith('.')) return load(path.normalize(path.join(path.dirname(rel),x)));throw Error(x)}; vm.runInNewContext(js,{require:req, exports:mod.exports,module:mod,Date,console,Map,Set,Number,String,Boolean,JSON,Math,Intl},{filename:rel});return mod.exports}
const {calculateQuote}=load('src/lib/quotePricing');const {DEFAULT_PRICING_CONFIG}=load('src/lib/pricingDefaults');
const items=[{id:'f',name:'Refrigerador',quantity:2,volume:2,weight:100},{id:'d',name:'Escritorio',quantity:2,volume:1,weight:40},{id:'b',name:'Cama',quantity:3,volume:2,weight:40}];const stairsOnly=[items[0]];
const base={items,origin:{floor:5,hasElevator:false},destination:{floor:0,hasElevator:true},distanceKm:3.3,dateTime:'2026-11-16T10:00',additionalServices:{packing:true},pricing:{...DEFAULT_PRICING_CONFIG,floorSurcharge:2000,stairs:{itemsPerTrip:5}}};
const old=calculateQuote(base);const corrected=calculateQuote({...base,originStairItems:stairsOnly,destinationStairItems:[]});
assert.equal(old.priceBreakdown.find(x=>x.key==='stairs_origin').amount,20000);
assert.equal(corrected.priceBreakdown.find(x=>x.key==='stairs_origin').amount,10000);
assert.equal(old.estimatedPrice-corrected.estimatedPrice,10000);
assert.equal(corrected.priceBreakdown.reduce((s,x)=>s+x.amount,0),corrected.estimatedPrice);
const noStairs=calculateQuote({...base,origin:{floor:0,hasElevator:true},originStairItems:[],destinationStairItems:[]});assert.equal(noStairs.priceBreakdown.find(x=>x.key==='stairs_origin').amount,0);
console.log('PASS: subset de muebles por escaleras cobra 1 viaje, no 2');
console.log('PASS: suma de partidas y total coinciden');
console.log('PASS: escaleras no utilizadas cobran cero');
