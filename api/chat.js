// /api/chat.js — v5.0.6
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

/* ========== CORS (hostname-baserad) ========== */
function isAllowedOrigin(origin = '') {
  try {
    const u = new URL(origin);
    const host = u.hostname;
    const ALLOWED = [
      'webbyrasigtuna.se',
      /^[a-z0-9-]+\.webbyrasigtuna\.se$/i, // valfri subdomän
    ];
    return ALLOWED.some(rule =>
      typeof rule === 'string' ? rule === host : rule.test(host)
    );
  } catch {
    return false;
  }
}
function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

/* ========== Config för LLMs-filer ========== */
const LLMS_BASE         = 'https://webbyrasigtuna.se';
const LLMS_INDEX_URL    = `${LLMS_BASE}/llms.txt`;
const LLMS_FULL_URL     = `${LLMS_BASE}/llms-full.txt`;
const LLMS_FULL_SV_URL  = `${LLMS_BASE}/llms-full-sv.txt`;
const LLMS_TTL          = 60 * 60 * 12; // 12h cache

const LLMS_INDEX_KEY    = 'llms:index';
const LLMS_FULL_KEY     = 'llms:full';
const LLMS_FULL_SV_KEY  = 'llms:full_sv';

// Hur mycket kontext vi vågar injicera i systemprompten
const LLMS_MAX_CHARS_PER_BLOCK = 2000; // ca 400–600 tokens
const ADD_SOURCE_FOOTER = true;        // “Källa: …” när interna länkar finns

/* ========== Sitemap-cache & helpers ========== */
const SITEMAP_INDEX = 'https://webbyrasigtuna.se/sitemaps.xml';
const SITEMAP_FALLBACKS = [
  'https://webbyrasigtuna.se/post-sitemap1.xml',
  'https://webbyrasigtuna.se/page-sitemap1.xml',
];
const SITEMAP_CACHE_KEY = 'sitemap:urls';
const POSTS_CACHE_KEY   = 'sitemap:posts';
const SITEMAP_TTL       = 60 * 60 * 24; // 24h

async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return await r.text();
}
function extractXmlLocs(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
}
function filterHost(urls, host = 'webbyrasigtuna.se') {
  const out = [];
  for (const u of urls) {
    try {
      const x = new URL(u);
      if (x.hostname === host || x.hostname.endsWith('.' + host)) out.push(x.toString());
    } catch {}
  }
  return out;
}

async function loadSitemapUrls() {
  try {
    const cached = await kv.get(SITEMAP_CACHE_KEY);
    if (Array.isArray(cached) && cached.length) return new Set(cached);
  } catch {}
  let urls = [];
  try {
    const indexXml = await fetchText(SITEMAP_INDEX);
    const subs = extractXmlLocs(indexXml);
    if (subs.length) {
      for (const sm of subs) {
        try { urls.push(...extractXmlLocs(await fetchText(sm))); } catch {}
      }
    }
  } catch {
    for (const f of SITEMAP_FALLBACKS) {
      try { urls.push(...extractXmlLocs(await fetchText(f))); } catch {}
    }
  }
  const set = new Set(filterHost(urls));
  try { await kv.set(SITEMAP_CACHE_KEY, [...set], { ex: SITEMAP_TTL }); } catch {}
  return set;
}

async function loadPostUrls() {
  try {
    const cached = await kv.get(POSTS_CACHE_KEY);
    if (Array.isArray(cached) && cached.length) return cached;
  } catch {}
  let postUrls = [];
  try {
    const indexXml = await fetchText(SITEMAP_INDEX);
    const subs = extractXmlLocs(indexXml);
    const postMaps = subs.filter(u => /post-sitemap/i.test(u));
    for (const sm of postMaps) {
      try { postUrls.push(...extractXmlLocs(await fetchText(sm))); } catch {}
    }
  } catch {}
  if (!postUrls.length) {
    try { postUrls = extractXmlLocs(await fetchText('https://webbyrasigtuna.se/post-sitemap1.xml')); } catch {}
  }
  postUrls = filterHost(postUrls);
  try { await kv.set(POSTS_CACHE_KEY, postUrls, { ex: SITEMAP_TTL }); } catch {}
  return postUrls;
}

