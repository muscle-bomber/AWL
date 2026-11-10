(function(){
'use strict';
const root=document.getElementById('weightRoot');if(!root||!globalThis.AWLHealth)return;
const model=AWLHealth.create(localStorage),$=id=>document.getElementById(id);let editing=null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n.toLocaleString('ja-JP',{maximumFractionDigits:2});
function inputNow(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function message(text){$('weightStatus').textContent=text}
function chart(rows){
 if(!rows.length)return '<p class="muted">この期間の体重記録はありません。</p>';
 const points=rows.slice().reverse(),values=points.map(o=>o.value),low=Math.min(...values),high=Math.max(...values),pad=Math.max(.5,(high-low)*.15),min=low-pad,max=high+pad;
 const first=Date.parse(points[0].measuredAt),last=Date.parse(points.at(-1).measuredAt);
 const coords=points.map(o=>({x:50+(last===first ? 0.5 : (Date.parse(o.measuredAt)-first)/(last-first))*500,y:160-(o.value-min)/(max-min)*130,o}));
 return `<svg viewBox="0 0 600 210" role="img" aria-label="体重の推移。各測定値は下の履歴にも表示します。"><text x="4" y="22" fill="#abc1cd" font-size="12">${fmt(max)} kg</text><text x="4" y="175" fill="#abc1cd" font-size="12">${fmt(min)} kg</text><path d="M50 30V175H560" fill="none" stroke="#37536a"/><polyline fill="none" stroke="#00cbd4" stroke-width="3" points="${coords.map(p=>p.x+','+p.y).join(' ')}"/>${coords.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#59e1e9"><title>${esc(new Date(p.o.measuredAt).toLocaleString('ja-JP'))}：${fmt(p.o.value)} kg</title></circle>`).join('')}<text x="50" y="200" fill="#abc1cd" font-size="12">${esc(new Date(first).toLocaleDateString('ja-JP'))}</text><text x="560" y="200" text-anchor="end" fill="#abc1cd" font-size="12">${esc(new Date(last).toLocaleDateString('ja-JP'))}</text></svg><p class="hint">縦軸は記録に合わせた範囲です。同日の複数の測定も表示します。</p>`;
}
function render(){
 const doc=model.snapshot(),all=AWLHealth.weights(doc),latest=all[0],previous=all[1],days=Number($('weightRange').value),since=new Date();since.setHours(0,0,0,0);since.setDate(since.getDate()-days+1);
 const shown=all.filter(o=>!days||Date.parse(o.measuredAt)>=since.getTime());
 $('weightLatest').textContent=latest?fmt(latest.value)+' kg':'記録なし';
 $('weightLatestDate').textContent=latest?new Date(latest.measuredAt).toLocaleString('ja-JP')+' · '+(latest.source.kind==='manual'?'手入力':'ヘルスケア'):'';
 const diff=latest&&previous?latest.value-previous.value:null;
 $('weightDifference').textContent=diff===null?'比較対象なし':(diff>0?'+':'')+fmt(diff)+' kg';
 $('weightChart').innerHTML=chart(shown);
 $('weightHistory').innerHTML=shown.length?`<div class="scroll"><table><caption>測定履歴（新しい順・${shown.length}件）</caption><thead><tr><th>測定日時</th><th>体重</th><th>記録元</th><th>操作</th></tr></thead><tbody>${shown.map(o=>`<tr><td>${esc(new Date(o.measuredAt).toLocaleString('ja-JP'))}</td><td>${fmt(o.value)} kg</td><td>${o.source.kind==='manual'?'手入力':'ヘルスケア'}</td><td>${o.source.kind==='manual'?`<button type="button" data-weight-edit="${esc(o.id)}">編集</button> <button type="button" data-weight-delete="${esc(o.id)}">削除</button>`:'連携元で管理'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">体重を記録すると履歴が表示されます。</p>';
 const sync=doc.sync.healthkit;$('weightSync').textContent='ヘルスケア：未連携（iPhone連携機能は準備中）'+(sync.lastSyncedAt?' ／ 保存済み同期日時：'+new Date(sync.lastSyncedAt).toLocaleString('ja-JP'):'');
 if(model.error()){message(model.error());$('weightSave').disabled=true}
}
function reset(){editing=null;$('weightForm').reset();$('weightMeasuredAt').value=inputNow();$('weightSave').textContent='体重を保存';$('weightCancel').hidden=true}
$('weightForm').addEventListener('submit',e=>{
 e.preventDefault();try{
 const date=new Date($('weightMeasuredAt').value);if(!Number.isFinite(date.getTime())||date.getTime()>Date.now())throw Error('測定日時は現在以前を指定してください。');
 model.saveManual({id:editing,recordId:editing?undefined:crypto.randomUUID(),value:Number($('weightValue').value),measuredAt:date.toISOString()});reset();render();message('体重を保存しました。');
 }catch(error){message('保存できませんでした。入力内容を保持しています。'+error.message)}
});
$('weightCancel').addEventListener('click',()=>{reset();message('編集をキャンセルしました。')});
$('weightRange').addEventListener('change',render);
$('weightHistory').addEventListener('click',e=>{
 const edit=e.target.closest('[data-weight-edit]'),del=e.target.closest('[data-weight-delete]');
 if(edit){const o=model.snapshot().observations.find(o=>o.id===edit.dataset.weightEdit);if(!o)return;editing=o.id;$('weightValue').value=o.value;const d=new Date(o.measuredAt);$('weightMeasuredAt').value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);$('weightSave').textContent='変更を保存';$('weightCancel').hidden=false;$('weightValue').focus();message('手入力の記録を編集中です。')}
 if(del&&confirm('この体重記録を削除しますか？'))try{model.removeManual(del.dataset.weightDelete);if(editing===del.dataset.weightDelete)reset();render();message('体重記録を削除しました。')}catch(error){message('削除できませんでした。'+error.message)}
});
$('weightExport').addEventListener('click',()=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify(model.snapshot(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='awl-health.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('weightImport').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const doc=AWLHealth.validate(JSON.parse((await file.text()).replace(/^\ufeff/,'')));if(!confirm('体重・身体測定データをバックアップの内容で置き換えます。現在のデータを書き出しましたか？'))return;model.replaceBackup(doc);reset();render();message('体重データを読み込みました。')}catch(error){message('読み込めませんでした。元データを保持しています。'+error.message)}finally{e.target.value=''}});
reset();render();
})();