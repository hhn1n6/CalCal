// Mifflin–St Jeor resting energy estimate (kcal/day):
// https://pubmed.ncbi.nlm.nih.gov/2305711/
// Activity factors are rough planning estimates, not measured expenditure.
export const activityFactors={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryActive:1.9};
export function calculateSuggestedGoals({gender,weight,height,age,activity,goal}){
  if(!['male','female'].includes(gender))throw new Error('Choose Male or Female.');
  if(!Number.isFinite(weight)||weight<20||weight>500)throw new Error('Enter a weight between 20 and 500 kg.');
  if(!Number.isFinite(height)||height<100||height>250)throw new Error('Enter a height between 100 and 250 cm.');
  if(!Number.isInteger(age)||age<18||age>100)throw new Error('Enter an age between 18 and 100.');
  if(!Object.hasOwn(activityFactors,activity))throw new Error('Choose your activity level.');
  if(!['gain','lose'].includes(goal))throw new Error('Choose your weight goal.');
  const bmr=10*weight+6.25*height-5*age+(gender==='male'?5:-161);
  if(bmr<=0)throw new Error('These stats do not produce a usable estimate. Check your entries.');
  const tdee=bmr*activityFactors[activity];
  // A modest 10% adjustment is an app starting point, not a prescribed diet.
  const cal=Math.max(gender==='male'?1500:1200,Math.round(tdee*(goal==='gain'?1.1:0.9)));
  // 25% protein, 30% fat, carbohydrate remainder. Whole grams for CalCal UI.
  const protein=Math.round(cal*.25/4),fat=Math.round(cal*.30/9);
  const carbs=Math.round((cal-protein*4-fat*9)/4);
  return {bmr:Math.round(bmr),tdee:Math.round(tdee),cal,protein,carbs,fat};
}
