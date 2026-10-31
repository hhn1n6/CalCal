const pages=['home','lists','workout','person'];
export function swipeDestination(page,dx,dy,elapsed){
  if(elapsed>900||Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return null;
  const index=pages.indexOf(page);
  if(index<0)return null;
  return pages[index+(dx<0?1:-1)]||null;
}
export function setupPageSwipes({canSwitch,switchPage}){
  for(const page of document.querySelectorAll('.page')){
    let gesture=null;
    const available=()=>canSwitch()&&!document.querySelector('.modal-overlay.open');
    page.addEventListener('touchstart',event=>{
      gesture=null;
      if(!available()||event.touches.length!==1||event.target.closest('button,input,select,textarea,a,[contenteditable],.food-drag-handle,.workout-alternatives'))return;
      const touch=event.touches[0];
      gesture={x:touch.clientX,y:touch.clientY,time:Date.now(),axis:null};
    },{passive:true});
    page.addEventListener('touchmove',event=>{
      if(!gesture)return;
      if(event.touches.length!==1||!available()){gesture=null;return;}
      const touch=event.touches[0],dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
      if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>10)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.5?'horizontal':'vertical';
      if(gesture.axis==='horizontal'&&event.cancelable)event.preventDefault();
    },{passive:false});
    page.addEventListener('touchend',event=>{
      const start=gesture;gesture=null;
      if(!start||start.axis==='vertical'||!available()||event.touches.length||!event.changedTouches.length)return;
      const touch=event.changedTouches[0],dx=touch.clientX-start.x,dy=touch.clientY-start.y;
      const destination=swipeDestination(page.id.replace('page-',''),dx,dy,Date.now()-start.time);
      // A horizontal drag must not also activate a food row's tap action.
      if(start.axis==='horizontal'&&event.cancelable)event.preventDefault();
      if(destination)switchPage(destination,dx<0?'left':'right');
    },{passive:false});
    page.addEventListener('touchcancel',()=>{gesture=null;},{passive:true});
  }
}
