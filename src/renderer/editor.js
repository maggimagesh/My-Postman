// Monaco wrapper: themes, pm.* typings for scripts, {{variable}} completion, lifecycle.
const live = new Set();
let varProvider = () => [];
export const setVarProvider = fn => { varProvider = fn; };

const PM_TYPES = `
interface PmVarScope { get(key: string): any; set(key: string, value: any): void; unset(key: string): void; has(key: string): boolean; clear(): void; toObject(): Record<string, any>; replaceIn(template: string): string; }
interface PmHeaderList { get(name: string): string | undefined; has(name: string): boolean; add(h: {key: string, value: string}): void; upsert(h: {key: string, value: string}): void; remove(name: string): void; toObject(): Record<string, string>; each(fn: (h: {key: string, value: string}) => void): void; all(): {key: string, value: string}[]; }
interface PmResponseAssertions { status(code: number | string): void; header(name: string, value?: string): void; body(value?: string | RegExp): void; jsonBody(path?: string, value?: any): void; jsonSchema(schema: object): void; responseTime: { below(ms: number): void; above(ms: number): void }; }
interface PmResponseBe { ok: void; success: void; info: void; redirection: void; clientError: void; serverError: void; error: void; accepted: void; badRequest: void; unauthorized: void; forbidden: void; notFound: void; rateLimited: void; json: void; html: void; xml: void; withBody: void; }
interface PmResponse { code: number; status: string; responseTime: number; responseSize: number; headers: PmHeaderList; cookies: { get(name: string): string | undefined; has(name: string): boolean; toObject(): Record<string, string> }; json(): any; text(): string; to: { have: PmResponseAssertions; be: PmResponseBe; not: { have: PmResponseAssertions; be: PmResponseBe } }; }
interface PmRequest { url: { toString(): string; getHost(): string; getPath(): string; query: PmHeaderList }; method: string; headers: PmHeaderList; body: { mode: string; raw?: string; urlencoded?: any[]; formdata?: any[]; graphql?: {query: string, variables: string}; update(raw: string): void }; name: string; id: string; auth: any; }
declare const pm: {
  environment: PmVarScope & { name: string }; globals: PmVarScope; collectionVariables: PmVarScope; variables: PmVarScope; iterationData: PmVarScope;
  request: PmRequest; response: PmResponse; info: { requestName: string; requestId: string; iteration: number; iterationCount: number; eventName: 'prerequest' | 'test' };
  cookies: { get(name: string): string | undefined; has(name: string): boolean; toObject(): Record<string, string> };
  test: ((name: string, fn: (done?: () => void) => void) => void) & { skip(name: string, fn: Function): void };
  expect: Chai.ExpectStatic;
  sendRequest(req: string | { url: string; method?: string; header?: Record<string, string> | {key: string, value: string}[]; body?: { mode: 'raw' | 'urlencoded' | 'formdata'; raw?: string; urlencoded?: {key: string, value: string}[] } }, cb: (err: any, res: PmResponse) => void): void;
  execution: { setNextRequest(nameOrId: string | null): void; skipRequest(): void; location: string[] };
  visualizer: { set(template: string, data?: any, options?: any): void; clear(): void };
  require(name: string): any;
};
declare namespace Chai { interface ExpectStatic { (target: any, message?: string): Assertion; fail(message?: string): never; } interface Assertion { [k: string]: any; to: Assertion; be: Assertion; been: Assertion; is: Assertion; that: Assertion; which: Assertion; and: Assertion; has: Assertion; have: Assertion; with: Assertion; at: Assertion; of: Assertion; not: Assertion; deep: Assertion; equal(v: any, msg?: string): Assertion; eql(v: any, msg?: string): Assertion; include(v: any, msg?: string): Assertion; a(type: string): Assertion; an(type: string): Assertion; property(name: string, value?: any): Assertion; lengthOf(n: number): Assertion; above(n: number): Assertion; below(n: number): Assertion; oneOf(list: any[]): Assertion; match(re: RegExp): Assertion; keys(...k: string[]): Assertion; ok: Assertion; true: Assertion; false: Assertion; null: Assertion; undefined: Assertion; exist: Assertion; empty: Assertion; } }
declare function require(name: 'lodash'): any; declare function require(name: 'moment'): any; declare function require(name: 'crypto-js'): any; declare function require(name: 'chai'): any; declare function require(name: string): any;
declare const _: any; declare const moment: any; declare const CryptoJS: any; declare const tv4: any;
declare const responseBody: string; declare const responseCode: { code: number; name: string }; declare const responseTime: number; declare const tests: Record<string, boolean>;
declare const postman: { setEnvironmentVariable(k: string, v: any): void; getEnvironmentVariable(k: string): any; setGlobalVariable(k: string, v: any): void; getGlobalVariable(k: string): any; setNextRequest(name: string): void; };
`;

