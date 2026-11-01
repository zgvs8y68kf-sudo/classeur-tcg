// Vercel serverless function — analyse Gemini pour recommander les cartes à grader.
// Variable d'environnement requise : GEMINI_API_KEY (Google AI Studio)
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { cards = [], threshold = 15 } = req.body || {};
    if (!cards.length) { res.status(400).json({ error: "no_cards" }); return; }

    const cardList = cards.map(c => `- ${c.name} (${c.setId}) : ${c.value.toFixed(2)} €`).join("\n");

    const prompt = `Tu es un expert en cartes Pokémon et en grading (PSA, PCA, BGS).
Voici une liste de cartes Pokémon avec leur valeur de marché actuelle (Cardmarket).
Le seuil minimum retenu est ${threshold} €.

${cardList}

Pour chaque carte, analyse si elle vaut le coup d'être gradée. Critères à considérer :
- Popularité du Pokémon (Charizard, Pikachu, Mewtwo = forte demande)
- Multiplicateur de valeur typique après grading PSA 10 (souvent ×2 à ×5 pour les cartes populaires)
- Coût du grading (~35€ PSA, ~15€ PCA) vs gain espéré
- Rareté et âge de la carte
- Priorité : "haute" si gain net > 50€ probable, "moyenne" si gain net > 20€, "basse" sinon

Réponds UNIQUEMENT en JSON valide :
{"recommendations":[{"name":"...","cardId":"...","reason":"...","priority":"haute|moyenne|basse","grader":"PSA|PCA|BGS","multiplier":2.5}]}
Inclus seulement les cartes pour lesquelles le grading est rentable. Maximum 10 recommandations.`;

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0.2 }
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let gemRes = null, lastErr = "";
    try {
      const models = [
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
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
    try { result = JSON.parse(text); } catch { result = {}; }

    const recommendations = (result.recommendations || []).slice(0, 10).map(r => ({
      name:       String(r.name     || "").trim().slice(0, 80),
      cardId:     String(r.cardId   || "").trim().slice(0, 40),
      reason:     String(r.reason   || "").trim().slice(0, 200),
      priority:   ["haute","moyenne","basse"].includes(r.priority) ? r.priority : "basse",
      grader:     ["PSA","PCA","BGS","CGC"].includes(r.grader) ? r.grader : "PSA",
      multiplier: typeof r.multiplier === "number" ? Math.round(r.multiplier * 10) / 10 : null
    }));

    res.json({ recommendations });
  } catch(e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
