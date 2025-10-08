// api/chat.js
// Serverless-funktion för Vercel (Node.js 18/20, ES Modules)

import OpenAI from "openai";

/* -------------------- CORS (apex + alla subdomäner, ej www) -------------------- */
const allowedExact = new Set([
  "https://webbyrasigtuna.se",
  // Lokal utveckling — ta gärna bort i prod:
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

// Tillåt alla subdomäner *.webbyrasigtuna.se, men blockera www.webbyrasigtuna.se
const allowedSubdomain = /^https:\/\/(?!www\.)[a-z0-9-]+\.webbyrasigtuna\.se$/i;

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const isAllowed = allowedExact.has(origin) || allowedSubdomain.test(origin);

  if (isAllowed) {
    // Eko tillbaka EXAKT origin (wildcards funkar inte i browsers)
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  // Hjälper CDN/cache att skilja på origins
  res.setHeader("Vary", "Origin");

  // Metoder & headers vi accepterar
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
/* ------------------------------------------------------------------------------ */

export default async function handler(req, res) {
  setCors(req, res);

  // Preflight för CORS
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    // Säkerställ att API-nyckel finns i Vercel → Project Settings → Environment Variables
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: "Missing OPENAI_API_KEY on server" });
      return;
    }

    // Enkla guardrails för inkommande body
    const body = req.body || {};
    const message = (body.message || "").toString().trim();
    if (!message) {
      res.status(400).json({ error: "Missing 'message' in JSON body" });
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // --- OpenAI Responses API ---
    const completion = await client.responses.create({
      model: "gpt-4o-mini", // billig & snabb för chat
      input: [
        {
          role: "system",
          content:
            "Du är en hjälpsam, saklig assistent för en svensk webbyrå. Svara koncist, tydligt och på svenska.",
        },
        { role: "user", content: message },
      ],
      max_output_tokens: 600,
    });

    const reply = completion?.output_text || "";

    // (Valfritt) Enkel intent-detektering — klienten kan lyssna på detta
    const booking_intent =
      /\b(boka|bokning|meeting|möte|konsultation|call)\b/i.test(message) ||
      /\b(boka|meeting|möte)\b/i.test(reply);

    res.status(200).json({ reply, booking_intent });
  } catch (err) {
    // Logga till Vercel Functions Logs, men exponera inte detaljer till klient
    console.error("[api/chat] error:", err);
    res.status(500).json({ error: "Server error" });
  }
}