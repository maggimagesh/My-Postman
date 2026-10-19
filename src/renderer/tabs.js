// Tabs: open/close/reorder/save. A tab holds a working copy (draft) of a saved item, or an unsaved one.
import { W, T, RT, find, newItem, isRequest, isContainer, kindBadge, saveW, saveT, walk } from './state.js';
import { $, h, esc, icon, uid, clone, modal, contextMenu, bus, toast, ask } from './ui.js';

export const activeTab = () => T.tabs[T.active] || null;
export const rt = tab => { if (!RT.has(tab.id)) RT.set(tab.id, {}); return RT.get(tab.id); };

export function tabTitle(t) {
  if (t.kind === 'env') return t.ref === 'globals' ? 'Globals' : t.draft?.name || 'Environment';
  if (t.kind === 'runner') return 'Runner' + (t.draft?.targetName ? ': ' + t.draft.targetName : '');
  return t.draft?.name || 'Untitled';
}

function focusIndex(i) { T.active = i; saveT(); bus.emit('tab'); }

export function openTab({ kind = 'request', ref = null, draft, preview = false }) {
  if (ref) {
    const i = T.tabs.findIndex(t => t.ref === ref && t.kind === kind);
    if (i >= 0) return focusIndex(i);
  }
  const t = { id: uid(), kind, ref, draft: clone(draft), dirty: false };
  T.tabs.splice(T.tabs.length ? T.active + 1 : 0, 0, t);
  focusIndex(T.tabs.length === 1 ? 0 : T.active + 1);
  return t;
}
export const openNode = n => {
  const f = find(n.id);
  if (!f) return;
  if (f.example) return openTab({ kind: 'example', ref: n.id, draft: n });
  if (isContainer(n)) { const { items, ...rest } = n; return openTab({ kind: 'container', ref: n.id, draft: rest }); }
  return openTab({ kind: 'request', ref: n.id, draft: n });
};
export const newRequestTab = (kind = 'http') => openTab({ kind: 'request', draft: newItem(kind) });

export function markDirty(t = activeTab()) {
  if (!t) return;
  const was = t.dirty;
  t.dirty = true;
  saveT();
  if (!was) renderTabs();
}

export async function closeTab(i = T.active, force = false) {
  const t = T.tabs[i];
  if (!t) return;
  if (t.dirty && !force && W.settings.confirmClose !== false && t.kind !== 'runner') {
    const choice = await modal({
      title: 'Do you want to save changes?', body: h(`<div>"${esc(tabTitle(t))}" has unsaved changes. They will be lost if you don't save them.</div>`),
      buttons: [["Don't save", 'discard', 'danger'], ['Cancel', null], ['Save changes', 'save', 'primary']],
    });
    if (!choice) return;
    if (choice === 'save' && !(await saveTab(t))) return;
  }
  const r = RT.get(t.id);
  if (r?.connected || r?.connecting) r.disconnect?.();
  RT.delete(t.id);
  T.closed.push({ kind: t.kind, ref: t.ref, draft: t.draft });
  T.tabs.splice(i, 1);
  if (T.active >= T.tabs.length) T.active = T.tabs.length - 1;
  else if (i < T.active) T.active--;
  if (T.active < 0) T.active = 0;
  saveT();
  bus.emit('tab');
}
export async function closeMany(indices) { for (const i of indices.sort((a, b) => b - a)) await closeTab(i); }
export function reopenClosed() {
  const c = T.closed.pop();
  if (!c) return toast('No recently closed tabs');
  if (c.ref && !find(c.ref) && c.kind !== 'env' && c.kind !== 'runner') c.ref = null;
  openTab(c);
}
export const nextTab = d => { if (T.tabs.length) focusIndex((T.active + d + T.tabs.length) % T.tabs.length); };
export const gotoTab = n => { if (n === 9) focusIndex(T.tabs.length - 1); else if (T.tabs[n - 1]) focusIndex(n - 1); };
export const activate = i => focusIndex(i);

// ---------- saving ----------
export async function pickDestination(defaultName, title = 'Save request') {
  const folders = [];
  walk((n, trail) => { if (isContainer(n)) folders.push([n.id, [...trail.map(t => t.name), n.name].join(' / ')]); });
  const NEW = '__new__';
  const v = await ask(title, [['name', 'Name', defaultName], ['dest', 'Save to', folders[0]?.[0] || NEW, [...folders, [NEW, '+ New collection…']]]], 'Save');
  if (!v) return null;
  let dest = v.dest;
  if (dest === NEW) {
    const c = await ask('New collection', [['name', 'Collection name', 'My Collection']], 'Create');
    if (!c?.name) return null;
    const col = { ...newItem('collection'), name: c.name };
    W.collections.push(col);
    dest = col.id;
  }
  return { name: v.name || defaultName, container: find(dest).node };
}

