// HTTP + GraphQL request editor.
import { W, T, find, varMap, saveT, saveW, kindBadge } from '../state.js';
import { h, esc, icon, kvTable, kvRow, toast, menuFor, md, uid, bus, dragResize, varOverlay, clone } from '../ui.js';
import { createEditor, formatEditor } from '../editor.js';
import { rt, markDirty, saveTab, renderTabs } from '../tabs.js';
import { renderAuth } from './auth.js';
import { renderResponse, saveToFile, saveAsExample } from './response.js';
import { execute, effectiveAuth, buildHttp, chainOf } from '../execute.js';
import { parseCurl } from '../importers.js';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'COPY', 'LINK', 'UNLINK', 'PURGE', 'LOCK', 'UNLOCK', 'PROPFIND', 'VIEW'];

// ---------- URL <-> params ----------
export function urlToParams(d) {
  const url = d.url || '';
  const qi = url.indexOf('?');
  const q = qi >= 0 ? url.slice(qi + 1).split('#')[0] : '';
  const parsed = q ? q.split('&').filter(Boolean).map(p => { const i = p.indexOf('='); return kvRow(i < 0 ? p : p.slice(0, i), i < 0 ? '' : p.slice(i + 1)); }) : [];
  const old = d.params || [];
  parsed.forEach((p, i) => { if (old[i]?.on && old[i].key === p.key) p.desc = old[i].desc; });
  d.params = [...parsed, ...old.filter(p => !p.on)];
  const path = (qi >= 0 ? url.slice(0, qi) : url).replace(/^[a-z]+:\/\/[^/]*/i, '');
  const names = [...path.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map(m => m[1]);
  const prev = d.pathVars || [];
  d.pathVars = names.map(k => prev.find(p => p.key === k) || kvRow(k, ''));
}
export function paramsToUrl(d) {
  const url = d.url || '';
  const qi = url.indexOf('?');
  const base = qi >= 0 ? url.slice(0, qi) : url;
  const q = (d.params || []).filter(p => p.on && p.key).map(p => p.value === '' ? p.key : `${p.key}=${p.value}`).join('&');
  d.url = base + (q ? '?' + q : '');
}

const HEADER_NAMES = ['Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language', 'Authorization', 'Cache-Control', 'Connection', 'Content-Disposition', 'Content-Encoding', 'Content-Language', 'Content-Length', 'Content-Type', 'Cookie', 'Date', 'Expect', 'Forwarded', 'From', 'Host', 'If-Match', 'If-Modified-Since', 'If-None-Match', 'If-Range', 'If-Unmodified-Since', 'Origin', 'Pragma', 'Prefer', 'Range', 'Referer', 'TE', 'User-Agent', 'Upgrade', 'Via', 'X-API-Key', 'X-Correlation-ID', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-HTTP-Method-Override', 'X-Request-ID', 'X-Requested-With'];
if (!document.getElementById('hdr-names')) document.body.append(h(`<datalist id="hdr-names">${HEADER_NAMES.map(n => `<option value="${n}">`).join('')}</datalist>`));

export const SNIPPETS = {
  post: {
    'Status code is 200': "pm.test(\"Status code is 200\", function () {\n  pm.response.to.have.status(200);\n});\n",
    'Response time is less than 200ms': "pm.test(\"Response time is less than 200ms\", function () {\n  pm.expect(pm.response.responseTime).to.be.below(200);\n});\n",
    'Response body: JSON value check': "pm.test(\"Your test name\", function () {\n  const jsonData = pm.response.json();\n  pm.expect(jsonData.value).to.eql(100);\n});\n",
    'Response body: Contains string': "pm.test(\"Body matches string\", function () {\n  pm.expect(pm.response.text()).to.include(\"string_you_want_to_search\");\n});\n",
    'Response body: Is equal to a string': "pm.test(\"Body is correct\", function () {\n  pm.response.to.have.body(\"response_body_string\");\n});\n",
    'Content-Type header is present': "pm.test(\"Content-Type is present\", function () {\n  pm.response.to.have.header(\"Content-Type\");\n});\n",
    'Status code: Successful POST request': "pm.test(\"Successful POST request\", function () {\n  pm.expect(pm.response.code).to.be.oneOf([201, 202]);\n});\n",
    'Status code: Code name has string': "pm.test(\"Status code name has string\", function () {\n  pm.response.to.have.status(\"Created\");\n});\n",
    'Response matches JSON schema': "const schema = {\n  type: 'object',\n  required: ['id'],\n  properties: { id: { type: ['integer', 'string'] } }\n};\npm.test('Schema is valid', function () {\n  pm.response.to.have.jsonSchema(schema);\n});\n",
    'Set an environment variable': "pm.environment.set(\"variable_key\", pm.response.json().value);\n",
    'Set a global variable': "pm.globals.set(\"variable_key\", \"variable_value\");\n",
    'Set a collection variable': "pm.collectionVariables.set(\"variable_key\", \"variable_value\");\n",
    'Get an environment variable': "const value = pm.environment.get(\"variable_key\");\n",
    'Clear an environment variable': "pm.environment.unset(\"variable_key\");\n",
    'Send a request': "pm.sendRequest(\"https://postman-echo.com/get\", function (err, response) {\n  console.log(response.json());\n});\n",
    'Visualize response as a table': "const template = `<table border=1 cellpadding=6>\n  {{#each rows}}<tr><td>{{@index}}</td><td>{{this}}</td></tr>{{/each}}\n</table>`;\nconst data = pm.response.json();\npm.visualizer.set(template, { rows: Array.isArray(data) ? data.map(JSON.stringify) : Object.entries(data).map(e => e.join(': ')) });\n",
    'Run next request by name': "pm.execution.setNextRequest(\"Request name\");\n",
  },
  pre: {
    'Set a timestamp variable': "pm.environment.set(\"timestamp\", Date.now());\n",
    'Generate a random UUID': "pm.variables.set(\"requestId\", require('uuid').v4());\n",
    'Add a request header': "pm.request.headers.upsert({ key: \"X-Request-Id\", value: pm.variables.replaceIn(\"{{$guid}}\") });\n",
    'Fetch an auth token first': "pm.sendRequest({\n  url: pm.environment.get(\"authUrl\"),\n  method: \"POST\",\n  header: { \"Content-Type\": \"application/json\" },\n  body: { mode: \"raw\", raw: JSON.stringify({ username: pm.environment.get(\"user\"), password: pm.environment.get(\"pass\") }) }\n}, function (err, res) {\n  pm.environment.set(\"token\", res.json().token);\n});\n",
    'HMAC-sign the body': "const sig = CryptoJS.HmacSHA256(pm.request.body.raw || '', pm.environment.get('secret')).toString();\npm.request.headers.upsert({ key: 'X-Signature', value: sig });\n",
    'Get an environment variable': "const value = pm.environment.get(\"variable_key\");\n",
    'Log the request': "console.log(pm.request.method, pm.request.url.toString());\n",
    'Skip this request': "if (!pm.environment.get(\"token\")) pm.execution.skipRequest();\n",
  },
};

// ---------- view ----------
// Terse hints next to each section tab ("Params 2 · Auth Bearer · Body JSON"); '' = nothing set.
function summary(k, d, path) {
  const n = a => (a || []).filter(x => x.on && x.key).length;
  const b = d.body || {};
  switch (k) {
    case 'params': { const c = n(d.params) + (d.pathVars || []).length; return c ? String(c) : ''; }
    case 'auth': {
      const t = d.auth?.type || 'inherit';
      if (t === 'none') return 'none';
      if (t !== 'inherit') return AUTH_SHORT(t);
      const p = [...path].reverse().find(x => x.auth && x.auth.type !== 'inherit');
      return p ? `↑ ${AUTH_SHORT(p.auth.type)}` : '';
    }
    case 'headers': { const c = n(d.headers); return c ? String(c) : ''; }
    case 'body': return { none: '', raw: (b.lang || 'text').toUpperCase(), formdata: `form ${n(b.formdata)}`, urlencoded: `urlenc ${n(b.urlencoded)}`, binary: 'file', graphql: 'GQL' }[b.mode] ?? '';
    case 'query': return b.graphql?.query?.match(/^\s*(mutation|subscription)/)?.[1] || '';
    case 'scripts': return [d.pre?.trim() && 'pre', d.tests?.trim() && 'post'].filter(Boolean).join('+');
    case 'settings': { const c = Object.keys(d.settings || {}).length; return c ? String(c) : ''; }
    case 'docs': return d.description?.trim() ? '✓' : '';
  }
  return '';
}
const AUTH_SHORT = t => ({ bearer: 'Bearer', basic: 'Basic', apikey: 'API key', jwt: 'JWT', digest: 'Digest', oauth1: 'OAuth1', oauth2: 'OAuth2', hawk: 'Hawk', awsv4: 'AWS', ntlm: 'NTLM', akamai: 'EdgeGrid', asap: 'ASAP' }[t] || t);

export function renderHttp(tab, el) {
  const d = tab.draft;
  const r = rt(tab);
  const isGql = d.kind === 'graphql';
  r.reqTab ||= isGql ? 'query' : (d.body?.mode !== 'none' && ['POST', 'PUT', 'PATCH'].includes(d.method) ? 'body' : 'params');
  const path = chainOf(d, tab.ref);
  el.replaceChildren();

  // Stacked: one flowing column (request card, then the dispatch log). Side: two scrolling columns (Ctrl+Alt+V).
  const side = W.settings.layout === 'side';
  const desk = h(`<div class="desk ${side ? 'side' : ''}"></div>`);
  const left = side ? h(`<div class="col"></div>`) : desk, right = side ? h(`<div class="col"></div>`) : desk;
  if (side) {
    const ratio = T.ui.split ?? 0.5;
    desk.style.setProperty('--split', ratio + 'fr');
    desk.style.setProperty('--split2', (1 - ratio) + 'fr');
    const gutter = h(`<div class="gutter" role="separator" aria-label="Resize panes"></div>`);
    desk.append(left, gutter, right);
    let startRatio;
    gutter.addEventListener('mousedown', () => { startRatio = T.ui.split ?? 0.5; });
    dragResize(gutter, {
      axis: 'x',
      onMove: dx => {
        const v = Math.min(.85, Math.max(.15, startRatio + dx / desk.clientWidth));
        T.ui.split = v;
        desk.style.setProperty('--split', v + 'fr'); desk.style.setProperty('--split2', (1 - v) + 'fr');
      },
      onEnd: saveT,
    });
  }
  el.append(desk);

  const crumb = path.length ? path.map(p => p.name).join(' / ') : tab.ref ? '' : 'Unsaved request';
  const card = h(`<section class="reqcard">
    <div class="reqhead">
      <div class="ttl"><span class="eyebrow crumb" title="${esc(crumb)}">${esc(crumb) || '&nbsp;'}</span><input class="nm" value="${esc(d.name)}" spellcheck="false" aria-label="Request name"></div>
      <button data-ai title="Describe a request and let Claude build it">${icon('spark')} Build</button>
      <button data-code title="Generate code snippet">${icon('code')} Code</button>
      <button data-cookies title="Manage cookies">${icon('cookie')} Cookies</button>
      <button data-save title="Save (Ctrl+S)">Save · Ctrl S</button><button class="ghost" data-savemenu title="More save options" aria-label="More save options">${icon('chevD')}</button>
    </div>
    <div class="reqline">
      ${isGql ? '<span class="kindtag">GraphQL</span>' : `<button class="methodbtn ${esc(d.method)}" data-method aria-label="HTTP method" aria-haspopup="menu">${esc(d.method)}${icon('chevD')}</button>`}
      <div class="urlbox"><input class="url var-input" id="urlInput" placeholder="${isGql ? 'Enter GraphQL endpoint URL' : 'Enter URL or paste a cURL command'}" spellcheck="false" aria-label="Request URL"></div>
      <div class="sendgrp"><button class="primary" data-send>Send ${icon('arrowR')}</button><button class="primary" data-sendmenu aria-label="Send options">${icon('chevD')}</button></div>
    </div>
    <div class="resolves"><span>resolves to</span><span class="u"></span><span class="w"></span></div>
    <div class="secgrid" role="tablist"></div>
    <div class="secbody"></div>
  </section>`);
  left.append(card);

  const nm = card.querySelector('.nm');
  nm.oninput = () => { d.name = nm.value; markDirty(tab); renderTabs(); };
  card.querySelector('[data-save]').onclick = () => saveTab(tab);
  card.querySelector('[data-savemenu]').onclick = e => menuFor(e.currentTarget, [{ label: 'Save as…', icon: 'copy', kb: 'Ctrl+Shift+S', run: () => saveTab(tab, true) }]);
  card.querySelector('[data-code]').onclick = () => bus.emit('codegen', tab);
  card.querySelector('[data-cookies]').onclick = () => bus.emit('cookies');
  card.querySelector('[data-ai]').onclick = () => bus.emit('ai-generate', tab);

  const url = card.querySelector('.url');
  url.value = d.url;
  const urlOv = varOverlay(url, k => k in varMap(path[0]?.id) || !!globalThis.MP_DYNAMIC.dynamicFor(k));
  const resolves = card.querySelector('.resolves');
  const paintResolved = () => {
    const u = resolvedUrl(tab);
    resolves.querySelector('.u').textContent = u || '—';
    resolves.querySelector('.u').title = u;
    const bad = new Set([...(u || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m => m[1]));
    resolves.querySelector('.w').textContent = bad.size ? `${bad.size} unresolved` : '';
    resolves.querySelector('.w').title = [...bad].map(k => `{{${k}}}`).join(', ');
    url.title = 'Resolved: ' + u;
  };
  paintResolved();
  const importCurl = text => {
    try {
      const c = parseCurl(text.trim());
      Object.assign(d, { ...c, id: d.id, name: d.name.startsWith('Untitled') ? c.name : d.name, examples: d.examples });
      r.reqTab = c.body.mode !== 'none' ? 'body' : 'params';
      markDirty(tab); renderTabs(); renderHttp(tab, el); toast('Imported cURL command');
    } catch (e) { toast('Could not parse cURL: ' + e.message, 'error'); }
  };
  // Read the clipboard ourselves: a single-line <input> strips newlines, which would break
  // multi-line cURL commands and any JSON inside quoted --form / --data values.
  url.addEventListener('paste', e => {
    const text = e.clipboardData.getData('text/plain');
    if (!isGql && /^\s*curl\s/i.test(text)) { e.preventDefault(); importCurl(text); }
  });
  url.addEventListener('input', () => {
    const v = url.value;
    if (/^\s*curl\s/i.test(v) && !isGql) return importCurl(v);
    d.url = v;
    urlToParams(d);
    markDirty(tab);
    paintResolved();
    if (r.reqTab === 'params') drawSub();
    updateCounts();
  });
  url.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); send(tab); } });
  const mbtn = card.querySelector('[data-method]');
  if (mbtn) mbtn.onclick = () => menuFor(mbtn, METHODS.map(m => ({ label: m, icon: m === d.method ? 'check' : '', run: () => {
    d.method = m;
    mbtn.className = 'methodbtn ' + m;
    mbtn.firstChild.textContent = m;
    markDirty(tab); renderTabs(); bus.emit('tree-soft');
  } })));
  card.querySelector('[data-send]').onclick = () => rt(tab).loading ? rt(tab).cancel?.() : send(tab);
  card.querySelector('[data-sendmenu]').onclick = e => menuFor(e.currentTarget, [
    { label: 'Send and Download', icon: 'download', kb: 'Ctrl+Alt+Enter', run: () => send(tab, true) },
    { label: 'Send', icon: 'send', kb: 'Ctrl+Enter', run: () => send(tab) },
  ]);
  if (r.loading) card.querySelector('[data-send]').innerHTML = `${icon('x')} Cancel`;

  const tabsDef = isGql
    ? [['query', 'Query'], ['auth', 'Auth'], ['headers', 'Headers'], ['scripts', 'Scripts'], ['settings', 'Settings'], ['docs', 'Docs']]
    : [['params', 'Params'], ['auth', 'Auth'], ['headers', 'Headers'], ['body', 'Body'], ['scripts', 'Scripts'], ['settings', 'Settings'], ['docs', 'Docs']];
  const grid = card.querySelector('.secgrid');
  const body = card.querySelector('.secbody');
  const updateCounts = () => {
    grid.replaceChildren(...tabsDef.map(([k, l]) => {
      const sm = summary(k, d, path);
      const b = h(`<button class="seccard st ${k === r.reqTab ? 'on' : ''}" data-t="${k}" role="tab" aria-selected="${k === r.reqTab}"><span class="l">${l}</span><span class="s">${esc(sm)}</span></button>`);
      b.onclick = () => { r.reqTab = k; drawSub(); };
      return b;
    }));
  };
  const changed = () => { markDirty(tab); updateCounts(); paintResolved(); };

  function drawSub() {
    updateCounts();
    body.replaceChildren();
    body.classList.remove('flush');
    const t = r.reqTab;
    if (t === 'params') {
      body.append(kvTable(d.params ||= [], () => { paramsToUrl(d); url.value = d.url; urlOv.repaint(); changed(); }, { placeholder: ['Key', 'Value'], desc: true, title: 'Query Params' }));
      if (d.pathVars?.length) body.append(kvTable(d.pathVars, changed, { placeholder: ['Path variable', 'Value'], desc: true, title: 'Path Variables', fixedKeys: true }));
      else body.append(h(`<div class="dim" style="font-size:12px">Tip: use <code>/:id</code> in the URL to add path variables.</div>`));
    }
    if (t === 'auth') {
      const parent = [...path].reverse().find(p => p.auth && p.auth.type !== 'inherit');
      renderAuth(body, d.auth ||= { type: 'inherit' }, changed, { allowInherit: true, inheritLabel: parent ? `${parent.name} uses ${parent.auth.type}.` : 'No parent auth is set, so no auth will be sent.', vars: () => varMap(path[0]?.id) });
    }
    if (t === 'headers') {
      const kv = kvTable(d.headers ||= [], changed, { placeholder: ['Key', 'Value'], desc: true, title: 'Headers' });
      kv.querySelectorAll('input.k').forEach(i => i.setAttribute('list', 'hdr-names'));
      const obs = new MutationObserver(() => kv.querySelectorAll('input.k:not([list])').forEach(i => i.setAttribute('list', 'hdr-names')));
      obs.observe(kv, { childList: true, subtree: true });
      body.append(kv);
      const auto = h(`<details style="margin-top:4px"><summary class="dim" style="cursor:pointer">Auto-generated headers</summary><div style="margin-top:8px"></div></details>`);
      auto.ontoggle = () => {
        if (!auto.open) return;
        let rows;
        try {
          const b = buildHttp(d, varMap(path[0]?.id), path);
          const user = new Set((d.headers || []).filter(x => x.on && x.key).map(x => x.key.toLowerCase()));
          rows = b.headers.filter(([k]) => !user.has(k.toLowerCase())).concat([['User-Agent', 'MyPostmaster/' + (window.APP_VERSION || '2')], ['Accept', '*/*'], ['Accept-Encoding', 'gzip, deflate, br'], ['Host', '<calculated when sent>']].filter(([k]) => !user.has(k.toLowerCase()) && !b.headers.some(([x]) => x.toLowerCase() === k.toLowerCase())));
          if (b.auth) rows.push(['Authorization', `<${b.auth.type} — signed when sent>`]);
        } catch (e) { rows = [['error', e.message]]; }
        auto.lastChild.replaceChildren(h(`<table class="grid"><tbody>${rows.map(([k, v]) => `<tr><td class="k mono">${esc(k)}</td><td class="mono">${esc(/^authorization$/i.test(k) && !String(v).startsWith('<') ? String(v).slice(0, 12) + '…' : v)}</td></tr>`).join('')}</tbody></table>`));
      };
      body.append(auto);
    }
    if (t === 'body') drawBody(tab, body, changed);
    if (t === 'query') drawGraphql(tab, body, changed);
    if (t === 'scripts') drawScripts(tab, body, changed);
    if (t === 'settings') drawSettings(d, body, changed);
    if (t === 'docs') drawDocs(tab, body, changed);
  }
  drawSub();
  const logEl = h(`<div class="dlog"></div>`);
  right.append(logEl);
  r.renderRes = () => renderResponse(tab, logEl, {
    onAskAi: k => bus.emit('ai-quick', k),
    onSaveExample: res => { const ex = saveAsExample(tab, res); if (ex) bus.emit('tree'); },
    onResend: run => send(tab, false, run.req),
    onRestore: run => { const { id, name, examples } = d; Object.assign(d, clone(run.req), { id, name, examples }); markDirty(tab); renderTabs(); bus.emit('render-view'); toast('Request restored to what was sent at ' + new Date(run.at).toLocaleTimeString()); },
    onDisableSsl: scope => {
      if (scope === 'all') { W.settings.sslVerify = false; saveW(); toast('SSL certificate verification turned off (Settings → General)'); }
      else { (d.settings ||= {}).sslVerify = false; markDirty(tab); updateCounts(); toast('SSL verification off for this request (request Settings)'); }
      send(tab);
    },
  });
  r.renderRes();
  r.focusUrl = () => { url.focus(); url.select(); };
  r.focusReq = () => body.querySelector('input,textarea,.monaco-editor textarea')?.focus();
  r.focusRes = () => logEl.querySelector('.run.open .runtabs button.on, .run .runhead')?.focus();
  r.beautify = () => beautify(tab);
}

