// WebSocket, Socket.IO, SSE and MQTT clients.
import { W, T, varMap, resolve, saveT, RT } from '../state.js';
import { h, esc, icon, kvTable, kvRow, toast, uid, md, contextMenu, dragResize, ask, varOverlay } from '../ui.js';
import { createEditor } from '../editor.js';
import { rt, markDirty, saveTab, renderTabs } from '../tabs.js';
import { urlToParams, paramsToUrl } from './http.js';
import { buildHttp, chainOf, log } from '../execute.js';
import { renderAuth } from './auth.js';

const MAX_MESSAGES = 5000;
const DEFAULT_URL = { ws: 'wss://echo.websocket.org', socketio: 'http://localhost:3000', sse: 'https://sse.dev/test', mqtt: 'mqtt://test.mosquitto.org:1883' };
const KIND_LABEL = { ws: 'WebSocket', socketio: 'Socket.IO', sse: 'SSE', mqtt: 'MQTT' };

// Route live events from the main process to the owning tab (session id = tab id).
api.on('rt-event', e => {
  const r = RT.get(e.id);
  if (!r) return;
  if (e.kind === 'open') { r.connected = true; r.connecting = false; }
  if (e.kind === 'close') { r.connected = false; r.connecting = false; r.streaming = false; }
  r.messages ||= [];
  r.messages.push(e);
  if (r.messages.length > MAX_MESSAGES) r.messages.splice(0, r.messages.length - MAX_MESSAGES);
  if (e.kind === 'error') log({ type: 'error', text: `[realtime] ${e.text}` });
  r.onEvent?.(e);
});

