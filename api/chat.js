// /api/chat.js
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

/* ===== CORS helpers ===== */
function isAllowedOrigin(origin = '') {
  try {
    const u = new URL(origin);
    const host = u.hostname; // enbart värdnamn, inte protokoll
    const ALLOWED = [
      'webbyrasigtuna.se',
      /^[a-z0-9-]+\.webbyrasigtuna\.se$/i, // valfri subdomän, t.ex. kundportal.webbyrasigtuna.se
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

/* ===== Main handler ===== */
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

    // CORS for actual response
    setCors(req, res);

    // Env guard
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    }

    const { message, sessionId } = req.body || {};
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Missing message or sessionId' });
    }

    // === Load recent history from KV ===
    const key = `chat:${sessionId}`;
    const raw = await kv.lrange(key, -40, -1); // last ~40 items
    const history = (raw || []).map(s => {
      try { return JSON.parse(s); } catch { return null; }
    }).filter(Boolean);

    const MAX_EXCHANGES = 20;
    const trimmed = history.slice(-MAX_EXCHANGES);

    // === System prompt (brand voice) ===
    const system = {
      role: 'system',
      content: `
Du är Webbyrå Sigtunas kunskapsdrivna marknadsassistent.

Mål:
1) Ge korrekta, begripliga svar om webb, SEO, lokal SEO, WordPress/underhåll, annonsering och våra tjänster.
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

    // === OpenAI call ===
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
    });

    let reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      'Jag är osäker just nu. Vill du omformulera frågan?';

    // --- Known/allowed links (endast dessa får förekomma) ---
    const LINKS = {
      // Ordningen spelar roll: "lokal seo" först så att den får prioritet över generisk "seo"
      "lokal seo": "https://webbyrasigtuna.se/hjalp-med-lokal-seo/",
      "seo": "https://webbyrasigtuna.se/sokmotoroptimering/",
      "webbdesign": "https://webbyrasigtuna.se/webbdesign/",
      // WordPress-underhåll/underhåll
      "wordpress": "https://webbyrasigtuna.se/webbplatsunderhall/",
      "underhåll": "https://webbyrasigtuna.se/webbplatsunderhall/",
      "wordpress-underhåll": "https://webbyrasigtuna.se/webbplatsunderhall/",
      "annonsering": "https://webbyrasigtuna.se/digital-annonsering/"
    };
    const BLOG_URL = "https://webbyrasigtuna.se/blogg/";
    const LEAD_LOCAL_URL = "https://webbyrasigtuna.se/gratis-lokal-seo-analys/";
    const LEAD_SEO_URL   = "https://webbyrasigtuna.se/gratis-seo-analys/";

    // Intent-signaler
    const infoTriggers = /(hur|varför|tips|guider|steg|förklara|förbättra|optimera|öka|bästa sättet)/i;
    const leadTriggers = /(pris|offert|strategi|analys|möte|projekt|erbjudande|paket|audit|granskning)/i;

    const lower = message.toLowerCase();

    // === 1) Sanera modellens fria text: normalisera termer och ta bort okända länkar ===
    // a) Normalisera vanliga termer (först "Lokal SEO", sedan generella)
    reply = reply
      .replace(/\blokal seo\b/gi, 'Lokal SEO')
      .replace(/\bseo\b/gi, 'SEO')
      .replace(/\bwordpress\b/gi, 'WordPress');

    // b) Tillåt endast våra kända länkar (ta bort övriga URL:er modellen kan ha hittat på)
    const allowedUrlSet = new Set([
      ...Object.values(LINKS),
      BLOG_URL,
      LEAD_LOCAL_URL,
      LEAD_SEO_URL,
    ]);
    reply = reply.replace(/https?:\/\/[^\s)\]]+/gi, (url) => {
      // behåll bara om den finns i allowlist
      return allowedUrlSet.has(url) ? url : '';
    }).replace(/\(\s*\)/g, ''); // städa tomma () om modellen använde markdown-länkar

    // === 2) Lägg till EN (1) tjänstelänk beroende på fråga (utan dubbletter) ===
    // Prioritera "lokal seo" före "seo"; därefter övriga.
    const linkKeysInOrder = ["lokal seo", "seo", "wordpress", "wordpress-underhåll", "underhåll", "webbdesign", "annonsering"];
    for (const key2 of linkKeysInOrder) {
      const url = LINKS[key2];
      if (lower.includes(key2) && !reply.includes(url)) {
        reply += `\n\n📖 Läs mer om ${key2 === 'wordpress' || key2 === 'wordpress-underhåll' || key2 === 'underhåll'
          ? 'WordPress-underhåll'
          : (key2 === 'seo' ? 'SEO' : (key2 === 'lokal seo' ? 'Lokal SEO' : key2))
        }: [${url}](${url})`;
        break;
      }
    }

    // === 3) Informationsintention → föreslå bloggen (om inte redan med i svaret) ===
    if (infoTriggers.test(lower) && !reply.includes(BLOG_URL)) {
      reply += `\n\n💡 Vill du läsa fler tips och guider? Kolla vår [blogg](${BLOG_URL}) för mer inspiration.`;
    }

    // === 4) Lead-intention → föreslå rätt gratis-analys (utan dubbletter) ===
    if (leadTriggers.test(lower) || lower.includes('lokal seo')) {
      const isLocal = lower.includes('lokal seo');
      const ctaUrl = isLocal ? LEAD_LOCAL_URL : LEAD_SEO_URL;
      const ctaLabel = isLocal ? 'gratis lokal SEO-analys' : 'gratis SEO-analys';
      if (!reply.includes(ctaUrl)) {
        reply += `\n\n🤝 Vill du ha en ${ctaLabel}? Ansök här: [${ctaUrl}](${ctaUrl})`;
      }
    }

    // === Persist back to KV ===
    await kv.rpush(key, JSON.stringify({ role: 'user', content: message }));
    await kv.rpush(key, JSON.stringify({ role: 'assistant', content: reply }));
    await kv.expire(key, 60 * 60 * 24 * 7); // 7 dagar

    // === Intent-flaggor till frontend ===
    const booking_intent = /boka|möte|call|meeting|upptäcktsmöte/i.test(message);
    const lead_intent = lower.includes('lokal seo') || leadTriggers.test(lower);

    return res.status(200).json({ reply, booking_intent, lead_intent });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}