const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const http = require('./http');
const { CookieJar } = require('./cookies');
const realtime = require('./realtime');
const grpc = require('./grpc');
const mock = require('./mock');
const ai = require('./ai');
const oauth2 = require('./oauth2');
const appimport = require('./appimport');

const ROOT = path.join(__dirname, '..', '..');
const UI = path.join(ROOT, 'src', 'renderer');
const DATA = app.getPath('userData');
const file = n => path.join(DATA, n);
const VERSION = require(path.join(ROOT, 'package.json')).version;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

// ---------- storage ----------
const readJson = n => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return null; } };
function writeJson(n, data) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(file(n) + '.tmp', JSON.stringify(data));
  fs.renameSync(file(n) + '.tmp', file(n)); // atomic: a crash can't truncate the user's collections
}

let primaryId = null;
const jar = new CookieJar(file('cookies.json'));
http.init(jar);

// ---------- app:// protocol (lets the UI use ES modules, workers and Monaco) ----------
function serve(req) {
  const u = new URL(req.url);
  const rel = decodeURIComponent(u.pathname);
  const [base, sub] = rel.startsWith('/node_modules/') ? [path.join(ROOT, 'node_modules'), rel.slice(14)]
    : rel.startsWith('/assets/icons/') ? [path.join(ROOT, 'icons'), rel.slice(14)] : [UI, rel.slice(1) || 'index.html'];
  const full = path.normalize(path.join(base, sub));
  if (!full.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
  if (rel === '/visualizer.html') {
    // Visualizer output runs user templates in an opaque-origin sandboxed iframe; let it load CDN scripts.
    return new Response(fs.readFileSync(full), { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src * app: data: blob: 'unsafe-inline' 'unsafe-eval'" } });
  }
  return net.fetch(pathToFileURL(full).toString());
}

// ---------- windows ----------
function createWindow() {
  const ws = readJson('workspace.json');
  const dark = ws?.settings?.theme !== 'light';
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 560, title: 'My Postmaster', icon: path.join(ROOT, 'icon.png'),
    backgroundColor: dark ? '#0f1218' : '#f6f7f9', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  if (primaryId === null) primaryId = win.webContents.id;
  win.loadURL('app://ui/index.html');
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  const wc = win.webContents;
  win.on('closed', () => { realtime.closeAllFor(wc); if (primaryId === wc.id) primaryId = null; });
  return win;
}

// ---------- IPC ----------
const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));

h('ws:load', e => {
  const workspace = readJson('workspace.json');
  if (workspace?.settings) http.setSettings({ ...workspace.settings, version: VERSION });
  return { workspace, session: e.sender.id === primaryId ? readJson('session.json') : null, legacy: workspace ? null : readJson('data.json'), primary: e.sender.id === primaryId, version: VERSION };
});
h('ws:save', (e, ws) => {
  writeJson('workspace.json', ws);
  http.setSettings({ ...ws.settings, version: VERSION });
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents.id !== e.sender.id) w.webContents.send('ws-changed', ws);
});
h('session:save', (e, s) => { if (e.sender.id === primaryId) writeJson('session.json', s); });

h('http:send', (_e, r) => http.send(r));
h('http:cancel', (_e, id) => http.cancel(id));
h('oauth2:token', async (e, cfg) => { try { return { ok: true, token: await oauth2.getToken(BrowserWindow.fromWebContents(e.sender), cfg) }; } catch (err) { return { ok: false, error: err.message }; } });

h('rt:connect', (e, c) => realtime.connect(e.sender, c));
h('rt:call', (_e, id, method, ...args) => realtime.call(id, method, ...args));

h('grpc:load', (_e, src, meta) => grpc.load(src, meta));
h('grpc:invoke', (e, c) => grpc.invoke(e.sender, c));
h('grpc:write', (_e, id, m) => grpc.write(id, m));
h('grpc:end', (_e, id) => grpc.end(id));
h('grpc:cancel', (_e, id) => grpc.cancel(id));

h('mock:start', (e, m) => mock.start(e.sender, m));
h('mock:stop', (_e, id) => mock.stop(id));
h('mock:running', () => mock.running());

h('cookies:list', () => jar.list());
h('cookies:upsert', (_e, c) => jar.upsert(c));
h('cookies:remove', (_e, d, n, p) => jar.remove(d, n, p));
h('cookies:clear', () => jar.clear());

h('ai:status', () => ai.status());
h('ai:ask', (e, q) => ai.ask(e.sender, q));
h('ai:cancel', (_e, id) => ai.cancel(id));

h('appimport:sources', () => appimport.sources());
h('appimport:read', (_e, id) => appimport.read(id));

h('dialog:open', async (e, o = {}) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: [o.directory ? 'openDirectory' : 'openFile', ...(o.multi ? ['multiSelections'] : [])], filters: o.filters,
  });
  if (r.canceled) return null;
  return r.filePaths.map(p => ({ path: p, name: path.basename(p), text: o.text ? fs.readFileSync(p, 'utf8') : undefined }));
});
h('dialog:save', async (e, o) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: o.name });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, o.base64 != null ? Buffer.from(o.base64, 'base64') : o.text);
  return r.filePath;
});
h('file:read', (_e, p) => fs.readFileSync(p, 'utf8'));

h('app:newWindow', () => { createWindow(); });
h('app:devtools', e => e.sender.toggleDevTools());
h('app:find', (e, text, opts) => text ? e.sender.findInPage(text, opts) : e.sender.stopFindInPage('clearSelection'));
h('app:openExternal', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // the default menu binds Ctrl+W/Ctrl+R etc. — shortcuts are handled in the UI
  protocol.handle('app', serve);
  createWindow();
});
app.on('web-contents-created', (_e, wc) => wc.on('found-in-page', (_ev, r) => wc.send('find-result', r)));
app.on('window-all-closed', () => { mock.stopAll(); app.quit(); });
