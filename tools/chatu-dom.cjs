const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    await page.route('**/scripts/extensions/third-party/st-narrative-director/**', route => {
      const prefix = '/scripts/extensions/third-party/st-narrative-director/';
      const relative = new URL(route.request().url()).pathname.split(prefix)[1];
      const root = path.resolve(__dirname, '..'), file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    await page.goto('http://localhost:11451/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis[Symbol.for('st.narrative-director.debug.v1')], null, { timeout: 90000 });
    await page.waitForTimeout(2500);
    const initial = await page.evaluate(async () => {
      const { controller: c, ui } = globalThis[Symbol.for('st.narrative-director.debug.v1')];
      globalThis.__ndOriginalAuto=c.adapter.settings().zidongdianji;
      c.adapter.settings().zidongdianji = 'false';
      const ctx = c.ctx(), text = '艾琳走进车站大厅，朝我微笑。\n\n她举起红色雨伞，站在门口。', index = ctx.chat.length;
      const message = { mes: text, is_user: false, is_system: false, extra: {} };
      ctx.chat.push(message);
      const root = document.createElement('div');root.id='nd-dom-test';root.className='mes';root.setAttribute('mesid',String(index));
      root.innerHTML='<div class="mes_text"><p>艾琳走进车站大厅，朝我微笑。</p><p>她举起红色雨伞，站在门口。</p></div>';
      document.querySelector('#chat').append(root);
      const {locateQuote}=await import('/scripts/extensions/third-party/st-narrative-director/core.mjs');
      for(const [i,quote,prompt] of [[1,'艾琳走进车站大厅，朝我微笑。','front view, one woman smiling in a station hall'],[2,'她举起红色雨伞，站在门口。','front view, one woman holding a red umbrella at the doorway']]){
        const anchor=locateQuote(text,quote),binding=c.bind(index,text,anchor.end);
        c.meta(message).prompts.push({id:`nd-dom-${i}`,binding,anchor,prompt,scene:{moment:`scene ${i}`},state:'issued'});
      }
      ui.refresh();
      return {index,text};
    });
    await page.waitForFunction(() => document.querySelectorAll('#nd-dom-test .image-tag-button').length === 2, null, { timeout: 15000 });
    const first = await page.locator('#nd-dom-test .mes_text').evaluate(root => ({ buttons:root.querySelectorAll('.image-tag-button').length,paragraphs:root.querySelectorAll('p').length,body:root.textContent }));
    assert.equal(first.buttons,2);
    await page.evaluate(() => {
      document.querySelector('#nd-dom-test .mes_text').innerHTML='<p>艾琳走进车站大厅，朝我微笑。</p><p>她举起红色雨伞，站在门口。</p>';
      globalThis[Symbol.for('st.narrative-director.debug.v1')].ui.refresh();
    });
    await page.waitForFunction(() => document.querySelectorAll('#nd-dom-test .image-tag-button').length === 2, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const second=await page.locator('#nd-dom-test .mes_text').evaluate(root => ({ buttons:root.querySelectorAll('.image-tag-button').length,paragraphs:root.querySelectorAll('p').length,body:root.textContent }));
    assert.equal(second.buttons,2);assert.equal(second.paragraphs,2);
    fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/chatu-two-prompts-mobile.png',fullPage:true});
    console.log(JSON.stringify({initial,first,second}));
  } finally {
    for(const context of browser.contexts())for(const page of context.pages()){
      try{await page.evaluate(async()=>{
        const ctx=SillyTavern.getContext();
        const index=ctx.chat.findIndex(m=>m.mes==='艾琳走进车站大厅，朝我微笑。\n\n她举起红色雨伞，站在门口。'&&m.extra?.narrative_director_v1?.prompts?.some(p=>p.id==='nd-dom-1'));
        if(index>=0){ctx.chat.splice(index,1);await ctx.saveChat();}
        document.querySelector('#nd-dom-test')?.remove();
        if(globalThis.__ndOriginalAuto!==undefined){
          ctx.extensionSettings['st-chatu8'].zidongdianji=globalThis.__ndOriginalAuto;
          ctx.saveSettingsDebounced();
        }
      });}catch{}
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
