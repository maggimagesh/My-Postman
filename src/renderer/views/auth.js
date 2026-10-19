// Authorization editor shared by requests, folders and collections.
import { h, esc, icon, toast, kvTable } from '../ui.js';
import { resolve } from '../state.js';

export const AUTH_TYPES = [
  ['inherit', 'Inherit auth from parent'], ['none', 'No Auth'], ['bearer', 'Bearer Token'], ['basic', 'Basic Auth'], ['apikey', 'API Key'],
  ['jwt', 'JWT Bearer'], ['digest', 'Digest Auth'], ['oauth1', 'OAuth 1.0'], ['oauth2', 'OAuth 2.0'], ['hawk', 'Hawk Authentication'], ['awsv4', 'AWS Signature'],
];

const FIELDS = {
  bearer: [['token', 'Token', 'secret']],
  basic: [['username', 'Username'], ['password', 'Password', 'secret']],
  apikey: [['key', 'Key'], ['value', 'Value', 'secret'], ['in', 'Add to', ['header', 'Header'], ['query', 'Query Params']]],
  jwt: [['algorithm', 'Algorithm', ...['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'].map(a => [a, a])],
    ['secret', 'Secret (HS*)', 'secret'], ['secretBase64', 'Secret is Base64 encoded', 'bool'], ['privateKey', 'Private key PEM (RS/PS/ES)', 'area'],
    ['payload', 'Payload (JSON)', 'area'], ['headers', 'JWT headers (JSON)', 'area'], ['addTo', 'Add token to', ['header', 'Request Header'], ['query', 'Query Param']],
    ['prefix', 'Header prefix'], ['queryParam', 'Query param name']],
  digest: [['username', 'Username'], ['password', 'Password', 'secret'], ['algorithm', 'Algorithm', ['', 'From server challenge'], ['MD5', 'MD5'], ['MD5-sess', 'MD5-sess'], ['SHA-256', 'SHA-256'], ['SHA-256-sess', 'SHA-256-sess']]],
  oauth1: [['signatureMethod', 'Signature method', ...['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'].map(a => [a, a])],
    ['consumerKey', 'Consumer key'], ['consumerSecret', 'Consumer secret', 'secret'], ['token', 'Access token'], ['tokenSecret', 'Token secret', 'secret'],
    ['privateKey', 'Private key PEM (RSA)', 'area'], ['callback', 'Callback URL'], ['verifier', 'Verifier'], ['realm', 'Realm'], ['addTo', 'Add auth data to', ['header', 'Request Headers'], ['query', 'Request URL']]],
  hawk: [['authId', 'Hawk Auth ID'], ['authKey', 'Hawk Auth Key', 'secret'], ['algorithm', 'Algorithm', ['sha256', 'SHA256'], ['sha1', 'SHA1']], ['ext', 'ext'], ['app', 'app'], ['dlg', 'dlg'], ['includePayloadHash', 'Include payload hash', 'bool']],
  awsv4: [['accessKey', 'Access key'], ['secretKey', 'Secret key', 'secret'], ['region', 'AWS region'], ['service', 'Service name'], ['sessionToken', 'Session token', 'secret']],
};

const DESCR = {
  inherit: 'This item will use the authorization of its parent folder or collection.',
  none: 'This request does not use any authorization.',
  digest: 'The first request gets the server challenge (401) and is retried automatically with the Digest response.',
  awsv4: 'Signs the request with AWS Signature Version 4 just before it is sent.',
};

