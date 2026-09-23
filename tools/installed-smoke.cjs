const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:430,height:900}});
    const errors=[];page.on('pageerror',e=>{if(e.stack?.includes('st-narrative-director'))errors.push(e.message);});
    await page.goto('http://localhost:11451/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')],null,{timeout:90000});
    await page.evaluate(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')].ui.settings());
    await page.getByRole('button',{name:'读取当前连接',exact:true}).waitFor();
    if(process.argv.includes('--configure')){
      await page.getByRole('button',{name:'读取当前连接',exact:true}).click();
      await page.waitForFunction(()=>!!globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.config().secretId);
      await page.waitForTimeout(2500);
    }
    const result=await page.evaluate(()=>{
      const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller,config=c.config(),d=document.querySelector('.nd-dialog');
      return {loaded:true,source:config.source,model:config.model,secretConfigured:!!config.secretId,autoEnabled:config.enabled,snapshot:c.adapter.snapshot('comfyui'),horizontalOverflow:d.scrollWidth>d.clientWidth+1};
    });
    assert.equal(result.horizontalOverflow,false);assert.equal(errors.length,0);
    await page.screenshot({path:'artifacts/installed-settings.png'});
    console.log(JSON.stringify({installed:result,pluginErrors:errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
