// Bootstraps the UI and wires modules together.
import { W, T, loadState, saveW, saveT, varList, activeEnv, find, KINDS, resolve, varMap, dynamicList } from './state.js';
import { $, h, esc, icon, bus, toast, modal, menuFor, dragResize, ask, setVarKnown } from './ui.js';
import { loadMonaco, setEditorTheme, setEditorOptions, setVarProvider, sweep } from './editor.js';
import { renderTabs, activeTab, openTab, newRequestTab, closeTab, nextTab, gotoTab, reopenClosed, saveTab, rt } from './tabs.js';
import { initSidebar, renderSidebar, toggleSidebar, focusFilter, applySideVisibility } from './sidebar.js';
import { renderHttp, send } from './views/http.js';
import { renderRealtime } from './views/realtime.js';
import { renderGrpc } from './views/grpc.js';
import { renderContainer, renderEnv, renderExample } from './views/container.js';
import { renderRunner, openRunner } from './views/runner.js';
import { openCodegen } from './codegen.js';
import { initConsole, toggleConsole } from './console.js';
import { checkAi, toggleAi, renderAi, askAi, aiGenerateRequest, aiGenerateCollection } from './ai.js';
import { openSettings, openCookies, shortcutSheet } from './settings.js';
import { initShortcuts } from './shortcuts.js';
import { openPalette } from './palette.js';
import { importText } from './importers.js';
import { appImportDialog } from './appimport.js';

// ---------- theme ----------
const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = W.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : W.settings.theme;
  document.documentElement.dataset.theme = t;
  document.documentElement.style.setProperty('--fs', (W.settings.fontSize || 13) + 'px');
  setEditorTheme(t === 'dark');
  setEditorOptions({ fontSize: W.settings.editorFontSize || 13, wordWrap: W.settings.wordWrap !== false });
}
media.addEventListener('change', applyTheme);

// ---------- main view ----------
function renderView() {
  const el = $('#view');
  const t = activeTab();
  el.replaceChildren();
  if (!t) { el.append(launchpad()); sweep(); return; }
  const k = t.kind;
  if (k === 'request') {
    const kind = t.draft.kind || 'http';
    if (kind === 'http' || kind === 'graphql') renderHttp(t, el);
    else if (kind === 'grpc') renderGrpc(t, el);
    else renderRealtime(t, el);
  } else if (k === 'container') renderContainer(t, el);
  else if (k === 'env') renderEnv(t, el);
  else if (k === 'example') renderExample(t, el);
  else if (k === 'runner') renderRunner(t, el);
  sweep();
  renderAi();
}

function launchpad() {
  const kinds = Object.entries(KINDS);
  const el = h(`<div class="empty" style="max-width:760px"><img src="/assets/icons/128.png" width="72" height="72" alt="" style="opacity:.9"><div class="big" style="font-size:18px;margin:8px 0 2px">Welcome to My Postmaster</div><div class="dim">Start a request, open one from the sidebar, or press <kbd>Ctrl</kbd>+<kbd>K</kbd> to search.</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0">${kinds.map(([k, x]) => `<button data-k="${k}" style="flex-direction:column;padding:14px;gap:6px;height:auto">${icon(x.icon)}<b>${x.label}</b></button>`).join('')}<button data-ai style="flex-direction:column;padding:14px;gap:6px;height:auto">${icon('spark')}<b>Ask Claude</b></button></div>
    <div class="row-flex" style="justify-content:center"><button data-import>${icon('download')} Import</button><button data-col>${icon('collections')} New collection</button><button data-keys>${icon('keyboard')} Shortcuts</button></div></div>`);
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => newRequestTab(b.dataset.k));
  el.querySelector('[data-ai]').onclick = () => aiGenerateRequest(null);
  el.querySelector('[data-import]').onclick = importDialog;
  el.querySelector('[data-col]').onclick = () => { T.ui.side = 'collections'; T.ui.sideHidden = false; applySideVisibility(); $('#sideAdd').click(); };
  el.querySelector('[data-keys]').onclick = cheatsheet;
  return el;
}

