// Mifflin–St Jeor resting energy estimate (kcal/day):
// https://pubmed.ncbi.nlm.nih.gov/2305711/
// Activity factors are rough planning estimates, not measured expenditure.
export const activityFactors={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryActive:1.9};
// Match 4P + 4C + 9F exactly using whole grams, without rounding macros to tens.
export function roundDailyGoals({cal,protein,carbs,fat}){
  if(![cal,protein,carbs,fat].every(Number.isInteger)||cal<1000||cal>20000||protein<0||protein>1000||carbs<0||carbs>2000||fat<0||fat>1000)throw new Error('Enter valid whole-number daily targets.');
  cal=Math.round(cal/10)*10;
  const energy=4*protein+4*carbs+9*fat;
  const target=energy>0?[protein*cal/energy,carbs*cal/energy,fat*cal/energy]:[cal*.25/4,cal*.45/4,cal*.30/9];
  let best=null,bestScore=Infinity;
  for(let f=0;f<=Math.min(1000,Math.floor(cal/9));f++){
    const remainder=cal-9*f;
    if(remainder%4!==0)continue;
    const pc=remainder/4,low=Math.max(0,pc-2000),high=Math.min(1000,pc);
    if(low>high)continue;
    const center=Math.max(low,Math.min(high,Math.round((target[0]+pc-target[1])/2)));
    for(let p=Math.max(low,center-1);p<=Math.min(high,center+1);p++){
      const c=pc-p,score=(p-target[0])**2+(c-target[1])**2+(f-target[2])**2;
      if(score<bestScore){bestScore=score;best={cal,protein:p,carbs:c,fat:f};}
    }
  }
  if(!best)throw new Error('Enter valid whole-number daily targets.');
  return best;
}
export function calculateSuggestedGoals({gender,weight,height,age,activity,goal}){
  if(!['male','female'].includes(gender))throw new Error('Choose Male or Female.');
  if(!Number.isFinite(weight)||weight<20||weight>500)throw new Error('Enter a weight between 20 and 500 kg.');
  if(!Number.isFinite(height)||height<100||height>250)throw new Error('Enter a height between 100 and 250 cm.');
  if(!Number.isInteger(age)||age<1||age>120)throw new Error('Enter an age between 1 and 120.');
  if(!Object.hasOwn(activityFactors,activity))throw new Error('Choose your activity level.');
  if(!['gain','maintain','lose'].includes(goal))throw new Error('Choose your weight goal.');
  const bmr=10*weight+6.25*height-5*age+(gender==='male'?5:-161);
  if(bmr<=0)throw new Error('These stats do not produce a usable estimate. Check your entries.');
  const tdee=bmr*activityFactors[activity];
  // A modest 10% adjustment is an app starting point, not a prescribed diet.
  const cal=Math.max(gender==='male'?1500:1200,Math.round(tdee*(goal==='gain'?1.1:goal==='lose'?0.9:1)));
  // 25% protein, 30% fat, carbohydrate remainder. Whole grams for CalCal UI.
  const protein=Math.round(cal*.25/4),fat=Math.round(cal*.30/9);
  const carbs=Math.round((cal-protein*4-fat*9)/4);
  return {bmr:Math.round(bmr),tdee:Math.round(tdee),cal,protein,carbs,fat};
}
