// Vercel serverless function : analyse une photo de carte Pokémon via vision IA.
//
// Clé GRATUITE  → OPENROUTER_API_KEY  (openrouter.ai, modèle qwen VL free)
// Clé PAYANTE   → ANTHROPIC_API_KEY   (platform.claude.com)
//
// Si les deux sont présentes, OpenRouter est utilisé en priorité.
// Modèle surchargeable via SCAN_MODEL (ex: "meta-llama/llama-3.2-11b-vision-instruct:free")

export const config = { maxDuration: 30 };

const PROMPT = `You are analyzing a Pokémon card photo.

Find these three things:
1. The card number at the bottom (e.g. "036/128", "SV-P 115/124", "TG19/TG30", "PROMO")
2. The short set code near the bottom number — 2–6 uppercase letters or digits (e.g. SVI, PAL, TEF, MEW, OBF, PAR, PRE, SSP, SFA, SCR, 151, SVP, TWM, STE, PRE, SV, BRS, ASR, LOR, CRZ, PAF, SF, DP, BW, XY, SM)
3. The Pokémon name at the top of the card

Reply ONLY with one JSON object on a single line, nothing else:
{"number":"036","total":"128","setCode":"SVI","name":"Pikachu"}

Use empty strings for anything not visible. No explanation, no markdown, just the JSON.`;

function extractResult(res, text) {
  const match = text.match(/\{[^}]*\}/);
  let result = { number: "", total: "", setCode: "", name: "" };
  try { if (match) result = { ...result, ...JSON.parse(match[0]) }; } catch {}
  result.number  = String(result.number  || "").replace(/[^A-Z0-9\-]/gi, "").toUpperCase().slice(0, 12);
  result.total   = String(result.total   || "").replace(/[^0-9]/g, "").slice(0, 5);
  result.setCode = String(result.setCode || "").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6);
  result.name    = String(result.name    || "").replace(/[^\p{L}\p{N}\s\-'\.]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  return res.status(200).json(result);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const orKey  = process.env.OPENROUTER_API_KEY || "";
  const antKey = process.env.ANTHROPIC_API_KEY  || "";
  const key      = orKey || antKey;
  const provider = orKey ? "openrouter" : (antKey ? "anthropic" : "none");

  if (req.method === "GET") {
    const prefix = key.slice(0, 14);
    return res.status(200).json({ ready: key.length > 10, len: key.length, prefix, provider, node: process.version });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!key) return res.status(501).json({ error: "no_key", message: "Ajoute OPENROUTER_API_KEY dans Vercel" });

  const { image, mediaType = "image/jpeg" } = req.body || {};
  if (!image || typeof image !== "string" || image.length > 8_000_000) {
    return res.status(400).json({ error: "bad_image" });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return res.status(400).json({ error: "bad_type" });
  }

  try {
    if (provider === "openrouter") {
      const model = process.env.SCAN_MODEL || "qwen/qwen2.5-vl-32b-instruct:free";
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${orKey}`,
          "HTTP-Referer": "https://classeur-tcg.vercel.app",
          "X-Title": "Classeur TCG",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 150,
          messages: [{ role: "user", content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } },
            { type: "text", text: PROMPT },
          ]}],
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data?.error?.message || data?.message || "";
        return res.status(502).json({ error: data?.error?.code || "upstream", message: String(msg).slice(0, 120), status: r.status });
      }
      const text = ((data.choices || [])[0]?.message?.content || "").trim();
      return extractResult(res, text);

    } else {
      // Anthropic fallback
      const model = process.env.SCAN_MODEL || "claude-3-5-haiku-20241022";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": antKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: 150,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ]}],
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data?.error?.message || "";
        return res.status(r.status === 429 ? 429 : 502).json({ error: data?.error?.type || "upstream", message: msg.slice(0, 120), status: r.status });
      }
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      return extractResult(res, text);
    }

  } catch (e) {
    return res.status(502).json({ error: "network", message: e.message });
  }
}
