/* === Webbyrå Sigtuna Chat – v4.4.2 (stable) === */
(function(){
  'use strict';

  const safe = (fn)=>{ try { return fn(); } catch(e){ console.error('[WBS chat] init error:', e); } };
  const idle = window.requestIdleCallback || ((cb)=>setTimeout(cb, 600));
  idle(()=> setTimeout(init, 350));

  function init(){
    safe(()=>{

      if (document.getElementById('wbs-launcher')) return;

      /* --- Config --- */
      const ENDPOINT="https://web-chatbot-beta.vercel.app/api/chat";
      const BOOKING_URL="https://webbyrasigtuna.se/kundportal/boka";
      const LEAD_LOCAL_URL = "https://webbyrasigtuna.se/gratis-lokal-seo-analys/";
      const LEAD_SEO_URL   = "https://webbyrasigtuna.se/gratis-seo-analys/";
      const PRIVACY_URL="https://webbyrasigtuna.se/integritetspolicy/";
      const BRAND_NAME="Webbyrå Sigtuna Chat";
      const AVATAR_URL="https://webbyrasigtuna.se/wp-content/uploads/2024/12/andreas-seifert-beveled-edge-webbyra-sigtuna.png";
      const CHAT_ICON="https://webbyrasigtuna.se/wp-content/uploads/2025/10/chat-bubble.png";
      const SUGGESTIONS=["Vilka tjänster erbjuder ni?","Erbjuder ni SEO-tjänster?","Erbjuder ni WordPress-underhåll?"];
      const CTA_TEXT="Boka ett upptäcktsmöte";
      const REPLACE_CHIPS_WITH_CTA=true;
      const LAUNCHER_DELAY_MS=1000;
      const CHIP_STAGGER_MS=70;

      /* --- Shadow host --- */
      const host=document.createElement('div');
      host.id='wbs-host';
      host.style.all='initial';
      host.style.position='fixed';
      host.style.inset='auto auto 0 0';
      host.style.zIndex='2147483646';
      document.body.appendChild(host);

      const shadow=host.attachShadow({mode:'open'});
      const c=(t,cls,html)=>{const e=document.createElement(t);if(cls)e.setAttribute('class',cls);if(html!=null)e.innerHTML=html;return e;};

      /* --- Styles --- */
      const css=`
:host{all:initial}
@keyframes wbs-blink{0%{opacity:.2}20%{opacity:1}100%{opacity:.2}}
.wbs-dot{width:6px;height:6px;margin-right:3px;border-radius:50%;background:#999;display:inline-block;animation:wbs-blink 1.4s infinite;}
.wbs-dot:nth-child(2){animation-delay:.2s}.wbs-dot:nth-child(3){animation-delay:.4s}
@keyframes wbs-fadeSlideIn{0%{opacity:0;transform:translateX(-12px);}100%{opacity:1;transform:translateX(0);}}
@keyframes wbs-slideUp{0%{opacity:0;transform:translateY(20px);}100%{opacity:1;transform:translateY(0);}}
@keyframes wbs-slideDown{0%{opacity:1;transform:translateY(0);}100%{opacity:0;transform:translateY(20px);}}
@keyframes wbs-fadeUp{0%{opacity:0;transform:translateY(6px);}100%{opacity:1;transform:translateY(0);}}

@font-face {
  font-family: "Encode Sans SC";
  src: local("Encode Sans SC"), url("https://webbyrasigtuna.se/wp-content/uploads/fonts/encode-sans-sc/encode-sans-sc/latin/EncodeSansSC-VariableFont_wght.woff2") format("woff2");
  font-display: swap;
}
@font-face {
  font-family: "Encode Sans Semi Expanded";
  src: local("Encode Sans Semi Expanded"), url("https://webbyrasigtuna.se/wp-content/uploads/fonts/encode-sans-semi-expanded/encode-sans-semi-expanded/latin/EncodeSansSemiExpanded-300.woff2") format("woff2");
  font-display: swap;
}

:host {
  --brandBg:#000;
  --brandFg:#ff9e00;
  --white:#fff;
  --border:#e5e7eb;
  --text:#000;
  --userBg:#e8efff;
  --radius-m:12px;
  --shadow-s:0 2px 4px rgba(0,0,0,0.1);
  --shadow-l:0 4px 10px rgba(0,0,0,0.15);
  --space-xs:6px;
  --space-m:10px;
}

* { box-sizing: border-box; font-family: "Encode Sans Semi Expanded","Encode Sans SC",system-ui,sans-serif; }

.wbs-chip-anim{opacity:0;transform:translateY(6px);animation:wbs-fadeUp .35s ease forwards;}
#wbs-launcher{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom,0));left:24px;z-index:2147483647;
  height:56px;border-radius:999px;border:2px solid var(--brandFg);background:var(--white);cursor:pointer;display:flex;align-items:center;gap:10px;
  box-shadow:0 10px 24px rgba(0,0,0,.25);padding:0 16px;color:var(--text);opacity:0}
#wbs-launcher.wbs-visible{animation:wbs-fadeSlideIn .6s ease forwards}
#wbs-launcher:hover{box-shadow:0 0 12px rgba(255,158,0,.5)}
#wbs-launcher img{width:32px;height:32px;display:block}
#wbs-launcher span{font-size:14px}
#wbs-launcher.wbs-close{background:var(--brandBg);color:var(--white);border-color:var(--brandBg)}

.wbs-panel{position:fixed;bottom:calc(92px + env(safe-area-inset-bottom,0));left:24px;z-index:2147483647;width:420px;max-width:96vw;min-height:560px;
  max-height:calc(85vh + 10px);border-radius:16px;overflow:hidden;display:none;flex-direction:column;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,.25);
  border:1px solid var(--border);opacity:0;will-change:transform,opacity}
.wbs-panel.wbs-open{display:flex;animation:wbs-slideUp .4s ease forwards}
.wbs-panel.wbs-closing{animation:wbs-slideDown .3s ease forwards}
@media(max-width:640px){.wbs-panel{width:96vw;min-height:560px;max-height:calc(78vh + 10px)}}

.wbs-header{background:var(--brandBg);color:#fff;padding:10px 12px;display:flex;align-items:center;gap:10px;font-family:"Encode Sans SC",system-ui,sans-serif}
.wbs-header img{width:22px;height:22px;border-radius:999px;object-fit:cover}
.wbs-x{margin-left:auto;color:#fff;opacity:.9;cursor:pointer;font-size:18px}

.wbs-log{padding:8px 8px 6px 8px;flex:1;overflow:auto;background:#fafafa}
.wbs-row{display:flex;gap:8px;margin:6px 0;align-items:flex-start}
.wbs-row.me{justify-content:flex-end}
.wbs-row.me .wbs-avatar{display:none}
.wbs-avatar{width:28px;height:28px;border-radius:999px;object-fit:cover}

.wbs-bubble{padding:8px 10px;border-radius:12px;max-width:78%;border:1px solid var(--border);box-shadow:0 1px 2px rgba(0,0,0,.04);color:var(--text)}
.wbs-bubble.user{background:var(--userBg)}
.wbs-bubble.bot{background:#fff}
.wbs-name{font-size:12px;margin-bottom:3px;color:var(--text);font-weight:700;font-family:"Encode Sans SC",system-ui,sans-serif}
.wbs-bubble div{white-space:pre-wrap;word-wrap:break-word}
.wbs-bubble.bot div{font-size:13px;line-height:1.45}
.wbs-bubble.user div{font-size:14px;line-height:1.45}
.wbs-bubble ul,.wbs-bubble ol{margin:6px 0 6px 20px;padding:0}
.wbs-bubble li{margin:2px 0;line-height:1.45}
.wbs-bubble p{margin:6px 0;line-height:1.55}
.wbs-bubble ul li p{margin:0}
.wbs-bubble a{color:var(--brandFg);text-decoration:underline;word-break:break-word}

.wbs-chips{display:flex;flex-direction:column;gap:8px;padding:8px 10px 10px 10px;align-items:flex-end}
.wbs-chip{display:inline-flex;width:auto;background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:10px 12px;font-size:13px;cursor:pointer}
.wbs-chip:hover{background:rgba(255,158,0,.15)}

.wbs-inputrow{display:flex;align-items:center;border-top:1px solid var(--border);background:#fff}
.wbs-inputrow input{flex:1;padding:12px;border:0;outline:none;font-size:14px}
.wbs-send{background:var(--brandBg);color:#fff;border:0;width:44px;height:44px;margin-right:8px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer}

.wbs-footer{display:flex;justify-content:center;gap:16px;align-items:center;border-top:1px solid var(--border);padding:8px 12px;background:#fff}
.wbs-footer a{font-size:12px;color:#555;text-decoration:underline;cursor:pointer}
.wbs-footer a:hover{color:var(--brandFg)}

.wbs-fade-out{animation:wbsFadeOut .6s ease forwards}
@keyframes wbsFadeOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(6px)}}
.wbs-fade-in{animation:wbsFadeIn .6s ease forwards}
@keyframes wbsFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `;
      const style=document.createElement('style');
      style.textContent=css;

      /* --- DOM --- */
      const root=document.createElement('div'); root.id='wbs-root';
      shadow.append(style, root);

      const launcher=c('button'); launcher.id='wbs-launcher';
      const icon=c('img'); icon.src=CHAT_ICON;
      const label=c('span',null,'Chatta med oss');
      launcher.append(icon,label); root.appendChild(launcher);
      setTimeout(()=>launcher.classList.add('wbs-visible'), LAUNCHER_DELAY_MS);

      const panel=c('div','wbs-panel');
      const header=c('div','wbs-header');
      const hImg=c('img'); hImg.src=AVATAR_URL;
      const title=c('div',null,BRAND_NAME);
      const x=c('div','wbs-x','×');
      header.append(hImg,title,x);

      const log=c('div','wbs-log');
      const chips=c('div','wbs-chips');
      const inpRow=c('div','wbs-inputrow'); const inp=c('input'); inp.placeholder='Skriv ett meddelande…';
      const send=c('button','wbs-send'); send.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

      const foot=c('div','wbs-footer');
      const priv=c('a',null,'Integritetspolicy'); priv.href=PRIVACY_URL;
      const clear=c('a',null,'Rensa chatten');

      inpRow.append(inp,send);
      foot.append(priv,clear);
      panel.append(header,log,chips,inpRow,foot);
      root.appendChild(panel);

      /* --- CTA helper --- */
      function addCTAChip(label, url) {
        chips.innerHTML = '';
        const chip = document.createElement('button');
        chip.className = 'wbs-chip wbs-chip-anim';
        chip.textContent = label;
        chip.onclick = () => {
          window.gtag?.('event', 'wbs_chat_cta', { cta: label });
          window.plausible?.('wbs_chat_cta', { props: { cta: label } });
          window.open(url, '_blank');
        };
        chips.append(chip);
      }

      /* --- Session + memory --- */
      const SESSION_KEY='wbs_session_id';
      let sessionId=localStorage.getItem(SESSION_KEY);
      if(!sessionId){
        sessionId=(crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
        localStorage.setItem(SESSION_KEY,sessionId);
      }
      let SAVED_LOG_KEY = 'wbs_chat_log_' + sessionId;
      let chatMemory = [];
      let replaying = false;

      try {
        const saved = localStorage.getItem(SAVED_LOG_KEY);
        if (saved) chatMemory = JSON.parse(saved);
      } catch(e) {
        console.warn('[WBS] failed to parse saved log', e);
        chatMemory = [];
      }

      /* --- Chips --- */
      SUGGESTIONS.forEach((q,i)=>{
        const chip=c('button','wbs-chip wbs-chip-anim',q);
        chip.style.animationDelay=(i*CHIP_STAGGER_MS)+'ms';
        chip.onclick=()=>{inp.value=q; send.click();};
        chips.append(chip);
      });

/* ===== Markdown renderer (de-dupe + link fixes + robust lists) ===== */
function dedupeBlocks(txt){
  const blocks = String(txt).split(/\n{2,}/);
  const seen = new Set();
  const out = [];
  for (const b of blocks){
    const key = b.trim().replace(/\s+/g,' ');
    if (!key) continue;
    if (!seen.has(key)) { seen.add(key); out.push(b); }
  }
  return out.join('\n\n');
}

function md(txt){
  if (!txt) return '';

  // 0) De-dupe early
  let s = dedupeBlocks(txt);

  // 0a) Collapse [[Label](url)](url) → [Label](url)
  s = s.replace(
    /\[\s*\[([^\]]+)\]\s*\(\s*(https?:\/\/[^)]+)\s*\)\s*\]\s*\(\s*\2\s*\)/gi,
    '[$1]($2)'
  );

  // 0b) Convert HTML anchors → Markdown (normalize hrefs)
  s = s.replace(/<a\s+[^>]*href\s*=\s*"([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href, label) => {
    let url = href.trim();
    if (/^\/\//i.test(url)) url = 'https:' + url;
    else if (/^\//.test(url)) url = 'https://webbyrasigtuna.se' + url;
    else if (/^(?:www\.)?webbyrasigtuna\.se\b/i.test(url))
      url = 'https://' + url.replace(/^https?:\/\//i, '');
    else if (!/^https?:\/\//i.test(url) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(url))
      url = 'https://' + url;
    return `[${label}](${url})`;
  });

  // 1) Normalize whitespace & dashes
  s = s
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-')
    .replace(/\r?\n[ \t]+\r?\n/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // 1b) Cosmetic casing
  s = s
    .replace(/\bseo\b/g, 'SEO')
    .replace(/\bwordpress\b/g, 'WordPress')
    .replace(/\blokal\s+seo\b/gi, 'lokal SEO');

// 1c) Fix glued or line-wrapped URLs (…texthttps… or …text⏎https…)
// Also handles the rare stray leading "h" → "hhttps://"
s = s.replace(/([A-Za-zÅÄÖåäö])h?https?:\/\//gi, '$1 https://');
s = s.replace(/([A-Za-zÅÄÖåäö])\s*\r?\n\s*h?(https?:\/\/)/gi, '$1 $2');


  // 2) "(Label) (https://…)" → "[Label](https://…)" and drop bare "(https://…)"
  s = s.replace(
    /\(\s*\[?([A-Za-zÅÄÖåäö0-9 .,:;+\-_/&%€$@!?]+?)\]?\s*\)\s*\(\s*(https?:\/\/[^)]+)\s*\)/g,
    '[$1]($2)'
  );
  s = s.replace(/\(\s*(https?:\/\/[^)]+)\s*\)/g, '$1');

  // 2b) "[Label](url) url" (same/next line) → "[Label](url)"
  s = s.replace(/\[([^\]]+)\]\s*\((https?:\/\/[^\s)]+)\)\s*(?:\r?\n)?\s*\2/gi, '[$1]($2)');

  // 3) Markdown links → <a> (no target)
  s = s.replace(/\[([^\]]+)\]\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/g, '<a href="$2">$1</a>');

  // 4) Emphasis
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

// 5) Remove orphan [Label]
s = s.replace(/\[([^\]]+)\](?!\s*\()/g, '$1');
// 5.1b) Bullets where the title is followed by a (possibly glued) raw URL
//       "- Title h?https://..."  ->  "- <a href="...">Title</a>"
s = s.replace(
  /(^|\n)([-*•]\s+)([^<\n]+?)\s*(h?https?:\/\/[^\s)]+)(?=\s*$|\s*\n)/gi,
  (_m, pre, marker, title, url) => {
    const urlNorm = url.replace(/^h(?=https?:\/\/)/i, '');        // drop stray 'h'
    const t = title.trim().replace(/[.:;,\u2013\u2014-]\s*$/, ''); // clean trailing punctuation
    return `${pre}${marker}<a href="${urlNorm}">${t}</a>`;
  }
);

// Ordered bullets: "1. Title h?https://..." -> "1. <a href="...">Title</a>"
s = s.replace(
  /(^|\n)(\d+\.\s+)([^<\n]+?)\s*(h?https?:\/\/[^\s)]+)(?=\s*$|\s*\n)/gi,
  (_m, pre, marker, title, url) => {
    const urlNorm = url.replace(/^h(?=https?:\/\/)/i, '');
    const t = title.trim().replace(/[.:;,\u2013\u2014-]\s*$/, '');
    return `${pre}${marker}<a href="${urlNorm}">${t}</a>`;
  }
);
// 5.1) Turn known "Label + URL" (no brackets) into one anchor *before* we auto-link URLs.
//     e.g. "SEOhttps://..." → <a href="...">SEO</a>
//     We also map WordPress → WordPress-underhåll when it points to /webbplatsunderhall/
{
  const LABELS =
    '(Tjänster|Webbdesign|Sökmotoroptimering|Digital(?:a)?\\s+Marknadsföring|Webbanalys|WordPress(?:-underhåll)?|WordPress|SEO|Lokal\\s+SEO|Priser|Annonsering)';

  const labelUrlRE = new RegExp(`(^|[^">])\\b${LABELS}\\s*(https?:\\/\\/[^\\s)]+)`, 'gi');
  s = s.replace(labelUrlRE, (_m, pre, label, url) => {
    // If we appear to be inside href="...label...url", bail out
    if (pre && pre.endsWith('=')) return _m;

    const nice =
      /webbplatsunderhall/i.test(url) && /^WordPress$/i.test(label)
        ? 'WordPress-underhåll'
        : label;

    return pre + `<a href="${url}">${nice}</a>`;
  });
}

// 5.2) If an anchor is followed by the same raw URL (same line, next line or after <br>), drop the duplicate
s = s.replace(
  /(<a\s+href="(https?:\/\/[^"]+)"[^>]*>[^<]+<\/a>)(?:\s*|<br\s*\/?>|\r?\n)+\2\b/gi,
  '$1'
);
// 5.3) Bullet / numbered item "Title + URL" -> make the *title* the anchor
//     Works for "- ", "• ", "* " and "1. " styles. URL may be on same line or next line.
const bulletToAnchor = (_m, pre, marker, title, url) => {
  const cleanTitle = title.trim().replace(/[.:;,\u2013\u2014-]\s*$/,''); // strip stray end punctuation
  return `${pre}${marker}<a href="${url}">${cleanTitle}</a>`;
};

// same line: "- Title    https://…"
s = s.replace(
  /(^|\n)([-*•]\s+)(.+?)\s+(https?:\/\/[^\s)]+)\s*(?=\n|$)/gi,
  bulletToAnchor
);
// next line: "- Title⏎https://…"
s = s.replace(
  /(^|\n)([-*•]\s+)(.+?)\s*\r?\n\s*(https?:\/\/[^\s)]+)\s*(?=\n|$)/gi,
  bulletToAnchor
);

