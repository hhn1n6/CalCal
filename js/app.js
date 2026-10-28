import { createWorkoutFeature } from './workout.js?v=1.2.26';
import { tr, setLanguage, getLanguage, validLanguage, locale } from './i18n.js?v=1.2.26';
import { calculateSuggestedGoals, activityFactors, roundDailyGoals } from './goal-calculator.js?v=1.2.26';
import { ageFromBirthday, currentProfileWeight } from './profile-utils.js?v=1.2.26';
import { setupOnboardingSwipes } from './onboarding-swipe.js?v=1.2.26';
import { createNumberWheel } from './number-wheel.js?v=1.2.26';
import { createOnboardingTransition } from './onboarding-transition.js?v=1.2.26';
import { db, doc, getDoc, setDoc, onSnapshot, writeBatch, collection, getDocs, auth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase.js?v=1.1.14';
import { scaleNutrient, formatNutrient, sumNutrition } from './nutrition.js?v=1.0.46';
import { setupPageSwipes } from './page-swipe.js?v=1.2.26';

// Shared feedback for all dark grey glass main action buttons.
document.addEventListener('click',event=>{
  const button=event.target.closest?.('.main-action-button');
  if(!button||button.disabled)return;
  button.classList.remove('main-action-pulse');
  void button.offsetWidth;
  button.classList.add('main-action-pulse');
},true);
document.addEventListener('animationend',event=>{
  if(event.animationName==='main-action-pulse')event.target.classList.remove('main-action-pulse');
});

// ── STATE ────────────────────────────────────────────────
let state = {
  user: null,
  isAdmin: false,
  isTester: false,
  testerNewUser: false,
  nutritionDisplay: 'remaining',
  bodyProfile: {},
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

const workoutFeature=createWorkoutFeature({root:document.getElementById('workout-content'),tracker:document.getElementById('workout-tracker'),getUid:()=>accountReady?state.user?.uid:null,tr,locale,
  store:{read:parts=>fbGet(doc(db,...parts)),list:async parts=>{const snapshot=await getDocs(collection(db,...parts)),items=[];snapshot.forEach(item=>items.push({...item.data(),id:item.id}));return items;},commit:async writes=>{const batch=writeBatch(db);for(const write of writes){if(write.remove)batch.delete(doc(db,...write.path));else batch.set(doc(db,...write.path),write.value,{merge:false});}await batch.commit();}}
});
window.createWorkout=()=>workoutFeature.create();
window.openWorkoutHistory=async()=>{
  const content=document.getElementById('workout-history-content');
  content.innerHTML=workoutFeature.historyHTML();
  openModal('modal-workout-history');
  await workoutFeature.open();
  if(accountReady)content.innerHTML=workoutFeature.historyHTML();
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
  goals:     () => accountRef('settings','goals'),
  foodLists: () => accountRef('settings','foodLists'),
  foods:     () => accountRef('settings','foods'),
  weights:   () => accountRef('settings','weights'),
  day:       (d) => accountRef('days',d),
};
function accountRef(...parts){
  if(!state.user || auth.currentUser?.uid!==state.user.uid) throw new Error(tr("Please sign in again."));
  return doc(db,'users',state.user.uid,...parts);
}
let stopDayListener=null;
let accountGeneration=0;
let accountReady=false;

async function initializeAccount(user){
  const profile=doc(db,'users',user.uid);
  const existing=await getDoc(profile);
  if(existing.exists()) return existing.data();
  let legacy=null;
  try{legacy=await fbGet(doc(db,'migration','legacy'));}
  catch(error){if(error.code!=='permission-denied')throw error;}
  const importLegacy=!!(legacy?.available&&user.emailVerified&&legacy.ownerEmail===user.email);
  const batch=writeBatch(db);
  if(importLegacy){
    const [goals,lists,foods,weights,days]=await Promise.all([
      fbGet(doc(db,'migration','legacy','settings','goals')),fbGet(doc(db,'migration','legacy','settings','foodLists')),
      fbGet(doc(db,'migration','legacy','settings','foods')),fbGet(doc(db,'migration','legacy','settings','weights')),
      getDocs(collection(db,'migration','legacy','days')),
    ]);
    if(days.size>450)throw new Error(tr("Your existing history needs an assisted import. Please contact the app owner."));
    for(const [name,data] of [['goals',goals],['foodLists',lists],['foods',foods],['weights',weights]]){
      if(data)batch.set(doc(db,'users',user.uid,'settings',name),data);
    }
    days.forEach(day=>batch.set(doc(db,'users',user.uid,'days',day.id),day.data()));
  }else{
    const [lists,foods]=await Promise.all([fbGet(doc(db,'defaults','foodLists')),fbGet(doc(db,'defaults','foods'))]);
    batch.set(doc(db,'users',user.uid,'settings','foodLists'),lists||{lists:[]});
    batch.set(doc(db,'users',user.uid,'settings','foods'),foods||{foods:[]});
  }
  const profileData={createdAt:Date.now(),legacyImported:importLegacy,languageSetupPending:true};
  batch.set(profile,profileData);
  await batch.commit();
  return profileData;
}

async function ensureAccountProtection(){
  // This deliberately anonymous read must be denied before any private account
  // records are opened or created. Old permissive rules return 404 for the probe.
  const response=await fetch('https://firestore.googleapis.com/v1/projects/fitness-352e8/databases/(default)/documents/users/calcal-account-protection-probe/settings/goals');
  const result=await response.json();
  if(response.status!==403||result.error?.status!=='PERMISSION_DENIED'){
    const error=new Error(tr("Account protection is not configured."));error.code='calcal/setup-required';throw error;
  }
}

async function fbGet(ref){ const s=await getDoc(ref); return s.exists()?s.data():null; }
async function fbSet(ref,data){ setSyncStatus('loading'); try{ await setDoc(ref,data); setSyncStatus('ok'); }catch(e){ setSyncStatus('err'); throw e; } }

// ── LOAD FROM FIREBASE ───────────────────────────────────
async function loadFromFirebase() {
  const generation=accountGeneration;
  const today = TODAY();
  const dayRef=REF.day(today);
  const [g,fl,fo,weights,dayDoc]=await Promise.all([
    fbGet(REF.goals()),fbGet(REF.foodLists()),fbGet(REF.foods()),fbGet(REF.weights()),fbGet(dayRef),
  ]);
  if(generation!==accountGeneration)return;
  if(g)state.goals=g;
  state.foodLists=fl?.lists||[];state.foods=fo?.foods||[];state.weights=weights||{};
  if(dayDoc){
    if(dayDoc.logs)  state.logs[today]  = dayDoc.logs;
    if(dayDoc.water !== undefined) state.water[today] = dayDoc.water;
    if(dayDoc.supps) state.supps[today] = new Set(dayDoc.supps);
  }

  if(!state.foodLists.some(l=>l.id===state.activeListId)) state.activeListId = state.foodLists[0]?.id||null;

  // real-time listener for today
  stopDayListener?.();
  stopDayListener=onSnapshot(dayRef, snap => {
    if(generation!==accountGeneration)return;
    if(!snap.exists()) return;
    const d = snap.data();
    if(d.logs)  state.logs[today]  = d.logs;
    if(d.water !== undefined) state.water[today] = d.water;
    if(d.supps) state.supps[today] = new Set(d.supps);
    renderHome();
  },()=>setSyncStatus('err'));

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
function syncHomeBackgroundBlur(){
  const home=document.getElementById('page-home');
  const canvas=document.getElementById('earth-background');
  if(!home || !canvas) return;
  const range=home.scrollHeight-home.clientHeight;
  const progress=range>0?Math.max(0,Math.min(1,home.scrollTop/range)):0;
  canvas.style.filter=`blur(${(8*(1-progress)).toFixed(2)}px)`;
  canvas.style.opacity=(0.2+0.8*progress).toFixed(3);
}

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
  // The lowered Earth's horizon occupies about .72 screen widths.
  // Reveal that visible region, without scrolling through the canvas's empty sky.
  const revealHeight=image.classList.contains('earth-ready')?Math.min(pictureBounds.height,pictureBounds.width*.72):0;
  spacer.style.height=Math.max(0,revealHeight+pageBounds.bottom-pictureBounds.bottom-bottomPadding-cardMargin)+'px';
  syncHomeBackgroundBlur();
}
document.getElementById('page-home')?.addEventListener('scroll',syncHomeBackgroundBlur,{passive:true});
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
  document.getElementById('home-weekday').textContent=_now.toLocaleDateString(locale(),{weekday:'long'});

  // Ring
  // Subtract the same whole-number total shown in the diary, so the
  // displayed intake and remaining amount always add up to the goal.
  const intakeMode=state.nutritionDisplay==='intake';
  const caloriesLeft=Math.round(g.cal)-Math.round(t.cal);
  document.getElementById('ring-consumed-big').textContent = intakeMode?Math.round(t.cal):Math.round(Math.abs(caloriesLeft));
  document.getElementById('ring-goal-lbl').textContent = intakeMode?`/${Math.round(g.cal)}kcal`:(caloriesLeft<0?`kcal ${tr("over")}`:'kcal');
  const pct=g.cal>0?Math.max(0,Math.min(1,(intakeMode?t.cal:caloriesLeft)/g.cal)):0, circ=2*Math.PI*57;
  document.getElementById('ring-cal').style.strokeDashoffset = circ - circ*pct;
  document.getElementById('ring-cal').style.stroke = caloriesLeft<0?'var(--red)':'var(--accent)';

  // Macros
  const setBar=(id,val,goal,color)=>{
    const left=Math.round(goal)-Math.round(val);
    const p=goal>0?Math.max(0,Math.min(100,(intakeMode?val:left)/goal*100)):0;
    document.getElementById('bar-'+id).style.width=p+'%';
    document.getElementById('bar-'+id).style.background=color;
    const label=document.getElementById('lbl-'+id);
    label.innerHTML=intakeMode?`<strong>${Math.round(val)}</strong>g/${Math.round(goal)}g`:`<strong>${Math.abs(left)}</strong>g${left<0?' '+tr("over"):''}`;
    label.classList.toggle('nutrition-over',left<0);
    label.title='';
  };
  setBar('protein',t.protein,g.protein,'var(--protein-bar)');
  setBar('carbs',t.carbs,g.carbs,'var(--carbs-bar)');
  setBar('fat',t.fat,g.fat,'var(--fat-bar)');

  // Water
  const wGoal=g.waterMl||2000, wCon=state.water[date]||0;
  document.getElementById('water-consumed-big').textContent=wCon;
  document.getElementById('water-goal-lbl').textContent=`${tr('Goal:')} ${wGoal} ml (${(wGoal/1000).toFixed(1)}L)`;
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
        <div class="log-meta">${tr("Protein")} ${formatNutrient(l.protein)}g · ${tr("Carbs")} ${formatNutrient(l.carbs)}g · ${tr("Fat")} ${formatNutrient(l.fat)}g</div>
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
function updateCategoryTitleFade(){
  const title=document.getElementById('current-category-name');
  title.classList.toggle('is-overflowing',title.clientWidth>0&&title.scrollWidth>title.clientWidth+1);
  title.title=title.textContent;
}
if(typeof ResizeObserver!=='undefined')new ResizeObserver(updateCategoryTitleFade).observe(document.getElementById('current-category-name'));
window.addEventListener('resize',updateCategoryTitleFade);
document.fonts?.addEventListener('loadingdone',updateCategoryTitleFade);
function renderFoodLists(){
  document.getElementById('current-category-name').textContent=state.foodLists.find(l=>l.id===state.activeListId)?.name||tr("Categories");
  updateCategoryTitleFade();
  const grid=document.getElementById('food-grid');
  const foods=state.foods.filter(f=>f.listId===state.activeListId);
  if(!foods.length){ grid.innerHTML=`<div class="empty"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle"><circle cx="12" cy="12" r="6"/><path d="M2 3v6m3-6v6M2 6h3M3.5 9v12M21 3v18M21 3c-4 3-4 8 0 8"/></svg></div><p>${tr("No foods in this list. Tap Add food to get started.")}</p></div>`; return; }
  grid.innerHTML=foods.map((f,index)=>`
    <div class="food-item-wrap" data-food-id="${escapeHtml(f.id)}">
      <div class="food-item" onclick="window._openServe('${f.id}')">
        <div class="food-details">
          <div class="food-name">${escapeHtml(f.name)}${f.portion?`<span class="food-portion">${escapeHtml(f.portion)}</span>`:''}</div>
          <div class="food-nutrition">
            ${[['cal','kcal',tr("Calories")],['protein','g',tr("Protein")],['carbs','g',tr("Carbs")],['fat','g',tr("Fat")]].map(([key,unit,label])=>`
              <div class="food-nutrient"><div class="food-nutrient-value">${formatNutrient(f[key]??0)}<span class="food-nutrient-unit"> ${unit}</span></div><div class="food-nutrient-label">${label}</div></div>
            `).join('')}
          </div>
          ${f.ingredients?`<div class="food-ingredients">${tr("Ingredients:")} ${escapeHtml(f.ingredients)}</div>`:''}
        </div>
        <div class="food-row-controls">
          <button class="btn-icon" aria-label="${tr("Edit")} ${escapeHtml(f.name)}" ${state._savingFoods?'disabled':''} onclick="event.stopPropagation();window._editFood('${f.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 3l5 5L8 21H3v-5zM13 6l5 5"/></svg></button>
          <button class="btn-icon" aria-label="${tr("Delete")} ${escapeHtml(f.name)}" ${state._savingFoods?'disabled':''} onclick="event.stopPropagation();window._deleteFood('${f.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button class="btn-icon food-drag-handle" aria-label="${tr("Reorder")} ${escapeHtml(f.name)}" title="${tr("Drag to reorder (keyboard: Up / Down)")}" ${state._savingFoods?'disabled':''} onclick="event.stopPropagation()" onpointerdown="window._startFoodDrag(event,'${f.id}')" onkeydown="if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();window._moveFood('${f.id}',event.key==='ArrowUp'?-1:1)}">☰</button>
        </div>
      </div>

    </div>`).join('');
}
window._setList=id=>{ state.activeListId=id; renderFoodLists(); };
async function persistFoods(nextFoods){
  if(state._savingFoods)return false;
  const generation=accountGeneration;
  const previous=state.foods;
  state._savingFoods=true; state.foods=nextFoods;
  document.getElementById('save-food-btn').disabled=true;
  renderFoodLists();
  try{ await saveFoodsDoc(); return generation===accountGeneration; }
  catch(err){ if(generation===accountGeneration){state.foods=previous; alert(tr("Could not save. Please try again."));} return false; }
  finally{ if(generation===accountGeneration){state._savingFoods=false; document.getElementById('save-food-btn').disabled=false; renderFoodLists();} }
}
window._deleteFood=async id=>{
  if(state._savingFoods||!confirm(tr("Delete this food?")))return;
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
let savingGoalSettings=false,goalEvaluation=null;
const activityPictures={
  sedentary:['sedentary','Sedentary','Little or no exercise'],
  light:['light','Light','Exercise 1–3 days/week'],
  moderate:['moderate','Moderate','Exercise 3–5 days/week'],
  active:['active','Active','Exercise 6–7 days/week'],
  veryActive:['extra','Very active','Hard daily exercise / physical job'],
};
function goalProfileStats(){
  return {...state.bodyProfile,age:ageFromBirthday(state.bodyProfile.birthday,TODAY())??state.bodyProfile.age,
    weight:currentProfileWeight(state.weights,state.bodyProfile,TODAY())};
}
function renderGoalProfileStats(){
  const stats=goalProfileStats();
  document.getElementById('g-current-age').textContent=Number.isFinite(stats.age)?stats.age:'—';
  document.getElementById('g-current-weight').textContent=Number.isFinite(stats.weight)?stats.weight.toFixed(1):'—';
}
window.clearGoalEvaluation=()=>{goalEvaluation=null;};
window.updateGoalActivity=()=>{
  goalEvaluation=null;
  const picture=activityPictures[document.getElementById('g-activity').value];
  if(!picture)return;
  document.getElementById('g-activity-image').src='./assets/pictures/web/'+picture[0]+'.jpg';
  document.getElementById('g-activity-title').textContent=tr(picture[1]);
  document.getElementById('g-activity-description').textContent=tr(picture[2]);
};
window.openGoalModal=()=>{
  for(const key of ['cal','protein','carbs','fat'])document.getElementById('g-'+key).value=state.goals[key]??'';
  document.getElementById('g-activity').value=Object.hasOwn(activityFactors,state.bodyProfile.activity)?state.bodyProfile.activity:'sedentary';
  const goal=['gain','lose','maintain'].includes(state.bodyProfile.goal)?state.bodyProfile.goal:'maintain';
  document.getElementById('g-fitness-goal').value=goal;
  document.querySelectorAll('input[name="g-fitness-choice"]').forEach(input=>input.checked=input.value===goal);
  window.updateGoalActivity();renderGoalProfileStats();
  document.getElementById('goal-error').textContent='';
  openModal('modal-goal');
};
window.reEvaluateGoals=()=>{
  if(savingGoalSettings)return false;
  const stats=goalProfileStats(),error=document.getElementById('goal-error');error.textContent='';
  renderGoalProfileStats();
  if(!['male','female'].includes(stats.gender)||!Number.isFinite(stats.age)||!Number.isFinite(stats.height)||!Number.isFinite(stats.weight)){
    error.textContent=tr('Add gender, birthday and height in Personal details, and record your weight first.');return false;
  }
  try{
    const activity=document.getElementById('g-activity').value,goal=document.getElementById('g-fitness-goal').value;
    const suggestion=calculateSuggestedGoals({...stats,activity,goal});
    for(const key of ['cal','protein','carbs','fat'])document.getElementById('g-'+key).value=suggestion[key];
    goalEvaluation={...stats,activity,goal,bmr:suggestion.bmr,tdee:suggestion.tdee,formula:'Mifflin-St Jeor'};
    return true;
  }catch(err){error.textContent=tr(err.message);return false;}
};
window.roundHomeGoals=()=>{
  if(savingGoalSettings)return false;
  const error=document.getElementById('goal-error');error.textContent='';
  if(!document.getElementById('daily-goals-form').reportValidity())return false;
  try{
    const rounded=roundDailyGoals(Object.fromEntries(['cal','protein','carbs','fat'].map(key=>[key,Number(document.getElementById('g-'+key).value)])));
    for(const key of ['cal','protein','carbs','fat'])document.getElementById('g-'+key).value=rounded[key];return true;
  }catch(err){error.textContent=tr(err.message);return false;}
};
window.saveGoals=async()=>{
  if(!state.user||!accountReady||savingGoalSettings)return false;
  const error=document.getElementById('goal-error');error.textContent='';
  if(!document.getElementById('daily-goals-form').reportValidity())return false;
  const next=Object.fromEntries(['cal','protein','carbs','fat'].map(key=>[key,Number(document.getElementById('g-'+key).value)]));
  if(!Object.values(next).every(Number.isInteger)||next.cal<1000||next.cal>20000||next.protein<0||next.protein>1000||next.carbs<0||next.carbs>2000||next.fat<0||next.fat>1000){error.textContent=tr('Enter valid whole-number daily targets.');return false;}
  const activity=document.getElementById('g-activity').value,goal=document.getElementById('g-fitness-goal').value;
  if(!Object.hasOwn(activityFactors,activity)){error.textContent=tr('Choose your activity level.');return false;}
  if(!['gain','lose','maintain'].includes(goal)){error.textContent=tr('Choose your weight goal.');return false;}
  const profilePatch={...(goalEvaluation?.activity===activity&&goalEvaluation?.goal===goal?goalEvaluation:{}),activity,goal,updatedAt:Date.now()};
  const generation=accountGeneration;savingGoalSettings=true;document.getElementById('g-save').disabled=true;
  try{
    const batch=writeBatch(db);batch.set(REF.goals(),next,{merge:true});batch.set(accountRef('settings','bodyProfile'),profilePatch,{merge:true});await batch.commit();
    if(generation!==accountGeneration)return false;
    state.goals={...state.goals,...next};state.bodyProfile={...state.bodyProfile,...profilePatch};renderPersonalDetails();
    closeModal('modal-goal');renderHome();return true;
  }catch(err){if(generation===accountGeneration)error.textContent=tr('Could not save goals. Please try again.');return false;}
  finally{if(generation===accountGeneration){savingGoalSettings=false;document.getElementById('g-save').disabled=false;}}
};
window.openWaterGoalModal=()=>{document.getElementById('g-water-ml').value=state.goals.waterMl||2000;document.getElementById('water-goal-error').textContent='';openModal('modal-water-goal');};
window.openSupplementGoalModal=()=>{document.getElementById('g-supps').value=(state.goals.supps||[]).join(', ');document.getElementById('supplement-goal-error').textContent='';openModal('modal-supplement-goal');};
async function saveCardGoal(kind,patch){
  if(!state.user||!accountReady||savingGoalSettings)return false;
  const generation=accountGeneration,error=document.getElementById(kind+'-goal-error'),button=document.getElementById(kind+'-goal-save');
  savingGoalSettings=true;button.disabled=true;error.textContent='';
  try{
    await setDoc(REF.goals(),patch,{merge:true});if(generation!==accountGeneration)return false;
    state.goals={...state.goals,...patch};closeModal('modal-'+kind+'-goal');renderHome();return true;
  }catch(err){if(generation===accountGeneration)error.textContent=tr('Could not save goals. Please try again.');return false;}
  finally{if(generation===accountGeneration){savingGoalSettings=false;button.disabled=false;}}
}
window.saveWaterGoal=()=>{
  const value=Number(document.getElementById('g-water-ml').value);
  if(!Number.isInteger(value)||value<=0){document.getElementById('water-goal-error').textContent=tr('Enter a positive whole-number water goal.');return false;}
  return saveCardGoal('water',{waterMl:value});
};
window.saveSupplementGoal=()=>saveCardGoal('supplement',{supps:[...new Set(document.getElementById('g-supps').value.split(/[,，]/).map(value=>value.trim()).filter(Boolean))]});

// ── ADD FOOD ──────────────────────────────────────────────
window.openAddFoodModal=(prefill)=>{
  state._editFoodId=null;
  document.getElementById('add-food-title').textContent=tr("Add food");
  document.getElementById('f-name').value=prefill?.name||'';
  document.getElementById('f-portion').value=prefill?.portion||'';
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
  document.getElementById('add-food-title').textContent=tr("Edit food");
};
window.saveFood=async()=>{
  if(state._savingFoods)return;
  const name=document.getElementById('f-name').value.trim();
  if(!name){alert(tr("Please enter a food name."));return;}
  const listId=document.getElementById('f-list').value;
  if(!state.foodLists.some(l=>l.id===listId)){alert(tr("Please create a food list first."));return;}
  const nutrients={};
  for(const key of ['cal','protein','carbs','fat']){
    const input=document.getElementById('f-'+key), text=input.value.trim();
    const value=text===''?(key==='cal'?0:null):Number(text);
    if(input.validity?.badInput||(value!==null&&(!Number.isFinite(value)||value<0))){alert(tr("Nutrient values must be zero or positive numbers."));return;}
    nutrients[key]=value;
  }
  const original=state._editFoodId?state.foods.find(f=>f.id===state._editFoodId):null;
  if(state._editFoodId&&!original){alert(tr("This food no longer exists. Please reopen the list."));return;}
  const food={
    ...original, id:original?.id||('f'+Date.now()), listId, name,
    portion:document.getElementById('f-portion').value.trim(),
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
        <button class="btn-icon" aria-label="${tr("Edit category")} ${escapeHtml(l.name)}" ${state._savingLists?'disabled':''} onclick="window._editCategory('${l.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 3l5 5L8 21H3v-5zM13 6l5 5"/></svg></button>
        <button class="btn-icon" aria-label="${tr("Delete category")} ${escapeHtml(l.name)}" ${state._savingLists||state._savingFoods?'disabled':''} onclick="window._deleteList('${l.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M9 6V4h6v2M10 11v6M14 11v6"/></svg></button>
        <button class="btn-icon food-drag-handle" aria-label="${tr("Reorder category")} ${escapeHtml(l.name)}" title="${tr("Drag to reorder (keyboard: Up / Down)")}" ${state._savingLists?'disabled':''} onpointerdown="window._startCategoryDrag(event,'${l.id}')" onkeydown="if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();window._moveCategory('${l.id}',event.key==='ArrowUp'?-1:1)}">☰</button>
      </div>
    </div>`).join('')||`<div class="empty">${tr("No categories yet. Add one above.")}</div>`;
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
  document.getElementById('edit-category-field').innerHTML=`<label for="list-name-${id}">${tr("Category name")}</label><input id="list-name-${id}" value="${escapeHtml(list.name)}">`;
  openModal('modal-edit-category');
};
window.saveCategoryName=()=>window._renameList(editingCategoryId);
async function persistCategories(next){
  if(state._savingLists)return false;
  const generation=accountGeneration;
  const previous=state.foodLists;
  state._savingLists=true;state.foodLists=next;
  renderManageLists();
  try{await saveFoodListsDoc();if(generation!==accountGeneration)return false;renderFoodLists();return true;}
  catch(err){if(generation===accountGeneration){state.foodLists=previous;alert(tr("Could not save. Please try again."));}return false;}
  finally{if(generation===accountGeneration){state._savingLists=false;renderManageLists();}}
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
  if(!name){alert(tr("Please enter a list name."));return;}
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
  const generation=accountGeneration;
  if(!confirm(tr("Delete this category and all its foods?")))return;
  const lists=state.foodLists.filter(l=>l.id!==id),foods=state.foods.filter(f=>f.listId!==id);
  state._savingLists=true;state._savingFoods=true;setSyncStatus('loading');
  renderManageLists();renderFoodLists();
  try{
    const batch=writeBatch(db);
    batch.set(REF.foodLists(),{lists});batch.set(REF.foods(),{foods});
    await batch.commit();
    if(generation!==accountGeneration)return;
    state.foodLists=lists;state.foods=foods;
    if(state.activeListId===id)state.activeListId=lists[0]?.id||null;
    setSyncStatus('ok');
  }catch(err){if(generation===accountGeneration){setSyncStatus('err');alert(tr("Could not delete. Please try again."));}}
  finally{if(generation===accountGeneration){state._savingLists=false;state._savingFoods=false;renderManageLists();renderFoodLists();}}
};

// ── SERVE MODAL ───────────────────────────────────────────
window._openServe=id=>{
  const f=state.foods.find(x=>x.id===id); if(!f)return;
  state._serveFood=f;
  document.getElementById('serve-food-name').textContent=f.name;
  document.getElementById('serve-food-info').textContent=`${tr("Per serving (1x):")} ${formatNutrient(f.cal)} kcal · ${tr("Protein")} ${formatNutrient(f.protein)}g · ${tr("Carbs")} ${formatNutrient(f.carbs)}g · ${tr("Fat")} ${formatNutrient(f.fat)}g ${tr("(— means unavailable)")}`;
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
      <div><div style="font-size:20px;font-weight:700;color:var(--green)">${formatNutrient(scaleNutrient(f.protein,q))}</div><div style="font-size:11px;color:var(--text2)">${tr("Protein")} g</div></div>
      <div><div style="font-size:20px;font-weight:700;color:var(--yellow)">${formatNutrient(scaleNutrient(f.carbs,q))}</div><div style="font-size:11px;color:var(--text2)">${tr("Carbs")} g</div></div>
      <div><div style="font-size:20px;font-weight:700;color:var(--orange)">${formatNutrient(scaleNutrient(f.fat,q))}</div><div style="font-size:11px;color:var(--text2)">${tr("Fat")} g</div></div>
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
  if(!entries.length){summary.textContent='';chart.innerHTML=`<div class="empty" style="padding:28px 0;">${tr("Tap + to record your first weight.")}</div>`;return;}
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
  chart.innerHTML=`<svg class="weight-chart-svg" viewBox="0 0 520 230" role="img" aria-label="${tr("Weight history in kilograms by date")}">
    <title>${tr("Weight history:")} ${entries.map(([date,kg])=>`${weightDateLabel(date)}: ${kg.toFixed(1)} kg`).join('; ')}</title>
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
  const generation=accountGeneration;
  const date=document.getElementById('weight-date').value;
  const input=document.getElementById('weight-value'),kg=Number(input.value);
  const error=document.getElementById('weight-error');
  if(!validWeightDate(date)||date>TODAY()){error.textContent=tr("Choose today or an earlier date.");return;}
  if(input.validity?.badInput||!Number.isFinite(kg)||kg<=0){error.textContent=tr("Enter a weight greater than zero.");return;}
  state._savingWeight=true;document.getElementById('save-weight-btn').disabled=true;error.textContent='';
  setSyncStatus('loading');
  try{
    await setDoc(REF.weights(),{[date]:kg},{merge:true});
    if(generation!==accountGeneration)return;
    state.weights={...state.weights,[date]:kg};setSyncStatus('ok');
    renderWeightChart();closeModal('modal-weight');
  }catch(err){if(generation===accountGeneration){setSyncStatus('err');error.textContent=tr("Could not save your weight. Please try again.");}}
  finally{if(generation===accountGeneration){state._savingWeight=false;document.getElementById('save-weight-btn').disabled=false;}}
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
window.switchPage=(name,btn,direction)=>{
  if(!accountReady)return;
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
  workoutFeature.setVisible(name==='workout');
  if(name==='workout')workoutFeature.open(!direction,previousPage==='page-workout');
  if(!direction){document.querySelectorAll('.modal-overlay.open').forEach(modal=>window.closeModal(modal.id));document.getElementById('page-'+name).scrollTop=0;}
  const page=document.getElementById('page-'+name);
  page.classList.remove('page-enter-left','page-enter-right');
  if(direction&&previousPage!==page.id){
    void page.offsetWidth;
    page.classList.add('page-enter-'+direction);
  }
};
setupPageSwipes({canSwitch:()=>accountReady,switchPage:(name,direction)=>window.switchPage(name,document.querySelector(`[data-page="${name}"]`),direction)});

// ── MODALS ────────────────────────────────────────────────
window.openModal=id=>{
  document.getElementById(id).classList.add('open');
  if(id==='modal-language'){
    onboardingTransition.reset();
    document.querySelector('.onboarding-panel').style.animation='';
    document.querySelectorAll('.page, .nav').forEach(el=>el.inert=true);
    document.getElementById('first-language').focus?.({preventScroll:true});
  }
};
window.closeModal=id=>{if(id==='modal-language'&&languageSetupPending)return;document.getElementById(id).classList.remove('open');};
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click',e=>{ if(e.target===o) window.closeModal(o.id); });
});

// Preferences live under this user's account, independently of their food data.
let languageSetupPending=false;
let savingLanguage=false;
let savingTesterMode=false;
let onboardingStep=0;
let onboardingStats=null;
let onboardingSuggestion=null;
let savingOnboarding=false;
const onboardingSteps=['language','stats','activity','review'];
const statsWheels=Array.from(document.querySelectorAll('[data-number-wheel]'),viewport=>createNumberWheel(document.getElementById(viewport.dataset.numberWheel),viewport,{min:Number(viewport.dataset.min),max:Number(viewport.dataset.max),step:Number(viewport.dataset.step),initial:Number(viewport.dataset.initial)}));
const onboardingTransition=createOnboardingTransition(document.querySelector('.onboarding-panel'));
function showOnboardingStep(step){
  const previous=onboardingStep;
  if(step!==previous)return onboardingTransition.run(()=>renderOnboardingStep(step),step>previous?'next':'back');
  renderOnboardingStep(step);
}
function clearOnboardingErrors(){
  document.getElementById('language-choice-error').textContent='';
  document.querySelectorAll('#modal-language .onboarding-error-title').forEach(el=>el.classList.remove('onboarding-error-title'));
  document.querySelectorAll('#modal-language [aria-invalid="true"]').forEach(el=>el.removeAttribute('aria-invalid'));
}
function showOnboardingError(message,fieldId){
  document.getElementById('language-choice-error').textContent=tr(message);
  if(!fieldId){
    fieldId=/weight between/.test(message)?'setup-weight':/height between/.test(message)?'setup-height':/age between/.test(message)?'setup-birthday':/Male or Female/.test(message)?'setup-gender':null;
  }
  const section=document.getElementById('onboarding-'+onboardingSteps[onboardingStep]);
  const title=fieldId?document.querySelector('label[for="'+fieldId+'"]'):/weight goal/.test(message)?section.querySelector('.setup-goal-heading'):section.querySelector('.modal-title');
  if(!title)return;
  title.classList.add('onboarding-error-title');
  if(fieldId)document.getElementById(fieldId).setAttribute?.('aria-invalid','true');
  if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)title.animate?.([{transform:'translateX(0)'},{transform:'translateX(-5px)'},{transform:'translateX(5px)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:360,easing:'ease-out'});
}
const onboardingPanel=document.querySelector('.onboarding-panel');
onboardingPanel.addEventListener('invalid',event=>{
  event.preventDefault();
  showOnboardingError(event.target.validationMessage,event.target.name==='setup-gender-choice'?'setup-gender':event.target.id);
},true);
onboardingPanel.addEventListener('input',clearOnboardingErrors);
onboardingPanel.addEventListener('change',clearOnboardingErrors);
function renderOnboardingStep(step){
  onboardingStep=step;
  if(step===2){
    const activity=document.getElementById('setup-activity').value;
    document.querySelectorAll('#onboarding-activity input[name="setup-activity-choice"]').forEach(input=>input.checked=input.value===activity);
  }
  onboardingSteps.forEach((name,index)=>document.getElementById('onboarding-'+name).hidden=index!==step);
  if(step===1){
    document.getElementById('setup-birthday').max=TODAY();
    statsWheels.forEach(wheel=>wheel.sync());
    const gender=document.getElementById('setup-gender').value;
    document.querySelectorAll('input[name="setup-gender-choice"]').forEach(input=>input.checked=input.value===gender);
  }
  const title=document.getElementById('onboarding-'+onboardingSteps[step]).querySelector('.modal-title');
  title.id='onboarding-title-'+step;
  title.setAttribute?.('tabindex','-1');
  document.getElementById('modal-language').setAttribute?.('aria-labelledby',title.id);
  title.focus?.({preventScroll:true});
  clearOnboardingErrors();
  document.querySelector('.onboarding-panel').scrollTop=0;
}
window.onboardingBack=()=>{if(!savingOnboarding&&!savingLanguage&&!onboardingTransition.moving&&onboardingStep>0)showOnboardingStep(onboardingStep-1);};
window.onboardingNext=()=>{
  if(savingOnboarding||savingLanguage||onboardingTransition.moving||onboardingStep===3)return;
  if(onboardingStep===0)return window.confirmLanguageChoice();
  const error=document.getElementById('language-choice-error');
  clearOnboardingErrors();
  if(onboardingStep===1){
    statsWheels.forEach(wheel=>wheel.flush());
    if(!document.getElementById('onboarding-stats-form').reportValidity())return;
    const birthday=document.getElementById('setup-birthday').value,age=ageFromBirthday(birthday,TODAY());
    if(age===null){showOnboardingError('Enter a valid birthday that is not in the future.','setup-birthday');return;}
    document.getElementById('setup-age').value=age;
    onboardingStats={birthday,gender:document.getElementById('setup-gender').value,weight:Number(document.getElementById('setup-weight').value),height:Number(document.getElementById('setup-height').value),age:Number(document.getElementById('setup-age').value)};
    try{calculateSuggestedGoals({...onboardingStats,activity:'sedentary',goal:'gain'});}catch(err){showOnboardingError(err.message);return;}
  }
  if(onboardingStep===2&&!Object.hasOwn(activityFactors,document.getElementById('setup-activity').value)){showOnboardingError('Choose your activity level.');return;}
  if(onboardingStep===2){
    const goal=document.querySelector('input[name="setup-goal"]:checked')?.value;
    try{
      onboardingSuggestion=calculateSuggestedGoals({...onboardingStats,activity:document.getElementById('setup-activity').value,goal});
      document.getElementById('setup-bmr').textContent=onboardingSuggestion.bmr+' kcal';
      document.getElementById('setup-tdee').textContent=onboardingSuggestion.tdee+' kcal';
      for(const key of ['cal','protein','carbs','fat'])document.getElementById('setup-'+key).value=onboardingSuggestion[key];
    }catch(err){showOnboardingError(err.message);return;}
  }
  showOnboardingStep(Math.min(3,onboardingStep+1));
};
window.roundOnboardingGoals=()=>{
  if(onboardingStep!==3||savingOnboarding||onboardingTransition.moving)return;
  clearOnboardingErrors();
  if(!document.getElementById('onboarding-review-form').reportValidity())return;
  try{
    const goals=roundDailyGoals(Object.fromEntries(['cal','protein','carbs','fat'].map(key=>[key,Number(document.getElementById('setup-'+key).value)])));
    for(const key of ['cal','protein','carbs','fat'])document.getElementById('setup-'+key).value=goals[key];
  }catch(err){showOnboardingError(err.message);}
};
window.completeOnboarding=async useSuggested=>{
  if(!useSuggested||onboardingStep!==3||!state.user||savingOnboarding||onboardingTransition.moving||!languageSetupPending)return false;
  if(useSuggested&&(!onboardingSuggestion||!document.getElementById('onboarding-review-form').reportValidity()))return false;
  const generation=accountGeneration,weightDate=TODAY(),error=document.getElementById('language-choice-error');
  let goals=null;
  if(useSuggested){
    goals={...state.goals};
    for(const key of ['cal','protein','carbs','fat']){
      const value=Number(document.getElementById('setup-'+key).value);
      if(!Number.isInteger(value)||value<0||(key==='cal'&&value<1000)){showOnboardingError('Enter valid whole-number daily targets.','setup-'+key);return false;}
      goals[key]=value;
    }
  }
  savingOnboarding=true;error.textContent='';
  document.querySelectorAll('#modal-language button, #modal-language input, #modal-language select').forEach(el=>el.disabled=true);
  try{
    const batch=writeBatch(db);
    batch.set(accountRef('settings','preferences'),{language:getLanguage(),onboardingComplete:true,onboardingCompletedAt:Date.now()},{merge:true});
    if(useSuggested){
      batch.set(REF.goals(),goals);
      batch.set(REF.weights(),{[weightDate]:onboardingStats.weight},{merge:true});
      batch.set(accountRef('settings','bodyProfile'),{...onboardingStats,activity:document.getElementById('setup-activity').value,goal:document.querySelector('input[name="setup-goal"]:checked').value,bmr:onboardingSuggestion.bmr,tdee:onboardingSuggestion.tdee,formula:'Mifflin-St Jeor',updatedAt:Date.now()},{merge:true});
    }
    await batch.commit();
    if(generation!==accountGeneration)return false;
    if(goals){state.goals=goals;state.weights={...state.weights,[weightDate]:onboardingStats.weight};}
    state.bodyProfile={...state.bodyProfile,...onboardingStats,activity:document.getElementById('setup-activity').value,goal:document.querySelector('input[name="setup-goal"]:checked').value,bmr:onboardingSuggestion.bmr,tdee:onboardingSuggestion.tdee};
    renderPersonalDetails();
    languageSetupPending=false;
    document.getElementById('modal-language').classList.remove('open');
    document.querySelectorAll('.page, .nav').forEach(el=>el.inert=false);
    renderHome();return true;
  }catch(err){if(generation===accountGeneration)showOnboardingError('Could not save your setup. Please try again.');return false;}
  finally{if(generation===accountGeneration){savingOnboarding=false;document.querySelectorAll('#modal-language button, #modal-language input, #modal-language select').forEach(el=>el.disabled=false);}}
};
let savingNutritionDisplay=false,savingPersonalDetails=false;
function renderPersonalDetails(){
  document.getElementById('personal-gender').value=['male','female'].includes(state.bodyProfile.gender)?state.bodyProfile.gender:'';
  document.getElementById('personal-birthday').value=state.bodyProfile.birthday||'';
  document.getElementById('personal-height').value=state.bodyProfile.height||'';
  document.getElementById('personal-birthday').max=TODAY();
}
window.changeNutritionDisplay=async mode=>{
  if(!state.user||!accountReady||savingNutritionDisplay||!['remaining','intake'].includes(mode))return false;
  const generation=accountGeneration,previous=state.nutritionDisplay;
  const select=document.getElementById('nutrition-display'),error=document.getElementById('nutrition-display-error');
  savingNutritionDisplay=true;select.disabled=true;error.textContent='';
  try{
    await setDoc(accountRef('settings','preferences'),{nutritionDisplay:mode},{merge:true});
    if(generation!==accountGeneration)return false;
    state.nutritionDisplay=mode;select.value=mode;renderHome();return true;
  }catch(err){
    if(generation===accountGeneration){select.value=previous;error.textContent=tr('Could not save display preference. Please try again.');}
    return false;
  }finally{if(generation===accountGeneration){savingNutritionDisplay=false;select.disabled=false;}}
};
window.savePersonalDetails=async()=>{
  if(!state.user||!accountReady||savingPersonalDetails)return false;
  const error=document.getElementById('personal-details-error'),status=document.getElementById('personal-details-status');
  error.textContent='';status.textContent='';
  const gender=document.getElementById('personal-gender').value,birthday=document.getElementById('personal-birthday').value;
  if(!['','male','female'].includes(gender)){error.textContent=tr('Choose Male or Female.');return false;}
  const update={gender,birthday,updatedAt:Date.now()};
  const height=document.getElementById('personal-height').value;
  if(height!==''){if(!Number.isFinite(Number(height))||Number(height)<100||Number(height)>250){error.textContent=tr('Enter a height between 100 and 250 cm.');return false;}update.height=Number(height);}
  if(birthday){
    const date=new Date(birthday+'T00:00:00'),parts=birthday.split('-').map(Number),now=new Date();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(birthday)||!Number.isFinite(date.getTime())||date.getFullYear()!==parts[0]||date.getMonth()+1!==parts[1]||date.getDate()!==parts[2]||birthday>TODAY()){
      error.textContent=tr('Enter a valid birthday that is not in the future.');return false;
    }
    update.age=now.getFullYear()-date.getFullYear()-((now.getMonth()<date.getMonth()||(now.getMonth()===date.getMonth()&&now.getDate()<date.getDate()))?1:0);
  }
  const generation=accountGeneration;
  savingPersonalDetails=true;
  for(const id of ['personal-gender','personal-birthday','personal-height','personal-details-save'])document.getElementById(id).disabled=true;
  try{
    await setDoc(accountRef('settings','bodyProfile'),update,{merge:true});
    if(generation!==accountGeneration)return false;
    state.bodyProfile={...state.bodyProfile,...update};status.textContent=tr('Saved');return true;
  }catch(err){if(generation===accountGeneration)error.textContent=tr('Could not save personal details. Please try again.');return false;}
  finally{if(generation===accountGeneration){savingPersonalDetails=false;for(const id of ['personal-gender','personal-birthday','personal-height','personal-details-save'])document.getElementById(id).disabled=false;}}
};
const TESTER_UID='YbInj1g14YPICxIGszWP3jtt6ZP2';
function renderAccountLabels(){
  if(!state.user)return;
  document.getElementById('account-name').textContent=state.user.displayName||tr('Personal account');
  document.getElementById('account-role').textContent=tr(state.isAdmin?'Admin':state.isTester?'Tester':'Personal account');
  document.getElementById('tester-card').hidden=!state.isTester;
  document.getElementById('tester-new-user').checked=state.testerNewUser;
  const google=state.user.providerData?.some(provider=>provider.providerId==='google.com');
  document.getElementById('account-provider').textContent=tr(google?'Signed in with Google':'Signed in with email');
}
function updateLanguageUI(language){
  setLanguage(language);
  document.getElementById('account-language').value=getLanguage();
  document.getElementById('nutrition-display').value=state.nutritionDisplay;
  renderAccountLabels();
  if(accountReady){
    renderHome();renderFoodLists();renderManageLists();workoutFeature.refresh();
    if(state._serveFood)updateServePreview();
  }
}
async function saveLanguagePreference(language,firstChoice=false){
  if(!validLanguage(language)||!state.user||savingLanguage)return false;
  const generation=accountGeneration, previous=getLanguage();
  const error=document.getElementById(firstChoice?'language-choice-error':'language-error');
  const button=document.getElementById(firstChoice?'language-continue':'account-language');
  savingLanguage=true;button.disabled=true;error.textContent='';
  try{
    await setDoc(accountRef('settings','preferences'),{language},{merge:true});
    if(generation!==accountGeneration)return false;
    updateLanguageUI(language);
    if(firstChoice){showOnboardingStep(1);return true;}
    languageSetupPending=false;
    document.getElementById('modal-language').classList.remove('open');
    document.querySelectorAll('.page, .nav').forEach(el=>el.inert=false);
    return true;
  }catch(err){
    if(generation===accountGeneration){document.getElementById('account-language').value=previous;if(firstChoice)showOnboardingError('Could not save your language. Please try again.');else error.textContent=tr('Could not save your language. Please try again.');}
    return false;
  }finally{if(generation===accountGeneration){savingLanguage=false;button.disabled=false;}}
}
window.changeAccountLanguage=language=>saveLanguagePreference(language);
window.changeTesterMode=async enabled=>{
  if(!state.isTester||savingTesterMode)return;
  const generation=accountGeneration, previous=state.testerNewUser;
  const input=document.getElementById('tester-new-user'),error=document.getElementById('tester-error');
  savingTesterMode=true;input.disabled=true;error.textContent='';
  try{
    await setDoc(accountRef('settings','preferences'),{testerNewUser:!!enabled},{merge:true});
    if(generation!==accountGeneration)return;
    state.testerNewUser=!!enabled;
  }catch(err){if(generation===accountGeneration){input.checked=previous;error.textContent=tr('Could not save tester mode. Please try again.');}}
  finally{if(generation===accountGeneration){savingTesterMode=false;input.disabled=false;}}
};
window.confirmLanguageChoice=()=>saveLanguagePreference(document.getElementById('first-language').value,true);
setupOnboardingSwipes({
  panel:document.querySelector('.onboarding-panel'),
  canNavigate:()=>accountReady&&languageSetupPending&&!savingOnboarding&&!savingLanguage&&!onboardingTransition.moving&&document.getElementById('modal-language').classList.contains('open'),
  next:()=>window.onboardingNext(),back:()=>window.onboardingBack(),
});
document.getElementById('first-language').addEventListener('change',event=>{
  updateLanguageUI(event.target.value);
});

// ── INIT ──────────────────────────────────────────────────
document.getElementById('water-input').addEventListener('keydown',e=>{ if(e.key==='Enter') window.addWater(); });

function resetAccountState(){
  onboardingTransition.reset();workoutFeature.reset();
  stopDayListener?.(); stopDayListener=null;
  state.goals={cal:2000,protein:150,carbs:250,fat:65,waterMl:2000,supps:[]};
  state.foodLists=[];state.foods=[];state.logs={};state.water={};state.supps={};state.weights={};
  state.activeListId=null;state._editFoodId=null;state._serveFood=null;
  state.isAdmin=false;
  state.isTester=false;state.testerNewUser=false;savingTesterMode=false;
  savingGoalSettings=false;goalEvaluation=null;
  for(const id of ['g-save','water-goal-save','supplement-goal-save'])document.getElementById(id).disabled=false;
  state.nutritionDisplay='remaining';state.bodyProfile={};savingNutritionDisplay=false;savingPersonalDetails=false;
  document.getElementById('nutrition-display').value='remaining';document.getElementById('nutrition-display').disabled=false;
  document.getElementById('nutrition-display-error').textContent='';
  document.getElementById('personal-details-error').textContent='';
  document.getElementById('personal-details-status').textContent='';
  document.getElementById('personal-details-save').disabled=false;
  document.getElementById('personal-gender').disabled=false;document.getElementById('personal-birthday').disabled=false;document.getElementById('personal-height').disabled=false;
  renderPersonalDetails();
  document.getElementById('tester-card').hidden=true;
  document.getElementById('tester-new-user').disabled=false;
  state._savingFoods=false;state._savingLists=false;state._savingWeight=false;
  languageSetupPending=false;savingLanguage=false;
  savingOnboarding=false;onboardingStep=0;onboardingStats=null;onboardingSuggestion=null;
  document.querySelectorAll('#modal-language button, #modal-language input, #modal-language select').forEach(el=>el.disabled=false);
  document.querySelectorAll('.page, .nav').forEach(el=>el.inert=false);
  document.getElementById('account-language').disabled=false;
  document.getElementById('language-continue').disabled=false;
  document.querySelectorAll('.modal-overlay').forEach(modal=>modal.classList.remove('open'));
}
function authMessage(error){
  const messages={
    'auth/popup-closed-by-user':tr("Sign-in was cancelled. Try again when you’re ready."),
    'auth/cancelled-popup-request':tr("A sign-in window is already open."),
    'auth/popup-blocked':tr("Allow popups for CalCal, then try again. On iPhone, try signing in through Safari."),
    'auth/unauthorized-domain':tr("Google sign-in needs this website to be enabled in Firebase. Please contact the app owner."),
    'auth/operation-not-allowed':tr("This sign-in method has not been enabled in Firebase yet. Please contact the app owner."),
    'auth/configuration-not-found':tr("Sign-in has not been set up yet. Please contact the app owner."),
    'auth/invalid-email':tr("Enter a valid email address."),
    'auth/invalid-credential':tr("Email or password is incorrect. If you use Google, continue with Google."),
    'auth/user-not-found':tr("Email or password is incorrect. If you use Google, continue with Google."),
    'auth/wrong-password':tr("Email or password is incorrect. If you use Google, continue with Google."),
    'auth/user-disabled':tr("This account has been disabled. Please contact the app owner."),
    'auth/too-many-requests':tr("Too many attempts. Please wait a little and try again."),
    'auth/network-request-failed':tr("Could not connect. Check your internet connection and try again."),
    'permission-denied':tr("Your account data could not be opened. Please contact the app owner."),
    'calcal/setup-required':tr("Google sign-in is ready. Account storage is waiting for the app owner to publish its protection rules. Please try again shortly."),
  };
  return messages[error.code]||tr("Could not open your account. Please try again.");
}
let signInPending=false;
function setSignInDisabled(disabled){
  for(const id of ['google-sign-in','email-sign-in','login-email','login-password'])document.getElementById(id).disabled=disabled;
}
window.signInEmail=async(event)=>{
  event.preventDefault();
  if(signInPending||!document.getElementById('email-login-form').reportValidity())return;
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  document.getElementById('login-error').textContent='';
  signInPending=true;setSignInDisabled(true);
  try{
    await signInWithEmailAndPassword(auth,email,password);
    document.getElementById('login-password').value='';
  }catch(error){document.getElementById('login-error').textContent=authMessage(error);}
  finally{signInPending=false;setSignInDisabled(document.querySelector('.login-actions').classList.contains('account-opening'));}
};
window.signInGoogle=async()=>{
  if(signInPending)return;
  const error=document.getElementById('login-error');
  error.textContent='';signInPending=true;setSignInDisabled(true);
  try{
    const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    await signInWithPopup(auth,provider);
  }catch(e){error.textContent=authMessage(e);}
  finally{signInPending=false;setSignInDisabled(document.querySelector('.login-actions').classList.contains('account-opening'));}
};
window.signOutAccount=async()=>{
  const button=document.getElementById('account-sign-out');button.disabled=true;
  try{await signOut(auth);}
  catch(e){document.getElementById('account-error').textContent=tr("Could not sign out. Please try again.");}
  finally{button.disabled=false;}
};
const loginIntroReady=new Promise(resolve=>setTimeout(resolve,1950));
function setAccountOpening(opening){
  document.querySelector('.login-actions').classList.toggle('account-opening',opening);
  setSignInDisabled(opening||signInPending);
}
async function openAccount(user){
  const generation=++accountGeneration;
  accountReady=false;resetAccountState();state.user=user;
  document.body.classList.add('signed-out');
  const loginScreen=document.getElementById('login-screen');
  loginScreen.classList.remove('account-loaded');
  loginScreen.hidden=false;
  document.getElementById('login-retry').hidden=true;
  document.getElementById('login-error').textContent='';
  setAccountOpening(!!user);
  if(!user)return;
  try{
    await ensureAccountProtection();
    if(generation!==accountGeneration)return;
    const profile=await initializeAccount(user);
    if(generation!==accountGeneration)return;
    const [preferences,bodyProfile]=await Promise.all([fbGet(accountRef('settings','preferences')),fbGet(accountRef('settings','bodyProfile'))]);
    if(generation!==accountGeneration)return;
    // Existing accounts retain English until they choose a language. New accounts
    // are prompted until a valid choice has been saved, including after retries.
    state.nutritionDisplay=preferences?.nutritionDisplay==='intake'?'intake':'remaining';
    state.bodyProfile=bodyProfile||{};renderPersonalDetails();
    state.isTester=user.uid===TESTER_UID&&profile.accountType==='tester';
    state.testerNewUser=state.isTester&&preferences?.testerNewUser===true;
    languageSetupPending=state.testerNewUser||!!profile.languageSetupPending&&preferences?.onboardingComplete!==true;
    updateLanguageUI(validLanguage(preferences?.language)?preferences.language:'en');
    await loadFromFirebase();
    if(generation!==accountGeneration)return;
    let admin=null;
    try{admin=await fbGet(doc(db,'access','admin'));}catch(error){if(error.code!=='permission-denied')throw error;}
    if(generation!==accountGeneration)return;
    state.isAdmin=!!(user.emailVerified&&admin?.email===user.email);
    document.getElementById('account-name').textContent=user.displayName||tr("Personal account");
    document.getElementById('account-email').textContent=user.email||'';
    document.getElementById('account-role').textContent=state.isAdmin?tr("Admin"):tr("Personal account");
    document.getElementById('account-initial').textContent=(user.displayName||user.email||'C').slice(0,1).toUpperCase();
    renderAccountLabels();
    document.getElementById('account-error').textContent='';
    await loginIntroReady;
    if(generation!==accountGeneration)return;
    accountReady=true;renderHome();renderFoodLists();
    document.body.classList.remove('signed-out');
    window.switchPage('home',document.querySelector('[data-page="home"]'));
    // Keep the login overlay above the ready homepage until its fade finishes.
    loginScreen.getBoundingClientRect?.();
    loginScreen.classList.add('account-loaded');
    await new Promise(resolve=>setTimeout(resolve,600));
    if(generation!==accountGeneration)return;
    loginScreen.hidden=true;
    if(languageSetupPending){
      showOnboardingStep(0);
      for(const id of ['setup-gender','setup-weight','setup-height','setup-age','setup-birthday','setup-activity'])document.getElementById(id).value='';
      document.querySelectorAll('input[name="setup-goal"], input[name="setup-activity-choice"], input[name="setup-gender-choice"]').forEach(input=>input.checked=false);
      document.getElementById('first-language').value=getLanguage();
      document.getElementById('language-choice-error').textContent='';
      window.openModal('modal-language');
    }
  }catch(error){
    if(generation!==accountGeneration)return;
    resetAccountState();setAccountOpening(false);
    document.getElementById('login-error').textContent=authMessage(error);
    document.getElementById('login-retry').hidden=false;
  }
}
window.retryAccount=()=>openAccount(auth.currentUser);
onAuthStateChanged(auth,openAccount,()=>{
  document.getElementById('login-error').textContent=tr("Could not check sign-in. Reload CalCal to try again.");
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
