import {NS,assertEnglish,validAnchor,narrative} from './core.mjs';
import {el,command,dialog,selectionSnapshot,insertAtAnchor} from './dom.mjs';
import {MIAOMIAO} from './workflows.mjs';
const labels={queued:'排队中',submitted:'已提交，等待后端结果',accepted:'服务已接收',running:'生成中',done:'完成',failed:'失败',expired:'已过期',cancelled:'已取消'};

export class UI {
  constructor(controller){this.c=controller;this.toolbar=null;this.selection=null;this.mounts=new Set();this.timer=null;this.statusNode=null;this.taskList=null;}
  error(e){this.c.status(String(e?.message||e));globalThis.toastr?.warning(String(e?.message||e),'叙景');}
  backendSelect(value){
    const caps=this.c.adapter.capabilities(),s=el('select',{},el('option',{value:'follow',text:'跟随智绘姬'}));
    if(caps.comfyui)s.append(el('option',{value:'comfyui',text:'ComfyUI'}));
    if(caps.banana)s.append(el('option',{value:'banana',text:'云端 · Banana'}));
    s.value=value;return s;
  }
  async preview(selection,previous=null){
    const {dialog:d,body}=dialog('确认画面'),abort=new AbortController();d.addEventListener('close',()=>abort.abort(),{once:true});
    const info=el('p',{text:'分析选中剧情…',class:'nd-status'});body.append(info);
    try{
      const raw=this.c.ctx().chat[selection.index]?.mes;
      if(!raw||raw.slice(selection.start,selection.end)!==selection.text)throw new Error('选中的剧情已改变，请重新选择');
      const result=previous||await this.c.analyze(selection.index,raw,selection.start,selection.end,true,abort.signal);
      if(abort.signal.aborted)return;
      const scene=result.scenes[0];if(!scene)throw new Error('没有识别到可绘制的完整瞬间');
      const backend=this.backendSelect(this.c.config().manualBackend);
      await this.c.adapter.inspectComfy();
      let snapshot=this.c.adapter.snapshot(backend.value),prompts=previous?{positive:scene.positive,negative:scene.negative}:this.c.effective(scene,snapshot);
      info.textContent=scene.moment+(scene.uncertain?'（存在歧义，请先核对）':'');
      const positive=el('textarea',{value:prompts.positive,rows:7,'aria-label':'英文正面提示词'}),negative=el('textarea',{value:prompts.negative,rows:3,'aria-label':'英文负面提示词'});
      const describe=()=>`${snapshot.model} · ${snapshot.workflow||''}${snapshot.parameters?` · ${snapshot.parameters.steps} steps / CFG ${snapshot.parameters.cfg} / ${snapshot.parameters.sampler} / ${snapshot.parameters.scheduler} / ${snapshot.parameters.width}×${snapshot.parameters.height}`:''}${snapshot.warning?' · '+snapshot.warning:''}`;
      const model=el('small',{text:describe()});
      let confirm;
      backend.onchange=()=>{try{snapshot=this.c.adapter.snapshot(backend.value);prompts=this.c.effective(scene,snapshot);positive.value=prompts.positive;negative.value=prompts.negative;model.textContent=describe();confirm.disabled=false;}catch(e){snapshot=null;confirm.disabled=true;model.textContent=e.message;this.error(e);}};
      confirm=command('image','确认生成',()=>{try{if(!snapshot)throw new Error('请先选择可用生图后端');this.c.enqueue(result.binding,{...scene,basePositive:scene.basePositive||scene.positive,positive:assertEnglish(positive.value),negative:assertEnglish(negative.value)},'manual',snapshot);d.close();}catch(e){this.error(e);}},'确认生成');
      body.append(el('blockquote',{text:narrative(scene.anchor.quote).trim()}),el('label',{},'生图后端',backend),model,
        el('label',{},'英文提示词',positive),el('label',{},'负面提示词',negative),
        el('div',{class:'nd-actions'},command('rotate-right','重新分析',()=>{d.close();void this.preview(selection);}),
          confirm));
    }catch(e){if(!abort.signal.aborted)info.textContent=e.message;}
  }
  lockDialog(record){
    const {body}=dialog('人物形象');
    for(const cast of record.scene.cast){
      const c=this.c.scope().characters[cast.character_id];if(!c)continue;
      const state=el('span',{text:c.lock?'固定外貌已锁定':'暂用形象，未锁定'});
      const b=command(c.lock?'lock-open':'lock',c.lock?'解除锁定':'锁定固定外貌',()=>{
        const lock=this.c.toggleLock(record,cast);state.textContent=lock?'固定外貌已锁定':'暂用形象，未锁定';b.title=lock?'解除锁定':'锁定固定外貌';
      });
      body.append(el('div',{class:'nd-character'},el('strong',{text:c.name}),state,b));
    }
    body.append(el('p',{class:'nd-notice',text:'当前锁定固定外貌描述，不锁服装与动作。此版本尚未验证人脸参考注入，不承诺换装后的脸部完全一致；多人图不会整张用作单人参考。'}),
      command('user','智绘姬角色管理',()=>this.c.adapter.openProfiles(),'角色管理'));
  }
  imageViewer(record){const {body}=dialog('画面');body.append(el('img',{src:record.imageId,alt:record.scene.moment,class:'nd-full-image'}),el('p',{text:record.scene.moment}));}
  async renderImages(){
    const chat=this.c.ctx().chat;
    for(let index=0;index<chat.length;index++){
      const m=chat[index],root=document.querySelector(`.mes[mesid="${index}"] .mes_text`);if(!root)continue;
      for(const record of m.extra?.[NS]?.images||[]){
        if(!this.c.resolve(record.binding)||!validAnchor(m.mes,record.scene.anchor)){root.querySelector(`[data-nd-id="${record.id}"]`)?.remove();continue;}
        if(root.querySelector(`[data-nd-id="${record.id}"]`)||this.mounts.has(record.id))continue;
        this.mounts.add(record.id);
        try{
          const img=el('img',{src:record.imageId,alt:record.scene.moment,loading:'lazy',onclick:()=>this.imageViewer(record)});
          const section=el('figure',{class:'nd-image','data-nd-id':record.id},img,
            el('figcaption',{},el('span',{text:record.scene.moment}),command('sliders','提示词与重绘',()=>{
              const target=this.c.resolve(record.binding);if(target)void this.preview({index:target.index,text:record.scene.anchor.quote,start:record.scene.anchor.start,end:record.scene.anchor.end},{binding:record.binding,scenes:[record.scene]});
            }),command('user-lock','锁定形象',()=>this.lockDialog(record))));
          insertAtAnchor(root,record.scene.anchor.quote,section);
        }finally{this.mounts.delete(record.id);}
      }
    }
  }
  refresh(){
    if(this.statusNode?.isConnected)this.statusNode.textContent=this.c.notice;
    if(this.taskList?.isConnected){
      this.taskList.replaceChildren();
      for(const t of [...this.c.tasks.values()].slice(-30).reverse()){
        const row=el('div',{class:'nd-task'},el('span',{text:t.scene.moment}),el('small',{text:`${labels[t.state]}${t.detail?' · '+t.detail:''}`}));
        if(!t.terminal)row.append(command('ban','取消排队/展示',()=>this.c.cancel(t)));
        if(t.state==='failed'&&this.c.resolve(t.binding))row.append(command('rotate-right','重试',()=>this.c.enqueue(t.binding,t.scene,t.origin,t.snapshot)));
        this.taskList.append(row);
      }
    }
    clearTimeout(this.timer);this.timer=setTimeout(()=>void this.renderImages().catch(e=>this.error(e)),160);
  }
  settings(){
    const {body}=dialog('叙景'),c=this.c.config();
    body.append(el('label',{class:'nd-toggle'},el('input',{type:'checkbox',checked:c.enabled,onchange:e=>{c.enabled=e.target.checked;this.c.save();if(!c.enabled&&this.c.round)this.c.round.abort.abort();}}),'自动导演 · 每轮最多两张'));
    const source=el('select',{},...['deepseek','openai','custom'].map(x=>el('option',{value:x,text:x==='custom'?'OpenAI 兼容服务':x})));source.value=c.source;
    const model=el('input',{value:c.model,placeholder:'模型名',list:'nd-models'}),list=el('datalist',{id:'nd-models'}),url=el('input',{value:c.url,type:'url',placeholder:'https://…/v1'});
    const secrets=el('select',{},el('option',{value:'',text:'未选择密钥'}));
    const key=el('input',{type:'password',autocomplete:'off',placeholder:'仅本次页面有效，不保存'});
    const persist=()=>{c.source=source.value;c.model=model.value.trim();c.url=url.value.trim();c.secretId=secrets.value;this.c.save();};
    [source,model,url,secrets].forEach(n=>n.addEventListener('change',persist));key.onchange=()=>{this.c.api.temporaryKey=key.value;key.value='';};
    const refreshSecrets=async()=>{
      const state=await this.c.api.secrets(),name=c.source==='custom'?'api_key_custom':c.source==='deepseek'?'api_key_deepseek':'api_key_openai';
      secrets.replaceChildren(el('option',{value:'',text:'未选择密钥'}));
      if(Array.isArray(state[name]))for(const s of state[name])secrets.append(el('option',{value:s.id,text:s.label||s.id}));secrets.value=c.secretId;
    };
    source.addEventListener('change',()=>void refreshSecrets().catch(e=>this.error(e)));
    body.append(el('h4',{text:'独立导演 API'}),command('link','使用正文连接的独立副本',async()=>{
      try{
        const s=this.c.ctx().chatCompletionSettings;
        if(!['deepseek','openai','custom'].includes(s.chat_completion_source))throw new Error('此服务尚未适配，请单独配置');
        c.source=s.chat_completion_source;c.model=c.source==='custom'?s.custom_model:c.source==='deepseek'?s.deepseek_model:s.openai_model;c.url=s.custom_url||'';
        const state=await this.c.api.secrets(),name=c.source==='deepseek'?'api_key_deepseek':c.source==='custom'?'api_key_custom':'api_key_openai';
        c.secretId=(state[name]||[]).find(x=>x.active)?.id||'';source.value=c.source;model.value=c.model||'';url.value=c.url;this.c.save();await refreshSecrets();
      }catch(e){this.error(e);}
    },'读取当前连接'),el('label',{},'服务',source),el('label',{},'API 地址（兼容服务）',url),el('label',{},'已保存密钥',secrets),el('label',{},'临时密钥（兼容服务）',key),
      el('label',{},'模型',model),list,command('arrows-rotate','刷新可用模型',async()=>{try{persist();list.replaceChildren(...(await this.c.api.models()).map(id=>el('option',{value:id})));this.c.status('模型列表已更新');}catch(e){this.error(e);}},'刷新模型'));
    try{
      const auto=this.backendSelect(c.autoBackend),manual=this.backendSelect(c.manualBackend);
      auto.onchange=()=>{c.autoBackend=auto.value;this.c.save();};manual.onchange=()=>{c.manualBackend=manual.value;this.c.save();};
      body.append(el('h4',{text:'生图'}),el('label',{},'自动后端',auto),el('label',{},'手动后端',manual));
      const workflow=el('select',{},el('option',{value:MIAOMIAO.id,text:MIAOMIAO.name}),el('option',{value:'chatu',text:'读取智绘姬当前工作流'}));
      workflow.value=c.comfyWorkflow||MIAOMIAO.id;workflow.onchange=()=>{c.comfyWorkflow=workflow.value;this.c.save();};
      body.append(el('label',{},'ComfyUI 工作流',workflow));
      const caps=this.c.adapter.capabilities();
      this.c.notice=`智绘姬资料/工作流已读取 · 原版文件未修改`;
      if(caps.conflicts.length)body.append(el('p',{class:'nd-notice',text:`原版另有自动功能开启：${caps.conflicts.join(', ')}；可能额外出图，叙景未更改它们。`}));
    }catch(e){this.c.notice=e.message;}
    this.statusNode=el('p',{class:'nd-status',text:this.c.notice});body.append(this.statusNode,
      el('p',{class:'nd-notice',text:'启用后，新增剧情、必要前文和相关角色资料发送给所选导演 API。不向正文模型注入生图指令。'}));
    this.taskList=el('div',{class:'nd-tasks'});body.append(el('h4',{text:'任务'}),this.taskList);this.refresh();void refreshSecrets().catch(e=>this.error(e));
  }
  install(){
    const entry=el('div',{class:'nd-settings-entry'},command('clapperboard','叙景 · 剧情导演',()=>this.settings(),'叙景 · 剧情导演'));
    (document.querySelector('#extensions_settings2')||document.querySelector('#extensions_settings')||document.body).append(entry);
    document.addEventListener('selectionchange',()=>{
      const next=selectionSnapshot(this.c.ctx());if(!next)return;this.selection=next;
      if(!this.toolbar){this.toolbar=el('div',{class:'nd-selection'},command('image','生成图片',()=>{
        const selected=this.selection;this.toolbar?.remove();this.toolbar=null;if(selected)void this.preview(selected);
      },'生成图片'));document.body.append(this.toolbar);}
      const v=window.visualViewport;this.toolbar.style.left=`${Math.max(8,Math.min(next.rect.left,(v?.width||innerWidth)-150))}px`;
      this.toolbar.style.top=`${Math.max(8,Math.min(next.rect.bottom+10,(v?.height||innerHeight)-64))}px`;
    });
    document.addEventListener('pointerdown',e=>{if(this.toolbar&&!this.toolbar.contains(e.target)&&!e.target.closest('.mes_text')){this.toolbar.remove();this.toolbar=null;this.selection=null;}});
    const chat=document.querySelector('#chat');if(chat)new MutationObserver(()=>this.refresh()).observe(chat,{childList:true,subtree:true});this.refresh();
  }
}