export function renderRealtime(tab, el) {
  const d = tab.draft;
  const r = rt(tab);
  r.messages ||= [];
  const kind = d.kind;
  r.subTab ||= kind === 'sse' ? 'params' : 'message';
  const path = chainOf(d, tab.ref);
  el.replaceChildren();

  const nameBar = h(`<div class="reqname">${path.map(p => `<span class="crumb">${esc(p.name)}</span><span class="dim">/</span>`).join('')}<input class="nm" value="${esc(d.name)}" aria-label="Name"><span class="sp"></span><button class="sm" data-save>${icon('check')} Save</button></div>`);
  const nm = nameBar.querySelector('.nm');
  nm.style.width = Math.max(80, d.name.length * 8 + 20) + 'px';
  nm.oninput = () => { d.name = nm.value; markDirty(tab); renderTabs(); };
  nameBar.querySelector('[data-save]').onclick = () => saveTab(tab);
  el.append(nameBar);

  const bar = h(`<div class="reqbar"><div class="urlgroup"><span class="kind-label">${KIND_LABEL[kind]}</span><input class="url var-input" spellcheck="false" placeholder="${DEFAULT_URL[kind]}" aria-label="Server URL"></div>
    <span class="conn-dot" title="Connection status"></span><button class="primary" data-conn style="min-width:110px;justify-content:center"></button></div>`);
  const url = bar.querySelector('.url');
  url.value = d.url;
  const urlOv = varOverlay(url, k => k in varMap(path[0]?.id) || !!globalThis.MP_DYNAMIC.dynamicFor(k));
  url.oninput = () => { d.url = url.value; if (kind !== 'mqtt') urlToParams(d); markDirty(tab); if (r.subTab === 'params') drawSub(); };
  url.onkeydown = e => { if (e.key === 'Enter') toggle(); };
  const connBtn = bar.querySelector('[data-conn]'), dot = bar.querySelector('.conn-dot');
  const paintConn = () => {
    connBtn.innerHTML = r.connected ? `${icon('x')} Disconnect` : r.connecting ? '<span class="spin"></span> Connecting' : `${icon('plug')} Connect`;
    connBtn.classList.toggle('primary', !r.connected);
    dot.className = 'conn-dot ' + (r.connected ? 'on' : r.connecting ? 'wait' : '');
    el.querySelectorAll('[data-needs-conn]').forEach(b => { b.disabled = !r.connected; });
  };
  const toggle = () => r.connected || r.connecting ? disconnect(tab) : connect(tab);
  connBtn.onclick = toggle;
  el.append(bar);

  const split = h(`<div class="split"><div class="pane"></div><div class="gutter"></div><div class="pane"></div></div>`);
  const ratio = T.ui.rtSplit ?? 0.45;
  split.style.setProperty('--split', ratio + 'fr'); split.style.setProperty('--split2', (1 - ratio) + 'fr');
  el.append(split);
  const [top, , bottom] = split.children;
  let start;
  split.children[1].addEventListener('mousedown', () => { start = T.ui.rtSplit ?? 0.45; });
  dragResize(split.children[1], { axis: 'y', onMove: dy => { const v = Math.min(.85, Math.max(.15, start + dy / split.clientHeight)); T.ui.rtSplit = v; split.style.setProperty('--split', v + 'fr'); split.style.setProperty('--split2', (1 - v) + 'fr'); }, onEnd: saveT });

  const tabsDef = {
    ws: [['message', 'Message'], ['params', 'Params'], ['headers', 'Headers'], ['settings', 'Settings'], ['docs', 'Docs']],
    socketio: [['message', 'Message'], ['events', 'Events'], ['params', 'Params'], ['headers', 'Headers'], ['settings', 'Settings'], ['docs', 'Docs']],
    sse: [['params', 'Params'], ['auth', 'Authorization'], ['headers', 'Headers'], ['settings', 'Settings'], ['docs', 'Docs']],
    mqtt: [['message', 'Message'], ['topics', 'Topics'], ['settings', 'Settings'], ['docs', 'Docs']],
  }[kind];
  const sub = h(`<div class="subtabs">${tabsDef.map(([k, l]) => `<button class="st" data-t="${k}">${l}</button>`).join('')}</div>`);
  const body = h(`<div class="panel-body"></div>`);
  top.append(sub, body);
  sub.onclick = e => { const b = e.target.closest('[data-t]'); if (b) { r.subTab = b.dataset.t; drawSub(); } };
  const changed = () => markDirty(tab);

  function drawSub() {
    sub.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === r.subTab));
    body.replaceChildren();
    const t = r.subTab;
    if (t === 'message') drawComposer(tab, body, changed);
    if (t === 'params') body.append(kvTable(d.params ||= [], () => { paramsToUrl(d); url.value = d.url; urlOv.repaint(); changed(); }, { title: 'Query Params' }));
    if (t === 'headers') body.append(kvTable(d.headers ||= [], changed, { title: 'Handshake headers' }));
    if (t === 'auth') renderAuth(body, d.auth ||= { type: 'inherit' }, changed, { vars: () => varMap(path[0]?.id) });
    if (t === 'events') {
      body.append(h(`<div class="callout">All server events are captured automatically. Add event names here to highlight them, or to show <b>only</b> these events when "Only listened events" is on.</div>`));
      body.append(kvTable(d.listeners ||= [], changed, { placeholder: ['Event name', 'Note'], title: 'Listeners' }));
      const only = h(`<label class="row-flex"><input type="checkbox" ${d.settings.onlyListened ? 'checked' : ''}> Only show listened events</label>`);
      only.querySelector('input').onchange = e => { d.settings.onlyListened = e.target.checked; changed(); drawLog(); };
      body.append(only);
    }
    if (t === 'topics') {
      body.append(kvTable(d.topics ||= [], changed, { placeholder: ['Topic filter (e.g. sensors/#)', 'QoS (0/1/2)'], title: 'Subscriptions — applied on connect' }));
      const row = h(`<div class="row-flex"><input placeholder="Topic to subscribe now" style="flex:1"><select><option>0</option><option>1</option><option>2</option></select><button data-needs-conn>Subscribe</button><button data-needs-conn>Unsubscribe</button></div>`);
      const [ti, qs] = row.querySelectorAll('input,select');
      const [subB, unsubB] = row.querySelectorAll('button');
      subB.onclick = () => ti.value && api.rtCall(tab.id, 'subscribe', ti.value, +qs.value);
      unsubB.onclick = () => ti.value && api.rtCall(tab.id, 'unsubscribe', ti.value);
      body.append(row);
    }
    if (t === 'settings') drawRtSettings(d, body, changed);
    if (t === 'docs') {
      const ta = h(`<textarea rows="10" placeholder="Describe this connection in Markdown…"></textarea>`);
      ta.value = d.description || '';
      ta.oninput = () => { d.description = ta.value; changed(); };
      body.append(ta, h(`<div class="md">${md(d.description || '')}</div>`));
    }
    paintConn();
  }

  // ---- message log ----
  r.logFilter ||= { text: '', type: 'all' };
  const logHead = h(`<div class="subtabs" style="gap:8px"><b style="padding:8px 4px">Messages</b><span class="dim" data-count></span><span class="sp"></span>
    <input placeholder="Search messages" style="width:200px;padding:3px 8px" data-q value="${esc(r.logFilter.text)}">
    <div class="seg">${['all', 'sent', 'received'].map(k => `<button data-ft="${k}" class="${r.logFilter.type === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <button class="ghost sm" data-clear title="Clear messages">${icon('trash')}</button></div>`);
  const logEl = h(`<div class="msglog" role="log" aria-live="polite"></div>`);
  bottom.append(logHead, logEl);
  logHead.querySelector('[data-q]').oninput = e => { r.logFilter.text = e.target.value; drawLog(); };
  logHead.querySelectorAll('[data-ft]').forEach(b => b.onclick = () => { r.logFilter.type = b.dataset.ft; logHead.querySelectorAll('[data-ft]').forEach(x => x.classList.toggle('on', x === b)); drawLog(); });
  logHead.querySelector('[data-clear]').onclick = () => { r.messages = []; drawLog(); };

  const listened = () => new Set((d.listeners || []).filter(l => l.on && l.key).map(l => l.key));
  const visible = m => {
    const f = r.logFilter;
    if (f.type === 'sent' && m.kind !== 'sent') return false;
    if (f.type === 'received' && m.kind !== 'message') return false;
    if (kind === 'socketio' && d.settings.onlyListened && m.kind === 'message' && !listened().has(m.event)) return false;
    if (f.text && !`${m.event || ''} ${m.data || ''} ${m.text || ''}`.toLowerCase().includes(f.text.toLowerCase())) return false;
    return true;
  };
  const rowFor = m => {
    const arrow = { sent: '↑', message: '↓', error: '!', open: '●', close: '○', connecting: '…', info: 'i' }[m.kind] || '·';
    let text = m.binary ? `[binary ${m.size} bytes] ${m.data}` : m.data ?? m.text ?? '';
    const hl = kind === 'socketio' && m.event && listened().has(m.event);
    const row = h(`<div class="msg-row ${m.kind}"><span class="ar">${arrow}</span><div class="body">${m.event ? `<span class="ev" style="${hl ? 'background:var(--acc-soft);padding:0 4px;border-radius:3px' : ''}">${esc(m.event)}</span>` : ''}${esc(String(text).slice(0, 4000))}</div><span class="ts">${new Date(m.ts).toLocaleTimeString()}</span></div>`);
    row.onclick = () => {
      if (row.classList.toggle('expanded')) {
        let full = String(text);
        try { full = JSON.stringify(JSON.parse(full), null, 2); } catch {}
        row.querySelector('.body').innerHTML = (m.event ? `<span class="ev">${esc(m.event)}</span>` : '') + esc(full) + (m.headers ? '\n\n' + m.headers.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('\n') : '');
      }
    };
    row.oncontextmenu = e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [{ label: 'Copy message', icon: 'copy', run: () => navigator.clipboard.writeText(String(text)) }, m.kind === 'message' && kind !== 'sse' && { label: 'Use as message', icon: 'edit', run: () => { d.draft = { ...d.draft, data: String(text) }; changed(); r.subTab = 'message'; drawSub(); } }]); };
    return row;
  };
  function drawLog() {
    const shown = r.messages.filter(visible);
    logHead.querySelector('[data-count]').textContent = shown.length ? `${shown.length}` : '';
    logEl.replaceChildren(...shown.slice(-1000).map(rowFor));
    if (!shown.length) logEl.append(h(`<div class="empty">${r.connected ? 'Connected — waiting for messages' : 'Messages will appear here once you connect'}</div>`));
    logEl.scrollTop = logEl.scrollHeight;
  }
  r.onEvent = e => {
    if (!logEl.isConnected) return;
    paintConn();
    if (!visible(e)) return;
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    logEl.querySelector('.empty')?.remove();
    logEl.append(rowFor(e));
    if (logEl.children.length > 1000) logEl.firstChild.remove();
    logHead.querySelector('[data-count]').textContent = String(r.messages.filter(visible).length);
    if (stick) logEl.scrollTop = logEl.scrollHeight;
  };
  r.sendMessage = () => sendMessage(tab);
  r.focusUrl = () => { url.focus(); url.select(); };
  drawSub();
  drawLog();
}

