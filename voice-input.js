/* Text parsing and batch construction only. No microphone, network or storage. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ShibaVoice=api})(globalThis,function(){
 'use strict';
 const DRAFT_KEY='shiba-train-log-voice-draft-v1';
 const exercises={
  'ベンチプレス':'胸','インクラインベンチプレス':'胸','ダンベルプレス':'胸','チェストプレス':'胸','腕立て伏せ':'胸',
  'スクワット':'脚','レッグプレス':'脚','レッグカール':'脚','デッドリフト':'背中','ラットプルダウン':'背中','シーテッドロー':'背中','懸垂':'背中',
  'ショルダープレス':'肩','サイドレイズ':'肩','アームカール':'腕','ダンベルカール':'腕','プランク':'体幹'
 };
 function kanjiNumber(text){
  const digits={'零':0,'〇':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  const parts=text.split('点');let value=0,current=0;
  if(!/[十百千]/.test(parts[0]))value=Number([...parts[0]].map(c=>digits[c]).join(''));
  else{for(const c of parts[0]){if(c in digits)current=digits[c];else{value+=(current||1)*({'十':10,'百':100,'千':1000}[c]);current=0}}value+=current}
  return String(value)+(parts[1]?'.'+[...parts[1]].map(c=>digits[c]).join(''):'');
 }
 function normalize(text){return String(text??'').normalize('NFKC').replace(/([零〇一二三四五六七八九十百千]+(?:点[零〇一二三四五六七八九]+)?)\s*(?=キログラム|キロ|kg|回|セット|点)/gi,(all,num)=>kanjiNumber(num))}
 function parse(text){
  const source=String(text??''),normalized=normalize(source),issues=[];
  // Indices are UTF-16 offsets, matching String/RegExp (including emoji in notes).
  const consumed=new Array(normalized.length).fill(false);
  const mark=(start,length)=>{for(let i=start;i<start+length;i++)consumed[i]=true};
  const result={exercise:'',part:'',rows:[],condition:'',pain:'',inflammation:'',memo:'',source,unparsed:'',issues,multipleExercises:false};
  let first=normalized.length;
  const extract=(regex,key,convert=v=>v)=>{const match=regex.exec(normalized);if(match){result[key]=convert(match[1]);mark(match.index,match[0].length);first=Math.min(first,match.index)}};
  extract(/(?:メモ|備考)\s*(?:は|:)?\s*([\s\S]*)$/,'memo');
  const memoStart=/(?:メモ|備考)\s*(?:は|:)?/.exec(normalized)?.index??normalized.length;
  const content=normalized.slice(0,memoStart);
  const names=Object.keys(exercises).sort((a,b)=>b.length-a.length);
  const found=[...content.matchAll(new RegExp(names.join('|'),'g'))].map(m=>m[0]);
  result.multipleExercises=new Set(found).size>1;
  if(result.multipleExercises)issues.push('1回につき1種目ずつ入力してください。文章を分けてください。');
  // Metadata is matched only before the memo; memo text must not become measurements.
  const meta=(regex,key,convert)=>{const match=regex.exec(content);if(match){result[key]=convert?convert(match[1]):match[1];mark(match.index,match[0].length);first=Math.min(first,match.index)}};
  meta(/(?:体調|コンディション)\s*(?:は|が|:)?\s*([1-5])(?:\s*(?:点|\/5))?(?!\d)/,'condition');
  meta(/痛み\s*(?:は|が|:)?\s*(なし|ない|軽い|中程度|強い)/,'pain',v=>v==='ない'?'なし':v);
  meta(/炎症\s*(?:は|が|:)?\s*(なし|ない|あり)/,'inflammation',v=>v==='ない'?'なし':v);
  meta(/部位\s*(?:は|:)?\s*(胸|背中|脚|肩|腕|体幹|全身)/,'part');
  const token=/(-?\d+(?:\.\d+)?)\s*(キログラム|キロ|kg|回|セット)|自重/gi;
  let row=null;
  for(const match of content.matchAll(token)){
   if(consumed[match.index])continue;
   const key=match[0]==='自重'?'weight':/キロ|kg/i.test(match[2])?'weight':match[2]==='回'?'reps':'sets';
   if(!row||row[key]!==''){row={weight:'',reps:'',sets:''};result.rows.push(row)}
   row[key]=match[0]==='自重'?'0':match[1];mark(match.index,match[0].length);first=Math.min(first,match.index);
  }
  const prefix=normalized.slice(0,first),name=prefix.replace(/^\s*(?:種目\s*(?:は|:)\s*)?/,'').replace(/[\s、,。;；]+$/,'').trim();
  result.exercise=name;
  if(name){mark(0,prefix.length);if(!result.part)result.part=exercises[name]||''}
  result.unparsed=normalized.split('').map((char,i)=>consumed[i]?' ':char).join('').replace(/[\s、,。;；×*]+/g,' ').trim();
  if(!name)issues.push('種目名を確認してください。');
  if(!result.part)issues.push('部位は未指定です。選択してください。');
  if(!result.rows.length)issues.push('重量・回数・セット数を確認してください。');
  if(result.rows.some(r=>Object.values(r).some(v=>v==='')))issues.push('不足している重量・回数・セット数を入力してください。推定値は入れていません。');
  if(result.unparsed)issues.push('未解析の文章があります。元の文章と照合してください。');
  if(result.multipleExercises){result.rows=[];result.unparsed=normalized}
  return result;
 }
 function newDraft(batchId,context){return {version:1,batchId,context:{...context},text:'',consumed:false,items:[]}}
 function sharedExercise(parsed){
  const notes=[parsed.memo||''];
  if(parsed.pain)notes.push('痛み：'+parsed.pain);
  if(parsed.inflammation)notes.push('炎症：'+parsed.inflammation);
  if(parsed.unparsed&&/痛|違和感|フォーム|疲労|疲れ/.test(parsed.unparsed))notes.push(parsed.unparsed);
  return {...parsed,memo:[...new Set(notes.filter(Boolean))].join('\n\n')};
 }
 function parseSessionExercise(text){return sharedExercise(parse(text))}
 function validateDraft(value){
  return value?.version===1&&typeof value.batchId==='string'&&!!value.batchId&&value.context&&['date','place','sessionId','minutes'].every(k=>typeof value.context[k]==='string')&&typeof value.text==='string'&&typeof value.consumed==='boolean'&&Array.isArray(value.items)&&value.items.every(item=>item&&typeof item.id==='string'&&!!item.id&&typeof item.source==='string'&&typeof item.exercise==='string'&&typeof item.part==='string'&&Array.isArray(item.rows)&&item.rows.every(r=>r&&['weight','reps','sets'].every(k=>typeof r[k]==='string'))&&['condition','pain','inflammation','memo','unparsed'].every(k=>typeof item[k]==='string')&&(item.issues===undefined||Array.isArray(item.issues)&&item.issues.every(v=>typeof v==='string'))&&(item.needsReparse===undefined||typeof item.needsReparse==='boolean'))&&new Set(value.items.map(i=>i.id)).size===value.items.length;
 }
 function readDraft(storage){try{const raw=storage.getItem(DRAFT_KEY);if(raw===null)return {draft:null};const draft=JSON.parse(raw);if(!validateDraft(draft))throw Error('一時データの形式が一致しません。');return {draft}}catch(error){return {draft:null,error:error.message}}}
 function persistDraft(storage,draft){try{storage.setItem(DRAFT_KEY,JSON.stringify(draft));return {ok:true}}catch(error){return {ok:false,error:error.message}}}
 function buildBatch(draft,records,services){
  if(records.some(r=>r.voiceBatchId===draft.batchId))return {alreadySaved:true,next:records};
  if(!draft.items.length)throw Error('未保存の種目を1件以上追加してください。');
  if(draft.text.trim()&&!draft.consumed)throw Error('入力欄に未追加の文章があります。「解析して追加」を押すか、次の種目の入力欄を空にしてください。');
  if(services.sessionModel)return services.buildSessionBatch(draft);
  const ctx=draft.context;
  if(!services.validDate(ctx.date))throw Error('日付を確認してください。');
  const sessions=services.sessions(ctx.date,records),existing=ctx.sessionId?sessions.find(s=>s.id===ctx.sessionId):null;
  if(ctx.sessionId&&!existing)throw Error('選択したセッションがありません。選び直してください。');
  const minutes=existing?existing.minutes:Number(ctx.minutes);
  if(!existing&&(ctx.minutes===''||!Number.isFinite(minutes)||minutes<0))throw Error('セッション全体の時間を入力してください。');
  const used=new Set(records.flatMap(r=>[r.id,r.sessionId]).concat([draft.batchId,...draft.items.map(i=>i.id)]).filter(Boolean));
  const sessionId=existing?existing.id:services.createId(used);used.add(sessionId);
  const day=services.sorted(records).filter(r=>r.date===ctx.date),ranks=new Map(day.map((r,i)=>[r.id,i])),additions=[];
  for(const [itemIndex,item] of draft.items.entries()){
   if(item.needsReparse)throw Error(`${itemIndex+1}種目目の元の文章が変更されています。「この文章で再解析」を押してください。`);
   if(!item.exercise.trim()||!item.rows.length||item.condition===''||item.pain===''||item.inflammation==='')throw Error(`${itemIndex+1}種目目の種目・部位・セット行・体調・痛み・炎症を確認してください。未入力の項目があります。`);
   for(const row of item.rows){
    if(['weight','reps','sets'].some(k=>row[k]===''||!Number.isFinite(Number(row[k])))||Number(row.weight)<0||!Number.isInteger(Number(row.reps))||Number(row.reps)<0||!Number.isInteger(Number(row.sets))||Number(row.sets)<1)throw Error(`${itemIndex+1}種目目の重量・回数・セット数を確認してください。`);
    const id=services.createId(used);used.add(id);
    const record={id,date:ctx.date,place:ctx.place,exercise:item.exercise.trim(),part:item.part,weight:Number(row.weight),reps:Number(row.reps),sets:Number(row.sets),minutes:!existing&&additions.length===0?minutes:0,calories:0,condition:Number(item.condition),pain:item.pain,inflammation:item.inflammation,memo:item.memo,sessionId,sessionMinutes:minutes,historyOrder:day.length+additions.length,voiceBatchId:draft.batchId,voiceSource:item.source,voiceUnparsed:item.unparsed};
    if(!services.valid(record))throw Error(`${itemIndex+1}種目目の入力内容を確認してください。`);
    additions.push(record);
   }
  }
  return {alreadySaved:false,sessionId,additions,next:[...records.map(r=>ranks.has(r.id)?{...r,historyOrder:ranks.get(r.id)}:r),...additions]};
 }
 return {DRAFT_KEY,parse,parseSessionExercise,sharedExercise,normalize,newDraft,validateDraft,readDraft,persistDraft,buildBatch};
});
