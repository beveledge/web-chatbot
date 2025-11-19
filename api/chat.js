/* Multi-tenant Chat Backend v6.1.0 (generic, WP-config-driven) */
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

/* ========== Tenant-konfiguration (enkel v1) ========== */
/**
 * siteId → baseUrl (WordPress-sajt)
 * Lägg till en rad per kund. På sikt kan detta ligga i databas/secret store.
 */
const TENANTS = {
  webbyrasigtuna: {
    baseUrl: 'https://webbyrasigtuna.se',
  },
  marketit: {
    baseUrl: 'https://market-it.eu/',
  },
  // exempel:
  // "kund123": { baseUrl: "https://kundensajt.se" },
};

function getTenant(siteId) {
  const t = TENANTS[siteId];
  if (!t) {
    throw new Error(`Unknown siteId: ${siteId}`);
  }
  return t;
}

/* ========== Hjälpare för per-tenant KV-nycklar ========== */
function kvKey(siteId, suffix) {
  return `${siteId}:${suffix}`;
}

/* ========== CORS (hostname-baserad per tenant) ========== */
function isAllowedOrigin(origin = '') {
  try {
    const u = new URL(origin);
    const host = u.hostname.replace(/^www\./, '');

    return Object.values(TENANTS).some(t => {
      try {
        const th = new URL(t.baseUrl).hostname.replace(/^www\./, '');
        return host === th || host.endsWith('.' + th);
      } catch {
        return false;
      }
    });
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

/* ========== LLMS-konfiguration (gemensam, men per-tenant cache) ========== */
const LLMS_TTL = 60 * 60 * 12; // 12h cache
const LLMS_MAX_CHARS_PER_BLOCK = 2000; // ca 400–600 tokens
const ADD_SOURCE_FOOTER = true;        // “Källa: …” när interna länkar finns

/* ========== Sitemap-cache (per tenant) ========== */
const SITEMAP_TTL = 60 * 60 * 24; // 24h

/* ========== Site-config-cache (per tenant) ========== */
const CONFIG_TTL = 60 * 5; // 5 minuter

/* ========== Generiska fetch-hjälpare ========== */
async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return await r.text();
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return await r.json();
}

/* ========== Sitemap / URL-hjälpare ========== */
function extractXmlLocs(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
}

function filterHost(urls, host) {
  const out = [];
  const cleanHost = (host || '').replace(/^www\./, '');
  for (const u of urls) {
    try {
      const x = new URL(u);
      const h = x.hostname.replace(/^www\./, '');
      if (h === cleanHost || h.endsWith('.' + cleanHost)) {
        out.push(x.toString());
      }
    } catch {}
  }
  return out;
}

/* ========== LLMS-hämtning & cache (per tenant) ========== */
async function loadKVOrFetch(key, url, ttlSeconds) {
  if (!url) return '';
  try {
    const cached = await kv.get(key);
    if (typeof cached === 'string' && cached.length) return cached;
  } catch {}
  try {
    const text = await fetchText(url);
    try {
      await kv.set(key, text, { ex: ttlSeconds });
    } catch {}
    return text;
  } catch {
    return ''; // fail soft
  }
}

/**
 * llmsConfig förväntas komma från siteConfig.llms, t.ex:
 * {
 *   index: "https://.../llms.txt"      (valfritt)
 *   full: "https://.../llms-full.txt"  (valfritt)
 *   full_sv: "https://.../llms-full-sv.txt" (valfritt)
 * }
 *
 * Om något saknas används generiska WP-endpoints:
 * /wp-json/wbs-ai/v1/llms, /llms-full, /llms-full-sv
 */
async function loadLLMSBundle(siteId, llmsConfig = {}, baseUrl) {
  const base = baseUrl.replace(/\/$/, '');

  const indexUrl   = llmsConfig.index   || `${base}/wp-json/wbs-ai/v1/llms`;
  const fullUrl    = llmsConfig.full    || `${base}/wp-json/wbs-ai/v1/llms-full`;
  const fullSvUrl  = llmsConfig.full_sv || `${base}/wp-json/wbs-ai/v1/llms-full-sv`;

  const indexKey   = kvKey(siteId, 'llms:index');
  const fullKey    = kvKey(siteId, 'llms:full');
  const fullSvKey  = kvKey(siteId, 'llms:full_sv');

  const [indexTxt, fullTxt, fullSvTxt] = await Promise.all([
    loadKVOrFetch(indexKey,  indexUrl,  LLMS_TTL),
    loadKVOrFetch(fullKey,   fullUrl,   LLMS_TTL),
    loadKVOrFetch(fullSvKey, fullSvUrl, LLMS_TTL),
  ]);

  const svPart   = (fullSvTxt || '').slice(0, LLMS_MAX_CHARS_PER_BLOCK);
  const fullPart = (fullTxt   || '').slice(0, LLMS_MAX_CHARS_PER_BLOCK);
  return { indexTxt, fullPart, svPart };
}

/* ========== Site-config (WP /config, per tenant) ========== */
async function loadSiteConfig(siteId, baseUrl) {
  const configKvKey = kvKey(siteId, 'site:config');
  try {
    const cached = await kv.get(configKvKey);
    if (typeof cached === 'string' && cached.length) {
      try { return JSON.parse(cached); } catch {}
    }
  } catch {}

  const configUrl = `${baseUrl.replace(/\/$/, '')}/wp-json/wbs-ai/v1/config`;

  try {
    const json = await fetchJson(configUrl);
    try {
      await kv.set(configKvKey, JSON.stringify(json), { ex: CONFIG_TTL });
    } catch {}
    return json;
  } catch {
    return null;
  }
}

/* ========== Sitemap-laddning (per tenant) ========== */
/**
 * sitemapConfig (från siteConfig.sitemap) kan t.ex vara:
 * {
 *   index: "https://.../sitemap_index.xml",
 *   fallbacks: ["https://.../post-sitemap.xml", "https://.../page-sitemap.xml"]
 * }
 */
async function loadSitemapUrls(siteId, baseUrl, sitemapConfig = {}, siteHost) {
  const cacheKey = kvKey(siteId, 'sitemap:urls');
  try {
    const cached = await kv.get(cacheKey);
    if (Array.isArray(cached) && cached.length) return new Set(cached);
  } catch {}

  const base = baseUrl.replace(/\/$/, '');

  const indexUrl =
    sitemapConfig.index ||
    `${base}/sitemap_index.xml`; // generisk standard

  const fallbacks = Array.isArray(sitemapConfig.fallbacks) && sitemapConfig.fallbacks.length
    ? sitemapConfig.fallbacks
    : [
        `${base}/post-sitemap.xml`,
        `${base}/page-sitemap.xml`,
      ];

  let urls = [];
  try {
    const indexXml = await fetchText(indexUrl);
    const subs = extractXmlLocs(indexXml);
    if (subs.length) {
      for (const sm of subs) {
        try { urls.push(...extractXmlLocs(await fetchText(sm))); } catch {}
      }
    }
  } catch {
    for (const f of fallbacks) {
      try { urls.push(...extractXmlLocs(await fetchText(f))); } catch {}
    }
  }

  const set = new Set(filterHost(urls, siteHost));
  try { await kv.set(cacheKey, [...set], { ex: SITEMAP_TTL }); } catch {}
  return set;
}

async function loadPostUrls(siteId, baseUrl, sitemapConfig = {}, siteHost) {
  const cacheKey = kvKey(siteId, 'sitemap:posts');
  try {
    const cached = await kv.get(cacheKey);
    if (Array.isArray(cached) && cached.length) return cached;
  } catch {}

  const base = baseUrl.replace(/\/$/, '');
  const indexUrl =
    sitemapConfig.index ||
    `${base}/sitemap_index.xml`;

  let postUrls = [];
  try {
    const indexXml = await fetchText(indexUrl);
    const subs = extractXmlLocs(indexXml);
    const postMaps = subs.filter(u => /post-sitemap/i.test(u));
    for (const sm of postMaps) {
      try { postUrls.push(...extractXmlLocs(await fetchText(sm))); } catch {}
    }
  } catch {}
  if (!postUrls.length) {
    const fallbackPost =
      (Array.isArray(sitemapConfig.fallbacks) &&
        sitemapConfig.fallbacks.find(u => /post-sitemap/i.test(u))) ||
      `${base}/post-sitemap.xml`;
    try { postUrls = extractXmlLocs(await fetchText(fallbackPost)); } catch {}
  }
  postUrls = filterHost(postUrls, siteHost);
  try { await kv.set(cacheKey, postUrls, { ex: SITEMAP_TTL }); } catch {}
  return postUrls;
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
    return s || url;
  } catch {
    return url;
  }
}

