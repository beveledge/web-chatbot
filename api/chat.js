import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    const { message } = req.body || {};
    if (!message) {
      res.status(400).json({ error: "Missing 'message' in body" });
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "You are a helpful assistant for a Swedish digital agency." },
        { role: "user", content: message }
      ],
    });

    res.status(200).json({ reply: completion.output_text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
}