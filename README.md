# Journal Course à Pied 🏃

Webapp simple pour centraliser ta **course à pied** : notes, tableaux importés et
données **COROS**, le tout lisible dans un journal unique et **transférable**
(export/import JSON, Markdown, CSV).

Tout est stocké **localement dans ton navigateur** (localStorage) : aucune donnée
ne quitte ta machine sauf si tu actives la synchronisation API COROS.

## Lancer la webapp

Aucune installation nécessaire :

```bash
# option 1 — ouvrir directement le fichier
ouvrir index.html dans le navigateur

# option 2 — petit serveur local
cd coros-running-journal
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

## Fonctionnement

| Onglet | Rôle |
|---|---|
| **Journal** | Fil chronologique de tout : notes, tableaux, activités COROS. Recherche + filtres. |
| **Notes** | Saisie libre ou import de fichiers `.txt` / `.md` → arrivent dans le Journal. |
| **Tableaux** | Colle un tableau (CSV `,` `;` ou tabulation) ou importe un `.csv` → tableau lisible dans le Journal. Chaque tableau est **modifiable** (bouton « Modifier » : cellules éditables, ajout de lignes/colonnes) et **exportable en CSV** vers Numbers/Excel. |
| **COROS** | Import de CSV COROS (format colonnes **ou** clé/valeur) + synchronisation API optionnelle. |
| **Stats** | Distance totale, temps, allure moyenne/meilleure, D+, km par semaine (graphique). |
| **Données** | Export JSON (sauvegarde complète), Markdown, CSV activités + import de sauvegarde. |

## Données COROS

### 1. Import de fichiers (fonctionne immédiatement)

Depuis l'app COROS ou le site web, exporte tes activités au format **FIT**,
**TCX** ou CSV, puis :

- onglet **COROS** → « Importer fichiers COROS » (plusieurs fichiers à la fois,
  ou colle le contenu d'un CSV).

Le décodeur intégré lit le format binaire FIT (sans dépendance), le XML TCX et
les CSV (colonnes ou clé/valeur, français ou anglais), et calcule l'allure si
elle manque.

Un fichier d'exemple est fourni : `exemple-coros.csv`.

### 2. Synchronisation automatique via Strava (recommandé pour l'automatique)

L'API officielle COROS est réservée aux partenaires approuvés. La voie ouverte
aux particuliers passe par Strava :

1. Dans l'app COROS : **Réglages → Connexions → Strava** (transfert automatique de chaque activité)
2. Crée une app API gratuite sur [strava.com/settings/api](https://www.strava.com/settings/api) — Callback Domain : `localhost`
3. Lance le proxy : `node server.js`
4. Dans la webapp, onglet **COROS** → section 3 : colle ton **Client ID** et **Client Secret**, enregistre, puis « Connecter mon compte Strava » et « Synchroniser »

Tes activités Strava (donc COROS) arrivent directement dans le Journal. Les
jetons restent dans `tokens.json` sur ta machine (ignoré par git).

### 3. API COROS (optionnel)

L'API officielle nécessite un accès développeur validé par COROS
(https://open.coros.com). Une fois obtenu :

```bash
node server.js   # proxy local sur http://127.0.0.1:8787
```

Dans l'onglet **COROS** : URL du proxy `http://localhost:8787`, ton jeton
d'accès, puis « Synchroniser les activités ». Les activités remontent
directement dans le Journal.

## Transférer tes données

- **JSON** : sauvegarde complète, réimportable telle quelle (onglet Données).
- **Markdown** : journal lisible partout (Obsidian, Notion, email…).
- **CSV** : activités réutilisables dans Excel, Google Sheets, etc.

## Fichiers

```
index.html          interface
styles.css          style
app.js              logique (CSV, journal, stats, export)
fit.js              décodeur FIT (binaire) + parseur TCX, sans dépendance
server.js           proxy optionnel pour l'API COROS (sans dépendance)
exemple-coros.csv   exemple d'import
```
