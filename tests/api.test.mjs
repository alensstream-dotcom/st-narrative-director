import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectorAPI,normalizeModelIds} from '../api.mjs';
import {AUTO_DIRECTOR_SCHEMA,AUTO_STREAM_SCHEMA} from '../schema.mjs';

test('automatic streaming schema emits evidence and usable prompt fields first',()=>{
  const properties=AUTO_DIRECTOR_SCHEMA.properties.scenes.items.properties;
  assert.deepEqual(Object.keys(properties).slice(0,5),['evidence','positive','score','uncertain','subject']);
  const streaming=AUTO_STREAM_SCHEMA.properties.scenes.items.properties;
  assert.deepEqual(Object.keys(streaming).slice(0,5),['evidence','score','uncertain','subject','positive']);
});

test('story analysis uses each supported model family minimum reasoning level',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({}),()=>config),requests=[];
  api.post=async(_path,body)=>{requests.push(body);return {choices:[{message:{content:'{"scenes":[],"state_updates":[]}'}}]};};
  await api.analyze({mode:'automatic',CURRENT_TEXT:'A woman enters.'});
  assert.equal(requests[0].reasoning_effort,'none');
  assert.deepEqual(JSON.parse(requests[0].custom_include_body),{reasoning_effort:'none'});
  config.model='gpt-5.6-luna';
  await api.analyze({mode:'manual',CURRENT_TEXT:'A woman enters.'});
  assert.equal(requests[1].reasoning_effort,'low');
  config.model='another-model';
  await api.analyze({mode:'manual',CURRENT_TEXT:'A woman enters.'});
  assert.equal('reasoning_effort' in requests[2],false);
  assert.equal(requests[0].json_schema.name,'scene_director_auto');
  assert.equal(requests[0].max_tokens,850);
  assert.equal(requests[1].json_schema.name,'scene_director');
});

test('compact automatic scene output is normalized for character/profile and image rendering',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({}),()=>config);let request;
  api.post=async(_path,body)=>{
    request=body;
    return {choices:[{message:{content:JSON.stringify({scenes:[{evidence:'Satan lifts her axe.',moment:'Satan raises her axe.',event_key:'satan_axe',phase:'happening',score:.92,uncertain:false,subject:'characters',cast:[{name:'Satan',aliases:[],gender:'female',is_subject:true,outfit:'',outfit_evidence:'',outfit_class:'',outfit_specificity:'unknown',fixed_facts:[]}],shot:{action:'Satan raises her axe.',essential_visible:['axe'],face_visibility:'both_eyes',face_visibility_evidence:''},positive:'front view, both eyes visible, and an unobstructed face. Satan raises her axe beside the gate.',negative:'text',audit:{grounded:true,one_moment:true,no_invented_dialogue:true}}],state_updates:[]})}}]};
  };
  const result=await api.analyze({mode:'automatic',CURRENT_TEXT:'Satan lifts her axe.'});
  assert.equal(request.messages[0].content.includes('concise visual-scene director'),true);
  assert.equal(result.scenes[0].shot.framing,'front-facing shot showing the face and defining action');
  assert.equal(result.scenes[0].shot.spatial_relations,'');
  assert.equal(result.scenes[0].cast[0].position,'');
});

