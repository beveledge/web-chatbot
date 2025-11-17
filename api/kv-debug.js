import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Simple security key
  const token = req.query.token;
  if (token !== process.env.KV_DEBUG_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // List all keys
    const keys = await kv.keys('*');

    // For each key, fetch value (limit size)
    const data = {};
    for (const k of keys) {
      try {
        const value = await kv.get(k);
        data[k] = value;
      } catch {
        data[k] = '(unreadable)';
      }
    }

    return res.status(200).json({ keys, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}