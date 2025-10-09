// api/clear.js
import { kv } from '@vercel/kv';

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
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const key = `chat:${sessionId}`;
    await kv.del(key);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Clear error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}