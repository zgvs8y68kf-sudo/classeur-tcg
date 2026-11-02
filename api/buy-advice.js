// Vercel serverless — conseils d'achat précis basés sur les cartes manquantes.
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }
    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { sets = [], wished = [], lang = "fr" } = req.body || {};
    if (!sets.length) { res.status(400).json({ error: "no_sets" }); return; }

    // Liste des sets avec cartes manquantes détaillées
    const setLines = sets.map(s => {
      const missingLines = (s.missing || []).slice(0, 20)
        .map(c => `    • ${c.localId ? c.localId + " - " : ""}${c.name}${c.rarity ? " [" + c.rarity + "]" : ""}`)
        .join("\n");
      return `- ${s.name} (${s.setId}) : ${s.owned}/${s.total} cartes possédées (${s.pct}%)\n  Cartes manquantes :\n${missingLines || "    (liste indisponible)"}`;
    }).join("\n\n");

    const wishLines = wished.length
      ? "\n\nCartes déjà sur la liste de souhaits :\n" + wished.map(w => `- ${w.name}${w.localId?" n°"+w.localId:""} (${w.setId})`).join("\n")
      : "";

    const prompt = `Tu es un expert Pokémon TCG et investissement collection. Langue : ${lang === "fr" ? "français" : "anglais"}.

EXTENSIONS INCOMPLÈTES DU COLLECTIONNEUR (avec cartes manquantes) :
${setLines}${wishLines}

MISSION : recommande 8 à 10 cartes spécifiques à acheter en priorité.
Choisis parmi les cartes manquantes listées ci-dessus.
Privilégie : raretés élevées, cartes populaires, cartes qui complètent un set proche du 100%.

Pour chaque recommandation, donne :
- Le nom exact de la carte (tel qu'il apparaît dans la liste)
- Le numéro localId (tel qu'il apparaît dans la liste, ex: "045" ou "SV021")
- Le nom de l'extension (setName)
- L'identifiant du set (setId)
- La rareté
- Une raison courte et concrète (prix actuel, popularité, potentiel)
- La priorité d'achat : haute / moyenne / basse
- Une estimation de prix en euros (ex: "~3 €", "8-15 €")

JSON UNIQUEMENT :
{"recommendations":[{
  "name":"Nom exact de la carte",
  "localId":"045",
  "setName":"Nom de l'extension",
  "setId":"sv3pt5",
  "rarity":"Rare Holo",
  "reason":"Raison courte en français",
  "priority":"haute",
  "estValue":"~5 €",
  "type":"carte"
}]}`;

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
        fetch(`https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${key}`,
          { method:"POST", headers:{"Content-Type":"application/json"}, body:payload, signal:ctrl.signal }
        ).then(r => r.ok ? r : Promise.reject({ status:r.status, model:m }))
      );
      gemRes = await Promise.any(races);
    } catch(e) {
      lastErr = e?.errors ? e.errors.map(x=>`${x.model||"?"}:${x.status||"?"}`).join(", ") : String(e);
    } finally { clearTimeout(timer); }

    if (!gemRes) { res.status(502).json({ error:"gemini_error", detail:lastErr.slice(0,400) }); return; }

    const data = await gemRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try { result = JSON.parse(text); } catch { result = {}; }

    const recommendations = (result.recommendations || []).slice(0, 10).map(r => ({
      name:     String(r.name     || "").trim().slice(0, 80),
      localId:  String(r.localId  || "").trim().slice(0, 20),
      setName:  String(r.setName  || "").trim().slice(0, 80),
      setId:    String(r.setId    || "").trim().slice(0, 40),
      rarity:   String(r.rarity   || "").trim().slice(0, 40),
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
