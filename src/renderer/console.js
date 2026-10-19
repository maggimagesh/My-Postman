// Console drawer: every request, script log, realtime error and mock hit.
import { T, saveT } from './state.js';
import { $, h, esc, icon, bus, dragResize } from './ui.js';

const MAX = 2000;
const entries = [];
let filter = { type: 'all', text: '' };
let unseen = 0;

export function initConsole() {
  bus.on('log', e => {
    entries.push(e);
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
    if (T.ui.consoleOpen) appendRow(e); else { unseen++; bus.emit('console-count', unseen, e.type === 'error'); }
  });
  api.on('mock-log', m => bus.emit('log', { ts: Date.now(), type: 'mock', text: `[mock ${m.mock} :${m.port}] ${m.method} ${m.url} → ${m.status}${m.example ? ` (${m.example})` : ''}` }));
  render();
}

export function toggleConsole(force) {
  T.ui.consoleOpen = force ?? !T.ui.consoleOpen;
  unseen = 0;
  bus.emit('console-count', 0);
  saveT();
  render();
}

const visible = e => (filter.type === 'all' || (filter.type === 'requests' ? ['http', 'mock'].includes(e.type) : filter.type === 'errors' ? ['error', 'warn'].includes(e.type) : ['log', 'info', 'debug'].includes(e.type))) && (!filter.text || e.text.toLowerCase().includes(filter.text.toLowerCase()));

function render() {
  const el = $('#console');
  el.classList.toggle('open', !!T.ui.consoleOpen);
  el.style.setProperty('--console-h', (T.ui.consoleH || 240) + 'px');
  if (!T.ui.consoleOpen) return;
  el.replaceChildren();
  const head = h(`<div class="console-head">${icon('terminal')}<b>Console</b><div class="seg">${['all', 'requests', 'logs', 'errors'].map(k => `<button data-f="${k}" class="${filter.type === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <input placeholder="Search console" value="${esc(filter.text)}"><span class="sp"></span><button class="ghost sm" data-clear title="Clear">${icon('trash')}</button><button class="ghost sm" data-close title="Close (Ctrl+Alt+C)">${icon('x')}</button></div>`);
  head.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter.type = b.dataset.f; render(); });
  head.querySelector('input').oninput = e => { filter.text = e.target.value; drawBody(); };
  head.querySelector('[data-clear]').onclick = () => { entries.length = 0; drawBody(); };
  head.querySelector('[data-close]').onclick = () => toggleConsole(false);
  let startH;
  head.addEventListener('mousedown', e => { if (e.target === head || e.target.tagName === 'B') startH = T.ui.consoleH || 240; });
  dragResize(head, { axis: 'y', onMove: dy => { if (startH == null) return; T.ui.consoleH = Math.max(100, Math.min(innerHeight * .7, startH - dy)); el.style.setProperty('--console-h', T.ui.consoleH + 'px'); }, onEnd: () => { startH = null; saveT(); } });
  const body = h(`<div class="console-body" id="consoleBody"></div>`);
  el.append(head, body);
  drawBody();
}
function drawBody() {
  const body = $('#consoleBody');
  if (!body) return;
  body.replaceChildren();
  const shown = entries.filter(visible);
  if (!shown.length) body.append(h(`<div class="empty">Requests, console.log output from scripts, and errors appear here.</div>`));
  for (const e of shown.slice(-500)) body.append(row(e));
  body.scrollTop = body.scrollHeight;
}
function appendRow(e) {
  const body = $('#consoleBody');
  if (!body || !visible(e)) return;
  body.querySelector('.empty')?.remove();
  const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  body.append(row(e));
  if (stick) body.scrollTop = body.scrollHeight;
}
function row(e) {
  const r = h(`<div class="log-row ${e.type === 'error' ? 'error' : e.type === 'warn' ? 'warn' : ''}"><span class="dim">${new Date(e.ts).toLocaleTimeString()}</span><span style="flex:1;word-break:break-all">${e.detail ? '▸ ' : ''}${esc(e.text)}</span></div>`);
  if (e.detail) r.onclick = () => {
    const next = r.nextElementSibling;
    if (next?.classList.contains('log-detail')) { next.remove(); r.firstElementChild.nextElementSibling.textContent = '▸ ' + e.text; return; }
    r.firstElementChild.nextElementSibling.textContent = '▾ ' + e.text;
    const q = e.detail.request || {}, s = e.detail.response;
    const hdrs = list => (list || []).map(([k, v]) => `${k}: ${v}`).join('\n');
    const d = h(`<div class="log-detail"></div>`);
    d.innerHTML = `<h5>Request</h5>${esc(`${q.method || ''} ${q.url || ''}`)}\n${esc(hdrs(q.headers))}${q.body ? '\n\n' + esc(String(q.body).slice(0, 20000)) : ''}`
      + (e.detail.redirects?.length ? `<h5>Redirects</h5>${esc(e.detail.redirects.map(x => `${x.status} ${x.from} → ${x.to}`).join('\n'))}` : '')
      + (s ? `<h5>Response — ${s.status} ${esc(s.statusText)} · ${s.time} ms</h5>${esc(hdrs(s.headers))}\n\n${esc((s.body ?? '[binary]').slice(0, 20000))}` : '');
    r.after(d);
  };
  return r;
}
