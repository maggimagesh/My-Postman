// Import / export: Postman v2.0/v2.1 collections, environments & globals, OpenAPI 3, Swagger 2, HAR, Insomnia v4, cURL, app backups.
import yaml from '/node_modules/js-yaml/dist/js-yaml.mjs';
import { W, newItem, saveW, flatRequests } from './state.js';
import { uid, kvRow } from './ui.js';

// ---------- cURL ----------
export function parseCurl(cmd) {
  const toks = [];
  cmd.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ').replace(/\s*(?:\$'((?:\\.|[^'])*)'|'([^']*)'|"((?:\\.|[^"])*)"|(\S+))/g, (_, ansi, sq, dq, bare) => {
    toks.push(ansi !== undefined ? ansi.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1') : sq ?? (dq !== undefined ? dq.replace(/\\(["\\$`])/g, '$1') : bare));
  });
  if (!/^curl$/i.test(toks[0] || '')) throw new Error('Not a cURL command');
  const r = newItem('http');
  const data = [], form = [];
  let explicitMethod = false, getMode = false;
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    const next = () => toks[++i] ?? '';
    const long = t.startsWith('--') && t.includes('=') ? [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] : null;
    const flag = long ? long[0] : t;
    const val = () => long ? long[1] : next();
    if (flag === '-X' || flag === '--request') { r.method = val().toUpperCase(); explicitMethod = true; }
    else if (/^-X[A-Z]+$/.test(t)) { r.method = t.slice(2); explicitMethod = true; }
    else if (flag === '-H' || flag === '--header') { const v = val(), j = v.indexOf(':'); if (j > 0) r.headers.push(kvRow(v.slice(0, j).trim(), v.slice(j + 1).trim())); }
    else if (/^(-d|--data|--data-raw|--data-binary|--data-ascii)$/.test(flag)) data.push(val());
    else if (flag === '--data-urlencode') { const v = val(); const j = v.indexOf('='); data.push(j > 0 ? v.slice(0, j) + '=' + encodeURIComponent(v.slice(j + 1)) : encodeURIComponent(v)); }
    else if (flag === '--json') { data.push(val()); if (!r.headers.some(h => /content-type/i.test(h.key))) r.headers.push(kvRow('Content-Type', 'application/json')); }
    else if (flag === '-F' || flag === '--form' || flag === '--form-string') { const v = val(), j = v.indexOf('='); const value = v.slice(j + 1); form.push(value.startsWith('@') && flag !== '--form-string' ? { on: true, key: v.slice(0, j), value: value.slice(1).split(';')[0], type: 'file' } : { on: true, key: v.slice(0, j), value, type: 'text' }); }
    else if (flag === '-u' || flag === '--user') { const [u, ...p] = val().split(':'); r.auth = { type: 'basic', username: u, password: p.join(':') }; }
    else if (flag === '-A' || flag === '--user-agent') r.headers.push(kvRow('User-Agent', val()));
    else if (flag === '-b' || flag === '--cookie') r.headers.push(kvRow('Cookie', val()));
    else if (flag === '-e' || flag === '--referer') r.headers.push(kvRow('Referer', val()));
    else if (flag === '-I' || flag === '--head') { r.method = 'HEAD'; explicitMethod = true; }
    else if (flag === '-G' || flag === '--get') getMode = true;
    else if (flag === '--url') r.url = val();
    else if (flag === '-k' || flag === '--insecure') r.settings.sslVerify = false;
    else if (flag === '-L' || flag === '--location') r.settings.followRedirects = true;
    else if (flag === '--compressed' || flag === '-s' || flag === '--silent' || flag === '-v' || flag === '-i') { /* no-op */ }
    else if (/^-(o|w|m|x|E|T|--output|--max-time|--connect-timeout|--proxy|--cert|--key|--cacert)$/.test(flag)) val();
    else if (t === '\\') continue; // line continuation whose newline was lost
    else if (!t.startsWith('-')) r.url = t;
  }
  if (getMode && data.length) { r.url += (r.url.includes('?') ? '&' : '?') + data.join('&'); data.length = 0; }
  if (data.length) {
    if (!explicitMethod) r.method = 'POST';
    const raw = data.join('&');
    const ct = r.headers.find(h => /^content-type$/i.test(h.key))?.value || '';
    if (/json/.test(ct) || (!ct && /^\s*[[{]/.test(raw))) Object.assign(r.body, { mode: 'raw', lang: 'json', raw: prettyJson(raw) });
    else if (!ct || /x-www-form-urlencoded/.test(ct)) { r.body.mode = 'urlencoded'; r.body.urlencoded = [...new URLSearchParams(raw)].map(([k, v]) => kvRow(k, v)); if (ct) r.headers = r.headers.filter(h => !/^content-type$/i.test(h.key)); }
    else Object.assign(r.body, { mode: 'raw', lang: /xml/.test(ct) ? 'xml' : /html/.test(ct) ? 'html' : 'text', raw });
  }
  if (form.length) { r.body.mode = 'formdata'; r.body.formdata = form; if (!explicitMethod) r.method = 'POST'; }
  r.name = (r.url.replace(/^\w+:\/\//, '').split('?')[0] || 'cURL request').slice(0, 60);
  syncParams(r);
  return r;
}
const prettyJson = s => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
function syncParams(r) {
  const qi = r.url.indexOf('?');
  r.params = qi < 0 ? [] : r.url.slice(qi + 1).split('&').filter(Boolean).map(p => { const i = p.indexOf('='); return kvRow(i < 0 ? p : p.slice(0, i), i < 0 ? '' : p.slice(i + 1)); });
  const path = (qi < 0 ? r.url : r.url.slice(0, qi)).replace(/^[a-z]+:\/\/[^/]*/i, '');
  r.pathVars = [...path.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map(m => kvRow(m[1], r.pathVars?.find(p => p.key === m[1])?.value || ''));
}

// ---------- Postman auth mapping ----------
const AUTH_MAP = {
  bearer: { token: 'token' }, basic: { username: 'username', password: 'password' }, apikey: { key: 'key', value: 'value', in: 'in' },
  digest: { username: 'username', password: 'password', algorithm: 'algorithm' },
  oauth1: { consumerKey: 'consumerKey', consumerSecret: 'consumerSecret', token: 'token', tokenSecret: 'tokenSecret', signatureMethod: 'signatureMethod', realm: 'realm', callback: 'callback', verifier: 'verifier', privateKey: 'privateKey' },
  oauth2: { accessToken: 'accessToken', headerPrefix: 'headerPrefix', authUrl: 'authUrl', tokenUrl: 'accessTokenUrl', clientId: 'clientId', clientSecret: 'clientSecret', scope: 'scope', state: 'state', callbackUrl: 'redirect_uri', username: 'username', password: 'password', codeVerifier: 'code_verifier', tokenName: 'tokenName', audience: 'audience' },
  hawk: { authId: 'authId', authKey: 'authKey', algorithm: 'algorithm', ext: 'extraData', app: 'app', dlg: 'delegation', includePayloadHash: 'includePayloadHash' },
  awsv4: { accessKey: 'accessKey', secretKey: 'secretKey', region: 'region', service: 'service', sessionToken: 'sessionToken' },
  jwt: { algorithm: 'algorithm', secret: 'secret', secretBase64: 'isSecretBase64Encoded', privateKey: 'privateKey', payload: 'payload', headers: 'header', prefix: 'headerPrefix', queryParam: 'queryParamKey' },
};
const GRANT = { authorization_code: 'authorization_code', authorization_code_with_pkce: 'authorization_code_pkce', implicit: 'implicit', password_credentials: 'password', client_credentials: 'client_credentials' };
function authFromPostman(a) {
  if (!a) return { type: 'inherit' };
  if (a.type === 'noauth') return { type: 'none' };
  const vals = Array.isArray(a[a.type]) ? Object.fromEntries(a[a.type].map(x => [x.key, x.value])) : a[a.type] || {};
  const out = { type: a.type };
  for (const [ours, theirs] of Object.entries(AUTH_MAP[a.type] || {})) if (vals[theirs] !== undefined) out[ours] = typeof vals[theirs] === 'object' && ours !== 'secretBase64' && ours !== 'includePayloadHash' ? JSON.stringify(vals[theirs]) : vals[theirs];
  if (a.type === 'oauth2') { out.grantType = GRANT[vals.grant_type] || 'authorization_code'; out.addTo = vals.addTokenTo === 'queryParams' ? 'query' : 'header'; out.clientAuth = vals.client_authentication === 'body' ? 'body' : 'header'; out.challengeMethod = vals.challengeAlgorithm === 'plain' ? 'plain' : 'S256'; }
  if (a.type === 'oauth1') out.addTo = vals.addParamsToHeader === false ? 'query' : 'header';
  if (a.type === 'jwt') out.addTo = vals.addTokenTo === 'queryParam' ? 'query' : 'header';
  if (!AUTH_MAP[a.type]) return { type: 'none' };
  return out;
}
function authToPostman(a) {
  if (!a || a.type === 'inherit') return undefined;
  if (a.type === 'none') return { type: 'noauth' };
  const vals = [];
  for (const [ours, theirs] of Object.entries(AUTH_MAP[a.type] || {})) if (a[ours] !== undefined && a[ours] !== '') vals.push({ key: theirs, value: a[ours], type: typeof a[ours] === 'boolean' ? 'boolean' : 'string' });
  if (a.type === 'oauth2') { vals.push({ key: 'grant_type', value: Object.entries(GRANT).find(([, v]) => v === a.grantType)?.[0] || 'authorization_code', type: 'string' }, { key: 'addTokenTo', value: a.addTo === 'query' ? 'queryParams' : 'header', type: 'string' }, { key: 'client_authentication', value: a.clientAuth || 'header', type: 'string' }); }
  if (a.type === 'oauth1') vals.push({ key: 'addParamsToHeader', value: a.addTo !== 'query', type: 'boolean' });
  if (a.type === 'jwt') vals.push({ key: 'addTokenTo', value: a.addTo === 'query' ? 'queryParam' : 'header', type: 'string' });
  return { type: a.type, [a.type]: vals };
}

// ---------- Postman collection ----------
const desc = d => typeof d === 'string' ? d : d?.content || '';
const scriptOf = (events, listen) => [].concat((events || []).find(e => e.listen === listen)?.script?.exec || []).join('\n');
const kvFrom = rows => (rows || []).filter(x => x && x.key !== undefined).map(x => kvRow(x.key, x.value ?? '', { on: !x.disabled, desc: desc(x.description) || undefined }));

function urlFromPostman(u) {
  if (!u) return '';
  if (typeof u === 'string') return u;
  if (u.raw) return u.raw;
  const host = [].concat(u.host || []).join('.');
  const p = [].concat(u.path || []).join('/');
  const q = (u.query || []).filter(x => !x.disabled).map(x => x.value == null ? x.key : `${x.key}=${x.value}`).join('&');
  return `${u.protocol ? u.protocol + '://' : ''}${host}${u.port ? ':' + u.port : ''}${p ? '/' + p : ''}${q ? '?' + q : ''}`;
}

function requestFromPostman(it) {
  const pr = typeof it.request === 'string' ? { url: it.request, method: 'GET' } : it.request || {};
  const r = newItem('http');
  r.name = it.name || 'Request';
  r.method = (pr.method || 'GET').toUpperCase();
  r.url = urlFromPostman(pr.url);
  syncParams(r);
  if (typeof pr.url === 'object') {
    for (const q of pr.url.query || []) { if (q.disabled) r.params.push(kvRow(q.key, q.value ?? '', { on: false })); const p = r.params.find(x => x.key === q.key); if (p && q.description) p.desc = desc(q.description); }
    for (const v of pr.url.variable || []) { const pv = r.pathVars.find(p => p.key === v.key); if (pv) { pv.value = v.value ?? ''; pv.desc = desc(v.description) || undefined; } }
  }
  r.headers = kvFrom(pr.header);
  const b = pr.body;
  if (b?.mode === 'raw') { const lang = b.options?.raw?.language; Object.assign(r.body, { mode: 'raw', raw: b.raw || '', lang: ['json', 'xml', 'html', 'javascript', 'text'].includes(lang) ? lang : /^\s*[[{]/.test(b.raw || '') ? 'json' : 'text' }); }
  if (b?.mode === 'urlencoded') Object.assign(r.body, { mode: 'urlencoded', urlencoded: kvFrom(b.urlencoded) });
  if (b?.mode === 'formdata') Object.assign(r.body, { mode: 'formdata', formdata: (b.formdata || []).map(x => ({ on: !x.disabled, key: x.key, value: x.type === 'file' ? x.src || '' : x.value ?? '', type: x.type === 'file' ? 'file' : 'text', contentType: x.contentType })) });
  if (b?.mode === 'file') Object.assign(r.body, { mode: 'binary', binary: b.file?.src || '' });
  if (b?.mode === 'graphql') { r.kind = 'graphql'; Object.assign(r.body, { mode: 'graphql', graphql: { query: b.graphql?.query || '', variables: b.graphql?.variables || '' } }); }
  r.auth = authFromPostman(pr.auth);
  r.pre = scriptOf(it.event, 'prerequest');
  r.tests = scriptOf(it.event, 'test');
  r.description = desc(pr.description);
  const pb = it.protocolProfileBehavior || {};
  if (pb.followRedirects !== undefined) r.settings.followRedirects = pb.followRedirects;
  if (pb.strictSSL !== undefined) r.settings.sslVerify = pb.strictSSL;
  if (pb.disableCookies !== undefined) r.settings.disableCookies = pb.disableCookies;
  if (pb.maxRedirects !== undefined) r.settings.maxRedirects = pb.maxRedirects;
  r.examples = (it.response || []).map(x => ({ id: uid(), name: x.name || `${x.code} ${x.status || ''}`.trim(), status: x.code || 200, headers: (x.header || []).map(h => [h.key, h.value]), body: x.body || '', request: { method: r.method, url: urlFromPostman(x.originalRequest?.url) || r.url } }));
  return r;
}
function itemFromPostman(it) {
  if (Array.isArray(it.item)) return { ...newItem('folder'), name: it.name || 'Folder', items: it.item.map(itemFromPostman), auth: authFromPostman(it.auth), pre: scriptOf(it.event, 'prerequest'), tests: scriptOf(it.event, 'test'), description: desc(it.description), open: false };
  return requestFromPostman(it);
}
export function fromPostmanCollection(j) {
  const c = newItem('collection');
  Object.assign(c, {
    name: j.info?.name || 'Imported collection', description: desc(j.info?.description), items: (j.item || []).map(itemFromPostman),
    vars: (j.variable || []).map(v => kvRow(v.key, v.value ?? '', { on: !v.disabled })), auth: j.auth ? authFromPostman(j.auth) : { type: 'none' },
    pre: scriptOf(j.event, 'prerequest'), tests: scriptOf(j.event, 'test'), open: true,
  });
  return c;
}

const kvTo = rows => (rows || []).filter(x => x.key).map(x => ({ key: x.key, value: x.value, ...(x.on === false ? { disabled: true } : {}), ...(x.desc ? { description: x.desc } : {}) }));
const events = n => [n.pre?.trim() && { listen: 'prerequest', script: { type: 'text/javascript', exec: n.pre.split('\n') } }, n.tests?.trim() && { listen: 'test', script: { type: 'text/javascript', exec: n.tests.split('\n') } }].filter(Boolean);
function urlToPostman(r) {
  const out = { raw: r.url };
  const m = /^([a-z]+):\/\/([^/?#]+)([^?#]*)/i.exec(r.url) || /^()([^/?#]+)([^?#]*)/.exec(r.url) || [];
  if (m[2]) { if (m[1]) out.protocol = m[1]; out.host = m[2].split(':')[0].split('.'); if (m[2].includes(':')) out.port = m[2].split(':')[1]; out.path = (m[3] || '').split('/').filter(Boolean); }
  if (r.params?.length) out.query = kvTo(r.params);
  if (r.pathVars?.length) out.variable = r.pathVars.map(p => ({ key: p.key, value: p.value, ...(p.desc ? { description: p.desc } : {}) }));
  return out;
}
function itemToPostman(n) {
  if (n.items) return { name: n.name, item: n.items.filter(i => i.items || !i.kind || ['http', 'graphql'].includes(i.kind)).map(itemToPostman), ...(authToPostman(n.auth) ? { auth: authToPostman(n.auth) } : {}), event: events(n), description: n.description || undefined };
  const req = { method: n.method, header: kvTo(n.headers), url: urlToPostman(n) };
  const b = n.body || {};
  if (b.mode === 'raw') req.body = { mode: 'raw', raw: b.raw, options: { raw: { language: b.lang || 'text' } } };
  if (b.mode === 'urlencoded') req.body = { mode: 'urlencoded', urlencoded: kvTo(b.urlencoded) };
  if (b.mode === 'formdata') req.body = { mode: 'formdata', formdata: (b.formdata || []).filter(x => x.key).map(x => x.type === 'file' ? { key: x.key, type: 'file', src: x.value, ...(x.on === false ? { disabled: true } : {}) } : { key: x.key, value: x.value, type: 'text', ...(x.on === false ? { disabled: true } : {}) }) };
  if (b.mode === 'binary') req.body = { mode: 'file', file: { src: b.binary } };
  if (b.mode === 'graphql') req.body = { mode: 'graphql', graphql: { query: b.graphql?.query || '', variables: b.graphql?.variables || '' } };
  const auth = authToPostman(n.auth);
  if (auth) req.auth = auth;
  if (n.description) req.description = n.description;
  const s = n.settings || {};
  const ppb = {};
  if (s.followRedirects !== undefined) ppb.followRedirects = s.followRedirects;
  if (s.sslVerify !== undefined) ppb.strictSSL = s.sslVerify;
  if (s.disableCookies !== undefined) ppb.disableCookies = s.disableCookies;
  return {
    name: n.name, request: req, event: events(n), ...(Object.keys(ppb).length ? { protocolProfileBehavior: ppb } : {}),
    response: (n.examples || []).map(e => ({ name: e.name, originalRequest: { method: e.request?.method || n.method, header: [], url: { raw: e.request?.url || n.url } }, code: e.status, status: e.name, header: (e.headers || []).map(([key, value]) => ({ key, value })), body: e.body })),
  };
}
export function toPostmanCollection(c) {
  return {
    info: { _postman_id: c.id, name: c.name, description: c.description || undefined, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: c.items.filter(i => i.items || !i.kind || ['http', 'graphql'].includes(i.kind)).map(itemToPostman),
    ...(authToPostman(c.auth) ? { auth: authToPostman(c.auth) } : {}), event: events(c),
    variable: (c.vars || []).filter(v => v.key).map(v => ({ key: v.key, value: v.value, ...(v.on === false ? { disabled: true } : {}) })),
  };
}
export const toPostmanEnv = e => ({ id: e.id, name: e.name, values: (e.vars || []).filter(v => v.key).map(v => ({ key: v.key, value: v.value, type: v.secret ? 'secret' : 'default', enabled: v.on !== false })), _postman_variable_scope: 'environment' });
export const toPostmanGlobals = () => ({ name: 'Globals', values: W.globals.filter(v => v.key).map(v => ({ key: v.key, value: v.value, type: v.secret ? 'secret' : 'default', enabled: v.on !== false })), _postman_variable_scope: 'globals' });

// ---------- OpenAPI 3 / Swagger 2 ----------
function makeDeref(root) {
  const get = ref => ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);
  const deref = (o, seen = new Set()) => {
    if (!o || typeof o !== 'object') return o;
    if (o.$ref) { if (seen.has(o.$ref) || !o.$ref.startsWith('#')) return {}; return deref(get(o.$ref), new Set([...seen, o.$ref])); }
    return o;
  };
  const sample = (s, depth = 0, seen = new Set()) => {
    if (!s || depth > 6) return null;
    if (s.$ref) { if (seen.has(s.$ref)) return {}; return sample(get(s.$ref), depth + 1, new Set([...seen, s.$ref])); }
    if (s.example !== undefined) return s.example;
    if (s.examples?.length) return s.examples[0];
    if (s.default !== undefined) return s.default;
    if (s.enum) return s.enum[0];
    if (s.allOf) return Object.assign({}, ...s.allOf.map(x => sample(x, depth + 1, seen) || {}));
    if (s.oneOf || s.anyOf) return sample((s.oneOf || s.anyOf)[0], depth + 1, seen);
    const t = Array.isArray(s.type) ? s.type[0] : s.type || (s.properties ? 'object' : s.items ? 'array' : 'string');
    if (t === 'object') return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, sample(v, depth + 1, seen)]));
    if (t === 'array') return [sample(s.items, depth + 1, seen)];
    if (t === 'integer' || t === 'number') return 0;
    if (t === 'boolean') return true;
    return { 'date-time': new Date().toISOString(), date: new Date().toISOString().slice(0, 10), email: 'user@example.com', uuid: crypto.randomUUID(), uri: 'https://example.com' }[s.format] || 'string';
  };
  return { deref, sample };
}

function fromOpenApi(spec) {
  const v2 = !!spec.swagger;
  const { deref, sample } = makeDeref(spec);
  const c = newItem('collection');
  c.name = spec.info?.title || 'API';
  c.description = spec.info?.description || '';
  let base = '';
  if (v2) base = `${(spec.schemes || ['https'])[0]}://${spec.host || 'localhost'}${spec.basePath || ''}`;
  else if (spec.servers?.[0]) base = spec.servers[0].url.replace(/\{(\w+)\}/g, (_, k) => spec.servers[0].variables?.[k]?.default ?? k);
  c.vars = [kvRow('baseUrl', base.replace(/\/$/, ''))];
  const schemes = v2 ? spec.securityDefinitions || {} : spec.components?.securitySchemes || {};
  const authFor = reqs => {
    const name = reqs && Object.keys(reqs[0] || {})[0];
    const s = name && deref(schemes[name]);
    if (!s) return null;
    if (s.type === 'http' && s.scheme?.toLowerCase() === 'bearer') return { type: 'bearer', token: '{{bearerToken}}' };
    if ((s.type === 'http' && s.scheme?.toLowerCase() === 'basic') || s.type === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' };
    if (s.type === 'apiKey') return { type: 'apikey', key: s.name, value: '{{apiKey}}', in: s.in === 'query' ? 'query' : 'header' };
    if (s.type === 'oauth2') {
      const flows = v2 ? { [s.flow]: s } : s.flows || {};
      const [kind, f] = Object.entries(flows)[0] || [];
      return { type: 'oauth2', grantType: { authorizationCode: 'authorization_code', accessCode: 'authorization_code', clientCredentials: 'client_credentials', application: 'client_credentials', password: 'password', implicit: 'implicit' }[kind] || 'authorization_code', authUrl: f?.authorizationUrl || '', tokenUrl: f?.tokenUrl || '', scope: Object.keys(f?.scopes || {}).join(' '), clientId: '{{clientId}}', clientSecret: '{{clientSecret}}', headerPrefix: 'Bearer' };
    }
    if (s.type === 'http') return { type: 'bearer', token: '{{bearerToken}}' };
    return null;
  };
  c.auth = authFor(spec.security) || { type: 'none' };
  for (const k of ['bearerToken', 'apiKey', 'username', 'password', 'clientId', 'clientSecret']) if (JSON.stringify(c.auth).includes(`{{${k}}}`)) c.vars.push(kvRow(k, ''));
  const folders = {};
  const folderFor = tag => folders[tag] ||= (() => { const f = { ...newItem('folder'), name: tag, open: false }; c.items.push(f); return f; })();
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    const shared = ops.parameters || [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = ops[method];
      if (!op) continue;
      const r = newItem('http');
      r.name = op.summary || op.operationId || `${method.toUpperCase()} ${p}`;
      r.method = method.toUpperCase();
      r.description = [op.description, op.deprecated ? '**Deprecated**' : ''].filter(Boolean).join('\n\n');
      const params = [...shared, ...(op.parameters || [])].map(x => deref(x));
      const val = x => { const v = x.example ?? x.schema?.example ?? x.schema?.default ?? x.default ?? (x.schema?.enum || x.enum)?.[0]; return v === undefined ? '' : String(v); };
      const query = params.filter(x => x.in === 'query').map(x => kvRow(x.name, val(x), { on: !!x.required, desc: x.description }));
      r.url = '{{baseUrl}}' + p.replace(/\{([^}]+)\}/g, ':$1') + (query.filter(q => q.on).length ? '?' + query.filter(q => q.on).map(q => `${q.key}=${q.value}`).join('&') : '');
      r.params = query;
      r.pathVars = params.filter(x => x.in === 'path').map(x => kvRow(x.name, val(x), { desc: x.description }));
      r.headers = params.filter(x => x.in === 'header').map(x => kvRow(x.name, val(x), { on: !!x.required, desc: x.description }));
      if (v2) {
        const bodyP = params.find(x => x.in === 'body');
        const formP = params.filter(x => x.in === 'formData');
        if (bodyP) Object.assign(r.body, { mode: 'raw', lang: 'json', raw: JSON.stringify(sample(bodyP.schema), null, 2) });
        else if (formP.length) {
          const multi = (op.consumes || spec.consumes || []).some(x => /multipart/.test(x)) || formP.some(x => x.type === 'file');
          if (multi) Object.assign(r.body, { mode: 'formdata', formdata: formP.map(x => ({ on: true, key: x.name, value: x.type === 'file' ? '' : val(x), type: x.type === 'file' ? 'file' : 'text' })) });
          else Object.assign(r.body, { mode: 'urlencoded', urlencoded: formP.map(x => kvRow(x.name, val(x))) });
        }
      } else if (op.requestBody) {
        const rb = deref(op.requestBody);
        const content = rb.content || {};
        const ct = Object.keys(content).find(k => /json/.test(k)) || Object.keys(content)[0];
        const media = content[ct] || {};
        const ex = media.example ?? (media.examples ? deref(Object.values(media.examples)[0])?.value : undefined) ?? sample(media.schema);
        if (/json/.test(ct || '')) Object.assign(r.body, { mode: 'raw', lang: 'json', raw: JSON.stringify(ex, null, 2) });
        else if (/x-www-form-urlencoded/.test(ct)) Object.assign(r.body, { mode: 'urlencoded', urlencoded: Object.entries(ex || {}).map(([k, v]) => kvRow(k, typeof v === 'object' ? JSON.stringify(v) : String(v))) });
        else if (/multipart/.test(ct)) { const props = deref(media.schema)?.properties || {}; Object.assign(r.body, { mode: 'formdata', formdata: Object.entries(props).map(([k, s]) => ({ on: true, key: k, value: s.format === 'binary' ? '' : String(sample(s) ?? ''), type: s.format === 'binary' ? 'file' : 'text' })) }); }
        else if (/xml/.test(ct)) Object.assign(r.body, { mode: 'raw', lang: 'xml', raw: typeof ex === 'string' ? ex : '' });
        else if (ct) Object.assign(r.body, { mode: 'raw', lang: 'text', raw: typeof ex === 'string' ? ex : JSON.stringify(ex ?? '') });
        if (ct && !r.headers.some(h => /content-type/i.test(h.key)) && !/multipart|urlencoded/.test(ct) && !/json/.test(ct)) r.headers.push(kvRow('Content-Type', ct));
      }
      const opAuth = op.security ? (op.security.length === 0 ? { type: 'none' } : authFor(op.security)) : null;
      if (opAuth && JSON.stringify(opAuth) !== JSON.stringify(c.auth)) r.auth = opAuth;
      for (const [code, resp0] of Object.entries(op.responses || {})) {
        const resp = deref(resp0);
        let body = '', ct = '';
        if (v2) { if (resp.examples) { ct = Object.keys(resp.examples)[0]; body = JSON.stringify(resp.examples[ct], null, 2); } else if (resp.schema) { ct = 'application/json'; body = JSON.stringify(sample(resp.schema), null, 2); } }
        else if (resp.content) { ct = Object.keys(resp.content).find(k => /json/.test(k)) || Object.keys(resp.content)[0]; const m = resp.content[ct] || {}; const ex = m.example ?? (m.examples ? deref(Object.values(m.examples)[0])?.value : undefined) ?? sample(m.schema); body = typeof ex === 'string' ? ex : JSON.stringify(ex, null, 2); }
        const status = /^\d{3}$/.test(code) ? +code : code === 'default' ? 200 : parseInt(code) * 100 || 200;
        r.examples.push({ id: uid(), name: resp.description ? `${code} ${resp.description}`.slice(0, 80) : code, status, headers: ct ? [['Content-Type', ct]] : [], body, request: { method: r.method, url: r.url } });
      }
      (op.tags?.[0] ? folderFor(op.tags[0]).items : c.items).push(r);
    }
  }
  return c;
}

// ---------- HAR ----------
function fromHar(har) {
  const c = newItem('collection');
  c.name = 'HAR import ' + new Date().toLocaleString();
  for (const e of har.log.entries || []) {
    const q = e.request;
    const r = newItem('http');
    r.method = q.method;
    r.url = q.url;
    try { r.name = `${q.method} ${new URL(q.url).pathname}`; } catch { r.name = q.url; }
    syncParams(r);
    r.headers = (q.headers || []).filter(h => !h.name.startsWith(':') && !/^(content-length|host|cookie|connection|accept-encoding)$/i.test(h.name)).map(h => kvRow(h.name, h.value));
    const pd = q.postData;
    if (pd?.params?.length && /urlencoded/.test(pd.mimeType)) Object.assign(r.body, { mode: 'urlencoded', urlencoded: pd.params.map(p => kvRow(p.name, p.value || '')) });
    else if (pd?.params?.length && /multipart/.test(pd.mimeType)) Object.assign(r.body, { mode: 'formdata', formdata: pd.params.map(p => ({ on: true, key: p.name, value: p.value || p.fileName || '', type: p.fileName ? 'file' : 'text' })) });
    else if (pd?.text) Object.assign(r.body, { mode: 'raw', lang: /json/.test(pd.mimeType) ? 'json' : /xml/.test(pd.mimeType) ? 'xml' : 'text', raw: /json/.test(pd.mimeType) ? prettyJson(pd.text) : pd.text });
    if (e.response?.content?.text !== undefined) r.examples.push({ id: uid(), name: `${e.response.status} ${e.response.statusText || ''}`.trim(), status: e.response.status, headers: (e.response.headers || []).filter(h => !h.name.startsWith(':')).map(h => [h.name, h.value]), body: e.response.content.text || '', request: { method: r.method, url: r.url } });
    c.items.push(r);
  }
  return c;
}

// ---------- Insomnia v4 ----------
function fromInsomnia(j) {
  const res = j.resources || [];
  const conv = s => String(s ?? '').replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, '{{$1}}');
  const ws = res.find(r => r._type === 'workspace');
  const c = newItem('collection');
  c.name = ws?.name || 'Insomnia import';
  const nodes = { [ws?._id]: c };
  const groups = res.filter(r => r._type === 'request_group');
  for (const g of groups) nodes[g._id] = { ...newItem('folder'), name: g.name, open: false };
  for (const g of groups) (nodes[g.parentId] || c).items.push(nodes[g._id]);
  for (const q of res.filter(r => r._type === 'request')) {
    const r = newItem('http');
    r.name = q.name; r.method = q.method || 'GET'; r.url = conv(q.url);
    if (q.parameters?.length) r.url += (r.url.includes('?') ? '&' : '?') + q.parameters.filter(p => !p.disabled).map(p => `${p.name}=${conv(p.value)}`).join('&');
    syncParams(r);
    r.headers = (q.headers || []).map(h => kvRow(h.name, conv(h.value), { on: !h.disabled }));
    const b = q.body || {};
    if (b.mimeType === 'application/x-www-form-urlencoded') Object.assign(r.body, { mode: 'urlencoded', urlencoded: (b.params || []).map(p => kvRow(p.name, conv(p.value), { on: !p.disabled })) });
    else if (b.mimeType === 'multipart/form-data') Object.assign(r.body, { mode: 'formdata', formdata: (b.params || []).map(p => ({ on: !p.disabled, key: p.name, value: p.type === 'file' ? p.fileName || '' : conv(p.value), type: p.type === 'file' ? 'file' : 'text' })) });
    else if (b.mimeType === 'application/graphql') { r.kind = 'graphql'; let g = {}; try { g = JSON.parse(b.text); } catch {} Object.assign(r.body, { mode: 'graphql', graphql: { query: g.query || '', variables: g.variables ? JSON.stringify(g.variables, null, 2) : '' } }); }
    else if (b.text) Object.assign(r.body, { mode: 'raw', lang: /json/.test(b.mimeType || '') ? 'json' : /xml/.test(b.mimeType || '') ? 'xml' : 'text', raw: conv(b.text) });
    const a = q.authentication || {};
    if (a.type === 'bearer') r.auth = { type: 'bearer', token: conv(a.token) };
    else if (a.type === 'basic') r.auth = { type: 'basic', username: conv(a.username), password: conv(a.password) };
    else if (a.type === 'apikey') r.auth = { type: 'apikey', key: conv(a.key), value: conv(a.value), in: a.addTo === 'queryParams' ? 'query' : 'header' };
    else if (a.type === 'digest') r.auth = { type: 'digest', username: conv(a.username), password: conv(a.password) };
    r.description = q.description || '';
    (nodes[q.parentId] || c).items.push(r);
  }
  const envs = res.filter(r => r._type === 'environment' && r.data && Object.keys(r.data).length).map(e => ({ id: uid(), name: e.name || 'Insomnia env', vars: Object.entries(e.data).map(([k, v]) => kvRow(k, typeof v === 'object' ? JSON.stringify(v) : String(v))) }));
  return { collection: c, envs };
}

// ---------- entry point ----------
// Returns a list of human-readable results; mutates the workspace.
export function importText(text, filename = '') {
  const t = text.trim();
  if (/^curl\s/i.test(t)) return [{ kind: 'request', item: parseCurl(t) }];
  let j;
  try { j = JSON.parse(t); } catch {
    try { j = yaml.load(t); } catch (e) { throw new Error('Not valid JSON, YAML or cURL: ' + e.message); }
  }
  if (!j || typeof j !== 'object') throw new Error('Unrecognised file');
  const out = [];
  if (j.myPostmaster && j.workspace) {
    const w = j.workspace;
    W.collections.push(...(w.collections || []));
    W.environments.push(...(w.environments || []));
    for (const g of w.globals || []) if (!W.globals.some(x => x.key === g.key)) W.globals.push(g);
    out.push({ kind: 'backup', name: `${(w.collections || []).length} collections, ${(w.environments || []).length} environments` });
  } else if (j.info && Array.isArray(j.item)) { const c = fromPostmanCollection(j); W.collections.push(c); out.push({ kind: 'collection', name: c.name, id: c.id }); }
  else if (j.openapi || j.swagger) { const c = fromOpenApi(j); W.collections.push(c); out.push({ kind: 'collection', name: c.name, id: c.id }); }
  else if (j.log?.entries) { const c = fromHar(j); W.collections.push(c); out.push({ kind: 'collection', name: c.name, id: c.id }); }
  else if (j._type === 'export' && j.resources) { const { collection, envs } = fromInsomnia(j); W.collections.push(collection); W.environments.push(...envs); out.push({ kind: 'collection', name: collection.name, id: collection.id }, ...envs.map(e => ({ kind: 'environment', name: e.name }))); }
  else if (Array.isArray(j.values) && (j._postman_variable_scope === 'globals' || /globals/i.test(j.name || '') && !j.id)) {
    for (const v of j.values) { const ex = W.globals.find(x => x.key === v.key); const row = kvRow(v.key, v.value ?? '', { on: v.enabled !== false, secret: v.type === 'secret' }); ex ? Object.assign(ex, row) : W.globals.push(row); }
    out.push({ kind: 'globals', name: `${j.values.length} global variables` });
  } else if (Array.isArray(j.values)) { const e = { id: uid(), name: j.name || filename.replace(/(\.post(?:man|master)_\w+)?\.[^.]+$/, '') || 'Imported environment', vars: j.values.map(v => kvRow(v.key, v.value ?? '', { on: v.enabled !== false, secret: v.type === 'secret' })) }; W.environments.push(e); out.push({ kind: 'environment', name: e.name, id: e.id }); }
  else if (Array.isArray(j.collections) || Array.isArray(j.environments)) { // Postman data dump
    for (const c of j.collections || []) { const col = fromPostmanCollection(c.info ? c : { info: { name: c.name }, item: c.item || [] }); W.collections.push(col); out.push({ kind: 'collection', name: col.name }); }
    for (const e of j.environments || []) { W.environments.push({ id: uid(), name: e.name, vars: (e.values || []).map(v => kvRow(v.key, v.value ?? '', { on: v.enabled !== false })) }); out.push({ kind: 'environment', name: e.name }); }
  } else throw new Error('Unrecognised format. Supported: Postman collection v2/v2.1, environment, globals or data dump; OpenAPI 3 / Swagger 2 (JSON or YAML); HAR; Insomnia v4; cURL; My Postmaster backup.');
  saveW();
  return out;
}

export const workspaceBackup = () => ({ myPostmaster: 2, exportedAt: new Date().toISOString(), workspace: { collections: W.collections, environments: W.environments, globals: W.globals } });
export const countRequests = c => flatRequests(c).length;
