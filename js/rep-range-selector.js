import {targetRepBounds,targetReps} from './workout-model.js?v=1.2.33';
export function createRepRangeSelector(element,{tr,onApply}){
  if(!element)return {open(){},close(){}};
  const low=element.querySelector('#rep-range-min'),high=element.querySelector('#rep-range-max'),min=element.querySelector('#rep-input-min'),max=element.querySelector('#rep-input-max'),output=element.querySelector('#rep-range-value'),error=element.querySelector('#rep-range-error'),sliders=element.querySelector('.rep-range-sliders');
  let context=null,returnFocus=null;
  function render(){
    output.textContent=min.value===''&&max.value===''?'—':min.value===max.value?min.value:`${min.value||'—'}–${max.value||'—'}`;
    const a=Number(min.value),b=Number(max.value),limit=Math.max(50,a||0,b||0);
    low.max=high.max=String(limit);low.value=String(a||0);high.value=String(b||0);
    sliders.style.setProperty('--range-left',((a||0)/limit*100)+'%');sliders.style.setProperty('--range-right',((b||0)/limit*100)+'%');sliders.classList.toggle('same',a===b);
  }
  function close(){element.classList.remove('open');context=null;returnFocus?.focus?.({preventScroll:true});returnFocus=null;}
  function open(value,next){context=next;returnFocus=document.activeElement;const bounds=targetRepBounds(value)||{min:8,max:12};min.value=bounds.min;max.value=bounds.max;error.textContent='';render();element.classList.add('open');}
  function apply(clear=false){
    try{
      const value=clear?null:targetReps(min.value===''&&max.value===''?null:min.value===max.value?min.value:`${min.value}-${max.value}`);
      onApply(value,context);close();
    }catch(err){error.textContent=tr(err.message);}
  }
  for(const input of [min,max])input.addEventListener('input',()=>{error.textContent='';render();});
  low.addEventListener('input',()=>{min.value=Math.min(Number(low.value),Number(max.value)||0);error.textContent='';render();});
  high.addEventListener('input',()=>{max.value=Math.max(Number(high.value),Number(min.value)||0);error.textContent='';render();});
  element.addEventListener('click',event=>{const action=event.target.closest('[data-rep-action]')?.dataset.repAction;if(action==='cancel'||event.target===element)close();else if(action==='save')apply();else if(action==='clear')apply(true);});
  element.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Enter'&&event.target.matches('input[type="number"]')){event.preventDefault();apply();}});
  return {open,close};
}
