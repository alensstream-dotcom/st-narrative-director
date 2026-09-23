import {Controller} from './controller.mjs';
import {UI} from './ui.mjs';

function init(){
  const c=new Controller(()=>SillyTavern.getContext()),ui=new UI(c);c.onchange=()=>ui.refresh();ui.install();
  const context=c.ctx(),events=context.eventSource,types=context.eventTypes||context.event_types;
  events.on(types.GENERATION_STARTED,(...args)=>c.startRound(...args));
  events.on(types.STREAM_TOKEN_RECEIVED,text=>c.onToken(text));
  events.on(types.GENERATION_ENDED,()=>{c.endRound();ui.refresh();});
  if(types.WORLD_INFO_ACTIVATED)events.on(types.WORLD_INFO_ACTIVATED,entries=>{
    c.activeLore=(Array.isArray(entries)?entries:[]).slice(0,8).map(e=>({title:e.comment||'',keys:e.key||[],content:String(e.content||'').slice(0,1000)}));
  });
  for(const name of ['CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_EDITED'])if(types[name])events.on(types[name],()=>{c.invalidate();ui.toolbar?.remove();ui.toolbar=null;ui.selection=null;});
  for(const name of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED','MESSAGE_RECEIVED'])if(types[name])events.on(types[name],()=>ui.refresh());
  globalThis[Symbol.for('st.narrative-director.debug.v1')]={controller:c,ui};
}
if(globalThis.SillyTavern?.getContext)init();else document.addEventListener('DOMContentLoaded',init,{once:true});
