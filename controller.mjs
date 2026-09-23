import {NS,uuid,fingerprint,clone,narrative,completeEnd,locateQuote,validAnchor,validateScene,AutoBudget,Task,assertEnglish} from './core.mjs';
import {DirectorAPI} from './api.mjs';
import {ChatuAdapter} from './adapter.mjs';
import {prototypeCandidates,prototypeTag} from './prototypes.mjs';

export class Controller {
  constructor(context){
    this.ctx=context;this.tasks=new Map();this.round=null;this.onchange=()=>{};this.notice='';this.epoch=0;this.activeLore=[];
    this.adapter=new ChatuAdapter(context);this.api=new DirectorAPI(context,()=>this.config());
  }
  config(){const c=this.ctx().extensionSettings[NS] ||= {enabled:false,source:'deepseek',model:'',secretId:'',url:'',autoBackend:'follow',manualBackend:'follow',scopes:{}};c.scopes ||= {};return c;}
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
    for(let i=0;i<=index;i++)for(const s of chat[i]?.extra?.[NS]?.states||[]){
      if(s.swipe===(chat[i].swipe_id||0)&&(i<index||s.end<=offset)&&fingerprint(chat[i].mes.slice(0,s.end))===s.prefix)states.push(s.value);
    }
    const contextText=recent+'\n'+narrative(chat[index]?.mes||'').slice(Math.max(0,offset-2500),offset);
    const relevant=new Set(Object.values(this.scope().characters).filter(c=>[c.name,...(c.aliases||[])].some(n=>n&&contextText.includes(n))).map(c=>c.name));
    const latest=new Map();
    for(const state of states)for(const character of state.characters||[])if(character.name&&relevant.has(character.name)){
      latest.delete(character.name);latest.set(character.name,{...state,characters:[character]});
    }
    const compressed=[...latest.values()].slice(-12);
    return {recent:contextText,states:compressed.length?compressed:states.slice(-4)};
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
    for(const c of Object.values(this.scope().characters)){
      const p=this.adapter.profiles().find(p=>p.id===c.profile);
      if(p&&!profiles.some(x=>x.id===p.id)&&[c.name,...(c.aliases||[])].some(n=>n&&text.includes(n)))profiles.push(p);
    }
    const originalOutfits=profiles.map(p=>{
      const linked=this.adapter.outfitsForProfile(p.id);
      const named=linked.filter(o=>[o.nameCN,o.nameEN].some(name=>name&&text.includes(name)));
      return {profile_ref:p.id,outfits:[...new Map([...named,...linked.slice(-3)].map(o=>[o.id,o])).values()].slice(0,5).map(o=>({id:o.id,nameCN:o.nameCN,nameEN:o.nameEN,description:o.description.slice(0,160)}))};
    }).filter(p=>p.outfits.length);
    const styleSettings=this.adapter.settings(),style=styleSettings.yushe?.[styleSettings.yusheid_comfyui];
    const input={mode:manual?'manual':'automatic',CURRENT_TEXT:narrative(selected),PREVIOUS_CONTEXT:history,character_card:this.card(),original_profiles:profiles,original_outfits:originalOutfits,
      renderer_style:{prefix:style?.fixedPrompt||'',suffix:style?.fixedPrompt_end||'',rule:'Describe scene content only. Do not override these styles or add style exclusions.'},
      active_lore:this.activeLore,visual_registry:registry,already_chosen:chosen.map(s=>({event_key:s.event_key,moment:s.moment})),remaining:2-chosen.length};
    const result=await this.api.analyze(input,signal);
    if(epoch!==this.epoch||!this.resolve(binding))throw new Error('分析期间原文已改变');
    const scenes=result.scenes.slice(0,manual?3:2).map(s=>validateScene(s,raw,{start,end},manual)).filter(Boolean);
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
      const facts=cast.fixed_facts.filter(f=>typeof f.evidence==='string'&&f.evidence.length>0&&evidence.includes(f.evidence)&&['hair_color','hair_style','eye_color','face','build','distinctive_features'].includes(f.field)&&!/[^\x20-\x7e]/.test(f.value));
      cast.fixed_facts=facts;
      if(!character){
        const id=uuid(),matches=this.adapter.profiles().filter(p=>(p.enabled||p.directorScope===this.chatKey())&&[p.nameCN,p.nameEN].some(v=>String(v||'').split('|').some(n=>names.includes(n))));
        const profile=matches.length===1?matches[0].id:this.adapter.upsertProfile(id,cast.name,'',undefined,this.chatKey());
        character=registry[id]={id,name:cast.name,aliases:cast.aliases||[],profile,lock:null,created:Date.now()};
      }
      character.aliases=[...new Set([...(character.aliases||[]),...(cast.aliases||[])])];
      for(const fixed of character.lock?.facts||[]){
        const proposed=facts.find(f=>f.field===fixed.field);
        if(proposed&&proposed.value.toLowerCase()!==fixed.value.toLowerCase())throw new Error(`${character.name} 的外貌与已锁定档案冲突，请核对人物关联后重新分析`);
      }
      character.sync=this.adapter.syncOwnedFacts(character.profile,character.id,facts);
      character.visualFacts ||= {};
      for(const fact of facts)character.visualFacts[fact.field]=fact.value;
      if(!character.lock&&(!character.prototypeMode||character.prototypeMode==='auto')){
        const candidates=prototypeCandidates(Object.entries(character.visualFacts).map(([field,value])=>({field,value})),cast.gender);
        character.prototypeMode='auto';
        if(!candidates.some(p=>p.id===character.prototypeId))character.prototypeId=candidates[0]?.id||'';
      }
      cast.character_id=character.id;cast.profile_ref=character.profile;
      const clothingSources=[input.CURRENT_TEXT||'',input.PREVIOUS_CONTEXT?.recent||'',JSON.stringify(input.PREVIOUS_CONTEXT?.states||[]),JSON.stringify(input.character_card||{}),JSON.stringify((input.original_outfits||[]).find(p=>p.profile_ref===character.profile)||{})];
      cast.outfit_grounded=typeof cast.outfit_evidence==='string'&&cast.outfit_evidence.trim().length>=2&&clothingSources.some(source=>source.includes(cast.outfit_evidence));
    }
    this.save();
  }
  linkProfile(characterId,profileId){
    const character=this.scope().characters[characterId];if(!character||!this.adapter.profile(profileId))throw new Error('人物或智绘姬档案不存在');
    if(character.lock)throw new Error('请先解除此人物的锁定，再更换档案');
    character.profile=profileId;character.sync={updated:false,reason:'linked'};this.save();this.onchange();
  }
  prototypeCandidates(character){return prototypeCandidates(Object.entries(character.visualFacts||{}).map(([field,value])=>({field,value})),'female');}
  setPrototype(characterId,mode,id='',custom=''){
    const character=this.scope().characters[characterId];if(!character)throw new Error('人物不存在');
    if(character.lock)throw new Error('请先解除人物形象锁定，再切换视觉原型');
    if(!['auto','none','candidate','custom'].includes(mode))throw new Error('未知视觉原型模式');
    if(mode==='candidate'&&!this.prototypeCandidates(character).some(p=>p.id===id))throw new Error('候选原型与已知外貌不匹配');
    if(mode==='custom'&&(!custom.trim()||custom.length>100||/[^\x20-\x7e]/.test(custom)))throw new Error('自定义角色 Tag 需为 1–100 个英文字符');
    character.prototypeMode=mode;
    character.prototypeId=mode==='auto'?this.prototypeCandidates(character)[0]?.id||'':mode==='candidate'?id:'';
    character.prototypeCustom=mode==='custom'?custom.trim():'';
    this.save();this.onchange();
  }
  setLock(character,lock){character.lockHistory ||= [];character.lockHistory.push(clone(character.lock||null));character.lockHistory=character.lockHistory.slice(-5);character.lock=lock;this.save();}
  restoreLock(id){const c=this.scope().characters[id];if(!c?.lockHistory?.length)throw new Error('没有可回滚的锁定记录');c.lock=c.lockHistory.pop();this.save();this.onchange();}
  effective(scene,snapshot){
    const join=values=>[...new Set(values.filter(x=>x?.trim()).map(x=>x.trim()))].join(', ');
    const negative=[snapshot.negative,scene.baseNegative||(scene.basePositive?'':scene.negative),'text, lettering, speech balloons'].filter(Boolean).flatMap(x=>x.split(',').map(tag=>tag.trim()).filter(Boolean));
    const character=scene.cast?.length===1?this.scope().characters[scene.cast[0].character_id]:null;
    const tag=prototypeTag(character,snapshot.backend,snapshot.model);
    return {positive:join([snapshot.prefix,tag?`1girl, ${tag}`:'',scene.basePositive||scene.positive,snapshot.suffix]),negative:[...new Map(negative.map(tag=>[tag.toLowerCase(),tag])).values()].join(', '),prototypeTag:tag};
  }
  enqueue(binding,scene,origin,snapshot){
    if(!this.resolve(binding))throw new Error('原文已改变，任务未提交');
    assertEnglish(scene.positive);assertEnglish(scene.negative);
    if(origin==='automatic'&&snapshot.warning&&this.config().approvedModel!==snapshot.model)throw new Error('保存的模型已失效，请先在手动预览中确认当前可用模型');
    if(origin==='manual'){this.config().approvedModel=snapshot.model;this.save();}
    for(const cast of scene.cast||[]){
      if(cast.character_id&&cast.profile_ref&&cast.outfit_grounded){
        cast.outfit_ref=this.adapter.upsertOutfit(cast.character_id,cast.profile_ref,cast.name,cast.outfit,this.chatKey());
      }
    }
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
    if(c.lock){this.setLock(c,null);}else{
      if(!cast.fixed_facts?.length)throw new Error('当前镜头没有可核实的固定外貌，不能保存空锁定');
      this.setLock(c,{confirmedAt:Date.now(),traits:cast.fixed_facts.map(f=>`${f.field.replaceAll('_',' ')}: ${f.value}`).join('; '),facts:clone(cast.fixed_facts),profile:c.profile,strategy:c.prototypeId||c.prototypeCustom?'character-tag-plus-description':'description',prototypeTag:record.scene.prototypeTag||'',sourceImage:record.scene.cast.length===1?record.imageId:null});
    }
    this.save();return c.lock;
  }
  startRound(type,options,dryRun){
    if(dryRun||['quiet','impersonate'].includes(type))return;
    if(this.round){this.round.abort.abort();clearTimeout(this.round.timer);}
    this.round={budget:new AutoBudget(),pending:[],messageId:null,cursor:type==='continue'?(this.ctx().chat.at(-1)?.mes.length||0):0,final:false,busy:false,failed:false,lastCall:0,abort:new AbortController()};
  }
  onToken(text){
    const r=this.round;if(!this.config().enabled||!r||typeof text!=='string')return;
    if(!r.timer)r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},700);
  }
  async pump(r=this.round){
    if(!r||r!==this.round||r.busy||r.failed||r.abort.signal.aborted||!this.config().enabled||r.budget.accepted.length>=2)return;
    const index=r.messageId?this.ctx().chat.findIndex(m=>m.extra?.[NS]?.id===r.messageId):this.ctx().chat.length-1,m=this.ctx().chat[index];if(!m||m.is_user||m.is_system)return;
    r.messageId=this.meta(m).id;
    const raw=m.mes||'',end=completeEnd(narrative(raw),r.final);
    if((end<=r.cursor&&!r.final)||(end<=r.cursor&&!r.pending.length)||end-r.cursor<100&&!r.final)return;
    if(!r.final&&Date.now()-r.lastCall<7000){r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},1500);return;}
    r.busy=true;r.lastCall=Date.now();this.status('导演正在旁路分析');
    try{
      const result=end>r.cursor?await this.analyze(index,raw,r.cursor,end,false,r.abort.signal,r.budget.accepted):{scenes:[]};
      if(r!==this.round||r.abort.signal.aborted||!this.config().enabled)return;
      r.cursor=end;
      for(const scene of result.scenes){
        if(!r.pending.some(x=>x.scene.event_key===scene.event_key))r.pending.push({scene,binding:this.bind(index,raw,scene.anchor.end)});
      }
      r.pending=r.pending.filter(x=>this.resolve(x.binding)&&validAnchor(raw,x.scene.anchor)).sort((a,b)=>b.scene.score-a.scene.score).slice(0,6);
      for(const candidate of [...r.pending]){
        const {scene,binding}=candidate;
        if(r.budget.canAccept(scene,r.final)){
          await this.adapter.inspectComfy();
          const snapshot=this.adapter.snapshot(this.config().autoBackend),prompts=this.effective(scene,snapshot);
          scene.basePositive ||=scene.positive;scene.baseNegative ||=scene.negative;scene.prototypeTag=prompts.prototypeTag;
          scene.positive=assertEnglish(prompts.positive);scene.negative=assertEnglish(prompts.negative);
          if(r!==this.round||r.abort.signal.aborted)return;
          this.enqueue(binding,scene,'automatic',snapshot);
          r.budget.accept(scene,r.final);r.pending=r.pending.filter(x=>x!==candidate);
        }
      }
      this.status(`本轮自动镜头 ${r.budget.accepted.length}/2`);
    }catch(e){if(!r.abort.signal.aborted){r.failed=true;this.status(e.message);}}
    finally{r.busy=false;if(r===this.round&&!r.failed&&!r.abort.signal.aborted&&r.cursor<(this.ctx().chat[index]?.mes.length||0))r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},1200);}
  }
  retryAnalysis(){if(!this.round)throw new Error('本轮分析已结束，请手动选择需要的片段');this.round.failed=false;void this.pump(this.round);}
  endRound(){const r=this.round;if(r){r.final=true;setTimeout(()=>void this.pump(r),300);}}
  invalidate(){
    this.epoch++;this.activeLore=[];if(this.round){this.round.abort.abort();clearTimeout(this.round.timer);this.round=null;}
    for(const task of this.tasks.values())if(!task.terminal&&!this.resolve(task.binding)){task.set('expired');task.abort.abort();}
    this.onchange();
  }
}
