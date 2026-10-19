// gRPC client view.
import { varMap, resolve, T, saveT } from '../state.js';
import { h, esc, icon, kvTable, toast, md, fmtTime, dragResize, varOverlay } from '../ui.js';
import { createEditor } from '../editor.js';
import { rt, markDirty, saveTab, renderTabs } from '../tabs.js';
import { renderAuth } from './auth.js';
import { chainOf, effectiveAuth, log } from '../execute.js';

const STREAM_LABEL = m => m.requestStream && m.responseStream ? 'bidi stream' : m.requestStream ? 'client stream' : m.responseStream ? 'server stream' : 'unary';

export function renderGrpc(tab, el) {
  const d = tab.draft, r = rt(tab);
  r.subTab ||= 'message';
  r.messages ||= [];
  const path = chainOf(d, tab.ref);
  el.replaceChildren();
  const methodObj = () => d.services?.find(s => s.name === d.service)?.methods.find(m => m.rpcName === d.method || m.name === d.method);

  const nameBar = h(`<div class="reqname">${path.map(p => `<span class="crumb">${esc(p.name)}</span><span class="dim">/</span>`).join('')}<input class="nm" value="${esc(d.name)}"><span class="sp"></span><button class="sm" data-save>${icon('check')} Save</button></div>`);
  nameBar.querySelector('.nm').oninput = e => { d.name = e.target.value; markDirty(tab); renderTabs(); };
  nameBar.querySelector('[data-save]').onclick = () => saveTab(tab);
  el.append(nameBar);

  const bar = h(`<div class="reqbar"><div class="urlgroup"><button class="ghost" data-tls title="Toggle TLS" style="border-right:1px solid var(--line);border-radius:6px 0 0 6px">${icon(d.tls ? 'lock' : 'unlock')}</button><input class="url var-input" placeholder="grpc.example.com:443" spellcheck="false" aria-label="Server address">
    <select data-method style="max-width:340px;border-left:1px solid var(--line)"></select></div><button class="primary" data-invoke style="min-width:96px;justify-content:center">${icon('play')} Invoke</button></div>`);
  const url = bar.querySelector('.url');
  url.value = d.url;
  const urlOv = varOverlay(url, k => k in varMap(path[0]?.id) || !!globalThis.MP_DYNAMIC.dynamicFor(k));
  url.oninput = () => { d.url = url.value; if (/^grpcs:\/\//i.test(d.url)) d.tls = true; markDirty(tab); };
  bar.querySelector('[data-tls]').onclick = e => { d.tls = !d.tls; e.currentTarget.innerHTML = icon(d.tls ? 'lock' : 'unlock'); markDirty(tab); toast(d.tls ? 'TLS on' : 'TLS off (plaintext)'); };
  const msel = bar.querySelector('[data-method]');
  const fillMethods = () => {
    const opts = (d.services || []).flatMap(s => s.methods.map(m => `<option value="${esc(s.name + '|' + m.rpcName)}">${esc(s.name.split('.').pop())} / ${esc(m.name)} (${STREAM_LABEL(m)})</option>`));
    msel.innerHTML = opts.length ? `<option value="">Select a method</option>` + opts.join('') : `<option value="">Load service definition first</option>`;
    msel.value = d.service ? `${d.service}|${d.method}` : '';
  };
  fillMethods();
  msel.onchange = () => {
    [d.service, d.method] = msel.value.split('|');
    const m = methodObj();
    if (m && (!d.message || d.message === '{}')) { d.message = m.sample; r.msgEditor?.setValue(d.message); }
    markDirty(tab); paint();
  };
  const invokeBtn = bar.querySelector('[data-invoke]');
  invokeBtn.onclick = () => r.streaming ? api.grpcCancel(tab.id) : invoke(tab);
  url.onkeydown = e => { if (e.key === 'Enter') invoke(tab); };
  el.append(bar);

  const split = h(`<div class="split"><div class="pane"></div><div class="gutter"></div><div class="pane"></div></div>`);
  const ratio = T.ui.split ?? 0.5;
  split.style.setProperty('--split', ratio + 'fr'); split.style.setProperty('--split2', (1 - ratio) + 'fr');
  let start;
  split.children[1].addEventListener('mousedown', () => { start = T.ui.split ?? .5; });
  dragResize(split.children[1], { axis: 'y', onMove: dy => { const v = Math.min(.85, Math.max(.15, start + dy / split.clientHeight)); T.ui.split = v; split.style.setProperty('--split', v + 'fr'); split.style.setProperty('--split2', (1 - v) + 'fr'); }, onEnd: saveT });
  el.append(split);
  const [top, , bottom] = split.children;
  const tabsDef = [['message', 'Message'], ['metadata', 'Metadata'], ['auth', 'Authorization'], ['definition', 'Service definition'], ['settings', 'Settings'], ['docs', 'Docs']];
  const sub = h(`<div class="subtabs">${tabsDef.map(([k, l]) => `<button class="st" data-t="${k}">${l}</button>`).join('')}</div>`);
  const body = h(`<div class="panel-body"></div>`);
  top.append(sub, body);
  sub.onclick = e => { const b = e.target.closest('[data-t]'); if (b) { r.subTab = b.dataset.t; drawSub(); } };
  const changed = () => markDirty(tab);

  function drawSub() {
    sub.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === r.subTab));
    body.replaceChildren();
    const t = r.subTab;
    if (t === 'message') {
      const m = methodObj();
      const tb = h(`<div class="toolbar"><span class="dim">${m ? `${esc(m.requestType || '')} → ${esc(m.responseType || '')} · ${STREAM_LABEL(m)}` : 'Select a method to see its message type'}</span><span class="sp"></span><button class="ghost sm" data-ex ${m ? '' : 'disabled'}>${icon('wand')} Use example message</button>
        ${m?.requestStream ? `<button class="sm" data-write ${r.streaming ? '' : 'disabled'}>${icon('send')} Send message</button><button class="sm" data-end ${r.streaming ? '' : 'disabled'}>End streaming</button>` : ''}</div>`);
      tb.querySelector('[data-ex]').onclick = () => { d.message = m.sample; r.msgEditor.setValue(d.message); changed(); };
      tb.querySelector('[data-write]')?.addEventListener('click', () => api.grpcWrite(tab.id, resolve(d.message, varMap(path[0]?.id))).then(x => { if (x.ok) r.onEvent?.({ kind: 'sent', data: d.message, ts: Date.now() }); else toast(x.error, 'error'); }));
      tb.querySelector('[data-end]')?.addEventListener('click', () => api.grpcEnd(tab.id));
      body.append(tb);
      const box = h(`<div class="editor-wrap"></div>`);
      body.append(box);
      r.msgEditor = createEditor(box, { value: d.message || '{}', language: 'json', onChange: v => { d.message = v; changed(); } });
    }
    if (t === 'metadata') body.append(kvTable(d.metadata ||= [], changed, { placeholder: ['Key', 'Value'], title: 'Request metadata' }));
    if (t === 'auth') renderAuth(body, d.auth ||= { type: 'inherit' }, changed, { vars: () => varMap(path[0]?.id) });
    if (t === 'definition') drawDefinition(tab, body, () => { fillMethods(); changed(); });
    if (t === 'settings') {
      const f = h(`<div class="form"><label>Deadline (ms, 0 = none)</label><input type="number" min="0" data-k="deadlineMs"><label>SSL certificate verification</label><div><input type="checkbox" data-k="sslVerify"></div><label>CA certificate (PEM)</label><div class="row-flex"><input data-k="caPath" style="flex:1" placeholder="Optional"><button data-pick="caPath">Browse</button></div><label>Client certificate</label><div class="row-flex"><input data-k="certPath" style="flex:1" placeholder="Optional"><button data-pick="certPath">Browse</button></div><label>Client key</label><div class="row-flex"><input data-k="keyPath" style="flex:1" placeholder="Optional"><button data-pick="keyPath">Browse</button></div></div>`);
      const s = d.settings ||= {};
      f.querySelectorAll('[data-k]').forEach(i => {
        const k = i.dataset.k;
        if (i.type === 'checkbox') { i.checked = s[k] !== false; i.onchange = () => { s[k] = i.checked; changed(); }; }
        else { i.value = s[k] ?? ''; i.oninput = () => { s[k] = i.type === 'number' ? +i.value : i.value; changed(); }; }
      });
      f.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => { const p = await api.dialogOpen({}); if (p) { s[b.dataset.pick] = p[0].path; f.querySelector(`[data-k=${b.dataset.pick}]`).value = p[0].path; changed(); } });
      body.append(f);
    }
    if (t === 'docs') { const ta = h(`<textarea rows="10" placeholder="Markdown docs…"></textarea>`); ta.value = d.description || ''; ta.oninput = () => { d.description = ta.value; changed(); }; body.append(ta, h(`<div class="md">${md(d.description || '')}</div>`)); }
  }

  // ---- response ----
  const resHead = h(`<div class="subtabs"><button class="st on" data-rt="body">Response</button><button class="st" data-rt="meta">Metadata</button><button class="st" data-rt="trailers">Trailers</button><span class="sp"></span><div class="resbar" data-status></div></div>`);
  const resBody = h(`<div class="panel-body"></div>`);
  bottom.append(resHead, resBody);
  r.resTab ||= 'body';
  resHead.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { r.resTab = b.dataset.rt; paint(); });
  function paint() {
    resHead.querySelectorAll('[data-rt]').forEach(b => b.classList.toggle('on', b.dataset.rt === r.resTab));
    invokeBtn.innerHTML = r.streaming ? `${icon('stop')} Cancel` : r.loading ? '<span class="spin"></span> Invoking' : `${icon('play')} Invoke`;
    const res = r.res;
    const st = resHead.querySelector('[data-status]');
    st.innerHTML = res?.status ? `<span class="pill ${res.status.code ? 's4' : 's2'}">${res.status.code} ${esc(res.status.name || '')}</span><span>${fmtTime(res.time || 0)}</span>` : '';
    resBody.replaceChildren();
    if (r.streaming || r.messages.length && !res?.status) {
      const logEl = h(`<div class="msglog"></div>`);
      const row = m => h(`<div class="msg-row ${m.kind} expanded"><span class="ar">${{ sent: '↑', message: '↓', error: '!', open: '●', close: '○' }[m.kind] || 'i'}</span><div class="body">${esc(m.data ?? m.text ?? '')}${m.headers?.length ? '\n' + m.headers.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('\n') : ''}</div><span class="ts">${new Date(m.ts).toLocaleTimeString()}</span></div>`);
      logEl.append(...r.messages.map(row));
      resBody.classList.add('flush');
      resBody.append(logEl);
      r.onEvent = e => { if (e.kind === 'close') { r.streaming = false; paint(); return; } if (!logEl.isConnected) return; logEl.append(row(e)); logEl.scrollTop = logEl.scrollHeight; };
      return;
    }
    resBody.classList.remove('flush');
    if (r.loading) return resBody.append(h(`<div class="empty"><span class="spin"></span> Invoking…</div>`));
    if (!res) return resBody.append(h(`<div class="empty">${icon('code')}<div class="big">Load a service definition, pick a method, then Invoke</div><div class="dim">Server reflection works for most servers. Otherwise import .proto files in Service definition.</div></div>`));
    if (!res.ok) return resBody.append(h(`<div class="empty s4 mono">${esc(res.error)}</div>`));
    if (r.resTab === 'body') {
      if (res.status.code) resBody.append(h(`<div class="callout warn"><b>${esc(res.status.name)}</b>: ${esc(res.status.details || '')}</div>`));
      if (res.message) { const box = h(`<div class="editor-wrap"></div>`); resBody.append(box); createEditor(box, { value: res.message, language: 'json', readOnly: true }); }
    } else {
      const rows = r.resTab === 'meta' ? res.metadata : res.trailers;
      resBody.append(rows?.length ? h(`<table class="grid"><tbody>${rows.map(([k, v]) => `<tr><td class="k mono">${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>`) : h(`<div class="empty">None</div>`));
    }
  }
  r.paint = paint;
  r.focusUrl = () => { url.focus(); url.select(); };
  drawSub();
  paint();
}

function drawDefinition(tab, el, onLoaded) {
  const d = tab.draft;
  const src = d.source ||= { type: 'reflection', files: [], importPaths: [] };
  const f = h(`<div class="col-flex">
    <div class="radios"><label><input type="radio" name="src-${tab.id}" value="reflection" ${src.type === 'reflection' ? 'checked' : ''}> Use server reflection</label><label><input type="radio" name="src-${tab.id}" value="proto" ${src.type === 'proto' ? 'checked' : ''}> Import .proto files</label></div>
    <div data-proto ${src.type === 'proto' ? '' : 'hidden'} class="col-flex"><div class="row-flex"><button data-add>${icon('file')} Add .proto files</button><button data-addimp>${icon('folder')} Add import path</button></div><div data-list></div></div>
    <div class="row-flex"><button class="primary" data-load>${icon('refresh')} Load services</button><span class="dim" data-st>${d.services?.length ? `${d.services.length} service(s) loaded` : ''}</span></div></div>`);
  const list = f.querySelector('[data-list]');
  const drawList = () => {
    list.replaceChildren();
    for (const [arr, label] of [[src.files, 'Proto file'], [src.importPaths, 'Import path']]) for (const p of arr) {
      const row = h(`<div class="row-flex"><span class="dim" style="width:90px">${label}</span><span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(p)}</span><button class="ghost sm">${icon('x')}</button></div>`);
      row.querySelector('button').onclick = () => { arr.splice(arr.indexOf(p), 1); markDirty(tab); drawList(); };
      list.append(row);
    }
  };
  drawList();
  f.querySelector('.radios').onchange = e => { src.type = e.target.value; f.querySelector('[data-proto]').hidden = src.type !== 'proto'; markDirty(tab); };
  f.querySelector('[data-add]').onclick = async () => { const r = await api.dialogOpen({ multi: true, filters: [{ name: 'Protocol Buffers', extensions: ['proto'] }] }); if (r) { src.files.push(...r.map(x => x.path)); markDirty(tab); drawList(); } };
  f.querySelector('[data-addimp]').onclick = async () => { const r = await api.dialogOpen({ directory: true }); if (r) { src.importPaths.push(r[0].path); markDirty(tab); drawList(); } };
  f.querySelector('[data-load]').onclick = async () => {
    const st = f.querySelector('[data-st]');
    st.innerHTML = '<span class="spin"></span> Loading…';
    const res = await api.grpcLoad(sourceSpec(tab), metadataPairs(tab));
    if (!res.ok) { st.innerHTML = `<span class="s4">${esc(res.error)}</span>`; return; }
    d.services = res.services;
    st.textContent = `${res.services.length} service(s), ${res.services.reduce((n, s) => n + s.methods.length, 0)} method(s) loaded`;
    onLoaded();
  };
  el.append(f);
}

function sourceSpec(tab) {
  const d = tab.draft;
  const vars = varMap(chainOf(d, tab.ref)[0]?.id);
  return d.source.type === 'reflection'
    ? { type: 'reflection', url: resolve(d.url, vars), tls: d.tls, sslVerify: d.settings?.sslVerify, caPath: d.settings?.caPath, certPath: d.settings?.certPath, keyPath: d.settings?.keyPath }
    : { type: 'proto', files: d.source.files, importPaths: d.source.importPaths };
}
function metadataPairs(tab) {
  const d = tab.draft;
  const path = chainOf(d, tab.ref);
  const vars = varMap(path[0]?.id);
  const meta = (d.metadata || []).filter(m => m.on && m.key).map(m => [resolve(m.key, vars), resolve(m.value, vars)]);
  const a = effectiveAuth(d, path);
  const R = s => resolve(s || '', vars);
  if (a.type === 'bearer') meta.push(['authorization', 'Bearer ' + R(a.token)]);
  if (a.type === 'basic') meta.push(['authorization', 'Basic ' + btoa(`${R(a.username)}:${R(a.password)}`)]);
  if (a.type === 'apikey' && a.key) meta.push([R(a.key).toLowerCase(), R(a.value)]);
  if (a.type === 'oauth2' && a.accessToken) meta.push(['authorization', `${a.headerPrefix ?? 'Bearer'} ${R(a.accessToken)}`.trim()]);
  return meta;
}

async function invoke(tab) {
  const d = tab.draft, r = rt(tab);
  if (!d.url) return toast('Enter the server address', 'error');
  if (!d.service || !d.method) { r.subTab = 'definition'; renderGrpc(tab, document.getElementById('view')); return toast('Load the service definition and select a method', 'error'); }
  const vars = varMap(chainOf(d, tab.ref)[0]?.id);
  r.loading = true; r.res = null; r.messages = [];
  r.paint?.();
  const spec = sourceSpec(tab);
  const res = await api.grpcInvoke({ id: tab.id, url: resolve(d.url, vars), tls: d.tls, source: spec, service: d.service, method: d.method, message: resolve(d.message, vars), metadata: metadataPairs(tab), deadlineMs: d.settings?.deadlineMs, sslVerify: d.settings?.sslVerify, caPath: spec.caPath, certPath: spec.certPath, keyPath: spec.keyPath });
  r.loading = false;
  if (res.streaming) { r.streaming = true; r.res = null; }
  else r.res = res;
  log({ type: res.ok ? 'http' : 'error', text: `gRPC ${d.service}/${d.method} → ${res.ok ? (res.streaming ? 'stream opened' : `${res.status?.code} ${res.status?.name} · ${res.time} ms`) : res.error}` });
  r.paint?.();
}
