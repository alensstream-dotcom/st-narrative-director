import {NS,assertEnglish,validAnchor,narrative} from './core.mjs';
import {el,command,dialog,selectionSnapshot,insertAtAnchor} from './dom.mjs';
import {openSettings} from './settings.mjs';

export class UI {
  constructor(controller){this.c=controller;this.toolbar=null;this.selection=null;this.mounts=new Set();this.pendingActivation=new Set();this.c.onPromptIssued=record=>this.pendingActivation.add(record.id);this.timer=null;this.statusNode=null;this.taskList=null;}
  async previewChatu(selection,previous=null){
    const {dialog:d,body}=dialog('确认画面'),abort=new AbortController();
    d.addEventListener('close',()=>abort.abort(),{once:true});
    const info=el('p',{class:'nd-status',text:'正在分析选中剧情…',role:'status'});body.append(info);
    try{
      const raw=this.c.ctx().chat[selection.index]?.mes;
      if(!raw||raw.slice(selection.start,selection.end)!==selection.text)throw new Error('选中的剧情已改变，请重新选择');
      const result=previous||await this.c.analyze(selection.index,raw,selection.start,selection.end,true,abort.signal);
      if(abort.signal.aborted)return;
      if(!result.scenes.length)throw new Error('未找到有原文依据的可绘制画面');
      let sceneIndex=0,scene=result.scenes[0];
      const quote=el('blockquote',{text:narrative(scene.anchor.quote).trim()});
      const prompt=el('textarea',{rows:6,'aria-label':'英文生图提示词'});
      const fill=()=>{
        scene=result.scenes[sceneIndex];
        quote.textContent=narrative(scene.anchor.quote).trim();
        prompt.value=this.c.effective(scene,this.c.adapter.promptStyle()).positive;
        info.textContent=scene.moment;
      };
      if(result.scenes.length>1){
        const moments=el('select',{},...result.scenes.map((s,i)=>el('option',{value:String(i),text:s.moment})));
        moments.onchange=()=>{sceneIndex=Number(moments.value);fill();};
        body.append(el('label',{},'画面',moments));
      }
      const confirm=command('image','交给智绘姬生成',async()=>{
        confirm.disabled=true;
        try{
          const positive=assertEnglish(prompt.value);
          await this.c.issuePrompt(this.c.bind(selection.index,raw,scene.anchor.end),scene,'manual',positive);
          d.close();this.refresh();
        }catch(e){this.error(e);confirm.disabled=false;}
      },'交给智绘姬生成');confirm.classList.add('nd-primary');
      fill();body.append(quote,el('label',{},'英文提示词',prompt),
        el('div',{class:'nd-actions'},command('rotate-right','重新分析',()=>{d.close();void this.previewChatu(selection);}),confirm));
    }catch(e){if(!abort.signal.aborted){info.textContent=e.message;body.append(command('rotate-right','重试分析',()=>{d.close();void this.previewChatu(selection);},'重试'));}}
  }
  error(e){this.c.status(String(e?.message||e));globalThis.toastr?.warning(String(e?.message||e),'叙景');}
  lockDialog(record,imageUrl=''){
    const {dialog:d,body}=dialog('人物形象');
    const feedback=el('p',{class:'nd-status',role:'status'});
    for(const cast of record.scene.cast){
      const c=this.c.scope().characters[cast.character_id];if(!c)continue;
      const state=el('span',{text:c.lock?'固定外貌已锁定':'暂用形象，未锁定'});
      const b=command(c.lock?'lock-open':'floppy-disk',c.lock?'解除锁定':'保存形象到智绘姬',async()=>{
        b.disabled=true;
        try{
          const result=await this.c.saveAppearance(record,cast,imageUrl||record.imageId);
          state.textContent=result.lock?'固定外貌已锁定':'暂用形象，未锁定';
          b.title=result.lock?'解除锁定':'保存形象到智绘姬';
          feedback.textContent=result.lock?result.mediaId
            ?`已保存至智绘姬人物照片${result.outfitSaved?'及对应服装照片':''}，并锁定固定外貌。`
            :'已锁定固定外貌；多人图不作为单人照片。':'已解除外貌锁定；智绘姬内已保存的照片保留。';
        }catch(e){feedback.textContent=e.message;this.error(e);}finally{b.disabled=false;}
      });
      body.append(el('div',{class:'nd-character'},el('strong',{text:c.name}),state,b));
    }
    body.append(feedback,el('p',{class:'nd-notice',text:'单人图确认后写入智绘姬人物照片；若当前剧情服装已建立预设，同一图也关联对应服装照片。固定外貌与人物 Tag 会锁定，换装和动作不会锁定。多人图只锁文字外貌，不作为单人参考。'}),
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
              const target=this.c.resolve(record.binding);if(target)void this.previewChatu({index:target.index,text:record.scene.anchor.quote,start:record.scene.anchor.start,end:record.scene.anchor.end},{binding:record.binding,scenes:[record.scene]});
            }),command('user-lock','保存形象',()=>this.lockDialog(record,record.imageId))));
          insertAtAnchor(root,record.scene.anchor.quote,section);
        }finally{this.mounts.delete(record.id);}
      }
    }
  }
  renderLockAction(marker,record){
    if(!record.scene?.cast?.some(c=>c.character_id&&c.fixed_facts?.length))return;
    if(!marker.querySelector('.st-chatu8-image-span img')||marker.querySelector('.nd-tools'))return;
    marker.append(el('div',{class:'nd-tools'},command('user-lock','保存形象到智绘姬',()=>this.lockDialog(record,marker.querySelector('.st-chatu8-image-span img')?.currentSrc||''))));
  }
  async renderPrompts(){
    const context=this.c.ctx(),chat=context.chat;
    for(let index=0;index<chat.length;index++){
      const message=chat[index],root=document.querySelector(`.mes[mesid="${index}"] .mes_text`);
      if(!root)continue;
      for(const record of message.extra?.[NS]?.prompts||[]){
        const target=this.c.resolve(record.binding);
        if(target?.anchor&&(target.anchor.start!==record.anchor.start||target.anchor.end!==record.anchor.end)){
          record.anchor=target.anchor;
          void context.saveChat();
        }
        if(!target||!validAnchor(message.mes,record.anchor)){
          root.querySelector(`[data-nd-id="${record.id}"]`)?.remove();
          continue;
        }
        const existing=root.querySelector(`[data-nd-id="${record.id}"]`);
        if(existing){this.renderLockAction(existing,record);continue;}
        const {startTag,endTag}=this.c.adapter.imageTags();
        const marker=el('span',{class:'nd-chatu-prompt','data-nd-id':record.id},`${startTag}${record.prompt}${endTag}`);
        if(!insertAtAnchor(root,record.anchor.quote,marker))continue;
        delete root.dataset.chatu8Processed;
        delete root.dataset.chatu8ContentLength;
        if(this.pendingActivation.delete(record.id)){
          void context.eventSource.emit('js_generation_ended').catch(e=>this.error(e));
        }
      }
    }
  }
  refresh(){
    if(this.statusNode?.isConnected)this.statusNode.textContent=this.c.notice;
    if(this.taskList?.isConnected){
      this.taskList.replaceChildren();
      const records=this.c.ctx().chat.flatMap(m=>m.extra?.[NS]?.prompts||[]).slice(-30).reverse();
      for(const record of records){
        const button=[...document.querySelectorAll('.image-tag-button')].find(node=>node.dataset.requestId===this.c.adapter.requestId(record.prompt));
        const state=record.state==='done'?'完成':record.state==='failed'?`失败 · ${record.detail||'请在原文按钮重试'}`:button?.hasAttribute('data-loading')?'智绘姬生成中':'已交付智绘姬';
        const row=el('div',{class:'nd-task'},el('span',{text:record.scene?.moment||'剧情画面'}),el('small',{text:state}));
        if(button)row.append(command('arrow-up-right-from-square','定位到正文',()=>{this.taskList.closest('dialog')?.close();button.scrollIntoView({behavior:'smooth',block:'center'});button.focus();}));
        this.taskList.append(row);
      }
    }
    if(!this.timer)this.timer=setTimeout(async()=>{
      this.timer=null;
      try{await this.renderImages();await this.renderPrompts();}catch(e){this.error(e);}
    },160);
  }
  settings(tab){return openSettings(this,tab);}
  install(){
    const entry=el('div',{class:'nd-settings-entry'},command('clapperboard','叙景 · 剧情导演',()=>this.settings(),'叙景 · 剧情导演'));
    (document.querySelector('#extensions_settings2')||document.querySelector('#extensions_settings')||document.body).append(entry);
    document.addEventListener('selectionchange',()=>{
      const next=selectionSnapshot(this.c.ctx());if(!next)return;this.selection=next;
      if(!this.toolbar){const generate=command('image','生成图片',()=>{
        const selected=this.selection;this.toolbar?.remove();this.toolbar=null;if(selected)void this.previewChatu(selected);
      },'生成图片');generate.classList.add('nd-primary');this.toolbar=el('div',{class:'nd-selection'},generate);document.body.append(this.toolbar);}
      const v=window.visualViewport;this.toolbar.style.left=`${Math.max(8,Math.min(next.rect.left,(v?.width||innerWidth)-150))}px`;
      this.toolbar.style.top=`${Math.max(8,Math.min(next.rect.bottom+10,(v?.height||innerHeight)-64))}px`;
    });
    document.addEventListener('pointerdown',e=>{if(this.toolbar&&!this.toolbar.contains(e.target)&&!e.target.closest('.mes_text')){this.toolbar.remove();this.toolbar=null;this.selection=null;}});
    const chat=document.querySelector('#chat');if(chat)new MutationObserver(()=>this.refresh()).observe(chat,{childList:true,subtree:true});this.refresh();
  }
}