function resolvedUrl(tab) {
  try { return buildHttp(tab.draft, varMap(chainOf(tab.draft, tab.ref)[0]?.id), chainOf(tab.draft, tab.ref)).url; } catch { return tab.draft.url; }
}

function drawBody(tab, el, changed) {
  const d = tab.draft;
  const b = d.body ||= { mode: 'none', raw: '', lang: 'json', urlencoded: [], formdata: [], binary: '', graphql: { query: '', variables: '' } };
  const modes = [['none', 'none'], ['formdata', 'form-data'], ['urlencoded', 'x-www-form-urlencoded'], ['raw', 'raw'], ['binary', 'binary'], ['graphql', 'GraphQL']];
  const top = h(`<div class="toolbar"><div class="radios">${modes.map(([v, l]) => `<label><input type="radio" name="bm-${tab.id}" value="${v}" ${b.mode === v ? 'checked' : ''}>${l}</label>`).join('')}</div><span class="sp"></span></div>`);
  top.querySelector('.radios').onchange = e => { b.mode = e.target.value; changed(); el.replaceChildren(); drawBody(tab, el, changed); };
  if (b.mode === 'raw') {
    const sel = h(`<select class="sm" style="padding:2px 6px">${[['text', 'Text'], ['javascript', 'JavaScript'], ['json', 'JSON'], ['html', 'HTML'], ['xml', 'XML']].map(([v, l]) => `<option value="${v}" ${b.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    sel.onchange = () => { b.lang = sel.value; changed(); el.replaceChildren(); drawBody(tab, el, changed); };
    const beauty = h(`<button class="ghost sm" title="Beautify (Ctrl+B)">${icon('wand')} Beautify</button>`);
    beauty.onclick = () => beautify(tab);
    top.append(sel, beauty);
  }
  el.append(top);
  if (b.mode === 'none') el.append(h(`<div class="empty">This request does not have a body</div>`));
  if (b.mode === 'raw') {
    const box = h(`<div class="editor-wrap"></div>`);
    el.append(box);
    const hint = h(`<div class="jsonhint" hidden>Not valid JSON yet — it will be sent exactly as written.</div>`);
    // {{vars}} may sit bare in JSON ({"n": {{count}}}), so swap them for a literal before checking.
    const check = v => { if (b.lang !== 'json' || !v.trim()) return hint.hidden = true; try { JSON.parse(v.replace(/\{\{[^{}]+\}\}/g, '0')); hint.hidden = true; } catch { hint.hidden = false; } };
    rt(tab).bodyEditor = createEditor(box, { value: b.raw || '', language: b.lang === 'text' ? 'plaintext' : b.lang, onChange: v => { b.raw = v; changed(); check(v); }, placeholder: b.lang === 'json' ? '{\n  "key": "{{variable}}"\n}' : '' });
    check(b.raw || '');
    el.append(hint);
  }
  if (b.mode === 'urlencoded') el.append(kvTable(b.urlencoded ||= [], changed, { desc: true }));
  if (b.mode === 'formdata') el.append(kvTable(b.formdata ||= [], changed, { files: true, desc: true }));
  if (b.mode === 'binary') {
    const row = h(`<div class="row-flex"><button>${icon('file')} Select file</button><span class="mono dim">${esc(b.binary || 'No file selected')}</span>${b.binary ? `<button class="ghost sm" data-clear>${icon('x')}</button>` : ''}</div>`);
    row.querySelector('button').onclick = async () => { const f = await api.dialogOpen({}); if (f) { b.binary = f[0].path; changed(); el.replaceChildren(); drawBody(tab, el, changed); } };
    row.querySelector('[data-clear]')?.addEventListener('click', () => { b.binary = ''; changed(); el.replaceChildren(); drawBody(tab, el, changed); });
    el.append(row);
  }
  if (b.mode === 'graphql') drawGraphql(tab, el, changed, true);
}

async function beautify(tab) {
  const r = rt(tab), b = tab.draft.body;
  if (tab.draft.kind === 'graphql' || b?.mode === 'graphql') { await formatEditor(r.varsEditor); return; }
  if (b?.mode !== 'raw') return;
  if (b.lang === 'json') {
    // Keep {{var}} placeholders intact: they may appear quoted ("{{id}}") or bare ({{count}}) in JSON bodies.
    const holders = [];
    let src = b.raw.replace(/\{\{[^{}]+\}\}/g, m => { holders.push(m); return `__MPV${holders.length - 1}__`; });
    src = src.replace(/(^|[^"\w])(__MPV\d+__)(?![\w"])/g, '$1"@@$2"');
    try {
      b.raw = JSON.stringify(JSON.parse(src), null, 2).replace(/"@@__MPV(\d+)__"/g, (_, i) => holders[i]).replace(/__MPV(\d+)__/g, (_, i) => holders[i]);
      r.bodyEditor?.setValue(b.raw);
      markDirty(tab);
    } catch (e) { toast('Invalid JSON: ' + e.message, 'error'); }
  } else await formatEditor(r.bodyEditor);
}

// ---------- GraphQL ----------
const INTROSPECTION = `query IntrospectionQuery { __schema { queryType { name } mutationType { name } subscriptionType { name } types { kind name description fields(includeDeprecated: true) { name description args { name type { ...TypeRef } defaultValue } type { ...TypeRef } } inputFields { name type { ...TypeRef } } enumValues { name } } } }
fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;
const typeStr = t => t.kind === 'NON_NULL' ? typeStr(t.ofType) + '!' : t.kind === 'LIST' ? `[${typeStr(t.ofType)}]` : t.name;
const baseType = t => t.ofType ? baseType(t.ofType) : t;

function drawGraphql(tab, el, changed, inBody = false) {
  const d = tab.draft;
  const r = rt(tab);
  const g = (d.body ||= {}).graphql ||= { query: '', variables: '' };
  if (!inBody) d.body.mode = 'graphql';
  const wrap = h(`<div style="display:grid;grid-template-columns:1fr ${r.schemaOpen ? '300px' : 'auto'};gap:10px;flex:1;min-height:0">
    <div class="col-flex" style="min-height:0;gap:6px">
      <div class="toolbar"><b class="dim" style="font-size:12px">QUERY</b><span class="sp"></span><button class="ghost sm" data-fmt title="Prettify">${icon('wand')} Prettify</button><button class="ghost sm" data-schema>${icon('box')} ${r.schemaOpen ? 'Hide schema' : 'Schema'}</button></div>
      <div class="editor-wrap" data-q style="flex:2"></div>
      <div class="toolbar"><b class="dim" style="font-size:12px">GRAPHQL VARIABLES</b></div>
      <div class="editor-wrap" data-v style="flex:1;min-height:90px"></div>
    </div>
    <div data-explorer style="${r.schemaOpen ? '' : 'display:none'};min-height:0;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px"></div></div>`);
  el.append(wrap);
  r.queryEditor = createEditor(wrap.querySelector('[data-q]'), { value: g.query, language: 'graphql', onChange: v => { g.query = v; changed(); } });
  r.varsEditor = createEditor(wrap.querySelector('[data-v]'), { value: g.variables, language: 'json', onChange: v => { g.variables = v; changed(); }, placeholder: '{ "id": "{{userId}}" }' });
  wrap.querySelector('[data-fmt]').onclick = () => { g.query = prettyGql(g.query); r.queryEditor.setValue(g.query); changed(); };
  wrap.querySelector('[data-schema]').onclick = () => { r.schemaOpen = !r.schemaOpen; el.replaceChildren(); inBody ? drawBody(tab, el, changed) : drawGraphql(tab, el, changed); };
  if (r.schemaOpen) drawExplorer(tab, wrap.querySelector('[data-explorer]'));
}

function prettyGql(q) {
  let depth = 0, out = '', inStr = false;
  for (const ch of q.replace(/\s+/g, ' ').trim()) {
    if (ch === '"') inStr = !inStr;
    if (inStr) { out += ch; continue; }
    if (ch === '{') { depth++; out = out.trimEnd() + ' {\n' + '  '.repeat(depth); }
    else if (ch === '}') { depth = Math.max(0, depth - 1); out = out.trimEnd() + '\n' + '  '.repeat(depth) + '}\n' + '  '.repeat(depth); }
    else if (ch === ' ' && /\n\s*$/.test(out)) continue;
    else if (ch === ',' ) out += ',';
    else out += ch;
  }
  return out.replace(/\n\s*\n/g, '\n').trim();
}

async function drawExplorer(tab, el) {
  const r = rt(tab);
  const d = tab.draft;
  el.replaceChildren(h(`<div class="toolbar"><b>Schema</b><span class="sp"></span><button class="ghost sm" data-r title="Fetch schema via introspection">${icon('refresh')}</button></div>`));
  el.querySelector('[data-r]').onclick = () => { r.schema = null; drawExplorer(tab, el); };
  if (!r.schema) {
    el.append(h(`<div class="dim"><span class="spin"></span> Fetching schema…</div>`));
    const req = { ...d, body: { mode: 'graphql', graphql: { query: INTROSPECTION, variables: '' } }, pre: '', tests: '' };
    const res = await execute(req, { refId: tab.ref, noHistory: true });
    try {
      if (!res.ok) throw new Error(res.error);
      const j = JSON.parse(res.body);
      if (!j.data?.__schema) throw new Error(j.errors?.[0]?.message || 'No schema in response');
      r.schema = j.data.__schema;
    } catch (e) { el.lastChild.replaceWith(h(`<div class="s4" style="font-size:12px">Could not load schema: ${esc(e.message)}</div>`)); return; }
    el.lastChild.remove();
  }
  const s = r.schema;
  const types = Object.fromEntries(s.types.map(t => [t.name, t]));
  const skeleton = (t, depth) => {
    const bt = types[baseType(t).name];
    if (!bt?.fields || depth > 2) return '';
    const scal = bt.fields.filter(f => ['SCALAR', 'ENUM'].includes(baseType(f.type).kind)).slice(0, 8).map(f => f.name);
    const objs = depth < 2 ? bt.fields.filter(f => baseType(f.type).kind === 'OBJECT' && !f.args?.some(a => a.type.kind === 'NON_NULL')).slice(0, 2) : [];
    const ind = '  '.repeat(depth + 2);
    return ` {\n${[...scal.map(n => ind + n), ...objs.map(f => ind + f.name + skeleton(f.type, depth + 1))].join('\n')}\n${'  '.repeat(depth + 1)}}`;
  };
  for (const [op, root] of [['query', s.queryType], ['mutation', s.mutationType], ['subscription', s.subscriptionType]]) {
    if (!root) continue;
    const t = types[root.name];
    const det = h(`<details ${op === 'query' ? 'open' : ''}><summary style="cursor:pointer;font-weight:600;margin:6px 0">${op[0].toUpperCase() + op.slice(1)} <span class="dim">(${t.fields.length})</span></summary></details>`);
    for (const f of t.fields) {
      const row = h(`<div style="padding:4px 2px;border-bottom:1px solid var(--line);cursor:pointer" title="${esc(f.description || '')}"><span class="mono" style="color:var(--acc)">${esc(f.name)}</span><span class="mono dim" style="font-size:11px">${f.args.length ? '(' + f.args.map(a => `${a.name}: ${typeStr(a.type)}`).join(', ') + ')' : ''}: ${esc(typeStr(f.type))}</span></div>`);
      row.onclick = () => {
        const vars = f.args.map(a => `$${a.name}: ${typeStr(a.type)}`).join(', ');
        const q = `${op} ${f.name[0].toUpperCase() + f.name.slice(1)}${vars ? `(${vars})` : ''} {\n  ${f.name}${f.args.length ? '(' + f.args.map(a => `${a.name}: $${a.name}`).join(', ') + ')' : ''}${skeleton(f.type, 0)}\n}`;
        d.body.graphql.query = q;
        if (f.args.length) d.body.graphql.variables = JSON.stringify(Object.fromEntries(f.args.map(a => [a.name, /Int|Float/.test(typeStr(a.type)) ? 0 : /Boolean/.test(typeStr(a.type)) ? false : ''])), null, 2);
        r.queryEditor?.setValue(q);
        r.varsEditor?.setValue(d.body.graphql.variables || '');
        markDirty(tab);
      };
      det.append(row);
    }
    el.append(det);
  }
}

// ---------- scripts ----------
export function drawScripts(tab, el, changed, holder = tab.draft) {
  const r = rt(tab);
  r.scriptTab ||= holder.tests?.trim() && !holder.pre?.trim() ? 'post' : 'pre';
  const wrap = h(`<div class="scripts" style="display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:14px;flex:1;min-height:0">
    <div class="col-flex" style="min-width:0;gap:10px">
      <div class="pillseg" style="align-self:flex-start">
        <button class="${r.scriptTab === 'pre' ? 'on' : ''}" data-s="pre">Pre-request${holder.pre?.trim() ? ' •' : ''}</button>
        <button class="${r.scriptTab === 'post' ? 'on' : ''}" data-s="post">Post-response${holder.tests?.trim() ? ' •' : ''}</button>
      </div>
      <div class="editor-wrap"></div>
      <span class="dim" style="font-size:11.5px">${r.scriptTab === 'pre' ? 'Runs before the request is sent. Use pm.environment / pm.variables to prepare values.' : 'Runs after the reply arrives. pm.test() results show under Tests in the dispatch log.'}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;min-width:0;overflow:auto"><span class="eyebrow" style="padding:6px 4px">Snippets</span><div data-snip style="display:flex;flex-direction:column;gap:2px;max-height:330px;overflow:auto"></div></div></div>`);
  el.append(wrap);
  const key = r.scriptTab === 'pre' ? 'pre' : 'tests';
  const ed = createEditor(wrap.querySelector('.editor-wrap'), { value: holder[key] || '', language: 'javascript', onChange: v => { holder[key] = v; changed(); }, placeholder: r.scriptTab === 'pre' ? '// Runs before the request is sent\n// pm.environment.set("timestamp", Date.now());' : '// Runs after the response is received\n// pm.test("Status code is 200", () => pm.response.to.have.status(200));' });
  r.scriptEditor = ed;
  wrap.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { r.scriptTab = b.dataset.s; el.replaceChildren(); drawScripts(tab, el, changed, holder); });
  const snip = wrap.querySelector('[data-snip]');
  for (const [name, code] of Object.entries(SNIPPETS[r.scriptTab])) {
    const a = h(`<button class="ghost" style="justify-content:flex-start;white-space:normal;text-align:left;color:var(--ac-tx);font-size:12px;line-height:1.35;border-radius:8px">${esc(name)}</button>`);
    a.onclick = () => {
      const model = ed.getModel();
      const last = model.getLineCount();
      const end = model.getLineMaxColumn(last);
      const prefix = model.getValue() && !model.getValue().endsWith('\n') ? '\n' : '';
      ed.executeEdits('snippet', [{ range: { startLineNumber: last, startColumn: end, endLineNumber: last, endColumn: end }, text: prefix + code }]);
      ed.focus();
    };
    snip.append(a);
  }
}

