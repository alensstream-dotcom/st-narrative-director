import {NS,assertEnglish,validAnchor,narrative} from './core.mjs';
import {el,command,dialog,selectionSnapshot,insertAtAnchor} from './dom.mjs';
import {MIAOMIAO} from './workflows.mjs';
import {openSettings} from './settings.mjs';
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
      let scene=result.scenes[0];if(!scene)throw new Error('没有识别到可绘制的完整瞬间');
      const backend=this.backendSelect(this.c.config().manualBackend);
      if(backend.value==='comfyui'||(backend.value==='follow'&&this.c.adapter.capabilities().current==='comfyui'))await this.c.adapter.inspectComfy();
      const workflow=el('select',{},el('option',{value:MIAOMIAO.id,text:MIAOMIAO.name}),el('option',{value:'chatu',text:'智绘姬当前工作流'}));workflow.value=this.c.config().comfyWorkflow||MIAOMIAO.id;
      let snapshot=this.c.adapter.snapshot(backend.value,workflow.value),prompts=this.c.effective(scene,snapshot);
      if(previous&&(scene.prototypeTag||'')===prompts.prototypeTag)prompts={...prompts,positive:scene.positive,negative:scene.negative};
      info.textContent=scene.moment+(scene.uncertain?'（存在歧义，请先核对）':'');
      const positive=el('textarea',{value:prompts.positive,rows:7,'aria-label':'英文正面提示词'}),negative=el('textarea',{value:prompts.negative,rows:3,'aria-label':'英文负面提示词'});
      const describe=()=>`${snapshot.model} · ${snapshot.workflow||''}${snapshot.parameters?` · ${snapshot.parameters.steps} steps / CFG ${snapshot.parameters.cfg} / ${snapshot.parameters.sampler} / ${snapshot.parameters.scheduler} / ${snapshot.parameters.width}×${snapshot.parameters.height}`:''}${snapshot.warning?' · '+snapshot.warning:''}`;
      const model=el('small',{text:describe()});
      let confirm;
      workflow.disabled=snapshot.backend!=='comfyui';
      let sceneIndex=0,currentKey=`0:${backend.value}:${workflow.value}`,refreshToken=0;
      const drafts=new Map([[currentKey,{positive:positive.value,negative:negative.value}]]);
      const remember=()=>drafts.set(currentKey,{positive:positive.value,negative:negative.value});
      const refresh=async()=>{const token=++refreshToken;confirm.disabled=true;try{
        if(backend.value==='comfyui'||(backend.value==='follow'&&this.c.adapter.capabilities().current==='comfyui'))await this.c.adapter.inspectComfy();
        if(abort.signal.aborted||token!==refreshToken)return;
        snapshot=this.c.adapter.snapshot(backend.value,workflow.value);prompts=this.c.effective(scene,snapshot);
        currentKey=`${sceneIndex}:${backend.value}:${workflow.value}`;
        const draft=drafts.get(currentKey);
        positive.value=draft?.positive??prompts.positive;negative.value=draft?.negative??prompts.negative;
        model.textContent=describe();workflow.disabled=snapshot.backend!=='comfyui';castLine.textContent=scene.cast.map(x=>`${x.name} · ${x.outfit||'服装未明确'} · 智绘姬 ${x.profile_ref||'待关联'}`).join('；');confirm.disabled=false;
      }catch(e){if(token!==refreshToken)return;snapshot=null;confirm.disabled=true;model.textContent=e.message;this.error(e);}};
      backend.onchange=()=>{remember();void refresh();};workflow.onchange=()=>{remember();void refresh();};
      confirm=command('image','确认生成',()=>{try{if(!snapshot)throw new Error('请先选择可用生图后端');this.c.enqueue(result.binding,{...scene,basePositive:scene.basePositive||scene.positive,baseNegative:scene.baseNegative||(previous?'':scene.negative),positive:assertEnglish(positive.value),negative:assertEnglish(negative.value),prototypeTag:prompts.prototypeTag},'manual',snapshot);d.close();}catch(e){this.error(e);}},'确认生成');
      const quote=el('blockquote',{text:narrative(scene.anchor.quote).trim()});
      const castLine=el('p',{class:'nd-status',text:scene.cast.map(x=>`${x.name} · ${x.outfit||'服装未明确'} · 智绘姬 ${x.profile_ref||'待关联'}`).join('；')});
      if(result.scenes.length>1){const moments=el('select',{},...result.scenes.map((candidate,i)=>el('option',{value:String(i),text:candidate.moment})));moments.onchange=()=>{remember();sceneIndex=Number(moments.value);scene=result.scenes[sceneIndex];quote.textContent=narrative(scene.anchor.quote).trim();info.textContent=scene.moment;void refresh();};body.append(el('label',{},'选择要画的瞬间',moments));}
      body.append(quote,el('label',{},'生图后端',backend),el('label',{},'本张工作流',workflow),model,
        castLine,
        el('label',{},'英文提示词',positive),el('label',{},'负面提示词',negative),
        el('div',{class:'nd-actions'},command('rotate-right','重新分析',()=>{d.close();void this.preview(selection);}),
          confirm));
    }catch(e){if(!abort.signal.aborted){info.textContent=e.message;body.append(command('rotate-right','重试分析',()=>{d.close();void this.preview(selection);},'重试分析'));}}
  }
  lockDialog(record){
    const {dialog:d,body}=dialog('人物形象');
    for(const cast of record.scene.cast){
      const c=this.c.scope().characters[cast.character_id];if(!c)continue;
      const state=el('span',{text:c.lock?'固定外貌已锁定':'暂用形象，未锁定'});
      const b=command(c.lock?'lock-open':'lock',c.lock?'解除锁定':'锁定固定外貌',()=>{
        try{const lock=this.c.toggleLock(record,cast);state.textContent=lock?'固定外貌已锁定':'暂用形象，未锁定';b.title=lock?'解除锁定':'锁定固定外貌';}catch(e){this.error(e);}
      });
      body.append(el('div',{class:'nd-character'},el('strong',{text:c.name}),state,b));
    }
    body.append(el('p',{class:'nd-notice',text:'当前锁定固定外貌描述与所选人物 Tag，不锁服装与动作。此版本尚未验证人脸参考注入，不承诺换装后的脸部完全一致；多人图不会整张用作单人参考。'}),
      command('palette','调整视觉原型',()=>{d.close();this.settings('characters');},'调整原型'),
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
  settings(tab){return openSettings(this,tab);}
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