/* ========== Intent-spec: action/content + lead magnets ========== */

/* 1) Intent från användarens meddelande (generisk, ingen SEO/WordPress-special) */
const ACTION_INTENT_PATTERNS = [
  // Pris / affär
  /\bpris(er|et|nivå|bild)?\b/i,
  /\bkostnad(er|en)?\b/i,
  /\bavgift(er|en)?\b/i,
  /\btimpris\b/i,
  /\bpaketpris\b/i,
  /\bbudget\b/i,
  /\bprisförslag\b/i,
  /\boffert(förslag)?\b/i,

  // Projekt / hjälp
  /\bstarta\b.*\b(projekt|webb|hemsida|kampanj|tjänst|lösning)\b/i,
  /\bdra igång\b/i,
  /\bstarta upp\b/i,
  /\bkomma igång\b/i,
  /\bhjälp med\b/i,
  /\bkan ni hjälpa\b/i,
  /\bkan du hjälpa\b/i,

  // Analys / granskning
  /\banalys(er)?\b/i,
  /\bgranskning\b/i,
  /\baudit\b/i,
  /\bgenomgång\b/i,
  /\bbedömning\b/i,
  /\bhälsokontroll\b/i,
  /\brevision\b/i,
  /\bbesiktning\b/i,

  // Rådgivning
  /\brådgivning\b/i,
  /\brådgivningsmöte\b/i,
  /\bstrategimöte\b/i,
  /\bstrategisamtal\b/i,
  /\bkonsultation\b/i,
  /\bcoaching\b/i,

  // Engelska
  /\bquote\b/i,
  /\bpricing\b/i,
  /\bprice\b/i,
  /\boffer\b/i,
  /\bproposal\b/i,
  /\breview\b/i,
  /\bassessment\b/i,
  /\bconsultation\b/i,
  /\bstrategy call\b/i,
  /\bstrategy session\b/i,
];

