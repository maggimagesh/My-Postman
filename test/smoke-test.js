// End-to-end check: boots the real app on a throwaway profile, runs it against local
// HTTP / WebSocket / SSE / Socket.IO / MQTT / gRPC servers, and asserts on the results.
// Run: npm test            (AI=1 npm test also checks the Claude bridge; SHOT=file.png saves a screenshot)
const { app, clipboard } = require('electron');
const os = require('os'), path = require('path'), fs = require('fs'), http = require('http'), zlib = require('zlib'), crypto = require('crypto');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-')));
require(process.env.MP_MAIN || '../src/main/main.js');

const results = [];
const check = (name, ok, info = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + info}`); };

// ---------- local servers ----------
async function servers() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const json = (o, code = 200, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/echo') return json({ method: req.method, headers: req.headers, body, query: Object.fromEntries(u.searchParams) });
      if (u.pathname === '/cookie') return json({ ok: true }, 200, { 'Set-Cookie': 'sid=abc123; Path=/; HttpOnly' });
      if (u.pathname === '/needs-cookie') return json({ cookie: req.headers.cookie || null });
      if (u.pathname === '/redirect') { res.writeHead(302, { Location: '/echo?redirected=1' }); return res.end(); }
      if (u.pathname === '/gzip') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }); return res.end(zlib.gzipSync(JSON.stringify({ zipped: true }))); }
      if (u.pathname === '/digest') {
        const a = req.headers.authorization || '';
        if (!a.startsWith('Digest ')) { res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="test", qop="auth", nonce="n0nce", opaque="op"' }); return res.end(); }
        const p = {}; a.replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, q, v) => { p[k] = q ?? v; });
        const H = s => crypto.createHash('md5').update(s).digest('hex');
        const expected = H(`${H(`u:test:p`)}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${H(`${req.method}:${p.uri}`)}`);
        return json({ ok: p.response === expected }, p.response === expected ? 200 : 403);
      }
      if (u.pathname === '/sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let i = 0;
        const t = setInterval(() => { res.write(`event: tick\ndata: {"n":${++i}}\n\n`); if (i === 3) { clearInterval(t); res.end(); } }, 100);
        return;
      }
      if (u.pathname === '/slow') return setTimeout(() => json({ slow: true }), 4000);
      json({ error: 'not found' }, 404);
    });
  });
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true });
  srv.on('upgrade', (req, sock, head) => { if (req.url.startsWith('/ws')) wss.handleUpgrade(req, sock, head, ws => ws.on('message', m => ws.send('echo:' + m))); });
  const { Server } = require('socket.io');
  const ioSrv = http.createServer();
  const io = new Server(ioSrv);
  io.on('connection', s => { s.on('ping-me', (data, ack) => { s.emit('pong-you', { got: data }); if (typeof ack === 'function') ack('acked'); }); });
  const aedes = require('aedes')();
  const mqttSrv = require('net').createServer(aedes.handle);
  const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  const port = await listen(srv), ioPort = await listen(ioSrv), mqttPort = await listen(mqttSrv);
  // gRPC server with reflection
  const grpc = require('@grpc/grpc-js'), loader = require('@grpc/proto-loader');
  const protoPath = path.join(os.tmpdir(), 'mp-test-greeter.proto');
  fs.writeFileSync(protoPath, `syntax = "proto3";\npackage demo;\nservice Greeter {\n  rpc SayHello (HelloRequest) returns (HelloReply);\n  rpc Count (HelloRequest) returns (stream HelloReply);\n}\nmessage HelloRequest { string name = 1; int32 times = 2; }\nmessage HelloReply { string message = 1; }\n`);
  const def = loader.loadSync(protoPath, { keepCase: true });
  const pkg = grpc.loadPackageDefinition(def);
  const gs = new grpc.Server();
  gs.addService(pkg.demo.Greeter.service, {
    SayHello: (call, cb) => cb(null, { message: 'Hello ' + call.request.name }),
    Count: call => { for (let i = 1; i <= (call.request.times || 2); i++) call.write({ message: `#${i}` }); call.end(); },
  });
  new (require('@grpc/reflection').ReflectionService)(def).addToServer(gs);
  const grpcPort = await new Promise((r, j) => gs.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => e ? j(e) : r(p)));
  return { port, ioPort, mqttPort, grpcPort, protoPath, close: () => { srv.close(); ioSrv.close(); mqttSrv.close(); gs.forceShutdown(); aedes.close(); } };
}

