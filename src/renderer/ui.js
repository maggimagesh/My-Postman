// Small DOM toolkit shared by every view.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const fmtSize = n => n == null ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(2) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
export const fmtTime = ms => ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(2) + ' s';
export const kvRow = (key = '', value = '', extra = {}) => ({ on: true, key, value, ...extra });

// ---------- event bus ----------
const listeners = {};
export const bus = {
  on: (ev, fn) => (listeners[ev] ||= []).push(fn),
  emit: (ev, ...a) => (listeners[ev] || []).forEach(fn => fn(...a)),
};

// ---------- icons (24px stroke) ----------
const P = {
  plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4', x: 'M6 6l12 12M18 6L6 18',
  collections: 'M4 6h16M4 12h16M4 18h10', env: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2', server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  play: 'M7 4l13 8-13 8z', stop: 'M6 6h12v12H6z', more: 'M5 12h.01M12 12h.01M19 12h.01', chevR: 'M9 6l6 6-6 6', chevD: 'M6 9l6 6 6-6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3', copy: 'M9 9h11v11H9zM5 15H4V4h11v1', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  download: 'M12 4v12M6 11l6 6 6-6M4 20h16', upload: 'M12 20V8M6 13l6-6 6 6M4 4h16', cookie: 'M12 3a9 9 0 1 0 9 9 4 4 0 0 1-5-5 4 4 0 0 1-4-4zM8.5 10.5h.01M15 15h.01M10 16h.01',
  terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3', layout: 'M4 4h16v16H4zM12 4v16', layoutH: 'M4 4h16v16H4zM4 12h16', keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', lock: 'M6 11h12v9H6zM8 11V7a4 4 0 0 1 8 0v4', unlock: 'M6 11h12v9H6zM8 11V7a4 4 0 0 1 7.5-2',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4', check: 'M5 12l5 5L20 7', send: 'M4 12l16-8-6 16-2-6z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18', sidebar: 'M4 4h16v16H4zM9 4v16',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', window: 'M3 5h18v14H3zM3 9h18',
  wand: 'M15 4V2M15 10V8M11 6h2M17 6h2M4 20L14 10', filter: 'M4 5h16l-6 8v6l-4-2v-4z', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
};
export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n] || P.more}"/></svg>`;

// ---------- toasts ----------
export function toast(msg, kind = '') {
  const t = h(`<div class="toast ${kind}" role="status">${esc(msg)}</div>`);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 2600);
}

// ---------- modals ----------
const modalStack = [];
export const modalOpen = () => modalStack.length > 0;
export function modal({ title, body, buttons = [['Close', null, 'primary']], cls = '', onMount }) {
  return new Promise(res => {
    const m = h(`<div class="modal"><div class="dlg ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">${title ? `<div class="dlg-head">${esc(title)}<span class="sp"></span><button class="ghost" data-x aria-label="Close">${icon('x')}</button></div>` : ''}<div class="dlg-body"></div>${buttons.length ? '<div class="dlg-foot"></div>' : ''}</div></div>`);
    const prevFocus = document.activeElement;
    const close = v => { m.remove(); modalStack.splice(modalStack.indexOf(m), 1); prevFocus?.focus?.(); res(v); };
    m.close = close;
    $('.dlg-body', m).append(...[].concat(body));
    $('[data-x]', m)?.addEventListener('click', () => close(null));
    for (const [label, val, kind] of buttons) {
      const b = h(`<button class="${kind || ''}">${label}</button>`);
      b.onclick = async () => { const v = typeof val === 'function' ? await val(m) : val; if (v !== false) close(v); };
      $('.dlg-foot', m).append(b);
    }
    m.addEventListener('mousedown', e => { if (e.target === m) close(null); });
    m.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' || (e.ctrlKey && e.target.tagName === 'TEXTAREA'))) { e.preventDefault(); $('.dlg-foot button.primary', m)?.click(); }
    });
    document.body.append(m);
    modalStack.push(m);
    onMount?.(m);
    ($('[autofocus]', m) || $('input:not([type=checkbox]),textarea,select', $('.dlg-body', m)) || $('.dlg-foot button.primary', m))?.focus();
  });
}

