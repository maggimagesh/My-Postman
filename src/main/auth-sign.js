// Auth schemes that need Node crypto or a server challenge. Simple ones (bearer, basic, API key,
// OAuth 2 token) are applied in the renderer; these mutate `headers` (array of [k, v]) / url in place.
const crypto = require('crypto');

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hash = (alg, s, out = 'hex') => crypto.createHash(alg).update(s).digest(out);
const hmac = (alg, key, s, out) => crypto.createHmac(alg, key).update(s).digest(out);
const getH = (headers, n) => headers.find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1];
const setH = (headers, n, v) => { const i = headers.findIndex(([k]) => k.toLowerCase() === n.toLowerCase()); i >= 0 ? headers[i] = [n, v] : headers.push([n, v]); };

// ---- AWS Signature V4 ----
function awsSign(req, a) {
  const u = new URL(req.url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const service = a.service || 'execute-api', region = a.region || 'us-east-1';
  const payloadHash = typeof req.body === 'string' ? hash('sha256', req.body) : req.body == null ? hash('sha256', '') : 'UNSIGNED-PAYLOAD';
  setH(req.headers, 'X-Amz-Date', amzDate);
  setH(req.headers, 'X-Amz-Content-Sha256', payloadHash);
  if (a.sessionToken) setH(req.headers, 'X-Amz-Security-Token', a.sessionToken);
  setH(req.headers, 'Host', u.host);
  const signed = {};
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (lk === 'host' || lk.startsWith('x-amz-') || lk === 'content-type') signed[lk] = String(v).trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(signed).sort();
  // S3 paths are encoded once; every other service double-encodes the (already encoded) segments.
  const canonPath = u.pathname.split('/').map(s => service === 's3' ? enc(decodeURIComponent(s)) : enc(s)).join('/') || '/';
  const canonQuery = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1).map(p => p.join('=')).join('&');
  const canon = [req.method, canonPath, canonQuery, names.map(n => `${n}:${signed[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash('sha256', canon)].join('\n');
  let key = hmac('sha256', 'AWS4' + a.secretKey, day);
  for (const p of [region, service, 'aws4_request']) key = hmac('sha256', key, p);
  const sig = hmac('sha256', key, toSign, 'hex');
  setH(req.headers, 'Authorization', `AWS4-HMAC-SHA256 Credential=${a.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`);
}

// ---- OAuth 1.0a ----
function oauth1Sign(req, a) {
  const u = new URL(req.url);
  const method = a.signatureMethod || 'HMAC-SHA1';
  const op = {
    oauth_consumer_key: a.consumerKey || '', oauth_nonce: a.nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: method, oauth_timestamp: a.timestamp || String(Math.floor(Date.now() / 1000)), oauth_version: a.version || '1.0',
  };
  if (a.token) op.oauth_token = a.token;
  if (a.callback) op.oauth_callback = a.callback;
  if (a.verifier) op.oauth_verifier = a.verifier;
  if (a.realm) op.realm = a.realm;
  const params = [...u.searchParams, ...Object.entries(op).filter(([k]) => k !== 'realm')];
  if (req.bodyKind === 'text' && /x-www-form-urlencoded/i.test(getH(req.headers, 'content-type') || '')) params.push(...new URLSearchParams(req.body || ''));
  const norm = params.map(([k, v]) => [enc(k), enc(v)]).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1).map(p => p.join('=')).join('&');
  const base = [req.method.toUpperCase(), enc(u.origin + u.pathname), enc(norm)].join('&');
  const key = enc(a.consumerSecret || '') + '&' + enc(a.tokenSecret || '');
  const algs = { 'HMAC-SHA1': 'sha1', 'HMAC-SHA256': 'sha256', 'HMAC-SHA512': 'sha512' };
  let sig;
  if (method === 'PLAINTEXT') sig = key;
  else if (method.startsWith('RSA-')) sig = crypto.sign(method === 'RSA-SHA1' ? 'sha1' : method === 'RSA-SHA512' ? 'sha512' : 'sha256', Buffer.from(base), a.privateKey).toString('base64');
  else sig = hmac(algs[method] || 'sha1', key, base, 'base64');
  op.oauth_signature = sig;
  if (a.addTo === 'query') {
    for (const [k, v] of Object.entries(op)) if (k !== 'realm') u.searchParams.set(k, v);
    req.url = u.toString();
  } else {
    setH(req.headers, 'Authorization', 'OAuth ' + Object.entries(op).map(([k, v]) => `${k}="${enc(v)}"`).join(', '));
  }
}

// ---- JWT bearer ----
function jwtSign(req, a) {
  const b64u = b => Buffer.from(b).toString('base64url');
  const alg = a.algorithm || 'HS256';
  let header = { alg, typ: 'JWT' }, payload = {};
  try { Object.assign(header, a.headers ? JSON.parse(a.headers) : {}); } catch { throw new Error('JWT: header is not valid JSON'); }
  try { payload = a.payload ? JSON.parse(a.payload) : {}; } catch { throw new Error('JWT: payload is not valid JSON'); }
  const data = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(payload));
  const bits = alg.slice(2);
  let sig;
  if (alg.startsWith('HS')) sig = hmac('sha' + bits, a.secretBase64 ? Buffer.from(a.secret || '', 'base64') : a.secret || '', data);
  else if (alg.startsWith('RS')) sig = crypto.sign('sha' + bits, Buffer.from(data), a.privateKey);
  else if (alg.startsWith('PS')) sig = crypto.sign('sha' + bits, Buffer.from(data), { key: a.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST });
  else if (alg.startsWith('ES')) sig = crypto.sign('sha' + bits, Buffer.from(data), { key: a.privateKey, dsaEncoding: 'ieee-p1363' });
  else throw new Error('JWT: unsupported algorithm ' + alg);
  const token = data + '.' + b64u(sig);
  if (a.addTo === 'query') { const u = new URL(req.url); u.searchParams.set(a.queryParam || 'token', token); req.url = u.toString(); }
  else setH(req.headers, 'Authorization', `${a.prefix ?? 'Bearer'} ${token}`.trim());
}

// ---- Hawk ----
function hawkSign(req, a) {
  const u = new URL(req.url);
  const alg = a.algorithm === 'sha1' ? 'sha1' : 'sha256';
  const ts = a.timestamp || Math.floor(Date.now() / 1000);
  const nonce = a.nonce || crypto.randomBytes(6).toString('base64url');
  const port = u.port || (u.protocol === 'https:' ? 443 : 80);
  let payloadHash = '';
  if (a.includePayloadHash) {
    const ct = (getH(req.headers, 'content-type') || '').split(';')[0].trim().toLowerCase();
    payloadHash = hash(alg, `hawk.1.payload\n${ct}\n${typeof req.body === 'string' ? req.body : ''}\n`, 'base64');
  }
  const norm = `hawk.1.header\n${ts}\n${nonce}\n${req.method.toUpperCase()}\n${u.pathname}${u.search}\n${u.hostname.toLowerCase()}\n${port}\n${payloadHash}\n${a.ext || ''}\n`
    + (a.app ? `${a.app}\n${a.dlg || ''}\n` : '');
  const mac = hmac(alg, a.authKey || '', norm, 'base64');
  let h = `Hawk id="${a.authId || ''}", ts="${ts}", nonce="${nonce}"`;
  if (payloadHash) h += `, hash="${payloadHash}"`;
  if (a.ext) h += `, ext="${a.ext}"`;
  h += `, mac="${mac}"`;
  if (a.app) h += `, app="${a.app}"` + (a.dlg ? `, dlg="${a.dlg}"` : '');
  setH(req.headers, 'Authorization', h);
}

// ---- Digest (needs the server's 401 challenge) ----
function digestHeader(req, a, challenge, nc = 1) {
  const p = {};
  challenge.replace(/^Digest\s+/i, '').replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, q, v) => { p[k.toLowerCase()] = q ?? v; });
  const algo = (a.algorithm || p.algorithm || 'MD5').toUpperCase();
  const H = s => hash(algo.startsWith('SHA-256') ? 'sha256' : algo.startsWith('SHA-512') ? 'sha512' : 'md5', s);
  const u = new URL(req.url);
  const uri = u.pathname + u.search;
  const cnonce = a.cnonce || crypto.randomBytes(8).toString('hex');
  const ncs = String(nc).padStart(8, '0');
  const qop = (p.qop || '').split(',').map(s => s.trim()).includes('auth') ? 'auth' : (p.qop ? p.qop.split(',')[0].trim() : '');
  let ha1 = H(`${a.username}:${p.realm}:${a.password}`);
  if (algo.endsWith('-SESS')) ha1 = H(`${ha1}:${p.nonce}:${cnonce}`);
  const ha2 = H(qop === 'auth-int' ? `${req.method}:${uri}:${H(typeof req.body === 'string' ? req.body : '')}` : `${req.method}:${uri}`);
  const response = qop ? H(`${ha1}:${p.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${p.nonce}:${ha2}`);
  let h = `Digest username="${a.username}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", algorithm=${algo}, response="${response}"`;
  if (qop) h += `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"`;
  if (p.opaque) h += `, opaque="${p.opaque}"`;
  return h;
}

function signRequest(req) {
  const a = req.auth;
  if (!a) return;
  if (a.type === 'awsv4') awsSign(req, a);
  if (a.type === 'oauth1') oauth1Sign(req, a);
  if (a.type === 'jwt') jwtSign(req, a);
  if (a.type === 'hawk') hawkSign(req, a);
}

module.exports = { signRequest, digestHeader, getH, setH };
