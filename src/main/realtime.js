// Long-lived connections: WebSocket, Socket.IO, Server-Sent Events and MQTT.
// Each session streams events to its window on the 'rt-event' channel.
const WebSocket = require('ws');
const { io } = require('socket.io-client');
const mqtt = require('mqtt');
const { request } = require('undici');
const http = require('./http');

const sessions = new Map();

function emitter(wc, id) {
  return (kind, data = {}) => { if (!wc.isDestroyed()) wc.send('rt-event', { id, kind, ts: Date.now(), ...data }); };
}
const headerObj = headers => Object.fromEntries((headers || []).filter(([k]) => k));
const asText = d => Buffer.isBuffer(d) || d instanceof ArrayBuffer ? Buffer.from(d).toString('utf8') : typeof d === 'string' ? d : JSON.stringify(d);

function connectWs(c, emit) {
  const ws = new WebSocket(c.url, c.protocols?.length ? c.protocols : undefined, {
    headers: headerObj(c.headers), handshakeTimeout: c.handshakeTimeout || 30000,
    rejectUnauthorized: http.tlsVerify(c.sslVerify), followRedirects: true, maxPayload: (c.maxMessageMB || 100) * 1048576,
  });
  ws.on('upgrade', res => emit('info', { text: `Handshake ${res.statusCode}`, headers: Object.entries(res.headers) }));
  ws.on('unexpected-response', (_req, res) => { emit('error', { text: `Unexpected server response: ${res.statusCode} ${res.statusMessage}` }); });
  ws.on('open', () => emit('open', { text: `Connected to ${c.url}` + (ws.protocol ? ` (protocol ${ws.protocol})` : '') }));
  ws.on('message', (data, isBinary) => emit('message', isBinary ? { binary: true, data: Buffer.from(data).toString('base64'), size: data.length } : { data: data.toString('utf8'), size: data.length }));
  ws.on('ping', () => emit('info', { text: 'Ping received' }));
  ws.on('pong', () => emit('info', { text: 'Pong received' }));
  ws.on('close', (code, reason) => { emit('close', { text: `Disconnected (${code}${reason?.length ? ' ' + reason : ''})` }); sessions.delete(c.id); });
  ws.on('error', e => emit('error', { text: e.message }));
  return {
    send: m => {
      const payload = m.binary ? Buffer.from(m.data, 'base64') : m.data;
      ws.send(payload, { binary: !!m.binary });
      emit('sent', { data: m.data, binary: !!m.binary, size: payload.length });
    },
    ping: () => ws.ping(),
    close: () => ws.close(1000, 'Closed by client'),
  };
}

function connectSocketIo(c, emit) {
  const u = new URL(c.url.replace(/^ws/, 'http'));
  let auth;
  try { auth = c.auth ? JSON.parse(c.auth) : undefined; } catch { throw new Error('Socket.IO auth must be JSON'); }
  const sock = io(u.origin + (u.pathname !== '/' ? u.pathname : ''), {
    path: c.path || '/socket.io', extraHeaders: headerObj(c.headers), auth, query: Object.fromEntries(u.searchParams),
    transports: c.transport === 'polling' ? ['polling'] : c.transport === 'websocket' ? ['websocket'] : ['polling', 'websocket'],
    reconnection: !!c.reconnect, forceNew: true, rejectUnauthorized: http.tlsVerify(c.sslVerify), timeout: c.handshakeTimeout || 20000,
  });
  sock.on('connect', () => emit('open', { text: `Connected (id ${sock.id})` }));
  sock.on('disconnect', reason => { emit('close', { text: `Disconnected: ${reason}` }); if (!c.reconnect) { sessions.delete(c.id); sock.close(); } });
  sock.on('connect_error', e => { emit('error', { text: `Connection error: ${e.message}` }); if (!c.reconnect) { sessions.delete(c.id); sock.close(); emit('close', { text: 'Disconnected' }); } });
  sock.onAny((event, ...args) => emit('message', { event, data: args.length === 1 ? asText(args[0]) : JSON.stringify(args) }));
  return {
    send: m => {
      let args = [];
      for (const a of m.args || [m.data]) { try { args.push(m.json === false ? a : JSON.parse(a)); } catch { args.push(a); } }
      if (m.ack) sock.timeout(c.ackTimeout || 10000).emit(m.event || 'message', ...args, (err, ...res) => emit(err ? 'error' : 'message', err ? { text: `Ack timeout for "${m.event}"` } : { event: `ack: ${m.event}`, data: res.length === 1 ? asText(res[0]) : JSON.stringify(res) }));
      else sock.emit(m.event || 'message', ...args);
      emit('sent', { event: m.event || 'message', data: (m.args || [m.data]).join(', ') });
    },
    close: () => { sock.close(); },
  };
}

