import {Controller} from './controller.mjs';
import {UI} from './ui.mjs';

function init(){
  if(!globalThis.SillyTavern?.getContext)return;
  const c=new Controller(()=>SillyTavern.getContext()),ui=new UI(c);c.onchange=()=>ui.refresh();ui.install();
  const ctx=c.ctx(),events=ctx.eventSource,types=ctx.eventTypes||ctx.event_types||{};
  const on=(name,fn)=>{if(types[name])events.on(types[name],fn);};
  on('GENERATION_STARTED',(_type,_options,dryRun)=>{if(!dryRun){c.generating=true;c.lastWorldbookActivation=false;ui.refresh();}});
  for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])on(name,()=>{c.generating=false;ui.refresh();});
  events.on('generate-image-response',result=>c.onChatuResult(result));
  on('WORLD_INFO_ACTIVATED',entries=>{c.lastWorldbookActivation=Boolean(c.lastWorldbookActivation||(Array.isArray(entries)?entries:[]).some(e=>String(e.content||'').includes('ANIMA_STORY_SAFE_V4')));});
  for(const name of ['CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_EDITED'])on(name,()=>{
    c.invalidate();ui.clearSelection();ui.pendingActivation.clear();if(name==='CHAT_CHANGED')c.lastWorldbookActivation=undefined;
  });
  for(const name of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED','MESSAGE_RECEIVED'])on(name,()=>ui.refresh());
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
