// Request pipeline: scripts (collection → folder → request) → build → send → test scripts → apply variables.
import { W, find, varMap, scopes, resolve, activeEnv, saveW } from './state.js';
import { bus, clone, uid, kvRow } from './ui.js';

const SCRIPT_TIMEOUT = 60000;
const MAIN_SIGNED = ['digest', 'awsv4', 'oauth1', 'jwt', 'hawk'];

export function chainOf(req, refId) {
  const f = refId && find(refId);
  return f ? f.path : [];
}

// Walk up folders/collection while auth is "inherit".
export function effectiveAuth(req, path) {
  let a = req.auth || { type: 'none' };
  for (let i = path.length - 1; a.type === 'inherit' && i >= 0; i--) a = path[i].auth || { type: 'inherit' };
  return a.type === 'inherit' ? { type: 'none' } : a;
}

const deepResolve = (o, vars) => {
  if (typeof o === 'string') return resolve(o, vars);
  if (Array.isArray(o)) return o.map(x => deepResolve(x, vars));
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepResolve(v, vars)]));
  return o;
};

export function substitutePathVars(url, pathVars, vars) {
  if (!pathVars?.length) return url;
  return url.replace(/(\/):([A-Za-z_][\w-]*)/g, (m, slash, k) => {
    const pv = pathVars.find(p => p.key === k);
    return pv && pv.value !== '' ? slash + encodeURIComponent(resolve(pv.value, vars)) : m;
  });
}

