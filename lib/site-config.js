// lib/site-config.js
// Centraliserad konfiguration för tjänster, länkar och etikett-mappning
// Hämtas dynamiskt från WordPress-pluginet (wp-json/wbs-ai/v1/config)

/* ------------------------------------------------
   1. HÄMTA KONFIG FRÅN WORDPRESS
-------------------------------------------------*/
export async function loadSiteConfig() {
  const base = process.env.WP_BASE_URL;

  if (!base) throw new Error('WP_BASE_URL missing');
  const endpoint = base.replace(/\/+$/, '') + '/wp-json/wbs-ai/v1/config';

  const res = await fetch(endpoint, { cache: 'no-store' });

  if (!res.ok) {
    throw new Error(`Failed to fetch WP AI config: ${res.status}`);
  }

  return await res.json();
}

/* ------------------------------------------------
   2. BYGG LÄNKKARTA (LINKS)
-------------------------------------------------*/
export function buildLinksMap(config) {
  const pages = config.pages || {};

  return {
    'lokal seo':            pages.local_seo,
    'seo':                  pages.seo,
    'webbdesign':           pages.webbdesign,
    'wordpress':            pages.wordpress,
    'wordpress-underhåll':  pages.wordpress,
    'underhåll':            pages.wordpress,
    'annonsering':          pages.annonsering,
    'tjänster':             pages.tjanster,
    'priser':               pages.priser,
    'webbanalys':           pages.webbanalys,
    'blogg':                pages.blogg,
  };
}

/* ------------------------------------------------
   3. mapLabel() — identifiera nyckelord som ska länkas
-------------------------------------------------*/
export function mapLabel(raw = '') {
  if (!raw) return null;

  const norm = raw
    .toLowerCase()
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const m = (key, display) => ({ key, display });

  if (norm.includes('lokal seo'))   return m('lokal seo', 'Lokal SEO');
  if (/\bseo\b/.test(norm))         return m('seo', 'SEO');
  if (norm.includes('wordpress'))   return m('wordpress', 'WordPress');
  if (norm.includes('underhåll'))   return m('underhåll', 'WordPress-underhåll');
  if (norm.includes('webbdesign'))  return m('webbdesign', 'Webbdesign');
  if (norm.includes('tjänster'))    return m('tjänster', 'Tjänster');
  if (norm.includes('annonsering')) return m('annonsering', 'Annonsering');
  if (norm.includes('priser'))      return m('priser', 'Priser');
  if (norm.includes('webbanalys'))  return m('webbanalys', 'Webbanalys');

  return null;
}