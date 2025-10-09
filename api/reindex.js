// api/reindex.js — enkel inkrementell reindex i batchar
import 'dotenv/config';
import { kv } from '@vercel/kv';
import fetch from 'node-fetch';
import OpenAI from 'openai';
import { JSDOM } from 'jsdom';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ROOT = 'https://webbyrasigtuna.se';
const MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 3; // kör X sidor per anrop för att undvika timeouts

async function getUrlsFromSitemaps() {
  const xml = await (await fetch(`${ROOT}/sitemap_index.xml`)).text();
  const sitemaps = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  const urls = [];
  for (const sm of sitemaps) {
    const smXml = await (await fetch(sm)).text();
    const pageLocs = [...smXml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
    urls.push(...pageLocs.filter(u => u.startsWith(ROOT)));
  }
  return urls;
}

function isIndexable(dom) {
  const meta = dom.window.document.querySelector('meta[name="robots"]');
  const content = meta?.getAttribute('content')?.toLowerCase() || '';
  return !content.includes('noindex');
}

function extractMainText(dom) {
  const doc = dom.window.document;
  doc.querySelectorAll('script, style, nav, footer').forEach(n => n.remove());
  const text = doc.body?.textContent || '';
  return text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function chunk(text, maxLen = 1500) {
  const out = []; for (let i=0;i<text.length;i+=maxLen) out.push(text.slice(i,i+maxLen)); return out;
}

export default async function handler(req, res) {
  // ✅ Optional security token (protects your reindex endpoint)
  const token = req.headers.authorization?.split(' ')[1];
  if (process.env.REINDEX_TOKEN && token !== process.env.REINDEX_TOKEN) {
    console.warn('🚫 Unauthorized reindex attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // validera ev. hemlig token: req.headers.authorization === `Bearer ${process.env.REINDEX_TOKEN}`
  try {
    const all = await getUrlsFromSitemaps();
    // Hämta kö-position från KV (så vi kan batcha över flera körningar)
    let idx = parseInt((await kv.get('reindex:cursor')) || '0', 10);
    const slice = all.slice(idx, idx + BATCH_SIZE);

    for (const url of slice) {
      const html = await (await fetch(url)).text();
      const dom = new JSDOM(html);
      if (!isIndexable(dom)) continue;

      const text = extractMainText(dom);
      if (!text || text.length < 200) continue;

      // Inkrementellt: räkna hash för att skippa oförändrat innehåll
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hex = Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
      const old = await kv.get(`hash:${url}`);
      if (old === hex) continue; // ingen förändring

      // Skriv ny embedding
      await kv.del(`embed:${url}`); // rensa gamla chunks
      for (const ch of chunk(text)) {
        const emb = await openai.embeddings.create({ model: MODEL, input: ch });
        await kv.rpush(`embed:${url}`, JSON.stringify({ chunk: ch, vector: emb.data[0].embedding }));
      }
      await kv.set(`hash:${url}`, hex);
    }

    // Uppdatera cursor, loopa tillbaka till 0 när vi är klara
    idx = (idx + slice.length) % all.length;
    await kv.set('reindex:cursor', String(idx));

    return res.status(200).json({ ok: true, processed: slice.length, nextIndex: idx, total: all.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}