// /api/clear.js
import { kv } from '@vercel/kv';

/* --- CORS helpers (som i /api/chat.js) --- */
const ALLOWED_ORIGINS = [
  'https://webbyrasigtuna.se',
  /\.webbyrasigtuna\.se$/, // subdomäner
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

/* --- Main handler --- */
export default async function handler(req, res) {
  try {
    // Preflight
    if (req.method === 'OPTIONS') {
      setCors(req, res);
      return res.status(204).end();
    }

    // Endast POST
    if (req.method !== 'POST') {
      setCors(req, res);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    setCors(req, res);

    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    const key = `chat:${sessionId}`;
    await kv.del(key);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Clear error:', err);
    // Skicka CORS även vid fel så klienten kan läsa svaret
    setCors(req, res);
    return res.status(500).json({ error: 'Server error' });
  }
}