const CONTENT_INTENT_PATTERNS = [
  // Format (svenska)
  /\bguide(n)?\b/i,
  /\bhandbok\b/i,
  /\bmanual\b/i,
  /\be-?bok\b/i,
  /\bebok\b/i,
  /\bpdf\b/i,
  /\bbroschyr\b/i,
  /\brapport\b/i,
  /\bwhitepaper\b/i,
  /\bchecklista\b/i,
  /\bmall(ar)?\b/i,
  /\btemplate\b/i,
  /\bplaybook\b/i,
  /\bkurs\b/i,
  /\bwebbkurs\b/i,
  /\butbildning\b/i,
  /\bwebinar\b/i,
  /\bvideokurs\b/i,

  // Handling (svenska)
  /\bladda ner\b/i,
  /\bladda ned\b/i,
  /\bdownload\b/i,
  /\bskicka (material|info|guid(e|en)?)\b/i,
  /\bhar ni (någon|en)\s+(guide|pdf|mall|checklista)\b/i,

  // Engelska
  /\bebook\b/i,
  /\be-book\b/i,
  /\bwhitepaper\b/i,
  /\bchecklist\b/i,
  /\bguide\b/i,
  /\bplaybook\b/i,
  /\bdownloadable\b/i,
];

function hasIntent(lower, patterns) {
  return patterns.some(rx => rx.test(lower));
}

