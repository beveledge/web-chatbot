// lib/md-renderer.js
// Enkel, koncentrerad renderer för att göra bot-svar → HTML
// Målet: lättare underhåll än 500 rader regex direkt i widgeten.

/**
 * Normalisera text lite försiktigt så vi slipper konstiga mellanslag/streck.
 */
function normalizeBase(text = '') {
  return String(text)
    .replace(/\u00A0/g, ' ')                       // NBSP → space
    .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-')  // snyggstreck → '-'
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Konvertera enkel markdown → HTML:
 * - [Länk](https://…) → <a>
 * - **fet** / *kursiv*
 */
function applyInlineMarkup(s) {
  // Länkar
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>'
  );

  // Fetstil
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Kursiv
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return s;
}

/**
 * Bygg HTML-block:
 * - stycken
 * - ul/ol-listor
 * - extra luft före "Tips:", "Relaterad läsning:", "Källa:"
 */
export function renderMessageToHtml(rawText) {
  if (!rawText) return '';

  let s = normalizeBase(rawText);
  s = applyInlineMarkup(s);

  const lines = s.split('\n');
  const out = [];

  let inUL = false;
  let inOL = false;
  let currentLi = null;
  let currentPara = [];

  const flushLi = () => {
    if (currentLi != null) {
      out.push(`<li>${currentLi}</li>`);
      currentLi = null;
    }
  };

  const flushLists = () => {
    flushLi();
    if (inUL) { out.push('</ul>'); inUL = false; }
    if (inOL) { out.push('</ol>'); inOL = false; }
  };

  const flushPara = () => {
    if (currentPara.length) {
      out.push('<p>' + currentPara.join('<br>') + '</p>');
      currentPara = [];
    }
  };

  const startsListHeading =
    /^(?:💡\s*)?Tips\b|(?:📰\s*)?Relaterad\s+läsning\b|Källa:/i;

  for (let raw of lines) {
    const line = raw.trim();
    const plain = line.replace(/<[^>]+>/g, '').trim();

    // Tomrad: bryt stycke (eller rad inne i <li>)
    if (!line) {
      if (inUL || inOL) {
        // Lägg in en extra rad i samma punkt
        if (currentLi != null) currentLi += '<br>';
      } else {
        flushPara();
      }
      continue;
    }

    const mUL = /^[-*•]\s+(.+)$/.exec(line);
    const mOL = /^\d+\.\s+(.+)$/.exec(line);

    if (mUL) {
      if (inOL) { flushLists(); }
      if (!inUL) { flushPara(); out.push('<ul>'); inUL = true; }
      flushLi();
      currentLi = mUL[1];
      continue;
    }

    if (mOL) {
      if (inUL) { flushLists(); }
      if (!inOL) { flushPara(); out.push('<ol>'); inOL = true; }
      flushLi();
      currentLi = mOL[1];
      continue;
    }

    // Om vi är i lista och raden är en tydlig "ny block-sektion" → stäng listan
    if ((inUL || inOL) && startsListHeading.test(plain)) {
      flushLists();
      out.push(''); // liten visuell separation
      currentPara.push(line);
      continue;
    }

    // Fortsättning inuti li
    if (inUL || inOL) {
      if (currentLi == null) currentLi = line;
      else currentLi += '<br>' + line;
      continue;
    }

    // Normal paragraf
    currentPara.push(line);
  }

  // Finalisera
  flushLists();
  flushPara();

  let html = out.join('\n');

  // Extra luft före Tips/Relaterad/Källa om de hamnat direkt efter annat block
  html = html.replace(
    /<\/(p|li|ul|ol)>\s*(<p>(?:<strong>)?(?:💡\s*)?Tips\b[^:<]*:)/gi,
    '</$1><br><br>$2'
  );
  html = html.replace(
    /<\/(p|li|ul|ol)>\s*(<p>(?:📰\s*)?Relaterad\s+läsning:)/gi,
    '</$1><br><br>$2'
  );
  html = html.replace(
    /<\/(p|li|ul|ol)>\s*(<p>(?:<em>)?Källa:)/gi,
    '</$1><br><br>$2'
  );

  return html;
}