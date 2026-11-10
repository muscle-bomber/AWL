/* Keyboard dictation is the input adapter; text parsing can be reused later. */
(function(root){
 'use strict';
 function init(options){
  const {document,storage,services,getRecords,commit}=options,api=root.ShibaVoice;
  const panel=document.getElementById('voiceInputRoot');if(!panel||!api)return null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hierarchical=!!services.sessionModel;
  const initialContext=()=>({date:options.today(),place:'会社・昼トレ',sessionId:'',minutes:'',...(hierarchical?{condition:''}:{})});
  const fresh=context=>api.newDraft(services.createId(new Set(getRecords().flatMap(r=>[r.id,r.sessionId,r.voiceBatchId]).filter(Boolean))),context||initialContext());
  const restored=api.readDraft(storage);let state=restored.draft||fresh(),readError=restored.error||'',notice='',reviewing=false,saved=false,showErrors=false;
  if(hierarchical){if(!state.sessionModel&&restored.draft){state.legacyDraft=JSON.parse(JSON.stringify(restored.draft));state.items=state.items.map(item=>api.sharedExercise(item))}state.sessionModel=true;state.context.condition??=''}
  const opts=(values,current,empty='選択してください')=>`<option value="">${empty}</option>`+values.map(v=>`<option value="${esc(v)}"${String(v)===String(current)?' selected':''}>${esc(v)}</option>`).join('');
  function status(text,error=false){notice=text;const node=panel.querySelector('[data-voice-status]');if(node)node.textContent=text;const bottom=panel.querySelector('[data-voice-review-status]');if(bottom){bottom.textContent=text;bottom.classList?.toggle('danger',error)}}
  function persist(){const result=api.persistDraft(storage,state);status(result.ok?'未保存の入力を一時保存しました。':'一時保存できませんでした。この画面の入力は残しています。再読み込み前に保存領域をご確認ください。');return result.ok}
  function hasSavedBatch(){return getRecords().some(r=>r.voiceBatchId===state.batchId)}
  function finishSaved(){
   const first=getRecords().find(r=>r.voiceBatchId===state.batchId);if(!first)return false;
   saved=true;
   try{storage.removeItem(api.DRAFT_KEY)}catch{status('記録は保存済みです。一時データの削除だけ失敗しました。再試行しても二重登録しません。');render();return false}
   state=fresh({...state.context,sessionId:first.sessionId,minutes:String(first.sessionMinutes),...(hierarchical?{condition:String(first.condition)}:{})});state.sessionModel=hierarchical;reviewing=false;saved=false;notice='まとめて保存しました。一時データを削除しました。';render();return true;
  }
  function itemErrors(item){
   const errors=[];
   if(!item.exercise.trim())errors.push('種目名を入力してください。');
   if(!['胸','背中','脚','肩','腕','体幹','全身'].includes(item.part))errors.push('部位を選択してください。');
   if(item.needsReparse)errors.push('元の文章が変更されています。「この文章で再解析」を押し、解析結果を確認してください。');
   if(!item.rows.length)errors.push('セット行がありません。「重量・回数・セットの行を追加」を押して入力してください。');
   item.rows.forEach((row,index)=>{
    for(const [key,label] of [['weight','重量'],['reps','回数'],['sets','セット数']]){
     const value=Number(row[key]);
     if(row[key]===''||row[key]===undefined||!Number.isFinite(value))errors.push(`${index+1}行目の${label}を入力してください。`);
     else if(value<(key==='sets'?1:0)||(key!=='weight'&&!Number.isInteger(value)))errors.push(`${index+1}行目の${label}は${key==='weight'?'0以上の数値':key==='sets'?'1以上の整数':'0以上の整数'}で入力してください。`);
    }
   });
   if(!hierarchical)for(const [key,label] of [['condition','体調'],['pain','痛み'],['inflammation','炎症']])if(item[key]==='')errors.push(`${label}を選択してください。`);
   return errors;
  }
  function errorText(errors){return errors.map(esc).join('<br>')}
  function errorSummary(){return errorText(state.items.flatMap((item,index)=>itemErrors(item).map(message=>`${index+1}種目目（${item.exercise||'種目名未入力'}）：${message}`)))}
  function refreshErrors(){
   if(!showErrors)return;
   state.items.forEach((item,index)=>{const node=panel.querySelector(`[data-voice-errors="${index}"]`);if(node)node.innerHTML=errorText(itemErrors(item))});
   const summary=panel.querySelector('[data-voice-errors-summary]');if(summary)summary.innerHTML=errorSummary();
  }
  function check(){
   const ctx=state.context,existing=services.sessions(ctx.date,getRecords()).find(s=>s.id===ctx.sessionId);
   const missing=[];
   if(hierarchical&&!existing){
    if(ctx.minutes===''||!Number.isFinite(Number(ctx.minutes))||Number(ctx.minutes)<0)missing.push('セッション全体の時間を0以上の数値で入力してください。');
    if(ctx.condition===''||!Number.isFinite(Number(ctx.condition))||Number(ctx.condition)<1||Number(ctx.condition)>5)missing.push('セッション全体の体調を1〜5から選択してください。');
   }
   if(missing.length)throw Error(missing.join('\n'));
   return api.buildBatch(state,getRecords(),services);
  }
  function render(){
   if(readError){panel.innerHTML=`<h3>未保存の音声入力</h3><p role="status">${esc(readError)} 元の一時データと確定済み記録は保持しています。</p><button type="button" data-voice-action="reset">未保存データだけを破棄してやり直す</button>`;return}
   if(saved){panel.innerHTML=`<h3>記録は保存済みです</h3><p data-voice-status role="status">${esc(notice)}</p><button type="button" data-voice-action="cleanup">一時データの削除を再試行</button>`;return}
   const ctx=state.context,sessions=services.sessions(ctx.date,getRecords()),session=sessions.find(s=>s.id===ctx.sessionId);
   panel.innerHTML=`<h3>音声・文章からまとめて入力</h3><p class="hint">欄をタップし、iPhoneキーボードのマイクで1種目ずつ話してください。文字入力でも使えます。アプリは音声を録音せず、有料APIも使いません。</p><p class="hint">下の手入力とは別の未保存一覧です。日付・場所・時間・体調はこの一覧全体に適用します。</p><div class="grid"><label>日付<input type="date" data-voice-context="date" value="${esc(ctx.date)}"></label><label>場所<select data-voice-context="place"${hierarchical&&session?' disabled':''}>${opts(['会社・昼トレ','自宅・自重','その他'],ctx.place)}</select></label><label>セッション<select data-voice-context="sessionId"><option value="">新しいセッション</option>${sessions.map((s,i)=>`<option value="${esc(s.id)}"${s.id===ctx.sessionId?' selected':''}>セッション${i+1}（${esc(s.place||'')} ${esc(s.minutes)}分）</option>`).join('')}</select></label><label>セッション全体の時間（分）<input type="number" min="0" step="any" data-voice-context="minutes" value="${esc(session?session.minutes:ctx.minutes)}"${session?' readonly':''}></label>${hierarchical?`<label>セッション全体の体調<select data-voice-context="condition"${session?' disabled':''}>${opts([1,2,3,4,5],session?session.condition:ctx.condition)}</select></label>`:''}</div><label for="voiceText">音声入力した文章（文字で修正できます）</label><textarea id="voiceText" data-voice-text placeholder="ベンチプレス60キロ10回3セット、70キロ8回2セット。体調3、痛みなし、炎症なし">${esc(state.text)}</textarea><div class="row"><button type="button" data-voice-action="analyze">解析して追加</button><button type="button" data-voice-action="next">次の種目を追加</button></div><p data-voice-status role="status">${esc(notice)}</p><h4>未保存の種目：${state.items.length}件</h4><p class="hint">${hierarchical?'部位は辞書の候補です。体調はセッション共通欄で選び、痛みや違和感は種目メモに記録します。':'部位は辞書の候補です。未指定の体調・痛み・炎症は選択してください。'}解析できなかった文章も確認に残します。</p>${state.items.map((item,i)=>`<div class="voice-item" data-voice-item="${i}"><h4>${i+1}種目目（未保存）</h4>${hierarchical&&state.legacyDraft&&item.condition?`<p class="hint">旧下書きの体調：${esc(item.condition)}。元の値は保管し、新しい体調は上のセッション共通欄で選びます。</p>`:''}<label>元の文章<textarea data-voice-field="source">${esc(item.source)}</textarea></label><button type="button" data-voice-action="reparse" data-index="${i}">この文章で再解析</button><label>種目名<input data-voice-field="exercise" value="${esc(item.exercise)}"></label><label>部位<select data-voice-field="part">${opts(['胸','背中','脚','肩','腕','体幹','全身'],item.part)}</select></label>${item.rows.map((row,j)=>`<div class="voice-set" data-voice-row="${j}"><div class="edit-number-grid">${[['weight','重量（kg）','any',0],['reps','回数',1,0],['sets','セット数',1,1]].map(([key,label,step,min])=>`<label>${label}<input type="number" min="${min}" step="${step}" data-voice-number="${key}" value="${esc(row[key])}"></label>`).join('')}</div><button type="button" data-voice-action="remove-row" data-index="${i}" data-row="${j}">この行を削除</button></div>`).join('')}<button type="button" data-voice-action="add-row" data-index="${i}">重量・回数・セットの行を追加</button>${hierarchical?'':`<label>体調<select data-voice-field="condition">${opts([1,2,3,4,5],item.condition)}</select></label><label>痛み<select data-voice-field="pain">${opts(['なし','軽い','中程度','強い'],item.pain)}</select></label><label>炎症<select data-voice-field="inflammation">${opts(['なし','あり'],item.inflammation)}</select></label>`}<label>種目メモ（痛み・違和感・フォームなど）<textarea data-voice-field="memo">${esc(item.memo)}</textarea></label>${item.unparsed?`<p class="danger">未解析：${esc(item.unparsed)}</p>`:''}<p class="danger" role="alert" data-voice-errors="${i}">${showErrors?errorText(itemErrors(item)):''}</p><button type="button" data-voice-action="remove" data-index="${i}">この種目を未保存一覧から削除</button></div>`).join('')}<button type="button" data-voice-action="review">全種目を確認</button><p class="danger" role="alert" data-voice-errors-summary>${showErrors?errorSummary():''}</p><p data-voice-review-status role="status">${esc(notice)}</p><div data-voice-review>${reviewing?renderReview():''}</div>`;
  }
  function renderReview(){
   const session=services.sessions(state.context.date,getRecords()).find(s=>s.id===state.context.sessionId);
   return `<div class="voice-review"><h4>一括保存前の最終確認</h4><p>${esc(state.context.date)} ／ ${esc(state.context.place)} ／ セッション全体 ${esc(session?session.minutes:state.context.minutes)}分（重複加算しません）${hierarchical?` ／ セッション全体の体調${esc(session?session.condition:state.context.condition)}/5`:''}</p>${state.items.map(item=>`<div><strong>${esc(item.exercise)}（${esc(item.part)}）</strong>${item.rows.map(r=>`<p>${esc(r.weight)}kg × ${esc(r.reps)}回 × ${esc(r.sets)}セット</p>`).join('')}${hierarchical?'':`<p>体調${esc(item.condition)}・痛み${esc(item.pain)}・炎症${esc(item.inflammation)}</p>`}<p>メモ：${esc(item.memo)||'なし'}</p><details><summary>元の文章・未解析部分を確認</summary><p>${esc(item.source)}</p><p>未解析：${esc(item.unparsed)||'なし'}</p></details></div>`).join('')}<p>元の文章や未解析部分も記録に保存します。内容が正しければ、次のボタンで確定してください。</p><button type="button" class="primary" data-voice-action="save">確認して一括保存</button></div>`;
  }
  function analyze(index=null){
   if(saved||readError)return;
   if(index===null&&state.consumed){status('この文章は追加済みです。「次の種目を追加」から続けてください。');return}
   const source=index===null?state.text:state.items[index].source;
   if(!source.trim()){status('文章を入力してください。');return}
   const parsed=hierarchical?api.parseSessionExercise(source):api.parse(source);if(parsed.multipleExercises){status(parsed.issues.join(' '));return}
   const id=index===null?services.createId(new Set(state.items.map(i=>i.id))):state.items[index].id;
   const item={...parsed,id};if(index===null){state.items.push(item);state.consumed=true}else state.items[index]=item;
   reviewing=false;persist();render();
  }
  function review(){if(saved||readError)return;try{showErrors=true;refreshErrors();if(state.text.trim()&&!state.consumed)throw Error('未追加の文章があります。「解析して追加」を押すか、不要な文章を空にしてください。');if(services.validDate&&!services.validDate(state.context.date))throw Error('日付を確認してください。');if(state.items.some(item=>itemErrors(item).length)){reviewing=false;status(state.items.flatMap((item,index)=>itemErrors(item).map(message=>(index+1)+'種目目：'+message)).join('\n'),true);panel.querySelector('[data-voice-errors-summary]')?.scrollIntoView?.({block:'center'});return}check();reviewing=true;status('全種目の内容を確認し、一番下の「確認して一括保存」を押してください。');render();panel.querySelector('[data-voice-review]')?.scrollIntoView?.({block:'start'})}catch(error){status(error.message,true);panel.querySelector('[data-voice-review-status]')?.scrollIntoView?.({block:'center'})}}
  function saveAll(){
   if(hasSavedBatch()){finishSaved();return}
   if(!reviewing){status('先に「全種目を確認」を押してください。');return}
   if(options.isHistoryEditing?.()){status('履歴の編集を保存またはキャンセルしてから、一括保存してください。');return}
   try{const batch=check();if(!batch.alreadySaved&&!commit(batch.next)){status('保存に失敗しました。未保存の種目と入力を保持しています。');return}finishSaved()}
   catch(error){if(hasSavedBatch())finishSaved();else status('保存できませんでした：'+error.message)}
  }
  panel.addEventListener('input',event=>{
   if(saved||readError)return;const target=event.target;
   if(target.hasAttribute('data-voice-text')){state.text=target.value;state.consumed=false}
   else if(target.dataset.voiceContext){state.context[target.dataset.voiceContext]=target.value;if(target.dataset.voiceContext==='date')state.context.sessionId=''}
   else{const itemNode=target.closest('[data-voice-item]');if(!itemNode)return;const item=state.items[Number(itemNode.dataset.voiceItem)];if(target.dataset.voiceField){item[target.dataset.voiceField]=target.value;if(target.dataset.voiceField==='source')item.needsReparse=true}else if(target.dataset.voiceNumber){const row=target.closest('[data-voice-row]');item.rows[Number(row.dataset.voiceRow)][target.dataset.voiceNumber]=target.value}}
   reviewing=false;const summary=panel.querySelector('[data-voice-review]');if(summary)summary.innerHTML='';persist();refreshErrors();
  });
  panel.addEventListener('change',event=>{
   if(event.target.dataset.voiceContext==='sessionId'||event.target.dataset.voiceContext==='date'){
    const key=event.target.dataset.voiceContext;state.context[key]=event.target.value;if(key==='date')state.context.sessionId='';
    const session=services.sessions(state.context.date,getRecords()).find(s=>s.id===state.context.sessionId);if(session){state.context.minutes=String(session.minutes);if(hierarchical){state.context.place=session.place;state.context.condition=String(session.condition)}}else if(hierarchical)state.context.condition='';
    reviewing=false;persist();render();
   }
  });
  panel.addEventListener('click',event=>{
   const button=event.target.closest('[data-voice-action]');if(!button)return;const {voiceAction:action,index,row}=button.dataset;
   if(action==='reset'){if(options.confirm('未保存の音声入力だけを破棄しますか？確定済み記録は変更しません。')){try{storage.removeItem(api.DRAFT_KEY);readError='';state=fresh();render();panel.querySelector('[data-voice-review]')?.scrollIntoView?.({block:'start'})}catch(error){status(error.message,true);panel.querySelector('[data-voice-review-status]')?.scrollIntoView?.({block:'center'})}}return}
   if(action==='cleanup'){finishSaved();return}if(saved||readError)return;
   if(action==='analyze'){analyze();return}if(action==='reparse'){analyze(Number(index));return}if(action==='review'){review();return}if(action==='save'){saveAll();return}
   if(action==='next'){
    if(state.text.trim()&&!state.consumed&&!options.confirm('未追加の文章を空にして、次の種目へ進みますか？'))return;
    state.text='';state.consumed=false;
   }
   if(action==='remove'){const item=state.items[Number(index)];if(item.source===state.text)state.consumed=false;state.items.splice(Number(index),1)}
   if(action==='add-row')state.items[Number(index)].rows.push({weight:'',reps:'',sets:''});
   if(action==='remove-row')state.items[Number(index)].rows.splice(Number(row),1);
   reviewing=false;persist();render();if(action==='next')panel.querySelector('[data-voice-text]')?.focus();
  });
  if(hasSavedBatch())finishSaved();else{if(restored.draft)notice='前回の未保存データを復元しました。';render()}
  return {getState:()=>JSON.parse(JSON.stringify(state)),analyze,review,saveAll};
 }
 root.ShibaVoiceUI={init};
})(globalThis);