// Postman-compatible script sandbox. Runs in a Web Worker: no access to the app, the DOM or Node.
importScripts('/node_modules/chai/chai.js', '/node_modules/lodash/lodash.min.js', '/node_modules/moment/min/moment.min.js',
  '/node_modules/crypto-js/crypto-js.js', '/node_modules/tv4/tv4.js', '/dynamic.js');
const LIB = { chai: self.chai, lodash: self._, moment: self.moment, 'crypto-js': self.CryptoJS, tv4: self.tv4, uuid: { v4: () => crypto.randomUUID() }, atob: self.atob, btoa: self.btoa };
const expect = self.chai.expect;

let pending = 0, scriptsDone = false, finished = false, finish;
const hold = () => pending++;
const release = () => { pending--; maybeFinish(); };
const maybeFinish = () => { if (scriptsDone && pending <= 0 && !finished) { finished = true; finish(); } };

// Track timers so async tests and callbacks complete before we report.
const timers = new Map();
const _setTimeout = self.setTimeout.bind(self), _clearTimeout = self.clearTimeout.bind(self);
self.setTimeout = (fn, ms, ...a) => { hold(); const id = _setTimeout(() => { timers.delete(id); try { fn(...a); } finally { release(); } }, ms); timers.set(id, 1); return id; };
self.clearTimeout = id => { if (timers.delete(id)) { _clearTimeout(id); release(); } };
self.setInterval = () => { throw new Error('setInterval is not supported in scripts'); };

const sendCallbacks = new Map();
let reqSeq = 0;

const str = x => { if (typeof x === 'string') return x; try { return JSON.stringify(x, (k, v) => typeof v === 'bigint' ? String(v) : v, 2); } catch { return String(x); } };

function listWrap(arr, readOnly) { // [{key,value,disabled?}] Postman PropertyList-ish
  const find = n => arr.find(h => !h.disabled && h.key.toLowerCase() === String(n).toLowerCase());
  return {
    get: n => find(n)?.value, has: (n, v) => { const h = find(n); return !!h && (v === undefined || h.value === v); },
    toObject: () => Object.fromEntries(arr.filter(h => !h.disabled).map(h => [h.key, h.value])),
    each: fn => arr.filter(h => !h.disabled).forEach(fn), all: () => arr.filter(h => !h.disabled), count: () => arr.filter(h => !h.disabled).length,
    one: n => find(n), idx: i => arr[i], map: fn => arr.filter(h => !h.disabled).map(fn), filter: fn => arr.filter(h => !h.disabled).filter(fn),
    add: h => { if (readOnly) throw new Error('read-only'); arr.push({ key: h.key, value: String(h.value ?? '') }); },
    upsert: h => { if (readOnly) throw new Error('read-only'); const x = find(h.key); x ? x.value = String(h.value ?? '') : arr.push({ key: h.key, value: String(h.value ?? '') }); },
    remove: n => { if (readOnly) throw new Error('read-only'); for (let i = arr.length - 1; i >= 0; i--) if (typeof n === 'function' ? n(arr[i]) : arr[i].key.toLowerCase() === String(n).toLowerCase()) arr.splice(i, 1); },
    clear: () => arr.splice(0), toString: () => arr.filter(h => !h.disabled).map(h => `${h.key}: ${h.value}`).join('\n'),
  };
}

