// Claude assistant — runs on the user's own Claude subscription through the local Claude Code login.
import { W, T, saveT, newItem } from './state.js';
import { $, h, esc, icon, md, toast, ask, uid, bus, modal, kvRow } from './ui.js';
import { activeTab, rt, markDirty, openTab } from './tabs.js';
import { importText } from './importers.js';

let status = { loggedIn: false, reason: 'Checking…' };
const chat = []; // {role, text, label, pending}
let currentId = null;
const deltas = new Map();
api.on('ai-delta', ({ id, delta }) => { const fn = deltas.get(id); fn?.(delta); });

export async function checkAi() {
  status = await api.aiStatus();
  const b = $('#btnAi');
  b.classList.toggle('on', status.loggedIn);
  b.title = status.loggedIn ? `Claude AI — signed in${status.email ? ' as ' + status.email : ''}` : `Claude AI — ${status.reason}`;
  bus.emit('ai-status', status);
  return status;
}
export const aiStatus = () => status;

const SECRET_KEYS = /authorization|token|secret|password|api[-_]?key|cookie|session/i;
const mask = v => (v ? String(v).slice(0, 4) + '••••' : v);
function contextFor(tab) {
  if (!tab) return 'No request is open.';
  const d = tab.draft || {};
  const r = rt(tab);
  const hdrs = (d.headers || []).filter(x => x.on !== false && x.key).map(x => `${x.key}: ${SECRET_KEYS.test(x.key) ? mask(x.value) : x.value}`);
  const auth = d.auth ? Object.fromEntries(Object.entries(d.auth).map(([k, v]) => [k, typeof v === 'string' && /token|secret|password|key/i.test(k) && k !== 'key' ? mask(v) : v])) : undefined;
  if (auth) delete auth.tokenInfo;
  const req = { type: d.kind || 'http', name: d.name, method: d.method, url: d.url, headers: hdrs, auth, body: d.body?.mode === 'raw' ? d.body.raw?.slice(0, 6000) : d.body?.mode === 'graphql' ? d.body.graphql : d.body?.mode && d.body.mode !== 'none' ? { mode: d.body.mode, fields: (d.body[d.body.mode] || []).map?.(x => x.key) } : undefined, preRequestScript: d.pre || undefined, postResponseScript: d.tests || undefined };
  if (d.kind === 'grpc') Object.assign(req, { service: d.service, method: d.method, message: d.message });
  if (['ws', 'socketio', 'sse', 'mqtt'].includes(d.kind)) req.recentMessages = (r.messages || []).slice(-15).map(m => `${m.kind}${m.event ? ' [' + m.event + ']' : ''}: ${String(m.data ?? m.text ?? '').slice(0, 400)}`);
  let res = null;
  if (r.res) {
    const x = r.res;
    res = x.ok ? { status: `${x.status} ${x.statusText}`, timeMs: x.time, sizeBytes: x.size, headers: (x.headers || []).map(([k, v]) => `${k}: ${/set-cookie/i.test(k) ? mask(v) : v}`), body: x.body != null ? (x.body.length > 14000 ? x.body.slice(0, 14000) + '\n…[truncated]' : x.body) : `[binary ${x.contentType}]`, testResults: x.tests, scriptErrors: x.errors, sentUrl: x.sent?.url }
      : { error: x.error, code: x.code };
  }
  return `CURRENT REQUEST (secrets masked):\n${JSON.stringify(req, null, 2)}\n\nLAST RESPONSE:\n${res ? JSON.stringify(res, null, 2) : '(not sent yet)'}`;
}

async function claude(prompt, onDelta) {
  if (!status.loggedIn) await checkAi();
  if (!status.loggedIn) throw new Error(status.reason);
  const id = uid();
  currentId = id;
  if (onDelta) deltas.set(id, onDelta);
  try {
    const r = await api.aiAsk({ id, prompt, model: W.settings.ai?.model || undefined });
    if (!r.ok) throw new Error(r.error);
    return r.text;
  } finally { deltas.delete(id); if (currentId === id) currentId = null; }
}

// ---------- panel ----------
export function toggleAi(force) {
  T.ui.aiOpen = force ?? !T.ui.aiOpen;
  $('#ai').classList.toggle('open', T.ui.aiOpen);
  saveT();
  if (T.ui.aiOpen) { renderAi(); setTimeout(() => $('#aiInput')?.focus(), 50); }
}

