import {el,command} from './dom.mjs';

const secretKey=source=>source==='deepseek'?'api_key_deepseek':source==='openai'?'api_key_openai':'api_key_custom';
const field=(name,input)=>{input.setAttribute('aria-label',name);return el('label',{},name,input);};
const option=(value,text)=>el('option',{value,text});

export function connectionPanel(ui,body,dialog){
  const c=ui.c.config(),api=ui.c.api;
  const source=el('select',{},option('deepseek','DeepSeek'),option('openai','OpenAI'),option('custom','OpenAI 兼容接口'));
  source.value=c.source;
  const url=el('input',{type:'url',value:c.url||'',placeholder:'https://example.com/v1'});
  const urlField=field('API 地址',url);
  const mode=el('select',{},option('saved','酒馆已保存密钥'),option('session','本页临时密钥'));
  mode.value=c.credentialMode||'saved';
  const secrets=el('select',{},option(c.secretId||'',c.secretId?'正在读取密钥…':'请选择密钥'));
  const secretField=field('已保存密钥',secrets);
  const key=el('input',{type:'password',autocomplete:'off',value:api.temporaryKey,placeholder:'刷新页面后需重新填写'});
  const keyField=field('临时密钥',key);
  const keyActions=el('div',{class:'nd-actions-inline'},
    command('eye','显示或隐藏密钥',()=>{key.type=key.type==='password'?'text':'password';},'显示'),
    command('eraser','清除临时密钥',()=>{api.clearSessionKey();key.value='';notice.textContent='临时密钥已清除';},'清除'));
  const model=el('select',{},option('__manual__','手动输入模型 ID'));
  const manual=el('input',{value:c.model||'',placeholder:'例如 gpt-6-sol',spellcheck:false});
  const manualField=field('模型 ID',manual);
  const auto=el('select',{},option('__same__','跟随上方模型'),option('__manual__','手动输入模型 ID'));
  const autoManual=el('input',{value:c.streamModel||'',placeholder:'自动生图专用模型 ID',spellcheck:false});
  const autoManualField=field('自动模型 ID',autoManual);
  const advanced=el('details',{class:'nd-connection-advanced'},el('summary',{text:'高级：自动生图模型'}),
    el('p',{class:'nd-hint',text:'默认跟随完整分析模型。只有需要分开配置时才选择其他模型。'}),
    field('自动生图模型',auto),autoManualField);
  const notice=el('p',{class:'nd-status',role:'status','aria-live':'polite'});
  const hint=el('p',{class:'nd-hint',text:'模型列表由服务商提供；若暂时读取失败，已填写的模型 ID 仍可用于连接测试。'});
  let loadedIds=[];
  let requestVersion=0;
  const persist=()=>{
    const next={source:source.value,url:url.value.trim(),model:manual.value.trim(),streamModel:auto.value==='__same__'?'':autoManual.value.trim(),credentialMode:mode.value};
    let changed=false;
    for(const [name,value] of Object.entries(next))if(c[name]!==value){c[name]=value;changed=true;}
    if(changed)ui.c.save();
    return changed;
  };
  const selection=(select,input,current,follow=false)=>{
    select.replaceChildren(...(follow?[option('__same__','跟随上方模型')]:[]),
      option('__manual__','手动输入模型 ID'),...loadedIds.map(id=>option(id,id)));
    select.value=follow&&(!current||current===c.model)?'__same__':loadedIds.includes(current)?current:'__manual__';
    input.value=current||'';
    (follow?autoManualField:manualField).hidden=select.value!=='__manual__';
  };
  const showModels=()=>{selection(model,manual,c.model);selection(auto,autoManual,c.streamModel,true);};
  const cacheKey=()=>JSON.stringify([source.value,url.value.trim(),mode.value,mode.value==='saved'?secrets.value:'session']);
  const useCache=()=>{
    let cached;try{cached=JSON.parse(sessionStorage.getItem('nd-model-catalog')||'null');}catch{}
    loadedIds=cached?.key===cacheKey()&&Array.isArray(cached.ids)?cached.ids:[];
    showModels();
  };
  const modeState=()=>{
    urlField.hidden=source.value!=='custom';
    secretField.hidden=mode.value!=='saved';
    keyField.hidden=mode.value!=='session';
    keyActions.hidden=mode.value!=='session';
  };
  const refreshSecrets=async()=>{
    const current=source.value,version=++requestVersion;
    const state=await api.secrets();
    if(!body.isConnected||source.value!==current||version!==requestVersion)return;
    const entries=state[secretKey(current)]||[];
    secrets.replaceChildren(option('','请选择密钥'),...entries.map(item=>option(item.id,item.label||item.id)));
    secrets.value=c.secretId||'';
    if(c.secretId&&!secrets.value)notice.textContent='先前选择的密钥已不存在，请重新选择。';
    useCache();
  };
  const refresh=command('arrows-rotate','刷新可用模型',async()=>{
    refresh.disabled=true;notice.textContent='正在读取模型列表…';
    const requested=cacheKey();
    try{
      persist();
      const ids=await api.models();
      if(!body.isConnected||requested!==cacheKey())return;
      loadedIds=ids;
      try{sessionStorage.setItem('nd-model-catalog',JSON.stringify({key:requested,ids}));}catch{}
      showModels();notice.textContent=`已读取 ${ids.length} 个模型。`;
    }catch(error){
      if(requested!==cacheKey())return;
      useCache();
      notice.textContent=`${error.message}${loadedIds.length?' 已保留上次成功读取的列表。':''}`;
    }finally{refresh.disabled=false;}
  },'刷新可用模型');
  const test=command('plug','测试导演连接',async()=>{
    test.disabled=true;notice.textContent='正在测试导演连接…';
    try{persist();await api.testConnection();notice.textContent='连接成功，当前模型已实际响应。';}
    catch(error){notice.textContent=error.message;}
    finally{test.disabled=false;}
  },'测试连接');
  const copy=command('link','使用正文连接的独立副本',async()=>{
    try{
      const s=ui.c.ctx().chatCompletionSettings;
      if(!['deepseek','openai','custom'].includes(s.chat_completion_source))throw new Error('当前正文服务未适配，请单独配置导演接口。');
      const state=await api.secrets(),nextSource=s.chat_completion_source;
      const selected=(state[secretKey(nextSource)]||[]).find(item=>item.active);
      if(!selected)throw new Error('正文连接没有可引用的已保存密钥，请先在酒馆密钥管理中保存。');
      const nextModel=nextSource==='custom'?s.custom_model:nextSource==='deepseek'?s.deepseek_model:s.openai_model;
      if(!nextModel)throw new Error('正文连接尚未选择模型。');
      source.value=nextSource;url.value=s.custom_url||'';mode.value='saved';
      const changedSecret=c.secretId!==selected.id;
      api.useSavedKey(selected.id);key.value='';
      manual.value=nextModel;auto.value='__same__';autoManual.value='';
      const changed=persist();if(changedSecret&&!changed)ui.c.save();modeState();await refreshSecrets();useCache();
      notice.textContent='已复制正文连接选择，正文配置未修改。';
    }catch(error){notice.textContent=error.message;}
  },'复制正文连接');
  const manage=command('key','管理酒馆密钥',()=>{manage.dataset.key=secretKey(source.value);dialog.close();},'管理密钥');
  manage.classList.add('manage-api-keys');manage.dataset.key=secretKey(source.value);

  source.onchange=()=>{const hadSecret=!!c.secretId;c.secretId='';api.clearSessionKey();key.value='';secrets.value='';const changed=persist();if(hadSecret&&!changed)ui.c.save();modeState();useCache();void refreshSecrets().catch(error=>notice.textContent=error.message);};
  url.onchange=()=>{if(c.url!==url.value.trim()){api.clearSessionKey();key.value='';}persist();useCache();};
  mode.onchange=()=>{const oldSecret=c.secretId;if(mode.value==='saved'){api.useSavedKey(secrets.value);key.value='';}const changed=persist();if(oldSecret!==c.secretId&&!changed)ui.c.save();modeState();useCache();};
  secrets.onchange=()=>{const oldSecret=c.secretId;api.useSavedKey(secrets.value);mode.value='saved';const changed=persist();if(oldSecret!==c.secretId&&!changed)ui.c.save();modeState();useCache();notice.textContent='已切换导演密钥。';};
  key.oninput=()=>{try{api.setSessionKey(key.value);mode.value='session';persist();modeState();useCache();notice.textContent='临时密钥仅保留在本页内存中。';}catch(error){notice.textContent=error.message;}};
  model.onchange=()=>{
    const old=c.model;manual.value=model.value==='__manual__'?old:model.value;
    manualField.hidden=model.value!=='__manual__';
    if(c.streamModel===old&&auto.value==='__same__')autoManual.value='';
    persist();if(model.value==='__manual__')manual.focus();
  };
  manual.oninput=persist;
  auto.onchange=()=>{autoManualField.hidden=auto.value!=='__manual__';if(auto.value==='__manual__'){autoManual.focus();return;}autoManual.value=auto.value==='__same__'?'':auto.value;persist();};
  autoManual.oninput=persist;
  body.append(el('div',{class:'nd-connection-head'},el('h4',{text:'独立导演 API'}),copy),
    el('div',{class:'nd-connection-grid'},field('服务',source),urlField,field('密钥来源',mode),secretField,keyField),
    keyActions,el('div',{class:'nd-connection-tools'},manage),
    el('div',{class:'nd-model-head'},field('完整分析模型',model),refresh),manualField,
    advanced,el('div',{class:'nd-connection-tools'},test),hint,notice);
  modeState();useCache();void refreshSecrets().catch(error=>notice.textContent=error.message);
}
