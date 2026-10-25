# Classeur TCG

Gestion de collection de cartes Pokémon : scan photo, classement par séries avec les cartes manquantes en gris, compteur de doubles, cotes Cardmarket (via TCGdex) et liens eBay.

## Structure

- `index.html` : l'application (HTML/CSS/JS, sans build)
- `firebase-config.js` : configuration Firebase (vide = collection locale au navigateur)
- `firestore.rules` : règles de sécurité Firestore
- `api/scan.js` : fonction Vercel qui envoie la photo à Claude pour lire nom et numéro des cartes

## Mise en route

1. **Firebase** : créer un projet sur console.firebase.google.com, ajouter une application Web, copier la configuration dans `firebase-config.js`.
2. Activer **Authentication > Google** et créer une base **Firestore**, puis coller `firestore.rules` dans l'onglet Règles.
3. Dans **Authentication > Paramètres > Domaines autorisés**, ajouter le domaine Vercel du site.
4. **Vercel** : ajouter la variable `ANTHROPIC_API_KEY` (Settings > Environment Variables) puis redéployer pour activer le scan.

Données des cartes et images : [TCGdex](https://tcgdex.dev).