function drawSettings(d, el, changed) {
  const s = d.settings ||= {};
  const tri = (k, label, hint) => {
    const v = s[k] === undefined ? '' : s[k] ? 'on' : 'off';
    const row = document.createDocumentFragment();
    row.append(h(`<label>${label}</label>`));
    const sel = h(`<select><option value="">Use app default</option><option value="on" ${v === 'on' ? 'selected' : ''}>On</option><option value="off" ${v === 'off' ? 'selected' : ''}>Off</option></select>`);
    sel.onchange = () => { if (sel.value === '') delete s[k]; else s[k] = sel.value === 'on'; changed(); };
    row.append(sel);
    if (hint) row.append(h(`<div class="hint">${hint}</div>`));
    return row;
  };
  const num = (k, label, hint) => {
    const row = document.createDocumentFragment();
    row.append(h(`<label>${label}</label>`));
    const i = h(`<input type="number" min="0" placeholder="App default" value="${s[k] ?? ''}">`);
    i.oninput = () => { if (i.value === '') delete s[k]; else s[k] = +i.value; changed(); };
    row.append(i);
    if (hint) row.append(h(`<div class="hint">${hint}</div>`));
    return row;
  };
  const f = h(`<div class="form"></div>`);
  f.append(num('timeout', 'Request timeout (ms)', '0 = never time out'), tri('followRedirects', 'Automatically follow redirects'), num('maxRedirects', 'Maximum number of redirects'),
    tri('sslVerify', 'Enable SSL certificate verification'), tri('disableCookies', 'Disable cookie jar', 'When on, stored cookies are not sent and response cookies are not stored.'),
    tri('keepAuthOnRedirect', 'Keep Authorization header on cross-origin redirect'));
  el.append(f);
}

