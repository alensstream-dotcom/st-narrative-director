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
