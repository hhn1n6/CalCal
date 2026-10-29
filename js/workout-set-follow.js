// Align the row's centre to a quarter of the visible screen, within scroll bounds.
export function currentSetScrollTop(row,page,viewport,limits={lastBottom:Infinity,trackerTop:0}){
  const target=viewport.offsetTop+viewport.height*.25;
  // Never scroll farther down just to align a row once all blocks clear the tracker.
  const bottomLimit=Math.max(page.scrollTop,page.scrollTop+limits.lastBottom-limits.trackerTop);
  return Math.max(0,Math.min(page.scrollHeight-page.clientHeight,bottomLimit,page.scrollTop+row.top+row.height/2-target));
}