export function loadMonaco() {
  return new Promise((resolve, reject) => {
    window.MonacoEnvironment = { getWorkerUrl: () => '/monaco-worker.js' };
    window.require.config({ paths: { vs: '/node_modules/monaco-editor/min/vs' } });
    window.require(['vs/editor/editor.main'], () => {
      const m = window.monaco;
      m.editor.defineTheme('mp-dark', { base: 'vs-dark', inherit: true, rules: [{ token: 'string.key.json', foreground: '7dd3fc' }, { token: 'string.value.json', foreground: '86efac' }, { token: 'number', foreground: 'fcd34d' }, { token: 'keyword', foreground: '5eead4' }], colors: { 'editor.background': '#141820', 'editorGutter.background': '#141820', 'editor.lineHighlightBackground': '#1b202b', 'editorLineNumber.foreground': '#4b5568', 'editor.selectionBackground': '#14b8a640', 'editorWidget.background': '#1f2430', 'focusBorder': '#14b8a6' } });
      m.editor.defineTheme('mp-light', { base: 'vs', inherit: true, rules: [{ token: 'string.key.json', foreground: '0369a1' }, { token: 'string.value.json', foreground: '15803d' }, { token: 'keyword', foreground: '0f766e' }], colors: { 'editor.background': '#fbfcfd', 'editorGutter.background': '#fbfcfd', 'editor.lineHighlightBackground': '#f1f4f7', 'editor.selectionBackground': '#0d948830', 'focusBorder': '#0d9488' } });
      const js = m.languages.typescript.javascriptDefaults;
      js.setCompilerOptions({ target: 99, allowNonTsExtensions: true, noLib: false, lib: ['es2020'] });
      js.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
      js.addExtraLib(PM_TYPES, 'ts:pm.d.ts');
      m.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'ignore' });
      // {{variable}} completion in every editor language.
      for (const lang of ['json', 'plaintext', 'xml', 'html', 'javascript', 'graphql', 'yaml']) {
        m.languages.registerCompletionItemProvider(lang, {
          triggerCharacters: ['{'],
          provideCompletionItems(model, pos) {
            const before = model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
            const mm = /\{\{([\w.$-]*)$/.exec(before);
            if (!mm) return { suggestions: [] };
            const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: pos.column - mm[1].length, endColumn: pos.column };
            const after = model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column + 2 });
            const close = after === '}}' ? '' : '}}';
            return { suggestions: varProvider().map(v => ({ label: v.key, kind: m.languages.CompletionItemKind.Variable, detail: `${v.scope}: ${String(v.value).slice(0, 60)}`, insertText: v.key + close, range, sortText: '0' + v.key })) };
          },
        });
      }
      resolve(m);
    }, reject);
  });
}

export function setEditorTheme(dark) { window.monaco?.editor.setTheme(dark ? 'mp-dark' : 'mp-light'); }

let opts = { fontSize: 13, wordWrap: true };
export function setEditorOptions(o) { opts = { ...opts, ...o }; for (const e of live) e.updateOptions({ fontSize: opts.fontSize, wordWrap: opts.wordWrap ? 'on' : 'off' }); }

// Creates an editor inside `el`. Old editors whose element left the DOM are disposed lazily.
export function createEditor(el, { value = '', language = 'plaintext', readOnly = false, onChange, lineNumbers = true, folding = true, placeholder } = {}) {
  sweep();
  const e = window.monaco.editor.create(el, {
    value, language, readOnly, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
    fontSize: opts.fontSize, fontFamily: 'JetBrains Mono, Fira Code, DejaVu Sans Mono, monospace', wordWrap: opts.wordWrap ? 'on' : 'off',
    lineNumbers: lineNumbers ? 'on' : 'off', folding, renderLineHighlight: readOnly ? 'none' : 'line', tabSize: 2, fixedOverflowWidgets: true,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }, padding: { top: 6 }, quickSuggestions: { other: true, strings: true },
    'semanticHighlighting.enabled': false, contextmenu: true, lineNumbersMinChars: 3, glyphMargin: false, stickyScroll: { enabled: false },
  });
  e._el = el;
  live.add(e);
  // Color {{variables}} like Postman: resolved vs unresolved, with the value on hover.
  let decoIds = [], decoT;
  const decorate = () => {
    const model = e.getModel();
    if (!model) return;
    const known = new Map(varProvider().map(v => [v.key, v]));
    const text = model.getValue();
    const decs = [];
    for (const m of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const k = m[1], v = known.get(k);
      const dyn = (!v || v.scope === 'Dynamic') && globalThis.MP_DYNAMIC?.dynamicFor(k);
      const s = model.getPositionAt(m.index), en = model.getPositionAt(m.index + m[0].length);
      decs.push({ range: new window.monaco.Range(s.lineNumber, s.column, en.lineNumber, en.column), options: {
        inlineClassName: v || dyn ? 'mp-var-ok' : 'mp-var-bad',
        hoverMessage: { value: dyn ? `**${k}** — dynamic variable, a new value is generated on every send` : v ? `**${k}** = \`${String(v.value).slice(0, 300)}\`  _(${v.scope})_` : `**${k}** is not defined in the active environment, collection or globals` },
      } });
      if (decs.length > 1000) break;
    }
    decoIds = e.deltaDecorations(decoIds, decs);
  };
  e.onDidChangeModelContent(() => { clearTimeout(decoT); decoT = setTimeout(decorate, 120); });
  e.onDidFocusEditorText(decorate);
  decorate();
  if (onChange) e.onDidChangeModelContent(() => onChange(e.getValue()));
  if (placeholder && !value) {
    const ph = document.createElement('div');
    ph.textContent = placeholder;
    ph.style.cssText = 'position:absolute;top:6px;left:42px;color:var(--dim);pointer-events:none;font:12.5px var(--mono);white-space:pre;opacity:.7';
    el.append(ph);
    const upd = () => { ph.style.display = e.getValue() ? 'none' : ''; };
    e.onDidChangeModelContent(upd);
  }
  return e;
}
export function sweep() { for (const e of live) if (!e._el.isConnected) { e.getModel()?.dispose(); e.dispose(); live.delete(e); } }
export const focusedEditor = () => [...live].find(e => e.hasTextFocus());
export async function formatEditor(e) { await e?.getAction('editor.action.formatDocument')?.run(); }
