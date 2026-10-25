// Vercel serverless function: analyse une photo de carte Pokémon via Claude Vision.
// Variables requises : ANTHROPIC_API_KEY (Vercel > Settings > Environment Variables)
// Variable optionnelle : SCAN_MODEL (défaut: claude-haiku-5-5 — ~0.01 $ pour 100 cartes)

export const config = { maxDuration: 30 };

const PROMPT = `You are analyzing a Pokémon card photo.

Find these three things:
1. The card number at the bottom (e.g. "036/128", "SV-P 115/124", "TG19/TG30", "PROMO")
2. The short set code near the bottom number — 2–6 uppercase letters or digits (e.g. SVI, PAL, TEF, MEW, OBF, PAR, PRE, SSP, SFA, SCR, 151, SVP, TWM, STE, PRE, SV, BRS, ASR, LOR, CRZ, PAF, SF, DP, BW, XY, SM)
3. The Pokémon name at the top of the card

Reply ONLY with one JSON object on a single line, nothing else:
{"number":"036","total":"128","setCode":"SVI","name":"Pikachu"}

Use empty strings for anything not visible. No explanation, no markdown, just the JSON.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const key = process.env.ANTHROPIC_API_KEY || "";
    const prefix = key.slice(0, 14); // "sk-ant-api03-x" vs "sk-ant-usr-1SE" — visible without exposing the full key
    return res.status(200).json({ ready: key.length > 10, len: key.length, prefix, node: process.version });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: "no_key" });

  const { image, mediaType = "image/jpeg" } = req.body || {};
  if (!image || typeof image !== "string" || image.length > 8_000_000) {
    return res.status(400).json({ error: "bad_image" });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return res.status(400).json({ error: "bad_type" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.SCAN_MODEL || "claude-haiku-5-5",
        max_tokens: 120,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const errMsg = data?.error?.message || "";
      return res.status(r.status === 429 ? 429 : 502).json({ error: data?.error?.type || "upstream", message: errMsg.slice(0, 120), status: r.status });
    }

    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const match = text.match(/\{[^}]*\}/);
    let result = { number: "", total: "", setCode: "", name: "" };
    try { if (match) result = { ...result, ...JSON.parse(match[0]) }; } catch {}

    // Normalisation
    result.number  = String(result.number  || "").replace(/[^A-Z0-9\-]/gi, "").toUpperCase().slice(0, 12);
    result.total   = String(result.total   || "").replace(/[^0-9]/g, "").slice(0, 5);
    result.setCode = String(result.setCode || "").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6);
    result.name    = String(result.name    || "").replace(/[^\p{L}\p{N}\s\-'\.]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 50);

    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: "network" });
  }
}