// fields: [key, label, default, options?] — options => select; key starting with 'text' => textarea
export function ask(title, fields, okLabel = 'OK') {
  const c = h(`<div class="col-flex"></div>`);
  for (const [k, label, def = '', opts] of fields) {
    c.append(h(opts ? `<label class="f">${esc(label)}<select data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === def ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
      : k.startsWith('text') ? `<label class="f">${esc(label)}<textarea data-k="${k}" rows="7" class="mono">${esc(def)}</textarea></label>`
        : `<label class="f">${esc(label)}<input data-k="${k}" value="${esc(def)}"></label>`));
  }
  setTimeout(() => { const i = $('input', c); i?.select(); }, 0);
  return modal({ title, body: c, buttons: [['Cancel', null], [okLabel, () => Object.fromEntries($$('[data-k]', c).map(i => [i.dataset.k, i.value.trim()])), 'primary']] });
}
export const confirmDlg = (msg, ok = 'Delete', danger = true) =>
  modal({ title: 'Are you sure?', body: h(`<div>${esc(msg)}</div>`), buttons: [['Cancel', false], [ok, true, danger ? 'primary danger' : 'primary']] }).then(Boolean);

// ---------- context menu ----------
let openMenu = null;
export function contextMenu(x, y, items) {
  openMenu?.remove();
  const m = h(`<div class="menu" role="menu"></div>`);
  const actionable = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h(`<div class="menu-sep"></div>`)); continue; }
    const el = h(`<div class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem">${it.icon ? icon(it.icon) : '<span style="width:16px"></span>'}<span>${esc(it.label)}</span>${it.kb ? `<span class="kb">${esc(it.kb)}</span>` : ''}</div>`);
    el.onclick = () => { close(); it.run(); };
    actionable.push(el);
    m.append(el);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  let idx = -1;
  const close = () => { m.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', keys, true); openMenu = null; };
  const outside = e => { if (!m.contains(e.target)) close(); };
  const keys = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + actionable.length) % actionable.length; actionable.forEach((a, i) => a.classList.toggle('on', i === idx)); }
    if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); e.stopPropagation(); actionable[idx].click(); }
  };
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', keys, true); });
  openMenu = m;
  m.close = close;
  return m;
}
export const menuFor = (btn, items) => { const r = btn.getBoundingClientRect(); return contextMenu(r.left, r.bottom + 4, items); };

// Auto-height for multi-line value cells (JSON pasted into form-data, long tokens…).
// Value cells are one line until clicked; while focused they expand to the whole value (like Postman).
const grow = el => {
  if (!el.isConnected || !el.offsetWidth) return;
  if (document.activeElement !== el) { el.style.height = ''; el.scrollTop = 0; return; }
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
};
// Column widths (% of table) shared by every key/value table and remembered, like Postman's resizable columns.
const COLS_KEY = 'mp.kvcols';
const colWidths = (() => { try { return { key: 25, desc: 22, ...JSON.parse(localStorage.getItem(COLS_KEY) || '{}') }; } catch { return { key: 25, desc: 22 }; } })();
function colResizer(th, which, table) {
  const handle = h(`<span class="col-rs" title="Drag to resize"></span>`);
  th.append(handle);
  handle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, start = colWidths[which], total = table.offsetWidth;
    const mv = ev => {
      colWidths[which] = Math.max(10, Math.min(60, start + ((ev.clientX - startX) / total) * 100 * (which === 'desc' ? -1 : 1)));
      document.querySelectorAll('table.kv').forEach(t => t.style.setProperty(`--kv-${which}`, colWidths[which] + '%'));
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); try { localStorage.setItem(COLS_KEY, JSON.stringify(colWidths)); } catch {} document.querySelectorAll('table.kv textarea.grow').forEach(grow); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
}

