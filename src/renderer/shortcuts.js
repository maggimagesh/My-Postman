// Global keyboard shortcuts — same bindings as Postman (Linux/Windows).
import { modalOpen } from './ui.js';
import { focusedEditor } from './editor.js';

export const SHORTCUT_GROUPS = [
  ['Tabs', [['Ctrl+T', 'Open new tab'], ['Ctrl+W', 'Close tab'], ['Ctrl+Alt+W', 'Force close tab'], ['Ctrl+Tab', 'Switch to next tab'], ['Ctrl+Shift+Tab', 'Switch to previous tab'], ['Ctrl+1 … Ctrl+8', 'Switch to tab at position'], ['Ctrl+9', 'Switch to last tab'], ['Ctrl+Shift+T', 'Reopen last closed tab'], ['Ctrl+Shift+A', 'Search tabs']]],
  ['Request', [['Ctrl+L', 'Request URL'], ['Ctrl+S', 'Save request'], ['Ctrl+Shift+S', 'Save request as'], ['Ctrl+Enter', 'Send request'], ['Ctrl+Alt+Enter', 'Send and download'], ['Ctrl+Alt+↑', 'Scroll to request'], ['Ctrl+Alt+↓', 'Scroll to response'], ['Ctrl+B', 'Beautify body']]],
  ['Sidebar', [['Ctrl+F', 'Search sidebar'], ['Ctrl+\\', 'Toggle sidebar'], ['↑ / ↓', 'Select previous / next item'], ['← / →', 'Collapse / expand item'], ['Enter', 'Open item'], ['Ctrl+E', 'Rename item'], ['Ctrl+D', 'Duplicate item'], ['Ctrl+C', 'Copy item'], ['Ctrl+V', 'Paste item'], ['Del', 'Delete item']]],
  ['Interface', [['Ctrl+K', 'Search'], ['Ctrl++', 'Zoom in'], ['Ctrl+-', 'Zoom out'], ['Ctrl+0', 'Reset zoom'], ['Ctrl+Shift+F', 'Toggle find'], ['Ctrl+Alt+V', 'Toggle two-pane view'], ['Ctrl+/', 'Shortcut cheatsheet']]],
  ['Windows and modals', [['Ctrl+N', 'New…'], ['Ctrl+Shift+N', 'New window'], ['Ctrl+O', 'Import'], ['Ctrl+,', 'Settings'], ['Ctrl+Alt+C', 'Console'], ['Esc', 'Close dialog / menu']]],
];

function combo(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

// Shortcuts the code editor should keep when it has focus.
const EDITOR_OWNS = new Set(['Ctrl+KeyF', 'Ctrl+Slash', 'Ctrl+KeyD', 'Ctrl+Shift+KeyK', 'Ctrl+KeyH']);

export function initShortcuts(a) {
  const map = {
    'Ctrl+KeyT': a.newTab, 'Ctrl+KeyW': a.closeTab, 'Ctrl+Alt+KeyW': a.forceCloseTab,
    'Ctrl+Tab': () => a.nextTab(1), 'Ctrl+Shift+Tab': () => a.nextTab(-1), 'Ctrl+PageDown': () => a.nextTab(1), 'Ctrl+PageUp': () => a.nextTab(-1),
    'Ctrl+Shift+KeyT': a.reopenTab, 'Ctrl+Shift+KeyA': a.searchTabs,
    'Ctrl+KeyL': a.focusUrl, 'Ctrl+KeyS': a.save, 'Ctrl+Shift+KeyS': a.saveAs,
    'Ctrl+Enter': a.send, 'Ctrl+NumpadEnter': a.send, 'Ctrl+Alt+Enter': a.sendDownload,
    'Ctrl+Alt+ArrowUp': a.focusRequest, 'Ctrl+Alt+ArrowDown': a.focusResponse, 'Ctrl+KeyB': a.beautify,
    'Ctrl+KeyF': a.searchSidebar, 'Ctrl+Backslash': a.toggleSidebar, 'Ctrl+IntlBackslash': a.toggleSidebar,
    'Ctrl+KeyK': a.search, 'Ctrl+Equal': () => a.zoom(1), 'Ctrl+Shift+Equal': () => a.zoom(1), 'Ctrl+NumpadAdd': () => a.zoom(1),
    'Ctrl+Minus': () => a.zoom(-1), 'Ctrl+NumpadSubtract': () => a.zoom(-1), 'Ctrl+Digit0': () => a.zoom(0), 'Ctrl+Numpad0': () => a.zoom(0),
    'Ctrl+Shift+KeyF': a.find, 'Ctrl+Alt+KeyV': a.toggleLayout, 'Ctrl+Slash': a.cheatsheet,
    'Ctrl+KeyN': a.newDialog, 'Ctrl+Shift+KeyN': a.newWindow, 'Ctrl+KeyO': a.import, 'Ctrl+Comma': a.settings, 'Ctrl+Alt+KeyC': a.console,
    'Ctrl+Shift+KeyI': a.devtools,
  };
  for (let i = 1; i <= 9; i++) map[`Ctrl+Digit${i}`] = () => a.gotoTab(i);
  window.addEventListener('keydown', e => {
    if (modalOpen() || document.querySelector('.menu')) return;
    const c = combo(e);
    const fn = map[c];
    if (!fn) return;
    if (EDITOR_OWNS.has(c) && focusedEditor()) return;
    // Plain-text inputs keep their native Ctrl+Z/C/V etc.; we only bind combos that inputs don't use.
    e.preventDefault();
    e.stopPropagation();
    fn();
  }, true);
}