// ---------- dialogs ----------
function newDialog() {
  const items = [...Object.entries(KINDS).map(([k, x]) => [k, x.label, x.desc, x.icon]), ['collection', 'Collection', 'Group and share requests', 'collections'], ['environment', 'Environment', 'Variables for dev / staging / prod', 'env'], ['mock', 'Mock server', 'Serve saved examples locally', 'server'], ['aicol', 'Collection with Claude', 'Describe an API, get a collection', 'spark']];
  const grid = h(`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${items.map(([k, l, d, ic], i) => `<button data-k="${k}" style="flex-direction:column;align-items:flex-start;height:auto;padding:12px;gap:4px;text-align:left;white-space:normal" ${i === 0 ? 'autofocus' : ''}>${icon(ic)}<b>${l}</b><span class="dim" style="font-size:12px">${d}</span></button>`).join('')}</div>`);
  let m;
  grid.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    m.close(null);
    const k = b.dataset.k;
    if (KINDS[k]) newRequestTab(k);
    else if (k === 'collection') { T.ui.side = 'collections'; T.ui.sideHidden = false; applySideVisibility(); renderSidebar(); $('#sideAdd').click(); }
    else if (k === 'environment') { T.ui.side = 'environments'; T.ui.sideHidden = false; applySideVisibility(); renderSidebar(); $('#sideAdd').click(); }
    else if (k === 'mock') { T.ui.side = 'mocks'; T.ui.sideHidden = false; applySideVisibility(); renderSidebar(); $('#sideAdd').click(); }
    else if (k === 'aicol') aiGenerateCollection();
  });
  grid.onkeydown = e => {
    const bs = [...grid.querySelectorAll('button')];
    const i = bs.indexOf(document.activeElement);
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
    if (d && i >= 0) { e.preventDefault(); bs[Math.max(0, Math.min(bs.length - 1, i + d))].focus(); }
  };
  modal({ title: 'Create new', cls: 'wide', body: grid, buttons: [], onMount: x => { m = x; } });
}

