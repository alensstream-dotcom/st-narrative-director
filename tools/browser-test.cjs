const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:process.argv.includes('--desktop')?1280:430,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const cdp=await browser.newBrowserCDPSession();
 const {browserContextIds}=await cdp.send('Target.getBrowserContexts');
 if(!process.argv.includes('--proxy'))for(const name of ['local-network-access','loopback-network','local-network'])await cdp.send('Browser.setPermission',{permission:{name},setting:'granted',origin:'http://localhost:11451',browserContextId:browserContextIds[0]});
 page.on('console',m=>{if(m.type()==='error')console.log('BROWSER_ERROR '+m.text().slice(0,500));});
 await page.route('**/scripts/extensions/third-party/st-narrative-director/**',route=>{
   const prefix='/scripts/extensions/third-party/st-narrative-director/';
   const relative=new URL(route.request().url()).pathname.split(prefix)[1];
   const root=path.resolve(__dirname,'..'),file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('http://localhost:11451/scripts/extensions/third-party/st-narrative-director/tests/harness.html');
 await page.waitForFunction(()=>window.testHarness?.ready,null,{timeout:60000});
 const inspect=await page.evaluate(()=>{const d=globalThis[Symbol.for('st.narrative-director.debug.v1')],c=d.controller;return {source:c.config().source,model:c.config().model,secretPresent:!!c.config().secretId,caps:c.adapter.capabilities(),snapshot:c.adapter.snapshot('comfyui')};});
 console.log(JSON.stringify({inspect,errors}));
 console.log(JSON.stringify(await page.evaluate(async()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;const url=c.adapter.settings().comfyuiUrl;try{const r=await fetch(url+'/system_stats');return {configuredUrl:url,status:r.status,info:!!await c.adapter.inspectComfy()};}catch(e){return {configuredUrl:url,error:e.message};}})));
 console.log(JSON.stringify(await page.evaluate(async()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;const info=await c.adapter.inspectComfy();return {inspected:!!info,viaProxy:!!info?._viaProxy,resolvedModel:c.adapter.snapshot('comfyui').model};})));
 await page.getByRole('button',{name:'叙景 · 剧情导演',exact:true}).click();
 await page.getByText('独立导演 API',{exact:true}).waitFor();
 fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/settings-mobile.png',fullPage:true});
 console.log('SCREENSHOT artifacts/settings-mobile.png');
 console.log(JSON.stringify({afterClickErrors:errors}));
 if(process.argv.includes('--settings')){
   const mode=page.getByRole('combobox',{name:'密钥来源'}),key=page.getByRole('textbox',{name:'本页独立密钥'});
   await key.fill('intentionally-wrong');
   const first=await page.evaluate(()=>{const a=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.api;return {session:!!a.temporaryKey,usesCustom:a.connection().chat_completion_source==='custom'};});
   if(await mode.inputValue()!=='session')throw new Error('Typing a new key did not switch to independent session mode');
   await page.getByRole('button',{name:'测试导演连接'}).click();
   await page.getByText(/密钥或访问权限验证失败|导演服务请求失败/).waitFor({timeout:60000});
   if(!await key.isEnabled())throw new Error('Key cannot be edited after a failed connection test');
   await key.fill('replacement-key');
   const revised=await page.evaluate(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.api.temporaryKey==='replacement-key');
   await page.getByRole('button',{name:'清除本页密钥'}).click();
   const missing=await page.evaluate(()=>{try{globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.api.connection();return false;}catch{return true;}});
   await mode.selectOption('saved');
   const cleared=await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;return !c.api.temporaryKey&&!!c.api.connection().secret_id;});
   if(!first.session||!first.usesCustom||!revised||!missing||!cleared)throw new Error('Credential switching is not recoverable');
   await page.getByRole('button',{name:'测试导演连接'}).click();
   await page.getByText('连接成功 · 模型已实际响应',{exact:true}).waitFor({timeout:60000});
   await page.getByRole('button',{name:'刷新可用模型'}).click();
   await page.getByText(/读取到 \d+ 个模型/).waitFor({timeout:60000});
   const models=await page.getByRole('combobox',{name:'可用模型'}).locator('option').count();
   await page.getByRole('tab',{name:'人物'}).click();
   await page.getByText(/智绘姬 \d+ 份档案/).waitFor();
   await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller,id='ui-outfit-test',profile=c.adapter.upsertProfile(id,'测试人物','');c.scope().characters[id]={id,name:'测试人物',aliases:[],profile,lock:null};c.adapter.upsertOutfit(id,profile,'测试人物','black coat',c.chatKey());});
   await page.getByRole('button',{name:'重新读取人物资料'}).click();
   await page.getByText('智绘姬服装预设 1').waitFor();
   if(!await page.getByRole('link',{name:'ANIMADEX Tag'}).count())throw new Error('AnimaDex lookup link missing');
   if(await page.locator('.nd-dialog').evaluate(d=>d.scrollWidth>d.clientWidth+1))throw new Error('Character manager overflows horizontally');
   await page.screenshot({path:'artifacts/characters-mobile.png',fullPage:true});
   console.log(JSON.stringify({phase:'settings',replaced:true,cleared:true,connectionTested:true,models,profilesVisible:true,errors}));
 }
 if(process.argv.includes('--redraw')){
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   const record=JSON.parse(fs.readFileSync('artifacts/manual-result.json','utf8')).records[0];
   await page.evaluate(record=>{
     const {controller:c,ui}=globalThis[Symbol.for('st.narrative-director.debug.v1')],a=record.scene.anchor;
     let raw=c.ctx().chat[0].mes;
     if(raw.slice(a.start,a.end)!==a.quote){
       window.testHarness.setText(a.quote);
       raw=c.ctx().chat[0].mes;
       a.start=0;
       a.end=a.quote.length;
     }
     void ui.preview({index:0,text:a.quote,start:a.start,end:a.end},{binding:c.bind(0,raw,a.end),scenes:[record.scene]});
   },record);
   await page.getByRole('button',{name:'确认生成',exact:true}).waitFor();
   const text=await page.getByRole('textbox',{name:'英文正面提示词',exact:true}).inputValue();
   if(text!==record.scene.positive)throw new Error('Redraw modified the previously confirmed prompt');
   const promptBox=page.getByRole('textbox',{name:'英文正面提示词',exact:true});
   await promptBox.fill(text+', inspected composition');
   const workflow=page.getByRole('combobox',{name:'本张工作流'});
   await workflow.selectOption('chatu');
   await page.getByRole('button',{name:'确认生成',exact:true}).waitFor({state:'visible'});
   await workflow.selectOption('miaomiao-harem-paired-v1');
   await page.waitForFunction(()=>!document.querySelector('.nd-dialog [title="确认生成"]')?.disabled);
   if(await promptBox.inputValue()!==text+', inspected composition')throw new Error('Workflow switch discarded the edited prompt');
   await promptBox.fill(text);
   const overflow=await page.locator('.nd-dialog').evaluate(d=>d.scrollWidth>d.clientWidth+1);
   if(overflow)throw new Error('Preview overflows horizontally');
   await page.screenshot({path:'artifacts/redraw-preview.png',fullPage:true});
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   console.log(JSON.stringify({phase:'redraw-preview',promptPreserved:true,editedDraftPreserved:true,overflow:false,errors}));
 }
 if(process.argv.includes('--prototype')){
   page.setDefaultTimeout(180000);
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   await page.evaluate(()=>{
     const h=window.testHarness,card=h.context.characters[0];
     card.name='薇儿';card.description='薇儿是二十五岁的女性，金色长发，蓝色眼睛。';card.data.name=card.name;card.data.description=card.description;
     h.setText('薇儿站在雨中的车站门口。她留着金色长发，蓝色眼睛映着灯光。她穿着黑色长袖外套和长裤，撑开一把红色雨伞，回头朝我微笑。');
     const p=document.querySelector('.mes_text p'),range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);
   });
   await page.getByRole('button',{name:'生成图片',exact:true}).click();
   await page.getByRole('button',{name:'确认生成',exact:true}).waitFor({timeout:110000});
   const preview=await page.getByRole('textbox',{name:'英文正面提示词',exact:true}).inputValue();
   if(!preview.includes('violet evergarden'))throw new Error('Matched prototype did not reach task prompt: '+preview);
   console.log(JSON.stringify({phase:'prototype-preview',preview,errors}));
   await page.getByRole('button',{name:'确认生成',exact:true}).click();
   await page.waitForFunction(()=>[...globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.tasks.values()].every(t=>t.terminal),null,{timeout:600000});
   const result=await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;return {tasks:[...c.tasks.values()].map(t=>({state:t.state,nativeId:t.nativeId})),characters:Object.values(c.scope().characters).map(x=>({name:x.name,prototypeId:x.prototypeId,visualFacts:x.visualFacts})),images:c.ctx().chat[0].extra?.narrative_director_v1?.images?.map(x=>({id:x.id,prototypeTag:x.scene.prototypeTag}))};});
   if(result.tasks.some(t=>t.state!=='done'))throw new Error('Prototype image task failed');
   await page.locator('.nd-image img').waitFor();await page.locator('.nd-image img').evaluate(img=>img.decode());
   await page.screenshot({path:'artifacts/prototype-mobile.png',fullPage:true});
   console.log(JSON.stringify({phase:'prototype-result',...result,errors}));
 }
 if(process.argv.includes('--real')){
   page.setDefaultTimeout(180000);
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   if(process.argv.includes('--multi'))await page.evaluate(()=>window.testHarness.setText('艾琳穿着白裙站在车站大厅，银发和绿色眼睛被窗边阳光照亮。她拿起银色相机，对着窗外站台拍了一张照片。\n\n半小时后，她换上黑色长袖外套和长裤，从更衣室走出。她撑开一把红色雨伞，站在雨中的车站门口，回头朝我微笑。'));
   let imageRequests=0;page.on('request',r=>{if(r.method()==='POST'&&(r.url().includes('/api/sd/comfy/generate')||new URL(r.url()).pathname==='/prompt'))imageRequests++;});
   page.on('response',async r=>{if(r.url().includes('/api/backends/chat-completions/generate')){try{const v=await r.json();console.log(JSON.stringify({directorResponse:String(v.choices?.[0]?.message?.content||'').slice(0,3000)}));}catch{}}});
   await page.evaluate(multi=>{const paragraphs=document.querySelectorAll('.mes_text p'),r=document.createRange();r.selectNodeContents(paragraphs[0]);if(multi)r.setEnd(paragraphs[1].firstChild,paragraphs[1].firstChild.length);getSelection().removeAllRanges();getSelection().addRange(r);},process.argv.includes('--multi'));
   await page.getByRole('button',{name:'生成图片',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.nd-dialog .nd-status')?.textContent!=='分析选中剧情…',null,{timeout:110000});
   if(!await page.getByRole('button',{name:'确认生成',exact:true}).count())throw new Error('Preview failed: '+await page.locator('.nd-dialog .nd-status').textContent());
   if(process.argv.includes('--multi')){
     const choices=await page.getByRole('combobox',{name:'选择要画的瞬间'}).locator('option').count();
     if(choices<2)throw new Error('Multiple selected events did not offer a moment choice');
     await page.getByRole('combobox',{name:'选择要画的瞬间'}).selectOption('1');
     console.log(JSON.stringify({phase:'multi-paragraph',choices,selectedMoment:1}));
   }
   const preview=await page.getByRole('textbox',{name:'英文正面提示词',exact:true}).inputValue();
   const outfitBefore=await page.evaluate(()=>Object.values(globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.adapter.settings().outfitPresets||{}).filter(o=>o.directorOwner).length);
   console.log(JSON.stringify({phase:'manual-preview',imageRequests,preview}));
   if(imageRequests!==0)throw new Error('Image requested before confirmation');
   if(outfitBefore!==0)throw new Error('Preview wrote an outfit before user confirmation');
   await page.screenshot({path:'artifacts/manual-preview-mobile.png',fullPage:true});
   await page.getByRole('button',{name:'确认生成',exact:true}).click();
   await page.waitForFunction(()=>[...globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.tasks.values()].some(t=>t.terminal),null,{timeout:600000});
   const result=await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;return {phase:'manual-result',tasks:[...c.tasks.values()].map(t=>({state:t.state,detail:t.detail})),records:c.ctx().chat[0].extra?.narrative_director_v1?.images};});
   console.log(JSON.stringify(result));fs.writeFileSync('artifacts/manual-result.json',JSON.stringify(result,null,2));
   if(result.tasks.some(t=>t.state!=='done'))throw new Error('Image task failed');
   const outfitAfter=await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller,s=c.adapter.settings(),cast=c.ctx().chat[0].extra?.narrative_director_v1?.images?.[0]?.scene.cast?.[0];return {ref:cast?.outfit_ref,preset:s.outfitPresets?.[cast?.outfit_ref],linked:s.characterPresets?.[cast?.profile_ref]?.outfits?.includes(cast?.outfit_ref)};});
   if(!outfitAfter.ref||!outfitAfter.preset||!outfitAfter.linked)throw new Error('Confirmed image did not link its evidenced outfit to the original manager');
   console.log(JSON.stringify({phase:'outfit-sync',ref:outfitAfter.ref,description:outfitAfter.preset.fullBody,linked:outfitAfter.linked}));
   await page.locator('.nd-image img').waitFor();await page.locator('.nd-image img').evaluate(img=>img.decode());
   await page.screenshot({path:'artifacts/manual-result-mobile.png',fullPage:true});
   const preserved=await page.locator('.test-options button').count();if(preserved!==4)throw new Error('Story options changed');
   await page.locator('.test-options button').first().click();
   console.log(JSON.stringify({phase:'manual-verified',imageRequests,optionsPreserved:preserved,errors}));
   await page.getByRole('button',{name:'锁定形象',exact:true}).click();
   await page.getByRole('button',{name:'锁定固定外貌',exact:true}).click();
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   const autoText='半小时后，艾琳从车站的更衣室走出来，已经换上黑色长袖外套和黑色长裤，白裙收进旅行箱。她走到大厅窗前，举起银色相机，镜头朝向窗外的站台；脸微微转向左侧，绿色眼睛专注地观察取景。她保持这个姿势，右手食指轻放在快门上，银色及肩短发被窗边微风拂起。';
   await page.evaluate(text=>{
     const {controller:c}=globalThis[Symbol.for('st.narrative-director.debug.v1')],h=window.testHarness;
     c.config().enabled=true;c.startRound('normal',{},false);h.context.chat.push({mes:text,swipe_id:0,is_user:false,name:'艾琳',extra:{}});h.render();c.onToken(text);
   },autoText);
   await page.waitForFunction(()=>[...globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.tasks.values()].some(t=>t.origin==='automatic'),null,{timeout:110000});
   const early=await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;return {submittedBeforeEnd:!c.round.final,tasks:[...c.tasks.values()].filter(t=>t.origin==='automatic').map(t=>({prompt:t.scene.positive,state:t.state}))};});
   console.log(JSON.stringify({phase:'automatic-early',...early}));
   await page.evaluate(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.endRound());
   await page.waitForFunction(()=>[...globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.tasks.values()].filter(t=>t.origin==='automatic').every(t=>t.terminal),null,{timeout:600000});
   await page.locator('.mes[mesid="1"] .nd-image img').waitFor();await page.locator('.mes[mesid="1"] .nd-image img').evaluate(img=>img.decode());
   await page.screenshot({path:'artifacts/auto-locked-mobile.png',fullPage:true});
   const autoResult=await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;return {tasks:[...c.tasks.values()].map(t=>({state:t.state,origin:t.origin,detail:t.detail,nativeId:t.nativeId})),characters:Object.values(c.scope().characters),images:c.ctx().chat[1].extra?.narrative_director_v1?.images};});
   fs.writeFileSync('artifacts/auto-result.json',JSON.stringify(autoResult,null,2));console.log(JSON.stringify({phase:'automatic-result',...autoResult}));
   await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;c.ctx().chat[1].swipe_id=1;c.invalidate();});
   await page.waitForFunction(()=>!document.querySelector('.mes[mesid="1"] .nd-image'));
   console.log(JSON.stringify({phase:'swipe-isolation',passed:true,errors,imageRequests}));
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
