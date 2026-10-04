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
  _savingFoods: false,
  _savingLists: false,
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

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
  document.getElementById('home-ddmmyyyy').textContent=`${_dd}/${_mm}/${_yyyy}`;

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
    document.getElementById('lbl-'+id).textContent=`${t.missing[id]?'Known ':''}${Math.round(val)}/${goal}g`;
    document.getElementById('lbl-'+id).title=t.missing[id]?'Some foods are missing this nutrient. Only known values are included.':'';
  };
  setBar('protein',t.protein,g.protein,'var(--green)');
  setBar('carbs',t.carbs,g.carbs,'var(--yellow)');
  setBar('fat',t.fat,g.fat,'var(--orange)');

  // Water
  const wGoal=g.waterMl||2000, wCon=state.water[date]||0;
  document.getElementById('water-consumed-big').textContent=wCon;
  document.getElementById('water-goal-lbl').textContent=`Goal: ${wGoal} ml (${(wGoal/1000).toFixed(1)}L)`;
  const wPct=Math.min(100,wCon/wGoal*100);
  document.getElementById('water-bar-fill').style.width=wPct+'%';
  document.getElementById('water-bar-fill').style.background=wCon>=wGoal
    ?'linear-gradient(90deg,var(--green),var(--success-end))'
    :'linear-gradient(90deg,var(--water-start),var(--accent2))';

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
        <div class="log-name">${escapeHtml(l.name)} <span style="font-size:11px;color:var(--text3)">×${l.qty}</span></div>
        <div class="log-meta">Protein ${formatNutrient(l.protein)}g · Carbs ${formatNutrient(l.carbs)}g · Fat ${formatNutrient(l.fat)}g</div>
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
    `<div class="list-tab${state.activeListId===l.id?' active':''}" onclick="window._setList('${l.id}')">${escapeHtml(l.name)}</div>`
  ).join('');
  const grid=document.getElementById('food-grid');
  const foods=state.foods.filter(f=>f.listId===state.activeListId);
  if(!foods.length){ grid.innerHTML='<div class="empty"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle"><circle cx="12" cy="12" r="6"/><path d="M2 3v6m3-6v6M2 6h3M3.5 9v12M21 3v18M21 3c-4 3-4 8 0 8"/></svg></div><p>No foods in this list. Tap Add food to get started.</p></div>'; return; }
  grid.innerHTML=foods.map((f,index)=>`
    <div class="food-item-wrap" data-food-id="${escapeHtml(f.id)}">
      <div class="food-item" onclick="window._openServe('${f.id}')">
        <div class="food-details">
          <div class="food-name">${escapeHtml(f.name)}</div>
          <div class="food-macros">Protein ${formatNutrient(f.protein)}g · Carbs ${formatNutrient(f.carbs)}g · Fat ${formatNutrient(f.fat)}g</div>
          ${f.ingredients?`<div class="food-ingredients">Ingredients: ${escapeHtml(f.ingredients)}</div>`:''}
        </div>
        <div class="food-row-controls">
          <div class="food-cal-badge">${f.cal} kcal</div>
          <button class="btn-icon" aria-label="Edit ${escapeHtml(f.name)}" ${state._savingFoods?'disabled':''} onclick="event.stopPropagation();window._editFood('${f.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 3l5 5L8 21H3v-5zM13 6l5 5"/></svg></button>
          <button class="btn-icon" aria-label="Delete ${escapeHtml(f.name)}" ${state._savingFoods?'disabled':''} onclick="event.stopPropagation();window._deleteFood('${f.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button class="btn-icon food-drag-handle" aria-label="Reorder ${escapeHtml(f.name)}" title="Drag to reorder (keyboard: Up / Down)" ${state._savingFoods?'disabled':''} onclick="event.stopPropagation()" onpointerdown="window._startFoodDrag(event,'${f.id}')" onkeydown="if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();window._moveFood('${f.id}',event.key==='ArrowUp'?-1:1)}">☰</button>
        </div>
      </div>

    </div>`).join('');
}
window._setList=id=>{ state.activeListId=id; renderFoodLists(); };
async function persistFoods(nextFoods){
  if(state._savingFoods)return false;
  const previous=state.foods;
  state._savingFoods=true; state.foods=nextFoods;
  document.getElementById('save-food-btn').disabled=true;
  renderFoodLists();
  try{ await saveFoodsDoc(); return true; }
  catch(err){ state.foods=previous; alert('Could not save. Please try again.'); return false; }
  finally{ state._savingFoods=false; document.getElementById('save-food-btn').disabled=false; renderFoodLists(); }
}
window._deleteFood=async id=>{
  if(state._savingFoods||!confirm('Delete this food?'))return;
  await persistFoods(state.foods.filter(f=>f.id!==id));
};
window._moveFood=async(id,direction)=>{
  if(state._savingFoods||![1,-1].includes(direction))return;
  const food=state.foods.find(f=>f.id===id); if(!food)return;
  const categoryFoods=state.foods.filter(f=>f.listId===food.listId);
  const index=categoryFoods.findIndex(f=>f.id===id);
  await window._reorderFood(id,index+direction);
};
window._reorderFood=async(id,to)=>{
  if(state._savingFoods)return;
  const food=state.foods.find(f=>f.id===id); if(!food)return;
  const categoryFoods=state.foods.filter(f=>f.listId===food.listId);
  const from=categoryFoods.findIndex(f=>f.id===id);
  if(!Number.isInteger(to)||to<0||to>=categoryFoods.length||from===to)return;
  categoryFoods.splice(to,0,categoryFoods.splice(from,1)[0]);
  let index=0;
  await persistFoods(state.foods.map(f=>f.listId===food.listId?categoryFoods[index++]:f));
};
window._startFoodDrag=(event,id)=>{
  if(state._savingFoods||event.button!==0||event.isPrimary===false)return;
  event.stopPropagation();
  const handle=event.currentTarget, row=handle.closest('.food-item-wrap');
  const grid=row.parentElement, page=grid.closest('.page');
  const rows=Array.from(grid.querySelectorAll('.food-item-wrap'));
  const others=rows.filter(item=>item!==row), listId=state.activeListId;
  let y=event.clientY, active=false, target=rows.indexOf(row), frame;
  const startY=y, pointerId=event.pointerId;
  handle.setPointerCapture(pointerId);
  function mark(){
    rows.forEach(item=>item.classList.remove('drop-before','drop-after'));
    target=others.findIndex(item=>{const rect=item.getBoundingClientRect();return y<rect.top+rect.height/2;});
    if(target===-1)target=others.length;
    if(others[target])others[target].classList.add('drop-before');
    else if(others.length)others.at(-1).classList.add('drop-after');
  }
  function scroll(){
    if(!row.isConnected){finish({type:'pointercancel'});return;}
    if(active&&page){
      const rect=page.getBoundingClientRect();
      const delta=y<rect.top+48?-10:y>rect.bottom-48?10:0;
      if(delta){page.scrollTop+=delta;mark();}
    }
    frame=requestAnimationFrame(scroll);
  }
  function move(e){
    if(e.pointerId!==pointerId)return;
    y=e.clientY;
    if(!active&&Math.abs(y-startY)<5)return;
    active=true;row.classList.add('food-dragging');mark();
  }
  function finish(e){
    if(e.pointerId!==undefined&&e.pointerId!==pointerId)return;
    if(e.type==='keydown'&&e.key!=='Escape')return;
    cancelAnimationFrame(frame);
    handle.removeEventListener('pointermove',move);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(type,finish);
    document.removeEventListener('keydown',finish);
    rows.forEach(item=>item.classList.remove('food-dragging','drop-before','drop-after'));
    if(handle.hasPointerCapture(pointerId))handle.releasePointerCapture(pointerId);
    if(active&&e.type==='pointerup'&&state.activeListId===listId)window._reorderFood(id,target);
  }
  handle.addEventListener('pointermove',move);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,finish);
  document.addEventListener('keydown',finish);
  frame=requestAnimationFrame(scroll);
};

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
  document.getElementById('add-food-title').textContent='Add food';
  document.getElementById('f-name').value=prefill?.name||'';
  document.getElementById('f-ingredients').value=prefill?.ingredients||'';
  document.getElementById('f-cal').value=prefill?.cal??'';
  document.getElementById('f-protein').value=prefill?.protein??'';
  document.getElementById('f-carbs').value=prefill?.carbs??'';
  document.getElementById('f-fat').value=prefill?.fat??'';
  const sel=document.getElementById('f-list');
  sel.innerHTML=state.foodLists.map(l=>`<option value="${l.id}"${l.id===(prefill?.listId||state.activeListId)?' selected':''}>${escapeHtml(l.name)}</option>`).join('');
  openModal('modal-add-food');
};
window._editFood=id=>{
  if(state._savingFoods)return;
  const food=state.foods.find(f=>f.id===id); if(!food)return;
  window.openAddFoodModal(food);
  state._editFoodId=id;
  document.getElementById('add-food-title').textContent='Edit food';
};
window.saveFood=async()=>{
  if(state._savingFoods)return;
  const name=document.getElementById('f-name').value.trim();
  if(!name){alert('Please enter a food name.');return;}
  const listId=document.getElementById('f-list').value;
  if(!state.foodLists.some(l=>l.id===listId)){alert('Please create a food list first.');return;}
  const nutrients={};
  for(const key of ['cal','protein','carbs','fat']){
    const input=document.getElementById('f-'+key), text=input.value.trim();
    const value=text===''?(key==='cal'?0:null):Number(text);
    if(input.validity?.badInput||(value!==null&&(!Number.isFinite(value)||value<0))){alert('Nutrient values must be zero or positive numbers.');return;}
    nutrients[key]=value;
  }
  const original=state._editFoodId?state.foods.find(f=>f.id===state._editFoodId):null;
  if(state._editFoodId&&!original){alert('This food no longer exists. Please reopen the list.');return;}
  const food={
    ...original, id:original?.id||('f'+Date.now()), listId, name,
    ingredients:document.getElementById('f-ingredients').value.trim(),
    ...nutrients,
  };
  const next=original?state.foods.map(f=>f.id===food.id?food:f):[...state.foods,food];
  if(await persistFoods(next)){
    state.activeListId=food.listId; state._editFoodId=null;
    closeModal('modal-add-food'); renderFoodLists();
  }
};

