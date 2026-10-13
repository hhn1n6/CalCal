// Move both complete cards, keeping the backdrop and homepage stationary.
export function createOnboardingTransition(panel){
  let moving=false,animations=[],ghost=null,generation=0;
  function reset(){
    generation++;moving=false;
    animations.forEach(animation=>animation.cancel());animations=[];
    ghost?.remove();ghost=null;
  }
  function run(update,direction){
    if(moving)return false;
    if(!panel.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){update();return true;}
    moving=true;
    const current=++generation,rect=panel.getBoundingClientRect();
    ghost=panel.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
    ghost.setAttribute('aria-hidden','true');ghost.inert=true;
    Object.assign(ghost.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',maxHeight:'none',margin:'0',animation:'none',pointerEvents:'none',zIndex:'1'});
    ghost.scrollTop=panel.scrollTop;
    // Preserve the visible answers in the outgoing card, including selects.
    const original=panel.querySelectorAll('input,select,textarea');
    ghost.querySelectorAll('input,select,textarea').forEach((el,index)=>{el.value=original[index].value;if(el.type==='radio'||el.type==='checkbox')el.checked=original[index].checked;});
    panel.parentElement.appendChild(ghost);
    panel.style.animation='none';
    update();
    const offset=direction==='next'?window.innerWidth:-window.innerWidth;
    const options={duration:380,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'};
    animations=[ghost.animate([{transform:'translateX(0)'},{transform:`translateX(${-offset}px)`}],options),panel.animate([{transform:`translateX(${offset}px)`},{transform:'translateX(0)'}],options)];
    Promise.all(animations.map(animation=>animation.finished)).catch(()=>{}).finally(()=>{
      if(current!==generation)return;
      animations.forEach(animation=>animation.cancel());animations=[];
      ghost?.remove();ghost=null;moving=false;
    });
    return true;
  }
  return {run,reset,get moving(){return moving;}};
}
