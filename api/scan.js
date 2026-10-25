// Vercel serverless function : analyse une photo de carte Pokémon via vision IA.
//
// Clé GRATUITE  → OPENROUTER_API_KEY  (openrouter.ai, modèle qwen VL free)
// Clé PAYANTE   → ANTHROPIC_API_KEY   (platform.claude.com)
//
// Si les deux sont présentes, OpenRouter est utilisé en priorité.
// Modèle surchargeable via SCAN_MODEL (ex: "meta-llama/llama-3.2-11b-vision-instruct:free")
//
// Mode multi-cartes : POST avec multi:true dans le body → retourne un tableau.

export const config = { maxDuration: 30 };

// Prompt pour une seule carte — inspiré de pokecollector (Git-Romer/pokecollector)
// Règles clés : ne pas confondre le "No." Pokédex avec le numéro de carte,
// copier exactement les préfixes lettres (TG06/TG30, GG52/GG70, SV28/SV94).
const PROMPT = `Look at this Pokémon Trading Card Game card image.

ACCURACY RULES — read carefully:
- Only report text that is actually visible in the image.
- number_local is the small collector index near the bottom (like "094/165" or "TG06/TG30").
  NEVER use a "No. 0094" or "No.94" Pokédex reference near the artwork as number_local.
  That is the species' Pokédex number, not the collector number.
- Copy letter prefixes exactly as printed: gallery cards print numbers like "TG06/TG30",
  "GG52/GG70", "SV28/SV94", so number_local is "TG06" and number_total is "TG30".
- set_code: only return it when short alphanumeric characters are printed near the collector
  number (e.g. SVI, PAL, TEF, MEW, OBF, SSP, PRE, 151, SVP, SFA, BRS, LOR, CRZ, DP, BW, XY, SM).
  Do not infer from artwork.
- If any value is unclear, return null — never guess.

Extract:
1. Card name as printed on the card
2. Collector number (never a Pokédex "No." reference), or null
3. Printed set total/denominator, or null
4. Printed set code/abbreviation near the number, or null
5. HP value as a number, or null
6. Two-letter ISO language code of the card (fr, en, de, it, es, pt, ja, ko, zh…)
7. Regulation mark letter if visible (A–H), or null

Respond ONLY with this exact JSON on one line, no markdown, no explanation:
{"name":"Pikachu","number":"036","total":"128","setCode":"SVI","hp":60,"language":"fr","regulation":"H"}
Use null (not empty string) for missing values.`;

// Prompt composite pour une page de plusieurs cartes — inspiré de pokecollector
const MULTI_PROMPT = `This image shows multiple Pokémon Trading Card Game cards.
Identify every card visible.

Same accuracy rules as a single scan:
- number_local is the small printed collector index (like "094/165" or "TG06/TG30").
  NEVER use a "No." Pokédex reference near the artwork.
- Copy letter prefixes exactly (TG06/TG30, GG52/GG70, SV28/SV94).
- set_code: only printed alphanumeric code near the collector number, not inferred.
- Use null for any unclear value, never guess.

For each card extract: name, number, total, setCode, hp, language, regulation.

Respond ONLY with a JSON array, one object per card, no markdown, no explanation:
[{"name":"Pikachu","number":"036","total":"128","setCode":"SVI","hp":60,"language":"fr","regulation":"H"},...]`;

