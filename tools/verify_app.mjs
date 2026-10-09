import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const elements = new Map();
const element = () => ({
  style: {}, value: '', innerHTML: '', textContent: '', title: '',
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, appendChild() {}, querySelector() { return element(); },
});
const document = {
  getElementById(id) { if(id === 'sync-dot') return null; if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  querySelectorAll() { return []; }, querySelector() { return element(); },
  createElement: element, documentElement: element(), body: element(),
};
const window = { visualViewport: { height: 800, addEventListener() {} }, addEventListener() {} };
const saved = [];
const alerts = [];
let failNextWrite = false;
let authObserver;
let stoppedListeners=0;
const testAuth={currentUser:null};
const testUser={uid:'account-a',email:'owner@example.com',displayName:'Test Owner'};
const reads=[];
let blockedRead=null;
let releaseBlockedRead;
const data = {
  'users/account-a':{createdAt:1},
  'users/account-a/settings/foodLists': { lists: [{ id: 'excel-main', name: 'Main' }, { id: 'excel-side', name: 'Side' }] },
  'users/account-a/settings/foods': { foods: [
    { id: 'excel-main-2', listId: 'excel-main', name: '白飯（100g）', cal: 130, carbs: 28, protein: null, fat: null, sourceRow: 2 },
    { id: 'excel-side-2', listId: 'excel-side', name: 'Side food', cal: 115, carbs: 0, protein: 20, fat: null },
    { id: 'excel-main-3', listId: 'excel-main', name: 'Test zero', cal: 0, carbs: 0, protein: 0, fat: 0 },
  ] },
};
const context = vm.createContext(Object.assign(window, { document, window, console, setTimeout, Date, alert: message => alerts.push(message), confirm: () => true }));
const firebase = new vm.SyntheticModule(['db','doc','getDoc','setDoc','onSnapshot','writeBatch','collection','getDocs','auth','GoogleAuthProvider','signInWithPopup','onAuthStateChanged','signOut'], function () {
  this.setExport('auth',testAuth);
  this.setExport('GoogleAuthProvider',class {setCustomParameters(parameters){assert.equal(parameters.prompt,'select_account');}});
  this.setExport('signInWithPopup',async()=>{testAuth.currentUser=testUser;await authObserver(testUser);});
  this.setExport('onAuthStateChanged',(_auth,callback)=>{authObserver=callback;});
  this.setExport('signOut',async()=>{testAuth.currentUser=null;await authObserver(null);});
  this.setExport('collection',(_db,...parts)=>parts.join('/'));
  this.setExport('getDocs',async path=>{const entries=Object.entries(data).filter(([key])=>key.startsWith(path+'/'));return {size:entries.length,forEach(callback){entries.forEach(([key,value])=>callback({id:key.split('/').at(-1),data:()=>structuredClone(value)}));}};});
  this.setExport('db', {});
  this.setExport('doc', (_db, ...parts) => parts.join('/'));
  this.setExport('getDoc', async path => {reads.push(path);if(path===blockedRead)await new Promise(resolve=>releaseBlockedRead=resolve);return { exists: () => path in data, data: () => structuredClone(data[path]) };});
  this.setExport('setDoc', async (path, fields, options) => {
    if (failNextWrite) { failNextWrite = false; throw new Error('Simulated save failure'); }
    data[path] = options?.merge ? {...data[path],...structuredClone(fields)} : structuredClone(fields);
    saved.push({path, fields: structuredClone(fields)});
  });
  this.setExport('onSnapshot', () => ()=>stoppedListeners++);
  this.setExport('writeBatch', () => {
    const writes=[];
    return {set:(path,fields)=>writes.push({path,fields}),commit:async()=>{
      if(failNextWrite){failNextWrite=false;throw new Error('Batch failure');}
      for(const {path,fields} of writes){data[path]=structuredClone(fields);saved.push({path,fields:structuredClone(fields)});}
    }};
  });
}, {context});
const nutrition = new vm.SourceTextModule(await fs.readFile(new URL('../js/nutrition.js',import.meta.url), 'utf8'), {context});
const app = new vm.SourceTextModule((await fs.readFile(new URL('../js/app.js',import.meta.url), 'utf8')) + '\nexport { state, loadFromFirebase, renderHome, TODAY };', {context});
await app.link(specifier => specifier.startsWith('./firebase.js') ? firebase : nutrition);
await app.evaluate();
await new Promise(resolve => setImmediate(resolve));
assert.equal(reads.length,0,'Signed-out startup must not read account records');
await authObserver(null);
assert.equal(reads.length,0);
await window.signInGoogle();
const state = app.namespace.state;
assert.equal(state.foods.length, 3);
assert.equal(state.activeListId, 'excel-main');
assert.match(document.getElementById('food-grid').innerHTML, /白飯（100g）/);
assert.doesNotMatch(document.getElementById('food-grid').innerHTML, /—/);
assert.match(document.getElementById('food-grid').innerHTML.replace(/<[^>]*>/g,''), /0\s*g/);
window._openServe('excel-main-2');
assert.match(document.getElementById('serve-preview').innerHTML, /—/);
document.getElementById('serve-qty').value = '2';
await window.confirmServe();
const log = saved.at(-1).fields.logs.at(-1);
assert.equal(log.cal, 260);
assert.equal(log.carbs, 56);
assert.equal(log.protein, null);
assert.equal(log.fat, null);
assert.match(document.getElementById('log-list').innerHTML, /—g/);
assert.equal(document.getElementById('lbl-protein').innerHTML, '<strong>150</strong>g left');
assert.equal(document.getElementById('lbl-carbs').innerHTML, '<strong>194</strong>g left');
assert.equal(saved.at(-1).path.startsWith('users/account-a/days/'), true);

// Rename categories without breaking their food relationships, including punctuation.
document.getElementById('list-name-excel-main').value = 'Main & "Rice"';
await window._renameList('excel-main');
assert.equal(state.foodLists[0].id, 'excel-main');
assert.equal(state.foodLists[0].name, 'Main & "Rice"');
assert.equal(state.foods[0].listId, 'excel-main');
assert.equal(document.getElementById('current-category-name').textContent, 'Main & "Rice"');

// Edit in place, preserving unknown nutrients, source details and existing diary entries.
window._editFood('excel-main-2');
assert.equal(document.getElementById('f-protein').value, '');
document.getElementById('f-name').value = 'Rice <special>';
document.getElementById('f-list').value = 'excel-main';
document.getElementById('f-ingredients').value = 'Rice & sauce';
document.getElementById('f-portion').value = '  1 bowl <large>  ';
document.getElementById('f-cal').value = '150';
document.getElementById('f-carbs').value = '30.5';
document.getElementById('f-protein').value = '';
document.getElementById('f-fat').value = '0';
await window.saveFood();
const edited = state.foods.find(food => food.id === 'excel-main-2');
assert.equal(state.foods.length, 3);
assert.equal(edited.sourceRow, 2);
assert.equal(edited.cal, 150);
assert.equal(edited.carbs, 30.5);
assert.equal(edited.protein, null);
assert.equal(edited.fat, 0);
assert.equal(edited.ingredients, 'Rice & sauce');
assert.equal(edited.portion, '1 bowl <large>');
assert.match(document.getElementById('food-grid').innerHTML, /food-portion">1 bowl &lt;large&gt;/);
assert.match(document.getElementById('food-grid').innerHTML, /Rice &lt;special&gt;/);
assert.equal(log.name, '白飯（100g）');
assert.equal(log.cal, 260);

// Move only within the category despite interleaved foods from other categories.
await window._moveFood('excel-main-2', 1);
assert.equal(state.foods[0].id, 'excel-main-3');
assert.equal(state.foods[1].id, 'excel-side-2');
assert.equal(state.foods[2].id, 'excel-main-2');
const beforeBoundary = saved.length;
await window._moveFood('excel-main-2', 1);
assert.equal(saved.length, beforeBoundary);
await app.namespace.loadFromFirebase();
assert.equal(state.foods[0].id, 'excel-main-3');
assert.equal(state.foods[2].name, 'Rice <special>');
assert.equal(state.foodLists[0].name, 'Main & "Rice"');

// Reject invalid values and roll back failed writes without losing foods or category names.
window._editFood('excel-main-2');
assert.equal(document.getElementById('f-portion').value, '1 bowl <large>');
document.getElementById('f-list').value = 'excel-main';
document.getElementById('f-cal').value = '-1';
const beforeInvalid = saved.length;
await window.saveFood();
assert.equal(saved.length, beforeInvalid);
assert.equal(state.foods[2].cal, 150);
failNextWrite = true;
await window._moveFood('excel-main-2', -1);
assert.equal(state.foods[2].id, 'excel-main-2');
assert.equal(state._savingFoods, false);
document.getElementById('list-name-excel-main').value = 'Failed rename';
failNextWrite = true;
await window._renameList('excel-main');
assert.equal(state.foodLists[0].name, 'Main & "Rice"');
assert.equal(state._savingLists, false);
assert.ok(alerts.length >= 3);
console.log('App integration passed: category rename, editing without duplicates, ingredients, zero/unknown nutrition, metadata preservation, category ordering across reload, invalid input, failure rollback, and diary compatibility. No live data was written.');
// Exercise the pointer handlers with a minimal event-driven DOM, without live writes.
const listeners = new Map();
document.addEventListener = (type, fn) => listeners.set(type, fn);
document.removeEventListener = type => listeners.delete(type);
context.requestAnimationFrame = () => 1;
context.cancelAnimationFrame = () => {};
const classes = () => ({add(){},remove(){}});
const rows = [0,1].map(i => ({isConnected:true,classList:classes(),getBoundingClientRect:()=>({top:i*100,height:100})}));
const grid = {querySelectorAll:()=>rows,closest:()=>null};
rows.forEach(row=>row.parentElement=grid);
const handlers = new Map();
const handle = {closest:()=>rows[0],setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){},addEventListener:(t,f)=>handlers.set(t,f),removeEventListener:t=>handlers.delete(t)};
const start = () => window._startFoodDrag({button:0,isPrimary:true,pointerId:1,clientY:50,currentTarget:handle,stopPropagation(){}},state.foods[0].id);
let count=saved.length;
start(); handlers.get('pointermove')({pointerId:1,clientY:190}); handlers.get('pointercancel')({pointerId:1,type:'pointercancel'});
assert.equal(saved.length,count); assert.equal(handlers.size,0);
start(); handlers.get('pointerup')({pointerId:1,type:'pointerup'});
assert.equal(saved.length,count);
const movedId=state.foods[0].id;
start(); handlers.get('pointermove')({pointerId:1,clientY:190}); handlers.get('pointerup')({pointerId:1,type:'pointerup'});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(saved.length,count+1); assert.equal(state.foods[2].id,movedId);
await app.namespace.loadFromFirebase(); assert.equal(state.foods[2].id,movedId);
state.foods.push({id:'third',listId:'excel-main',name:'Third'});
await window._reorderFood('third',0);
assert.equal(state.foods[0].id,'third'); assert.equal(state.foods[1].id,'excel-side-2');
const markup=document.getElementById('food-grid').innerHTML;
assert.ok(markup.indexOf('aria-label="Edit')<markup.indexOf('aria-label="Delete'));
assert.ok(markup.indexOf('aria-label="Delete')<markup.indexOf('aria-label="Reorder'));
assert.doesNotMatch(markup,/food-actions|↑ 上移|↓ 下移/);
console.log('Drag checks passed: cancellation, click without movement, one save on drop, reload persistence, multi-position reorder, and icon order.');
// Full date and immediate water reset preserve the day's other records.
const now=new Date();
assert.equal(document.getElementById('home-ddmm').textContent,`${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`);
const day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
state.water[day]=1500;
const previousLogs=JSON.stringify(state.logs[day]);
window.confirm=()=>{throw new Error('Reset must not ask for confirmation');};
await window.resetWater();
assert.equal(state.water[day],0);
assert.equal(data['users/account-a/days/'+day].water,0);
assert.equal(JSON.stringify(state.logs[day]),previousLogs);
assert.equal(document.getElementById('water-consumed-big').textContent,0);
console.log('Full date and immediate water reset checks passed.');

// Exercise goals and both water entry paths, then read persisted values back.
for(const [id,value] of Object.entries({'g-cal':'2300','g-protein':'160','g-carbs':'240','g-fat':'70','g-water-ml':'3000','g-supps':'Vitamin D'}))document.getElementById(id).value=value;
await window.saveGoals();
assert.equal(data['users/account-a/settings/goals'].cal,2300);
assert.equal(document.getElementById('ring-goal-lbl').textContent,'kcal left');
await window.addWaterQuick(500);
document.getElementById('water-input').value='250';
await window.addWater();
assert.equal(data['users/account-a/days/'+day].water,750);
assert.equal(document.getElementById('water-consumed-big').textContent,750);
await app.namespace.loadFromFirebase();
assert.equal(state.goals.cal,2300);
assert.equal(state.water[day],750);
assert.equal(JSON.stringify(state.logs[day]),previousLogs);
console.log('Goals, meal persistence, and water saving/reloading checks passed.');

// Remaining displays and bars count down, and excess is clearly labeled.
state.logs[day]=[{cal:2400,protein:170,carbs:250,fat:80}];
await window.addWaterQuick(1);
assert.equal(document.getElementById('ring-consumed-big').textContent,100);
assert.equal(document.getElementById('ring-goal-lbl').textContent,'kcal over');
assert.equal(document.getElementById('lbl-protein').innerHTML,'<strong>10</strong>g over');
assert.equal(document.getElementById('lbl-carbs').innerHTML,'<strong>10</strong>g over');
assert.equal(document.getElementById('lbl-fat').innerHTML,'<strong>10</strong>g over');
assert.equal(document.getElementById('bar-fat').style.width,'0%');
state.logs[day]=[];
await window.addWaterQuick(1);
assert.equal(document.getElementById('ring-consumed-big').textContent,2300);
assert.equal(document.getElementById('lbl-protein').innerHTML,'<strong>160</strong>g left');
assert.equal(document.getElementById('bar-protein').style.width,'100%');
console.log('Remaining amounts, empty diary, unknown nutrients and over-goal checks passed.');

// Category selector preserves relationships and saves ordering with rollback.
window.openManageListsModal();
assert.match(document.getElementById('manage-lists-items').innerHTML,/Edit category/);
assert.match(document.getElementById('manage-lists-items').innerHTML,/Delete category/);
assert.match(document.getElementById('manage-lists-items').innerHTML,/Reorder category/);
const categoryFoodIds=state.foods.map(f=>f.id).join(',');
await window._reorderCategory('excel-side',0);
assert.equal(state.foodLists[0].id,'excel-side');
assert.equal(state.foods.map(f=>f.id).join(','),categoryFoodIds);
await app.namespace.loadFromFirebase();assert.equal(state.foodLists[0].id,'excel-side');
failNextWrite=true;await window._reorderCategory('excel-side',1);
assert.equal(state.foodLists[0].id,'excel-side');assert.equal(state._savingLists,false);
window._chooseCategory('excel-side');
assert.equal(state.activeListId,'excel-side');
assert.equal(document.getElementById('current-category-name').textContent,'Side');
count=saved.length;
window._startCategoryDrag({button:0,isPrimary:true,pointerId:1,clientY:50,currentTarget:handle,stopPropagation(){}},'excel-side');
handlers.get('pointermove')({pointerId:1,clientY:190});handlers.get('pointercancel')({pointerId:1,type:'pointercancel'});
assert.equal(saved.length,count);
window._startCategoryDrag({button:0,isPrimary:true,pointerId:1,clientY:50,currentTarget:handle,stopPropagation(){}},'excel-side');
handlers.get('pointermove')({pointerId:1,clientY:190});handlers.get('pointerup')({pointerId:1,type:'pointerup'});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(saved.length,count+1);assert.equal(state.foodLists[1].id,'excel-side');
console.log('Category selector checks passed: selection, ordering/reload, failure rollback, pointer drop and cancellation, preserving food relationships.');

window.confirm=()=>true;
failNextWrite=true;await window._deleteList('excel-side');
assert.equal(state.foodLists.some(l=>l.id==='excel-side'),true);
assert.equal(state.foods.some(f=>f.listId==='excel-side'),true);
await window._deleteList('excel-side');
assert.equal(state.foodLists.some(l=>l.id==='excel-side'),false);
assert.equal(state.foods.some(f=>f.listId==='excel-side'),false);
assert.equal(state.activeListId,'excel-main');
await app.namespace.loadFromFirebase();
assert.equal(state.foodLists.some(l=>l.id==='excel-side'),false);
console.log('Category deletion checks passed: atomic save failure, active selection fallback, food removal and persistence.');

// Weight history uses an independent document and merges individual dates.
assert.match(document.getElementById('weight-chart').innerHTML,/first weight/);
window.openWeightModal();
assert.equal(document.getElementById('weight-date').value,day);
document.getElementById('weight-date').value='2026-01-01';
document.getElementById('weight-value').value='70.5';
await window.saveWeight();
assert.equal(data['users/account-a/settings/weights']['2026-01-01'],70.5);
assert.match(document.getElementById('weight-chart').innerHTML,/70.5 kg/);
document.getElementById('weight-date').value='2026-01-03';
document.getElementById('weight-value').value='70.2';
await window.saveWeight();
assert.equal(Object.keys(data['users/account-a/settings/weights']).length,2);
assert.match(document.getElementById('weight-chart').innerHTML,/03\/01\/2026/);
document.getElementById('weight-value').value='70.1';
await window.saveWeight();assert.equal(Object.keys(data['users/account-a/settings/weights']).length,2);
await app.namespace.loadFromFirebase();assert.equal(state.weights['2026-01-03'],70.1);
const beforeWeight=JSON.stringify(state.weights),beforeWeightWrites=saved.length;
document.getElementById('weight-value').value='0';await window.saveWeight();
assert.equal(saved.length,beforeWeightWrites);
document.getElementById('weight-date').value='2026-02-30';document.getElementById('weight-value').value='71';await window.saveWeight();
assert.equal(saved.length,beforeWeightWrites);
document.getElementById('weight-date').value='2026-01-03';failNextWrite=true;await window.saveWeight();
assert.equal(JSON.stringify(state.weights),beforeWeight);assert.equal(state._savingWeight,false);
assert.match(document.getElementById('weight-error').textContent,/Could not save/);
console.log('Weight checks passed: empty chart, dated save, history merge, same-date update, reload, invalid input and failure recovery.');

assert.equal(nutrition.namespace.formatNutrient(30.5),'31');
assert.equal(nutrition.namespace.formatNutrient(30.4),'30');
assert.equal(nutrition.namespace.formatNutrient(null),'—');
window._setList('excel-main');
assert.doesNotMatch(document.getElementById('food-grid').innerHTML,/\d+\.\d+|—/);
assert.match(document.getElementById('food-grid').innerHTML,/0<span class="food-nutrient-unit"> g/);
console.log('Nutrition display checks passed: whole numbers, unknown food-list values as zero, preserved precision and unknown storage.');

// A half-calorie total previously displayed 926 consumed but 1275 left.
const regressionDate=app.namespace.TODAY();
state.goals={...state.goals,cal:2200,protein:190,carbs:190,fat:75};
state.logs[regressionDate]=[
  {name:'Known nutrition',cal:925.5,protein:23.5,carbs:109.5,fat:30.5},
  {name:'Unknown nutrition',cal:null,protein:null,carbs:null,fat:null},
];
const regressionLogs=JSON.stringify(state.logs[regressionDate]);
app.namespace.renderHome();
assert.match(document.getElementById('log-total-badge').innerHTML,/>926 kcal<\/span>/);
assert.equal(document.getElementById('ring-consumed-big').textContent,1274);
assert.equal(document.getElementById('ring-goal-lbl').textContent,'kcal left');
assert.equal(document.getElementById('lbl-protein').innerHTML,'<strong>166</strong>g left');
assert.equal(document.getElementById('lbl-carbs').innerHTML,'<strong>80</strong>g left');
assert.equal(document.getElementById('lbl-fat').innerHTML,'<strong>44</strong>g left');
assert.equal(JSON.stringify(state.logs[regressionDate]),regressionLogs);
state.logs[regressionDate][0].cal=2200.5;
app.namespace.renderHome();
assert.equal(document.getElementById('ring-consumed-big').textContent,1);
assert.equal(document.getElementById('ring-goal-lbl').textContent,'kcal over');
console.log('Daily nutrition regression checks passed: rounding agrees with diary, unknown values add zero without Estimated, and over-goal labels remain correct.');

// Account lifecycle: signed-out state, fresh account setup, isolation and remembered records.
const originalAccount=structuredClone(data);
await window.signOutAccount();
assert.equal(state.user,null);
assert.equal(state.foods.length,0);
assert.equal(Object.keys(state.logs).length,0);
assert.equal(Object.keys(state.weights).length,0);
assert.ok(stoppedListeners>0);
await assert.rejects(window.addWaterQuick(500),/sign in again/);
data['catalog/foods']={foods:[{id:'starter',listId:'default',name:'Starter food',cal:100}]};
data['catalog/foodLists']={lists:[{id:'default',name:'Default'}]};
const secondUser={uid:'account-b',email:'second@example.com',displayName:'Second account'};
testAuth.currentUser=secondUser;
await authObserver(secondUser);
assert.equal(state.foods[0].name,'Starter food');
assert.equal(state.goals.cal,2000);
assert.equal(Object.keys(state.logs).length,0);
assert.equal(Object.keys(state.weights).length,0);
await window.addWaterQuick(500);
assert.equal(data['users/account-b/days/'+day].water,500);
assert.deepEqual(data['users/account-a/days/'+day],originalAccount['users/account-a/days/'+day]);
testAuth.currentUser=testUser;await authObserver(testUser);
assert.equal(state.water[day],originalAccount['users/account-a/days/'+day].water);

// Switching while a previous account read is pending must discard the stale load.
blockedRead='users/account-a/settings/foods';
const slowLoad=app.namespace.loadFromFirebase();
await new Promise(resolve=>setImmediate(resolve));
testAuth.currentUser=secondUser;await authObserver(secondUser);
releaseBlockedRead();blockedRead=null;await slowLoad;
assert.equal(state.user.uid,'account-b');
assert.equal(state.foods[0].id,'starter');
assert.equal(state.water[day],500);

// The owner's first login imports legacy records once; later logins never overwrite them.
data['migration/legacy']={available:true};
data['CalCal/goals']={cal:2200,protein:190,carbs:190,fat:75,waterMl:4000,supps:[]};
data['CalCal/foods']={foods:[{id:'legacy',listId:'legacy-list',name:'Legacy food',cal:123}]};
data['CalCal/foodLists']={lists:[{id:'legacy-list',name:'Legacy'}]};
data['CalCal/weights']={'2026-10-01':97.5};
data['days/'+day]={water:1500,logs:[{name:'Legacy meal',cal:123}],supps:['Creatine']};
const ownerUser={uid:'original-owner',email:'owner@example.com',displayName:'Original Owner'};
testAuth.currentUser=ownerUser;await authObserver(ownerUser);
assert.equal(state.goals.cal,2200);
assert.equal(state.water[day],1500);
assert.equal(state.weights['2026-10-01'],97.5);
assert.equal(state.logs[day][0].name,'Legacy meal');
assert.equal(data['users/original-owner'].legacyImported,true);
await window.addWaterQuick(500);
await window.signOutAccount();testAuth.currentUser=ownerUser;await authObserver(ownerUser);
assert.equal(state.water[day],2000);
assert.equal(data['days/'+day].water,1500);

// Failed first setup leaves no partial profile and is recoverable via the retry screen.
const failingUser={uid:'retry-user',email:'retry@example.com'};
testAuth.currentUser=failingUser;failNextWrite=true;await authObserver(failingUser);
assert.equal('users/retry-user' in data,false);
assert.equal(document.getElementById('login-retry').hidden,false);
await window.retryAccount();
assert.equal('users/retry-user' in data,true);
assert.equal(document.getElementById('login-screen').hidden,true);
console.log('Account checks passed: no signed-out reads, UID-specific writes, sign-out cleanup, fresh-account defaults, account switching, stale-read isolation, one-time owner import, atomic setup failure and retry. No live data was written.');
