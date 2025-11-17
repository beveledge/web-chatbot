// /api/kv-debug.js
import { kv } from '@vercel/kv';

function describeKey(name, value) {
  const exists = value !== null && value !== undefined;
  const type = Array.isArray(value) ? 'array' : typeof value;

  let stringLength = null;
  let arrayLength = null;
  let preview = null;

  if (typeof value === 'string') {
    stringLength = value.length;
    preview = value.slice(0, 160); // första 160 tecken
  } else if (Array.isArray(value)) {
    arrayLength = value.length;
    preview = value.slice(0, 5);   // första 5 element
  }

  return { name, exists, type, stringLength, arrayLength, preview };
}

export default async function handler(req, res) {
  try {
    const now = new Date().toISOString();

    // Enkel ping-nyckel för att verifiera skrivning/läsning
    await kv.set('kv:debug:ping', now);
    const storedValue = await kv.get('kv:debug:ping');

    // Läs LLMS-cache
    const llmsIndex   = await kv.get('llms:index');
    const llmsFull    = await kv.get('llms:full');
    const llmsFullSv  = await kv.get('llms:full_sv');

    // Läs sitemap-cache
    const sitemapUrls = await kv.get('sitemap:urls');   // Set/Array i din kod
    const sitemapPosts = await kv.get('sitemap:posts'); // Array med post-URL:er

    return res.status(200).json({
      ok: true,
      message: 'KV-anslutning OK',
      ping: {
        key: 'kv:debug:ping',
        storedValue,
      },
      llms: {
        index:   describeKey('llms:index', llmsIndex),
        full:    describeKey('llms:full', llmsFull),
        full_sv: describeKey('llms:full_sv', llmsFullSv),
      },
      sitemap: {
        urls:  describeKey('sitemap:urls', sitemapUrls),
        posts: describeKey('sitemap:posts', sitemapPosts),
      },
    });
  } catch (err) {
    console.error('KV debug error:', err);
    return res.status(500).json({
      ok: false,
      error: 'KV-debug failed',
      details: String(err?.message || err),
    });
  }
}