export async function saveTab(t = activeTab(), saveAs = false) {
  if (!t) return false;
  if (t.kind === 'runner') return false;
  if (t.kind === 'env') {
    const target = t.ref === 'globals' ? null : W.environments.find(e => e.id === t.ref);
    if (t.ref === 'globals') W.globals = clone(t.draft.vars);
    else if (target) Object.assign(target, clone(t.draft));
    else { W.environments.push(clone(t.draft)); t.ref = t.draft.id; }
  } else if (t.kind === 'container' || t.kind === 'example') {
    const f = find(t.ref);
    if (!f) { toast('The original item was deleted', 'error'); return false; }
    Object.assign(f.node, clone(t.draft), { id: f.node.id, ...(f.node.items ? { items: f.node.items } : {}) });
  } else {
    const f = !saveAs && t.ref && find(t.ref);
    if (f) Object.assign(f.node, clone(t.draft), { id: f.node.id });
    else {
      const d = await pickDestination(saveAs ? t.draft.name + ' copy' : t.draft.name, saveAs ? 'Save request as' : 'Save request');
      if (!d) return false;
      const node = { ...clone(t.draft), id: uid(), name: d.name };
      d.container.items.push(node);
      d.container.open = true;
      for (let p = find(d.container.id)?.path || []; p.length; p = p.slice(0, -1)) p[p.length - 1].open = true;
      if (saveAs) { openTab({ kind: 'request', ref: node.id, draft: node }); saveW(); bus.emit('tree'); toast('Saved as ' + d.name); return true; }
      t.ref = node.id;
      t.draft = clone(node);
    }
  }
  t.dirty = false;
  saveW(); saveT();
  bus.emit('tree'); bus.emit('saved', t); renderTabs();
  toast('Saved');
  return true;
}

// Called after the tree changes elsewhere (rename/delete/sync) to keep tabs consistent.
export function syncTabsWithTree() {
  for (const t of T.tabs) {
    if (!t.ref || t.kind === 'env' || t.kind === 'runner') continue;
    const f = find(t.ref);
    if (!f) { t.ref = null; t.dirty = true; continue; }
    if (!t.dirty) { const { items, ...rest } = f.node; t.draft = clone(rest); }
    else t.draft.name = f.node.name;
  }
  renderTabs();
}

// ---------- tab strip ----------
let dragFrom = -1;
export function renderTabs() {
  const el = $('#tabs');
  el.replaceChildren();
  T.tabs.forEach((t, i) => {
    const d = t.draft || {};
    const badge = t.kind === 'request' ? `<span class="mdot ${d.kind === 'http' || !d.kind ? esc(d.method) : 'k-' + d.kind}" title="${esc(kindBadge(d))}"></span>`
      : t.kind === 'container' ? icon(d.kind === 'collection' ? 'collections' : 'folder') : t.kind === 'env' ? icon('env') : t.kind === 'runner' ? icon('play') : icon('file');
    const tab = h(`<div class="tab ${i === T.active ? 'on' : ''}" role="tab" aria-selected="${i === T.active}" draggable="true" title="${esc((t.kind === 'request' ? kindBadge(d) + ' ' : '') + tabTitle(t))}">${badge}<span class="t">${esc(tabTitle(t))}</span>${t.dirty ? '<span class="dot" title="Unsaved changes"></span>' : ''}<button class="ghost x" aria-label="Close tab" title="Put away">${icon('x')}</button></div>`);
    tab.onclick = () => activate(i);
    tab.onauxclick = e => { if (e.button === 1) { e.preventDefault(); closeTab(i); } };
    tab.querySelector('.x').onclick = e => { e.stopPropagation(); closeTab(i); };
    tab.ondragstart = e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; };
    tab.ondragover = e => { if (dragFrom < 0) return; e.preventDefault(); tab.classList.add('drop-before'); };
    tab.ondragleave = () => tab.classList.remove('drop-before');
    tab.ondrop = e => {
      e.preventDefault();
      if (dragFrom < 0 || dragFrom === i) return;
      const cur = T.tabs[T.active];
      const [m] = T.tabs.splice(dragFrom, 1);
      T.tabs.splice(dragFrom < i ? i - 1 : i, 0, m);
      T.active = T.tabs.indexOf(cur);
      dragFrom = -1;
      saveT(); renderTabs();
    };
    tab.ondragend = () => { dragFrom = -1; };
    tab.oncontextmenu = e => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: 'New tab', icon: 'plus', kb: 'Ctrl+T', run: () => newRequestTab() },
        { label: 'Duplicate tab', icon: 'copy', run: () => openTab({ kind: t.kind, draft: { ...clone(t.draft), id: uid(), name: tabTitle(t) + ' copy' } }) },
        t.ref && t.kind !== 'env' && t.kind !== 'runner' && { label: 'Reveal in sidebar', icon: 'sidebar', run: () => bus.emit('reveal', t.ref) },
        '-',
        { label: 'Close', icon: 'x', kb: 'Ctrl+W', run: () => closeTab(i) },
        { label: 'Force close', kb: 'Ctrl+Alt+W', run: () => closeTab(i, true) },
        { label: 'Close other tabs', run: () => closeMany(T.tabs.map((_, j) => j).filter(j => j !== i)) },
        { label: 'Close tabs to the right', run: () => closeMany(T.tabs.map((_, j) => j).filter(j => j > i)) },
        { label: 'Close all tabs', run: () => closeMany(T.tabs.map((_, j) => j)) },
      ]);
    };
    el.append(tab);
  });
  const add = h(`<div class="tab tab-add" title="New tab (Ctrl+T)" role="button" aria-label="New tab">${icon('plus')}</div>`);
  add.onclick = () => newRequestTab();
  el.append(add);
  el.ondblclick = e => { if (e.target === el) newRequestTab(); };
  el.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
