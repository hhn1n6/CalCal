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
fs.writeFileSync(new URL('./accounts-legacy-backup.json',import.meta.url),JSON.stringify({email,foods,lists,goals,weights,days},null,2));
const safeFields=['id','name','listId','portion','ingredients','cal','protein','carbs','fat'];
const catalogFoods={foods:{arrayValue:{values:foods.fields.foods.arrayValue.values.map(row=>({mapValue:{fields:Object.fromEntries(Object.entries(row.mapValue.fields).filter(([key])=>safeFields.includes(key)))}}))}}};
const writes=[
  ['catalog/foods',catalogFoods],['catalog/foodLists',lists.fields],
  ['migration/owner',{email:{stringValue:email}}],['migration/legacy',{available:{booleanValue:true}}],
].map(([path,fields])=>({update:{name:`projects/fitness-352e8/databases/(default)/documents/${path}`,fields},currentDocument:{exists:false}}));
// Abort if the shared food data changes while this snapshot is being prepared.
writes.unshift(...[foods,lists].map(document=>({verify:document.name,currentDocument:{updateTime:document.updateTime}})));
console.log(`Backed up ${days.length} days and ${catalogFoods.foods.arrayValue.values.length} foods. Ready to prepare the catalogue and owner migration.`);
if(process.argv.includes('--apply')){
  const response=await fetch(`${base}:commit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes})});
  if(!response.ok)throw new Error(await response.text());
  const saved=await response.json();
  console.log(`Prepared ${saved.writeResults.length-2} new documents. Existing records were preserved.`);
}
