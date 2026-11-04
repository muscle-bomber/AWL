const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const helpers=script.slice(0,script.indexOf('function sorted()'));
const record={id:'demo-1',date:'2026-02-28',exercise:'ベンチプレス',part:'胸',place:'会社・昼トレ',pain:'なし',inflammation:'なし',weight:50,reps:10,sets:3,minutes:30,calories:0,condition:3,memo:'既存の記録'};
function setup(crypto=webcrypto){
  const storage=new Map(),alerts=[];
  const context=vm.createContext({crypto,Uint8Array,alert:m=>alerts.push(m),localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
  vm.runInContext(helpers+';function render(){}',context);
  return {context,storage,alerts,run:code=>vm.runInContext(code,context)};
}
test('calendar validation includes leap years and rejects overflow',()=>{
 const {run}=setup();
 for(const date of ['2026-02-28','2024-02-29','2000-02-29','0001-01-01'])assert.equal(run(`validDate('${date}')`),true,date);
 for(const date of ['2026-02-31','2026-02-29','1900-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','0000-01-01','2026-2-01'])assert.equal(run(`validDate('${date}')`),false,date);
 assert.equal(run(`valid(${JSON.stringify({...record,date:'2026-02-31'})})`),false);
});
test('native and fallback UUIDs are unique; collisions are retried',()=>{
 for(const crypto of [webcrypto,{getRandomValues:bytes=>webcrypto.getRandomValues(bytes)}]){
  const {run}=setup(crypto);const ids=new Set();
  for(let i=0;i<1000;i++){const id=run('createRecordId()');assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);ids.add(id)}
  assert.equal(ids.size,1000);
 }
 let calls=0;const {run}=setup({randomUUID:()=>++calls===1?'existing':'new'});
 assert.equal(run("createRecordId(new Set(['existing']))"),'new');
 assert.throws(()=>setup({randomUUID:()=> 'existing'}).run("createRecordId(new Set(['existing']))"));
 assert.throws(()=>setup({}).run('createRecordId()'),/HTTPS/);
});
test('missing, malformed and duplicate IDs are repaired without dropping records',()=>{
 const {run}=setup();const rows=[record,{...record},{...record,id:null},{...record,id:7},{...record,id:'  '},{...record,id:'legacy-custom'}];
 const normalized=JSON.parse(run(`JSON.stringify(normalizeIds(${JSON.stringify(rows)}))`));
 assert.equal(normalized.length,rows.length);assert.equal(new Set(normalized.map(r=>r.id)).size,rows.length);
 assert.equal(normalized[0].id,'demo-1');assert.equal(normalized[5].id,'legacy-custom');
 normalized.forEach((r,i)=>assert.deepEqual({...r,id:rows[i].id},rows[i]));
});
test('new IDs cannot steal valid IDs later in an import',()=>{
 let calls=0;const {run}=setup({randomUUID:()=>++calls===1?'reserved':'generated'});
 const rows=[{...record,id:null},{...record,id:'reserved'}];
 assert.deepEqual(JSON.parse(run(`JSON.stringify(normalizeIds(${JSON.stringify(rows)}).map(r=>r.id))`)),['generated','reserved']);
});
test('save/reload preserves legacy data and failure leaves memory and storage unchanged',()=>{
 const {context,run,storage,alerts}=setup();run(`commitRecords([${JSON.stringify(record)}])`);
 const before=storage.get('shiba-train-log-v1');run('records=[];load()');assert.equal(run('records[0].id'),'demo-1');
 context.localStorage.setItem=()=>{throw Error('quota')};
 for(const next of ['[]',JSON.stringify([{...record,id:'imported'}]),JSON.stringify([record,{...record,id:'new'}])]){
  assert.equal(run(`commitRecords(${next})`),false);
  assert.equal(run('JSON.stringify(records)'),before);assert.equal(storage.get('shiba-train-log-v1'),before);
 }
 assert.equal(alerts.length,3);
});
