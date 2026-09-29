import {NS,assertEnglish,validAnchor,narrative,locateQuote} from './core.mjs';
import {el,command,dialog,selectionSnapshot,insertAtAnchor,canInsertAtAnchor} from './dom.mjs';
import {analyzeMainSelection,inspectNativeMarkers} from './worldbook-mode.mjs';

export class UI {
  constructor(controller){
    this.c=controller;this.pendingActivation=new Map();this.timer=null;this.toolbar=null;this.selection=null;
    this.c.onPromptIssued=(record,regenerate=false)=>this.pendingActivation.set(record.id,regenerate);
  }
  error(error){this.c.status(String(error?.message||error));globalThis.toastr?.warning(String(error?.message||error),'叙景');}
  clearSelection(){this.toolbar?.remove();this.toolbar=null;this.selection=null;}
  async previewChatu(selection,reference=''){
    const {dialog:d,body}=dialog('确认画面'),abort=new AbortController();
    d.addEventListener('close',()=>abort.abort(),{once:true});
    const info=el('p',{class:'nd-status',role:'status',text:'正在使用酒馆主 API 分析选段。关闭窗口会丢弃结果，已发出的请求仍会完成。'});body.append(info);
    try{
      const result=await analyzeMainSelection(this.c,selection,abort.signal,reference);
      if(abort.signal.aborted)return;
      if(!result.scenes.length)throw new Error('选段中未找到可绘制的普通、非露骨剧情画面');
      let scene=result.scenes[0];
      const quote=el('blockquote'),prompt=el('textarea',{rows:7,'aria-label':'英文生图提示词'});
      const size=el('select',{'aria-label':'画面比例'},
        el('option',{value:'576x960',text:'竖图 3:5'}),el('option',{value:'960x576',text:'横图 5:3'}),el('option',{value:'768x768',text:'方图 1:1'}));
      const fill=()=>{quote.textContent=narrative(scene.anchor.quote).trim();prompt.value=scene.positive;info.textContent=scene.moment;};
      if(result.scenes.length>1){
        const moments=el('select',{'aria-label':'选择画面'},...result.scenes.map((s,i)=>el('option',{value:String(i),text:s.moment})));
        moments.onchange=()=>{scene=result.scenes[Number(moments.value)];fill();};body.append(moments);
      }
      const submit=command('image','交给智绘姬生成',async()=>{
        submit.disabled=true;
        try{
          let positive=assertEnglish(prompt.value).replace(/,\s*\d{2,4}x\d{2,4}\s*;$/,';');
          if(!positive.endsWith(';'))throw new Error('提示词末尾需要保留分号');
          positive=positive.slice(0,-1)+', '+size.value+';';
          const target=this.c.resolve(result.binding),root=target&&document.querySelector(`.mes[mesid="${target.index}"] .mes_text`);
          if(!canInsertAtAnchor(root,scene.anchor.quote))throw new Error('页面无法唯一定位这句原文，请改选更完整的句子后再提交');
          root.scrollIntoView({block:'center'});
          await this.c.issuePrompt(result.binding,scene,positive);d.close();this.refresh();
        }catch(e){this.error(e);submit.disabled=false;}
      },'交给智绘姬生成');submit.classList.add('nd-primary');
      fill();body.append(quote,el('label',{},'英文提示词',prompt),el('label',{},'建议画面比例（智绘姬启用自主分辨率时生效）',size),
        el('div',{class:'nd-actions'},command('rotate-right','重新选择',()=>{d.close();this.pickExcerpt(selection.index,selection,reference);},'返回选段'),submit));
    }catch(error){if(!abort.signal.aborted){info.textContent=error.message;body.append(command('arrow-left','返回选段',()=>{d.close();this.pickExcerpt(selection.index,selection,reference);},'返回选段'));}}
  }
  pickExcerpt(index,selection=null,reference=''){
    const message=this.c.ctx().chat[index];if(!message||message.is_user||message.is_system)return;
    const raw=message.mes,epoch=this.c.epoch,clean=narrative(raw),{dialog:d,body}=dialog('选择要补图的剧情');
    const parts=[...clean.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)].filter(p=>p[0].trim().length>=4);
    const choices=el('select',{'aria-label':'剧情段落'},...parts.map((p,i)=>el('option',{value:String(i),text:`${i+1}. ${p[0].trim().replace(/\s+/g,' ').slice(0,80)}`})));
    const quote=el('textarea',{rows:7,'aria-label':'补图原文',value:selection?.text||parts[0]?.[0].trim()||''});
    choices.onchange=()=>{selection=null;quote.value=parts[Number(choices.value)]?.[0].trim()||'';};
    const memory=el('textarea',{rows:4,'aria-label':'当时的人物服装资料',placeholder:'可选：粘贴数据库总结中的相关外貌、当时衣着及来源楼层。只使用选段时已经成立的资料。',value:reference});
    const status=el('p',{class:'nd-status',role:'status'});
    const submit=command('image','分析选段并预览',()=>{
      try{
        if(epoch!==this.c.epoch||this.c.ctx().chat[index]!==message||message.mes!==raw)throw new Error('聊天或原文已改变，请重新打开选段');
        const part=parts[Number(choices.value)],same=part&&quote.value===part[0].trim();
        const existing=selection&&selection.text===quote.value?selection:null;
        const anchor=locateQuote(raw,quote.value,existing?.start??(same?part.index:0),existing?.end??(same?part.index+part[0].length:raw.length));
        if(memory.value.length>12000)throw new Error('补充资料最多 12000 字符，请只保留相关记录');
        this.c.adapter.imageTags();
        d.close();void this.previewChatu({index,text:anchor.quote,start:anchor.start,end:anchor.end},memory.value);
      }catch(error){status.textContent=error.message;}
    },'分析选段并预览');submit.classList.add('nd-primary');
    body.append(el('p',{text:'先选原文，再预览提示词。支持普通、非露骨剧情；不改变正文模型、推理强度或回复长度。'}),
      choices,quote,el('label',{},'当时的人物与服装资料（可选）',memory),
      el('p',{class:'nd-notice',text:'补图会带上本段之前的近期正文与当前角色卡，不自动读取未确认的数据库插件，也不保存另一份人物档案。旧段落请勿使用后文的最新衣着。'}),status,submit);
  }
  renderImages(){
    for(const [index,message] of this.c.ctx().chat.entries()){
      const root=document.querySelector(`.mes[mesid="${index}"] .mes_text`);if(!root)continue;
      for(const record of message.extra?.[NS]?.images||[]){
        if(!this.c.resolve(record.binding)||!record.scene?.anchor||!validAnchor(message.mes,record.scene.anchor)){
          root.querySelector(`[data-nd-id="${record.id}"]`)?.remove();continue;
        }
        if(root.querySelector(`[data-nd-id="${record.id}"]`))continue;
        // Preserve display of legacy saved images without reviving old generators.
        const image=el('img',{src:record.imageId,alt:record.scene.moment||'剧情插图',loading:'lazy'});
        insertAtAnchor(root,record.scene.anchor.quote,el('figure',{class:'nd-image','data-nd-id':record.id},image));
      }
    }
  }
  async renderPrompts(){
    const ctx=this.c.ctx();
    for(const [index,message] of ctx.chat.entries()){
      const root=document.querySelector(`.mes[mesid="${index}"] .mes_text`);if(!root)continue;
      for(const record of message.extra?.[NS]?.prompts||[]){
        const target=this.c.resolve(record.binding),anchor=target?.anchor||record.anchor;
        if(!target||!anchor||!validAnchor(message.mes,anchor)){
          root.querySelector(`[data-nd-id="${record.id}"]`)?.remove();
          if(this.pendingActivation.has(record.id)){
            this.pendingActivation.delete(record.id);
            this.errorOnce(new Error('聊天、回复分支或原文已改变，未触发这次补图'));
          }
          continue;
        }
        const existingMarker=root.querySelector(`[data-nd-id="${record.id}"]`);
        if(existingMarker){
          await this.activateIfPending(ctx,existingMarker,root,record);
          continue;
        }
        const requestId=this.c.adapter.requestId(record.prompt);
        const existingButton=[...root.querySelectorAll('.image-tag-button')].find(b=>b.dataset.requestId===requestId);
        if(existingButton){
          await this.activateIfPending(ctx,existingButton,root,record);
          continue;
        }
        const {startTag,endTag}=this.c.adapter.imageTags();
        const marker=el('span',{class:'nd-chatu-prompt','data-nd-id':record.id},`${startTag}${record.prompt}${endTag}`);
        if(!insertAtAnchor(root,anchor.quote,marker)){
          if(this.pendingActivation.has(record.id)){
            this.pendingActivation.delete(record.id);
            this.errorOnce(new Error('提示词已保存，但当前页面无法唯一定位原句；请展开正文后重新打开本条消息'));
          }
          continue;
        }
        await this.activateIfPending(ctx,marker,root,record);
      }
    }
  }
  async activateIfPending(ctx,focus,root,record){
    if(!this.pendingActivation.has(record.id))return;
    const regenerate=this.pendingActivation.get(record.id);
    this.pendingActivation.delete(record.id);
    await this.activateChatuPrompt(ctx,focus,root,record,regenerate);
  }
  async activateChatuPrompt(ctx,focus,root,record,regenerate=false){
    const requestId=this.c.adapter.requestId(record.prompt);
    const hadImage=[...root.querySelectorAll('.st-chatu8-image-span')].some(s=>s.dataset.requestId===requestId&&s.querySelector('img'));
    focus.scrollIntoView({block:'center'});
    delete root.dataset.chatu8Processed;delete root.dataset.chatu8ContentLength;
    await ctx.eventSource.emit('js_generation_ended');
    const nativeAuto=String(ctx.extensionSettings['st-chatu8']?.zidongdianji)==='true';
    if(!nativeAuto||regenerate&&hadImage)this.clickManualButtonWhenReady(record,regenerate);
  }
  clickManualButtonWhenReady(record,regenerate=false){
    const requestId=this.c.adapter.requestId(record.prompt);
    let attempts=0;
    const check=()=>{
      const target=this.c.resolve(record.binding);if(!target)return;
      const liveRoot=document.querySelector(`.mes[mesid="${target.index}"] .mes_text`);
      const button=liveRoot&&[...liveRoot.querySelectorAll('.image-tag-button')].find(b=>b.dataset.requestId===requestId);
      if(button){
        const saved=[...liveRoot.querySelectorAll('.st-chatu8-image-span')].find(s=>s.dataset.requestId===requestId&&s.querySelector('img'));
        if((regenerate||!saved)&&!button.hasAttribute('data-loading'))button.click();
        return;
      }
      if(++attempts<40)setTimeout(check,250);
      else this.errorOnce(new Error('智绘姬未识别选段的图片标记；请检查标记配置，或点击正文里出现的生图按钮'));
    };
    setTimeout(check,250);
  }
  renderTools(){
    const ctx=this.c.ctx();let tags=null;
    try{tags=this.c.adapter.imageTags();}catch{}
    for(const root of document.querySelectorAll('#chat .mes[mesid] .mes_text')){
      const row=root.closest('.mes'),index=Number(row.getAttribute('mesid')),message=ctx.chat[index];
      if(!message||message.is_user||message.is_system||!narrative(message.mes).trim()){row.querySelector('.nd-worldbook-tools')?.remove();continue;}
      const counts=inspectNativeMarkers(message.mes);
      const mismatch=tags&&(tags.startTag!=='image###'||tags.endTag!=='###')&&counts.complete>0;
      const manual=(message.extra?.[NS]?.prompts||[]).filter(r=>this.c.resolve(r.binding)).length;
      const images=root.querySelectorAll('.st-chatu8-image-span img,.nd-image img').length;
      const busy=index===ctx.chat.length-1&&this.c.generating;
      const state=!tags?'尚未检测到智绘姬配置':busy?'正文生成中':mismatch?'正文与智绘姬的图片标记不一致':counts.dangling||counts.malformed?'图片指令不完整或格式异常':counts.declared!==null&&counts.declared!==counts.complete?'声明图数与完整指令数不一致':!counts.complete&&!manual?counts.reason==='no-safe-visible-scene'?'本条无通用插图画面':counts.reason==='no-visual-scene'?'本条没有可见画面':'本条没有生图指令':`正文指令 ${counts.complete} · 手动 ${manual} · 已显示 ${images} 张`;
      const signature=JSON.stringify([index,state,counts,manual,images]);
      let bar=row.querySelector('.nd-worldbook-tools');if(bar?.dataset.signature===signature)continue;
      if(!bar){bar=el('div',{class:'nd-tools nd-worldbook-tools'});root.after(bar);}bar.dataset.signature=signature;
      bar.replaceChildren(el('small',{text:state}),command('image','选段补图',()=>this.pickExcerpt(index),'选段补图'),
        command('circle-info','本条生图诊断',()=>{
          const {body}=dialog('本条生图诊断');
          body.append(el('p',{text:`完整图片标记：${counts.complete}；格式异常：${counts.malformed}；缺少结束标记：${counts.dangling}；手动记录：${manual}；页面已显示图片：${images}。`}),
            el('p',{text:'没有指令时检查世界书是否启用或用选段补图。有指令却没有图时，查看智绘姬生成按钮、自动点击设置及错误。世界书无法保证生成端成功。'}),
            el('p',{text:this.c.lastWorldbookActivation===undefined?'当前页面尚无世界书激活记录。':`最近的世界书激活事件中，通用版核心${this.c.lastWorldbookActivation?'已出现':'未出现'}。这不代表历史消息，也不能证明最终 API 请求包含它。`}));
        }));
    }
  }
  settings(){
    const {body}=dialog('叙景 · 世界书助手 0.6.2');
    const link=el('a',{href:new URL('./worldbooks/Anima-Story-Safe-v3.json',import.meta.url).href,download:'Anima-Story-Safe-v3.json',class:'nd-command',text:'下载改进的通用剧情世界书'});
    body.append(el('p',{text:'自动插图由主 API 配合世界书输出，智绘姬负责生成。叙景只保留选段补图、提示词预览和漏图诊断。'}),
      link,el('p',{text:'导入世界书后，在当前角色或聊天中启用。请停用旧版 Anima 生图世界书，避免两套图片规则同时注入；原文件保留作备份。横图和方图要配合启用智绘姬 AI 自主分辨率及动态比例工作流。'}),
      el('p',{text:'人物、服装和剧情沿用已有数据库总结。自动插图直接使用主 API 已收到的资料；手动补图可粘贴相关摘要，插件不维护重复记忆。'}),
      el('p',{text:'旧自动导演、独立 API / 模型设置、原型库、服装写回和工作流控制已经移除。你原有的智绘姬设置、人物照片和聊天内容保留。'}),
      el('p',{class:'nd-notice',text:'本版按要求未运行测试、模型调用或真实生图；手机表现和实际出图等待你的反馈。'}));
  }
  refresh(){
    if(this.timer)return;
    this.timer=setTimeout(async()=>{
      this.timer=null;
      try{this.renderImages();await this.renderPrompts();}catch(error){this.errorOnce(error);}
      try{this.renderTools();}catch(error){this.errorOnce(error);}
    },180);
  }
  errorOnce(error){const text=String(error?.message||error);if(text!==this.lastError){this.lastError=text;globalThis.toastr?.warning(text,'叙景');}}
  install(){
    (document.querySelector('#extensions_settings2')||document.querySelector('#extensions_settings')||document.body).append(
      el('div',{class:'nd-settings-entry'},command('images','叙景 · 世界书助手',()=>this.settings(),'叙景 · 世界书助手')));
    document.addEventListener('selectionchange',()=>{
      const next=selectionSnapshot(this.c.ctx());if(!next)return;this.selection=next;
      if(!this.toolbar){
        this.toolbar=el('div',{class:'nd-selection'},command('image','选段补图',()=>{
          const selected=this.selection;this.clearSelection();if(selected)this.pickExcerpt(selected.index,selected);
        },'选段补图'));document.body.append(this.toolbar);
      }
      const v=window.visualViewport;
      this.toolbar.style.left=`${Math.max(8,Math.min(next.rect.left,(v?.width||innerWidth)-150))}px`;
      this.toolbar.style.top=`${Math.max(8,Math.min(next.rect.bottom+10,(v?.height||innerHeight)-64))}px`;
    });
    document.addEventListener('pointerdown',event=>{if(this.toolbar&&!this.toolbar.contains(event.target)&&!event.target.closest('.mes_text'))this.clearSelection();});
    const chat=document.querySelector('#chat');if(chat)new MutationObserver(()=>this.refresh()).observe(chat,{childList:true,subtree:true});
    this.refresh();
  }
}
