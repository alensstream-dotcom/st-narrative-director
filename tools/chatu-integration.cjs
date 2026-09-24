const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => {
      if(message.type()==='error' || /Image response|图像生成失败|生图失败|请求失败/i.test(message.text()))
        console.log('BROWSER', message.text().slice(0, 600));
    });
    await page.route('**/scripts/extensions/third-party/st-narrative-director/**', route => {
      const prefix = '/scripts/extensions/third-party/st-narrative-director/';
      const relative = new URL(route.request().url()).pathname.split(prefix)[1];
      const root = path.resolve(__dirname, '..'), file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    await page.goto(process.env.DIRECTOR_ST_URL || 'http://localhost:11451/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis[Symbol.for('st.narrative-director.debug.v1')], null, { timeout: 90000 });
    await page.waitForFunction(() => SillyTavern.getContext().extensionSettings['st-chatu8']?.worker, null, { timeout: 90000 });
    const old = await page.evaluate(() => structuredClone(SillyTavern.getContext().extensionSettings['st-chatu8']));
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/chatu-before-integration.json', JSON.stringify(old, null, 2));
    const setup=await page.evaluate(() => globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.adapter.configureChatu());
    await page.waitForTimeout(2500);
    const result = await page.evaluate(async () => {
      const { controller: c, ui } = globalThis[Symbol.for('st.narrative-director.debug.v1')];
      const ctx = c.ctx();
      globalThis.__ndResponses=[];
      ctx.eventSource.on('generate-image-response',response=>globalThis.__ndResponses.push({id:response.id,success:response.success,error:response.error,hasImage:!!response.imageData}));
      const text = '艾琳站在车站大厅里，正面望向来人。她银色长发垂在肩头，穿着深色外套。';
      const index = ctx.chat.length;
      const message = { mes: text, is_user: false, is_system: false, extra: {} };
      ctx.chat.push(message);
      const root = document.createElement('div');
      root.id='nd-integration-message';root.className = 'mes'; root.setAttribute('mesid', String(index));
      root.innerHTML = '<div class="mes_text"><p></p></div>';
      root.querySelector('p').textContent = text;
      document.querySelector('#chat').append(root);
      const anchor = { start: 0, end: text.length, quote: text, fingerprint: (() => {
        let a = 2166136261; for (const char of text) a = Math.imul(a ^ char.charCodeAt(0), 16777619);
        return (a >>> 0).toString(36);
      })() };
      const prompt = 'masterpiece, best quality, anime illustration, 1girl, adult woman, long silver hair, dark coat, standing in a station hall, front view, both eyes visible, unobstructed face, medium shot';
      const binding = c.bind(index, text, text.length);
      c.meta(message).prompts.push({ id: 'nd-integration-test', binding, anchor, prompt, scene: { moment: 'test' }, state: 'issued', created:Date.now() });
      ui.pendingActivation.add('nd-integration-test');
      ui.refresh();
      return { prompt, index, existingMessages:document.querySelectorAll('#chat .mes').length };
    });
    await page.locator('#nd-integration-message .image-tag-button').waitFor({ timeout: 15000 });
    const button = await page.locator('#nd-integration-message .image-tag-button').evaluate(e => ({ link: e.dataset.link, text: e.textContent, loading: e.hasAttribute('data-loading') }));
    console.log(JSON.stringify({ setup, result, button, errors }));
    assert.equal(button.link, result.prompt);
    await page.screenshot({ path: 'artifacts/chatu-marker-mobile.png', fullPage: true });
    if (process.argv.includes('--wait-image')) {
      await page.waitForFunction(() => globalThis.__ndResponses?.length || document.querySelector('#nd-integration-message .st-chatu8-image-span img'), null, { timeout: 180000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const final = await page.evaluate(() => ({ responses:globalThis.__ndResponses,
        promptState:SillyTavern.getContext().chat[0]?.extra?.narrative_director_v1?.prompts?.[0]?.state,
        fakeConnected:!!document.querySelector('#nd-integration-message'),
        images:[...document.querySelectorAll('#nd-integration-message .st-chatu8-image-span img')].map(e=>({src:e.src.slice(0,120),width:e.naturalWidth,height:e.naturalHeight})),
        button:document.querySelector('#nd-integration-message .image-tag-button')?.outerHTML.slice(0,500),
        marker:document.querySelector('#nd-integration-message .nd-chatu-prompt')?.innerHTML.slice(0,800) }));
      console.log(JSON.stringify({final,errors}));
      assert.ok(final.images.some(x=>x.width>0&&x.height>0),'Chatu did not render a generated image below the story');
    }
  } finally {
    for(const context of browser.contexts())for(const page of context.pages()){
      try{await page.evaluate(async()=>{
        const ctx=SillyTavern.getContext();
        const index=ctx.chat.findIndex(m=>m.mes==='艾琳站在车站大厅里，正面望向来人。她银色长发垂在肩头，穿着深色外套。'&&m.extra?.narrative_director_v1?.prompts?.some(p=>p.id==='nd-integration-test'));
        if(index>=0){ctx.chat.splice(index,1);await ctx.saveChat();}
        document.querySelector('#nd-integration-message')?.remove();
      });}catch{}
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
