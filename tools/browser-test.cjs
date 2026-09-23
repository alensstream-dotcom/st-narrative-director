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
 if(process.argv.includes('--redraw')){
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   const record=JSON.parse(fs.readFileSync('artifacts/manual-result.json','utf8')).records[0];
   await page.evaluate(record=>{
     const {controller:c,ui}=globalThis[Symbol.for('st.narrative-director.debug.v1')],raw=c.ctx().chat[0].mes,a=record.scene.anchor;
     void ui.preview({index:0,text:a.quote,start:a.start,end:a.end},{binding:c.bind(0,raw,a.end),scenes:[record.scene]});
   },record);
   await page.getByRole('button',{name:'确认生成',exact:true}).waitFor();
   const text=await page.getByRole('textbox',{name:'英文正面提示词',exact:true}).inputValue();
   if(text!==record.scene.positive)throw new Error('Redraw modified the previously confirmed prompt');
   const overflow=await page.locator('.nd-dialog').evaluate(d=>d.scrollWidth>d.clientWidth+1);
   if(overflow)throw new Error('Preview overflows horizontally');
   await page.screenshot({path:'artifacts/redraw-preview.png',fullPage:true});
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   console.log(JSON.stringify({phase:'redraw-preview',promptPreserved:true,overflow:false,errors}));
 }
 if(process.argv.includes('--real')){
   page.setDefaultTimeout(180000);
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   let imageRequests=0;page.on('request',r=>{if(r.method()==='POST'&&(r.url().includes('/api/sd/comfy/generate')||new URL(r.url()).pathname==='/prompt'))imageRequests++;});
   page.on('response',async r=>{if(r.url().includes('/api/backends/chat-completions/generate')){try{const v=await r.json();console.log(JSON.stringify({directorResponse:String(v.choices?.[0]?.message?.content||'').slice(0,3000)}));}catch{}}});
   await page.evaluate(()=>{const p=document.querySelector('.mes_text p'),r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);});
   await page.getByRole('button',{name:'生成图片',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.nd-dialog .nd-status')?.textContent!=='分析选中剧情…',null,{timeout:110000});
   if(!await page.getByRole('button',{name:'确认生成',exact:true}).count())throw new Error('Preview failed: '+await page.locator('.nd-dialog .nd-status').textContent());
   const preview=await page.getByRole('textbox',{name:'英文正面提示词',exact:true}).inputValue();
   console.log(JSON.stringify({phase:'manual-preview',imageRequests,preview}));
   if(imageRequests!==0)throw new Error('Image requested before confirmation');
   await page.screenshot({path:'artifacts/manual-preview-mobile.png',fullPage:true});
   await page.getByRole('button',{name:'确认生成',exact:true}).click();
   await page.waitForFunction(()=>[...globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.tasks.values()].some(t=>t.terminal),null,{timeout:600000});
   const result=await page.evaluate(()=>{const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;return {phase:'manual-result',tasks:[...c.tasks.values()].map(t=>({state:t.state,detail:t.detail})),records:c.ctx().chat[0].extra?.narrative_director_v1?.images};});
   console.log(JSON.stringify(result));fs.writeFileSync('artifacts/manual-result.json',JSON.stringify(result,null,2));
   if(result.tasks.some(t=>t.state!=='done'))throw new Error('Image task failed');
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
