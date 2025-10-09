// /api/chat.js
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

/* ===== CORS helpers ===== */
const ALLOWED_ORIGINS = [
  'https://webbyrasigtuna.se',
  /\.webbyrasigtuna\.se$/, // alla subdomäner, t.ex. kundportal.webbyrasigtuna.se
];

function isAllowedOrigin(origin = '') {
  try {
    const o = new URL(origin).origin;
    return ALLOWED_ORIGINS.some(rule =>
      typeof rule === 'string' ? rule === o : rule.test(o)
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
Du är Webbyrå Sigtunas digitala assistent. 
Ditt uppdrag är att hjälpa besökare att förstå våra tjänster inom webbdesign, SEO, digital marknadsföring och strategisk utveckling. 
Du svarar alltid på svenska, med ett professionellt och engagerande tonfall — vänligt, kunnigt och framåtblickande. 

### Dina mål:
1. Hjälp användaren att förstå hur vi kan lösa deras behov eller frågor på ett tydligt och effektivt sätt.
2. Hänvisa gärna till en relevant tjänst eller sida på webbyrasigtuna.se när det passar.
3. Föreslå gärna att boka ett möte med Andreas när det verkar naturligt – till exempel om användaren uttrycker intresse eller behöver mer personlig rådgivning.

### Begränsningar:
- Prata inte om att du är en AI-modell eller tränad på data.
- Svara inte på ämnen utanför digital marknadsföring, webb, SEO, eller relaterade tjänster.
- Om något ligger utanför ditt område, säg artigt att det inte är ditt expertområde och föreslå kontakt med oss istället.

Om användaren nämner ord som pris, offert, projekt, ny hemsida eller SEO, föreslå att boka ett möte.
Avsluta gärna dina svar med en positiv och uppmuntrande ton, i linje med Webbyrå Sigtunas varumärke.
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

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      'Jag är osäker just nu. Vill du omformulera frågan?';

    // === Persist back to KV ===
    await kv.rpush(key, JSON.stringify({ role: 'user', content: message }));
    await kv.rpush(key, JSON.stringify({ role: 'assistant', content: reply }));
    await kv.expire(key, 60 * 60 * 24 * 7); // 7 dagar

    const booking_intent = /boka|möte|call|meeting|upptäcktsmöte/i.test(message);

    return res.status(200).json({ reply, booking_intent });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}