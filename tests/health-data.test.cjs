const {test}=require('node:test');
const assert=require('node:assert/strict');
const health=require('../health-data.js');
function storage(raw=null){let value=raw;return {getItem:()=>value,setItem:(k,v)=>{value=v},read:()=>value}}
const time='2026-11-10T10:00:00Z';
const sample=(id,value=65)=>({id:'healthkit:'+id,metric:'bodyMass',value,unit:'kg',measuredAt:time,updatedAt:time,source:{kind:'healthkit',recordId:id}});
const batch=(previousAnchor,anchor,upserts=[],deletedRecordIds=[])=>({version:1,metric:'bodyMass',previousAnchor,anchor,upserts,deletedRecordIds,syncedAt:time});
test('manual records and HealthKit UUIDs remain separate; successive sync upserts do not duplicate',()=>{
 const m=health.create(storage());m.saveManual({recordId:'a',value:66,measuredAt:time,now:time});
 m.applyHealthKitBatch(batch(null,'1',[sample('a')]));m.applyHealthKitBatch(batch('1','2',[sample('a',64)]));
 assert.equal(m.snapshot().observations.length,2);assert.equal(m.snapshot().observations.find(o=>o.id==='healthkit:a').value,64);
 m.applyHealthKitBatch(batch('2','3',[],['a']));assert.equal(m.snapshot().observations.length,1);assert.equal(m.snapshot().observations[0].id,'manual:a');
});
test('invalid batch, stale cursor and conflicting deletions leave data and anchor unchanged',()=>{
 const m=health.create(storage());m.applyHealthKitBatch(batch(null,'1',[sample('a')]));const before=m.snapshot();
 for(const b of [batch(null,'2'),batch('1','2',[sample('b',NaN)]),batch('1','2',[sample('b')],['b']),batch('1','2',[sample('b'),sample('b')])]){
 assert.throws(()=>m.applyHealthKitBatch(b));assert.deepEqual(m.snapshot(),before);
 }
});
test('storage failure does not advance cursor or publish manual change',()=>{
 const s=storage(),m=health.create(s);s.setItem=()=>{throw Error('quota')};
 assert.throws(()=>m.applyHealthKitBatch(batch(null,'1',[sample('a')])));assert.deepEqual(m.snapshot(),health.empty());
 assert.throws(()=>m.saveManual({recordId:'x',value:65,measuredAt:time}));assert.deepEqual(m.snapshot(),health.empty());
});
test('unreadable saved data blocks writes without overwriting raw content',()=>{
 const s=storage('{broken'),m=health.create(s);assert.ok(m.error());assert.throws(()=>m.saveManual({recordId:'x',value:65,measuredAt:time}));assert.equal(s.read(),'{broken');
});
test('validate unit, numeric value and zoned timestamp; native observations cannot be manually edited',()=>{
 const m=health.create(storage());for(const change of [{unit:'lb'},{value:'65'},{value:0},{measuredAt:'2026-11-10T10:00'}])assert.throws(()=>m.applyHealthKitBatch(batch(null,'1',[{...sample('a'),...change}])));
 m.applyHealthKitBatch(batch(null,'1',[sample('a')]));assert.throws(()=>m.removeManual('healthkit:a'));assert.throws(()=>m.saveManual({id:'healthkit:a',value:66,measuredAt:time}));
});
test('manual edit preserves identity; backups round trip independently of workout storage',()=>{
 const s=storage(),m=health.create(s);m.saveManual({recordId:'x',value:65,measuredAt:time,now:time});m.saveManual({id:'manual:x',value:64,measuredAt:time,now:time});
 assert.equal(m.snapshot().observations.length,1);assert.equal(health.weights(m.snapshot())[0].value,64);assert.deepEqual(health.create(s).snapshot(),m.snapshot());
 const restored=health.create(storage());restored.replaceBackup(m.snapshot());assert.deepEqual(restored.snapshot(),m.snapshot());
 const bad=m.snapshot();bad.observations.push(bad.observations[0]);assert.throws(()=>restored.replaceBackup(bad));assert.deepEqual(restored.snapshot(),m.snapshot());
});