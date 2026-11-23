// Az oldal szövegének kinyerése. Önálló függvény: a chrome.scripting
// sorosítja és az oldalon futtatja, ezért kívülről semmit nem használhat.
export function extractPage() {
  const LIMIT = 60000;
  const clean = (s) => (s || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const main = document.querySelector('article, main, [role="main"]');
  let text = clean(main ? main.innerText : '');
  if (text.length < 400) text = clean(document.body ? document.body.innerText : '');
  if (text.length > LIMIT) text = text.slice(0, LIMIT) + '\n…(levágva)';
  const selection = String(window.getSelection ? window.getSelection() : '').trim().slice(0, 20000);
  return { title: document.title, url: location.href, text, selection };
}
