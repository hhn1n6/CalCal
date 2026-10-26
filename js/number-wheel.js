const ROW=36, PAD=72;
export function wheelIndex(value,min,max,step){
  return Math.max(0,Math.min(Math.round((max-min)/step),Math.round((value-min)/step)));
}
export function createNumberWheel(input,viewport,{min,max,step=1,initial}){
  const count=Math.round((max-min)/step)+1,decimals=step<1?1:0;
  const track=document.createElement('div');
  track.className='number-wheel-track';track.style.height=(count*ROW+PAD*2)+'px';
  viewport.appendChild(track);
  let index=0,timer;
  const valueAt=i=>Number((min+i*step).toFixed(decimals));
  function render(){
    track.replaceChildren();
    for(let i=Math.max(0,index-5);i<=Math.min(count-1,index+5);i++){
      const row=document.createElement('div');
      row.className='number-wheel-value'+(i===index?' selected':'');
      row.style.top=(PAD+i*ROW)+'px';row.dataset.index=String(i);
      row.textContent=valueAt(i).toFixed(decimals);row.setAttribute('aria-hidden','true');
      track.appendChild(row);
    }
    viewport.setAttribute('aria-valuenow',String(valueAt(index)));
    viewport.setAttribute('aria-valuetext',valueAt(index).toFixed(decimals));
  }
  function commit(next,notify=true){
    index=Math.max(0,Math.min(count-1,next));
    const value=valueAt(index).toFixed(decimals),changed=input.value!==value;
    input.value=value;render();
    if(notify&&changed)input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function sync(){
    clearTimeout(timer);
    const value=input.value===''?initial:Number(input.value);
    commit(wheelIndex(value,min,max,step),false);
    viewport.scrollTop=index*ROW;
  }
  function flush(){
    clearTimeout(timer);if(viewport.closest('[hidden]'))return;commit(Math.round(viewport.scrollTop/ROW));
    viewport.scrollTop=index*ROW;
  }
  viewport.setAttribute('aria-valuemin',String(min));viewport.setAttribute('aria-valuemax',String(max));
  viewport.addEventListener('scroll',()=>{
    if(viewport.closest('[hidden]'))return;
    commit(Math.round(viewport.scrollTop/ROW));
    clearTimeout(timer);timer=setTimeout(flush,140);
  },{passive:true});
  viewport.addEventListener('keydown',event=>{
    const delta={ArrowUp:-1,ArrowDown:1,PageUp:-10,PageDown:10}[event.key];
    if(delta===undefined&&event.key!=='Home'&&event.key!=='End')return;
    event.preventDefault();clearTimeout(timer);
    commit(event.key==='Home'?0:event.key==='End'?count-1:index+delta);
    viewport.scrollTop=index*ROW;
  });
  viewport.addEventListener('click',event=>{
    const row=event.target.closest('[data-index]');
    if(!row)return;
    clearTimeout(timer);commit(Number(row.dataset.index));viewport.scrollTop=index*ROW;
  });
  // Creating the wheel while its question is hidden must not reset its value.
  return {sync,flush};
}
