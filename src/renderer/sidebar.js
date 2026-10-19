// Sidebar: collections tree (keyboard + drag & drop), environments, history, mock servers.
import { W, T, find, newItem, isContainer, kindBadge, reId, saveW, saveT, flatRequests, KINDS } from './state.js';
import { $, h, esc, icon, contextMenu, menuFor, ask, confirmDlg, toast, bus, uid, clone, kvRow, modal } from './ui.js';
import { openNode, openTab, newRequestTab, syncTabsWithTree, activeTab } from './tabs.js';
import { toPostmanCollection, toPostmanEnv, toPostmanGlobals } from './importers.js';

const SECTIONS = [['collections', 'Collections', 'collections'], ['environments', 'Environments', 'env'], ['history', 'History', 'history'], ['mocks', 'Mock Servers', 'server']];
let clipboard = null;
let dragId = null;
let mocksRunning = new Set();
let renaming = null;

export function initSidebar() {
  const rail = $('#rail');
  for (const [k, label, ic] of SECTIONS) {
    const b = h(`<button data-s="${k}" title="${label}" aria-label="${label}">${icon(ic)}</button>`);
    b.onclick = () => { if (T.ui.side === k && !T.ui.sideHidden) toggleSidebar(); else { T.ui.side = k; T.ui.sideHidden = false; applySideVisibility(); saveT(); renderSidebar(); } };
    rail.append(b);
  }
  rail.append(h(`<span class="sp"></span>`));
  const cookies = h(`<button title="Cookies" aria-label="Cookies">${icon('cookie')}</button>`);
  cookies.onclick = () => bus.emit('cookies');
  rail.append(cookies);
  $('#filter').oninput = () => renderSidebar();
  $('#filter').onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); $('#tree').focus(); moveCursor(1); } if (e.key === 'Escape') { $('#filter').value = ''; renderSidebar(); $('#tree').focus(); } };
  $('#sideAdd').innerHTML = icon('plus');
  $('#sideAdd').onclick = () => addInSection();
  $('#sideMore').innerHTML = icon('more');
  $('#sideMore').onclick = e => sectionMenu(e.currentTarget);
  $('#tree').addEventListener('keydown', treeKeys);
  applySideVisibility();
  bus.on('tree', () => { syncTabsWithTree(); renderSidebar(); });
  bus.on('tree-soft', () => renderSidebar());
  bus.on('history', () => { if (T.ui.side === 'history') renderSidebar(); });
  bus.on('env', () => { if (T.ui.side === 'environments') renderSidebar(); });
  bus.on('workspace', () => { syncTabsWithTree(); renderSidebar(); });
  bus.on('tab', () => renderSidebar());
  bus.on('reveal', reveal);
}

export function toggleSidebar() { T.ui.sideHidden = !T.ui.sideHidden; applySideVisibility(); saveT(); }
export function applySideVisibility() {
  $('#main').classList.toggle('noside', !!T.ui.sideHidden);
  $('#main').style.setProperty('--side-w', (T.ui.sideW || 280) + 'px');
}
export const focusFilter = () => { if (T.ui.sideHidden) toggleSidebar(); $('#filter').focus(); $('#filter').select(); };

