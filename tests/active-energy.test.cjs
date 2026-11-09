const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function setup(){
 const elements={activeEnergyValue:{},activeEnergySource:{}};
 const context=vm.createContext({document:{getElementById:id=>elements[id]}});
 vm.runInContext(script.slice(0,script.indexOf('function sorted()')),context);
 return {elements,run:code=>vm.runInContext(code,context)};
}
test('local midnight range and seven calendar days include DST changes',()=>{
 const {run}=setup();
 assert.equal(run(`(()=>{const now=new Date(2026,10,6,15,30),p=energyPeriod(now);return p.start.getHours()===0&&p.start.getDate()===6&&p.end.getTime()===now.getTime()})()`),true);
 assert.equal(run(`(()=>{const p=energyPeriod(new Date(2026,2,10,15),7);return p.start.getDate()===4&&p.start.getHours()===0})()`),true);
});
test('missing data differs from a genuine zero; invalid or duplicate totals are rejected',()=>{
 const {run}=setup();
 for(const totals of ['[]','[{date:"2026-11-05",kcal:420}]','[{date:"2026-11-06",kcal:-1}]','[{date:"2026-11-06",kcal:"420"}]','[{date:"2026-11-06",kcal:NaN}]','[{date:"2026-11-06",kcal:1},{date:"2026-11-06",kcal:2}]'])assert.equal(run(`energyValue(${totals},'2026-11-06')`),null);
 assert.equal(run(`energyValue([{date:'2026-11-06',kcal:0}],'2026-11-06')`),0);
});
test('unlinked, explicit sample and provider failure display without touching saved records',async()=>{
 const {run,elements}=setup();
 await run('refreshActiveEnergy()');assert.equal(elements.activeEnergyValue.textContent,'未連携');
 await run('energyProvider=energyProviders.sample;refreshActiveEnergy()');
 assert.equal(elements.activeEnergyValue.textContent,'420 kcal');assert.match(elements.activeEnergySource.textContent,/サンプルデータ.*実測値ではありません/);
 assert.equal(run('records.length'),0);
 assert.equal(await run('(async()=> (await energyProviders.sample.readDailyTotals(energyPeriod(new Date(),7))).length)()'),7);
 await run('energyProvider={readDailyTotals:async()=>{throw Error()}};refreshActiveEnergy()');
 assert.equal(elements.activeEnergyValue.textContent,'未連携');
});
test('an old request cannot overwrite a newer result; next local day clears old totals',async()=>{
 const {run,elements}=setup();
 run('var resolveOld;energyProvider={readDailyTotals:()=>new Promise(resolve=>{resolveOld=resolve})};var oldRequest=refreshActiveEnergy()');
 await run('energyProvider=energyProviders.sample;refreshActiveEnergy()');
 await run('resolveOld([]);oldRequest');assert.equal(elements.activeEnergyValue.textContent,'420 kcal');
 await run(`energyProvider={readDailyTotals:async()=>[{date:'2026-11-06',kcal:0}]};refreshActiveEnergy(new Date(2026,10,6,23,59))`);
 assert.equal(elements.activeEnergyValue.textContent,'0 kcal');
 await run('refreshActiveEnergy(new Date(2026,10,7,0,0))');assert.equal(elements.activeEnergyValue.textContent,'未連携');
});
test('complete inline script parses and the old card is removed',()=>{
 new vm.Script(script);
 assert.doesNotMatch(html,/直近7日の総ボリューム/);
 assert.match(html,/i===0\?energyCard\(\)/);
});