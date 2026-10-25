# Classeur TCG — contexte du projet

App web de gestion de collection de cartes Pokémon pour Thomas. Interface en français, mobile d'abord.

## Fonctions en place
- **Scan photo** : une photo d'une carte. Tesseract.js (OCR local, navigateur) lit le nom (haut) et le numéro (bas, ex. 136/189). L'app cherche ensuite les candidats dans TCGdex et l'utilisateur valide la bonne édition. Aucun appel externe payant.
- **Séries → extensions** avec barre de complétion. Vue classeur : cartes manquantes en gris, badge ×2/×3 pour les doubles, filtres Toutes / Possédées / Manquantes / Doubles.
- **Fiche carte** : grande image, cotes Cardmarket (tendance, moyennes 7 et 30 j, prix bas, reverse/holo), TCGplayer, liens Cardmarket / eBay ventes réussies / eBay en vente.
- **Quantités par variante** : normale, reverse, holo, 1re édition. Aussi état, langue, prix payé, note perso.
- **Gradées** : PCA, PSA, CGC, BGS, Collect Aura, avec note et valeur gradée (qui remplace la cote).
- **Tableau de bord** : valeur totale, courbe d'évolution (un point par jour d'actualisation), plus-value vs prix payé, top des cartes, ajouts récents.
- **Listes** : souhaits (♥) avec coût pour compléter, doubles à échanger, gradées.
- **Recherche** par nom, bascule FR/EN, export CSV (séparateur `;`, compatible Excel FR).

## Architecture
- `index.html` : toute l'app (HTML/CSS/JS vanilla, sans build). L'état est dans `S`, le rendu dans `render()` avec les vues `viewHome`, `viewSeries`, `viewSet`, `viewScan`, `viewSearch`, `viewLists` et la fiche `openCard`.
- **Données cartes** : API TCGdex `https://api.tcgdex.net/v2/{fr|en}`. Le catalogue (séries + extensions) est mis en cache localStorage 3 jours. Les prix viennent du champ `pricing` (Cardmarket EUR quotidien, TCGplayer USD) ; si la version FR n'a pas de prix, l'app retombe sur EN. Images : `{image}/low.webp` et `{image}/high.webp`.
- **Stockage** : objet `Store`.
  - Sans config Firebase ou sans connexion : localStorage (`ctcg_coll`, `ctcg_hist`).
  - Avec Firebase + connexion Google : Firestore `users/{uid}/cards/{cardId}` et `users/{uid}/meta/history`. Les cartes locales sont migrées vers le compte à la première connexion.
  - SDK Firebase 11.0.2 chargé en import dynamique depuis gstatic.
- **Document carte** : `{kind, cardId, setId, name, localId, image, v:{normal,reverse,holo,first}, cond, lang, paid, note, wish, grade:{co,note,value}, prices:{variante: €}, priceAt, addedAt}`.
- **Valeur** = somme (quantité × cote Cardmarket tendance de la variante). La valeur gradée remplace la cote si elle est renseignée.
- `api/scan.js` : ancienne fonction Vercel (désactivée). Le scan OCR est maintenant 100 % local via Tesseract.js (CDN cdnjs). Aucune variable d'environnement requise pour le scan.
- `firestore.rules` : chaque utilisateur ne lit et n'écrit que `users/{son uid}/**`.
- `manifest.webmanifest` + `icon.svg` : installable sur l'écran d'accueil.

## Reste à faire (côté Thomas)
1. **GitHub** : créer le dépôt `classeur-tcg` (compte zgvs8y68kf-sudo) et pousser ce dossier (`git remote add origin … && git push -u origin main`).
2. **Vercel** : importer le dépôt dans l'équipe « Thomas » (team_v8HARSIjafmyUzBJkhD3EJno), sans framework ni build.
3. **Firebase** : créer le projet, ajouter une app Web, coller la config dans `firebase-config.js`, activer Authentication > Google, créer Firestore (europe-west), coller `firestore.rules`, ajouter le domaine Vercel dans Authentication > Paramètres > Domaines autorisés.
4. **Scan** : fonctionne sans clé API — Tesseract.js tourne dans le navigateur. Pour de meilleurs résultats : bonne lumière, une carte bien cadrée, fond neutre.

## Limites connues / pistes
- eBay bloque les accès directs : pas de prix eBay chiffré, seulement des liens de recherche. Une piste serait une API tierce (pokemon-api.com, TCG Price Lookup), avec clé côté serveur.
- Cardmarket est mis à jour une fois par jour via TCGdex. Les sorties très récentes et les cartes japonaises n'ont parfois pas de cote.
- Pas de prix des cartes gradées automatique : la saisie est manuelle.
- Idées : rappel d'actualisation des prix, alertes de prix sur la liste de souhaits, classeurs personnalisés (format 9 ou 12 pochettes), mode échange entre deux collections, scan de produits scellés.
- Une version sœur existe en artifact claude.ai (même UI). Son scan passe par l'abonnement Claude au lieu de l'API ; ses données sont séparées de Firebase.
