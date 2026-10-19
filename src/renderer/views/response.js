// HTTP response viewer.
import { h, esc, icon, fmtSize, fmtTime, toast, menuFor, uid, clone } from '../ui.js';
import { createEditor, focusedEditor } from '../editor.js';
import { rt, markDirty } from '../tabs.js';
import { find, saveW } from '../state.js';

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

export function renderResponse(tab, el, { onAskAi, onSaveExample, onDisableSsl } = {}) {
  const r = rt(tab);
  const res = r.res;
  el.replaceChildren();
  if (r.loading) {
    const d = h(`<div class="empty"><div class="spin" style="width:22px;height:22px"></div><div class="big" style="margin-top:10px">Sending request…</div><button style="margin-top:8px">Cancel</button></div>`);
    d.querySelector('button').onclick = () => r.cancel?.();
    return el.append(d);
  }
  if (!res) return el.append(h(`<div class="empty">${icon('send', '').replace('class="i ', 'style="width:46px;height:46px;opacity:.35" class="i ')}<div class="big">Enter the URL and click Send to get a response</div><div><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to send · <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Enter</kbd> to send and download</div></div>`));
  if (!res.ok) {
    const d = h(`<div class="empty"><div class="big s4">${res.skipped ? 'Request skipped' : res.cancelled ? 'Request cancelled' : 'Could not send request'}</div><div class="mono" style="max-width:640px;white-space:pre-wrap">${esc(res.error)}</div>${res.code ? `<div class="dim">${esc(res.code)}</div>` : ''}<div class="row-flex" style="justify-content:center;margin-top:10px"><button data-ai>${icon('spark')} Ask Claude why</button></div></div>`);
    d.querySelector('[data-ai]').onclick = () => onAskAi?.('debug');
    // Like Postman: certificate problems (expired, self-signed, wrong host) get a one-click way around.
    if (TLS_ERRORS.test(res.code || '') && onDisableSsl) {
      const ssl = h(`<div class="callout warn" style="max-width:640px;margin-top:12px;text-align:left">The server's TLS certificate failed verification, so no request was sent. If you trust this server (e.g. a local or dev environment), turn off SSL certificate verification and retry.
        <div class="row-flex" style="margin-top:8px"><button class="primary" data-ssl="all">Disable SSL verification &amp; retry</button><button data-ssl="one">Only for this request</button></div></div>`);
      ssl.querySelectorAll('[data-ssl]').forEach(b => b.onclick = () => onDisableSsl(b.dataset.ssl));
      d.append(ssl);
    }
    el.append(d);
    if (res.tests?.length || res.errors?.length) el.append(testsView(res, r));
    return;
  }
  r.resTab ||= 'body';
  const tests = res.tests || [];
  const passed = tests.filter(t => t.pass).length;
  const failed = tests.filter(t => !t.pass && !t.skipped).length;
  const cls = 's' + String(res.status)[0];
  const head = h(`<div class="subtabs">
    <button class="st" data-t="body">Body</button>
    <button class="st" data-t="cookies">Cookies${res.cookies?.length ? ` <span class="cnt">(${res.cookies.length})</span>` : ''}</button>
    <button class="st" data-t="headers">Headers <span class="cnt">(${res.headers.length})</span></button>
    <button class="st" data-t="tests">Test Results${tests.length ? ` <span class="cnt" style="color:${failed ? 'var(--bad)' : 'var(--ok)'}">(${passed}/${tests.length})</span>` : ''}${res.errors?.length ? ' <span class="flag" style="background:var(--bad)"></span>' : ''}</button>
    <button class="st" data-t="timeline">Timeline</button>
    <span class="sp"></span>
    <div class="resbar">
      <span class="pill ${cls}" title="${esc(STATUS_HINT[res.status] || res.statusText)}">${res.status} ${esc(res.statusText)}</span>
      <span title="Time to first byte: ${res.timings?.ttfb} ms&#10;Download: ${res.timings?.download} ms${res.redirects?.length ? `&#10;Redirects: ${res.redirects.length}` : ''}">${fmtTime(res.time)}</span>
      <span title="Body: ${fmtSize(res.size)} (transferred ${fmtSize(res.rawSize)})&#10;Headers: ${fmtSize(res.headersSize)}">${fmtSize(res.size + (res.headersSize || 0))}</span>
      <button class="ghost sm" data-save title="Save response">${icon('download')}</button>
      <button class="ghost sm" data-clear title="Clear response">${icon('x')}</button>
    </div></div>`);
  head.querySelectorAll('[data-t]').forEach(b => { b.classList.toggle('on', b.dataset.t === r.resTab); b.onclick = () => { r.resTab = b.dataset.t; renderResponse(tab, el, { onAskAi, onSaveExample }); }; });
  head.querySelector('[data-clear]').onclick = () => { r.res = null; renderResponse(tab, el, { onAskAi, onSaveExample }); };
  head.querySelector('[data-save]').onclick = e => menuFor(e.currentTarget, [
    { label: 'Save to a file', icon: 'download', run: () => saveToFile(tab, res) },
    { label: 'Save as example', icon: 'file', run: () => onSaveExample?.() },
    { label: 'Copy body', icon: 'copy', run: () => { navigator.clipboard.writeText(res.body ?? ''); toast('Copied'); } },
  ]);
  el.append(head);
  const body = h(`<div class="panel-body"></div>`);
  el.append(body);
  if (r.resTab === 'body') bodyView(tab, res, body, r);
  if (r.resTab === 'headers') body.append(table(res.headers));
  if (r.resTab === 'cookies') body.append(res.cookies?.length ? cookieTable(res.cookies) : h(`<div class="empty">No cookies were set by this response.<br><span class="dim">All stored cookies are in the Cookies manager (status bar).</span></div>`));
  if (r.resTab === 'tests') body.replaceWith(testsView(res, r));
  if (r.resTab === 'timeline') timeline(res, body);
}

function bodyView(tab, res, el, r) {
  const lang = detectLang(res);
  r.view ||= 'pretty';
  r.lang ||= null;
  const useLang = r.lang || lang;
  const tb = h(`<div class="toolbar"><div class="seg">${['pretty', 'raw', 'preview', 'visualize'].map(v => `<button data-v="${v}" class="${r.view === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
    ${r.view === 'pretty' ? `<select class="sm" data-lang style="padding:2px 6px">${[['json', 'JSON'], ['xml', 'XML'], ['html', 'HTML'], ['javascript', 'JavaScript'], ['plaintext', 'Text']].map(([v, l]) => `<option value="${v}" ${v === useLang ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
    <span class="sp"></span><button class="ghost sm" data-find title="Search (in editor: Ctrl+F)">${icon('search')}</button><button class="ghost sm" data-copy title="Copy">${icon('copy')}</button></div>`);
  tb.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { r.view = b.dataset.v; el.replaceChildren(); bodyView(tab, res, el, r); });
  tb.querySelector('[data-lang]')?.addEventListener('change', e => { r.lang = e.target.value; el.replaceChildren(); bodyView(tab, res, el, r); });
  tb.querySelector('[data-copy]').onclick = () => { navigator.clipboard.writeText(res.body ?? ''); toast('Copied'); };
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

function testsView(res, r) {
  const tests = res.tests || [];
  r.testFilter ||= 'all';
  const wrap = h(`<div class="panel-body"></div>`);
  const counts = { all: tests.length, passed: tests.filter(t => t.pass).length, skipped: tests.filter(t => t.skipped).length, failed: tests.filter(t => !t.pass && !t.skipped).length };
  const seg = h(`<div class="toolbar"><div class="seg">${Object.entries(counts).map(([k, n]) => `<button data-f="${k}" class="${r.testFilter === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)} (${n})</button>`).join('')}</div></div>`);
  seg.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { r.testFilter = b.dataset.f; wrap.replaceWith(testsView(res, r)); });
  wrap.append(seg);
  for (const e of res.errors || []) wrap.append(h(`<div class="callout warn"><b>Script error in ${esc(e.location)}:</b> <span class="mono">${esc(e.message)}</span></div>`));
  const shown = tests.filter(t => r.testFilter === 'all' || (r.testFilter === 'passed' ? t.pass : r.testFilter === 'skipped' ? t.skipped : !t.pass && !t.skipped));
  if (!tests.length && !res.errors?.length) wrap.append(h(`<div class="empty">No tests for this request.<br><span class="dim">Write them in Scripts → Post-response, or ask Claude to write them.</span></div>`));
  for (const t of shown) wrap.append(h(`<div class="test-row"><span class="badge ${t.skipped ? 'skip' : t.pass ? 'pass' : 'fail'}">${t.skipped ? 'SKIPPED' : t.pass ? 'PASS' : 'FAIL'}</span><div>${esc(t.name)}${t.err ? `<div class="mono dim" style="font-size:12px">${esc(t.err)}</div>` : ''}</div></div>`));
  if (res.logs?.length) wrap.append(h(`<div class="dim" style="font-size:12px;margin-top:6px">${res.logs.length} console message(s) — open the Console (Ctrl+Alt+C).</div>`));
  return wrap;
}

function timeline(res, el) {
  const s = res.sent || {};
  el.append(h(`<div class="form" style="grid-template-columns:160px 1fr"><h4>Request</h4><label>URL</label><div class="mono" style="word-break:break-all">${esc(s.method)} ${esc(s.url)}</div>
    <label>Total time</label><div>${fmtTime(res.time)} <span class="dim">(TTFB ${res.timings?.ttfb} ms · download ${res.timings?.download} ms)</span></div>
    <label>Transferred</label><div>${fmtSize(res.rawSize)} <span class="dim">(${fmtSize(res.size)} decoded)</span></div></div>`));
  if (res.redirects?.length) {
    el.append(h(`<h4 class="dim" style="margin:8px 0 0;font-size:12px;text-transform:uppercase">Redirects</h4>`));
    el.append(h(`<table class="grid"><tbody>${res.redirects.map(r => `<tr><td class="k">${r.status}</td><td class="mono">${esc(r.from)} → ${esc(r.to)}</td></tr>`).join('')}</tbody></table>`));
  }
  el.append(h(`<h4 class="dim" style="margin:8px 0 0;font-size:12px;text-transform:uppercase">Request headers sent</h4>`));
  el.append(table((s.headers || []).map(([k, v]) => [k, /^authorization$/i.test(k) ? String(v).replace(/^(\S+\s+).{6}.*/, '$1••••••') : v])));
  if (s.body) { el.append(h(`<h4 class="dim" style="margin:8px 0 0;font-size:12px;text-transform:uppercase">Request body sent</h4>`)); el.append(h(`<pre class="mono" style="white-space:pre-wrap;word-break:break-all;margin:0">${esc(String(s.body).slice(0, 20000))}</pre>`)); }
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
