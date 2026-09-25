import {NS,uuid,fingerprint,clone,narrative,completeEnd,locateQuote,validAnchor,validateScene,AutoBudget,Task,assertEnglish} from './core.mjs';
import {DirectorAPI} from './api.mjs';
import {ChatuAdapter} from './adapter.mjs';
import {prototypeCandidates,prototypeTag} from './prototypes.mjs';

export class Controller {
  constructor(context){
    this.ctx=context;this.tasks=new Map();this.round=null;this.finishingRounds=new Set();this.onchange=()=>{};this.notice='';this.epoch=0;this.activeLore=[];
    this.adapter=new ChatuAdapter(context);this.api=new DirectorAPI(context,()=>this.config());
  }
  config(){const c=this.ctx().extensionSettings[NS] ||= {enabled:false,source:'custom',model:'gpt-6-sol',streamModel:'gpt-6-sol',secretId:'',url:'https://api-slb.krill-code.net/v1',credentialMode:'session',autoBackend:'comfyui',manualBackend:'comfyui',scopes:{}};if(!Object.hasOwn(c,'streamModel'))c.streamModel='gpt-6-sol';c.scopes ||= {};return c;}
  save(){this.ctx().saveSettingsDebounced();}
  status(text){this.notice=text;this.onchange();}
  chatKey(){const c=this.ctx();return `${c.groupId||c.characters?.[c.characterId]?.avatar||'solo'}::${c.getCurrentChatId?.()||c.chatId||''}`;}
  scope(){return this.config().scopes[this.chatKey()] ||= {characters:{}};}
  meta(message){message.extra ||= {};const meta=message.extra[NS] ||= {id:uuid(),images:[],states:[],prompts:[]};meta.prompts ||= [];return meta;}
  bind(index,raw,end,quote=''){
    const m=this.ctx().chat[index];if(!m)throw new Error('原消息已不存在');
    return {chat:this.chatKey(),message:this.meta(m).id,swipe:m.swipe_id||0,prefix:fingerprint(raw.slice(0,end)),end,...(quote?{quote}:{})};
  }
  resolveMessage(b){
    if(b.chat!==this.chatKey())return null;
    const index=this.ctx().chat.findIndex(m=>m.extra?.[NS]?.id===b.message),m=this.ctx().chat[index];
    if(!m||(m.swipe_id||0)!==b.swipe)return null;
    return {message:m,index};
  }
  resolve(b){
    const target=this.resolveMessage(b);if(!target)return null;
    const {message:m,index}=target;
    if(b.quote){try{return {message:m,index,anchor:locateQuote(m.mes,b.quote,0,m.mes.length)};}catch{return null;}}
    if(fingerprint(m.mes.slice(0,b.end))!==b.prefix)return null;
    return {message:m,index};
  }
  historyAt(index,offset,focus=''){
    const chat=this.ctx().chat;
    const compact=text=>narrative(text).replace(/\s+/g,' ').trim();
    const recent=chat.slice(Math.max(0,index-3),index).filter(m=>!m.is_system).map(m=>compact(m.mes)).join('\n').slice(-2200);
    const states=[];
    for(let i=0;i<=index;i++)for(const s of chat[i]?.extra?.[NS]?.states||[]){
      if(s.swipe===(chat[i].swipe_id||0)&&(i<index||s.end<=offset)&&fingerprint(chat[i].mes.slice(0,s.end))===s.prefix)states.push(s.value);
    }
    const before=compact(narrative(chat[index]?.mes||'').slice(0,offset)).slice(-1800);
    const contextText=recent+'\n'+before+'\n'+compact(focus).slice(0,1800);
    const relevant=new Set(Object.values(this.scope().characters).filter(c=>[c.name,...(c.aliases||[])].some(n=>n&&contextText.includes(n))).map(c=>c.name));
    const latest=new Map();
    for(const state of states)for(const character of state.characters||[])if(character.name&&relevant.has(character.name)){
      latest.delete(character.name);latest.set(character.name,{...state,characters:[character]});
    }
    const compressed=[...latest.values()].slice(-6);
    const bounded=(compressed.length?compressed:states.slice(-2)).map(s=>({
      evidence:String(s.evidence||'').slice(-180),
      characters:(s.characters||[]).slice(-4).map(c=>({name:c.name,outfit:String(c.outfit||'').slice(0,140),location:String(c.location||'').slice(0,100),time:String(c.time||'').slice(0,80),injury:String(c.injury||'').slice(0,80)}))
    }));
    return {recent:contextText.slice(-3200),states:bounded};
  }
  card(relevanceText=''){
    const c=this.ctx().characters?.[this.ctx().characterId];if(!c)return {};
    const d=c.data||c;
    const focus=String(relevanceText).toLowerCase();
    const lore=(d.character_book?.entries||[]).filter(e=>e.enabled!==false).filter(e=>{
      const keys=Array.isArray(e.keys)?e.keys:String(e.keys||e.key||'').split(',');
      return e.constant===true||keys.some(key=>String(key||'').trim().length>1&&focus.includes(String(key).trim().toLowerCase()));
    }).slice(0,4).map(e=>({keys:e.keys,content:String(e.content||'').slice(0,500)}));
    return {name:d.name,description:String(d.description||c.description||'').slice(0,2400),scenario:String(d.scenario||c.scenario||'').slice(0,700),lore};
  }
  async analyze(index,raw,start,end,manual,signal,chosen=[],onEarlyScene){
    const fallback=manual==='fallback',isManual=manual===true;
    let binding=this.bind(index,raw,end);const epoch=this.epoch,selected=raw.slice(start,end);
    const history=this.historyAt(index,start,selected);
    if(!isManual){history.recent=history.recent.slice(-1400);history.states=history.states.slice(-4);}
    const text=selected+history.recent;
    const linked=new Set(Object.values(this.scope().characters).map(c=>c.profile));
    const profiles=this.adapter.profiles().filter(p=>(p.enabled||linked.has(p.id)||p.directorScope===this.chatKey())&&[p.nameCN,p.nameEN].some(v=>String(v||'').split('|').some(n=>n&&text.includes(n)))).slice(0,isManual?6:4)
      .map(p=>({...p,characterTraits:String(p.characterTraits||'').slice(0,500),facialFeatures:String(p.facialFeatures||'').slice(0,400)}));
    const registry=Object.values(this.scope().characters).filter(c=>[c.name,...(c.aliases||[])].some(n=>n&&text.includes(n))).slice(-(isManual?8:4))
      .map(c=>{const profile=this.adapter.profile(c.profile);return {id:c.id,name:c.name,aliases:c.aliases,gender:c.gender,profile:c.profile,visualFacts:c.visualFacts||{},profileTraits:String(profile?.characterTraits||'').slice(0,260),facialFeatures:String(profile?.facialFeatures||'').slice(0,180),lock:c.lock?{facts:(c.lock.facts||[]).slice(0,8)}:null,prototypeMode:c.prototypeMode,prototypeId:c.prototypeId,prototypeCustom:c.prototypeCustom};});
    for(const c of Object.values(this.scope().characters)){
      const p=this.adapter.profiles().find(p=>p.id===c.profile);
      if(p&&!profiles.some(x=>x.id===p.id)&&[c.name,...(c.aliases||[])].some(n=>n&&text.includes(n)))profiles.push(p);
    }
    const originalOutfits=profiles.map(p=>{
      const linked=this.adapter.outfitsForProfile(p.id);
      const named=linked.filter(o=>[o.nameCN,o.nameEN].some(name=>name&&text.includes(name)));
      return {profile_ref:p.id,outfits:[...new Map([...named,...linked.slice(-3)].map(o=>[o.id,o])).values()].slice(0,3).map(o=>({id:o.id,nameCN:o.nameCN,nameEN:o.nameEN,description:o.description.slice(0,120),outfit_class:o.directorOutfitClass,outfit_specificity:o.directorOutfitSpecificity}))};
    }).filter(p=>p.outfits.length);
    const styleSettings=this.adapter.settings(),style=styleSettings.yushe?.[styleSettings.yusheid_comfyui];
    const characterCard=this.card(text);
    if(!isManual){characterCard.description=String(characterCard.description||'').slice(0,900);characterCard.scenario=String(characterCard.scenario||'').slice(0,400);}
    characterCard.lore=(characterCard.lore||[]).slice(0,isManual?4:2).map(entry=>({...entry,content:String(entry.content||'').slice(0,isManual?120:100)}));
    const activeLore=this.activeLore.slice(0,isManual?8:3).map(entry=>({...entry,content:String(entry.content||'').slice(0,isManual?120:100)}));
    const input={mode:fallback?'automatic_final_fallback':isManual?'manual':'automatic',CURRENT_TEXT:narrative(selected).replace(/\s+/g,' ').trim(),PREVIOUS_CONTEXT:history,character_card:characterCard,original_profiles:profiles,original_outfits:originalOutfits,
      renderer_style:{prefix:style?.fixedPrompt||'',suffix:style?.fixedPrompt_end||'',rule:'Describe scene content only. Do not override these styles or add style exclusions.'},
      active_lore:activeLore,visual_registry:registry,already_chosen:chosen.map(s=>({event_key:s.event_key,moment:s.moment,evidence:s.anchor?.quote||'',action:s.shot?.action||'',essential_visible:s.shot?.essential_visible||[]})),remaining:(isManual?2:1)-chosen.length};
    const dispatchEarly=async partial=>{
      if(isManual||fallback||!onEarlyScene)return;
      try{
        const names=(entry)=>[entry.name,...(entry.aliases||[])].filter(Boolean);
        const known=input.visual_registry.filter(entry=>names(entry).some(name=>partial.evidence.includes(name))).map(entry=>({
          name:entry.name,aliases:entry.aliases||[],gender:entry.gender||'unknown',is_subject:true,outfit:'',outfit_evidence:'',outfit_class:'',outfit_specificity:'unknown',fixed_facts:[],character_id:entry.id,profile_ref:entry.profile
        }));
        const scene={metadataPending:true,evidence:partial.evidence,moment:partial.evidence,event_key:fingerprint(partial.evidence),phase:'happening',score:partial.score,uncertain:partial.uncertain,
          subject:partial.subject,cast:known,shot:{action:partial.positive,essential_visible:[],framing:'front-facing shot showing the face and defining action',spatial_relations:'',face_visibility:'both_eyes',face_visibility_evidence:''},
          positive:partial.positive,negative:partial.negative||'text, watermark',audit:{grounded:true,one_moment:true,no_invented_dialogue:true}};
        let liveRaw='',anchor=null;
        const deadline=Date.now()+1800;
        while(!anchor&&!signal?.aborted&&Date.now()<=deadline){
          const target=this.resolveMessage(binding);if(!target)return;
          liveRaw=target.message.mes;
          try{anchor=locateQuote(liveRaw,partial.evidence,0,liveRaw.length);}catch{}
          if(anchor||this.round?.final)break;
          await new Promise(resolve=>setTimeout(resolve,80));
        }
        if(!anchor)return;
        const validated=validateScene(scene,liveRaw,{start:0,end:liveRaw.length},false);
        if(!validated)return;
        if(validated.subject!=='environment'&&!validated.cast.length)validated.cast=[{is_subject:true}];
        return (await onEarlyScene(validated))===true;
      }catch(error){this.status(String(error.message||error));}
    };
    const result=await this.api.analyze(input,signal,isManual||fallback?undefined:dispatchEarly);
    const liveTarget=this.resolveMessage(binding);
    const activeRaw=isManual?raw:liveTarget?.message.mes;
    const activeStart=isManual?start:0,activeEnd=isManual?end:activeRaw?.length||0;
    if(!isManual&&liveTarget)binding=this.bind(index,activeRaw,end);
    if(epoch!==this.epoch||!this.resolve(binding))throw new Error('分析期间原文已改变');
    const scenes=result.scenes.slice(0,fallback?1:isManual?3:2).map(scene=>{
      try{return validateScene(scene,activeRaw,{start:activeStart,end:activeEnd},manual);}
      catch(error){if(isManual)throw error;return null;}
    }).filter(Boolean);
    const m=liveTarget?.message||this.ctx().chat[index];
    for(const state of result.state_updates.slice(0,12)){
      try{
        const a=locateQuote(activeRaw,state.evidence,activeStart,activeEnd),entry={swipe:binding.swipe,end:a.end,prefix:fingerprint(activeRaw.slice(0,a.end)),value:state};
        if(!this.meta(m).states.some(s=>s.prefix===entry.prefix))this.meta(m).states.push(entry);
      }catch{/* Do not save ungrounded state. */}
    }
    this.meta(m).states=this.meta(m).states.slice(-30);
    for(const scene of scenes){
      scene.analysisMs=result.analysisMs;this.prepareCharacters(scene,input);
      const issued=this.meta(m).prompts.find(record=>record.origin==='automatic'&&record.scene?.metadataPending&&record.anchor.fingerprint===scene.anchor.fingerprint);
      if(issued){
        this.syncSceneOutfits(scene);
        issued.scene={...clone(scene),positive:issued.prompt};
      }
    }
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
        character=registry[id]={id,name:cast.name,aliases:cast.aliases||[],gender:cast.gender||'unknown',profile,lock:null,created:Date.now()};
      }
      if(!this.adapter.profile(character.profile)){
        const matches=this.adapter.profiles().filter(p=>(p.enabled||p.directorScope===this.chatKey())&&[p.nameCN,p.nameEN].some(v=>String(v||'').split('|').some(n=>n&&names.includes(n))));
        character.profile=matches.length===1?matches[0].id:this.adapter.upsertProfile(character.id||cast.character_id||uuid(),character.name||cast.name,'',undefined,this.chatKey());
        character.sync={updated:false,reason:'missing-profile-repaired'};
      }
      if(cast.gender&&cast.gender!=='unknown')character.gender=cast.gender;
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
      const clothingSources=[input.CURRENT_TEXT||'',input.PREVIOUS_CONTEXT?.recent||'',JSON.stringify(input.PREVIOUS_CONTEXT?.states||[]),JSON.stringify(input.character_card||{})];
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
    const anima=snapshot.backend==='comfyui'&&/miaomiao|anima/i.test(snapshot.model||'');
    const faceEvidence=String(scene.shot?.face_visibility_evidence||'');
    const explicitFaceException=scene.shot?.face_visibility!=='both_eyes'&&faceEvidence.length>=4&&String(scene.anchor?.quote||'').includes(faceEvidence);
    const faceLock=anima&&scene.subject!=='environment'&&scene.cast?.some(c=>c.is_subject!==false)&&!explicitFaceException;
    let content=scene.basePositive||scene.positive;
    const cameraShot=faceLock&&/\b(?:camera|photograph)\b/i.test(content);
    if(faceLock)content=content.replace(/\b(?:three-quarter view|front view|profile view|profile|side view|rear view|back view|from behind|both eyes visible|one eye hidden|hidden face|obstructed face)\b/gi,' ')
      .replace(/\band an unobstructed face\b/gi,' ')
      .replace(/\s+/g,' ').replace(/\s+([,.;])/g,'$1').replace(/^[\s,.;]+|[\s,.;]+$/g,'');
    if(faceLock)negative.push('profile','side view','from behind','back view','hidden face','one eye hidden');
    if(cameraShot){
      content=content.replace(/\b(?:raised|lifted)\s+((?:silver|digital|film|compact)\s+)?camera\b/gi,'$1camera held at chest height')
        .replace(/\b(?:raises?|lifts?)\s+(?:her\s+)?((?:silver|digital|film|compact)\s+)?camera\b/gi,'holds $1camera at chest height');
      negative.push('camera covering face','camera blocking eyes','camera covering nose or mouth','camera above chin','camera at eye level','viewfinder shot','monitor','screen','inset photograph');
    }
    return {positive:join([snapshot.prefix,tag?`${character?.gender==='male'?'1boy':'1girl'}, ${tag}`:'',faceLock?'front view, both eyes visible, unobstructed face':'',cameraShot?'camera at chest height below the chin; her entire face, including nose and mouth, remains unobstructed':'',content,snapshot.suffix]),negative:[...new Map(negative.map(tag=>[tag.toLowerCase(),tag])).values()].join(', '),prototypeTag:tag,faceLock};
  }
  async issuePrompt(binding,scene,origin,positive){
    const target=this.resolve(binding);
    if(origin==='automatic'&&target?.anchor)scene.anchor=target.anchor;
    if(!target||!validAnchor(target.message.mes,scene.anchor))throw new Error('原文已经改变，请重新选择剧情');
    const prompt=assertEnglish(positive);
    const {startTag,endTag}=this.adapter.imageTags();
    if(prompt.includes(startTag)||prompt.includes(endTag))throw new Error('提示词包含智绘姬标记，请修改后重试');
    const meta=this.meta(target.message);
    const duplicate=meta.prompts.find(p=>p.anchor.fingerprint===scene.anchor.fingerprint&&p.prompt===prompt&&p.state!=='failed');
    if(duplicate)return duplicate;
    this.syncSceneOutfits(scene);
    const record={id:uuid(),binding:clone(binding),anchor:clone(scene.anchor),scene:clone(scene),prompt,origin,state:'issued',created:Date.now()};
    meta.prompts.push(record);
    await this.ctx().saveChat();
    this.onPromptIssued?.(record);
    this.status(`已向智绘姬交付提示词 ${meta.prompts.length} 条`);
    return record;
  }
  syncSceneOutfits(scene){
    for(const cast of scene.cast||[]){
      if(cast.character_id&&cast.profile_ref&&cast.outfit_grounded&&this.adapter.profile(cast.profile_ref)){
        cast.outfit_ref=this.adapter.upsertOutfit(cast.character_id,cast.profile_ref,cast.name,cast.outfit,this.chatKey(),cast.outfit_class,cast.outfit_specificity);
      }
    }
  }
  onChatuResult(result){
    if(!result?.id)return;
    let changed=false;
    for(const message of this.ctx().chat){
      for(const record of message.extra?.[NS]?.prompts||[]){
        if(!this.resolve(record.binding)||this.adapter.requestId(record.prompt)!==result.id||record.state==='done')continue;
        record.state=result.success?'done':'failed';record.completed=Date.now();record.detail=result.success?'':String(result.error||'生图失败').slice(0,160);changed=true;
      }
    }
    if(changed){this.status(result.success?'智绘姬已完成生图':`智绘姬生图失败：${String(result.error||'未知错误').slice(0,120)}`);void this.ctx().saveChat();}
  }
  enqueue(binding,scene,origin,snapshot){
    if(!this.resolve(binding))throw new Error('原文已改变，任务未提交');
    assertEnglish(scene.positive);assertEnglish(scene.negative);
    if(origin==='automatic'&&snapshot.warning&&this.config().approvedModel!==snapshot.model)throw new Error('保存的模型已失效，请先在手动预览中确认当前可用模型');
    if(origin==='manual'){this.config().approvedModel=snapshot.model;this.save();}
    for(const cast of scene.cast||[]){
      if(cast.character_id&&cast.profile_ref&&cast.outfit_grounded&&this.adapter.profile(cast.profile_ref)){
        cast.outfit_ref=this.adapter.upsertOutfit(cast.character_id,cast.profile_ref,cast.name,cast.outfit,this.chatKey(),cast.outfit_class,cast.outfit_specificity);
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
      const anchor=target?.anchor||task.scene.anchor;
      if(!target||!validAnchor(target.message.mes,anchor)){task.set('expired');return;}
      const scene=clone(task.scene);scene.anchor=anchor;
      const record={id:task.id,binding:task.binding,scene,imageId:result.imageId,backend:task.backend,model:task.snapshot.model,params:result.params,times:task.times};
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
    if(this.round){
      if(this.round.final&&this.round.busy&&this.round.messageId)this.finishingRounds.add(this.round);
      else{this.round.abort.abort();clearTimeout(this.round.timer);}
    }
    this.round={budget:new AutoBudget(),pending:[],messageId:null,cursor:type==='continue'?(this.ctx().chat.at(-1)?.mes.length||0):0,final:false,finalProcessed:false,busy:false,failed:false,fallbackTried:false,lastCall:0,abort:new AbortController()};
  }
  isRoundLive(round){return round===this.round||this.finishingRounds.has(round);}
  onToken(text){
    const r=this.round;if(!this.config().enabled||!r||typeof text!=='string')return;
    r.sawStreamToken=true;
    if(narrative(text).trim())r.sawVisibleText=true;
    if(!r.timer)r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},40);
  }
  async pump(r=this.round){
    if(!r||!this.isRoundLive(r)||r.busy||r.failed||r.abort.signal.aborted||!this.config().enabled||r.budget.accepted.length>=2)return;
    const index=r.messageId?this.ctx().chat.findIndex(m=>m.extra?.[NS]?.id===r.messageId):this.ctx().chat.length-1,m=this.ctx().chat[index];if(!m||m.is_user||m.is_system)return;
    r.messageId=this.meta(m).id;
    const raw=m.mes||'',visible=narrative(raw),end=r.final?visible.length:visible.trimEnd().length;
    if(r.final&&r.budget.accepted.length){r.cursor=end;r.pending.length=0;r.finalProcessed=true;this.finishingRounds.delete(r);return;}
    // A near-empty unfinished opening can occupy the only live director request
    // while the drawable scene streams past. A complete short sentence is useful
    // evidence, and the final pass still handles shorter replies.
    const minimum=r.cursor?240:100;
    const freshVisibleChars=visible.slice(r.cursor,end).replace(/\s/g,'').length;
    const firstCompleteSentence=!r.cursor&&freshVisibleChars>=16&&completeEnd(visible.slice(0,end))>0;
    if((end<=r.cursor&&!r.final)||(end<=r.cursor&&!r.pending.length&&!(r.final&&!r.finalProcessed))||freshVisibleChars<minimum&&!firstCompleteSentence&&!r.final)return;
    if(!r.final&&Date.now()-r.lastCall<1800){r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},400);return;}
    r.busy=true;r.lastCall=Date.now();this.status('导演正在旁路分析');
    try{
      const onEarlyScene=async scene=>{
        if(r!==this.round||r.final||r.abort.signal.aborted||!this.config().enabled||!r.budget.canAccept(scene,false))return;
        const prompts=this.effective(scene,this.adapter.promptStyle());
        scene.basePositive||=scene.positive;scene.baseNegative||=scene.negative;scene.prototypeTag=prompts.prototypeTag;
        scene.positive=assertEnglish(prompts.positive);scene.negative=assertEnglish(prompts.negative);
        const liveRaw=this.ctx().chat[index]?.mes||raw;
        await this.issuePrompt(this.bind(index,liveRaw,scene.anchor.end,scene.anchor.quote),scene,'automatic',scene.positive);
        r.budget.accept(scene,false);
        return true;
      };
      const result=end>r.cursor?await this.analyze(index,raw,0,end,false,r.abort.signal,r.budget.accepted,onEarlyScene):{scenes:[]};
      if(!this.isRoundLive(r)||r.abort.signal.aborted||!this.config().enabled)return;
      r.cursor=end;
      const currentRaw=this.ctx().chat[index]?.mes||raw;
      if(r.final&&r.budget.accepted.length){
        r.cursor=narrative(currentRaw).length;r.pending.length=0;r.finalProcessed=true;
        this.finishingRounds.delete(r);return;
      }
      for(const scene of result.scenes){
        if(!r.pending.some(x=>x.scene.event_key===scene.event_key))r.pending.push({scene,binding:this.bind(index,currentRaw,scene.anchor.end,scene.anchor.quote)});
      }
      r.pending=r.pending.filter(x=>{const target=this.resolve(x.binding);return !!target&&validAnchor(target.message.mes,target.anchor||x.scene.anchor);}).sort((a,b)=>b.scene.score-a.scene.score).slice(0,6);
      for(const candidate of [...r.pending]){
        const {scene,binding}=candidate;
        if(r.budget.canAccept(scene,r.final)){
          const prompts=this.effective(scene,this.adapter.promptStyle());
          scene.basePositive ||=scene.positive;scene.baseNegative ||=scene.negative;scene.prototypeTag=prompts.prototypeTag;
          scene.positive=assertEnglish(prompts.positive);scene.negative=assertEnglish(prompts.negative);
          if(!this.isRoundLive(r)||r.abort.signal.aborted)return;
          await this.issuePrompt(binding,scene,'automatic',scene.positive);
          r.budget.accept(scene,r.final);r.pending=r.pending.filter(x=>x!==candidate);
        }
      }
      const latestRaw=this.ctx().chat[index]?.mes||'';
      const latestVisibleEnd=narrative(latestRaw).trimEnd().length;
      if(r.final&&r.cursor>=latestVisibleEnd&&!r.budget.accepted.length&&!r.fallbackTried&&latestRaw.trim()){
        r.fallbackTried=true;this.status('本轮尚无画面，正在补选一个有原文依据的镜头');
        const fallback=await this.analyze(index,latestRaw,0,latestVisibleEnd,'fallback',r.abort.signal);
        const scene=fallback.scenes[0];
        if(scene&&r===this.round&&!r.abort.signal.aborted&&this.config().enabled){
          const prompts=this.effective(scene,this.adapter.promptStyle());
          scene.basePositive ||=scene.positive;scene.baseNegative ||=scene.negative;scene.prototypeTag=prompts.prototypeTag;
          scene.positive=assertEnglish(prompts.positive);scene.negative=assertEnglish(prompts.negative);
          const liveRaw=this.ctx().chat[index]?.mes||raw;
          await this.issuePrompt(this.bind(index,liveRaw,scene.anchor.end,scene.anchor.quote),scene,'automatic',scene.positive);
          r.budget.accept(scene,true);
        }
      }
      r.finalProcessed=!!r.final&&r.cursor>=latestVisibleEnd;
      if(r.finalProcessed)this.finishingRounds.delete(r);
      this.status(`本轮自动镜头 ${r.budget.accepted.length}/2`);
    }catch(e){if(!r.abort.signal.aborted){r.failed=true;this.status(e.message);}}
    finally{
      r.busy=false;
      if(r.failed||r.abort.signal.aborted)this.finishingRounds.delete(r);
      const latestVisibleEnd=narrative(this.ctx().chat[index]?.mes||'').trimEnd().length;
      if(this.isRoundLive(r)&&!r.failed&&!r.abort.signal.aborted&&(r.cursor<latestVisibleEnd||r.final&&!r.finalProcessed))r.timer=setTimeout(()=>{r.timer=null;void this.pump(r);},400);
    }
  }
  retryAnalysis(){if(!this.round)throw new Error('本轮分析已结束，请手动选择需要的片段');this.round.failed=false;void this.pump(this.round);}
  endRound(){const r=this.round;if(r){
    r.final=true;
    if(r.sawStreamToken&&!r.sawVisibleText){
      clearTimeout(r.timer);r.timer=null;r.failed=true;r.finalProcessed=true;
      this.status('正文模型没有输出可见剧情，请先重新生成正文；不会把思考内容当成剧情出图');return;
    }
    setTimeout(()=>void this.pump(r),300);
  }}
  invalidate(){
    this.epoch++;this.activeLore=[];if(this.round){this.round.abort.abort();clearTimeout(this.round.timer);this.round=null;}for(const round of this.finishingRounds){round.abort.abort();clearTimeout(round.timer);}this.finishingRounds.clear();
    for(const task of this.tasks.values())if(!task.terminal&&!this.resolve(task.binding)){task.set('expired');task.abort.abort();}
    this.onchange();
  }
}
