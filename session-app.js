/* UI/storage adapter for the three-level model. v1 storage remains untouched. */
(function(root){
 'use strict';
 function create(bridge){
 const model=root.ShibaTraining,storage=bridge.storage;let doc=model.empty(),readError='',needsMigration=false,sourceText='';
 const esc=bridge.esc,num=v=>Number(v)||0,fmt=bridge.fmt,clone=v=>JSON.parse(JSON.stringify(v));
 const options=(values,current)=>'<option value="">選択してください</option>'+values.map(v=>`<option value="${esc(v)}"${String(current)===String(v)?' selected':''}>${esc(v)}</option>`).join('');
 const usedIds=()=>new Set(rows().concat(doc.legacyArchive).flatMap(r=>[r.id,r.sessionId,r.exerciseId,r.voiceBatchId]).filter(Boolean));
 function rows(){return model.toRecords(doc)}
 function loadRows(){
 try{
 const modern=storage.getItem(model.KEY);sourceText=modern??storage.getItem('shiba-train-log-v1')??'[]';
 if(modern!==null){doc=model.validate(JSON.parse(modern));needsMigration=false}
 else{const old=JSON.parse(storage.getItem('shiba-train-log-v1')||'[]');if(!Array.isArray(old)||!old.every(bridge.valid))throw Error('旧記録に不正な項目があります。元データは変更していません。');doc=model.migrateLegacy(old);needsMigration=old.length>0}
 readError='';return rows();
 }catch(error){readError=error.message;bridge.alert('保存データを読み込めません。元データを保護するため保存を止めています。'+readError);return []}
 }
 function writeDocument(next,restore=false){
 try{
 if(readError&&!restore)throw Error('読み込みエラーがあるため保存できません。バックアップを確認してください。');
 model.validate(next);
 if(readError&&restore){const raw=storage.getItem(model.KEY);if(raw!==null)storage.setItem(model.KEY+'-before-restore',raw)}
 storage.setItem(model.KEY,JSON.stringify(next));doc=next;needsMigration=false;readError='';return true;
 }catch(error){bridge.alert('保存できませんでした。変更前の記録と入力内容を保持します。'+error.message);return false}
 }
 function writeRows(next){try{return writeDocument(model.fromRecords(next,doc))}catch(error){bridge.alert(error.message);return false}}
 function sessions(date){return doc.sessions.filter(s=>s.date===date).map(s=>({id:s.id,date:s.date,place:s.place,minutes:s.minutes,condition:s.condition}))}
 function combineMemo(previous,next){return [...new Set([previous,next].filter(v=>v&&v.trim()))].join('\n\n')}
 function makeBatch(context,items,batchId=''){
 const current=rows();if(batchId&&current.some(r=>r.voiceBatchId===batchId))return {alreadySaved:true,next:current};
 const existing=context.sessionId?doc.sessions.find(s=>s.id===context.sessionId&&s.date===context.date):null;
 if(context.sessionId&&!existing)throw Error('セッションを選び直してください。');
 if(existing&&context.place&&context.place!==existing.place)throw Error('選択したセッションと場所が異なります。別のトレーニングは新しいセッションにしてください。');
 const place=existing?.place||context.place;
 const minutes=existing?existing.minutes:Number(context.minutes),condition=existing?existing.condition:Number(context.condition);
 if(!model.validDate(context.date)||!['会社・昼トレ','自宅・自重','その他'].includes(place)||!existing&&(context.minutes===''||context.minutes===undefined)||!Number.isFinite(minutes)||minutes<0||!Number.isFinite(condition)||condition<1||condition>5)throw Error('セッションの日付・場所・時間・体調を確認してください。');
 if(!items.length)throw Error('種目を1件以上入力してください。');
 const used=usedIds(),sessionId=existing?existing.id:bridge.createId(used);used.add(sessionId);const additions=[],memoChanges=new Map();
 for(const item of items){
 if(!item.exercise?.trim()||!item.rows?.length||item.needsReparse)throw Error('種目名・セット行・再解析の状態を確認してください。');
 const name=item.exercise.trim(),old=existing?.exercises.find(e=>e.name===name);
 if(old&&old.part!==item.part)throw Error('同じ種目の部位が異なります。部位を合わせるか、履歴の種目編集で修正してください。');
 const memo=combineMemo(memoChanges.get(name)??old?.memo??'',item.memo||'');memoChanges.set(name,memo);
 for(const row of item.rows){
 if(['weight','reps','sets'].some(k=>row[k]===''||!Number.isFinite(Number(row[k])))||Number(row.weight)<0||Number(row.reps)<0||!Number.isInteger(Number(row.reps))||Number(row.sets)<1||!Number.isInteger(Number(row.sets)))throw Error('重量・回数・セット数を確認してください。');
 const id=bridge.createId(used);used.add(id);
 const record={id,date:context.date,place:existing?.place||context.place,sessionId,sessionMinutes:minutes,condition,exercise:name,part:item.part,memo,weight:Number(row.weight),reps:Number(row.reps),sets:Number(row.sets),minutes:!existing&&additions.length===0?minutes:0,pain:'なし',inflammation:'なし',calories:0,schemaVersion:2,historyOrder:current.filter(r=>r.date===context.date).length+additions.length};
 if(batchId){Object.assign(record,{voiceBatchId:batchId,voiceSource:item.source||'',voiceUnparsed:item.unparsed||''});if(item.legacyCondition!==undefined)record.voiceLegacyCondition=item.legacyCondition}
 if(!bridge.valid(record))throw Error('入力内容を確認してください。');additions.push(record);
 }
 }
 const next=current.concat(additions).map(r=>r.sessionId===sessionId&&!r.migrationPending&&memoChanges.has(r.exercise)?{...r,memo:memoChanges.get(r.exercise)}:r);
 return {alreadySaved:false,next,sessionId,additions};
 }
 function buildSets(fields,sets){return makeBatch(fields,[{exercise:fields.exercise,part:fields.part,memo:fields.memo||'',rows:sets.map(r=>({...r,sets:r.sets??1}))}]).next}
 function voiceBatch(draft){
 if(draft.text.trim()&&!draft.consumed)throw Error('未追加の文章があります。「解析して追加」を押してください。');
 return makeBatch(draft.context,draft.items.map(item=>({...item,legacyCondition:draft.legacyDraft?.items.find(old=>old.id===item.id)?.condition})),draft.batchId);
 }
 function editCard(cardId,draft){
 const card=bridge.cards().find(c=>c.id===cardId);if(!card||card.pending)throw Error('旧記録は移行確認後に編集してください。');
 if(!draft.exercise?.trim()||!draft.rows.length)throw Error('種目名と1行以上のセットを入力してください。');
 const originals=new Map(card.rows.map(r=>[r.id,r])),seen=new Set(),used=usedIds();
 const updated=draft.rows.map(row=>{
 if(row.id&&(!originals.has(row.id)||seen.has(row.id)))throw Error('記録IDを確認してください。');if(row.id)seen.add(row.id);
 for(const key of ['weight','reps','sets'])if(row[key]===''||!Number.isFinite(Number(row[key])))throw Error('セット情報を確認してください。');
 const original=row.id?originals.get(row.id):card.rows[0];let id=row.id;if(!id){id=bridge.createId(used);used.add(id)}
 const next={...original,id,exercise:draft.exercise.trim(),part:draft.part,memo:draft.memo??'',weight:Number(row.weight),reps:Number(row.reps),sets:Number(row.sets)};
 if(!row.id)Object.assign(next,{minutes:0,calories:0,pain:'なし',inflammation:'なし'});
 if(!bridge.valid(next)||!Number.isInteger(next.reps)||!Number.isInteger(next.sets))throw Error('重量・回数・セット数を確認してください。');return next;
 });
 const next=rows().filter(r=>!originals.has(r.id)).concat(updated),order=bridge.cards().filter(c=>c.date===card.date).flatMap(c=>c.id===cardId?updated:c.rows),ranks=new Map(order.map((r,i)=>[r.id,i]));
 return next.map(r=>ranks.has(r.id)?{...r,historyOrder:ranks.get(r.id)}:r);
 }
 function editSessions(date,changes){
 const known=sessions(date);if(changes.length!==known.length)throw Error('セッションを確認してください。');
 const map=new Map();for(const change of changes){if(map.has(change.id)||!known.some(s=>s.id===change.id)||change.minutes===''||change.condition===''||!Number.isFinite(Number(change.minutes))||Number(change.minutes)<0||Number(change.condition)<1||Number(change.condition)>5||!['会社・昼トレ','自宅・自重','その他'].includes(change.place))throw Error('セッションの場所・時間・体調を確認してください。');map.set(change.id,change)}
 const anchors=new Set();return rows().map(r=>{const update=r.date===date&&!r.migrationPending?map.get(r.sessionId):null;if(!update)return r;const first=!anchors.has(r.sessionId);anchors.add(r.sessionId);return {...r,place:update.place,condition:Number(update.condition),sessionMinutes:Number(update.minutes),minutes:first?Number(update.minutes):0}});
 }
 function renderCardEditor(card,editor){
 const draft=editor.draft;return `<form data-history-editor><h4>種目を編集</h4><label>種目名<input data-edit-field="exercise" value="${esc(draft.exercise)}" required></label><label>部位<select data-edit-field="part">${options(['胸','背中','脚','肩','腕','体幹','全身'],draft.part)}</select></label>${draft.rows.map((row,i)=>`<fieldset data-edit-row="${i}"><legend>${i+1}行目</legend><div class="edit-number-grid">${[['weight','重量（kg）',0,'any'],['reps','回数',0,1],['sets','セット数',1,1]].map(([key,label,min,step])=>`<label>${label}<input type="number" data-row-field="${key}" min="${min}" step="${step}" value="${esc(row[key])}" required></label>`).join('')}</div><button type="button" data-edit-remove="${i}">この入力行を削除</button></fieldset>`).join('')}<button type="button" data-edit-add>行を追加</button><label>種目メモ<textarea data-edit-field="memo">${esc(draft.memo)}</textarea></label><p class="hint">痛み・違和感・フォーム・疲労感もここに記録します。体調はセッション共通欄で編集してください。</p><p data-editor-error class="danger" role="status">${esc(editor.error||'')}</p><button type="submit" class="primary">保存</button> <button type="button" data-edit-cancel>キャンセル</button></form>`;
 }
 function renderTime(date,editor){
 if(editor?.kind==='time'&&editor.date===date)return `<div class="history-time editing" data-time-date="${esc(date)}"><form data-history-editor><h4>セッション共通情報を編集</h4>${editor.draft.map((s,i)=>`<fieldset><legend>セッション${i+1}</legend><label>場所<select data-session-index="${i}" data-session-field="place">${options(['会社・昼トレ','自宅・自重','その他'],s.place)}</select></label><label>運動時間（分）<input type="number" min="0" step="any" data-time-index="${i}" value="${esc(s.minutes)}" required></label><label>体調<select data-session-index="${i}" data-session-field="condition">${options([1,2,3,4,5],s.condition)}</select></label></fieldset>`).join('')}<p data-editor-error class="danger" role="status">${esc(editor.error||'')}</p><button type="submit" class="primary">保存</button> <button type="button" data-edit-cancel>キャンセル</button></form></div>`;
 const list=sessions(date);return `<div class="history-time" data-time-date="${esc(date)}"><strong>運動時間 ${fmt(list.reduce((n,s)=>n+s.minutes,0))}分</strong><small>確認済みセッションの全場所合計・重複なし</small>${list.map((s,i)=>`<p>セッション${i+1}：${esc(s.place)} ／ ${fmt(s.minutes)}分 ／ 体調${fmt(s.condition)}/5</p>`).join('')}${list.length?`<button type="button" data-time-edit="${esc(date)}">場所・時間・体調を編集</button>`:''}</div>`;
 }
 function renderHistory(editor,groupBy,place){
 const cards=bridge.cards().filter(c=>place==='all'||c.place===place),weeks=new Map();
 for(const card of cards){const week=groupBy==='week'?bridge.week(card.date):'';if(!weeks.has(week))weeks.set(week,new Map());const dates=weeks.get(week);if(!dates.has(card.date))dates.set(card.date,[]);dates.get(card.date).push(card)}
 return [...weeks].map(([week,dates])=>(week?`<h3>${esc(week)} の週</h3>`:'')+[...dates].map(([date,items])=>`<div class="history-day" data-history-date="${esc(date)}"><h3>${esc(date)}</h3>${renderTime(date,editor)}${[...new Set(items.map(c=>c.pending?'pending':c.sessionId))].map(id=>`<div class="history-session"><h4>${id==='pending'?'旧記録（要確認・時間や体調を自動統合しません）':`セッション：${esc(sessions(date).find(s=>s.id===id)?.place||'')}`}</h4>${items.filter(c=>(c.pending?'pending':c.sessionId)===id).map(card=>`<article class="history-exercise${editor?.kind==='card'&&editor.id===card.id?' editing':''}" data-card-id="${esc(card.id)}">${editor?.kind==='card'&&editor.id===card.id?renderCardEditor(card,editor):`<div class="history-card-head"><div><h4>${esc(card.exercise)}</h4><span class="tag">${esc(card.part)}</span><small>${esc(card.place)}・合計${fmt(card.rows.reduce((n,r)=>n+num(r.sets),0))}セット</small></div>${card.pending?'':`<button type="button" class="reorder-handle" data-reorder="${esc(card.id)}" aria-label="長押しして並べ替え">≡</button>`}</div>${card.rows.map((r,i)=>`<div class="history-set" data-record-id="${esc(r.id)}"><strong>${fmt(r.weight)}kg × ${fmt(r.reps)}回 × ${fmt(r.sets)}セット</strong>${card.pending?`<p>元の時間：${fmt(r.minutes)}分 ／ 元の体調：${fmt(r.condition)}/5</p>`:`<button type="button" class="delete-set" data-delete="${esc(r.id)}">この行を削除</button>`}</div>`).join('')}<p class="history-memo">メモ：${esc((card.pending?model.legacyMemo(card.rows,true):card.memo)||'なし')}</p>${card.pending?'<p class="hint">上の移行確認で元の情報を確認してください。</p>':`<div class="history-card-actions"><button type="button" data-card-edit="${esc(card.id)}">編集</button><button type="button" data-card-move="${esc(card.id)}" data-step="-1">↑ 上へ</button><button type="button" data-card-move="${esc(card.id)}" data-step="1">↓ 下へ</button></div>`}`}</article>`).join('')}</div>`).join('')}</div>`).join('')).join('')||'<p>該当する記録はありません。</p>';
 }
 function renderMigration(){
 const panel=bridge.document.getElementById('migrationPanel');if(!panel)return;
 panel.innerHTML=`<h3>データ保護・移行確認</h3><p>移行前にJSONバックアップを書き出してください。旧保存領域は上書きせず残します。</p><button type="button" data-model-action="backup">移行前の元データをJSON保存</button>${readError?`<p class="danger">${esc(readError)}（保存停止中）</p>`:''}${needsMigration?'<p>まだ新しい保存領域には書き込んでいません。</p><button type="button" data-model-action="persist">確認済みの構造を保存</button>':''}${doc.pending.length?`<h4>要確認の旧記録：${doc.pending.length}件</h4><p>同じトレーニングに属する記録だけ選び、共通情報を入力してください。元の値は保管します。</p>${doc.pending.map(p=>`<div class="migration-row"><label><input type="checkbox" data-migrate-id="${esc(p.record.id)}"> ${esc(p.record.date)} ${esc(p.record.exercise)} ／ ${esc(p.record.place)}</label><p>元の時間 ${fmt(p.record.minutes)}分 ／ 保存済みセッション時間 ${esc(p.record.sessionMinutes??'不明')}分 ／ 体調${esc(p.record.condition)}</p><p>${esc(p.reason)}</p><details><summary>元の情報をすべて確認</summary><pre>${esc(JSON.stringify(p.record,null,2))}</pre></details></div>`).join('')}<label>日付<input type="date" data-migration-field="date" value="${esc(doc.pending[0].record.date)}"></label><label>場所<select data-migration-field="place">${options(['会社・昼トレ','自宅・自重','その他'],'')}</select></label><label>このトレーニング全体の時間（分）<input type="number" min="0" step="any" data-migration-field="minutes"></label><label>体調<select data-migration-field="condition">${options([1,2,3,4,5],'')}</select></label>${[...new Set(doc.pending.map(p=>p.record.exercise))].map(name=>`<label>「${esc(name)}」の共通部位（元の部位が異なる場合に選択）<select data-migration-part="${esc(name)}">${options(['胸','背中','脚','肩','腕','体幹','全身'],'')}</select></label>`).join('')}<button type="button" class="primary" data-model-action="resolve">選択した旧記録を1セッションへ移行</button>`:'<p>要確認の旧記録はありません。</p>'}<p data-migration-status role="status"></p>`;
 }
 function install(){
 const panel=bridge.document.getElementById('migrationPanel');if(!panel)return;
 panel.addEventListener('click',e=>{
 const button=e.target.closest('[data-model-action]');if(!button)return;
 const status=panel.querySelector('[data-migration-status]');try{
 if(button.dataset.modelAction==='backup'){bridge.download('shiba-original-backup.json',readError?sourceText:JSON.stringify(doc.legacyArchive.length?doc.legacyArchive:doc,null,2),'application/json');return}
 let next=doc;
 if(button.dataset.modelAction==='resolve'){
 const ids=[...panel.querySelectorAll('[data-migrate-id]:checked')].map(input=>input.dataset.migrateId),fields=Object.fromEntries(['date','place','minutes','condition'].map(key=>[key,panel.querySelector(`[data-migration-field="${key}"]`).value]));
 if(fields.minutes===''||fields.condition==='')throw Error('時間と体調を入力してください。推測では補完しません。');
 fields.parts=Object.fromEntries([...panel.querySelectorAll('[data-migration-part]')].filter(input=>input.value).map(input=>[input.dataset.migrationPart,input.value]));
 next=model.resolvePending(doc,ids,fields,bridge.createId(usedIds()));
 }
 if(!writeDocument(next)){status.textContent='保存できませんでした。選択と入力を残しています。';return}
 bridge.publish(rows());
 }catch(error){status.textContent=error.message}
 });
 }
 function importData(value){if(Array.isArray(value)&&!value.every(bridge.valid))throw Error('旧JSONの入力項目が正しくありません。既存データは変更していません。');const next=Array.isArray(value)?model.migrateLegacy(value):model.validate(clone(value));return writeDocument(next,true)}
 function summary(){
 const cutoff=bridge.today(),sessions=doc.sessions.filter(s=>bridge.dayDiff(cutoff,s.date)>=0&&bridge.dayDiff(cutoff,s.date)<14),all=rows(),recent=all.filter(r=>bridge.dayDiff(cutoff,r.date)>=0&&bridge.dayDiff(cutoff,r.date)<14),previous=all.filter(r=>bridge.dayDiff(cutoff,r.date)>=14&&bridge.dayDiff(cutoff,r.date)<28),volume=list=>list.reduce((n,r)=>n+r.weight*r.reps*r.sets,0),lines=['以下はトレーニング記録です。痛み・違和感などの種目メモを確認し、安全側で提案してください。',`集計日：${cutoff} ／ 直近14日：${sessions.length}確認済みセッション`, `運動時間：${fmt(sessions.reduce((n,s)=>n+s.minutes,0))}分（確認済みセッションのみ）`,`外部重量ボリューム：${fmt(volume(recent))}kg（前の14日：${fmt(volume(previous))}kg・要確認の旧記録も含む）`];
 for(const s of sessions){lines.push('',`${s.date}｜${s.place}｜運動時間${fmt(s.minutes)}分｜体調${fmt(s.condition)}/5`);for(const e of s.exercises){lines.push(`${e.name}（${e.part}）`);e.sets.forEach(r=>lines.push(`${fmt(r.weight)}kg × ${fmt(r.reps)}回 × ${fmt(r.sets)}セット`));lines.push('種目メモ：'+(e.memo||'なし'))}}
 if(doc.pending.length){lines.push('','【移行要確認の旧記録（自動統合していません）】');for(const p of doc.pending.filter(p=>bridge.dayDiff(cutoff,p.record.date)>=0&&bridge.dayDiff(cutoff,p.record.date)<14)){const r=p.record;lines.push(`${r.date}｜${r.exercise}｜${r.place}｜${r.minutes}分｜体調${r.condition}｜メモ:${r.memo||''}｜旧痛み:${r.pain||''}`)}}return lines.join('\n');
 }
 function averageCondition(){const current=doc.sessions.filter(s=>bridge.dayDiff(bridge.today(),s.date)>=0&&bridge.dayDiff(bridge.today(),s.date)<14);return current.length?current.reduce((n,s)=>n+s.condition,0)/current.length:0}
 function recentHTML(){return bridge.cards().slice(0,6).map(c=>`<div class="entry"><strong>${esc(c.date)}・${esc(c.exercise)}</strong> <span class="tag">${esc(c.place)}</span><div class="muted">${c.rows.map(r=>`${fmt(r.weight)}kg × ${fmt(r.reps)}回 × ${fmt(r.sets)}セット`).join(' ／ ')}</div>${c.pending?'<small>旧記録・移行要確認</small>':''}</div>`).join('')||'<p>記録がありません。</p>'}
 return {loadRows,writeRows,rows,buildSets,voiceBatch,sessions,editCard,editSessions,renderHistory,renderMigration,install,importData,summary,averageCondition,recentHTML,getDocument:()=>clone(doc)};
 }
 root.ShibaSessionApp={create};
})(globalThis);
