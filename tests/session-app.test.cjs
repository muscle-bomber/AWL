const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {webcrypto}=require('node:crypto');
const model=require('../training-data.js'),voice=require('../voice-input.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const appScript=fs.readFileSync(path.join(__dirname,'../session-app.js'),'utf8'),voiceUI=fs.readFileSync(path.join(__dirname,'../voice-ui.js'),'utf8');
const old={id:'old',date:'2026-11-09',place:'会社・昼トレ',exercise:'ベンチプレス',part:'胸',weight:80,reps:10,sets:1,minutes:40,condition:4,pain:'軽い',inflammation:'なし',memo:'肩を確認',calories:0,sessionId:'old-lunch',sessionMinutes:40,schemaVersion:2};
function setup(input=[],sharedStorage=null){
 const storage=sharedStorage||new Map([['shiba-train-log-v1',JSON.stringify(input)]]),alerts=[],nodes=new Map(),downloads=[];
 function node(){const children=new Map();return {value:'',innerHTML:'',textContent:'',disabled:false,dataset:{},events:{},addEventListener(name,fn){(this.events[name]??=[]).push(fn)},querySelector(key){if(!children.has(key))children.set(key,node());return children.get(key)},querySelectorAll(){return []},focus(){}}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 get('groupBy').value='day';get('filterPlace').value='all';get('entryForm').querySelector('[name=date]').value='2026-11-09';
 const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const context=vm.createContext({ShibaTraining:model,ShibaVoice:voice,crypto:webcrypto,Uint8Array,localStorage,alert:message=>alerts.push(message),document:{getElementById:get}});
 const run=code=>vm.runInContext(code,context),json=code=>JSON.parse(run(`JSON.stringify(${code})`));
 run(script.slice(0,script.indexOf('function sorted()'))+';function render(){renderHistory()}');
 run(script.slice(script.indexOf('function renderHistory()'),script.indexOf('function renderAI()')));run(appScript);
 context.downloadCapture=(...args)=>downloads.push(args);
 run("sessionApp=ShibaSessionApp.create({storage:localStorage,document,esc,fmt,valid,createId:used=>createRecordId(used),cards:()=>historyCards(),week:isoWeek,today:()=> '2026-11-10',dayDiff,alert,download:downloadCapture,publish:next=>{records=next;renderHistory()}});sessionApp.install();load()");
 return {run,json,get,context,storage,localStorage,alerts,downloads};
}
function add(app,fields,sets){app.context.fields=fields;app.context.sets=sets;assert.equal(app.run('commitRecords(buildSetRecords(fields,sets))'),true,app.alerts.join('\n'))}
const fields={date:'2026-11-09',place:'会社・昼トレ',minutes:'40',condition:'4',exercise:'ベンチプレス',part:'胸',memo:'右肩に違和感あり'};
test('real adapter stores three levels, differing weights and shared memo/condition once',()=>{
 const app=setup();add(app,fields,[{weight:'80',reps:'10',sets:'1'},{weight:'75',reps:'8',sets:'2'}]);
 const stored=JSON.parse(app.storage.get(model.KEY)),session=stored.sessions[0],exercise=session.exercises[0];
 assert.equal(session.minutes,40);assert.equal(session.condition,4);assert.equal(exercise.memo,fields.memo);assert.equal(exercise.sets.length,2);
 assert.deepEqual(exercise.sets.map(r=>[r.weight,r.reps,r.sets]),[[80,10,1],[75,8,2]]);
 assert.ok(exercise.sets.every(r=>!('condition' in r)&&!('memo' in r)&&!('minutes' in r)));
 app.run('renderHistory()');const rendered=app.get('historyList').innerHTML;
 assert.equal((rendered.match(/右肩に違和感あり/g)||[]).length,1);assert.equal((rendered.match(/体調4\/5/g)||[]).length,1);
 assert.equal(app.run("dailyMinutes('2026-11-09')"),40);assert.equal(app.storage.get('shiba-train-log-v1'),'[]');
});
test('same exercise added to an existing session stays one card; another session/place stays separate',()=>{
 const app=setup();add(app,fields,[{weight:'80',reps:'10',sets:'1'}]);const id=app.run('records[0].sessionId');
 add(app,{...fields,sessionId:id,minutes:'999',condition:'1',memo:'後半は重量を落とした'},[{weight:'75',reps:'8',sets:'2'}]);
 assert.equal(app.run('historyCards().length'),1);assert.equal(app.run('records[1].condition'),4);assert.equal(app.run("dailyMinutes('2026-11-09')"),40);
 add(app,{...fields,place:'自宅・自重',minutes:'20',condition:'2'},[{weight:'60',reps:'8',sets:'1'}]);
 assert.equal(app.run('historyCards().length'),2);assert.equal(app.run("dailyMinutes('2026-11-09')"),60);
 app.context.fields={...fields,sessionId:id,place:'自宅・自重'};app.context.sets=[{weight:'50',reps:'10',sets:1}];assert.throws(()=>app.run('buildSetRecords(fields,sets)'));
 app.get('filterPlace').value='自宅・自重';app.run('renderHistory()');assert.equal((app.get('historyList').innerHTML.match(/<article /g)||[]).length,1);
 app.get('groupBy').value='week';app.run('renderHistory()');assert.match(app.get('historyList').innerHTML,/の週/);
});
test('legacy loading never merges by date or writes storage; all conflicting originals remain visible',()=>{
 const input=[{...old,sessionId:undefined},{...old,id:'home',sessionId:undefined,place:'自宅・自重',condition:2,memo:'疲労あり'}];const app=setup(input);
 assert.equal(app.run('sessionApp.getDocument().pending.length'),2);assert.equal(app.storage.has(model.KEY),false);
 assert.equal(app.storage.get('shiba-train-log-v1'),JSON.stringify(input));app.run('renderHistory()');
 assert.match(app.get('migrationPanel').innerHTML,/要確認/);assert.match(app.get('migrationPanel').innerHTML,/疲労あり/);
 assert.deepEqual(app.json('records.map(r=>r.id)'),['old','home']);
});
test('an old random session ID alone is insufficient evidence after the previous date-based migration',()=>{
 const app=setup([{...old,schemaVersion:undefined},{...old,id:'two',schemaVersion:undefined,minutes:0}]);
 assert.equal(app.run('sessionApp.getDocument().pending.length'),2);assert.equal(app.run('sessionApp.getDocument().sessions.length'),0);assert.equal(app.storage.has(model.KEY),false);
});
test('migration screen resolves selected records only after confirmation fields and storage succeed',()=>{
 const input=[{...old,sessionId:undefined},{...old,id:'second',minutes:20,condition:2,sessionId:undefined,memo:'疲労あり'}],app=setup(input),panel=app.get('migrationPanel');
 app.run('renderHistory()');panel.querySelectorAll=()=>input.map(r=>({dataset:{migrateId:r.id}}));
 for(const [key,value] of Object.entries({date:old.date,place:old.place,minutes:'60',condition:'3'}))panel.querySelector(`[data-migration-field="${key}"]`).value=value;
 const click=()=>panel.events.click[0]({target:{closest:()=>({dataset:{modelAction:'resolve'}})}});
 const write=app.localStorage.setItem;app.localStorage.setItem=()=>{throw Error('quota')};click();assert.equal(app.run('sessionApp.getDocument().pending.length'),2);assert.equal(panel.querySelector('[data-migration-field="minutes"]').value,'60');
 app.localStorage.setItem=write;click();assert.equal(app.run('sessionApp.getDocument().pending.length'),0);assert.equal(app.run('records[0].condition'),3);
 assert.deepEqual(app.json('records.map(r=>r.id)'),['old','second']);assert.equal(app.storage.get('shiba-train-log-v1'),JSON.stringify(input));
 const archive=app.json('sessionApp.getDocument().legacyArchive');assert.deepEqual(archive,JSON.parse(JSON.stringify(input)));
});
test('reload, normalized JSON and old-format JSON restore preserve IDs and shared information',()=>{
 const app=setup([old,{...old,id:'second',minutes:0,weight:75}]);
 const before=app.json('records.map(r=>r.id)');app.run('save()');const backup=app.run('JSON.stringify(sessionApp.getDocument())');
 const reloaded=setup([],app.storage);assert.deepEqual(reloaded.json('records.map(r=>r.id)'),before);
 reloaded.context.backup=backup;assert.equal(reloaded.run('sessionApp.importData(JSON.parse(backup))'),true);
 const legacyView=app.json('records');reloaded.context.flat=legacyView;assert.equal(reloaded.run('sessionApp.importData(flat)'),true);
 assert.equal(reloaded.run('sessionApp.getDocument().sessions[0].minutes'),40);assert.equal(reloaded.run('sessionApp.getDocument().sessions[0].condition'),4);
});
test('history edit keeps IDs, edits one common memo, changes session condition once and maintains volume',()=>{
 const app=setup();add(app,fields,[{weight:'80',reps:'10',sets:'1'},{weight:'75',reps:'8',sets:'2'}]);const ids=app.json('records.map(r=>r.id)');
 app.run("var card=historyCards()[0];var draft={exercise:'ベンチプレス',part:'胸',memo:'修正した共通メモ',rows:card.rows.map(r=>({...r,weight:'70'}))};commitRecords(editedCardRecords(card.id,draft))");
 assert.deepEqual(app.json('records.map(r=>r.id)'),ids);assert.equal(app.run("records.reduce((n,r)=>n+volume(r),0)"),1820);
 app.run("var changes=timeDraftForDate('2026-11-09');changes[0].condition='2';changes[0].minutes='35';commitRecords(editedTimeRecords('2026-11-09',changes))");
 assert.equal(app.run('records[0].condition'),2);assert.equal(app.run('records[1].condition'),2);assert.equal(app.run("dailyMinutes('2026-11-09')"),35);
 app.run('renderHistory()');assert.equal((app.get('historyList').innerHTML.match(/修正した共通メモ/g)||[]).length,1);
});
test('new model storage failure retains existing data and permits retry; corrupt v2 is not overwritten',()=>{
 const app=setup();const before=app.storage.get('shiba-train-log-v1');app.localStorage.setItem=()=>{throw Error('quota')};
 app.context.fields=fields;app.context.sets=[{weight:'80',reps:'10',sets:'1'}];assert.equal(app.run('commitRecords(buildSetRecords(fields,sets))'),false);assert.equal(app.run('records.length'),0);assert.equal(app.storage.get('shiba-train-log-v1'),before);
 const storage=new Map([[model.KEY,'broken'],['shiba-train-log-v1',JSON.stringify([old])]]),broken=setup([],storage);assert.equal(broken.run('save([])'),false);assert.equal(storage.get(model.KEY),'broken');
});
test('new-model card ordering survives reload and cannot move an exercise to another session',()=>{
 const app=setup();add(app,fields,[{weight:'80',reps:'10',sets:'1'}]);const sessionId=app.run('records[0].sessionId');
 add(app,{...fields,sessionId,exercise:'スクワット',part:'脚'},[{weight:'60',reps:'8',sets:'2'}]);
 const before=app.json('historyCards().map(c=>c.id)');app.context.order=before;assert.equal(app.run("commitRecords(reorderedCards(order[1],order[0],'before'))"),true);
 app.run('load()');assert.deepEqual(app.json('historyCards().map(c=>c.exercise)'),['スクワット','ベンチプレス']);
 add(app,{...fields,place:'自宅・自重',minutes:'20',condition:'2'},[{weight:'40',reps:'8',sets:'1'}]);
 app.run('var cards=historyCards()');assert.equal(app.run('reorderedCards(cards[0].id,cards[2].id)'),null);
});
test('session condition averages do not change when one session has more set rows',()=>{
 const app=setup();add(app,fields,[{weight:'80',reps:'10',sets:'1'}]);const first=app.run('records[0].sessionId');
 add(app,{...fields,place:'自宅・自重',condition:'2',minutes:'20'},[{weight:'50',reps:'8',sets:'1'}]);assert.equal(app.run('sessionApp.averageCondition()'),3);
 add(app,{...fields,sessionId:first},[{weight:'75',reps:'8',sets:'2'},{weight:'70',reps:'8',sets:'1'}]);assert.equal(app.run('sessionApp.averageCondition()'),3);
});
test('pending old-format JSON can be restored then saved without merging or changing IDs',()=>{
 const source={...old,schemaVersion:undefined,sessionId:undefined},app=setup([source]);
 const flat=app.json('records');app.context.flat=flat;assert.equal(app.run('sessionApp.importData(flat)'),true);app.run('records=sessionApp.rows()');
 assert.equal(app.run('sessionApp.getDocument().pending.length'),1);assert.equal(app.run('save()'),true);assert.equal(app.run('records[0].id'),'old');
});
test('different old body parts require an explicit common part and all originals remain archived',()=>{
 const source=[{...old,sessionId:undefined},{...old,id:'two',sessionId:undefined,part:'肩'}],app=setup(source);app.context.selected=['old','two'];
 app.context.chosen={date:old.date,place:old.place,minutes:'40',condition:'4'};
 assert.throws(()=>app.run("ShibaTraining.resolvePending(sessionApp.getDocument(),selected,chosen,'confirmed')"));
 app.context.chosen.parts={'ベンチプレス':'胸'};
 const next=app.json("ShibaTraining.resolvePending(sessionApp.getDocument(),selected,chosen,'confirmed')");assert.equal(next.sessions[0].exercises[0].part,'胸');assert.equal(next.legacyArchive[1].part,'肩');
});
test('new-model history edits retain draft on save failure and render common memo once after retry',()=>{
 const app=setup();add(app,fields,[{weight:'80',reps:'10',sets:'1'},{weight:'75',reps:'8',sets:'2'}]);
 app.run("function clearHistoryDrag(){};openHistoryEditor('card',historyCards()[0].id);historyEditor.draft.memo='新しい共通メモ';historyEditor.draft.rows[0].weight='70'");
 const saved=app.storage.get(model.KEY),write=app.localStorage.setItem;app.localStorage.setItem=()=>{throw Error('quota')};assert.equal(app.run('finishHistoryEdit()'),false);
 assert.equal(app.run('historyEditor.draft.memo'),'新しい共通メモ');assert.equal(app.storage.get(model.KEY),saved);
 app.localStorage.setItem=write;assert.equal(app.run('finishHistoryEdit()'),true);assert.equal(app.run('historyEditor'),null);assert.equal((app.get('historyList').innerHTML.match(/新しい共通メモ/g)||[]).length,1);
});
test('voice text assigns symptom tail to exercise memo and session condition to shared context',()=>{
 const parsed=voice.parseSessionExercise('ベンチプレス80キロ10回1セット、75キロ8回2セット、右肩に違和感あり');
 assert.equal(parsed.exercise,'ベンチプレス');assert.match(parsed.memo,/右肩に違和感あり/);assert.equal(parsed.rows.length,2);
 const app=setup();app.context.draft={version:1,batchId:'batch',context:{date:old.date,place:old.place,minutes:'40',condition:'4',sessionId:''},text:'',consumed:true,items:[{...parsed,id:'pending'}]};
 app.run('var batch=sessionApp.voiceBatch(draft);commitRecords(batch.next)');
 assert.equal(app.run('sessionApp.getDocument().sessions[0].condition'),4);assert.equal(app.run("dailyMinutes('2026-11-09')"),40);assert.equal(app.run('sessionApp.getDocument().sessions[0].exercises[0].sets.length'),2);
});
test('voice UI uses one condition field and no pain inputs, preserves drafts and retries a failed batch save',()=>{
 const app=setup();app.run(voiceUI);const panel=app.get('voiceInputRoot'),events=panel.events;
 const services=app.run('({valid,validDate,createId:createRecordId,sessions:sessionsForDate,sorted:historySorted,sessionModel:true,buildSessionBatch:draft=>sessionApp.voiceBatch(draft)})');
 const start=()=>app.context.ShibaVoiceUI.init({document:app.context.document,storage:app.localStorage,services,getRecords:()=>app.run('records'),commit:next=>{app.context.next=next;return app.run('commitRecords(next)')},today:()=>old.date,confirm:()=>true});let ui=start();
 const input=(dataset,value,text=false)=>events.input.at(-1)({target:{dataset,value,hasAttribute:key=>text&&key==='data-voice-text',closest:()=>null}});
 input({voiceContext:'minutes'},'40');input({voiceContext:'condition'},'4');input({},'ベンチプレス80キロ10回1セット、75キロ8回2セット、右肩に違和感あり',true);ui.analyze();
 assert.doesNotMatch(panel.innerHTML,/data-voice-field="(?:condition|pain|inflammation)"/);assert.equal((panel.innerHTML.match(/data-voice-context="condition"/g)||[]).length,1);
 ui=start();assert.equal(ui.getState().items.length,1);ui.review();const write=app.localStorage.setItem;app.localStorage.setItem=(key,value)=>{if(key===model.KEY)throw Error('quota');write(key,value)};
 ui.saveAll();assert.equal(ui.getState().items.length,1);assert.equal(app.run('records.length'),0);app.localStorage.setItem=write;ui.saveAll();assert.equal(app.run('records.length'),2);
 assert.equal(app.storage.has(voice.DRAFT_KEY),false);assert.equal(app.run("dailyMinutes('2026-11-09')"),40);
});
test('previous voice draft condition variants are retained and never silently selected for a session',()=>{
 const pending=voice.newDraft('old-voice',{date:old.date,place:old.place,minutes:'40',sessionId:''});
 pending.items=[{...voice.parse('ベンチプレス80キロ10回1セット'),id:'draft-one',condition:'4',pain:'軽い',inflammation:'なし'},{...voice.parse('スクワット60キロ8回2セット'),id:'draft-two',condition:'2',pain:'なし',inflammation:'なし'}];
 const storage=new Map([[voice.DRAFT_KEY,JSON.stringify(pending)],['shiba-train-log-v1','[]']]),app=setup([],storage);app.run(voiceUI);
 const services=app.run('({sessionModel:true,createId:createRecordId,sessions:sessionsForDate,buildSessionBatch:draft=>sessionApp.voiceBatch(draft)})');
 const ui=app.context.ShibaVoiceUI.init({document:app.context.document,storage:app.localStorage,services,getRecords:()=>app.run('records'),commit:()=>false,today:()=>old.date,confirm:()=>true});
 assert.equal(ui.getState().context.condition,'');assert.deepEqual(JSON.parse(JSON.stringify(ui.getState().legacyDraft)),JSON.parse(JSON.stringify(pending)));assert.match(app.get('voiceInputRoot').innerHTML,/旧下書きの体調：4/);assert.match(ui.getState().items[0].memo,/軽い/);
});
test('full application startup connects new storage, manual controls, CSV, summary and JSON restore',async()=>{
 const storage=new Map(),nodes=new Map(),alerts=[],captures=[];
 function node(){const inputs=new Map();return {value:'',children:[],dataset:{},disabled:false,innerHTML:'',events:{},classList:{toggle(){}},addEventListener(name,fn){(this.events[name]??=[]).push(fn)},querySelector(s){if(!inputs.has(s))inputs.set(s,node());return inputs.get(s)},querySelectorAll(){return this.children},append(row){this.children.push(row)},get lastElementChild(){return this.children.at(-1)}}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},form=get('entryForm');
 get('groupBy').value='day';get('filterPlace').value='all';get('nextPlace').value=old.place;get('nextMinutes').value='30';
 const fieldsByName={date:old.date,place:old.place,minutes:'40',condition:'4',exercise:'ベンチプレス',part:'胸',memo:'共通メモ',sessionId:'',calories:''};
 const context=vm.createContext({ShibaTraining:model,crypto:webcrypto,Uint8Array,alert:m=>alerts.push(m),confirm:()=>true,setTimeout(){},clearTimeout(){},setInterval(){},document:{getElementById:get,createElement:node,querySelector:s=>form.querySelector(s),querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},FormData:class{constructor(){return Object.keys(fieldsByName).filter(name=>!form.querySelector(`[name=${name}]`).disabled).map(name=>[name,form.querySelector(`[name=${name}]`).value])}}});
 const run=code=>vm.runInContext(code,context);run(appScript);run(script);
 for(const [name,value] of Object.entries(fieldsByName))form.querySelector(`[name=${name}]`).value=value;
 // Session select is addressed by ID in the actual DOM.
 nodes.set('sessionSelect',form.querySelector('[name=sessionId]'));
 const row=get('setRows').children[0];row.querySelector('[data-weight]').value='80';row.querySelector('[data-reps]').value='10';row.querySelector('[data-sets]').value='1';
 form.onsubmit({preventDefault(){},target:form});assert.equal(run('records.length'),1,alerts.join('\n'));assert.equal(form.querySelector('[name=condition]').disabled,true);assert.equal(form.querySelector('[name=place]').disabled,true);
 form.onsubmit({preventDefault(){},target:form});assert.equal(run('records.length'),2,alerts.join('\n'));assert.equal(run("dailyMinutes('2026-11-09')"),40);
 context.capture=(...args)=>captures.push(args);run('download=(...args)=>capture(...args)');get('csv').onclick();assert.match(captures.at(-1)[1],/sessionId,exerciseId/);
 get('export').onclick();const backup=captures.at(-1)[1];assert.equal(JSON.parse(backup).version,2);get('exportLegacy').onclick();assert.ok(Array.isArray(JSON.parse(captures.at(-1)[1])));
 assert.equal((get('summary').value.match(/共通メモ/g)||[]).length,1);assert.equal((get('summary').value.match(/体調4\/5/g)||[]).length,1);
 await get('import').onchange({target:{files:[{text:async()=>backup}],value:'backup'}});assert.equal(run('records.length'),2);assert.equal(run("dailyMinutes('2026-11-09')"),40);
});
