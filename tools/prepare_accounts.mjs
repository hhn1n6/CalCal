import fs from 'node:fs';

const email=(process.argv[2]||'').trim().toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Supply the original owner’s Google account email.');
const base='https://firestore.googleapis.com/v1/projects/fitness-352e8/databases/(default)/documents';
async function get(path){
  const response=await fetch(`${base}/${path}`);
  if(!response.ok)throw new Error(`${path}: ${await response.text()}`);
  return response.json();
}
const [foods,lists,goals,weights]=await Promise.all(['CalCal/foods','CalCal/foodLists','CalCal/goals','CalCal/weights'].map(get));
let days=[],pageToken='';
do{
  const response=await fetch(`${base}/days?pageSize=300${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}`);
  if(!response.ok)throw new Error(await response.text());
  const page=await response.json();days.push(...(page.documents||[]));pageToken=page.nextPageToken||'';
}while(pageToken);
const backupFile=new URL(`./accounts-legacy-backup-${Date.now()}.json`,import.meta.url);
fs.writeFileSync(backupFile,JSON.stringify({email,foods,lists,goals,weights,days},null,2));
const snapshot=[
  ['migration/legacy/settings/foods',foods.fields],
  ['migration/legacy/settings/foodLists',lists.fields],
  ['migration/legacy/settings/goals',goals.fields],
  ['migration/legacy/settings/weights',weights.fields],
  ...days.map(document=>['migration/legacy/days/'+document.name.split('/').at(-1),document.fields]),
];
const writes=[
  ['migration/owner',{email:{stringValue:email}}],
  ['migration/legacy',{available:{booleanValue:true},ownerEmail:{stringValue:email},dayCount:{integerValue:String(days.length)},foodCount:{integerValue:String(foods.fields.foods.arrayValue.values.length)}}],
  ['access/admin',{email:{stringValue:email}}],
  ...snapshot,
].map(([path,fields])=>({update:{name:`projects/fitness-352e8/databases/(default)/documents/${path}`,fields},currentDocument:{exists:false}}));
// Abort if any source record changes while this snapshot is being prepared.
const sources=[foods,lists,goals,weights,...days];
writes.unshift(...sources.map(document=>({verify:document.name,currentDocument:{updateTime:document.updateTime}})));
if(writes.length>500)throw new Error('More than 500 writes/verifications: assisted migration required. Backup was saved.');
console.log(`Backed up ${days.length} days, ${lists.fields.lists.arrayValue.values.length} categories and ${foods.fields.foods.arrayValue.values.length} foods. Owner: ${email}. No public/default food database will be created.`);
if(process.argv.includes('--apply')){
  const response=await fetch(`${base}:commit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes})});
  if(!response.ok)throw new Error(await response.text());
  const saved=await response.json();
  // Verify the saved snapshot, independently of the write response.
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  for(const [path,fields] of snapshot){
    const document=await get(path);
    if(JSON.stringify(canonical(document.fields))!==JSON.stringify(canonical(fields)))throw new Error(`Verification failed: ${path}`);
  }
  for(const [path,fields] of [['migration/owner',{email:{stringValue:email}}],['access/admin',{email:{stringValue:email}}]]){
    if(JSON.stringify(canonical((await get(path)).fields))!==JSON.stringify(canonical(fields)))throw new Error(`Verification failed: ${path}`);
  }
  console.log(`Verified ${snapshot.length+3} new documents linked to the owner's verified Google email. Existing records were preserved. UID import happens at the owner's first sign-in.`);
}
