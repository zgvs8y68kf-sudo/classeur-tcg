// Vercel serverless — suggère des decks Pokémon TCG depuis la collection.
// Règles officielles TCG : 60 cartes, max 4 exemplaires d'une même carte (hors énergie de base).
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }
    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { cards = [], energy = [] } = req.body || {};
    if (!cards.length) { res.status(400).json({ error: "no_cards" }); return; }

    const cardList = cards.map(c => `- [${c.cardId}] ${c.name} (${c.setId}) ×${c.qty}`).join("\n");
    const energyList = energy.map(e => `- ${e.type}: ${e.qty} cartes`).join("\n");

    const prompt = `Tu es un expert du Pokémon TCG compétitif.
Voici la collection d'un joueur :

CARTES POSSÉDÉES :
${cardList}

CARTES ÉNERGIE DISPONIBLES :
${energyList || "Stock non précisé — suppose des énergies de base en quantité illimitée."}

RÈGLES TCG OFFICIELLES :
- Deck de 60 cartes exactement
- Maximum 4 exemplaires d'une même carte non-énergie
- Au moins 1 Pokémon de base dans la main de départ
- Catégories : Pokémon (actif + banc), Dresseurs (Objets, Supporters, Stades), Énergies
- Structure typique : 12-20 Pokémon, 25-35 Dresseurs, 10-15 Énergies

À partir de cette collection, compose 2 ou 3 decks compétitifs et cohérents.
Pour chaque deck :
1. Utilise en priorité les cartes déjà possédées
2. Indique les cartes manquantes essentielles (max 5)
3. Explique la stratégie en 2-3 phrases
4. Assure-toi que le total fait 60 cartes

IMPORTANT : retourne uniquement du JSON valide :
{"decks":[{
  "name":"Nom du deck",
  "strategy":"Stratégie en 2-3 phrases",
  "cards":[{"cardId":"id-de-la-liste-ou-vide","name":"Nom carte","qty":4,"owned":true}],
  "energy":[{"type":"Feu","qty":8}],
  "missingCards":[{"name":"Carte manquante","setName":"Extension","qty":2,"reason":"Pourquoi essentielle"}]
}]}
Maximum 3 decks. Ordonnés du plus fort au moins fort avec les cartes disponibles.`;

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let gemRes = null, lastErr = "";
    try {
      const models = ["gemini-3.1-flash-lite","gemini-3.5-flash-lite","gemini-3.6-flash","gemini-3.8-flash"];
      const races = models.map(model =>
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          { method:"POST", headers:{"Content-Type":"application/json"}, body:payload, signal:ctrl.signal }
        ).then(r => r.ok ? r : Promise.reject({ status:r.status, model }))
      );
      gemRes = await Promise.any(races);
    } catch(e) {
      if (e?.errors) lastErr = e.errors.map(x=>`${x.model||"?"}:${x.status||"?"}`).join(", ");
      else lastErr = e?.message || String(e);
    } finally { clearTimeout(timer); }

    if (!gemRes) { res.status(502).json({ error:"gemini_error", detail:lastErr.slice(0,400) }); return; }

    const data = await gemRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try { result = JSON.parse(text); } catch { result = {}; }

    const decks = (result.decks || []).slice(0, 3).map(d => ({
      name:        String(d.name || "").trim().slice(0, 60),
      strategy:    String(d.strategy || "").trim().slice(0, 400),
      cards:       (d.cards || []).slice(0, 60).map(c => ({
        cardId:  String(c.cardId || "").trim().slice(0, 40),
        name:    String(c.name   || "").trim().slice(0, 60),
        qty:     Math.min(60, Math.max(1, parseInt(c.qty) || 1)),
        owned:   !!c.owned
      })),
      energy:      (d.energy || []).map(e => ({
        type: String(e.type || "").trim().slice(0, 20),
        qty:  Math.min(30, Math.max(0, parseInt(e.qty) || 0))
      })),
      missingCards:(d.missingCards || []).slice(0, 8).map(c => ({
        name:    String(c.name    || "").trim().slice(0, 60),
        setName: String(c.setName || "").trim().slice(0, 60),
        qty:     Math.min(4, Math.max(1, parseInt(c.qty) || 1)),
        reason:  String(c.reason  || "").trim().slice(0, 150)
      }))
    }));

    res.json({ decks });
  } catch(e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