function field(a, [k, label, kind, ...opts], onChange) {
  const row = document.createDocumentFragment();
  row.append(h(`<label>${esc(label)}</label>`));
  let input;
  if (Array.isArray(kind)) {
    input = h(`<select>${[kind, ...opts].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`);
    input.value = a[k] ?? kind[0];
    if (a[k] === undefined) a[k] = kind[0];
    input.onchange = () => { a[k] = input.value; onChange(); };
  } else if (kind === 'bool') {
    input = h(`<div><input type="checkbox" ${a[k] ? 'checked' : ''}></div>`);
    input.firstChild.onchange = e => { a[k] = e.target.checked; onChange(); };
  } else if (kind === 'area') {
    input = h(`<textarea class="mono var-input" rows="4" spellcheck="false"></textarea>`);
    input.value = a[k] || '';
    input.oninput = () => { a[k] = input.value; onChange(); };
  } else {
    input = h(`<div class="row-flex"><input class="mono var-input" style="flex:1" type="${kind === 'secret' ? 'password' : 'text'}" spellcheck="false">${kind === 'secret' ? `<button class="ghost" title="Show / hide">${icon('eye')}</button>` : ''}</div>`);
    const i = input.querySelector('input');
    i.value = a[k] || '';
    i.oninput = () => { a[k] = i.value; onChange(); };
    input.querySelector('button')?.addEventListener('click', () => { i.type = i.type === 'password' ? 'text' : 'password'; });
  }
  row.append(input);
  return row;
}

// opts: { allowInherit, inheritLabel, vars: () => map for resolving OAuth2 fields }
export function renderAuth(el, a, onChange, opts = {}) {
  el.replaceChildren();
  const types = AUTH_TYPES.filter(([t]) => opts.allowInherit !== false || t !== 'inherit');
  const top = h(`<div class="row-flex" style="margin-bottom:6px"><label class="dim">Auth Type</label><select style="width:260px">${types.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`);
  const sel = top.querySelector('select');
  sel.value = a.type || 'none';
  sel.onchange = () => { a.type = sel.value; onChange(); renderAuth(el, a, onChange, opts); };
  el.append(top);
  if (DESCR[a.type]) el.append(h(`<div class="callout">${esc(DESCR[a.type])}${a.type === 'inherit' && opts.inheritLabel ? ` <b>${esc(opts.inheritLabel)}</b>` : ''}</div>`));
  if (a.type === 'oauth2') return renderOAuth2(el, a, onChange, opts);
  if (!FIELDS[a.type]) return;
  const form = h(`<div class="form"></div>`);
  for (const f of FIELDS[a.type]) form.append(field(a, f, onChange));
  el.append(form);
  if (['bearer', 'basic', 'apikey', 'digest'].includes(a.type)) el.append(h(`<div class="dim" style="font-size:12px">Tip: keep secrets in environment variables, e.g. <code>{{token}}</code>, and mark them as secret.</div>`));
}

