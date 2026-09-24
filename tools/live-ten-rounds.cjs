const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.DIRECTOR_ST_URL || 'http://localhost:11451';
const useNewChat = process.argv.includes('--new-chat');
const useMinimalRoleplayReasoning = process.argv.includes('--minimal-roleplay-reasoning');
const temporaryDirectorModel = process.argv.find(arg => arg.startsWith('--temporary-director-model='))?.slice('--temporary-director-model='.length) || '';
const temporaryDirectorReasoning = process.argv.find(arg => arg.startsWith('--temporary-director-reasoning='))?.slice('--temporary-director-reasoning='.length) || '';
const compactDirectorTest = process.argv.includes('--compact-director-test');
const requestedRounds = Number(process.env.LIVE_ROUNDS || process.argv.find(arg => arg.startsWith('--rounds='))?.split('=')[1]) || 10;
const runCount = Math.min(10, Math.max(1, requestedRounds));
const installedOnly = process.argv.includes('--installed');
const scenarioOffset = Number(process.env.LIVE_OFFSET || process.argv.find(arg => arg.startsWith('--offset='))?.split('=')[1]) || 0;
const scenarios = [
  '我慢慢放下戒备，告诉撒旦自己来自人间，请她带我离开地狱之门。',
  '我跟着撒旦穿过大厅，抬头看向墙上空着的王座，问她为何一直无人继承。',
  '走廊尽头突然传来急促的脚步声，我停下脚步，和撒旦一起望向门口。',
  '别西卜抱着一大堆点心跑来，我侧身让开，问她准备带我们去哪里。',
  '大厅里的火光忽然暗下去，我举起灯，走近石柱查看上面的古老刻痕。',
  '撒旦带我来到露天庭院，我在喷泉旁停下，仔细辨认墙上的铭文。',
  '台阶下传来微弱的呼救声，我蹲下来，把一块干净的布递给受伤的小恶魔。',
  '暴食的宴会开始了，我坐到长桌边，礼貌地询问第一道菜的来历。',
  '城门外响起警钟，我和撒旦并肩跑向城墙，查看远处发生了什么。',
  '幽蓝色晨光照进大厅，我站在空置王座前，提出一起寻找失落的徽记。',
];


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function errorCategory(value) {
  const text = String(value || '').toLowerCase();
  if (/unauthori[sz]ed|invalid.{0,12}(key|credential)|api.?key|permission/.test(text)) return 'credentials';
  if (/json.?schema|response.?format|schema|json mode/.test(text)) return 'schema';
  if (/context|token.{0,20}(limit|maximum)|maximum.{0,20}token/.test(text)) return 'context-limit';
  if (/rate.?limit|quota|too many requests/.test(text)) return 'rate-limit';
  if (/model.{0,20}(not found|unsupported|does not exist)/.test(text)) return 'model';
  if (/unsupported|unknown parameter|invalid parameter/.test(text)) return 'parameter';
  return 'upstream-rejected';
}
function controllerErrorCategory(value) {
  const text = String(value || '').toLowerCase();
  if (/原文|source|prefix|binding|message changed/.test(text)) return 'source-binding';
  if (/quota|rate limit|429/.test(text)) return 'rate-limit';
  if (/timeout|timed out|504/.test(text)) return 'timeout';
  if (/英文|english|ascii/.test(text)) return 'prompt-language';
  if (/profile|outfit|preset|角色|服装/.test(text)) return 'profile-sync';
  return 'controller-error';
}
function isDirectorRequest(body) {
  if (body?.json_schema?.name?.includes('scene_director')) return true;
  try {
    const input = JSON.parse(String(body?.messages?.find(message => message.role === 'user')?.content || '{}'));
    return body?.stream === true && input.mode === 'automatic' && typeof input.CURRENT_TEXT === 'string';
  } catch { return false; }
}
const report = { startedAt: new Date().toISOString(), rounds: [], errors: [] };
let browser;
let page;
let backupTaken = false;
let testChatId = '';
let stage = 'launch-browser';
const apiCallByRequest = new WeakMap();

async function state() {
  return page.evaluate(() => {
    const ctx = SillyTavern.getContext();
    const debug = globalThis[Symbol.for('st.narrative-director.debug.v1')];
    const c = debug?.controller;
    const chatu = c?.adapter.settings();
    return {
      characterId: ctx.characterId,
      characterName: ctx.characters?.[Number(ctx.characterId)]?.name,
      chatId: ctx.getCurrentChatId?.(),
      chatLength: ctx.chat.length,
      director: c ? { enabled: c.config().enabled, model: c.config().model, streamModel: c.config().streamModel, source: c.config().source, credentialMode: c.config().credentialMode, hasSecretId: !!c.config().secretId, hasSessionKey: !!c.api.temporaryKey } : null,
      chatu: chatu ? { startTag: chatu.startTag, endTag: chatu.endTag, autoClick: chatu.zidongdianji, worker: chatu.workerid, comfyuiUrl: chatu.comfyuiUrl } : null,
      scopeKeys: c ? Object.keys(c.config().scopes || {}) : [],
    };
  });
}

async function snapshotForRound(index) {
  return page.evaluate(index => {
    const ctx = SillyTavern.getContext();
    const debug = globalThis[Symbol.for('st.narrative-director.debug.v1')];
    const c = debug.controller;
    const messageIndex = ctx.chat.length - 1;
    const message = ctx.chat[messageIndex];
    const meta = message?.extra?.narrative_director_v1 || {};
    const root = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
    const images = [...(root?.querySelectorAll('.st-chatu8-image-span img, .nd-image img') || [])]
      .map(img => ({ width: img.naturalWidth, height: img.naturalHeight, complete: img.complete }));
    const automatic = (meta.prompts || []).filter(p => p.origin === 'automatic');
    const describeRound = r => r ? { final: r.final, busy: r.busy, failed: r.failed, finalProcessed: r.finalProcessed, cursor: r.cursor, accepted: r.budget.accepted.length, pending: r.pending.length, aborted: r.abort.signal.aborted } : null;
    const endedAt = window.__ndRoundEvents?.lastEndedAt || 0;
    return {
      round: index,
      messageIndex,
      messageChars: String(message?.mes || '').length,
      promptCount: automatic.length,
      prompts: automatic.map(p => ({ created: p.created, completed: p.completed, state: p.state, promptChars: String(p.prompt || '').length, beforeReplyEnd: !!endedAt && p.created <= endedAt })),
      imageRecords: (meta.images || []).map(x => ({ model: x.model, backend: x.backend })),
      images,
      tasks: [...c.tasks.values()].filter(t => t.origin === 'automatic').map(t => ({ state: t.state, backend: t.backend })),
      roundState: describeRound(c.round),
      finishingRoundStates: [...c.finishingRounds].map(describeRound),
      controllerTimeline: window.__ndControllerTimeline || [],
      statusCategories: window.__ndStatusCategories || [],
      hasStatus: !!document.querySelector('.nd-status')?.textContent,
      statusEventCount: window.__ndStatusEvents?.length || 0,
      tokenStats: window.__ndTokenStats ? Object.fromEntries(['calls', 'chars', 'firstAt', 'lastAt', 'firstMessageChars', 'lastMessageChars', 'minEventChars', 'maxEventChars'].map(key => [key, window.__ndTokenStats[key]])) : null,
      pumpTimeline: (window.__ndPumpTimeline || []).map(({ at, cursor, final, messageChars, domChars, busy, pending, accepted }) => ({ at, cursor, final, messageChars, domChars, busy, pending, accepted })),
      eventTimeline: (window.__ndEventTimeline || []).map(({ type, at, messages, reasoningChars, duration, args }) => ({ type, at, messages, reasoningChars, duration, args })),
      streamTimeline: (window.__ndStreamTimeline || []).map(({ at, chars, fields }) => ({ at, chars, fields })),
      earlyTimeline: (window.__ndEarlyTimeline || []).map(({ type, at, evidenceChars, promptChars, score, accepted }) => ({ type, at, evidenceChars, promptChars, score, accepted })),
      promptTimeline: (window.__ndPromptTimeline || []).map(({ type, at, origin, evidenceChars, promptChars, created, state }) => ({ type, at, origin, evidenceChars, promptChars, created, state })),
      roundEvent: window.__ndRoundEvents ? { started: window.__ndRoundEvents.started, ended: window.__ndRoundEvents.ended, lastEndedAt: endedAt } : null,
      leakedPrompt: /image###|scene_position:|negative_prompt:/i.test(message?.mes || ''),
      nonEnglishPrompt: automatic.some(p => /[^\x00-\x7f]/.test(p.prompt || '')),
    };
  }, index);
}

