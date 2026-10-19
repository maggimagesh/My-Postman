// HTTP engine: undici with proxy / TLS / client-cert support, a shared cookie jar,
// manual redirects (so cookies from every hop are kept) and main-process auth signers.
const { request, Agent, ProxyAgent } = require('undici');
const { STATUS_CODES } = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { signRequest, digestHeader, getH, setH } = require('./auth-sign');

let settings = {};
let jar = null;
const inflight = new Map();
const dispatchers = new Map();

const init = (cookieJar) => { jar = cookieJar; };
const setSettings = s => { settings = s || {}; dispatchers.clear(); };

const hostMatches = (host, pattern) => {
  pattern = pattern.trim().toLowerCase();
  if (!pattern) return false;
  if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
  if (pattern.startsWith('.')) return host.endsWith(pattern);
  return host === pattern;
};
const readMaybe = p => { try { return p ? fs.readFileSync(p) : undefined; } catch (e) { throw new Error(`Cannot read ${p}: ${e.message}`); } };

function proxyFor(u) {
  const p = settings.proxy || {};
  if (p.mode === 'custom' && p.url) {
    if ((p.bypass || '').split(',').some(b => hostMatches(u.hostname, b))) return null;
    if (u.protocol === 'http:' && p.httpOnly === false) return null;
    return { uri: /^\w+:\/\//.test(p.url) ? p.url : 'http://' + p.url, user: p.user, pass: p.pass };
  }
  if (p.mode === 'system') {
    const env = process.env;
    const noProxy = env.NO_PROXY || env.no_proxy || '';
    if (noProxy === '*' || noProxy.split(',').some(b => hostMatches(u.hostname, b))) return null;
    const url = u.protocol === 'https:' ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy : env.HTTP_PROXY || env.http_proxy;
    return url ? { uri: url } : null;
  }
  return null;
}

function dispatcherFor(url, reqSettings = {}) {
  const u = new URL(url);
  const verify = reqSettings.sslVerify ?? settings.sslVerify ?? false;
  const cert = (settings.certs || []).find(c => c.on !== false && c.host && hostMatches(u.hostname, c.host.split(':')[0]) && (!c.host.includes(':') || c.host.split(':')[1] === (u.port || '443')));
  const proxy = proxyFor(u);
  const caOn = settings.ca?.on && settings.ca.path;
  const key = JSON.stringify([verify, cert?.id, proxy, caOn && settings.ca.path]);
  if (dispatchers.has(key)) return dispatchers.get(key);
  const tls = { rejectUnauthorized: verify };
  if (caOn) tls.ca = readMaybe(settings.ca.path);
  if (cert) Object.assign(tls, { cert: readMaybe(cert.crt), key: readMaybe(cert.key), pfx: readMaybe(cert.pfx), passphrase: cert.passphrase || undefined });
  const d = proxy
    ? new ProxyAgent({ uri: proxy.uri, token: proxy.user ? 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass || ''}`).toString('base64') : undefined, requestTls: tls, proxyTls: { rejectUnauthorized: verify } })
    : new Agent({ connect: tls });
  dispatchers.set(key, d);
  return d;
}

function decode(buf, encoding) {
  try {
    switch ((encoding || '').trim().toLowerCase()) {
      case 'gzip': case 'x-gzip': return zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      case 'br': return zlib.brotliDecompressSync(buf);
      case 'deflate': try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); }
      default: return buf;
    }
  } catch { return buf; }
}

const isTextType = ct => !ct || /json|text|xml|javascript|html|csv|yaml|x-www-form-urlencoded|graphql|ndjson|event-stream/i.test(ct);

// Multipart encoder: sends text values byte-for-byte like Postman (undici's FormData rewrites \n to \r\n).
function multipart(form) {
  const boundary = '----MyPostmasterBoundary' + Math.random().toString(16).slice(2);
  const q = s => String(s).replace(/"/g, '%22').replace(/\r?\n/g, ' ');
  const parts = [];
  for (const f of form || []) {
    if (f.type === 'file') {
      for (const p of [].concat(f.value || [])) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${q(f.key)}"; filename="${q(path.basename(p))}"\r\nContent-Type: ${f.contentType || 'application/octet-stream'}\r\n\r\n`), fs.readFileSync(p), Buffer.from('\r\n'));
    } else parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${q(f.key)}"\r\n${f.contentType ? `Content-Type: ${f.contentType}\r\n` : ''}\r\n${f.value ?? ''}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { buf: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

function buildBody(r, headers) {
  if (r.bodyKind === 'form') {
    const { buf, type } = multipart(r.form);
    // A form-data body needs its boundary in Content-Type; a user header (e.g. a leftover
    // x-www-form-urlencoded from a copied cURL) would make the body unreadable, so ours wins.
    setH(headers, 'Content-Type', type);
    return buf;
  }
  if (r.bodyKind === 'binary') return r.binaryPath ? fs.readFileSync(r.binaryPath) : null;
  return r.body ?? null;
}

