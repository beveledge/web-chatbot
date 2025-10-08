import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple chat endpoint
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "You are a helpful assistant for a Swedish digital agency." },
        { role: "user", content: userMessage },
      ],
    });

    res.json({ reply: completion.output_text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(3000, () => console.log("✅ Server running on http://localhost:3000"));