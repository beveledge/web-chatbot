// /api/chat.js
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

/* ===== CORS helpers (hostname-baserad) ===== */
function isAllowedOrigin(origin = '') {
  try {
    const u = new URL(origin);
    const host = u.hostname; // enbart värdnamn
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

/* ===== Sitemap: hämta & cacha alla indexerbara URL:er ===== */
const SITEMAP_INDEX = 'https://webbyrasigtuna.se/sitemaps.xml';
const SITEMAP_FALLBACKS = [
  'https://webbyrasigtuna.se/post-sitemap1.xml',
  'https://webbyrasigtuna.se/page-sitemap1.xml',
];
const SITEMAP_CACHE_KEY = 'sitemap:urls';
const SITEMAP_TTL = 60 * 60 * 24; // 24h

async function fetchText(url) {
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error(`Fetch failed ${url} ${r.status}`);
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
      if (x.hostname === host || x.hostname.endsWith('.' + host)) {
        out.push(x.toString());
      }
    } catch { /* ignore */ }
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
    const submaps = extractXmlLocs(indexXml);
    if (submaps.length) {
      for (const sm of submaps) {
        try {
          const xml = await fetchText(sm);
          urls.push(...extractXmlLocs(xml));
        } catch {}
      }
    }
  } catch {
    for (const f of SITEMAP_FALLBACKS) {
      try {
        const xml = await fetchText(f);
        urls.push(...extractXmlLocs(xml));
      } catch {}
    }
  }

  const filtered = filterHost(urls, 'webbyrasigtuna.se');
  const set = new Set(filtered);

  try { await kv.set(SITEMAP_CACHE_KEY, [...set], { ex: SITEMAP_TTL }); } catch {}

  return set;
}

