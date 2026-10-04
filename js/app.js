import { db, doc, getDoc, setDoc, onSnapshot } from './firebase.js';
import { scaleNutrient, formatNutrient, sumNutrition } from './nutrition.js';

// ── STATE ────────────────────────────────────────────────
let state = {
  goals:     { cal:2000, protein:150, carbs:250, fat:65, waterMl:2000, supps:[] },
  foodLists: [],
  foods: [],
  logs:  {},   // date -> [{name,qty,cal,protein,carbs,fat,time}]
  water: {},   // date -> ml
  supps: {},   // date -> Set<string>
  activeListId: null,
  _editFoodId: null,
  _serveFood: null,
};

const TODAY = () => new Date().toISOString().slice(0,10);
const syncDot = document.getElementById('sync-dot');
function setSyncStatus(s){ syncDot.className = s; }

// ── FIREBASE HELPERS ─────────────────────────────────────
const REF = {
  goals:     () => doc(db,'CalCal','goals'),
  foodLists: () => doc(db,'CalCal','foodLists'),
  foods:     () => doc(db,'CalCal','foods'),
  day:       (d) => doc(db,'days', d),
};

async function fbGet(ref){ try{ const s=await getDoc(ref); return s.exists()?s.data():null; }catch(e){return null;} }
async function fbSet(ref,data){ setSyncStatus('loading'); try{ await setDoc(ref,data); setSyncStatus('ok'); }catch(e){ setSyncStatus('err'); throw e; } }

// ── LOAD FROM FIREBASE ───────────────────────────────────
async function loadFromFirebase() {
  // goals
  const g = await fbGet(REF.goals());
  if(g) state.goals = g;

  // foodLists
  const fl = await fbGet(REF.foodLists());
  if(fl && fl.lists) state.foodLists = fl.lists;

  // foods
  const fo = await fbGet(REF.foods());
  if(fo && fo.foods) state.foods = fo.foods;

  // today's day doc
  const today = TODAY();
  const dayDoc = await fbGet(REF.day(today));
  if(dayDoc){
    if(dayDoc.logs)  state.logs[today]  = dayDoc.logs;
    if(dayDoc.water !== undefined) state.water[today] = dayDoc.water;
    if(dayDoc.supps) state.supps[today] = new Set(dayDoc.supps);
  }

  if(!state.foodLists.some(l=>l.id===state.activeListId)) state.activeListId = state.foodLists[0]?.id||null;

  // real-time listener for today
  onSnapshot(REF.day(today), snap => {
    if(!snap.exists()) return;
    const d = snap.data();
    if(d.logs)  state.logs[today]  = d.logs;
    if(d.water !== undefined) state.water[today] = d.water;
    if(d.supps) state.supps[today] = new Set(d.supps);
    renderHome();
  });

  setSyncStatus('ok');
}

// ── SAVE HELPERS ─────────────────────────────────────────
async function saveDayDoc(date){
  const suppsArr = Array.from(state.supps[date]||[]);
  await fbSet(REF.day(date), {
    logs:  state.logs[date]  || [],
    water: state.water[date] || 0,
    supps: suppsArr,
    updatedAt: Date.now(),
  });
}
async function saveGoalsDoc(){ await fbSet(REF.goals(), state.goals); }
async function saveFoodListsDoc(){ await fbSet(REF.foodLists(), {lists: state.foodLists}); }
async function saveFoodsDoc(){ await fbSet(REF.foods(), {foods: state.foods}); }

// ── COMPUTED ─────────────────────────────────────────────
function todayTotals(date){
  return sumNutrition(state.logs[date]||[]);
}