// ---------- rendering ----------
let rows = []; // visible rows in order (for keyboard nav)
export function renderSidebar() {
  document.querySelectorAll('#rail [data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === T.ui.side && !T.ui.sideHidden));
  const sec = SECTIONS.find(s => s[0] === T.ui.side) || SECTIONS[0];
  $('#sideTitle').textContent = sec[1];
  $('#sideAdd').title = { collections: 'New collection', environments: 'New environment', history: 'New request', mocks: 'New mock server' }[sec[0]];
  const tree = $('#tree');
  const scroll = tree.scrollTop;
  tree.replaceChildren();
  rows = [];
  const f = $('#filter').value.trim().toLowerCase();
  if (sec[0] === 'collections') renderCollections(tree, f);
  if (sec[0] === 'environments') renderEnvs(tree, f);
  if (sec[0] === 'history') renderHistory(tree, f);
  if (sec[0] === 'mocks') renderMocks(tree, f);
  tree.scrollTop = scroll;
}

function nodeRow({ id, depth, html, cls = '', title = '' }) {
  const el = h(`<div class="node ${cls}" data-id="${esc(id)}" role="treeitem" style="padding-left:${6 + depth * 14}px" title="${esc(title)}">${html}</div>`);
  if (T.ui.cursor === id) el.classList.add('cursor', 'sel');
  rows.push({ id, el });
  return el;
}

function renderCollections(tree, f) {
  if (!W.collections.length) {
    const e = h(`<div class="empty-side">${icon('collections')}<div>Collections group your requests.</div><div class="col-flex" style="margin-top:12px;align-items:center"><button class="primary" data-new>${icon('plus')} Create collection</button><button data-imp>${icon('download')} Import</button></div></div>`);
    e.querySelector('[data-new]').onclick = () => addInSection();
    e.querySelector('[data-imp]').onclick = () => bus.emit('import');
    return tree.append(e);
  }
  const activeRef = activeTab()?.ref;
  const matches = n => !f || (n.name || '').toLowerCase().includes(f) || (n.url || '').toLowerCase().includes(f) || (n.items || []).some(matches) || (n.examples || []).some(e => e.name.toLowerCase().includes(f));
  const walk = (items, depth) => {
    for (const n of items) {
      if (!matches(n)) continue;
      const open = n.open || !!f;
      if (isContainer(n)) {
        const isCol = n.kind === 'collection';
        const el = nodeRow({ id: n.id, depth, cls: activeRef === n.id ? 'open-tab' : '', html: `<span class="chev">${icon(open ? 'chevD' : 'chevR')}</span>${icon(isCol ? 'collections' : 'folder')}<span class="nm">${esc(n.name)}</span><button class="ghost sm more" aria-label="More actions">${icon('more')}</button>` });
        wireRow(el, n);
        tree.append(el);
        if (open) {
          walk(n.items, depth + 1);
          if (!n.items.length && !f) tree.append(h(`<div class="dim" style="padding:4px 0 4px ${26 + (depth + 1) * 14}px;font-size:12px">${isCol ? 'This collection is empty' : 'This folder is empty'} · <a href="#" data-add="${n.id}" style="color:var(--acc)">Add a request</a></div>`));
        }
      } else {
        const hasEx = n.examples?.length;
        const exOpen = n.open && hasEx;
        const badge = kindBadge(n);
        const el = nodeRow({ id: n.id, depth, cls: activeRef === n.id ? 'open-tab' : '', title: n.url || '', html: `<span class="chev">${hasEx ? icon(exOpen || f ? 'chevD' : 'chevR') : ''}</span><span class="m ${n.kind === 'http' || !n.kind ? esc(n.method) : 'k-' + n.kind}">${esc(badge)}</span><span class="nm">${esc(n.name)}</span><button class="ghost sm more" aria-label="More actions">${icon('more')}</button>` });
        wireRow(el, n);
        tree.append(el);
        if (exOpen || (f && hasEx)) for (const ex of n.examples) {
          if (f && !ex.name.toLowerCase().includes(f) && !matches({ name: n.name, url: n.url })) continue;
          const xe = nodeRow({ id: ex.id, depth: depth + 1, cls: activeRef === ex.id ? 'open-tab' : '', html: `<span class="chev"></span>${icon('file')}<span class="nm">${esc(ex.name)}</span><button class="ghost sm more">${icon('more')}</button>` });
          wireRow(xe, ex, true);
          tree.append(xe);
        }
      }
    }
  };
  walk(W.collections, 0);
  tree.querySelectorAll('[data-add]').forEach(a => a.onclick = e => { e.preventDefault(); addRequestTo(find(a.dataset.add).node, 'http'); });
  if (f && !rows.length) tree.append(h(`<div class="empty-side">No results for "${esc(f)}"</div>`));
}

function wireRow(el, n, isExample = false) {
  el.onclick = e => {
    if (e.target.closest('.more')) return;
    T.ui.cursor = n.id;
    if (isContainer(n)) { n.open = !n.open; saveW(); }
    else if (!isExample && e.target.closest('.chev') && n.examples?.length) { n.open = !n.open; saveW(); }
    else openNode(n);
    renderSidebar();
  };
  el.ondblclick = e => { if (!e.target.closest('.more')) startRename(n); };
  el.querySelector('.more').onclick = e => { e.stopPropagation(); T.ui.cursor = n.id; itemMenu(n, e.currentTarget.getBoundingClientRect()); };
  el.oncontextmenu = e => { e.preventDefault(); T.ui.cursor = n.id; renderSidebar(); itemMenu(n, { left: e.clientX, bottom: e.clientY }); };
  if (isExample) return;
  el.draggable = true;
  el.ondragstart = e => { dragId = n.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.name); };
  el.ondragend = () => { dragId = null; el.classList.remove('dragging'); };
  el.ondragover = e => {
    if (!dragId || dragId === n.id) return;
    const pos = dropPos(e, el, n);
    if (!pos) return;
    e.preventDefault();
    el.classList.toggle('drop-in', pos === 'in');
    el.classList.toggle('drop-before', pos === 'before');
  };
  el.ondragleave = () => el.classList.remove('drop-in', 'drop-before');
  el.ondrop = e => {
    e.preventDefault();
    el.classList.remove('drop-in', 'drop-before');
    const pos = dropPos(e, el, n);
    if (pos) moveNode(dragId, n.id, pos);
    dragId = null;
  };
}