function sanitizeCard(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num    = String(raw.number  || "").replace(/[^A-Z0-9\-]/gi, "").toUpperCase().slice(0, 12);
  const total  = String(raw.total   || "").replace(/[^0-9TG]/gi, "").toUpperCase().slice(0, 8);
  const code   = String(raw.setCode || raw.set_code || "").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6);
  const name   = String(raw.name    || "").replace(/[^\p{L}\p{N}\s\-'\.]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  const hp     = Number.isFinite(Number(raw.hp)) && Number(raw.hp) > 0 ? Number(raw.hp) : null;
  const lang   = String(raw.language || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 2) || null;
  const reg    = String(raw.regulation || "").toUpperCase().replace(/[^A-H]/g, "").slice(0, 1) || null;
  if (!num && !name) return null;
  return { number: num, total, setCode: code, name, hp, language: lang, regulation: reg };
}

function extractSingle(res, text) {
  const match = text.match(/\{[^{}]*\}/);
  let raw = {};
  try { if (match) raw = JSON.parse(match[0]); } catch {}
  const card = sanitizeCard(raw);
  return res.status(200).json(card || { number: "", total: "", setCode: "", name: "", hp: null, language: null, regulation: null });
}

function extractMulti(res, text) {
  const match = text.match(/\[[\s\S]*\]/);
  let arr = [];
  try { if (match) arr = JSON.parse(match[0]); } catch {}
  if (!Array.isArray(arr)) arr = [];
  const cards = arr.map(sanitizeCard).filter(Boolean).slice(0, 20);
  return res.status(200).json({ cards });
}

async function callVision(provider, orKey, antKey, mediaType, image, prompt, maxTokens) {
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
        model, max_tokens: maxTokens,
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } },
          { type: "text", text: prompt },
        ]}],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || "";
      throw Object.assign(new Error(msg), { status: r.status, code: data?.error?.code || "upstream" });
    }
    return ((data.choices || [])[0]?.message?.content || "").trim();
  } else {
    const model = process.env.SCAN_MODEL || "claude-opus-5-5";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": antKey, "anthropic-version": "2026-10-21", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: prompt },
        ]}],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || "";
      throw Object.assign(new Error(msg), { status: r.status === 429 ? 429 : 502, code: data?.error?.type || "upstream" });
    }
    return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const orKey    = process.env.OPENROUTER_API_KEY || "";
  const antKey   = process.env.ANTHROPIC_API_KEY  || "";
  const key      = orKey || antKey;
  const provider = orKey ? "openrouter" : (antKey ? "anthropic" : "none");

  if (req.method === "GET") {
    const prefix = key.slice(0, 14);
    if (!key) return res.status(200).json({ ready: false, provider: "none", prefix: "", node: process.version, msg: "Aucune clé API configurée dans Vercel" });
    try {
      let testRes, testData;
      if (provider === "openrouter") {
        testRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${orKey}`, "HTTP-Referer": "https://classeur-tcg.vercel.app", "Content-Type": "application/json" },
          body: JSON.stringify({ model: process.env.SCAN_MODEL || "qwen/qwen2.5-vl-32b-instruct:free", max_tokens: 3, messages: [{ role: "user", content: "hi" }] }),
        });
        testData = await testRes.json();
      } else {
        testRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": antKey, "anthropic-version": "2026-10-21", "content-type": "application/json" },
          body: JSON.stringify({ model: process.env.SCAN_MODEL || "claude-opus-5-5", max_tokens: 3, messages: [{ role: "user", content: "hi" }] }),
        });
        testData = await testRes.json();
      }
      const ok = testRes.ok;
      const msg = !ok ? (testData?.error?.message || testData?.message || `HTTP ${testRes.status}`).slice(0, 100) : "";
      return res.status(200).json({ ready: ok, provider, prefix, node: process.version, msg });
    } catch (e) {
      return res.status(200).json({ ready: false, provider, prefix, node: process.version, msg: "Erreur réseau : " + e.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!key) return res.status(501).json({ error: "no_key", message: "Ajoute OPENROUTER_API_KEY dans Vercel" });

  const { image, mediaType = "image/jpeg", multi = false } = req.body || {};
  if (!image || typeof image !== "string" || image.length > 8_000_000) {
    return res.status(400).json({ error: "bad_image" });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return res.status(400).json({ error: "bad_type" });
  }

  try {
    const prompt   = multi ? MULTI_PROMPT : PROMPT;
    const maxTok   = multi ? 800 : 200;
    const text = await callVision(provider, orKey, antKey, mediaType, image, prompt, maxTok);
    return multi ? extractMulti(res, text) : extractSingle(res, text);
  } catch (e) {
    const status = e.status || 502;
    return res.status(status).json({ error: e.code || "upstream", message: (e.message || "").slice(0, 120), status });
  }
}
