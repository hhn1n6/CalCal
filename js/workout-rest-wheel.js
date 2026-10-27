// A short, virtualised scroll wheel. Tapping the selected value opens decimal keypad.
export function mountRestWheel(input,viewport){
  const row=28,pad=14,max=3600;let index=Math.max(0,Math.min(max,Number(input.value)||0)),timer,editing=false;
  const track=document.createElement('div');track.className='rest-wheel-track';track.style.height=((max+1)*row+pad*2)+'px';viewport.appendChild(track);
  function paint(){
    track.replaceChildren();
    for(let i=Math.max(0,index-3);i<=Math.min(max,index+3);i++){
      const item=document.createElement('span');item.textContent=i;item.dataset.value=i;item.className='rest-wheel-value'+(i===index?' selected':'');item.style.top=(pad+i*row)+'px';track.appendChild(item);
    }
    viewport.setAttribute('aria-valuenow',String(index));
  }
  function commit(value){index=Math.max(0,Math.min(max,Math.round(value)));input.value=index;paint();input.dispatchEvent(new Event('input',{bubbles:true}));}
  viewport.scrollTop=index*row;paint();
  viewport.addEventListener('scroll',()=>{if(editing)return;commit(viewport.scrollTop/row);clearTimeout(timer);timer=setTimeout(()=>{viewport.scrollTop=index*row;},100);},{passive:true});
  viewport.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();commit(e.key==='Home'?0:e.key==='End'?max:index+(e.key==='ArrowUp'?-1:1));viewport.scrollTop=index*row;});
  viewport.addEventListener('click',e=>{const value=e.target.closest('[data-value]');if(!value)return;if(Number(value.dataset.value)!==index){commit(Number(value.dataset.value));viewport.scrollTop=index*row;return;}editing=true;input.hidden=false;input.focus({preventScroll:true});input.select();});
  input.addEventListener('blur',()=>{editing=false;commit(Number(input.value)||0);input.hidden=true;viewport.scrollTop=index*row;});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});
}