const RAW_CT = { json: 'application/json', text: 'text/plain', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript' };

export function buildHttp(req, vars, path = []) {
  const headers = (req.headers || []).filter(h => h.on !== false && h.key).map(h => [resolve(h.key, vars), resolve(h.value, vars)]);
  const has = n => headers.some(([k]) => k.toLowerCase() === n);
  let url = substitutePathVars(resolve(req.url, vars).trim(), req.pathVars, vars);
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;
  const a = deepResolve(effectiveAuth(req, path), vars);
  const addQuery = (k, v) => { try { const u = new URL(url); u.searchParams.append(k, v); url = u.toString(); } catch {} };
  let mainAuth;
  switch (a.type) {
    case 'bearer': if (a.token) headers.push(['Authorization', `Bearer ${a.token}`]); break;
    case 'basic': headers.push(['Authorization', 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${a.username ?? a.user ?? ''}:${a.password ?? a.pass ?? ''}`)))]); break;
    case 'apikey': if (a.key) a.in === 'query' ? addQuery(a.key, a.value || '') : headers.push([a.key, a.value || '']); break;
    case 'oauth2': if (a.accessToken) a.addTo === 'query' ? addQuery('access_token', a.accessToken) : headers.push([a.headerName || 'Authorization', `${a.headerPrefix ?? 'Bearer'} ${a.accessToken}`.trim()]); break;
    default: if (MAIN_SIGNED.includes(a.type)) mainAuth = a;
  }
  const b = req.body || { mode: 'none' };
  let body = null, bodyKind = 'text', form, binaryPath;
  if (b.mode === 'raw') { body = resolve(b.raw, vars); if (!has('content-type')) headers.push(['Content-Type', RAW_CT[b.lang] || 'text/plain']); }
  if (b.mode === 'urlencoded') {
    body = new URLSearchParams((b.urlencoded || []).filter(x => x.on !== false && x.key).map(x => [resolve(x.key, vars), resolve(x.value, vars)])).toString();
    if (!has('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  if (b.mode === 'formdata') {
    bodyKind = 'form';
    form = (b.formdata || []).filter(x => x.on !== false && x.key).map(x => ({ key: resolve(x.key, vars), value: x.type === 'file' ? x.value : resolve(x.value, vars), type: x.type || 'text', contentType: x.contentType }));
  }
  if (b.mode === 'binary') { bodyKind = 'binary'; binaryPath = b.binary; if (!has('content-type')) headers.push(['Content-Type', 'application/octet-stream']); }
  if (b.mode === 'graphql') {
    let variables;
    try { variables = b.graphql?.variables?.trim() ? JSON.parse(resolve(b.graphql.variables, vars)) : undefined; } catch { throw new Error('GraphQL variables are not valid JSON'); }
    body = JSON.stringify({ query: resolve(b.graphql?.query || '', vars), ...(variables ? { variables } : {}), ...(b.graphql?.operationName ? { operationName: b.graphql.operationName } : {}) });
    if (!has('content-type')) headers.push(['Content-Type', 'application/json']);
  }
  if (W.settings.sendNoCache && !has('cache-control')) headers.push(['Cache-Control', 'no-cache']);
  const s = req.settings || {};
  return {
    method: (req.method || 'GET').toUpperCase(), url, headers, body, bodyKind, form, binaryPath, auth: mainAuth,
    settings: { timeout: s.timeout ?? W.settings.timeout, followRedirects: s.followRedirects ?? W.settings.followRedirects, maxRedirects: s.maxRedirects ?? W.settings.maxRedirects, sslVerify: s.sslVerify ?? W.settings.sslVerify, disableCookies: s.disableCookies, keepAuthOnRedirect: s.keepAuthOnRedirect },
  };
}

// ---------- scripts ----------
const toScriptReq = req => ({
  id: req.id, name: req.name, url: req.url, method: req.method,
  headers: (req.headers || []).filter(h => h.key).map(h => ({ key: h.key, value: h.value, disabled: h.on === false })),
  body: req.body ? { mode: req.body.mode, raw: req.body.raw, urlencoded: (req.body.urlencoded || []).map(x => ({ key: x.key, value: x.value, disabled: x.on === false })), formdata: req.body.formdata, graphql: req.body.graphql } : { mode: 'none' },
  auth: req.auth,
});
const fromScriptReq = (req, q) => {
  req.url = q.url; req.method = q.method;
  req.headers = q.headers.map(h => kvRow(h.key, h.value, { on: !h.disabled }));
  if (req.body && q.body) { req.body.raw = q.body.raw; if (q.body.mode) req.body.mode = q.body.mode === 'raw' && req.body.mode === 'none' ? 'raw' : req.body.mode; req.body.urlencoded = (q.body.urlencoded || []).map(x => kvRow(x.key, x.value, { on: !x.disabled })); }
};

function sendFromScript(r) {
  const headers = Array.isArray(r.header) ? r.header.map(h => [h.key, h.value]) : Object.entries(r.header || {});
  let body = null, bodyKind = 'text', form;
  if (r.body?.mode === 'raw') body = typeof r.body.raw === 'string' ? r.body.raw : JSON.stringify(r.body.raw);
  if (r.body?.mode === 'urlencoded') { body = new URLSearchParams((r.body.urlencoded || []).map(x => [x.key, x.value])).toString(); if (!headers.some(([k]) => /^content-type$/i.test(k))) headers.push(['Content-Type', 'application/x-www-form-urlencoded']); }
  if (r.body?.mode === 'formdata') { bodyKind = 'form'; form = (r.body.formdata || []).map(x => ({ key: x.key, value: x.value, type: x.type || 'text' })); }
  return api.httpSend({ id: uid(), method: (r.method || 'GET').toUpperCase(), url: r.url, headers, body, bodyKind, form, settings: {} });
}

export function runScripts(scripts, ctx) {
  if (!scripts.some(s => s.code?.trim())) return Promise.resolve(null);
  return new Promise(res => {
    const w = new Worker('/script-worker.js');
    const timer = setTimeout(() => { w.terminate(); res({ tests: [], logs: [{ level: 'error', text: `Script timed out after ${SCRIPT_TIMEOUT / 1000}s` }], errors: [{ location: ctx.info.eventName, message: 'Script timed out' }], vars: ctx.vars, request: ctx.request }); }, SCRIPT_TIMEOUT);
    w.onmessage = async ({ data }) => {
      if (data.type === 'sendRequest') {
        const r = await sendFromScript(data.req);
        log({ type: 'http', text: `${(data.req.method || 'GET').toUpperCase()} ${data.req.url} → ${r.ok ? r.status : r.error} (pm.sendRequest)`, detail: { request: r.sent, response: r } });
        w.postMessage({ type: 'sendResult', reqId: data.reqId, err: r.ok ? null : r.error, res: r.ok ? r : null });
      }
      if (data.type === 'done') { clearTimeout(timer); w.terminate(); res(data); }
    };
    w.onerror = e => { clearTimeout(timer); w.terminate(); res({ tests: [], logs: [{ level: 'error', text: e.message }], errors: [{ location: 'sandbox', message: e.message }], vars: ctx.vars, request: ctx.request }); };
    w.postMessage({ type: 'run', scripts, ctx: JSON.parse(JSON.stringify(ctx)) });
  });
}

function applyRows(rows, before, after) {
  let changed = false;
  for (const [k, v] of Object.entries(after || {})) {
    if (before[k] === v) continue;
    const r = rows.find(x => x.key === k);
    r ? Object.assign(r, { value: v, on: true }) : rows.push(kvRow(k, v));
    changed = true;
  }
  for (const k of Object.keys(before)) if (!(k in (after || {}))) { const i = rows.findIndex(x => x.key === k); if (i >= 0) { rows.splice(i, 1); changed = true; } }
  return changed;
}
function applyVars(colId, before, after) {
  let changed = applyRows(W.globals, before.globals, after.globals);
  const col = W.collections.find(c => c.id === colId);
  if (col) changed = applyRows(col.vars ||= [], before.collection, after.collection) || changed;
  const env = activeEnv();
  if (env) changed = applyRows(env.vars, before.environment, after.environment) || changed;
  else if (Object.keys(after.environment || {}).length) log({ type: 'warn', text: 'A script set an environment variable but no environment is selected — value discarded.' });
  if (changed) { saveW(); bus.emit('vars'); }
}

// ---------- console ----------
export const log = entry => bus.emit('log', { ts: Date.now(), ...entry });

// ---------- the pipeline ----------
// opts: { refId, data, iteration, iterationCount, local, signalId, scriptsOnly }
export async function execute(reqIn, opts = {}) {
  const req = clone(reqIn);
  const path = chainOf(req, opts.refId);
  const colId = path[0]?.id;
  const local = { ...(opts.local || {}) };
  const s0 = scopes(colId);
  const info = { requestName: req.name, requestId: req.id, iteration: opts.iteration ?? 0, iterationCount: opts.iterationCount ?? 1, location: [...path.map(p => p.name), req.name] };
  const result = { tests: [], logs: [], errors: [] };
  const merge = r => { if (!r) return; result.tests.push(...r.tests); result.logs.push(...r.logs); result.errors.push(...(r.errors || [])); if (r.nextRequest !== undefined) result.nextRequest = r.nextRequest; if (r.visualizer) result.visualizer = r.visualizer; };
  const envName = activeEnv()?.name;

  const pre = await runScripts(
    [...path.map(p => ({ code: p.pre, location: `${p.name} (pre-request)` })), { code: req.pre, location: 'pre-request' }],
    { request: toScriptReq(req), vars: { ...clone(s0), data: opts.data || {}, local }, info: { ...info, eventName: 'prerequest' }, envName },
  );
  if (pre) {
    merge(pre);
    fromScriptReq(req, pre.request);
    applyVars(colId, s0, pre.vars);
    Object.assign(local, pre.vars.local);
    pre.logs.forEach(l => log({ type: l.level === 'log' ? 'log' : l.level, text: l.text }));
  }
  if (pre?.skipRequest) return { ...result, ok: false, skipped: true, error: 'Request skipped by pm.execution.skipRequest()', time: 0 };

  let payload;
  try {
    payload = buildHttp(req, varMap(colId, { data: opts.data, local }), path);
    if (!payload.url || payload.url === 'http://') throw new Error('Enter a request URL');
    new URL(payload.url);
  } catch (e) { return { ...result, ok: false, error: e.message, time: 0 }; }
  payload.id = opts.signalId || uid();
  const res = await api.httpSend(payload);
  log({ type: res.ok ? 'http' : 'error', text: `${payload.method} ${res.url || payload.url} → ${res.ok ? `${res.status} ${res.statusText} · ${res.time} ms` : res.error}`, detail: { request: res.sent || payload, response: res.ok ? res : null, redirects: res.redirects } });

  if (res.ok) {
    const s1 = scopes(colId);
    const post = await runScripts(
      [...path.map(p => ({ code: p.tests, location: `${p.name} (tests)` })), { code: req.tests, location: 'tests' }],
      { request: toScriptReq(req), response: res, cookies: res.cookies, vars: { ...clone(s1), data: opts.data || {}, local }, info: { ...info, eventName: 'test' }, envName },
    );
    if (post) {
      merge(post);
      applyVars(colId, s1, post.vars);
      post.logs.forEach(l => log({ type: l.level === 'log' ? 'log' : l.level, text: l.text }));
    }
  }
  if (!opts.noHistory && W.settings.history?.enabled !== false) {
    W.history.unshift({ id: uid(), at: Date.now(), status: res.ok ? res.status : 'ERR', time: res.time, req: clone(reqIn) });
    W.history.length = Math.min(W.history.length, W.settings.history?.max || 500);
    saveW();
    bus.emit('history');
  }
  return { ...res, ...result, finalRequest: req };
}
