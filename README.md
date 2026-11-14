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
| **Tableaux** | Colle un tableau (CSV `,` `;` ou tabulation) ou importe un `.csv` → tableau lisible dans le Journal. |
| **COROS** | Import de CSV COROS (format colonnes **ou** clé/valeur) + synchronisation API optionnelle. |
| **Stats** | Distance totale, temps, allure moyenne/meilleure, D+, km par semaine (graphique). |
| **Données** | Export JSON (sauvegarde complète), Markdown, CSV activités + import de sauvegarde. |

## Données COROS

### 1. Import de fichiers (fonctionne immédiatement)

Depuis l'app COROS ou le site web, exporte tes activités en CSV, puis :

- onglet **COROS** → « Importer CSV COROS » (ou colle le contenu).

Le parseur reconnaît automatiquement les colonnes courantes
(date, type, distance, durée, allure, FC, dénivelé, calories…) en français
comme en anglais, et calcule l'allure si elle manque.

Un fichier d'exemple est fourni : `exemple-coros.csv`.

### 2. API COROS (optionnel)

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
server.js           proxy optionnel pour l'API COROS (sans dépendance)
exemple-coros.csv   exemple d'import
```