function renderOAuth2(el, a, onChange, opts) {
  a.grantType ||= 'authorization_code';
  a.headerPrefix ??= 'Bearer';
  const tokenBox = h(`<div class="col-flex" style="gap:6px"></div>`);
  const drawToken = () => {
    tokenBox.replaceChildren();
    const exp = a.tokenInfo?.expires_in && a.tokenInfo.obtainedAt ? a.tokenInfo.obtainedAt + a.tokenInfo.expires_in * 1000 : null;
    tokenBox.append(h(`<div class="form"><h4>Current token</h4></div>`));
    const f = tokenBox.firstChild;
    f.append(...field(a, ['accessToken', 'Access token', 'secret'], onChange).childNodes);
    f.append(...field(a, ['headerPrefix', 'Header prefix'], onChange).childNodes);
    f.append(...field(a, ['addTo', 'Add token to', ['header', 'Request Headers'], ['query', 'Request URL']], onChange).childNodes);
    if (exp) f.append(h(`<label>Expires</label>`), h(`<div class="${exp < Date.now() ? 's4' : 'dim'}">${new Date(exp).toLocaleString()}${exp < Date.now() ? ' (expired)' : ''}</div>`));
    if (a.tokenInfo?.refresh_token) f.append(h(`<label>Refresh token</label>`), h(`<div class="mono dim" style="overflow:hidden;text-overflow:ellipsis">${esc(a.tokenInfo.refresh_token.slice(0, 40))}…</div>`));
  };
  drawToken();
  el.append(tokenBox);
  const cfg = h(`<div class="form"><h4>Configure new token</h4></div>`);
  const fieldsFor = {
    authorization_code: ['callbackUrl', 'authUrl', 'tokenUrl', 'clientId', 'clientSecret', 'scope', 'state', 'clientAuth'],
    authorization_code_pkce: ['callbackUrl', 'authUrl', 'tokenUrl', 'clientId', 'clientSecret', 'challengeMethod', 'codeVerifier', 'scope', 'state', 'clientAuth'],
    implicit: ['callbackUrl', 'authUrl', 'clientId', 'scope', 'state'],
    password: ['tokenUrl', 'clientId', 'clientSecret', 'username', 'password', 'scope', 'clientAuth'],
    client_credentials: ['tokenUrl', 'clientId', 'clientSecret', 'scope', 'audience', 'clientAuth'],
  };
  const defs = {
    callbackUrl: ['Callback URL'], authUrl: ['Auth URL'], tokenUrl: ['Access Token URL'], clientId: ['Client ID'], clientSecret: ['Client Secret', 'secret'],
    scope: ['Scope'], state: ['State'], audience: ['Audience'], username: ['Username'], password: ['Password', 'secret'], codeVerifier: ['Code verifier (optional)'],
    challengeMethod: ['Code challenge method', ['S256', 'SHA-256'], ['plain', 'Plain']], clientAuth: ['Client authentication', ['header', 'Send as Basic Auth header'], ['body', 'Send client credentials in body']],
  };
  cfg.append(...field(a, ['tokenName', 'Token name'], onChange).childNodes);
  const gsel = field(a, ['grantType', 'Grant type', ['authorization_code', 'Authorization Code'], ['authorization_code_pkce', 'Authorization Code (With PKCE)'], ['implicit', 'Implicit'], ['password', 'Password Credentials'], ['client_credentials', 'Client Credentials']], () => { onChange(); renderAuth(el, a, onChange, opts); });
  cfg.append(...gsel.childNodes);
  if (!a.callbackUrl) a.callbackUrl = 'https://oauth.pstmn.io/v1/callback';
  for (const k of fieldsFor[a.grantType]) cfg.append(...field(a, [k, ...defs[k]], onChange).childNodes);
  el.append(cfg);
  const btns = h(`<div class="row-flex" style="margin-top:6px"><button class="primary">${icon('refresh')} Get New Access Token</button>${a.tokenInfo?.refresh_token ? `<button data-refresh>${icon('refresh')} Refresh token</button>` : ''}<button class="ghost" data-clear>Clear token</button></div>`);
  const get = async refresh => {
    const vars = opts.vars?.() || {};
    const c = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' ? resolve(v, vars) : v]));
    if (refresh) { c.grantType = 'refresh_token'; c.refreshToken = a.tokenInfo.refresh_token; }
    const b = btns.querySelector('.primary');
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Authorizing…';
    const r = await api.oauth2Token(c);
    b.disabled = false; b.innerHTML = `${icon('refresh')} Get New Access Token`;
    if (!r.ok) return toast('OAuth 2.0: ' + r.error, 'error');
    a.accessToken = r.token.access_token;
    a.tokenInfo = { ...r.token, refresh_token: r.token.refresh_token || a.tokenInfo?.refresh_token };
    if (r.token.token_type && /bearer/i.test(r.token.token_type)) a.headerPrefix = 'Bearer';
    onChange();
    renderAuth(el, a, onChange, opts);
    toast('Access token received');
  };
  btns.querySelector('.primary').onclick = () => get(false);
  btns.querySelector('[data-refresh]')?.addEventListener('click', () => get(true));
  btns.querySelector('[data-clear]').onclick = () => { a.accessToken = ''; a.tokenInfo = null; onChange(); renderAuth(el, a, onChange, opts); };
  el.append(btns);
  el.append(h(`<div class="dim" style="font-size:12px">Extra parameters sent to the token endpoint:</div>`));
  el.append(kvTable(a.extraTokenParams ||= [], onChange, { placeholder: ['Param', 'Value'] }));
}