function drawComposer(tab, el, changed) {
  const d = tab.draft, r = rt(tab), kind = d.kind;
  const m = d.draft ||= {};
  const wrap = h(`<div style="display:grid;grid-template-columns:1fr 210px;gap:10px;flex:1;min-height:0"><div class="col-flex" style="min-height:0" data-main></div><div style="border-left:1px solid var(--line);padding-left:10px;overflow:auto"><div class="row-flex"><b class="dim" style="font-size:11px;text-transform:uppercase;letter-spacing:.6px">Saved messages</b><span class="sp"></span><button class="ghost sm" data-savemsg title="Save current message">${icon('plus')}</button></div><div data-saved></div></div></div>`);
  const main = wrap.querySelector('[data-main]');
  const tb = h(`<div class="toolbar"></div>`);
  if (kind === 'socketio') {
    tb.append(h(`<input placeholder="Event name" class="mono" data-ev style="width:200px" value="${esc(m.event || 'message')}">`), h(`<label class="row-flex" title="Wait for an acknowledgement callback"><input type="checkbox" data-ack ${m.ack ? 'checked' : ''}> Ack</label>`));
    tb.querySelector('[data-ev]').oninput = e => { m.event = e.target.value; changed(); };
    tb.querySelector('[data-ack]').onchange = e => { m.ack = e.target.checked; changed(); };
  }
  if (kind === 'mqtt') {
    tb.append(h(`<input placeholder="Topic" class="mono" data-topic style="flex:1;min-width:200px" value="${esc(m.topic || '')}">`), h(`<select data-qos title="QoS"><option value="0">QoS 0</option><option value="1">QoS 1</option><option value="2">QoS 2</option></select>`), h(`<label class="row-flex"><input type="checkbox" data-retain ${m.retain ? 'checked' : ''}> Retain</label>`));
    tb.querySelector('[data-topic]').oninput = e => { m.topic = e.target.value; changed(); };
    tb.querySelector('[data-qos]').value = String(m.qos || 0);
    tb.querySelector('[data-qos]').onchange = e => { m.qos = +e.target.value; changed(); };
    tb.querySelector('[data-retain]').onchange = e => { m.retain = e.target.checked; changed(); };
  }
  const fmts = kind === 'ws' ? [['text', 'Text'], ['json', 'JSON'], ['binary', 'Binary (Base64)']] : [['text', 'Text'], ['json', 'JSON']];
  const fsel = h(`<select class="sm" style="padding:3px 6px">${fmts.map(([v, l]) => `<option value="${v}" ${m.format === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
  fsel.onchange = () => { m.format = fsel.value; changed(); ed.updateOptions({}); window.monaco.editor.setModelLanguage(ed.getModel(), m.format === 'json' ? 'json' : 'plaintext'); };
  const sendB = h(`<button class="primary" data-needs-conn title="Send (Ctrl+Enter)">${icon('send')} ${kind === 'mqtt' ? 'Publish' : 'Send'}</button>`);
  sendB.onclick = () => sendMessage(tab);
  if (kind === 'ws') { const ping = h(`<button data-needs-conn title="Send a ping frame">Ping</button>`); ping.onclick = () => api.rtCall(tab.id, 'ping'); tb.append(ping); }
  tb.append(h(`<span class="sp"></span>`), fsel, sendB);
  main.append(tb);
  const box = h(`<div class="editor-wrap"></div>`);
  main.append(box);
  const ed = createEditor(box, { value: m.data || '', language: m.format === 'json' ? 'json' : 'plaintext', onChange: v => { m.data = v; changed(); }, placeholder: 'Compose a message… (Ctrl+Enter to send)' });
  r.composer = ed;
  if (kind === 'socketio') {
    main.append(h(`<div class="dim" style="font-size:12px">Additional arguments (each parsed as JSON when possible):</div>`));
    main.append(kvTable(m.args ||= [], changed, { placeholder: ['Argument', 'Note'] }));
  }
  const saved = wrap.querySelector('[data-saved]');
  const drawSaved = () => {
    saved.replaceChildren();
    if (!d.saved?.length) saved.append(h(`<div class="dim" style="font-size:12px;padding:6px 0">No saved messages</div>`));
    for (const s of d.saved || []) {
      const it = h(`<div class="node" style="padding:0 4px"><span class="nm">${esc(s.name)}</span><button class="ghost sm more">${icon('x')}</button></div>`);
      it.onclick = () => { Object.assign(m, JSON.parse(JSON.stringify(s.msg))); changed(); el.replaceChildren(); drawComposer(tab, el, changed); };
      it.querySelector('button').onclick = e => { e.stopPropagation(); d.saved.splice(d.saved.indexOf(s), 1); changed(); drawSaved(); };
      saved.append(it);
    }
  };
  wrap.querySelector('[data-savemsg]').onclick = async () => {
    const v = await ask('Save message', [['name', 'Name', (m.event || m.topic || m.data || 'Message').slice(0, 30)]], 'Save');
    if (!v?.name) return;
    (d.saved ||= []).push({ id: uid(), name: v.name, msg: JSON.parse(JSON.stringify(m)) });
    changed(); drawSaved();
  };
  drawSaved();
  el.append(wrap);
}

function drawRtSettings(d, el, changed) {
  const s = d.settings ||= {};
  const f = h(`<div class="form"></div>`);
  const add = (k, label, type = 'text', opts) => {
    f.append(h(`<label>${label}</label>`));
    let i;
    if (opts) { i = h(`<select>${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`); i.value = String(s[k] ?? opts[0][0]); i.onchange = () => { s[k] = type === 'number' ? +i.value : i.value; changed(); }; }
    else if (type === 'bool') { i = h(`<div><input type="checkbox" ${s[k] ? 'checked' : ''}></div>`); i.firstChild.onchange = e => { s[k] = e.target.checked; changed(); }; }
    else if (type === 'area') { i = h(`<textarea class="mono var-input" rows="3"></textarea>`); i.value = s[k] ?? ''; i.oninput = () => { s[k] = i.value; changed(); }; }
    else { i = h(`<input type="${type}" class="var-input">`); i.value = s[k] ?? ''; i.oninput = () => { s[k] = type === 'number' ? +i.value : i.value; changed(); }; }
    f.append(i);
  };
  if (d.kind === 'ws') { add('protocols', 'Subprotocols (comma separated)'); add('handshakeTimeout', 'Handshake timeout (ms)', 'number'); add('maxMessageMB', 'Max message size (MB)', 'number'); add('sslVerify', 'SSL certificate verification', 'bool'); }
  if (d.kind === 'socketio') {
    add('path', 'Handshake path'); add('transport', 'Transport', 'text', [['auto', 'Polling → WebSocket (auto)'], ['websocket', 'WebSocket only'], ['polling', 'Polling only']]);
    add('auth', 'Auth payload (JSON)', 'area'); add('reconnect', 'Reconnect automatically', 'bool'); add('ackTimeout', 'Ack timeout (ms)', 'number'); add('handshakeTimeout', 'Connection timeout (ms)', 'number'); add('sslVerify', 'SSL certificate verification', 'bool');
  }
  if (d.kind === 'sse') { add('method', 'Method', 'text', [['GET', 'GET'], ['POST', 'POST']]); add('body', 'Request body (POST)', 'area'); add('sslVerify', 'SSL certificate verification', 'bool'); }
  if (d.kind === 'mqtt') {
    add('clientId', 'Client ID (blank = random)'); add('username', 'Username'); add('password', 'Password', 'password'); add('version', 'Protocol version', 'number', [['4', 'MQTT 3.1.1'], ['5', 'MQTT 5.0']]);
    add('keepalive', 'Keep alive (s)', 'number'); add('clean', 'Clean session', 'bool'); add('reconnect', 'Reconnect automatically', 'bool'); add('sslVerify', 'SSL certificate verification', 'bool');
    f.append(h(`<h4>Last will</h4>`));
    const w = s.will ||= { topic: '', payload: '', qos: 0, retain: false };
    for (const [k, l] of [['topic', 'Will topic'], ['payload', 'Will message']]) { f.append(h(`<label>${l}</label>`)); const i = h(`<input>`); i.value = w[k] || ''; i.oninput = () => { w[k] = i.value; changed(); }; f.append(i); }
  }
  el.append(f);
}

function connect(tab) {
  const d = tab.draft, r = rt(tab);
  const path = chainOf(d, tab.ref);
  const vars = varMap(path[0]?.id);
  let url = resolve(d.url || DEFAULT_URL[d.kind], vars).trim();
  if (!d.url) { d.url = DEFAULT_URL[d.kind]; }
  const headers = (d.headers || []).filter(x => x.on && x.key).map(x => [resolve(x.key, vars), resolve(x.value, vars)]);
  const s = Object.fromEntries(Object.entries(d.settings || {}).map(([k, v]) => [k, typeof v === 'string' ? resolve(v, vars) : v]));
  const cfg = { id: tab.id, kind: d.kind, url, headers, ...s };
  if (d.kind === 'ws') { if (!/^wss?:\/\//i.test(url)) cfg.url = 'ws://' + url.replace(/^https?:\/\//, ''); cfg.protocols = (s.protocols || '').split(',').map(x => x.trim()).filter(Boolean); }
  if (d.kind === 'sse') {
    try { const b = buildHttp({ ...d, method: s.method || 'GET', body: { mode: s.body ? 'raw' : 'none', raw: s.body || '', lang: 'json' } }, vars, path); Object.assign(cfg, { url: b.url, headers: b.headers, method: b.method, body: b.body }); }
    catch (e) { return toast(e.message, 'error'); }
  }
  if (d.kind === 'mqtt') { cfg.topics = d.topics; cfg.version = +s.version || 4; }
  r.connecting = true;
  r.messages ||= [];
  r.disconnect = () => disconnect(tab);
  r.onEvent?.({ kind: 'connecting', text: `Connecting to ${cfg.url}…`, ts: Date.now() });
  api.rtConnect(cfg).then(res => { if (!res.ok) { r.connecting = false; r.messages.push({ kind: 'error', text: res.error, ts: Date.now() }); r.onEvent?.({ kind: 'error', text: res.error, ts: Date.now() }); } });
}
function disconnect(tab) { api.rtCall(tab.id, 'close'); const r = rt(tab); r.connecting = false; }

function sendMessage(tab) {
  const d = tab.draft, r = rt(tab);
  if (!r.connected) return connect(tab);
  const m = d.draft || {};
  const vars = varMap(chainOf(d, tab.ref)[0]?.id);
  const data = resolve(m.data || '', vars);
  if (m.format === 'json') { try { JSON.parse(data); } catch (e) { return toast('Message is not valid JSON: ' + e.message, 'error'); } }
  let payload;
  if (d.kind === 'ws') payload = { data, binary: m.format === 'binary' };
  if (d.kind === 'socketio') payload = { event: resolve(m.event || 'message', vars), args: [data, ...(m.args || []).filter(a => a.on && a.key).map(a => resolve(a.key, vars))], ack: m.ack, json: m.format !== 'text' };
  if (d.kind === 'mqtt') { if (!m.topic) return toast('Enter a topic to publish to', 'error'); payload = { event: resolve(m.topic, vars), data, qos: m.qos, retain: m.retain }; }
  api.rtCall(tab.id, 'send', payload).then(res => { if (!res.ok) toast(res.error, 'error'); });
}