function dropPos(e, el, target) {
  const src = find(dragId);
  if (!src || src.example) return null;
  const tf = find(target.id);
  if (!tf || tf.example) return null;
  // can't drop a container into its own subtree
  if (isContainer(src.node) && (target.id === src.node.id || tf.path.some(p => p.id === src.node.id))) return null;
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  const isCol = src.node.kind === 'collection';
  if (isCol) return target.kind === 'collection' ? 'before' : null;
  if (isContainer(target) && y > 0.3) return 'in';
  if (target.kind === 'collection') return 'in';
  return 'before';
}

function moveNode(id, targetId, pos) {
  const src = find(id);
  const node = src.node;
  src.list.splice(src.list.indexOf(node), 1);
  const tf = find(targetId);
  if (pos === 'in') { tf.node.items.push(node); tf.node.open = true; }
  else { const list = tf.list; list.splice(list.indexOf(tf.node), 0, node); }
  saveW();
  bus.emit('tree');
}

// ---------- item actions ----------
function itemMenu(n, rect) {
  const f = find(n.id);
  const isCol = n.kind === 'collection';
  const items = [];
  if (f?.example) items.push(
    { label: 'Open', icon: 'file', run: () => openNode(n) },
    { label: 'Rename', icon: 'edit', kb: 'Ctrl+E', run: () => startRename(n) },
    { label: 'Duplicate', icon: 'copy', kb: 'Ctrl+D', run: () => duplicate(n) },
    '-', { label: 'Delete', icon: 'trash', kb: 'Del', danger: true, run: () => remove(n) });
  else if (isContainer(n)) {
    items.push(
      { label: 'Run ' + (isCol ? 'collection' : 'folder'), icon: 'play', run: () => bus.emit('run', n.id) },
      { label: 'Add request', icon: 'globe', run: () => addRequestTo(n, 'http') },
      { label: 'Add GraphQL request', icon: 'box', run: () => addRequestTo(n, 'graphql') },
      { label: 'Add WebSocket', icon: 'plug', run: () => addRequestTo(n, 'ws') },
      { label: 'Add Socket.IO', icon: 'bolt', run: () => addRequestTo(n, 'socketio') },
      { label: 'Add SSE / MQTT / gRPC…', icon: 'plus', run: () => pickKindFor(n) },
      { label: 'Add folder', icon: 'folder', run: () => addFolderTo(n) },
      '-',
      { label: isCol ? 'Edit collection' : 'Edit folder', icon: 'gear', run: () => openNode(n) },
      { label: 'Rename', icon: 'edit', kb: 'Ctrl+E', run: () => startRename(n) },
      { label: 'Duplicate', icon: 'copy', kb: 'Ctrl+D', run: () => duplicate(n) },
      { label: 'Copy', kb: 'Ctrl+C', run: () => copy(n) },
      clipboard && { label: 'Paste', kb: 'Ctrl+V', run: () => paste(n) },
      isCol && { label: 'Export', icon: 'upload', run: () => exportCollection(n) },
      isCol && { label: 'Mock collection', icon: 'server', run: () => createMock(n.id) },
      { label: isCol ? 'Expand all' : 'Expand', run: () => { setOpen(n, true); renderSidebar(); } },
      { label: 'Collapse all', run: () => { setOpen(n, false); renderSidebar(); } },
      '-', { label: 'Delete', icon: 'trash', kb: 'Del', danger: true, run: () => remove(n) });
  } else items.push(
    { label: 'Open in tab', icon: 'window', run: () => openNode(n) },
    { label: 'Rename', icon: 'edit', kb: 'Ctrl+E', run: () => startRename(n) },
    { label: 'Duplicate', icon: 'copy', kb: 'Ctrl+D', run: () => duplicate(n) },
    { label: 'Copy', kb: 'Ctrl+C', run: () => copy(n) },
    clipboard && { label: 'Paste', kb: 'Ctrl+V', run: () => paste(n) },
    (n.kind === 'http' || n.kind === 'graphql' || !n.kind) && { label: 'Generate code', icon: 'code', run: () => { openNode(n); setTimeout(() => bus.emit('codegen', activeTab()), 50); } },
    '-', { label: 'Delete', icon: 'trash', kb: 'Del', danger: true, run: () => remove(n) });
  contextMenu(rect.left, rect.bottom + 2, items);
}
const setOpen = (n, v) => { n.open = v; (n.items || []).forEach(c => isContainer(c) && setOpen(c, v)); saveW(); };

