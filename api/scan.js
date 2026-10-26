// Vercel serverless function — proxie vers Gemini pour lire une carte Pokémon.
// Variable d'environnement requise : GEMINI_API_KEY (Google AI Studio)
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    let imageBase64, mimeType = "image/jpeg";
    try {
      const body = req.body || {};
      imageBase64 = body.imageBase64;
      mimeType = body.mimeType || "image/jpeg";
    } catch (e) {
      res.status(400).json({ error: "body_parse_error", detail: e.message }); return;
    }
    if (!imageBase64) { res.status(400).json({ error: "no_image" }); return; }

    const prompt = `Tu regardes la photo d'une carte Pokémon.
Extrais ces informations :
- name   : le nom du Pokémon en haut de la carte (grand texte), sans stage, sans HP
- number : le numéro collecteur avant le slash, ex "036" ; "" si non visible
- total  : le total du set après le slash, ex "128" ; "" si absent
- setCode: le code d'extension ou de régulation visible près du numéro, ex "SVI" ; "" si absent

Réponds UNIQUEMENT en JSON valide avec ces 4 champs, aucun autre texte.`;

    const payload = JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageBase64 } }
      ]}],
      generationConfig: { response_mime_type: "application/json", temperature: 0 }
    });

    const models = ["gemini-3.8-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"];
    let gemRes, lastErr = "";
    for (const model of models) {
      gemRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }
      );
      if (gemRes.ok) break;
      lastErr = await gemRes.text();
      if (gemRes.status !== 503 && gemRes.status !== 404) break;
    }

    if (!gemRes.ok) {
      res.status(502).json({ error: "gemini_error", detail: lastErr.slice(0, 400) });
      return;
    }

    const data = await gemRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try { result = JSON.parse(text); }
    catch (e) { result = {}; }

    res.json({
      name:    String(result.name    || "").trim().slice(0, 60),
      number:  String(result.number  || "").replace(/\D/g, "").slice(0, 4),
      total:   String(result.total   || "").replace(/\D/g, "").slice(0, 4),
      setCode: String(result.setCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e), stack: String(e.stack || "").slice(0, 300) });
  }
}