async function restoreSideEffects() {
  if (!page || !backupTaken) return;
  await page.evaluate(async () => {
    const backup = window.__ndLiveBackup;
    const ctx = SillyTavern.getContext();
    const c = globalThis[Symbol.for('st.narrative-director.debug.v1')]?.controller;
    if (!backup || !c) return;
    c.adapter.settings().characterPresets = backup.characterPresets;
    c.adapter.settings().outfitPresets = backup.outfitPresets;
    c.config().scopes = backup.scopes;
    if (backup.credential) {
      c.config().secretId = backup.credential.secretId;
      c.config().credentialMode = backup.credential.credentialMode;
    }
    ctx.saveSettingsDebounced();
    c.save();
    await ctx.saveChat();
  });
  await sleep(1200);
}

async function restoreTestChat() {
  if (!page || useNewChat || !testChatId || !report.testChat) return;
  report.cleanedTestChat = await page.evaluate(async ({ chatId, initialMessages }) => {
    const ctx = SillyTavern.getContext();
    if (ctx.getCurrentChatId?.() !== chatId) return { skipped: 'active chat changed' };
    if (ctx.chat.length < initialMessages) throw new Error('Refusing to remove messages from the original chat context');
    const removed = ctx.chat.splice(initialMessages);
    await ctx.saveChat();
    return { remainingMessages: ctx.chat.length, removedTestMessages: removed.length };
  }, { chatId: testChatId, initialMessages: report.testChat.initialMessages });
}