const QUICK = {
  http: [['explain', 'Explain response'], ['tests', 'Write tests'], ['debug', 'Debug'], ['docs', 'Document'], ['pre', 'Pre-request script'], ['body', 'Example body']],
  graphql: [['explain', 'Explain response'], ['gql', 'Improve query'], ['tests', 'Write tests'], ['debug', 'Debug']],
  realtime: [['rt-explain', 'Explain messages'], ['rt-msg', 'Draft a message'], ['debug', 'Debug connection']],
  grpc: [['grpc-msg', 'Example message'], ['explain', 'Explain response'], ['debug', 'Debug']],
  other: [['general', 'What can you do?']],
};
const PROMPTS = {
  explain: 'Explain this response: what it means, the important fields, and anything unusual (status, headers, errors, performance).',
  tests: 'Write a thorough post-response test script for this request (status, response time, content type, JSON schema/fields, key values, and set useful variables for chaining). Output ONE ```js code block, then one short sentence.',
  debug: 'This request failed or returned something unexpected. Diagnose the most likely causes and give concrete fixes (URL, method, headers, auth, body, variables, TLS/proxy).',
  docs: 'Write concise Markdown API documentation for this endpoint: purpose, parameters, headers, body schema, example request and response, error cases.',
  pre: 'Suggest a useful pre-request script for this request (dynamic values, auth token fetching, signing, timestamps). Output ONE ```js code block.',
  body: 'Generate a realistic example request body for this endpoint. Output ONE ```json code block only.',
  gql: 'Review and improve this GraphQL query (fragments, variables, avoid over-fetching). Output the improved query in ONE ```graphql code block, then the variables in a ```json block.',
  'rt-explain': 'Explain the recent messages on this realtime connection and point out anything wrong.',
  'rt-msg': 'Draft a useful message to send on this connection, based on the messages seen so far. Output ONE ```json code block.',
  'grpc-msg': 'Write a realistic example request message for this gRPC method. Output ONE ```json code block.',
  general: 'Briefly list what you can help with in this API client.',
};

export function renderAi() {
  const el = $('#ai');
  if (!el.classList.contains('open')) return;
  el.replaceChildren();
  const tab = activeTab();
  const kind = tab?.kind === 'request' ? (['ws', 'socketio', 'sse', 'mqtt'].includes(tab.draft.kind) ? 'realtime' : tab.draft.kind === 'grpc' ? 'grpc' : tab.draft.kind === 'graphql' ? 'graphql' : 'http') : 'other';
  const head = h(`<div class="ai-head">${icon('spark')} Claude<span class="dim" style="font-weight:400;font-size:12px">${status.loggedIn ? 'using your subscription' : ''}</span><span class="sp"></span>${currentId ? `<button class="ghost sm" data-stop title="Stop">${icon('stop')}</button>` : ''}<button class="ghost sm" data-clear title="New chat">${icon('refresh')}</button><button class="ghost sm" data-close title="Close">${icon('x')}</button></div>`);
  head.querySelector('[data-close]').onclick = () => toggleAi(false);
  head.querySelector('[data-clear]').onclick = () => { chat.length = 0; renderAi(); };
  head.querySelector('[data-stop]')?.addEventListener('click', () => api.aiCancel(currentId));
  const msgs = h(`<div class="ai-msgs" role="log" aria-live="polite"></div>`);
  if (!status.loggedIn) {
    const e = h(`<div class="empty" style="text-align:left;margin:0"><div class="big">${icon('spark')} Connect Claude</div><p>AI features use <b>your own Claude subscription</b> through Claude Code — no API key needed.</p><ol style="padding-left:18px;line-height:1.9"><li>Install Claude Code:<br><code>curl -fsSL https://claude.ai/install.sh | bash</code></li><li>Sign in: <code>claude auth login</code></li><li>Click <b>Re-check</b></li></ol><p class="dim">${esc(status.reason || '')}</p><button class="primary" data-re>${icon('refresh')} Re-check</button></div>`);
    e.querySelector('[data-re]').onclick = () => checkAi().then(renderAi);
    msgs.append(e);
  } else if (!chat.length) msgs.append(h(`<div class="empty" style="margin:auto 0">${icon('spark')}<div class="big">Ask Claude about this ${kind === 'other' ? 'workspace' : 'request'}</div><div class="dim">Claude sees the current request and its last response (secrets masked).</div></div>`));
  for (const m of chat) msgs.append(renderMsg(m));
  const quick = h(`<div class="ai-quick">${QUICK[kind].map(([k, l]) => `<button data-q="${k}">${l}</button>`).join('')}</div>`);
  quick.onclick = e => { const b = e.target.closest('[data-q]'); if (b) askAi(PROMPTS[b.dataset.q], b.textContent); };
  const askBox = h(`<div class="ai-ask"><textarea id="aiInput" placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"></textarea><button class="primary" data-send aria-label="Send">${icon('send')}</button></div>`);
  const ta = askBox.querySelector('textarea');
  askBox.querySelector('[data-send]').onclick = () => { const v = ta.value.trim(); if (v) { ta.value = ''; askAi(v); } };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askBox.querySelector('[data-send]').click(); } };
  el.append(head, msgs, ...(status.loggedIn ? [quick, askBox] : []));
  msgs.scrollTop = msgs.scrollHeight;
}