async function pickKindFor(n) {
  const v = await ask('Add request', [['kind', 'Type', 'sse', Object.entries(KINDS).map(([k, x]) => [k, `${x.label} — ${x.desc}`])]], 'Add');
  if (v) addRequestTo(n, v.kind);
}
export function addRequestTo(container, kind = 'http') {
  const r = newItem(kind);
  container.items.push(r);
  container.open = true;
  saveW();
  bus.emit('tree');
  T.ui.cursor = r.id;
  openNode(r);
  setTimeout(() => startRename(r), 30);
}
async function addFolderTo(container) {
  const f = newItem('folder');
  container.items.push(f);
  container.open = true;
  saveW();
  T.ui.cursor = f.id;
  renderSidebar();
  startRename(f);
}

export function startRename(n) {
  const row = $(`#tree .node[data-id="${CSS.escape(n.id)}"]`);
  if (!row) return;
  const nm = row.querySelector('.nm');
  renaming = n.id;
  const input = h(`<input value="${esc(n.name)}" style="flex:1;padding:1px 6px;height:22px" aria-label="Rename">`);
  nm.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = ok => {
    if (done) return; done = true; renaming = null;
    if (ok && input.value.trim() && input.value.trim() !== n.name) {
      n.name = input.value.trim();
      saveW();
      bus.emit('tree');
    } else renderSidebar();
    $('#tree').focus();
  };
  input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
  input.onblur = () => commit(true);
  input.onclick = e => e.stopPropagation();
}

function duplicate(n) {
  const f = find(n.id);
  const c = reId(n);
  c.name = n.name + ' Copy';
  f.list.splice(f.list.indexOf(n) + 1, 0, c);
  T.ui.cursor = c.id;
  saveW(); bus.emit('tree');
  toast('Duplicated');
}
function copy(n) { clipboard = clone(n); toast(`Copied "${n.name}"`); }
function paste(target) {
  if (!clipboard) return;
  const tf = find(target.id);
  if (!tf) return;
  const c = reId(clipboard);
  if (clipboard.kind === 'collection') { c.kind = 'collection'; W.collections.splice(W.collections.indexOf(tf.collection) + 1, 0, c); }
  else if (tf.example) return;
  else if (isContainer(target)) { target.items.push(isContainer(c) && c.kind === 'collection' ? { ...c, kind: 'folder' } : c); target.open = true; }
  else tf.list.splice(tf.list.indexOf(target) + 1, 0, c);
  T.ui.cursor = c.id;
  saveW(); bus.emit('tree');
  toast('Pasted');
}
async function remove(n) {
  const f = find(n.id);
  if (!f) return;
  const count = isContainer(n) ? flatRequests(n).length : 0;
  if (!(await confirmDlg(`Delete "${n.name}"${count ? ` and the ${count} request(s) inside it` : ''}? This cannot be undone.`))) return;
  f.list.splice(f.list.indexOf(n), 1);
  const idx = rows.findIndex(r => r.id === n.id);
  T.ui.cursor = rows[idx + 1]?.id || rows[idx - 1]?.id;
  saveW();
  bus.emit('tree');
}
async function exportCollection(c) {
  const p = await api.dialogSave({ name: `${c.name}.postmaster_collection.json`, text: JSON.stringify(toPostmanCollection(c), null, 2) });
  if (p) toast('Exported to ' + p);
}