// One request/response exchange (no redirect handling).
async function exchange(r, signal) {
  const u = new URL(r.url);
  const headers = r.headers.filter(([k]) => k);
  if (jar && settings.cookies?.enabled !== false && !r.settings?.disableCookies) {
    const c = jar.headerFor(r.url);
    if (c) { const existing = getH(headers, 'cookie'); setH(headers, 'Cookie', existing ? `${existing}; ${c}` : c); }
  }
  const body = ['GET', 'HEAD'].includes(r.method) && r.body == null && r.bodyKind !== 'form' ? null : buildBody(r, headers);
  const res = await request(u, {
    method: r.method, headers: headers.map(([k, v]) => [k, String(v)]).flat(), body, signal,
    dispatcher: dispatcherFor(r.url, r.settings), headersTimeout: 0, bodyTimeout: 0,
  });
  return { res, headers };
}

async function send(r) {
  const ctrl = new AbortController();
  if (r.id) inflight.set(r.id, ctrl);
  const timeoutMs = r.settings?.timeout ?? settings.timeout ?? 0;
  let timedOut = false;
  const timer = timeoutMs > 0 && setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const t0 = performance.now();
  const redirects = [];
  try {
    r = { ...r, headers: [...(r.headers || [])] };
    if (!getH(r.headers, 'user-agent')) r.headers.push(['User-Agent', `MyPostmaster/${settings.version || '2'}`]);
    if (!getH(r.headers, 'accept')) r.headers.push(['Accept', '*/*']);
    if (!getH(r.headers, 'accept-encoding')) r.headers.push(['Accept-Encoding', 'gzip, deflate, br']);
    signRequest(r);
    const follow = r.settings?.followRedirects ?? settings.followRedirects ?? true;
    const maxRedirects = r.settings?.maxRedirects ?? settings.maxRedirects ?? 10;
    let digestTried = false, setCookies = [], sentHeaders, res, tHeaders;
    for (;;) {
      ({ res, headers: sentHeaders } = await exchange(r, ctrl.signal));
      tHeaders = performance.now();
      const sc = [].concat(res.headers['set-cookie'] || []);
      if (sc.length && jar && settings.cookies?.enabled !== false) setCookies.push(...jar.setFromResponse(r.url, sc));
      const challenge = res.headers['www-authenticate'];
      if (res.statusCode === 401 && r.auth?.type === 'digest' && !digestTried && /^digest/i.test(challenge || '')) {
        await res.body.dump();
        digestTried = true;
        setH(r.headers, 'Authorization', digestHeader(r, r.auth, challenge));
        continue;
      }
      const loc = res.headers.location;
      if (follow && loc && [301, 302, 303, 307, 308].includes(res.statusCode) && redirects.length < maxRedirects) {
        await res.body.dump();
        const next = new URL(loc, r.url).toString();
        redirects.push({ status: res.statusCode, from: r.url, to: next });
        const crossOrigin = new URL(next).origin !== new URL(r.url).origin;
        let headers = r.headers;
        if (crossOrigin && !r.settings?.keepAuthOnRedirect) headers = headers.filter(([k]) => !['authorization', 'cookie'].includes(k.toLowerCase()));
        if (res.statusCode === 303 || ([301, 302].includes(res.statusCode) && r.method === 'POST')) {
          r = { ...r, method: 'GET', body: null, bodyKind: 'text', headers: headers.filter(([k]) => !/^content-(type|length)$/i.test(k)) };
        } else r = { ...r, headers };
        r.url = next;
        continue;
      }
      break;
    }
    const raw = Buffer.from(await res.body.arrayBuffer());
    const buf = decode(raw, res.headers['content-encoding']);
    const t1 = performance.now();
    const headers = [];
    for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) headers.push([k, x]);
    const ct = res.headers['content-type'] || '';
    const text = isTextType(ct);
    return {
      ok: true, status: res.statusCode, statusText: STATUS_CODES[res.statusCode] || '', headers, contentType: ct,
      body: text ? buf.toString('utf8') : null, base64: text ? null : buf.toString('base64'),
      size: buf.length, rawSize: raw.length, headersSize: headers.reduce((n, [k, v]) => n + k.length + String(v).length + 4, 0),
      time: Math.round(t1 - t0), timings: { ttfb: Math.round(tHeaders - t0), download: Math.round(t1 - tHeaders) },
      redirects, cookies: setCookies, url: r.url,
      sent: { method: r.method, url: r.url, headers: sentHeaders, body: typeof r.body === 'string' ? r.body.slice(0, 200000) : r.bodyKind === 'form' ? '[form-data]' : r.bodyKind === 'binary' ? `[file ${r.binaryPath}]` : null },
    };
  } catch (err) {
    const msg = timedOut ? `Request timed out after ${timeoutMs} ms` : ctrl.signal.aborted ? 'Request cancelled' : (err.cause?.message || err.message || String(err));
    return { ok: false, error: msg, code: err.code || err.cause?.code, time: Math.round(performance.now() - t0), redirects, cancelled: ctrl.signal.aborted && !timedOut };
  } finally {
    clearTimeout(timer);
    if (r.id) inflight.delete(r.id);
  }
}

const cancel = id => inflight.get(id)?.abort();

// Realtime/gRPC tabs: verify only when both the global switch and the tab ask for it.
const tlsVerify = tabValue => settings.sslVerify === true && tabValue !== false;

module.exports = { tlsVerify, init, setSettings, send, cancel, dispatcherFor, isTextType };
