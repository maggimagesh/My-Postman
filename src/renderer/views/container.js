// Collection / folder settings, environment & globals editor, saved example editor.
import { W, find, varMap, flatRequests, activeEnv, saveW, kindBadge } from '../state.js';
import { h, esc, icon, kvTable, md, bus, toast } from '../ui.js';
import { createEditor } from '../editor.js';
import { rt, markDirty, saveTab, renderTabs } from '../tabs.js';
import { renderAuth } from './auth.js';
import { drawScripts } from './http.js';

export function renderContainer(tab, el) {
  const d = tab.draft, r = rt(tab);
  const isCol = d.kind === 'collection';
  r.subTab ||= 'overview';
  const f = find(tab.ref);
  el.replaceChildren();
  const head = h(`<div class="reqname" style="padding-bottom:8px">${icon(isCol ? 'collections' : 'folder')}<input class="nm" value="${esc(d.name)}" aria-label="Name"><span class="sp"></span>
    <button class="sm" data-run>${icon('play')} Run</button><button class="sm" data-save>${icon('check')} Save</button></div>`);
  head.querySelector('.nm').oninput = e => { d.name = e.target.value; markDirty(tab); renderTabs(); };
  head.querySelector('[data-save]').onclick = () => saveTab(tab);
  head.querySelector('[data-run]').onclick = () => bus.emit('run', tab.ref);
  el.append(head);
  const tabsDef = [['overview', 'Overview'], ['auth', 'Authorization'], ['scripts', 'Scripts'], ...(isCol ? [['vars', 'Variables']] : [])];
  const sub = h(`<div class="subtabs">${tabsDef.map(([k, l]) => `<button class="st" data-t="${k}">${l}</button>`).join('')}</div>`);
  const body = h(`<div class="panel-body"></div>`);
  el.append(sub, body);
  sub.onclick = e => { const b = e.target.closest('[data-t]'); if (b) { r.subTab = b.dataset.t; draw(); } };
  const changed = () => markDirty(tab);
  function draw() {
    sub.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === r.subTab));
    body.replaceChildren();
    body.classList.remove('flush');
    if (r.subTab === 'overview') {
      const reqs = f ? flatRequests(f.node) : [];
      const kinds = {};
      for (const q of reqs) kinds[kindBadge(q)] = (kinds[kindBadge(q)] || 0) + 1;
      body.append(h(`<div class="row-flex dim">${reqs.length} request(s) · ${Object.entries(kinds).map(([k, n]) => `${n} ${esc(k)}`).join(' · ') || 'empty'}</div>`));
      const wrap = h(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;min-height:260px"><textarea style="resize:none" placeholder="Document this ${isCol ? 'collection' : 'folder'} in Markdown…"></textarea><div class="md" style="overflow:auto;border-left:1px solid var(--line);padding-left:12px"></div></div>`);
      const ta = wrap.querySelector('textarea'), pv = wrap.querySelector('.md');
      ta.value = d.description || '';
      pv.innerHTML = md(d.description || '*No description.*');
      ta.oninput = () => { d.description = ta.value; pv.innerHTML = md(ta.value || '*No description.*'); changed(); };
      body.append(wrap);
    }
    if (r.subTab === 'auth') renderAuth(body, d.auth ||= { type: isCol ? 'none' : 'inherit' }, changed, { allowInherit: !isCol, inheritLabel: '', vars: () => varMap(f?.collection?.id) });
    if (r.subTab === 'scripts') {
      body.append(h(`<div class="dim" style="font-size:12px;padding:6px 0">These scripts run for every request in this ${isCol ? 'collection' : 'folder'} — before/after the request's own scripts.</div>`));
      const holder = h(`<div class="panel-body flush" style="padding:0"></div>`);
      body.append(holder);
      drawScripts(tab, holder, changed, d);
    }
    if (r.subTab === 'vars') {
      body.append(h(`<div class="dim" style="font-size:12px">Collection variables are available to every request in this collection. Environment variables with the same name take precedence.</div>`));
      body.append(kvTable(d.vars ||= [], changed, { placeholder: ['Variable', 'Value'], secret: true, desc: true }));
    }
  }
  draw();
}

