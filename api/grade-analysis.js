// Vercel serverless function — analyse Gemini pour recommander les cartes à grader.
// Variable d'environnement requise : GEMINI_API_KEY (Google AI Studio)
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { cards = [], preferredGrader = "PSA" } = req.body || {};
    if (!cards.length) { res.status(400).json({ error: "no_cards" }); return; }

    const graderCosts = { PSA: "35€", PCA: "15€", BGS: "30€", CGC: "25€", Beckett: "30€" };
    const cost = graderCosts[preferredGrader] || "30€";

    // Liste avec le cardId explicite pour que Gemini le retourne tel quel
    const cardList = cards.map(c => `- [${c.cardId}] ${c.name} (${c.setId})${c.value > 0 ? ` : ${c.value.toFixed(2)} €` : ""}`).join("\n");

    const prompt = `Tu es un expert en cartes Pokémon et en grading (PSA, PCA, BGS, CGC).
Le collectionneur préfère envoyer ses cartes chez **${preferredGrader}** (tarif ~${cost}).
Voici sa collection de cartes Pokémon non-gradées :

${cardList}

Analyse et sélectionne celles qui valent VRAIMENT le coup d'être gradées chez ${preferredGrader}.
Critères principaux :
- Popularité du Pokémon (Pikachu, Charizard, Mewtwo, starters = forte demande)
- Édition et rareté : cartes vintage (Base Set, Fossil, Jungle, Neo), holographiques, Full Art, Alt Art
- Multiplicateur de valeur estimé après ${preferredGrader} 10 (×2 minimum pour que ce soit rentable)
- Coût du grading à déduire : ~${cost} chez ${preferredGrader} — si la carte vaut moins de 10€, c'est rarement rentable
- Priorité : "haute" = gain net probable > 50€, "moyenne" = gain net > 20€, "basse" = intéressant mais incertain
- Recommande ${preferredGrader} en premier choix, mais indique une alternative si une autre société est plus adaptée à la carte

IMPORTANT : retourne le champ "cardId" EXACTEMENT comme il apparaît entre crochets [] dans la liste ci-dessus.

Réponds UNIQUEMENT en JSON valide :
{"recommendations":[{"cardId":"id-exact-de-la-liste","name":"...","reason":"explication courte en français","priority":"haute|moyenne|basse","grader":"${preferredGrader}","multiplier":3.0}]}
Inclus seulement les cartes rentables à grader. Maximum 12 recommandations, ordonnées par priorité décroissante.`;

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let gemRes = null, lastErr = "";
    try {
      const endpoints = [
        { m:"gemini-3.6-flash", v:"v1beta" },
        { m:"gemini-3.8-flash", v:"v1beta" },
        { m:"gemini-3.1-flash-lite", v:"v1beta" },
        { m:"gemini-flash-latest", v:"v1beta" },
      ];
      const races = endpoints.map(({m,v}) =>
        fetch(
          `https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${key}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: ctrl.signal }
        ).then(r => r.ok ? r : Promise.reject({ status: r.status, model: m }))
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
