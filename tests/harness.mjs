import {NS} from '../core.mjs';
const token=await(await fetch('/csrf-token')).json();
const headers={'Content-Type':'application/json','X-CSRF-Token':token.token};
const post=async(path,body)=>(await fetch(path,{method:'POST',headers,body:JSON.stringify(body)})).json();
const response=await post('/api/settings/get',{}),settings=typeof response.settings==='string'?JSON.parse(response.settings):response.settings;
const secrets=await post('/api/secrets/read',{});
const completion=settings.oai_settings||{},source=completion.chat_completion_source||'deepseek';
const name=source==='deepseek'?'api_key_deepseek':source==='custom'?'api_key_custom':'api_key_openai';
settings.extension_settings[NS]={enabled:false,source,model:source==='deepseek'?completion.deepseek_model:source==='custom'?completion.custom_model:completion.openai_model,
 secretId:(secrets[name]||[]).find(s=>s.active)?.id||'',url:completion.custom_url||'',autoBackend:'comfyui',manualBackend:'comfyui',scopes:{}};
const events=new Map(),types=Object.fromEntries(['GENERATION_STARTED','STREAM_TOKEN_RECEIVED','GENERATION_ENDED','CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_EDITED','CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED','MESSAGE_RECEIVED'].map(n=>[n,n]));
const description='艾琳是二十五岁的女性，银色及肩短发，绿色眼睛，左眼下有一颗小痣。她是一名旅行摄影师。';
const context={extensionSettings:settings.extension_settings,chatCompletionSettings:completion,chat:[],chatId:'nd-real-qa',characterId:0,characters:[{avatar:'nd-qa.png',name:'艾琳',description,data:{name:'艾琳',description}}],
getCurrentChatId:()=>context.chatId,getRequestHeaders:()=>headers,saveSettingsDebounced:()=>{},saveChat:async()=>{},eventTypes:types,
eventSource:{on:(n,f)=>{const list=events.get(n)||[];list.push(f);events.set(n,list);},emit:async(n,...args)=>{for(const f of events.get(n)||[])await f(...args);}}};
window.SillyTavern={getContext:()=>context};
window.testHarness={context,types,setText(text){context.chat=[{mes:text,is_user:false,name:'艾琳',swipe_id:0,extra:{}}];this.render();},render(){
 const root=document.querySelector('#chat');root.replaceChildren();context.chat.forEach((m,i)=>{const row=document.createElement('article');row.className='mes';row.setAttribute('mesid',i);const content=document.createElement('div');content.className='mes_text';
 for(const paragraph of m.mes.split('\n\n')){const p=document.createElement('p');p.textContent=paragraph;content.append(p);}const options=document.createElement('div');options.className='test-options';for(let i=1;i<=4;i++){const b=document.createElement('button');b.textContent='剧情选项 '+i;b.onclick=()=>b.dataset.clicked='true';options.append(b);}content.append(options);row.append(content);root.append(row);});
}};
window.testHarness.setText('艾琳走进车站大厅，停在窗边。她穿着白色长裙，银色及肩短发衬着绿色的眼睛，左眼下有一颗小痣。她把棕色旅行箱放在脚边，转过身朝我微笑。窗外的午后阳光照亮了她的脸。\n\n远处的广播响了，她低头核对车票，随后安静地等待。');
await import('../index.js');document.querySelector('#ready').textContent='就绪 · 不保存酒馆设置或聊天；真实生成仍会使用 API 和算力。';window.testHarness.ready=true;
