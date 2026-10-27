export const copy=value=>JSON.parse(JSON.stringify(value));
export const uid=()=>globalThis.crypto?.randomUUID?.()||'w'+Date.now().toString(36)+Math.random().toString(36).slice(2);
export function optionalNumber(value,kind){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>(kind==='reps'?10000:2000)||(kind==='reps'&&!Number.isInteger(n)))throw Error('Enter valid weight and whole-number reps.');
  return n;
}
export function newSet(){return {id:uid(),weight:null,reps:null};}
export function exerciseInstance(exercise){return {id:uid(),exerciseId:exercise.id,name:exercise.name,category:exercise.category,restSeconds:90,sets:[newSet()]};}
export function positions(workout){return workout.exercises.flatMap(exercise=>exercise.sets.map(set=>({exerciseId:exercise.id,setId:set.id})));}
export function locate(session,position=session.current){
  const exercise=session.workout.exercises.find(e=>e.id===position?.exerciseId);
  const index=exercise?.sets.findIndex(s=>s.id===position?.setId)??-1;
  return index<0?null:{exercise,set:exercise.sets[index],index};
}
export function createSession(template,now=Date.now()){
  return {id:uid(),templateId:template.id,workout:copy(template),createdAt:now,startedAt:null,phase:'ready',current:positions(template)[0]||null,restUntil:null,restTotal:0,results:{}};
}
export function nextPosition(session){return positions(session.workout).find(p=>!session.results[p.setId])||null;}
export function startSession(session,now=Date.now()){
  if(!positions(session.workout).length)throw Error('Add at least one exercise and set.');
  session.startedAt??=now;session.phase='set';session.current=nextPosition(session)||positions(session.workout)[0];session.restUntil=null;
}
export function completeSet(session,weight,reps,best={},now=Date.now()){
  const current=locate(session);
  if(!current||!session.startedAt||session.phase!=='set')throw Error('Start the workout before logging a set.');
  weight=optionalNumber(weight,'weight');reps=optionalNumber(reps,'reps');
  current.set.weight=weight;current.set.reps=reps;
  session.results[current.set.id]={exerciseId:current.exercise.exerciseId,name:current.exercise.name,weight,reps,completedAt:now};
  const updated=copy(best);updated.byWeight??={};
  if(weight!==null&&reps!==null){
    updated.bestWeight=Math.max(updated.bestWeight??0,weight);
    updated.byWeight[String(weight)]=Math.max(updated.byWeight[String(weight)]??0,reps);
  }
  const next=nextPosition(session);session.current=next;
  const rest=Number(current.exercise.restSeconds)||0;
  session.phase=!next?'complete':rest>0?'rest':'set';
  session.restTotal=rest;session.restUntil=session.phase==='rest'?now+rest*1000:null;
  return {exerciseId:current.exercise.exerciseId,best:updated};
}
export function advanceRest(session,now=Date.now()){
  if(session.phase!=='rest'||now<session.restUntil)return false;
  session.phase=nextPosition(session)?'set':'complete';session.current=nextPosition(session);session.restUntil=null;return true;
}
export function extendRest(session,seconds){if(session.phase==='rest'){session.restUntil+=seconds*1000;session.restTotal+=seconds;}}
export function selectSet(session,exerciseId,setId){
  if(!locate(session,{exerciseId,setId}))throw Error('This set no longer exists.');
  session.current={exerciseId,setId};session.restUntil=null;if(session.startedAt)session.phase='set';
}
export function validateWorkout(workout){
  if(!workout.name?.trim())throw Error('Enter a workout name.');
  if(!workout.exercises?.length||workout.exercises.length>50)throw Error('Add between 1 and 50 exercises.');
  for(const exercise of workout.exercises){
    if(!exercise.sets?.length||exercise.sets.length>50)throw Error('Each exercise needs between 1 and 50 sets.');
    if(!Number.isInteger(Number(exercise.restSeconds))||exercise.restSeconds<0||exercise.restSeconds>3600)throw Error('Rest time must be 0–3600 seconds.');
    for(const set of exercise.sets){set.weight=optionalNumber(set.weight,'weight');set.reps=optionalNumber(set.reps,'reps');}
  }
  return workout;
}
