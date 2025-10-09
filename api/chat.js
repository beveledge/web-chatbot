// api/chat.js
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

// överst i filen, under imports
const ALLOWED_ORIGINS = [
  'https://webbyrasigtuna.se',
  /\.webbyrasigtuna\.se$/ // matchar valfri subdomän, t.ex. kundportal.webbyrasigtuna.se
];

function isAllowedOrigin(origin = '') {
  try {
    const { origin: o } = new URL(origin);
    return ALLOWED_ORIGINS.some((rule) =>
      typeof rule === 'string' ? rule === o : rule.test(o)
    );
  } catch {
    return false;
  }
}

// i din handler – allra först:
if (req.method === 'OPTIONS') {
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  return res.status(403).end();
}

// för POST-svaret – innan du skickar JSON:
const origin = req.headers.origin || '';
if (isAllowedOrigin(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, sessionId } = req.body || {};
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Missing message or sessionId' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1) Läs historik (lista med JSON-strängar)
    const key = `chat:${sessionId}`;
    const raw = await kv.lrange(key, -40, -1); // hämta sista ~40 poster
    const history = raw.map((s) => JSON.parse(s));

    // 2) Trimma historik (håll nere tokenkostnad)
    const MAX_EXCHANGES = 20;
    const trimmed = history.slice(-MAX_EXCHANGES);

    // 3) Bygg meddelanden till modellen
    const system = {
  role: "system",
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
    `
    };

    const messages = [system, ...trimmed, { role: 'user', content: message }];

    // 4) Hämta svar från OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      'Jag är osäker just nu. Vill du omformulera frågan?';

    // 5) Spara nytt in/ut i KV (append)
    await kv.rpush(key, JSON.stringify({ role: 'user', content: message }));
    await kv.rpush(key, JSON.stringify({ role: 'assistant', content: reply }));

    // 6) Sätt TTL (t.ex. 7 dagar)
    await kv.expire(key, 60 * 60 * 24 * 7);

    // 7) Enkel bokningsintention (kan förbättras senare)
    const booking_intent = /boka|möte|call|meeting|upptäcktsmöte/i.test(message);

    return res.status(200).json({ reply, booking_intent });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}