function drawDocs(tab, el, changed) {
  const d = tab.draft, r = rt(tab);
  r.docsTab ||= d.description?.trim() ? 'preview' : 'write';
  const wrap = h(`<div class="docs col-flex" style="gap:10px"><div class="pillseg" style="align-self:flex-start"><button data-d="write" class="${r.docsTab === 'write' ? 'on' : ''}">Write</button><button data-d="preview" class="${r.docsTab === 'preview' ? 'on' : ''}">Preview</button></div></div>`);
  if (r.docsTab === 'write') {
    const ta = h(`<textarea placeholder="Describe what this request does, its parameters and expected responses. Markdown is supported." style="line-height:1.6;padding:14px 16px;border-radius:12px"></textarea>`);
    ta.value = d.description || '';
    ta.oninput = () => { d.description = ta.value; changed(); };
    wrap.append(ta);
  } else wrap.append(h(`<div class="md" style="max-width:680px;padding:4px;user-select:text">${md(d.description || '*No documentation yet.*')}</div>`));
  wrap.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { r.docsTab = b.dataset.d; el.replaceChildren(); drawDocs(tab, el, changed); });
  el.append(wrap);
}

// ---------- send ----------
export async function send(tab, download = false, snapshot = null) {
  const r = rt(tab);
  if (r.loading) return;
  const req = clone(snapshot || tab.draft);
  r.loading = true;
  r.signalId = uid();
  r.cancel = () => api.httpCancel(r.signalId);
  r.sending = { method: req.kind === 'graphql' ? 'POST' : req.method, url: snapshot ? req.url : resolvedUrl(tab) };
  r.renderRes?.();
  const sendBtn = document.querySelector('[data-send]');
  if (sendBtn) sendBtn.innerHTML = `${icon('x')} Cancel`;
  try {
    r.res = await execute(req, { refId: tab.ref, signalId: r.signalId });
  } catch (e) {
    r.res = { ok: false, error: e.message, time: 0 };
  }
  r.loading = false;
  // Dispatch log: newest first, newest expanded, capped so a long session doesn't hold every body in memory.
  r.runs = [{ id: uid(), res: r.res, req, at: Date.now(), method: r.res.sent?.method || r.sending.method, url: r.res.sent?.url || r.sending.url }, ...(r.runs || [])].slice(0, 15);
  r.openRuns = new Set([r.runs[0].id]);
  if (sendBtn?.isConnected) sendBtn.innerHTML = `Send ${icon('arrowR')}`;
  r.renderRes?.();
  if (download && r.res.ok) saveToFile(tab, r.res);
  bus.emit('sent', tab);
}