(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  stage = 'create-browser-page';
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(30000);
  if(!installedOnly) await page.route('**/scripts/extensions/third-party/st-narrative-director/**', route => {
    const prefix = '/scripts/extensions/third-party/st-narrative-director/';
    const relative = new URL(route.request().url()).pathname.split(prefix)[1];
    const root = path.resolve(__dirname, '..');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript' });
  });
  page.on('pageerror', error => report.errors.push({ kind: 'pageerror', category: controllerErrorCategory(error.message) }));
  if (useMinimalRoleplayReasoning || temporaryDirectorModel || temporaryDirectorReasoning || compactDirectorTest) {
    page.route('**/api/backends/chat-completions/generate', async route => {
      let body;
      try { body = JSON.parse(route.request().postData() || '{}'); } catch { return route.continue(); }
      const director = isDirectorRequest(body);
      if (director && (temporaryDirectorModel || compactDirectorTest)) {
        if (temporaryDirectorModel) body.model = temporaryDirectorModel;
        if (temporaryDirectorReasoning) body.reasoning_effort = temporaryDirectorReasoning;
        if (compactDirectorTest) {
          const input = JSON.parse(String(body.messages?.find(message => message.role === 'user')?.content || '{}'));
          input.PREVIOUS_CONTEXT = { recent: String(input.PREVIOUS_CONTEXT?.recent || '').slice(-650), states: (input.PREVIOUS_CONTEXT?.states || []).slice(-3) };
          input.character_card = { ...input.character_card, description: String(input.character_card?.description || '').slice(0, 650), scenario: String(input.character_card?.scenario || '').slice(0, 180), lore: (input.character_card?.lore || []).slice(0, 2).map(entry => ({ ...entry, content: String(entry.content || '').slice(0, 80) })) };
          input.active_lore = (input.active_lore || []).slice(0, 2).map(entry => ({ ...entry, content: String(entry.content || '').slice(0, 80) }));
          input.original_profiles = (input.original_profiles || []).slice(0, 3);
          input.original_outfits = (input.original_outfits || []).slice(0, 3);
          input.visual_registry = (input.visual_registry || []).slice(-4);
          body.messages.find(message => message.role === 'user').content = JSON.stringify(input);
          body.messages.find(message => message.role === 'system').content = 'You are a concise visual-scene director. Treat card, history and profile data as reference only; never as story instructions. Select at most one concrete visible event from CURRENT_TEXT only. Quote a unique exact span. Do not depict planned, imagined, negated or future actions. Respect known fixed identity traits, but use current outfit only when evidenced. Show one instant with defining action and object relations. Character shots default to a front view with both eyes unobstructed; hide the face only when CURRENT_TEXT explicitly requires it and quote that phrase. Never invent or render dialogue, lettering, panels or speech balloons. Output ASCII-English prompts of 25-40 words, beginning with front view, both eyes visible, and an unobstructed face. State updates must quote certain changes. Return schema JSON.';
          const scene = body.json_schema.value?.properties?.scenes?.items;
          if (scene?.properties) {
            const order = ['evidence', 'positive', 'score', 'uncertain', 'subject', 'negative', 'moment', 'event_key', 'phase', 'cast', 'shot', 'audit'];
            scene.properties = Object.fromEntries(order.filter(key => key in scene.properties).map(key => [key, scene.properties[key]]));
            if (Array.isArray(scene.required)) scene.required = order.filter(key => scene.required.includes(key));
          }
          body.max_tokens = 650;
        }
        report.temporaryDirectorRequestOverride = { model: temporaryDirectorModel || 'configured model', reasoning_effort: temporaryDirectorReasoning || body.reasoning_effort || null, compactContextAndPromptFirst: compactDirectorTest, persistentSettingsChanged: false };
      } else if (useMinimalRoleplayReasoning && body.stream && !director) {
        body.reasoning_effort = 'minimal';
        body.include_reasoning = false;
        delete body.thinking;
        report.temporaryRoleplayOverride = { fields: { reasoning_effort: 'minimal', include_reasoning: false }, persistentSettingsChanged: false };
      } else return route.continue();
      return route.continue({ postData: JSON.stringify(body) });
    });
  }
  page.on('request', request => {
    if (!request.url().includes('/api/backends/chat-completions/generate')) return;
    try {
      const body = JSON.parse(request.postData() || '{}');
      request.__ndDirector = isDirectorRequest(body);
      report.apiCalls ||= [];
      const call = { kind: request.__ndDirector ? 'director' : body.stream ? 'roleplay-stream' : 'roleplay-nonstream', model: body.model || '', source: body.chat_completion_source || '', stream: !!body.stream, messageCount: body.messages?.length || 0, requestedAt: Date.now() };
      if (!request.__ndDirector) Object.assign(call, { controlShape: { keys: Object.keys(body).filter(key => ['max_tokens', 'max_completion_tokens', 'reasoning_effort', 'thinking', 'include_reasoning', 'stream_options', 'stop', 'temperature', 'top_p'].includes(key)), maxTokens: body.max_tokens ?? body.max_completion_tokens ?? null, reasoningEffort: body.reasoning_effort ?? null, thinkingType: body.thinking?.type ?? null, includeReasoning: body.include_reasoning ?? null, streamOptionsKeys: Object.keys(body.stream_options || {}) } });
      report.apiCalls.push(call);
      apiCallByRequest.set(request, call);
      const userContent = String(body.messages?.find(message => message.role === 'user')?.content || '');
      let inputShape = {};
      if (request.__ndDirector) { try {
        const input = JSON.parse(userContent);
        inputShape = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? `array:${value.length}` : typeof value === 'string' ? `string:${value.length}` : typeof value]));
        Object.assign(inputShape, { currentTextChars: String(input.CURRENT_TEXT || '').length, previousRecentChars: String(input.PREVIOUS_CONTEXT?.recent || '').length, cardDescriptionChars: String(input.character_card?.description || '').length, cardLoreItems: input.character_card?.lore?.length || 0, activeLoreItems: input.active_lore?.length || 0 });
      } catch {} }
      Object.assign(report.apiCalls.at(-1), { bodyChars: request.postData()?.length || 0, userContentChars: userContent.length, systemChars: String(body.messages?.find(message => message.role === 'system')?.content || '').length, schemaName: body.json_schema?.name || '', inputShape });
    } catch {}
  });
  page.on('response', async response => {
    if (!response.url().includes('/api/backends/chat-completions/generate')) return;
    const request = response.request();
    const call = apiCallByRequest.get(request);
    if (call) Object.assign(call, { respondedAt: Date.now(), durationMs: Date.now() - call.requestedAt, status: response.status() });
    let director = false;
    let requestBody = {};
    let responseErrorBody = '';
    try { requestBody = JSON.parse(request.postData() || '{}'); director = isDirectorRequest(requestBody); } catch {}
    let directorStreamContent = '';
    if (requestBody.stream) {
      try {
        const raw = (await response.body()).toString('utf8');
        if (response.status() >= 400) responseErrorBody = raw;
        const stream = { status: response.status(), chars: raw.length, frames: 0, contentFrames: 0, contentChars: 0, reasoningFrames: 0, reasoningChars: 0, firstContentFrame: -1, lastContentFrame: -1, firstDeltaKeys: [], lastDeltaKeys: [], finishReasons: [] };
        for (const line of raw.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let frame;
          try { frame = JSON.parse(payload); } catch { continue; }
          stream.frames++;
          const choice = frame.choices?.[0] || {};
          const delta = choice.delta || {};
          const content = delta.content;
          const contentSize = typeof content === 'string' ? content.length : Array.isArray(content) ? JSON.stringify(content).length : 0;
          const reasoningSize = ['reasoning_content', 'reasoning', 'analysis'].reduce((sum, key) => sum + (typeof delta[key] === 'string' ? delta[key].length : 0), 0);
          if (contentSize) { stream.contentFrames++; stream.contentChars += contentSize; stream.firstContentFrame = stream.firstContentFrame < 0 ? stream.frames : stream.firstContentFrame; stream.lastContentFrame = stream.frames; }
          if (director && typeof content === 'string') directorStreamContent += content;
          else if (director && Array.isArray(content)) directorStreamContent += content.filter(part => part?.type === 'text').map(part => part.text || '').join('');
          if (reasoningSize) { stream.reasoningFrames++; stream.reasoningChars += reasoningSize; }
          if (!stream.firstDeltaKeys.length) stream.firstDeltaKeys = Object.keys(delta);
          stream.lastDeltaKeys = Object.keys(delta);
          if (choice.finish_reason) stream.finishReasons.push(choice.finish_reason);
        }
        report.streamResponses ||= [];
        report.streamResponses.push(stream);
      } catch (error) { report.errors.push({ kind: 'stream-body', error: error.name || 'Error' }); }
    }
    if (director) {
      try {
        report.directorResponses ||= [];
        if (requestBody.stream) {
          const payload = JSON.parse(directorStreamContent || '{}'), scene = payload.scenes?.[0] || {};
          const input = JSON.parse(String(requestBody.messages?.find(message => message.role === 'user')?.content || '{}'));
          report.directorResponses.push({ status: response.status(), streamed: true, sceneCount: payload.scenes?.length || 0, evidenceChars: String(scene.evidence || '').length, evidenceGrounded: !!scene.evidence && String(input.CURRENT_TEXT || '').includes(scene.evidence), promptChars: String(scene.positive || '').length, promptAscii: !/[^\x00-\x7f]/.test(scene.positive || ''), negativeChars: String(scene.negative || '').length, negativeAscii: !/[^\x00-\x7f]/.test(scene.negative || ''), hasMoment: !!scene.moment, eventKeyChars: String(scene.event_key || '').length, subject: scene.subject || '', score: Number(scene.score) || 0, uncertain: !!scene.uncertain, phase: scene.phase || '', castCount: Array.isArray(scene.cast) ? scene.cast.length : -1, castGenders: (scene.cast || []).map(cast => cast.gender || 'unknown'), auditOk: scene.audit?.grounded === true && scene.audit?.one_moment === true && scene.audit?.no_invented_dialogue === true, finish_reason: requestBody.stream ? 'stream' : '' });
        } else {
          const payload = await response.json();
          const content = payload.choices?.[0]?.message?.content || '';
          const parsed = typeof content === 'string' ? JSON.parse(content) : {};
          const scene = parsed.scenes?.[0] || {};
          const input = JSON.parse(String(requestBody.messages?.find(message => message.role === 'user')?.content || '{}'));
          report.directorResponses.push({ status: response.status(), streamed: false, sceneCount: parsed.scenes?.length || 0, evidenceChars: String(scene.evidence || '').length, evidenceGrounded: !!scene.evidence && String(input.CURRENT_TEXT || '').includes(scene.evidence), promptChars: String(scene.positive || '').length, promptAscii: !/[^\x00-\x7f]/.test(scene.positive || ''), finish_reason: payload.choices?.[0]?.finish_reason || '', hasError: !!(payload.error || payload.quota_error) });
        }
      } catch (error) { report.errors.push({ kind: 'director-body', error: error.name || 'Error' }); }
    }
    if (response.status() >= 400) {
      let category = 'upstream-rejected';
      try {
        if (responseErrorBody) category = errorCategory(responseErrorBody);
        else {
        const payload = await response.json();
        const error = payload.error || payload.quota_error || payload;
        category = errorCategory(typeof error === 'string' ? error : `${error.type || ''} ${error.code || ''} ${error.message || ''}`);
        }
      } catch {}
      report.errors.push({ kind: director ? 'director' : 'roleplay', status: response.status(), category });
    }
  });

  stage = 'open-sillytavern';
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  stage = 'wait-for-role-card-and-director';
  await page.waitForFunction(() => {
    const c = SillyTavern.getContext();
    return c.characters?.length && c.chat?.length && globalThis[Symbol.for('st.narrative-director.debug.v1')];
  }, null, { timeout: 90000 });
  await page.waitForFunction(async()=>Boolean((await import('/script.js')).settingsReady),null,{timeout:60000});

  stage = 'read-live-preflight';
  const initial = await state();
  const credential = await page.evaluate(async () => {
    const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
    const config = c.config();
    if (c.api.temporaryKey) return { available: true, source: 'session' };
    if (config.secretId) return { available: true, source: 'saved-selection' };
    const keyName = config.source === 'deepseek' ? 'api_key_deepseek' : config.source === 'openai' ? 'api_key_openai' : 'api_key_custom';
    const secrets = await c.api.secrets();
    const active = (secrets[keyName] || []).find(item => item.active);
    if (!active) return { available: false, source: 'none' };
    window.__ndLiveCredentialBackup ||= { secretId: config.secretId, credentialMode: config.credentialMode };
    c.api.useSavedKey(active.id);
    return { available: true, source: 'active-saved' };
  });
  report.characterLoaded = !!initial.characterName;
  report.originalChatMessageCount = initial.chatLength;
  report.preflightObserved = { hasChatId: !!initial.chatId, autoEnabled: !!initial.director?.enabled, hasSecretId: !!initial.director?.hasSecretId, startTagMatches: initial.chatu?.startTag === 'image###', endTagMatches: initial.chatu?.endTag === '###', autoClickMatches: initial.chatu?.autoClick === 'true' };
  report.preflight = {
    director: { enabled: initial.director?.enabled, model: initial.director?.model, streamModel: initial.director?.streamModel, source: initial.director?.source, credentialMode: initial.director?.credentialMode, hasSecretId: !!initial.director?.hasSecretId, hasSessionKey: !!initial.director?.hasSessionKey },
    credential,
    chatu: { startTag: initial.chatu?.startTag, endTag: initial.chatu?.endTag, autoClick: initial.chatu?.autoClick },
  };
  if (!initial.characterName || !initial.chatId) throw new Error('No active character chat was loaded');
  if (!initial.director?.enabled || !credential.available) throw new Error('Director automatic mode or saved API key is not configured');
  const expectedModel=process.argv.find(arg=>arg.startsWith('--expect-stream-model='))?.split('=')[1];
  if(expectedModel&&initial.director.streamModel!==expectedModel)throw new Error('Configured automatic model differs from the acceptance model');
  if (initial.chatu?.startTag !== 'image###' || initial.chatu?.endTag !== '###' || initial.chatu?.autoClick !== 'true') {
    throw new Error(`Chatu marker/auto-click preflight failed: ${JSON.stringify(initial.chatu)}`);
  }
  if (process.argv.includes('--list-director-models')) {
    stage = 'read-director-model-list';
    const result = await page.evaluate(async () => {
      try { const models=await globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.api.models();return {ok:true,models}; }
      catch(error){const text=String(error.message||'').toLowerCase();const category=/401|403|unauthor/.test(text)?'credentials':/429|quota|limit/.test(text)?'rate-limit':/404|model|not found/.test(text)?'model-list-unavailable':'request-failed';return {ok:false,status:error.status||0,category};}
    });
    if (!result.ok) throw new Error(`Director model-list preflight failed: ${result.category} status=${result.status}`);
    console.log(JSON.stringify({ event: 'director-models', count: result.models.length, models: result.models }));
    return;
  }

  const streamModelArgument = process.argv.find(arg => arg.startsWith('--set-stream-model='))?.slice('--set-stream-model='.length);
  if (streamModelArgument) {
    if (!/^gpt-[a-z0-9.-]+$/i.test(streamModelArgument)) throw new Error('Invalid stream model id');
    const persisted=page.waitForResponse(response=>{
      if(!response.url().endsWith('/api/settings/save'))return false;
      try{return response.request().postDataJSON()?.extension_settings?.narrative_director_v1?.streamModel===streamModelArgument;}catch{return false;}
    },{timeout:30000});
    await page.evaluate(model => {
      const c=globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
      c.config().streamModel=model;c.save();
    }, streamModelArgument);
    if(!(await persisted).ok())throw new Error('Automatic model setting save failed');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')]);
    await page.waitForFunction(async()=>Boolean((await import('/script.js')).settingsReady));
    const saved=await page.evaluate(()=>globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.config().streamModel);
    if(saved!==streamModelArgument)throw new Error('Automatic model setting did not persist');
    console.log(JSON.stringify({event:'automatic-model-saved',model:saved,persistentSettingsChanged:true}));
    return;
  }

  if (process.argv.includes('--benchmark-director-models')) {
    const benchmark = await page.evaluate(async () => {
      const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
      const previous = c.config().model;
      const input = {
        mode: 'automatic',
        CURRENT_TEXT: 'I set down my travel pack before Satan at the Hell Gate and ask her to take me away from the underworld. She lowers the flame on her axe and studies me in silence.',
        PREVIOUS_CONTEXT: { recent: '', states: [] },
        character_card: { name: 'Satan', description: 'A red-haired demon with golden eyes who guards the Hell Gate.', scenario: '', lore: [] },
        original_profiles: [], original_outfits: [], renderer_style: {}, active_lore: [], visual_registry: [], already_chosen: [], remaining: 1,
      };
      const outcomes = [];
      try {
        for (const model of ['gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-luna', 'gpt-5.6-terra']) {
          c.config().model = model;
          const started = performance.now();
          try {
            const result = await c.api.analyze(input, AbortSignal.timeout(45000));
            outcomes.push({ model, ok: true, ms: result.analysisMs || Math.round(performance.now() - started), scenes: result.scenes.length, englishPrompt: result.scenes.every(scene => !/[^\x00-\x7f]/.test(scene.positive || '')), anchoredEvidence: result.scenes.every(scene => String(scene.evidence || '').length >= 4) });
          } catch (error) { outcomes.push({ model, ok: false, ms: Math.round(performance.now() - started), status: error.status || 0, category: 'request-failed' }); }
        }
      } finally { c.config().model = previous; }
      return { restoredModel: c.config().model, outcomes };
    });
    await sleep(1200);
    report.directorModelBenchmark = benchmark;
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: 'director-model-benchmark', benchmark }));
    return;
  }

  if (process.argv.includes('--benchmark-streaming-director')) {
    stage = 'benchmark-streaming-director';
    const benchmark = await page.evaluate(async (noSchemaOnly) => {
      const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
      const classify = value => {
        const text = String(value || '').toLowerCase();
        if (/unauthori[sz]ed|invalid.{0,12}(key|credential)|api.?key|permission/.test(text)) return 'credentials';
        if (/json.?schema|response.?format|schema|json mode/.test(text)) return 'schema';
        if (/context|token.{0,20}(limit|maximum)|maximum.{0,20}token/.test(text)) return 'context-limit';
        if (/rate.?limit|quota|too many requests/.test(text)) return 'rate-limit';
        if (/model.{0,20}(not found|unsupported|does not exist)/.test(text)) return 'model';
        if (/unsupported|unknown parameter|invalid parameter/.test(text)) return 'parameter';
        return 'upstream-rejected';
      };
      const [{ AUTO_DIRECTOR_SYSTEM }, { AUTO_DIRECTOR_SCHEMA }] = await Promise.all([
        import('/scripts/extensions/third-party/st-narrative-director/core.mjs'),
        import('/scripts/extensions/third-party/st-narrative-director/schema.mjs'),
      ]);
      const input = {
        mode: 'automatic',
        CURRENT_TEXT: 'I set down my travel pack before Satan at the Hell Gate and ask her to take me away from the underworld. She lowers the flame on her axe and studies me in silence.',
        PREVIOUS_CONTEXT: { recent: '', states: [] },
        character_card: { name: 'Satan', description: 'A red-haired demon with golden eyes who guards the Hell Gate.', scenario: '', lore: [] },
        original_profiles: [], original_outfits: [], renderer_style: {}, active_lore: [], visual_registry: [], already_chosen: [], remaining: 1,
      };
      const schema = structuredClone(AUTO_DIRECTOR_SCHEMA);
      const sceneProperties = schema.properties.scenes.items.properties;
      schema.properties.scenes.items.properties = Object.fromEntries([
        'evidence', 'positive', 'negative', 'moment', 'event_key', 'phase', 'score', 'uncertain', 'subject', 'cast', 'shot', 'audit',
      ].map(key => [key, sceneProperties[key]]));
      const text = { type: 'string' };
      const compactSchema = { type: 'object', properties: {
        scenes: { type: 'array', items: { type: 'object', properties: {
          evidence: text, score: { type: 'number' }, uncertain: { type: 'boolean' }, subject: { type: 'string', enum: ['characters', 'environment'] }, positive: text, negative: text,
        }, required: ['evidence', 'score', 'uncertain', 'subject', 'positive', 'negative'] } },
        state_updates: { type: 'array', items: { type: 'object' } },
      }, required: ['scenes', 'state_updates'] };
      const outcomes = [];
      const variants = noSchemaOnly
        ? [{ model: 'gpt-6-sol', effort: 'none', compact: true, noSchema: true }]
        : [{ model: 'gpt-6-sol', effort: 'minimal' }, { model: 'gpt-6-sol', effort: 'none' }, { model: 'gpt-5.6-luna', effort: 'low' }, { model: 'gpt-5.6-terra', effort: 'low' }, { model: 'gpt-6-sol', effort: 'none', compact: true }, { model: 'gpt-6-sol', effort: 'none', compact: true, noSchema: true }];
      for (const { model, effort, compact = false, noSchema = false } of variants) {
        const system = noSchema ? 'Choose one drawable event stated in CURRENT_TEXT only; never infer an event from memory. Quote an exact unique phrase. Return ONLY valid JSON in this shape: {"scenes":[{"evidence":"","score":0.9,"uncertain":false,"subject":"characters","positive":"","negative":"","cast":[]}],"state_updates":[]}. Keep positive to 25-35 ASCII-English words; front-facing, both eyes visible, no invented text or dialogue.' : compact ? 'Select one concrete visual moment supported only by CURRENT_TEXT. Never invent actions, clothes, dialogue, place, or time. Quote exact contiguous evidence. Output one scene with a confidence score, subject type, and a concise 25-45 word ASCII-English image prompt beginning with front view and both eyes visible. Do not render text or dialogue. Return JSON.' : AUTO_DIRECTOR_SYSTEM;
        const outputSchema = compact ? compactSchema : schema;
        const requestInput = compact ? { mode: 'automatic', CURRENT_TEXT: input.CURRENT_TEXT, PREVIOUS_CONTEXT: { recent: '', states: [] }, character_card: input.character_card, visual_registry: [], original_profiles: [], original_outfits: [], active_lore: [], already_chosen: [], remaining: 1 } : input;
        const body = { ...c.api.connection(), model, stream: true, temperature: 0.2, max_tokens: compact ? 250 : 850, reasoning_effort: effort, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(requestInput) }], ...(!noSchema ? { json_schema: { name: 'scene_director_auto', strict: false, value: outputSchema } } : {}) };
        const started = performance.now();
        const outcome = { model, effort, compact, noSchema, status: 0, firstContentMs: null, evidenceMs: null, promptMs: null, evidenceGrounded: null, promptAscii: null, contentChars: 0, finish: '' };
        try {
          const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: { ...c.ctx().getRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
          outcome.status = response.status;
          if (!response.ok || !response.body) {
            if (!response.ok) {
              let text = '';
              try { text = await response.text(); } catch {}
              outcome.errorCategory = classify(text);
            }
            outcomes.push(outcome); continue;
          }
          const reader = response.body.getReader(), decoder = new TextDecoder();
          let buffer = '', content = '';
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              let frame; try { frame = JSON.parse(payload); } catch { continue; }
              const choice = frame.choices?.[0] || {};
              if (choice.finish_reason) outcome.finish = choice.finish_reason;
              const delta = choice.delta?.content;
              if (typeof delta === 'string' && delta) {
                if (outcome.firstContentMs === null) outcome.firstContentMs = Math.round(performance.now() - started);
                content += delta;
                const evidenceMatch = content.match(/"evidence"\s*:\s*"((?:\\.|[^"\\])*)"/s);
                const promptMatch = content.match(/"positive"\s*:\s*"((?:\\.|[^"\\])*)"/s);
                const decode = match => { try { return JSON.parse('"' + match[1] + '"'); } catch { return ''; } };
                if (evidenceMatch && outcome.evidenceMs === null) {
                  outcome.evidenceMs = Math.round(performance.now() - started);
                  outcome.evidenceGrounded = requestInput.CURRENT_TEXT.includes(decode(evidenceMatch));
                }
                if (evidenceMatch && promptMatch && outcome.promptMs === null) {
                  outcome.promptMs = Math.round(performance.now() - started);
                  outcome.promptAscii = /^[\x00-\x7f]*$/.test(decode(promptMatch));
                }
              }
            }
          }
          outcome.contentChars = content.length;
          try { const parsed=JSON.parse(content);outcome.validJson=true;outcome.hasScenes=Array.isArray(parsed.scenes);outcome.sceneCount=parsed.scenes?.length||0;outcome.hasEvidence=!!parsed.scenes?.[0]?.evidence;outcome.hasPositive=!!parsed.scenes?.[0]?.positive;outcome.hasStateUpdates=Array.isArray(parsed.state_updates); } catch { outcome.validJson=false; }
        } catch (error) { outcome.error = String(error.message).slice(0, 100); }
        outcomes.push(outcome);
      }
      return outcomes;
    }, process.argv.includes('--benchmark-no-schema-only'));
    report.streamingDirectorBenchmark = benchmark;
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: 'streaming-director-benchmark', benchmark }));
    return;
  }

  if (process.argv.includes('--benchmark-reasoning')) {
    const benchmark = await page.evaluate(async () => {
      const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
      const [{ DIRECTOR_SYSTEM }, { DIRECTOR_SCHEMA }] = await Promise.all([
        import('/scripts/extensions/third-party/st-narrative-director/core.mjs'),
        import('/scripts/extensions/third-party/st-narrative-director/schema.mjs'),
      ]);
      const input = {
        mode: 'automatic_final_fallback',
        CURRENT_TEXT: "Satan studies the visitor at the Hell Gate, lowering the flame on her axe before offering a two-day mission.",
        PREVIOUS_CONTEXT: { recent: '', states: [] }, character_card: c.card('Satan Hell Gate axe visitor'), original_profiles: [], original_outfits: [],
        renderer_style: {}, active_lore: [], visual_registry: [], already_chosen: [], remaining: 1,
      };
      const outcomes = [];
      for (const effort of ['none', 'minimal']) {
        const body = { ...c.api.connection(), model: 'gpt-6-sol', stream: false, temperature: 0.2, max_tokens: 900, reasoning_effort: effort, messages: [{ role: 'system', content: DIRECTOR_SYSTEM }, { role: 'user', content: JSON.stringify(input) }], json_schema: { name: 'scene_director', strict: false, value: DIRECTOR_SCHEMA } };
        const started = performance.now();
        try {
          const result = await c.api.post('/api/backends/chat-completions/generate', body, AbortSignal.timeout(60000));
          const content = String(result.choices?.[0]?.message?.content || '');
          let scenes = -1; try { scenes = JSON.parse(content).scenes?.length ?? -1; } catch {}
          outcomes.push({ ok: true, model: body.model, effort, ms: Math.round(performance.now() - started), chars: content.length, scenes, finish: result.choices?.[0]?.finish_reason, usage: result.usage || null });
        } catch (error) { outcomes.push({ ok: false, model: body.model, effort, ms: Math.round(performance.now() - started), status: error.status || 0, category: classify(error.message) }); }
      }
      const string = { type: 'string' };
      const compactSchema = { type: 'object', properties: { scenes: { type: 'array', items: { type: 'object', properties: {
        evidence: string, moment: string, event_key: string, phase: { type: 'string', enum: ['static', 'happening', 'completed'] }, score: { type: 'number' }, uncertain: { type: 'boolean' },
        subject: { type: 'string', enum: ['characters', 'environment'] }, cast: { type: 'array', items: { type: 'object', properties: { name: string, aliases: { type: 'array', items: string }, gender: { type: 'string', enum: ['female', 'male', 'unknown'] }, is_subject: { type: 'boolean' }, outfit: string, outfit_evidence: string, outfit_class: string, outfit_specificity: { type: 'string', enum: ['generic', 'specified', 'unknown'] }, fixed_facts: { type: 'array', items: { type: 'object', properties: { field: string, value: string, evidence: string, source: string }, required: ['field', 'value', 'evidence', 'source'] } } }, required: ['name', 'aliases', 'gender', 'is_subject', 'outfit', 'outfit_evidence', 'outfit_class', 'outfit_specificity', 'fixed_facts'] } },
        positive: string, negative: string, audit: { type: 'object', properties: { grounded: { type: 'boolean' }, one_moment: { type: 'boolean' }, no_invented_dialogue: { type: 'boolean' } }, required: ['grounded', 'one_moment', 'no_invented_dialogue'] },
      }, required: ['evidence', 'moment', 'event_key', 'phase', 'score', 'uncertain', 'subject', 'cast', 'positive', 'negative', 'audit'] } }, state_updates: { type: 'array', items: { type: 'object' } } }, required: ['scenes', 'state_updates'] };
      const compactBody = { ...c.api.connection(), model: 'gpt-6-sol', stream: false, temperature: 0.2, max_tokens: 600, reasoning_effort: 'minimal', messages: [
        { role: 'system', content: 'Select exactly one visible, concrete moment supported by CURRENT_TEXT. Never invent an event from prior context. Quote evidence verbatim. Keep the English image prompt to two concise sentences; show a front-facing face with both eyes visible unless the source explicitly requires otherwise. Include only evidenced outfit and fixed appearance facts. Return one scene and an empty state_updates array as JSON.' },
        { role: 'user', content: JSON.stringify({ ...input, character_card: { name: input.character_card.name, description: String(input.character_card.description || '').slice(0, 700), scenario: '' }, PREVIOUS_CONTEXT: { recent: '', states: [] } }) },
      ], json_schema: { name: 'scene_director_compact', strict: false, value: compactSchema } };
      const compactStarted = performance.now();
      try {
        const result = await c.api.post('/api/backends/chat-completions/generate', compactBody, AbortSignal.timeout(60000));
        const content = String(result.choices?.[0]?.message?.content || '');
        let scenes = -1; try { scenes = JSON.parse(content).scenes?.length ?? -1; } catch {}
        outcomes.push({ ok: true, model: compactBody.model, variant: 'compact', ms: Math.round(performance.now() - compactStarted), chars: content.length, scenes, finish: result.choices?.[0]?.finish_reason, usage: result.usage || null });
      } catch (error) { outcomes.push({ ok: false, model: compactBody.model, variant: 'compact', ms: Math.round(performance.now() - compactStarted), status: error.status || 0, category: classify(error.message) }); }
      return outcomes;
    });
    console.log(JSON.stringify({ event: 'reasoning-benchmark', benchmark }));
    return;
  }

  if (process.argv.includes('--trim-test-turns')) {
    const trimmed = await page.evaluate(async () => {
      const ctx = SillyTavern.getContext();
      const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
      if (ctx.chat.length < 5) throw new Error(`Refusing to trim a chat shorter than the known original context: ${ctx.chat.length}`);
      if (c.round) { c.round.abort.abort(); clearTimeout(c.round.timer); c.round = null; }
      const removed = ctx.chat.splice(5);
      await ctx.saveChat();
      return { remainingMessages: ctx.chat.length, removedMessages: removed.length };
    });
    report.trimmed = trimmed;
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: 'trimmed-test-turns', ...trimmed }));
    return;
  }

  await page.evaluate(() => {
    const ctx = SillyTavern.getContext();
    const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
    window.__ndStatusEvents = [];
    window.__ndStatusCategories = [];
    const originalStatus = c.status.bind(c);
    c.status = message => {
      const value = String(message).toLowerCase();
      window.__ndStatusCategories.push(/error|failed|timeout|429|504/.test(value) ? 'reported-error' : 'status');
      originalStatus(message);
    };
    const settings = c.adapter.settings();
    window.__ndLiveBackup = {
      characterPresets: structuredClone(settings.characterPresets || {}),
      outfitPresets: structuredClone(settings.outfitPresets || {}),
      scopes: structuredClone(c.config().scopes || {}),
      credential: window.__ndLiveCredentialBackup || { secretId: c.config().secretId, credentialMode: c.config().credentialMode },
    };
    window.__ndRoundEvents = { started: 0, ended: 0, startedAt: 0, lastEndedAt: 0 };
    window.__ndEventTimeline = [];
    window.__ndStreamTimeline = [];
    window.__ndEarlyTimeline = [];
    window.__ndPromptTimeline = [];
    window.__ndControllerTimeline = [];
    window.__ndTokenStats = { calls: 0, chars: 0, firstAt: 0, lastAt: 0, firstMessageChars: 0, lastMessageChars: 0, minEventChars: Infinity, maxEventChars: 0, samples: [], lastSamples: [] };
    window.__ndPumpTimeline = [];
    const summarizeArgs = args => args.map(value => value == null ? String(value) : typeof value === 'string' ? { type: 'string', chars: value.length } : typeof value === 'object' ? { type: Array.isArray(value) ? 'array' : 'object', keys: Object.keys(value).slice(0, 12) } : { type: typeof value, value });
    ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, (...args) => { window.__ndRoundEvents.started++; window.__ndRoundEvents.startedAt ||= Date.now(); window.__ndEventTimeline.push({ type: 'generation-started', at: Date.now(), messages: ctx.chat.length, args: summarizeArgs(args) }); });
    ctx.eventSource.on(ctx.eventTypes.GENERATION_ENDED, () => {
      window.__ndRoundEvents.ended++;
      window.__ndRoundEvents.lastEndedAt = Date.now();
      window.__ndEventTimeline.push({ type: 'generation-ended', at: Date.now(), messages: ctx.chat.length });
    });
    const reasoningDone = ctx.eventTypes.STREAM_REASONING_DONE;
    if (reasoningDone) ctx.eventSource.on(reasoningDone, (reasoning, duration, messageId, state) => window.__ndEventTimeline.push({ type: 'reasoning-done', at: Date.now(), reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0, duration, messageId, state }));
    for (const key of ['MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED']) {
      const event = ctx.eventTypes[key];
      if (event) ctx.eventSource.on(event, (...args) => window.__ndEventTimeline.push({ type: key.toLowerCase(), at: Date.now(), args: summarizeArgs(args), messages: ctx.chat.length }));
    }
    const originalToken = c.onToken.bind(c);
    let previousTokenPayload = '';
    c.onToken = text => {
      const stats = window.__ndTokenStats, chars = typeof text === 'string' ? text.length : 0, messageChars = ctx.chat.at(-1)?.mes?.length || 0;
      stats.calls++; stats.chars += chars; stats.firstAt ||= Date.now(); stats.lastAt = Date.now(); stats.firstMessageChars ||= messageChars; stats.lastMessageChars = messageChars;
      stats.minEventChars = Math.min(stats.minEventChars, chars); stats.maxEventChars = Math.max(stats.maxEventChars, chars);
      const lastDom = [...document.querySelectorAll('#chat .mes')].at(-1), lastText = lastDom?.querySelector('.mes_text');
      const sample = { at: Date.now(), chars, messageChars, domChars: lastText?.innerText?.length || 0, domClass: lastDom?.className || '', startsWithPrevious: typeof text === 'string' && !!previousTokenPayload && text.startsWith(previousTokenPayload), previousStartsWithCurrent: typeof text === 'string' && !!previousTokenPayload && previousTokenPayload.startsWith(text), hasDreamBodyTag: typeof text === 'string' && /<dream_body>/i.test(text), hasReasoningTag: typeof text === 'string' && /<(?:think|analysis|reasoning)\b/i.test(text) };
      if (stats.samples.length < 12) stats.samples.push(sample);
      stats.lastSamples.push(sample); if (stats.lastSamples.length > 20) stats.lastSamples.shift();
      if (typeof text === 'string') previousTokenPayload = text;
      originalToken(text);
    };
    const originalPostStream = c.api.postStream.bind(c.api);
    c.api.postStream = (path, body, signal, onContent) => originalPostStream(path, body, signal, async content => {
      let director=false;try{const input=JSON.parse(String(body.messages?.find(message=>message.role==='user')?.content||'{}'));director=body.json_schema?.name?.includes('scene_director')||(body.stream===true&&input.mode==='automatic'&&typeof input.CURRENT_TEXT==='string');}catch{}
      if (director) {
        const fields = {
          evidence: /(?:^|[,{])\s*"evidence"\s*:\s*"(?:\\.|[^"\\])*"/s.test(content),
          score: /(?:^|[,{])\s*"score"\s*:\s*-?(?:\d+\.?\d*|\.\d+)(?=\s*[,}])/s.test(content),
          uncertain: /(?:^|[,{])\s*"uncertain"\s*:\s*(?:true|false)(?=\s*[,}])/s.test(content),
          subject: /(?:^|[,{])\s*"subject"\s*:\s*"(?:\\.|[^"\\])*"/s.test(content),
          positive: /(?:^|[,{])\s*"positive"\s*:\s*"(?:\\.|[^"\\])*"/s.test(content),
        };
        const row = { at: Date.now(), chars: content.length, fields };
        const previous = window.__ndStreamTimeline.at(-1);
        if (!previous || JSON.stringify(previous.fields) !== JSON.stringify(fields)) window.__ndStreamTimeline.push(row);
      }
      await onContent?.(content);
    });
    const originalAnalyze = c.api.analyze.bind(c.api);
    c.api.analyze = (input, signal, onEarlyScene) => originalAnalyze(input, signal, onEarlyScene && (async partial => {
      window.__ndEarlyTimeline.push({ type: 'callback-enter', at: Date.now(), evidenceChars: partial.evidence.length, promptChars: partial.positive.length, score: partial.score, subject: partial.subject });
      const result = await onEarlyScene(partial);
      window.__ndEarlyTimeline.push({ type: 'callback-exit', at: Date.now(), accepted: !!result });
      return result;
    }));
    const originalControllerAnalyze = c.analyze.bind(c);
    c.analyze = async (...args) => {
      const row = { at: Date.now(), rangeChars: Math.max(0, Number(args[3]) - Number(args[2])), mode: args[4] === 'fallback' ? 'fallback' : args[4] === true ? 'manual' : 'automatic' };
      try {
        const result = await originalControllerAnalyze(...args);
        row.scenes = result.scenes.length;
        window.__ndControllerTimeline.push(row);
        return result;
      } catch (error) {
        const message = String(error.message || '').toLowerCase();
        row.error = /source|prefix|binding|原文|消息已改/.test(message) ? 'source-binding' : /timeout|timed out|超时/.test(message) ? 'timeout' : 'controller-error';
        row.stack = String(error.stack || '').split('\n').slice(1, 4).map(line => line.trim().slice(-180));
        window.__ndControllerTimeline.push(row);
        throw error;
      }
    };
    const originalIssuePrompt = c.issuePrompt.bind(c);
    c.issuePrompt = async (...args) => {
      window.__ndPromptTimeline.push({ type: 'issue-start', at: Date.now(), origin: args[2], evidenceChars: args[1]?.evidence?.length || 0, promptChars: String(args[3] || '').length });
      const record = await originalIssuePrompt(...args);
      window.__ndPromptTimeline.push({ type: 'issue-saved', at: Date.now(), created: record.created, state: record.state });
      return record;
    };
    const originalStartRound = c.startRound.bind(c);
    c.startRound = (...args) => { window.__ndEventTimeline.push({ type: 'controller-start-round', at: Date.now(), args: summarizeArgs(args) }); return originalStartRound(...args); };
    const originalPump = c.pump.bind(c);
    c.pump = round => {
      const lastDom = [...document.querySelectorAll('#chat .mes')].at(-1), lastText = lastDom?.querySelector('.mes_text');
      window.__ndPumpTimeline.push({ at: Date.now(), cursor: round?.cursor, final: round?.final, messageChars: ctx.chat.at(-1)?.mes?.length || 0, domChars: lastText?.innerText?.length || 0, domMessageId: lastDom?.getAttribute('mesid') || '', domClass: lastDom?.className || '', busy: round?.busy, pending: round?.pending?.length, accepted: round?.budget?.accepted?.length });
      if (window.__ndPumpTimeline.length > 80) window.__ndPumpTimeline.shift();
      return originalPump(round);
    };
  });
  backupTaken = true;

  if (process.argv.includes('--parameter-probe')) {
    const probes = await page.evaluate(async () => {
      const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
      const { DIRECTOR_SCHEMA } = await import('/scripts/extensions/third-party/st-narrative-director/schema.mjs');
      const outcomes = [];
      for (const temperature of [undefined, 0, 0.2, 1]) {
        const body = { ...c.api.connection(), stream: false, max_tokens: 96, reasoning_effort: 'minimal', messages: [{ role: 'system', content: 'Return JSON only, matching the supplied schema.' }, { role: 'user', content: '{"scenes":[],"state_updates":[]}' }], json_schema: { name: 'scene_director', strict: false, value: DIRECTOR_SCHEMA } };
        if (temperature !== undefined) body.temperature = temperature;
        const started = performance.now();
        try { const response = await c.api.post('/api/backends/chat-completions/generate', body, AbortSignal.timeout(30000)); outcomes.push({ temperature: temperature ?? 'omitted', ok: true, ms: Math.round(performance.now() - started), finish: response.choices?.[0]?.finish_reason }); }
        catch (error) { outcomes.push({ temperature: temperature ?? 'omitted', ok: false, ms: Math.round(performance.now() - started), status: error.status || 0, message: error.message }); }
      }
      return outcomes;
    });
    await sleep(1200);
    report.parameterProbe = probes;
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: 'parameter-probe', probes }));
    return;
  }

  if (process.argv.includes('--analyze-latest')) {
    const probe = await page.evaluate(async () => {
      const ctx = SillyTavern.getContext();
      const c = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller;
      const { DIRECTOR_SYSTEM } = await import('/scripts/extensions/third-party/st-narrative-director/core.mjs');
      const { DIRECTOR_SCHEMA } = await import('/scripts/extensions/third-party/st-narrative-director/schema.mjs');
      const originalAnalyze = c.api.analyze.bind(c.api);
      let captured = null;
      c.api.analyze = (input, signal) => { captured = structuredClone(input); return originalAnalyze(input, signal); };
      const index = ctx.chat.length - 1;
      const raw = ctx.chat[index]?.mes || '';
      let primary;
      try {
        const result = await c.analyze(index, raw, 0, raw.length, false, new AbortController().signal);
        primary = { ok: true, scenes: result.scenes.length };
      } catch (error) { primary = { ok: false, name: error.name, message: error.message, status: error.status || 0, retryAfter: error.retryAfter || 0 }; }
      c.api.analyze = originalAnalyze;
      const variants = [
        ['original', captured],
        ['without_card', { ...captured, character_card: {} }],
        ['card_name_only', { ...captured, character_card: { name: captured.character_card?.name || '' } }],
        ['card_without_description', { ...captured, character_card: { ...captured.character_card, description: '' } }],
        ['card_without_scenario', { ...captured, character_card: { ...captured.character_card, scenario: '' } }],
        ['card_without_lore', { ...captured, character_card: { ...captured.character_card, lore: [] } }],
        ['card_description_600', { ...captured, character_card: { ...captured.character_card, description: String(captured.character_card?.description || '').slice(0, 600) } }],
        ['lore_content_blank', { ...captured, character_card: { ...captured.character_card, lore: (captured.character_card?.lore || []).map(entry => ({ ...entry, content: '' })) } }],
        ...((captured.character_card?.lore || []).map((entry, index) => [`lore_item_${index + 1}`, { ...captured, character_card: { ...captured.character_card, lore: [entry] } }])),
        ['lore_content_80', { ...captured, character_card: { ...captured.character_card, lore: (captured.character_card?.lore || []).map(entry => ({ ...entry, content: String(entry.content || '').slice(0, 80) })) } }],
        ['without_history', { ...captured, PREVIOUS_CONTEXT: { recent: '', states: [] } }],
        ['without_visual_memory', { ...captured, visual_registry: [], original_profiles: [], original_outfits: [], active_lore: [], already_chosen: [] }],
        ['story_only', { ...captured, PREVIOUS_CONTEXT: { recent: '', states: [] }, character_card: {}, original_profiles: [], original_outfits: [], active_lore: [], visual_registry: [], already_chosen: [], renderer_style: {}, CURRENT_TEXT: 'A woman enters a bright hall and greets her friend.' }],
      ];
      const outcomes = [];
      for (const [name, input] of variants) {
        if (!input) { outcomes.push({ name, skipped: true }); continue; }
        const body = { ...c.api.connection(), stream: false, temperature: 0.2, max_tokens: 1500, reasoning_effort: 'minimal', messages: [{ role: 'system', content: DIRECTOR_SYSTEM }, { role: 'user', content: JSON.stringify(input) }], json_schema: { name: 'scene_director', strict: false, value: DIRECTOR_SCHEMA } };
        const started = performance.now();
        try { const result = await c.api.post('/api/backends/chat-completions/generate', body, AbortSignal.timeout(30000)); outcomes.push({ name, ok: true, ms: Math.round(performance.now() - started), contentChars: String(result.choices?.[0]?.message?.content || '').length }); }
        catch (error) { outcomes.push({ name, ok: false, ms: Math.round(performance.now() - started), status: error.status || 0, message: error.message }); }
      }
      const card = captured?.character_card || {};
      return { primary, variants: outcomes, shape: captured ? Object.fromEntries(Object.entries(captured).map(([key, value]) => [key, Array.isArray(value) ? `array:${value.length}` : typeof value === 'string' ? `string:${value.length}` : typeof value])) : null, cardShape: { keys: Object.keys(card), nameChars: String(card.name || '').length, descriptionChars: String(card.description || '').length, scenarioChars: String(card.scenario || '').length, loreCount: card.lore?.length || 0, loreLengths: (card.lore || []).map(entry => String(entry.content || '').length) } };
    });
    await sleep(1200);
    report.analysisProbe = probe;
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: 'analysis-probe', probe }));
    return;
  }

  if (useNewChat) {
    await page.locator('#options_button').click();
    await page.locator('#option_start_new_chat').click({ force: true });
    const newChatDialog = page.locator('dialog.popup').filter({ hasText: '开始新聊天？' });
    await newChatDialog.waitFor({ state: 'visible', timeout: 10000 });
    const deleteOldChat = newChatDialog.locator('#del_chat_checkbox');
    if (await deleteOldChat.isChecked()) throw new Error('New-chat confirmation unexpectedly has delete-current-chat enabled');
    await newChatDialog.getByRole('button', { name: '确定' }).click();
    await page.waitForTimeout(1200);
    const afterNewChat = await state();
    if (afterNewChat.chatId === initial.chatId || afterNewChat.chatLength >= initial.chatLength) {
      throw new Error(`Could not safely open a separate chat; original remains selected. current=${afterNewChat.chatId} messages=${afterNewChat.chatLength}`);
    }
    testChatId = afterNewChat.chatId;
    report.testChat = { initialMessages: afterNewChat.chatLength, mode: 'new-chat' };
  } else {
    testChatId = initial.chatId;
    report.testChat = { initialMessages: initial.chatLength, mode: 'existing-roleplay-chat' };
  }

  await page.evaluate(() => {
    window.__ndRoundEvents.ended = 0;
    window.__ndRoundEvents.started = 0;
    window.__ndRoundEvents.startedAt = 0;
    window.__ndRoundEvents.lastEndedAt = 0;
    window.__ndEventTimeline = [];
    window.__ndTokenStats = { calls: 0, chars: 0, firstAt: 0, lastAt: 0, firstMessageChars: 0, lastMessageChars: 0, minEventChars: Infinity, maxEventChars: 0, samples: [], lastSamples: [] };
    window.__ndPreviousTokenPayload = '';
    window.__ndPumpTimeline = [];
  });

  for (let i = 0; i < runCount; i++) {
    const round = i + 1;
    stage = `send-test-round-${round}`;
    const before = await page.evaluate(() => ({ count: SillyTavern.getContext().chat.length, ended: window.__ndRoundEvents.ended }));
    const userMessage = scenarios[(scenarioOffset + i) % scenarios.length];
    await page.locator('#send_textarea').fill(userMessage);
    await page.locator('#send_but').click();
    console.log(JSON.stringify({ event: 'round-started', round, chatMessages: before.count }));
    await page.waitForFunction(({ count, ended }) => {
      const ctx = SillyTavern.getContext();
      return window.__ndRoundEvents.ended > ended && ctx.chat.length >= count + 2 && !ctx.chat.at(-1)?.is_user;
    }, { count: before.count, ended: before.ended }, { timeout: 300000 }).catch(async error => {
      const detail = await page.evaluate(() => ({
        chatId: SillyTavern.getContext().getCurrentChatId?.(),
        messages: SillyTavern.getContext().chat.map(m => ({ user: !!m.is_user, chars: (m.mes || '').length })),
        events: window.__ndRoundEvents,
        hasStatus: !!document.querySelector('.nd-status')?.textContent,
        statusEventCount: window.__ndStatusEvents?.length || 0,
        directorRound: (() => { const r = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.round; return r && { cursor: r.cursor, final: r.final, failed: r.failed, pending: r.pending.length, accepted: r.budget.accepted.length }; })(),
      }));
      report.diagnostic = detail;
      throw new Error(`Round ${round}: roleplay reply did not finish: ${JSON.stringify(detail)}; ${error.message}`);
    });
    const replyChars = await page.evaluate(() => String(SillyTavern.getContext().chat.at(-1)?.mes || '').length);
    console.log(JSON.stringify({ event: 'reply-finished', round, replyChars }));

    stage = `wait-for-prompt-round-${round}`;
    await page.waitForFunction(index => {
      const ctx = SillyTavern.getContext();
      const meta = ctx.chat.at(-1)?.extra?.narrative_director_v1;
      return ctx.chat.length - 1 > index && (meta?.prompts || []).some(p => p.origin === 'automatic');
    }, before.count, { timeout: 60000 }).catch(async error => {
      const detail = await snapshotForRound(round);
      report.diagnostic = detail;
      throw new Error(`Round ${round}: no automatic prompt was issued after ${detail.messageChars} message characters; ${error.message}`);
    });
    const promptState = await page.evaluate(() => {
      const message = SillyTavern.getContext().chat.at(-1);
      const prompts = (message?.extra?.narrative_director_v1?.prompts || []).filter(p => p.origin === 'automatic');
      return { count: prompts.length, states: prompts.map(p => p.state) };
    });
    console.log(JSON.stringify({ event: 'prompt-recorded', round, promptCount: promptState.count, states: promptState.states }));

    stage = `wait-for-all-images-round-${round}`;
    await page.waitForFunction(index => {
      const ctx = SillyTavern.getContext();
      const aiIndex = ctx.chat.length - 1;
      const meta = ctx.chat[aiIndex]?.extra?.narrative_director_v1 || {};
      const root = document.querySelector(`#chat .mes[mesid="${aiIndex}"]`);
      const prompts = (meta.prompts || []).filter(p => p.origin === 'automatic');
      const loadedImages = [...(root?.querySelectorAll('.st-chatu8-image-span img, .nd-image img') || [])]
        .filter(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
      const round = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.round;
      const finishing = globalThis[Symbol.for('st.narrative-director.debug.v1')].controller.finishingRounds;
      const terminal = prompts.length > 0 && prompts.every(p => ['done', 'failed'].includes(p.state));
      const allCallbacksAndImages = prompts.length > 0 && prompts.every(p => p.state === 'done') && loadedImages.length >= prompts.length;
      const analysisSettled = !round?.busy && (!round?.final || round.finalProcessed) && (!finishing || finishing.size === 0);
      return aiIndex >= index + 1 && terminal && (allCallbacksAndImages || prompts.some(p => p.state === 'failed')) && analysisSettled;
    }, before.count, { timeout: 180000 }).catch(async error => {
      const detail = await snapshotForRound(round);
      report.diagnostic = detail;
      throw new Error(`Round ${round}: not every automatic prompt finished its Chatu callback and loaded an image: ${JSON.stringify(detail)}; ${error.message}`);
    });
    const settled = await page.evaluate(index => {
      const ctx = SillyTavern.getContext();
      const message = ctx.chat.at(-1);
      const prompts = (message?.extra?.narrative_director_v1?.prompts || []).filter(p => p.origin === 'automatic');
      return { promptCount: prompts.length, states: prompts.map(p => p.state) };
    }, before.count);
    console.log(JSON.stringify({ event: 'image-loaded', round, promptCount: settled.promptCount, states: settled.states }));

    await page.waitForTimeout(600);
    stage = `validate-round-${round}`;
    const result = await snapshotForRound(round);
    report.partialRounds ||= [];
    report.partialRounds.push(result);
    result.replyIndex = before.count + 1;
    if (!result.prompts.length) throw new Error(`Round ${round}: no automatic prompt record`);
    if (result.prompts.length > 2) throw new Error(`Round ${round}: more than two automatic prompts were issued`);
    if (result.prompts.some(p => p.state !== 'done')) throw new Error(`Round ${round}: not every Chatu prompt callback completed successfully`);
    if (result.images.filter(image => image.width > 0 && image.height > 0).length < result.prompts.length) throw new Error(`Round ${round}: not every automatic prompt has a loaded image`);
    if (result.nonEnglishPrompt) throw new Error(`Round ${round}: non-English prompt`);
    if (result.leakedPrompt) throw new Error(`Round ${round}: prompt marker leaked into story text`);
    if (result.prompts.some(p => !p.beforeReplyEnd)) throw new Error(`Round ${round}: at least one automatic prompt was created only after the reply ended`);
    report.rounds.push(result);
    fs.mkdirSync(path.join(__dirname,'..','artifacts'),{recursive:true});
    const visibleImage=page.locator(`#chat .mes[mesid="${result.messageIndex}"] .nd-chatu-prompt img`).first();
    await visibleImage.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    result.imageDisplay=await visibleImage.evaluate(img=>({display:getComputedStyle(img).display,visibility:getComputedStyle(img).visibility,opacity:getComputedStyle(img).opacity,rect:{width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}}));
    await visibleImage.screenshot({path:path.join(__dirname,'..','artifacts',`live-round-${round}.png`)});
    console.log(JSON.stringify({ event: 'round-passed', round, promptCount: result.promptCount, images: result.images, promptCreatedMidReply: result.prompts.some(p => p.beforeReplyEnd), model: result.imageRecords[0]?.model, status: result.status }));
  }

  report.finishedAt = new Date().toISOString();
  report.passed = report.rounds.length === runCount;
})().catch(error => {
  report.failure = error.name || 'Error';
  report.failureStage = stage;
  const message = String(error.message || '');
  report.failureCode = message.startsWith('No active character chat') ? 'no-active-character-chat'
    : message.startsWith('Director automatic mode') ? 'director-disabled-or-key-missing'
    : message.startsWith('Chatu marker') ? 'chatu-marker-or-auto-click-mismatch'
    : /Timeout/i.test(message) ? 'timeout'
    : `${stage}-error`;
  console.error(JSON.stringify({ event: 'round-failed', completed: report.rounds.length, failure: report.failure, stage, code: report.failureCode }));
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (backupTaken) await restoreSideEffects();
    await restoreTestChat();
    if (report.startedAt) {
      fs.mkdirSync(path.join(__dirname, '..', 'artifacts'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'live-ten-rounds.json'), JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error('CLEANUP_ERROR', error.name || 'Error');
    process.exitCode = 1;
  }
  await browser?.close();
});
