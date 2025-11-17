// /api/kv-debug.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  try {
    // Enkel token-säkerhet
    const expected = process.env.KV_DEBUG_TOKEN;
    const token = req.query.token || req.headers['x-debug-token'];

    if (!expected) {
      return res.status(500).json({
        ok: false,
        error: 'KV_DEBUG_TOKEN saknas i environment variables',
      });
    }

    if (token !== expected) {
      return res.status(401).json({
        ok: false,
        error: 'Ogiltig token',
      });
    }

    // KV-ping: skriv + läs ett nyckelvärde
    const key = 'kv:debug:ping';
    const now = new Date().toISOString();

    await kv.set(key, now, { ex: 60 }); // 60 sekunder
    const value = await kv.get(key);

    // Försök läsa lite historik för att se att chatten verkligen skriver till KV
    let sampleHistory = [];
    try {
      // OBS: vissa versioner av @vercel/kv saknar .keys,
      // så vi håller det enkelt – bara prova ett par kända keys.
      const maybe = await kv.lrange('chat:test', -5, -1);
      sampleHistory = maybe || [];
    } catch (e) {
      // Ignorera om .lrange på 'chat:test' inte finns – det är bara extra info
    }

    return res.status(200).json({
      ok: true,
      message: 'KV-anslutning OK',
      pingKey: key,
      storedValue: value,
      sampleHistoryLength: sampleHistory.length,
    });
  } catch (err) {
    console.error('KV-debug error:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Okänt fel i KV-debug',
    });
  }
}