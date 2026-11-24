import * as store from './store.js';
import { listModels, suggestModels, streamChat } from './gemini.js';
import { renderMarkdown } from './md.js';
import { extractPage } from './extract.js';

const $ = (s) => document.querySelector(s);
const isExt = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);

const DEFAULTS = {
  apiKey: '',
  fastModel: '',
  strongModel: '',
  models: [],
  route: 'auto',
  openMode: 'window',
  freeTier: true,
  system: 'Reply in the language the user writes in, concisely and accurately. If you do not know something, say so; never make up data. Use Markdown for formatting.',
};
const MAX_SAVED = 60;      // messages kept in storage
const MAX_HISTORY = 20;    // messages sent back to the model as context

// In Auto mode the strong model answers these keywords (English and Hungarian) or long messages.
const STRONG_HINT = /(code|program|function|script|debug|bug|error|analy[sz]|strateg|plan|detailed|compare|argue|math|calculat|prove|essay|letter|email|table|write (a|me)|kód|függvény|hib[aá]|elemz|stratégi|terv|részletes|összehasonlít|matek|számol|bizonyít|fogalmazz|írj (egy|nekem)|esszé|levelet|e-mailt|táblázat)/i;

let settings = { ...DEFAULTS };
let chat = [];       // { role: 'user'|'model', text, send?, ctx?, tier?, model?, note?, error?, pending? }
let ctx = null;      // attached context: { kind: 'page'|'selection', title, url, text }
let busy = null;     // AbortController while a reply is streaming

const el = {
  messages: $('#messages'), empty: $('#empty'), chat: $('#chat'), input: $('#input'), send: $('#send'),
  ctx: $('#ctx'), ctxLabel: $('#ctx .ctx-label'), route: $('#route'), privacy: $('#privacy'),
  sheet: $('#settings'), toast: $('#toast'),
};

init();

async function init() {
  const s = await store.get(['settings', 'chat']);
  settings = { ...DEFAULTS, ...(s.settings || {}) };
  chat = Array.isArray(s.chat) ? s.chat.filter((m) => !m.pending) : [];
  bindUI();
  syncSettingsUI();
  renderAll();
  if (!settings.apiKey || location.hash === '#settings') showSettings(true);
  else el.input.focus();

  store.onChange((ch) => {
    if (ch.pending && ch.pending.newValue) takePending(ch.pending.newValue);
  });
  const p = await store.get(['pending']);
  if (p.pending) takePending(p.pending);
}

/* ---------- UI ---------- */

function bindUI() {
  el.input.addEventListener('input', autosize);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(el.input.value); }
    if (e.key === 'Escape' && busy) busy.abort();
  });
  el.send.addEventListener('click', () => (busy ? busy.abort() : send(el.input.value)));
  $('#attach').addEventListener('click', () => attachPage());
  $('#ctx .ctx-x').addEventListener('click', () => setCtx(null));
  $('#newChat').addEventListener('click', newChat);
  $('#openSettings').addEventListener('click', () => showSettings(true));
  $('#closeSettings').addEventListener('click', () => showSettings(false));
  el.route.addEventListener('change', () => saveSettings({ route: el.route.value }));

  for (const b of document.querySelectorAll('.chips button')) {
    b.addEventListener('click', async () => {
      if (b.dataset.page && !(await attachPage())) return;
      send(b.dataset.prompt);
    });
  }

  // Settings
  const key = $('#apiKey');
  key.addEventListener('change', () => saveSettings({ apiKey: key.value.trim() }));
  $('#toggleKey').addEventListener('click', (e) => {
    const show = key.type === 'password';
    key.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
  });
  $('#loadModels').addEventListener('click', loadModels);
  $('#fastModel').addEventListener('change', (e) => saveSettings({ fastModel: e.target.value }));
  $('#strongModel').addEventListener('change', (e) => saveSettings({ strongModel: e.target.value }));
  $('#openMode').addEventListener('change', (e) => saveSettings({ openMode: e.target.value }));
  $('#freeTier').addEventListener('change', (e) => { saveSettings({ freeTier: e.target.checked }); syncSettingsUI(); });
  $('#system').addEventListener('change', (e) => saveSettings({ system: e.target.value.trim() || DEFAULTS.system }));
  $('#clearChat').addEventListener('click', () => { newChat(); showSettings(false); toast('Chat cleared.'); });

  // Copy code blocks and messages (event delegation, because the content re-renders)
  el.messages.addEventListener('click', (e) => {
    const t = e.target.closest('[data-copy]');
    if (!t) return;
    const text = t.dataset.copy === 'code'
      ? t.closest('pre').querySelector('code').innerText
      : (chat[Number(t.dataset.copy)] || {}).text || '';
    navigator.clipboard.writeText(text).then(() => toast('Copied.'), () => toast('Could not copy.'));
  });
}

function autosize() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 180) + 'px';
}

function showSettings(on) {
  el.sheet.hidden = !on;
  if (on) $('#apiKey').focus();
  else el.input.focus();
}

