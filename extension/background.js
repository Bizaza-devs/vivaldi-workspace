import { extractPage } from './extract.js';

// Megnyitás módja: 'window' (külön kis ablak, Vivaldi-ban ez biztos) vagy 'sidepanel'.
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
    chrome.contextMenus.create({ id: 'gp-selection', title: 'Kérdezd a Geminit a kijelölésről', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'gp-summary', title: 'Oldal összefoglalása (Gemini)', contexts: ['page'] });
  });
});

async function openPanel(tab) {
  if (openMode === 'sidepanel' && chrome.sidePanel && chrome.sidePanel.open && tab) {
    try { await chrome.sidePanel.open({ windowId: tab.windowId }); return; } catch { /* ablakra vált */ }
  }
  const { panelWindowId } = await chrome.storage.session.get('panelWindowId');
  if (panelWindowId) {
    try { await chrome.windows.update(panelWindowId, { focused: true }); return; } catch { /* bezárták */ }
  }
  const opts = { url: chrome.runtime.getURL('panel.html'), type: 'popup', width: 420, height: 720 };
  if (tab) {
    try {
      const w = await chrome.windows.get(tab.windowId);
      opts.left = Math.max(0, w.left + w.width - 440);
      opts.top = w.top + 90;
    } catch { /* alapértelmezett hely */ }
  }
  const win = await chrome.windows.create(opts);
  await chrome.storage.session.set({ panelWindowId: win.id });
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { panelWindowId } = await chrome.storage.session.get('panelWindowId');
  if (id === panelWindowId) chrome.storage.session.remove('panelWindowId');
});

// Ikon vagy Alt+G (oldalpanel módban ezt a böngésző maga nyitja, ide nem jut el).
chrome.action.onClicked.addListener((tab) => { openPanel(tab); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Az oldalpanelt a kattintással egy ütemben kell nyitni, különben a böngésző tiltja.
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
      pending = { kind: 'page', ...r.result, prompt: 'Foglald össze ezt az oldalt röviden, pontokba szedve.' };
    } catch {
      pending = { kind: 'error', text: 'Ezt az oldalt a böngésző nem engedi beolvasni.' };
    }
  } else {
    return;
  }
  await chrome.storage.local.set({ pending: { ...pending, at: Date.now() } });
  if (openMode !== 'sidepanel') openPanel(tab);
}
