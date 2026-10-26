// Vercel serverless function — proxie vers Gemini pour lire une carte Pokémon.
// Variable d'environnement requise : GEMINI_API_KEY (Google AI Studio)
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    let imageBase64, mimeType = "image/jpeg", mode = "card";
    try {
      const body = req.body || {};
      imageBase64 = body.imageBase64;
      mimeType = body.mimeType || "image/jpeg";
      mode = body.mode === "page" ? "page" : "card";
    } catch (e) {
      res.status(400).json({ error: "body_parse_error", detail: e.message }); return;
    }
    if (!imageBase64) { res.status(400).json({ error: "no_image" }); return; }

    const prompt = mode === "page"
      ? `Tu regardes une photo d'une page de classeur Pokémon (plusieurs cartes dans des pochettes plastiques).
Liste TOUTES les cartes visibles, de gauche à droite puis haut en bas.
Pour chaque carte extrais : name (nom du Pokémon), number (numéro avant le /), total (après le /), setCode (code extension).
Réponds UNIQUEMENT en JSON : {"cards":[{"name":"...","number":"...","total":"...","setCode":"..."},...]}
Tableau vide si aucune carte n'est identifiable.`
      : `Tu regardes la photo d'une carte Pokémon.
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

    // Race 4 modèles en parallèle : lite d'abord (plus rapide/léger), timeout 8s
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let gemRes = null, lastErr = "";
    try {
      const models = [
        "gemini-3.1-flash-lite",   // Lite GA (mai 2026) — optimisé vitesse/coût
        "gemini-3.5-flash-lite",   // autre lite
        "gemini-3.6-flash",
        "gemini-3.8-flash"
      ];
      const races = models.map(model =>
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: ctrl.signal }
        ).then(r => r.ok ? r : Promise.reject({ status: r.status, model }))
      );
      gemRes = await Promise.any(races);
    } catch(e) {
      if (e?.errors) lastErr = e.errors.map(x => `${x.model||"?"}:${x.status||"?"}`).join(", ");
      else lastErr = e?.message || String(e);
    } finally { clearTimeout(timer); }

    if (!gemRes) {
      res.status(502).json({ error: "gemini_error", detail: lastErr.slice(0, 400) });
      return;
    }

    const data = await gemRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try { result = JSON.parse(text); } catch (e) { result = {}; }

    const clean = r => ({
      name:    String(r.name    || "").trim().slice(0, 60),
      number:  String(r.number  || "").replace(/\D/g, "").slice(0, 4),
      total:   String(r.total   || "").replace(/\D/g, "").slice(0, 4),
      setCode: String(r.setCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
    });

    if (mode === "page") {
      const cards = Array.isArray(result.cards) ? result.cards : [];
      res.json({ cards: cards.slice(0, 20).map(clean) });
    } else {
      res.json(clean(result));
    }
  } catch (e) {
    res.status(500).json({ error: e.message || String(e), stack: String(e.stack || "").slice(0, 300) });
  }
}
