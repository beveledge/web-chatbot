// scripts/ingest.js
import 'dotenv/config';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ROOT = 'https://webbyrasigtuna.se';
const MODEL = 'text-embedding-3-small';

// ---------------- helpers ----------------
async function getAllUrlsFromSitemaps() {
  const indexUrl = `${ROOT}/sitemap_index.xml`;
  const xml = await (await fetch(indexUrl)).text();
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

  const urls = [];
  for (const sm of locs) {
    const smXml = await (await fetch(sm)).text();
    const pageLocs = [...smXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    urls.push(...pageLocs.filter((u) => u.startsWith(ROOT)));
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
  doc.querySelectorAll('script, style, nav, footer').forEach((n) => n.remove());
  const text = doc.body?.textContent || '';
  return text
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// split into roughly 1500-character chunks
function chunkText(text, maxLen = 1500) {
  const parts = [];
  let pos = 0;
  while (pos < text.length) {
    parts.push(text.slice(pos, pos + maxLen));
    pos += maxLen;
  }
  return parts;
}

// ---------------- main ingest ----------------
(async () => {
  console.log('🔎  Fetching sitemap...');
  const urls = await getAllUrlsFromSitemaps();

  for (const url of urls) {
    try {
      console.log(`📄  Processing ${url}`);
      const res = await fetch(url);
      const html = await res.text();
      const dom = new JSDOM(html);

      if (!isIndexable(dom)) {
        console.log('   ⏩  Skipped (noindex)');
        continue;
      }

      const text = extractMainText(dom);
      if (!text || text.length < 200) {
        console.log('   ⚪  Skipped (too short)');
        continue;
      }

      const chunks = chunkText(text);
      let i = 0;
      for (const chunk of chunks) {
        i++;
        const emb = await openai.embeddings.create({
          model: MODEL,
          input: chunk,
        });
        const vector = emb.data[0].embedding;

        // store in KV: key=page-URL, list of vectors
        await kv.rpush(`embed:${url}`, JSON.stringify({ chunk, vector }));
      }
      console.log(`   ✅  Stored ${i} chunks`);
    } catch (err) {
      console.error(`   ❌  Error at ${url}:`, err.message);
    }
  }

  console.log('Ingest klar ✅');
})();