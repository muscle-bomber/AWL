const {test}=require('node:test');
const assert=require('node:assert/strict');
const data=require('../training-data.js');
const row={id:'one',date:'2026-11-09',place:'会社・昼トレ',exercise:'ベンチプレス',part:'胸',weight:80,reps:10,sets:1,minutes:40,condition:4,pain:'軽い',inflammation:'なし',memo:'右肩に違和感あり',calories:0,sessionId:'lunch',sessionMinutes:40,custom:'original',schemaVersion:2};
test('three-level storage keeps session information once, exercise memo once, and original set IDs',()=>{
 const rows=[row,{...row,id:'two',weight:75,reps:8,sets:2,minutes:0}];const before=JSON.stringify(rows),doc=data.migrateLegacy(rows);
 assert.equal(doc.sessions.length,1);const session=doc.sessions[0],exercise=session.exercises[0];
 assert.equal(session.minutes,40);assert.equal(session.condition,4);assert.equal(exercise.sets.length,2);
 assert.deepEqual(exercise.sets.map(s=>s.id),['one','two']);assert.equal((exercise.memo.match(/右肩に違和感あり/g)||[]).length,1);
 assert.equal('condition' in exercise.sets[0],false);assert.equal('minutes' in exercise.sets[0],false);assert.equal('memo' in exercise.sets[0],false);
 assert.deepEqual(doc.legacyArchive,rows);assert.equal(JSON.stringify(rows),before);
});
test('same date never merges records without an explicit reliable session ID',()=>{
 const records=[{...row,sessionId:undefined},{...row,id:'two',place:'自宅・自重',sessionId:undefined,condition:2}];
 const doc=data.migrateLegacy(records);assert.equal(doc.sessions.length,0);assert.equal(doc.pending.length,2);assert.equal(doc.pending[0].record.id,'one');
});
test('conflicting session fields and possible earlier date-only merges remain pending',()=>{
 for(const change of [{condition:2},{place:'自宅・自重'},{minutes:30},{sessionMinutes:50}]){
 const doc=data.migrateLegacy([row,{...row,id:'two',minutes:0,...change}]);assert.equal(doc.pending.length,2);assert.equal(doc.sessions.length,0);
 }
});
test('same date has separate lunch and evening sessions and separate exercise cards',()=>{
 const doc=data.migrateLegacy([row,{...row,id:'evening',sessionId:'night',place:'自宅・自重',minutes:20,sessionMinutes:20,condition:2}]);
 assert.equal(doc.sessions.length,2);assert.deepEqual(doc.sessions.map(s=>s.place),['会社・昼トレ','自宅・自重']);assert.equal(data.toRecords(doc).length,2);
});
test('confirmed resolution retains every original field in archive and preserves differing notes',()=>{
 const records=[{...row,sessionId:undefined},{...row,id:'two',minutes:20,condition:2,sessionId:undefined,memo:'疲労あり',pain:'強い'}];
 const doc=data.migrateLegacy(records),next=data.resolvePending(doc,['one','two'],{date:row.date,place:row.place,minutes:60,condition:3},'confirmed-session');
 assert.equal(doc.pending.length,2);assert.equal(next.pending.length,0);assert.deepEqual(next.legacyArchive,JSON.parse(JSON.stringify(records)));
 assert.match(next.sessions[0].exercises[0].memo,/疲労あり/);assert.match(next.sessions[0].exercises[0].memo,/強い/);assert.deepEqual(next.sessions[0].exercises[0].sets.map(s=>s.id),['one','two']);
});
test('flat compatibility view and normalized round trip do not duplicate notes or session values',()=>{
 const doc=data.migrateLegacy([row,{...row,id:'two',minutes:0}]);const flat=data.toRecords(doc),next=data.fromRecords(flat,doc);
 assert.equal(next.sessions[0].exercises[0].memo,doc.sessions[0].exercises[0].memo);
 assert.equal(flat.reduce((n,r)=>n+r.minutes,0),40);assert.equal(flat[0].custom,'original');
 assert.deepEqual(data.toRecords(data.validate(JSON.parse(JSON.stringify(next)))).map(r=>r.id),['one','two']);
});
test('invalid IDs and unsafe field conflicts are rejected without changing input',()=>{
 assert.throws(()=>data.migrateLegacy([row,{...row}]));
 const doc=data.migrateLegacy([row]),before=JSON.stringify(doc),flat=data.toRecords(doc);flat.push({...flat[0],id:'new',condition:2});
 assert.throws(()=>data.fromRecords(flat,doc));assert.equal(JSON.stringify(doc),before);
});
