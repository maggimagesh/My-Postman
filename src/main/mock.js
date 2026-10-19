// Local mock servers that answer from a collection's saved examples.
const http = require('http');

const servers = new Map(); // mock id -> { server, routes, port }

// "/users/:id" and "/users/{{id}}" and "/users/{id}" all match any single segment.
const toRegex = p => new RegExp('^' + p.replace(/\/+$/, '').split('/').map(seg =>
  /^(:\w+|\{\{[^}]+\}\}|\{[^}]+\})$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\\\{[^}]+\\\}\\\}/g, '[^/]*')
).join('/') + '/?$', 'i');

function start(wc, m) {
  stop(m.id);
  const routes = m.routes.map(r => ({ ...r, re: toRegex(r.path || '/') }));
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const cors = { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Credentials': 'true' };
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
        const candidates = routes.filter(r => r.method === req.method && r.re.test(u.pathname)).flatMap(r => r.examples.map(e => ({ ...e, route: r })));
        const wantName = req.headers['x-mock-response-name'], wantCode = req.headers['x-mock-response-code'];
        const pick = candidates.find(e => wantName && e.name === wantName) || candidates.find(e => wantCode && String(e.status) === String(wantCode))
          // Prefer an example saved with the same query string, then any 2xx, then anything.
          || candidates.find(e => e.query && e.query === u.search.slice(1)) || candidates.find(e => e.status < 300) || candidates[0];
        const log = { method: req.method, url: req.url, status: pick ? pick.status : 404, example: pick?.name, mock: m.name, port: m.port };
        const reply = () => {
          if (!pick) {
            res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
            res.end(JSON.stringify({ error: 'mockRequestNotFoundError', message: `No saved example matches ${req.method} ${u.pathname}. Save a response as an example on a request in this collection.` }));
          } else {
            const headers = Object.fromEntries((pick.headers || []).filter(([k]) => k && !/^(content-length|transfer-encoding|content-encoding|connection)$/i.test(k)));
            res.writeHead(pick.status || 200, { ...cors, ...headers });
            res.end(pick.body ?? '');
          }
          if (!wc.isDestroyed()) wc.send('mock-log', log);
        };
        m.delay ? setTimeout(reply, m.delay) : reply();
      });
    });
    server.on('error', e => resolve({ ok: false, error: e.code === 'EADDRINUSE' ? `Port ${m.port} is already in use` : e.message }));
    server.listen(m.port, '127.0.0.1', () => { servers.set(m.id, { server, port: m.port }); resolve({ ok: true, url: `http://localhost:${m.port}` }); });
  });
}
function stop(id) { const s = servers.get(id); if (s) { s.server.close(); s.server.closeAllConnections?.(); servers.delete(id); } return { ok: true }; }
const running = () => [...servers.keys()];
const stopAll = () => { for (const id of servers.keys()) stop(id); };

module.exports = { start, stop, running, stopAll, toRegex };
