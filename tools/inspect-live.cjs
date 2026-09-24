const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.DIRECTOR_ST_URL || 'http://localhost:11451/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis[Symbol.for('st.narrative-director.debug.v1')], null, { timeout: 90000 });
    const result = await page.evaluate(async () => {
      const { controller } = globalThis[Symbol.for('st.narrative-director.debug.v1')];
      const c = controller.config();
      const s = controller.adapter.settings();
      const user = await fetch('/api/users/me').then(r => r.json()).catch(() => ({}));
      const users = await fetch('/api/users/get', { method: 'POST', headers: controller.ctx().getRequestHeaders(), body: '{}' }).then(r => r.ok ? r.json() : []).catch(() => []);
      let graph = {};
      try { graph = JSON.parse(s.worker || '{}'); } catch {}
      const loaders = Object.values(graph).filter(n => /Loader/.test(n.class_type || '')).map(n => ({ type: n.class_type, inputs: n.inputs }));
      const keyList = await controller.api.secrets().catch(() => ({}));
      return {
        user: { handle: user.handle, name: user.name },
        availableUsers: Array.isArray(users) ? users.map(x => ({ handle: x.handle, name: x.name })) : [],
        director: { enabled: c.enabled, source: c.source, model: c.model, streamModel: c.streamModel, credentialMode: c.credentialMode, secretId: c.secretId, autoBackend: c.autoBackend, comfyWorkflow: c.comfyWorkflow },
        savedKeyLabels: Object.fromEntries(Object.entries(keyList).filter(([k, v]) => k.startsWith('api_key_') && Array.isArray(v)).map(([k, v]) => [k, v.map(x => ({ id: x.id, label: x.label, active: x.active }))])),
        chatu: { mode: s.mode, client: s.client, workerid: s.workerid, workerNames: Object.keys(s.workers || {}), loaders, MODEL_NAME: s.MODEL_NAME,
          comfyuiUrl: s.comfyuiUrl, steps: s.comfyui_steps, cfg: s.cfg_comfyui, sampler: s.comfyuisamplerName, scheduler: s.comfyui_scheduler,
          width: s.comfyui_width, height: s.comfyui_height, startTag: s.startTag, endTag: s.endTag, autoClick: s.zidongdianji,
          permanentAutoClick: s.zidongdianji2, autoLLM: s.autoLLMImageGen, pregen: s.enablePregen, prefixPreset: s.yusheid_comfyui }
      };
    });
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
