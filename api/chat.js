// /api/chat.js
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

/* ===== CORS helpers (hostname-baserad) ===== */
function isAllowedOrigin(origin = '') {
  try {
    const u = new URL(origin);
    const host = u.hostname;
    const ALLOWED = [
      'webbyrasigtuna.se',
      /^[a-z0-9-]+\.webbyrasigtuna\.se$/i,
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

/* ===== Sitemap-cache ===== */
const SITEMAP_INDEX = 'https://webbyrasigtuna.se/sitemaps.xml';
const SITEMAP_FALLBACKS = [
  'https://webbyrasigtuna.se/post-sitemap1.xml',
  'https://webbyrasigtuna.se/page-sitemap1.xml',
];
const SITEMAP_CACHE_KEY = 'sitemap:urls';
const SITEMAP_TTL = 60 * 60 * 24; // 24h

async function fetchText(url) {
  const r = await fetch(url);
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

/* ===== Main handler ===== */
export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
    if (req.method !== 'POST') { setCors(req, res); return res.status(405).json({ error: 'Method not allowed' }); }
    setCors(req, res);

    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

    const { message, sessionId } = req.body || {};
    if (!message || !sessionId) return res.status(400).json({ error: 'Missing message or sessionId' });

    // Historik
    const key = `chat:${sessionId}`;
    const raw = await kv.lrange(key, -40, -1);
    const history = (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const trimmed = history.slice(-20);

    // System
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

    // OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
    });

    let reply = completion?.choices?.[0]?.message?.content?.trim() ||
      'Jag är osäker just nu. Vill du omformulera frågan?';

    // Normalisering
    reply = reply
      .replace(/\blokal seo\b/gi, 'Lokal SEO')
      .replace(/\bseo\b/gi, 'SEO')
      .replace(/\bwordpress\b/gi, 'WordPress');

    // Ladda sitemap
    const sitemapUrls = await loadSitemapUrls();

    // Kända målsidor
    const LINKS = {
      'lokal seo': 'https://webbyrasigtuna.se/hjalp-med-lokal-seo/',
      'seo': 'https://webbyrasigtuna.se/sokmotoroptimering/',
      'webbdesign': 'https://webbyrasigtuna.se/webbdesign/',
      'wordpress': 'https://webbyrasigtuna.se/webbplatsunderhall/',
      'wordpress-underhåll': 'https://webbyrasigtuna.se/webbplatsunderhall/',
      'underhåll': 'https://webbyrasigtuna.se/webbplatsunderhall/',
      'annonsering': 'https://webbyrasigtuna.se/digital-annonsering/',
      'tjänster': 'https://webbyrasigtuna.se/vara-digitala-marknadsforingstjanster/',
    };
    const BLOG_URL = 'https://webbyrasigtuna.se/blogg/';
    const LEAD_LOCAL_URL = 'https://webbyrasigtuna.se/gratis-lokal-seo-analys/';
    const LEAD_SEO_URL   = 'https://webbyrasigtuna.se/gratis-seo-analys/';

    const infoTriggers = /(hur|varför|tips|guider|steg|förklara|förbättra|optimera|öka|bästa sättet)/i;
    const leadTriggers = /(pris|offert|strategi|analys|möte|projekt|erbjudande|paket|audit|granskning)/i;

    const lower = message.toLowerCase();

    // Hjälpare
    function canonicalLabel(k) {
      if (k === 'lokal seo') return 'Lokal SEO';
      if (k === 'seo') return 'SEO';
      if (k === 'tjänster') return 'Tjänster';
      if (k.startsWith('wordpress') || k === 'underhåll') return 'WordPress-underhåll';
      return k.charAt(0).toUpperCase() + k.slice(1);
    }

    // 1) Inline-konvertera alla orphan-etiketter till korrekta länkar (om kända + i sitemap)
    const inlineLinkedKeys = new Set();
    reply = reply.replace(/\[([^\]]+)\](?!\()/g, (m, labelRaw) => {
      const label = labelRaw.trim().toLowerCase();
      // hitta nyckel genom “contains”-match (fångar "Lokal SEO", "WordPress-underhåll", etc.)
      const key = Object.keys(LINKS).find(k => label.includes(k));
      if (!key) return labelRaw; // okänd etikett → lämna som ren text
      const url = LINKS[key];
      if (url && sitemapUrls.has(url)) {
        inlineLinkedKeys.add(key);
        return `[${canonicalLabel(key)}](${url})`;
      }
      return labelRaw;
    });

    // 2) Rensa bort ev. råa okända URL:er (behåll endast sådana som finns i sitemap)
    const allUrls = new Set([
      ...[...reply.matchAll(/\]\((https?:\/\/[^\s)]+)\)/gi)].map(m => m[1]),
      ...[...reply.matchAll(/https?:\/\/[^\s)\]]+/gi)].map(m => m[0]),
    ]);
    const toKeep = new Set([...allUrls].filter(u => sitemapUrls.has(u)));
    reply = reply.replace(/https?:\/\/[^\s)\]]+/gi, (u) => (toKeep.has(u) ? u : ''));
    reply = reply.replace(/\(\s*\)/g, ''); // ta bort tomma () efter rensning

    // 3) Lägg till max EN kuraterad tjänstelänk om inte redan inlänkad/med
    const order = ['lokal seo', 'seo', 'wordpress', 'wordpress-underhåll', 'underhåll', 'webbdesign', 'annonsering'];
    let addedServiceLink = false;
    for (const k of order) {
      const url = LINKS[k];
      if (lower.includes(k) && !reply.includes(url) && !inlineLinkedKeys.has(k)) {
        if (sitemapUrls.has(url)) {
          reply += `\n\n📖 Läs mer om ${canonicalLabel(k)}: [${url}](${url})`;
          addedServiceLink = true;
        }
        break;
      }
    }
    // Fallback: tjänsteöversikt om “tjänster” nämns och ingen specifik länk lades
    if (!addedServiceLink && /\btjänster\b/i.test(lower)) {
      const url = LINKS['tjänster'];
      if (!reply.includes(url) && sitemapUrls.has(url)) {
        reply += `\n\n📖 Se en översikt av våra tjänster: [${url}](${url})`;
      }
    }

    // 4) Infobehov → blogglänk
    if (infoTriggers.test(lower) && !reply.includes(BLOG_URL) && sitemapUrls.has(BLOG_URL)) {
      reply += `\n\n💡 Vill du läsa fler tips och guider? Kolla vår [blogg](${BLOG_URL}) för mer inspiration.`;
    }

    // 5) Lead-intention → rätt gratis-analys
    if (leadTriggers.test(lower) || lower.includes('lokal seo')) {
      const isLocal = lower.includes('lokal seo');
      const ctaUrl = isLocal ? LEAD_LOCAL_URL : LEAD_SEO_URL;
      const ctaLabel = isLocal ? 'gratis lokal SEO-analys' : 'gratis SEO-analys';
      if (!reply.includes(ctaUrl) && sitemapUrls.has(ctaUrl)) {
        reply += `\n\n🤝 Vill du ha en ${ctaLabel}? Ansök här: [${ctaUrl}](${ctaUrl})`;
      }
    }

    // 6) SISTA SAFETY PASS: ta bort ev. kvarvarande orphan-etiketter (inga [Lokal SEO] kvar)
    reply = reply.replace(/\[([^\]]+)\](?!\()/g, '$1');

    // Spara historik
    await kv.rpush(key, JSON.stringify({ role: 'user', content: message }));
    await kv.rpush(key, JSON.stringify({ role: 'assistant', content: reply }));
    await kv.expire(key, 60 * 60 * 24 * 7);

    // Intentflaggor
    const booking_intent = /boka|möte|call|meeting|upptäcktsmöte/i.test(message);
    const lead_intent = lower.includes('lokal seo') || leadTriggers.test(lower);

    return res.status(200).json({ reply, booking_intent, lead_intent });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}