const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const api=require('../voice-input.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ui=fs.readFileSync(path.join(__dirname,'../voice-ui.js'),'utf8');
const first='ベンチプレス60キロ10回3セット、70キロ8回2セット、体調3、痛みなし、炎症なし';
const second='スクワット80キロ8回3セット、体調4、痛み軽い、炎症なし、メモフォームを確認';
const legacy={id:'existing-id',date:'2026-11-08',exercise:'腕立て伏せ',part:'胸',place:'自宅・自重',weight:0,reps:10,sets:3,minutes:20,calories:0,condition:3,pain:'なし',inflammation:'なし',memo:'元の記録',custom:'keep'};
function setup(storage=new Map()){
 const events={},status={textContent:''},review={innerHTML:''},raw={focus(){}},panel={innerHTML:'',querySelector:s=>s==='[data-voice-status]'?status:s==='[data-voice-review]'?review:raw,addEventListener:(key,fn)=>events[key]=fn};
 const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const context=vm.createContext({crypto:webcrypto,Uint8Array,localStorage,alert(){},ShibaVoice:api,document:{getElementById:id=>id==='voiceInputRoot'?panel:null}});
 const run=code=>vm.runInContext(code,context);
 run(inline.slice(0,inline.indexOf('function sorted()'))+';function render(){}');run(ui);
 if(!storage.has('shiba-train-log-v1'))storage.set('shiba-train-log-v1',JSON.stringify([legacy]));run('load()');
 const services=run('({valid,validDate,createId:createRecordId,sessions:sessionsForDate,sorted:historySorted})');
 const start=()=>context.ShibaVoiceUI.init({document:context.document,storage:localStorage,services,getRecords:()=>run('records'),commit:next=>{context.proposed=next;return run('commitRecords(proposed)')},today:()=> '2026-11-09',confirm:()=>true,isHistoryEditing:()=>false});
 let controller=start();
 const input=(dataset,value,item=null,row=null,text=false)=>events.input({target:{dataset,value,hasAttribute:key=>text&&key==='data-voice-text',closest:key=>key==='[data-voice-item]'&&item!==null?{dataset:{voiceItem:String(item)}}:key==='[data-voice-row]'&&row!==null?{dataset:{voiceRow:String(row)}}:null}});
 const click=(action,index,row)=>events.click({target:{closest:()=>({dataset:{voiceAction:action,index:String(index),row:String(row)}})}});
 const say=text=>{input({},text,null,null,true);click('analyze')};
 return {storage,localStorage,panel,status,context,run,services,events,input,click,say,start,get controller(){return controller},restore(){controller=start();return controller}};
}
test('voice text parser extracts one exercise and multiple weight/repetition/set configurations',()=>{
 const parsed=api.parse('ベンチプレス60キロ10回3セット、70キロ8回2セット');
 assert.equal(parsed.exercise,'ベンチプレス');assert.equal(parsed.part,'胸');
 assert.deepEqual(parsed.rows,[{weight:'60',reps:'10',sets:'3'},{weight:'70',reps:'8',sets:'2'}]);
 assert.equal(parsed.unparsed,'');assert.equal(parsed.condition,'');assert.equal(parsed.pain,'');assert.equal(parsed.inflammation,'');
});
test('normalization supports full-width digits, kg, decimal weights and explicit Japanese numerals',()=>{
 const parsed=api.parse('ベンチプレス６０．５ｋｇ×１０回×３セット、七十キロ八回二セット、体調4、痛み軽い、炎症なし、メモ次回も丁寧に');
 assert.deepEqual(parsed.rows,[{weight:'60.5',reps:'10',sets:'3'},{weight:'70',reps:'8',sets:'2'}]);
 assert.equal(parsed.condition,'4');assert.equal(parsed.pain,'軽い');assert.equal(parsed.inflammation,'なし');assert.equal(parsed.memo,'次回も丁寧に');
 assert.equal(api.parse('腕立て伏せ自重10回3セット').rows[0].weight,'0');
});
test('unknown or missing information is not invented and original text is preserved',()=>{
 const source='謎の運動60キロ10回、痛み右肩、疲れた';const parsed=api.parse(source);
 assert.equal(parsed.source,source);assert.equal(parsed.part,'');assert.equal(parsed.rows[0].sets,'');assert.equal(parsed.pain,'');assert.match(parsed.unparsed,/痛み右肩/);
 const memo=api.parse('ベンチプレス60キロ10回3セット、メモスクワット100キロは次回');
 assert.equal(memo.multipleExercises,false);assert.equal(memo.rows.length,1);assert.equal(memo.memo,'スクワット100キロは次回');
});
test('multiple exercises in one utterance are rejected and remain in the input',()=>{
 const app=setup();const text='ベンチプレス60キロ10回3セット、スクワット80キロ8回3セット';
 app.say(text);assert.equal(app.controller.getState().items.length,0);assert.equal(app.controller.getState().text,text);assert.match(app.status.textContent,/1回につき1種目/);
});
test('pending exercises can be added, edited, reparsed and deleted without changing confirmed records',()=>{
 const app=setup(),before=app.storage.get('shiba-train-log-v1');app.input({voiceContext:'minutes'},'45');app.say(first);app.click('analyze');assert.equal(app.controller.getState().items.length,1);
 app.click('next');app.say(second);assert.equal(app.controller.getState().items.length,2);
 app.input({voiceNumber:'reps'},'6',0,1);assert.equal(app.controller.getState().items[0].rows[1].reps,'6');
 app.input({voiceField:'source'},first.replace('60キロ','65キロ'),0);app.controller.review();assert.match(app.status.textContent,/再解析/);
 app.click('reparse',0);assert.equal(app.controller.getState().items[0].rows[0].weight,'65');
 app.click('add-row',0);assert.equal(app.controller.getState().items[0].rows.length,3);app.click('remove-row',0,2);assert.equal(app.controller.getState().items[0].rows.length,2);
 app.click('remove',1);assert.equal(app.controller.getState().items.length,1);assert.equal(app.storage.get('shiba-train-log-v1'),before);
});
test('review and explicit batch save commit all exercises once with one session duration',()=>{
 const app=setup();app.input({voiceContext:'minutes'},'45');app.say(first);app.click('next');app.say(second);
 app.controller.saveAll();assert.equal(app.run('records.length'),1); // Review is required.
 app.controller.review();assert.match(app.panel.innerHTML,/一括保存前の最終確認/);assert.equal(app.run('records.length'),1);
 app.input({voiceNumber:'weight'},'62.5',0,0);app.controller.saveAll();assert.equal(app.run('records.length'),1);app.controller.review();
 app.controller.saveAll();assert.equal(app.run('records.length'),4);assert.equal(app.run("dailyMinutes('2026-11-09')"),45);
 assert.equal(app.run("records.filter(r=>r.date==='2026-11-09').reduce((n,r)=>n+r.minutes,0)"),45);
 assert.equal(app.run("new Set(records.filter(r=>r.date==='2026-11-09').map(r=>r.sessionId)).size"),1);
 assert.equal(app.storage.has(api.DRAFT_KEY),false);assert.deepEqual(JSON.parse(app.run("JSON.stringify(records.find(r=>r.id==='existing-id'))")),legacy);
 const backup=app.run('JSON.stringify(records)');app.run('records=[];load()');assert.equal(app.run('JSON.stringify(records)'),backup);
 app.context.backup=backup;app.run('records=normalizeIds(JSON.parse(backup))');assert.equal(app.run("dailyMinutes('2026-11-09')"),45);
 // The next batch can reuse the same session without adding its duration again.
 app.say(second);app.controller.review();app.controller.saveAll();assert.equal(app.run("dailyMinutes('2026-11-09')"),45);
});
test('raw text, context and edited pending items survive a Safari-style reload',()=>{
 const app=setup();app.input({voiceContext:'minutes'},'50');app.say(first);app.input({voiceNumber:'weight'},'62.5',0,0);app.click('next');app.input({},'まだ解析していない文章',null,null,true);
 const restored=setup(app.storage);const state=restored.controller.getState();assert.equal(state.context.minutes,'50');assert.equal(state.items[0].rows[0].weight,'62.5');assert.equal(state.text,'まだ解析していない文章');
 assert.equal(restored.run('records.length'),1);assert.match(restored.panel.innerHTML,/前回の未保存データを復元/);
});
test('confirmed-save failure preserves pending data and a reload can retry without duplicates',()=>{
 const app=setup();app.input({voiceContext:'minutes'},'40');app.say(first);app.controller.review();
 const write=app.localStorage.setItem;app.localStorage.setItem=(key,value)=>{if(key==='shiba-train-log-v1')throw Error('quota');write(key,value)};
 app.controller.saveAll();assert.equal(app.run('records.length'),1);assert.equal(app.controller.getState().items.length,1);assert.equal(app.storage.has(api.DRAFT_KEY),true);assert.match(app.status.textContent,/保存に失敗/);
 const restored=setup(app.storage);restored.controller.review();restored.controller.saveAll();assert.equal(restored.run('records.length'),3);assert.equal(restored.run("dailyMinutes('2026-11-09')"),40);
});
test('draft-cleanup failure and subsequent reload cannot register a saved batch twice',()=>{
 const app=setup();app.input({voiceContext:'minutes'},'30');app.say(second);app.controller.review();app.localStorage.removeItem=()=>{throw Error('blocked')};app.controller.saveAll();
 assert.equal(app.run('records.length'),2);assert.equal(app.storage.has(api.DRAFT_KEY),true);app.controller.saveAll();assert.equal(app.run('records.length'),2);
 const restored=setup(app.storage);assert.equal(restored.run('records.length'),2);assert.equal(restored.storage.has(api.DRAFT_KEY),false);assert.equal(restored.controller.getState().items.length,0);
});
test('unparsed text is retained in confirmed records and review edits require another confirmation',()=>{
 const app=setup();app.input({voiceContext:'minutes'},'30');app.say(first+'、ゆっくり行った');
 assert.match(app.controller.getState().items[0].unparsed,/ゆっくり/);
 app.controller.review();app.controller.saveAll();
 assert.match(app.run('records.at(-1).voiceUnparsed'),/ゆっくり/);assert.equal(app.run('records.at(-1).voiceSource'),first+'、ゆっくり行った');
});
test('missing values, unadded input and invalid dates never write confirmed records',()=>{
 const app=setup(),before=app.storage.get('shiba-train-log-v1');app.say('ベンチプレス60キロ10回');app.input({voiceContext:'minutes'},'30');app.controller.review();assert.match(app.status.textContent,/確認|未入力/);
 app.click('next');app.input({},'スクワットまだ追加していない',null,null,true);app.controller.review();assert.match(app.status.textContent,/未追加/);assert.equal(app.storage.get('shiba-train-log-v1'),before);
 app.click('next');app.input({voiceContext:'date'},'2026-02-31');app.controller.review();assert.match(app.status.textContent,/日付/);assert.equal(app.storage.get('shiba-train-log-v1'),before);
});
test('draft storage failure preserves visible input; malformed drafts are retained without overwriting',()=>{
 const app=setup();app.localStorage.setItem=()=>{throw Error('quota')};app.input({},'ベンチプレス60キロ',null,null,true);assert.equal(app.controller.getState().text,'ベンチプレス60キロ');assert.match(app.status.textContent,/一時保存できません/);
 const storage=new Map([[api.DRAFT_KEY,'not json']]);const broken=setup(storage);assert.equal(storage.get(api.DRAFT_KEY),'not json');assert.match(broken.panel.innerHTML,/元の一時データ/);
});
test('voice modules do not request audio or paid services; inline application wiring is present',()=>{
 const parser=fs.readFileSync(path.join(__dirname,'../voice-input.js'),'utf8');
 assert.doesNotMatch(parser+ui,/\bfetch\s*\(|getUserMedia\s*\(|new\s+(?:webkit)?SpeechRecognition/);
 assert.match(html,/src="voice-input.js"/);assert.match(html,/src="voice-ui.js"/);assert.match(inline,/ShibaVoiceUI\.init/);
 new vm.Script(ui);new vm.Script(parser);
});
