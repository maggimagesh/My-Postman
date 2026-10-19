// Collection runner.
import { W, find, flatRequests, kindBadge, saveW, varMap } from '../state.js';
import { h, esc, icon, toast, fmtTime, fmtSize, modal, clone, bus } from '../ui.js';
import { rt, markDirty, openTab } from '../tabs.js';
import { execute, buildHttp, chainOf } from '../execute.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...rest] = rows.filter(r => r.some(x => x !== ''));
  return (rest || []).map(r => Object.fromEntries(head.map((k, i) => [k.trim(), r[i] ?? ''])));
}

export function openRunner(targetId) {
  const f = find(targetId);
  if (!f) return;
  const reqs = flatRequests(f.node);
  openTab({ kind: 'runner', ref: 'runner:' + targetId, draft: { targetId, targetName: f.node.name, order: reqs.map(r => r.id), selected: Object.fromEntries(reqs.map(r => [r.id, true])), iterations: 1, delay: 0, envId: W.activeEnv, persistVars: true, stopOnFail: false } });
}

export function renderRunner(tab, el) {
  const d = tab.draft, r = rt(tab);
  const f = find(d.targetId);
  el.replaceChildren();
  if (!f) return el.append(h(`<div class="empty">The collection or folder for this run no longer exists.</div>`));
  const all = flatRequests(f.node);
  // keep order in sync with the tree (new requests appended, deleted removed)
  d.order = [...d.order.filter(id => all.some(x => x.id === id)), ...all.filter(x => !d.order.includes(x.id)).map(x => x.id)];
  for (const x of all) if (!(x.id in d.selected)) d.selected[x.id] = true;
  const byId = Object.fromEntries(all.map(x => [x.id, x]));
  const runnable = x => !x.kind || x.kind === 'http' || x.kind === 'graphql';

  const wrap = h(`<div style="display:grid;grid-template-columns:minmax(320px,380px) 1fr;flex:1;min-height:0">
    <div style="border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0">
      <div class="reqname" style="padding:12px 14px">${icon('play')}<b style="font-size:14px">${esc(f.node.name)}</b><span class="sp"></span><div class="seg" data-mode><button data-m="functional" class="${d.mode !== 'perf' ? 'on' : ''}">Functional</button><button data-m="perf" class="${d.mode === 'perf' ? 'on' : ''}">Performance</button></div></div>
      <div class="panel-body" data-cfg></div>
    </div>
    <div class="pane" data-results></div></div>`);
  el.append(wrap);
  wrap.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { if (r.running) return; d.mode = b.dataset.m; markDirty(tab); renderRunner(tab, el); });
  const cfg = wrap.querySelector('[data-cfg]');
  const list = h(`<div style="border:1px solid var(--line);border-radius:6px;max-height:260px;overflow:auto"></div>`);
  const drawList = () => {
    list.replaceChildren();
    const head = h(`<div class="node" style="border-bottom:1px solid var(--line)"><input type="checkbox" ${d.order.every(id => d.selected[id]) ? 'checked' : ''}><span class="nm dim">Select all</span><span class="dim">${d.order.filter(id => d.selected[id]).length}/${d.order.length}</span></div>`);
    head.querySelector('input').onchange = e => { d.order.forEach(id => d.selected[id] = e.target.checked); markDirty(tab); drawList(); };
    list.append(head);
    d.order.forEach((id, i) => {
      const x = byId[id];
      const row = h(`<div class="node" draggable="true" title="${runnable(x) ? 'Drag to reorder' : 'Realtime / gRPC requests are skipped by the runner'}"><input type="checkbox" ${d.selected[id] ? 'checked' : ''} ${runnable(x) ? '' : 'disabled'}><span class="m ${x.method || 'k-' + x.kind}">${esc(kindBadge(x))}</span><span class="nm">${esc(x.name)}</span></div>`);
      row.querySelector('input').onchange = e => { d.selected[id] = e.target.checked; markDirty(tab); };
      row.ondragstart = e => e.dataTransfer.setData('text/runner', String(i));
      row.ondragover = e => { e.preventDefault(); row.classList.add('drop-before'); };
      row.ondragleave = () => row.classList.remove('drop-before');
      row.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData('text/runner'); const [m] = d.order.splice(from, 1); d.order.splice(from < i ? i - 1 : i, 0, m); drawList(); };
      list.append(row);
    });
  };
  drawList();
  cfg.append(h(`<b class="dim" style="font-size:11px;text-transform:uppercase;letter-spacing:.6px">Run order</b>`), list);
  if (d.mode === 'perf') return renderPerfConfig(tab, el, cfg, wrap.querySelector('[data-results]'));
  const form = h(`<div class="form" style="grid-template-columns:130px 1fr">
    <label>Iterations</label><input type="number" min="1" data-k="iterations">
    <label>Delay (ms)</label><input type="number" min="0" data-k="delay">
    <label>Environment</label><select data-k="envId"><option value="">No environment</option>${W.environments.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
    <label>Data file</label><div class="row-flex"><button data-file>${icon('file')} Select CSV / JSON</button>${d.dataName ? `<span class="mono dim" style="overflow:hidden;text-overflow:ellipsis">${esc(d.dataName)}</span><button class="ghost sm" data-clearfile>${icon('x')}</button>` : ''}</div>
    <label>Keep variable values</label><div><input type="checkbox" data-k="persistVars"></div>
    <label>Stop on failure</label><div><input type="checkbox" data-k="stopOnFail"></div></div>`);
  form.querySelectorAll('[data-k]').forEach(i => {
    const k = i.dataset.k;
    if (i.type === 'checkbox') { i.checked = !!d[k]; i.onchange = () => { d[k] = i.checked; markDirty(tab); }; }
    else { i.value = d[k] ?? ''; i.oninput = i.onchange = () => { d[k] = i.type === 'number' ? Math.max(+i.min || 0, +i.value) : i.value || null; markDirty(tab); }; }
  });
  form.querySelector('[data-file]').onclick = async () => {
    const p = await api.dialogOpen({ text: true, filters: [{ name: 'Data', extensions: ['csv', 'json'] }] });
    if (!p) return;
    try {
      const rows = p[0].name.endsWith('.json') ? JSON.parse(p[0].text) : parseCsv(p[0].text);
      if (!Array.isArray(rows) || !rows.length) throw new Error('Expected a non-empty array / CSV with a header row');
      d.dataPath = p[0].path; d.dataName = p[0].name; d.iterations = rows.length; r.data = rows;
      markDirty(tab); renderRunner(tab, el);
      toast(`Loaded ${rows.length} data rows`);
    } catch (e) { toast('Data file: ' + e.message, 'error'); }
  };
  form.querySelector('[data-clearfile]')?.addEventListener('click', () => { d.dataPath = d.dataName = null; r.data = null; markDirty(tab); renderRunner(tab, el); });
  cfg.append(form);
  if (d.dataName) {
    const preview = h(`<button class="ghost sm" style="align-self:flex-start">${icon('eye')} Preview data</button>`);
    preview.onclick = async () => { const rows = await loadData(tab); if (rows) modal({ title: d.dataName, cls: 'wide', body: h(`<div style="overflow:auto"><table class="grid"><thead><tr>${Object.keys(rows[0]).map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 200).map(row => `<tr>${Object.values(row).map(v => `<td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`) }); };
    cfg.append(preview);
  }
  const runBtn = h(`<button class="primary" style="justify-content:center;padding:8px">${r.running ? `${icon('stop')} Stop run` : `${icon('play')} Run ${esc(f.node.name)}`}</button>`);
  runBtn.onclick = () => r.running ? (r.stop = true) : run(tab, el);
  cfg.append(runBtn);
  drawResults(tab, wrap.querySelector('[data-results]'));
}

async function loadData(tab) {
  const d = tab.draft, r = rt(tab);
  if (r.data) return r.data;
  if (!d.dataPath) return null;
  try { const t = await api.fileRead(d.dataPath); r.data = d.dataPath.endsWith('.json') ? JSON.parse(t) : parseCsv(t); return r.data; }
  catch (e) { toast('Could not read data file: ' + e.message, 'error'); return null; }
}

async function run(tab, el) {
  const d = tab.draft, r = rt(tab);
  const f = find(d.targetId);
  const all = flatRequests(f.node);
  const byId = Object.fromEntries(all.map(x => [x.id, x]));
  const queue = d.order.filter(id => d.selected[id] && byId[id] && (!byId[id].kind || ['http', 'graphql'].includes(byId[id].kind))).map(id => byId[id]);
  if (!queue.length) return toast('Select at least one HTTP request to run', 'error');
  const data = await loadData(tab);
  const iterations = Math.max(1, d.iterations || 1);
  const prevEnv = W.activeEnv;
  const snapshot = d.persistVars ? null : clone({ globals: W.globals, envs: W.environments.map(e => [e.id, e.vars]), cols: W.collections.map(c => [c.id, c.vars]) });
  W.activeEnv = d.envId || null;
  r.running = true; r.stop = false;
  r.results = { started: Date.now(), iterations: [], done: false };
  renderRunner(tab, el);
  outer: for (let it = 0; it < iterations; it++) {
    const rows = [];
    r.results.iterations.push(rows);
    let i = 0, guard = 0;
    while (i < queue.length && guard++ < queue.length * 50) {
      if (r.stop) break outer;
      const req = queue[i];
      const res = await execute(req, { refId: req.id, data: data ? data[it % data.length] : undefined, iteration: it, iterationCount: iterations, noHistory: true });
      rows.push({ id: req.id, name: req.name, method: req.method || 'POST', url: res.sent?.url || req.url, status: res.status, statusText: res.statusText, error: res.ok ? null : res.error, time: res.time, size: res.size, tests: res.tests, errors: res.errors, res });
      r.paintResults?.();
      const failed = !res.ok || res.tests.some(t => !t.pass && !t.skipped) || res.errors.length;
      if (failed && d.stopOnFail) break outer;
      if (res.nextRequest !== undefined) {
        if (res.nextRequest === null) break;
        const j = queue.findIndex(q => q.name === res.nextRequest || q.id === res.nextRequest);
        if (j < 0) { toast(`setNextRequest: "${res.nextRequest}" not found in this run`, 'error'); break; }
        i = j;
      } else i++;
      if (d.delay) await new Promise(s => setTimeout(s, d.delay));
    }
  }
  W.activeEnv = prevEnv;
  if (snapshot) {
    W.globals = snapshot.globals;
    for (const [id, vars] of snapshot.envs) { const e = W.environments.find(x => x.id === id); if (e) e.vars = vars; }
    for (const [id, vars] of snapshot.cols) { const c = W.collections.find(x => x.id === id); if (c) c.vars = vars; }
  }
  saveW(); bus.emit('vars'); bus.emit('env');
  r.running = false;
  r.results.done = true;
  r.results.finished = Date.now();
  r.results.stopped = r.stop;
  renderRunner(tab, el);
}

function drawResults(tab, el) {
  const r = rt(tab);
  r.filter ||= 'all';
  const paint = () => {
    el.replaceChildren();
    const res = r.results;
    if (!res) return el.append(h(`<div class="empty">${icon('play')}<div class="big">Configure the run on the left, then press Run</div><div class="dim">Tests from every request are collected here. Use <code>pm.execution.setNextRequest()</code> to control flow and a CSV/JSON data file for data-driven runs.</div></div>`));
    const rows = res.iterations.flat();
    const tests = rows.flatMap(x => x.tests || []);
    const pass = tests.filter(t => t.pass).length, fail = tests.filter(t => !t.pass && !t.skipped).length + rows.filter(x => x.error).length;
    const dur = (res.finished || Date.now()) - res.started;
    const avg = rows.length ? Math.round(rows.reduce((n, x) => n + (x.time || 0), 0) / rows.length) : 0;
    const head = h(`<div class="subtabs" style="gap:14px;padding:8px 14px"><b>${res.done ? (res.stopped ? 'Run stopped' : 'Run complete') : '<span class="spin"></span> Running…'}</b>
      <span class="dim">Iterations <b style="color:var(--fg)">${res.iterations.length}</b></span><span class="dim">Duration <b style="color:var(--fg)">${fmtTime(dur)}</b></span><span class="dim">Avg. response <b style="color:var(--fg)">${avg} ms</b></span>
      <span class="sp"></span><div class="seg">${[['all', `All (${rows.length})`], ['passed', `Passed (${pass})`], ['failed', `Failed (${fail})`]].map(([k, l]) => `<button data-f="${k}" class="${r.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="ghost sm" data-export title="Export results">${icon('upload')}</button></div>`);
    head.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { r.filter = b.dataset.f; paint(); });
    head.querySelector('[data-export]').onclick = () => api.dialogSave({ name: `${tab.draft.targetName}-run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, text: JSON.stringify({ collection: tab.draft.targetName, started: new Date(res.started).toISOString(), durationMs: dur, iterations: res.iterations.map(rs => rs.map(({ res: _, ...x }) => x)) }, null, 2) }).then(p => p && toast('Exported to ' + p));
    el.append(head);
    const body = h(`<div class="panel-body"></div>`);
    res.iterations.forEach((rs, it) => {
      if (res.iterations.length > 1) body.append(h(`<div class="dim" style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-top:6px">Iteration ${it + 1}</div>`));
      for (const x of rs) {
        const failed = x.error || x.tests?.some(t => !t.pass && !t.skipped) || x.errors?.length;
        if (r.filter === 'passed' && failed) continue;
        if (r.filter === 'failed' && !failed) continue;
        const row = h(`<div style="border:1px solid var(--line);border-radius:6px;padding:8px 10px;cursor:pointer">
          <div class="row-flex"><span class="m ${esc(x.method)}">${esc(x.method)}</span><b>${esc(x.name)}</b><span class="mono dim" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(x.url)}</span>
          ${x.error ? `<span class="s4">${esc(x.error)}</span>` : `<span class="pill s${String(x.status)[0]}">${x.status} ${esc(x.statusText || '')}</span><span class="dim">${x.time} ms · ${fmtSize(x.size)}</span>`}</div>
          ${(x.tests || []).map(t => `<div style="padding-left:52px;font-size:12.5px"><span class="${t.skipped ? 'dim' : t.pass ? 's2' : 's4'}">${t.skipped ? '–' : t.pass ? '✓' : '✗'}</span> ${esc(t.name)}${t.err ? ` <span class="mono dim">— ${esc(t.err)}</span>` : ''}</div>`).join('')}
          ${(x.errors || []).map(e => `<div style="padding-left:52px" class="s4 mono">${esc(e.location)}: ${esc(e.message)}</div>`).join('')}</div>`);
        row.onclick = () => detail(x);
        body.append(row);
      }
    });
    el.append(body);
    if (!res.done) body.scrollTop = body.scrollHeight;
  };
  r.paintResults = paint;
  paint();
}

function detail(x) {
  const res = x.res;
  const body = h(`<div class="col-flex"></div>`);
  if (!res.ok) body.append(h(`<div class="callout warn">${esc(res.error)}</div>`));
  else {
    let pretty = res.body ?? '[binary]';
    try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch {}
    body.append(h(`<div class="form" style="grid-template-columns:120px 1fr"><label>Request</label><div class="mono" style="word-break:break-all">${esc(res.sent?.method)} ${esc(res.sent?.url)}</div><label>Status</label><div>${res.status} ${esc(res.statusText)} · ${res.time} ms</div></div>`));
    body.append(h(`<details><summary>Request headers</summary><pre class="mono" style="white-space:pre-wrap">${esc((res.sent?.headers || []).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre></details>`));
    if (res.sent?.body) body.append(h(`<details><summary>Request body</summary><pre class="mono" style="white-space:pre-wrap">${esc(res.sent.body)}</pre></details>`));
    body.append(h(`<details><summary>Response headers</summary><pre class="mono" style="white-space:pre-wrap">${esc(res.headers.map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre></details>`));
    body.append(h(`<details open><summary>Response body</summary><pre class="mono" style="white-space:pre-wrap;max-height:40vh;overflow:auto">${esc(pretty.slice(0, 200000))}</pre></details>`));
  }
  modal({ title: x.name, cls: 'wide', body });
}

// ---------- performance testing ----------
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))] : 0;

