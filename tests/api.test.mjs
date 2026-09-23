import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectorAPI} from '../api.mjs';

test('gpt-6-sol uses minimal reasoning for story analysis without changing other models',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({}),()=>config),requests=[];
  api.post=async(_path,body)=>{requests.push(body);return {choices:[{message:{content:'{"scenes":[],"state_updates":[]}'}}]};};
  await api.analyze({mode:'automatic',CURRENT_TEXT:'A woman enters.'});
  assert.equal(requests[0].reasoning_effort,'minimal');
  config.model='another-model';
  await api.analyze({mode:'manual',CURRENT_TEXT:'A woman enters.'});
  assert.equal('reasoning_effort' in requests[1],false);
});

test('gateway timeout and quota envelopes are classified even when HTTP status is 200',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({getRequestHeaders:()=>({})}),()=>config);
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Gateway Time-out'}}),{status:200,headers:{'content-type':'application/json'}});
    await assert.rejects(api.post('/completion',{}),error=>error.status===504);
    globalThis.fetch=async()=>new Response(JSON.stringify({quota_error:{message:'quota exceeded'}}),{status:200,headers:{'content-type':'application/json'}});
    await assert.rejects(api.post('/completion',{}),error=>error.status===429);
  }finally{globalThis.fetch=originalFetch;}
});

test('analysis retries a gateway 504 once and then returns the parsed scene',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({}),()=>config);let attempts=0;
  api.post=async()=>{
    attempts++;
    if(attempts===1){const error=new Error('gateway timeout');error.status=504;error.retryAfter=0.001;throw error;}
    return {choices:[{message:{content:'{"scenes":[],"state_updates":[]}'}}]};
  };
  const result=await api.analyze({mode:'automatic',CURRENT_TEXT:'A woman enters.'});
  assert.equal(attempts,2);
  assert.deepEqual(result.scenes,[]);
});
