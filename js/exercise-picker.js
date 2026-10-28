// Multi-select exercise library. Opening or cancelling never writes account data.
export function createExercisePicker(element,{tr,onAdd}){
  if(!element)return {open(){},close(){},reset(){},refresh(){}};
  const grid=element.querySelector('.exercise-picker-grid'),category=element.querySelector('.exercise-picker-category-label'),menu=element.querySelector('.exercise-picker-menu'),searchRow=element.querySelector('.exercise-picker-search'),search=element.querySelector('input[type="search"]'),add=element.querySelector('[data-picker-action="add"]'),error=element.querySelector('[role="alert"]');
  let catalog=[],selected=new Set(),filter='',searching=false,saving=false,returnFocus=null,generation=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const categoryText=value=>value==='Back'?(tr('Back muscles')==='Back muscles'?'Back':tr('Back muscles')):tr(value);
  const panelAnimations=new Map();
  function showPanel(panel,show,animate=true){
    const oldHeight=panel.hidden?0:panel.getBoundingClientRect?.().height||0;
    panelAnimations.get(panel)?.cancel();panelAnimations.delete(panel);
    panel.inert=!show;
    if(!animate||!panel.animate||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){panel.hidden=!show;return;}
    panel.hidden=false;
    const fullHeight=panel.getBoundingClientRect().height,style=getComputedStyle(panel);
    const collapsed={height:'0px',paddingTop:'0px',paddingBottom:'0px',borderBottomWidth:'0px',opacity:0};
    const expanded={height:fullHeight+'px',paddingTop:style.paddingTop,paddingBottom:style.paddingBottom,borderBottomWidth:style.borderBottomWidth,opacity:1};
    const animation=panel.animate([{...(oldHeight?expanded:collapsed),height:oldHeight+'px'},show?expanded:collapsed],{duration:280,easing:'cubic-bezier(.22,.8,.25,1)',fill:'both'});
    panelAnimations.set(panel,animation);
    animation.finished.then(()=>{if(panelAnimations.get(panel)!==animation)return;panel.hidden=!show;panelAnimations.delete(panel);animation.cancel();}).catch(()=>{});
  }
  function render(){
    category.textContent=filter?categoryText(filter):tr('All categories');
    const categories=[...new Set(catalog.map(item=>item.category))];
    menu.innerHTML=['',...categories].map(name=>`<button type="button" data-picker-category="${esc(name)}" aria-pressed="${name===filter}">${esc(name?categoryText(name):tr('All categories'))}</button>`).join('');
    const query=search.value.trim().toLocaleLowerCase();
    const items=catalog.filter(item=>(!filter||item.category===filter)&&(!query||(item.name+' '+categoryText(item.category)).toLocaleLowerCase().includes(query)));
    grid.innerHTML=items.map(item=>`<button type="button" class="exercise-choice${selected.has(item.id)?' selected':''}" data-picker-id="${esc(item.id)}" aria-pressed="${selected.has(item.id)}"><span class="exercise-picture-placeholder" role="img" aria-label="${esc(tr('Exercise image placeholder'))}"><span>${esc(tr('Image'))}</span></span><span class="exercise-choice-name">${esc(item.name)}</span>${selected.has(item.id)?'<span class="exercise-choice-check" aria-hidden="true"><img src="./assets/icons/tick.svg?v=1.2.36" width="16" height="16" alt=""></span>':''}</button>`).join('')||`<p class="empty">${esc(tr('No exercises found.'))}</p>`;
    const customCategory=element.querySelector('[data-picker-custom-category]'),previous=customCategory.value;
    customCategory.innerHTML=categories.map(name=>`<option value="${esc(name)}">${esc(categoryText(name))}</option>`).join('');if(categories.includes(previous))customCategory.value=previous;
    add.textContent=tr('Add')+(selected.size?' ('+selected.size+')':'');
    add.disabled=saving||!selected.size;
  }
  function close(){if(saving)return;element.classList.remove('open');selected.clear();returnFocus?.focus?.({preventScroll:true});returnFocus=null;}
  function open(items){generation++;catalog=items.map(item=>({...item}));selected.clear();filter='';search.value='';searching=false;saving=false;showPanel(menu,false,false);showPanel(searchRow,false,false);error.textContent='';element.querySelector('[data-picker-action="categories"]').setAttribute('aria-expanded','false');element.querySelector('[data-picker-custom-name]').value='';element.querySelector('details').open=false;returnFocus=document.activeElement;render();element.querySelector('.bottom-sheet-body').scrollTop=0;element.classList.add('open');}
  function reset(){generation++;saving=false;close();catalog=[];}
  function setSaving(value){saving=value;render();for(const control of element.querySelectorAll('button,input,select'))control.disabled=value;add.disabled=value||!selected.size;}
  element.addEventListener('click',async event=>{
    if(saving)return;
    const target=event.target.closest('button');
    if(event.target===element){close();return;}
    if(!target)return;
    if(target.hasAttribute('data-picker-id')){const id=target.dataset.pickerId;selected.has(id)?selected.delete(id):selected.add(id);render();return;}
    if(target.hasAttribute('data-picker-category')){filter=target.dataset.pickerCategory;element.querySelector('[data-picker-action="categories"]').setAttribute('aria-expanded','false');render();showPanel(menu,false);return;}
    const action=target.dataset.pickerAction;
    if(action==='cancel')close();
    else if(action==='categories'){const show=menu.hidden||menu.inert;showPanel(menu,show);target.setAttribute('aria-expanded',String(show));}
    else if(action==='search'){searching=!searching;if(!searching)search.value='';render();showPanel(searchRow,searching);if(searching)search.focus();}
    else if(action==='close-search'){searching=false;search.value='';render();showPanel(searchRow,false);element.querySelector('[data-picker-action="search"]').focus();}
    else if(action==='custom'){
      const name=element.querySelector('[data-picker-custom-name]').value.trim();
      if(!name){error.textContent=tr('Enter an exercise name.');return;}
      const item={id:'custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),name,category:element.querySelector('[data-picker-custom-category]').value||'Other'};
      catalog.push(item);selected.add(item.id);filter='';search.value='';error.textContent='';element.querySelector('[data-picker-custom-name]').value='';render();
    }else if(action==='add'){
      if(!selected.size)return;const ticket=generation;error.textContent='';setSaving(true);
      try{const success=await onAdd(catalog.filter(item=>selected.has(item.id)));if(ticket!==generation)return;setSaving(false);if(success)close();else error.textContent=tr('Could not save workout. Try again.');}
      catch{if(ticket!==generation)return;setSaving(false);error.textContent=tr('Could not save workout. Try again.');}
    }
  });
  search.addEventListener('input',render);
  element.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  return {open,close,reset,refresh:render};
}
