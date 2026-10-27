import {createRepRangeSelector} from './rep-range-selector.js?v=1.2.10';
import {copy,uid,newSet,exerciseInstance,positions,locate,createSession,nextPosition,startSession,completeSet,advanceRest,extendRest,selectSet,validateWorkout,optionalNumber,targetReps,trackerRepDefault} from './workout-model.js?v=1.2.10';
import {defaultExercises} from './workout-catalog.js?v=1.2.10';
import {setupCompactReorder} from './compact-reorder.js?v=1.2.10';
import {mountRestWheel} from './workout-rest-wheel.js?v=1.2.10';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=seconds=>{seconds=Math.max(0,Math.floor(seconds));return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
export function createWorkoutFeature({root,tracker,getUid,store,tr,locale=()=> 'en-GB'}){
  let owner=null,epoch=0,loaded=false,loading=false,busy=false,visible=false,view='library',templates=[],catalog=[],bests={},session=null,draft=null,history=[],error='',timer=null,dirty=false,lastSaved=0,revision=0,pendingCreate=false;
  let expanded=new Set(),pickerOpen=false,lastCurrent=null,lastView='library',transitioning=false;
  let editTail=Promise.resolve(),editFailure=null,newWorkoutId=null;
  const workoutName=workout=>workout.name?.trim()||tr('Unnamed workout');
  const path=(...parts)=>['users',owner,...parts];
  async function commit(writes){const generation=epoch;await store.commit(writes);if(generation!==epoch)throw Error('Account changed.');}
  const categoryText=value=>value==='Back'?(tr('Back muscles')==='Back muscles'?'Back':tr('Back muscles')):tr(value);
  const button=(action,label,extra='')=>`<button type="button" class="btn btn-secondary btn-sm" data-action="${action}" ${extra}>${escape(tr(label))}</button>`;
  const number=(value,field,extra='')=>`<input type="number" inputmode="decimal" min="0" step="${(field==='reps'||field==='current-reps')?'1':'any'}" data-field="${field}" value="${value??''}" ${extra}>`;
  const currentWorkout=()=>view==='editor'?draft:session?.workout;
  function saveEditSnapshot(job){
    if(job.generation!==epoch)return Promise.resolve();
    return (async()=>{
      const writes=[],emptyNew=job.newWorkout&&!job.workout.name.trim()&&!job.workout.exercises.length;
      if(job.template){validateWorkout(job.workout,{allowDraft:true});job.workout.updatedAt=Date.now();if(emptyNew){if(templates.some(item=>item.id===job.workout.id))writes.push({path:['users',job.owner,'workoutTemplates',job.workout.id],remove:true});}else writes.push({path:['users',job.owner,'workoutTemplates',job.workout.id],value:job.workout});}
      if(job.session)validateWorkout(job.session.workout,{allowDraft:true});
      if(job.session)writes.push({path:['users',job.owner,'settings','workoutActive'],value:{session:job.session,updatedAt:Date.now()}});
      if(writes.length)await store.commit(writes);
      if(job.generation!==epoch)return;
      if(job.template){if(emptyNew)templates=templates.filter(item=>item.id!==job.workout.id);else{const index=templates.findIndex(item=>item.id===job.workout.id);if(index<0)templates.push(copy(job.workout));else templates[index]=copy(job.workout);}}
      dirty=revision!==job.revision;lastSaved=Date.now();
      if(!editFailure||editFailure.revision<=job.revision){editFailure=null;error='';root.querySelector('.workout-error')?.remove?.();tracker.querySelector('.workout-error')?.remove?.();root.querySelector('[data-action="retry-edits"]')?.remove?.();}
    })().catch(err=>{if(job.generation===epoch){editFailure=job;error=tr('Could not save workout. Try again.');render();}});
  }
  function saveEdit(template=true){
    const workout=currentWorkout();if(!workout||!getUid()||owner!==getUid())return;
    dirty=true;revision++;
    const job={generation:epoch,owner,revision,template,newWorkout:workout.id===newWorkoutId,workout:copy(workout),session:view==='session'&&session?.startedAt?copy(session):null};
    editTail=editTail.then(()=>saveEditSnapshot(job));return editTail;
  }
  async function flushEdits(){let pending;do{pending=editTail;await pending;}while(pending!==editTail);return !editFailure;}
  function reset(){editTail=Promise.resolve();editFailure=null;newWorkoutId=null;repsPicker?.close();reorder?.cancel();root.getAnimations?.().forEach(animation=>animation.cancel());transitioning=false;expanded.clear();pickerOpen=false;lastCurrent=null;lastView='library';root.closest('.page')?.classList?.remove?.('workout-detail');epoch++;if(timer)clearInterval(timer);timer=null;owner=null;loaded=false;loading=false;busy=false;visible=false;view='library';pendingCreate=false;templates=[];catalog=[];bests={};session=null;draft=null;history=[];error='';dirty=false;root.innerHTML='';tracker.innerHTML='';tracker.hidden=true;}
  async function open(){
    if(!getUid())return;
    visible=true;
    if(loaded&&owner===getUid()){render();return;}
    if(loading)return;
    owner=getUid();loading=true;error='';render();const generation=epoch;
    try{
      const [list,custom,records,active,logs]=await Promise.all([store.list(path('workoutTemplates')),store.read(path('settings','workoutCatalog')),store.list(path('workoutBests')),store.read(path('settings','workoutActive')),store.list(path('workoutSessions'))]);
      if(generation!==epoch)return;
      templates=list.filter(item=>!item.archived);catalog=custom?.exercises||copy(defaultExercises);bests=Object.fromEntries(records.map(item=>[item.id,item]));session=active?.session?.startedAt?active.session:null;history=logs.sort((a,b)=>b.endedAt-a.endedAt);
      if(!custom)await commit([{path:path('settings','workoutCatalog'),value:{exercises:catalog}}]);
      if(generation!==epoch)return;
      loaded=true;view=session?'session':'library';lastSaved=Date.now();timer=setInterval(tick,1000);
    }catch(err){if(generation===epoch)error=tr('Could not load workouts. Try again.');}
    finally{if(generation===epoch){loading=false;if(loaded&&pendingCreate){pendingCreate=false;create();}else render();}}
  }
  function refresh(){if(loaded)render();}
  function disable(disabled){for(const host of [root,tracker])host.querySelectorAll('button,input,select').forEach(el=>el.disabled=disabled||el.dataset?.workoutLocked==='true');}
  async function perform(work,quiet=false){
    if(!await flushEdits())return;
    if(busy||!getUid()||owner!==getUid())return;
    const generation=epoch,version=revision,snapshot=copy({templates,catalog,bests,session,draft,view,history});busy=true;error='';if(!quiet)disable(true);
    try{await work();if(generation!==epoch)return;dirty=revision!==version;lastSaved=Date.now();}
    catch(err){if(generation===epoch){if(!quiet)({templates,catalog,bests,session,draft,view,history}=snapshot);error=err.code?tr('Could not save workout. Try again.'):tr(err.message)||tr('Could not save workout. Try again.');}}
    finally{if(generation===epoch){busy=false;if(!quiet||error)render();}}
  }
  function sessionWrite(){return {path:path('settings','workoutActive'),value:{session,updatedAt:Date.now()}};}
  async function saveSession(templateToo=false){
    const writes=session?.startedAt?[sessionWrite()]:[];
    if(templateToo){
      validateWorkout(session.workout);session.workout.updatedAt=Date.now();
      writes.push({path:path('workoutTemplates',session.templateId),value:session.workout});
      for(const result of Object.values(session.results))if(result.weight!==null&&result.reps!==null){
        const best=bests[result.exerciseId]||{byWeight:{}};best.byWeight??={};
        best.bestWeight=Math.max(best.bestWeight??0,result.weight);best.byWeight[String(result.weight)]=Math.max(best.byWeight[String(result.weight)]??0,result.reps);bests[result.exerciseId]=best;
      }
      for(const id of new Set(Object.values(session.results).map(result=>result.exerciseId))){const best=bests[id];writes.push({path:path('workoutBests',id),value:best});}
    }
    if(writes.length)await commit(writes);
    if(templateToo)templates=templates.map(item=>item.id===session.templateId?copy(session.workout):item);
  }
  async function navigate(next,prepare=()=>{}){
    if(transitioning)return;transitioning=true;const generation=epoch;
    if(root.animate)await root.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}).finished.catch(()=>{});
    if(generation!==epoch){transitioning=false;return;}
    prepare();view=next;expanded.clear();pickerOpen=false;lastCurrent=null;render();
    root.getAnimations?.().forEach(animation=>animation.cancel());
    root.animate?.([{opacity:0},{opacity:1}],{duration:220});transitioning=false;
    const page=root.closest('.page');if(page)page.scrollTop=0;
  }
  function averageTime(workout){const logs=history.filter(log=>log.templateId===workout.id&&log.status==='finished'&&Number.isFinite(log.elapsedSeconds)&&log.elapsedSeconds>=0);return logs.length?time(logs.reduce((sum,log)=>sum+log.elapsedSeconds,0)/logs.length):'';}
  function render(){
    root.closest('.page')?.classList?.toggle('workout-detail',view!=='library');
    if(view!==lastView){lastView=view;root.animate?.([{opacity:0},{opacity:1}],{duration:220});}
    if(session?.startedAt&&session.phase==='set'&&session.current?.exerciseId!==lastCurrent){lastCurrent=session.current?.exerciseId;if(lastCurrent)expanded.add(lastCurrent);}
    const oldScroll=root.closest('.page')?.scrollTop;
    if(loading){root.innerHTML=`<div class="empty" role="status">${escape(tr('Loading workouts…'))}</div>`;tracker.hidden=true;return;}
    if(!loaded){root.innerHTML=`<p role="alert">${escape(error)}</p>${button('reload','Try again')}`;tracker.hidden=true;return;}
    const alert=error?`<p class="workout-error" role="alert">${escape(error)}</p>${editFailure?button('retry-edits','Try again'):''}`:'';
    if(view==='library'){
      root.innerHTML=alert+(session?.startedAt?`<div class="card workout-resume"><strong>${escape(workoutName(session.workout))}</strong><button type="button" class="btn-icon workout-resume-icon" data-action="resume" aria-label="${escape(tr('Resume workout'))}" title="${escape(tr('Resume workout'))}"><img src="./assets/icons/resume.svg?v=1.2.10" width="24" height="24" alt=""></button></div>`:'')+(templates.length?templates.map(workout=>`<div class="card workout-card"><button type="button" class="workout-open" data-action="open" data-id="${escape(workout.id)}"><strong>${escape(workoutName(workout))}</strong><span>${workout.exercises.length} ${escape(tr('exercises'))}${averageTime(workout)?' · '+escape(tr('Average time'))+': '+averageTime(workout):''}</span></button></div>`).join(''):`<div class="empty">${escape(tr('No workouts yet. Tap + to create one.'))}</div>`);
    }else{
      const workout=currentWorkout(),running=view==='session';
      root.innerHTML=`<div class="workout-detail-header"><input id="workout-name" class="workout-name-input${workout.name.trim()?' named':''}" type="text" maxlength="100" data-field="name" value="${escape(workout.name)}" placeholder="${escape(tr('Workout Name'))}" aria-label="${escape(tr('Workout name'))}"><button type="button" class="btn-icon workout-quit" data-action="library" aria-label="${escape(tr('Back to workouts'))}"><img src="./assets/icons/quit.svg?v=1.2.10" width="24" height="28" alt=""></button></div>`+alert+`<div class="workout-exercise-list">${workout.exercises.map(ex=>exerciseCard(ex,running)).join('')}</div>`+picker();
      for(const input of root.querySelectorAll('[data-field="rest"]')){const viewport=input.parentElement.querySelector('.workout-rest-wheel');if(viewport)mountRestWheel(input,viewport);}
    }
    tracker.hidden=!visible||view!=='session'||!session;
    if(!tracker.hidden)renderTracker();else tracker.innerHTML='';
    root.classList.toggle('workout-has-tracker',!tracker.hidden);
    if(oldScroll!==undefined&&root.closest('.page'))root.closest('.page').scrollTop=oldScroll;
    disable(busy);
  }
  function exerciseCard(ex,running){
    const isOpen=expanded.has(ex.id),locked=!!(running&&session.startedAt&&session.current?.exerciseId===ex.id);
    return `<section class="card workout-exercise" data-reorder-id="${ex.id}"><div class="workout-exercise-heading"><button type="button" class="workout-exercise-name" data-action="toggle-exercise" data-id="${ex.id}" aria-expanded="${isOpen}">${escape(ex.name)}</button><button type="button" class="btn-icon workout-drag" aria-label="${escape(tr('Reorder'))} ${escape(ex.name)}">☰</button><button type="button" class="btn-icon" data-action="remove-exercise" data-id="${ex.id}" data-workout-locked="${locked}" ${locked?'disabled':''} title="${escape(tr(locked?'The current exercise cannot be deleted.':'Remove exercise'))}" aria-label="${escape(tr('Remove exercise'))}"><img src="./assets/icons/cross.svg?v=1.2.10" width="18" height="18" alt=""></button></div><div class="workout-exercise-body" ${isOpen?'':'hidden'}><div class="workout-exercise-options"><label class="workout-set-count"><input type="number" inputmode="decimal" min="1" max="50" step="1" data-field="count" data-ex="${ex.id}" value="${ex.sets.length}" aria-label="${escape(tr('Sets'))}"><span>${escape(tr('sets'))}</span></label><div class="workout-rest-setting"><span>${escape(tr('Rest'))}:</span><div class="workout-rest-control"><input hidden type="number" inputmode="decimal" min="0" max="3600" step="1" data-field="rest" data-ex="${ex.id}" value="${ex.restSeconds}" aria-label="${escape(tr('Rest (seconds)'))}"><div class="workout-rest-wheel" role="spinbutton" tabindex="0" aria-label="${escape(tr('Rest (seconds)'))}" aria-valuemin="0" aria-valuemax="3600"></div></div><span>s</span></div></div><div class="workout-set-head"><span>${escape(tr('Set'))}</span><span>${escape(tr('Target kg'))}</span><span>${escape(tr('Target reps'))}</span><span></span></div><div data-set-list="${ex.id}">${setRows(ex,running)}</div><button type="button" class="btn-icon workout-add-set" data-action="add-set" data-ex="${ex.id}" aria-label="${escape(tr('Add set'))}">+</button></div></section>`;
  }
  function setRows(ex,running){return ex.sets.map((set,index)=>{const result=running?session.results[set.id]:null,selected=running&&session.current?.setId===set.id;return `<div class="workout-set-row${selected?' current':''}${result?' completed':''}"><button type="button" data-action="jump" data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(tr('Select set'))} ${index+1}">${result?'✓':index+1}</button>${number(set.weight,'weight',`data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(ex.name+' '+tr('Set')+' '+(index+1)+' kg')}"`)}${targetRepInput(ex,set,index)}<button type="button" class="btn-icon" data-action="remove-set" data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(tr('Remove set'))} ${index+1}"><img src="./assets/icons/cross.svg?v=1.2.10" width="18" height="18" alt=""></button></div>`;}).join('');}
  function targetRepInput(ex,set,index){return `<input type="text" readonly inputmode="none" data-action="target-reps" data-field="reps" data-ex="${ex.id}" data-set="${set.id}" value="${escape(set.reps??'')}" aria-label="${escape(ex.name+' '+tr('Set')+' '+(index+1)+' '+tr('Target reps'))}" aria-haspopup="dialog">`;}
  function historyHTML(){
    if(!loaded)return '<div class="empty">'+escape(error||tr('Loading workouts…'))+'</div>';
    return history.length?history.map(log=>'<div class="card workout-history"><strong>'+escape(workoutName(log.workout))+'</strong><p>'+escape(new Date(log.endedAt).toLocaleString(locale()))+' · '+time(log.elapsedSeconds)+'</p>'+(log.status==='discarded'?'<small>'+escape(tr('Stopped early'))+'</small>':'')+historySets(log)+'</div>').join(''):'<div class="empty">'+escape(tr('No completed workouts yet.'))+'</div>';
  }
  function historySets(log){
    const groups=new Map();
    for(const result of Object.values(log.results)){if(!groups.has(result.exerciseId))groups.set(result.exerciseId,[]);groups.get(result.exerciseId).push(result);}
    return [...groups.values()].map(results=>'<div><b>'+escape(results[0].name)+'</b><p>'+results.map(result=>(result.weight??'—')+' kg × '+(result.reps??'—')).join(' · ')+'</p></div>').join('');
  }
  function picker(){
    const categories=[...new Set(catalog.map(ex=>ex.category))];
    return `<div class="card workout-picker"><button type="button" class="btn-icon workout-picker-toggle" data-action="toggle-picker" aria-label="${escape(tr('Add exercise'))}" aria-expanded="${pickerOpen}">${pickerOpen?'−':'+'}</button><div ${pickerOpen?'':'hidden'}><div class="workout-picker-toolbar"><div class="workout-category-select"><select id="workout-category" aria-label="${escape(tr('Category'))}"><option value="">${escape(tr('All categories'))}</option>${categories.map(c=>`<option value="${escape(c)}">${escape(categoryText(c))}</option>`).join('')}</select><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></div><input id="workout-search" type="search" placeholder="${escape(tr('Search exercises'))}" aria-label="${escape(tr('Search exercises'))}"></div><div id="workout-exercise-options">${catalogButtons(catalog)}</div><details><summary>${escape(tr('Custom exercise'))}</summary><label>${escape(tr('Exercise name'))}<input id="workout-custom-name" type="text" maxlength="100"></label><label>${escape(tr('Category'))}<select id="workout-custom-category">${categories.map(c=>`<option value="${escape(c)}">${escape(categoryText(c))}</option>`).join('')}</select></label>${button('custom','Add custom exercise')}</details></div></div>`;

  }
  function catalogButtons(items){return items.map(ex=>`<button type="button" data-action="add-exercise" data-id="${escape(ex.id)}">${escape(ex.name)} <small>${escape(categoryText(ex.category))}</small></button>`).join('')||`<p>${escape(tr('No exercises found.'))}</p>`;}
  function renderTracker(){
    const current=locate(session),ex=current?.exercise,set=current?.set;
    const elapsed=session.startedAt?time((Date.now()-session.startedAt)/1000):'00:00';
    let content='';
    if(session.phase==='ready')content=`<button type="button" class="workout-start" data-action="start"><img src="./assets/icons/play.svg" width="28" height="28" alt="">${escape(tr('Start workout'))}</button>`;
    else if(session.phase==='rest')content=`<div class="workout-rest"><div class="workout-rest-circle"><svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="38" class="rest-track"/><circle id="workout-rest-progress" cx="45" cy="45" r="38" class="rest-progress"/></svg><span id="workout-rest-time"></span></div><div><strong>${escape(tr('Rest'))}</strong><div class="workout-rest-actions">${button('rest30','+30 sec')}${button('rest60','+1 min')}${button('skip','Skip rest')}</div><small>${escape(tr('Next'))}: ${escape(ex?.name||'')} · ${escape(tr('Set'))} ${(current?.index??0)+1}</small></div></div>`;
    else if(session.phase==='complete')content=`<strong>${escape(tr('All sets completed'))}</strong>`;
    else if(current){
      const actual=session.results[set.id]||{weight:set.weight,reps:trackerRepDefault(set.reps)};
      const weight=session.pending?.setId===set.id?session.pending.weight:actual.weight,reps=session.pending?.setId===set.id?session.pending.reps:actual.reps;
      const best=bests[ex.exerciseId]||{byWeight:{}};
      content=`<div class="workout-current-title"><strong>${escape(ex.name)}</strong><span>${escape(tr('Set'))} ${current.index+1}/${ex.sets.length}</span></div>${typeof set.reps==='string'?`<small class="workout-current-target">${escape(tr('Target reps'))}: ${escape(set.reps.replace('-','–'))}</small>`:''}<div class="workout-current-inputs"><label>${escape(tr('Weight (kg)'))}${number(weight,'current-weight','id="workout-current-weight"')}</label><label>${escape(tr('Reps'))}${number(reps,'current-reps','id="workout-current-reps"')}</label><button type="button" class="workout-complete-set" data-action="complete" aria-label="${escape(tr('Complete set'))}"><img src="./assets/icons/tick.svg" width="28" height="28" alt=""></button></div><div class="workout-bests"><span>${escape(tr('Best weight'))}: <b id="workout-best-weight">${best.bestWeight??'—'}</b> kg</span><span>${escape(tr('Best reps at this weight'))}: <b id="workout-best-reps">${weight===null||weight===''?'—':best.byWeight?.[String(Number(weight))]??'—'}</b></span></div>`;
    }
    const endControls=session.startedAt?`<div class="workout-tracker-end"><button type="button" class="btn-icon" data-action="finish" aria-label="${escape(tr('Finish workout'))}" title="${escape(tr('Finish workout'))}"><img src="./assets/icons/cross.svg?v=1.2.10" width="24" height="24" alt=""></button></div>`:'';
    tracker.innerHTML=(error?`<p class="workout-error" role="alert">${escape(error)}</p>`:'')+`<div class="workout-tracker-header"><span>${escape(tr('Workout tracker'))}</span><strong id="workout-elapsed">${elapsed}</strong>${endControls}</div>`+content;
    tickText();
  }
  function tickText(){
    const elapsed=tracker.querySelector('#workout-elapsed');if(elapsed)elapsed.textContent=session?.startedAt?time((Date.now()-session.startedAt)/1000):'00:00';
    if(session?.phase==='rest'){
      const seconds=Math.max(0,Math.ceil((session.restUntil-Date.now())/1000));
      const label=tracker.querySelector('#workout-rest-time'),ring=tracker.querySelector('#workout-rest-progress');
      if(label)label.textContent=time(seconds);
      if(ring){ring.style.strokeDasharray=String(2*Math.PI*38);ring.style.strokeDashoffset=String(2*Math.PI*38*(1-Math.min(1,seconds/Math.max(1,session.restTotal))));}
    }
  }
  function tick(){
    if(!session?.startedAt||busy||owner!==getUid())return;
    if(session.phase==='rest'&&Date.now()>=session.restUntil){perform(async()=>{advanceRest(session);await saveSession();});return;}
    tickText();
  }
  function input(event){
    const el=event.target,field=el.dataset.field,workout=currentWorkout();
    if(el.id==='workout-search'||el.id==='workout-category'){
      const category=root.querySelector('#workout-category').value,query=root.querySelector('#workout-search').value.toLowerCase();
      root.querySelector('#workout-exercise-options').innerHTML=catalogButtons(catalog.filter(ex=>(!category||ex.category===category)&&ex.name.toLowerCase().includes(query)));return;
    }
    if(!field||!workout)return;
    if(field==='count'){changed(event,true);return;}
    if(field==='name'){workout.name=el.value;el.classList?.toggle('named',!!el.value.trim());}
    else if(field==='current-weight'||field==='current-reps'){
      const current=locate(session);if(!current)return;
      const actual=session.results[current.set.id]||{weight:current.set.weight,reps:trackerRepDefault(current.set.reps)};
      session.pending??={setId:current.set.id,weight:actual.weight,reps:actual.reps};
      session.pending[field==='current-weight'?'weight':'reps']=el.value;
      if(field==='current-weight'){
        const best=bests[current.exercise.exerciseId],label=tracker.querySelector('#workout-best-reps');
        if(label)label.textContent=el.value===''?'—':best?.byWeight?.[String(Number(el.value))]??'—';
      }
    }else{
      const exercise=workout.exercises.find(ex=>ex.id===el.dataset.ex);if(!exercise)return;
      if(field==='rest')exercise.restSeconds=el.value===''?0:Number(el.value);
      else if(field!=='count'){
        const set=exercise.sets.find(item=>item.id===el.dataset.set);if(!set)return;
        set[field]=field==='reps'?targetReps(el.value):el.value===''?null:Number(el.value);
        if(view==='session'&&session.current?.setId===set.id&&!session.pending&&!session.results[set.id]){const currentInput=tracker.querySelector(field==='weight'?'#workout-current-weight':'#workout-current-reps');if(currentInput)currentInput.value=(field==='reps'?trackerRepDefault(set.reps):set.weight)??'';if(field==='weight'){const label=tracker.querySelector('#workout-best-reps');if(label)label.textContent=set.weight===null?'—':bests[exercise.exerciseId]?.byWeight?.[String(set.weight)]??'—';}}
      }
    }
    saveEdit(field!=='current-weight'&&field!=='current-reps');
  }
  function changed(event,soft=false){
    if(event.target.dataset.field!=='count')return;
    const count=Number(event.target.value),exercise=currentWorkout()?.exercises.find(ex=>ex.id===event.target.dataset.ex);
    if(!exercise||!Number.isInteger(count)||count<1||count>50){if(!soft){error=tr('Each exercise needs between 1 and 50 sets.');render();}return;}
    while(exercise.sets.length<count)exercise.sets.push(newSet());
    if(exercise.sets.length>count)exercise.sets.length=count;
    repairCurrent();saveEdit();
    const list=root.querySelector('[data-set-list="'+exercise.id+'"]');if(list)list.innerHTML=setRows(exercise,view==='session');if(view==='session'&&visible)renderTracker();
  }
  function repairCurrent(){
    if(!session)return;
    if(!locate(session)){session.current=nextPosition(session);session.pending=null;if(session.startedAt){session.phase=session.current?'set':'complete';session.restUntil=null;}}
  }
  async function action(event){
    const target=event.target.closest('[data-action]');if(!target||busy)return;
    const type=target.dataset.action,workout=currentWorkout();
    if(type==='retry-edits'){const job=editFailure;if(job){editTail=editTail.then(()=>saveEditSnapshot(job));await editTail;}return;}
    if(type==='target-reps'){const set=workout?.exercises.find(ex=>ex.id===target.dataset.ex)?.sets.find(item=>item.id===target.dataset.set);if(set)repsPicker.open(set.reps,{ex:target.dataset.ex,set:target.dataset.set,generation:epoch});return;}
    if(type==='toggle-exercise'){expanded.has(target.dataset.id)?expanded.delete(target.dataset.id):expanded.add(target.dataset.id);render();return;}
    if(type==='toggle-picker'){pickerOpen=!pickerOpen;render();return;}
    if(type==='reload'){loaded=false;await open();return;}
    if(type==='library'){if(!await flushEdits())return;await navigate('library',()=>{if(session&&!session.startedAt){session=null;dirty=false;}newWorkoutId=null;error='';});return;}
    if(type==='resume'){await navigate('session');return;}
    if(type==='open'){
      if(session?.startedAt){if(session.templateId!==target.dataset.id){error=tr('Finish the current workout first.');render();return;}await navigate('session');return;}
      await navigate('session',()=>{session=createSession(templates.find(item=>item.id===target.dataset.id));dirty=false;error='';});return;
    }
    if(type==='add-exercise'){const ex=catalog.find(item=>item.id===target.dataset.id);if(ex){workout.exercises.push(exerciseInstance(ex));repairCurrent();saveEdit();render();}return;}
    if(type==='add-set'){const ex=workout.exercises.find(item=>item.id===target.dataset.ex);if(ex&&ex.sets.length<50){ex.sets.push(newSet());repairCurrent();saveEdit();render();}return;}
    if(type==='remove-exercise'){if(view==='session'&&session?.startedAt&&session.current?.exerciseId===target.dataset.id)return;if(!globalThis.confirm?.(tr('Delete this exercise?')))return;expanded.delete(target.dataset.id);workout.exercises=workout.exercises.filter(ex=>ex.id!==target.dataset.id);repairCurrent();saveEdit();render();return;}
    if(type==='remove-set'){const ex=workout.exercises.find(item=>item.id===target.dataset.ex);if(ex&&ex.sets.length>1){ex.sets=ex.sets.filter(set=>set.id!==target.dataset.set);repairCurrent();saveEdit();render();}else{error=tr('Each exercise needs between 1 and 50 sets.');render();}return;}
    if(type==='jump'||type==='jump-exercise'){
      if(view!=='session')return;
      const exercise=workout.exercises.find(ex=>ex.id===(target.dataset.ex||target.dataset.id));
      const set=type==='jump'?exercise?.sets.find(s=>s.id===target.dataset.set):exercise?.sets.find(s=>!session.results[s.id])||exercise?.sets[0];
      if(set)await perform(async()=>{selectSet(session,exercise.id,set.id);session.pending=null;await saveSession();});return;
    }
    await perform(async()=>{
      if(type==='custom'){
        const name=root.querySelector('#workout-custom-name').value.trim();if(!name)throw Error('Enter an exercise name.');
        const ex={id:uid(),name,category:root.querySelector('#workout-custom-category').value};catalog.push(ex);workout.exercises.push(exerciseInstance(ex));repairCurrent();
        await commit([{path:path('settings','workoutCatalog'),value:{exercises:catalog}},...(session?.startedAt?[sessionWrite()]:[])]);saveEdit();
      }else if(type==='start'){validateWorkout(session.workout);startSession(session);session.pending=null;await saveSession();}
      else if(type==='complete'){
        const current=locate(session),weight=tracker.querySelector('#workout-current-weight').value,reps=tracker.querySelector('#workout-current-reps').value;
        const record=completeSet(session,weight,reps,bests[current.exercise.exerciseId]);bests[record.exerciseId]=record.best;session.pending=null;
        await saveSession(true);
      }else if(type==='rest30'||type==='rest60'){extendRest(session,type==='rest30'?30:60);await saveSession();}
      else if(type==='skip'){session.restUntil=Date.now();advanceRest(session);await saveSession();}
      else if(type==='finish'){
        if(!session?.startedAt)return;
        const endedAt=Date.now(),hasResults=Object.keys(session.results).length>0;
        const writes=[{path:path('settings','workoutActive'),value:{session:null,updatedAt:endedAt}}];
        let log=null;
        if(hasResults){
          validateWorkout(session.workout,{allowDraft:true});
          log={...copy(session),endedAt,elapsedSeconds:Math.floor((endedAt-session.startedAt)/1000),status:'finished'};
          writes.push({path:path('workoutSessions',session.id),value:log},{path:path('workoutTemplates',session.templateId),value:session.workout});
        }
        await commit(writes);
        if(log){templates=templates.map(item=>item.id===session.templateId?copy(session.workout):item);history.unshift(log);}
        session=createSession(session.workout);lastCurrent=null;view='session';
      }
    });
  }
  const reorder=setupCompactReorder(root,{items:'.workout-exercise',handle:'.workout-drag',canDrag:()=>!busy&&!transitioning,getLabel:row=>row.querySelector('.workout-exercise-name').textContent,onDrop:order=>{
    const workout=currentWorkout();if(!workout)return;
    workout.exercises=order.map(id=>workout.exercises.find(ex=>ex.id===id)).filter(Boolean);saveEdit();render();
  }});
  const repsPicker=createRepRangeSelector(document.getElementById?.('modal-target-reps'),{tr,onApply:(value,context)=>{
    if(!context||context.generation!==epoch||owner!==getUid())return;
    const set=currentWorkout()?.exercises.find(ex=>ex.id===context.ex)?.sets.find(item=>item.id===context.set);if(!set)return;
    set.reps=value;saveEdit();render();
  }});
  root.addEventListener('click',action);tracker.addEventListener('click',action);
  root.addEventListener('input',input);tracker.addEventListener('input',input);
  root.addEventListener('change',changed);
  document.addEventListener?.('visibilitychange',tick);
  function create(){if(busy)return;if(!loaded){pendingCreate=true;open();return;}if(session&&!session.startedAt){session=null;dirty=false;}return navigate('editor',()=>{draft={id:uid(),name:'',exercises:[],createdAt:Date.now()};newWorkoutId=draft.id;error='';});}
  function setVisible(value){visible=value;tracker.hidden=!value||view!=='session'||!session;}
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>root.style.setProperty('--workout-tracker-height',tracker.getBoundingClientRect().height+'px')).observe(tracker);
  return {open,create,reset,refresh,setVisible,historyHTML,flushEdits};
}