function reveal(id) {
  const f = find(id);
  if (!f) return;
  for (const p of f.path) p.open = true;
  if (f.example) f.parent.open = true;
  T.ui.side = 'collections';
  T.ui.sideHidden = false;
  T.ui.cursor = id;
  applySideVisibility();
  renderSidebar();
  $(`#tree .node[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
}

// ---------- keyboard (Postman bindings) ----------
function moveCursor(d) {
  if (!rows.length) return;
  let i = rows.findIndex(r => r.id === T.ui.cursor);
  i = i < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + d));
  T.ui.cursor = rows[i].id;
  rows.forEach(r => r.el.classList.toggle('cursor', r.id === T.ui.cursor));
  rows.forEach(r => r.el.classList.toggle('sel', r.id === T.ui.cursor));
  rows[i].el.scrollIntoView({ block: 'nearest' });
}
function treeKeys(e) {
  if (renaming || e.target !== $('#tree')) return;
  const sec = T.ui.side;
  const cur = rows.find(r => r.id === T.ui.cursor);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (k === 'ArrowDown') { e.preventDefault(); moveCursor(1); return; }
  if (k === 'ArrowUp') { e.preventDefault(); moveCursor(-1); return; }
  if (k === 'Home') { e.preventDefault(); moveCursor(-1e9); return; }
  if (k === 'End') { e.preventDefault(); moveCursor(1e9); return; }
  if (!cur) return;
  if (sec !== 'collections') {
    if (k === 'Enter') { e.preventDefault(); cur.el.click(); }
    if (k === 'Delete') { e.preventDefault(); cur.el.querySelector('[data-del]')?.click(); }
    return;
  }
  const f = find(cur.id);
  if (!f) return;
  const n = f.node;
  const expandable = isContainer(n) || (n.examples?.length && !f.example);
  if (k === 'ArrowRight') {
    e.preventDefault();
    if (expandable && !n.open) { n.open = true; saveW(); renderSidebar(); }
    else if (expandable) moveCursor(1);
  } else if (k === 'ArrowLeft') {
    e.preventDefault();
    if (expandable && n.open) { n.open = false; saveW(); renderSidebar(); }
    else if (f.parent) { T.ui.cursor = f.parent.id; renderSidebar(); $(`#tree .node[data-id="${CSS.escape(f.parent.id)}"]`)?.scrollIntoView({ block: 'nearest' }); }
  } else if (k === 'Enter' || k === ' ') { e.preventDefault(); openNode(n); }
  else if (k === 'Delete' || (k === 'Backspace' && ctrl)) { e.preventDefault(); remove(n); }
  else if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); startRename(n); }
  else if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(n); }
  else if (ctrl && k.toLowerCase() === 'c' && !f.example) { e.preventDefault(); copy(n); }
  else if (ctrl && k.toLowerCase() === 'v') { e.preventDefault(); paste(n); }
  else if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) { e.preventDefault(); const r = cur.el.getBoundingClientRect(); itemMenu(n, { left: r.left + 40, bottom: r.bottom }); }
}

