export function ageFromBirthday(birthday,today){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birthday||'')||birthday>today)return null;
  const [year,month,day]=birthday.split('-').map(Number),date=new Date(birthday+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)return null;
  const [y,m,d]=today.split('-').map(Number);
  return y-year-((m<month||(m===month&&d<day))?1:0);
}
export function currentProfileWeight(weights,profile,today){
  const entries=Object.entries(weights||{}).filter(([date,kg])=>date<=today&&ageFromBirthday(date,today)!==null&&Number.isFinite(kg)&&kg>0).sort(([a],[b])=>a.localeCompare(b));
  return entries.length?entries.at(-1)[1]:(Number.isFinite(profile?.weight)?profile.weight:null);
}
