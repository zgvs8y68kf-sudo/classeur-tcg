// Vercel serverless — suggère des decks Pokémon TCG depuis la collection.
// Règles officielles TCG : 60 cartes, max 4 exemplaires d'une même carte (hors énergie de base).
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).end(); return; }
    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(503).json({ error: "no_key" }); return; }

    const { cards = [], energy = [], preferredTypes = [] } = req.body || {};
    if (!cards.length) { res.status(400).json({ error: "no_cards" }); return; }

    const cardList = cards.map(c => `- [${c.cardId}] ${c.name} (${c.setId}) ×${c.qty}`).join("\n");
    const energyList = energy.map(e => `- ${e.type}: ${e.qty} cartes`).join("\n");

    const typesLine = preferredTypes.length
      ? `\nTYPES D'ÉNERGIE IMPOSÉS : ${preferredTypes.join(" + ")}\nConstruis des decks qui utilisent UNIQUEMENT ces types (+ Incolore si nécessaire pour les attaques sans couleur).\n`
      : "";

    const prompt = `Tu es un expert du Pokémon TCG compétitif chargé de construire des decks pour un collectionneur.

CARTES POSSÉDÉES PAR LE JOUEUR :
${cardList}

STOCK D'ÉNERGIES :
${energyList || "Énergies de Base disponibles en quantité illimitée pour tous les types."}
${typesLine}
════════════════════════════════════════════
RÈGLE ABSOLUE N°1 — POKÉMON PRINCIPAL POSSÉDÉ
════════════════════════════════════════════
Le Pokémon CENTRAL de chaque deck (celui qui attaque et donne le nom au deck) DOIT
être présent dans la liste des cartes possédées ci-dessus.
→ NE PROPOSE JAMAIS un deck "Charizard ex" si le joueur n'a pas Charizard.
→ NE PROPOSE JAMAIS un deck dont la pièce maîtresse est dans "missingCards".
→ Construis chaque deck autour des Pokémon-star que le joueur POSSÈDE DÉJÀ.

RÈGLE ABSOLUE N°2 — CARTES MANQUANTES = SEULEMENT DES SUPPORTS
════════════════════════════════════════════
Les seules cartes qui peuvent figurer dans missingCards sont :
  ✅ Dresseurs courants (Poké Ball, Super Ball, Pokédex, Professeur Magnolia, Marnie, Boss Orders, etc.)
  ✅ Énergies Spéciales (Double Turbo Energy, Choice Belt, etc.) si vraiment utiles
  ✅ Pokémon de base COMMUNS et peu coûteux (Bidoof, Ralts bas niveau pour alimenter une chaîne, etc.)
  ❌ JAMAIS un Pokémon-ex, V, VMAX, VSTAR, GX, EX, Full Art, Alt Art dans missingCards
  ❌ JAMAIS le Pokémon principal ou d'évolution rare dans missingCards
  ❌ JAMAIS plus de 4 cartes manquantes par deck

════════════════════════════════════════════
RÈGLES OFFICIELLES TCG (non négociables)
════════════════════════════════════════════
• 60 cartes EXACTEMENT (sum cards[] qty + sum energy[] qty = 60)
• Max 4 exemplaires d'une même carte NON-ÉNERGIE (même nom = même carte)
• Énergies de Base : ILLIMITÉES (Feu, Eau, Plante, Foudre, Psy, Combat, Obscurité, Métal, Incolore)
• Énergies Spéciales : limitées à 4 exemplaires
• Au moins 1 Pokémon de Base pour la main initiale (7 cartes)
• 6 cartes Récompense mises de côté au début
• Récompenses lors d'un KO : Pokémon normal = 1 · Pokémon-ex/GX/EX/V/VSTAR = 2 · VMAX/V-UNION/ESCOUADE = 3

STRUCTURE RECOMMANDÉE :
  • 10-16 Pokémon : 4-6 Pokémon de Base + leur(s) évolution(s) + support (Bibarel pour piocher, etc.)
  • 30-36 Dresseurs : 8-10 Supporters + 12-16 Objets (chercheurs de cartes surtout) + 2-4 Stades
  • 8-14 Énergies de Base (le minimum cohérent pour attaquer régulièrement)

════════════════════════════════════════════
MISSION : GÉNÈRE 10 DECKS DIFFÉRENTS ET COMPLETS
════════════════════════════════════════════
• Propose 10 decks variés exploitant différents Pokémon de la collection
• Chaque deck doit être compétitif et cohérent avec ses propres synergies
• Ordonne-les du plus exploitable (avec les cartes disponibles) au moins exploitable
• Varie les archétypes : aggro rapide, contrôle, combo, mill, etc.
• Si preferredTypes est défini, TOUS les decks doivent utiliser ces types

POUR CHAQUE DECK :
1. Identifie le Pokémon-star (il DOIT être possédé)
2. Construis la liste EXACTE de 60 cartes (possédées + quelques supports manquants)
3. Ne dépasse JAMAIS les quantités disponibles (×N dans la liste = max N copies)
4. Vérifie que sum(cards qty) + sum(energy qty) = 60

IMPORTANT : retourne UNIQUEMENT du JSON valide (aucun texte avant ou après) :
{"decks":[{
  "name":"Nom evocateur du deck",
  "strategy":"Stratégie en 2-3 phrases — comment gagner avec ce deck",
  "cards":[{"cardId":"id-exact-de-la-liste-ou-vide-si-manquant","name":"Nom carte","qty":4,"owned":true,"isPokemon":true}],
  "energy":[{"type":"Feu","qty":10}],
  "missingCards":[{"name":"Dresseur manquant","setName":"Écarlate et Violet","qty":4,"reason":"Chercheur de cartes essentiel"}]
}]}

Contrôle final avant de répondre : pour chaque deck, fais le total (sum cards + sum energy) = 60.`;


    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
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

    const decks = (result.decks || []).slice(0, 10).map(d => ({
      name:        String(d.name || "").trim().slice(0, 60),
      strategy:    String(d.strategy || "").trim().slice(0, 400),
      cards:       (d.cards || []).slice(0, 60).map(c => ({
        cardId:    String(c.cardId || "").trim().slice(0, 40),
        name:      String(c.name   || "").trim().slice(0, 60),
        qty:       Math.min(60, Math.max(1, parseInt(c.qty) || 1)),
        owned:     !!c.owned,
        isPokemon: !!c.isPokemon
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