async function importDialog() {
  const body = h(`<div class="col-flex">
    <div class="callout">Postman collections (v2.0 / v2.1), environments, globals and data dumps · OpenAPI 3 & Swagger 2 (JSON/YAML) · HAR · Insomnia v4 · cURL · My Postmaster backups</div>
    <div class="row-flex"><button class="primary" data-file>${icon('file')} Choose files…</button><span class="dim">or drop files anywhere in this dialog</span></div>
    <div class="row-flex" data-apps style="display:none"><span class="dim">From an installed app:</span></div>
    <label class="f">Link<div class="row-flex"><input data-url placeholder="https://example.com/openapi.yaml" style="flex:1"><button data-fetch>Fetch</button></div></label>
    <label class="f">Raw text / cURL<textarea data-raw rows="9" class="mono" placeholder="Paste JSON, YAML or a cURL command"></textarea></label></div>`);
  const run = (text, name) => {
    try {
      const res = importText(text, name);
      for (const r of res) if (r.kind === 'request') openTab({ kind: 'request', draft: r.item });
      toast('Imported: ' + res.map(r => r.name || r.item?.name).join(', '));
      if (res.some(r => r.kind === 'collection' || r.kind === 'backup')) T.ui.side = 'collections';
      if (res.some(r => r.kind === 'environment' || r.kind === 'globals')) { T.ui.side = 'environments'; bus.emit('env'); }
      T.ui.sideHidden = false; applySideVisibility();
      bus.emit('tree');
      return true;
    } catch (e) { toast(`${name || 'Import'}: ${e.message}`, 'error'); return false; }
  };
  let m;
  api.appimportSources().then(list => {
    const row = body.querySelector('[data-apps]');
    for (const src of list) {
      const b = h(`<button ${src.found ? '' : 'disabled title="Not installed"'}>${icon('download')} ${esc(src.name)}</button>`);
      b.onclick = async () => { m.close(null); if (await appImportDialog(src.id)) { T.ui.side = 'collections'; T.ui.sideHidden = false; applySideVisibility(); bus.emit('tree'); } };
      row.append(b);
    }
    if (list.some(s => s.found)) row.style.display = "";
  });
  body.querySelector('[data-file]').onclick = async () => {
    const files = await api.dialogOpen({ multi: true, text: true, filters: [{ name: 'API definitions', extensions: ['json', 'yaml', 'yml', 'har', 'txt', 'sh'] }, { name: 'All files', extensions: ['*'] }] });
    if (!files) return;
    let ok = false;
    for (const f of files) ok = run(f.text, f.name) || ok;
    if (ok) m.close(null);
  };
  body.ondragover = e => e.preventDefault();
  body.ondrop = async e => { e.preventDefault(); let ok = false; for (const f of e.dataTransfer.files) ok = run(await f.text(), f.name) || ok; if (ok) m.close(null); };
  body.querySelector('[data-fetch]').onclick = async () => {
    const url = body.querySelector('[data-url]').value.trim();
    if (!url) return;
    const r = await api.httpSend({ method: 'GET', url, headers: [], bodyKind: 'text', settings: {} });
    if (!r.ok || r.status >= 400) return toast(`Could not fetch: ${r.error || r.status}`, 'error');
    if (run(r.body, url.split('/').pop())) m.close(null);
  };
  modal({ title: 'Import', cls: 'wide', body, buttons: [['Cancel', null], ['Import', () => { const t = body.querySelector('[data-raw]').value; if (!t.trim()) { toast('Choose a file, enter a link, or paste text', 'error'); return false; } return run(t, '') ? null : false; }, 'primary']], onMount: x => { m = x; } });
}

const cheatsheet = () => modal({ title: 'Keyboard shortcuts', cls: 'wide', body: shortcutSheet() });

function envQuickLook() {
  const env = activeEnv();
  const t = activeTab();
  const colId = t?.ref ? find(t.ref)?.collection?.id : null;
  const col = colId && W.collections.find(c => c.id === colId);
  const row = (rows, masked) => rows.filter(v => v.key).map(v => `<tr><td class="k mono">${esc(v.key)}</td><td class="mono">${v.secret || masked ? '••••••' : esc(v.value)}</td></tr>`).join('') || '<tr><td colspan=2 class="dim">No variables</td></tr>';
  const body = h(`<div class="col-flex">
    <div class="row-flex"><b>${env ? esc(env.name) : 'No environment selected'}</b><span class="sp"></span>${env ? '<button class="sm" data-edit-env>Edit</button>' : ''}</div>
    ${env ? `<table class="grid"><tbody>${row(env.vars)}</tbody></table>` : ''}
    ${col ? `<div class="row-flex"><b>Collection: ${esc(col.name)}</b><span class="sp"></span><button class="sm" data-edit-col>Edit</button></div><table class="grid"><tbody>${row(col.vars || [])}</tbody></table>` : ''}
    <div class="row-flex"><b>Globals</b><span class="sp"></span><button class="sm" data-edit-glob>Edit</button></div><table class="grid"><tbody>${row(W.globals)}</tbody></table></div>`);
  let m;
  body.querySelector('[data-edit-env]')?.addEventListener('click', () => { m.close(null); openTab({ kind: 'env', ref: env.id, draft: env }); });
  body.querySelector('[data-edit-col]')?.addEventListener('click', () => { m.close(null); const { items, ...rest } = col; openTab({ kind: 'container', ref: col.id, draft: rest }); rt(activeTab()).subTab = 'vars'; bus.emit('render-view'); });
  body.querySelector('[data-edit-glob]').onclick = () => { m.close(null); openTab({ kind: 'env', ref: 'globals', draft: { id: 'globals', name: 'Globals', vars: JSON.parse(JSON.stringify(W.globals)) } }); };
  modal({ title: 'Variables in scope', body, onMount: x => { m = x; } });
}

