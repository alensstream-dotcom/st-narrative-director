import {NS,uuid,fingerprint,clone,narrative,completeEnd,locateQuote,validAnchor,validateScene,AutoBudget,Task,assertEnglish} from './core.mjs';
import {DirectorAPI} from './api.mjs';
import {ChatuAdapter} from './adapter.mjs';

export class Controller {
  constructor(context){
    this.ctx=context;this.tasks=new Map();this.round=null;this.onchange=()=>{};this.notice='';this.epoch=0;this.activeLore=[];
    this.adapter=new ChatuAdapter(context);this.api=new DirectorAPI(context,()=>this.config());
  }
  config(){return this.ctx().extensionSettings[NS] ||= {enabled:false,source:'deepseek',model:'',secretId:'',url:'',autoBackend:'follow',manualBackend:'follow',scopes:{}};}
  save(){this.ctx().saveSettingsDebounced();}
  status(text){this.notice=text;this.onchange();}
  chatKey(){const c=this.ctx();return `${c.groupId||c.characters?.[c.characterId]?.avatar||'solo'}::${c.getCurrentChatId?.()||c.chatId||''}`;}
  scope(){return this.config().scopes[this.chatKey()] ||= {characters:{}};}
  meta(message){message.extra ||= {};return message.extra[NS] ||= {id:uuid(),images:[],states:[]};}
  bind(index,raw,end){
    const m=this.ctx().chat[index];if(!m)throw new Error('原消息已不存在');
    return {chat:this.chatKey(),message:this.meta(m).id,swipe:m.swipe_id||0,prefix:fingerprint(raw.slice(0,end)),end};
  }
  resolve(b){
    if(b.chat!==this.chatKey())return null;
    const index=this.ctx().chat.findIndex(m=>m.extra?.[NS]?.id===b.message),m=this.ctx().chat[index];
    if(!m||(m.swipe_id||0)!==b.swipe||fingerprint(m.mes.slice(0,b.end))!==b.prefix)return null;
    return {message:m,index};
  }
  historyAt(index,offset){
    const chat=this.ctx().chat;
    const recent=chat.slice(Math.max(0,index-3),index).filter(m=>!m.is_system).map(m=>narrative(m.mes)).join('\n').slice(-4500);
    const states=[];
    for(let i=Math.max(0,index-40);i<=index;i++)for(const s of chat[i]?.extra?.[NS]?.states||[]){
      if(s.swipe===(chat[i].swipe_id||0)&&(i<index||s.end<=offset)&&fingerprint(chat[i].mes.slice(0,s.end))===s.prefix)states.push(s.value);
    }
    return {recent:recent+'\n'+narrative(chat[index]?.mes||'').slice(Math.max(0,offset-2500),offset),states:states.slice(-12)};
  }
  card(){
    const c=this.ctx().characters?.[this.ctx().characterId];if(!c)return {};
    const d=c.data||c;
    return {name:d.name,description:String(d.description||c.description||'').slice(0,6000),scenario:String(d.scenario||c.scenario||'').slice(0,1800),
      lore:(d.character_book?.entries||[]).filter(e=>e.enabled!==false).slice(0,8).map(e=>({keys:e.keys,content:String(e.content||'').slice(0,900)}))};
  }
  async analyze(index,raw,start,end,manual,signal,chosen=[]){
    const binding=this.bind(index,raw,end),epoch=this.epoch;
    const history=this.historyAt(index,start),selected=raw.slice(start,end),text=selected+history.recent;
    const linked=new Set(Object.values(this.scope().characters).map(c=>c.profile));
    const profiles=this.adapter.profiles().filter(p=>(p.enabled||linked.has(p.id)||p.directorScope===this.chatKey())&&[p.nameCN,p.nameEN].some(v=>String(v||'').split('|').some(n=>n&&text.includes(n)))).slice(0,12);
    const registry=Object.values(this.scope().characters).map(c=>({id:c.id,name:c.name,aliases:c.aliases,profile:c.profile,lock:c.lock})).slice(-20);
    const styleSettings=this.adapter.settings(),style=styleSettings.yushe?.[styleSettings.yusheid_comfyui];
    const input={mode:manual?'manual':'automatic',CURRENT_TEXT:narrative(selected),PREVIOUS_CONTEXT:history,character_card:this.card(),original_profiles:profiles,
      renderer_style:{prefix:style?.fixedPrompt||'',suffix:style?.fixedPrompt_end||'',rule:'Describe scene content only. Do not override these styles or add style exclusions.'},
      active_lore:this.activeLore,visual_registry:registry,already_chosen:chosen.map(s=>({event_key:s.event_key,moment:s.moment})),remaining:2-chosen.length};
    const result=await this.api.analyze(input,signal);
    if(epoch!==this.epoch||!this.resolve(binding))throw new Error('分析期间原文已改变');
    const scenes=result.scenes.slice(0,manual?1:2).map(s=>validateScene(s,raw,{start,end},manual)).filter(Boolean);
    const m=this.ctx().chat[index];
    for(const state of result.state_updates.slice(0,12)){
      try{
        const a=locateQuote(raw,state.evidence,start,end),entry={swipe:binding.swipe,end:a.end,prefix:fingerprint(raw.slice(0,a.end)),value:state};
        if(!this.meta(m).states.some(s=>s.prefix===entry.prefix))this.meta(m).states.push(entry);
      }catch{/* Do not save ungrounded state. */}
    }
    this.meta(m).states=this.meta(m).states.slice(-30);
    for(const scene of scenes){scene.analysisMs=result.analysisMs;this.prepareCharacters(scene,input);}
    await this.ctx().saveChat();return {binding,scenes};
  }
  prepareCharacters(scene,input){
    const registry=this.scope().characters,evidence=JSON.stringify(input);
    for(const cast of scene.cast){
      const names=[cast.name,...(cast.aliases||[])];
      let character=Object.values(registry).find(c=>[c.name,...c.aliases].some(n=>names.includes(n)));
      if(!character){
        const id=uuid(),matches=this.adapter.profiles().filter(p=>(p.enabled||p.directorScope===this.chatKey())&&[p.nameCN,p.nameEN].some(v=>String(v||'').split('|').some(n=>names.includes(n))));
        const facts=cast.fixed_facts.filter(f=>evidence.includes(f.evidence)&&['hair_color','hair_style','eye_color','face','build','distinctive_features'].includes(f.field));
        const profile=matches.length===1?matches[0].id:this.adapter.upsertProfile(id,cast.name,facts.map(f=>`${f.field.replaceAll('_',' ')}: ${f.value}`).join('; '),undefined,this.chatKey());
        character=registry[id]={id,name:cast.name,aliases:cast.aliases||[],profile,lock:null,created:Date.now()};
      }
      cast.character_id=character.id;cast.profile_ref=character.profile;
    }
    this.save();
  }
  effective(scene,snapshot){
    const join=values=>[...new Set(values.filter(x=>x?.trim()).map(x=>x.trim()))].join(', ');
    return {positive:join([snapshot.prefix,scene.basePositive||scene.positive,snapshot.suffix]),negative:join([snapshot.negative,'text, lettering, speech balloons'])};
  }
  enqueue(binding,scene,origin,snapshot){
    if(!this.resolve(binding))throw new Error('原文已改变，任务未提交');
    assertEnglish(scene.positive);assertEnglish(scene.negative);
    if(origin==='automatic'&&snapshot.warning&&this.config().approvedModel!==snapshot.model)throw new Error('保存的模型已失效，请先在手动预览中确认当前可用模型');
    if(origin==='manual'){this.config().approvedModel=snapshot.model;this.save();}
    const task=new Task({binding,scene,origin,backend:snapshot.backend,snapshot});task.abort=new AbortController();
    this.tasks.set(task.id,task);this.onchange();void this.runTask(task);return task;
  }
  async runTask(task){
    const timer=setTimeout(()=>{task.set('expired','超过 10 分钟，停止展示晚到结果');task.abort.abort();this.onchange();},600000);
    try{
      if(task.terminal||!this.resolve(task.binding)){task.set('expired');return;}
      const result=await this.adapter.generate(task.snapshot,{id:task.id,chatId:task.binding.chat,positive:task.scene.positive,negative:task.scene.negative},state=>{
        if(state.nativeId)task.nativeId=state.nativeId;if(['queued','accepted','running','submitted'].includes(state.state))task.set(state.state);this.onchange();
      },task.abort.signal);
      if(task.terminal)return;
      const target=this.resolve(task.binding);
      if(!target||!validAnchor(target.message.mes,task.scene.anchor)){task.set('expired');return;}
      const record={id:task.id,binding:task.binding,scene:clone(task.scene),imageId:result.imageId,backend:task.backend,model:task.snapshot.model,params:result.params,times:task.times};
      if(!this.meta(target.message).images.some(r=>r.id===task.id))this.meta(target.message).images.push(record);
      task.set('done');await this.ctx().saveChat();
    }catch(e){task.set('failed',String(e.message).slice(0,160));}
    finally{clearTimeout(timer);this.onchange();}
  }
  cancel(task){task.set('cancelled','停止排队/展示；已提交的算力不保证撤销');task.abort.abort();this.onchange();}
  toggleLock(record,cast){
    const c=this.scope().characters[cast.character_id];if(!c)return;
    if(c.lock){c.lock=null;}else{
      c.lock={confirmedAt:Date.now(),traits:cast.fixed_facts.map(f=>`${f.field.replaceAll('_',' ')}: ${f.value}`).join('; '),facts:clone(cast.fixed_facts),profile:c.profile,strategy:'description',sourceImage:record.scene.cast.length===1?record.imageId:null};
    }
    this.save();return c.lock;
  }
  startRound(type,options,dryRun){
    if(dryRun||['quiet','impersonate'].includes(type))return;
    if(this.round){this.round.abort.abort();clearTimeout(this.round.timer);}
    this.round={budget:new AutoBudget(),cursor:type==='continue'?(this.ctx().chat.at(-1)?.mes.length||0):0,final:false,busy:false,lastCall:0,abort:new AbortController()};
  }
  onToken(text){
    const r=this.round;if(!this.config().enabled||!r||typeof text!=='string')return;
    if(!r.timer)r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},700);
  }
  async pump(r=this.round){
    if(!r||r!==this.round||r.busy||r.abort.signal.aborted||!this.config().enabled||r.budget.accepted.length>=2)return;
    const index=this.ctx().chat.length-1,m=this.ctx().chat[index];if(!m||m.is_user||m.is_system)return;
    const raw=m.mes||'',end=completeEnd(narrative(raw),r.final);
    if(end<=r.cursor||end-r.cursor<100&&!r.final)return;
    if(!r.final&&Date.now()-r.lastCall<7000){r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},1500);return;}
    r.busy=true;r.lastCall=Date.now();this.status('导演正在旁路分析');
    try{
      const result=await this.analyze(index,raw,r.cursor,end,false,r.abort.signal,r.budget.accepted);
      if(r!==this.round||r.abort.signal.aborted||!this.config().enabled)return;
      r.cursor=end;
      for(const scene of result.scenes){
        if(r.budget.accept(scene,r.final)){
          await this.adapter.inspectComfy();
          const snapshot=this.adapter.snapshot(this.config().autoBackend),prompts=this.effective(scene,snapshot);
          scene.basePositive=scene.positive;
          scene.positive=assertEnglish(prompts.positive);scene.negative=assertEnglish(prompts.negative);
          this.enqueue(this.bind(index,raw,scene.anchor.end),scene,'automatic',snapshot);
        }
      }
      this.status(`本轮自动镜头 ${r.budget.accepted.length}/2`);
    }catch(e){if(!r.abort.signal.aborted){this.status(e.message);r.cursor=end;}}
    finally{r.busy=false;if(r===this.round&&!r.abort.signal.aborted&&r.cursor<(this.ctx().chat[index]?.mes.length||0))r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},1200);}
  }
  endRound(){const r=this.round;if(r){r.final=true;setTimeout(()=>void this.pump(r),300);}}
  invalidate(){
    this.epoch++;this.activeLore=[];if(this.round){this.round.abort.abort();clearTimeout(this.round.timer);this.round=null;}
    for(const task of this.tasks.values())if(!task.terminal&&!this.resolve(task.binding)){task.set('expired');task.abort.abort();}
    this.onchange();
  }
}
