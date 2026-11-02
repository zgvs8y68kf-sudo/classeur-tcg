// Vercel serverless — suggère des decks Pokémon TCG depuis la collection.
// Règles officielles TCG : 60 cartes, max 4 exemplaires d'une même carte (hors énergie de base).
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }
    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { cards = [], energy = [], preferredTypes = [] } = req.body || {};
    if (!cards.length) { res.status(400).json({ error: "no_cards" }); return; }

    // Index des cartes possédées pour validation post-Gemini
    const ownedById  = new Map(cards.map(c => [c.cardId, c]));
    const norm = s => String(s||"").toLowerCase().replace(/[^a-z0-9éèêëàâùûîïôœç]/g,"").trim();
    const ownedByName = new Map(cards.map(c => [norm(c.name), c]));

    // Format compact : regroupe par nom (somme des quantités), trie par qty desc
    const byName = new Map();
    for (const c of cards) {
      const key = norm(c.name);
      if (!byName.has(key)) byName.set(key, { name: c.name, cardId: c.cardId, setId: c.setId, qty: 0 });
      const e = byName.get(key);
      e.qty += c.qty;
      if (c.qty > (byName.get(key)._maxQty||0)) { e._maxQty = c.qty; e.cardId = c.cardId; e.setId = c.setId; }
    }
    const allCards = [...byName.values()].sort((a,b) => b.qty - a.qty);
    // Sans filtre de type : limiter à 80 noms pour garder le prompt court
    const filteredCards = preferredTypes.length ? allCards : allCards.slice(0, 80);
    const cardList = filteredCards.map(c => `${c.name} ×${c.qty}`).join(", ");
    const energyList = energy.map(e => `- ${e.type}: ${e.qty} cartes`).join("\n");

    const typesLine = preferredTypes.length
      ? `\nTYPES D'ÉNERGIE IMPOSÉS : ${preferredTypes.join(" + ")}\nConstruis des decks qui utilisent UNIQUEMENT ces types (+ Incolore si nécessaire).\n`
      : "";

    // Mots-clés = cartes Dresseur (pas Pokémon)
    const TRAINER_RE = /ball|belt|belt|potion|énergie|energy|professor|professeur|marnie|boss|iono|arven|nemona|penny|jacq|crispin|klara|korrina|guzma|lusamine|jesse|james|map|town|bicycle|escape|lure|fossil|cape|vest|dew|mail|timer|computer|pokédex|pokedex|binocles|potion|super|hyper|full|sac|rocher|caillou|stade|stadium|gym|cour|poing|sac de|rechargement|coupon|carte du|curiosité|éclat|lumière|grande/i;

    const prompt = `Tu es un expert du Pokémon TCG compétitif.

CARTES POSSÉDÉES PAR LE JOUEUR (format: Nom ×quantité, séparés par virgule) :
${cardList}

STOCK D'ÉNERGIES :
${energyList || "Énergies de Base disponibles en quantité illimitée pour tous les types."}
${typesLine}
════════════════════════════════════════════
LOI ABSOLUE — AUCUN POKÉMON DANS missingCards
════════════════════════════════════════════
⛔ SI LE POKÉMON PRINCIPAL N'EST PAS DANS LA LISTE CI-DESSUS → NE PAS CRÉER CE DECK.
⛔ missingCards ne doit contenir QUE des cartes Dresseur (Objets, Supporters, Stades).
⛔ AUCUN Pokémon dans missingCards — ni le principal, ni une évolution, ni un support.
⛔ Si une évolution du Pokémon-star manque, ne crée pas ce deck.

CONSÉQUENCE : si ton deck nécessite un Pokémon absent de la liste → supprime ce deck,
propose-en un autre avec un Pokémon présent.

RÈGLE DE STRUCTURE :
• missingCards = uniquement : Poké Ball, Super Ball, Professeur, Marnie, Boss, Iono,
  Objets de recherche, Énergies Spéciales. MAX 4 cartes manquantes par deck.
• Tout Pokémon dans le deck DOIT avoir owned:true ET son cardId dans la liste.

════════════════════════════════════════════
RÈGLES OFFICIELLES TCG
════════════════════════════════════════════
• 60 cartes EXACTEMENT · Max 4 copies d'une même carte non-énergie
• Énergies de Base : illimitées · Énergies Spéciales : max 4
• Au moins 1 Pokémon de Base requis · 6 cartes Récompense

STRUCTURE RECOMMANDÉE (60 cartes) :
  • ~12 Pokémon : Pokémon-star ×3-4 + support ×2-3 + pré-évolutions si nécessaire
  • ~28 Dresseurs : Supporters ×8-10 + Objets ×14-16 + Stades ×2-3
  • ~10-14 Énergies de Base

════════════════════════════════════════════
MISSION : ${preferredTypes.length ? "3 DECKS CIBLÉS" : "5 DECKS COMPLETS"}, UNIQUEMENT AVEC LES CARTES POSSÉDÉES
════════════════════════════════════════════
• Varie les archétypes (aggro, contrôle, combo) et les Pokémon-star
• Ordre : du plus jouable au moins jouable
• Pour chaque deck : vérifie que sum(cards qty) + sum(energy qty) = 60

JSON UNIQUEMENT (pas de texte avant/après) :
{"decks":[{
  "name":"Nom du deck",
  "strategy":"Stratégie en 2-3 phrases",
  "cards":[{"cardId":"id-exact","name":"Nom","qty":4,"owned":true,"isPokemon":true}],
  "energy":[{"type":"Feu","qty":10}],
  "missingCards":[{"name":"Poké Ball","setName":"Écarlate et Violet","qty":4,"reason":"Chercheur essentiel","isPokemon":false}]
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
      if (e?.errors) lastErr = e.errors.map(x=>`${x.model||"?"}:${x.status||"?"}`).join(", ");
      else lastErr = e?.message || String(e);
    } finally { clearTimeout(timer); }

    if (!gemRes) { res.status(502).json({ error:"gemini_error", detail:lastErr.slice(0,400) }); return; }

    const data = await gemRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try { result = JSON.parse(text); } catch { result = {}; }

    // ── Validation serveur ───────────────────────────────────────────────────
    function hasPokemonMissing(d) {
      for (const mc of d.missingCards || []) {
        // Gemini doit mettre isPokemon:false sur les Dresseurs
        if (mc.isPokemon === true) return true;
        // Heuristique de secours : si le nom ne ressemble pas à un Dresseur
        if (!TRAINER_RE.test(String(mc.name||""))) return true;
      }
      return false;
    }

    // Normalise un deck : résout les cardIds réels, marque owned:false si absent
    function normalizeCards(rawCards) {
      return (rawCards || []).map(c => {
        const name = String(c.name||"").trim().slice(0,60);
        const qty  = Math.min(60, Math.max(1, parseInt(c.qty)||1));
        const isPokemon = !!c.isPokemon;
        // Résolution : cardId exact d'abord, puis recherche par nom normalisé
        let real = c.cardId ? ownedById.get(String(c.cardId).trim()) : null;
        if (!real) real = ownedByName.get(norm(name));
        if (real) {
          return { cardId: real.cardId, name: real.name, qty, owned: true, isPokemon };
        }
        // Carte absente de la collection
        return { cardId: "", name, qty, owned: false, isPokemon };
      });
    }

    function hasUnownedPokemon(normalizedCards) {
      return normalizedCards.some(c => c.isPokemon && !c.owned);
    }

    const decks = (result.decks || [])
      .map(d => {
        const normalizedCards = normalizeCards(d.cards);
        return { _raw: d, normalizedCards };
      })
      .filter(({ _raw: d, normalizedCards }) =>
        !hasPokemonMissing(d) && !hasUnownedPokemon(normalizedCards)
      )
      .slice(0, 10)
      .map(({ _raw: d, normalizedCards }) => ({
        name:     String(d.name || "").trim().slice(0, 60),
        strategy: String(d.strategy || "").trim().slice(0, 400),
        cards: normalizedCards,
        energy: (d.energy || []).map(e => ({
          type: String(e.type || "").trim().slice(0, 20),
          qty:  Math.min(30, Math.max(0, parseInt(e.qty) || 0))
        })),
        missingCards: (d.missingCards || [])
          .filter(c => !c.isPokemon && TRAINER_RE.test(String(c.name||"")))
          .slice(0, 4)
          .map(c => ({
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
