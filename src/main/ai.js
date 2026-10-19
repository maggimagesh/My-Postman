// AI runs on the user's own Claude subscription via the locally logged-in Claude Code CLI.
// No API key; nothing is sent anywhere except through `claude` itself.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SYSTEM = `You are the AI assistant inside "My Postmaster", a desktop API client (HTTP, GraphQL, WebSocket, Socket.IO, SSE, MQTT, gRPC).
Help with APIs: build requests, explain responses, write test and pre-request scripts, debug errors, write docs.
Scripts use the Postman-compatible sandbox: pm.test, pm.expect (chai), pm.response.{code,status,json(),text(),headers.get(),responseTime,to.have.status()}, pm.environment/globals/collectionVariables/variables.{get,set,unset}, pm.request, pm.sendRequest, pm.iterationData, pm.execution.setNextRequest, pm.visualizer.set(template, data); lodash as _, moment, CryptoJS, require('chai'|'lodash'|'moment'|'crypto-js'|'tv4'|'uuid').
Be concise. Put code in fenced blocks with a language tag. When asked for JSON only, output only raw JSON with no code fences.`;

function findClaude() {
  const home = os.homedir();
  const dirs = [...(process.env.PATH || '').split(':'), path.join(home, '.local/bin'), path.join(home, '.claude/local'),
    path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin'), '/usr/local/bin', '/usr/bin', '/opt/homebrew/bin'];
  for (const d of dirs) {
    const p = path.join(d, 'claude');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

const status = () => new Promise(resolve => {
  const bin = findClaude();
  if (!bin) return resolve({ loggedIn: false, installed: false, reason: 'Claude Code is not installed. Install: curl -fsSL https://claude.ai/install.sh | bash — then run: claude auth login' });
  execFile(bin, ['auth', 'status'], { timeout: 15000 }, (_err, out) => {
    try {
      const s = JSON.parse(out);
      resolve({ loggedIn: !!s.loggedIn, installed: true, method: s.authMethod, email: s.email, reason: s.loggedIn ? '' : 'Not signed in. Run in a terminal: claude auth login' });
    } catch { resolve({ loggedIn: false, installed: true, reason: 'Not signed in. Run in a terminal: claude auth login' }); }
  });
});

const running = new Map();

// Streams text deltas to the window as 'ai-delta' events; resolves with the full text.
function ask(wc, { id, prompt, model }) {
  return new Promise(resolve => {
    const bin = findClaude();
    if (!bin) return resolve({ ok: false, error: 'Claude Code CLI not found' });
    // --setting-sources '' keeps the user's personal hooks/plugins/CLAUDE.md out of the app's prompts;
    // no tools, no MCP, no saved session, and a temp cwd: Claude only sees what we pipe in.
    const args = ['-p', '--setting-sources', '', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--system-prompt', SYSTEM];
    if (model) args.push('--model', model);
    const p = spawn(bin, args, { cwd: os.tmpdir() });
    running.set(id, p);
    let buf = '', text = '', result = null, err = '';
    const kill = setTimeout(() => p.kill(), 300000);
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const delta = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.text;
        if (delta) { text += delta; if (!wc.isDestroyed()) wc.send('ai-delta', { id, delta }); }
        if (ev.type === 'result') result = ev;
      }
    });
    p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(kill); running.delete(id); resolve({ ok: false, error: e.message }); });
    p.on('close', code => {
      clearTimeout(kill); running.delete(id);
      if (result && !result.is_error) resolve({ ok: true, text: result.result ?? text });
      else resolve({ ok: false, error: (result?.result || err || (code === null ? 'Cancelled' : `claude exited with code ${code}`)).trim(), partial: text });
    });
    p.stdin.end(prompt);
  });
}
const cancel = id => { running.get(id)?.kill(); };

module.exports = { status, ask, cancel };
