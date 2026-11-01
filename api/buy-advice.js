// Vercel serverless function — conseils d'achat Gemini basés sur la collection.
// Variable d'environnement requise : GEMINI_API_KEY (Google AI Studio)
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { sets = [], wished = [] } = req.body || {};
    if (!sets.length) { res.status(400).json({ error: "no_sets" }); return; }

    const setList = sets.map(s =>
      `- ${s.name} (${s.setId}) : ${s.owned}/${s.total} cartes (${s.pct}%)`
    ).join("\n");

    const wishList = wished.length
      ? "\n\nCartes déjà sur la liste de souhaits :\n" + wished.map(w => `- ${w.name} (${w.setId})`).join("\n")
      : "";

    const prompt = `Tu es un expert en cartes Pokémon et en investissement de collection.
Voici les extensions que ce collectionneur possède partiellement :

${setList}${wishList}

En te basant sur la valeur actuelle du marché Pokémon, les tendances 2024-2025 et la popularité des sets :
1. Quelles cartes manquantes vaut-il le mieux compléter en priorité ?
2. Quelles extensions incomplètes méritent d'être complétées pour leur valeur de set complet ?
3. Y a-t-il des cartes ou extensions sous-évaluées à surveiller ?

Pour chaque recommandation, indique :
- Le nom de la carte ou de l'extension
- Pourquoi c'est une bonne acquisition maintenant
- La priorité (haute/moyenne/basse)
- Une estimation de valeur si possible

IMPORTANT : Concentre-toi sur des conseils concrets et actionnables pour ce collectionneur en particulier.

Réponds UNIQUEMENT en JSON valide :
{"recommendations":[{"name":"...","setName":"...","reason":"explication courte en français","priority":"haute|moyenne|basse","estValue":"~15€ ou à partir de 8€","type":"carte|extension"}]}
Maximum 10 recommandations, ordonnées par priorité décroissante.`;

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
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
      name:     String(r.name     || "").trim().slice(0, 80),
      setName:  String(r.setName  || "").trim().slice(0, 80),
      reason:   String(r.reason   || "").trim().slice(0, 250),
      priority: ["haute","moyenne","basse"].includes(r.priority) ? r.priority : "basse",
      estValue: String(r.estValue || "").trim().slice(0, 30),
      type:     ["carte","extension"].includes(r.type) ? r.type : "carte"
    }));

    res.json({ recommendations });
  } catch(e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