export function renderEnv(tab, el) {
  const d = tab.draft;
  const isGlobals = tab.ref === 'globals';
  el.replaceChildren();
  const isActive = W.activeEnv === tab.ref;
  const head = h(`<div class="reqname" style="padding-bottom:8px">${icon(isGlobals ? 'globe' : 'env')}${isGlobals ? '<b style="font-size:14px">Globals</b>' : `<input class="nm" value="${esc(d.name)}" aria-label="Environment name">`}<span class="sp"></span>
    ${isGlobals ? '' : `<button class="sm ${isActive ? '' : 'primary'}" data-act>${isActive ? icon('check') + ' Active' : 'Set active'}</button>`}<button class="sm" data-save>${icon('check')} Save</button></div>`);
  head.querySelector('.nm')?.addEventListener('input', e => { d.name = e.target.value; markDirty(tab); renderTabs(); });
  head.querySelector('[data-save]').onclick = () => saveTab(tab);
  head.querySelector('[data-act]')?.addEventListener('click', async () => { if (tab.dirty) await saveTab(tab); W.activeEnv = isActive ? null : tab.ref; saveW(); bus.emit('env'); renderEnv(tab, el); });
  el.append(head);
  const body = h(`<div class="panel-body"></div>`);
  body.append(h(`<div class="dim" style="font-size:12px">${isGlobals ? 'Global variables are available in every request, in every environment.' : 'Use variables as <code>{{name}}</code> anywhere — URL, headers, body, auth, scripts. Secret values are masked on screen.'}</div>`));
  const table = kvTable(d.vars ||= [], () => markDirty(tab), { placeholder: ['Variable', 'Value'], secret: true, desc: true });
  body.append(table);
  el.append(body);
  // Scripts may change variables while this tab is open.
  rt(tab).refresh = () => {
    if (tab.dirty) return;
    const src = isGlobals ? W.globals : W.environments.find(e => e.id === tab.ref)?.vars;
    if (src) { d.vars = JSON.parse(JSON.stringify(src)); renderEnv(tab, el); }
  };
}

export function renderExample(tab, el) {
  const d = tab.draft;
  const f = find(tab.ref);
  el.replaceChildren();
  const head = h(`<div class="reqname" style="padding-bottom:8px">${icon('file')}<span class="dim">${esc(f?.parent?.name || '')} /</span><input class="nm" value="${esc(d.name)}"><span class="sp"></span><span class="dim" style="font-size:12px">Example — served by mock servers</span><button class="sm" data-save>${icon('check')} Save</button></div>`);
  head.querySelector('.nm').oninput = e => { d.name = e.target.value; markDirty(tab); renderTabs(); };
  head.querySelector('[data-save]').onclick = () => saveTab(tab);
  el.append(head);
  const body = h(`<div class="panel-body"></div>`);
  const meta = h(`<div class="form"><label>Request</label><div class="mono">${esc(d.request?.method || '')} ${esc(d.request?.url || '')}</div><label>Status code</label><input type="number" min="100" max="599" value="${d.status || 200}"></div>`);
  meta.querySelector('input').oninput = e => { d.status = +e.target.value; markDirty(tab); };
  body.append(meta);
  const rows = (d.headers || []).map(([k, v]) => ({ on: true, key: k, value: v }));
  body.append(kvTable(rows, () => { d.headers = rows.filter(x => x.on && x.key).map(x => [x.key, x.value]); markDirty(tab); }, { title: 'Response headers' }));
  body.append(h(`<b class="dim" style="font-size:12px">RESPONSE BODY</b>`));
  const box = h(`<div class="editor-wrap" style="min-height:240px"></div>`);
  body.append(box);
  const lang = /json/i.test((d.headers || []).find(([k]) => /content-type/i.test(k))?.[1] || '') || /^\s*[[{]/.test(d.body || '') ? 'json' : 'plaintext';
  createEditor(box, { value: d.body || '', language: lang, onChange: v => { d.body = v; markDirty(tab); } });
  el.append(body);
}