/* ========== LLMS-hämtning & cache ========== */
async function loadKVOrFetch(key, url, ttlSeconds) {
  try {
    const cached = await kv.get(key);
    if (typeof cached === 'string' && cached.length) return cached;
  } catch {}
  try {
    const text = await fetchText(url);
    await kv.set(key, text, { ex: ttlSeconds });
    return text;
  } catch {
    return ''; // fail soft
  }
}

async function loadLLMSBundle() {
  const [indexTxt, fullTxt, fullSvTxt] = await Promise.all([
    loadKVOrFetch(LLMS_INDEX_KEY,   LLMS_INDEX_URL,   LLMS_TTL),
    loadKVOrFetch(LLMS_FULL_KEY,    LLMS_FULL_URL,    LLMS_TTL),
    loadKVOrFetch(LLMS_FULL_SV_KEY, LLMS_FULL_SV_URL, LLMS_TTL),
  ]);
  // begränsa längd
  const svPart   = (fullSvTxt || '').slice(0, LLMS_MAX_CHARS_PER_BLOCK);
  const fullPart = (fullTxt   || '').slice(0, LLMS_MAX_CHARS_PER_BLOCK);
  return { indexTxt, fullPart, svPart };
}

/* ========== Svenska hjälp-funktioner ========== */
const STOPWORDS = new Set([
  'och','att','som','för','med','en','ett','det','den','de','vi','ni','jag','hur','varför','tips','om','till','på','i','av','er','era',
  'vår','vårt','våra','din','ditt','dina','han','hon','man','min','mitt','mina','deras','från','mer','mindre','utan','eller','så',
  'också','kan','ska','få','får','var','är','bli','blir','nya','ny'
]);
function tokenizeSv(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[^\p{Letter}\p{Number}\s-]/gu, ' ')
    .split(/[\s/._-]+/)
    .filter(t => t && !STOPWORDS.has(t) && t.length > 1);
}
function prettyFromSlug(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    let s = decodeURIComponent(segs[segs.length - 1] || '');

    s = s.replace(/-/g, ' ').toLowerCase();
    s = s.replace(/\s+/g, ' ').trim();
    if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
    s = s.replace(/\bseo\b/g, 'SEO')
         .replace(/\blokal seo\b/g, 'lokal SEO')
         .replace(/\bwordpress\b/g, 'WordPress');
    return s;
  } catch {
    return url;
  }
}

/* Label-mappning + display-namn (hanterar även “-tjänster”) */
function mapLabel(labelRaw = '') {
  const norm = labelRaw
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const hasTjanster = /tja?nster/.test(norm);
  const display = (base) => {
    if (base === 'seo')        return hasTjanster ? 'SEO-tjänster' : 'SEO';
    if (base === 'lokal seo')  return hasTjanster ? 'Lokal SEO-tjänster' : 'Lokal SEO';
    if (base === 'wordpress')  return hasTjanster ? 'WordPress-underhåll' : 'WordPress';
    if (base === 'underhåll')  return 'WordPress-underhåll';
    return base.charAt(0).toUpperCase() + base.slice(1);
  };

  if (norm.includes('lokal seo'))   return { key: 'lokal seo', display: display('lokal seo') };
  if (/\bseo\b/.test(norm))         return { key: 'seo',       display: display('seo') };
  if (norm.startsWith('wordpress')) return { key: 'wordpress', display: display('wordpress') };
  if (norm.includes('underhåll'))   return { key: 'underhåll', display: display('underhåll') };
  if (norm.includes('webbdesign'))  return { key: 'webbdesign', display: 'Webbdesign' };
  if (norm.includes('tjänster'))    return { key: 'tjänster',   display: 'Tjänster' };
  if (norm.includes('annonsering')) return { key: 'annonsering', display: 'Annonsering' };
  if (norm.includes('priser'))      return { key: 'priser', display: 'Priser' };
  if (norm.includes('webbanalys'))  return { key: 'webbanalys', display: 'Webbanalys' };
  if (norm.includes('digital'))     return { key: 'annonsering', display: 'Digital marknadsföring' }; // fallback
  return null;
}

