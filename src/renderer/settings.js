// Settings dialog and cookie manager.
import { W, saveW, DEFAULT_SETTINGS } from './state.js';
import { h, esc, icon, modal, toast, confirmDlg, uid, bus } from './ui.js';
import { checkAi, aiStatus } from './ai.js';
import { workspaceBackup, importText } from './importers.js';
import { SHORTCUT_GROUPS } from './shortcuts.js';

const SECTIONS = [['general', 'General', 'gear'], ['appearance', 'Themes & layout', 'sun'], ['proxy', 'Proxy', 'globe'], ['certs', 'Certificates', 'lock'], ['ai', 'Claude AI', 'spark'], ['data', 'Data', 'download'], ['shortcuts', 'Shortcuts', 'keyboard'], ['about', 'About', 'file']];

export function openSettings(section = 'general') {
  const body = h(`<div style="display:grid;grid-template-columns:190px 1fr;gap:16px;min-height:60vh"><div data-nav style="border-right:1px solid var(--line);padding-right:8px"></div><div data-pane style="overflow:auto;max-height:68vh;padding-right:6px"></div></div>`);
  const nav = body.querySelector('[data-nav]'), pane = body.querySelector('[data-pane]');
  const s = W.settings;
  const commit = () => { saveW(); bus.emit('settings'); };
  const show = sec => {
    nav.querySelectorAll('.node').forEach(n => n.classList.toggle('sel', n.dataset.s === sec));
    pane.replaceChildren();
    const form = h(`<div class="form" style="grid-template-columns:240px minmax(220px,1fr)"></div>`);
    const bool = (obj, k, label, hint) => { form.append(h(`<label>${label}</label>`)); const c = h(`<div><input type="checkbox" ${obj[k] ? 'checked' : ''}></div>`); c.firstChild.onchange = e => { obj[k] = e.target.checked; commit(); }; form.append(c); if (hint) form.append(h(`<div class="hint">${hint}</div>`)); };
    const num = (obj, k, label, hint, min = 0) => { form.append(h(`<label>${label}</label>`)); const i = h(`<input type="number" min="${min}" value="${obj[k] ?? ''}">`); i.onchange = () => { obj[k] = Math.max(min, +i.value || 0); commit(); }; form.append(i); if (hint) form.append(h(`<div class="hint">${hint}</div>`)); };
    const text = (obj, k, label, hint, type = 'text') => { form.append(h(`<label>${label}</label>`)); const i = h(`<input type="${type}" value="${esc(obj[k] ?? '')}">`); i.onchange = () => { obj[k] = i.value.trim(); commit(); }; form.append(i); if (hint) form.append(h(`<div class="hint">${hint}</div>`)); };
    const select = (obj, k, label, opts, hint) => { form.append(h(`<label>${label}</label>`)); const i = h(`<select>${opts.map(([v, l]) => `<option value="${v}" ${String(obj[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`); i.onchange = () => { obj[k] = i.value; commit(); show(sec); }; form.append(i); if (hint) form.append(h(`<div class="hint">${hint}</div>`)); };
    const file = (obj, k, label) => { form.append(h(`<label>${label}</label>`)); const row = h(`<div class="row-flex"><input style="flex:1" value="${esc(obj[k] || '')}"><button>Browse</button></div>`); const i = row.firstChild; i.onchange = () => { obj[k] = i.value.trim(); commit(); }; row.lastChild.onclick = async () => { const f = await api.dialogOpen({}); if (f) { obj[k] = i.value = f[0].path; commit(); } }; form.append(row); };
    if (sec === 'general') {
      form.append(h(`<h4>Requests</h4>`));
      num(s, 'timeout', 'Request timeout (ms)', '0 means never time out.');
      bool(s, 'followRedirects', 'Automatically follow redirects');
      num(s, 'maxRedirects', 'Maximum number of redirects', '', 0);
      bool(s, 'sslVerify', 'SSL certificate verification', 'Off by default: self-signed, expired or missing certificates are accepted for HTTP, WebSocket, Socket.IO, SSE, MQTT and gRPC. Turn on to enforce verification.');
      bool(s, 'sendNoCache', 'Send no-cache header');
      bool(s.cookies, 'enabled', 'Use cookie jar', 'Store cookies from responses and send them with matching requests.');
      form.append(h(`<h4>History & tabs</h4>`));
      bool(s.history, 'enabled', 'Save request history');
      num(s.history, 'max', 'History entries to keep', '', 10);
      bool(s, 'confirmClose', 'Ask before closing tabs with unsaved changes');
    }
    if (sec === 'appearance') {
      select(s, 'theme', 'Theme', [['system', 'Follow system'], ['dark', 'Dark'], ['light', 'Light']]);
      select(s, 'layout', 'Request / response layout', [['stacked', 'Stacked (response below)'], ['side', 'Side by side']], 'Toggle anytime with Ctrl+Alt+V.');
      num(s, 'fontSize', 'Interface font size', '', 11);
      num(s, 'editorFontSize', 'Editor font size', '', 10);
      bool(s, 'wordWrap', 'Wrap long lines in editors');
    }
    if (sec === 'proxy') {
      select(s.proxy, 'mode', 'Proxy', [['none', 'No proxy'], ['system', 'Use system proxy (HTTP_PROXY / HTTPS_PROXY / NO_PROXY)'], ['custom', 'Custom proxy']]);
      if (s.proxy.mode === 'custom') {
        text(s.proxy, 'url', 'Proxy server', 'e.g. http://127.0.0.1:8080');
        text(s.proxy, 'user', 'Proxy username');
        text(s.proxy, 'pass', 'Proxy password', '', 'password');
        text(s.proxy, 'bypass', 'Bypass for hosts', 'Comma separated, supports *.example.com');
      }
    }
    if (sec === 'certs') {
      form.append(h(`<h4>CA certificates</h4>`));
      bool(s.ca, 'on', 'Use custom CA certificate');
      if (s.ca.on) file(s.ca, 'path', 'PEM file');
      form.append(h(`<h4>Client certificates</h4>`));
      pane.append(form);
      const list = h(`<div class="col-flex" style="margin-top:8px"></div>`);
      const draw = () => {
        list.replaceChildren();
        for (const c of s.certs) {
          const row = h(`<div style="border:1px solid var(--line);border-radius:6px;padding:10px"><div class="form" style="grid-template-columns:120px 1fr"></div><div class="row-flex" style="justify-content:flex-end"><button class="ghost sm danger">${icon('trash')} Remove</button></div></div>`);
          const f = row.firstChild;
          for (const [k, label, kind] of [['host', 'Host (and :port)'], ['crt', 'CRT file', 'file'], ['key', 'KEY file', 'file'], ['pfx', 'PFX file', 'file'], ['passphrase', 'Passphrase', 'password']]) {
            f.append(h(`<label>${label}</label>`));
            const r = h(`<div class="row-flex"><input style="flex:1" type="${kind === 'password' ? 'password' : 'text'}" value="${esc(c[k] || '')}" placeholder="${k === 'host' ? 'api.example.com' : ''}">${kind === 'file' ? '<button>Browse</button>' : ''}</div>`);
            r.firstChild.onchange = e => { c[k] = e.target.value.trim(); commit(); };
            r.querySelector('button')?.addEventListener('click', async () => { const p = await api.dialogOpen({}); if (p) { c[k] = r.firstChild.value = p[0].path; commit(); } });
            f.append(r);
          }
          row.querySelector('.danger').onclick = () => { s.certs.splice(s.certs.indexOf(c), 1); commit(); draw(); };
          list.append(row);
        }
        const add = h(`<button style="align-self:flex-start">${icon('plus')} Add certificate</button>`);
        add.onclick = () => { s.certs.push({ id: uid(), host: '', crt: '', key: '', pfx: '', passphrase: '' }); commit(); draw(); };
        list.append(add);
      };
      draw();
      pane.append(list);
      return;
    }
    if (sec === 'ai') {
      const st = aiStatus();
      pane.append(h(`<div class="callout" style="margin-bottom:12px">${icon('spark')} AI runs on <b>your own Claude subscription</b> via the Claude Code CLI on this computer. No API key is stored here, and only the request you're working on (with secrets masked) is sent.</div>`));
      form.append(h(`<label>Status</label>`), h(`<div class="${st.loggedIn ? 's2' : 's4'}">${st.loggedIn ? `Signed in${st.email ? ' as ' + esc(st.email) : ''} (${esc(st.method || 'claude.ai')})` : esc(st.reason || 'Not signed in')}</div>`));
      select(s.ai, 'model', 'Model', [['', 'Claude Code default'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku (fastest)']]);
      pane.append(form);
      const re = h(`<button style="margin-top:12px">${icon('refresh')} Re-check sign-in</button>`);
      re.onclick = async () => { await checkAi(); show('ai'); };
      pane.append(re, h(`<div class="dim" style="margin-top:12px;font-size:12px">Not signed in? Run <code>claude auth login</code> in a terminal. Not installed? <code>curl -fsSL https://claude.ai/install.sh | bash</code></div>`));
      return;
    }
    if (sec === 'data') {
      const box = h(`<div class="col-flex"><div class="dim">Your collections, environments and history are stored locally on this computer. Back them up or move them to another machine.</div>
        <div class="row-flex"><button data-exp>${icon('upload')} Export all data</button><button data-imp>${icon('download')} Import data</button></div>
        <div class="row-flex"><button class="danger" data-hist>${icon('trash')} Clear history (${W.history.length})</button><button data-reset>${icon('refresh')} Reset settings to defaults</button></div></div>`);
      box.querySelector('[data-exp]').onclick = async () => { const p = await api.dialogSave({ name: `my-postmaster-backup-${new Date().toISOString().slice(0, 10)}.json`, text: JSON.stringify(workspaceBackup(), null, 2) }); if (p) toast('Backup saved to ' + p); };
      box.querySelector('[data-imp]').onclick = async () => { const f = await api.dialogOpen({ text: true, filters: [{ name: 'JSON', extensions: ['json'] }] }); if (!f) return; try { const r = importText(f[0].text, f[0].name); toast('Imported ' + r.map(x => x.name).join(', ')); bus.emit('tree'); } catch (e) { toast(e.message, 'error'); } };
      box.querySelector('[data-hist]').onclick = async () => { if (await confirmDlg('Clear all request history?', 'Clear')) { W.history = []; saveW(); bus.emit('history'); show('data'); } };
      box.querySelector('[data-reset]').onclick = async () => { if (await confirmDlg('Reset all settings (proxy, certificates, theme…) to defaults?', 'Reset')) { W.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); commit(); show('data'); } };
      pane.append(box);
      return;
    }
    if (sec === 'shortcuts') { pane.append(shortcutSheet()); return; }
    if (sec === 'about') { pane.append(h(`<div class="col-flex" style="gap:14px;max-width:620px;line-height:1.6">
      <div class="row-flex" style="gap:14px"><img src="/assets/icons/64.png" width="52" height="52" alt=""><div><b style="font:600 20px var(--display)">My Postmaster</b><div class="dim">Version ${esc(window.APP_VERSION || '')} · made by Magesh Kumar</div></div></div>
      <p style="margin:0">I built My Postmaster because I wanted an API client that opens instantly, works offline, keeps my data on my own machine, and lets me do everything from the keyboard. Every reply is kept and stamped so I can see what changed between two sends, and Claude sits next to the request when something doesn't make sense.</p>
      <div><b>What's new</b>
        <ul style="margin:6px 0 0;padding-left:18px">
          <li><b>3.0.0</b> — a new look. Replies are postmarked and kept in the dispatch log; compare any two side by side, see response times at a glance, copy what was sent as cURL, or send it again. A status bar shows your environment, proxy, TLS checking and cookies.</li>
          <li><b>2.0.11</b> — one-click import from Postman and EchoAPI installed on this computer.</li>
          <li><b>2.0.7 – 2.0.10</b> — {{variables}} highlighted in bodies and tables, consistent import / export, F12 no longer opens developer tools.</li>
        </ul></div>
      <div><b>Your data</b><div class="dim">Everything stays in <code>~/.config/My Postmaster/</code>. Nothing is sent anywhere except the requests you send and, if you use it, your questions to Claude. One-click import only reads another app's local data when you click it, and never changes it.</div></div></div>`)); return; }
    pane.append(form);
  };
  for (const [k, l, ic] of SECTIONS) { const n = h(`<div class="node" data-s="${k}">${icon(ic)}<span class="nm">${l}</span></div>`); n.onclick = () => show(k); nav.append(n); }
  show(section);
  modal({ title: 'Settings', cls: 'wide', body });
}

export function shortcutSheet() {
  const g = h(`<div class="shortcut-grid"></div>`);
  for (const [group, items] of SHORTCUT_GROUPS) {
    g.append(h(`<h4>${esc(group)}</h4>`));
    for (const [keys, label] of items) g.append(h(`<div><span>${esc(label)}</span><span>${keys.split(' / ').map(k => k.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join('+')).join(' / ')}</span></div>`));
  }
  return g;
}

// ---------- cookies ----------
export async function openCookies() {
  const body = h(`<div style="display:grid;grid-template-columns:220px 1fr;gap:14px;min-height:50vh"><div data-domains style="border-right:1px solid var(--line);padding-right:8px;overflow:auto"></div><div data-list style="overflow:auto"></div></div>`);
  const domains = body.querySelector('[data-domains]'), list = body.querySelector('[data-list]');
  let sel = null;
  const draw = async () => {
    const all = await api.cookiesList();
    const byDomain = {};
    for (const c of all) (byDomain[c.domain] ||= []).push(c);
    if (!sel || !byDomain[sel]) sel = Object.keys(byDomain)[0] || null;
    domains.replaceChildren();
    const add = h(`<div class="row-flex" style="margin-bottom:8px"><input placeholder="Add domain" style="flex:1"><button>${icon('plus')}</button></div>`);
    add.querySelector('button').onclick = async () => { const d = add.querySelector('input').value.trim().replace(/^https?:\/\//, '').split('/')[0]; if (!d) return; await api.cookiesUpsert({ domain: d, name: 'cookie', value: 'value', path: '/' }); sel = d; draw(); };
    domains.append(add);
    for (const d of Object.keys(byDomain).sort()) {
      const n = h(`<div class="node ${d === sel ? 'sel' : ''}"><span class="nm">${esc(d)}</span><span class="dim">${byDomain[d].length}</span><button class="ghost sm more" title="Remove all cookies for this domain">${icon('trash')}</button></div>`);
      n.onclick = e => { if (e.target.closest('button')) return; sel = d; draw(); };
      n.querySelector('button').onclick = async () => { await api.cookiesRemove(d); draw(); };
      domains.append(n);
    }
    list.replaceChildren();
    if (!sel) { list.append(h(`<div class="empty">No cookies stored yet.<br><span class="dim">Cookies set by responses are saved automatically.</span></div>`)); return; }
    for (const c of byDomain[sel]) {
      const row = h(`<div style="border:1px solid var(--line);border-radius:6px;padding:8px;margin-bottom:8px"><div class="form" style="grid-template-columns:90px 1fr 90px 1fr;gap:6px 10px">
        <label>Name</label><input data-k="name"><label>Value</label><input data-k="value" class="mono">
        <label>Path</label><input data-k="path"><label>Expires</label><input data-k="expires" type="datetime-local">
        <label>Secure</label><div><input type="checkbox" data-k="secure"></div><label>HttpOnly</label><div><input type="checkbox" data-k="httpOnly"></div></div>
        <div class="row-flex" style="justify-content:flex-end"><button class="sm" data-save>Save</button><button class="ghost sm danger" data-del>${icon('trash')}</button></div></div>`);
      const orig = { name: c.name, path: c.path };
      row.querySelectorAll('[data-k]').forEach(i => {
        const k = i.dataset.k;
        if (i.type === 'checkbox') i.checked = !!c[k];
        else if (k === 'expires') i.value = c.expires ? new Date(c.expires - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
        else i.value = c[k] ?? '';
      });
      row.querySelector('[data-save]').onclick = async () => {
        const v = Object.fromEntries([...row.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.type === 'checkbox' ? i.checked : i.value]));
        if (orig.name !== v.name || orig.path !== v.path) await api.cookiesRemove(c.domain, orig.name, orig.path);
        await api.cookiesUpsert({ ...c, ...v, expires: v.expires ? new Date(v.expires).getTime() : null });
        toast('Cookie saved'); draw();
      };
      row.querySelector('[data-del]').onclick = async () => { await api.cookiesRemove(c.domain, c.name, c.path); draw(); };
      list.append(row);
    }
    const addC = h(`<button>${icon('plus')} Add cookie to ${esc(sel)}</button>`);
    addC.onclick = async () => { await api.cookiesUpsert({ domain: sel, name: 'new_cookie', value: '', path: '/' }); draw(); };
    list.append(addC);
  };
  draw();
  modal({ title: 'Manage cookies', cls: 'wide', body, buttons: [['Clear all', async () => { if (await confirmDlg('Delete every stored cookie?', 'Clear all')) { await api.cookiesClear(); draw(); } return false; }, 'danger'], ['Close', null, 'primary']] });
}
