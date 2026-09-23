import { clone, freeze, fingerprint, NS } from './core.mjs';
import {pairedWorkflow} from './workflows.mjs';

export function materialize(workflow, variables) {
  function visit(value) {
    if(Array.isArray(value))return value.map(visit);
    if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));
    if(typeof value!=='string')return value;
    const exact=value.match(/^%([a-zA-Z_]+)%$/);
    if(exact){if(!(exact[1] in variables))throw new Error(`工作流参数未支持：${exact[1]}`);return variables[exact[1]];}
    return value.replace(/%([a-zA-Z_]+)%/g,(_,key)=>{if(!(key in variables))throw new Error(`工作流参数未支持：${key}`);return String(variables[key]);});
  }
  const result=visit(clone(workflow));
  if(Object.values(result).some(n=>n._skip))throw new Error('当前工作流含跳过节点，请先在智绘姬另存为可直接执行的工作流');
  return result;
}
export class ChatuAdapter {
  #snapshots=new WeakMap();
  #tail=Promise.resolve();
  #info=new Map();
  constructor(context){this.context=context;}
  settings(){const s=this.context().extensionSettings['st-chatu8'];if(!s)throw new Error('请先安装并配置原版智绘姬');return s;}
  async inspectComfy(){
    const url=this.settings().comfyuiUrl?.replace(/\/$/,'');if(!url)return;
    if(this.#info.has(url))return this.#info.get(url);
    try{
      const r=await fetch(url+'/object_info',{signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error('Unavailable');
      const nodes=await r.json();this.#info.set(url,nodes);return nodes;
    }catch{
      try{
        const list=await this.post('/api/sd/comfy/models',{url});
        const models=list.filter(x=>String(x.text).startsWith('UNet:')).map(x=>x.value);
        const info={_viaProxy:true,UNETLoader:{input:{required:{unet_name:[models]}}}};
        this.#info.set(url,info);return info;
      }catch{return null;}
    }
  }
  profiles(){
    const s=this.settings(),enabled=new Set([
      ...(s.characterEnablePresets?.[s.characterEnablePresetId]?.characters||[]),
      ...(s.characterCommonPresets?.[s.characterCommonPresetId]?.characters||[])
    ].map(x=>typeof x==='string'?x:x.characterPresetName));
    return Object.entries(s.characterPresets||{}).map(([id,p])=>({id,nameCN:p.nameCN,nameEN:p.nameEN,characterTraits:p.characterTraits,facialFeatures:p.facialFeatures,
      directorOwner:p.directorOwner,directorScope:p.directorScope,enabled:enabled.has(id)}));
  }
  capabilities(){
    const s=this.settings();
    return {current:s.mode==='comfyui'?'comfyui':s.mode==='banana'?'banana':null,comfyui:!!((s.worker||pairedWorkflow(this.context().extensionSettings[NS]))&&s.comfyuiUrl),
      banana:!!(s.banana?.apiUrl&&s.banana?.model&&!String(s.banana.model).startsWith('imagen')&&String(s.banana.useGrokFormat)!=='true'),
      reference:{comfyui:false,banana:false},cache:'SillyTavern 服务器',
      conflicts:Object.entries(s).filter(([k,v])=>/auto.*click|pre.*generat|stream.*generat/i.test(k)&&(v===true||v==='true')).map(([k])=>k)};
  }
  snapshot(backend='follow',workflowId){
    const s=this.settings();backend=backend==='follow'?this.capabilities().current:backend;
    if(!this.capabilities()[backend])throw new Error('此后端未配置或接口尚未适配');
    const paired=backend==='comfyui'?pairedWorkflow(workflowId?{comfyWorkflow:workflowId}:this.context().extensionSettings[NS]):null;
    const p=backend==='comfyui'?(s.yushe?.[s.yusheid_comfyui]||(paired?{}:null)):s.banana.conversationPresets?.[s.banana.conversationPresetId];
    if(!p)throw new Error('智绘姬固定提示词预设不存在');
    const data=backend==='comfyui'?{
      url:s.comfyuiUrl,workflow:paired?clone(paired.workflow):JSON.parse(s.worker),variables:{
        steps:Number(s.comfyui_steps),cfg_scale:Number(s.cfg_comfyui),sampler_name:s.comfyuisamplerName,width:Number(s.comfyui_width),height:Number(s.comfyui_height),
        MODEL_NAME:s.MODEL_NAME,scheduler:s.comfyui_scheduler,vae:s.comfyui_vae,clip:s.comfyuiCLIPName,
        c_quanzhong:Number(s.c_quanzhong)||0,c_idquanzhong:Number(s.c_idquanzhong)||0,c_xijie:Number(s.c_xijie)||0,c_fenwei:Number(s.c_fenwei)||0,
        comfyuicankaotupian:'',ipa:s.ipa||'',inpaint_image:'',inpaint_mask:'',inpaint_positive:'',inpaint_negative:'',inpaint_denoise:0.75
      },seed:paired?-1:(Number(s.comfyui_seed)||-1)
    }:{url:s.banana.apiUrl,key:s.banana.apiKey,model:s.banana.model,size:s.banana.imageSize||'1024x1024'};
    let warning='';
    if(backend==='comfyui'){
      if(paired)data.variables.MODEL_NAME=paired.model;
      const info=this.#info.get(data.url.replace(/\/$/,''));data.direct=!!info&&!info._viaProxy;
      const models=info?.UNETLoader?.input?.required?.unet_name?.[0];
      if(Array.isArray(models)&&!models.includes(data.variables.MODEL_NAME)){
        throw new Error(`工作流所需模型 ${data.variables.MODEL_NAME} 不可用；不会自动换模型。请检查模型安装和工作流选择。`);
      }
    }
    const handle=freeze({backend,model:backend==='comfyui'?data.variables.MODEL_NAME:s.banana.model,workflow:backend==='comfyui'?(paired?.name||s.workerid):s.banana.conversationPresetId,parameters:paired?.parameters||null,warning,
      prefix:p.fixedPrompt||'',suffix:p.fixedPrompt_end||p.postfixPrompt||'',negative:p.negativePrompt||'',referenceSupported:false,
      digest:fingerprint(JSON.stringify(backend==='comfyui'?data:{model:data.model,url:data.url}))});
    this.#snapshots.set(handle,freeze(clone(data)));return handle;
  }
  async post(path,body,signal){
    const r=await fetch(path,{method:'POST',headers:this.context().getRequestHeaders(),body:JSON.stringify(body),signal});
    if(!r.ok)throw new Error(`生图服务 HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
    const value=await r.json();if(value.error)throw new Error('生图后端拒绝请求，请检查工作流或模型');return value;
  }
  async generate(handle,request,onStatus=()=>{},signal){
    const data=this.#snapshots.get(handle);if(!data)throw new Error('任务快照已失效');
    const execute=async()=>{
      if(signal?.aborted)throw new DOMException('已取消','AbortError');
      let image,seed;
      if(handle.backend==='comfyui'){
        seed=data.seed>0?data.seed:Math.floor(Math.random()*2**48);
        const workflow=materialize(data.workflow,{...data.variables,seed,prompt:request.positive,negative_prompt:request.negative});
        if(data.direct){
          image=await this.directComfy(data.url,workflow,request.id,onStatus,signal);
        }else{
          onStatus({state:'submitted'});
          // ST's proxy interrupts globally when its socket is closed. Do not abort this fetch.
          const result=await this.post('/api/sd/comfy/generate',{url:data.url,prompt:JSON.stringify({client_id:request.id,prompt:workflow})});
          if(!result.data)throw new Error('ComfyUI 没有返回图片');
          image=`data:image/${result.format||'png'};base64,${result.data}`;
        }
      }else{
        onStatus({state:'submitted'});
        const content=[{type:'text',text:request.positive+'\nAvoid: '+request.negative}];
        for(const ref of (request.references||[]).slice(0,2))content.push({type:'image_url',image_url:{url:ref}});
        const result=await this.post('/api/backends/chat-completions/generate',{
          chat_completion_source:'custom',custom_url:data.url,custom_include_headers:`Authorization: "Bearer ${String(data.key||'').replace(/[\r\n"\\]/g,'')}"`,
          model:data.model,messages:[{role:'user',content}],stream:false,size:data.size
        },signal);
        const message=result.choices?.[0]?.message;
        image=message?.images?.[0]?.image_url?.url;
        if(!image&&Array.isArray(message?.content))image=message.content.find(x=>x.type==='image_url')?.image_url?.url;
        if(!image&&typeof message?.content==='string')image=message.content.match(/data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+/)?.[0];
        if(!image)throw new Error('云端没有返回内嵌图片；此响应格式尚未适配');
      }
      if(signal?.aborted)throw new DOMException('已取消','AbortError');
      const match=image.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/s);if(!match)throw new Error('返回的图片格式无效');
      const saved=await this.post('/api/images/upload',{image:match[2],format:match[1],ch_name:'narrative-director',filename:request.id});
      if(typeof saved.path!=='string'||!saved.path.startsWith('/'))throw new Error('图片保存失败');
      return {imageId:saved.path,image:saved.path,params:{model:handle.model,workflow:handle.workflow,parameters:handle.parameters,seed,snapshot:handle.digest}};
    };
    if(handle.backend!=='comfyui')return execute();
    const result=this.#tail.then(execute,execute);this.#tail=result.catch(()=>{});return result;
  }
  async directComfy(base,workflow,id,onStatus,signal){
    const url=base.replace(/\/$/,'');
    const request=async(path,options={})=>{
      const r=await fetch(url+path,{...options,signal});
      if(!r.ok){const value=await r.json().catch(()=>({}));throw new Error(`ComfyUI ${r.status}: ${JSON.stringify(value.node_errors||value.error||{}).slice(0,280)}`);}
      return r;
    };
    const accepted=await(await request('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:id,prompt:workflow})})).json();
    const nativeId=accepted.prompt_id;if(!nativeId)throw new Error('ComfyUI 未接受任务');onStatus({state:'accepted',nativeId});
    const started=Date.now();
    while(Date.now()-started<600000){
      const history=await(await request('/history/'+encodeURIComponent(nativeId))).json();const item=history[nativeId];
      if(item){
        if(item.status?.status_str==='error')throw new Error('ComfyUI 节点执行失败：'+String(item.status.messages?.find(x=>x[0]==='execution_error')?.[1]?.exception_message||'未知错误').slice(0,220));
        const image=Object.values(item.outputs||{}).flatMap(x=>x.images||[])[0];if(!image)throw new Error('工作流未返回图片输出');
        const query=new URLSearchParams({filename:image.filename,subfolder:image.subfolder||'',type:image.type||'output'});
        const blob=await(await request('/view?'+query)).blob();
        return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      }
      const queue=await(await request('/queue')).json();
      onStatus({state:(queue.queue_running||[]).some(x=>x[1]===nativeId)?'running':'queued',nativeId});
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
    throw new Error('ComfyUI 任务超时');
  }
  getImage(id){return Promise.resolve(id);}
  upsertProfile(owner,name,traits,profileId,scope=''){
    const s=this.settings();s.characterPresets ||= {};const id=profileId||`nd_${owner}`;
    if(!s.characterPresets[id]){s.characterPresets[id]={nameCN:name,nameEN:'',characterTraits:traits,facialFeatures:'',outfits:[],photoMedia:[],audioMedia:[],directorOwner:owner,directorScope:scope};this.context().saveSettingsDebounced();}
    return id;
  }
  profile(id){return this.settings().characterPresets?.[id]||null;}
  outfitsForProfile(profileId){
    const s=this.settings(),profile=s.characterPresets?.[profileId];
    return (profile?.outfits||[]).map(id=>({id,preset:s.outfitPresets?.[id]})).filter(x=>x.preset).map(({id,preset})=>({
      id,nameCN:preset.nameCN||'',nameEN:preset.nameEN||'',description:preset.fullBody||preset.upperBody||'',directorOwner:preset.directorOwner||''
    }));
  }
  upsertOutfit(owner,profileId,characterName,description,scope=''){
    const profile=this.profile(profileId);
    if(!profile)throw new Error('人物档案不存在，无法关联服装');
    const value=String(description||'').trim().replace(/\s+/g,' ');
    if(value.length<3||value.length>180||/[^\x20-\x7e]/.test(value)||/^(unknown|unspecified|none|not specified|n\/a)$/i.test(value))return null;
    const normalized=value.toLowerCase();
    const tokens=text=>new Set(String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[]);
    const incoming=tokens(value);
    const same=text=>{
      const other=String(text||'').trim().replace(/\s+/g,' ').toLowerCase();
      if(other===normalized)return true;
      const known=tokens(other),union=new Set([...incoming,...known]);
      return incoming.size>=2&&known.size>=2&&[...incoming].filter(word=>known.has(word)).length/union.size>=0.9;
    };
    const existing=this.outfitsForProfile(profileId).find(x=>[x.nameEN,x.description].some(same));
    if(existing)return existing.id;
    const s=this.settings();s.outfitPresets ||= {};profile.outfits ||= [];
    const id=`nd_outfit_${owner}_${fingerprint(normalized)}`;
    if(s.outfitPresets[id]){
      if(s.outfitPresets[id].directorOwner!==owner)throw new Error('服装 ID 冲突，已停止写入');
    }else{
      s.outfitPresets[id]={nameCN:`${characterName} - 导演服装 ${profile.outfits.length+1}`,nameEN:'',owner:profile.nameEN||characterName,
        upperBody:value,upperBodyBack:'',fullBody:value,fullBodyBack:'',photoImageIds:[],selectedPhotoIndex:0,photoPrompt:'',sendPhoto:false,
        directorOwner:owner,directorScope:scope,directorGeneratedDescription:value};
    }
    if(!profile.outfits.includes(id))profile.outfits.push(id);
    this.context().saveSettingsDebounced();return id;
  }
  syncOwnedFacts(id,owner,facts){
    const p=this.profile(id);if(!p||p.directorOwner!==owner)return {updated:false,reason:'existing'};
    const previous=p.directorGeneratedTraits;
    if(previous!==undefined&&p.characterTraits!==previous)return {updated:false,reason:'user-edited'};
    if(previous===undefined&&p.characterTraits)return {updated:false,reason:'untracked'};
    p.directorFacts ||= {};
    for(const f of facts)if(!p.directorFacts[f.field])p.directorFacts[f.field]={...f};
    p.characterTraits=Object.values(p.directorFacts).map(f=>`${f.field.replaceAll('_',' ')}: ${f.value}`).join('; ');
    p.directorGeneratedTraits=p.characterTraits;this.context().saveSettingsDebounced();return {updated:true};
  }
  openProfiles(){if(typeof globalThis.showChatuSettingsPanel!=='function')throw new Error('智绘姬管理入口尚未加载，请先检查原版扩展');globalThis.showChatuSettingsPanel();}
}