function makeResponse(r) {
  if (!r) return undefined;
  const headers = (r.headers || []).map(([key, value]) => ({ key, value }));
  let parsed;
  const json = () => { if (parsed === undefined) parsed = JSON.parse(r.body ?? ''); return parsed; };
  const text = () => r.body ?? '';
  const cookies = (r.cookies || []).map(c => ({ key: c.name, value: c.value }));
  const res = {
    code: r.status, status: r.statusText, responseTime: r.time, responseSize: r.size, headers: listWrap(headers, true),
    cookies: listWrap(cookies, true), json, text, reason: () => r.statusText, stream: r.body, size: () => ({ body: r.size, header: r.headersSize, total: (r.size || 0) + (r.headersSize || 0) }),
  };
  const asserts = neg => {
    const ex = (v, m) => neg ? expect(v, m).to.not : expect(v, m).to;
    const ct = () => res.headers.get('content-type') || '';
    const range = (lo, hi) => ex(r.status >= lo && r.status <= hi, `expected response code ${r.status} ${neg ? 'not ' : ''}to be ${lo}-${hi}`).be.true;
    const have = {
      status: c => typeof c === 'number' ? ex(r.status, 'response status code').equal(c) : ex(r.statusText, 'response status').equal(c),
      header: (n, v) => v === undefined ? ex(res.headers.has(n), `response header "${n}"`).be.true : ex(res.headers.get(n), `response header "${n}"`).equal(v),
      body: v => v === undefined ? ex(text().length > 0, 'response body').be.true : v instanceof RegExp ? ex(text()).match(v) : ex(text()).equal(v),
      jsonBody: (p, v) => { const j = json(); if (p === undefined) ex(j !== null && typeof j === 'object', 'JSON body').be.true; else if (v === undefined) ex(LIB.lodash.has(j, p), `JSON path "${p}"`).be.true; else ex(LIB.lodash.get(j, p), `JSON path "${p}"`).eql(v); },
      jsonSchema: s => { const ok = LIB.tv4.validate(json(), s); ex(ok, ok ? 'JSON schema' : `JSON schema: ${LIB.tv4.error?.message} at "${LIB.tv4.error?.dataPath || '/'}"`).be.true; },
      responseTime: { below: ms => ex(r.time, 'response time').below(ms), above: ms => ex(r.time, 'response time').above(ms) },
      cookie: (n, v) => v === undefined ? ex(res.cookies.has(n), `cookie "${n}"`).be.true : ex(res.cookies.get(n)).equal(v),
    };
    const be = {};
    const g = (k, fn) => Object.defineProperty(be, k, { get: fn, enumerable: true });
    g('ok', () => ex(r.status, 'response status').equal(200)); g('accepted', () => ex(r.status).equal(202)); g('badRequest', () => ex(r.status).equal(400));
    g('unauthorized', () => ex(r.status).equal(401)); g('forbidden', () => ex(r.status).equal(403)); g('notFound', () => ex(r.status).equal(404)); g('rateLimited', () => ex(r.status).equal(429));
    g('info', () => range(100, 199)); g('success', () => range(200, 299)); g('redirection', () => range(300, 399)); g('clientError', () => range(400, 499)); g('serverError', () => range(500, 599)); g('error', () => range(400, 599));
    g('json', () => { ex(/json/i.test(ct()), 'content-type json').be.true; json(); }); g('html', () => ex(/html/i.test(ct()), 'content-type html').be.true); g('xml', () => ex(/xml/i.test(ct()), 'content-type xml').be.true);
    g('withBody', () => ex(text().length > 0, 'response body').be.true);
    return { have, be, has: have, a: be, an: be };
  };
  res.to = { ...asserts(false), not: asserts(true) };
  return res;
}

