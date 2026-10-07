import { db, doc, getDoc, setDoc, onSnapshot, writeBatch } from './firebase.js?v=1.0.36';
import { scaleNutrient, formatNutrient, sumNutrition } from './nutrition.js?v=1.0.46';

// ── STATE ────────────────────────────────────────────────
let state = {
  goals:     { cal:2000, protein:150, carbs:250, fat:65, waterMl:2000, supps:[] },
  foodLists: [],
  foods: [],
  logs:  {},   // date -> [{name,qty,cal,protein,carbs,fat,time}]
  water: {},   // date -> ml
  supps: {},   // date -> Set<string>
  weights: {}, // local date -> weight in kg
  _savingWeight: false,
  activeListId: null,
  _editFoodId: null,
  _serveFood: null,
  _savingFoods: false,
  _savingLists: false,
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const TODAY = () => {
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
};
const syncDot = document.getElementById('sync-dot');
function setSyncStatus(s){ if(syncDot) syncDot.className = s; }

// ── FIREBASE HELPERS ─────────────────────────────────────
const REF = {
  goals:     () => doc(db,'CalCal','goals'),
  foodLists: () => doc(db,'CalCal','foodLists'),
  foods:     () => doc(db,'CalCal','foods'),
  weights:   () => doc(db,'CalCal','weights'),
  day:       (d) => doc(db,'days', d),
};

async function fbGet(ref){ const s=await getDoc(ref); return s.exists()?s.data():null; }
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
  state.weights = await fbGet(REF.weights()) || {};

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
function syncHomeBackgroundSpace(){
  const home=document.getElementById('page-home');
  const image=document.querySelector('.home-footer-art');
  const spacer=document.getElementById('home-background-spacer');
  const cards=Array.from(document.querySelectorAll('#page-home > .card'));
  const lastCard=cards.at(-1);
  if(!home?.getBoundingClientRect || !image || !spacer || !lastCard) return;
  const pageBounds=home.getBoundingClientRect();
  if(!pageBounds.height) return;
  const pictureBounds=image.getBoundingClientRect();
  const bottomPadding=parseFloat(getComputedStyle(home).paddingBottom)||0;
  const cardMargin=parseFloat(getComputedStyle(lastCard).marginBottom)||0;
  // The Earth's horizon occupies about .85 widths above the screen bottom.
  // Reveal that visible region, without scrolling through the canvas's empty sky.
  const revealHeight=image.classList.contains('earth-ready')?Math.min(pictureBounds.height,pictureBounds.width*.85):0;
  spacer.style.height=Math.max(0,revealHeight+pageBounds.bottom-pictureBounds.bottom-bottomPadding-cardMargin)+'px';
}
window.addEventListener('resize',syncHomeBackgroundSpace);
window.addEventListener('earth-background-change',syncHomeBackgroundSpace);
window.visualViewport?.addEventListener('resize',syncHomeBackgroundSpace);
document.querySelector('.home-footer-art img')?.addEventListener('load',syncHomeBackgroundSpace);

function renderHome(){
  renderWeightChart();
  syncHomeBackgroundSpace();
  const date=TODAY(), t=todayTotals(date), g=state.goals;
  const _now=new Date();
  const _dd=String(_now.getDate()).padStart(2,'0');
  const _mm=String(_now.getMonth()+1).padStart(2,'0');
  document.getElementById('home-ddmm').textContent=`${_dd}/${_mm}/${_now.getFullYear()}`;

  // Ring
  // Subtract the same whole-number total shown in the diary, so the
  // displayed intake and remaining amount always add up to the goal.
  const caloriesLeft=Math.round(g.cal)-Math.round(t.cal);
  document.getElementById('ring-consumed-big').textContent = Math.round(Math.abs(caloriesLeft));
  document.getElementById('ring-goal-lbl').textContent = `kcal ${caloriesLeft<0?'over':'left'}`;
  const pct=g.cal>0?Math.max(0,Math.min(1,caloriesLeft/g.cal)):0, circ=2*Math.PI*57;
  document.getElementById('ring-cal').style.strokeDashoffset = circ - circ*pct;
  document.getElementById('ring-cal').style.stroke = caloriesLeft<0?'var(--red)':'var(--accent)';

  // Macros
  const setBar=(id,val,goal,color)=>{
    const left=Math.round(goal)-Math.round(val);
    const p=goal>0?Math.max(0,Math.min(100,left/goal*100)):0;
    document.getElementById('bar-'+id).style.width=p+'%';
    document.getElementById('bar-'+id).style.background=color;
    const label=document.getElementById('lbl-'+id);
    label.innerHTML=`<strong>${Math.abs(left)}</strong>g ${left<0?'over':'left'}`;
    label.classList.toggle('nutrition-over',left<0);
    label.title='';
  };
  setBar('protein',t.protein,g.protein,'var(--protein-bar)');
  setBar('carbs',t.carbs,g.carbs,'var(--carbs-bar)');
  setBar('fat',t.fat,g.fat,'var(--fat-bar)');

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
window.openDiaryModal=()=>{renderHome();openModal('modal-diary');};

// ── RENDER FOOD LISTS ─────────────────────────────────────
function renderFoodLists(){
  document.getElementById('current-category-name').textContent=state.foodLists.find(l=>l.id===state.activeListId)?.name||'Categories';
  const grid=document.getElementById('food-grid');
  const foods=state.foods.filter(f=>f.listId===state.activeListId);
  if(!foods.length){ grid.innerHTML='<div class="empty"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle"><circle cx="12" cy="12" r="6"/><path d="M2 3v6m3-6v6M2 6h3M3.5 9v12M21 3v18M21 3c-4 3-4 8 0 8"/></svg></div><p>No foods in this list. Tap Add food to get started.</p></div>'; return; }
  grid.innerHTML=foods.map((f,index)=>`
    <div class="food-item-wrap" data-food-id="${escapeHtml(f.id)}">
      <div class="food-item" onclick="window._openServe('${f.id}')">
        <div class="food-details">
          <div class="food-name">${escapeHtml(f.name)}</div>
          <div class="food-nutrition">
            ${[['cal','kcal','Calories'],['protein','g','Protein'],['carbs','g','Carbs'],['fat','g','Fat']].map(([key,unit,label])=>`
              <div class="food-nutrient"><div class="food-nutrient-value">${formatNutrient(f[key]??0)}<span class="food-nutrient-unit"> ${unit}</span></div><div class="food-nutrient-label">${label}</div></div>
            `).join('')}
          </div>
          ${f.ingredients?`<div class="food-ingredients">Ingredients: ${escapeHtml(f.ingredients)}</div>`:''}
        </div>
        <div class="food-row-controls">
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
window._startFoodDrag=(event,id)=>startRowDrag(event,id,false);
window._startCategoryDrag=(event,id)=>startRowDrag(event,id,true);
function startRowDrag(event,id,isCategory){
  if((isCategory?state._savingLists:state._savingFoods)||event.button!==0||event.isPrimary===false)return;
  event.stopPropagation();
  const handle=event.currentTarget, row=handle.closest('.food-item-wrap');
  const grid=row.parentElement, page=grid.closest(isCategory?'.modal':'.page');
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
    if(active&&e.type==='pointerup'){
      if(isCategory)window._reorderCategory(id,target);
      else if(state.activeListId===listId)window._reorderFood(id,target);
    }
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
    <div class="food-item-wrap category-row">
      <button class="category-name${state.activeListId===l.id?' selected':''}" ${state._savingLists?'disabled':''} onclick="window._chooseCategory('${l.id}')">${escapeHtml(l.name)}</button>
      <div class="food-row-controls">
        <button class="btn-icon" aria-label="Edit category ${escapeHtml(l.name)}" ${state._savingLists?'disabled':''} onclick="window._editCategory('${l.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 3l5 5L8 21H3v-5zM13 6l5 5"/></svg></button>
        <button class="btn-icon" aria-label="Delete category ${escapeHtml(l.name)}" ${state._savingLists||state._savingFoods?'disabled':''} onclick="window._deleteList('${l.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M9 6V4h6v2M10 11v6M14 11v6"/></svg></button>
        <button class="btn-icon food-drag-handle" aria-label="Reorder category ${escapeHtml(l.name)}" title="Drag to reorder (keyboard: Up / Down)" ${state._savingLists?'disabled':''} onpointerdown="window._startCategoryDrag(event,'${l.id}')" onkeydown="if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();window._moveCategory('${l.id}',event.key==='ArrowUp'?-1:1)}">☰</button>
      </div>
    </div>`).join('')||'<div class="empty">No categories yet. Add one above.</div>';
  document.getElementById('add-category-btn').disabled=state._savingLists;
}
window._chooseCategory=id=>{
  if(state._savingLists)return;
  window._setList(id);closeModal('modal-manage-lists');
};
let editingCategoryId=null;
window._editCategory=id=>{
  if(state._savingLists)return;
  const list=state.foodLists.find(l=>l.id===id);if(!list)return;
  editingCategoryId=id;
  document.getElementById('edit-category-field').innerHTML=`<label for="list-name-${id}">Category name</label><input id="list-name-${id}" value="${escapeHtml(list.name)}">`;
  openModal('modal-edit-category');
};
window.saveCategoryName=()=>window._renameList(editingCategoryId);
async function persistCategories(next){
  if(state._savingLists)return false;
  const previous=state.foodLists;
  state._savingLists=true;state.foodLists=next;
  renderManageLists();
  try{await saveFoodListsDoc();renderFoodLists();return true;}
  catch(err){state.foodLists=previous;alert('Could not save. Please try again.');return false;}
  finally{state._savingLists=false;renderManageLists();}
}
window._moveCategory=(id,direction)=>window._reorderCategory(id,state.foodLists.findIndex(l=>l.id===id)+direction);
window._reorderCategory=async(id,to)=>{
  const from=state.foodLists.findIndex(l=>l.id===id);
  if(from<0||!Number.isInteger(to)||to<0||to>=state.foodLists.length||from===to)return;
  const next=state.foodLists.slice();next.splice(to,0,next.splice(from,1)[0]);
  await persistCategories(next);
};
window._renameList=async id=>{
  if(state._savingLists)return;
  const name=document.getElementById('list-name-'+id).value.trim();
  if(!name){alert('Please enter a list name.');return;}
  if(!state.foodLists.some(l=>l.id===id))return;
  if(await persistCategories(state.foodLists.map(l=>l.id===id?{...l,name}:l)))closeModal('modal-edit-category');
};
window.addFoodList=async()=>{
  if(state._savingLists)return;
  const name=document.getElementById('new-list-name').value.trim();if(!name)return;
  const id='l'+Date.now();
  if(await persistCategories([...state.foodLists,{id,name}])){
    document.getElementById('new-list-name').value='';
    if(!state.activeListId){state.activeListId=id;renderFoodLists();}
  }
};
window._deleteList=async id=>{
  if(state._savingLists||state._savingFoods)return;
  if(!confirm('Delete this category and all its foods?'))return;
  const lists=state.foodLists.filter(l=>l.id!==id),foods=state.foods.filter(f=>f.listId!==id);
  state._savingLists=true;state._savingFoods=true;setSyncStatus('loading');
  renderManageLists();renderFoodLists();
  try{
    const batch=writeBatch(db);
    batch.set(REF.foodLists(),{lists});batch.set(REF.foods(),{foods});
    await batch.commit();
    state.foodLists=lists;state.foods=foods;
    if(state.activeListId===id)state.activeListId=lists[0]?.id||null;
    setSyncStatus('ok');
  }catch(err){setSyncStatus('err');alert('Could not delete. Please try again.');}
  finally{state._savingLists=false;state._savingFoods=false;renderManageLists();renderFoodLists();}
};

// ── SERVE MODAL ───────────────────────────────────────────
window._openServe=id=>{
  const f=state.foods.find(x=>x.id===id); if(!f)return;
  state._serveFood=f;
  document.getElementById('serve-food-name').textContent=f.name;
  document.getElementById('serve-food-info').textContent=`Per serving (1x): ${formatNutrient(f.cal)} kcal · Protein ${formatNutrient(f.protein)}g · Carbs ${formatNutrient(f.carbs)}g · Fat ${formatNutrient(f.fat)}g (— means unavailable)`;
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
  renderHome();
};

// ── WEIGHT ────────────────────────────────────────────────
function validWeightDate(date){
  return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
}
const weightDateLabel=date=>date.split('-').reverse().join('/');
function renderWeightChart(){
  const entries=Object.entries(state.weights).filter(([date,kg])=>validWeightDate(date)&&typeof kg==='number'&&Number.isFinite(kg)&&kg>0).sort(([a],[b])=>a.localeCompare(b));
  const chart=document.getElementById('weight-chart'),summary=document.getElementById('weight-summary');
  if(!entries.length){summary.textContent='';chart.innerHTML='<div class="empty" style="padding:28px 0;">Tap + to record your first weight.</div>';return;}
  const [lastDate,lastWeight]=entries.at(-1);
  summary.textContent=`${lastWeight.toFixed(1)} kg`;
  const values=entries.map(([,kg])=>kg),min=Math.min(...values),max=Math.max(...values);
  const padding=Math.max(0.5,(max-min)*0.15),low=Math.max(0,min-padding),high=max+padding;
  const start=Date.parse(entries[0][0]+'T00:00:00Z'),end=Date.parse(lastDate+'T00:00:00Z');
  const x=date=>end===start?277:52+(Date.parse(date+'T00:00:00Z')-start)/(end-start)*450;
  const y=kg=>186-(kg-low)/(high-low)*164;
  const points=entries.map(([date,kg])=>`${x(date).toFixed(2)},${y(kg).toFixed(2)}`).join(' ');
  const ticks=[low,(low+high)/2,high];
  const dateTicks=Array.from(new Set([0,Math.floor((entries.length-1)/2),entries.length-1]));
  chart.innerHTML=`<svg class="weight-chart-svg" viewBox="0 0 520 230" role="img" aria-label="Weight history in kilograms by date">
    <title>Weight history: ${entries.map(([date,kg])=>`${weightDateLabel(date)}: ${kg.toFixed(1)} kg`).join('; ')}</title>
    ${ticks.map(kg=>`<line class="weight-chart-grid" x1="52" x2="502" y1="${y(kg)}" y2="${y(kg)}"/><text x="44" y="${y(kg)+4}" text-anchor="end">${kg.toFixed(1)}</text>`).join('')}
    <polyline class="weight-chart-line" points="${points}"/>
    ${entries.map(([date,kg])=>`<circle class="weight-chart-point" cx="${x(date)}" cy="${y(kg)}" r="4" tabindex="0" aria-label="${weightDateLabel(date)}: ${kg.toFixed(1)} kg"><title>${weightDateLabel(date)}: ${kg.toFixed(1)} kg</title></circle>`).join('')}
    ${dateTicks.map(index=>{const date=entries[index][0];return `<text x="${x(date)}" y="213" text-anchor="${entries.length===1?'middle':index===0?'start':index===entries.length-1?'end':'middle'}">${weightDateLabel(date)}</text>`;}).join('')}
  </svg>`;
}
window.openWeightModal=()=>{
  const date=TODAY();
  document.getElementById('weight-date').value=date;
  document.getElementById('weight-date').max=date;
  document.getElementById('weight-value').value=state.weights[date]??'';
  document.getElementById('weight-error').textContent='';
  openModal('modal-weight');
};
window.saveWeight=async()=>{
  if(state._savingWeight)return;
  const date=document.getElementById('weight-date').value;
  const input=document.getElementById('weight-value'),kg=Number(input.value);
  const error=document.getElementById('weight-error');
  if(!validWeightDate(date)||date>TODAY()){error.textContent='Choose today or an earlier date.';return;}
  if(input.validity?.badInput||!Number.isFinite(kg)||kg<=0){error.textContent='Enter a weight greater than zero.';return;}
  state._savingWeight=true;document.getElementById('save-weight-btn').disabled=true;error.textContent='';
  setSyncStatus('loading');
  try{
    await setDoc(REF.weights(),{[date]:kg},{merge:true});
    state.weights={...state.weights,[date]:kg};setSyncStatus('ok');
    renderWeightChart();closeModal('modal-weight');
  }catch(err){setSyncStatus('err');error.textContent='Could not save your weight. Please try again.';}
  finally{state._savingWeight=false;document.getElementById('save-weight-btn').disabled=false;}
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
  const date=TODAY(); state.water[date]=0;
  await saveDayDoc(date); renderHome();
};

// ── NAV ───────────────────────────────────────────────────
window.switchPage=(name,btn)=>{
  const previousPage=document.querySelector('.page.active')?.id;
  const nav=document.querySelector('.nav');
  if(previousPage!==`page-${name}` && typeof nav?.offsetWidth==='number'){
    nav.classList.remove('liquid-moving');
    // Restart the stretch when switching again before the last motion finishes.
    void nav.offsetWidth;
    nav.classList.add('liquid-moving');
  }
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
  renderHome();
  renderFoodLists();
  document.getElementById('loading-screen').classList.add('loaded');
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
