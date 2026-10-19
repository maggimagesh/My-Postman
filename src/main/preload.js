const { contextBridge, ipcRenderer, webFrame } = require('electron');

const invoke = ch => (...a) => ipcRenderer.invoke(ch, ...a);
const channels = ['ws:load', 'ws:save', 'session:save', 'http:send', 'http:cancel', 'oauth2:token', 'rt:connect', 'rt:call',
  'grpc:load', 'grpc:invoke', 'grpc:write', 'grpc:end', 'grpc:cancel', 'mock:start', 'mock:stop', 'mock:running',
  'cookies:list', 'cookies:upsert', 'cookies:remove', 'cookies:clear', 'ai:status', 'ai:ask', 'ai:cancel', 'appimport:sources', 'appimport:read',
  'dialog:open', 'dialog:save', 'file:read', 'app:newWindow', 'app:devtools', 'app:find', 'app:openExternal'];
const api = {};
for (const ch of channels) api[ch.replace(/:(\w)/, (_, c) => c.toUpperCase())] = invoke(ch); // 'http:send' -> api.httpSend

const events = ['rt-event', 'ws-changed', 'mock-log', 'ai-delta', 'find-result'];
api.on = (ch, fn) => { if (events.includes(ch)) ipcRenderer.on(ch, (_e, data) => fn(data)); };
api.zoom = d => webFrame.setZoomLevel(d === 0 ? 0 : webFrame.getZoomLevel() + d * 0.5);
api.getZoom = () => webFrame.getZoomLevel();

contextBridge.exposeInMainWorld('api', api);