// ordered lists "1. Title   https://…" (same line)
s = s.replace(
  /(^|\n)(\d+\.\s+)(.+?)\s+(https?:\/\/[^\s)]+)\s*(?=\n|$)/gi,
  bulletToAnchor
);
// ordered lists "1. Title⏎https://…" (next line)
s = s.replace(
  /(^|\n)(\d+\.\s+)(.+?)\s*\r?\n\s*(https?:\/\/[^\s)]+)\s*(?=\n|$)/gi,
  bulletToAnchor
);
  // 6) Auto-link raw URLs + bare webbyrasigtuna.se
  s = s.replace(
    /(^|[\s(])((?:https?:\/\/)[^\s)]+)(?=$|[\s).,!?])/gi,
    function (_m, p1, url) { return p1 + '<a href="' + url + '">' + url + '</a>'; }
  );
  s = s.replace(
    /(^|[\s(])((?:www\.)?webbyrasigtuna\.se[^\s)]+)(?=$|[\s).,!?])/gi,
    function (_m, p1, url) {
      const norm = 'https://' + url.replace(/^https?:\/\//i, '');
      return p1 + '<a href="' + norm + '">' + norm + '</a>';
    }
  );

  // 6a) After auto-link: upgrade WordPress + maintenance URL to readable label
  s = s.replace(
    /(WordPress)\s*<a href="(https?:\/\/[^"]*webbplatsunderhall[^"]*)">https?:\/\/[^<]+<\/a>/gi,
    function (_m, _label, url) { return '<a href="' + url + '">WordPress-underhåll</a>'; }
  );

  // 6c) Collapse repeated identical raw URLs
  s = s.replace(/(https?:\/\/[^\s)]+)(?:\s*\1)+/gi, '$1');

  // 6d) Post-auto-link repair: bullets/ordered items where the URL is already an <a>
