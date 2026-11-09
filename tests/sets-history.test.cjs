const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const legacy={id:'old',date:'2026-11-09',exercise:'ベンチプレス',part:'胸',place:'会社・昼トレ',weight:50,reps:10,sets:3,minutes:30,calories:120,condition:3,pain:'なし',inflammation:'なし',memo:'既存の記録',custom:'keep'};
function setup(){
 const storage=new Map(),elements={groupBy:{value:'day'},filterPlace:{value:'all'},historyList:{},reorderStatus:{}};
 const context=vm.createContext({crypto:webcrypto,Uint8Array,document:{getElementById:id=>elements[id]},alert(){},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 vm.runInContext(script.slice(0,script.indexOf('function sorted()'))+';function render(){}',context);
 vm.runInContext(script.slice(script.indexOf('function renderHistory()'),script.indexOf('function renderAI()')),context);
 const run=code=>vm.runInContext(code,context);
 run(`records=${JSON.stringify([legacy,{...legacy,id:'z'},{...legacy,id:'older',date:'2026-11-08'}])}`);
 return {context,elements,storage,run,json:code=>JSON.parse(run(`JSON.stringify(${code})`))};
}
test('same weight with different reps stays in separate sets; totals are not duplicated',()=>{
 const {run,json}=setup();
 const next=json(`buildSetRecords(${JSON.stringify(legacy)},[{weight:'50',reps:'10'},{weight:'50',reps:'8'}])`);
 assert.equal(next.length,5);
 assert.deepEqual(next.slice(-2).map(r=>[r.weight,r.reps,r.sets,r.minutes,r.calories]),[[50,10,1,30,120],[50,8,1,0,0]]);
 assert.equal(new Set(next.map(r=>r.id)).size,5);
 assert.equal(run('records.length'),3);
 assert.deepEqual({...next[0],historyOrder:undefined},{...legacy,historyOrder:undefined});
 assert.equal(next.slice(-2).reduce((n,r)=>n+r.weight*r.reps*r.sets,0),900);
});
test('invalid set rows never change existing records',()=>{
 const {run}=setup(),before=run('JSON.stringify(records)');
 for(const rows of [[],[{weight:'',reps:'8'}],[{weight:'50',reps:'oops'}],[{weight:'-1',reps:'8'}]])assert.throws(()=>run(`buildSetRecords(${JSON.stringify(legacy)},${JSON.stringify(rows)})`));
 assert.equal(run('JSON.stringify(records)'),before);
});
test('session time counts once across exercises and sets; separate same-day sessions add up',()=>{
 const {run,json}=setup();
 run('records=[]');
 run(`commitRecords(buildSetRecords(${JSON.stringify(legacy)},[{weight:'50',reps:'10'},{weight:'50',reps:'8'}]));var firstSession=records[0].sessionId`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),30);
 run(`commitRecords(buildSetRecords({...${JSON.stringify(legacy)},exercise:'スクワット',sessionId:firstSession,minutes:999},[{weight:'60',reps:'10'}]))`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),30);
 assert.equal(run('records[2].minutes'),0);assert.equal(run('records[2].sessionMinutes'),30);
 run(`commitRecords(buildSetRecords({...${JSON.stringify(legacy)},minutes:45},[{weight:'40',reps:'10'}]))`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),75);
 assert.equal(run(`sessionsForDate('${legacy.date}').length`),2);
 assert.equal(run('records.reduce((total,r)=>total+r.minutes,0)'),75);
 const before=json('records');run('records=[];load()');assert.deepEqual(json('records'),before);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),75);
});
test('session duration survives deleting its first set and JSON restoration',()=>{
 const {run}=setup();run('records=[]');
 run(`commitRecords(buildSetRecords(${JSON.stringify(legacy)},[{weight:'50',reps:'10'},{weight:'50',reps:'8'}]));commitRecords(records.slice(1))`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),30);
 run('var backup=JSON.stringify(records);records=normalizeIds(JSON.parse(backup));save();records=[];load()');
 assert.equal(run(`dailyMinutes('${legacy.date}')`),30);
});
test('legacy minutes remain intact; a stale session choice is rejected without saving',()=>{
 const {run}=setup();const before=run('JSON.stringify(records)');
 assert.equal(run(`dailyMinutes('${legacy.date}')`),60);
 assert.throws(()=>run(`buildSetRecords({...${JSON.stringify(legacy)},sessionId:'not-found'},[{weight:'50',reps:'8'}])`));
 assert.equal(run('JSON.stringify(records)'),before);
});
test('legacy migration groups each date once, preserves all original fields and is idempotent',()=>{
 const {run,json}=setup(),before=json('records');
 run('records=withLegacySessions(records)');
 assert.equal(run(`sessionsForDate('${legacy.date}').length`),1);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),60);
 assert.equal(run("dailyMinutes('2026-11-08')"),30);
 for(const migrated of json('records')){
 const {sessionId,sessionMinutes,...original}=migrated;
 assert.deepEqual(original,before.find(r=>r.id===migrated.id));
 }
 assert.equal(run('withLegacySessions(records)===records'),true);
 run('save();records=[];load();upgradeLegacySessions()');
 assert.equal(run(`dailyMinutes('${legacy.date}')`),60);
});
test('legacy migration preserves already separate sessions on the same date',()=>{
 const {run,json}=setup();
 const modern={...legacy,id:'modern',sessionId:'evening',sessionMinutes:45,minutes:45};
 run(`records.push(${JSON.stringify(modern)});records=withLegacySessions(records)`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),105);
 assert.equal(run(`sessionsForDate('${legacy.date}').length`),2);
 assert.deepEqual(json("records.find(r=>r.id==='modern')"),modern);
});
test('migration save failure leaves original data untouched and can be retried',()=>{
 const {run,context,storage}=setup();run('save()');const before=run('JSON.stringify(records)');
 const write=context.localStorage.setItem;context.localStorage.setItem=()=>{throw Error('quota')};
 assert.equal(run('upgradeLegacySessions()'),false);
 assert.equal(run('JSON.stringify(records)'),before);assert.equal(storage.get('shiba-train-log-v1'),before);
 context.localStorage.setItem=write;assert.equal(run('upgradeLegacySessions()'),true);
 assert.equal(run(`sessionsForDate('${legacy.date}').length`),1);
});
test('reorder fixes dates and preserves every existing field and ID',()=>{
 const {run,json}=setup();
 const before=json('records');
 run("records=reorderedRecords('old','z')");
 assert.deepEqual(json('historySorted().map(r=>r.id)'),['old','z','older']);
 for(const row of json('records')){const {historyOrder,...fields}=row;assert.deepEqual(fields,before.find(r=>r.id===row.id));}
 assert.equal(run("reorderedRecords('old','older')"),null);
 assert.equal(run("reorderedRecords('missing','z')"),null);
});
test('order survives saving, reloading and JSON backup restoration; old backups still load',()=>{
 const {run,storage}=setup();
 run("commitRecords(reorderedRecords('old','z'))");
 const backup=storage.get('shiba-train-log-v1');
 run('records=[];load()');assert.equal(run("historySorted().map(r=>r.id).join(',')"),'old,z,older');
 run(`commitRecords(normalizeIds(JSON.parse(${JSON.stringify(backup)})))`);
 assert.equal(run("historySorted().map(r=>r.id).join(',')"),'old,z,older');
 run(`commitRecords(normalizeIds([${JSON.stringify(legacy)}]));records=[];load()`);
 assert.equal(run('JSON.stringify(records[0])'),JSON.stringify(legacy));
});
test('failed set save and reorder both preserve memory and durable data',()=>{
 const {run,context,storage}=setup();run('save()');
 const before=run('JSON.stringify(records)'),stored=storage.get('shiba-train-log-v1');
 context.localStorage.setItem=()=>{throw Error('quota')};
 assert.equal(run("commitRecords(reorderedRecords('old','z'))"),false);
 assert.equal(run(`commitRecords(buildSetRecords(${JSON.stringify(legacy)},[{weight:'50',reps:'8'}]))`),false);
 assert.equal(run('JSON.stringify(records)'),before);assert.equal(storage.get('shiba-train-log-v1'),stored);
});
test('history rendering honors saved order in day/week views and place filters',()=>{
 const {run,elements}=setup();run("records=reorderedRecords('old','z')");
 for(const group of ['day','week']){
 elements.groupBy.value=group;run('renderHistory()');
 const html=elements.historyList.innerHTML;
 assert.ok(html.indexOf('data-record-id="old"')<html.indexOf('data-record-id="z"'));
 assert.ok(html.indexOf('data-record-id="z"')<html.indexOf('data-record-id="older"'));
 assert.match(html,/data-reorder="old"/);
 }
 elements.filterPlace.value='自宅・自重';run('renderHistory()');assert.match(elements.historyList.innerHTML,/該当する記録はありません/);
});
test('cards group same-exercise rows without merging records, losing sets or exposing session time per card',()=>{
 const {run,json,elements}=setup();
 run(`records=[${JSON.stringify({...legacy,id:'a',sessionId:'morning',sessionMinutes:30,sets:1})},${JSON.stringify({...legacy,id:'b',sessionId:'morning',sessionMinutes:30,weight:50,reps:8,sets:1,minutes:0,memo:'<script>unsafe</script>'})},${JSON.stringify({...legacy,id:'c',exercise:'スクワット',sessionId:'morning',sessionMinutes:30,minutes:0})}]`);
 const before=run('JSON.stringify(records)');
 const cards=json('historyCards()');assert.equal(cards.length,2);
 assert.equal(cards.find(c=>c.exercise==='ベンチプレス').rows.length,2);
 assert.equal(run('JSON.stringify(records)'),before);
 run('renderHistory()');const rendered=elements.historyList.innerHTML;
 assert.doesNotMatch(rendered,/<table|<td|<th>/);
 assert.equal((rendered.match(/<article /g)||[]).length,2);
 assert.match(rendered,/50kg × 10回/);assert.match(rendered,/50kg × 8回/);
 assert.match(rendered,/&lt;script&gt;unsafe&lt;\/script&gt;/);
 for(const article of rendered.matchAll(/<article[\s\S]*?<\/article>/g))assert.doesNotMatch(article[0],/運動時間|セッション.*分|30分/);
 assert.equal((rendered.match(/data-delete=/g)||[]).length,3);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),30);
});
test('card grouping separates dates, places and body parts but groups rows across sessions',()=>{
 const {run,json}=setup();
 run(`records=[${JSON.stringify(legacy)},{...${JSON.stringify(legacy)},id:'second',sessionId:'evening',sessionMinutes:30},{...${JSON.stringify(legacy)},id:'home',place:'自宅・自重'},{...${JSON.stringify(legacy)},id:'other-date',date:'2026-11-08'},{...${JSON.stringify(legacy)},id:'other-part',part:'肩'}]`);
 const cards=json('historyCards()');assert.equal(cards.length,4);
 assert.equal(cards.find(c=>c.rows.some(r=>r.id==='old')).rows.length,2);
});
test('card reorder moves every set, preserves IDs and fields, and survives reload and JSON round trip',()=>{
 const {run,json,storage}=setup();
 run("records.find(r=>r.id==='older').date='2026-11-09';records.find(r=>r.id==='older').exercise='スクワット';records.push({...records[0],id:'past',date:'2026-11-08'})");
 const before=json('records');
 run("commitRecords(reorderedCards('old','older','before'))");
 assert.deepEqual(json('historyCards().map(c=>c.id)'),['old','older','past']);
 assert.deepEqual(json("historyCards()[0].rows.map(r=>r.id)"),['z','old']);
 for(const row of json('records')){const {historyOrder,...fields}=row;assert.deepEqual(fields,before.find(r=>r.id===row.id))}
 const backup=storage.get('shiba-train-log-v1');run('records=[];load()');assert.deepEqual(json('historyCards().map(c=>c.id)'),['old','older','past']);
 run(`records=normalizeIds(JSON.parse(${JSON.stringify(backup)}))`);assert.deepEqual(json('historyCards().map(c=>c.id)'),['old','older','past']);
 assert.equal(run("reorderedCards('old','past')"),null);
});
test('failed card reorder retains storage and memory',()=>{
 const {run,context,storage}=setup();run("records.find(r=>r.id==='z').exercise='スクワット';save()");
 const before=run('JSON.stringify(records)');context.localStorage.setItem=()=>{throw Error('quota')};
 assert.equal(run("commitRecords(reorderedCards('old','z'))"),false);
 assert.equal(run('JSON.stringify(records)'),before);assert.equal(storage.get('shiba-train-log-v1'),before);
});
test('90 minutes from three old 30-minute entries is explained without changing values; new shared 30 minutes stays 30',()=>{
 const {run}=setup();
 run(`records=withLegacySessions([${JSON.stringify(legacy)},{...${JSON.stringify(legacy)},id:'two'},{...${JSON.stringify(legacy)},id:'three'}])`);
 const before=run('JSON.stringify(records)');
 assert.equal(run(`dailyMinutes('${legacy.date}')`),90);
 assert.match(run(`sessionTimeNotes('${legacy.date}').join('')`),/30＋30＋30分.*90分/);
 assert.equal(run('JSON.stringify(records)'),before);
 run(`records=records.map((r,i)=>({...r,sessionMinutes:30,minutes:i===0?30:0}))`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),30);assert.equal(run(`sessionTimeNotes('${legacy.date}').length`),0);
});
test('conflicting session durations are reported without silently rewriting a backup',()=>{
 const {run}=setup();run("records=records.map((r,i)=>({...r,sessionId:'same',sessionMinutes:i===0?30:90}))");
 const before=run('JSON.stringify(records)');assert.match(run(`sessionTimeNotes('${legacy.date}').join('')`),/一致していません/);
 assert.equal(run('JSON.stringify(records)'),before);
});
test('editing card rows preserves existing IDs and session duration, supports add/remove and recalculates volume',()=>{
 const {run,json}=setup();run('records=withLegacySessions(records)');
 const before=json('records');
 run("var card=historyCards().find(c=>c.id==='old');var draft={exercise:'編集ベンチ',part:'肩',rows:card.rows.map(r=>({...r}))};draft.rows=draft.rows.filter(r=>r.id==='old');draft.rows[0]={...draft.rows[0],weight:'60',reps:'8',sets:'2',condition:'4',pain:'軽い',memo:'編集済み'};draft.rows.push({...draft.rows[0],id:null,reps:'6',sets:'1'});var edited=editedCardRecords('old',draft)");
 const edited=json('edited');assert.equal(edited.length,3);assert.ok(!edited.some(r=>r.id==='z'));
 const kept=edited.find(r=>r.id==='old');assert.equal(kept.exercise,'編集ベンチ');assert.equal(kept.sets,2);assert.equal(kept.custom,'keep');assert.equal(kept.sessionId,before[0].sessionId);
 const added=edited.find(r=>!before.some(old=>old.id===r.id));assert.equal(added.reps,6);assert.equal(added.minutes,0);assert.equal(added.calories,0);assert.equal(added.sessionId,kept.sessionId);
 assert.equal(new Set(edited.map(r=>r.id)).size,3);
 assert.equal(run('JSON.stringify(records)'),JSON.stringify(before));
 run('commitRecords(edited);records=[];load()');assert.equal(run(`dailyMinutes('${legacy.date}')`),60);
 assert.equal(run("records.filter(r=>r.exercise==='編集ベンチ').reduce((n,r)=>n+volume(r),0)"),1320);
});
test('invalid edits and duplicate IDs cannot alter data',()=>{
 const {run}=setup(),before=run('JSON.stringify(records)');
 run("var card=historyCards().find(c=>c.id==='old');var draft={exercise:card.exercise,part:card.part,rows:card.rows.map(r=>({...r}))}");
 assert.throws(()=>run("editedCardRecords('old',{...draft,rows:[draft.rows[0],draft.rows[0]]})"));
 assert.throws(()=>run("editedCardRecords('old',{...draft,exercise:''})"));
 for(const change of [{weight:-1},{sets:0},{reps:1.5},{condition:6}])assert.throws(()=>run(`editedCardRecords('old',{...draft,rows:[{...draft.rows[0],...${JSON.stringify(change)}}]})`));
 assert.equal(run('JSON.stringify(records)'),before);
});
test('time editing changes 90 only when saved, updates each session once and preserves IDs through backup reload',()=>{
 const {run,json}=setup();
 run(`records=withLegacySessions([${JSON.stringify(legacy)},{...${JSON.stringify(legacy)},id:'two'},{...${JSON.stringify(legacy)},id:'three'}]);var changes=timeDraftForDate('${legacy.date}');changes[0].minutes='35'`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),90);
 const ids=json('records.map(r=>r.id)');run(`commitRecords(editedTimeRecords('${legacy.date}',changes));var exported=JSON.stringify(records);records=[];load()`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),35);assert.deepEqual(json('records.map(r=>r.id)'),ids);
 assert.equal(run('records.reduce((n,r)=>n+r.minutes,0)'),35);
 run('records=normalizeIds(JSON.parse(exported))');assert.equal(run(`dailyMinutes('${legacy.date}')`),35);
});
test('time editing covers all places in one session and does not change another session',()=>{
 const {run,json}=setup();
 const evening={...legacy,id:'evening',sessionId:'night',sessionMinutes:60,minutes:60};
 run(`records=[{...${JSON.stringify(legacy)},sessionId:'morning',sessionMinutes:30},{...${JSON.stringify(legacy)},id:'home',place:'自宅・自重',minutes:0,sessionId:'morning',sessionMinutes:30},${JSON.stringify(evening)}];records=editedTimeRecords('${legacy.date}',[{id:'morning',minutes:'45'},{id:'night',minutes:'60'}])`);
 assert.equal(run(`dailyMinutes('${legacy.date}')`),105);
 assert.equal(run("records.find(r=>r.id==='home').sessionMinutes"),45);assert.deepEqual(json("records.find(r=>r.id==='evening')"),evening);
 const before=run('JSON.stringify(records)');assert.throws(()=>run(`editedTimeRecords('${legacy.date}',[{id:'morning',minutes:''},{id:'night',minutes:'60'}])`));assert.equal(run('JSON.stringify(records)'),before);
});
test('editing cancelled or failing storage preserves records and draft; successful retry does not duplicate rows',()=>{
 const {run,context,json}=setup();run('function clearHistoryDrag(){};function selectLatestSession(){};records=withLegacySessions(records)');
 run("openHistoryEditor('card','old');historyEditor.draft.rows[0].reps='7'");
 const before=run('JSON.stringify(records)');run('historyEditor=null;renderHistory()');assert.equal(run('JSON.stringify(records)'),before);
 run("openHistoryEditor('card','old');historyEditor.draft.rows[0].reps='7'");
 const write=context.localStorage.setItem;context.localStorage.setItem=()=>{throw Error('quota')};
 assert.equal(run('finishHistoryEdit()'),false);assert.equal(run('historyEditor.draft.rows[0].reps'),'7');assert.equal(run('JSON.stringify(records)'),before);
 context.localStorage.setItem=write;assert.equal(run('finishHistoryEdit()'),true);assert.equal(run('historyEditor'),null);
 assert.equal(run('records.length'),3);assert.equal(new Set(json('records.map(r=>r.id)')).size,3);
 run(`openHistoryEditor('time','${legacy.date}');historyEditor.draft[0].minutes='42'`);context.localStorage.setItem=()=>{throw Error('quota')};
 assert.equal(run('finishHistoryEdit()'),false);assert.equal(run('historyEditor.draft[0].minutes'),'42');assert.equal(run(`dailyMinutes('${legacy.date}')`),60);
});
function dragSetup(){
 const base=setup(),{run,context,elements}=base,handlers={};
 run("records.find(r=>r.id==='z').exercise='スクワット'");
 const listeners={};const register=(name,fn)=>{(listeners[name]??=[]).push(fn);handlers[name]=(...args)=>listeners[name].forEach(listener=>listener(...args))};
 elements.historyList.addEventListener=register;
 context.document.addEventListener=register;
 let removed=0,prevented=0;const timers=new Map();let timerId=0;
 context.setTimeout=fn=>{timers.set(++timerId,fn);return timerId};context.clearTimeout=id=>timers.delete(id);
 context.document.body={style:{overscrollBehavior:'auto'},append(){}};
 context.document.createElement=()=>({style:{},setAttribute(){},append(){},remove(){removed++}});
 const row=(id,top)=>({dataset:{cardId:id},style:{},setAttribute(){},removeAttribute(){},querySelectorAll:()=>[],remove(){removed++},classList:{values:new Set(),add(...names){names.forEach(n=>this.values.add(n))},remove(...names){names.forEach(n=>this.values.delete(n))}},getBoundingClientRect:()=>({top,bottom:top+40,left:0,width:300,height:40}),cloneNode:()=>row(id,top),closest(){return this}});
 const source=row('old',50),target=row('z',100),other=row('older',150),rows=[source,target,other];
 elements.historyList.querySelectorAll=()=>rows;
 let hit=source;context.document.elementFromPoint=()=>hit;
 const handle={dataset:{reorder:'old'},closest:()=>source,setPointerCapture(){},releasePointerCapture(){}};
 const event=(y=60)=>({target:{closest:()=>handle},button:0,pointerId:1,clientX:10,clientY:y,preventDefault(){prevented++}});
 vm.runInContext(script.slice(script.indexOf('let drag=null;'),script.indexOf("load();document.querySelector")),context);
 run('var moves=[];function saveHistoryCardMove(a,b,position){moves.push([a,b,position])}');
 return {...base,handlers,event,source,target,other,activate:()=>{for(const fn of [...timers.values()])fn()},hit:row=>hit=row,removed:()=>removed,prevented:()=>prevented};
}
test('long press starts card drag; card center determines the destination without an insertion line',()=>{
 const {run,context,handlers,event,target,hit,activate}=dragSetup();
 handlers.pointerdown(event());assert.equal(run('drag.active'),false);activate();assert.equal(run('drag.active'),true);
 assert.equal(context.document.body.style.overscrollBehavior,'none');
 hit(target);handlers.pointermove(event(105));assert.equal(run('drag.ghost.style.transform'),'translateY(45px) scale(1.01)');
 assert.ok(target.classList.values.has('drop-target'));assert.equal(run('drag.position'),'before');
 handlers.pointermove(event(130));assert.equal(run('drag.position'),'after');
 handlers.pointerup(event(130));assert.equal(run('JSON.stringify(moves)'),JSON.stringify([['old','z','after']]));
 assert.equal(context.document.body.style.overscrollBehavior,'auto');
});
test('cross-date drops, cancellation and Escape never save; visual state is cleaned up',()=>{
 for(const action of ['other','cancel','escape','lost']){
 const {run,context,handlers,event,source,target,other,hit,removed,activate}=dragSetup();
 handlers.pointerdown(event());activate();hit(target);handlers.pointermove(event(105));
 if(action==='other'){hit(other);handlers.pointerup(event(155))}
 if(action==='cancel')handlers.pointercancel(event());
 if(action==='escape')handlers.keydown({key:'Escape'});
 if(action==='lost')handlers.lostpointercapture(event());
 assert.equal(run('moves.length'),0);assert.equal(run('drag'),null);assert.equal(removed(),1);
 assert.equal(source.classList.values.size,0);assert.equal(target.classList.values.size,0);assert.equal(context.document.body.style.overscrollBehavior,'auto');
 }
});
test('touch scrolling is prevented only during drag; an unrelated pointer cannot end drag',()=>{
 const {run,handlers,event,prevented,activate}=dragSetup();
 handlers.touchmove(event());assert.equal(prevented(),0);
 handlers.pointerdown(event());handlers.touchmove(event());assert.equal(prevented(),0);activate();handlers.touchmove(event());assert.equal(prevented(),1);
 handlers.pointerup({...event(),pointerId:2});assert.equal(run('drag!==null'),true);
 handlers.pointerup(event());handlers.touchmove(event());assert.equal(run('moves.length'),0);
});
test('short tap or motion before long press never starts dragging or saves',()=>{
 for(const moveFirst of [true,false]){
 const {run,handlers,event,activate,removed}=dragSetup();handlers.pointerdown(event());
 if(moveFirst)handlers.pointermove(event(100));else handlers.pointerup(event());
 activate();assert.equal(run('drag'),null);assert.equal(run('moves.length'),0);assert.equal(removed(),0);
 }
});
test('edge scroll speed is gradual, directional and zero in the middle',()=>{
 const {run}=setup();assert.equal(run('edgeScrollSpeed(300,600)'),0);
 assert.ok(run('edgeScrollSpeed(10,600)<edgeScrollSpeed(60,600)'));
 assert.ok(run('edgeScrollSpeed(590,600)>edgeScrollSpeed(540,600)'));
 assert.equal(run('edgeScrollSpeed(600,600)'),420);assert.equal(run('edgeScrollSpeed(0,600)'),-420);
});
test('drag auto-scroll continues while held, stays within the date and stops on release',()=>{
 const {run,context,handlers,event,source,target,activate,hit}=dragSetup();
 const frames=new Map();let frameId=0,cancelled=0;
 context.innerHeight=300;context.scrollY=0;
 context.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId};context.cancelAnimationFrame=id=>{frames.delete(id);cancelled++};
 context.scrollBy=(x,y)=>{context.scrollY+=y};
 source.getBoundingClientRect=()=>({top:50-context.scrollY,bottom:90-context.scrollY,left:0,width:300,height:40});
 target.getBoundingClientRect=()=>({top:500-context.scrollY,bottom:1000-context.scrollY,left:0,width:300,height:500});
 handlers.pointerdown(event());activate();hit(target);handlers.pointermove(event(290));
 for(let time=0;time<5000;time+=16){const entry=frames.entries().next().value;if(!entry)break;frames.delete(entry[0]);entry[1](time)}
 assert.ok(context.scrollY>0);assert.ok(context.scrollY<=724);assert.equal(run('drag.active'),true);
 handlers.pointermove(event(5));
 for(let time=5000;time<10000;time+=16){const entry=frames.entries().next().value;if(!entry)break;frames.delete(entry[0]);entry[1](time)}
 assert.ok(context.scrollY>=26);assert.ok(context.scrollY<100);
 handlers.pointerup(event(100));assert.equal(run('drag'),null);assert.equal(frames.size,0);assert.ok(cancelled>0);
});
test('editing prevents drag activation and body long press is cancelled by normal scrolling',()=>{
 const {run,handlers,event,activate}=dragSetup();
 run("historyEditor={kind:'card',id:'old',draft:{}}");handlers.pointerdown(event());activate();assert.equal(run('drag'),null);
 run('historyEditor=null');
 const bodyEvent={...event(),target:{closest:selector=>selector==='[data-card-id]'?{dataset:{cardId:'old'}}:null}};
 handlers.pointerdown(bodyEvent);handlers.pointermove({...bodyEvent,clientY:100});activate();assert.equal(run('historyEditor'),null);
});
test('body and time long presses open separate inline editors without starting drag or changing data',()=>{
 const {run,handlers,event,activate}=dragSetup();const before=run('JSON.stringify(records)');
 const body={...event(),target:{closest:selector=>selector==='[data-card-id]'?{dataset:{cardId:'old'}}:null}};
 handlers.pointerdown(body);activate();assert.equal(run('historyEditor.kind'),'card');assert.equal(run('drag'),null);
 run('historyEditor=null');
 const time={...event(),target:{closest:selector=>selector==='[data-time-date]'?{dataset:{timeDate:legacy.date}}:null}};
 handlers.pointerdown(time);activate();assert.equal(run('historyEditor.kind'),'time');assert.equal(run('drag'),null);
 assert.equal(run('JSON.stringify(records)'),before);
});
test('card preview reorders DOM smoothly and cancellation restores original DOM order',()=>{
 const {run,handlers,event,source,target,activate,hit}=dragSetup();
 const order=[source,target];let animated=0;
 const parent={append(row){const i=order.indexOf(row);if(i>=0)order.splice(i,1);order.push(row)},insertBefore(row,before){const i=order.indexOf(row);if(i>=0)order.splice(i,1);const at=before?order.indexOf(before):order.length;order.splice(at,0,row)}};
 for(const row of order){row.parentNode=parent;row.getBoundingClientRect=()=>({top:50+order.indexOf(row)*50,bottom:90+order.indexOf(row)*50,height:40,width:300,left:0});row.animate=()=>{animated++;return {cancel(){}}};Object.defineProperty(row,'nextSibling',{get:()=>order[order.indexOf(row)+1]??null})}
 handlers.pointerdown(event());activate();hit(target);handlers.pointermove(event(135));assert.deepEqual(order,[target,source]);assert.ok(animated>0);
 handlers.pointercancel(event());assert.deepEqual(order,[source,target]);assert.equal(run('moves.length'),0);
});
test('explicit drop positions retain fixed dates and support both sides of a row',()=>{
 const {run,json}=setup();
 run("records.push({...records[0],id:'third'})");
 assert.deepEqual(json("historySorted(reorderedRecords('old','z','after')).map(r=>r.id)"),['z','old','third','older']);
 assert.deepEqual(json("historySorted(reorderedRecords('old','z','before')).map(r=>r.id)"),['old','z','third','older']);
});
test('form order places session time directly after date and retains set rows',()=>{
 const form=html.slice(html.indexOf('<form id="entryForm">'),html.indexOf('</form>'));
 const names=[...form.matchAll(/name="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(names.slice(0,7),['date','minutes','sessionId','place','condition','exercise','part']);
 assert.ok(!names.includes('pain'));assert.ok(!names.includes('inflammation'));
 assert.match(form,/id="setRows"/);assert.match(html,/>≡<\/button>/);
});
test('actual form and backup handlers preserve set inputs on failure and support cancel/restore',async()=>{
 const storage=new Map(),nodes=new Map();let approve=true;
 function node(){const inputs={};return {value:'',children:[],dataset:{},events:{},classList:{toggle(){}},addEventListener(name,fn){this.events[name]=fn},querySelector:s=>inputs[s]??=(node()),querySelectorAll(){return this.children},append(row){this.children.push(row)},get lastElementChild(){return this.children.at(-1)}}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 get('groupBy').value='day';get('filterPlace').value='all';get('nextPlace').value=legacy.place;get('nextMinutes').value='30';
 const context=vm.createContext({crypto:webcrypto,Uint8Array,alert(){},confirm:()=>approve,setTimeout(){},clearTimeout(){},setInterval(){},FormData:class{constructor(){return Object.entries({...legacy,sessionId:get('sessionSelect').value})}},document:{getElementById:get,createElement:node,querySelector:()=>node(),querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 const run=code=>vm.runInContext(code,context);run(script);
 get('entryForm').querySelector('[name=date]').value=legacy.date;
 get('setRows').children[0].querySelector('[data-weight]').value='50';get('addSet').onclick();
 get('setRows').children[1].querySelector('[data-reps]').value='8';
 get('entryForm').onsubmit({preventDefault(){},target:{}});
 assert.equal(run('records.length'),2);assert.equal(run('records[1].reps'),8);
 assert.equal(get('entryForm').querySelector('[name=minutes]').readOnly,true);
 assert.equal(get('sessionSelect').value,run('records[0].sessionId'));
 get('entryForm').onsubmit({preventDefault(){},target:{}});
 assert.equal(run(`dailyMinutes('${legacy.date}')`),30);
 get('sessionSelect').value='';get('sessionSelect').onchange();
 assert.equal(get('entryForm').querySelector('[name=minutes]').readOnly,false);
 run('selectLatestSession()');
 assert.equal(get('entryForm').querySelector('[name=minutes]').readOnly,true);
 run('saveHistoryMove(records[1].id,records[0].id);var exported;download=(name,text)=>{exported=text}');get('export').onclick();
 const backup=run('exported'),before=run('JSON.stringify(records)');
 const event={target:{files:[{text:async()=>backup}],value:'file'}};
 approve=false;await get('import').onchange(event);assert.equal(run('JSON.stringify(records)'),before);assert.equal(event.target.value,'');
 approve=true;run('records=[]');await get('import').onchange(event);assert.deepEqual(JSON.parse(run('JSON.stringify(records)')),JSON.parse(backup));
 const saved=storage.get('shiba-train-log-v1');context.localStorage.setItem=()=>{throw Error('quota')};
 get('entryForm').onsubmit({preventDefault(){},target:{}});
 assert.equal(get('setRows').children.length,2);assert.equal(get('setRows').children[1].querySelector('[data-reps]').value,'8');
 assert.equal(storage.get('shiba-train-log-v1'),saved);assert.deepEqual(JSON.parse(run('JSON.stringify(records)')),JSON.parse(backup));
 context.localStorage.setItem=(key,value)=>storage.set(key,value);
 const oldBackup=JSON.stringify([legacy,{...legacy,id:'old2',minutes:20}]);
 await get('import').onchange({target:{files:[{text:async()=>oldBackup}],value:'old-file'}});
 assert.equal(run('records.length'),2);assert.equal(run(`dailyMinutes('${legacy.date}')`),50);
 assert.equal(run(`sessionsForDate('${legacy.date}').length`),1);
 assert.equal(run("records.find(r=>r.id==='old2').minutes"),20);
 const deleteEvent={target:{closest:selector=>selector==='[data-delete]'?{dataset:{delete:'old2'}}:null}};
 approve=false;get('historyList').onclick(deleteEvent);assert.equal(run('records.length'),2);
 approve=true;get('historyList').onclick(deleteEvent);assert.equal(run('records.length'),1);
 assert.equal(run('records[0].id'),'old');assert.equal(run(`dailyMinutes('${legacy.date}')`),50);
 const click=(selector,dataset={})=>get('historyList').onclick({target:{closest:key=>key===selector?{dataset}:null}});
 const submit=()=>get('historyList').events.submit({target:{hasAttribute:()=>true},preventDefault(){}});
 click('[data-card-edit]',{cardEdit:'old'});
 get('historyList').oninput({target:{dataset:{editField:'exercise'},value:'キャンセル予定',closest:()=>null}});
 click('[data-edit-cancel]');assert.equal(run('records[0].exercise'),legacy.exercise);
 click('[data-card-edit]',{cardEdit:'old'});
 get('historyList').oninput({target:{dataset:{rowField:'weight'},value:'60',closest:()=>({dataset:{editRow:'0'}})}});
 click('[data-edit-add]');assert.equal(run('historyEditor.draft.rows.length'),2);
 get('historyList').oninput({target:{dataset:{rowField:'reps'},value:'8',closest:()=>({dataset:{editRow:'1'}})}});
 context.localStorage.setItem=()=>{throw Error('quota')};submit();assert.equal(run('historyEditor.draft.rows[0].weight'),'60');assert.equal(run('records.length'),1);
 context.localStorage.setItem=(key,value)=>storage.set(key,value);submit();assert.equal(run('historyEditor'),null);assert.equal(run('records.length'),2);assert.equal(run('records[0].id'),'old');assert.equal(run(`dailyMinutes('${legacy.date}')`),50);
 click('[data-time-edit]',{timeEdit:legacy.date});get('historyList').oninput({target:{dataset:{timeIndex:'0'},value:'35'}});submit();
 assert.equal(run(`dailyMinutes('${legacy.date}')`),35);run('records=[];load()');assert.equal(run(`dailyMinutes('${legacy.date}')`),35);
});