/* ===== Huvudhandler ===== */
export default async function handler(req, res) {
  try {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      setCors(req, res);
      return res.status(204).end();
    }

    // Method guard
    if (req.method !== 'POST') {
      setCors(req, res);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // CORS för svaret
    setCors(req, res);

    // Env guard
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    }

    const { message, sessionId } = req.body || {};
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Missing message or sessionId' });
    }

    // === Läs historik från KV ===
    const key = `chat:${sessionId}`;
    const raw = await kv.lrange(key, -40, -1);
    const history = (raw || []).map(s => {
      try { return JSON.parse(s); } catch { return null; }
    }).filter(Boolean);
    const trimmed = history.slice(-20);

    // === System-prompt (kunskapsdriven marknadsassistent) ===
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
      `.trim(),
    };

    const messages = [system, ...trimmed, { role: 'user', content: message }];

    // === OpenAI ===
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
    });

    let reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      'Jag är osäker just nu. Vill du omformulera frågan?';

    /* ==== Normalisering av termer ==== */
    reply = reply
      .replace(/\blokal seo\b/gi, 'Lokal SEO')
      .replace(/\bseo\b/gi, 'SEO')
      .replace(/\bwordpress\b/gi, 'WordPress');

    /* ==== Ta bort “orphan” label om vi inte kan länka den (hanteras strax under) ==== */
    // (tillfälligt noop – vi ersätter strax orphans till riktiga länkar om möjligt)

    /* ==== 1) Ladda sitemap-URL:er ==== */
    const sitemapUrls = await loadSitemapUrls(); // Set<string>

    /* ==== 2) Kända målsidor ==== */
    const LINKS = {
      "lokal seo": "https://webbyrasigtuna.se/hjalp-med-lokal-seo/",
      "seo": "https://webbyrasigtuna.se/sokmotoroptimering/",
      "webbdesign": "https://webbyrasigtuna.se/webbdesign/",
      "wordpress": "https://webbyrasigtuna.se/webbplatsunderhall/",
      "wordpress-underhåll": "https://webbyrasigtuna.se/webbplatsunderhall/",
      "underhåll": "https://webbyrasigtuna.se/webbplatsunderhall/",
      "annonsering": "https://webbyrasigtuna.se/digital-annonsering/",
    };
    const BLOG_URL = "https://webbyrasigtuna.se/blogg/";
    const SERVICES_OVERVIEW = "https://webbyrasigtuna.se/vara-digitala-marknadsforingstjanster/";
    const LEAD_LOCAL_URL = "https://webbyrasigtuna.se/gratis-lokal-seo-analys/";
    const LEAD_SEO_URL   = "https://webbyrasigtuna.se/gratis-seo-analys/";

    const infoTriggers = /(hur|varför|tips|guider|steg|förklara|förbättra|optimera|öka|bästa sättet)/i;
    const leadTriggers = /(pris|offert|strategi|analys|möte|projekt|erbjudande|paket|audit|granskning)/i;

    const lower = message.toLowerCase();

    /* ==== 3) Ersätt orphan-etiketter inline till riktiga länkar (om kända & i sitemap) ==== */
    function canonicalLabel(k) {
      if (k === 'lokal seo') return 'Lokal SEO';
      if (k === 'seo') return 'SEO';
      if (k.startsWith('wordpress') || k === 'underhåll') return 'WordPress-underhåll';
      if (k === 'tjänster') return 'Tjänster';
      return k.charAt(0).toUpperCase() + k.slice(1);
    }
    const LABEL_MAP = {
      'tjänster': SERVICES_OVERVIEW,
      'lokal seo': LINKS['lokal seo'],
      'seo': LINKS['seo'],
      'wordpress': LINKS['wordpress'],
      'wordpress-underhåll': LINKS['wordpress-underhåll'],
      'underhåll': LINKS['underhåll'],
      'webbdesign': LINKS['webbdesign'],
      'annonsering': LINKS['annonsering'],
    };
    const inlineLinkedKeys = new Set();

    reply = reply.replace(/\[([^\]]+)\](?!\()/g, (m, labelRaw) => {
      const label = labelRaw.trim().toLowerCase();
      const key =
        label === 'tjänster' ? 'tjänster' :
        label === 'lokal seo' ? 'lokal seo' :
        label === 'seo' ? 'seo' :
        label.startsWith('wordpress') ? 'wordpress' :
        LABEL_MAP[label] ? label : null;

      if (!key) return labelRaw; // okänd – lämna som ren text

      const url = LABEL_MAP[key];
      if (url && sitemapUrls.has(url)) {
        inlineLinkedKeys.add(key);
        return `[${canonicalLabel(key)}](${url})`;
      }
      return labelRaw; // om inte i sitemap, lämna ren text
    });

    /* ==== 4) Plocka bort eventuella råa okända URL:er i modellens text ==== */
    const allUrls = new Set([
      ...[...reply.matchAll(/\]\((https?:\/\/[^\s)]+)\)/gi)].map(m => m[1]),
      ...[...reply.matchAll(/https?:\/\/[^\s)\]]+/gi)].map(m => m[0]),
    ]);
    const toKeep = new Set([...allUrls].filter(u => sitemapUrls.has(u)));
    reply = reply.replace(/https?:\/\/[^\s)\]]+/gi, (u) => (toKeep.has(u) ? u : ''));
    reply = reply.replace(/\(\s*\)/g, ''); // tomma () efter rensning

    /* ==== 5) Lägg till max EN kuraterad tjänstelänk (om vi inte redan länkade inline) ==== */
    const linkKeysInOrder = ["lokal seo", "seo", "wordpress", "wordpress-underhåll", "underhåll", "webbdesign", "annonsering"];
    let addedServiceLink = false;
    for (const k of linkKeysInOrder) {
      const url = LINKS[k];
      if (lower.includes(k) && !reply.includes(url) && !inlineLinkedKeys.has(k)) {
        const label = canonicalLabel(k);
        if (sitemapUrls.has(url)) {
          reply += `\n\n📖 Läs mer om ${label}: [${url}](${url})`;
          addedServiceLink = true;
        }
        break;
      }
    }

    // Fallback till tjänsteöversikt om “tjänster” nämns och ingen specifik länk lades
    if (!addedServiceLink && /\btjänster\b/i.test(lower) && !reply.includes(SERVICES_OVERVIEW) && sitemapUrls.has(SERVICES_OVERVIEW)) {
      reply += `\n\n📖 Se en översikt av våra tjänster: [${SERVICES_OVERVIEW}](${SERVICES_OVERVIEW})`;
    }

    /* ==== 6) Informationsintention → blogglänk (om inte redan) ==== */
    if (infoTriggers.test(lower) && !reply.includes(BLOG_URL) && sitemapUrls.has(BLOG_URL)) {
      reply += `\n\n💡 Vill du läsa fler tips och guider? Kolla vår [blogg](${BLOG_URL}) för mer inspiration.`;
    }

    /* ==== 7) Lead-intention → rätt gratis-analys (utan dubbletter) ==== */
    if (leadTriggers.test(lower) || lower.includes('lokal seo')) {
      const isLocal = lower.includes('lokal seo');
      const ctaUrl = isLocal ? LEAD_LOCAL_URL : LEAD_SEO_URL;
      const ctaLabel = isLocal ? 'gratis lokal SEO-analys' : 'gratis SEO-analys';
      if (!reply.includes(ctaUrl) && sitemapUrls.has(ctaUrl)) {
        reply += `\n\n🤝 Vill du ha en ${ctaLabel}? Ansök här: [${ctaUrl}](${ctaUrl})`;
      }
    }

    // === Spara i KV ===
    await kv.rpush(key, JSON.stringify({ role: 'user', content: message }));
    await kv.rpush(key, JSON.stringify({ role: 'assistant', content: reply }));
    await kv.expire(key, 60 * 60 * 24 * 7);

    // === Intent-flaggor till frontend ===
    const booking_intent = /boka|möte|call|meeting|upptäcktsmöte/i.test(message);
    const lead_intent = lower.includes('lokal seo') || leadTriggers.test(lower);

    return res.status(200).json({ reply, booking_intent, lead_intent });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}