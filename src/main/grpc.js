// gRPC client: service definitions from .proto files or server reflection; unary and all streaming modes.
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const { tlsVerify } = require('./http');
const { GrpcReflection } = require('grpc-js-reflection-client');

const LOADER = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true };
const defs = new Map();      // source key -> packageDefinition
const calls = new Map();     // session id -> active call
const statusName = Object.fromEntries(Object.entries(grpc.status).map(([k, v]) => [v, k]));

function target(url) {
  const m = /^(grpcs?):\/\/(.*)$/i.exec(url.trim());
  const rest = (m ? m[2] : url.trim().replace(/^https?:\/\//, '')).replace(/\/.*$/, '');
  return { addr: rest, tls: m ? m[1].toLowerCase() === 'grpcs' : null };
}
function creds(c) {
  const tls = c.tls ?? target(c.url).tls;
  if (!tls) return grpc.credentials.createInsecure();
  const read = p => p ? fs.readFileSync(p) : null;
  return grpc.credentials.createSsl(read(c.caPath), read(c.keyPath), read(c.certPath), !tlsVerify(c.sslVerify) ? { rejectUnauthorized: false, checkServerIdentity: () => undefined } : {});
}
const toMeta = pairs => { const m = new grpc.Metadata(); for (const [k, v] of pairs || []) if (k) m.add(k.toLowerCase(), k.toLowerCase().endsWith('-bin') ? Buffer.from(v, 'base64') : String(v)); return m; };
const fromMeta = m => m ? Object.entries(m.getMap()).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString('base64') : String(v)]) : [];

function describe(pkgDef) {
  const messages = {}, enums = {};
  for (const [name, v] of Object.entries(pkgDef)) {
    if (v.format === 'Protocol Buffer 3 DescriptorProto') messages[name] = v.type;
    if (v.format === 'Protocol Buffer 3 EnumDescriptorProto') enums[name] = v.type;
  }
  const sample = (typeName, depth = 0) => {
    const t = messages[typeName.replace(/^\./, '')];
    if (!t || depth > 5) return {};
    const out = {};
    for (const f of t.field) {
      let v;
      const tn = (f.typeName || '').replace(/^\./, '');
      if (f.type === 'TYPE_MESSAGE') {
        const sub = messages[tn];
        if (sub?.options?.mapEntry) { out[f.name] = {}; continue; }
        v = tn === 'google.protobuf.Timestamp' ? new Date().toISOString() : sample(tn, depth + 1);
      } else if (f.type === 'TYPE_ENUM') v = enums[tn]?.value?.[0]?.name ?? 0;
      else if (f.type === 'TYPE_BOOL') v = false;
      else if (f.type === 'TYPE_STRING') v = '';
      else if (f.type === 'TYPE_BYTES') v = '';
      else if (/INT64|FIXED64/.test(f.type)) v = '0';
      else v = 0;
      out[f.name] = f.label === 'LABEL_REPEATED' ? [v] : v;
    }
    return out;
  };
  // Method descriptors only carry the short message name; prefer the service's own package.
  const fqnOf = (short, svc) => {
    const pkg = svc.split('.').slice(0, -1).join('.');
    if (messages[pkg ? `${pkg}.${short}` : short]) return pkg ? `${pkg}.${short}` : short;
    return Object.keys(messages).find(k => k === short || k.endsWith('.' + short));
  };
  const services = [];
  for (const [name, v] of Object.entries(pkgDef)) {
    if (v.format) continue;
    const methods = Object.entries(v).map(([mName, m]) => ({
      name: mName, rpcName: mName, requestStream: m.requestStream, responseStream: m.responseStream,
      requestType: m.requestType?.type?.name, responseType: m.responseType?.type?.name,
      sample: JSON.stringify(sample(fqnOf(m.requestType?.type?.name || '', name) || ''), null, 2),
    }));
    services.push({ name, methods });
  }
  return services;
}

async function loadSource(src, meta) {
  const key = JSON.stringify(src);
  if (defs.has(key)) return defs.get(key);
  let pkgDef;
  if (src.type === 'reflection') {
    const client = new GrpcReflection(target(src.url).addr, creds(src));
    const names = (await client.listServices('*', toMeta(meta))).filter(s => !s.startsWith('grpc.reflection.'));
    pkgDef = {};
    for (const n of names) Object.assign(pkgDef, (await client.getDescriptorBySymbol(n, toMeta(meta))).getPackageDefinition(LOADER));
  } else {
    if (!src.files?.length) throw new Error('Add a .proto file or enable server reflection');
    pkgDef = await protoLoader.load(src.files, { ...LOADER, includeDirs: src.importPaths || [] });
  }
  defs.set(key, pkgDef);
  return pkgDef;
}