// ---------- key/value table (with bulk edit) ----------
// rows: [{on,key,value,...}] mutated in place. opts: {placeholder, files, secret, desc, readOnly, onChange}
export function kvTable(rows, onChange, opts = {}) {
  const ph = opts.placeholder || ['Key', 'Value'];
  const wrap = h(`<div class="col-flex kvwrap" style="gap:6px"></div>`);
  let bulk = false;
  const head = h(`<div class="kv-head">${opts.title ? `<b style="color:var(--fg2)">${esc(opts.title)}</b>` : ''}<span class="sp"></span>${opts.readOnly || opts.fixedKeys ? '' : '<button class="ghost sm" data-bulk>Bulk edit</button>'}</div>`);
  const holder = h(`<div></div>`);
  wrap.append(head, holder);
  const bulkBtn = $('[data-bulk]', head);
  if (bulkBtn) bulkBtn.onclick = () => { bulk = !bulk; bulkBtn.textContent = bulk ? 'Key-value edit' : 'Bulk edit'; draw(); };

  const drawBulk = () => {
    const ta = h(`<textarea class="mono" rows="10" spellcheck="false" placeholder="key:value — one per line, prefix with // to disable"></textarea>`);
    ta.value = rows.filter(r => r.key || r.value).map(r => `${r.on ? '' : '//'}${r.key}:${r.value}`).join('\n');
    ta.oninput = () => {
      const next = ta.value.split('\n').filter(l => l.trim()).map(l => {
        const off = l.trimStart().startsWith('//');
        const s = off ? l.trimStart().slice(2) : l;
        const i = s.indexOf(':');
        return kvRow(i < 0 ? s.trim() : s.slice(0, i).trim(), i < 0 ? '' : s.slice(i + 1).trim(), { on: !off });
      });
      rows.splice(0, rows.length, ...next);
      onChange();
    };
    holder.replaceChildren(ta);
  };

  const draw = () => {
    if (bulk) return drawBulk();
    const tbl = h(`<table class="kv"><thead><tr><th class="c"></th><th class="kcol">${ph[0]}</th><th class="vcol">${ph[1]}</th>${opts.files ? '<th class="tcol">Type</th>' : ''}${opts.desc ? '<th class="dcol">Description</th>' : ''}${opts.secret ? '<th class="c" title="Secret"></th>' : ''}<th class="c"></th></tr></thead><tbody></tbody></table>`);
    tbl.style.setProperty('--kv-key', colWidths.key + '%');
    tbl.style.setProperty('--kv-desc', colWidths.desc + '%');
    colResizer($('th.kcol', tbl), 'key', tbl);
    if (opts.desc) colResizer($('th.vcol', tbl), 'desc', tbl);
    const tb = $('tbody', tbl);
    const list = opts.readOnly || opts.fixedKeys ? rows : [...rows, null];
    list.forEach((r, i) => {
      const row = r || { on: true, key: '', value: '' };
      const isFile = opts.files && row.type === 'file';
      const masked = opts.secret && row.secret;
      const valText = isFile ? [].concat(row.value || []).map(p => p.split('/').pop()).join(', ') : row.value;
      const tr = h(`<tr class="${r ? (row.on ? '' : 'off') : 'ghost'}">
        <td class="c">${r ? `<input type="checkbox" ${row.on ? 'checked' : ''} aria-label="Enabled">` : ''}</td>
        <td><input class="k var-input" value="${esc(row.key)}" placeholder="${esc(ph[0])}" spellcheck="false" ${opts.readOnly || opts.fixedKeys ? 'readonly' : ''}></td>
        <td>${masked || isFile ? `<input class="v var-input" type="${masked ? 'password' : 'text'}" value="${esc(valText)}" placeholder="${isFile ? 'Select files…' : esc(ph[1])}" spellcheck="false" ${isFile || opts.readOnly ? 'readonly' : ''} ${isFile ? 'style="cursor:pointer"' : ''}>`
          : `<textarea class="v var-input grow" rows="1" placeholder="${esc(ph[1])}" spellcheck="false" ${opts.readOnly ? 'readonly' : ''}>${esc(valText)}</textarea>`}</td>
        ${opts.files ? `<td><select class="ty"><option value="text">Text</option><option value="file" ${isFile ? 'selected' : ''}>File</option></select></td>` : ''}
        ${opts.desc ? `<td class="dcol"><input class="d" value="${esc(row.desc || '')}" placeholder="Description"></td>` : ''}
        ${opts.secret ? `<td class="c">${r ? `<button class="ghost sm sec" title="${masked ? 'Secret (click to reveal type)' : 'Mark as secret'}">${icon(masked ? 'lock' : 'unlock')}</button>` : ''}</td>` : ''}
        <td class="c">${r && !opts.readOnly && !opts.fixedKeys ? `<button class="ghost sm rm" title="Remove" aria-label="Remove row">${icon('x')}</button>` : ''}</td></tr>`);
      const promote = (sel) => {
        if (r) return;
        rows.push(row); draw();
        const el = $$('tbody tr', holder)[i]?.querySelector(sel);
        if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
      };
      $('[type=checkbox]', tr)?.addEventListener('change', e => { row.on = e.target.checked; tr.className = row.on ? '' : 'off'; onChange(); });
      $('.k', tr).oninput = e => { row.key = e.target.value; promote('.k'); onChange(); };
      // Like Postman: pasting several "key: value" / "key=value" lines into a key cell creates one row per line.
      if (!opts.readOnly && !opts.fixedKeys) $('.k', tr).addEventListener('paste', e => {
        const text = e.clipboardData.getData('text/plain');
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2 || !lines.every(l => /[:=]/.test(l))) return;
        e.preventDefault();
        const parsed = lines.map(l => { const off = l.trimStart().startsWith('//'); const s = off ? l.trimStart().slice(2) : l; const m = /^([^:=]*)[:=](.*)$/.exec(s); return kvRow(m[1].trim(), m[2].trim(), { on: !off }); });
        if (r && !row.key && !row.value) rows.splice(i, 1, ...parsed); else if (r) rows.splice(i + 1, 0, ...parsed); else rows.push(...parsed);
        draw(); onChange();
      });
      const v = $('.v', tr);
      if (!isFile) v.oninput = e => { row.value = e.target.value; grow(e.target); promote('.v'); onChange(); };
      if (v.tagName === 'TEXTAREA') { v.addEventListener('focus', () => grow(v)); v.addEventListener('blur', () => grow(v)); }
      else v.onclick = async () => { const f = await api.dialogOpen({ multi: true }); if (f) { row.value = f.length === 1 ? f[0].path : f.map(x => x.path); if (!r) rows.push(row); draw(); onChange(); } };
      for (const f of $$('.var-input', tr)) if (f.classList.contains('k') || !(isFile || masked)) cellVarOverlay(f);
      $('.ty', tr)?.addEventListener('change', e => { row.type = e.target.value; row.value = ''; if (!r) rows.push(row); draw(); onChange(); });
      $('.d', tr)?.addEventListener('input', e => { row.desc = e.target.value; promote('.d'); onChange(); });
      $('.sec', tr)?.addEventListener('click', () => { row.secret = !row.secret; draw(); onChange(); });
      $('.rm', tr)?.addEventListener('click', () => { rows.splice(i, 1); draw(); onChange(); });
      tb.append(tr);
    });
    holder.replaceChildren(tbl);
    // Re-measure multi-line cells whenever the table's width changes (pane resize, window resize, first layout).
    tbl.querySelectorAll('textarea.grow').forEach(grow); // now (if attached), so sizing never waits on a paint
    let lastW = 0;
    new ResizeObserver(() => { if (tbl.offsetWidth !== lastW) { lastW = tbl.offsetWidth; tbl.querySelectorAll('textarea.grow').forEach(grow); } }).observe(tbl);
  };
  draw();
  wrap.redraw = draw;
  return wrap;
}