// ---------- section actions ----------
async function addInSection() {
  const s = T.ui.side;
  if (s === 'collections') {
    const c = newItem('collection');
    W.collections.push(c);
    T.ui.cursor = c.id;
    saveW();
    renderSidebar();
    startRename(c);
  }
  if (s === 'environments') {
    const e = { id: uid(), name: 'New Environment', vars: [] };
    W.environments.push(e);
    saveW();
    renderSidebar();
    openTab({ kind: 'env', ref: e.id, draft: e });
  }
  if (s === 'history') newRequestTab();
  if (s === 'mocks') createMock();
}
function sectionMenu(btn) {
  const s = T.ui.side;
  const items = {
    collections: [
      { label: 'New collection', icon: 'plus', run: addInSection },
      { label: 'Import…', icon: 'download', kb: 'Ctrl+O', run: () => bus.emit('import') },
      { label: 'Expand all', run: () => { W.collections.forEach(c => setOpen(c, true)); renderSidebar(); } },
      { label: 'Collapse all', run: () => { W.collections.forEach(c => setOpen(c, false)); renderSidebar(); } },
      { label: 'Sort collections A→Z', run: () => { W.collections.sort((a, b) => a.name.localeCompare(b.name)); saveW(); renderSidebar(); } },
    ],
    environments: [{ label: 'New environment', icon: 'plus', run: addInSection }, { label: 'Import…', icon: 'download', run: () => bus.emit('import') }],
    history: [{ label: 'Clear all history', icon: 'trash', danger: true, run: async () => { if (await confirmDlg('Clear all history?', 'Clear')) { W.history = []; saveW(); renderSidebar(); } } }],
    mocks: [{ label: 'New mock server', icon: 'plus', run: () => createMock() }],
  }[s];
  menuFor(btn, items);
}

// ---------- environments ----------
function renderEnvs(tree, f) {
  const activeRef = activeTab()?.kind === 'env' ? activeTab().ref : null;
  const g = nodeRow({ id: 'globals', depth: 0, cls: activeRef === 'globals' ? 'open-tab' : '', html: `${icon('globe')}<span class="nm">Globals</span><span class="dim" style="font-size:11px">${W.globals.filter(v => v.key).length}</span>` });
  g.onclick = () => { T.ui.cursor = 'globals'; openTab({ kind: 'env', ref: 'globals', draft: { id: 'globals', name: 'Globals', vars: clone(W.globals) } }); };
  tree.append(g, h(`<div style="height:1px;background:var(--line);margin:6px 8px"></div>`));
  for (const e of W.environments) {
    if (f && !e.name.toLowerCase().includes(f)) continue;
    const active = W.activeEnv === e.id;
    const row = nodeRow({ id: e.id, depth: 0, cls: activeRef === e.id ? 'open-tab' : '', html: `<span style="width:16px;color:var(--acc)" title="${active ? 'Active environment' : ''}">${active ? icon('check') : ''}</span><span class="nm">${esc(e.name)}</span><button class="ghost sm more" aria-label="More">${icon('more')}</button><span data-del hidden></span>` });
    row.onclick = ev => { if (ev.target.closest('.more')) return; T.ui.cursor = e.id; openTab({ kind: 'env', ref: e.id, draft: e }); };
    const del = async () => { if (await confirmDlg(`Delete environment "${e.name}"?`)) { W.environments.splice(W.environments.indexOf(e), 1); if (W.activeEnv === e.id) W.activeEnv = null; saveW(); bus.emit('env'); renderSidebar(); } };
    row.querySelector('[data-del]').onclick = del;
    const menu = rect => contextMenu(rect.left, rect.bottom, [
      { label: active ? 'Deactivate' : 'Set as active', icon: 'check', run: () => { W.activeEnv = active ? null : e.id; saveW(); bus.emit('env'); renderSidebar(); } },
      { label: 'Duplicate', icon: 'copy', run: () => { W.environments.push({ ...clone(e), id: uid(), name: e.name + ' Copy' }); saveW(); renderSidebar(); } },
      { label: 'Export', icon: 'upload', run: async () => { const p = await api.dialogSave({ name: `${e.name}.postmaster_environment.json`, text: JSON.stringify(toPostmanEnv(e), null, 2) }); if (p) toast('Exported to ' + p); } },
      '-', { label: 'Delete', icon: 'trash', danger: true, run: del },
    ]);
    row.querySelector('.more').onclick = ev => { ev.stopPropagation(); menu(ev.currentTarget.getBoundingClientRect()); };
    row.oncontextmenu = ev => { ev.preventDefault(); menu({ left: ev.clientX, bottom: ev.clientY }); };
    tree.append(row);
  }
  if (!W.environments.length) tree.append(h(`<div class="empty-side">Environments hold variables like <code>{{baseUrl}}</code> that change between dev, staging and production.<br><br>Click + to create one.</div>`));
  const exp = h(`<div style="padding:10px 8px"><button class="ghost sm">${icon('upload')} Export globals</button></div>`);
  exp.querySelector('button').onclick = async () => { const p = await api.dialogSave({ name: 'globals.postmaster_globals.json', text: JSON.stringify(toPostmanGlobals(), null, 2) }); if (p) toast('Exported to ' + p); };
  tree.append(exp);
}