function renderMsg(m) {
  if (m.role === 'user') return h(`<div class="ai-msg u">${esc(m.label || m.text)}</div>`);
  const d = h(`<div class="ai-msg a ${m.pending ? 'cursor-blink' : ''}"></div>`);
  d.innerHTML = m.text ? md(m.text) : (m.pending ? '<span class="spin"></span> Thinking…' : '');
  if (m.error) d.innerHTML = `<div class="callout warn">${esc(m.error)}</div>`;
  if (!m.pending) d.querySelectorAll('pre').forEach(p => p.after(codeActions(p.textContent, p.dataset.lang)));
  return d;
}

function codeActions(code, lang) {
  const bar = h(`<div class="ai-code-actions"></div>`);
  const add = (label, fn) => { const b = h(`<button class="sm">${label}</button>`); b.onclick = fn; bar.append(b); };
  add('Copy', () => { navigator.clipboard.writeText(code); toast('Copied'); });
  const tab = activeTab();
  const d = tab?.draft;
  if (!d || tab.kind !== 'request') return bar;
  const isJs = /^(js|javascript)?$/.test(lang) && /pm\.|postman\./.test(code);
  const goto = sub => { const r = rt(tab); r.reqTab = sub; bus.emit('render-view'); };
  if (isJs) {
    add('Add to Post-response', () => { d.tests = (d.tests ? d.tests.trimEnd() + '\n\n' : '') + code; rt(tab).scriptTab = 'post'; markDirty(tab); goto('scripts'); toast('Added to Post-response script'); });
    add('Add to Pre-request', () => { d.pre = (d.pre ? d.pre.trimEnd() + '\n\n' : '') + code; rt(tab).scriptTab = 'pre'; markDirty(tab); goto('scripts'); toast('Added to Pre-request script'); });
  }
  if (lang === 'json' && (d.kind === 'http' || !d.kind)) add('Use as body', () => { d.body = { ...d.body, mode: 'raw', lang: 'json', raw: code.trim() }; markDirty(tab); goto('body'); });
  if (lang === 'json' && ['ws', 'socketio', 'mqtt'].includes(d.kind)) add('Use as message', () => { d.draft = { ...d.draft, data: code.trim(), format: 'json' }; markDirty(tab); goto('message'); });
  if (lang === 'json' && d.kind === 'grpc') add('Use as message', () => { d.message = code.trim(); markDirty(tab); bus.emit('render-view'); });
  if (lang === 'graphql' && d.body?.mode === 'graphql') add('Use as query', () => { d.body.graphql.query = code.trim(); markDirty(tab); bus.emit('render-view'); });
  return bar;
}

