// Kicsi, biztonságos Markdown-megjelenítő: előbb mindent escape-el, utána formáz.
// Tud: kódblokk, inline kód, címsor, lista, idézet, táblázat, félkövér, dőlt, http(s)-link, vonal.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(esc(c.trim())));

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++;
      const lang = fence[1] ? ` data-lang="${esc(fence[1])}"` : '';
      out.push(`<pre><code${lang}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }

    const h = line.match(HEADING);
    if (h) {
      const n = Math.min(h[1].length + 2, 6);
      out.push(`<h${n}>${inline(esc(h[2]))}</h${n}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      const thead = head.map((c) => `<th>${c}</th>`).join('');
      const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`);
      continue;
    }

    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (ITEM.test(line)) {
      const ordered = /\d/.test(line.match(ITEM)[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(ITEM);
        if (m) { items.push(m[3]); i++; continue; }
        if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(esc(t))}</li>`).join('')}</${tag}>`);
      continue;
    }

    const buf = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i])
      && !ITEM.test(lines[i]) && !QUOTE.test(lines[i]) && !RULE.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${buf.map((l) => inline(esc(l))).join('<br>')}</p>`);
  }
  return out.join('');
}