function syncSettingsUI() {
  el.route.value = settings.route;
  $('#apiKey').value = settings.apiKey;
  $('#openMode').value = settings.openMode;
  $('#freeTier').checked = settings.freeTier;
  $('#system').value = settings.system;
  $('#panelUrl').textContent = isExt ? chrome.runtime.getURL('panel.html') : '(extension only)';
  el.privacy.hidden = !settings.freeTier;
  fillModelSelect($('#fastModel'), settings.fastModel);
  fillModelSelect($('#strongModel'), settings.strongModel);
}

function fillModelSelect(select, value) {
  const list = settings.models.length ? settings.models : (value ? [{ id: value, label: value }] : []);
  select.innerHTML = '';
  if (!list.length) select.append(new Option('– load the models first –', ''));
  for (const m of list) select.append(new Option(m.label === m.id ? m.id : `${m.label} (${m.id})`, m.id));
  select.value = value || '';
}

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await store.set({ settings });
}

async function loadModels() {
  const btn = $('#loadModels');
  const status = $('#modelStatus');
  const key = $('#apiKey').value.trim();
  if (!key) { status.textContent = 'Enter the key.'; return; }
  btn.disabled = true;
  status.textContent = 'Checking…';
  try {
    const models = await listModels(key);
    if (!models.length) throw new Error('No text Gemini models are available for this key.');
    const pick = suggestModels(models, settings.freeTier);
    const keep = (id) => models.some((m) => m.id === id);
    await saveSettings({
      apiKey: key,
      models,
      fastModel: keep(settings.fastModel) ? settings.fastModel : pick.fast,
      strongModel: keep(settings.strongModel) ? settings.strongModel : pick.strong,
    });
    syncSettingsUI();
    status.textContent = `OK: ${models.length} models available.`;
  } catch (e) {
    status.textContent = 'Error: ' + explain(e);
  } finally {
    btn.disabled = false;
  }
}

function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

function setCtx(c) {
  ctx = c;
  el.ctx.hidden = !c;
  if (c) {
    const what = c.kind === 'selection' ? 'Selection' : 'Page';
    el.ctxLabel.textContent = `${what}: ${c.title || c.url || ''}`;
    el.ctxLabel.title = c.url || '';
  }
}

/* ---------- Context ---------- */

async function attachPage() {
  if (!isExt) { toast('This only works as an extension.'); return null; }
  // One-time permission for all sites: the page is read only when this button is pressed.
  try { await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch { /* may still work with activeTab */ }
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab) throw new Error('no active tab');
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
    const d = r && r.result;
    if (!d || !d.text) throw new Error('empty page');
    const c = d.selection
      ? { kind: 'selection', title: d.title, url: d.url, text: d.selection }
      : { kind: 'page', title: d.title, url: d.url, text: d.text };
    setCtx(c);
    el.input.focus();
    return c;
  } catch {
    toast('Cannot read this page (internal or protected page).');
    return null;
  }
}

async function takePending(p) {
  await store.remove(['pending']);
  if (!p || Date.now() - (p.at || 0) > 60000) return;
  if (p.kind === 'error') { toast(p.text); return; }
  showSettings(false);
  setCtx({ kind: p.kind, title: p.title, url: p.url, text: p.text });
  if (p.prompt) send(p.prompt);
  else {
    el.input.value = 'Explain this briefly.';
    autosize();
    el.input.focus();
    el.input.select();
  }
}

/* ---------- Send ---------- */

function pickTier(text) {
  if (settings.route === 'fast' || settings.route === 'strong') return settings.route;
  if (text.length > 600 || text.includes('```') || STRONG_HINT.test(text)) return 'strong';
  return 'fast';
}

function modelFor(tier) {
  return tier === 'strong'
    ? (settings.strongModel || settings.fastModel)
    : (settings.fastModel || settings.strongModel);
}

function buildPayload(text, c) {
  if (!c) return text;
  const head = c.kind === 'selection' ? 'Selected text' : 'Page content';
  return `${text}\n\n---\n${head}${c.title ? ` – ${c.title}` : ''}${c.url ? `\n${c.url}` : ''}\n\n${c.text}`;
}