/* ========== Huvud-handler ========== */
export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
    if (req.method !== 'POST')   { setCors(req, res); return res.status(405).json({ error: 'Method not allowed' }); }
    setCors(req, res);

    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

    const { message, sessionId } = req.body || {};
    if (!message || !sessionId) return res.status(400).json({ error: 'Missing message or sessionId' });

    // Historik (KV)
    const key = `chat:${sessionId}`;
    const raw = await kv.lrange(key, -40, -1);
    const history = (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const trimmed = history.slice(-20);

    // Ladda sitemap & inlägg & LLMS
    const [sitemapUrls, postUrls, llms] = await Promise.all([
      loadSitemapUrls(),
      loadPostUrls(),
      loadLLMSBundle()
    ]);

    const llmsContext = `
[LLMS-index]
${(llms.indexTxt || '').slice(0, 1000)}

[LLMS-sammanfattning (EN)]
${llms.fullPart}

[LLMS-språk-stil (SV)]
${llms.svPart}
`.trim();

    // Systemprompt
    const system = {
      role: 'system',
      content: `
Du är Webbyrå Sigtunas kunskapsdrivna marknadsassistent.

Mål:
1) Ge korrekta, begripliga svar om webb, SEO, Lokal SEO, WordPress/underhåll, annonsering och våra tjänster.
2) Hjälp användaren vidare med relevanta länkar till webbyrasigtuna.se (om möjligt).
3) När användaren uttrycker intresse (t.ex. pris, offert, ny webb, SEO, strategi, analys): föreslå att boka ett möte med Andreas på ett naturligt sätt.
4) Håll tonen professionell, vänlig och framåtblickande – på svenska.

Begränsningar:
- Gå inte utanför ovanstående områden. Hänvisa artigt till kontakt om något ligger utanför.
- Påstå inte att du “har träningsdata”; beskriv istället att du baserar svar på vårt innehåll och generell branschkunskap.
- Om du är osäker: be om förtydligande eller föreslå ett kort möte.

Svarsstruktur (när det passar):
- Kort kärnförklaring (2–5 meningar).
- Punktlista med 2–4 konkreta råd eller steg.
- “Läs mer”: 1–2 relevanta länkar till webbyrasigtuna.se.
- Avsluta med en mjuk CTA om läget är rätt (t.ex. boka möte eller snabb analys).

Format:
- Använd korta stycken, tydliga listor, och länka så här: [Sidnamn](https://…).
- Undvik onödigt långt svar; prioritera klarhet och nästa steg.

Primär kunskapsbas:
- Använd innehållet från llms.txt / llms-full.txt / llms-full-sv.txt på webbyrasigtuna.se (kontekst nedan) som prioriterad källa när du svarar om våra tjänster, blogg eller expertis.

${llmsContext}
`.trim(),
    };

    const messages = [system, ...trimmed, { role: 'user', content: message }];

    // OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
    });

    let reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      'Jag är osäker just nu. Vill du omformulera frågan?';

    /* --- Pre-normalize links coming from the model --- */

    // 1) Convert any HTML anchors to Markdown so the widget can safely render them
    reply = reply.replace(
      /<a\s+href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi,
      '[$2]($1)'
    );

    // 2) Fix "( [Label] ) (https://…)" or "(Label) (https://…)" → "[Label](https://…)"
    reply = reply.replace(
      /\(\s*\[?([A-Za-zÅÄÖåäö0-9 .,:;+\-_/&%€$@!?]+?)\]?\s*\)\s*\(\s*(https?:\/\/[^)]+)\s*\)/g,
      '[$1]($2)'
    );

    // 3) If the model produced bare "(https://…)" just drop the stray parens
    reply = reply.replace(/\(\s*(https?:\/\/[^)]+)\s*\)/g, '$1');

    // 3b) Collapse accidental double-wrapped links like [[Label](url)](url)
    reply = reply.replace(
      /\[\s*\[([^\]]+)\]\s*\(\s*(https?:\/\/[^)]+)\s*\)\s*\]\s*\(\s*\2\s*\)/gi,
      '[$1]($2)'
    );

    /* ---------- Normalisering ---------- */
    reply = reply
      .replace(/\u00A0/g, ' ')                    // NBSP → space
      .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-') // snyggstreck → '-'
      .replace(/\blokal seo\b/gi, 'Lokal SEO')
      .replace(/\bseo\b/gi, 'SEO')
      .replace(/\bwordpress\b/gi, 'WordPress');

    const LINKS = {
      'lokal seo': 'https://webbyrasigtuna.se/hjalp-med-lokal-seo/',
      'seo': 'https://webbyrasigtuna.se/sokmotoroptimering/',
      'webbdesign': 'https://webbyrasigtuna.se/webbdesign/',
      'wordpress': 'https://webbyrasigtuna.se/webbplatsunderhall/',
      'wordpress-underhåll': 'https://webbyrasigtuna.se/webbplatsunderhall/',
      'underhåll': 'https://webbyrasigtuna.se/webbplatsunderhall/',
      'annonsering': 'https://webbyrasigtuna.se/digital-annonsering/',
      'tjänster': 'https://webbyrasigtuna.se/vara-digitala-marknadsforingstjanster/',
      'blogg': 'https://webbyrasigtuna.se/blogg/',
      'priser': 'https://webbyrasigtuna.se/priser/',
      'webbanalys': 'https://webbyrasigtuna.se/webbanalys/',
    };

    const infoTriggers = /(hur|varför|tips|guider|steg|förklara|förbättra|optimera|öka|bästa sättet)/i;
    const leadTriggers = /(pris|offert|strategi|analys|möte|projekt|erbjudande|paket|audit|granskning)/i;

    const lower = message.toLowerCase();
    const inlineLinkedKeys = new Set();

    /* === FIX 1: orphan [SEO] + suffix “-tjänster” → länka korrekt === */
    reply = reply.replace(/\[(SEO)\]\s*[–-]?\s*tja?nster/gi, () => {
      const url = LINKS['seo']; if (!sitemapUrls.has(url)) return 'SEO-tjänster';
      inlineLinkedKeys.add('seo');
      return `[SEO-tjänster](${url})`;
    });
    reply = reply.replace(/\[(Lokal\s*SEO)\]\s*[–-]?\s*tja?nster/gi, () => {
      const url = LINKS['lokal seo']; if (!sitemapUrls.has(url)) return 'Lokal SEO-tjänster';
      inlineLinkedKeys.add('lokal seo');
      return `[Lokal SEO-tjänster](${url})`;
    });

    /* === FIX 2: orphan-etiketter [SEO] / [Lokal SEO] / etc → länka === */
    reply = reply.replace(/\[([^\]]+)\](?!\()/g, (m, labelRaw) => {
      const mapped = mapLabel(labelRaw);
      if (!mapped) return labelRaw;
      const url = LINKS[mapped.key];
      if (url && sitemapUrls.has(url)) {
        inlineLinkedKeys.add(mapped.key);
        return `[${mapped.display}](${url})`;
      }
      return labelRaw;
    });

    /* === FIX 3: “här: <Etikett>” → gör etiketten klickbar (utan dubbelt efteråt) === */
    reply = reply.replace(
      /(här\s*:\s*)(Lokal SEO(?:[–-]tja?nster)?|SEO(?:[–-]tja?nster)?|WordPress(?:[–-]underhåll)?|Underhåll|Webbdesign|Tjänster|Annonsering|Priser|Webbanalys)\b(\.)?/gi,
      (m, leadText, labelRaw, dot) => {
        const mapped = mapLabel(labelRaw);
        const url = mapped && LINKS[mapped.key];
        if (!mapped || !url || !sitemapUrls.has(url)) return m;
        inlineLinkedKeys.add(mapped.key);
        return `${leadText}[${mapped.display}](${url})${dot || ''}`;
      }
    );
    // ta bort ev. “här: <Etikett>” som hänger kvar efter länk
    reply = reply.replace(/(\[[^\]]+\]\([^)]+\)[^.]*?)\s+här\s*:\s*[^.\n]+(\.)/gi, '$1$2');

    /* === FIX 4: “Läs mer … <Etikett>.” (utan “här:”) → länk === */
    reply = reply.replace(
      /(Läs\s+mer[^.\n]*?)\b(Lokal SEO(?:[–-]tja?nster)?|SEO(?:[–-]tja?nster)?|WordPress(?:[–-]underhåll)?|Underhåll|Webbdesign|Tjänster|Annonsering|Priser|Webbanalys)\b(\.)?/gi,
      (m, leadText, labelRaw, dot) => {
        const mapped = mapLabel(labelRaw);
        const url = mapped && LINKS[mapped.key];
        if (!mapped || !url || !sitemapUrls.has(url)) return m;
        inlineLinkedKeys.add(mapped.key);
        return `${leadText}[${mapped.display}](${url})${dot || ''}`;
      }
    );

    /* === FIX 5: “[SEO](url)-tjänster” → “[SEO-tjänster](url)” === */
    reply = reply
      .replace(/\[(SEO)\]\((https?:\/\/[^)]+)\)\s*[–-]\s*tja?nster/gi, '[SEO-tjänster]($2)')
      .replace(/\[(Lokal SEO)\]\((https?:\/\/[^)]+)\)\s*[–-]\s*tja?nster/gi, '[Lokal SEO-tjänster]($2)');

    /* === FIX 5b: SÄKER RÅ-URL-STÄDNING (behåll markdown + interna råa, ta bort externa råa) === */
    {
      const mdUrlMatches = [...reply.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi)];
      const mdUrls = new Set(mdUrlMatches.map(m => m[1]));
      reply = reply.replace(/https?:\/\/[^\s)\]]+/gi, (u, off, str) => {
        if (mdUrls.has(u)) return u;                  // redan i markdown
        const prev = str.slice(Math.max(0, off - 2), off);
        if (prev === '](') return u;                  // precis efter ](
        try {
          const host = new URL(u).hostname.replace(/^www\./,'');
          if (!host.endsWith('webbyrasigtuna.se')) return ''; // döda externa råa URL:er
        } catch { return ''; }
        return u; // intern rå URL behålls (konverteras i nästa steg)
      });
    }

    /* === FIX 5c: konvertera interna råa URL:er till länk med föregående etikett (om möjligt) === */
    reply = reply.replace(
      /(\b(?:Webbdesign|Sökmotoroptimering|SEO|Digital(?:\s+Marknadsföring)?|Annonsering|Tjänster|Priser|WordPress(?:-underhåll)?|Underhåll|Webbanalys)\b)\s+(https?:\/\/(?:www\.)?webbyrasigtuna\.se\/[^\s)]+)/gi,
      (_m, label, url) => {
        const mapped = mapLabel(label) || { display: label };
        return `[${mapped.display}](${url})`;
      }
    );

    // 5d) Städa “([Label]) (url)” varianter → “[Label](url)”
    reply = reply.replace(/\(\s*\[([^\]]+)\]\s*\)\s*\(\s*(https?:\/\/[^)]+)\s*\)/gi, '[$1]($2)');

    // tomma parenteser
    reply = reply.replace(/\(\s*\)/g, '');

    // Ensam slutparentes efter kända ord (ex. “SEO)”)
    reply = reply.replace(/\b(Lokal SEO|SEO|Tjänster|WordPress|Webbdesign)\s*\)/gi, '$1');

    /* Kuraterad tjänstelänk om inget redan satts */
    const order = ['lokal seo', 'seo', 'wordpress', 'wordpress-underhåll', 'underhåll', 'webbdesign', 'annonsering', 'priser'];
    let addedServiceLink = false;
    for (const k of order) {
      const url = LINKS[k];
      if (lower.includes(k) && !reply.includes(url) && !inlineLinkedKeys.has(k)) {
        if (sitemapUrls.has(url)) {
          const mapped = mapLabel(k) || { display: k.charAt(0).toUpperCase() + k.slice(1) };
          reply += `\n\n📖 Läs mer om ${mapped.display}: [${mapped.display}](${url})`;
          addedServiceLink = true;
        }
        break;
      }
    }
    if (!addedServiceLink && /\btjänster\b/i.test(lower)) {
      const url = LINKS['tjänster'];
      if (!reply.includes(url) && sitemapUrls.has(url)) {
        reply += `\n\n📖 Se en översikt av våra tjänster: [Tjänster](${url})`;
      }
    }

    /* Informationsintention → relaterade inlägg eller blogg */
    const infoTriggered = infoTriggers.test(lower);
    if (infoTriggered) {
      const qTokens = tokenizeSv(lower);
      const scored = [];
      for (const p of postUrls) {
        try {
          const u = new URL(p);
          const segs = u.pathname.split('/').filter(Boolean);
          const last = segs[segs.length - 1] || '';
          const slugTokens = tokenizeSv(last);
          let score = 0;
          for (const t of qTokens) if (slugTokens.includes(t)) score += 1;
          if (slugTokens.includes('seo')) score += 0.2;
          if (slugTokens.includes('lokal')) score += 0.2;
          if (score > 0) scored.push({ url: p, score });
        } catch {}
      }
      scored.sort((a,b)=> b.score - a.score);

      const suggestions = [];
      for (const s of scored) {
        if (suggestions.length >= 2) break;
        if (!reply.includes(s.url)) suggestions.push(s);
      }
      if (suggestions.length) {
        reply += `\n\n📰 Relaterad läsning:\n`;
        for (const s of suggestions) {
          const nice = prettyFromSlug(s.url);
          reply += `- [${nice}](${s.url})\n`;
        }
      } else if (!reply.includes(LINKS.blogg) && sitemapUrls.has(LINKS.blogg)) {
        reply += `\n\n💡 Vill du läsa fler tips och guider? Kolla vår [blogg](${LINKS.blogg}) för mer inspiration.`;
      }
    }

    /* Lead-intention → gratis-analys (inkl. generiska förbättra/optimera/öka SEO) */
    const genericSeoImprove = /\bseo\b.*\b(förbättra|optimera|öka)\b/i.test(lower);
    const leadTriggered = leadTriggers.test(lower) || lower.includes('lokal seo') || genericSeoImprove;
    if (leadTriggered) {
      const isLocal = lower.includes('lokal seo');
      const ctaUrl   = isLocal ? 'https://webbyrasigtuna.se/gratis-lokal-seo-analys/' : 'https://webbyrasigtuna.se/gratis-seo-analys/';
      const ctaLabel = isLocal ? 'gratis lokal SEO-analys' : 'gratis SEO-analys';
      if (!reply.includes(ctaUrl) && sitemapUrls.has(ctaUrl)) {
        reply += `\n\n🤝 Vill du ha en ${ctaLabel}? Ansök här: [${ctaUrl}](${ctaUrl})`;
      }
    }

    // Sista safety: ta bort kvarvarande orphan-hakparenteser
    reply = reply.replace(/\[([^\]]+)\](?!\()/g, '$1');

    // “Källa” när vi faktiskt har lagt in en intern länk
    if (ADD_SOURCE_FOOTER) {
      const hasInternalLink = /\]\(https:\/\/(?:www\.)?webbyrasigtuna\.se\/[^)]+\)/i.test(reply);
      if (hasInternalLink && !/Källa:\s*Webbyrå Sigtuna/i.test(reply)) {
        reply += `\n\n*Källa: Webbyrå Sigtuna*`;
      }
    }

    // Spara i KV
    await kv.rpush(key, JSON.stringify({ role: 'user', content: message }));
    await kv.rpush(key, JSON.stringify({ role: 'assistant', content: reply }));
    await kv.expire(key, 60 * 60 * 24); // 24 h

    const booking_intent = /boka|möte|call|meeting|upptäcktsmöte/i.test(message);
    const lead_intent = leadTriggered;

    return res.status(200).json({ reply, booking_intent, lead_intent });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}