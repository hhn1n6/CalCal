export function mergeWorkoutBests(existing,results){
  const merged=JSON.parse(JSON.stringify(existing||{}));
  for(const result of Object.values(results||{})){
    if(result.weight===null||result.reps===null||!Number.isFinite(result.weight)||!Number.isFinite(result.reps))continue;
    const best=merged[result.exerciseId]||{byWeight:{}};best.byWeight??={};
    best.bestWeight=Math.max(best.bestWeight??0,result.weight);
    best.byWeight[String(result.weight)]=Math.max(best.byWeight[String(result.weight)]??0,result.reps);
    merged[result.exerciseId]=best;
  }
  return merged;
}
export async function finishWorkoutInCloud({store,uid,completion}){
  const base=['users',uid],recordPath=[...base,'workoutSessions',completion.sessionId];
  // Replaying an interrupted upload must never create another history entry or
  // resurrect an entry the user has since removed.
  if(completion.log){const existing=await store.read(recordPath);if(existing)return {log:existing,bests:null};}
  const template=await store.read([...base,'workoutTemplates',completion.workout.id]);
  if(template?.archived)throw Error('This workout was deleted.');
  const ids=[...new Set(Object.values(completion.log?.results||{}).filter(item=>item.weight!==null&&item.reps!==null).map(item=>item.exerciseId))];
  const records=await Promise.all(ids.map(async id=>[id,await store.read([...base,'workoutBests',id])]));
  const bests=mergeWorkoutBests(Object.fromEntries(records.filter(([,value])=>value)),completion.log?.results);
  const writes=[{path:[...base,'settings','workoutActive'],value:{session:null,updatedAt:completion.endedAt}}];
  if(completion.log){
    writes.push({path:recordPath,value:completion.log},{path:[...base,'workoutTemplates',completion.workout.id],value:completion.workout});
    for(const id of ids)writes.push({path:[...base,'workoutBests',id],value:bests[id]});
  }
  await store.commit(writes);return {log:completion.log,bests};
}
