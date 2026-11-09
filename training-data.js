/* Canonical three-level data. Legacy arrays are an import/export view, not storage. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ShibaTraining=api})(globalThis,function(){
 'use strict';
 const KEY='shiba-train-log-v2';
 const copy=value=>JSON.parse(JSON.stringify(value));
 const unique=values=>[...new Set(values.filter(value=>value!==''&&value!==undefined&&value!==null))];
 const idOK=id=>typeof id==='string'&&id.trim().length>0;
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 const places=['会社・昼トレ','自宅・自重','その他'];
 const parts=['胸','背中','脚','肩','腕','体幹','全身'];
 const commonKeys=new Set(['id','date','place','minutes','condition','exercise','part','memo','weight','reps','sets','sessionId','sessionMinutes','exerciseId','historyOrder','schemaVersion','migrationPending']);
 function empty(){return {version:2,sessions:[],pending:[],legacyArchive:[]}}
 function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [y,m,d]=value.split('-').map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 return y>0&&m>=1&&m<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
 }
 function validate(doc){
 if(doc?.version!==2||!Array.isArray(doc.sessions)||!Array.isArray(doc.pending)||!Array.isArray(doc.legacyArchive))throw Error('3階層データの形式が正しくありません。');
 const sessionIds=new Set(),recordIds=new Set(),exerciseIds=new Set();
 if(!doc.legacyArchive.every(r=>r&&typeof r==='object'&&!Array.isArray(r)))throw Error('元データの保管形式を確認してください。');
 for(const session of doc.sessions){
 if(!idOK(session.id)||sessionIds.has(session.id)||!validDate(session.date)||!places.includes(session.place)||!finite(session.minutes)||!Number.isFinite(session.condition)||session.condition<1||session.condition>5||!Array.isArray(session.exercises)||!session.exercises.length)throw Error('セッション情報を確認してください。');sessionIds.add(session.id);const names=new Set();
 for(const exercise of session.exercises){
 if(!idOK(exercise.id)||exerciseIds.has(exercise.id)||typeof exercise.name!=='string'||!exercise.name.trim()||names.has(exercise.name.trim())||!parts.includes(exercise.part)||typeof exercise.memo!=='string'||!Array.isArray(exercise.sets)||!exercise.sets.length)throw Error('種目情報を確認してください。');exerciseIds.add(exercise.id);names.add(exercise.name.trim());
 for(const set of exercise.sets){if(!idOK(set.id)||recordIds.has(set.id)||!finite(set.weight)||!finite(set.reps)||!finite(set.sets)||set.sets<1)throw Error('セット情報または記録IDを確認してください。');recordIds.add(set.id)}
 }
 }
 for(const item of doc.pending){if(!item||!item.record||typeof item.reason!=='string'||!idOK(item.record.id)||recordIds.has(item.record.id)||!validDate(item.record.date)||!parts.includes(item.record.part)||!places.includes(item.record.place)||typeof item.record.exercise!=='string'||!item.record.exercise.trim()||!['weight','reps','sets','minutes','condition'].every(k=>Number.isFinite(Number(item.record[k])))||Number(item.record.weight)<0||Number(item.record.reps)<0||Number(item.record.sets)<1||Number(item.record.minutes)<0||Number(item.record.condition)<1||Number(item.record.condition)>5)throw Error('移行待ちデータの形式またはIDが正しくありません。');recordIds.add(item.record.id)}
 return doc;
 }
 function legacyMemo(rows,force=false){
 const notes=unique(rows.map(r=>String(r.memo??'')));
 for(const pain of unique(rows.filter(r=>force||r.schemaVersion!==2).map(r=>r.pain)).filter(v=>v!=='なし')){const text='旧記録の痛み：'+pain;if(!notes.some(note=>note.includes(text)))notes.push(text)}
 for(const inflammation of unique(rows.filter(r=>force||r.schemaVersion!==2).map(r=>r.inflammation)).filter(v=>v!=='なし')){const text='旧記録の炎症：'+inflammation;if(!notes.some(note=>note.includes(text)))notes.push(text)}
 return unique(notes).join('\n\n');
 }
 function makeSession(rows,fields,id,previous=null,forceLegacy=false){
 const groups=new Map();
 for(const row of rows){const key=row.exercise.trim();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
 const exercises=[...groups].map(([name,items])=>{
 const bodyParts=unique(items.map(r=>r.part));if(bodyParts.length!==1)throw Error(`「${name}」の部位が複数あります。元の内容を確認してから移行してください。`);
 const old=previous?.exercises.find(e=>e.name===name);
 return {id:old?.id||items[0].exerciseId||'exercise:'+items[0].id,name,part:bodyParts[0],memo:legacyMemo(items,forceLegacy),sets:items.map(row=>({id:row.id,weight:Number(row.weight),reps:Number(row.reps),sets:Number(row.sets),extras:Object.fromEntries(Object.entries(row).filter(([key,value])=>!commonKeys.has(key)&&!(row.schemaVersion===2&&['pain','inflammation'].includes(key)&&value==='なし')))}))};
 });
 return {id,date:fields.date,place:fields.place,minutes:Number(fields.minutes),condition:Number(fields.condition),exercises};
 }
 function migrateLegacy(rows,mode='pending'){
 if(!Array.isArray(rows))throw Error('旧JSONは記録の配列である必要があります。');
 const doc=empty();doc.legacyArchive=copy(rows);
 const groups=new Map(),seen=new Set();
 for(const row of rows){
 if(!row||!idOK(row.id)||seen.has(row.id))throw Error('旧記録のIDが空または重複しています。IDを自動変更せず、読み込みを中止しました。');seen.add(row.id);
 const key=idOK(row.sessionId)?'session:'+row.sessionId:'record:'+row.id;
 if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 for(const group of groups.values()){
 const first=group[0],same=key=>group.every(r=>r[key]===first[key]);
 const explicit=group.every(r=>r.schemaVersion===2||idOK(r.voiceBatchId));
 const trusted=explicit&&!group.some(r=>r.migrationPending)&&idOK(first.sessionId)&&same('date')&&same('place')&&same('condition')&&same('sessionMinutes')&&finite(first.sessionMinutes)&&group.filter(r=>Number(r.minutes)>0).length<=1;
 if(trusted){try{doc.sessions.push(makeSession(group,{...first,minutes:first.sessionMinutes},first.sessionId));continue}catch{/* retain below */}}
 if(mode==='separate'){
 for(const row of group)doc.sessions.push(makeSession([row],row,'legacy-session:'+row.id));
 }else{
 const reason=!idOK(first.sessionId)?'セッションIDがなく、同じ日だけでは区別できません。':'場所・体調・時間の食い違い、または日付だけで統合された可能性があります。';
 group.forEach(record=>doc.pending.push({record:copy(record),reason}));
 }
 }
 return validate(doc);
 }
 function toRecords(doc){
 validate(doc);let order=0;const result=[];
 for(const session of doc.sessions)for(const exercise of session.exercises)for(const set of exercise.sets){
 const first=result.every(r=>r.sessionId!==session.id);
 const original=doc.legacyArchive.find(r=>r.id===set.id);
 result.push({...set.extras,id:set.id,date:session.date,place:session.place,minutes:first?session.minutes:0,condition:session.condition,exercise:exercise.name,part:exercise.part,memo:exercise.memo,weight:set.weight,reps:set.reps,sets:set.sets,sessionId:session.id,sessionMinutes:session.minutes,exerciseId:exercise.id,historyOrder:order++,schemaVersion:2,pain:set.extras?.pain??original?.pain??'なし',inflammation:set.extras?.inflammation??original?.inflammation??'なし',calories:Number(set.extras?.calories)||0});
 }
 return result.concat(doc.pending.map(item=>({...copy(item.record),migrationPending:true})));
 }
 function fromRecords(rows,current=empty()){
 const doc=empty();doc.legacyArchive=copy(current.legacyArchive);
 const pendingIds=new Set(current.pending.map(p=>p.record.id));
 for(const pending of current.pending){
 const row=rows.find(r=>r.id===pending.record.id);
 if(!row)throw Error('要確認の旧記録は移行確認を済ませてから変更してください。');
 const stripped={...row},original={...pending.record};delete stripped.migrationPending;delete original.migrationPending;delete stripped.historyOrder;delete original.historyOrder;
 if(JSON.stringify(stripped)!==JSON.stringify(original))throw Error('要確認の旧記録は、移行確認から整理してください。');
 doc.pending.push(copy(pending));
 }
 const groups=new Map();
 for(const row of [...rows].filter(r=>!pendingIds.has(r.id)).sort((a,b)=>b.date.localeCompare(a.date)||(a.historyOrder??0)-(b.historyOrder??0))){
 if(!idOK(row.sessionId))throw Error('セッションを選択してください。日付だけでは統合しません。');
 if(!groups.has(row.sessionId))groups.set(row.sessionId,[]);groups.get(row.sessionId).push(row);
 }
 for(const [id,items] of groups){
 const first=items[0];for(const key of ['date','place','sessionMinutes','condition'])if(!items.every(r=>r[key]===first[key]))throw Error('同一セッションの'+key+'が異なります。セッション共通欄で確認してください。');
 doc.sessions.push(makeSession(items,{...first,minutes:first.sessionMinutes},id,current.sessions.find(s=>s.id===id)));
 }
 return validate(doc);
 }
 function resolvePending(doc,ids,fields,sessionId){
 const selected=doc.pending.filter(p=>ids.includes(p.record.id));if(!selected.length||selected.length!==new Set(ids).size)throw Error('移行する旧記録を選択してください。');
 if(!validDate(fields.date)||selected.some(p=>p.record.date!==fields.date))throw Error('同じ日付の旧記録を選んでください。');
 if(fields.minutes===''||fields.minutes===undefined||fields.condition===''||fields.condition===undefined)throw Error('共通の時間と体調を指定してください。');
 if(!idOK(sessionId)||doc.sessions.some(s=>s.id===sessionId))throw Error('新しいセッションIDを指定してください。');
 const resolved=selected.map(p=>({...p.record,...(fields.parts?.[p.record.exercise]?{part:fields.parts[p.record.exercise]}:{})}));
 const next=copy(doc);next.sessions.push(makeSession(resolved,fields,sessionId,null,true));next.pending=next.pending.filter(p=>!ids.includes(p.record.id));return validate(next);
 }
 return {KEY,empty,validate,validDate,legacyMemo,migrateLegacy,toRecords,fromRecords,resolvePending};
});
