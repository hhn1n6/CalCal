// Align the row's centre to a quarter of the visible screen, within scroll bounds.
export function currentSetScrollTop(row,page,viewport){
  const target=viewport.offsetTop+viewport.height*.25;
  return Math.max(0,Math.min(page.scrollHeight-page.clientHeight,page.scrollTop+row.top+row.height/2-target));
}