// ---------- tiny markdown (docs, AI answers) ----------
export function md(src) {
  const blocks = [];
  let s = esc(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => { blocks.push([lang, code]); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/^\s*\d+\. (.*)$/gm, '<li>$1</li>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .split(/\n{2,}/).map(p => /^\s*<(h\d|ul|ol|li)|\u0000/.test(p) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre data-lang="${blocks[i][0]}">${blocks[i][1]}</pre>`);
}

// ---------- fuzzy match (palette) ----------
export function fuzzy(q, s) {
  if (!q) return 1;
  s = s.toLowerCase(); q = q.toLowerCase();
  const idx = s.indexOf(q);
  if (idx >= 0) return 100 - idx;
  let j = 0, score = 0;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) { j++; score++; }
  return j === q.length ? score : 0;
}

// ---------- drag-to-resize helper ----------
export function dragResize(handle, { axis = 'x', onMove, onEnd }) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    handle.classList.add('drag');
    const start = axis === 'x' ? e.clientX : e.clientY;
    const mv = ev => onMove((axis === 'x' ? ev.clientX : ev.clientY) - start, ev);
    const up = () => { handle.classList.remove('drag'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); onEnd?.(); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
}

// ---------- {{variable}} highlighting (Postman-style) ----------
let varKnown = () => true;
export const setVarKnown = fn => { varKnown = fn; };
const paintVars = text => esc(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => `<span class="${varKnown(k) ? 'mp-var-ok' : 'mp-var-bad'}">${m}</span>`);

// Key-value cells: a colored copy of the text sits under the field, which turns its own text transparent
// only while it holds a {{var}}. Multi-line value cells show plain text while focused (they expand to edit).
function cellVarOverlay(f) {
  const ov = h(`<div class="kv-ov" aria-hidden="true"></div>`);
  f.after(ov);
  f.parentElement.classList.add('ov-cell');
  const sync = () => { ov.scrollLeft = f.scrollLeft; };
  const paint = () => {
    const has = /\{\{[^{}]+\}\}/.test(f.value);
    f.classList.toggle('has-var', has);
    if (!has) return;
    const cs = getComputedStyle(f);
    ov.style.padding = f.tagName === 'TEXTAREA' ? `${cs.paddingTop} ${cs.paddingRight} 0 ${cs.paddingLeft}` : `0 ${cs.paddingRight} 0 ${cs.paddingLeft}`;
    ov.style.lineHeight = f.tagName === 'TEXTAREA' ? cs.lineHeight : cs.height;
    ov.innerHTML = paintVars(f.value);
    sync();
  };
  f.addEventListener('input', paint);
  for (const ev of ['scroll', 'keyup', 'click', 'blur']) f.addEventListener(ev, sync);
  requestAnimationFrame(paint); // the row isn't in the DOM yet, so its padding can't be measured now
}

// Single-line inputs (URL bars).
// Draws a colored copy of the text behind a transparent-text input. isKnown(name) → resolved?
export function varOverlay(input, isKnown) {
  const wrap = h(`<span class="var-ov-wrap"></span>`);
  const ov = h(`<div class="var-ov" aria-hidden="true"></div>`);
  input.replaceWith(wrap);
  wrap.append(ov, input);
  input.classList.add('var-ov-input');
  const paint = () => {
    ov.innerHTML = esc(input.value).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => `<span class="${isKnown(k) ? 'mp-var-ok' : 'mp-var-bad'}">${m}</span>`) + ' ';
    ov.scrollLeft = input.scrollLeft;
  };
  const sync = () => { ov.scrollLeft = input.scrollLeft; };
  input.addEventListener('input', paint);
  for (const ev of ['scroll', 'keyup', 'click', 'select', 'focus', 'blur']) input.addEventListener(ev, sync);
  paint();
  wrap.repaint = paint;
  return wrap;
}