// ── RENDER HOME ──────────────────────────────────────────
function renderHome(){
  const date=TODAY(), t=todayTotals(date), g=state.goals;
  const _now=new Date();
  const _dd=String(_now.getDate()).padStart(2,'0');
  const _mm=String(_now.getMonth()+1).padStart(2,'0');
  document.getElementById('home-ddmm').textContent=`${_dd}/${_mm}`;

  // Ring
  document.getElementById('ring-consumed-big').textContent = Math.round(t.cal);
  document.getElementById('ring-goal-lbl').textContent = `/ ${g.cal} kcal`;
  const pct=Math.min(1,t.cal/g.cal), circ=2*Math.PI*57;
  document.getElementById('ring-cal').style.strokeDashoffset = circ - circ*pct;
  document.getElementById('ring-cal').style.stroke = t.cal>g.cal?'var(--red)':'var(--accent)';

  // Macros
  const setBar=(id,val,goal,color)=>{
    const p=goal>0?Math.min(100,val/goal*100):0;
    document.getElementById('bar-'+id).style.width=p+'%';
    document.getElementById('bar-'+id).style.background=val>goal?'var(--red)':color;
    document.getElementById('lbl-'+id).textContent=`${t.missing[id]?'已知 ':''}${Math.round(val)}/${goal}g`;
    document.getElementById('lbl-'+id).title=t.missing[id]?'部分食物未提供此營養數值，僅加總已知數值。':'';
  };
  setBar('protein',t.protein,g.protein,'var(--green)');
  setBar('carbs',t.carbs,g.carbs,'var(--yellow)');
  setBar('fat',t.fat,g.fat,'var(--orange)');

  // Water
  const wGoal=g.waterMl||2000, wCon=state.water[date]||0;
  document.getElementById('water-consumed-big').textContent=wCon;
  document.getElementById('water-goal-lbl').textContent=`目標 ${wGoal} ml (${(wGoal/1000).toFixed(1)}L)`;
  const wPct=Math.min(100,wCon/wGoal*100);
  document.getElementById('water-bar-fill').style.width=wPct+'%';
  document.getElementById('water-bar-fill').style.background=wCon>=wGoal
    ?'linear-gradient(90deg,var(--green),#34d399)'
    :'linear-gradient(90deg,#7dd3fc,var(--accent2))';

  // Supps
  const suppRow=document.getElementById('supp-row');
  const suppEmpty=document.getElementById('supp-empty');
  suppRow.innerHTML='';
  if(!g.supps||!g.supps.length){ suppEmpty.style.display=''; suppRow.style.display='none'; }
  else {
    suppEmpty.style.display='none'; suppRow.style.display='';
    const doneSet=state.supps[date]||new Set();
    g.supps.forEach(s=>{
      const chip=document.createElement('div');
      chip.className='supp-chip'+(doneSet.has(s)?' done':'');
      chip.innerHTML=(doneSet.has(s)
        ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>')+s;
      chip.onclick=()=>{
        if(!state.supps[date]) state.supps[date]=new Set();
        if(state.supps[date].has(s)) state.supps[date].delete(s); else state.supps[date].add(s);
        saveDayDoc(date); renderHome();
      };
      suppRow.appendChild(chip);
    });
  }

  // Log
  const logs=state.logs[date]||[];
  const logList=document.getElementById('log-list');
  const logEmpty=document.getElementById('log-empty');
  document.getElementById('log-total-badge').innerHTML=t.cal>0?`<span class="badge ${t.cal>g.cal?'badge-over':''}">${Math.round(t.cal)} kcal</span>`:'';
  if(!logs.length){ logEmpty.style.display=''; logList.innerHTML=''; return; }
  logEmpty.style.display='none';
  logList.innerHTML=logs.map((l,i)=>`
    <div class="log-item">
      <div>
        <div class="log-name">${l.name} <span style="font-size:11px;color:var(--text3)">×${l.qty}</span></div>
        <div class="log-meta">蛋白 ${formatNutrient(l.protein)}g · 碳水 ${formatNutrient(l.carbs)}g · 脂肪 ${formatNutrient(l.fat)}g</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="log-cal">${Math.round(l.cal)}</div>
        <button class="btn-icon" onclick="window._deleteLog('${date}',${i})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`).join('');
}
window._deleteLog=(date,idx)=>{ state.logs[date].splice(idx,1); saveDayDoc(date); renderHome(); };

// ── RENDER FOOD LISTS ─────────────────────────────────────
function renderFoodLists(){
  document.getElementById('list-tabs').innerHTML=state.foodLists.map(l=>
    `<div class="list-tab${state.activeListId===l.id?' active':''}" onclick="window._setList('${l.id}')">${l.name}</div>`
  ).join('');
  const grid=document.getElementById('food-grid');
  const foods=state.foods.filter(f=>f.listId===state.activeListId);
  if(!foods.length){ grid.innerHTML='<div class="empty"><div class="empty-icon">🥗</div><p>此列表沒有食物，點擊「添加食物」</p></div>'; return; }
  grid.innerHTML=foods.map(f=>`
    <div class="food-item-wrap">
      <div class="food-item" onclick="window._openServe('${f.id}')">
        <div>
          <div class="food-name">${f.name}</div>
          <div class="food-macros">蛋白 ${formatNutrient(f.protein)}g · 碳水 ${formatNutrient(f.carbs)}g · 脂肪 ${formatNutrient(f.fat)}g</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="food-cal-badge">${f.cal} kcal</div>
          <button class="btn-icon" onclick="event.stopPropagation();window._deleteFood('${f.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    </div>`).join('');
}
window._setList=id=>{ state.activeListId=id; renderFoodLists(); };
window._deleteFood=id=>{ if(!confirm('刪除這個食物？'))return; state.foods=state.foods.filter(f=>f.id!==id); saveFoodsDoc(); renderFoodLists(); };

// ── GOALS ─────────────────────────────────────────────────
window.openGoalModal=()=>{
  const g=state.goals;
  document.getElementById('g-cal').value=g.cal||'';
  document.getElementById('g-protein').value=g.protein||'';
  document.getElementById('g-carbs').value=g.carbs||'';
  document.getElementById('g-fat').value=g.fat||'';
  document.getElementById('g-water-ml').value=g.waterMl||'';
  document.getElementById('g-supps').value=(g.supps||[]).join(', ');
  openModal('modal-goal');
};
window.saveGoals=async()=>{
  state.goals={
    cal:+document.getElementById('g-cal').value||2000,
    protein:+document.getElementById('g-protein').value||150,
    carbs:+document.getElementById('g-carbs').value||250,
    fat:+document.getElementById('g-fat').value||65,
    waterMl:+document.getElementById('g-water-ml').value||2000,
    supps: (document.getElementById('g-supps').value||'').split(',').map(s=>s.trim()).filter(Boolean),
  };
  await saveGoalsDoc(); closeModal('modal-goal'); renderHome();
};

// ── ADD FOOD ──────────────────────────────────────────────
window.openAddFoodModal=(prefill)=>{
  state._editFoodId=null;
  document.getElementById('add-food-title').textContent='添加食物';
  document.getElementById('f-name').value=prefill?.name||'';
  document.getElementById('f-cal').value=prefill?.cal||'';
  document.getElementById('f-protein').value=prefill?.protein||'';
  document.getElementById('f-carbs').value=prefill?.carbs||'';
  document.getElementById('f-fat').value=prefill?.fat||'';
  const sel=document.getElementById('f-list');
  sel.innerHTML=state.foodLists.map(l=>`<option value="${l.id}"${l.id===state.activeListId?' selected':''}>${l.name}</option>`).join('');
  openModal('modal-add-food');
};
window.saveFood=async()=>{
  const name=document.getElementById('f-name').value.trim();
  if(!name){alert('請輸入食物名稱');return;}
  const food={
    id:'f'+Date.now(), listId:document.getElementById('f-list').value, name,
    cal:+document.getElementById('f-cal').value||0,
    protein:+document.getElementById('f-protein').value||0,
    carbs:+document.getElementById('f-carbs').value||0,
    fat:+document.getElementById('f-fat').value||0,
  };
  state.foods.push(food); state.activeListId=food.listId;
  await saveFoodsDoc(); closeModal('modal-add-food'); renderFoodLists();
};

// ── MANAGE LISTS ──────────────────────────────────────────
window.openManageListsModal=()=>{ renderManageLists(); openModal('modal-manage-lists'); };
function renderManageLists(){
  document.getElementById('manage-lists-items').innerHTML=state.foodLists.map(l=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:14px;">${l.name}</span>
      <button class="btn btn-danger btn-sm" onclick="window._deleteList('${l.id}')">刪除</button>
    </div>`).join('');
}
window.addFoodList=async()=>{
  const name=document.getElementById('new-list-name').value.trim(); if(!name)return;
  const id='l'+Date.now(); state.foodLists.push({id,name});
  document.getElementById('new-list-name').value='';
  await saveFoodListsDoc(); renderManageLists(); renderFoodLists();
};
window._deleteList=async id=>{
  if(!confirm('刪除此列表及其所有食物？'))return;
  state.foodLists=state.foodLists.filter(l=>l.id!==id);
  state.foods=state.foods.filter(f=>f.listId!==id);
  if(state.activeListId===id) state.activeListId=state.foodLists[0]?.id||null;
  await saveFoodListsDoc(); await saveFoodsDoc(); renderManageLists(); renderFoodLists();
};

// ── SERVE MODAL ───────────────────────────────────────────
window._openServe=id=>{
  const f=state.foods.find(x=>x.id===id); if(!f)return;
  state._serveFood=f;
  document.getElementById('serve-food-name').textContent=f.name;
  document.getElementById('serve-food-info').textContent=`每份(×1): ${f.cal} kcal · 蛋白 ${formatNutrient(f.protein)}g · 碳水 ${formatNutrient(f.carbs)}g · 脂肪 ${formatNutrient(f.fat)}g（— 表示未提供）`;
  document.getElementById('serve-qty').value=1;
  updateServePreview();
  openModal('modal-serve');
  document.getElementById('serve-qty').oninput=updateServePreview;
};
function updateServePreview(){
  const f=state._serveFood; if(!f)return;
  const q=parseFloat(document.getElementById('serve-qty').value)||1;
  document.getElementById('serve-preview').innerHTML=`
    <div style="display:flex;justify-content:space-around;text-align:center;">
      <div><div style="font-size:20px;font-weight:700;color:var(--accent)">${Math.round(f.cal*q)}</div><div style="font-size:11px;color:var(--text2)">kcal</div></div>
      <div><div style="font-size:20px;font-weight:700;color:var(--green)">${formatNutrient(scaleNutrient(f.protein,q))}</div><div style="font-size:11px;color:var(--text2)">蛋白 g</div></div>
      <div><div style="font-size:20px;font-weight:700;color:var(--yellow)">${formatNutrient(scaleNutrient(f.carbs,q))}</div><div style="font-size:11px;color:var(--text2)">碳水 g</div></div>
      <div><div style="font-size:20px;font-weight:700;color:var(--orange)">${formatNutrient(scaleNutrient(f.fat,q))}</div><div style="font-size:11px;color:var(--text2)">脂肪 g</div></div>
    </div>`;
}
window.confirmServe=async()=>{
  const f=state._serveFood; if(!f)return;
  const q=parseFloat(document.getElementById('serve-qty').value)||1;
  const date=TODAY();
  if(!state.logs[date]) state.logs[date]=[];
  state.logs[date].push({
    name:f.name, qty:q,
    cal:scaleNutrient(f.cal,q), protein:scaleNutrient(f.protein,q), carbs:scaleNutrient(f.carbs,q), fat:scaleNutrient(f.fat,q),
    time:new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}),
  });
  await saveDayDoc(date); closeModal('modal-serve');
  switchPage('home',document.querySelector('[data-page="home"]')); renderHome();
};

// ── WATER ─────────────────────────────────────────────────
window.addWater=async()=>{
  const val=parseInt(document.getElementById('water-input').value); if(!val||val<=0)return;
  const date=TODAY(); state.water[date]=(state.water[date]||0)+val;
  document.getElementById('water-input').value='';
  await saveDayDoc(date); renderHome();
};
window.addWaterQuick=async ml=>{
  const date=TODAY(); state.water[date]=(state.water[date]||0)+ml;
  await saveDayDoc(date); renderHome();
};
window.resetWater=async()=>{
  if(!confirm('重置今日飲水記錄？'))return;
  const date=TODAY(); state.water[date]=0;
  await saveDayDoc(date); renderHome();
};

// ── AI SCAN ───────────────────────────────────────────────
let _parsedFood=null;
window.handlePhotoUpload=evt=>{
  const file=evt.target.files[0]; if(!file)return; evt.target.value='';
  const reader=new FileReader();
  reader.onload=async e=>{
    const dataUrl=e.target.result;
    document.getElementById('ai-preview').innerHTML=`<img src="${dataUrl}" class="preview-img">`;
    const box=document.getElementById('ai-result-box');
    const stream=document.getElementById('ai-stream');
    const action=document.getElementById('ai-action');
    box.style.display=''; action.style.display='none';
    stream.innerHTML='<span class="spinner"></span> AI 正在識別食物...'; _parsedFood=null;

    // Use Claude API via fetch (works when hosted outside claude.ai)
    try {
      const base64=dataUrl.split(',')[1];
      const mediaType=file.type||'image/jpeg';
      const prompt=`你是一個專業的營養師。請分析這張食物圖片，識別食物名稱，並估算每100g的營養成分。請只回答JSON，不要其他文字：
{"name":"食物中文名稱","description":"食物簡短描述","cal":卡路里數字,"protein":蛋白質g數,"carbs":碳水g數,"fat":脂肪g數,"confidence":"high/medium/low"}`;

      // Try claude.use('sample') if inside claude.ai iframe
      let resultText='';
      if(typeof window.claude!=='undefined'){
        const sample=await window.claude.use('sample');
        if(sample){
          const res=await sample([{role:'user',content:[
            {type:'image',source:{type:'base64',media_type:mediaType,data:base64}},
            {type:'text',text:prompt}
          ]}],{modelTier:'default',cache:false});
          resultText=res.text;
        }
      }
      if(!resultText) throw new Error('AI 功能需在 Claude.ai 環境下使用，或請整合自己的 API key');

      const match=resultText.match(/\{[\s\S]*\}/);
      if(!match) throw new Error('無法解析回應');
      _parsedFood=JSON.parse(match[0]);

      stream.innerHTML=`
        <div style="margin-bottom:8px;font-weight:600;font-size:15px;">🍽 ${_parsedFood.name}</div>
        <div style="color:var(--text2);font-size:12px;margin-bottom:12px;">${_parsedFood.description||''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="background:rgba(108,99,255,.1);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--accent)">${_parsedFood.cal}</div><div style="font-size:11px;color:var(--text2)">卡路里/100g</div></div>
          <div style="background:rgba(34,211,165,.1);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--green)">${_parsedFood.protein}g</div><div style="font-size:11px;color:var(--text2)">蛋白質/100g</div></div>
          <div style="background:rgba(250,204,21,.1);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--yellow)">${_parsedFood.carbs}g</div><div style="font-size:11px;color:var(--text2)">碳水/100g</div></div>
          <div style="background:rgba(251,146,60,.1);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--orange)">${_parsedFood.fat}g</div><div style="font-size:11px;color:var(--text2)">脂肪/100g</div></div>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text3);">信心度: ${_parsedFood.confidence==='high'?'🟢 高':_parsedFood.confidence==='medium'?'🟡 中':'🔴 低'}</div>`;
      action.style.display='';
      action.innerHTML=`<div class="btn-row">
        <button class="btn btn-secondary btn-full" onclick="window._addAiToList()">+ 添加到食物列表</button>
        <button class="btn btn-primary btn-full" onclick="window._logAiDirect()">直接記錄今日</button>
      </div>`;
    } catch(err){
      stream.textContent='⚠ '+( err.message||'識別失敗');
    }
  };
  reader.readAsDataURL(file);
};
window._addAiToList=()=>{ if(_parsedFood) window.openAddFoodModal(_parsedFood); };
window._logAiDirect=async()=>{
  if(!_parsedFood)return;
  const date=TODAY();
  if(!state.logs[date]) state.logs[date]=[];
  state.logs[date].push({name:_parsedFood.name,qty:1,cal:_parsedFood.cal,protein:_parsedFood.protein,carbs:_parsedFood.carbs,fat:_parsedFood.fat,time:new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})});
  await saveDayDoc(date); switchPage('home',document.querySelector('[data-page="home"]')); renderHome();
};