// ---------- history ----------
function renderHistory(tree, f) {
  if (!W.history.length) return tree.append(h(`<div class="empty-side">${icon('history')}<div>Requests you send will appear here.</div></div>`));
  let day = '';
  for (const x of W.history) {
    if (f && !`${x.req.url} ${x.req.name}`.toLowerCase().includes(f)) continue;
    const d = new Date(x.at);
    const label = d.toDateString() === new Date().toDateString() ? 'Today' : d.toDateString() === new Date(Date.now() - 864e5).toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (label !== day) { day = label; tree.append(h(`<div class="dim" style="padding:10px 10px 2px;font-size:11px;text-transform:uppercase;letter-spacing:.6px">${label}</div>`)); }
    const st = String(x.status);
    const row = nodeRow({ id: x.id, depth: 0, title: `${d.toLocaleTimeString()} · ${st}${x.time != null ? ' · ' + x.time + ' ms' : ''}`, html: `<span class="m ${esc(x.req.method || 'GET')}">${esc(kindBadge(x.req))}</span><span class="nm mono" style="font-size:12px">${esc(x.req.url || x.req.name)}</span><span class="s${st[0]}" style="font-size:11px">${esc(st)}</span><span data-del hidden></span>` });
    const del = () => { W.history.splice(W.history.indexOf(x), 1); saveW(); renderSidebar(); };
    row.querySelector('[data-del]').onclick = del;
    row.onclick = () => { T.ui.cursor = x.id; openTab({ kind: 'request', draft: { ...clone(x.req), id: uid() } }); };
    row.oncontextmenu = e => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: 'Open in new tab', icon: 'window', run: () => row.click() },
        { label: 'Save to collection…', icon: 'collections', run: () => { openTab({ kind: 'request', draft: { ...clone(x.req), id: uid() } }); bus.emit('save-active'); } },
        '-', { label: 'Delete', icon: 'trash', kb: 'Del', danger: true, run: del },
      ]);
    };
    tree.append(row);
  }
}

