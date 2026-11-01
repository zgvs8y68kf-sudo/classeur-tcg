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
${energyList || "Stock non précisé — considère toutes les Énergies de base disponibles en illimité."}

═══════════════════════════════════════════
RÈGLES OFFICIELLES POKÉMON TCG (obligatoires)
═══════════════════════════════════════════

STRUCTURE DU DECK :
• 60 cartes EXACTEMENT — ni plus, ni moins
• Maximum 4 exemplaires d'une même carte NON-ÉNERGIE (par nom)
• Énergies de Base (Feu, Eau, Plante, Foudre, Psy, Combat, Obscurité, Métal, Incolore) : ILLIMITÉES, aucune restriction de copie
• Énergies Spéciales : limitées à 4 exemplaires comme toute autre carte
• Minimum 1 Pokémon de Base dans la main de départ (main initiale = 7 cartes)
• 6 cartes Récompense mises de côté face cachée au début

CATÉGORIES (les 3 types de cartes) :
1. Pokémon : Actif (1) + Banc (5 max). Base → Stade 1 → Stade 2. Pokémon-ex/V/VMAX/VSTAR comptent comme Pokémon.
2. Dresseurs : Objets (jouables à volonté), Supporters (1 par tour), Stades (1 actif)
3. Énergies : attachez 1 Énergie par tour à votre Pokémon actif ou sur le banc

DÉROULEMENT D'UN TOUR :
1. Piocher 1 carte
2. Actions possibles (dans n'importe quel ordre) : poser des Pokémon de Base, faire évoluer, attacher 1 Énergie, jouer des cartes Dresseur, battre en retraite (payer le coût en Énergies)
3. Attaquer (met fin au tour)

CONDITIONS DE VICTOIRE :
• Prendre les 6 cartes Récompense (1 par KO adverse)
• L'adversaire ne peut pas piocher au début de son tour
• L'adversaire n'a plus aucun Pokémon en jeu

ÉTAT DU POKÉMON ACTIF :
• Empoisonné : −10 PV entre les tours
• Brûlé : −20 PV entre les tours, puis pile ou face (face = guéri, pile = reste brûlé)
• Confus : pile ou face pour attaquer (pile = 30 dégâts sur soi-même)
• Endormi : ne peut pas attaquer ni battre en retraite, pile ou face pour se réveiller
• Paralysé : ne peut pas attaquer ni battre en retraite pendant 1 tour

═══════════════════════════════════════════
CONSIGNES DE CONSTRUCTION
═══════════════════════════════════════════

Structure recommandée pour un deck de 60 cartes :
• 10-18 Pokémon (dont 4-6 Pokémon de Base, 2-4 Évolutions, éventuellement des ex/V)
• 28-36 Dresseurs (dont 8-12 Supporters, 10-16 Objets comme Poké Ball, 2-4 Stades si pertinent)
• 8-14 Énergies (de préférence majoritairement de Base pour la cohérence du type)

À partir de la collection disponible, compose 2 ou 3 decks compétitifs et cohérents.
Pour chaque deck :
1. Respecte ABSOLUMENT les 60 cartes exactement (compte chaque carte)
2. N'utilise que les quantités disponibles indiquées (×N = N exemplaires max)
3. Indique les 3-5 cartes manquantes les plus importantes pour améliorer le deck
4. Explique la stratégie en 2-3 phrases claires

IMPORTANT : retourne uniquement du JSON valide, sans texte avant ni après :
{"decks":[{
  "name":"Nom du deck (type de stratégie)",
  "strategy":"Stratégie en 2-3 phrases",
  "cards":[{"cardId":"id-de-la-liste-ou-vide","name":"Nom carte","qty":4,"owned":true}],
  "energy":[{"type":"Feu","qty":10}],
  "missingCards":[{"name":"Carte manquante","setName":"Extension","qty":2,"reason":"Pourquoi essentielle"}]
}]}

Règle de vérification : sum(cards[].qty) + sum(energy[].qty) DOIT être égale à 60.
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
