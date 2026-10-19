// Workspace (shared across windows, synced) and session (this window's tabs/layout) state.
import { uid, clone, kvRow, debounce, bus } from './ui.js';

export const W = {};   // workspace: collections, environments, globals, history, mocks, settings
export const T = {};   // session: tabs, active tab, closed-tab stack, layout
export const RT = new Map(); // tab id -> runtime state (responses, live connections); never persisted

export const DEFAULT_SETTINGS = {
  theme: 'system', layout: 'stacked', fontSize: 13, editorFontSize: 13, wordWrap: true,
  timeout: 0, followRedirects: true, maxRedirects: 10, sslVerify: false, sendNoCache: false,
  cookies: { enabled: true }, history: { enabled: true, max: 500 },
  proxy: { mode: 'none', url: '', user: '', pass: '', bypass: 'localhost,127.0.0.1' },
  ca: { on: false, path: '' }, certs: [], ai: { model: '' }, autoSaveTabs: true, confirmClose: true,
};

const blankWorkspace = () => ({ version: 2, collections: [], environments: [], activeEnv: null, globals: [], history: [], mocks: [], settings: clone(DEFAULT_SETTINGS) });
const blankSession = () => ({ tabs: [], active: 0, closed: [], ui: { side: 'collections', sideW: 280, sideHidden: false, aiOpen: false, aiW: 420, consoleOpen: false, consoleH: 240 } });

// ---------- persistence ----------
let suppress = false;
const flushW = debounce(() => api.wsSave(W), 250);
const flushT = debounce(() => api.sessionSave({ tabs: T.tabs, active: T.active, closed: T.closed.slice(-25), ui: T.ui }), 400);
export const saveW = () => { if (!suppress) flushW(); };
export const saveT = () => flushT();

export async function loadState() {
  const d = await api.wsLoad();
  Object.assign(W, blankWorkspace(), d.workspace || (d.legacy ? migrateV1(d.legacy) : {}));
  W.settings = deepDefaults(W.settings, DEFAULT_SETTINGS);
  if (!W.settings.tlsOffMigrated) { W.settings.sslVerify = false; W.settings.tlsOffMigrated = true; saveW(); } // v2.1: unverified TLS by default
  Object.assign(T, blankSession(), d.session || {});
  T.ui = { ...blankSession().ui, ...(d.session?.ui || {}) };
  T.closed ||= [];
  T.tabs = (T.tabs || []).filter(t => t && t.id);
  if (!d.workspace) api.wsSave(W);
  api.on('ws-changed', ws => {
    suppress = true;
    for (const k of Object.keys(W)) delete W[k];
    Object.assign(W, ws);
    suppress = false;
    bus.emit('workspace');
  });
  return d;
}
function deepDefaults(obj, defs) {
  const out = { ...defs, ...(obj || {}) };
  for (const [k, v] of Object.entries(defs)) if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...v, ...(obj?.[k] || {}) };
  return out;
}

// ---------- factories ----------
export const KINDS = {
  http: { label: 'HTTP', icon: 'globe', desc: 'REST / HTTP request' },
  graphql: { label: 'GraphQL', icon: 'box', desc: 'GraphQL query with schema explorer' },
  ws: { label: 'WebSocket', icon: 'plug', desc: 'Raw WebSocket connection' },
  socketio: { label: 'Socket.IO', icon: 'bolt', desc: 'Socket.IO v3/v4 client' },
  sse: { label: 'SSE', icon: 'download', desc: 'Server-Sent Events stream' },
  mqtt: { label: 'MQTT', icon: 'server', desc: 'MQTT 3.1.1 / 5 client' },
  grpc: { label: 'gRPC', icon: 'code', desc: 'gRPC unary & streaming' },
};
export const kindBadge = n => n.kind === 'http' || !n.kind ? n.method || 'GET' : { graphql: 'GQL', ws: 'WS', socketio: 'SIO', sse: 'SSE', mqtt: 'MQTT', grpc: 'gRPC' }[n.kind];

const base = (kind, name) => ({ id: uid(), kind, name, description: '' });
export function newItem(kind = 'http') {
  switch (kind) {
    case 'graphql': return { ...newItem('http'), kind: 'graphql', name: 'Untitled GraphQL', method: 'POST', body: { mode: 'graphql', raw: '', lang: 'json', urlencoded: [], formdata: [], binary: '', graphql: { query: 'query {\n  \n}', variables: '{}' } } };
    case 'ws': return { ...base('ws', 'Untitled WebSocket'), url: '', params: [], headers: [], settings: { protocols: '', handshakeTimeout: 30000, maxMessageMB: 100, sslVerify: true }, draft: { data: '', format: 'text' }, saved: [] };
    case 'socketio': return { ...base('socketio', 'Untitled Socket.IO'), url: '', params: [], headers: [], settings: { path: '/socket.io', transport: 'auto', auth: '', reconnect: false, ackTimeout: 10000, sslVerify: true }, draft: { event: 'message', data: '', format: 'json', ack: false }, listeners: [], saved: [] };
    case 'sse': return { ...base('sse', 'Untitled SSE'), url: '', params: [], headers: [], auth: { type: 'inherit' }, settings: { sslVerify: true } };
    case 'mqtt': return { ...base('mqtt', 'Untitled MQTT'), url: 'mqtt://test.mosquitto.org:1883', settings: { clientId: '', username: '', password: '', keepalive: 60, clean: true, version: 4, reconnect: false, sslVerify: true, will: { topic: '', payload: '', qos: 0, retain: false } }, topics: [kvRow('mypostmaster/#', '0')], draft: { topic: 'mypostmaster/hello', data: 'hello', qos: 0, retain: false }, saved: [] };
    case 'grpc': return { ...base('grpc', 'Untitled gRPC'), url: '', tls: false, source: { type: 'reflection', files: [], importPaths: [] }, service: '', method: '', message: '{}', metadata: [], auth: { type: 'inherit' }, settings: { deadlineMs: 0, sslVerify: true }, services: [] };
    case 'folder': return { ...base('folder', 'New Folder'), items: [], auth: { type: 'inherit' }, pre: '', tests: '', open: true };
    case 'collection': return { ...base('collection', 'New Collection'), items: [], vars: [], auth: { type: 'none' }, pre: '', tests: '', open: true };
    default: return {
      ...base('http', 'Untitled Request'), method: 'GET', url: '', params: [], pathVars: [], headers: [], auth: { type: 'inherit' },
      body: { mode: 'none', raw: '', lang: 'json', urlencoded: [], formdata: [], binary: '', graphql: { query: '', variables: '' } },
      pre: '', tests: '', settings: {}, examples: [],
    };
  }
}
export const isContainer = n => n && (n.kind === 'collection' || n.kind === 'folder' || (!n.kind && Array.isArray(n.items)));
export const isRequest = n => n && !isContainer(n);