function connectSse(c, emit) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const headers = [['Accept', 'text/event-stream'], ['Cache-Control', 'no-cache'], ...(c.headers || [])];
      const res = await request(c.url, { method: c.method || 'GET', headers: headers.flat(), body: c.body || null, signal: ctrl.signal, dispatcher: http.dispatcherFor(c.url, { sslVerify: http.tlsVerify(c.sslVerify) }), bodyTimeout: 0, headersTimeout: 0 });
      emit(res.statusCode < 300 ? 'open' : 'error', { text: `HTTP ${res.statusCode} — ${res.headers['content-type'] || ''}`, headers: Object.entries(res.headers) });
      if (res.statusCode >= 300) { emit('message', { event: 'body', data: await res.body.text() }); throw Object.assign(new Error('closed'), { quiet: true }); }
      let buf = '', ev = { event: '', data: [], id: '' };
      for await (const chunk of res.body) {
        buf += chunk.toString('utf8');
        let i;
        while ((i = buf.search(/\r?\n/)) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
          if (line === '') {
            if (ev.data.length) emit('message', { event: ev.event || 'message', data: ev.data.join('\n'), lastEventId: ev.id });
            ev = { event: '', data: [], id: ev.id };
          } else if (!line.startsWith(':')) {
            const j = line.indexOf(':');
            const field = j < 0 ? line : line.slice(0, j);
            const val = j < 0 ? '' : line.slice(j + 1).replace(/^ /, '');
            if (field === 'data') ev.data.push(val);
            else if (field === 'event') ev.event = val;
            else if (field === 'id') ev.id = val;
            else if (field === 'retry') emit('info', { text: `Server retry hint: ${val} ms` });
          }
        }
      }
      emit('close', { text: 'Stream ended by server' });
    } catch (e) {
      if (!e.quiet && !ctrl.signal.aborted) emit('error', { text: e.message });
      emit('close', { text: 'Disconnected' });
    } finally { sessions.delete(c.id); }
  })();
  return { send: () => { throw new Error('SSE is receive-only'); }, close: () => ctrl.abort() };
}

function connectMqtt(c, emit) {
  const client = mqtt.connect(c.url, {
    clientId: c.clientId || 'mypostmaster_' + Math.random().toString(16).slice(2, 10), username: c.username || undefined, password: c.password || undefined,
    clean: c.clean !== false, keepalive: c.keepalive ?? 60, protocolVersion: c.version === 5 ? 5 : 4, reconnectPeriod: c.reconnect ? 2000 : 0,
    connectTimeout: c.handshakeTimeout || 30000, rejectUnauthorized: http.tlsVerify(c.sslVerify),
    will: c.will?.topic ? { topic: c.will.topic, payload: c.will.payload || '', qos: +c.will.qos || 0, retain: !!c.will.retain } : undefined,
  });
  client.on('connect', () => {
    emit('open', { text: `Connected to ${c.url}` });
    for (const t of c.topics || []) if (t.on !== false && t.key) client.subscribe(t.key, { qos: +t.value || 0 }, (err) => emit(err ? 'error' : 'info', { text: err ? `Subscribe ${t.key} failed: ${err.message}` : `Subscribed to ${t.key} (QoS ${+t.value || 0})` }));
  });
  client.on('message', (topic, payload, packet) => emit('message', { event: topic, data: payload.toString('utf8'), qos: packet.qos, retain: packet.retain, size: payload.length }));
  client.on('error', e => emit('error', { text: e.message }));
  client.on('close', () => { emit('close', { text: 'Disconnected' }); if (!c.reconnect) { sessions.delete(c.id); client.end(true); } });
  return {
    send: m => client.publish(m.event, m.data ?? '', { qos: +m.qos || 0, retain: !!m.retain }, err => emit(err ? 'error' : 'sent', err ? { text: err.message } : { event: m.event, data: m.data, qos: +m.qos || 0 })),
    subscribe: (topic, qos) => client.subscribe(topic, { qos: +qos || 0 }, err => emit(err ? 'error' : 'info', { text: err ? err.message : `Subscribed to ${topic}` })),
    unsubscribe: topic => client.unsubscribe(topic, err => emit(err ? 'error' : 'info', { text: err ? err.message : `Unsubscribed from ${topic}` })),
    close: () => client.end(),
  };
}

const connectors = { ws: connectWs, socketio: connectSocketIo, sse: connectSse, mqtt: connectMqtt };

function connect(wc, c) {
  sessions.get(c.id)?.close();
  const emit = emitter(wc, c.id);
  try {
    const s = connectors[c.kind](c, emit);
    s.wc = wc;
    sessions.set(c.id, s);
    emit('connecting', { text: `Connecting to ${c.url}…` });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function call(id, method, ...args) {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: 'Not connected' };
  try { s[method]?.(...args); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
const closeAllFor = wc => { for (const [id, s] of sessions) if (s.wc === wc) { try { s.close(); } catch {} sessions.delete(id); } };

module.exports = { connect, call, closeAllFor, sessions };