function renderPerfConfig(tab, el, cfg, resultsEl) {
  const d = tab.draft, r = rt(tab);
  d.perf ||= { vus: 10, duration: 30, rampUp: 5 };
  const form = h(`<div class="form" style="grid-template-columns:150px 1fr">
    <label>Virtual users</label><input type="number" min="1" max="200" data-k="vus">
    <label>Test duration (s)</label><input type="number" min="1" max="3600" data-k="duration">
    <label>Ramp-up (s)</label><input type="number" min="0" data-k="rampUp">
    <label>Environment</label><select data-env><option value="">No environment</option>${W.environments.map(e => `<option value="${e.id}" ${e.id === d.envId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>`);
  form.querySelectorAll('[data-k]').forEach(i => { i.value = d.perf[i.dataset.k]; i.oninput = () => { d.perf[i.dataset.k] = Math.max(+i.min, Math.min(+i.max || 1e9, +i.value || 0)); markDirty(tab); }; });
  form.querySelector('[data-env]').onchange = e => { d.envId = e.target.value || null; markDirty(tab); };
  cfg.append(form, h(`<div class="dim" style="font-size:12px">Each virtual user loops through the selected requests until the time is up. Scripts are not run in performance mode, so the load generator measures the API rather than the sandbox.</div>`));
  const btn = h(`<button class="primary" style="justify-content:center;padding:8px">${r.running ? `${icon('stop')} Stop test` : `${icon('bolt')} Start performance test`}</button>`);
  btn.onclick = () => r.running ? (r.stop = true) : runPerf(tab, el);
  cfg.append(btn);
  drawPerf(tab, resultsEl);
}

async function runPerf(tab, el) {
  const d = tab.draft, r = rt(tab);
  const f = find(d.targetId);
  const byId = Object.fromEntries(flatRequests(f.node).map(x => [x.id, x]));
  const queue = d.order.filter(id => d.selected[id] && byId[id] && (!byId[id].kind || ['http', 'graphql'].includes(byId[id].kind))).map(id => byId[id]);
  if (!queue.length) return toast('Select at least one HTTP request', 'error');
  const prevEnv = W.activeEnv;
  W.activeEnv = d.envId || null;
  const colId = f.collection.id;
  const { vus, duration, rampUp } = d.perf;
  const start = Date.now(), end = start + duration * 1000;
  r.perf = { start, end, samples: [], active: 0, done: false, vus };
  r.running = true; r.stop = false;
  renderRunner(tab, el);
  const timer = setInterval(() => r.paintPerf?.(), 500);
  const vu = async i => {
    await new Promise(s => setTimeout(s, rampUp ? (i * rampUp * 1000) / vus : 0));
    if (r.stop || Date.now() >= end) return;
    r.perf.active++;
    while (!r.stop && Date.now() < end) {
      for (const q of queue) {
        if (r.stop || Date.now() >= end) break;
        let payload;
        try { payload = buildHttp(q, varMap(colId), chainOf(q, q.id)); } catch { continue; }
        const res = await api.httpSend({ ...payload, id: undefined });
        r.perf.samples.push({ t: Date.now(), ms: res.time, ok: res.ok && res.status < 400, status: res.ok ? res.status : 'ERR', name: q.name, error: res.ok ? null : res.error });
      }
    }
    r.perf.active--;
  };
  await Promise.all(Array.from({ length: vus }, (_, i) => vu(i)));
  clearInterval(timer);
  W.activeEnv = prevEnv;
  r.perf.done = true; r.perf.finished = Date.now(); r.running = false;
  renderRunner(tab, el);
}

function drawPerf(tab, el) {
  const r = rt(tab);
  const paint = () => {
    el.replaceChildren();
    const p = r.perf;
    if (!p) return el.append(h(`<div class="empty">${icon('bolt')}<div class="big">Load-test the selected requests</div><div class="dim">Simulate concurrent virtual users and see throughput, latency percentiles and error rate in real time.</div></div>`));
    const s = p.samples;
    const now = p.finished || Date.now();
    const elapsed = Math.max(1, (Math.min(now, p.end) - p.start) / 1000);
    const times = s.map(x => x.ms).sort((a, b) => a - b);
    const errors = s.filter(x => !x.ok).length;
    const avg = s.length ? Math.round(times.reduce((a, b) => a + b, 0) / s.length) : 0;
    const stat = (label, val, cls = '') => `<div style="border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px"><div class="dim" style="font-size:12px">${label}</div><div class="${cls}" style="font-size:20px;font-weight:600">${val}</div></div>`;
    const head = h(`<div class="panel-body" style="flex:none">
      <div class="row-flex"><b>${p.done ? 'Test finished' : `<span class="spin"></span> Running — ${p.active}/${p.vus} virtual users`}</b><span class="dim">${Math.round(elapsed)}s / ${Math.round((p.end - p.start) / 1000)}s</span><span class="sp"></span><button class="ghost sm" data-export title="Export samples">${icon('upload')}</button></div>
      <div class="row-flex" style="flex-wrap:wrap;gap:10px">${stat('Total requests', s.length)}${stat('Throughput', (s.length / elapsed).toFixed(1) + ' req/s')}${stat('Avg. response', avg + ' ms')}${stat('P90', pct(times, 90) + ' ms')}${stat('P95', pct(times, 95) + ' ms')}${stat('P99', pct(times, 99) + ' ms')}${stat('Error rate', (s.length ? (errors / s.length * 100).toFixed(1) : '0.0') + '%', errors ? 's4' : 's2')}</div></div>`);
    head.querySelector('[data-export]').onclick = () => api.dialogSave({ name: 'performance-run.json', text: JSON.stringify({ started: new Date(p.start).toISOString(), vus: p.vus, samples: s }, null, 2) }).then(x => x && toast('Exported to ' + x));
    el.append(head);
    // per-second chart: bars = requests/s, line = avg response time
    const secs = Math.ceil((p.end - p.start) / 1000);
    const buckets = Array.from({ length: secs }, () => ({ n: 0, ms: 0 }));
    for (const x of s) { const b = buckets[Math.min(secs - 1, Math.floor((x.t - p.start) / 1000))]; b.n++; b.ms += x.ms; }
    const maxN = Math.max(1, ...buckets.map(b => b.n)), maxMs = Math.max(1, ...buckets.map(b => b.n ? b.ms / b.n : 0));
    const W_ = 800, H = 140, bw = W_ / secs;
    const bars = buckets.map((b, i) => `<rect x="${i * bw + 1}" y="${H - (b.n / maxN) * H}" width="${Math.max(1, bw - 2)}" height="${(b.n / maxN) * H}" fill="var(--acc-soft)"/>`).join('');
    const line = buckets.map((b, i) => b.n ? `${i * bw + bw / 2},${H - (b.ms / b.n / maxMs) * (H - 6)}` : null).filter(Boolean).join(' ');
    el.append(h(`<div class="panel-body" style="flex:none"><div class="row-flex dim" style="font-size:12px"><span><span style="display:inline-block;width:10px;height:10px;background:var(--acc-soft);border:1px solid var(--acc)"></span> requests/s (max ${maxN})</span><span><span style="display:inline-block;width:14px;height:2px;background:var(--warn);vertical-align:middle"></span> avg response (max ${Math.round(maxMs)} ms)</span></div>
      <svg viewBox="0 0 ${W_} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;border:1px solid var(--line);border-radius:6px" role="img" aria-label="Throughput and latency over time">${bars}<polyline points="${line}" fill="none" stroke="var(--warn)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`));
    const per = {};
    for (const x of s) { const q = per[x.name] ||= { n: 0, err: 0, t: [] }; q.n++; if (!x.ok) q.err++; q.t.push(x.ms); }
    el.append(h(`<div class="panel-body"><table class="grid"><thead><tr><th>Request</th><th>Requests</th><th>Avg</th><th>Min</th><th>Max</th><th>P90</th><th>Errors</th></tr></thead><tbody>${Object.entries(per).map(([n, q]) => { const t = q.t.sort((a, b) => a - b); return `<tr><td class="k">${esc(n)}</td><td>${q.n}</td><td>${Math.round(t.reduce((a, b) => a + b, 0) / t.length)} ms</td><td>${t[0]} ms</td><td>${t[t.length - 1]} ms</td><td>${pct(t, 90)} ms</td><td class="${q.err ? 's4' : ''}">${q.err} (${(q.err / q.n * 100).toFixed(1)}%)</td></tr>`; }).join('')}</tbody></table>
      ${errors ? `<div class="dim" style="margin-top:8px;font-size:12px">Errors: ${esc([...new Set(s.filter(x => !x.ok).map(x => x.error || 'HTTP ' + x.status))].slice(0, 5).join(' · '))}</div>` : ''}</div>`));
  };
  r.paintPerf = paint;
  paint();
}
