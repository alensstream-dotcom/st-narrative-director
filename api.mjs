import { DIRECTOR_SYSTEM, parseJson } from './core.mjs';
import { DIRECTOR_SCHEMA } from './schema.mjs';
export class DirectorAPI {
  constructor(context, config) { this.context=context; this.config=config; this.temporaryKey=''; }
  async post(path, body, signal) {
    const r = await fetch(path,{method:'POST',headers:this.context().getRequestHeaders(),body:JSON.stringify(body),signal});
    if (!r.ok) { const e=new Error(`导演服务 HTTP ${r.status}`); e.status=r.status; e.retryAfter=Number(r.headers.get('retry-after')) || 2; throw e; }
    const value=await r.json();
    if (value.error) throw new Error('导演服务拒绝请求，请检查模型、密钥和余额');
    return value;
  }
  connection(requireModel=true) {
    const c=this.config();
    if (requireModel && !c.model) throw new Error('请先设置导演模型');
    if (c.source==='custom' && !/^https?:\/\//.test(c.url)) throw new Error('请填写完整的导演 API 地址');
    return {chat_completion_source:c.source,model:c.model,secret_id:c.secretId || undefined,
      ...(c.source==='custom' ? {custom_url:c.url,custom_include_headers:this.temporaryKey ? `Authorization: "Bearer ${this.temporaryKey.replace(/[\r\n"\\]/g,'')}"` : ''} : {})};
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
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const timeout=AbortSignal.timeout(90000);
        const result=await this.post('/api/backends/chat-completions/generate',{
          ...this.connection(),stream:false,temperature:0.2,max_tokens:3200,
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