export async function askAi(text, label) {
  if (!T.ui.aiOpen) toggleAi(true);
  const tab = activeTab();
  const history = chat.filter(m => !m.pending && !m.error).slice(-8).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n');
  chat.push({ role: 'user', text, label });
  const slot = { role: 'assistant', text: '', pending: true };
  chat.push(slot);
  renderAi();
  const msgsEl = () => $('#ai .ai-msgs');
  let raf = 0;
  const onDelta = delta => {
    slot.text += delta;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!slot.pending) return; // final render already happened; don't clobber its action buttons
      const last = msgsEl()?.lastElementChild;
      if (last) { last.innerHTML = md(slot.text); const m = msgsEl(); if (m.scrollHeight - m.scrollTop - m.clientHeight < 80) m.scrollTop = m.scrollHeight; }
    });
  };
  try {
    slot.text = await claude(`${contextFor(tab)}\n\n${history ? 'CONVERSATION SO FAR:\n' + history + '\n\n' : ''}User: ${text}`, onDelta);
  } catch (e) { if (!slot.text) slot.error = e.message; else slot.text += `\n\n_(${e.message})_`; }
  slot.pending = false;
  if (raf) cancelAnimationFrame(raf);
  renderAi();
}

const extractJson = s => { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('Claude did not return JSON'); return JSON.parse(s.slice(a, b + 1)); };

export async function aiGenerateRequest(tab) {
  const v = await ask('✨ Build a request with Claude', [['text', 'Describe what you want (e.g. "Create a GitHub issue in my repo using a token from {{githubToken}}, and test that it returns 201")', '']], 'Generate');
  if (!v?.text) return;
  toast('Claude is building your request…');
  try {
    const vars = [...new Set([...W.globals, ...(W.environments.find(e => e.id === W.activeEnv)?.vars || [])].map(x => x.key).filter(Boolean))];
    const out = await claude(`Build an HTTP request from this description. Respond with ONLY raw JSON (no code fences):
{"name":string,"method":string,"url":string,"headers":[{"key":string,"value":string}],"body":{"mode":"none"|"raw"|"urlencoded","lang":"json"|"text"|"xml","raw":string,"urlencoded":[{"key":string,"value":string}]},"auth":{"type":"none"|"bearer"|"basic"|"apikey","token"?:string,"username"?:string,"password"?:string,"key"?:string,"value"?:string,"in"?:"header"|"query"},"tests":string,"description":string}
Use {{variable}} placeholders for secrets the user did not provide. "tests" is a Postman-style test script (may be empty).
Variables that already exist: ${JSON.stringify(vars)}
Description: ${v.text}`);
    const j = extractJson(out);
    const r = newItem('http');
    Object.assign(r, {
      name: j.name || 'AI request', method: (j.method || 'GET').toUpperCase(), url: j.url || '', description: j.description || '',
      headers: (j.headers || []).map(x => kvRow(x.key, x.value)), tests: j.tests || '',
      body: { ...r.body, ...(j.body || {}), urlencoded: (j.body?.urlencoded || []).map(x => kvRow(x.key, x.value)) },
      auth: j.auth?.type && j.auth.type !== 'none' ? j.auth : { type: 'inherit' },
    });
    const { urlToParams } = await import('./views/http.js');
    urlToParams(r);
    const empty = tab && tab.kind === 'request' && !tab.ref && !tab.draft.url && (tab.draft.kind === 'http' || !tab.draft.kind);
    if (empty) { tab.draft = r; markDirty(tab); bus.emit('tab'); }
    else { openTab({ kind: 'request', draft: r }); markDirty(); }
    toast('Request ready — review and Send');
  } catch (e) { toast('AI: ' + e.message, 'error'); }
}

export async function aiGenerateCollection() {
  const v = await ask('✨ Generate a collection with Claude', [['text', 'Describe the API (e.g. "CRUD for a todo API at {{baseUrl}}/todos with auth via bearer token, with tests")', '']], 'Generate');
  if (!v?.text) return;
  const wait = h(`<div class="row-flex"><span class="spin"></span> Claude is designing the collection… this can take a minute.</div>`);
  modal({ title: 'Generating collection', body: wait, buttons: [] });
  try {
    const out = await claude(`Generate a Postman Collection v2.1 JSON for this API description. Respond with ONLY raw JSON (no code fences). Include folders where sensible, realistic example bodies, {{baseUrl}} and other {{variables}} in a top-level "variable" array, and test scripts (event listen "test") per request.
Description: ${v.text}`);
    const res = importText(JSON.stringify(extractJson(out)));
    document.querySelector('.modal')?.close?.();
    toast(`Created collection "${res[0]?.name}"`);
    bus.emit('tree');
  } catch (e) { document.querySelector('.modal')?.close?.(); toast('AI: ' + e.message, 'error'); }
}
