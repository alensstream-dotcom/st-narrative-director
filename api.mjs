import { DIRECTOR_SYSTEM, parseJson } from './core.mjs';
import { DIRECTOR_SCHEMA } from './schema.mjs';
export class DirectorAPI {
  constructor(context, config) { this.context=context; this.config=config; this.temporaryKey='';this.keyEndpoint=''; }
  endpoint(){const c=this.config();return c.source==='custom'?String(c.url||'').trim().replace(/\/$/,''):c.source==='deepseek'?'https://api.deepseek.com':'https://api.openai.com/v1';}
  setSessionKey(value){
    const key=String(value||'').trim();if(/[\r\n]/.test(key))throw new Error('密钥不能包含换行');
    this.temporaryKey=key;this.keyEndpoint=this.endpoint();this.config().credentialMode='session';
  }
  clearSessionKey(){this.temporaryKey='';this.keyEndpoint='';}
  useSavedKey(id){this.clearSessionKey();this.config().credentialMode='saved';this.config().secretId=id||'';}
  async post(path, body, signal) {
    const r = await fetch(path,{method:'POST',headers:this.context().getRequestHeaders(),body:JSON.stringify(body),signal});
    if (!r.ok) { const e=new Error(this.errorMessage(r.status)); e.status=r.status; e.retryAfter=Number(r.headers.get('retry-after')) || 2; throw e; }
    const value=await r.json();
    if (value.error) {const status=Number(value.status||value.error?.status||value.error?.code)||0;const e=new Error(this.errorMessage(status));e.status=status;throw e;}
    return value;
  }
  connection(requireModel=true) {
    const c=this.config();
    if (requireModel && !c.model) throw new Error('请先设置导演模型');
    if (c.source==='custom' && !/^https?:\/\//.test(c.url)) throw new Error('请填写完整的导演 API 地址');
    if(c.credentialMode==='session'){
      if(!this.temporaryKey)throw new Error('临时密钥为空或页面已刷新，请重新填写，或选择酒馆已保存密钥');
      if(this.keyEndpoint!==this.endpoint())throw new Error('API 地址已改变，请重新确认密钥；不会把旧密钥发送到新地址');
      return {chat_completion_source:'custom',model:c.model,secret_id:'nd-no-default-secret',custom_url:this.endpoint(),custom_include_headers:`Authorization: ${JSON.stringify('Bearer '+this.temporaryKey)}`};
    }
    if(!c.secretId)throw new Error('请选择已保存密钥，或填写临时密钥；不会自动借用正文密钥');
    return {chat_completion_source:c.source,model:c.model,secret_id:c.secretId,
      ...(c.source==='custom' ? {custom_url:this.endpoint(),custom_include_headers:''} : {})};
  }
  errorMessage(status){return status===401||status===403?'密钥或访问权限验证失败。可以直接修改密钥后重试。':status===429?'服务限流或额度不足，请稍后重试或检查余额。':status===404?'接口地址或模型不存在，请检查 API 地址与模型。':`导演服务请求失败${status?'（HTTP '+status+'）':''}，请检查地址、模型、密钥和网络。`;}
  async testConnection(signal){
    const result=await this.post('/api/backends/chat-completions/generate',{...this.connection(),messages:[{role:'user',content:'Reply with OK.'}],stream:false,max_tokens:16,temperature:0},signal||AbortSignal.timeout(30000));
    if(!result.choices?.length)throw new Error('服务未返回有效聊天响应');return true;
  }
  async secrets() { return this.post('/api/secrets/read',{}); }
  async models() {
    const value=await this.post('/api/backends/chat-completions/status',{...this.connection(false),bypass_status_check:false});
    const data=Array.isArray(value.data) ? value.data : value.data?.data;
    if (!Array.isArray(data)) throw new Error('此服务未返回模型列表；可直接输入模型名');
    return data.map(x=>x.id).filter(Boolean);
  }
  async analyze(input, signal) {
    const start=performance.now();
    const connection=this.connection();
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const timeout=AbortSignal.timeout(90000);
        const result=await this.post('/api/backends/chat-completions/generate',{
          ...connection,stream:false,temperature:0.2,max_tokens:3200,
          messages:[{role:'system',content:DIRECTOR_SYSTEM},{role:'user',content:JSON.stringify(input)}],
          json_schema:{name:'scene_director',strict:false,value:DIRECTOR_SCHEMA}
        },signal ? AbortSignal.any([signal,timeout]) : timeout);
        return {...parseJson(result.choices?.[0]?.message?.content),analysisMs:Math.round(performance.now()-start)};
      } catch(e) {
        if(signal?.aborted || attempt===2 || ![429,502,503,504].includes(e.status)) throw e;
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},Math.min(12000,(e.retryAfter || 2)*1000*2**attempt));
          const abort=()=>{clearTimeout(timer);reject(signal.reason);}; signal?.addEventListener('abort',abort,{once:true});
        });
      }
    }
  }
}