// The model needs alternating user/model turns: skip failed replies and merge consecutive ones.
function buildHistory(upto) {
  const out = [];
  for (const m of chat.slice(0, upto).slice(-MAX_HISTORY)) {
    if (m.role === 'model' && (m.error || !m.text)) continue;
    const text = m.send || m.text;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += '\n\n' + text;
    else out.push({ role: m.role, text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function send(raw) {
  const text = String(raw || '').trim();
  if (!text || busy) return;
  if (!settings.apiKey) { showSettings(true); toast('Add your Gemini API key first.'); return; }
  const tier = pickTier(text);
  const model = modelFor(tier);
  if (!model) { showSettings(true); toast('Load the models in Settings.'); return; }

  const c = ctx;
  setCtx(null);
  chat.push({ role: 'user', text, send: buildPayload(text, c), ctx: c ? { kind: c.kind, title: c.title, url: c.url } : null });
  const reply = { role: 'model', text: '', tier, model, pending: true };
  chat.push(reply);
  const history = buildHistory(chat.length - 1);

  el.input.value = '';
  autosize();
  renderAll();
  busy = new AbortController();
  document.body.classList.add('busy');

  const signal = busy.signal;
  const once = (m) => {
    reply.model = m;
    return streamChat({
      key: settings.apiKey, model: m, system: settings.system, messages: history, signal,
      onDelta: (t) => { reply.text = t; scheduleRender(); },
    });
  };
  // On overload (503/500), retry the same model once.
  const run = async (m) => {
    try {
      return await once(m);
    } catch (e) {
      if (![500, 503].includes(e.status) || reply.text || signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      if (signal.aborted) throw e;
      return once(m);
    }
  };

  try {
    try {
      await run(model);
    } catch (e) {
      const fallback = settings.fastModel;
      const canFallBack = tier === 'strong' && fallback && fallback !== model && !reply.text
        && e.name !== 'AbortError' && [403, 404, 429, 500, 503, 504].includes(e.status);
      if (!canFallBack) throw e;
      reply.note = 'The strong model is unavailable right now; the fast model replied.';
      reply.tier = 'fast';
      await run(fallback);
    }
  } catch (e) {
    if (e.name === 'AbortError') reply.note = 'Stopped.';
    else reply.error = explain(e);
  } finally {
    reply.pending = false;
    busy = null;
    document.body.classList.remove('busy');
    renderAll();
    save();
  }
}

function explain(e) {
  const msg = String((e && e.message) || e);
  if (e instanceof TypeError) return 'No connection to the Gemini API.';
  if (/api key/i.test(msg) && (e.status === 400 || e.status === 403)) return 'Invalid API key.';
  if (e.status === 429) return 'You hit the per-minute or daily limit. Wait a little, or switch to Fast mode.';
  if (e.status === 403) return 'This key has no access to this model.';
  if (e.status === 404) return 'Model not found. Reload the models in Settings.';
  if (e.status === 503 || e.status === 500) return 'The model is overloaded. Try again a little later, or switch to Fast mode.';
  if (e.status === 504) return msg + ' Try again, or switch to Fast mode.';
  return msg;
}

function newChat() {
  if (busy) busy.abort();
  chat = [];
  setCtx(null);
  renderAll();
  save();
  el.input.focus();
}

function save() {
  store.set({ chat: chat.slice(-MAX_SAVED).map(({ pending, ...m }) => m) });
}

/* ---------- Rendering ---------- */

const ICON_DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function messageHtml(m, i) {
  if (m.role === 'user') {
    const tag = m.ctx
      ? `<div class="tag">${ICON_DOC}<span>${m.ctx.kind === 'selection' ? 'Selection' : 'Page'}: ${escHtml(m.ctx.title || m.ctx.url || '')}</span></div>`
      : '';
    return `<div class="msg user"><div class="bubble">${escHtml(m.text)}</div>${tag}</div>`;
  }
  const tierName = m.tier === 'strong' ? 'Strong' : 'Fast';
  const meta = `<div class="meta"><span class="tier ${m.tier}">${tierName}</span><span>${escHtml(m.model || '')}</span></div>`;
  const body = m.text
    ? `<div class="md">${renderMarkdown(m.text)}</div>`
    : (m.pending ? '<div class="typing"><i></i><i></i><i></i></div>' : '');
  const note = m.note ? `<div class="note">${escHtml(m.note)}</div>` : '';
  const err = m.error ? `<div class="error">${escHtml(m.error)}</div>` : '';
  const actions = !m.pending && m.text
    ? `<div class="actions"><button class="icon" data-copy="${i}" title="Copy reply" aria-label="Copy reply">${ICON_COPY}</button></div>`
    : '';
  return `<div class="msg model">${meta}${body}${note}${err}${actions}</div>`;
}

function decorate(root) {
  for (const pre of root.querySelectorAll('.md pre')) {
    if (pre.querySelector('.copy-code')) continue;
    const b = document.createElement('button');
    b.className = 'copy-code';
    b.dataset.copy = 'code';
    b.textContent = 'Copy';
    pre.append(b);
  }
}

function nearBottom() {
  const c = el.chat;
  return c.scrollHeight - c.scrollTop - c.clientHeight < 80;
}

function renderAll() {
  el.empty.hidden = chat.length > 0;
  el.messages.innerHTML = chat.map(messageHtml).join('');
  decorate(el.messages);
  el.chat.scrollTop = el.chat.scrollHeight;
}

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const stick = nearBottom();
    const i = chat.length - 1;
    const last = el.messages.lastElementChild;
    if (!last || i < 0) return renderAll();
    last.outerHTML = messageHtml(chat[i], i);
    decorate(el.messages);
    if (stick) el.chat.scrollTop = el.chat.scrollHeight;
  });
}
