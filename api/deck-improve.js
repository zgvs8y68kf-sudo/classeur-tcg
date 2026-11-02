// Vercel serverless — analyse un deck existant et propose des améliorations.
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }
    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { deck = {}, cards = [] } = req.body || {};
    if (!deck.cards?.length) { res.status(400).json({ error: "no_deck" }); return; }

    const deckList  = deck.cards.map(c => `- ${c.qty}× ${c.name}${c.isPokemon?" [Pokémon]":" [Dresseur]"}`).join("\n");
    const energyList = (deck.energy||[]).map(e => `- ${e.qty}× Énergie ${e.type}`).join("\n");
    const collList  = cards.map(c => `- [${c.cardId}] ${c.name} ×${c.qty}`).join("\n");
    const total = deck.cards.reduce((s,c)=>s+(c.qty||0),0) + (deck.energy||[]).reduce((s,e)=>s+(e.qty||0),0);

    const prompt = `Tu es un expert du Pokémon TCG. Analyse ce deck et propose des améliorations précises.

NOM DU DECK : ${deck.name || "Deck"}
TOTAL ACTUEL : ${total}/60 cartes

COMPOSITION DU DECK :
${deckList}
${energyList}

COLLECTION DISPONIBLE DU JOUEUR :
${collList}

────────────────────────────────────────
MISSION : propose 4 à 6 améliorations concrètes et prioritaires.
Chaque suggestion doit :
- S'appuyer sur les cartes DE LA COLLECTION (preferred) ou des cartes communes faciles à trouver
- Expliquer en 1 phrase pourquoi c'est mieux
- Indiquer si la carte est dans la collection (owned: true) ou à se procurer (owned: false)

Types d'actions possibles :
- "add" : ajouter une carte manquante au deck
- "remove" : retirer une carte trop situationnelle ou redondante
- "increase" : augmenter la quantité d'une carte déjà présente
- "decrease" : réduire la quantité d'une carte
- "swap" : remplacer une carte par une meilleure option

JSON UNIQUEMENT :
{
  "analysis": "2-3 phrases sur les forces/faiblesses du deck",
  "suggestions": [
    {"action":"add","name":"Iono","qty":2,"reason":"Perturbation main adverse + pioche","owned":false},
    {"action":"increase","name":"Boss's Orders","from":1,"to":3,"reason":"Cibler les Pokémon de Banc vulnérables","owned":true},
    {"action":"swap","remove":"Énergie Incolore","removeQty":2,"add":"Double Turbo Energy","addQty":2,"reason":"Accélère l'énergie avec moins de coût","owned":false}
  ]
}`;

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 }
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let gemRes = null, lastErr = "";
    try {
      const endpoints = [
        { m:"gemini-3.1-flash-lite", v:"v1beta" },
        { m:"gemini-flash-latest", v:"v1beta" },
        { m:"gemini-3.5-flash-lite", v:"v1beta" },
        { m:"gemini-3.5-flash", v:"v1beta" },
      ];
      const races = endpoints.map(({m,v}) =>
        fetch(`https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${key}`,
          { method:"POST", headers:{"Content-Type":"application/json"}, body:payload, signal:ctrl.signal }
        ).then(r => r.ok ? r : Promise.reject({ status:r.status, model:m }))
      );
      gemRes = await Promise.any(races);
    } catch(e) {
      lastErr = e?.errors ? e.errors.map(x=>`${x.model}:${x.status}`).join(", ") : String(e);
    } finally { clearTimeout(timer); }

    if (!gemRes) { res.status(502).json({ error:"gemini_error", detail:lastErr.slice(0,200) }); return; }

    const data = await gemRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try { result = JSON.parse(text); } catch { result = {}; }

    res.json({
      analysis: String(result.analysis||"").trim().slice(0, 500),
      suggestions: (result.suggestions||[]).slice(0,6).map(s => ({
        action:    String(s.action||"").trim(),
        name:      String(s.name||s.add||"").trim().slice(0,60),
        remove:    s.remove ? String(s.remove).trim().slice(0,60) : undefined,
        removeQty: s.removeQty ? parseInt(s.removeQty)||1 : undefined,
        qty:       Math.min(4, Math.max(1, parseInt(s.qty||s.addQty)||1)),
        from:      s.from ? parseInt(s.from)||undefined : undefined,
        to:        s.to   ? parseInt(s.to)||undefined   : undefined,
        reason:    String(s.reason||"").trim().slice(0,200),
        owned:     !!s.owned
      }))
    });
  } catch(e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
