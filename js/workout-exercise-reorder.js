import {dragPreviewPosition} from './compact-reorder.js?v=1.2.43';

// Exercise cards move independently, within their row or into another row.
export function setupExerciseReorder(root,{getRows,onDrop,canDrag=()=>true,onDragState=()=>{}}){
  let drag=null,suppressClick=false;
  const rows=()=>[...root.querySelectorAll('.workout-exercise')].filter(row=>row.style.display!=='none');
  function record(viewport){
    if(!drag.views.has(viewport))drag.views.set(viewport,{height:viewport.style.height,snap:viewport.style.scrollSnapType,left:viewport.scrollLeft});
    viewport.style.scrollSnapType='none';
  }
  function animateChange(change){
    const elements=[...rows(),...root.querySelectorAll('[data-variant-id]')],before=new Map(elements.map(el=>[el,el.getBoundingClientRect()]));
    change();
    if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    for(const [el,old] of before){
      if(el===drag?.card||el.style.display==='none')continue;
      const box=el.getBoundingClientRect(),card=!!el.dataset.variantId,offset=card?old.left-box.left:old.top-box.top;
      if(Math.abs(offset)>.5)el.animate?.([{transform:`translate${card?'X':'Y'}(${offset}px)`},{transform:'translate(0)'}],{duration:180,easing:'ease-out'});
    }
  }
  function place(){
    const d=drag;if(!d?.active)return;
    const viewport=globalThis.visualViewport,box=d.ghost.getBoundingClientRect();
    const position=dragPreviewPosition(d.x,d.y,box.width,box.height,{left:viewport?.offsetLeft||0,top:viewport?.offsetTop||0,width:viewport?.width||globalThis.innerWidth||320,height:viewport?.height||globalThis.innerHeight||640});
    d.ghost.style.transform=`translate(${position.x}px,${position.y}px)`;
    const available=rows(),hit=available.find(row=>{const r=row.getBoundingClientRect();return d.y>=r.top&&d.y<=r.bottom;});
    const targetView=hit?.querySelector('.workout-alternatives'),viewBox=targetView?.getBoundingClientRect();
    if(!hit||d.y>(viewBox?.bottom??0)+4){
      const next=available.find(row=>d.y<row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);
      if(d.placeholder.parentElement!==d.list||d.placeholder.nextElementSibling!==(next||null))animateChange(()=>{
        d.placeholder.classList.add('exercise-row-drop');d.list.insertBefore(d.placeholder,next||null);
        d.drop={exerciseId:d.exerciseId,beforeRowId:next?.dataset.reorderId||null};d.targetView=null;
        d.row.style.display=d.members===1?'none':d.rowDisplay;
      });
      return;
    }
    record(targetView);
    const candidates=[...targetView.children].filter(el=>el.dataset.variantId&&el!==d.card);
    let next=candidates.find(card=>{const r=card.getBoundingClientRect();return d.x<r.left+r.width/2;})||null;
    const now=Date.now(),same=targetView===d.sourceView;
    if(same&&Math.abs(d.x-d.hopX)>40&&now-d.lastHop>250){
      const current=[...targetView.children].filter(el=>el!==d.card&&(el.dataset.variantId||el===d.placeholder)).indexOf(d.placeholder);
      const index=Math.max(0,Math.min(candidates.length,current+(d.x<d.hopX?-1:1)));
      next=candidates[index]||null;d.lastHop=now;d.hopX=d.x;
    }
    if(d.placeholder.parentElement!==targetView||d.placeholder.nextElementSibling!==next)animateChange(()=>{
      d.placeholder.classList.remove('exercise-row-drop');targetView.insertBefore(d.placeholder,next);
      targetView.style.height=Math.max(targetView.getBoundingClientRect().height,d.compactHeight)+'px';
      targetView.scrollLeft=d.placeholder.offsetLeft;d.row.style.display=targetView!==d.sourceView&&d.members===1?'none':d.rowDisplay;
    });
    const ordered=[...targetView.children].filter(el=>el!==d.card&&(el.dataset.variantId||el===d.placeholder));
    d.drop={exerciseId:d.exerciseId,targetRowId:hit.dataset.reorderId,index:ordered.indexOf(d.placeholder)};d.targetView=targetView;
  }
  function frame(){
    const d=drag;if(!d?.active)return;
    const box=d.page.getBoundingClientRect(),edge=60;
    const delta=d.y<box.top+edge?-Math.ceil((box.top+edge-d.y)/5):d.y>box.bottom-edge?Math.ceil((d.y-box.bottom+edge)/5):0;
    if(delta){d.page.scrollTop+=Math.max(-18,Math.min(18,delta));place();}
    if(d.targetView&&Date.now()-d.lastHop>450){
      const rect=d.targetView.getBoundingClientRect(),direction=d.x<rect.left+28?-1:d.x>rect.right-28?1:0;
      if(direction){d.targetView.scrollLeft+=direction*(d.targetView.clientWidth+12);d.lastHop=Date.now();place();}
    }
    d.frame=requestAnimationFrame(frame);
  }
  function clean(cancelled){
    const d=drag;if(!d)return;drag=null;if(d.frame)cancelAnimationFrame(d.frame);
    if(d.active){
      d.placeholder.remove();d.ghost.remove();d.card.style.display=d.cardDisplay;d.row.style.display=d.rowDisplay;
      for(const [body,hidden] of d.bodies)body.hidden=hidden;
      for(const [viewport,state] of d.views){viewport.style.height=state.height;viewport.style.scrollSnapType=state.snap;viewport.scrollLeft=state.left;}
      onDragState(false);
      if(!cancelled&&d.drop)onDrop(d.drop);
      suppressClick=true;setTimeout(()=>suppressClick=false,0);
    }
    if(d.handle.hasPointerCapture?.(d.id))d.handle.releasePointerCapture(d.id);
  }
  root.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('.workout-drag'),card=handle?.closest('[data-variant-id]'),row=card?.closest('.workout-exercise');
    if(!card||!row||event.button!==0||!canDrag())return;
    event.preventDefault();const sourceView=card.parentElement;
    drag={handle,card,row,sourceView,list:row.parentElement,id:event.pointerId,exerciseId:card.dataset.variantId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,hopX:event.clientX,lastHop:0,active:false,views:new Map(),bodies:[],members:sourceView.querySelectorAll('[data-variant-id]').length,cardDisplay:card.style.display,rowDisplay:row.style.display,page:root.closest('.page')||root};
    handle.setPointerCapture?.(event.pointerId);
  });
  root.addEventListener('pointermove',event=>{
    const d=drag;if(!d||d.id!==event.pointerId)return;
    d.x=event.clientX;d.y=event.clientY;
    if(!d.active&&Math.hypot(d.x-d.startX,d.y-d.startY)<6)return;
    event.preventDefault();
    if(!d.active){
      d.active=true;onDragState(true);record(d.sourceView);
      animateChange(()=>{
        d.bodies=[...d.row.querySelectorAll('.workout-exercise-body')].map(body=>[body,body.hidden]);for(const [body] of d.bodies)body.hidden=true;
        d.compactHeight=Math.max(...[...d.sourceView.querySelectorAll('[data-variant-id]')].map(card=>card.getBoundingClientRect().height));
        d.sourceView.style.height=d.compactHeight+'px';
        d.placeholder=document.createElement('div');d.placeholder.className='reorder-placeholder exercise-drop-placeholder';d.placeholder.style.height=d.compactHeight+'px';
        d.card.before(d.placeholder);d.card.style.display='none';
      });
      d.ghost=document.createElement('div');d.ghost.className='compact-drag-preview';d.ghost.textContent=d.card.querySelector('.workout-exercise-name').textContent;document.body.appendChild(d.ghost);d.frame=requestAnimationFrame(frame);
    }
    place();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,event=>{if(drag?.id===event.pointerId)clean(type!=='pointerup');});
  root.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();}},true);
  root.addEventListener('keydown',event=>{
    if(drag&&event.key==='Escape'){event.preventDefault();clean(true);return;}
    const handle=event.target.closest('.workout-drag'),card=handle?.closest('[data-variant-id]');
    if(!card||!canDrag()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    const exerciseId=card.dataset.variantId||card.dataset.reorderId,groups=getRows(),rowIndex=groups.findIndex(row=>row.exerciseIds.includes(exerciseId)),row=groups[rowIndex];if(!row)return;
    event.preventDefault();const index=row.exerciseIds.indexOf(exerciseId);
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      const next=index+(event.key==='ArrowLeft'?-1:1);if(next>=0&&next<row.exerciseIds.length)onDrop({exerciseId,targetRowId:row.id,index:next});
    }else{
      const next=rowIndex+(event.key==='ArrowUp'?-1:1);if(next<0||next>=groups.length)return;
      if(row.exerciseIds.length===1)onDrop({exerciseId,beforeRowId:event.key==='ArrowUp'?groups[next].id:groups[next+1]?.id||null});
      else onDrop({exerciseId,targetRowId:groups[next].id,index:groups[next].exerciseIds.length});
    }
  });
  return {cancel:()=>clean(true)};
}
