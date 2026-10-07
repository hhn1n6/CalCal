// Local measurements only; no data is transmitted or stored.
const check=document.getElementById('display-check');
function measureDisplay(){
  if(!check?.open) return;
  const probe=document.createElement('div');
  probe.style.cssText='position:fixed;bottom:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.appendChild(probe);
  const fixedBottom=probe.getBoundingClientRect().bottom;
  const safeBottom=parseFloat(getComputedStyle(probe).paddingBottom)||0;
  const heights={};
  for(const unit of ['vh','svh','lvh','dvh']){
    probe.style.cssText=`position:absolute;visibility:hidden;pointer-events:none;width:1px;height:100${unit};`;
    heights['100'+unit]=Math.round(probe.getBoundingClientRect().height);
  }
  probe.remove();
  const vv=window.visualViewport;
  const round=value=>Math.round(value??0);
  const page=document.querySelector('.page.active');
  const rows={
    'Installed PWA':window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true,
    'Screen height':screen.height,
    'Window height':window.innerHeight,
    'Root client height':document.documentElement.clientHeight,
    'Visual viewport height':round(vv?.height),
    'Visual viewport top':round(vv?.offsetTop),
    'Visual viewport scale':vv?.scale??1,
    'Bottom safe area':safeBottom,
    'Body bottom':round(document.body.getBoundingClientRect().bottom),
    'Page bottom':round(page?.getBoundingClientRect().bottom),
    'Fixed bottom':round(fixedBottom),
    ...heights,
  };
  document.getElementById('display-check-values').textContent=Object.entries(rows).map(([name,value])=>`${name}: ${value}`).join('\n');
}
check?.addEventListener('toggle',measureDisplay);
window.addEventListener('resize',measureDisplay);
window.visualViewport?.addEventListener('resize',measureDisplay);
