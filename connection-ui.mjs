import {el,command} from './dom.mjs';

const secretKey=source=>source==='deepseek'?'api_key_deepseek':source==='openai'?'api_key_openai':'api_key_custom';
const field=(name,input)=>{input.setAttribute('aria-label',name);return el('label',{},name,input);};
const option=(value,text)=>el('option',{value,text});

export function connectionPanel(ui,body,dialog){
  const config=ui.c.config(),api=ui.c.api;
  const source=el('select',{},option('custom','OpenAI 兼容接口'),option('deepseek','DeepSeek'),option('openai','OpenAI'));
  source.value=config.source;
  const url=el('input',{type:'url',value:config.url||'',placeholder:'https://example.com/v1',spellcheck:false});
  const urlField=field('API Base URL',url);
  const mode=el('select',{},option('session','本页独立 API Key'),option('saved','酒馆已保存密钥'));
  mode.value=config.credentialMode||'session';
  const secrets=el('select',{},option(config.secretId||'',config.secretId?'正在读取密钥名称…':'请选择密钥'));
  const secretField=field('酒馆已保存密钥',secrets);
  const key=el('input',{type:'password',value:api.temporaryKey,autocomplete:'off',spellcheck:false,placeholder:'输入 API Key；仅保存在当前页面内存'});
  const keyField=field('API Key',key);
  const showKey=command('eye','显示或隐藏 API Key',()=>{key.type=key.type==='password'?'text':'password';},'显示');
  const keyHint=el('p',{class:'nd-hint'});
  const modelList=el('select',{},option('','连接后选择模型'));
  const model=el('input',{value:config.model||'',placeholder:'选择或输入模型名称',spellcheck:false});
  const autoList=el('select',{},option('','跟随上方模型'));
  const autoInput=el('input',{value:config.streamModel&&config.streamModel!==config.model?config.streamModel:'',placeholder:'留空则跟随上方模型',spellcheck:false});
  const autoPanel=el('details',{class:'nd-connection-advanced'},el('summary',{text:'高级：自动生图模型'}),
    el('p',{class:'nd-hint',text:'默认跟随完整分析模型。只有需要更快或不同的模型时才分开填写。'}),
    field('自动模型列表',autoList),field('自动模型名称',autoInput));
  const result=el('p',{class:'nd-status',role:'status','aria-live':'polite'});
  const more=el('details',{class:'nd-connection-advanced'},el('summary',{text:'更多连接选项与密钥管理'}));
  let ids=[];
  let secretRequest=0;
  const cacheKey=()=>JSON.stringify([source.value,url.value.trim(),mode.value,mode.value==='saved'?secrets.value:'session']);
  const persist=()=>{
    const selectedModel=model.value.trim();
    const selectedAuto=autoInput.value.trim()||(config.streamModel===config.model&&config.model===selectedModel?config.streamModel:'');
    const next={source:source.value,url:url.value.trim(),credentialMode:mode.value,model:selectedModel,streamModel:selectedAuto};
    let changed=false;
    for(const [name,value] of Object.entries(next))if(config[name]!==value){config[name]=value;changed=true;}
    if(changed)ui.c.save();
    return changed;
  };
  const renderLists=()=>{
    const current=model.value.trim(),automatic=autoInput.value.trim();
    const mainIds=current&&!ids.includes(current)?[current,...ids]:ids;
    const automaticIds=automatic&&!ids.includes(automatic)?[automatic,...ids]:ids;
    modelList.replaceChildren(option('','选择可用模型'),...mainIds.map(id=>option(id,id===current&&!ids.includes(id)?`${id}（当前手填）`:id)));
    modelList.value=current||'';
    autoList.replaceChildren(option('','跟随上方模型'),...automaticIds.map(id=>option(id,id)));
    autoList.value=automatic||'';
  };
  const useCache=()=>{
    let cache;try{cache=JSON.parse(sessionStorage.getItem('nd-model-catalog')||'null');}catch{}
    ids=cache?.key===cacheKey()&&Array.isArray(cache.ids)?cache.ids:[];
    renderLists();
  };
  const keyState=()=>{
    urlField.hidden=source.value!=='custom';
    secretField.hidden=mode.value!=='saved';
    if(mode.value==='saved'){
      const selected=secrets.selectedOptions[0]?.textContent||'';
      keyHint.textContent=secrets.value?`当前使用酒馆密钥：${selected}。也可在上方直接输入新 Key。`:'尚未选择酒馆密钥；可在上方直接输入 API Key。';
    }else keyHint.textContent=api.temporaryKey?'当前使用本页独立 Key；刷新页面后需重新输入。':'请输入 API Key 后点击「连接并获取模型」；刷新页面后需重新输入。';
  };
  const refreshSecrets=async()=>{
    const current=source.value,version=++secretRequest;
    const state=await api.secrets();
    if(!body.isConnected||current!==source.value||version!==secretRequest)return;
    secrets.replaceChildren(option('','请选择密钥'),...(state[secretKey(current)]||[]).map(item=>option(item.id,item.label||item.id)));
    secrets.value=config.secretId||'';
    if(config.secretId&&!secrets.value)result.textContent='先前选择的酒馆密钥已不存在。可重新选择，或直接输入 API Key。';
    keyState();useCache();
  };
  const fetchModels=command('plug','连接并获取模型',async()=>{
    fetchModels.disabled=true;result.textContent='正在连接并获取模型…';
    const requested=cacheKey();
    try{
      persist();
      const list=await api.models();
      if(!body.isConnected||requested!==cacheKey())return;
      ids=list;
      try{sessionStorage.setItem('nd-model-catalog',JSON.stringify({key:requested,ids:list}));}catch{}
      renderLists();
      result.textContent=`已获取 ${list.length} 个模型。请选择一个，或继续使用手填模型名称。`;
    }catch(error){
      if(requested!==cacheKey())return;
      useCache();result.textContent=`${error.message}${ids.length?' 已保留上次成功读取的列表。':''}`;
    }finally{fetchModels.disabled=false;}
  },'连接并获取模型');
  fetchModels.classList.add('nd-primary');
  const test=command('plug','测试当前模型',async()=>{
    test.disabled=true;result.textContent='正在测试当前模型…';
    try{persist();await api.testConnection();result.textContent='连接成功，当前模型已返回可见文本。';}
    catch(error){result.textContent=error.message;}
    finally{test.disabled=false;}
  },'测试当前模型');
  const manage=command('key','管理酒馆密钥',()=>{manage.dataset.key=secretKey(source.value);dialog.close();},'管理密钥');
  manage.classList.add('manage-api-keys');manage.dataset.key=secretKey(source.value);
  const copy=command('link','使用正文连接的独立副本',async()=>{
    try{
      const settings=ui.c.ctx().chatCompletionSettings;
      if(!['deepseek','openai','custom'].includes(settings.chat_completion_source))throw new Error('正文服务尚未适配，请单独填写导演 API。');
      const state=await api.secrets(),selectedSource=settings.chat_completion_source;
      const active=(state[secretKey(selectedSource)]||[]).find(item=>item.active);
      if(!active)throw new Error('正文连接没有可引用的已保存密钥。');
      const selectedModel=selectedSource==='custom'?settings.custom_model:selectedSource==='deepseek'?settings.deepseek_model:settings.openai_model;
      if(!selectedModel)throw new Error('正文连接尚未选择模型。');
      const oldSecret=config.secretId,oldMode=config.credentialMode;
      source.value=selectedSource;url.value=settings.custom_url||'';mode.value='saved';
      api.useSavedKey(active.id);key.value='';model.value=selectedModel;autoInput.value='';
      const changed=persist();if((oldSecret!==config.secretId||oldMode!==config.credentialMode)&&!changed)ui.c.save();
      keyState();await refreshSecrets();result.textContent='已复制连接选择，正文配置未修改。';
    }catch(error){result.textContent=error.message;}
  },'复制正文连接');
  more.append(field('服务类型',source),field('密钥来源',mode),secretField,
    el('div',{class:'nd-actions-inline'},manage,copy));

  source.onchange=()=>{
    const hadSecret=!!config.secretId;config.secretId='';api.clearSessionKey();key.value='';secrets.value='';
    const changed=persist();if(hadSecret&&!changed)ui.c.save();keyState();useCache();
    void refreshSecrets().catch(error=>result.textContent=error.message);
  };
  url.onchange=()=>{
    if(config.url!==url.value.trim()&&api.temporaryKey){api.clearSessionKey();key.value='';result.textContent='API 地址已改变，请重新输入 Key，避免把旧 Key 发往新地址。';}
    persist();keyState();useCache();
  };
  mode.onchange=()=>{
    const oldSecret=config.secretId,oldMode=config.credentialMode;
    if(mode.value==='saved'){api.useSavedKey(secrets.value);key.value='';}
    const changed=persist();if((oldSecret!==config.secretId||oldMode!==config.credentialMode)&&!changed)ui.c.save();keyState();useCache();
  };
  secrets.onchange=()=>{
    const oldSecret=config.secretId,oldMode=config.credentialMode;api.useSavedKey(secrets.value);mode.value='saved';key.value='';
    const changed=persist();if((oldSecret!==config.secretId||oldMode!==config.credentialMode)&&!changed)ui.c.save();keyState();useCache();
    result.textContent='已选用酒馆密钥。';
  };
  key.oninput=()=>{
    try{
      const oldMode=config.credentialMode;api.setSessionKey(key.value);mode.value='session';
      const changed=persist();if(oldMode!==config.credentialMode&&!changed)ui.c.save();keyState();
      try{sessionStorage.removeItem('nd-model-catalog');}catch{}
      ids=[];renderLists();result.textContent='';
    }catch(error){result.textContent=error.message;}
  };
  modelList.onchange=()=>{if(modelList.value){model.value=modelList.value;persist();}};
  model.oninput=()=>{
    renderLists();
    persist();
  };
  autoList.onchange=()=>{autoInput.value=autoList.value;persist();};
  autoInput.oninput=()=>{renderLists();persist();};

  body.append(el('h4',{text:'导演 LLM 连接'}),urlField,
    el('div',{class:'nd-key-row'},keyField,showKey),keyHint,
    el('div',{class:'nd-model-pair'},field('可用模型',modelList),field('模型名称',model)),
    el('div',{class:'nd-connection-actions'},fetchModels,test),result,
    el('p',{class:'nd-hint',text:'获取列表失败时仍可手填模型名称并测试；酒馆代理失败时，本页 Key 会尝试直连 /models。'}),
    autoPanel,more);
  keyState();useCache();void refreshSecrets().catch(error=>result.textContent=error.message);
}