test('automatic streaming analysis emits a grounded prompt before late scene metadata arrives',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',streamModel:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({getRequestHeaders:()=>({'content-type':'application/json'})}),()=>config);
  const scene={evidence:'Satan lowers her axe.',positive:'front view, both eyes visible, and an unobstructed face. Satan lowers her burning axe beside the stone gate.',score:0.94,uncertain:false,subject:'characters',negative:'text, watermark',moment:'Satan lowers her axe.',event_key:'satan-axe',phase:'happening',cast:[],shot:{action:'Satan lowers her axe.',essential_visible:['axe'],face_visibility:'both_eyes',face_visibility_evidence:''},audit:{grounded:true,one_moment:true,no_invented_dialogue:true}};
  const full=JSON.stringify({scenes:[scene],state_updates:[]});
  const split=full.indexOf(',"subject"')+1;
  let makeRestAvailable;
  const restAvailable=new Promise(resolve=>{makeRestAvailable=resolve;});
  const originalFetch=globalThis.fetch;
  let requestedModel='',requestedEffort='',requestedSchema,requestInput;
  try{
    globalThis.fetch=async(_path,options)=>{const body=JSON.parse(options.body);requestedModel=body.model;requestedEffort=body.reasoning_effort;requestedSchema=body.json_schema;requestInput=JSON.parse(body.messages[1].content);return new Response(new ReadableStream({
      start(controller){
        const encoder=new TextEncoder();
        const frame=content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`;
        controller.enqueue(encoder.encode(frame(full.slice(0,split))));
        makeRestAvailable(()=>{
          controller.enqueue(encoder.encode(frame(full.slice(split))));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        });
      },
    }),{status:200,headers:{'content-type':'text/event-stream'}});};
    let settled=false;
    let resolveEarly;
    const early=new Promise(resolve=>{resolveEarly=resolve;});
    const analysis=api.analyze({mode:'automatic',CURRENT_TEXT:'Satan lowers her axe.',PREVIOUS_CONTEXT:{recent:'r'.repeat(1000),states:[{id:1},{id:2},{id:3}]},original_profiles:[{id:'profile'}],original_outfits:[{id:'outfit'}],renderer_style:{prefix:'style'},visual_registry:[{name:'Satan',aliases:[],gender:'female',profileTraits:'red hair'}]},undefined,async partial=>{resolveEarly(partial);return true;}).then(value=>{settled=true;return value;});
    const partial=await early;
    assert.equal(settled,false);
    assert.equal(partial.evidence,'Satan lowers her axe.');
    assert.equal(partial.subject,'characters');
    assert.match(partial.positive,/front view/);
    assert.equal(requestedModel,'gpt-6-sol');
    assert.equal(requestedEffort,'none');
    assert.equal(requestedSchema,undefined);
    assert.equal(requestInput.PREVIOUS_CONTEXT.recent.length,140);
    assert.equal(requestInput.PREVIOUS_CONTEXT.states.length,1);
    assert.equal(requestInput.original_profiles,undefined);
    assert.equal(requestInput.original_outfits,undefined);
    assert.equal(requestInput.renderer_style,undefined);
    assert.equal(requestInput.visual_registry[0].profileTraits,'red hair');
    const emitRest=await restAvailable;
    emitRest();
    const result=await analysis;
    assert.equal(result.scenes.length,1);
  }finally{globalThis.fetch=originalFetch;}
});

test('connection check requires visible model output and only sets auxiliary reasoning',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({}),()=>config);let request;
  api.post=async(_path,body)=>{request=body;return {choices:[{message:{content:''}}]};};
  await assert.rejects(api.testConnection(),/没有返回可见文本/);
  assert.equal(request.max_tokens,64);
  assert.deepEqual(JSON.parse(request.custom_include_body),{reasoning_effort:'none'});
  api.post=async()=>({choices:[{message:{content:'OK'}}]});
  assert.equal(await api.testConnection(),true);
});

test('automatic stream can issue a complete scene clause before the positive JSON string closes',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',streamModel:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({getRequestHeaders:()=>({})}),()=>config);
  const positive='front view, both eyes visible, and an unobstructed face. Satan lowers her burning axe beside the stone gate while a distant bell rings.';
  const full=JSON.stringify({scenes:[{evidence:'Satan lowers her axe.',score:.94,uncertain:false,subject:'characters',positive,negative:'text, watermark',cast:[]}],state_updates:[]});
  const split=full.indexOf(' while a distant bell')+' while a dis'.length;
  const originalFetch=globalThis.fetch;
  let sendRest;
  try{
    globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){
      const encoder=new TextEncoder(),frame=content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`;
      controller.enqueue(encoder.encode(frame(full.slice(0,split))));
      sendRest=()=>{controller.enqueue(encoder.encode(frame(full.slice(split))));controller.close();};
    }}),{status:200,headers:{'content-type':'text/event-stream'}});
    let resolveEarly;
    const early=new Promise(resolve=>{resolveEarly=resolve;});
    let settled=false;
    const analysis=api.analyze({mode:'automatic',CURRENT_TEXT:'Satan lowers her axe.',visual_registry:[{name:'Satan',gender:'female',aliases:[]}]},undefined,async scene=>{resolveEarly(scene);return true;}).then(result=>{settled=true;return result;});
    const scene=await early;
    assert.equal(settled,false);
    assert.equal(scene.positive,'front view, both eyes visible, and an unobstructed face. Satan lowers her burning axe beside the stone gate');
    assert.equal(scene.subject,'characters');
    sendRest();
    assert.equal((await analysis).scenes[0].positive,positive);
  }finally{globalThis.fetch=originalFetch;}
});

