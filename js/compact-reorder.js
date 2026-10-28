// Shared drag standard: compact follower, live placeholder, animated neighbours.
export function dragPreviewPosition(x,y,width,height,viewport){
  const gap=8,left=viewport.left||0,top=viewport.top||0;
  return {x:Math.max(left+gap,Math.min(x-width/2,left+viewport.width-width-gap)),y:Math.max(top+gap,Math.min(y-height-16,top+viewport.height-height-gap))};
}
export function setupCompactReorder(root,{items,handle,getLabel,onDrop,canDrag=()=>true,getCompactHeight}){
  let drag=null,suppressClick=false;
  const rows=()=>[...root.querySelectorAll(items)];
  function clean(cancelled){
    if(!drag)return;
    const d=drag;drag=null;cancelAnimationFrame(d.frame);
    if(d.active){
      const order=[...d.parent.children].filter(el=>el!==d.row&&(el.matches(items)||el===d.placeholder)).map(el=>el===d.placeholder?d.row.dataset.reorderId:el.dataset.reorderId);
      d.placeholder.replaceWith(d.row);d.ghost.remove();
      if(cancelled)for(const row of d.original)d.parent.appendChild(row);
      d.row.style.display=d.display;
      if(!cancelled&&order.some((id,i)=>id!==d.original[i].dataset.reorderId))onDrop(order);
      suppressClick=true;setTimeout(()=>suppressClick=false,0);
    }
    if(d.handle.hasPointerCapture?.(d.id))d.handle.releasePointerCapture(d.id);
  }
  function animateMove(change){
    const before=new Map(rows().map(el=>[el,el.getBoundingClientRect().top]));change();
    for(const [el,top] of before){const dy=top-el.getBoundingClientRect().top;if(dy)el.animate?.([{transform:`translateY(${dy}px)`},{transform:'translateY(0)'}],{duration:180,easing:'ease-out'});}
  }
  function place(){
    const d=drag;if(!d?.active)return;
    const box=d.ghost.getBoundingClientRect(),viewport=globalThis.visualViewport;
    const position=dragPreviewPosition(d.x,d.y,box.width||0,box.height,{left:viewport?.offsetLeft||0,top:viewport?.offsetTop||0,width:viewport?.width||globalThis.innerWidth||document.documentElement?.clientWidth||320,height:viewport?.height||globalThis.innerHeight||document.documentElement?.clientHeight||640});
    d.ghost.style.transform=`translate(${position.x}px,${position.y}px)`;
    const remaining=rows().filter(el=>el!==d.row);
    const next=remaining.find(el=>d.y<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
    if((next&&d.placeholder.nextElementSibling!==next)||(!next&&d.placeholder!==d.parent.lastElementChild))animateMove(()=>d.parent.insertBefore(d.placeholder,next||null));
  }
  function frame(){
    const d=drag;if(!d?.active)return;
    const box=d.scroll.getBoundingClientRect(),edge=60;
    const delta=d.y<box.top+edge?-Math.ceil((box.top+edge-d.y)/5):d.y>box.bottom-edge?Math.ceil((d.y-box.bottom+edge)/5):0;
    if(delta){d.scroll.scrollTop+=Math.max(-18,Math.min(18,delta));place();}
    d.frame=requestAnimationFrame(frame);
  }
  root.addEventListener('pointerdown',event=>{
    const h=event.target.closest(handle),row=h?.closest(items);
    if(!row||event.button!==0||!canDrag())return;
    event.preventDefault();
    drag={row,handle:h,id:event.pointerId,startY:event.clientY,startX:event.clientX,x:event.clientX,y:event.clientY,parent:row.parentElement,original:[...row.parentElement.children].filter(el=>el.matches(items)),display:row.style.display,scroll:root.closest('.page')||root,active:false};
    h.setPointerCapture?.(event.pointerId);
  });
  root.addEventListener('pointermove',event=>{
    const d=drag;if(!d||event.pointerId!==d.id)return;
    d.x=event.clientX;d.y=event.clientY;
    if(!d.active&&Math.hypot(d.x-d.startX,d.y-d.startY)<6)return;
    event.preventDefault();
    if(!d.active){
      d.active=true;const rect=d.row.getBoundingClientRect(),compactHeight=getCompactHeight?.(d.row)||rect.height;
      d.placeholder=document.createElement('div');d.placeholder.className='reorder-placeholder';d.placeholder.style.height=compactHeight+'px';
      d.row.before(d.placeholder);d.row.style.display='none';
      d.ghost=document.createElement('div');d.ghost.className='compact-drag-preview';d.ghost.textContent=getLabel(d.row);document.body.appendChild(d.ghost);d.frame=requestAnimationFrame(frame);
    }
    place();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,e=>{if(drag&&e.pointerId===drag.id)clean(type!=='pointerup');});
  root.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  root.addEventListener('keydown',event=>{
    if(drag&&event.key==='Escape'){event.preventDefault();clean(true);return;}
    const h=event.target.closest(handle),row=h?.closest(items);if(!row||!canDrag()||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const order=rows().map(el=>el.dataset.reorderId),index=order.indexOf(row.dataset.reorderId),next=index+(event.key==='ArrowUp'?-1:1);
    if(next<0||next>=order.length)return;[order[index],order[next]]=[order[next],order[index]];onDrop(order);
  });
  return {cancel:()=>clean(true)};
}
