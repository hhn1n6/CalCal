import {createRepRangeSelector} from './rep-range-selector.js?v=1.2.26';
import {copy,uid,newSet,exerciseInstance,positions,locate,createSession,nextPosition,startSession,completeSet,advanceRest,extendRest,selectSet,validateWorkout,optionalNumber,targetReps,trackerRepDefault} from './workout-model.js?v=1.2.26';
import {defaultExercises} from './workout-catalog.js?v=1.2.26';
import {setupCompactReorder} from './compact-reorder.js?v=1.2.26';
import {mountRestWheel} from './workout-rest-wheel.js?v=1.2.26';
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
  function reset(){finishRequested=false;editTail=Promise.resolve();editFailure=null;newWorkoutId=null;repsPicker?.close();reorder?.cancel();root.getAnimations?.().forEach(animation=>animation.cancel());transitioning=false;expanded.clear();pickerOpen=false;lastCurrent=null;lastView='library';root.closest('.page')?.classList?.remove?.('workout-detail');epoch++;if(timer)clearInterval(timer);timer=null;owner=null;loaded=false;loading=false;busy=false;visible=false;view='library';pendingCreate=false;templates=[];catalog=[];bests={};session=null;draft=null;history=[];error='';dirty=false;root.innerHTML='';tracker.innerHTML='';tracker.hidden=true;}
  async function open(main=false,animateMain=true){
    if(!getUid())return;
    visible=true;
    if(loaded&&owner===getUid()){if(main){if(!await flushEdits())return;await navigate('library',()=>{finishRequested=false;if(session&&!session.startedAt)session=null;newWorkoutId=null;error='';},animateMain);}else render();return;}
    if(loading)return;
    owner=getUid();loading=true;error='';render();const generation=epoch;
    try{
      const [list,custom,records,active,logs]=await Promise.all([store.list(path('workoutTemplates')),store.read(path('settings','workoutCatalog')),store.list(path('workoutBests')),store.read(path('settings','workoutActive')),store.list(path('workoutSessions'))]);
      if(generation!==epoch)return;
      templates=list.filter(item=>!item.archived);catalog=custom?.exercises||copy(defaultExercises);bests=Object.fromEntries(records.map(item=>[item.id,item]));session=active?.session?.startedAt?active.session:null;history=logs.sort((a,b)=>b.endedAt-a.endedAt);
      if(!custom)await commit([{path:path('settings','workoutCatalog'),value:{exercises:catalog}}]);
      if(generation!==epoch)return;
      loaded=true;view=main?'library':session?'session':'library';lastSaved=Date.now();timer=setInterval(tick,1000);
    }catch(err){if(generation===epoch)error=tr('Could not load workouts. Try again.');}
    finally{if(generation===epoch){loading=false;if(loaded&&pendingCreate){pendingCreate=false;create();}else render();}}
  }
  function refresh(){if(loaded)render();}
  function disable(disabled){for(const host of [root,tracker])host.querySelectorAll('button,input,select').forEach(el=>el.disabled=disabled||el.dataset?.workoutLocked==='true');}
  async function perform(work,quiet=false){
    if(!await flushEdits()){render();return;}
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
  async function navigate(next,prepare=()=>{},animate=true){
    if(transitioning)return;transitioning=true;const generation=epoch;
    if(animate&&root.animate)await root.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}).finished.catch(()=>{});
    if(generation!==epoch){transitioning=false;return;}
    prepare();view=next;lastView=next;expanded.clear();pickerOpen=false;lastCurrent=null;render();
    root.getAnimations?.().forEach(animation=>animation.cancel());
    if(animate)root.animate?.([{opacity:0},{opacity:1}],{duration:220});transitioning=false;
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
      root.innerHTML=alert+(session?.startedAt?`<div class="card workout-resume"><strong>${escape(workoutName(session.workout))}</strong><button type="button" class="btn-icon workout-resume-icon" data-action="resume" aria-label="${escape(tr('Resume workout'))}" title="${escape(tr('Resume workout'))}"><img src="./assets/icons/resume.svg?v=1.2.26" width="24" height="24" alt=""></button></div>`:'')+(templates.length?templates.map(workout=>`<div class="card workout-card"><button type="button" class="workout-open" data-action="open" data-id="${escape(workout.id)}"><strong>${escape(workoutName(workout))}</strong><span>${workout.exercises.length} ${escape(tr('exercises'))}${averageTime(workout)?' · '+escape(tr('Average time'))+': '+averageTime(workout):''}</span></button></div>`).join(''):`<div class="empty">${escape(tr('No workouts yet. Tap + to create one.'))}</div>`);
    }else{
      const workout=currentWorkout(),running=view==='session';
      const canStart=!(session?.startedAt);
      root.innerHTML=`<div class="workout-detail-header"><div class="workout-name-row"><button type="button" class="btn-icon glass-circle main-action-button workout-quit" data-action="library" aria-label="${escape(tr('Back to workouts'))}"><img src="./assets/icons/chevron-left.svg?v=1.2.26" width="24" height="24" alt=""></button><input id="workout-name" class="workout-name-input${workout.name.trim()?' named':''}" type="text" maxlength="100" data-field="name" value="${escape(workout.name)}" placeholder="${escape(tr('Workout Name'))}" aria-label="${escape(tr('Workout name'))}"></div><div class="workout-detail-actions"><button type="button" class="btn-icon" data-action="delete-workout" aria-label="${escape(tr('Delete workout'))}"><img src="./assets/icons/delete.svg?v=1.2.26" width="24" height="24" alt=""></button>${canStart?`<button type="button" class="btn-icon workout-header-play" data-action="start" aria-label="${escape(tr('Start workout'))}"><img src="./assets/icons/play.svg?v=1.2.26" width="26" height="26" alt=""></button>`:''}<button type="button" class="btn-icon" data-action="toggle-picker" aria-label="${escape(tr('Add exercise'))}" aria-expanded="${pickerOpen}"><img src="./assets/icons/add.svg?v=1.2.26" width="26" height="26" alt=""></button></div></div>`+alert+picker()+`<div class="workout-exercise-list">${workout.exercises.map(ex=>exerciseCard(ex,running)).join('')}</div>`;

      for(const input of root.querySelectorAll('[data-field="rest"]')){const viewport=input.parentElement.querySelector('.workout-rest-wheel');if(viewport)mountRestWheel(input,viewport);}
    }
    const reveal=tracker.hidden;tracker.hidden=!visible||view!=='session'||!session?.startedAt;
    if(!tracker.hidden){renderTracker();if(reveal&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)tracker.animate?.([{opacity:0},{opacity:1}],{duration:300});}else tracker.innerHTML='';
    root.classList.toggle('workout-has-tracker',!tracker.hidden);
    if(oldScroll!==undefined&&root.closest('.page'))root.closest('.page').scrollTop=oldScroll;
    disable(busy);
  }
  function exerciseCard(ex,running){
    const isOpen=expanded.has(ex.id),locked=!!(running&&session.startedAt&&session.current?.exerciseId===ex.id);
    return `<section class="card workout-exercise" data-reorder-id="${ex.id}"><div class="workout-exercise-heading"><button type="button" class="workout-exercise-name" data-action="toggle-exercise" data-id="${ex.id}" aria-expanded="${isOpen}">${escape(ex.name)}</button><button type="button" class="btn-icon workout-drag" aria-label="${escape(tr('Reorder'))} ${escape(ex.name)}">☰</button><button type="button" class="btn-icon" data-action="remove-exercise" data-id="${ex.id}" data-workout-locked="${locked}" ${locked?'disabled':''} title="${escape(tr(locked?'The current exercise cannot be deleted.':'Remove exercise'))}" aria-label="${escape(tr('Remove exercise'))}"><img src="./assets/icons/cross.svg?v=1.2.26" width="18" height="18" alt=""></button></div><div class="workout-exercise-body" ${isOpen?'':'hidden'}><div class="workout-exercise-options"><label class="workout-set-count"><input type="number" inputmode="decimal" min="1" max="50" step="1" data-field="count" data-ex="${ex.id}" value="${ex.sets.length}" aria-label="${escape(tr('Sets'))}"><span>${escape(tr('sets'))}</span></label><div class="workout-rest-setting"><span>${escape(tr('Rest'))}:</span><div class="workout-rest-control"><input hidden type="number" inputmode="decimal" min="0" max="3600" step="1" data-field="rest" data-ex="${ex.id}" value="${ex.restSeconds}" aria-label="${escape(tr('Rest (seconds)'))}"><div class="workout-rest-wheel" role="spinbutton" tabindex="0" aria-label="${escape(tr('Rest (seconds)'))}" aria-valuemin="0" aria-valuemax="3600"></div></div><span>s</span></div></div><div class="workout-set-head"><span>${escape(tr('Set'))}</span><span>${escape(tr('Target kg'))}</span><span>${escape(tr('Target reps'))}</span><span></span></div><div data-set-list="${ex.id}">${setRows(ex,running)}</div><button type="button" class="btn-icon workout-add-set" data-action="add-set" data-ex="${ex.id}" aria-label="${escape(tr('Add set'))}">+</button></div></section>`;
  }
  function setRows(ex,running){return ex.sets.map((set,index)=>{const result=running?session.results[set.id]:null,selected=running&&session.current?.setId===set.id;return `<div class="workout-set-row${selected?' current':''}${result?' completed':''}"><button type="button" data-action="jump" data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(tr('Select set'))} ${index+1}">${result?'✓':index+1}</button>${number(set.weight,'weight',`data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(ex.name+' '+tr('Set')+' '+(index+1)+' kg')}"`)}${targetRepInput(ex,set,index)}<button type="button" class="btn-icon" data-action="remove-set" data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(tr('Remove set'))} ${index+1}"><img src="./assets/icons/cross.svg?v=1.2.26" width="18" height="18" alt=""></button></div>`;}).join('');}
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
    return `<div class="card workout-picker" ${pickerOpen?'':'hidden'}><div><div class="workout-picker-toolbar"><div class="workout-category-select"><select id="workout-category" aria-label="${escape(tr('Category'))}"><option value="">${escape(tr('All categories'))}</option>${categories.map(c=>`<option value="${escape(c)}">${escape(categoryText(c))}</option>`).join('')}</select><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></div><input id="workout-search" type="search" placeholder="${escape(tr('Search exercises'))}" aria-label="${escape(tr('Search exercises'))}"></div><div id="workout-exercise-options">${catalogButtons(catalog)}</div><details><summary>${escape(tr('Custom exercise'))}</summary><label>${escape(tr('Exercise name'))}<input id="workout-custom-name" type="text" maxlength="100"></label><label>${escape(tr('Category'))}<select id="workout-custom-category">${categories.map(c=>`<option value="${escape(c)}">${escape(categoryText(c))}</option>`).join('')}</select></label>${button('custom','Add custom exercise')}</details></div></div>`;

  }
  function catalogButtons(items){return items.map(ex=>`<button type="button" data-action="add-exercise" data-id="${escape(ex.id)}">${escape(ex.name)} <small>${escape(categoryText(ex.category))}</small></button>`).join('')||`<p>${escape(tr('No exercises found.'))}</p>`;}
  let lastTrackerKey=null,finishRequested=false;
  function renderTracker(){
    const current=locate(session),ex=current?.exercise,set=current?.set,ready=session.phase==='ready';
    const previous=tracker.querySelector('.tracker-panel')?.cloneNode?.(true),oldHeight=tracker.getBoundingClientRect?.().height||0;
    const starting=!ready&&!!session.startedAt&&!!previous?.querySelector('.workout-start');
    const oldRing=tracker.querySelector('#workout-rest-progress'),priorRestOffset=oldRing?parseFloat(globalThis.getComputedStyle?.(oldRing).strokeDashoffset||oldRing.style?.strokeDashoffset):NaN;
    tracker.getAnimations?.().forEach(animation=>animation.cancel());tracker.style.overflow='';
    const key=session.id+':'+session.phase+':'+(session.current?.setId||'')+':'+finishRequested;
    const elapsed=session.startedAt?time((Date.now()-session.startedAt)/1000):'';
    let content='';
    if(ready){
      content=`<div class="tracker-controls"><button type="button" class="workout-start" data-action="start" aria-label="${escape(tr('Start workout'))}" title="${escape(tr('Start workout'))}"><img src="./assets/icons/play.svg?v=1.2.26" width="36" height="36" alt=""></button></div>`;
    }else{
      content=`<div class="tracker-display"><div class="tracker-active-header"><div class="tracker-exercise"><strong>${escape(session.phase==='rest'?tr('Rest'):ex?.name||tr('All sets completed'))}</strong></div><span id="workout-elapsed">${elapsed}</span></div>`;
      if(session.phase==='rest'){
        content+=`<div class="tracker-rest-body"><div class="workout-rest-circle"><svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="38" class="rest-track"/><circle id="workout-rest-progress" cx="45" cy="45" r="38" class="rest-progress"/></svg><span id="workout-rest-time"></span></div><div class="tracker-rest-add"><button type="button" class="btn-icon" data-action="rest30" aria-label="${escape(tr('+30 sec'))}" title="${escape(tr('+30 sec'))}"><img src="./assets/icons/plus-30sec.svg?v=1.2.26" width="46" height="46" alt=""></button><span class="tracker-rest-separator" aria-hidden="true"></span><button type="button" class="btn-icon" data-action="rest60" aria-label="${escape(tr('+1 min'))}" title="${escape(tr('+1 min'))}"><img src="./assets/icons/plus-1min.svg?v=1.2.26" width="46" height="46" alt=""></button></div></div>`;
      }else if(current){
        const actual=session.results[set.id]||{weight:set.weight,reps:trackerRepDefault(set.reps)};
        const weight=session.pending?.setId===set.id?session.pending.weight:actual.weight,reps=session.pending?.setId===set.id?session.pending.reps:actual.reps;
        content+=`${typeof set.reps==='string'?`<small class="workout-current-target">${escape(tr('Target reps'))}: ${escape(set.reps.replace('-','–'))}</small>`:''}<div class="tracker-metrics"><div class="tracker-metric tracker-set-stat"><div class="tracker-field"><span>${escape(tr('Set'))}</span><output class="tracker-set-number" aria-label="${escape(tr('Set'))} ${current.index+1}">${current.index+1}</output></div></div><div class="tracker-metric"><label class="tracker-field">${escape(tr('Weight (kg)'))}${number(weight,'current-weight','id="workout-current-weight"')}</label></div><div class="tracker-metric"><label class="tracker-field">${escape(tr('Reps'))}${number(reps,'current-reps','id="workout-current-reps"')}</label></div></div>`;

      }
      const nextAction=session.phase==='rest'?'skip':'complete',nextLabel=session.phase==='rest'?'Skip rest':'Complete set',done=session.phase==='complete';
      content+=`</div><div class="tracker-controls tracker-actions"><button type="button" class="btn-icon tracker-action" data-action="finish" aria-label="${escape(tr('Finish workout'))}" title="${escape(tr('Finish workout'))}"><img src="./assets/icons/cross.svg?v=1.2.26" width="46" height="46" alt=""></button><button type="button" class="btn-icon tracker-action" data-action="${nextAction}" ${done?'disabled data-workout-locked="true"':''} aria-label="${escape(tr(nextLabel))}" title="${escape(tr(nextLabel))}"><img src="./assets/icons/arrow-right.svg?v=1.2.26" width="46" height="46" alt=""></button></div>`;
    }
    if(finishRequested)content=`<div class="tracker-finish-confirm" role="alertdialog" aria-labelledby="tracker-finish-question"><div class="tracker-display"><p id="tracker-finish-question">${escape(tr('Finish this workout?'))}</p></div><div class="tracker-controls btn-row"><button type="button" class="btn btn-secondary btn-full" data-action="cancel-finish">${escape(tr('Cancel'))}</button><button type="button" class="btn btn-primary btn-full" data-action="confirm-finish">${escape(tr('Finish'))}</button></div></div>`;
    tracker.classList.toggle('tracker-ready',ready);
    tracker.innerHTML=`<div class="tracker-panel">${error?`<p class="workout-error" role="alert">${escape(error)}</p>`:''}${content}</div>`;
    animateRestRing(priorRestOffset);tickText();
    if(key!==lastTrackerKey&&previous&&tracker.animate&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      const newHeight=tracker.getBoundingClientRect().height;
      tracker.style.overflow='hidden';
      const duration=starting?900:420;
      tracker.animate(starting?[
        {height:oldHeight+'px',backgroundColor:'#000'},
        {height:newHeight+'px',backgroundColor:'#000',offset:.94},
        {height:newHeight+'px',backgroundColor:'#fff'}
      ]:[{height:oldHeight+'px'},{height:newHeight+'px'}],{duration,easing:'cubic-bezier(.22,.8,.25,1)'}).finished.catch(()=>{}).finally(()=>{if(key===lastTrackerKey)tracker.style.overflow='';});
      const panel=tracker.querySelector('.tracker-panel');panel.animate?.([{opacity:0},{opacity:1}],{duration:240,delay:starting?900:100,fill:'backwards'});
      if(starting){
        const fill=document.createElement('img');fill.src=previous.querySelector('.workout-start img').getAttribute('src');fill.alt='';fill.className='tracker-play-fill';fill.setAttribute('aria-hidden','true');tracker.appendChild(fill);
        const scale=Math.ceil(Math.hypot(tracker.getBoundingClientRect().width,newHeight)/8);
        fill.animate([{transform:'scale(1)'},{transform:`scale(${scale})`}],{duration:900,easing:'cubic-bezier(.45,0,.2,1)',fill:'forwards'}).finished.catch(()=>{}).finally(()=>fill.remove());
      }else{
      const oldProgress=previous.querySelector('#workout-rest-progress');if(oldProgress&&Number.isFinite(priorRestOffset))oldProgress.style.strokeDashoffset=String(priorRestOffset);
      previous.classList.add('tracker-transition-old');previous.classList.toggle('tracker-was-ready',previous.querySelector('.workout-start')!==null);previous.setAttribute('aria-hidden','true');previous.inert=true;
      for(const item of previous.querySelectorAll('[id]'))item.removeAttribute('id');tracker.appendChild(previous);
      previous.animate?.([{opacity:1},{opacity:0}],{duration:140,fill:'forwards'}).finished.catch(()=>{}).finally(()=>previous.remove());
      }
    }
    lastTrackerKey=key;
  }
  function animateRestRing(priorOffset){
    if(session.phase!=='rest')return;
    const ring=tracker.querySelector('#workout-rest-progress');if(!ring?.animate||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const length=2*Math.PI*38,remaining=Math.max(0,session.restUntil-Date.now()),total=Math.max(1000,session.restTotal*1000),offset=length*(1-Math.min(1,remaining/total));
    ring.dataset.animated='true';ring.style.strokeDasharray=String(length);
    if(Number.isFinite(priorOffset)&&Math.abs(priorOffset-offset)>0.25&&remaining>300){
      const target=length*(1-Math.min(1,(remaining-300)/total));ring.style.strokeDashoffset=String(priorOffset);
      ring.animate([{strokeDashoffset:priorOffset},{strokeDashoffset:target}],{duration:300,easing:'ease-out',fill:'forwards'});
      ring.animate([{strokeDashoffset:target},{strokeDashoffset:length}],{delay:300,duration:remaining-300,easing:'linear',fill:'forwards'});
    }else{ring.style.strokeDashoffset=String(offset);ring.animate([{strokeDashoffset:offset},{strokeDashoffset:length}],{duration:Math.max(1,remaining),easing:'linear',fill:'forwards'});}
  }
  function tickText(){
    const elapsed=tracker.querySelector('#workout-elapsed');if(elapsed)elapsed.textContent=session?.startedAt?time((Date.now()-session.startedAt)/1000):'00:00';
    if(session?.phase==='rest'){
      const seconds=Math.max(0,Math.ceil((session.restUntil-Date.now())/1000));
      const label=tracker.querySelector('#workout-rest-time'),ring=tracker.querySelector('#workout-rest-progress');
      if(label)label.textContent=time(seconds);
      if(ring&&ring.dataset?.animated!=='true'){ring.style.strokeDasharray=String(2*Math.PI*38);ring.style.strokeDashoffset=String(2*Math.PI*38*(1-Math.min(1,seconds/Math.max(1,session.restTotal))));}
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
    }else{
      const exercise=workout.exercises.find(ex=>ex.id===el.dataset.ex);if(!exercise)return;
      if(field==='rest')exercise.restSeconds=el.value===''?0:Number(el.value);
      else if(field!=='count'){
        const set=exercise.sets.find(item=>item.id===el.dataset.set);if(!set)return;
        set[field]=field==='reps'?targetReps(el.value):el.value===''?null:Number(el.value);
        if(view==='session'&&session.current?.setId===set.id&&!session.pending&&!session.results[set.id]){const currentInput=tracker.querySelector(field==='weight'?'#workout-current-weight':'#workout-current-reps');if(currentInput)currentInput.value=(field==='reps'?trackerRepDefault(set.reps):set.weight)??'';}
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
    if(type==='finish'){if(!session?.startedAt)return;finishRequested=true;renderTracker();disable(busy);tracker.querySelector('[data-action="cancel-finish"]')?.focus?.({preventScroll:true});return;}
    if(type==='cancel-finish'){finishRequested=false;renderTracker();disable(busy);return;}
    if(type==='confirm-finish'){if(!finishRequested)return;finishRequested=false;}
    if(type==='retry-edits'){const job=editFailure;if(job){editTail=editTail.then(()=>saveEditSnapshot(job));await editTail;}return;}
    if(type==='target-reps'){const set=workout?.exercises.find(ex=>ex.id===target.dataset.ex)?.sets.find(item=>item.id===target.dataset.set);if(set)repsPicker.open(set.reps,{ex:target.dataset.ex,set:target.dataset.set,generation:epoch});return;}
    if(type==='toggle-exercise'){expanded.has(target.dataset.id)?expanded.delete(target.dataset.id):expanded.add(target.dataset.id);render();return;}
    if(type==='toggle-picker'){pickerOpen=!pickerOpen;render();return;}
    if(type==='delete-workout'){
      const active=session?.startedAt&&session.templateId===workout?.id;
      if(!workout||!globalThis.confirm?.(tr(active?'Delete this workout and end its current session?':'Delete this workout?')))return;
      await perform(async()=>{
        const writes=[{path:path('workoutTemplates',workout.id),value:{...copy(workout),archived:true,updatedAt:Date.now()}}];
        if(active)writes.push({path:path('settings','workoutActive'),value:{session:null,updatedAt:Date.now()}});
        await commit(writes);templates=templates.filter(item=>item.id!==workout.id);
        if(session?.templateId===workout.id)session=null;
        draft=null;newWorkoutId=null;finishRequested=false;view='library';
      });return;
    }
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
      }else if(type==='start'){if(view==='editor'){if(session?.startedAt)throw Error('Finish the current workout first.');session=createSession(draft);view='session';}validateWorkout(session.workout);startSession(session);session.pending=null;await saveSession();}
      else if(type==='complete'){
        const current=locate(session),weight=tracker.querySelector('#workout-current-weight').value,reps=tracker.querySelector('#workout-current-reps').value;
        const record=completeSet(session,weight,reps,bests[current.exercise.exerciseId]);bests[record.exerciseId]=record.best;session.pending=null;
        await saveSession(true);
      }else if(type==='rest30'||type==='rest60'){extendRest(session,type==='rest30'?30:60);await saveSession();}
      else if(type==='skip'){session.restUntil=Date.now();advanceRest(session);await saveSession();}
      else if(type==='confirm-finish'){
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
  const reorder=setupCompactReorder(root,{items:'.workout-exercise',handle:'.workout-drag',canDrag:()=>!busy&&!transitioning,getLabel:row=>row.querySelector('.workout-exercise-name').textContent,getCompactHeight:row=>{
    const body=row.querySelector('.workout-exercise-body'),hidden=body.hidden;
    try{body.hidden=true;return row.getBoundingClientRect().height;}finally{body.hidden=hidden;}
  },onDrop:order=>{
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
  tracker.addEventListener('keydown',event=>{if(event.key==='Escape'&&finishRequested){event.preventDefault();finishRequested=false;renderTracker();}});
  document.addEventListener?.('visibilitychange',tick);
  function create(){if(busy)return;if(!loaded){pendingCreate=true;open();return;}if(session&&!session.startedAt){session=null;dirty=false;}return navigate('editor',()=>{draft={id:uid(),name:'',exercises:[],createdAt:Date.now()};newWorkoutId=draft.id;error='';});}
  function setVisible(value){if(!value)finishRequested=false;visible=value;tracker.hidden=!value||view!=='session'||!session?.startedAt;}
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>root.style.setProperty('--workout-tracker-height',tracker.getBoundingClientRect().height+'px')).observe(tracker);
  return {open,create,reset,refresh,setVisible,historyHTML,flushEdits};
}