//    Convert "• Title <a href="...">https://...</a>" -> "• <a href="...">Title</a>"
//    Works for -, *, • and "1. " lists, URL may be on same or next line.
const bulletAnchorize = (_m, pre, marker, title, url) => {
  const cleanTitle = title.trim().replace(/[.:;,\u2013\u2014-]\s*$/,'');
  return `${pre}${marker}<a href="${url}">${cleanTitle}</a>`;
};

// unordered bullets (same line)
s = s.replace(
  /(^|\n)([-*•]\s+)([^<\n]+?)\s*<a\s+href="(https?:\/\/[^"]+)">https?:\/\/[^<]+<\/a>\s*(?=\n|$)/gi,
  bulletAnchorize
);
// unordered bullets (URL on next line)
s = s.replace(
  /(^|\n)([-*•]\s+)([^<\n]+?)\s*\r?\n\s*<a\s+href="(https?:\/\/[^"]+)">https?:\/\/[^<]+<\/a>\s*(?=\n|$)/gi,
  bulletAnchorize
);

// ordered bullets (same line)
s = s.replace(
  /(^|\n)(\d+\.\s+)([^<\n]+?)\s*<a\s+href="(https?:\/\/[^"]+)">https?:\/\/[^<]+<\/a>\s*(?=\n|$)/gi,
  bulletAnchorize
);
// ordered bullets (URL on next line)
s = s.replace(
  /(^|\n)(\d+\.\s+)([^<\n]+?)\s*\r?\n\s*<a\s+href="(https?:\/\/[^"]+)">https?:\/\/[^<]+<\/a>\s*(?=\n|$)/gi,
  bulletAnchorize
);
  
  // 7) Headings like "### Tips:" → bold line
  s = s.replace(/^###\s*([^:\n]+):?\s*$/gim, function (_m, h) {
    return '<p><strong>' + h.trim() + ':</strong></p>';
  });



  // Generic "WordPress + URL to maintenance page" -> "WordPress-underhåll" as a single anchor
