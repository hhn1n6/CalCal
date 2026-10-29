import {createRepRangeSelector} from './rep-range-selector.js?v=1.2.43';
import {alignTrackerClock} from './tracker-clock.js?v=1.2.47';
import {captureSetLayout,animateSetLayout} from './workout-set-motion.js?v=1.2.54';
import {currentSetScrollTop} from './workout-set-follow.js?v=1.2.55';
import {copy,uid,newSet,exerciseInstance,positions,locate,createSession,nextPosition,startSession,completeSet,advanceRest,extendRest,restProgress,selectSet,validateWorkout,optionalNumber,targetReps,trackerRepDefault} from './workout-model.js?v=1.2.49';
import {defaultExercises} from './workout-catalog.js?v=1.2.43';
import {setupCompactReorder} from './compact-reorder.js?v=1.2.43';
import {mountRestWheel} from './workout-rest-wheel.js?v=1.2.43';
import {createExercisePicker} from './exercise-picker.js?v=1.2.43';
import {createWorkoutLocalStore} from './workout-local-store.js?v=1.2.43';
import {mergeWorkoutBests,finishWorkoutInCloud} from './workout-sync.js?v=1.2.43';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=seconds=>{seconds=Math.max(0,Math.floor(seconds));return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
export function createWorkoutFeature({root,tracker,getUid,store,tr,localStore=createWorkoutLocalStore(),locale=()=> 'en-GB',uploadTimeoutMs=15000}){
  let owner=null,epoch=0,loaded=false,loading=false,busy=false,visible=false,view='library',templates=[],catalog=[],bests={},session=null,draft=null,history=[],error='',timer=null,dirty=false,lastSaved=0,revision=0,pendingCreate=false;
  let expanded=new Set(),pickerOpen=false,lastCurrent=null,lastCurrentSet=null,lastView='library',transitioning=false,followRevision=0;
  let editTail=Promise.resolve(),editFailure=null,newWorkoutId=null;
  let localTail=Promise.resolve(),localFailure=null,localBusy=false,pendingCompletion=null;
  function fitLiveTracker(){
    const width=tracker.getBoundingClientRect?.().width||tracker.clientWidth;
    if(width)tracker.style.setProperty?.('--tracker-scale',String(width/644));
    const title=tracker.querySelector('.tracker-live-title'),text=title?.querySelector?.('strong');
    if(title?.clientWidth&&text?.scrollWidth)text.style.setProperty('--tracker-title-scale',Math.min(.838,title.clientWidth/text.scrollWidth));
    const message=tracker.querySelector('.tracker-message-title'),messageText=message?.querySelector?.('strong');
    if(message?.clientWidth&&messageText?.scrollWidth)messageText.style.setProperty('--tracker-message-title-scale',Math.min(.838,message.clientWidth/messageText.scrollWidth));
    for(const input of tracker.querySelectorAll('input[data-field^="current-"]'))input.style.setProperty?.('--tracker-number-scale',String(Math.min(1,3/Math.max(3,String(input.value).length))));
    for(const clock of tracker.querySelectorAll('.tracker-clock-digits'))alignTrackerClock(clock);
  }
  if(globalThis.ResizeObserver){const observer=new ResizeObserver(()=>{fitLiveTracker();if(session?.phase==='rest')animateRestFill();});observer.observe(tracker);}
  const workoutName=workout=>workout.name?.trim()||tr('Workout');
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
      if(writes.length)await store.commit(writes);
      if(job.generation!==epoch)return;
      if(job.template){if(emptyNew)templates=templates.filter(item=>item.id!==job.workout.id);else{const index=templates.findIndex(item=>item.id===job.workout.id);if(index<0)templates.push(copy(job.workout));else templates[index]=copy(job.workout);}}
      dirty=revision!==job.revision;lastSaved=Date.now();
      if(!editFailure||editFailure.revision<=job.revision){editFailure=null;if(!localFailure&&!pendingCompletion)error='';root.querySelector('[data-action="retry-edits"]')?.remove?.();}
    })().catch(err=>{if(job.generation===epoch){editFailure=job;error=tr('Could not save workout. Try again.');render();}});
  }
  function saveEdit(template=true){
    const workout=currentWorkout();if(!workout||!getUid()||owner!==getUid())return;
    dirty=true;revision++;
    const localWrite=view==='session'&&session?.startedAt?saveLocalRecord({session:copy(session),completion:pendingCompletion,updatedAt:Date.now()}):null;
    if(!template)return localWrite;
    const job={generation:epoch,owner,revision,template,newWorkout:workout.id===newWorkoutId,workout:copy(workout)};
    editTail=editTail.then(()=>saveEditSnapshot(job));return editTail;
  }
  async function flushEdits(){let pending;do{pending=editTail;await pending;}while(pending!==editTail);await flushLocal();return !editFailure&&!localFailure;}
  function saveLocalRecord(record){
    const job={owner,generation:epoch,record:copy(record)};
    const pending=localTail.then(async()=>{
      if(job.generation!==epoch)return;
      try{await localStore.write(job.owner,job.record);}catch(cause){const error=Error('Could not save workout on this device. Keep this page open and try again.');error.code='workout-local-storage';error.cause=cause;throw error;}
      if(job.generation!==epoch)return;
      if(localFailure){localFailure=null;if(!editFailure&&!pendingCompletion)error='';}
    });
    localTail=pending.catch(err=>{if(job.generation===epoch){localFailure=job;error=tr(err.message);render();}});
    return pending;
  }
  async function flushLocal(){let pending;do{pending=localTail;await pending;}while(pending!==localTail);return !localFailure;}
  async function performLocal(work){
    if(busy||localBusy||pendingCompletion||!getUid()||owner!==getUid())return;
    if(!await flushLocal()){render();return;}
    if(busy||localBusy||owner!==getUid())return;
    const generation=epoch,snapshot=copy({session,bests,draft,view});localBusy=true;error='';
    try{await work();}
    catch(err){if(generation===epoch){if(err.code!=='workout-local-storage')({session,bests,draft,view}=snapshot);error=tr(err.message);}}
    finally{if(generation===epoch){localBusy=false;render();}}
  }
  function allSetsCompleted(){const sets=session?.startedAt?positions(session.workout):[];return session?.phase==='complete'&&sets.length>0&&sets.every(set=>session.results[set.setId]);}
  async function fadeTrackerOut(whole=false){
    if(!tracker.animate||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const panel=whole?tracker:tracker.querySelector('.tracker-finished, .tracker-finish-confirm, .tracker-upload')||tracker.querySelector('.tracker-panel');
    await panel?.animate?.([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}).finished.catch(()=>{});
  }
  function reset(){finishRequested=false;localTail=Promise.resolve();localFailure=null;localBusy=false;pendingCompletion=null;editTail=Promise.resolve();editFailure=null;newWorkoutId=null;exercisePicker?.reset();repsPicker?.close();reorder?.cancel();libraryReorder?.cancel();root.getAnimations?.().forEach(animation=>animation.cancel());transitioning=false;expanded.clear();pickerOpen=false;lastCurrent=null;lastView='library';root.closest('.page')?.classList?.remove?.('workout-detail');epoch++;if(timer)clearInterval(timer);timer=null;owner=null;loaded=false;loading=false;busy=false;visible=false;view='library';pendingCreate=false;templates=[];catalog=[];bests={};session=null;draft=null;history=[];error='';dirty=false;root.innerHTML='';tracker.innerHTML='';tracker.hidden=true;}
  async function open(main=false,animateMain=true){
    if(!getUid())return;
    visible=true;
    if(loaded&&owner===getUid()){if(main&&view!=='library'){if(!await flushEdits())return;await navigate('library',()=>{finishRequested=false;if(session&&!session.startedAt)session=null;newWorkoutId=null;error='';},animateMain);}else render();return;}
    if(loading)return;
    owner=getUid();loading=true;error='';render();const generation=epoch;let local=null,localReady=false;
    try{
      local=await localStore.read(owner);localReady=true;if(generation!==epoch)return;
      const [list,custom,records,active,logs,order]=await Promise.all([store.list(path('workoutTemplates')),store.read(path('settings','workoutCatalog')),store.list(path('workoutBests')),store.read(path('settings','workoutActive')),store.list(path('workoutSessions')),store.read(path('settings','workoutOrder'))]);
      if(generation!==epoch)return;
      const orderIndex=new Map((order?.ids||[]).map((id,index)=>[id,index]));
      templates=list.filter(item=>!item.archived).sort((a,b)=>(orderIndex.get(a.id)??Infinity)-(orderIndex.get(b.id)??Infinity));catalog=custom?.exercises||copy(defaultExercises);bests=Object.fromEntries(records.map(item=>[item.id,item]));session=local?local.session:active?.session?.startedAt?active.session:null;pendingCompletion=local?.completion||null;history=logs.filter(log=>!log.deleted).sort((a,b)=>b.endedAt-a.endedAt);
      if(session?.startedAt){
        validateWorkout(session.workout,{allowDraft:true});
        if(logs.some(log=>log.id===session.id)||list.some(item=>item.id===session.templateId&&item.archived)){session=null;pendingCompletion=null;try{await localStore.write(owner,{session:null,completion:null,updatedAt:Date.now()});}catch{/* Uploaded history remains authoritative. */}}
        else{bests=mergeWorkoutBests(bests,session.results);if(!local)await saveLocalRecord({session,completion:null,updatedAt:Date.now()});}
      }
      if(!custom)await commit([{path:path('settings','workoutCatalog'),value:{exercises:catalog}}]);
      if(generation!==epoch)return;
      loaded=true;view=main?'library':session?'session':'library';if(!animateMain)lastView=view;lastSaved=Date.now();timer=setInterval(tick,1000);
    }catch(err){if(generation===epoch){
      if(localReady&&local?.session?.startedAt){
        try{validateWorkout(local.session.workout,{allowDraft:true});session=local.session;pendingCompletion=local.completion||null;templates=[copy(session.workout)];catalog=copy(defaultExercises);history=[];bests=mergeWorkoutBests({},session.results);loaded=true;view=main?'library':'session';lastView=view;timer=setInterval(tick,1000);error='';}
        catch{session=null;pendingCompletion=null;error=tr('Could not read local workout storage. Try again.');}
      }
      else error=tr(localReady?'Could not load workouts. Try again.':'Could not read local workout storage. Try again.');
    }}
    finally{if(generation===epoch){loading=false;if(loaded&&pendingCreate){pendingCreate=false;create();}else render();}}
  }
  function refresh(){if(loaded)render();exercisePicker.refresh();}
  function disable(disabled){for(const host of [root,tracker])host.querySelectorAll('button,input,select').forEach(el=>el.disabled=disabled||el.dataset?.workoutLocked==='true'||!!(pendingCompletion&&!['library','delete-workout','open','resume','retry-upload','retry-local'].includes(el.dataset?.action)));}
  async function perform(work,quiet=false){
    if(!await flushEdits()||!await flushLocal()){render();return;}
    if(busy||localBusy||!getUid()||owner!==getUid())return;
    const generation=epoch,version=revision,snapshot=copy({templates,catalog,bests,session,draft,view,history});busy=true;error='';if(!quiet)disable(true);
    try{await work();if(generation!==epoch)return;dirty=revision!==version;lastSaved=Date.now();}
    catch(err){if(generation===epoch){if(!quiet&&err.code!=='workout-local-storage')({templates,catalog,bests,session,draft,view,history}=snapshot);error=err.code==='workout-local-storage'?tr(err.message):err.code?tr('Could not save workout. Try again.'):tr(err.message)||tr('Could not save workout. Try again.');}}
    finally{if(generation===epoch){busy=false;if(!quiet||error)render();}}
  }
  async function saveSession(){
    if(!session?.startedAt)return;
    if(allSetsCompleted())session.finishedAt??=Date.now();else delete session.finishedAt;
    await saveLocalRecord({session:copy(session),completion:pendingCompletion,updatedAt:Date.now()});
  }
  async function boundedUpload(work){
    let timeout;
    try{return await Promise.race([work(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Upload timed out.')),uploadTimeoutMs);})]);}
    finally{clearTimeout(timeout);}
  }
  async function finishWorkout(){
    if(busy||localBusy||!session?.startedAt||owner!==getUid())return;
    if(!await flushLocal()){render();return;}
    if(busy||localBusy||owner!==getUid())return;
    const generation=epoch,account=owner;busy=true;error='';
    try{
      if(!pendingCompletion){
        const endedAt=allSetsCompleted()?(session.finishedAt||Date.now()):Date.now(),workout=copy(session.workout);validateWorkout(workout,{allowDraft:true});workout.updatedAt=endedAt;
        const log=Object.keys(session.results).length?{...copy(session),workout,endedAt,elapsedSeconds:Math.floor((endedAt-session.startedAt)/1000),status:'finished'}:null;
        pendingCompletion={sessionId:session.id,workout,endedAt,log};
        await saveLocalRecord({session:copy(session),completion:pendingCompletion,updatedAt:endedAt});
      }
      if(generation!==epoch)return;
      await fadeTrackerOut();if(generation!==epoch)return;
      render();const completion=copy(pendingCompletion),spinnerShownAt=Date.now();
      const result=await boundedUpload(async()=>{
        // Template autosaves stay independent during training. Finish waits for
        // queued edits so an older template write cannot overwrite this upload.
        await flushEdits();if(generation!==epoch)throw Error('Account changed.');
        if(globalThis.navigator?.onLine===false)throw Error('Offline.');
        return store.finish?store.finish(account,completion):finishWorkoutInCloud({store,uid:account,completion});
      });
      if(generation!==epoch)return;
      if(tracker.animate)await new Promise(resolve=>setTimeout(resolve,Math.max(0,400-(Date.now()-spinnerShownAt))));
      if(generation!==epoch)return;
      if(result.bests)bests={...bests,...result.bests};
      if(result.log&&!result.log.deleted){const index=history.findIndex(item=>item.id===result.log.id);if(index<0)history.unshift(result.log);else history[index]=result.log;}
      if(completion.log){const index=templates.findIndex(item=>item.id===completion.workout.id);if(index<0)templates.push(copy(completion.workout));else templates[index]=copy(completion.workout);}
      await fadeTrackerOut(true);if(generation!==epoch)return;
      pendingCompletion=null;editFailure=null;session=createSession(completion.workout);lastCurrent=null;view='session';
      await saveLocalRecord({session:null,completion:null,completedSessionId:completion.sessionId,updatedAt:Date.now()});
    }catch(err){if(generation===epoch)error=err.code==='workout-local-storage'?tr(err.message):tr('Workout is saved on this device. Upload failed. Try again when connected.');}
    finally{if(generation===epoch){busy=false;render();}}
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
  function followCurrentSet(){
    const revision=++followRevision,generation=epoch;
    if(!visible||view!=='session'||!session?.startedAt||session.phase!=='set'||!globalThis.requestAnimationFrame)return;
    const setId=session.current?.setId;
    requestAnimationFrame(async()=>{
      const row=root.querySelector('[data-set-id="'+setId+'"]'),page=root.closest('.page');
      if(!row?.getBoundingClientRect||!page?.scrollTo)return;
      // Expansion and set-row animations must settle before measuring the target.
      const animations=row.closest('.workout-exercise-body')?.getAnimations?.({subtree:true})||[];
      await Promise.all(animations.filter(a=>a.effect?.getComputedTiming().endTime<1000).map(a=>a.finished.catch(()=>{})));
      if(revision!==followRevision||generation!==epoch||!visible||view!=='session'||session?.phase!=='set'||session.current?.setId!==setId||!row.isConnected||row.closest('.workout-exercise-body')?.hidden)return;
      const viewport=globalThis.visualViewport||{height:globalThis.innerHeight,offsetTop:0};
      page.scrollTo({top:currentSetScrollTop(row.getBoundingClientRect(),page,viewport),behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    });
  }
  function render(){
    let autoExpand=null;
    root.closest('.page')?.classList?.toggle('workout-detail',view!=='library');
    if(view!==lastView){lastView=view;root.animate?.([{opacity:0},{opacity:1}],{duration:220});}
    if(session?.startedAt&&session.phase==='set'&&(session.current?.exerciseId!==lastCurrent||session.current?.setId!==lastCurrentSet)){lastCurrent=session.current?.exerciseId;lastCurrentSet=session.current?.setId;if(lastCurrent){if(!expanded.has(lastCurrent))autoExpand=lastCurrent;expanded.add(lastCurrent);}}
    const oldScroll=root.closest('.page')?.scrollTop;
    if(loading){root.innerHTML=`<div class="empty" role="status">${escape(tr('Loading workouts…'))}</div>`;tracker.hidden=true;return;}
    if(!loaded){root.innerHTML=`<p role="alert">${escape(error)}</p>${button('reload','Try again')}`;tracker.hidden=true;return;}
    const alert=error?`<p class="workout-error" role="alert">${escape(error)}</p>${localFailure?button('retry-local','Try again'):editFailure?button('retry-edits','Try again'):''}`:'';
    if(view==='library'){
      root.innerHTML=alert+(session?.startedAt?`<div class="card workout-resume"><strong>${escape(workoutName(session.workout))}</strong><button type="button" class="btn-icon workout-resume-icon" data-action="resume" aria-label="${escape(tr('Resume workout'))}" title="${escape(tr('Resume workout'))}"><img src="./assets/icons/resume.svg?v=1.2.43" width="24" height="24" alt=""></button></div>`:'')+(templates.length?templates.map(workout=>`<div class="card workout-card" data-reorder-id="${escape(workout.id)}"><button type="button" class="workout-open" data-action="open" data-id="${escape(workout.id)}"><strong>${escape(workoutName(workout))}</strong><span>${workout.exercises.length} ${escape(tr('exercises'))}${averageTime(workout)?' · '+escape(tr('Average time'))+': '+averageTime(workout):''}</span></button><button type="button" class="btn-icon workout-card-drag" aria-label="${escape(tr('Reorder'))} ${escape(workoutName(workout))}">☰</button></div>`).join(''):`<div class="empty">${escape(tr('No workouts yet. Tap + to create one.'))}</div>`);
    }else{
      const workout=currentWorkout(),running=view==='session';
      const canStart=!(session?.startedAt);
      root.innerHTML=`<div class="workout-detail-header"><div class="workout-name-row"><button type="button" class="btn-icon glass-circle main-action-button workout-quit" data-action="library" aria-label="${escape(tr('Back to workouts'))}"><img src="./assets/icons/chevron-left.svg?v=1.2.43" width="24" height="24" alt=""></button><input id="workout-name" class="workout-name-input${workout.name.trim()?' named':''}" type="text" maxlength="100" data-field="name" value="${escape(workout.name)}" placeholder="${escape(tr('Workout'))}" aria-label="${escape(tr('Workout name'))}"></div><div class="workout-detail-actions"><button type="button" class="btn-icon" data-action="delete-workout" aria-label="${escape(tr('Delete workout'))}"><img src="./assets/icons/delete.svg?v=1.2.43" width="24" height="24" alt=""></button><button type="button" class="btn-icon workout-header-play" ${canStart?'': 'disabled data-workout-locked="true"'} data-action="start" aria-label="${escape(tr('Start workout'))}"><img src="./assets/icons/play.svg?v=1.2.43" width="26" height="26" alt=""></button><button type="button" class="btn-icon" data-action="toggle-picker" aria-label="${escape(tr('Add exercise'))}" aria-haspopup="dialog"><img src="./assets/icons/add.svg?v=1.2.43" width="26" height="26" alt=""></button></div></div>`+alert+`<div class="workout-exercise-list">${workout.exercises.map(ex=>exerciseCard(ex,running)).join('')}</div>`;

      for(const input of root.querySelectorAll('[data-field="rest"]')){const viewport=input.parentElement.querySelector('.workout-rest-wheel');if(viewport)mountRestWheel(input,viewport);}
      if(autoExpand)animateExerciseBody(root.querySelector(`[data-reorder-id="${autoExpand}"] .workout-exercise-body`),true,0);
    }
    const reveal=tracker.hidden;tracker.hidden=!visible||view!=='session'||!session?.startedAt;
    if(!tracker.hidden){renderTracker();if(reveal&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)tracker.animate?.([{opacity:0},{opacity:1}],{duration:300});}else tracker.innerHTML='';
    root.classList.toggle('workout-has-tracker',!tracker.hidden);
    if(oldScroll!==undefined&&root.closest('.page'))root.closest('.page').scrollTop=oldScroll;
    disable(busy);
    followCurrentSet();
  }
  function animateExerciseBody(body,opening,startHeight){
    if(!body?.animate||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    body.hidden=false;const full=body.getBoundingClientRect().height;body.style.overflow='hidden';
    const animation=body.animate([{height:(startHeight||0)+'px',opacity:opening?0:1,paddingTop:opening?'0px':'16px'},{height:(opening?full:0)+'px',opacity:opening?1:0,paddingTop:opening?'16px':'0px'}],{duration:300,easing:'cubic-bezier(.22,.8,.25,1)',fill:'both'});
    animation.finished.then(()=>{body.hidden=!opening;body.style.overflow='';animation.cancel();}).catch(()=>{});
  }
  function toggleExercise(id){
    const opening=!expanded.has(id),body=root.querySelector(`[data-reorder-id="${id}"] .workout-exercise-body`),height=opening?0:body?.getBoundingClientRect?.().height||0;
    opening?expanded.add(id):expanded.delete(id);render();
    animateExerciseBody(root.querySelector(`[data-reorder-id="${id}"] .workout-exercise-body`),opening,height);
  }
  function exerciseCard(ex,running){
    const isOpen=expanded.has(ex.id),locked=!!(running&&session.startedAt&&session.current?.exerciseId===ex.id);
    return `<section class="card workout-exercise" data-reorder-id="${ex.id}"><div class="workout-exercise-heading"><button type="button" class="workout-exercise-name" data-action="toggle-exercise" data-id="${ex.id}" aria-expanded="${isOpen}">${escape(ex.name)}</button><button type="button" class="btn-icon workout-drag" aria-label="${escape(tr('Reorder'))} ${escape(ex.name)}">☰</button><button type="button" class="btn-icon" data-action="remove-exercise" data-id="${ex.id}" data-workout-locked="${locked}" ${locked?'disabled':''} title="${escape(tr(locked?'The current exercise cannot be deleted.':'Remove exercise'))}" aria-label="${escape(tr('Remove exercise'))}"><img src="./assets/icons/close.svg?v=1.2.43" width="18" height="18" alt=""></button></div><div class="workout-exercise-body" ${isOpen?'':'hidden'}><div class="workout-exercise-options"><label class="workout-set-count"><input type="number" inputmode="decimal" min="1" max="50" step="1" data-field="count" data-ex="${ex.id}" value="${ex.sets.length}" aria-label="${escape(tr('Sets'))}"><span>${escape(tr('sets'))}</span></label><div class="workout-rest-setting"><span>${escape(tr('Rest'))}:</span><div class="workout-rest-control"><input hidden type="number" inputmode="decimal" min="0" max="3600" step="1" data-field="rest" data-ex="${ex.id}" value="${ex.restSeconds}" aria-label="${escape(tr('Rest (seconds)'))}"><div class="workout-rest-wheel" role="spinbutton" tabindex="0" aria-label="${escape(tr('Rest (seconds)'))}" aria-valuemin="0" aria-valuemax="3600"></div></div><span>s</span></div></div><div class="workout-set-head"><span>${escape(tr('Set'))}</span><span>${escape(tr('Target kg'))}</span><span>${escape(tr('Target reps'))}</span><span></span></div><div data-set-list="${ex.id}">${setRows(ex,running)}</div><button type="button" class="btn-icon workout-add-set" data-action="add-set" data-ex="${ex.id}" aria-label="${escape(tr('Add set'))}">+</button></div></section>`;
  }
  function setRows(ex,running){return ex.sets.map((set,index)=>{const result=running?session.results[set.id]:null,selected=running&&!!session.startedAt&&session.current?.setId===set.id;return `<div data-set-id="${set.id}" class="workout-set-row${selected?' current':''}${result?' completed':''}"><button type="button" data-action="jump" data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(tr('Select set'))} ${index+1}">${result?'<img class="workout-set-tick" src="./assets/icons/tick.svg?v=1.2.43" width="20" height="20" alt="">':index+1}</button>${number(set.weight,'weight',`data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(ex.name+' '+tr('Set')+' '+(index+1)+' kg')}"`)}${targetRepInput(ex,set,index)}<button type="button" class="btn-icon" data-action="remove-set" data-ex="${ex.id}" data-set="${set.id}" aria-label="${escape(tr('Remove set'))} ${index+1}"><img src="./assets/icons/close.svg?v=1.2.43" width="18" height="18" alt=""></button></div>`;}).join('');}
  function targetRepInput(ex,set,index){return `<input type="text" readonly inputmode="none" data-action="target-reps" data-field="reps" data-ex="${ex.id}" data-set="${set.id}" value="${escape(set.reps??'')}" aria-label="${escape(ex.name+' '+tr('Set')+' '+(index+1)+' '+tr('Target reps'))}" aria-haspopup="dialog">`;}
  function historyHTML(){
    if(!loaded)return '<div class="empty">'+escape(error||tr('Loading workouts…'))+'</div>';
    return history.length?history.map(log=>'<div class="card workout-history"><div class="workout-history-heading"><strong>'+escape(workoutName(log.workout))+'</strong><button type="button" class="btn-icon" data-history-delete="'+escape(log.id)+'" aria-label="'+escape(tr('Delete workout record'))+'"><img src="./assets/icons/delete.svg?v=1.2.43" width="22" height="22" alt=""></button></div><p>'+escape(new Date(log.endedAt).toLocaleString(locale()))+' · '+time(log.elapsedSeconds)+'</p>'+(log.status==='discarded'?'<small>'+escape(tr('Stopped early'))+'</small>':'')+historySets(log)+'</div>').join(''):'<div class="empty">'+escape(tr('No completed workouts yet.'))+'</div>';
  }
  function historySets(log){
    const groups=new Map();
    for(const result of Object.values(log.results)){if(!groups.has(result.exerciseId))groups.set(result.exerciseId,[]);groups.get(result.exerciseId).push(result);}
    return [...groups.values()].map(results=>'<div><b>'+escape(results[0].name)+'</b><p>'+results.map(result=>(result.weight??'—')+' kg × '+(result.reps??'—')).join(' · ')+'</p></div>').join('');
  }
  let lastTrackerKey=null,finishRequested=false;
  function trackerFooter(elapsed,nextAction){
    const label=nextAction==='skip'?'Skip rest':'Complete set';
    return `<div class="tracker-live-footer"><button type="button" class="btn-icon tracker-action" data-action="finish" aria-label="${escape(tr('Finish workout'))}"><span class="tracker-control-circle"></span><img class="tracker-control-art tracker-finish-art" src="./assets/figma/tracker/finish.svg" width="49" height="57" alt=""></button><span id="workout-elapsed" aria-label="${escape(tr('Elapsed time'))}"><span class="tracker-clock-digits">${elapsed}</span></span><button type="button" class="btn-icon tracker-action" data-action="${nextAction}" aria-label="${escape(tr(label))}"><span class="tracker-control-circle"></span><img class="tracker-control-art tracker-next-art" src="./assets/figma/tracker/next.svg" width="60" height="60" alt=""></button></div>`;
  }
  function renderTracker(){
    const current=locate(session),ex=current?.exercise,set=current?.set,ready=session.phase==='ready';
    const currentPanel=tracker.querySelector('.tracker-panel');
    const previous=currentPanel?.cloneNode?.(true),oldHeight=tracker.getBoundingClientRect?.().height||0;
    if(previous?.style&&globalThis.getComputedStyle)previous.style.background=getComputedStyle(currentPanel).background;
    const starting=!ready&&!!session.startedAt&&!!previous?.querySelector('.workout-start');
    const oldFill=tracker.querySelector('.tracker-rest-fill'),priorRestWidth=oldFill?.getBoundingClientRect?.().width;
    tracker.getAnimations?.().forEach(animation=>animation.cancel());tracker.style.overflow='';
    const key=session.id+':'+session.phase+':'+(session.current?.setId||'')+':'+finishRequested+':'+!!pendingCompletion+':'+busy;
    const elapsed=session.startedAt?time(((pendingCompletion?.endedAt||Date.now())-session.startedAt)/1000):'';
    let content='';
    if(ready){
      content=`<div class="tracker-controls"><button type="button" class="workout-start" data-action="start" aria-label="${escape(tr('Start workout'))}" title="${escape(tr('Start workout'))}"><img src="./assets/icons/play.svg?v=1.2.43" width="36" height="36" alt=""></button></div>`;
    }else{
      content=`<div class="tracker-display"><div class="tracker-active-header"><div class="tracker-exercise"><strong>${escape(session.phase==='rest'?tr('Rest'):ex?.name||tr('All sets completed'))}</strong></div><span id="workout-elapsed">${elapsed}</span></div>`;
      if(session.phase==='rest'){
        content+=`<div class="tracker-rest-body"><div class="workout-rest-circle"><svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="38" class="rest-track"/><circle id="workout-rest-progress" cx="45" cy="45" r="38" class="rest-progress"/></svg><span id="workout-rest-time"></span></div><div class="tracker-rest-add"><button type="button" class="btn-icon" data-action="rest30" aria-label="${escape(tr('+30 sec'))}" title="${escape(tr('+30 sec'))}"><img src="./assets/icons/plus-30sec.svg?v=1.2.43" width="46" height="46" alt=""></button><span class="tracker-rest-separator" aria-hidden="true"></span><button type="button" class="btn-icon" data-action="rest60" aria-label="${escape(tr('+1 min'))}" title="${escape(tr('+1 min'))}"><img src="./assets/icons/plus-1min.svg?v=1.2.43" width="46" height="46" alt=""></button></div></div>`;
      }else if(current){
        const actual=session.results[set.id]||{weight:set.weight,reps:trackerRepDefault(set.reps)};
        const weight=session.pending?.setId===set.id?session.pending.weight:actual.weight,reps=session.pending?.setId===set.id?session.pending.reps:actual.reps;
        content+=`${typeof set.reps==='string'?`<small class="workout-current-target">${escape(tr('Target reps'))}: ${escape(set.reps.replace('-','–'))}</small>`:''}<div class="tracker-metrics"><div class="tracker-metric tracker-set-stat"><div class="tracker-field"><span>${escape(tr('Set'))}</span><output class="tracker-set-number" aria-label="${escape(tr('Set'))} ${current.index+1}">${current.index+1}</output></div></div><div class="tracker-metric"><label class="tracker-field">${escape(tr('Weight (kg)'))}${number(weight,'current-weight','id="workout-current-weight"')}</label></div><div class="tracker-metric"><label class="tracker-field">${escape(tr('Reps'))}${number(reps,'current-reps','id="workout-current-reps"')}</label></div></div>`;

      }
      const nextAction=session.phase==='rest'?'skip':'complete',nextLabel=session.phase==='rest'?'Skip rest':'Complete set',done=session.phase==='complete';
      content+=`</div><div class="tracker-controls tracker-actions"><button type="button" class="btn-icon tracker-action" data-action="finish" aria-label="${escape(tr('Finish workout'))}" title="${escape(tr('Finish workout'))}"><img src="./assets/icons/close.svg?v=1.2.43" width="46" height="46" alt=""></button><button type="button" class="btn-icon tracker-action" data-action="${nextAction}" ${done?'disabled data-workout-locked="true"':''} aria-label="${escape(tr(nextLabel))}" title="${escape(tr(nextLabel))}"><img src="./assets/icons/arrow-right.svg?v=1.2.43" width="46" height="46" alt=""></button></div>`;
    }
    if(finishRequested)content=`<div class="tracker-finish-confirm" role="alertdialog" aria-labelledby="tracker-finish-question"><div class="tracker-message-title"><strong id="tracker-finish-question">${escape(tr('Finish this workout?'))}</strong></div><div class="tracker-confirm-buttons"><button type="button" class="btn btn-secondary btn-full" data-action="cancel-finish">${escape(tr('Cancel'))}</button><button type="button" class="btn btn-primary btn-full" data-action="confirm-finish">${escape(tr('Finish'))}</button></div></div>`;
    if(allSetsCompleted()&&!finishRequested&&!pendingCompletion)content=`<button type="button" class="tracker-finished" data-action="close-finished"><span class="tracker-message-title"><strong>${escape(tr('Workout Finished'))}</strong></span><span class="tracker-finished-hint">${escape(tr('Tap to close'))}</span></button>`;
    if(pendingCompletion&&busy)content=`<div class="tracker-upload tracker-uploading" role="status" aria-label="${escape(tr('Uploading…'))}"><span class="workout-upload-spinner" aria-hidden="true"></span></div>`;
    else if(pendingCompletion)content=`<div class="tracker-upload"><div class="tracker-display"><strong>${escape(tr('Workout saved on this device'))}</strong><p>${escape(tr(busy?'Uploading…':'Ready to retry upload'))}</p></div><div class="tracker-controls"><button type="button" class="btn btn-primary btn-full" data-action="${localFailure?'retry-local':'retry-upload'}">${escape(tr(busy?'Uploading…':localFailure?'Try again':'Retry upload'))}</button></div></div>`;
    const live=session.phase==='set'&&!!current&&!finishRequested&&!pendingCompletion;
    const resting=session.phase==='rest'&&!finishRequested&&!pendingCompletion;
    if(live){
      const actual=session.results[set.id]||{weight:set.weight,reps:trackerRepDefault(set.reps)};
      const weight=session.pending?.setId===set.id?session.pending.weight:actual.weight,reps=session.pending?.setId===set.id?session.pending.reps:actual.reps;
      const target=typeof set.reps==='string'?tr('Target reps')+': '+set.reps.replace('-','–'):'';
      content=`<div class="tracker-live-title"><strong>${escape(ex.name)}</strong></div><div class="tracker-live-metrics"><div class="tracker-live-metric"><span>${escape(tr('Set')==='Set'?'SETs':tr('Set'))}</span><output class="tracker-set-number" aria-label="${escape(tr('Set'))} ${current.index+1}">${current.index+1}</output></div><label class="tracker-live-metric tracker-live-weight"><span>${escape(tr('Weight (kg)')==='Weight (kg)'?'WEIGHT(kg)':tr('Weight (kg)'))}</span>${number(weight,'current-weight','id="workout-current-weight" aria-label="'+escape(tr('Weight (kg)'))+'"')}<img class="tracker-input-line" src="./assets/figma/tracker/weight-line.svg" width="153" height="1" alt=""></label><label class="tracker-live-metric tracker-live-reps"><span>${escape(tr('Reps')==='Reps'?'REPs':tr('Reps'))}</span>${number(reps,'current-reps','id="workout-current-reps" aria-label="'+escape(tr('Reps'))+'" title="'+escape(target)+'"')}<img class="tracker-input-line" src="./assets/figma/tracker/reps-line.svg" width="107" height="1" alt=""></label></div>${trackerFooter(elapsed,'complete')}`;
    }
    if(resting)content=`<div class="tracker-rest-layer"><div class="tracker-rest-background"><div class="tracker-rest-fill" aria-hidden="true"></div></div><div class="tracker-rest-word">${escape(tr('Rest'))}</div><div class="tracker-rest-countdown" aria-label="${escape(tr('Rest'))}" role="timer"><span id="workout-rest-time" class="tracker-clock-digits"></span></div><div class="tracker-rest-extension"><button type="button" data-action="rest30" aria-label="${escape(tr('+30 sec'))}"><span class="tracker-rest-add-icon" style="--rest-add-icon:url('../assets/icons/plus-30sec.svg')" aria-hidden="true"></span></button><button type="button" data-action="rest60" aria-label="${escape(tr('+1 min'))}"><span class="tracker-rest-add-icon" style="--rest-add-icon:url('../assets/icons/plus-1min.svg')" aria-hidden="true"></span></button></div></div>${trackerFooter(elapsed,'skip')}`;
    if(live){const footerStart=content.indexOf('<div class="tracker-live-footer">');content='<div class="tracker-phase-content">'+content.slice(0,footerStart)+'</div>'+content.slice(footerStart);}
    if(error&&!busy)content=content.replace('<div class="tracker-display">',`<div class="tracker-display"><p class="workout-error" role="alert">${escape(error)}</p>`);
    tracker.classList.toggle('tracker-ready',ready);
    tracker.classList.toggle('tracker-live',!ready);
    tracker.classList.toggle('tracker-rest',resting);
    tracker.classList.toggle('tracker-message',!ready&&!live&&!resting);
    tracker.classList.toggle('tracker-translucent-message',finishRequested||(allSetsCompleted()&&!pendingCompletion)||!!(pendingCompletion&&busy));
    const sharedPhase=!!currentPanel?.classList?.contains?.('tracker-live-panel')&&(live||resting);
    if(sharedPhase){
      // Keep the connected footer and its foreground nodes throughout phase changes.
      const footer=currentPanel.querySelector('.tracker-live-footer');
      for(const child of [...currentPanel.children])if(child!==footer)child.remove();
      currentPanel.insertAdjacentHTML('afterbegin',content.slice(0,content.indexOf('<div class="tracker-live-footer">')));
      const next=footer.querySelector('[data-action="skip"], [data-action="complete"]');
      next.dataset.action=resting?'skip':'complete';
      next.setAttribute('aria-label',tr(resting?'Skip rest':'Complete set'));
      tracker.querySelectorAll('.tracker-transition-old').forEach(panel=>panel.remove());
    }else tracker.innerHTML=`<div class="tracker-panel${live||resting?' tracker-live-panel':''}">${content}</div>`;
    if(!ready)fitLiveTracker();
    animateRestFill(priorRestWidth);tickText();
    if(sharedPhase&&key!==lastTrackerKey){
      if(!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
        const body=tracker.querySelector(resting?'.tracker-rest-layer':'.tracker-phase-content');body?.animate?.([{opacity:0},{opacity:1}],{duration:240});
        previous.querySelector('.tracker-live-footer')?.remove();
        const fill=previous.querySelector('.tracker-rest-fill');if(fill&&Number.isFinite(priorRestWidth))fill.style.width=priorRestWidth+'px';
        previous.classList.add('tracker-transition-old');previous.inert=true;previous.setAttribute('aria-hidden','true');
        for(const item of previous.querySelectorAll('[id]'))item.removeAttribute('id');tracker.appendChild(previous);
        previous.animate?.([{opacity:1},{opacity:0}],{duration:240}).finished.catch(()=>{}).finally(()=>previous.remove());
      }
      lastTrackerKey=key;return;
    }
    if(key!==lastTrackerKey&&previous&&tracker.animate&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      const newHeight=tracker.getBoundingClientRect().height;
      tracker.style.overflow='hidden';
      const duration=starting?900:420;
      tracker.animate(starting?[
        {height:oldHeight+'px',backgroundColor:'#000'},
        {height:newHeight+'px',backgroundColor:'#000',offset:.94},
        {height:newHeight+'px',backgroundColor:'#fff'}
      ]:[{height:oldHeight+'px'},{height:newHeight+'px'}],{duration,easing:'cubic-bezier(.22,.8,.25,1)'}).finished.catch(()=>{}).finally(()=>{if(key===lastTrackerKey)tracker.style.overflow='';});
      const panel=tracker.querySelector('.tracker-panel');panel.animate?.([{opacity:0},{opacity:1}],{duration:240,delay:starting?900:pendingCompletion&&busy?0:100,fill:'backwards'});
      if(starting){
        const fill=document.createElement('img');fill.src=previous.querySelector('.workout-start img').getAttribute('src');fill.alt='';fill.className='tracker-play-fill';fill.setAttribute('aria-hidden','true');tracker.appendChild(fill);
        const scale=Math.ceil(Math.hypot(tracker.getBoundingClientRect().width,newHeight)/8);
        fill.animate([{transform:'scale(1)'},{transform:`scale(${scale})`}],{duration:900,easing:'cubic-bezier(.45,0,.2,1)',fill:'forwards'}).finished.catch(()=>{}).finally(()=>fill.remove());
      }else if(!(pendingCompletion&&busy)){
      previous.classList.add('tracker-transition-old');previous.classList.toggle('tracker-was-ready',previous.querySelector('.workout-start')!==null);previous.setAttribute('aria-hidden','true');previous.inert=true;
      for(const item of previous.querySelectorAll('[id]'))item.removeAttribute('id');tracker.appendChild(previous);
      previous.animate?.([{opacity:1},{opacity:0}],{duration:140,fill:'forwards'}).finished.catch(()=>{}).finally(()=>previous.remove());
      }
    }
    lastTrackerKey=key;
  }
  function animateRestFill(priorWidth){
    if(session.phase!=='rest')return;
    const fill=tracker.querySelector('.tracker-rest-fill');if(!fill)return;
    const {remainingMs,fraction}=restProgress(session),width=tracker.getBoundingClientRect?.().width||tracker.clientWidth||0;
    fill.style.width=(fraction*100)+'%';
    if(!fill.animate||!width||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){if(fill.dataset)fill.dataset.animated='false';return;}
    if(fill.dataset)fill.dataset.animated='true';
    const target=width*fraction;
    if(Number.isFinite(priorWidth)&&Math.abs(priorWidth-target)>.5&&remainingMs>300){
      const next=width*restProgress(session,Date.now()+300).fraction;
      fill.animate([{width:priorWidth+'px'},{width:next+'px'}],{duration:300,easing:'ease-out',fill:'forwards'});
      fill.animate([{width:next+'px'},{width:'0px'}],{delay:300,duration:Math.max(1,remainingMs-300),easing:'linear',fill:'forwards'});
    }else fill.animate([{width:target+'px'},{width:'0px'}],{duration:Math.max(1,remainingMs),easing:'linear',fill:'forwards'});
  }
  function tickText(){
    const elapsed=tracker.querySelector('#workout-elapsed'),digits=elapsed?.querySelector?.('.tracker-clock-digits');
    if(elapsed){(digits||elapsed).textContent=session?.startedAt?time(((pendingCompletion?.endedAt||Date.now())-session.startedAt)/1000):'00:00';if(digits)alignTrackerClock(digits);}
    if(session?.phase==='rest'){
      const seconds=Math.max(0,Math.ceil((session.restUntil-Date.now())/1000));
      const label=tracker.querySelector('#workout-rest-time'),fill=tracker.querySelector('.tracker-rest-fill');
      if(label){label.textContent=time(seconds);alignTrackerClock(label);}
      if(fill&&fill.dataset?.animated!=='true')fill.style.width=(restProgress(session).fraction*100)+'%';
    }
  }
  function tick(){
    if(!session?.startedAt||busy||localBusy||pendingCompletion||owner!==getUid())return;
    if(allSetsCompleted())return;
    if(session.phase==='rest'&&Date.now()>=session.restUntil){performLocal(async()=>{advanceRest(session);await saveSession();});return;}
    tickText();
  }
  function input(event){
    const el=event.target,field=el.dataset.field,workout=currentWorkout();
    if(!field||!workout)return;
    if(field==='count'){changed(event,true);return;}
    if(field==='name'){workout.name=el.value;el.classList?.toggle('named',!!el.value.trim());}
    else if(field==='current-weight'||field==='current-reps'){
      const current=locate(session);if(!current)return;
      const actual=session.results[current.set.id]||{weight:current.set.weight,reps:trackerRepDefault(current.set.reps)};
      session.pending??={setId:current.set.id,weight:actual.weight,reps:actual.reps};
      session.pending[field==='current-weight'?'weight':'reps']=el.value;
      fitLiveTracker();
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
    const before=captureSetLayout(root.querySelector('[data-set-list="'+exercise.id+'"]'));
    while(exercise.sets.length<count)exercise.sets.push(newSet());
    if(exercise.sets.length>count)exercise.sets.length=count;
    repairCurrent();saveEdit();
    const list=root.querySelector('[data-set-list="'+exercise.id+'"]');if(list){list.innerHTML=setRows(exercise,view==='session');animateSetLayout(list,before);}if(view==='session'&&visible)renderTracker();followCurrentSet();
  }
  function repairCurrent(){
    if(!session)return;
    if(!locate(session)){session.current=nextPosition(session);session.pending=null;if(session.startedAt){session.phase=session.current?'set':'complete';session.restUntil=null;}}
  }
  async function action(event){
    const target=event.target.closest('[data-action]');if(!target||busy||localBusy)return;
    const type=target.dataset.action,workout=currentWorkout();
    if(type==='start'&&session?.startedAt)return;
    if(type==='start'&&!workout?.exercises.length){
      error='';root.querySelector('.workout-error')?.remove?.();
      if(!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)target.animate?.([{transform:'translateX(0)'},{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:360,easing:'ease-out'});
      return;
    }
    if(type==='finish'){if(!session?.startedAt)return;finishRequested=true;renderTracker();disable(busy);tracker.querySelector('[data-action="cancel-finish"]')?.focus?.({preventScroll:true});return;}
    if(type==='cancel-finish'){finishRequested=false;renderTracker();disable(busy);return;}
    if(type==='confirm-finish'){if(!finishRequested)return;finishRequested=false;await finishWorkout();return;}
    if(type==='close-finished'){if(allSetsCompleted())await finishWorkout();return;}
    if(type==='retry-upload'){await finishWorkout();return;}
    if(type==='retry-local'){const failed=localFailure;if(failed){try{await saveLocalRecord(failed.record);}catch{}render();}return;}
    if(type==='retry-edits'){const job=editFailure;if(job){editTail=editTail.then(()=>saveEditSnapshot(job));await editTail;}return;}
    if(type==='target-reps'){const set=workout?.exercises.find(ex=>ex.id===target.dataset.ex)?.sets.find(item=>item.id===target.dataset.set);if(set)repsPicker.open(set.reps,{ex:target.dataset.ex,set:target.dataset.set,generation:epoch});return;}
    if(type==='toggle-exercise'){toggleExercise(target.dataset.id);return;}
    if(type==='toggle-picker'){exercisePicker.open(catalog);return;}
    if(type==='delete-workout'){
      const active=session?.startedAt&&session.templateId===workout?.id;
      if(!workout||!globalThis.confirm?.(tr(active?'Delete this workout and end its current session?':'Delete this workout?')))return;
      await perform(async()=>{
        const writes=[{path:path('workoutTemplates',workout.id),value:{...copy(workout),archived:true,updatedAt:Date.now()}}];
        if(active)writes.push({path:path('settings','workoutActive'),value:{session:null,updatedAt:Date.now()}});
        await commit(writes);templates=templates.filter(item=>item.id!==workout.id);
        if(session?.templateId===workout.id)session=null;
        draft=null;newWorkoutId=null;finishRequested=false;view='library';
        if(active){pendingCompletion=null;await saveLocalRecord({session:null,completion:null,updatedAt:Date.now()});}
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
    if(type==='add-set'){const ex=workout.exercises.find(item=>item.id===target.dataset.ex);if(ex&&ex.sets.length<50){const before=captureSetLayout(root.querySelector('[data-set-list="'+ex.id+'"]'));ex.sets.push(newSet());repairCurrent();saveEdit();render();animateSetLayout(root.querySelector('[data-set-list="'+ex.id+'"]'),before);}return;}
    if(type==='remove-exercise'){if(view==='session'&&session?.startedAt&&session.current?.exerciseId===target.dataset.id)return;if(!globalThis.confirm?.(tr('Delete this exercise?')))return;expanded.delete(target.dataset.id);workout.exercises=workout.exercises.filter(ex=>ex.id!==target.dataset.id);repairCurrent();saveEdit();render();return;}
    if(type==='remove-set'){const ex=workout.exercises.find(item=>item.id===target.dataset.ex);if(ex&&ex.sets.length>1){const before=captureSetLayout(root.querySelector('[data-set-list="'+ex.id+'"]'));ex.sets=ex.sets.filter(set=>set.id!==target.dataset.set);repairCurrent();saveEdit();render();animateSetLayout(root.querySelector('[data-set-list="'+ex.id+'"]'),before);}else{error=tr('Each exercise needs between 1 and 50 sets.');render();}return;}
    if(type==='jump'||type==='jump-exercise'){
      if(view!=='session')return;
      const exercise=workout.exercises.find(ex=>ex.id===(target.dataset.ex||target.dataset.id));
      const set=type==='jump'?exercise?.sets.find(s=>s.id===target.dataset.set):exercise?.sets.find(s=>!session.results[s.id])||exercise?.sets[0];
      if(set)await performLocal(async()=>{selectSet(session,exercise.id,set.id);session.pending=null;await saveSession();});return;
    }
    if(['start','complete','rest30','rest60','skip'].includes(type)){
      await performLocal(async()=>{
      if(type==='start'){if(view==='editor'){if(session?.startedAt)throw Error('Finish the current workout first.');session=createSession(draft);view='session';}validateWorkout(session.workout);startSession(session);session.pending=null;await saveSession();}
      else if(type==='complete'){
        const current=locate(session),weight=tracker.querySelector('#workout-current-weight').value,reps=tracker.querySelector('#workout-current-reps').value;
        const record=completeSet(session,weight,reps,bests[current.exercise.exerciseId]);bests[record.exerciseId]=record.best;session.pending=null;
        await saveSession();
      }else if(type==='rest30'||type==='rest60'){extendRest(session,type==='rest30'?30:60);await saveSession();}
      else if(type==='skip'){session.restUntil=Date.now();advanceRest(session);await saveSession();}

      });return;
    }
    await perform(async()=>{
      if(type==='custom'){
        const name=root.querySelector('#workout-custom-name').value.trim();if(!name)throw Error('Enter an exercise name.');
        const ex={id:uid(),name,category:root.querySelector('#workout-custom-category').value};catalog.push(ex);workout.exercises.push(exerciseInstance(ex));repairCurrent();
        await commit([{path:path('settings','workoutCatalog'),value:{exercises:catalog}}]);saveEdit();
      }
    });
  }
  const reorder=setupCompactReorder(root,{items:'.workout-exercise',handle:'.workout-drag',canDrag:()=>!busy&&!localBusy&&!pendingCompletion&&!transitioning,getLabel:row=>row.querySelector('.workout-exercise-name').textContent,getCompactHeight:row=>{
    const body=row.querySelector('.workout-exercise-body'),hidden=body.hidden;
    try{body.hidden=true;return row.getBoundingClientRect().height;}finally{body.hidden=hidden;}
  },onDrop:order=>{
    const workout=currentWorkout();if(!workout)return;
    workout.exercises=order.map(id=>workout.exercises.find(ex=>ex.id===id)).filter(Boolean);saveEdit();render();
  }});
  const libraryReorder=setupCompactReorder(root,{items:'.workout-card',handle:'.workout-card-drag',canDrag:()=>view==='library'&&!busy&&!transitioning,getLabel:row=>row.querySelector('.workout-open strong').textContent,onDrop:order=>{
    perform(async()=>{await commit([{path:path('settings','workoutOrder'),value:{ids:order,updatedAt:Date.now()}}]);templates=order.map(id=>templates.find(workout=>workout.id===id)).filter(Boolean);});
  }});
  const exercisePicker=createExercisePicker(document.getElementById?.('modal-exercise-picker'),{tr,onCatalogChange:async next=>{
    let success=false;
    await perform(async()=>{await commit([{path:path('settings','workoutCatalog'),value:{exercises:next}}]);catalog=copy(next);success=true;});
    return success;
  },onAdd:async chosen=>{
    if(!chosen.length||!currentWorkout())return false;
    let success=false;
    await perform(async()=>{
      const workout=copy(currentWorkout());workout.exercises.push(...chosen.map(exerciseInstance));validateWorkout(workout,{allowDraft:true});workout.updatedAt=Date.now();
      const additions=chosen.filter(item=>!catalog.some(existing=>existing.id===item.id)),nextCatalog=[...catalog,...additions];
      const writes=[{path:path('workoutTemplates',workout.id),value:workout}];
      if(additions.length)writes.push({path:path('settings','workoutCatalog'),value:{exercises:nextCatalog}});
      const nextSession=view==='session'?{...copy(session),workout}:null;
      await commit(writes);catalog=nextCatalog;
      if(view==='editor')draft=workout;else session=nextSession;
      const index=templates.findIndex(item=>item.id===workout.id);if(index<0)templates.push(copy(workout));else templates[index]=copy(workout);
      repairCurrent();success=true;if(nextSession?.startedAt)await saveSession();
    });return success;
  }});
  async function removeHistory(id){
    const log=history.find(item=>item.id===id);if(!log||busy||!globalThis.confirm?.(tr('Delete this workout record?')))return false;
    let removed=false;
    await perform(async()=>{await commit([{path:path('workoutSessions',id),value:{...copy(log),deleted:true,updatedAt:Date.now()}}]);history=history.filter(item=>item.id!==id);removed=true;});
    return removed;
  }
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
  function setVisible(value){if(!value)finishRequested=false;visible=value;tracker.hidden=!value||view!=='session'||!session?.startedAt;followCurrentSet();}
  globalThis.visualViewport?.addEventListener('resize',followCurrentSet);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>root.style.setProperty('--workout-tracker-height',tracker.getBoundingClientRect().height+'px')).observe(tracker);
  return {open,create,reset,refresh,setVisible,historyHTML,removeHistory,flushEdits};
}
