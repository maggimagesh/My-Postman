// HTTP response viewer.
import { h, esc, icon, fmtSize, fmtTime, toast, menuFor, uid, clone } from '../ui.js';
import { createEditor, focusedEditor } from '../editor.js';
import { rt, markDirty } from '../tabs.js';
import { find, saveW } from '../state.js';
import { curlOf } from '../codegen.js';

const LARGE = 5 * 1048576;
const STATUS_HINT = { 200: 'OK — request succeeded', 201: 'Created — a new resource was created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found (temporary redirect)', 304: 'Not Modified', 400: 'Bad Request — the server could not understand the request', 401: 'Unauthorized — authentication is required or failed', 403: 'Forbidden — you lack permission', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity — validation failed', 429: 'Too Many Requests — rate limited', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

export function detectLang(res) {
  const ct = res.contentType || '';
  const b = (res.body || '').trimStart();
  if (/json/.test(ct) || /^[[{]/.test(b)) return 'json';
  if (/html/.test(ct) || /^<!doctype html|^<html/i.test(b)) return 'html';
  if (/xml/.test(ct) || b.startsWith('<')) return 'xml';
  if (/javascript/.test(ct)) return 'javascript';
  return 'plaintext';
}
export const prettyBody = (res, lang) => {
  if (lang === 'json') { try { return JSON.stringify(JSON.parse(res.body), null, 2); } catch {} }
  return res.body;
};

const TLS_ERRORS = /^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(VERIFY|GET_ISSUER)|ERR_TLS_CERT_ALTNAME_INVALID|ERR_SSL_|HOSTNAME_MISMATCH)/;

const postmark = t => { const d = new Date(t); return [`${d.getDate()} ${d.toLocaleString('en', { month: 'short' }).toUpperCase()}`, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`]; };
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleTimeString(); };

// The dispatch log: every reply to this tab is stamped and kept (newest first), each with its body, headers,
// cookies, tests, console output and timing. The newest one is expanded.
export function renderResponse(tab, el, opts = {}) {
  const r = rt(tab);
  if (r.res && !r.runs?.length) { r.runs = [{ id: uid(), res: r.res, at: Date.now(), method: r.res.sent?.method || tab.draft.method, url: r.res.sent?.url || tab.draft.url }]; r.openRuns = new Set([r.runs[0].id]); }
  r.runs ||= [];
  r.openRuns ||= new Set(r.runs[0] ? [r.runs[0].id] : []);
  el.replaceChildren();
  r.diffEd?.dispose(); r.diffEd = null;
  r.cmp = (r.cmp || []).filter(id => r.runs.some(x => x.id === id));
  // Response-time sparkline across the kept replies, oldest → newest.
  const times = r.runs.slice().reverse();
  const max = Math.max(...times.map(x => x.res.time || 0), 1);
  const spark = times.length > 1 ? `<span class="spark" title="Response times, oldest to newest">${times.map(x => `<i style="height:${x.res.ok ? Math.max(2, (x.res.time || 0) / max * 16) : 16}px;background:var(--${!x.res.ok || x.res.status >= 400 ? 'err' : x.res.time < 300 ? 'ok' : x.res.time < 1000 ? 'warn' : 'err'})" title="${x.res.ok ? x.res.status + ' · ' + fmtTime(x.res.time) : 'failed'}"></i>`).join('')}</span>` : '';
  const head = h(`<div class="loghead"><span class="h">Dispatch log</span><span class="c">${r.runs.length ? `${r.runs.length} ${r.runs.length === 1 ? 'reply' : 'replies'}` : ''}</span>${spark}<span class="sp"></span>${r.runs.length > 1 ? '<span class="c">Tick two replies to compare them</span>' : ''}${r.runs.length ? '<button data-clear>Clear log</button>' : ''}</div>`);
  head.querySelector('[data-clear]')?.addEventListener('click', () => { r.runs = []; r.res = null; r.cmp = []; renderResponse(tab, el, opts); });
  const list = h(`<div class="runs"></div>`);
  el.append(head, list);
  if (r.cmp.length === 2) list.append(compareView(tab, r, () => renderResponse(tab, el, opts)));
  if (r.loading) {
    const d = h(`<div class="transit"><span class="spin"></span><div class="t"><b>In transit</b><span class="u">${esc(r.sending?.method || '')} ${esc(r.sending?.url || '')}</span></div><button>Cancel</button></div>`);
    d.querySelector('button').onclick = () => r.cancel?.();
    list.append(d);
  }
  if (!r.runs.length && !r.loading) list.append(h(`<div class="logempty"><div class="st">— — —</div><div class="tx"><b>Nothing dispatched yet</b><span>Press <kbd>Ctrl Enter</kbd> to send, or <kbd>Ctrl Alt Enter</kbd> to send and download. Each reply is stamped and kept here, with its tests, console output and cookies.</span></div></div>`));
  for (const run of r.runs) list.append(runCard(tab, run, r, () => renderResponse(tab, el, opts), opts));
}

// Side-by-side diff of two kept replies (older on the left): body or headers.
function compareView(tab, r, redraw) {
  const [a, b] = r.cmp.map(id => r.runs.find(x => x.id === id)).sort((x, y) => x.at - y.at);
  r.cmpWhat ||= 'body';
  const label = x => `${x.res.ok ? x.res.status : 'ERR'} · ${new Date(x.at).toLocaleTimeString()}`;
  const wrap = h(`<div class="col-flex"><div class="cmpbar"><b>Comparing</b><span class="mono">${esc(label(a))}</span><span class="dim">→</span><span class="mono">${esc(label(b))}</span>
    <div class="pillseg"><button data-w="body" class="${r.cmpWhat === 'body' ? 'on' : ''}">Body</button><button data-w="headers" class="${r.cmpWhat === 'headers' ? 'on' : ''}">Headers</button></div><span class="sp"></span><button class="ghost sm" data-x>${icon('x')} Stop comparing</button></div><div class="diffwrap"></div></div>`);
  wrap.querySelectorAll('[data-w]').forEach(x => x.onclick = () => { r.cmpWhat = x.dataset.w; redraw(); });
  wrap.querySelector('[data-x]').onclick = () => { r.cmp = []; redraw(); };
  const text = x => !x.res.ok ? String(x.res.error || '') : r.cmpWhat === 'headers' ? x.res.headers.map(([k, v]) => `${k}: ${v}`).sort().join('\n') : x.res.body == null ? `<binary ${x.res.contentType}, ${x.res.size} bytes>` : prettyBody(x.res, detectLang(x.res));
  const lang = r.cmpWhat === 'headers' ? 'plaintext' : detectLang(b.res);
  requestAnimationFrame(() => {
    const m = window.monaco;
    if (!m || !wrap.isConnected) return;
    r.diffEd = m.editor.createDiffEditor(wrap.querySelector('.diffwrap'), { readOnly: true, automaticLayout: true, minimap: { enabled: false }, renderSideBySide: true, scrollBeyondLastLine: false, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 });
    r.diffEd.setModel({ original: m.editor.createModel(text(a), lang), modified: m.editor.createModel(text(b), lang) });
  });
  return wrap;
}

function runCard(tab, run, r, redraw, { onAskAi, onSaveExample, onDisableSsl, onResend, onRestore }) {
  const res = run.res;
  const open = r.openRuns.has(run.id);
  const cls = res.ok ? 's' + String(res.status)[0] : 'serr';
  const tests = res.tests || [];
  const passed = tests.filter(t => t.pass).length, failed = tests.filter(t => !t.pass && !t.skipped).length;
  const path = String(run.url || '').replace(/^[a-z]+:\/\/[^/]*/i, '') || run.url || '';
  const code = res.ok ? res.status : res.skipped ? 'SKIP' : res.cancelled ? 'STOP' : 'ERR';
  const reason = res.ok ? res.statusText || '' : res.skipped ? 'skipped' : res.cancelled ? 'cancelled' : 'returned to sender';
  const card = h(`<article class="run ${open ? 'open' : ''}">
    <div class="runhead" tabindex="0" role="button" aria-expanded="${open}">
      <div class="stamp ${cls}" title="${esc(res.ok && res.status >= 400 ? 'Returned to sender: ' + reason : reason)}"><div><span class="r">${esc(postmark(run.at)[0])}</span><span class="c">${esc(code)}</span><span class="r">${esc(postmark(run.at)[1])}</span></div></div>
      <div class="runmeta">
        <div class="ln"><span class="m ${esc(run.method)}">${esc(run.method)}</span><span class="p" title="${esc(run.url)}">${esc(path)}</span></div>
        <div class="resbar">
          ${res.ok ? `<span class="pill ${cls}" title="${esc(STATUS_HINT[res.status] || res.statusText)}">${res.status} ${esc(res.statusText)}</span>
          <span title="Time to first byte: ${res.timings?.ttfb} ms&#10;Download: ${res.timings?.download} ms${res.redirects?.length ? `&#10;Redirects: ${res.redirects.length}` : ''}">${fmtTime(res.time)}</span>
          <span title="Body: ${fmtSize(res.size)} (transferred ${fmtSize(res.rawSize)})&#10;Headers: ${fmtSize(res.headersSize)}">${fmtSize(res.size + (res.headersSize || 0))}</span>` : `<span class="pill serr">${esc(reason[0].toUpperCase() + reason.slice(1))}${res.code ? ' · ' + esc(res.code) : ''}</span>`}
          ${tests.length ? `<span style="color:var(--${failed ? 'err' : 'ok'});font-weight:500">${passed}/${tests.length} tests passed</span>` : ''}
          ${res.errors?.length ? `<span style="color:var(--err)">${res.errors.length} script error${res.errors.length > 1 ? 's' : ''}</span>` : ''}
          <span class="at">${ago(run.at)}</span>
        </div>
      </div>
      ${r.runs.length > 1 ? `<label class="pick" title="Compare with another reply"><input type="checkbox" ${r.cmp.includes(run.id) ? 'checked' : ''}> Compare</label>` : ''}
      ${open ? '' : `<span class="chev">${icon('chevD')}</span>`}
      <button class="ghost" data-more title="Send again, copy as cURL, save…" aria-label="More actions">${icon('more')}</button>
    </div></article>`);
  const toggle = () => { open ? r.openRuns.delete(run.id) : r.openRuns.add(run.id); redraw(); };
  const hd = card.querySelector('.runhead');
  hd.onclick = e => { if (!e.target.closest('button, label')) toggle(); };
  hd.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === hd) { e.preventDefault(); toggle(); } };
  card.querySelector('.pick input')?.addEventListener('change', e => {
    r.cmp = e.target.checked ? [...r.cmp.filter(id => id !== run.id), run.id].slice(-2) : r.cmp.filter(id => id !== run.id);
    redraw();
  });
  card.querySelector('[data-more]').onclick = e => menuFor(e.currentTarget, [
    run.req && { label: 'Send this again', icon: 'refresh', run: () => onResend?.(run) },
    run.req && { label: 'Restore request as sent', icon: 'copy', run: () => onRestore?.(run) },
    res.sent && { label: 'Copy as cURL', icon: 'code', run: () => { navigator.clipboard.writeText(curlOf(res.sent)); toast('cURL copied'); } },
    '-',
    res.ok && { label: 'Save to a file', icon: 'download', run: () => saveToFile(tab, res) },
    res.ok && { label: 'Save as example', icon: 'file', run: () => onSaveExample?.(res) },
    res.ok && { label: 'Copy body', icon: 'copy', run: () => { navigator.clipboard.writeText(res.body ?? ''); toast('Copied'); } },
    { label: 'Remove from log', icon: 'x', run: () => { r.runs = r.runs.filter(x => x !== run); if (r.res === res) r.res = r.runs[0]?.res || null; redraw(); } },
  ]);
  if (!open) return card;

  const body = h(`<div class="runbody"></div>`);
  card.append(body);
  if (!res.ok) {
    const d = h(`<div class="empty"><div class="big s4">${res.skipped ? 'Request skipped' : res.cancelled ? 'Request cancelled' : 'Could not send request'}</div><div class="mono" style="max-width:640px;white-space:pre-wrap;margin:0 auto">${esc(res.error)}</div>${res.code ? `<div class="dim">${esc(res.code)}</div>` : ''}<div class="row-flex" style="justify-content:center;margin-top:10px"><button data-ai>${icon('spark')} Ask Claude why</button></div></div>`);
    d.querySelector('[data-ai]').onclick = () => onAskAi?.('debug');
    // Certificate problems (expired, self-signed, wrong host) get a one-click way around.
    if (TLS_ERRORS.test(res.code || '') && onDisableSsl) {
      const ssl = h(`<div class="callout warn" style="max-width:640px;margin:12px auto 0;text-align:left">The server's TLS certificate failed verification, so no request was sent. If you trust this server (e.g. a local or dev environment), turn off SSL certificate verification and retry.
        <div class="row-flex" style="margin-top:8px"><button class="primary" data-ssl="all">Disable SSL verification &amp; retry</button><button data-ssl="one">Only for this request</button></div></div>`);
      ssl.querySelectorAll('[data-ssl]').forEach(b => b.onclick = () => onDisableSsl(b.dataset.ssl));
      d.append(ssl);
    }
    body.append(d);
    if (tests.length || res.errors?.length) body.append(testsView(res, run));
    return card;
  }

  run.tab ||= 'body';
  const logs = res.logs || [];
  const tabs = [['body', 'Body'], ['headers', `Headers ${res.headers.length}`], ['cookies', `Cookies${res.cookies?.length ? ' ' + res.cookies.length : ''}`], ['tests', `Tests${tests.length ? ` ${passed}/${tests.length}` : ''}`], ['console', `Console${logs.length ? ' ' + logs.length : ''}`], ['timing', 'Timing']];
  const seg = h(`<div class="pillseg runtabs" role="tablist">${tabs.map(([k, l]) => `<button data-t="${k}" role="tab" class="${run.tab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`);
  seg.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { run.tab = b.dataset.t; redraw(); });
  hd.insertBefore(seg, card.querySelector('[data-more]'));
  const panel = h(`<div class="panel-body"></div>`);
  body.append(panel);
  if (run.tab === 'body') bodyView(tab, res, panel, run);
  if (run.tab === 'headers') panel.append(table(res.headers));
  if (run.tab === 'cookies') panel.append(res.cookies?.length ? cookieTable(res.cookies) : h(`<div class="dim" style="padding:6px 0">No cookies were set by this reply. All stored cookies are in the Cookies manager.</div>`));
  if (run.tab === 'tests') panel.replaceWith(testsView(res, run, redraw));
  if (run.tab === 'console') {
    if (!logs.length) panel.append(h(`<div class="dim" style="padding:6px 0">Nothing logged. <code>console.log()</code> output from scripts appears here; every request is also in the Console (Ctrl+Alt+C).</div>`));
    for (const l of logs) panel.append(h(`<div class="logrow ${esc(l.level)}"><span class="lv">${esc(l.level)}</span><span class="tx">${esc(l.text)}</span></div>`));
  }
  if (run.tab === 'timing') timeline(res, panel);
  return card;
}

function bodyView(tab, res, el, r) {
  const lang = detectLang(res);
  r.view ||= 'pretty';
  r.lang ||= null;
  const useLang = r.lang || lang;
  const tb = h(`<div class="toolbar"><div class="seg">${['pretty', 'raw', 'preview', 'visualize'].map(v => `<button data-v="${v}" class="${r.view === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
    ${r.view === 'pretty' ? `<select class="sm" data-lang style="padding:2px 6px">${[['json', 'JSON'], ['xml', 'XML'], ['html', 'HTML'], ['javascript', 'JavaScript'], ['plaintext', 'Text']].map(([v, l]) => `<option value="${v}" ${v === useLang ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
    <span class="dim mono" style="font-size:11px">${esc((res.contentType || '').split(';')[0])}</span><span class="sp"></span><button class="ghost sm" data-find title="Search (in editor: Ctrl+F)">${icon('search')}</button><button class="ghost sm" data-dl title="Save to file">${icon('download')} Save to file</button><button class="ghost sm" data-copy title="Copy body" style="color:var(--ac-tx)">${icon('copy')} Copy</button></div>`);
  tb.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { r.view = b.dataset.v; el.replaceChildren(); bodyView(tab, res, el, r); });
  tb.querySelector('[data-lang]')?.addEventListener('change', e => { r.lang = e.target.value; el.replaceChildren(); bodyView(tab, res, el, r); });
  tb.querySelector('[data-copy]').onclick = () => { navigator.clipboard.writeText(res.body ?? ''); toast('Copied'); };
  tb.querySelector('[data-dl]').onclick = () => saveToFile(tab, res);
  el.append(tb);
  if (res.body == null) {
    if (/^image\//.test(res.contentType)) el.append(h(`<div style="overflow:auto"><img alt="Response image" style="max-width:100%;background:repeating-conic-gradient(#8882 0 25%,transparent 0 50%) 0 0/16px 16px" src="data:${esc(res.contentType)};base64,${res.base64}"></div>`));
    else {
      const d = h(`<div class="empty">Binary response (${esc(res.contentType || 'unknown type')}, ${fmtSize(res.size)})<br><button>${icon('download')} Save to file</button></div>`);
      d.querySelector('button').onclick = () => saveToFile(tab, res);
      el.append(d);
    }
    return;
  }
  if (r.view === 'preview') {
    const f = h(`<iframe class="preview" sandbox="" title="Response preview"></iframe>`);
    f.srcdoc = useLang === 'json' ? `<pre style="font:13px monospace;white-space:pre-wrap">${esc(prettyBody(res, 'json'))}</pre>` : res.body;
    return el.append(f);
  }
  if (r.view === 'visualize') {
    const vz = res.visualizer;
    if (!vz) return el.append(h(`<div class="empty">No visualization for this response.<br>Use <code>pm.visualizer.set(template, data)</code> in a post-response script.<br><span class="dim">Templates use Handlebars, e.g. <code>&lt;table&gt;{{#each rows}}&lt;tr&gt;&lt;td&gt;{{name}}&lt;/td&gt;&lt;/tr&gt;{{/each}}&lt;/table&gt;</code></span></div>`));
    const f = h(`<iframe class="preview" sandbox="allow-scripts" src="/visualizer.html" title="Visualization"></iframe>`);
    f.onload = () => f.contentWindow.postMessage({ template: vz.template, data: vz.data }, '*');
    return el.append(f);
  }
  const box = h(`<div class="editor-wrap"></div>`);
  el.append(box);
  const big = res.body.length > LARGE;
  if (big && !r.forceBig) {
    const d = h(`<div class="callout warn">Large response (${fmtSize(res.body.length)}). Showing raw text without highlighting. <button class="sm">Format anyway</button></div>`);
    d.querySelector('button').onclick = () => { r.forceBig = true; el.replaceChildren(); bodyView(tab, res, el, r); };
    el.insertBefore(d, box);
  }
  const ed = createEditor(box, { value: r.view === 'pretty' && (!big || r.forceBig) ? prettyBody(res, useLang) : res.body, language: r.view === 'pretty' && (!big || r.forceBig) ? useLang : 'plaintext', readOnly: true });
  tb.querySelector('[data-find]').onclick = () => { ed.focus(); ed.getAction('actions.find').run(); };
}

const table = rows => h(`<table class="grid"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td class="k mono">${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>`);
const cookieTable = cs => h(`<table class="grid"><thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th><th>Expires</th><th>HttpOnly</th><th>Secure</th></tr></thead><tbody>${cs.map(c => `<tr><td class="k mono">${esc(c.name)}</td><td class="mono">${esc(c.value)}</td><td>${esc(c.domain)}</td><td>${esc(c.path)}</td><td>${c.expires ? new Date(c.expires).toLocaleString() : 'Session'}</td><td>${c.httpOnly ? '✓' : ''}</td><td>${c.secure ? '✓' : ''}</td></tr>`).join('')}</tbody></table>`);

function testsView(res, r, redraw) {
  const tests = res.tests || [];
  r.testFilter ||= 'all';
  const wrap = h(`<div class="panel-body"></div>`);
  const counts = { all: tests.length, passed: tests.filter(t => t.pass).length, skipped: tests.filter(t => t.skipped).length, failed: tests.filter(t => !t.pass && !t.skipped).length };
  const seg = h(`<div class="toolbar"><div class="seg">${Object.entries(counts).map(([k, n]) => `<button data-f="${k}" class="${r.testFilter === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)} (${n})</button>`).join('')}</div></div>`);
  seg.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { r.testFilter = b.dataset.f; wrap.replaceWith(testsView(res, r, redraw)); });
  wrap.append(seg);
  for (const e of res.errors || []) wrap.append(h(`<div class="callout warn"><b>Script error in ${esc(e.location)}:</b> <span class="mono">${esc(e.message)}</span></div>`));
  const shown = tests.filter(t => r.testFilter === 'all' || (r.testFilter === 'passed' ? t.pass : r.testFilter === 'skipped' ? t.skipped : !t.pass && !t.skipped));
  if (!tests.length && !res.errors?.length) wrap.append(h(`<div class="dim" style="padding:6px 0">No tests ran. Add <code>pm.test()</code> calls in Scripts → Post-response, or ask Claude to write them.</div>`));
  for (const t of shown) wrap.append(h(`<div class="test-row"><span class="badge ${t.skipped ? 'skip' : t.pass ? 'pass' : 'fail'}">${t.skipped ? 'SKIPPED' : t.pass ? 'PASS' : 'FAIL'}</span><div>${esc(t.name)}${t.err ? `<div class="mono dim" style="font-size:12px">${esc(t.err)}</div>` : ''}</div></div>`));
  return wrap;
}

function timeline(res, el) {
  const s = res.sent || {};
  const t = res.timings || {}, total = Math.max(1, res.time || 0);
  const ttfb = Math.min(t.ttfb ?? 0, total), dl = Math.min(t.download ?? 0, total - ttfb);
  const bar = (name, left, width, ms, color) => `<div class="ph"><span>${name}</span><div class="bar"><i style="left:${left / total * 100}%;width:${Math.max(width / total * 100, 1)}%;background:${color}"></i></div><span class="ms">${ms}</span></div>`;
  el.append(h(`<div class="timing">${bar('Waiting (TTFB)', 0, ttfb, `${ttfb} ms`, 'var(--info)')}${bar('Download', ttfb, dl, `${dl} ms`, 'var(--ac)')}
    <div class="ph tot"><span>Total</span><span class="dim" style="font-size:12px">${res.redirects?.length ? `${res.redirects.length} redirect${res.redirects.length > 1 ? 's' : ''} followed` : ''}</span><span class="ms" style="font-weight:700">${fmtTime(res.time)}</span></div></div>`));
  el.append(h(`<div class="form" style="grid-template-columns:160px 1fr;margin-top:6px"><h4>Request</h4><label>URL</label><div class="mono" style="word-break:break-all">${esc(s.method)} ${esc(s.url)}</div>
    <label>Transferred</label><div>${fmtSize(res.rawSize)} <span class="dim">(${fmtSize(res.size)} decoded)</span></div></div>`));
  if (res.redirects?.length) {
    el.append(h(`<h4 class="eyebrow" style="margin:8px 0 0">Redirects</h4>`));
    el.append(h(`<table class="grid"><tbody>${res.redirects.map(r => `<tr><td class="k">${r.status}</td><td class="mono">${esc(r.from)} → ${esc(r.to)}</td></tr>`).join('')}</tbody></table>`));
  }
  el.append(h(`<h4 class="eyebrow" style="margin:8px 0 0">Request headers sent</h4>`));
  el.append(table((s.headers || []).map(([k, v]) => [k, /^authorization$/i.test(k) ? String(v).replace(/^(\S+\s+).{6}.*/, '$1••••••') : v])));
  if (s.body) { el.append(h(`<h4 class="eyebrow" style="margin:8px 0 0">Request body sent</h4>`)); el.append(h(`<pre class="mono" style="white-space:pre-wrap;word-break:break-all;margin:0">${esc(String(s.body).slice(0, 20000))}</pre>`)); }
}

export async function saveToFile(tab, res) {
  const ext = res.body == null ? (res.contentType.split('/')[1] || 'bin').split(';')[0] : { json: 'json', html: 'html', xml: 'xml', javascript: 'js' }[detectLang(res)] || 'txt';
  const name = (tab.draft?.name || 'response').replace(/[^\w.-]+/g, '_') + '.' + ext;
  const p = await api.dialogSave(res.body == null ? { name, base64: res.base64 } : { name, text: res.body });
  if (p) toast('Saved to ' + p);
}

export function saveAsExample(tab, res) {
  const f = tab.ref && find(tab.ref);
  if (!f) return toast('Save the request to a collection first, then save examples on it.', 'error');
  const ex = { id: uid(), name: `${res.status} ${res.statusText || ''}`.trim(), status: res.status, headers: res.headers.filter(([k]) => !/^(content-length|transfer-encoding|content-encoding|connection|date|set-cookie)$/i.test(k)), body: res.body ?? '', request: { method: tab.draft.method, url: tab.draft.url, query: (tab.draft.url.split('?')[1] || '') } };
  (f.node.examples ||= []).push(ex);
  (tab.draft.examples ||= []).push(clone(ex));
  saveW();
  toast('Saved example "' + ex.name + '"');
  return ex;
}