s = s.replace(
  /\b(WordPress)\s*(https?:\/\/[^\s)]+webbplatsunderhall[^\s)]*)/gi,
  (_m, label, url) => `<a href="${url}">WordPress-underhåll</a>`
);
  
// 8) Lists & paragraphs (extended items)
const lines = s.split(/\r?\n/);
let out = [];
let inUL = false, inOL = false;
let liBuffer = '';
let para = [];

const flushLists = () => {
  if (liBuffer) { out.push('<li>' + liBuffer + '</li>'); liBuffer = ''; }
  if (inUL) { out.push('</ul>'); inUL = false; }
  if (inOL) { out.push('</ol>'); inOL = false; }
};
const ensureUL = () => { if (!inUL) { flushLists(); out.push('<ul>'); inUL = true; } };
const ensureOL = () => { if (!inOL) { flushLists(); out.push('<ol>'); inOL = true; } };
const flushPara = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };

const addLineToLi = (line) => {
  if (!line.trim()) return;
  if (!liBuffer) liBuffer = line;
  else liBuffer += '<br>' + line;
};

for (const raw of lines) {
  const line = raw.trim();
  // Strip tags for heading detection (e.g. <p><strong>Tips...</strong></p>)
  const plain = line.replace(/<[^>]+>/g, '').trim();

  const mUL = /^[-*•]\s+(.+)$/.exec(line);
  const mOL = /^\d+\.\s+(.+)$/.exec(line);

  if (mUL) {
    if (inOL) flushLists();
    ensureUL();
    if (liBuffer) { out.push('<li>' + liBuffer + '</li>'); liBuffer = ''; }
    flushPara();
    liBuffer = mUL[1];
    continue;
  }
  if (mOL) {
    if (inUL) flushLists();
    ensureOL();
    if (liBuffer) { out.push('<li>' + liBuffer + '</li>'); liBuffer = ''; }
    flushPara();
    liBuffer = mOL[1];
    continue;
  }

  // Blank line handling — keep current list open
  if (line === '') {
    if (inUL || inOL) {          // paragraph break *inside* the current bullet
      addLineToLi('');
      continue;
    }
    flushPara();                  // real paragraph break (not in a list)
    continue;
  }

// Close lists before blocks like Tips, Relaterad läsning, Källa, "Läs mer …", "Om du …", CTAs, etc.
const BREAKS_LIST =
  /^(?:Tips\b|Relaterad\s+läsning\b|Källa:|Läs\b|Läs\s+gärna\b|Läs\s+mer\b|Läs\s+mer\s+om\b|För\s+mer\s+information\b|Du\s+kan\s+läsa\s+mer\b|Om\s+du\b|Vill\s+du\s+boka\b|Ansök\s+här\b|🤝)/i;

  // Standalone service label/anchor — should not live inside a bullet
  const SERVICE_LABEL =
    /^(Webbanalys|Webbdesign|Sökmotoroptimering|Digital(?:a)?\s+marknadsföring|WordPress(?:-underhåll)?|SEO|Lokal\s+SEO|Tjänster|Priser)$/i;

  const isStandaloneServiceAnchor =
    /^<a\b[^>]*>[^<]+<\/a>$/.test(line) && SERVICE_LABEL.test(plain);

  if ((inUL || inOL) && (SERVICE_LABEL.test(plain) || isStandaloneServiceAnchor)) {
    if (liBuffer) { out.push('<li>' + liBuffer + '</li>'); liBuffer = ''; }
    flushLists();
    out.push('');                 // visual gap
    out.push('<p>' + line + '</p>');
    continue;
  }

  if ((inUL || inOL) && BREAKS_LIST.test(plain)) {
    if (liBuffer) { out.push('<li>' + liBuffer + '</li>'); liBuffer = ''; }
    flushLists();
    out.push('');                 // visual gap
    // fall through — treat current line as paragraph below
  }

  if (inUL || inOL) { addLineToLi(line); continue; } // still same bullet
  para.push(line);                                    // normal paragraph
}