app.on('browser-window-created', (_e, win) => win.webContents.setBackgroundThrottling(false) || win.webContents.once('did-finish-load', async () => {
  const errors = [];
  win.webContents.on('console-message', (_ev, level, msg, line, src) => { if (level >= 3) errors.push(`${msg} (${src}:${line})`); });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const S = await servers();
  const base = `http://127.0.0.1:${S.port}`;
  try {
    await new Promise(r => setTimeout(r, 2500));
    check('app booted', !(await js(`return document.body.innerText.startsWith('Failed to start')`)), await js(`return document.body.innerText.slice(0, 500)`));
    await js(`window.M = { exec: await import('/execute.js'), state: await import('/state.js'), imp: await import('/importers.js'), tabs: await import('/tabs.js'), ui: await import('/ui.js'), sidebar: await import('/sidebar.js'), runner: await import('/views/runner.js') }; return 1`);

    // --- importers ---
    const curl = await js(`const r = M.imp.parseCurl("curl -X POST '${base}/echo?a=1' -H 'Content-Type: application/json' -H 'X-Test: yes' --data-raw '{\\"k\\":\\"v\\"}' -u user:pw"); return r`);
    check('cURL import', curl.method === 'POST' && curl.body.mode === 'raw' && curl.body.lang === 'json' && curl.params[0].key === 'a' && curl.auth.type === 'basic' && curl.headers.length === 2, JSON.stringify(curl).slice(0, 300));
    const appImp = await js(`
      const ai = await import('/appimport.js');
      const flat = n => n.items ? n.items.flatMap(flat) : [n];
      const pm = ai.postmanCollections([
        { value: { id: 'c1', $kind: 'collection', name: 'PM', items: [{ id: 'f1', $kind: 'collection' }, { id: 'r2', $kind: 'http-request' }], variables: [{ key: 'v', value: '1' }] } },
        { value: { id: 'f1', $kind: 'collection', name: 'Folder', items: [{ id: 'r1', $kind: 'http-request' }] } },
        { value: { id: 'r1', $kind: 'http-request', name: 'Full', method: 'POST', url: '{{v}}/x', headers: [{ key: 'A', value: 'b' }], body: { type: 'urlencoded', content: [{ key: 'k', value: 'v', disabled: true }] }, scripts: [{ type: 'beforeRequest', code: 'pre()' }] } },
        { value: { id: 'r2', $kind: 'http-request', name: 'Partial', descriptor: 'PUT', url: 'http://y', isPartial: true } },
      ]);
      const ec = ai.echoCollections([{ project_id: 'p', target_id: 'a', parent_id: '0', target_type: 'api', name: 'E', method: 'POST', url: 'http://e', request: { header: { parameter: [{ key: 'H', value: '1', is_checked: 1 }] }, body: { mode: 'json', raw: '{}' }, auth: { type: 'bearer', bearer: { key: 'tok' } }, post_tasks: [{ type: 'customScript', enabled: 1, data: 'test()' }] } }]);
      const p = M.imp.fromPostmanCollection(pm[0].json), e = flat(M.imp.fromPostmanCollection(ec[0].json))[0], full = p.items[0].items[0], part = p.items[1];
      return { n: pm.length, partial: pm[0].partial, key: pm[0].key, folder: p.items[0].name, full: [full.method, full.headers[0]?.key, full.body.mode, full.body.urlencoded[0]?.on, full.pre], part: [part.method, part.url], vars: p.vars[0]?.key, e: [e.headers[0]?.key, e.body.lang, e.auth.type, e.tests] };`);
    check('installed-app import: Postman cache tree + EchoAPI recent APIs convert', appImp.n === 1 && appImp.partial === 1 && appImp.key === 'postman:c1' && appImp.folder === 'Folder' && JSON.stringify(appImp.full) === '["POST","A","urlencoded",false,"pre()"]' && JSON.stringify(appImp.part) === '["PUT","http://y"]' && appImp.vars === 'v' && JSON.stringify(appImp.e) === '["H","json","bearer","test()"]', JSON.stringify(appImp));
    const rt = await js(`
      const c = M.state.newItem('collection'); c.name = 'RT';
      const r = M.state.newItem('http'); r.name = 'r1'; r.url = '{{base}}/users/:id'; r.pathVars = [{on:true,key:'id',value:'7'}]; r.tests = 'pm.test("x",()=>{})';
      r.auth = { type: 'awsv4', accessKey: 'AK', secretKey: 'SK', region: 'eu-west-1', service: 's3' };
      r.examples = [{ id: 'e', name: 'ok', status: 200, headers: [['Content-Type','application/json']], body: '{"id":7}', request: { method: 'GET', url: r.url } }];
      c.items.push(r); c.vars = [{on:true,key:'base',value:'x'}];
      const out = M.imp.importText(JSON.stringify(M.imp.toPostmanCollection(c)));
      const back = M.state.W.collections.find(x => x.id === out[0].id);
      M.state.W.collections.splice(M.state.W.collections.indexOf(back), 1);
      return back;`);
    const r1 = rt.items[0];
    check('Postman v2.1 export → import round trip', r1.name === 'r1' && r1.pathVars[0].value === '7' && r1.auth.type === 'awsv4' && r1.auth.region === 'eu-west-1' && r1.examples[0].body === '{"id":7}' && rt.vars[0].key === 'base', JSON.stringify(rt).slice(0, 400));
    const oa = await js(`
      const yaml = "openapi: 3.0.0\\ninfo: {title: Pets, version: '1'}\\nservers: [{url: 'https://api.pets.io/v1'}]\\ncomponents:\\n  securitySchemes: {bearer: {type: http, scheme: bearer}}\\n  schemas:\\n    Pet: {type: object, properties: {id: {type: integer}, name: {type: string, example: Rex}}}\\nsecurity: [{bearer: []}]\\npaths:\\n  /pets/{petId}:\\n    get:\\n      tags: [pets]\\n      summary: Get pet\\n      parameters: [{name: petId, in: path, required: true, schema: {type: integer, example: 5}}]\\n      responses:\\n        '200': {description: ok, content: {application/json: {schema: {$ref: '#/components/schemas/Pet'}}}}\\n  /pets:\\n    post:\\n      tags: [pets]\\n      summary: Add pet\\n      requestBody: {content: {application/json: {schema: {$ref: '#/components/schemas/Pet'}}}}\\n      responses: {'201': {description: created}}\\n";
      const out = M.imp.importText(yaml);
      const c = M.state.W.collections.find(x => x.id === out[0].id);
      M.state.W.collections.splice(M.state.W.collections.indexOf(c), 1);
      return c;`);
    const pets = oa.items[0];
    check('OpenAPI 3 (YAML) import', oa.name === 'Pets' && oa.auth.type === 'bearer' && oa.vars[0].value === 'https://api.pets.io/v1' && pets.name === 'pets' && pets.items[0].url === '{{baseUrl}}/pets/:petId' && pets.items[0].pathVars[0].value === '5' && JSON.parse(pets.items[0].examples[0].body).name === 'Rex' && JSON.parse(pets.items[1].body.raw).name === 'Rex', JSON.stringify(oa).slice(0, 500));

    // --- HTTP pipeline: env vars, pre-request script, tests, variable write-back ---
    const env = await js(`
      const W = M.state.W;
      const e = { id: 'env1', name: 'Test', vars: [{on:true,key:'base',value:'${base}'},{on:true,key:'token',value:'t0k'}] };
      W.environments.push(e); W.activeEnv = 'env1';
      const r = M.state.newItem('http');
      Object.assign(r, { method: 'POST', url: '{{base}}/echo?q={{$randomInt}}', headers: [{on:true,key:'X-Env',value:'{{token}}'}], auth: { type: 'bearer', token: '{{token}}' },
        body: { ...r.body, mode: 'raw', lang: 'json', raw: '{"who":"{{name}}"}' },
        pre: 'pm.variables.set("name", "ada"); pm.request.headers.add({key:"X-Pre", value:"1"});',
        tests: 'pm.test("status 200", () => pm.response.to.have.status(200)); pm.test("body var", () => pm.expect(pm.response.json().body).to.include("ada")); pm.test("chai chain", () => pm.expect(pm.response.json()).to.have.property("headers").that.is.an("object")); pm.test("should fail", () => pm.expect(1).to.equal(2)); pm.environment.set("saved", pm.response.json().headers["x-pre"]); pm.test("async", done => setTimeout(done, 50)); console.log("hello from test");' });
      const res = await M.exec.execute(r, {});
      return { status: res.status, tests: res.tests, logs: res.logs, body: JSON.parse(res.body), saved: e.vars.find(v => v.key === 'saved')?.value };`);
    const names = Object.fromEntries(env.tests.map(t => [t.name, t.pass]));
    check('HTTP send with env vars + bearer auth', env.status === 200 && env.body.headers.authorization === 'Bearer t0k' && env.body.headers['x-env'] === 't0k' && /^\d+$/.test(env.body.query.q), JSON.stringify(env.body).slice(0, 300));
    check('pre-request script (local var + header)', env.body.body === '{"who":"ada"}' && env.body.headers['x-pre'] === '1', env.body.body);
    check('tests: chai, async, failures reported', names['status 200'] && names['body var'] && names['chai chain'] && names['async'] && names['should fail'] === false, JSON.stringify(env.tests));
    check('pm.environment.set persists to environment', env.saved === '1', env.saved);
    check('console.log captured', env.logs.some(l => l.text === 'hello from test'), JSON.stringify(env.logs));

    const misc = await js(`
      const mk = (o) => Object.assign(M.state.newItem('http'), o);
      const a = await M.exec.execute(mk({ url: '{{base}}/cookie' }), {});
      const b = await M.exec.execute(mk({ url: '{{base}}/needs-cookie' }), {});
      const c = await M.exec.execute(mk({ url: '{{base}}/redirect' }), {});
      const d = await M.exec.execute(mk({ url: '{{base}}/gzip' }), {});
      const e = await M.exec.execute(mk({ url: '{{base}}/digest', auth: { type: 'digest', username: 'u', password: 'p' } }), {});
      const f = await M.exec.execute(mk({ url: '{{base}}/echo', tests: 'pm.sendRequest("${base}/echo?from=script", (err, res) => { pm.test("sendRequest", () => pm.expect(res.json().query.from).to.equal("script")); });' }), {});
      const g = await M.exec.execute(mk({ url: '{{base}}/echo', tests: 'this is not js' }), {});
      const h = await M.exec.execute(mk({ url: '{{base}}/echo', tests: 'pm.test("schema", () => pm.response.to.have.jsonSchema({type:"object",required:["method"]})); pm.test("lodash+moment", () => pm.expect(_.get(pm.response.json(),"method") + moment(0).utc().year()).to.equal("GET1970")); pm.test("CryptoJS", () => pm.expect(CryptoJS.MD5("a").toString()).to.equal("0cc175b9c0f1b6a831c399e269772661"));' }), {});
      const mkPost = mk({ method: 'POST', url: '{{base}}/echo', body: { mode: 'urlencoded', urlencoded: [{on:true,key:'a b',value:'c&d'}], raw:'', formdata: [] } });
      const i = await M.exec.execute(mkPost, {});
      const fd = mk({ method: 'POST', url: '{{base}}/echo', body: { mode: 'formdata', formdata: [{on:true,key:'field',value:'v1',type:'text'}], urlencoded: [] } });
      const j = await M.exec.execute(fd, {});
      const gq = mk({ method: 'POST', url: '{{base}}/echo', body: { mode: 'graphql', graphql: { query: 'query { me { id } }', variables: '{"x": "{{token}}"}' } } });
      const k = await M.exec.execute(gq, {});
      return { a: a.cookies, b: JSON.parse(b.body), c: [c.status, JSON.parse(c.body).query, c.redirects.length], d: JSON.parse(d.body), e: e.status, f: f.tests, g: g.errors, h: h.tests, i: JSON.parse(i.body), j: JSON.parse(j.body), k: JSON.parse(JSON.parse(k.body).body) };`);
    check('cookie jar stores and sends cookies', misc.a[0]?.name === 'sid' && misc.b.cookie === 'sid=abc123', JSON.stringify([misc.a, misc.b]));
    check('redirects followed', misc.c[0] === 200 && misc.c[1].redirected === '1' && misc.c[2] === 1, JSON.stringify(misc.c));
    check('gzip responses decoded', misc.d.zipped === true, JSON.stringify(misc.d));
    check('Digest auth (challenge + retry)', misc.e === 200, misc.e);
    check('pm.sendRequest from a script', misc.f.some(t => t.name === 'sendRequest' && t.pass), JSON.stringify(misc.f));
    check('script syntax errors reported', misc.g.length === 1 && /SyntaxError/.test(misc.g[0].message), JSON.stringify(misc.g));
    check('jsonSchema, lodash, moment, CryptoJS in sandbox', misc.h.length === 3 && misc.h.every(t => t.pass), JSON.stringify(misc.h));
    check('x-www-form-urlencoded body', misc.i.body === 'a+b=c%26d' && /urlencoded/.test(misc.i.headers['content-type']), misc.i.body);
    check('multipart form-data body', /name="field"\r\n\r\nv1/.test(misc.j.body) && /multipart\/form-data; boundary=/.test(misc.j.headers['content-type']), misc.j.body.slice(0, 200));
    check('GraphQL body with variables', misc.k.query === 'query { me { id } }' && misc.k.variables.x === 't0k', JSON.stringify(misc.k));

    const dyn = await js(`
      const r = Object.assign(M.state.newItem('http'), { method: 'POST', url: '{{base}}/echo?ts={{isoTimestamp}}&g={{$guid}}', headers: [{on:true,key:'X-Mail',value:'{{$randomEmail}}'}],
        body: { mode: 'raw', lang: 'json', raw: '{"name":"{{$randomFullName}}","price":"{{$randomPrice}}","semver":"{{$randomSemver}}"}', urlencoded: [], formdata: [] },
        pre: 'pm.variables.set("rid", pm.variables.replaceIn("{{$randomUUID}}"));', tests: 'pm.test("replaceIn dynamic", () => pm.expect(pm.variables.replaceIn("{{$isoTimestamp}}")).to.match(/^[0-9]{4}-/));' });
      const res = await M.exec.execute(r, {});
      return { body: JSON.parse(res.body), tests: res.tests, count: Object.keys(M.state.DYNAMIC).length };`);
    const db = dyn.body, dbody = JSON.parse(db.body);
    check('dynamic variables ({{isoTimestamp}}, {{$guid}}, {{$randomEmail}}…)', /^\d{4}-\d\d-\d\dT/.test(db.query.ts) && /^[0-9a-f-]{36}$/.test(db.query.g) && /@/.test(db.headers['x-mail']) && / /.test(dbody.name) && /^\d+\.\d\d$/.test(dbody.price) && /^\d\.\d\.\d$/.test(dbody.semver) && dyn.tests.every(t => t.pass) && dyn.count >= 118, JSON.stringify({ q: db.query, t: dyn.tests, c: dyn.count }));
    const cancel = await js(`
      const r = Object.assign(M.state.newItem('http'), { url: '{{base}}/slow' });
      const p = M.exec.execute(r, { signalId: 'sig1' });
      setTimeout(() => api.httpCancel('sig1'), 300);
      const res = await p; return { ok: res.ok, error: res.error, time: res.time };`);
    check('cancel in-flight request', !cancel.ok && /cancel/i.test(cancel.error) && cancel.time < 2000, JSON.stringify(cancel));

    // --- collection runner via the UI, with setNextRequest ---
    const run = await js(`
      const W = M.state.W;
      const c = M.state.newItem('collection'); c.name = 'Runner Test';
      const a = Object.assign(M.state.newItem('http'), { name: 'A', url: '{{base}}/echo?row={{who}}', tests: 'pm.test("A ok", () => pm.response.to.have.status(200)); pm.execution.setNextRequest("C");' });
      const b = Object.assign(M.state.newItem('http'), { name: 'B', url: '{{base}}/echo' , tests: 'pm.test("B should be skipped", () => {});' });
      const cc = Object.assign(M.state.newItem('http'), { name: 'C', url: '{{base}}/echo', tests: 'pm.test("C row", () => pm.expect(pm.iterationData.get("who")).to.be.oneOf(["x","y"]));' });
      c.items.push(a, b, cc); W.collections.push(c);
      M.runner.openRunner(c.id);
      await new Promise(r => setTimeout(r, 300));
      const tab = M.tabs.activeTab();
      M.tabs.rt(tab).data = [{ who: 'x' }, { who: 'y' }]; tab.draft.iterations = 2; tab.draft.dataName = 'inline.csv';
      M.ui.bus.emit('render-view');
      await new Promise(r => setTimeout(r, 200));
      [...document.querySelectorAll('#view button.primary')].find(b => /Run /.test(b.textContent)).click();
      for (let i = 0; i < 60 && !M.tabs.rt(tab).results?.done; i++) await new Promise(r => setTimeout(r, 100));
      const res = M.tabs.rt(tab).results;
      return { its: res.iterations.map(it => it.map(x => x.name + ':' + x.tests.map(t => t.pass).join('/'))), text: document.querySelector('#view').innerText.slice(0, 200) };`);
    check('collection runner: iterations, data file, setNextRequest', JSON.stringify(run.its) === JSON.stringify([['A:true', 'C:true'], ['A:true', 'C:true']]), JSON.stringify(run));
    const perf = await js(`
      const tab = M.tabs.activeTab();
      tab.draft.mode = 'perf'; tab.draft.perf = { vus: 5, duration: 2, rampUp: 0 };
      M.ui.bus.emit('render-view');
      await new Promise(r => setTimeout(r, 200));
      [...document.querySelectorAll('#view button.primary')].find(b => /performance test/i.test(b.textContent)).click();
      for (let i = 0; i < 60 && !M.tabs.rt(tab).perf?.done; i++) await new Promise(r => setTimeout(r, 100));
      const p = M.tabs.rt(tab).perf;
      return { n: p.samples.length, errors: p.samples.filter(x => !x.ok).length, done: p.done, ui: /Throughput/.test(document.querySelector('#view').innerText) };`);
    check('performance test (virtual users, metrics)', perf.done && perf.n > 20 && perf.errors === 0 && perf.ui, JSON.stringify(perf));
    check('runner csv parser', JSON.stringify(await js(`return M.runner.parseCsv('a,b\\n1,"x,y"\\n2,"q""t"\\n')`)) === JSON.stringify([{ a: '1', b: 'x,y' }, { a: '2', b: 'q"t' }]));

    // --- mock server answering from saved examples ---
    const mock = await js(`
      const W = M.state.W;
      const c = M.state.newItem('collection'); c.name = 'Mocked';
      const r = Object.assign(M.state.newItem('http'), { name: 'Get user', url: '{{baseUrl}}/users/:id', examples: [{ id: 'e1', name: 'found', status: 200, headers: [['Content-Type','application/json']], body: '{"id":1,"name":"Ada"}' }, { id: 'e2', name: 'missing', status: 404, headers: [], body: 'nope' }] });
      c.items.push(r); W.collections.push(c);
      const m = { id: 'm1', name: 'mock', colId: c.id, port: ${S.port + 1000 > 65000 ? 41234 : S.port + 1000}, delay: 0 };
      await M.sidebar.startMock(m);
      const one = await api.httpSend({ method: 'GET', url: 'http://127.0.0.1:' + m.port + '/users/42', headers: [], bodyKind: 'text', settings: {} });
      const two = await api.httpSend({ method: 'GET', url: 'http://127.0.0.1:' + m.port + '/users/42', headers: [['x-mock-response-code','404']], bodyKind: 'text', settings: {} });
      const three = await api.httpSend({ method: 'POST', url: 'http://127.0.0.1:' + m.port + '/nothing', headers: [], bodyKind: 'text', settings: {} });
      await api.mockStop('m1');
      return [one.status, one.body, two.status, two.body, three.status];`);
    check('mock server serves examples (+ x-mock-response-code)', mock[0] === 200 && JSON.parse(mock[1]).name === 'Ada' && mock[2] === 404 && mock[3] === 'nope' && mock[4] === 404, JSON.stringify(mock));

    // --- realtime protocols through the real UI ---
    const rtTest = async (kind, url, setup, waitFor) => js(`
      const t = M.tabs.newRequestTab('${kind}');
      const tab = M.tabs.activeTab();
      tab.draft.url = '${url}';
      ${setup}
      M.ui.bus.emit('render-view');
      await new Promise(r => setTimeout(r, 150));
      document.querySelector('[data-conn]').click();
      const r = M.tabs.rt(tab);
      for (let i = 0; i < 50 && !r.connected; i++) await new Promise(x => setTimeout(x, 100));
      const connected = r.connected;
      ${waitFor}
      const msgs = r.messages.map(m => m.kind + ':' + (m.event ? m.event + ':' : '') + (m.data ?? m.text));
      document.querySelector('[data-conn]')?.click();
      await new Promise(x => setTimeout(x, 200));
      return { connected, msgs, closed: !r.connected };`);
    const ws = await rtTest('ws', `ws://127.0.0.1:${S.port}/ws`, `tab.draft.draft = { data: 'hi {{token}}', format: 'text' };`, `r.sendMessage(); for (let i = 0; i < 30 && !r.messages.some(m => m.kind === 'message'); i++) await new Promise(x => setTimeout(x, 100));`);
    check('WebSocket connect / send / receive / disconnect', ws.connected && ws.msgs.includes('sent:hi t0k') && ws.msgs.includes('message:echo:hi t0k') && ws.closed, JSON.stringify(ws));
    const sse = await rtTest('sse', `${base}/sse`, '', `for (let i = 0; i < 30 && r.messages.filter(m => m.kind === 'message').length < 3; i++) await new Promise(x => setTimeout(x, 100));`);
    check('Server-Sent Events stream', sse.connected && sse.msgs.filter(m => m.startsWith('message:tick:')).length === 3, JSON.stringify(sse));
    const sio = await rtTest('socketio', `http://127.0.0.1:${S.ioPort}`, `tab.draft.draft = { event: 'ping-me', data: '{"a":1}', format: 'json', ack: true };`, `r.sendMessage(); for (let i = 0; i < 30 && !r.messages.some(m => m.event === 'pong-you'); i++) await new Promise(x => setTimeout(x, 100)); await new Promise(x => setTimeout(x, 200));`);
    check('Socket.IO emit / ack / receive', sio.connected && sio.msgs.some(m => m.startsWith('message:pong-you:') && m.includes('"a":1')) && sio.msgs.some(m => m.includes('ack: ping-me') && m.includes('acked')), JSON.stringify(sio));
    const mq = await rtTest('mqtt', `mqtt://127.0.0.1:${S.mqttPort}`, `tab.draft.topics = [{on:true,key:'t/#',value:'0'}]; tab.draft.draft = { topic: 't/1', data: 'hello mqtt', qos: 0 };`, `for (let i = 0; i < 20 && !r.messages.some(m => /Subscribed/.test(m.text || '')); i++) await new Promise(x => setTimeout(x, 100)); r.sendMessage(); for (let i = 0; i < 30 && !r.messages.some(m => m.kind === 'message'); i++) await new Promise(x => setTimeout(x, 100));`);
    check('MQTT subscribe / publish / receive', mq.connected && mq.msgs.includes('message:t/1:hello mqtt'), JSON.stringify(mq));

    // --- gRPC: reflection, proto file, unary and server streaming ---
    const g = await js(`
      const target = '127.0.0.1:${S.grpcPort}';
      const refl = await api.grpcLoad({ type: 'reflection', url: target, tls: false }, []);
      const proto = await api.grpcLoad({ type: 'proto', files: [${JSON.stringify(S.protoPath)}], importPaths: [] }, []);
      const unary = await api.grpcInvoke({ id: 'g1', url: target, tls: false, source: { type: 'proto', files: [${JSON.stringify(S.protoPath)}], importPaths: [] }, service: 'demo.Greeter', method: 'SayHello', message: '{"name":"Ada"}', metadata: [['x-a','1']] });
      const msgs = [];
      const fake = { kind: 'request', id: 'g2' };
      M.state.RT.set('g2', { onEvent: e => msgs.push(e) });
      const stream = await api.grpcInvoke({ id: 'g2', url: target, tls: false, source: { type: 'reflection', url: target, tls: false }, service: 'demo.Greeter', method: 'Count', message: '{"name":"x","times":3}', metadata: [] });
      for (let i = 0; i < 30 && !msgs.some(m => m.kind === 'close'); i++) await new Promise(r => setTimeout(r, 100));
      return { refl: refl.ok && refl.services.map(s => s.name + ':' + s.methods.map(m => m.name).join(',')), sample: proto.services?.[0]?.methods[0]?.sample, unary: unary.message && JSON.parse(unary.message), status: unary.status, stream: stream.streaming, data: msgs.filter(m => m.kind === 'message').map(m => JSON.parse(m.data).message) };`);
    check('gRPC server reflection', JSON.stringify(g.refl) === JSON.stringify(['demo.Greeter:SayHello,Count']), JSON.stringify(g.refl));
    check('gRPC .proto import + example message', g.sample && JSON.parse(g.sample).name === '' && JSON.parse(g.sample).times === 0, g.sample);
    check('gRPC unary call', g.unary?.message === 'Hello Ada' && g.status?.code === 0, JSON.stringify(g));
    check('gRPC server streaming', g.stream && JSON.stringify(g.data) === JSON.stringify(['#1', '#2', '#3']), JSON.stringify(g));

    // --- UI + Postman keyboard shortcuts ---
    const ui = await js(`
      const key = (code, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: o.key || '', ctrlKey: true, shiftKey: !!o.shift, altKey: !!o.alt, bubbles: true, cancelable: true }));
      const T = M.state.T;
      const n0 = T.tabs.length;
      key('KeyT'); await new Promise(r => setTimeout(r, 100));
      const afterNew = T.tabs.length;
      const tab = M.tabs.activeTab();
      key('KeyL'); await new Promise(r => setTimeout(r, 50));
      const urlFocused = document.activeElement?.id === 'urlInput';
      const input = document.getElementById('urlInput');
      input.value = '{{base}}/echo?hello=world'; input.dispatchEvent(new Event('input', { bubbles: true }));
      const params = tab.draft.params.map(p => p.key + '=' + p.value).join('&');
      key('Enter'); for (let i = 0; i < 40 && !M.tabs.rt(tab).res; i++) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 300));
      const status = document.querySelector('.resbar .pill')?.textContent;
      key('KeyW', {}); await new Promise(r => setTimeout(r, 200));
      const modalShown = !!document.querySelector('.modal');
      document.querySelector('.modal .dlg-foot button.danger')?.click();
      await new Promise(r => setTimeout(r, 200));
      const afterClose = T.tabs.length;
      key('KeyT', { shift: true }); await new Promise(r => setTimeout(r, 200));
      const reopened = T.tabs.length === afterNew && M.tabs.activeTab().draft.url.includes('/echo');
      key('Backslash'); const sideHidden = T.ui.sideHidden; key('Backslash');
      key('KeyK'); await new Promise(r => setTimeout(r, 100)); const palette = !!document.querySelector('.palette'); document.querySelector('.modal')?.close?.();
      return { n0, afterNew, urlFocused, params, status, modalShown, afterClose, reopened, sideHidden, sideBack: T.ui.sideHidden, palette };`);
    check('Ctrl+T new tab', ui.afterNew === ui.n0 + 1, JSON.stringify(ui));
    check('Ctrl+L focuses URL; URL → params sync', ui.urlFocused && ui.params === 'hello=world', JSON.stringify(ui));
    check('Ctrl+Enter sends and renders response', /^200/.test(ui.status || ''), JSON.stringify(ui));
    check('Ctrl+W asks to save unsaved tab, then closes', ui.modalShown && ui.afterClose === ui.afterNew - 1, JSON.stringify(ui));
    check('Ctrl+Shift+T reopens closed tab', ui.reopened, JSON.stringify(ui));
    check('Ctrl+\\ toggles sidebar; Ctrl+K opens search', ui.sideHidden === true && ui.sideBack === false && ui.palette, JSON.stringify(ui));

    // --- Postman-style paste behavior in key/value cells, variable highlighting ---
    const prep = await js(`
      M.tabs.newRequestTab('http');
      const t = M.tabs.activeTab();
      t.draft.method = 'POST'; t.draft.url = '{{base}}/echo?x={{nope}}'; t.draft.body.mode = 'formdata'; M.tabs.rt(t).reqTab = 'body';
      M.ui.bus.emit('render-view'); await new Promise(r => setTimeout(r, 300));
      const cells = document.querySelectorAll('#view table.kv textarea.v');
      cells[cells.length - 1].focus(); return cells.length;`);
    const JSON_TEXT = '[\n  {\n    "recordId": "zoho",\n    "crawlerInfo": { "depth": -1 }\n  }\n]';
    win.focus(); clipboard.writeText(JSON_TEXT); win.webContents.paste();
    await new Promise(r => setTimeout(r, 400));
    const fd = await js(`
      const t = M.tabs.activeTab();
      const ta = document.querySelector('#view table.kv textarea.v');
      const res = await M.exec.execute(Object.assign({}, t.draft, { body: { ...t.draft.body, formdata: t.draft.body.formdata.map(f => ({ ...f, key: 'payload' })) } }), {});
      const ov = document.querySelector('.var-ov');
      const expanded = ta.offsetHeight; ta.blur(); const collapsed = ta.offsetHeight; ta.focus(); const refocused = ta.offsetHeight;
      return { value: t.draft.body.formdata[0]?.value, height: expanded, collapsed, refocused, sent: JSON.parse(res.body).body, ok: ov?.querySelectorAll('.mp-var-ok').length, bad: ov?.querySelectorAll('.mp-var-bad').length };`);
    check('multi-line JSON pasted into a form-data value keeps its lines; cell expands on focus, collapses on blur', fd.value === JSON_TEXT && fd.height > 60 && fd.collapsed === 24 && fd.refocused > 60 && fd.sent.includes('"recordId": "zoho",\r\n') === false && fd.sent.includes('"recordId": "zoho"'), JSON.stringify(fd));
    check('{{variables}} highlighted in URL (resolved vs unresolved)', fd.ok === 1 && fd.bad === 1, JSON.stringify(fd));
    await js(`const t = M.tabs.activeTab(); M.tabs.rt(t).reqTab = 'headers'; M.ui.bus.emit('render-view'); await new Promise(r => setTimeout(r, 300)); const k = document.querySelectorAll('#view table.kv input.k'); k[k.length - 1].focus(); return 1;`);
    await js(`const k = document.querySelectorAll('#view table.kv input.k'); const el = k[k.length - 1]; const dt = new DataTransfer(); dt.setData('text/plain', 'Content-Type: application/json\\nX-Trace=abc\\nAuthorization: Bearer {{token}}'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return 1;`);
    await new Promise(r => setTimeout(r, 300));
    const hd = await js(`return M.tabs.activeTab().draft.headers.map(h => h.key + '=' + h.value);`);
    check('pasting key:value lines into a key cell creates rows', JSON.stringify(hd) === JSON.stringify(['Content-Type=application/json', 'X-Trace=abc', 'Authorization=Bearer {{token}}']), JSON.stringify(hd));

    // --- multi-line cURL pasted into the URL bar (newlines must survive, form-data sent as real multipart) ---
    const CURL = `curl --location --request POST '${base}/echo?action=crawling' \\\n  --header 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \\\n  --header 'X-Requested-With: XMLHttpRequest' \\\n  --form 'requestId=1' \\\n  --form 'seedInfo=[\n  {\n    "recordId": "zoho"\n  }\n]' \\\n  --form 'dataDispatch={"method":"webhook"}'`;
    // Dispatch the paste event directly: OS-level paste into an unfocused test window is unreliable.
    await js(`M.tabs.newRequestTab('http'); await new Promise(r => setTimeout(r, 200));
      const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify("__CURL__")}.replace('__CURL__', window.__curl));
      return 1;`.replace('window.__curl', JSON.stringify(CURL)));
    await js(`const el = document.getElementById('urlInput'); el.focus(); const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(CURL)}); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 300)); return 1;`);
    const cp = await js(`
      const t = M.tabs.activeTab(), d = t.draft;
      const res = await M.exec.execute(d, {});
      const echo = JSON.parse(res.body);
      return { url: d.url, tab: M.tabs.rt(t).reqTab, form: d.body.formdata.map(f => f.key + '=' + f.value), ct: echo.headers['content-type'], body: echo.body };`);
    check('multi-line cURL paste: URL, headers, form-data with JSON intact, opens Body tab', cp.url === base + '/echo?action=crawling' && cp.tab === 'body' && JSON.stringify(cp.form) === JSON.stringify(['requestId=1', 'seedInfo=[\n  {\n    "recordId": "zoho"\n  }\n]', 'dataDispatch={"method":"webhook"}']), JSON.stringify(cp));
    check('form-data sent as multipart even when a stale Content-Type header is set', /^multipart\/form-data; boundary=/.test(cp.ct) && cp.body.includes('name="seedInfo"\r\n\r\n[\n  {\n    "recordId": "zoho"\n  }\n]\r\n'), JSON.stringify(cp));

    // --- TLS failure → one-click "disable SSL verification & retry" (like Postman) ---
    const tlsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-tls-'));
    require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tlsDir, 'k.pem'), '-out', path.join(tlsDir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const tlsSrv = require('https').createServer({ key: fs.readFileSync(path.join(tlsDir, 'k.pem')), cert: fs.readFileSync(path.join(tlsDir, 'c.pem')) }, (q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('{"tls":true}'); });
    await new Promise(r => tlsSrv.listen(0, '127.0.0.1', r));
    const tls = await js(`
      M.tabs.newRequestTab('http'); const t = M.tabs.activeTab(); t.draft.url = 'https://127.0.0.1:${tlsSrv.address().port}/'; M.ui.bus.emit('render-view');
      await new Promise(r => setTimeout(r, 200));
      const { send } = await import('/views/http.js');
      await send(t);
      const first = { ok: M.tabs.rt(t).res.ok, code: M.tabs.rt(t).res.code, btn: !!document.querySelector('[data-ssl="one"]') };
      document.querySelector('[data-ssl="one"]')?.click();
      for (let i = 0; i < 40 && !(M.tabs.rt(t).res?.ok); i++) await new Promise(r => setTimeout(r, 100));
      return { first, second: M.tabs.rt(t).res.ok && M.tabs.rt(t).res.body, perRequest: t.draft.settings.sslVerify, global: M.state.W.settings.sslVerify };`);
    tlsSrv.close();
    check('certificate error offers "disable SSL verification & retry" and it works', tls.first.ok === false && /SELF_SIGNED|CERT/.test(tls.first.code || '') && tls.first.btn && tls.second === '{"tls":true}' && tls.perRequest === false && tls.global === true, JSON.stringify(tls));

    if (process.env.AI) {
      const ai = await js(`return await api.aiAsk({ id: 'smoke', prompt: 'Reply with only the word pong' })`);
      check('Claude bridge (your subscription via Claude Code)', ai.ok && /pong/i.test(ai.text), JSON.stringify(ai));
    }
    if (process.env.SHOT) { await new Promise(r => setTimeout(r, 400)); fs.writeFileSync(process.env.SHOT, (await win.webContents.capturePage()).toPNG()); }
    check('no renderer errors', !errors.length, errors.join('\n'));
  } catch (e) { check('test harness', false, e.stack || e.message); }
  S.close();
  const failed = results.filter(r => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  app.exit(failed ? 1 : 0);
}));
