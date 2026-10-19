// OAuth 2.0 "Get New Access Token": every grant Postman supports, with the browser
// steps done in an Electron window that watches for the callback URL.
const { BrowserWindow } = require('electron');
const crypto = require('crypto');
const http = require('./http');

const b64u = b => Buffer.from(b).toString('base64url');

function openAuthWindow(parent, url, callback) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ parent, modal: true, width: 520, height: 720, title: 'Authorize', webPreferences: { partition: 'persist:oauth2', sandbox: true } });
    let done = false;
    const check = (e, target) => {
      if (done || !target.startsWith(callback)) return;
      done = true;
      e?.preventDefault?.();
      win.destroy();
      resolve(new URL(target));
    };
    win.webContents.on('will-redirect', (e, u) => check(e, u));
    win.webContents.on('will-navigate', (e, u) => check(e, u));
    win.webContents.on('did-navigate', (e, u) => check(null, u));
    win.webContents.on('did-fail-load', (_e, _c, _d, u) => check(null, u || ''));
    win.on('closed', () => { if (!done) reject(new Error('Authorization window was closed')); });
    win.loadURL(url).catch(() => {});
  });
}

async function tokenRequest(c, params) {
  const headers = [['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']];
  if (c.clientAuth === 'body') { params.client_id = c.clientId; if (c.clientSecret) params.client_secret = c.clientSecret; }
  else if (c.clientId) headers.push(['Authorization', 'Basic ' + Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret || '')}`).toString('base64')]);
  for (const kv of c.extraTokenParams || []) if (kv.on !== false && kv.key) params[kv.key] = kv.value;
  const res = await http.send({ method: 'POST', url: c.tokenUrl, headers, body: new URLSearchParams(params).toString(), bodyKind: 'text', settings: { disableCookies: true } });
  if (!res.ok) throw new Error(res.error);
  let data;
  try { data = JSON.parse(res.body); } catch { data = Object.fromEntries(new URLSearchParams(res.body || '')); }
  if (res.status >= 400 || data.error) throw new Error(`${data.error || res.status}: ${data.error_description || res.body?.slice(0, 300)}`);
  if (!data.access_token) throw new Error('No access_token in response: ' + res.body?.slice(0, 300));
  return data;
}

async function getToken(parent, c) {
  const g = c.grantType || 'authorization_code';
  const scope = c.scope ? { scope: c.scope } : {};
  const extra = Object.fromEntries((c.extraAuthParams || []).filter(x => x.on !== false && x.key).map(x => [x.key, x.value]));
  if (c.audience) extra.audience = c.audience;
  let data;
  if (g === 'client_credentials') data = await tokenRequest(c, { grant_type: 'client_credentials', ...scope, ...extra });
  else if (g === 'password') data = await tokenRequest(c, { grant_type: 'password', username: c.username || '', password: c.password || '', ...scope, ...extra });
  else if (g === 'refresh_token') data = await tokenRequest(c, { grant_type: 'refresh_token', refresh_token: c.refreshToken || '', ...scope });
  else if (g === 'implicit') {
    const u = new URL(c.authUrl);
    Object.entries({ response_type: 'token', client_id: c.clientId, redirect_uri: c.callbackUrl, state: c.state || crypto.randomBytes(8).toString('hex'), ...scope, ...extra }).forEach(([k, v]) => v && u.searchParams.set(k, v));
    const back = await openAuthWindow(parent, u.toString(), c.callbackUrl);
    const p = new URLSearchParams(back.hash.slice(1) || back.search.slice(1));
    if (p.get('error')) throw new Error(`${p.get('error')}: ${p.get('error_description') || ''}`);
    data = Object.fromEntries(p);
    if (!data.access_token) throw new Error('No access_token returned');
  } else {
    const pkce = g === 'authorization_code_pkce';
    const verifier = c.codeVerifier || b64u(crypto.randomBytes(32));
    const state = c.state || crypto.randomBytes(8).toString('hex');
    const u = new URL(c.authUrl);
    const q = { response_type: 'code', client_id: c.clientId, redirect_uri: c.callbackUrl, state, ...scope, ...extra };
    if (pkce) Object.assign(q, c.challengeMethod === 'plain'
      ? { code_challenge: verifier, code_challenge_method: 'plain' }
      : { code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
    Object.entries(q).forEach(([k, v]) => v && u.searchParams.set(k, v));
    const back = await openAuthWindow(parent, u.toString(), c.callbackUrl);
    const p = back.searchParams;
    if (p.get('error')) throw new Error(`${p.get('error')}: ${p.get('error_description') || ''}`);
    if (p.get('state') && p.get('state') !== state) throw new Error('State mismatch (possible CSRF) — token request aborted');
    data = await tokenRequest(c, { grant_type: 'authorization_code', code: p.get('code'), redirect_uri: c.callbackUrl, ...(pkce ? { code_verifier: verifier } : {}) });
  }
  return { ...data, obtainedAt: Date.now() };
}

module.exports = { getToken };
