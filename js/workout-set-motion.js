const heightAnimations=new WeakMap();
export function captureSetLayout(list){
  if(!list?.getBoundingClientRect)return null;
  const box=list.getBoundingClientRect();
  return {height:box.height,rows:new Map([...list.querySelectorAll('.workout-set-row[data-set-id]')].map(row=>{
    const rect=row.getBoundingClientRect();
    return [row.dataset.setId,{top:rect.top-box.top,height:rect.height,clone:row.cloneNode(true)}];
  }))};
}

export function animateSetLayout(list,before){
  if(!before||!list?.animate||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  heightAnimations.get(list)?.cancel();
  const box=list.getBoundingClientRect(),rows=[...list.querySelectorAll('.workout-set-row[data-set-id]')];
  const ids=new Set(rows.map(row=>row.dataset.setId));
  const timing={duration:300,easing:'cubic-bezier(.22,.8,.25,1)'};
  for(const row of rows){
    const old=before.rows.get(row.dataset.setId);
    if(!old)row.animate([{opacity:0},{opacity:1}],{duration:240});
    else{
      const offset=old.top-(row.getBoundingClientRect().top-box.top);
      if(Math.abs(offset)>.5)row.animate([{transform:`translateY(${offset}px)`},{transform:'translateY(0)'}],timing);
    }
  }
  // Keep deleted rows visible only as inert overlays while their space closes.
  for(const [id,old] of before.rows){
    if(ids.has(id))continue;
    const ghost=old.clone;
    ghost.removeAttribute('data-set-id');ghost.inert=true;ghost.setAttribute('aria-hidden','true');
    for(const node of ghost.querySelectorAll('[id]'))node.removeAttribute('id');
    Object.assign(ghost.style,{position:'absolute',top:old.top+'px',left:'0',right:'0',height:old.height+'px',pointerEvents:'none'});
    list.appendChild(ghost);
    ghost.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}).finished.catch(()=>{}).finally(()=>ghost.remove());
  }
  list.style.position='relative';list.style.overflow='hidden';
  const animation=list.animate([{height:before.height+'px'},{height:box.height+'px'}],timing);
  heightAnimations.set(list,animation);
  animation.finished.catch(()=>{}).finally(()=>{if(heightAnimations.get(list)===animation){heightAnimations.delete(list);list.style.overflow='';}});
}