function makeRequest(q) {
  if (!q) return undefined;
  q.headers ||= [];
  const queryArr = () => { try { return [...new URL(q.url).searchParams].map(([key, value]) => ({ key, value })); } catch { return []; } };
  const url = {
    toString: () => q.url, getHost: () => { try { return new URL(q.url).hostname; } catch { return ''; } },
    getPath: () => { try { return new URL(q.url).pathname; } catch { return ''; } }, getQueryString: () => { try { return new URL(q.url).search.slice(1); } catch { return ''; } },
    update: u => { q.url = String(u); },
    get query() {
      const arr = queryArr();
      const w = listWrap(arr);
      const sync = () => { const u = new URL(q.url); u.search = new URLSearchParams(arr.map(x => [x.key, x.value])).toString(); q.url = u.toString(); };
      for (const k of ['add', 'upsert', 'remove', 'clear']) { const f = w[k]; w[k] = (...a) => { f(...a); sync(); }; }
      return w;
    },
  };
  const body = {
    get mode() { return q.body?.mode; }, get raw() { return q.body?.raw; }, set raw(v) { q.body.raw = v; },
    get urlencoded() { return listWrap(q.body.urlencoded ||= []); }, get formdata() { return listWrap(q.body.formdata ||= []); }, get graphql() { return q.body?.graphql; },
    update: v => { if (typeof v === 'string') { q.body.mode = q.body.mode === 'none' ? 'raw' : q.body.mode; q.body.raw = v; } else Object.assign(q.body, v); },
    toString: () => q.body?.raw || '',
  };
  return {
    get url() { return url; }, set url(u) { q.url = String(u); }, get method() { return q.method; }, set method(m) { q.method = String(m).toUpperCase(); },
    headers: listWrap(q.headers), body, name: q.name, id: q.id, auth: q.auth,
    addHeader: h => listWrap(q.headers).upsert(h), removeHeader: n => listWrap(q.headers).remove(n), upsertHeader: h => listWrap(q.headers).upsert(h),
    toJSON: () => q,
  };
}

function scope(vars, name, envName) {
  const m = () => vars[name] ||= {};
  return {
    get: k => m()[k], set: (k, v) => { m()[k] = typeof v === 'string' ? v : str(v); }, unset: k => { delete m()[k]; }, has: k => k in m(),
    clear: () => { vars[name] = {}; }, toObject: () => ({ ...m() }), toJSON: () => ({ ...m() }), name: envName,
    replaceIn: s => self.MP_DYNAMIC.resolve(s, m()),
  };
}