// ── MANAGE LISTS ──────────────────────────────────────────
window.openManageListsModal=()=>{ renderManageLists(); openModal('modal-manage-lists'); };
function renderManageLists(){
  document.getElementById('manage-lists-items').innerHTML=state.foodLists.map(l=>`
    <div class="field list-edit-row">
      <input id="list-name-${l.id}" type="text" aria-label="List name ${escapeHtml(l.name)}" value="${escapeHtml(l.name)}">
      <button class="btn btn-secondary btn-sm" ${state._savingLists?'disabled':''} onclick="window._renameList('${l.id}')">Save</button>
      <button class="btn btn-danger btn-sm" onclick="window._deleteList('${l.id}')">Delete</button>
    </div>`).join('');
}
window._renameList=async id=>{
  if(state._savingLists)return;
  const name=document.getElementById('list-name-'+id).value.trim();
  if(!name){alert('Please enter a list name.');return;}
  const previous=state.foodLists;
  state._savingLists=true;
  state.foodLists=state.foodLists.map(l=>l.id===id?{...l,name}:l);
  renderManageLists();
  try{ await saveFoodListsDoc(); renderFoodLists(); }
  catch(err){ state.foodLists=previous; alert('Could not save. Please try again.'); }
  finally{ state._savingLists=false; renderManageLists(); }
};
window.addFoodList=async()=>{
  if(state._savingLists)return;
  const name=document.getElementById('new-list-name').value.trim(); if(!name)return;
  const id='l'+Date.now(); state.foodLists.push({id,name});
  document.getElementById('new-list-name').value='';
  await saveFoodListsDoc(); renderManageLists(); renderFoodLists();
};
window._deleteList=async id=>{
  if(state._savingLists||state._savingFoods)return;
  if(!confirm('Delete this list and all its foods?'))return;
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
  document.getElementById('serve-food-info').textContent=`Per serving (1x): ${f.cal} kcal · Protein ${formatNutrient(f.protein)}g · Carbs ${formatNutrient(f.carbs)}g · Fat ${formatNutrient(f.fat)}g (— means unavailable)`;
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
      <div><div style="font-size:20px;font-weight:700;color:var(--green)">${formatNutrient(scaleNutrient(f.protein,q))}</div><div style="font-size:11px;color:var(--text2)">Protein g</div></div>
      <div><div style="font-size:20px;font-weight:700;color:var(--yellow)">${formatNutrient(scaleNutrient(f.carbs,q))}</div><div style="font-size:11px;color:var(--text2)">Carbs g</div></div>
      <div><div style="font-size:20px;font-weight:700;color:var(--orange)">${formatNutrient(scaleNutrient(f.fat,q))}</div><div style="font-size:11px;color:var(--text2)">Fat g</div></div>
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
    time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
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
  if(!confirm('Reset today’s water intake?'))return;
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
    stream.innerHTML='<span class="spinner"></span> AI is identifying the food...'; _parsedFood=null;

    // Use Claude API via fetch (works when hosted outside claude.ai)
    try {
      const base64=dataUrl.split(',')[1];
      const mediaType=file.type||'image/jpeg';
      const prompt=`Analyze this food photo and estimate nutrients per 100g. Return only JSON. Use English for the name and description, and numbers for nutrients:
{"name":"Food name in English","description":"Short description in English","cal":0,"protein":0,"carbs":0,"fat":0,"confidence":"high/medium/low"}`;

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
      if(!resultText) throw new Error('AI requires a supported Claude environment or an API integration.');

      const match=resultText.match(/\{[\s\S]*\}/);
      if(!match) throw new Error('Could not parse the response.');
      _parsedFood=JSON.parse(match[0]);

      stream.innerHTML=`
        <div style="margin-bottom:8px;font-weight:600;font-size:15px;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle"><circle cx="12" cy="12" r="6"/><path d="M2 3v6m3-6v6M2 6h3M3.5 9v12M21 3v18M21 3c-4 3-4 8 0 8"/></svg> ${_parsedFood.name}</div>
        <div style="color:var(--text2);font-size:12px;margin-bottom:12px;">${_parsedFood.description||''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="background:var(--accent-soft);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--accent)">${_parsedFood.cal}</div><div style="font-size:11px;color:var(--text2)">Calories/100g</div></div>
          <div style="background:var(--green-soft);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--green)">${_parsedFood.protein}g</div><div style="font-size:11px;color:var(--text2)">Protein/100g</div></div>
          <div style="background:var(--yellow-soft);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--yellow)">${_parsedFood.carbs}g</div><div style="font-size:11px;color:var(--text2)">Carbs/100g</div></div>
          <div style="background:var(--orange-soft);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--orange)">${_parsedFood.fat}g</div><div style="font-size:11px;color:var(--text2)">Fat/100g</div></div>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text3);">Confidence: ${_parsedFood.confidence==='high'?'High':_parsedFood.confidence==='medium'?'Medium':'Low'}</div>`;
      action.style.display='';
      action.innerHTML=`<div class="btn-row">
        <button class="btn btn-secondary btn-full" onclick="window._addAiToList()">+ Add to food list</button>
        <button class="btn btn-primary btn-full" onclick="window._logAiDirect()">Log for today</button>
      </div>`;
    } catch(err){
      stream.textContent='Error: '+( err.message||'Identification failed.');
    }
  };
  reader.readAsDataURL(file);
};
window._addAiToList=()=>{ if(_parsedFood) window.openAddFoodModal(_parsedFood); };
window._logAiDirect=async()=>{
  if(!_parsedFood)return;
  const date=TODAY();
  if(!state.logs[date]) state.logs[date]=[];
  state.logs[date].push({name:_parsedFood.name,qty:1,cal:_parsedFood.cal,protein:_parsedFood.protein,carbs:_parsedFood.carbs,fat:_parsedFood.fat,time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})});
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
  document.getElementById('loading-screen').querySelector('p').textContent='Connection failed. Please check your network.';
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