// ── NAV ───────────────────────────────────────────────────
window.switchPage=(name,btn)=>{
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='home') renderHome();
  if(name==='lists') renderFoodLists();
};

// ── MODALS ────────────────────────────────────────────────
window.openModal=id=>document.getElementById(id).classList.add('open');
window.closeModal=id=>document.getElementById(id).classList.remove('open');
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click',e=>{ if(e.target===o) o.classList.remove('open'); });
});

// ── INIT ──────────────────────────────────────────────────
document.getElementById('water-input').addEventListener('keydown',e=>{ if(e.key==='Enter') window.addWater(); });

setSyncStatus('loading');
loadFromFirebase().then(()=>{
  document.getElementById('loading-screen').style.display='none';
  renderHome();
  renderFoodLists();
}).catch(err=>{
  setSyncStatus('err');
  document.getElementById('loading-screen').querySelector('p').textContent='連接失敗，請檢查網路';
  console.error(err);
});

(function setupKeyboardHandling() {
  const vv = window.visualViewport;
  if (!vv) return;

  let initialHeight = vv.height;

  function updateKeyboardState() {
    const heightDiff = initialHeight - vv.height;

    const keyboardOpen = heightDiff > 120;

    document.documentElement.classList.toggle(
      'keyboard-open',
      keyboardOpen
    );
  }

  vv.addEventListener('resize', updateKeyboardState);

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      initialHeight = vv.height;
      updateKeyboardState();
    }, 300);
  });

  updateKeyboardState();
})();
