// Fade complete cards out, then in while the backdrop and homepage stay stationary.
export function createOnboardingTransition(panel){
  let moving=false,animations=[],ghost=null,generation=0;
  function reset(){
    generation++;moving=false;
    animations.forEach(animation=>animation.cancel());animations=[];
    ghost?.remove();ghost=null;
  }
  function run(update){
    if(moving)return false;
    if(!panel.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){update();return true;}
    moving=true;
    const current=++generation,rect=panel.getBoundingClientRect(),scrollTop=panel.scrollTop;
    ghost=panel.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
    // A checked clone must never join the real form's radio groups.
    ghost.querySelectorAll('[name]').forEach(el=>el.removeAttribute('name'));
    ghost.setAttribute('aria-hidden','true');ghost.inert=true;
    Object.assign(ghost.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',maxHeight:'none',margin:'0',animation:'none',pointerEvents:'none',overflow:'hidden',scrollBehavior:'auto',overflowAnchor:'none',zIndex:'1'});
    // Preserve the visible answers in the outgoing card, including selects.
    const original=panel.querySelectorAll('input,select,textarea');
    ghost.querySelectorAll('input,select,textarea').forEach((el,index)=>{el.value=original[index].value;if(el.type==='radio'||el.type==='checkbox')el.checked=original[index].checked;});
    panel.parentElement.appendChild(ghost);
    // Detached elements have no scroll range: restore only after layout exists.
    ghost.scrollTop=scrollTop;
    panel.style.animation='none';
    update();
    const options={duration:380,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'};
    animations=[ghost.animate([{opacity:1},{opacity:0}],options),panel.animate([{opacity:0},{opacity:1}],{...options,delay:380})];
    Promise.all(animations.map(animation=>animation.finished)).catch(()=>{}).finally(()=>{
      if(current!==generation)return;
      animations.forEach(animation=>animation.cancel());animations=[];
      ghost?.remove();ghost=null;moving=false;
    });
    return true;
  }
  return {run,reset,get moving(){return moving;}};
}