// === Finalize ===
if (liBuffer) out.push('<li>' + liBuffer + '</li>');
if (inUL) out.push('</ul>');
if (inOL) out.push('</ol>');
flushPara();

// Join once into HTML
let html = out.join('\n');
  // If a list ends and a paragraph starts immediately, add a small gap.
html = html.replace(/<\/[uo]l>\s*<p>/gi, '</ul><br><p>');

// If Tips/Relaterad/Källa appear inside a <li>, add a visual gap before them
html = html.replace(
  /(<li>[\s\S]*?)(<p>(?:<strong>)?(?:💡\s*)?Tips\b[^:<]*:)/gi,
  '$1<br>$2'
);
html = html.replace(
  /(<li>[\s\S]*?)(<p>(?:📰\s*)?Relaterad\s+läsning:)/gi,
  '$1<br><br>$2'
);
html = html.replace(
  /(<li>[\s\S]*?)(<p>(?:<em>)?Källa:)/gi,
  '$1<br>$2'
);

return html;
} // end of md()


      /* --- Add message --- */
      let lastBotTxt = '';
      function addMsg(who, txt, persist = true){
        if (who === 'Bot') {
          const normalized = String(txt).trim().replace(/\s+/g,' ');
          if (normalized && normalized === lastBotTxt) return;
          lastBotTxt = normalized;
        }
        const row=c('div','wbs-row'+(who==='Du'?' me':''));
        if(who==='Bot'){ const a=c('img','wbs-avatar'); a.src=AVATAR_URL; row.append(a); }
        const b=c('div','wbs-bubble '+(who==='Du'?'user':'bot'));
        const n=c('div','wbs-name', who==='Du'?'Du':BRAND_NAME);
        const d=document.createElement('div');
        if (who === 'Bot') d.innerHTML = md(txt); else d.textContent = txt;
        b.append(n,d); row.append(b); log.append(row); log.scrollTop=log.scrollHeight;
        if (who === 'Bot') requestAnimationFrame(()=> row.classList.add('wbs-fade-in'));

        if (persist && !replaying) {
          chatMemory.push({ who, txt });
          try { localStorage.setItem(SAVED_LOG_KEY, JSON.stringify(chatMemory)); }
          catch(e){ console.warn('[WBS] failed to save chat log', e); }
        }
      }

      /* --- Restore or greet --- */
      if (chatMemory.length > 0) {
        replaying = true;
        chatMemory.forEach(({ who, txt }) => addMsg(who, txt, false));
        replaying = false;
      } else {
        addMsg('Bot','Hej! Vad kan jag hjälpa dig med idag?');
      }

      /* --- Open/close --- */
      function toggleLauncher(open){
        if(open){
          launcher.classList.add('wbs-close');
          launcher.innerHTML='<span style="font-size:24px;margin-right:8px;">×</span><span style="font-size:14px;">Stäng chatten</span>';
        } else {
          launcher.classList.remove('wbs-close');
          launcher.innerHTML=''; launcher.append(icon,label);
        }
      }
      function openPanel(){ panel.style.display='flex'; panel.classList.remove('wbs-closing'); void panel.offsetWidth; panel.classList.add('wbs-open'); toggleLauncher(true); }
      function closePanel(){ panel.classList.remove('wbs-open'); panel.classList.add('wbs-closing'); setTimeout(()=>{ panel.classList.remove('wbs-closing'); panel.style.display='none'; toggleLauncher(false); }, 300); }
      launcher.onclick=()=> panel.classList.contains('wbs-open')? closePanel(): openPanel();
      x.onclick=closePanel;

      /* --- Ask flow --- */
      let first=true;
      async function ask(m){
        if(!m) return;
        addMsg('Du', m);

        if(first && REPLACE_CHIPS_WITH_CTA){
          first=false;
          chips.innerHTML='';
          const cta=c('button','wbs-chip wbs-chip-anim',CTA_TEXT);
          cta.onclick=()=>window.open(BOOKING_URL,'_blank');
          chips.append(cta);
        }

        const t=c('div','wbs-row');
        const d=c('div','wbs-bubble bot','<span class="wbs-dot"></span><span class="wbs-dot"></span><span class="wbs-dot"></span>');
        const a=c('img','wbs-avatar'); a.src=AVATAR_URL; t.append(a,d); log.append(t);

        try{
          const r=await fetch(ENDPOINT,{ method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ message:m, sessionId }) });
          const data=await r.json().catch(()=>({reply:'(Kunde inte tolka svar)'}));
          t.remove();
          addMsg('Bot', data.reply || '(Inget svar)');

          if (data.lead_intent) {
            const lower = m.toLowerCase();
            const isLocal = lower.includes('lokal seo');
            const url   = isLocal ? LEAD_LOCAL_URL : LEAD_SEO_URL;
            const label = isLocal ? 'Gör en gratis lokal SEO-analys' : 'Gör en gratis SEO-analys';
            addCTAChip(label, url);
          }
          if (data.booking_intent) addCTAChip('Boka möte direkt', BOOKING_URL);

        }catch(e){
          console.error('[WBS chat] fetch error:', e);
          t.remove();
          addMsg('Bot','(Tekniskt fel – försök igen.)');
        }
      }

      send.onclick=()=>{ const m=inp.value.trim(); if(!m) return; inp.value=''; ask(m); };
      inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); send.click(); } });

      /* --- Clear chat --- */
      clear.onclick = () => {
        const oldKey = SAVED_LOG_KEY;

        fetch('https://web-chatbot-beta.vercel.app/api/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        }).catch(() => {});

        log.innerHTML = '';
        localStorage.removeItem(oldKey);
        chatMemory = [];

        // new session id
        localStorage.removeItem(SESSION_KEY);
        sessionId = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
        localStorage.setItem(SESSION_KEY, sessionId);
        SAVED_LOG_KEY = 'wbs_chat_log_' + sessionId;

        addMsg('Bot', 'Chatten har rensats. Börja om när du vill!', false);

        setTimeout(() => {
          const bubbles = log.querySelectorAll('.wbs-row');
          if (!bubbles.length) return;

          const last = bubbles[bubbles.length - 1];
          last.classList.add('wbs-fade-out');

          (window.requestIdleCallback || ((cb) => setTimeout(cb, 400)))(() => {
            try {
              last.remove();
              addMsg('Bot', 'Är det något mer jag kan hjälpa dig med?');
            } catch (err) {
              console.warn('[WBS clear fade] error', err);
            }
          });
        }, 2000);
      };

    }); // <-- end of safe(() => { ... })
  }      // <-- end of init()
})();    // <-- end of IIFE