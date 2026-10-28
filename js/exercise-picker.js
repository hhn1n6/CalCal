// Multi-select exercise library. Opening or cancelling never writes account data.
export function createExercisePicker(element,{tr,onAdd}){
  if(!element)return {open(){},close(){},reset(){},refresh(){}};
  const grid=element.querySelector('.exercise-picker-grid'),category=element.querySelector('.exercise-picker-category-label'),menu=element.querySelector('.exercise-picker-menu'),searchRow=element.querySelector('.exercise-picker-search'),search=element.querySelector('input[type="search"]'),add=element.querySelector('[data-picker-action="add"]'),error=element.querySelector('[role="alert"]');
  let catalog=[],selected=new Set(),filter='',searching=false,saving=false,returnFocus=null,generation=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const categoryText=value=>value==='Back'?(tr('Back muscles')==='Back muscles'?'Back':tr('Back muscles')):tr(value);
  function render(){
    category.textContent=filter?categoryText(filter):tr('All categories');
    const categories=[...new Set(catalog.map(item=>item.category))];
    menu.innerHTML=['',...categories].map(name=>`<button type="button" data-picker-category="${esc(name)}" aria-pressed="${name===filter}">${esc(name?categoryText(name):tr('All categories'))}</button>`).join('');
    const query=search.value.trim().toLocaleLowerCase();
    const items=catalog.filter(item=>(!filter||item.category===filter)&&(!query||(item.name+' '+categoryText(item.category)).toLocaleLowerCase().includes(query)));
    grid.innerHTML=items.map(item=>`<button type="button" class="exercise-choice${selected.has(item.id)?' selected':''}" data-picker-id="${esc(item.id)}" aria-pressed="${selected.has(item.id)}"><span class="exercise-picture-placeholder" role="img" aria-label="${esc(tr('Exercise image placeholder'))}"><span>${esc(tr('Image'))}</span></span><span class="exercise-choice-name">${esc(item.name)}</span>${selected.has(item.id)?'<span class="exercise-choice-check" aria-hidden="true">✓</span>':''}</button>`).join('')||`<p class="empty">${esc(tr('No exercises found.'))}</p>`;
    const customCategory=element.querySelector('[data-picker-custom-category]'),previous=customCategory.value;
    customCategory.innerHTML=categories.map(name=>`<option value="${esc(name)}">${esc(categoryText(name))}</option>`).join('');if(categories.includes(previous))customCategory.value=previous;
    searchRow.hidden=!searching;add.textContent=tr('Add')+(selected.size?' ('+selected.size+')':'');
    add.disabled=saving||!selected.size;
  }
  function close(){if(saving)return;element.classList.remove('open');selected.clear();returnFocus?.focus?.({preventScroll:true});returnFocus=null;}
  function open(items){generation++;catalog=items.map(item=>({...item}));selected.clear();filter='';search.value='';searching=false;saving=false;menu.hidden=true;error.textContent='';element.querySelector('[data-picker-action="categories"]').setAttribute('aria-expanded','false');element.querySelector('[data-picker-custom-name]').value='';element.querySelector('details').open=false;returnFocus=document.activeElement;render();element.querySelector('.bottom-sheet-body').scrollTop=0;element.classList.add('open');}
  function reset(){generation++;saving=false;close();catalog=[];}
  function setSaving(value){saving=value;render();for(const control of element.querySelectorAll('button,input,select'))control.disabled=value;add.disabled=value||!selected.size;}
  element.addEventListener('click',async event=>{
    if(saving)return;
    const target=event.target.closest('button');
    if(event.target===element){close();return;}
    if(!target)return;
    if(target.hasAttribute('data-picker-id')){const id=target.dataset.pickerId;selected.has(id)?selected.delete(id):selected.add(id);render();return;}
    if(target.hasAttribute('data-picker-category')){filter=target.dataset.pickerCategory;menu.hidden=true;element.querySelector('[data-picker-action="categories"]').setAttribute('aria-expanded','false');render();return;}
    const action=target.dataset.pickerAction;
    if(action==='cancel')close();
    else if(action==='categories'){menu.hidden=!menu.hidden;target.setAttribute('aria-expanded',String(!menu.hidden));}
    else if(action==='search'){searching=!searching;if(!searching)search.value='';render();if(searching)search.focus();}
    else if(action==='close-search'){searching=false;search.value='';render();element.querySelector('[data-picker-action="search"]').focus();}
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
