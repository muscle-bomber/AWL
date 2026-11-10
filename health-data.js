/* Weight observations are independent of workout sessions. Native HealthKit adapter is not installed. */
(function(root){
'use strict';
const KEY='awl-health-v1',clone=v=>JSON.parse(JSON.stringify(v));
function empty(){return {version:1,observations:[],sync:{healthkit:{anchor:null,lastSyncedAt:null}}}}
function iso(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))}
function validObservation(o){
 if(!o||!['bodyMass','bodyFatPercentage'].includes(o.metric)||!iso(o.measuredAt)||!iso(o.updatedAt))throw Error('測定データの形式が正しくありません。');
 if(typeof o.value!=='number'||!Number.isFinite(o.value)||(o.metric==='bodyMass'?(o.unit!=='kg'||o.value<=0||o.value>1000):(o.unit!=='%'||o.value<0||o.value>100)))throw Error('測定値・単位が正しくありません。');
 if(!o.source||!['manual','healthkit'].includes(o.source.kind)||typeof o.id!=='string'||!o.id||typeof o.source.recordId!=='string'||!o.source.recordId||o.id!==o.source.kind+':'+o.source.recordId)throw Error('記録元のIDが正しくありません。');
 return o;
}
function validate(doc){
 if(!doc||doc.version!==1||!Array.isArray(doc.observations)||!doc.sync?.healthkit)throw Error('対応していない体重データです。');
 const ids=new Set();for(const o of doc.observations){validObservation(o);if(ids.has(o.id))throw Error('記録IDが重複しています。');ids.add(o.id)}
 const s=doc.sync.healthkit;if(s.anchor!==null&&typeof s.anchor!=='string'||s.lastSyncedAt!==null&&!iso(s.lastSyncedAt))throw Error('同期情報が正しくありません。');
 return clone(doc);
}
function create(storage){
 let doc=empty(),error='';
 try{const raw=storage.getItem(KEY);if(raw!==null)doc=validate(JSON.parse(raw))}catch(e){error='体重データを読み込めません。元データを保護して保存を停止しています。'+e.message}
 function commit(next){if(error)throw Error(error);next=validate(next);storage.setItem(KEY,JSON.stringify(next));doc=next;return snapshot()}
 function snapshot(){return clone(doc)}
 return {snapshot,error:()=>error,
 saveManual({id,recordId,value,measuredAt,now=new Date().toISOString()}){
 const next=snapshot();let previous;
 if(id){previous=next.observations.find(o=>o.id===id);if(!previous||previous.source.kind!=='manual')throw Error('手入力の記録だけ編集できます。')}
 const rid=previous?.source.recordId||recordId;if(typeof rid!=='string'||!rid)throw Error('記録IDを作成できません。');
 const item=validObservation({id:'manual:'+rid,metric:'bodyMass',value,unit:'kg',measuredAt,updatedAt:now,source:{kind:'manual',recordId:rid}});
 next.observations=next.observations.filter(o=>o.id!==item.id).concat(item);return commit(next);
 },
 removeManual(id){const next=snapshot(),o=next.observations.find(o=>o.id===id);if(!o||o.source.kind!=='manual')throw Error('手入力の記録だけ削除できます。');next.observations=next.observations.filter(o=>o.id!==id);return commit(next)},
 applyHealthKitBatch(batch){
 if(!batch||batch.version!==1||batch.metric!=='bodyMass'||!Array.isArray(batch.upserts)||!Array.isArray(batch.deletedRecordIds)||typeof batch.anchor!=='string'||!batch.anchor||!iso(batch.syncedAt))throw Error('同期データが正しくありません。');
 if(batch.previousAnchor!==doc.sync.healthkit.anchor)throw Error('同期の順序が変わっています。最新の位置から再取得してください。');
 const next=snapshot(),seen=new Set(),deleted=new Set();
 for(const id of batch.deletedRecordIds){if(typeof id!=='string'||!id||deleted.has(id))throw Error('削除IDが正しくありません。');deleted.add(id)}
 const items=batch.upserts.map(o=>{validObservation(o);if(o.metric!=='bodyMass'||o.source.kind!=='healthkit'||seen.has(o.id)||deleted.has(o.source.recordId))throw Error('同期レコードが競合しています。');seen.add(o.id);return clone(o)});
 next.observations=next.observations.filter(o=>o.source.kind!=='healthkit'||!deleted.has(o.source.recordId)&&!seen.has(o.id)).concat(items);
 next.sync.healthkit={anchor:batch.anchor,lastSyncedAt:batch.syncedAt};return commit(next);
 },
 replaceBackup(value){return commit(validate(value))}
 };
}
function weights(doc){return doc.observations.filter(o=>o.metric==='bodyMass').slice().sort((a,b)=>Date.parse(b.measuredAt)-Date.parse(a.measuredAt)||b.id.localeCompare(a.id))}
const api={KEY,empty,validate,create,weights};root.AWLHealth=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);