function renderEnvSelect() {
  const s = $('#envSel');
  s.innerHTML = `<option value="">No environment</option>${W.environments.map(e => `<option value="${e.id}" ${e.id === W.activeEnv ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}`;
}

// ---------- status bar ----------
let consoleCount = 0, consoleErr = false;
function renderStatus() {
  const el = $('#status');
  el.replaceChildren();
  const b = (ic, label, title, fn, on) => { const x = h(`<button class="${on ? 'on' : ''}" title="${title}">${icon(ic)}${label ? ' ' + label : ''}</button>`); x.onclick = fn; el.append(x); return x; };
  b('sidebar', '', 'Toggle sidebar (Ctrl+\\)', toggleSidebar, !T.ui.sideHidden);
  b('terminal', `Console${consoleCount ? ` (${consoleCount})` : ''}`, 'Console (Ctrl+Alt+C)', () => toggleConsole(), T.ui.consoleOpen).style.color = consoleErr && !T.ui.consoleOpen ? 'var(--bad)' : '';
  b('cookie', 'Cookies', 'Manage cookies', openCookies);
  b('play', 'Runner', 'Run a collection', runnerPicker);
  b(W.settings.layout === 'side' ? 'layout' : 'layoutH', '', 'Toggle two-pane view (Ctrl+Alt+V)', toggleLayout);
  el.append(h(`<span class="sp"></span>`));
  b('keyboard', '', 'Keyboard shortcuts (Ctrl+/)', cheatsheet);
  const ai = b('spark', '', '', () => toggleAi());
  ai.id = 'aiStatus';
  paintAiStatus();
}
function paintAiStatus(s = window.__aiStatus) {
  const el = $('#aiStatus');
  if (!el || !s) return;
  el.innerHTML = `${icon('spark')} ${s.loggedIn ? 'Claude connected' : 'Claude: sign in'}`;
  el.classList.toggle('on', s.loggedIn);
  el.title = s.loggedIn ? 'AI uses your Claude subscription via Claude Code' : s.reason;
}
async function runnerPicker() {
  if (!W.collections.length) return toast('Create a collection first', 'error');
  const t = activeTab();
  const cur = t?.ref && find(t.ref)?.collection?.id;
  const opts = [];
  const walkC = (n, depth) => { if (!n.items) return; opts.push([n.id, '  '.repeat(depth) + n.name]); n.items.forEach(c => walkC(c, depth + 1)); };
  W.collections.forEach(c => walkC(c, 0));
  const v = await ask('Run collection', [['id', 'Collection or folder', cur || opts[0][0], opts]], 'Open runner');
  if (v) openRunner(v.id);
}
function toggleLayout() { W.settings.layout = W.settings.layout === 'side' ? 'stacked' : 'side'; saveW(); renderStatus(); renderView(); }

// ---------- find in page ----------
function toggleFind(force) {
  const bar = $('#findbar');
  const open = force ?? !bar.classList.contains('open');
  bar.classList.toggle('open', open);
  if (open) { $('#findInput').focus(); $('#findInput').select(); } else { api.appFind(''); $('#findCount').textContent = ''; }
}
function initFind() {
  const input = $('#findInput');
  input.oninput = () => api.appFind(input.value, {});
  input.onkeydown = e => { if (e.key === 'Enter') api.appFind(input.value, { forward: !e.shiftKey, findNext: true }); if (e.key === 'Escape') toggleFind(false); };
  $('#findNext').onclick = () => api.appFind(input.value, { forward: true, findNext: true });
  $('#findPrev').onclick = () => api.appFind(input.value, { forward: false, findNext: true });
  $('#findClose').onclick = () => toggleFind(false);
  api.on('find-result', r => { if (r.finalUpdate) $('#findCount').textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : 'No results'; });
}

// ---------- {{variable}} autocomplete in plain inputs ----------
function initVarAutocomplete() {
  let pop = null, target = null, items = [], idx = 0, start = 0;
  const close = () => { pop?.remove(); pop = null; target = null; };
  const currentVars = () => {
    const t = activeTab();
    const colId = t?.ref ? find(t.ref)?.collection?.id : null;
    return [...varList(colId), ...dynamicList()];
  };
  const choose = i => {
    const it = items[i];
    if (!it || !target) return;
    const el = target;
    const pos = el.selectionStart;
    const after = el.value.slice(pos);
    const closeBraces = after.startsWith('}}') ? '' : '}}';
    el.value = el.value.slice(0, start) + it.key + closeBraces + after;
    const caret = start + it.key.length + 2;
    el.setSelectionRange(caret, caret);
    close();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const paint = () => pop?.querySelectorAll('.vi').forEach((x, i) => { x.classList.toggle('on', i === idx); if (i === idx) x.scrollIntoView({ block: 'nearest' }); });
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el.classList?.contains('var-input') || el.type === 'password') return close();
    const before = el.value.slice(0, el.selectionStart);
    const m = /\{\{([\w.$-]*)$/.exec(before);
    if (!m) return close();
    start = el.selectionStart - m[1].length;
    const q = m[1].toLowerCase();
    items = currentVars().filter(v => v.key.toLowerCase().includes(q)).slice(0, 40);
    if (!items.length) return close();
    target = el;
    idx = 0;
    pop?.remove();
    pop = h(`<div class="varpop" role="listbox">${items.map((v, i) => `<div class="vi ${i === 0 ? 'on' : ''}" data-i="${i}"><span>${esc(v.key)}</span><span class="sc">${esc(v.scope)}</span><span class="val">${esc(v.value)}</span></div>`).join('')}</div>`);
    pop.onmousedown = ev => { ev.preventDefault(); const x = ev.target.closest('.vi'); if (x) choose(+x.dataset.i); };
    document.body.append(pop);
    const r = el.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - 300) + 'px';
    pop.style.top = (r.bottom + 4 + 260 > innerHeight ? r.top - 264 : r.bottom + 4) + 'px';
  }, true);
  document.addEventListener('keydown', e => {
    if (!pop || e.target !== target) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); idx = Math.min(items.length - 1, idx + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); idx = Math.max(0, idx - 1); paint(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); choose(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  document.addEventListener('focusout', e => { if (e.target === target) setTimeout(close, 100); });
  // Hover: show resolved values of {{vars}} in an input.
  document.addEventListener('mouseover', e => {
    const el = e.target;
    if (!el.classList?.contains('var-input') || el.type === 'password' || !el.value?.includes('{{')) return;
    const t = activeTab();
    const vars = varMap(t?.ref ? find(t.ref)?.collection?.id : null);
    const names = [...new Set([...el.value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m => m[1]))];
    el.title = names.map(n => `{{${n}}} = ${n in vars ? vars[n] : globalThis.MP_DYNAMIC.dynamicFor(n) ? '(dynamic — new value each send)' : '⚠ unresolved'}`).join('\n') + (el.classList.contains('url') ? `\n\n→ ${resolve(el.value, vars)}` : '');
  });
}

// ---------- boot ----------
async function boot() {
  const d = await loadState();
  window.APP_VERSION = d.version;
  applyTheme();
  await loadMonaco();
  applyTheme();
  setVarKnown(k => { const t = activeTab(); return k in varMap(t?.ref ? find(t.ref)?.collection?.id : null) || !!globalThis.MP_DYNAMIC.dynamicFor(k); });
  setVarProvider(() => { const t = activeTab(); return [...varList(t?.ref ? find(t.ref)?.collection?.id : null), ...dynamicList()]; });

  $('#btnNew').innerHTML = `${icon('plus')}<span class="bl">New</span>`;
  $('#btnNew').onclick = e => menuFor(e.currentTarget, [
    ...Object.entries(KINDS).map(([k, x]) => ({ label: x.label, icon: x.icon, kb: k === 'http' ? 'Ctrl+T' : '', run: () => newRequestTab(k) })),
    '-', { label: 'More… ', icon: 'plus', kb: 'Ctrl+N', run: newDialog },
  ]);
  $('#btnImport').innerHTML = `${icon('download')}<span class="bl">Import</span>`;
  $('#btnImport').onclick = importDialog;
  $('#searchbox').innerHTML = `${icon('search')}<span>Search</span><span class="sp"></span><kbd>Ctrl</kbd><kbd>K</kbd>`;
  $('#searchbox').onclick = search;
  $('#searchbox').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') search(); };
  $('#envEye').innerHTML = icon('eye');
  $('#envEye').onclick = envQuickLook;
  $('#envSel').onchange = e => { W.activeEnv = e.target.value || null; saveW(); bus.emit('env'); };
  $('#btnSettings').innerHTML = icon('gear');
  $('#btnSettings').onclick = () => openSettings();
  $('#btnAi').innerHTML = `${icon('spark')}<span class="bl">Claude</span>`;
  $('#btnAi').onclick = () => toggleAi();

  dragResize($('#sideResizer'), { axis: 'x', onMove: (dx) => { const w = Math.max(200, Math.min(560, (T.ui._sw ??= T.ui.sideW || 280) + dx)); T.ui.sideW = w; $('#main').style.setProperty('--side-w', w + 'px'); }, onEnd: () => { delete T.ui._sw; saveT(); } });

  initSidebar();
  initConsole();
  initFind();
  initVarAutocomplete();
  initShortcuts({
    newTab: () => newRequestTab(), closeTab: () => closeTab(), forceCloseTab: () => closeTab(T.active, true), nextTab, gotoTab,
    reopenTab: reopenClosed, searchTabs: () => openPalette({ tabsOnly: true }),
    focusUrl: () => { const t = activeTab(); if (t) rt(t).focusUrl?.(); },
    save: () => saveTab(), saveAs: () => { const t = activeTab(); if (t?.kind === 'request') saveTab(t, true); },
    send: sendActive, sendDownload: () => { const t = activeTab(); if (t?.kind === 'request' && ['http', 'graphql'].includes(t.draft.kind || 'http')) send(t, true); },
    focusRequest: () => { const t = activeTab(); t && rt(t).focusReq?.(); }, focusResponse: () => { const t = activeTab(); t && rt(t).focusRes?.(); },
    beautify: () => { const t = activeTab(); t && rt(t).beautify?.(); },
    searchSidebar: focusFilter, toggleSidebar, search, zoom: d => api.zoom(d), find: () => toggleFind(), toggleLayout, cheatsheet,
    newDialog, newWindow: () => api.appNewWindow(), import: importDialog, settings: () => openSettings(), console: () => toggleConsole(), devtools: () => api.appDevtools(),
  });

  bus.on('tab', () => { renderTabs(); renderView(); saveT(); });
  bus.on('render-view', renderView);
  bus.on('codegen', t => t && openCodegen(t));
  bus.on('ai-generate', t => aiGenerateRequest(t));
  bus.on('ai-quick', k => askAi({ debug: 'This request failed or returned something unexpected. Diagnose the most likely causes and give concrete fixes (URL, method, headers, auth, body, variables, TLS/proxy).' }[k] || k, 'Debug error'));
  bus.on('run', id => openRunner(id));
  bus.on('import', importDialog);
  bus.on('cookies', openCookies);
  bus.on('save-active', () => saveTab());
  bus.on('env', () => { renderEnvSelect(); renderSidebar(); });
  bus.on('vars', () => { for (const t of T.tabs) if (t.kind === 'env') rt(t).refresh?.(); renderEnvSelect(); });
  bus.on('settings', () => { applyTheme(); renderStatus(); renderView(); });
  bus.on('workspace', () => { applyTheme(); renderEnvSelect(); renderTabs(); });
  bus.on('console-count', (n, err) => { consoleCount = n; consoleErr = n ? (consoleErr || err) : false; renderStatus(); });
  bus.on('ai-status', s => { window.__aiStatus = s; paintAiStatus(s); });

  renderEnvSelect();
  renderSidebar();
  renderTabs();
  renderView();
  renderStatus();
  if (T.ui.aiOpen) toggleAi(true);
  checkAi();
  window.addEventListener('beforeunload', () => { api.sessionSave({ tabs: T.tabs, active: T.active, closed: T.closed.slice(-25), ui: T.ui }); });
  document.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', async e => {
    if (!e.dataTransfer?.files?.length || e.target.closest('.modal')) return;
    e.preventDefault();
    for (const f of e.dataTransfer.files) { try { const r = importText(await f.text(), f.name); toast('Imported ' + r.map(x => x.name || x.item?.name).join(', ')); for (const x of r) if (x.kind === 'request') openTab({ kind: 'request', draft: x.item }); bus.emit('tree'); bus.emit('env'); } catch (err) { toast(`${f.name}: ${err.message}`, 'error'); } }
  });
}

function sendActive() {
  const t = activeTab();
  if (!t) return;
  if (t.kind === 'runner') return;
  if (t.kind !== 'request') return;
  const k = t.draft.kind || 'http';
  if (k === 'http' || k === 'graphql') send(t);
  else if (k === 'grpc') document.querySelector('[data-invoke]')?.click();
  else rt(t).sendMessage?.();
}

function search() {
  const t = activeTab();
  openPalette({
    commands: [
      ...Object.entries(KINDS).map(([k, x]) => ({ label: `New ${x.label} request`, icon: x.icon, run: () => newRequestTab(k) })),
      { label: 'Import', icon: 'download', kb: 'Ctrl+O', run: importDialog },
      { label: 'Settings', icon: 'gear', kb: 'Ctrl+,', run: () => openSettings() },
      { label: 'Toggle console', icon: 'terminal', kb: 'Ctrl+Alt+C', run: () => toggleConsole() },
      { label: 'Manage cookies', icon: 'cookie', run: openCookies },
      { label: 'Run a collection', icon: 'play', run: runnerPicker },
      { label: 'Toggle theme (dark / light)', icon: 'moon', run: () => { W.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; saveW(); applyTheme(); } },
      { label: 'Toggle two-pane view', icon: 'layout', kb: 'Ctrl+Alt+V', run: toggleLayout },
      { label: 'Keyboard shortcuts', icon: 'keyboard', kb: 'Ctrl+/', run: cheatsheet },
      { label: 'Ask Claude', icon: 'spark', run: () => toggleAi(true) },
      { label: 'Build a request with Claude', icon: 'spark', run: () => aiGenerateRequest(t) },
      { label: 'Generate a collection with Claude', icon: 'spark', run: aiGenerateCollection },
      { label: 'New window', icon: 'window', kb: 'Ctrl+Shift+N', run: () => api.appNewWindow() },
      ...(t?.kind === 'request' ? [{ label: 'Generate code snippet', icon: 'code', run: () => openCodegen(t) }] : []),
      ...(t?.ref && find(t.ref) ? [{ label: 'Reveal current item in sidebar', icon: 'sidebar', run: () => bus.emit('reveal', t.ref) }] : []),
      ...W.environments.map(e => ({ label: `Use environment: ${e.name}`, icon: 'env', run: () => { W.activeEnv = e.id; saveW(); bus.emit('env'); } })),
    ],
  });
}

boot().catch(e => { document.body.innerHTML = `<pre style="padding:20px;color:#f66;white-space:pre-wrap">Failed to start: ${esc(e.stack || e.message)}</pre>`; console.error(e); });
