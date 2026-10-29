// Center the visible numeral shapes, including their side bearings and tracking.
export function clockInkOffset(text,measure,spacing,advanceWidth,scale=1){
  let pen=0,left=Infinity,right=-Infinity;
  for(const character of text){
    const glyph=measure(character);
    left=Math.min(left,pen-glyph.actualBoundingBoxLeft);
    right=Math.max(right,pen+glyph.actualBoundingBoxRight);
    pen+=glyph.width+spacing;
  }
  return Number.isFinite(left+right)?(advanceWidth-left-right)*scale/2:0;
}
let context;
export function alignTrackerClock(element){
  if(!element?.ownerDocument||!globalThis.getComputedStyle)return;
  context??=element.ownerDocument.createElement('canvas').getContext('2d');
  if(!context)return;
  const style=getComputedStyle(element),scale=parseFloat(style.getPropertyValue('--tracker-clock-scale'))||.84;
  context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.fontKerning='none';
  const offset=clockInkOffset(element.textContent,character=>context.measureText(character),parseFloat(style.letterSpacing)||0,element.getBoundingClientRect().width/scale,scale);
  element.style.setProperty('--clock-ink-offset',offset+'px');
}
