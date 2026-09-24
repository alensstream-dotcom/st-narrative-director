const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const story='艾琳经过车站大厅。\n\n她在门口撑起一把红伞，抬头朝我微笑。';
(async () => {
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:430,height:900},hasTouch:true});
    await page.route('**/scripts/extensions/third-party/st-narrative-director/**',route=>{
      const prefix='/scripts/extensions/third-party/st-narrative-director/';
      const relative=new URL(route.request().url()).pathname.split(prefix)[1];
      const root=path.resolve(__dirname,'..'),file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':'text/javascript'});
    });
    await page.goto('http://localhost:11451/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')],null,{timeout:90000});
    await page.waitForTimeout(3000);
    await page.evaluate(async story=>{
      const {controller:c}=globalThis[Symbol.for('st.narrative-director.debug.v1')],ctx=c.ctx();
      c.adapter.settings().zidongdianji='false';
      const index=ctx.chat.length;
      ctx.chat.push({mes:story,is_user:false,is_system:false,extra:{}});
      const root=document.createElement('div');root.id='nd-manual-test';root.className='mes';root.setAttribute('mesid',String(index));
      root.innerHTML='<div class="mes_text"><p>艾琳经过车站大厅。</p><p>她在门口撑起一把红伞，抬头朝我微笑。</p></div>';
      document.querySelector('#chat').append(root);
      const {locateQuote}=await import('/scripts/extensions/third-party/st-narrative-director/core.mjs');
      c.analyze=async(i,raw,start,end)=>({binding:c.bind(i,raw,end),scenes:[{
        anchor:locateQuote(raw,'她在门口撑起一把红伞，抬头朝我微笑。',start,end),
        cast:[],moment:'她在车站门口撑伞微笑',positive:'One woman smiles under a red umbrella at the station entrance.',negative:'text'
      }]});
      const node=root.querySelectorAll('p')[1].firstChild,range=document.createRange();
      range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    },story);
    await page.locator('.nd-selection button').click();
    const preview=await page.locator('.nd-dialog').evaluate(d=>({quote:d.querySelector('blockquote')?.textContent,
      prompt:d.querySelector('textarea')?.value,overflow:d.scrollWidth>d.clientWidth+1}));
    assert.match(preview.quote,/红伞/);assert.match(preview.prompt,/red umbrella/);assert.equal(preview.overflow,false);
    await page.getByRole('button',{name:'交给智绘姬生成'}).click();
    await page.locator('#nd-manual-test .image-tag-button').waitFor({timeout:15000});
    const result=await page.evaluate(story=>{
      const ctx=SillyTavern.getContext(),message=ctx.chat.find(m=>m.mes===story);
      const buttons=[...document.querySelectorAll('#nd-manual-test .image-tag-button')];
      return {storyUnchanged:message?.mes===story,prompts:message?.extra?.narrative_director_v1?.prompts?.length||0,
        buttons:buttons.length,link:buttons[0]?.dataset.link,position:buttons[0]?.closest('.nd-chatu-prompt')?.previousElementSibling?.textContent};
    },story);
    assert.equal(result.storyUnchanged,true);assert.equal(result.prompts,1);assert.equal(result.buttons,1);
    assert.match(result.position,/红伞/);
    fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/chatu-manual-mobile.png',fullPage:true});
    console.log(JSON.stringify({preview,result}));
  }finally{
    for(const context of browser.contexts())for(const page of context.pages()){
      try{await page.evaluate(async story=>{
        const ctx=SillyTavern.getContext();
        const index=ctx.chat.findIndex(m=>m.mes===story&&m.extra?.narrative_director_v1?.prompts?.some(p=>p.origin==='manual'));
        if(index>=0){ctx.chat.splice(index,1);await ctx.saveChat();}
        document.querySelector('#nd-manual-test')?.remove();
      },story);}catch{}
    }
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