test('automatic stream rejects incomplete or ungrounded partial positive strings',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',streamModel:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({getRequestHeaders:()=>({})}),()=>config);
  const base={evidence:'Satan lowers her axe.',score:.94,uncertain:false,subject:'characters',positive:'front view, both eyes visible, and an unobstructed face. Satan lowers her burning axe beside the stone gate.',negative:'text, watermark',cast:[]};
  const variants=[
    {name:'low score',scene:{...base,score:.7},partial:'stone gate'},
    {name:'out-of-range score',scene:{...base,score:1.2},partial:'stone gate'},
    {name:'uncertain scene',scene:{...base,uncertain:true},partial:'stone gate'},
    {name:'unquoted evidence',scene:{...base,evidence:'Satan raises her axe.'},partial:'stone gate'},
    {name:'incorrect subject',scene:{...base,subject:'environment'},partial:'stone gate'},
    {name:'missing place object',scene:base,partial:'beside the st'},
    {name:'escaped positive',scene:{...base,positive:'front view, both eyes visible, and an unobstructed face. Satan lowers her burning axe beside the stone gate\\n'},partial:'gate\\'},
  ];
  const originalFetch=globalThis.fetch;
  try{
    for(const variant of variants){
      const full=JSON.stringify({scenes:[variant.scene],state_updates:[]});
      const split=full.indexOf(variant.partial)+variant.partial.length;
      assert.ok(split>=variant.partial.length,variant.name);
      let sendRest;
      globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){
        const encoder=new TextEncoder(),frame=content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`;
        controller.enqueue(encoder.encode(frame(full.slice(0,split))));
        sendRest=()=>{controller.enqueue(encoder.encode(frame(full.slice(split))));controller.close();};
      }}),{status:200,headers:{'content-type':'text/event-stream'}});
      let earlyCount=0;
      const analysis=api.analyze({mode:'automatic',CURRENT_TEXT:'Satan lowers her axe.',visual_registry:[{name:'Satan',gender:'female',aliases:[]}]},undefined,async()=>{earlyCount++;return true;});
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(earlyCount,0,variant.name);
      sendRest();
      await analysis;
    }
  }finally{globalThis.fetch=originalFetch;}
});

test('malformed fast JSON falls back once to the compact structured stream schema',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',streamModel:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({getRequestHeaders:()=>({'content-type':'application/json'})}),()=>config),schemas=[];
  const originalFetch=globalThis.fetch;
  const scene={evidence:'Satan lowers her axe.',score:.94,uncertain:false,subject:'characters',positive:'front view, both eyes visible, and an unobstructed face. Satan lowers her axe beside the gate.',negative:'text, watermark',cast:[]};
  const response=content=>new Response(new ReadableStream({start(controller){const e=new TextEncoder();controller.enqueue(e.encode(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: [DONE]\n\n`));controller.close();}}),{status:200,headers:{'content-type':'text/event-stream'}});
  try{
    globalThis.fetch=async(_path,options)=>{schemas.push(JSON.parse(options.body).json_schema);return response(schemas.length===1?'not json':JSON.stringify({scenes:[scene],state_updates:[]}));};
    let early=0;
    const result=await api.analyze({mode:'automatic',CURRENT_TEXT:'Satan lowers her axe.'},undefined,async()=>{early++;return true;});
    assert.equal(schemas.length,2);assert.equal(schemas[0],undefined);assert.equal(schemas[1].name,'scene_director_auto');
    assert.equal(early,1);assert.equal(result.scenes.length,1);
  }finally{globalThis.fetch=originalFetch;}
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

test('model list accepts common compatible-provider shapes and recovers from a transient proxy error',async()=>{
  assert.deepEqual(normalizeModelIds({models:[{name:'beta'},'alpha',{model:'beta'}]}),['alpha','beta']);
  assert.deepEqual(normalizeModelIds({data:{data:[{id:'gpt-6-sol'}]}}),['gpt-6-sol']);
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({}),()=>config);let calls=0;
  api.post=async()=>{if(++calls===1){const error=new Error('proxy returned error');error.status=0;throw error;}return {data:[{id:'gpt-6-sol'},{id:'gpt-6-astra'}]};};
  assert.deepEqual(await api.models(),['gpt-6-astra','gpt-6-sol']);
  assert.equal(calls,2);
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

test('a rejected role-card lore payload retries once without lore and preserves the rest of the request',async()=>{
  const config={source:'custom',url:'https://example.test/v1',model:'gpt-6-sol',secretId:'stored-id',credentialMode:'saved'};
  const api=new DirectorAPI(()=>({}),()=>config),requests=[];
  api.post=async(_path,body)=>{
    requests.push(body);
    if(requests.length===1){const error=new Error('request rejected');error.status=400;error.upstreamMessage='Bad Request';throw error;}
    return {choices:[{message:{content:'{"scenes":[],"state_updates":[]}'}}]};
  };
  const input={mode:'automatic',CURRENT_TEXT:'A woman enters.',character_card:{name:'Hero',description:'visual traits',lore:[{content:'rejected card lore'}]},active_lore:[{content:'rejected active lore'}],PREVIOUS_CONTEXT:{recent:'recent scene',states:[]}};
  const result=await api.analyze(input);
  assert.equal(requests.length,2);
  const first=JSON.parse(requests[0].messages[1].content),second=JSON.parse(requests[1].messages[1].content);
  assert.equal(first.character_card.lore.length,1);
  assert.deepEqual(second.character_card.lore,[]);
  assert.equal(first.active_lore.length,1);
  assert.deepEqual(second.active_lore,[]);
  assert.equal(second.CURRENT_TEXT,input.CURRENT_TEXT);
  assert.deepEqual(second.PREVIOUS_CONTEXT,input.PREVIOUS_CONTEXT);
  assert.deepEqual(result.scenes,[]);
});
