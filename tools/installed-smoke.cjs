const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  if((process.argv.includes('--profile-roundtrip')||process.argv.includes('--render'))&&process.env.DIRECTOR_TEST_ISOLATED!=='1'){
    throw new Error('Write/render acceptance checks require DIRECTOR_TEST_ISOLATED=1 and an isolated SillyTavern instance');
  }
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const viewportWidth=Number(process.env.DIRECTOR_VIEWPORT_WIDTH||430);
    const page=await browser.newPage({viewport:{width:viewportWidth,height:900}});
    const errors=[];let pageErrorCount=0;page.on('pageerror',e=>{pageErrorCount++;if(e.stack?.includes('st-narrative-director'))errors.push(e.message);});
    page.on('request',r=>{if(r.url().endsWith('/api/settings/save'))console.log('SETTINGS_REQUEST',r.method());});
    page.on('response',r=>{if(r.url().endsWith('/api/settings/save'))console.log('SETTINGS_RESPONSE',r.status());});
    page.on('console',m=>{if(/Settings not ready/i.test(m.text()))console.log('SETTINGS_NOT_READY');else if(/Error saving settings/i.test(m.text()))console.log('SETTINGS_SAVE_ERROR');});
    const base=process.env.DIRECTOR_ST_URL||'http://localhost:11451';
    const localAssets=[];
    await page.route('**/scripts/extensions/third-party/st-narrative-director/**',route=>{
      const prefix='/scripts/extensions/third-party/st-narrative-director/';
      const relative=new URL(route.request().url()).pathname.split(prefix)[1];
      const root=path.resolve(__dirname,'..'),file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
      localAssets.push(relative);
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':'text/javascript'});
    });
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')],null,{timeout:90000});
    const readiness=await page.evaluate(async()=>{
      const module=await import('/script.js');
      const started=Date.now();
      while(!module.settingsReady&&Date.now()-started<60000)await new Promise(resolve=>setTimeout(resolve,100));
      return {ready:module.settingsReady};
    });
    console.log(JSON.stringify({readiness,pageErrorCount}));
    if(process.argv.includes('--profile-roundtrip')&&!readiness.ready){
      await page.screenshot({path:'artifacts/installed-not-ready.png'});
      throw new Error('SillyTavern settings are not ready; cannot verify persistence');
    }
    await page.evaluate(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')].ui.settings());
    await page.getByRole('button',{name:'使用正文连接的独立副本',exact:true}).waitFor();
    if(process.argv.includes('--configure-krill')){
      const secretId=process.env.DIRECTOR_SECRET_ID;
      if(!secretId)throw new Error('DIRECTOR_SECRET_ID is required; never put the API key in this script');
      await page.getByRole('combobox',{name:'服务'}).selectOption('custom');
      const url=page.getByRole('textbox',{name:'API 地址（兼容接口）'});
      await url.fill('https://api-slb.krill-code.net/v1');await url.press('Tab');
      const secrets=page.getByRole('combobox',{name:'已保存密钥'});
      await secrets.locator(`option[value="${secretId}"]`).waitFor({state:'attached',timeout:30000});
      await secrets.selectOption(secretId);
      await page.getByRole('textbox',{name:'模型 ID'}).fill('gpt-6-sol');
      await page.getByRole('button',{name:'测试导演连接'}).click();
      await page.getByText('连接成功 · 模型已实际响应',{exact:true}).waitFor({timeout:90000});
      await page.waitForTimeout(1500);
    }
    if(process.argv.includes('--configure')){
      const saved=page.waitForResponse(r=>{
        if(!r.url().endsWith('/api/settings/save')||r.request().method()!=='POST')return false;
        const config=r.request().postDataJSON()?.extension_settings?.narrative_director_v1;
        return !!config?.model&&!!config?.secretId;
      },{timeout:90000});
      await page.getByRole('button',{name:'使用正文连接的独立副本',exact:true}).click();
      await page.waitForFunction(()=>!!globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.config().secretId);
      assert.ok((await saved).ok(),'Settings save failed');
    }
    const result=await page.evaluate(()=>{
      const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller,config=c.config(),d=document.querySelector('.nd-dialog');
      let chatuAvailable=false;try{chatuAvailable=!!c.adapter.settings();}catch{}
      return {loaded:true,source:config.source,model:config.model,secretConfigured:!!config.secretId,autoEnabled:config.enabled,chatuAvailable,snapshot:c.adapter.snapshot('comfyui'),horizontalOverflow:d.scrollWidth>d.clientWidth+1};
    });
    assert.equal(result.horizontalOverflow,false);assert.equal(errors.length,0);
    if(process.argv.includes('--require-chatu'))assert.ok(result.chatuAvailable,'Original Chatu integration is not available');
    if(process.argv.includes('--profile-roundtrip')){
      const owner=`acceptance_${Date.now()}`;
      const saved=page.waitForResponse(r=>r.url().endsWith('/api/settings/save')&&r.request().method()==='POST',{timeout:90000});
      const created=await page.evaluate(owner=>{
        const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller,s=c.adapter.settings();
        const enabledBefore=JSON.stringify([s.characterEnablePresets,s.characterCommonPresets]);
        const profile=c.adapter.upsertProfile(owner,'验收测试艾琳','silver hair, green eyes',undefined,'acceptance');
        const outfit=c.adapter.upsertOutfit(owner,profile,'验收测试艾琳','black coat','acceptance','coat','generic');
        return {profile,outfit,enabledBefore};
      },owner);
      console.log(JSON.stringify({createdProfile:created.profile,createdOutfit:created.outfit}));
      assert.ok((await saved).ok(),'Chatu profile save failed');
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')],null,{timeout:90000});
      const persisted=await page.evaluate(({profile,outfit,enabledBefore})=>{
        const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller,s=c.adapter.settings();
        return {profilePresent:!!s.characterPresets?.[profile],outfitPresent:!!s.outfitPresets?.[outfit],
          linked:s.characterPresets?.[profile]?.outfits?.includes(outfit),globalEnabledUnchanged:enabledBefore===JSON.stringify([s.characterEnablePresets,s.characterCommonPresets])};
      },created);
      assert.deepEqual(persisted,{profilePresent:true,outfitPresent:true,linked:true,globalEnabledUnchanged:true});
      console.log(JSON.stringify({profileRoundtrip:persisted}));
    }
    if(process.argv.includes('--render')){
      const generated=await page.evaluate(async()=>{
        const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller,start=Date.now();
        await c.adapter.inspectComfy();
        const snapshot=c.adapter.snapshot('comfyui');
        const image=await c.adapter.generate(snapshot,{id:`acceptance_image_${Date.now()}`,
          positive:'masterpiece, best quality, anime illustration, one adult woman with silver hair and green eyes, black coat, standing in a station hall, complete face visible, front view, medium shot',
          negative:'text, watermark, speech bubble, cropped face, back view'});
        return {path:image.image,model:image.params.model,workflow:image.params.workflow,ms:Date.now()-start};
      });
      const image=await page.request.get(new URL(generated.path,base).toString());
      assert.ok(image.ok()&&image.headers()['content-type']?.startsWith('image/'),'Generated image was not saved to the SillyTavern server');
      console.log(JSON.stringify({render:generated,savedImage:true}));
    }
    await page.screenshot({path:'artifacts/installed-settings.png'});
    const visual=await page.evaluate(()=>({dialogBackground:getComputedStyle(document.querySelector('.nd-dialog')).backgroundColor,stylesheets:[...document.styleSheets].map(x=>x.href).filter(x=>x?.includes('narrative-director'))}));
    const panels={api:{overflow:result.horizontalOverflow}};
    for(const [name,label] of [['render','生图'],['characters','人物'],['tasks','任务']]){
      await page.getByRole('tab',{name:label,exact:true}).click({force:true});
      const metrics=await page.locator('.nd-dialog').evaluate(d=>({overflow:d.scrollWidth>d.clientWidth+1,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth}));
      panels[name]=metrics;
      await page.screenshot({path:`artifacts/installed-${name}-${viewportWidth}.png`});
    }
    console.log(JSON.stringify({installed:result,pluginErrors:errors,visual,localAssets,viewportWidth,panels}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