// ---------- tree ----------
export function find(id, nodes = W.collections, trail = []) {
  if (!id) return null;
  for (const n of nodes) {
    if (n.id === id) return { node: n, list: nodes, parent: trail[trail.length - 1] || null, path: trail, collection: trail[0] || n };
    if (n.items) { const r = find(id, n.items, [...trail, n]); if (r) return r; }
    if (n.examples) {
      const ex = n.examples.find(e => e.id === id);
      if (ex) return { node: ex, list: n.examples, parent: n, path: [...trail, n], collection: trail[0], example: true };
    }
  }
  return null;
}
export function walk(fn, nodes = W.collections, trail = []) {
  for (const n of nodes) { fn(n, trail); if (n.items) walk(fn, n.items, [...trail, n]); }
}
export const flatRequests = node => (node.items || []).flatMap(i => isContainer(i) ? flatRequests(i) : [i]);
export const pathLabel = id => { const f = find(id); return f ? [...f.path.map(p => p.name), f.node.name].join(' / ') : ''; };
export function reId(node) { // deep copy with fresh ids (duplicate / paste)
  const c = clone(node);
  const fix = n => { n.id = uid(); n.items?.forEach(fix); n.examples?.forEach(e => e.id = uid()); };
  fix(c);
  return c;
}

// ---------- variables ----------
const mapOf = rows => Object.fromEntries((rows || []).filter(v => v.on !== false && v.key).map(v => [v.key, v.value ?? '']));
export const activeEnv = () => W.environments.find(e => e.id === W.activeEnv) || null;
export function scopes(colId) {
  const col = colId && W.collections.find(c => c.id === colId);
  return { globals: mapOf(W.globals), collection: mapOf(col?.vars), environment: mapOf(activeEnv()?.vars) };
}
// Postman precedence: local > data > environment > collection > global
export const varMap = (colId, extra = {}) => { const s = scopes(colId); return { ...s.globals, ...s.collection, ...s.environment, ...(extra.data || {}), ...(extra.local || {}) }; };
export function varList(colId) {
  const s = scopes(colId);
  const out = new Map();
  for (const [scope, m] of [['Global', s.globals], ['Collection', s.collection], ['Environment', s.environment]]) for (const [k, v] of Object.entries(m)) out.set(k, { key: k, value: v, scope });
  return [...out.values()];
}

// Postman dynamic variables live in dynamic.js (shared with the script sandbox).
const DYN = globalThis.MP_DYNAMIC;
export const DYNAMIC = DYN.vars;
export const resolve = (s, vars) => DYN.resolve(s, vars);
export const unresolved = (s, vars) => [...String(s ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m => m[1]).filter(k => !(k in vars) && !DYN.dynamicFor(k));
export const dynamicList = () => Object.keys(DYNAMIC).map(k => ({ key: k, value: 'dynamic', scope: 'Dynamic' }));

// ---------- v1 (single-file) data migration ----------
function migrateV1(d) {
  const mode = { json: ['raw', 'json'], text: ['raw', 'text'], xml: ['raw', 'xml'], html: ['raw', 'html'], urlencoded: ['urlencoded'], 'form-data': ['formdata'] };
  const req = r => {
    const n = newItem('http');
    const [m, lang] = mode[r.bodyType] || ['none'];
    return Object.assign(n, {
      id: r.id || n.id, name: r.name || n.name, method: r.method || 'GET', url: r.url || '', params: r.params || [], headers: r.headers || [],
      auth: !r.auth || r.auth.type === 'none' ? { type: 'inherit' } : r.auth,
      body: { ...n.body, mode: m, lang: lang || 'json', raw: r.body || '', urlencoded: r.urlencoded || [], formdata: r.form || [] },
      pre: r.pre || '', tests: r.tests || '', settings: r.settings?.timeout ? { timeout: r.settings.timeout * 1000, followRedirects: r.settings.followRedirects } : {},
    });
  };
  const item = i => i.items ? { ...newItem('folder'), id: i.id, name: i.name, items: i.items.map(item), open: !!i.open } : req(i);
  return {
    collections: (d.collections || []).map(c => ({ ...newItem('collection'), id: c.id, name: c.name, items: (c.items || []).map(item), vars: c.vars || [], open: !!c.open })),
    environments: d.environments || [], activeEnv: d.activeEnv || null,
    history: (d.history || []).map(x => ({ id: x.id, at: x.at, status: x.status, req: req(x.req) })),
  };
}