/* 2) Klassificering av lead magnets utifrån label → magnet_type */
function classifyMagnetType(labelRaw = '') {
  const label = (labelRaw || '').toLowerCase();

  if (!label) return 'generic';

  // Content-typer
  if (/(guide|guiden|handbok|manual|e-?bok|ebook|pdf|broschyr|rapport|whitepaper|checklista|checklist|mall|template|playbook|kurs|webbkurs|utbildning|webinar|videokurs)/i.test(label)) {
    return 'content';
  }

  // Action-typer
  if (/(analys|audit|genomgång|granskning|bedömning|hälsokontroll|besiktning|rådgivning|rådgivningsmöte|strategimöte|strategisamtal|konsultation|coaching|offert|offertförslag|prisförslag|demo|test|prova på|kostnadsfri genomgång|kostnadsfritt möte)/i.test(label)) {
    return 'action';
  }

  return 'generic';
}

/* ========== Huvud-handler ========== */
export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
    if (req.method !== 'POST')   { setCors(req, res); return res.status(405).json({ error: 'Method not allowed' }); }
    setCors(req, res);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    }

    const { message, sessionId, siteId } = req.body || {};
    if (!message || !sessionId || !siteId) {
      return res.status(400).json({ error: 'Missing message, sessionId or siteId' });
    }

    let tenant;
    try {
      tenant = getTenant(siteId);
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Invalid siteId' });
    }

    const baseUrl = tenant.baseUrl.replace(/\/$/, '');

    // Historik (KV) – per tenant
    const chatKey = kvKey(siteId, `chat:${sessionId}`);
    const raw = await kv.lrange(chatKey, -40, -1);
    const history = (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const trimmed = history.slice(-20);

    // Ladda site-config först (behövs för LLMS + sitemap + länkar)
    const siteConfig = await loadSiteConfig(siteId, baseUrl);

    const siteName     = siteConfig?.site?.name || 'företaget';
    const siteBaseUrl  = siteConfig?.site?.base_url || baseUrl;
    const siteHost     = (() => {
      try { return new URL(siteBaseUrl).hostname.replace(/^www\./,''); }
      catch { return null; }
    })();

    const sitemapConfig = siteConfig?.sitemap || {};
    const llmsConfig    = siteConfig?.llms    || {};
    const linksConfig   = siteConfig?.links   || {};

    // Ladda sitemap & inlägg & LLMS (per site)
    const [sitemapUrls, postUrls, llms] = await Promise.all([
      loadSitemapUrls(siteId, siteBaseUrl, sitemapConfig, siteHost),
      loadPostUrls(siteId,  siteBaseUrl, sitemapConfig, siteHost),
      loadLLMSBundle(siteId, llmsConfig, siteBaseUrl),
    ]);

    const llmsContext = `
[LLMS-index]
${(llms.indexTxt || '').slice(0, 1000)}

[LLMS-sammanfattning (EN)]
${llms.fullPart}

[LLMS-språk-stil (SV)]
${llms.svPart}
`.trim();

    const system = {
      role: 'system',
      content: `
Du är ${siteName}s digitala assistent.

Mål:
1) Ge korrekta, begripliga svar om företagets verksamhet, tjänster, produkter och praktisk information.
2) Hjälp användaren vidare med relevanta länkar till webbplatsen (om möjligt).
3) När användaren uttrycker intresse (t.ex. pris, offert, boka, rådgivning, analys): föreslå att ta kontakt eller boka ett möte på ett naturligt sätt.
4) Håll tonen professionell, vänlig och framåtblickande – på svenska.

Begränsningar:
- Fokusera på sådant som är relevant för företagets verksamhet och webbplats.
- Påstå inte att du “har träningsdata”; beskriv istället att du baserar svar på webbplatsens innehåll och generell branschkunskap.
- Om du är osäker: be om förtydligande eller föreslå ett kort möte eller kontakt.

Svarsstruktur (när det passar):
- Kort kärnförklaring (2–5 meningar).
- Punktlista med 2–4 konkreta råd eller steg.
- “Läs mer”: 1–2 relevanta länkar till webbplatsen.
- Avsluta med en mjuk CTA om läget är rätt (t.ex. boka möte, kontakta oss eller få en snabb genomgång).

Primär kunskapsbas:
- Använd innehållet från LLMS-källorna (llms/index/full/full_sv – se sammanfattning nedan) som prioriterad källa när du svarar om tjänster, produkter, artiklar eller guider.

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

    // 1) HTML-ankare → Markdown
    reply = reply.replace(
      /<a\s+href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi,
      '[$2]($1)'
    );

    // 2) "( Label ) (https://…)" → "[Label](https://…)"
    reply = reply.replace(
      /\(\s*\[?([A-Za-zÅÄÖåäö0-9 .,:;+\-_/&%€$@!?]+?)\]?\s*\)\s*\(\s*(https?:\/\/[^)]+)\s*\)/g,
      '[$1]($2)'
    );

    // 3) "(https://…)" → "https://…"
    reply = reply.replace(/\(\s*(https?:\/\/[^)]+)\s*\)/g, '$1');

    // 3b) dubbel-wrappade länkar [[Label](url)](url) → [Label](url)
    reply = reply.replace(
      /\[\s*\[([^\]]+)\]\s*\(\s*(https?:\/\/[^)]+)\s*\)\s*\]\s*\(\s*\2\s*\)/gi,
      '[$1]($2)'
    );

    /* ---------- Normalisering ---------- */
    reply = reply
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-');

    // Ta bort råa URL-dubletter direkt efter en markdown-länk
    reply = reply.replace(
      /\]\((https?:\/\/[^\s)]+)\)\s*https?:\/\/[^\s)]+/gi,
      ']($1)'
    );

    /* === SÄKER RÅ-URL-STÄDNING (behåll markdown + interna råa, ta bort externa råa) === */
    if (siteHost) {
      const mdUrlMatches = [...reply.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi)];
      const mdUrls = new Set(mdUrlMatches.map(m => m[1]));
      const escapedHost = siteHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      reply = reply.replace(/https?:\/\/[^\s)\]]+/gi, (u, off, str) => {
        if (mdUrls.has(u)) return u;                  // redan i markdown
        const prev = str.slice(Math.max(0, off - 2), off);
        if (prev === '](') return u;                  // precis efter ](
        try {
          const host = new URL(u).hostname.replace(/^www\./,'');
          if (host === siteHost || host.endsWith('.' + siteHost)) {
            // intern rå URL – behåll
            return u;
          }
          // extern rå URL – ta bort
          return '';
        } catch {
          return '';
        }
      });

      // 5d) “([Label]) (url)” → “[Label](url)” (generiskt)
      const internalUrlRegex = new RegExp(
        '\\(\\s*\\[([^\\]]+)\\]\\s*\\)\\s*\\(\\s*(https?:\\/\\/(?:www\\.)?' + escapedHost + '\\/[^)]+)\\s*\\)',
        'gi'
      );
      reply = reply.replace(internalUrlRegex, '[$1]($2)');
    } else {
      // Fallback: ta bara bort externa råa URL:er (utan host-koll)
      const mdUrlMatches = [...reply.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi)];
      const mdUrls = new Set(mdUrlMatches.map(m => m[1]));
      reply = reply.replace(/https?:\/\/[^\s)\]]+/gi, (u, off, str) => {
        if (mdUrls.has(u)) return u;
        const prev = str.slice(Math.max(0, off - 2), off);
        if (prev === '](') return u;
        return '';
      });
    }

    // Rensa tomma parenteser
    reply = reply.replace(/\(\s*\)/g, '');

    /* Informationsintention → relaterade inlägg eller blogg */
    const infoTriggers = /(hur|varför|tips|guider|steg|förklara|förbättra|optimera|öka|bästa sättet|hur gör jag)/i;
    const lower = message.toLowerCase();
    const infoTriggered = infoTriggers.test(lower);

    if (infoTriggered && postUrls && postUrls.length) {
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
      } else {
        const blogUrl =
          (typeof linksConfig.blog === 'string' && linksConfig.blog) ||
          (typeof linksConfig.news === 'string' && linksConfig.news) ||
          null;
        if (blogUrl && !reply.includes(blogUrl)) {
          reply += `\n\n💡 Vill du läsa fler artiklar och guider? Kolla gärna vår [artikelsida](${blogUrl}).`;
        }
      }
    }

    /* ========== Lead-intent enligt specifikationen (per siteConfig) ========== */

    // 1) Magneter från siteConfig
    const leadMagnetsRaw = Array.isArray(siteConfig?.lead_magnets)
      ? siteConfig.lead_magnets
      : [];

    const leadMagnets = leadMagnetsRaw
      .filter(lm => lm && typeof lm === 'object' && lm.key && lm.url)
      .map(lm => ({
        ...lm,
        magnet_type: classifyMagnetType(lm.label || ''),
      }));

    // 2) Intent i användarmeddelandet
    const action_intent  = hasIntent(lower, ACTION_INTENT_PATTERNS);
    const content_intent = hasIntent(lower, CONTENT_INTENT_PATTERNS);

    let lead_type = null;
    if (content_intent) {
      lead_type = 'content';
    } else if (action_intent) {
      lead_type = 'action';
    }

    let lead_intent = !!lead_type;
    let lead_key = null;

    if (lead_intent && leadMagnets.length) {
      const pickByType = (type) => {
        const found = leadMagnets.find(lm => lm.magnet_type === type);
        return found ? found.key : null;
      };

      if (lead_type === 'content') {
        lead_key =
          pickByType('content') ||
          pickByType('generic') ||
          (leadMagnets[0] && leadMagnets[0].key) ||
          null;
      } else if (lead_type === 'action') {
        lead_key =
          pickByType('action') ||
          pickByType('generic') ||
          (leadMagnets[0] && leadMagnets[0].key) ||
          null;
      }
    }

    if (!leadMagnets.length) {
      lead_intent = false;
      lead_key = null;
    }

    // Sista safety: ta bort kvarvarande orphan-hakparenteser
    reply = reply.replace(/\[([^\]]+)\](?!\()/g, '$1');

    // “Källa” när vi faktiskt har lagt in en intern länk
    if (ADD_SOURCE_FOOTER && siteHost) {
      const escapedHost = siteHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const internalLinkRegex = new RegExp(`\\]\\(https?:\\/\\/(?:www\\.)?${escapedHost}\\/[^)]+\\)`, 'i');
      const hasInternalLink = internalLinkRegex.test(reply);
      if (hasInternalLink && !/Källa:\s*/i.test(reply)) {
        reply += `\n\n*Källa: ${siteName}*`;
      }
    }

    // Spara i KV (per tenant)
    await kv.rpush(chatKey, JSON.stringify({ role: 'user', content: message }));
    await kv.rpush(chatKey, JSON.stringify({ role: 'assistant', content: reply }));
    await kv.expire(chatKey, 60 * 60 * 24); // 24 h

    /* Booking-intent (generisk) */
    const booking_intent =
      /\b(boka|bokar|bokning|bokningsförfrågan)\b/i.test(lower) ||
      /\b(möte|möten|mötesförslag)\b/i.test(lower) ||
      /\b(träff|samtal|telefonsamtal|videosamtal|videomöte)\b/i.test(lower) ||
      /\b(rådgivning|rådgivningssamtal|rådgivningsmöte)\b/i.test(lower) ||
      /\b(konsultation|konsultationstid)\b/i.test(lower) ||
      /\b(introduktion|introcall|upptäcktsmöte)\b/i.test(lower) ||
      /discovery call|intro call|book a call|book a meeting|schedule a call|schedule a meeting/i.test(lower);

    // Privacy policy-länk från config – ingen hårdkodad URL
    const privacy_url =
      (typeof siteConfig?.privacy === 'string' && siteConfig.privacy) ||
      (typeof siteConfig?.privacy_url === 'string' && siteConfig.privacy_url) ||
      (siteConfig?.pages && typeof siteConfig.pages.integritet === 'string' && siteConfig.pages.integritet) ||
      `${siteBaseUrl}/integritetspolicy/`;

    return res.status(200).json({
      reply,
      booking_intent,
      lead_intent,
      lead_key,
      privacy_url,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}