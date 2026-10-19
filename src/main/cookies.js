// Minimal RFC 6265 cookie jar, persisted to disk. Shared by every window and request.
const fs = require('fs');

class CookieJar {
  constructor(file) {
    this.file = file;
    try { this.cookies = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.cookies = []; }
  }

  save() {
    this.purge();
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.cookies));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  purge() {
    const now = Date.now();
    this.cookies = this.cookies.filter(c => !c.expires || c.expires > now);
  }

  // Store cookies from Set-Cookie headers received for `url`. Returns the parsed cookies.
  setFromResponse(url, setCookies) {
    const u = new URL(url);
    const out = [];
    for (const line of setCookies) {
      const c = parseSetCookie(line, u);
      if (!c) continue;
      out.push(c);
      this.cookies = this.cookies.filter(x => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
      if (!c.expires || c.expires > Date.now()) this.cookies.push(c);
    }
    if (out.length) this.save();
    return out;
  }

  headerFor(url) {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const now = Date.now();
    return this.cookies
      .filter(c => (!c.expires || c.expires > now)
        && (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain))
        && pathMatch(u.pathname || '/', c.path)
        && (!c.secure || u.protocol === 'https:' || u.protocol === 'wss:'))
      .sort((a, b) => b.path.length - a.path.length)
      .map(c => `${c.name}=${c.value}`).join('; ');
  }

  list() { this.purge(); return this.cookies; }
  upsert(c) {
    this.cookies = this.cookies.filter(x => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
    this.cookies.push({ path: '/', hostOnly: false, secure: false, httpOnly: false, expires: null, ...c, domain: c.domain.replace(/^\./, '').toLowerCase() });
    this.save();
  }
  remove(domain, name, path) {
    this.cookies = this.cookies.filter(c => !(c.domain === domain && (name == null || (c.name === name && (path == null || c.path === path)))));
    this.save();
  }
  clear() { this.cookies = []; this.save(); }
}

function pathMatch(reqPath, cookiePath) {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}

function parseSetCookie(line, u) {
  const [pair, ...attrs] = line.split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  const host = u.hostname.toLowerCase();
  const defPath = u.pathname.lastIndexOf('/') > 0 ? u.pathname.slice(0, u.pathname.lastIndexOf('/')) : '/';
  const c = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: host, hostOnly: true, path: defPath, secure: false, httpOnly: false, expires: null, sameSite: '' };
  let maxAge = null;
  for (const a of attrs) {
    const i = a.indexOf('=');
    const k = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase();
    const v = i < 0 ? '' : a.slice(i + 1).trim();
    if (k === 'domain' && v) {
      const d = v.replace(/^\./, '').toLowerCase();
      if (host !== d && !host.endsWith('.' + d)) return null; // a site can't set cookies for another domain
      c.domain = d; c.hostOnly = false;
    }
    else if (k === 'path' && v.startsWith('/')) c.path = v;
    else if (k === 'expires') { const t = Date.parse(v); if (!isNaN(t)) c.expires = t; }
    else if (k === 'max-age') maxAge = parseInt(v, 10);
    else if (k === 'secure') c.secure = true;
    else if (k === 'httponly') c.httpOnly = true;
    else if (k === 'samesite') c.sameSite = v;
  }
  if (maxAge != null && !isNaN(maxAge)) c.expires = maxAge <= 0 ? 1 : Date.now() + maxAge * 1000;
  return c;
}

module.exports = { CookieJar, parseSetCookie };
