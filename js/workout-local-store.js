// Private to this browser and keyed by Firebase UID. Resolve writes only after
// the IndexedDB transaction commits, not merely after the request succeeds.
export function createWorkoutLocalStore(database=globalThis.indexedDB){
  let connection=null;
  function open(){
    if(!database)return Promise.reject(Error('Local workout storage is unavailable.'));
    if(!connection)connection=new Promise((resolve,reject)=>{
      const request=database.open('calcal-workout-progress',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('accounts'))request.result.createObjectStore('accounts');};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
      request.onerror=()=>{connection=null;reject(request.error||Error('Could not open local workout storage.'));};
      request.onblocked=()=>{connection=null;reject(Error('Local workout storage is blocked.'));};
    });
    return connection;
  }
  async function access(uid,mode,value){
    if(!uid)throw Error('An account is required for local workout storage.');
    const db=await open();
    return new Promise((resolve,reject)=>{
      let result=null,transaction;
      try{transaction=db.transaction('accounts',mode);const store=transaction.objectStore('accounts');const request=mode==='readonly'?store.get(uid):store.put(value,uid);request.onsuccess=()=>{result=request.result??null;};}
      catch(error){reject(error);return;}
      transaction.oncomplete=()=>resolve(mode==='readonly'?result:undefined);
      transaction.onabort=transaction.onerror=()=>reject(transaction.error||Error('Could not save local workout progress.'));
    });
  }
  return {read:uid=>access(uid,'readonly'),write:(uid,value)=>access(uid,'readwrite',value)};
}
