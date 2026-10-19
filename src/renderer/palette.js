// Ctrl+K search / command palette and Ctrl+Shift+A tab search.
import { W, T, walk, isContainer, kindBadge, pathLabel } from './state.js';
import { h, esc, icon, fuzzy, modal } from './ui.js';
import { openNode, openTab, activate, tabTitle } from './tabs.js';

export function openPalette({ commands = [], tabsOnly = false } = {}) {
  const items = [];
  if (tabsOnly) T.tabs.forEach((t, i) => items.push({ group: 'Open tabs', label: tabTitle(t), meta: t.ref ? pathLabel(t.ref) : 'Unsaved', icon: 'window', run: () => activate(i) }));
  else {
    for (const c of commands) items.push({ group: 'Commands', ...c });
    walk((n, trail) => items.push({ group: isContainer(n) ? 'Collections & folders' : 'Requests', label: n.name, meta: [...trail.map(t => t.name)].join(' / ') || (n.kind === 'collection' ? 'Collection' : ''), badge: isContainer(n) ? null : kindBadge(n), method: n.method, icon: isContainer(n) ? (n.kind === 'collection' ? 'collections' : 'folder') : null, extra: n.url || '', run: () => openNode(n) }));
    for (const e of W.environments) items.push({ group: 'Environments', label: e.name, meta: W.activeEnv === e.id ? 'Active' : '', icon: 'env', run: () => openTab({ kind: 'env', ref: e.id, draft: e }) });
    for (const x of W.history.slice(0, 60)) items.push({ group: 'History', label: x.req.url || x.req.name, meta: new Date(x.at).toLocaleString(), badge: kindBadge(x.req), method: x.req.method, run: () => openTab({ kind: 'request', draft: { ...JSON.parse(JSON.stringify(x.req)), id: Math.random().toString(36).slice(2) } }) });
  }
  const box = h(`<div><input class="q" placeholder="${tabsOnly ? 'Search open tabs' : 'Search requests, collections, environments, commands…'}" aria-label="Search"><div class="results" role="listbox"></div></div>`);
  const input = box.querySelector('input'), results = box.querySelector('.results');
  let shown = [], idx = 0;
  const draw = () => {
    const q = input.value.trim();
    shown = items.map(it => ({ it, s: q ? Math.max(fuzzy(q, it.label) * 2, fuzzy(q, it.extra || '') , fuzzy(q, it.meta || '') * .5) : 1 })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 80).map(x => x.it);
    if (!q) shown.sort((a, b) => order(a.group) - order(b.group));
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    results.replaceChildren();
    let g = '';
    shown.forEach((it, i) => {
      if (it.group !== g) { g = it.group; results.append(h(`<div class="pal-group">${esc(g)}</div>`)); }
      const el = h(`<div class="pal-item ${i === idx ? 'on' : ''}" role="option">${it.badge ? `<span class="m ${esc(it.method || '')}">${esc(it.badge)}</span>` : icon(it.icon || 'bolt')}<span>${esc(it.label)}</span>${it.kb ? `<kbd style="margin-left:8px">${esc(it.kb)}</kbd>` : ''}<span class="meta">${esc(it.meta || it.extra || '')}</span></div>`);
      el.onmousemove = () => { if (idx !== i) { idx = i; paint(); } };
      el.onclick = () => choose(i);
      results.append(el);
    });
    if (!shown.length) results.append(h(`<div class="empty">No matches</div>`));
  };
  const paint = () => results.querySelectorAll('.pal-item').forEach((el, i) => { el.classList.toggle('on', i === idx); if (i === idx) el.scrollIntoView({ block: 'nearest' }); });
  const order = g => ['Open tabs', 'Commands', 'Requests', 'Collections & folders', 'Environments', 'History'].indexOf(g);
  let dlg;
  const choose = i => { const it = shown[i]; if (!it) return; dlg.close(null); it.run(); };
  input.oninput = () => { idx = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); paint(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); paint(); }
    if (e.key === 'Enter') { e.preventDefault(); choose(idx); }
  };
  draw();
  modal({ title: '', body: box, buttons: [], cls: 'palette', onMount: m => { dlg = m; input.focus(); } });
}
