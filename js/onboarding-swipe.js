export function onboardingSwipeDirection(dx,dy,elapsed){
  if(elapsed>900||Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return null;
  return dx<0?'next':'back';
}
export function setupOnboardingSwipes({panel,canNavigate,next,back}){
  let gesture=null;
  panel.addEventListener('touchstart',event=>{
    gesture=null;
    if(!canNavigate()||event.touches.length!==1||event.target.closest('button,input,select,textarea,a,[contenteditable]'))return;
    const touch=event.touches[0];
    gesture={x:touch.clientX,y:touch.clientY,time:Date.now(),axis:null};
  },{passive:true});
  panel.addEventListener('touchmove',event=>{
    if(!gesture)return;
    if(!canNavigate()||event.touches.length!==1){gesture=null;return;}
    const touch=event.touches[0],dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>10)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.5?'horizontal':'vertical';
    if(gesture.axis==='horizontal'&&event.cancelable)event.preventDefault();
  },{passive:false});
  panel.addEventListener('touchend',event=>{
    const start=gesture;gesture=null;
    if(!start||start.axis==='vertical'||!canNavigate()||event.touches.length||event.changedTouches.length!==1)return;
    const touch=event.changedTouches[0];
    const direction=onboardingSwipeDirection(touch.clientX-start.x,touch.clientY-start.y,Date.now()-start.time);
    if(start.axis==='horizontal'&&event.cancelable)event.preventDefault();
    if(direction==='next')next();
    if(direction==='back')back();
  },{passive:false});
  panel.addEventListener('touchcancel',()=>{gesture=null;},{passive:true});
}
