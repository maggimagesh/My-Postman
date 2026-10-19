// Reads collections that other API clients installed on this machine keep in their local cache.
// Postman and EchoAPI are Electron apps storing data in Chromium IndexedDB, so we open a throwaway
// copy of that folder with our own Chromium — never their live files.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APPDATA = app.getPath('appData');

function postmanDir() {
  const base = path.join(APPDATA, 'Postman');
  let active = null;
  try { active = JSON.parse(fs.readFileSync(path.join(base, 'storage', 'userPartitionData.json'), 'utf8')).v8PartitionsNamespaceMeta?.users?.activePartition; } catch {}
  const parts = path.join(base, 'Partitions');
  const has = p => fs.existsSync(path.join(parts, p, 'IndexedDB', 'https_desktop.postman.com_0.indexeddb.leveldb'));
  const pick = active && has(active) ? active : (fs.existsSync(parts) ? fs.readdirSync(parts).find(has) : null);
  return pick ? path.join(parts, pick, 'IndexedDB') : null;
}

// want: [dbNameRegex, storeName] pairs to dump
const SOURCES = {
  postman: { name: 'Postman', origin: 'https://desktop.postman.com', dir: postmanDir, want: [['-v3-collections$', 'v3-collections']] },
  echoapi: { name: 'EchoAPI', origin: 'app://localhost', dir: () => path.join(APPDATA, 'EchoAPI', 'IndexedDB'), want: [['^lately$', 'lately_save']] },
};

const sources = () => Object.entries(SOURCES).map(([id, s]) => { const d = s.dir(); return { id, name: s.name, found: !!d && fs.existsSync(d) }; });

async function read(id) {
  const s = SOURCES[id];
  const dir = s?.dir();
  if (!dir || !fs.existsSync(dir)) throw new Error(`${s?.name || id} data not found on this machine`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-appimport-'));
  try {
    fs.cpSync(dir, path.join(tmp, 'IndexedDB'), { recursive: true, filter: f => path.basename(f) !== 'LOCK' }); // LOCK is held while the app runs
    const ses = session.fromPath(tmp);
    // Serve a blank page for the app's origin so IndexedDB opens under it; nothing goes to the network.
    ses.protocol.handle(new URL(s.origin).protocol.slice(0, -1), () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }));
    const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
    try {
      await win.loadURL(s.origin + '/');
      return await win.webContents.executeJavaScript(`(async () => {
        const want = ${JSON.stringify(s.want)}, rows = [];
        for (const d of await indexedDB.databases()) {
          const stores = want.filter(([re]) => new RegExp(re).test(d.name)).map(w => w[1]);
          if (!stores.length) continue;
          const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
          for (const st of stores) if (db.objectStoreNames.contains(st)) rows.push(...await new Promise((ok, no) => { const r = db.transaction(st).objectStore(st).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
          db.close();
        }
        return rows;
      })()`);
    } finally { win.destroy(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { sources, read };
