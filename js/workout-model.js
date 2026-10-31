export const copy=value=>JSON.parse(JSON.stringify(value));
export const uid=()=>globalThis.crypto?.randomUUID?.()||'w'+Date.now().toString(36)+Math.random().toString(36).slice(2);
export function optionalNumber(value,kind){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>(kind==='reps'?10000:2000)||(kind==='reps'&&!Number.isInteger(n)))throw Error('Enter valid weight and whole-number reps.');
  return n;
}
export function targetRepBounds(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const match=String(value).trim().match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
  if(!match)throw Error('Enter a whole-number rep target or range.');
  const min=Number(match[1]),max=Number(match[2]??match[1]);
  if(min>max||max>10000)throw Error('Enter a valid rep range (minimum ≤ maximum).');
  return {min,max};
}
export function targetReps(value){const bounds=targetRepBounds(value);return bounds?(bounds.min===bounds.max?bounds.min:`${bounds.min}-${bounds.max}`):null;}
export function trackerRepDefault(value){return targetRepBounds(value)?.min??null;}
export function newSet(){return {id:uid(),weight:null,reps:null};}
export function exerciseInstance(exercise){return {id:uid(),exerciseId:exercise.id,name:exercise.name,category:exercise.category,restSeconds:90,sets:[newSet()]};}
export const exerciseVariants=exercise=>[exercise,...(exercise.alternatives||[])];
export const allExercises=workout=>(workout?.exercises||[]).flatMap(exerciseVariants);
export const exerciseGroup=(workout,id)=>workout.exercises.find(group=>exerciseVariants(group).some(ex=>ex.id===id));
export const activeExercise=group=>exerciseVariants(group).find(ex=>ex.id===group.selectedExerciseId)||group;
export function positions(workout){return workout.exercises.flatMap(group=>{const exercise=activeExercise(group);return exercise.sets.map(set=>({exerciseId:exercise.id,setId:set.id}));});}
export function locate(session,position=session.current){
  const exercise=allExercises(session.workout).find(e=>e.id===position?.exerciseId);
  const index=exercise?.sets.findIndex(s=>s.id===position?.setId)??-1;
  return index<0?null:{exercise,set:exercise.sets[index],index};
}
export function createSession(template,now=Date.now()){
  return {id:uid(),templateId:template.id,workout:copy(template),createdAt:now,startedAt:null,phase:'ready',current:positions(template)[0]||null,restUntil:null,restTotal:0,results:{}};
}
export function nextPosition(session){
  const sets=positions(session.workout);
  const currentIndex=sets.findIndex(p=>p.exerciseId===session.current?.exerciseId&&p.setId===session.current?.setId);
  const start=currentIndex>=0?currentIndex:Number.isInteger(session.cursorIndex)?session.cursorIndex:session.phase==='complete'?sets.length:0;
  return sets.slice(start).find(p=>!session.results[p.setId])||null;
}
export function startSession(session,now=Date.now()){
  if(!positions(session.workout).length)throw Error('Add at least one exercise and set.');
  session.startedAt??=now;session.phase='set';session.current=nextPosition(session)||positions(session.workout)[0];session.restUntil=null;
  session.cursorIndex=positions(session.workout).findIndex(p=>p.setId===session.current.setId);
}
export function completeSet(session,weight,reps,best={},now=Date.now()){
  const current=locate(session);
  if(!current||!session.startedAt||session.phase!=='set')throw Error('Start the workout before logging a set.');
  weight=optionalNumber(weight,'weight');reps=optionalNumber(reps,'reps');
  session.results[current.set.id]={exerciseId:current.exercise.exerciseId,name:current.exercise.name,weight,reps,completedAt:now};
  const updated=copy(best);updated.byWeight??={};
  if(weight!==null&&reps!==null){
    updated.bestWeight=Math.max(updated.bestWeight??0,weight);
    updated.byWeight[String(weight)]=Math.max(updated.byWeight[String(weight)]??0,reps);
  }
  const next=nextPosition(session);session.current=next;
  session.cursorIndex=next?positions(session.workout).findIndex(p=>p.setId===next.setId):positions(session.workout).length;
  const rest=Number(current.exercise.restSeconds)||0;
  session.phase=!next?'complete':rest>0?'rest':'set';
  session.restTotal=rest;session.restUntil=session.phase==='rest'?now+rest*1000:null;
  return {exerciseId:current.exercise.exerciseId,best:updated};
}
export function advanceRest(session,now=Date.now()){
  if(session.phase!=='rest'||now<session.restUntil)return false;
  const next=nextPosition(session);session.phase=next?'set':'complete';session.current=next;
  session.cursorIndex=next?positions(session.workout).findIndex(p=>p.setId===next.setId):positions(session.workout).length;
  session.restUntil=null;return true;
}
export function extendRest(session,seconds){if(session.phase==='rest'){session.restUntil+=seconds*1000;session.restTotal+=seconds;}}
export function restProgress(session,now=Date.now()){
  const remainingMs=Math.max(0,(session.restUntil||0)-now);
  return {remainingMs,fraction:Math.max(0,Math.min(1,remainingMs/Math.max(1000,session.restTotal*1000)))};
}
export function selectSet(session,exerciseId,setId){
  if(!locate(session,{exerciseId,setId}))throw Error('This set no longer exists.');
  const group=exerciseGroup(session.workout,exerciseId);group.selectedExerciseId=exerciseId;
  session.current={exerciseId,setId};session.restUntil=null;if(session.startedAt)session.phase='set';
  session.cursorIndex=positions(session.workout).findIndex(p=>p.setId===setId);
}
export function selectAlternative(session,groupId,exerciseId){
  const group=session.workout.exercises.find(ex=>ex.id===groupId);
  if(!group||!exerciseVariants(group).some(ex=>ex.id===exerciseId))throw Error('This exercise no longer exists.');
  const currentGroup=exerciseGroup(session.workout,session.current?.exerciseId);
  group.selectedExerciseId=exerciseId;
  if(!session.startedAt){session.current=positions(session.workout)[0]||null;return;}
  if(currentGroup===group&&['set','rest'].includes(session.phase)){
    const following=session.workout.exercises.slice(session.workout.exercises.indexOf(group));
    session.current=positions({exercises:following}).find(p=>!session.results[p.setId])||null;
    session.phase=session.current?'set':'complete';session.restUntil=null;session.pending=null;
  }
  session.cursorIndex=session.current?positions(session.workout).findIndex(p=>p.setId===session.current.setId):positions(session.workout).length;
}
export function validateWorkout(workout,{allowDraft=false}={}){
  if(typeof workout.name!=='string'||workout.name.length>100)throw Error('Enter a workout name.');
  if(!Array.isArray(workout.exercises)||(!allowDraft&&!workout.exercises.length)||workout.exercises.length>50)throw Error('Add between 1 and 50 exercises.');
  for(const group of workout.exercises){
    if(group.alternatives&&(!Array.isArray(group.alternatives)||group.alternatives.length>50))throw Error('Each exercise supports up to 50 alternatives.');
    if(group.selectedExerciseId&&!exerciseVariants(group).some(ex=>ex.id===group.selectedExerciseId))throw Error('This exercise no longer exists.');
    for(const exercise of exerciseVariants(group)){
    if(exercise!==group&&exercise.alternatives?.length)throw Error('Alternative exercises cannot contain alternatives.');
    if(!exercise.sets?.length||exercise.sets.length>50)throw Error('Each exercise needs between 1 and 50 sets.');
    if(!Number.isInteger(Number(exercise.restSeconds))||exercise.restSeconds<0||exercise.restSeconds>3600)throw Error('Rest time must be 0–3600 seconds.');
    for(const set of exercise.sets){set.weight=optionalNumber(set.weight,'weight');set.reps=targetReps(set.reps);}
    }
  }
  return workout;
}
