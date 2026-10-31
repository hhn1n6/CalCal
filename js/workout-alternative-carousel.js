export function centredAlternative(left,width,count){return Math.max(0,Math.min(count-1,Math.round(left/(width+12))));}

export function createAlternativeCarousels(root,{getSelected,onSelect}){
  const observers=[],heightAnimations=[],timers=new Map();
  function reset(){for(const observer of observers)observer.disconnect();observers.length=0;for(const animation of heightAnimations)animation.cancel();heightAnimations.length=0;for(const timer of timers.values())clearTimeout(timer);timers.clear();}
  function cards(viewport){return [...viewport.querySelectorAll('[data-variant-id]')];}
  function selectedIndex(viewport){return Math.max(0,cards(viewport).findIndex(card=>card.dataset.variantId===getSelected(viewport.dataset.alternativeGroup)));}
  function setHeight(viewport){const card=cards(viewport)[selectedIndex(viewport)];if(card&&viewport.clientWidth)viewport.style.height=card.getBoundingClientRect().height+'px';}
  async function commit(viewport){
    clearTimeout(timers.get(viewport));timers.delete(viewport);
    if(!viewport.isConnected||!viewport.clientWidth)return;
    const options=cards(viewport),index=centredAlternative(viewport.scrollLeft,viewport.clientWidth,options.length),card=options[index];
    if(!card||card.dataset.variantId===getSelected(viewport.dataset.alternativeGroup))return;
    const accepted=await onSelect(viewport.dataset.alternativeGroup,card.dataset.variantId);
    if(accepted===false&&viewport.isConnected)viewport.scrollTo({left:selectedIndex(viewport)*(viewport.clientWidth+12),behavior:'smooth'});
  }
  root.addEventListener('scroll',event=>{
    const viewport=event.target;if(!viewport.matches?.('.workout-alternatives'))return;
    clearTimeout(timers.get(viewport));timers.set(viewport,setTimeout(()=>commit(viewport),150));
  },true);
  root.addEventListener('keydown',event=>{
    const viewport=event.target.closest?.('.workout-alternatives');
    if(!viewport||event.target.closest('input,button,select,textarea')||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();const options=cards(viewport),index=Math.max(0,Math.min(options.length-1,selectedIndex(viewport)+(event.key==='ArrowRight'?1:-1)));
    viewport.scrollTo({left:index*(viewport.clientWidth+12),behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
  function mount(previousHeights=new Map()){
    reset();
    for(const viewport of root.querySelectorAll('.workout-alternatives')){
      let width=viewport.clientWidth;
      const align=()=>{if(viewport.clientWidth){viewport.scrollLeft=selectedIndex(viewport)*(viewport.clientWidth+12);setHeight(viewport);}};
      align();
      const before=previousHeights.get(viewport.dataset.alternativeGroup),card=cards(viewport)[selectedIndex(viewport)],body=card?.querySelector?.('.workout-exercise-body');
      const expansion=body?.getAnimations?.().find(animation=>animation.effect?.getKeyframes().some(frame=>frame.height));
      const finalHeight=expansion?.effect.getKeyframes().at(-1).height;
      const target=card?card.getBoundingClientRect().height+(finalHeight?parseFloat(finalHeight)-body.getBoundingClientRect().height:0):0;
      if(before&&target&&Math.abs(before-target)>.5&&viewport.animate&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
        heightAnimations.push(viewport.animate([{height:before+'px'},{height:target+'px'}],{duration:300,easing:'cubic-bezier(.22,.8,.25,1)'}));
      }
      if(globalThis.ResizeObserver){
        const observer=new ResizeObserver(()=>{if(width!==viewport.clientWidth){width=viewport.clientWidth;align();}setHeight(viewport);});
        observer.observe(viewport);for(const card of cards(viewport))observer.observe(card);observers.push(observer);
      }
      viewport.addEventListener('scrollend',()=>commit(viewport));
    }
  }
  return {mount,reset};
}