async function load(src, meta) {
  try {
    defs.delete(JSON.stringify(src));
    const pkgDef = await loadSource(src, meta);
    return { ok: true, services: describe(pkgDef) };
  } catch (e) { return { ok: false, error: e.details || e.message }; }
}

function clientFor(pkgDef, c) {
  const pkgObj = grpc.loadPackageDefinition(pkgDef);
  const Svc = c.service.split('.').reduce((o, k) => o?.[k], pkgObj);
  if (!Svc) throw new Error(`Service ${c.service} not found`);
  return new Svc(target(c.url).addr, creds(c), { 'grpc.max_receive_message_length': -1, 'grpc.max_send_message_length': -1 });
}

async function invoke(wc, c) {
  const t0 = performance.now();
  const emit = (kind, data = {}) => { if (!wc.isDestroyed()) wc.send('rt-event', { id: c.id, kind, ts: Date.now(), ...data }); };
  try {
    const pkgDef = await loadSource(c.source, c.metadata);
    const client = clientFor(pkgDef, c);
    const def = pkgDef[c.service][c.method];
    if (!def) throw new Error(`Method ${c.method} not found on ${c.service}`);
    let msg;
    try { msg = JSON.parse(c.message || '{}'); } catch (e) { throw new Error('Message is not valid JSON: ' + e.message); }
    const opts = c.deadlineMs ? { deadline: Date.now() + c.deadlineMs } : {};
    const meta = toMeta(c.metadata);
    let headers = [];
    if (!def.requestStream && !def.responseStream) {
      return await new Promise(resolve => {
        const call = client[c.method](msg, meta, opts, (err, res) => {
          const time = Math.round(performance.now() - t0);
          if (err) resolve({ ok: true, status: { code: err.code, name: statusName[err.code], details: err.details }, metadata: headers, trailers: fromMeta(err.metadata), time });
          else call.once('status', s => resolve({ ok: true, status: { code: 0, name: 'OK', details: s.details }, message: JSON.stringify(res, null, 2), metadata: headers, trailers: fromMeta(s.metadata), time }));
        });
        call.on('metadata', m => { headers = fromMeta(m); });
        calls.set(c.id, call);
      });
    }
    // Streaming: events go to the window like a realtime session.
    let call;
    const onEnd = (err, res) => { if (res) emit('message', { data: JSON.stringify(res, null, 2) }); };
    if (def.requestStream && def.responseStream) call = client[c.method](meta, opts);
    else if (def.requestStream) call = client[c.method](meta, opts, (err, res) => err ? null : onEnd(null, res));
    else call = client[c.method](msg, meta, opts);
    calls.set(c.id, call);
    emit('open', { text: `Stream opened: ${c.service}/${c.method}` });
    call.on('metadata', m => emit('info', { text: 'Response metadata', headers: fromMeta(m) }));
    call.on('data', d => emit('message', { data: JSON.stringify(d, null, 2) }));
    call.on('error', () => {});
    call.on('status', s => { emit(s.code ? 'error' : 'info', { text: `Status ${s.code} ${statusName[s.code]}${s.details ? ': ' + s.details : ''}`, headers: fromMeta(s.metadata) }); emit('close', { text: `Stream closed (${Math.round(performance.now() - t0)} ms)` }); calls.delete(c.id); });
    if (def.requestStream) { call.write(msg); emit('sent', { data: JSON.stringify(msg, null, 2) }); }
    return { ok: true, streaming: true, clientStream: def.requestStream };
  } catch (e) {
    return { ok: false, error: e.details || e.message, time: Math.round(performance.now() - t0) };
  }
}

function write(id, message) {
  const call = calls.get(id);
  if (!call?.write) return { ok: false, error: 'No open client stream' };
  try { call.write(JSON.parse(message || '{}')); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
const end = id => { calls.get(id)?.end?.(); return { ok: true }; };
const cancel = id => { calls.get(id)?.cancel?.(); calls.delete(id); return { ok: true }; };

module.exports = { load, invoke, write, end, cancel };