// ---------- mock servers ----------
export function mockRoutes(colId) {
  const c = W.collections.find(x => x.id === colId);
  if (!c) return [];
  return flatRequests(c).filter(r => r.examples?.length && (!r.kind || r.kind === 'http' || r.kind === 'graphql')).map(r => {
    let p = (r.url || '').split('?')[0];
    p = p.replace(/^\{\{[^}]+\}\}/, '').replace(/^[a-z]+:\/\/[^/]+/i, '');
    return { method: r.method, path: p.startsWith('/') ? p : '/' + p, examples: r.examples.map(e => ({ name: e.name, status: e.status, headers: e.headers, body: e.body, query: e.request?.url?.split('?')[1] || '' })) };
  });
}
async function refreshMockState() { mocksRunning = new Set(await api.mockRunning()); }
export async function startMock(m) {
  const routes = mockRoutes(m.colId);
  if (!routes.length) toast('No saved examples in this collection yet — the mock will answer 404 until you save responses as examples.', 'error');
  const r = await api.mockStart({ ...m, routes });
  if (!r.ok) return toast(r.error, 'error');
  mocksRunning.add(m.id);
  toast(`Mock running at ${r.url}`);
  renderSidebar();
}
async function createMock(colId) {
  if (!W.collections.length) return toast('Create a collection with saved examples first', 'error');
  const v = await ask('New mock server', [['name', 'Name', 'Mock server'], ['colId', 'Collection to mock', colId || W.collections[0].id, W.collections.map(c => [c.id, c.name])], ['port', 'Port', String(3000 + Math.floor(Math.random() * 900))], ['delay', 'Response delay (ms)', '0']], 'Create');
  if (!v) return;
  const port = +v.port;
  if (!(port > 0 && port < 65536)) return toast('Invalid port', 'error');
  const m = { id: uid(), name: v.name || 'Mock server', colId: v.colId, port, delay: +v.delay || 0 };
  W.mocks.push(m);
  saveW();
  T.ui.side = 'mocks';
  renderSidebar();
  startMock(m);
  const col = W.collections.find(c => c.id === m.colId);
  if (col && !(col.vars ||= []).some(x => x.key === 'mockUrl')) { col.vars.push(kvRow('mockUrl', `http://localhost:${port}`)); saveW(); }
}
function renderMocks(tree, f) {
  refreshMockState().then(() => tree.querySelectorAll('[data-mock]').forEach(el => { const on = mocksRunning.has(el.dataset.mock); el.querySelector('.conn-dot').className = 'conn-dot ' + (on ? 'on' : ''); el.querySelector('[data-toggle]').innerHTML = icon(on ? 'stop' : 'play'); el.querySelector('[data-toggle]').title = on ? 'Stop' : 'Start'; }));
  if (!W.mocks.length) {
    const e = h(`<div class="empty-side">${icon('server')}<div>Mock servers answer with the <b>examples</b> saved on a collection's requests — great for front-end work before the API exists.</div><button class="primary" style="margin-top:12px">${icon('plus')} Create mock server</button></div>`);
    e.querySelector('button').onclick = () => createMock();
    return tree.append(e);
  }
  for (const m of W.mocks) {
    if (f && !m.name.toLowerCase().includes(f)) continue;
    const col = W.collections.find(c => c.id === m.colId);
    const on = mocksRunning.has(m.id);
    const row = nodeRow({ id: m.id, depth: 0, title: `${col?.name || 'missing collection'} · ${mockRoutes(m.colId).length} route(s)`, html: `<span class="conn-dot ${on ? 'on' : ''}"></span><span class="nm">${esc(m.name)}<br><span class="mono dim" style="font-size:11px">localhost:${m.port}</span></span><button class="ghost sm" data-toggle title="${on ? 'Stop' : 'Start'}">${icon(on ? 'stop' : 'play')}</button><button class="ghost sm more">${icon('more')}</button><span data-del hidden></span>` });
    row.style.height = '40px';
    row.dataset.mock = m.id;
    const del = async () => { if (await confirmDlg(`Delete mock server "${m.name}"?`)) { await api.mockStop(m.id); W.mocks.splice(W.mocks.indexOf(m), 1); saveW(); renderSidebar(); } };
    row.querySelector('[data-del]').onclick = del;
    row.querySelector('[data-toggle]').onclick = async e => { e.stopPropagation(); if (mocksRunning.has(m.id)) { await api.mockStop(m.id); mocksRunning.delete(m.id); renderSidebar(); } else startMock(m); };
    row.onclick = e => { if (!e.target.closest('button')) { navigator.clipboard.writeText(`http://localhost:${m.port}`); toast('Mock URL copied'); } };
    row.querySelector('.more').onclick = e => {
      e.stopPropagation();
      menuFor(e.currentTarget, [
        { label: 'Copy URL', icon: 'copy', run: () => { navigator.clipboard.writeText(`http://localhost:${m.port}`); toast('Copied'); } },
        { label: 'Show routes', icon: 'eye', run: () => modal({ title: `${m.name} — routes`, cls: 'wide', body: h(`<div><div class="dim" style="margin-bottom:8px">Choose a specific example with the <code>x-mock-response-name</code> or <code>x-mock-response-code</code> request header.</div><table class="grid"><thead><tr><th>Method</th><th>Path</th><th>Examples</th></tr></thead><tbody>${mockRoutes(m.colId).map(r => `<tr><td class="${esc(r.method)}">${esc(r.method)}</td><td class="mono">${esc(r.path)}</td><td>${r.examples.map(x => esc(`${x.status} ${x.name}`)).join('<br>')}</td></tr>`).join('') || '<tr><td colspan=3 class="dim">No examples saved in this collection</td></tr>'}</tbody></table></div>`) }) },
        { label: 'Restart (reload examples)', icon: 'refresh', run: async () => { await api.mockStop(m.id); startMock(m); } },
        '-', { label: 'Delete', icon: 'trash', danger: true, run: del },
      ]);
    };
    tree.append(row);
  }
}
