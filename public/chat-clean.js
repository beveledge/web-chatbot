/* Webbyrå Sigtuna Chat – Frontend v1.3.4 (multitenant: siteId skickas till backend) */
(function () {
  'use strict';

  const safe = (fn) => { try { return fn(); } catch (e) { console.error('[WBS chat] init error:', e); } };
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 600));

  // Hämta konfiguration från WordPress-pluginet
  const CONFIG_ENDPOINT = '/wp-json/wbs-ai/v1/config';

  async function loadConfig() {
    try {
      const res = await fetch(CONFIG_ENDPOINT, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Config HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.warn('[WBS chat] kunde inte ladda config, använder fallback', e);
      return null;
    }
  }

  // Vänta tills sidan är lugn, ladda config, SEN starta init()
  idle(async () => {
    const cfg = await loadConfig();
    setTimeout(() => init(cfg), 350);
  });

  function init(config) {
    safe(() => {
      if (typeof document === 'undefined') return;
      if (document.getElementById('wbs-launcher')) return;

      /* --- Config (nu baserad på WP-config) --- */
      const baseUrl   = config?.base_url   || 'https://webbyrasigtuna.se';
      const brandName = config?.brand_name || 'Webbyrå Sigtuna';
      
      const bookingUrl   = config?.primary_cta?.url   || (baseUrl + '/kontakt/');
      const bookingLabel = config?.primary_cta?.label || 'Boka ett upptäcktsmöte';

      // Generiska lead magnets (max 2, men vi bryr oss bara om de som finns)
      const leadMagnets = Array.isArray(config?.lead_magnets) ? config.lead_magnets : [];

      const pages      = config?.pages || {};
      const privacyUrl = pages.integritet || (baseUrl + '/integritetspolicy/');

      // Färger från config (med vettiga defaults)
      const colors = config?.colors || {};
      const brandBgColor = (typeof colors.brand_bg === 'string' && colors.brand_bg.trim()) ? colors.brand_bg.trim() : '#000000';
      const brandFgColor = (typeof colors.brand_fg === 'string' && colors.brand_fg.trim()) ? colors.brand_fg.trim() : '#ff9e00';

      // === Slutliga konstanter som resten av widgeten använder ===
      const ENDPOINT       = 'https://web-chatbot-beta.vercel.app/api/chat';
      const BOOKING_URL    = bookingUrl;
      const PRIVACY_URL    = privacyUrl;
      const BRAND_NAME     = brandName + ' Chat';

      // 👇 Multitenant: siteId tas från config / global / domän
      const SITE_ID =
        (config && (config.site_id || config.siteId)) ||
        (window.WBS_AI && window.WBS_AI.siteId) ||
        (window.location && window.location.hostname.replace(/^www\./, ''));

      // Avatar, chat-ikon och förslag från config
      const AVATAR_URL = config?.avatar_url
        || 'https://webbyrasigtuna.se/wp-content/uploads/2024/12/andreas-seifert-beveled-edge-webbyra-sigtuna.png';

      const CHAT_ICON = config?.chat_icon_url
        || 'https://webbyrasigtuna.se/wp-content/uploads/2025/10/chat-bubble.png';

      const SUGGESTIONS = (Array.isArray(config?.suggestions) && config.suggestions.length > 0)
        ? config.suggestions
        : [
            'Vilka tjänster erbjuder ni?',
            'Hur kan ni hjälpa oss?',
            'Hur fungerar er tjänst?'
          ];

      const CTA_TEXT               = bookingLabel;
      const REPLACE_CHIPS_WITH_CTA = true;
      const LAUNCHER_DELAY_MS      = 1000;
      const CHIP_STAGGER_MS        = 70;

      /* --- Shadow host --- */
      const host = document.createElement('div');
      host.id = 'wbs-host';
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.inset = 'auto auto 0 0';
      host.style.zIndex = '2147483646';
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      const c = (t, cls, html) => {
        const e = document.createElement(t);
        if (cls) e.setAttribute('class', cls);
        if (html != null) e.innerHTML = html;
        return e;
      };

      /* --- Styles --- */
      const css = `
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
  --brandBg:${brandBgColor};
  --brandFg:${brandFgColor};
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
#wbs-launcher{
  position:fixed;
  bottom:calc(24px + env(safe-area-inset-bottom,0));
  left:24px;
  z-index:2147483647;
  height:56px;
  border-radius:999px;
  border:2px solid var(--brandFg);
  background:var(--white);
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:10px;
  box-shadow:0 10px 24px rgba(0,0,0,.25);
  padding:0 16px;
  color:var(--text);
  opacity:0
}
#wbs-launcher.wbs-visible{animation:wbs-fadeSlideIn .6s ease forwards}
#wbs-launcher:hover{box-shadow:0 0 12px rgba(0,0,0,.35)}
#wbs-launcher img{width:32px;height:32px;display:block}
#wbs-launcher span{font-size:14px}
#wbs-launcher.wbs-close{background:var(--brandBg);color:var(--white);border-color:var(--brandBg)}

.wbs-panel{
  position:fixed;
  bottom:calc(92px + env(safe-area-inset-bottom,0));
  left:24px;
  z-index:2147483647;
  width:420px;
  max-width:96vw;
  min-height:560px;
  max-height:calc(85vh + 10px);
  border-radius:16px;
  overflow:hidden;
  display:none;
  flex-direction:column;
  background:#fff;
  box-shadow:0 20px 50px rgba(0,0,0,.25);
  border:1px solid var(--border);
  opacity:0;
  will-change:transform,opacity
}
.wbs-panel.wbs-open{display:flex;animation:wbs-slideUp .4s ease forwards}
.wbs-panel.wbs-closing{animation:wbs-slideDown .3s ease forwards}
@media(max-width:640px){
  .wbs-panel{
    width:96vw;
    min-height:560px;
    max-height:calc(78vh + 10px)
  }
}

.wbs-header{
  background:var(--brandBg);
  color:#fff;
  padding:10px 12px;
  display:flex;
  align-items:center;
  gap:10px;
  font-family:"Encode Sans SC",system-ui,sans-serif
}
.wbs-header img{width:22px;height:22px;border-radius:999px;object-fit:cover}
.wbs-x{margin-left:auto;color:#fff;opacity:.9;cursor:pointer;font-size:18px}

.wbs-log{padding:8px 8px 6px 8px;flex:1;overflow:auto;background:#fafafa}
.wbs-row{display:flex;gap:8px;margin:6px 0;align-items:flex-start}
.wbs-row.me{justify-content:flex-end}
.wbs-row.me .wbs-avatar{display:none}
.wbs-avatar{width:28px;height:28px;border-radius:999px;object-fit:cover}

.wbs-bubble{
  padding:8px 10px;
  border-radius:12px;
  max-width:78%;
  border:1px solid var(--border);
  box-shadow:0 1px 2px rgba(0,0,0,.04);
  color:var(--text)
}
.wbs-bubble.user{background:var(--userBg)}
.wbs-bubble.bot{background:#fff}
.wbs-name{
  font-size:12px;
  margin-bottom:3px;
  color:var(--text);
  font-weight:700;
  font-family:"Encode Sans SC",system-ui,sans-serif
}
.wbs-bubble div{white-space:pre-wrap;word-wrap:break-word}
.wbs-bubble.bot div{font-size:13px;line-height:1.45}
.wbs-bubble.user div{font-size:14px;line-height:1.45}

/* Tighter spacing i bubblor och listor */
.wbs-bubble ul,
.wbs-bubble ol{
  margin:4px 0 4px 18px;
  padding:0;
}
.wbs-bubble li{margin:2px 0;line-height:1.45}
.wbs-bubble p{margin:4px 0;line-height:1.5}
.wbs-bubble ul li p{margin:0}
.wbs-bubble a{color:var(--brandFg);text-decoration:underline;word-break:break-word}

.wbs-chips{
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:8px 10px 10px 10px;
  align-items:flex-end
}

.wbs-chip{
  display:inline-flex;
  width:auto;
  background:#fff;
  border:1px solid #e5e7eb;
  border-radius:999px;
  padding:8px 12px;
  font-size:13px;
  cursor:pointer;
  transition:background .15s ease,border-color .15s ease,color .15s ease;
}
.wbs-chip:hover{background:rgba(0,0,0,.03)}

/* CTA / lead magnets – tydligt skild från vanliga chips */
.wbs-chip-cta{
  background:var(--brandBg);
  color:#fff;
  border-color:var(--brandBg);
}
.wbs-chip-cta:hover{
  background:var(--brandFg);
  border-color:var(--brandFg);
}

.wbs-inputrow{
  display:flex;
  align-items:center;
  border-top:1px solid var(--border);
  background:#fff
}
.wbs-inputrow input{
  flex:1;
  padding:12px;
  border:0;
  outline:none;
  font-size:14px
}
.wbs-send{
  background:var(--brandBg);
  color:#fff;
  border:0;
  width:44px;
  height:44px;
  margin-right:8px;
  border-radius:10px;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer
}

/* Powered by-rad mellan input och footer */
.wbs-powered{
  border-top:1px solid var(--border);
  background:#fff;
  padding:4px 12px 4px 12px;
  font-size:11px;
  text-align:right;
  color:#777;
}
.wbs-powered a{
  color:#999;
  text-decoration:none;
}
.wbs-powered a:hover{
  color:var(--brandFg);
  text-decoration:underline;
}

.wbs-footer{
  display:flex;
  justify-content:center;
  gap:16px;
  align-items:center;
  border-top:1px solid var(--border);
  padding:8px 12px;
  background:#fff
}
.wbs-footer a{
  font-size:12px;
  color:#555;
  text-decoration:underline;
  cursor:pointer
}
.wbs-footer a:hover{color:var(--brandFg)}

.wbs-fade-out{animation:wbsFadeOut .6s ease forwards}
@keyframes wbsFadeOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(6px)}}
@keyframes wbsFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `;
      const style = document.createElement('style');
      style.textContent = css;

      /* --- DOM --- */
      const root = document.createElement('div');
      root.id = 'wbs-root';
      shadow.append(style, root);

      const launcher = document.createElement('button');
      launcher.id = 'wbs-launcher';
      const icon = document.createElement('img');
      icon.src = CHAT_ICON;
      const label = document.createElement('span');
      label.textContent = 'Chatta med oss';
      launcher.append(icon, label);
      root.appendChild(launcher);
      setTimeout(() => launcher.classList.add('wbs-visible'), LAUNCHER_DELAY_MS);

      const panel = c('div', 'wbs-panel');
      const header = c('div', 'wbs-header');
      const hImg = c('img');
      hImg.src = AVATAR_URL;
      const title = c('div', null, BRAND_NAME);
      const x = c('div', 'wbs-x', '×');
      header.append(hImg, title, x);

      const log = c('div', 'wbs-log');
      const chips = c('div', 'wbs-chips');
      const inpRow = c('div', 'wbs-inputrow');
      const inp = c('input');
      inp.placeholder = 'Skriv ett meddelande…';
      const send = c('button', 'wbs-send');
      send.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
      inpRow.append(inp, send);

      // Powered by-rad (mellan input och footer)
      const powered = c('div', 'wbs-powered');
      const poweredLink = c('a', null, 'Powered by Webbyrå Sigtuna');
      poweredLink.href = 'https://webbyrasigtuna.se/';
      poweredLink.target = '_blank';
      powered.appendChild(poweredLink);

      const foot = c('div', 'wbs-footer');
      const priv = c('a', null, 'Integritetspolicy');
      priv.href = PRIVACY_URL;
      priv.target = '_blank';
      const clear = c('a', null, 'Rensa chatten');

      foot.append(priv, clear);
      panel.append(header, log, chips, inpRow, powered, foot);
      root.appendChild(panel);

      /* --- CTA helper (lead magnets / bokning) --- */
      function addCTAChip(label, url) {
        chips.innerHTML = '';
        const chip = document.createElement('button');
        chip.className = 'wbs-chip wbs-chip-cta wbs-chip-anim';
        chip.textContent = label;
        chip.onclick = () => {
          window.gtag?.('event', 'wbs_chat_cta', { cta: label });
          window.plausible?.('wbs_chat_cta', { props: { cta: label } });
          window.open(url, '_blank');
        };
        chips.append(chip);
      }

      /* --- Session + memory --- */
      const SESSION_KEY = 'wbs_session_id';
      let sessionId = null;
      try {
        sessionId = localStorage.getItem(SESSION_KEY);
      } catch {
        sessionId = null;
      }
      if (!sessionId) {
        sessionId = (window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
        try { localStorage.setItem(SESSION_KEY, sessionId); } catch { }
      }

      let SAVED_LOG_KEY = 'wbs_chat_log_' + sessionId;
      let chatMemory = [];
      let replaying = false;

      try {
        const saved = localStorage.getItem(SAVED_LOG_KEY);
        if (saved) chatMemory = JSON.parse(saved) || [];
      } catch (e) {
        console.warn('[WBS] failed to parse saved log', e);
        chatMemory = [];
      }

      /* --- Chips (vanliga, neutrala) --- */
      SUGGESTIONS.forEach((q, i) => {
        const chip = c('button', 'wbs-chip wbs-chip-anim', q);
        chip.style.animationDelay = (i * CHIP_STAGGER_MS) + 'ms';
        chip.onclick = () => { inp.value = q; send.click(); };
        chips.append(chip);
      });

      /* === Enkelt Markdown/HTML-rendering (generisk, ej domänbunden) === */
function renderMarkdown(txt) {
  if (!txt) return '';

  let s = String(txt);

  // Normalisering
  s = s
    .replace(/\r\n/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-');

  // 0a) Lösa "SEOhttps://..." osv (text fastklistrad mot URL)
  s = s.replace(/([A-Za-zÅÄÖåäö])https?:\/\//g, '$1 https://');

  // 0b) Fånga alla Markdown-länkar och ta bort råa URL:er direkt efter
  (function () {
    const mdUrls = new Set();
    s.replace(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/gi, function (_m, url) {
      mdUrls.add(url);
      return _m;
    });

    mdUrls.forEach((url) => {
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\)\\s*${esc}`, 'g');
      s = s.replace(re, ')');
    });
  })();

  // ❌ 0c (Label + URL → länk) – borttagen med flit, gav felaktiga länkar

  // 1) "[Label](url) url" (samma rad eller nästa rad) → "[Label](url)"
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*(?:\r?\n)?\s*\2/g,
    '[$1]($2)'
  );

  // 2) Markdown-länkar [text](url) → HTML-länkar
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // 3) Råa URL:er → HTML-länkar (om de står som eget ord)
  //    (träffar inte i href-attribut, eftersom tecknet före inte är mellanslag/början)
  s = s.replace(/(^|\s)(https?:\/\/[^\s)]+)/g, '$1<a href="$2">$2</a>');

  // Fetstil + kursiv
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  const lines = s.split('\n');
  const out = [];
  let inUL = false;
  let inOL = false;
  let para = [];

  const flushLists = () => {
    if (inUL) { out.push('</ul>'); inUL = false; }
    if (inOL) { out.push('</ol>'); inOL = false; }
  };
  const flushPara = () => {
    if (para.length) {
      out.push('<p>' + para.join('<br>') + '</p>');
      para = [];
    }
  };

  // 👉 Här lade vi tidigare till "Läs mer" som brytpunkt – behåll det
  const BREAKS_LIST = /^(?:💡\s*)?Tips\b|(?:📰\s*)?Relaterad\s+läsning\b|Källa:|Läs mer\b/i;

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      if (inUL || inOL) {
        continue;
      }
      flushPara();
      continue;
    }

    const mUL = /^[-*•]\s+(.+)$/.exec(line);
    const mOL = /^\d+\.\s+(.+)$/.exec(line);

    if ((inUL || inOL) && BREAKS_LIST.test(line)) {
      flushLists();
      flushPara();
      out.push('<p><strong>' + line + '</strong></p>');
      continue;
    }

    if (mUL) {
      flushPara();
      if (!inUL) {
        flushLists();
        inUL = true;
        out.push('<ul>');
      }
      out.push('<li>' + mUL[1] + '</li>');
      continue;
    }

    if (mOL) {
      flushPara();
      if (!inOL) {
        flushLists();
        inOL = true;
        out.push('<ol>');
      }
      out.push('<li>' + mOL[1] + '</li>');
      continue;
    }

    para.push(line);
  }

  flushPara();
  flushLists();

  let finalOutput = out.join('\n');

  // Ta bort Markdown-rubriker (### osv) och ersätt dem med fetstil
  finalOutput = finalOutput.replace(/^#{1,6}\s+(.*)$/gm, '<strong>$1</strong>');

  return finalOutput;
  }

      /* --- Add message --- */
      let lastBotTxt = '';
      function addMsg(who, txt, persist = true) {
        if (!txt && txt !== '') return;

        if (who === 'Bot') {
          const normalized = String(txt).trim().replace(/\s+/g, ' ');
          if (normalized && normalized === lastBotTxt) return;
          lastBotTxt = normalized;
        }

        const row = c('div', 'wbs-row' + (who === 'Du' ? ' me' : ''));
        if (who === 'Bot') {
          const a = c('img', 'wbs-avatar');
          a.src = AVATAR_URL;
          row.append(a);
        }
        const bubble = c('div', 'wbs-bubble ' + (who === 'Du' ? 'user' : 'bot'));
        const name = c('div', 'wbs-name', who === 'Du' ? 'Du' : BRAND_NAME);
        const d = document.createElement('div');

        if (who === 'Bot') {
          d.innerHTML = renderMarkdown(txt);
        } else {
          d.textContent = txt;
        }

        bubble.append(name, d);
        row.append(bubble);
        log.append(row);
        log.scrollTop = log.scrollHeight;
        if (who === 'Bot') requestAnimationFrame(() => row.classList.add('wbs-fade-in'));

        if (persist && !replaying) {
          chatMemory.push({ who, txt });
          try {
            localStorage.setItem(SAVED_LOG_KEY, JSON.stringify(chatMemory));
          } catch (e) {
            console.warn('[WBS] failed to save chat log', e);
          }
        }
      }

      /* --- Restore eller första hälsning --- */
      if (chatMemory.length > 0) {
        replaying = true;
        chatMemory.forEach(({ who, txt }) => addMsg(who, txt, false));
        replaying = false;
      } else {
        addMsg('Bot', 'Hej! Vad kan jag hjälpa dig med idag?');
      }

      /* --- Open/close --- */
      function toggleLauncher(open) {
        if (open) {
          launcher.classList.add('wbs-close');
          launcher.innerHTML = '<span style="font-size:24px;margin-right:8px;">×</span><span style="font-size:14px;">Stäng chatten</span>';
        } else {
          launcher.classList.remove('wbs-close');
          launcher.innerHTML = '';
          launcher.append(icon, label);
        }
      }
      function openPanel() {
        panel.style.display = 'flex';
        panel.classList.remove('wbs-closing');
        void panel.offsetWidth;
        panel.classList.add('wbs-open');
        toggleLauncher(true);
      }
      function closePanel() {
        panel.classList.remove('wbs-open');
        panel.classList.add('wbs-closing');
        setTimeout(() => {
          panel.classList.remove('wbs-closing');
          panel.style.display = 'none';
          toggleLauncher(false);
        }, 300);
      }
      launcher.onclick = () => panel.classList.contains('wbs-open') ? closePanel() : openPanel();
      x.onclick = closePanel;

      /* --- Ask flow --- */
      let first = true;
      async function ask(m) {
        if (!m) return;
        addMsg('Du', m);

        if (first && REPLACE_CHIPS_WITH_CTA) {
          first = false;
          chips.innerHTML = '';
          const cta = c('button', 'wbs-chip wbs-chip-cta wbs-chip-anim', CTA_TEXT);
          cta.onclick = () => window.open(BOOKING_URL, '_blank');
          chips.append(cta);
        }

        const t = c('div', 'wbs-row');
        const d = c('div', 'wbs-bubble bot', '<span class="wbs-dot"></span><span class="wbs-dot"></span><span class="wbs-dot"></span>');
        const a = c('img', 'wbs-avatar');
        a.src = AVATAR_URL;
        t.append(a, d);
        log.append(t);
        log.scrollTop = log.scrollHeight;

        try {
          const payload = { message: m, sessionId };
          if (SITE_ID) payload.siteId = SITE_ID;

          const r = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await r.json().catch(() => ({ reply: '(Kunde inte tolka svar)' }));
          t.remove();
          addMsg('Bot', data.reply || '(Inget svar)');

          // Lead-intent: visa lead magnet om någon är definierad
          if (data.lead_intent && leadMagnets.length) {
            let chosen = null;

            if (data.lead_key) {
              chosen = leadMagnets.find(lm => lm.key === data.lead_key) || null;
            }
            if (!chosen) {
              chosen = leadMagnets[0];
            }

            if (chosen && chosen.url) {
              const label = chosen.label || chosen.url;
              addCTAChip(label, chosen.url);
            }
          }

          // Boknings-intent: använd primär CTA-label + URL
          if (data.booking_intent) {
            addCTAChip(bookingLabel, BOOKING_URL);
          }

        } catch (e) {
          console.error('[WBS chat] fetch error:', e);
          t.remove();
          addMsg('Bot', '(Tekniskt fel – försök igen.)');
        }
      }

      send.onclick = () => {
        const m = inp.value.trim();
        if (!m) return;
        inp.value = '';
        ask(m);
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          send.click();
        }
      });

      /* --- Clear chat --- */
      clear.onclick = () => {
        const oldKey = SAVED_LOG_KEY;

        const clearPayload = { sessionId };
        if (SITE_ID) clearPayload.siteId = SITE_ID;

        fetch('https://web-chatbot-beta.vercel.app/api/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clearPayload)
        }).catch(() => { });

        log.innerHTML = '';
        try { localStorage.removeItem(oldKey); } catch { }
        chatMemory = [];

        try { localStorage.removeItem(SESSION_KEY); } catch { }
        sessionId = (window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
        try {
          localStorage.setItem(SESSION_KEY, sessionId);
        } catch { }
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

    });
  }
})();