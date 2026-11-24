import { extractPage } from './extract.js';

// Open mode: 'window' (small separate window, reliable in Vivaldi) or 'sidepanel'.
let openMode = 'window';

function applyBehavior() {
  if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) return;
  Promise.resolve(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openMode === 'sidepanel' })).catch(() => {});
}

chrome.storage.local.get('settings').then((s) => {
  openMode = (s.settings && s.settings.openMode) || 'window';
  applyBehavior();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  openMode = (changes.settings.newValue && changes.settings.newValue.openMode) || 'window';
  applyBehavior();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'gp-selection', title: 'Ask Gemini about the selection', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'gp-summary', title: 'Summarise page (Gemini)', contexts: ['page'] });
  });
});

async function openPanel(tab) {
  if (openMode === 'sidepanel' && chrome.sidePanel && chrome.sidePanel.open && tab) {
    try { await chrome.sidePanel.open({ windowId: tab.windowId }); return; } catch { /* fall back to a window */ }
  }
  const { panelWindowId } = await chrome.storage.session.get('panelWindowId');
  if (panelWindowId) {
    try { await chrome.windows.update(panelWindowId, { focused: true }); return; } catch { /* it was closed */ }
  }
  const opts = { url: chrome.runtime.getURL('panel.html'), type: 'popup', width: 420, height: 720 };
  if (tab) {
    try {
      const w = await chrome.windows.get(tab.windowId);
      opts.left = Math.max(0, w.left + w.width - 440);
      opts.top = w.top + 90;
    } catch { /* default position */ }
  }
  const win = await chrome.windows.create(opts);
  await chrome.storage.session.set({ panelWindowId: win.id });
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { panelWindowId } = await chrome.storage.session.get('panelWindowId');
  if (id === panelWindowId) chrome.storage.session.remove('panelWindowId');
});

// Icon or Alt+G (in side panel mode the browser opens it itself and this is not reached).
chrome.action.onClicked.addListener((tab) => { openPanel(tab); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // The side panel must open in the same tick as the click, otherwise the browser blocks it.
  if (openMode === 'sidepanel' && chrome.sidePanel && chrome.sidePanel.open && tab) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  handleMenu(info, tab);
});

async function handleMenu(info, tab) {
  let pending;
  if (info.menuItemId === 'gp-selection') {
    pending = {
      kind: 'selection',
      text: info.selectionText || '',
      title: (tab && tab.title) || '',
      url: (tab && tab.url) || info.pageUrl || '',
    };
  } else if (info.menuItemId === 'gp-summary') {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
      pending = { kind: 'page', ...r.result, prompt: 'Summarise this page briefly as bullet points.' };
    } catch {
      pending = { kind: 'error', text: 'The browser does not allow reading this page.' };
    }
  } else {
    return;
  }
  await chrome.storage.local.set({ pending: { ...pending, at: Date.now() } });
  if (openMode !== 'sidepanel') openPanel(tab);
}
