// Gemini API (Google AI Studio key). The key is sent in a header, not in the URL.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

async function fail(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (j && j.error && j.error.message) msg = j.error.message;
  } catch { /* not JSON */ }
  throw new GeminiError(msg, res.status);
}

// Text Gemini models available for the key.
export async function listModels(key) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${BASE}/models?pageSize=1000${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
    const res = await fetch(url, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) await fail(res);
    const j = await res.json();
    for (const m of j.models || []) {
      const id = String(m.name || '').replace(/^models\//, '');
      if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
      if (!/gemini/i.test(id)) continue;
      if (/embedding|tts|image|audio|live|native|robotics|computer-use|nano-banana|transcribe|omni|customtools/i.test(id)) continue;
      out.push({ id, label: m.displayName || id });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

const version = (id) => {
  const m = id.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
};
const unstable = (id) => (/preview|exp/i.test(id) ? 1 : 0);

// Suggested pair: fast = Flash-Lite, strong = Flash (free tier) or Pro (paid tier).
// Prefers Google's maintained "-latest" aliases first (the official examples use them
// too, and they always point to the current stable model).
export function suggestModels(models, freeTier) {
  const has = (id) => models.some((m) => m.id === id);
  const latestFast = has('gemini-flash-lite-latest') ? 'gemini-flash-lite-latest' : '';
  const latestStrong = freeTier
    ? (has('gemini-flash-latest') ? 'gemini-flash-latest' : '')
    : (has('gemini-pro-latest') ? 'gemini-pro-latest' : (has('gemini-flash-latest') ? 'gemini-flash-latest' : ''));
  const fallback = pickByVersion(models, freeTier);
  return { fast: latestFast || fallback.fast, strong: latestStrong || fallback.strong };
}

function pickByVersion(models, freeTier) {
  // stable first, newest version within that; preview only if no stable exists
  const sorted = [...models].sort((a, b) =>
    (unstable(a.id) - unstable(b.id)) || (version(b.id) - version(a.id)) || (a.id.length - b.id.length));
  const lite = sorted.find((m) => /flash-lite/i.test(m.id));
  const flash = sorted.find((m) => /flash/i.test(m.id) && !/lite/i.test(m.id));
  const pro = sorted.find((m) => /pro/i.test(m.id));
  const fast = lite || flash || sorted[0];
  const strong = (freeTier ? flash : (pro || flash)) || fast;
  return { fast: fast ? fast.id : '', strong: strong ? strong.id : '' };
}

// If no data arrives for this long, the request aborts (504) and the panel falls back to the fast model.
const IDLE_MS = 60000;

// Streamed reply (SSE). onDelta receives the full text so far.
export async function streamChat({ key, model, system, messages, signal, onDelta, idleMs = IDLE_MS }) {
  const body = {
    contents: messages.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })),
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  let timer = 0;
  let timedOut = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, idleMs);
  };

  try {
    arm();
    return await readStream();
  } catch (e) {
    if (timedOut) throw new GeminiError(`The model did not respond for ${Math.round(idleMs / 1000)} seconds.`, 504);
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  async function readStream() {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (!res.ok) await fail(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    let blocked = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let j;
        try { j = JSON.parse(line.slice(5)); } catch { continue; }
        if (j.error) throw new GeminiError(j.error.message || 'Unknown error', j.error.code);
        if (j.promptFeedback && j.promptFeedback.blockReason) blocked = j.promptFeedback.blockReason;
        const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        if (text) {
          full += text;
          onDelta(full);
        }
      }
    }
    if (!full && blocked) throw new GeminiError(`Gemini blocked the request (${blocked}).`, 400);
    return full;
  }
}
