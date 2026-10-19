// One-click import from API clients installed on this machine (Postman, EchoAPI).
// Main reads their local cache; here we convert it to Postman v2.1 and reuse the normal importer.
import { W, saveW } from './state.js';
import { h, esc, toast, modal } from './ui.js';
import { fromPostmanCollection } from './importers.js';

const RAW_LANG = { json: 'json', xml: 'xml', html: 'html', javascript: 'javascript', text: 'text', plain: 'text', raw: 'text' };
const kv = (rows, map = x => x) => (rows || []).map(map).filter(x => x?.key).map(x => ({ key: x.key, value: x.value ?? '', ...(x.disabled ? { disabled: true } : {}), ...(x.description ? { description: x.description } : {}) }));
const event = (listen, code) => code?.trim() ? [{ listen, script: { type: 'text/javascript', exec: code.split('\n') } }] : [];

// ---------- Postman (desktop v3 cache: flat records, collections list their children by id) ----------
export function postmanCollections(rows) {
  const byId = new Map(rows.map(r => [r.value?.id, r.value]).filter(([id]) => id));
  const children = new Set([...byId.values()].flatMap(n => (n.items || []).map(i => i.id)));
  const out = [];
  for (const n of byId.values()) {
    if (n.$kind !== 'collection' || children.has(n.id)) continue;
    const stats = { requests: 0, partial: 0 };
    const item = (n.items || []).map(ref => postmanItem(byId, ref, stats)).filter(Boolean);
    out.push({
      key: 'postman:' + n.id, name: n.name || 'Postman collection', ...stats,
      json: { info: { name: n.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item, variable: kv(n.variables), event: postmanEvents(n.scripts) },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const postmanEvents = scripts => [...event('prerequest', (scripts || []).find(s => s.type === 'beforeRequest')?.code), ...event('test', (scripts || []).find(s => s.type === 'afterResponse')?.code)];
function postmanItem(byId, ref, stats) {
  const n = byId.get(ref.id);
  if (ref.$kind === 'collection') return { name: n?.name || 'Folder', item: (n?.items || []).map(r => postmanItem(byId, r, stats)).filter(Boolean), event: postmanEvents(n?.scripts) };
  if (ref.$kind !== 'http-request' || !n) return null;
  stats.requests++;
  if (n.isPartial) stats.partial++;
  const b = n.body, c = b?.content;
  const body = !b?.type ? undefined
    : b.type === 'formdata' ? { mode: 'formdata', formdata: (c || []).filter(x => x.key).map(x => ({ key: x.key, type: x.type === 'file' ? 'file' : 'text', ...(x.type === 'file' ? { src: x.src ?? x.value } : { value: x.value ?? '' }), ...(x.disabled ? { disabled: true } : {}) })) }
      : b.type === 'urlencoded' ? { mode: 'urlencoded', urlencoded: kv(c) }
        : b.type === 'graphql' ? { mode: 'graphql', graphql: { query: c?.query || '', variables: c?.variables || '' } }
          : typeof c === 'string' ? { mode: 'raw', raw: c, options: { raw: { language: RAW_LANG[b.type] || 'text' } } } : undefined;
  return {
    name: n.name || 'Request',
    request: { method: n.method || n.descriptor || 'GET', url: n.url || '', header: kv(n.headers), ...(body ? { body } : {}), ...(Array.isArray(n.auth?.[n.auth?.type]) ? { auth: n.auth } : {}) },
    event: postmanEvents(n.scripts),
  };
}

// ---------- EchoAPI (local cache only holds recently saved APIs, grouped here by project) ----------
export function echoCollections(rows) {
  const projects = new Map();
  for (const r of rows) if (!(r.is_deleted > 0)) { if (!projects.has(r.project_id)) projects.set(r.project_id, []); projects.get(r.project_id).push(r); }
  return [...projects].map(([pid, list]) => {
    list.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const nodes = new Map(list.map(r => [r.target_id, r.target_type === 'folder' ? { name: r.name || 'Folder', item: [] } : echoRequest(r)]));
    const root = [];
    for (const r of list) (nodes.get(r.parent_id)?.item || root).push(nodes.get(r.target_id));
    return { key: 'echoapi:' + pid, name: `EchoAPI project ${pid}`, requests: list.filter(r => r.target_type !== 'folder').length, partial: 0, recentOnly: true, json: { info: { name: `EchoAPI project ${pid}` }, item: root } };
  });
}
function echoRequest(r) {
  const q = r.request || {}, b = q.body || {};
  const params = a => kv(a?.parameter, p => ({ key: p.key, value: p.value, disabled: !p.is_checked, description: p.description }));
  const body = b.mode === 'form-data' ? { mode: 'formdata', formdata: (b.parameter || []).filter(p => p.key).map(p => ({ key: p.key, ...(p.file_name || /file/i.test(p.field_type) ? { type: 'file', src: p.file_name || p.value } : { type: 'text', value: p.value ?? '' }), ...(p.is_checked ? {} : { disabled: true }) })) }
    : b.mode === 'urlencoded' ? { mode: 'urlencoded', urlencoded: params(b) }
      : RAW_LANG[b.mode] ? { mode: 'raw', raw: b.raw || '', options: { raw: { language: RAW_LANG[b.mode] } } } : undefined;
  const a = q.auth || {};
  const auth = a.type === 'bearer' ? { type: 'bearer', bearer: [{ key: 'token', value: a.bearer?.key || '' }] }
    : a.type === 'basic' ? { type: 'basic', basic: [{ key: 'username', value: a.basic?.username || '' }, { key: 'password', value: a.basic?.password || '' }] }
      : a.type === 'noauth' ? { type: 'noauth' } : undefined; // 'inherit' = no auth block
  const script = tasks => (tasks || []).filter(t => t.type === 'customScript' && t.enabled).map(t => t.data).join('\n');
  return {
    name: r.name || 'Request',
    request: { method: r.method || 'GET', url: r.url || '', header: params(q.header), ...(body ? { body } : {}), ...(auth ? { auth } : {}), ...(r.description ? { description: r.description } : {}) },
    event: [...event('prerequest', script(q.pre_tasks)), ...event('test', script(q.post_tasks))],
  };
}

const CONVERT = { postman: postmanCollections, echoapi: echoCollections };

// ---------- dialog ----------
export async function appImportDialog(sourceId) {
  const sources = await api.appimportSources();
  const src = sources.find(s => s.id === sourceId);
  if (!src?.found) return toast(`${src?.name || sourceId} is not installed or has no local data`, 'error');
  let list;
  try { list = CONVERT[sourceId](await api.appimportRead(sourceId)); } catch (e) { return toast(`Could not read ${src.name}: ${e.message}`, 'error'); }
  if (!list.length) return toast(`No collections found in ${src.name}'s local data`, 'error');
  // Collections imported earlier from a file carry no source tag, so a same-named collection counts too.
  const imported = new Set(W.collections.flatMap(c => [c.source, 'name:' + c.name?.trim().toLowerCase()]).filter(Boolean));
  const isDone = c => imported.has(c.key) || imported.has('name:' + c.name.trim().toLowerCase());
  const fresh = list.filter(c => !isDone(c));
  const body = h(`<div class="col-flex">
    <div class="dim" style="font-size:12px">Read from ${esc(src.name)}'s local data on this computer. Nothing in ${esc(src.name)} is changed.</div>
    ${list.some(c => c.partial) ? `<div class="callout warn">${src.name} keeps some request details only in its cloud. Requests marked partial come in with name, method and URL only — open them in ${src.name} once to cache the full request, then re-import.</div>` : ''}
    ${list.some(c => c.recentOnly) ? `<div class="callout">${src.name} only keeps recently saved APIs on disk, so only those are listed.</div>` : ''}
    <label class="node"><input type="checkbox" data-all ${fresh.length ? 'checked' : 'disabled'}><b class="nm">Select all</b><span class="dim">${fresh.length} of ${list.length} not imported yet</span></label>
    <div class="col-flex" data-list style="max-height:50vh;overflow:auto"></div></div>`);
  const boxes = [];
  for (const c of list) {
    const done = isDone(c);
    const row = h(`<label class="node" style="${done ? 'opacity:.5' : ''}" title="${done ? 'Already imported' : ''}"><input type="checkbox" ${done ? 'disabled' : 'checked'}><span class="nm">${esc(c.name)}</span>
      <span class="dim">${done ? 'Imported' : `${c.requests} request${c.requests === 1 ? '' : 's'}${c.partial ? ` · ${c.partial} partial` : ''}`}</span></label>`);
    if (!done) boxes.push([row.querySelector('input'), c]);
    body.querySelector('[data-list]').append(row);
  }
  const all = body.querySelector('[data-all]');
  all.onchange = () => boxes.forEach(([b]) => { b.checked = all.checked; });
  for (const [b] of boxes) b.onchange = () => { all.checked = boxes.every(([x]) => x.checked); };
  return modal({
    title: `Import from ${src.name}`, cls: 'wide', body,
    buttons: [['Cancel', null], ['Import', () => {
      const pick = boxes.filter(([b]) => b.checked).map(([, c]) => c);
      if (!pick.length) { toast('Select at least one collection', 'error'); return false; }
      for (const c of pick) W.collections.push(Object.assign(fromPostmanCollection(c.json), { source: c.key }));
      saveW();
      toast(`Imported ${pick.length} collection${pick.length === 1 ? '' : 's'} from ${src.name}`);
      return pick.length;
    }, 'primary']],
  });
}