self.onmessage = async ({ data: msg }) => {
  if (msg.type === 'sendResult') {
    const cb = sendCallbacks.get(msg.reqId);
    sendCallbacks.delete(msg.reqId);
    try { cb?.(msg.err ? new Error(msg.err) : null, msg.res ? makeResponse(msg.res) : undefined); } finally { release(); }
    return;
  }
  if (msg.type !== 'run') return;
  const { scripts, ctx } = msg;
  const vars = ctx.vars;
  const tests = [], logs = [], errors = [];
  let nextRequest, skipRequest = false, visualizer = null;
  const req = makeRequest(ctx.request);
  const res = makeResponse(ctx.response);
  finish = () => {
    for (const [k, v] of Object.entries(legacyTests)) tests.push({ name: k, pass: !!v, err: v ? undefined : 'Assertion failed (legacy tests[] syntax)' });
    postMessage({ type: 'done', tests, logs, errors, vars, request: ctx.request, nextRequest, skipRequest, visualizer });
  };

  const record = (name, err, skipped) => tests.push({ name: String(name), pass: !err && !skipped, skipped: !!skipped, err: err ? (err.message || String(err)) : undefined });
  const test = (name, fn) => {
    if (typeof fn !== 'function') { record(name, null, true); return pm; }
    if (fn.length > 0) { // async test with done callback
      hold();
      let called = false;
      const done = err => { if (called) return; called = true; record(name, err); release(); };
      try { fn(done); } catch (e) { done(e); }
      return pm;
    }
    try {
      const p = fn();
      if (p && typeof p.then === 'function') { hold(); p.then(() => record(name), e => record(name, e)).finally(release); }
      else record(name);
    } catch (e) { record(name, e); }
    return pm;
  };
  test.skip = name => { record(name, null, true); return pm; };

  const variables = {
    get: k => ['local', 'data', 'environment', 'collection', 'globals'].map(s => vars[s]?.[k]).find(v => v !== undefined),
    set: (k, v) => { (vars.local ||= {})[k] = typeof v === 'string' ? v : str(v); }, unset: k => { delete vars.local?.[k]; },
    has: k => ['local', 'data', 'environment', 'collection', 'globals'].some(s => vars[s] && k in vars[s]),
    toObject: () => ({ ...vars.globals, ...vars.collection, ...vars.environment, ...vars.data, ...vars.local }),
    replaceIn: s => self.MP_DYNAMIC.resolve(s, variables.toObject()),
  };

  const sendRequest = (r, cb) => {
    const reqId = ++reqSeq;
    const norm = typeof r === 'string' ? { url: r, method: 'GET' } : r;
    hold();
    const p = new Promise((resolve, reject) => sendCallbacks.set(reqId, (err, response) => { if (cb) cb(err, response); err ? reject(err) : resolve(response); }));
    if (cb) p.catch(() => {});
    postMessage({ type: 'sendRequest', reqId, req: JSON.parse(JSON.stringify(norm)) });
    return cb ? undefined : p;
  };

  const consoleObj = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) consoleObj[level] = (...a) => logs.push({ level, text: a.map(str).join(' ') });

  const env = scope(vars, 'environment', ctx.envName);
  const globals = scope(vars, 'globals');
  const pm = {
    environment: env, globals, collectionVariables: scope(vars, 'collection'), variables, iterationData: { ...scope(vars, 'data'), set: () => { throw new Error('iterationData is read-only'); } },
    request: req, response: res, info: ctx.info, test, expect,
    cookies: listWrap((ctx.cookies || []).map(c => ({ key: c.name, value: c.value })), true),
    sendRequest,
    execution: { setNextRequest: n => { nextRequest = n; }, skipRequest: () => { skipRequest = true; }, location: ctx.info?.location || [] },
    setNextRequest: n => { nextRequest = n; },
    visualizer: { set: (template, data, options) => { visualizer = { template: String(template), data: JSON.parse(JSON.stringify(data ?? {})), options }; }, clear: () => { visualizer = null; } },
    require: n => { if (n in LIB) return LIB[n]; throw new Error(`Module "${n}" is not available. Available: ${Object.keys(LIB).join(', ')}`); },
  };
  const legacyTests = {};
  const postman = {
    setEnvironmentVariable: env.set, getEnvironmentVariable: env.get, clearEnvironmentVariable: env.unset,
    setGlobalVariable: globals.set, getGlobalVariable: globals.get, clearGlobalVariable: globals.unset,
    setNextRequest: n => { nextRequest = n; }, getResponseHeader: n => res?.headers.get(n), getResponseCookie: n => res?.cookies.one(n),
  };
  const legacy = {
    responseBody: ctx.response?.body ?? '', responseCode: res ? { code: res.code, name: res.status, detail: res.status } : undefined, responseTime: res?.responseTime,
    responseHeaders: res ? res.headers.toObject() : {}, environment: { ...vars.environment }, globals: { ...vars.globals }, data: { ...vars.data }, iteration: ctx.info?.iteration ?? 0,
    request: ctx.request ? { url: ctx.request.url, method: ctx.request.method, headers: Object.fromEntries((ctx.request.headers || []).map(h => [h.key, h.value])), data: ctx.request.body?.raw, name: ctx.request.name, id: ctx.request.id } : {},
  };
  const names = ['pm', 'postman', 'console', 'require', 'tests', '_', 'moment', 'CryptoJS', 'tv4', 'chai', 'xml2Json', ...Object.keys(legacy)];
  const values = [pm, postman, consoleObj, pm.require, legacyTests, LIB.lodash, LIB.moment, LIB['crypto-js'], LIB.tv4, LIB.chai, () => { throw new Error('xml2Json is not supported'); }, ...Object.values(legacy)];

  for (const s of scripts) {
    if (!s.code?.trim()) continue;
    try {
      const fn = new Function(...names, `return (async () => {\n${s.code}\n})();`);
      await fn(...values);
    } catch (e) {
      const where = /<anonymous>:(\d+)/.exec(e.stack || '');
      const msg = `${e.name || 'Error'}: ${e.message}${where ? ` (line ${where[1] - 3})` : ''}`;
      errors.push({ location: s.location, message: msg });
      logs.push({ level: 'error', text: `[${s.location}] ${msg}` });
    }
  }
  scriptsDone = true;
  maybeFinish();
};
