import {NS,uuid,fingerprint,clone,narrative,locateQuote,validAnchor,assertEnglish} from './core.mjs';
import {ChatuAdapter} from './adapter.mjs';

// No automatic LLM, renderer, character registry or database writes.
export class Controller {
  constructor(context){
    this.ctx=context;this.epoch=0;this.generating=false;this.mainManualBusy=false;
    this.onchange=()=>{};this.notice='';this.adapter=new ChatuAdapter(context);
  }
  status(text){this.notice=text;this.onchange();}
  chatKey(){const c=this.ctx();return `${c.groupId??c.characters?.[c.characterId]?.avatar??'solo'}::${c.getCurrentChatId?.()||c.chatId||''}`;}
  meta(message){message.extra||={};const m=message.extra[NS]||={id:uuid(),images:[],prompts:[]};m.id||=uuid();m.prompts||=[];return m;}
  bind(index,raw,end,quote=''){
    const m=this.ctx().chat[index];if(!m||m.mes!==raw)throw new Error('原文已改变，请重新选择');
    return {chat:this.chatKey(),message:this.meta(m).id,swipe:m.swipe_id||0,prefix:fingerprint(raw.slice(0,end)),end,...(quote?{quote}:{})};
  }
  resolve(b){
    if(!b||b.chat!==this.chatKey())return null;
    const index=this.ctx().chat.findIndex(m=>m.extra?.[NS]?.id===b.message),message=this.ctx().chat[index];
    if(!message||(message.swipe_id||0)!==b.swipe)return null;
    if(b.quote){try{return {message,index,anchor:locateQuote(message.mes,b.quote)};}catch{return null;}}
    return fingerprint(message.mes.slice(0,b.end))===b.prefix?{message,index}:null;
  }
  historyAt(index,start){
    const chat=this.ctx().chat;
    return [...chat.slice(Math.max(0,index-3),index).filter(m=>!m.is_system).map(m=>`${m.name||''}: ${narrative(m.mes).trim()}`),
      narrative(chat[index]?.mes?.slice(0,start)||'').trim()].join('\n').slice(-8000);
  }
  card(){
    const ctx=this.ctx(),card=ctx.characters?.[ctx.characterId];
    return card?{name:card.name,description:String(card.description||card.data?.description||'').slice(0,3500)}:null;
  }
  async issuePrompt(binding,scene,positive){
    const target=this.resolve(binding);
    if(!target||!validAnchor(target.message.mes,scene.anchor))throw new Error('原文已改变，请重新选择剧情');
    const prompt=assertEnglish(positive),{startTag,endTag}=this.adapter.imageTags();
    if(prompt.includes(startTag)||prompt.includes(endTag)||/[<>]/.test(prompt)||!/^Scene Composition:SFW\s*,[^;]+;$/.test(prompt))throw new Error('请保留 Scene Composition:SFW, 开头和末尾分号，每条只描述一个普通剧情画面');
    const meta=this.meta(target.message);
    const duplicate=meta.prompts.find(p=>p.binding?.swipe===binding.swipe&&p.anchor?.fingerprint===scene.anchor.fingerprint&&p.prompt===prompt&&p.state!=='failed');
    if(duplicate){this.status('这张画面已经提交，可在原文的智绘姬按钮查看或重试');return duplicate;}
    const record={id:uuid(),binding:clone(binding),anchor:clone(scene.anchor),scene:clone(scene),prompt,origin:'manual',state:'issued',created:Date.now()};
    meta.prompts.push(record);
    try{await this.ctx().saveChat();}catch(error){meta.prompts=meta.prompts.filter(p=>p!==record);throw error;}
    if(!this.resolve(binding))throw new Error('聊天已切换；提示词已保存在原聊天，未在新聊天触发生图');
    this.onPromptIssued?.(record);this.status('已保存提示词，等待智绘姬识别');return record;
  }
  onChatuResult(result){
    if(!result?.id)return;
    let changed=false;
    for(const message of this.ctx().chat)for(const record of message.extra?.[NS]?.prompts||[]){
      if(!this.resolve(record.binding)||this.adapter.requestId(record.prompt)!==result.id)continue;
      record.state=result.success?'done':'failed';record.detail=result.success?'':String(result.error||'生图失败').slice(0,160);changed=true;
    }
    if(changed){Promise.resolve(this.ctx().saveChat()).catch(()=>{});this.onchange();}
  }
  invalidate(){this.epoch++;this.onchange();}
}
