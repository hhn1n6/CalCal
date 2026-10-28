// Multi-select exercise library. Opening or cancelling never writes account data.
export function createExercisePicker(element,{tr,onAdd,onCatalogChange=async()=>true}){
  if(!element)return {open(){},close(){},reset(){},refresh(){}};
  const grid=element.querySelector('.exercise-picker-grid'),category=element.querySelector('.exercise-picker-category-label'),menu=element.querySelector('.exercise-picker-menu'),searchRow=element.querySelector('.exercise-picker-search'),search=element.querySelector('input[type="search"]'),add=element.querySelector('[data-picker-action="add"]'),error=element.querySelector('[role="alert"]');
  let catalog=[],selected=new Set(),filter='',searching=false,saving=false,returnFocus=null,generation=0;
  let editing=null,editorOpen=false,deleteRequested=false,moreId=null;
  const editor=element.querySelector('.exercise-editor-overlay'),editorError=element.querySelector('[data-picker-editor-error]');
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
    const categories=[...new Set([...catalog.map(item=>item.category),'Chest','Back','Shoulders','Arms','Legs','Core','Cardio','Other'])];
    menu.innerHTML=['',...categories].map(name=>`<button type="button" data-picker-category="${esc(name)}" aria-pressed="${name===filter}">${esc(name?categoryText(name):tr('All categories'))}</button>`).join('');
    const query=search.value.trim().toLocaleLowerCase();
    const items=catalog.filter(item=>(!filter||item.category===filter)&&(!query||(item.name+' '+categoryText(item.category)).toLocaleLowerCase().includes(query)));
    grid.innerHTML=items.map(item=>`<div class="exercise-choice-wrap"><button type="button" class="exercise-choice${selected.has(item.id)?' selected':''}" data-picker-id="${esc(item.id)}" aria-pressed="${selected.has(item.id)}"><span class="exercise-picture-placeholder" role="img" aria-label="${esc(tr('Exercise image placeholder'))}"><span>${esc(tr('Image'))}</span></span><span class="exercise-choice-name">${esc(item.name)}</span>${selected.has(item.id)?'<span class="exercise-choice-check" aria-hidden="true"><img src="./assets/icons/tick.svg?v=1.2.39" width="16" height="16" alt=""></span>':''}</button>${!selected.has(item.id)?`<button type="button" class="btn-icon exercise-choice-more" data-picker-action="more" data-picker-edit="${esc(item.id)}" aria-label="${esc(tr('More options')+' '+item.name)}" aria-haspopup="menu" aria-expanded="${moreId===item.id}"><img src="./assets/icons/more-vertical.svg?v=1.2.39" width="22" height="22" alt=""></button>${moreId===item.id?`<div class="exercise-choice-menu" role="menu"><button type="button" role="menuitem" data-picker-action="edit" data-picker-edit="${esc(item.id)}">${esc(tr('Edit'))}</button><button type="button" role="menuitem" data-picker-action="delete-custom" data-picker-edit="${esc(item.id)}">${esc(tr('Delete'))}</button></div>`:''}`:''}</div>`).join('')+`<button type="button" class="exercise-choice exercise-custom-tile" data-picker-action="new-custom" aria-label="${esc(tr('Add custom exercise'))}"><img src="./assets/icons/add.svg?v=1.2.39" width="32" height="32" alt=""></button>`;
    const customCategory=element.querySelector('[data-picker-custom-category]'),previous=customCategory.value;
    customCategory.innerHTML=categories.map(name=>`<option value="${esc(name)}">${esc(categoryText(name))}</option>`).join('');if(categories.includes(previous))customCategory.value=previous;
    add.textContent=tr('Add')+(selected.size?' ('+selected.size+')':'');
    add.disabled=saving||!selected.size;
  }
  function editorVisible(show){editorOpen=show;editor.hidden=!show;if(show&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)editor.animate?.([{opacity:0},{opacity:1}],{duration:220});element.querySelector('.exercise-picker-sheet').inert=show;}
  function close(){if(saving)return;moreId=null;editorVisible(false);element.classList.remove('open');selected.clear();returnFocus?.focus?.({preventScroll:true});returnFocus=null;}
  function open(items){moreId=null;generation++;catalog=items.map(item=>({...item}));selected.clear();filter='';search.value='';searching=false;saving=false;editorVisible(false);showPanel(menu,false,false);showPanel(searchRow,false,false);error.textContent='';element.querySelector('[data-picker-action="categories"]').setAttribute('aria-expanded','false');element.querySelector('[data-picker-custom-name]').value='';returnFocus=document.activeElement;render();element.querySelector('.bottom-sheet-body').scrollTop=0;element.classList.add('open');}
  function openEditor(id=null){
    const item=id?catalog.find(item=>item.id===id):null;if(id&&(!item||selected.has(id)))return;
    moreId=null;render();
    editing=id;deleteRequested=false;editorError.textContent='';
    element.querySelector('[data-picker-editor-title]').textContent=tr(item?'Edit exercise':'Custom exercise');
    element.querySelector('[data-picker-custom-name]').value=item?.name||'';
    element.querySelector('[data-picker-custom-category]').value=item?.category||filter||catalog[0]?.category||'Other';
    element.querySelector('[data-picker-editor-fields]').hidden=false;
    element.querySelector('[data-picker-editor-actions]').hidden=false;
    element.querySelector('[data-picker-delete-confirm]').hidden=true;
    editorVisible(true);element.querySelector('[data-picker-custom-name]').focus?.({preventScroll:true});
  }
  function openDelete(id){
    const item=catalog.find(item=>item.id===id);if(!item||selected.has(id))return;
    moreId=null;render();editing=id;deleteRequested=true;editorError.textContent='';
    element.querySelector('[data-picker-editor-title]').textContent=tr('Delete this exercise?');
    element.querySelector('[data-picker-editor-fields]').hidden=true;
    element.querySelector('[data-picker-editor-actions]').hidden=true;
    element.querySelector('[data-picker-delete-name]').textContent=item.name;
    element.querySelector('[data-picker-delete-confirm]').hidden=false;
    editorVisible(true);element.querySelector('[data-picker-action="cancel-delete"]').focus?.({preventScroll:true});
  }
  async function saveCatalog(next,onSuccess){
    const ticket=generation;saving=true;editorError.textContent='';
    for(const control of editor.querySelectorAll?.('button,input,select')||[])control.disabled=true;
    try{if(!await onCatalogChange(next.map(item=>({...item}))))throw Error();if(ticket!==generation)return;catalog=next;onSuccess();render();editorVisible(false);}
    catch{if(ticket===generation)editorError.textContent=tr('Could not save workout. Try again.');}
    finally{if(ticket===generation){saving=false;add.disabled=!selected.size;for(const control of editor.querySelectorAll?.('button,input,select')||[])control.disabled=false;}}
  }
  function reset(){generation++;saving=false;close();catalog=[];}
  function setSaving(value){saving=value;render();for(const control of element.querySelectorAll('button,input,select'))control.disabled=value;add.disabled=value||!selected.size;}
  element.addEventListener('click',async event=>{
    if(saving)return;
    const target=event.target.closest('button');
    if(event.target===editor){editorVisible(false);return;}
    if(event.target===element){close();return;}
    if(!target){if(moreId){moreId=null;render();}return;}
    if(target.hasAttribute('data-picker-id')){moreId=null;const id=target.dataset.pickerId;selected.has(id)?selected.delete(id):selected.add(id);render();return;}
    if(target.hasAttribute('data-picker-category')){moreId=null;filter=target.dataset.pickerCategory;element.querySelector('[data-picker-action="categories"]').setAttribute('aria-expanded','false');render();showPanel(menu,false);return;}
    const action=target.dataset.pickerAction;
    if(editorOpen&&!['custom','close-editor','delete-custom','confirm-delete','cancel-delete'].includes(action))return;
    if(action==='cancel')close();
    else if(action==='more'){const id=target.dataset.pickerEdit;if(selected.has(id))return;moreId=moreId===id?null:id;render();}
    else if(action==='new-custom')openEditor();
    else if(action==='edit')openEditor(target.dataset.pickerEdit);
    else if(action==='close-editor')editorVisible(false);
    else if(action==='delete-custom')openDelete(target.dataset.pickerEdit);
    else if(action==='cancel-delete'){deleteRequested=false;editorVisible(false);}
    else if(action==='confirm-delete'){if(!deleteRequested||!editing||selected.has(editing))return;const id=editing;await saveCatalog(catalog.filter(item=>item.id!==id),()=>{selected.delete(id);if(!catalog.some(item=>item.category===filter))filter='';});}
    else if(action==='categories'){const show=menu.hidden||menu.inert;showPanel(menu,show);target.setAttribute('aria-expanded',String(show));}
    else if(action==='search'){moreId=null;searching=!searching;if(!searching)search.value='';render();showPanel(searchRow,searching);if(searching)search.focus();}
    else if(action==='close-search'){searching=false;search.value='';render();showPanel(searchRow,false);element.querySelector('[data-picker-action="search"]').focus();}
    else if(action==='custom'){
      const name=element.querySelector('[data-picker-custom-name]').value.trim();
      if(!editorOpen||(editing&&selected.has(editing)))return;
      if(!name||name.length>100){editorError.textContent=tr('Enter an exercise name.');return;}
      const existing=catalog.find(item=>item.id===editing),item={...existing,id:editing||'custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),name,category:element.querySelector('[data-picker-custom-category]').value||'Other'};
      await saveCatalog(existing?catalog.map(entry=>entry.id===editing?item:entry):[...catalog,item],()=>{if(!existing)selected.add(item.id);filter=item.category;search.value='';});
    }else if(action==='add'){
      if(!selected.size)return;const ticket=generation;error.textContent='';setSaving(true);
      try{const success=await onAdd(catalog.filter(item=>selected.has(item.id)));if(ticket!==generation)return;setSaving(false);if(success)close();else error.textContent=tr('Could not save workout. Try again.');}
      catch{if(ticket!==generation)return;setSaving(false);error.textContent=tr('Could not save workout. Try again.');}
    }
  });
  search.addEventListener('input',render);
  element.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();if(moreId){moreId=null;render();}else if(editorOpen&&!saving)editorVisible(false);else close();}else if(event.key==='Enter'&&editorOpen&&!saving&&event.target===element.querySelector('[data-picker-custom-name]')){event.preventDefault();element.querySelector('[data-picker-action="custom"]').click();}});
  return {open,close,reset,refresh:render};
}
