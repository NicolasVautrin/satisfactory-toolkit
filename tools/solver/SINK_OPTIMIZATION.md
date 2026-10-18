# Satisfactory Sink Points Optimization

## Ce qui a été fait

### 1. LP Solver - Maximisation des sink points (`analyzeSinkPoints.js`)

Script Node.js qui résout un problème de programmation linéaire pour maximiser les sink points/min en utilisant toutes les ressources de la map.

#### Modèle LP

- **Variables** : mines (extraction), recettes (production), sinks (destruction), générateurs (power)
- **Contraintes** :
  - Flow par item : production >= consommation (`flow_ItemClass >= 0`)
  - Limites des ressources : extraction <= max de la map (`limit_ResourceClass <= max`)
  - Power via item virtuel `PowerUnit` : les recettes/mines consomment, les générateurs produisent
  - Matières radioactives non-sinkables : flow = 0 (doivent être transformées)

#### Générateurs disponibles (le solver choisit le mix optimal)

| Type | MW | Fuel |
|------|----|------|
| Coal Generator (coal) | 75 | 15 coal/min + 45 water/min |
| Coal Generator (compacted coal) | 75 | 7.14/min + 45 water/min |
| Coal Generator (petroleum coke) | 75 | 25/min + 45 water/min |
| Fuel Generator (liquid fuel) | 250 | 20 m³/min |
| Fuel Generator (turbo fuel) | 250 | 7.5 m³/min |
| Fuel Generator (biofuel) | 250 | 20 m³/min |
| Fuel Generator (rocket fuel) | 250 | 4.167 m³/min |
| Fuel Generator (ionized fuel) | 250 | 3 m³/min |
| NPP (uranium rod) | 2500 | 0.2 rods/min + 240 water/min |
| NPP (plutonium rod) | 2500 | 0.1 rods/min + 240 water/min |
| NPP (ficsonium rod) | 2500 | 1 rod/min + 240 water/min |

#### Power modélisé via item virtuel `PowerUnit`

Pour éviter la dépendance circulaire (les recettes de fuel rod coûtent du power qui coûte des fuel rods), le power est modélisé comme un item virtuel :
- Les recettes/mines **consomment** des `PowerUnit` proportionnellement à leur MW
- Les générateurs **produisent** des `PowerUnit`
- Pas de lien direct entre fuel rod et recettes → le solver gère la circularité

#### Coût power des extracteurs

Tous les extracteurs sont surcadencés à 250 %, leurs débits comme leur consommation :
- Débits : foreuse Mk3 impur 300, normal 600, pur 1 200 /min (limite du convoyeur Mk6) ; extracteur de puits impur 75, normal 150, pur 300 m³/min.
- Consommation à 250 % = consommation à 100 % × 2,5^1,3219 (exposant `mPowerConsumptionExponent` lu en jeu), soit × 3,36 :

| Extracteur | 100 % | 250 % |
|---|---|---|
| Foreuse Mk3 | 45 MW | 151 MW |
| Extracteur de pétrole | 40 MW | 134 MW |
| Pressuriseur de puits (les extracteurs satellites ne consomment rien) | 150 MW | 504 MW |
| Extracteur d'eau (reste à 100 %) | 20 MW | — |

- Le coût MW/item extrait = consommation totale des extracteurs de la ressource / extraction_max.
- Nombres de gisements et de puits lus en jeu (6 puits d'azote, 3 de pétrole), dans `data/resourceConfig.json`.

#### Affichage des bâtiments à 250 %

Le modèle compte les générateurs à 100 %. Comme le combustible et la puissance suivent la cadence, N générateurs à 100 % = N / 2,5 bâtiments à 250 %, la règle de construction. La console, l'onglet « Full LP Optimization » et le graphe donnent les deux nombres pour les générateurs, et le nombre d'extracteurs par ressource (gisements les plus riches d'abord, extracteurs d'eau à 100 %). Les machines de production restent comptées à 100 %.

#### Solver : HiGHS (remplace javascript-lp-solver)

- `javascript-lp-solver` produit des **résultats invalides** sur les grands modèles (violations de contraintes silencieuses)
- HiGHS (via npm `highs`) : solver industriel compilé en WASM, résultats fiables
- Le modèle est converti en format CPLEX LP avant résolution

#### Quirk découvert

`javascript-lp-solver` retourne 0 si les variables de sink sont ajoutées dans l'ordre décroissant de sinkPoints. Trié en ascendant ça marche, mais les résultats restent non fiables → remplacé par HiGHS.

### 2. Résultat actuel

**295.0M sink points/min** avec :
- 1692 Fuel Generator (Rocket Fuel) à 100 %, soit 677 à 250 % → 423 GW
- 252 NPP (Uranium) à 100 %, soit 100,8 à 250 % → 630 GW
- Toutes les ressources extraites : 429 foreuses Mk3, 30 extracteurs de pétrole, 63 extracteurs de puits et 9 pressuriseurs à 250 % ; 1 903 extracteurs d'eau à 100 %.
- Extraction à 250 % : 46 GW de plus qu'avec les extracteurs comptés à 100 % (ancien résultat : 297.6M points/min, 1507 générateurs). La filière nucléaire ne change pas ; le carburant de fusée couvre l'écart.
- Items sinkés : Ballistic Warp Drive, Assembly Director System, AI Expansion Server, Plutonium Fuel Rod
- Filière nucléaire complète (waste → plutonium rod → sink)

### 3. Extraction d'un bloc : `subchain.js`

Le calcul écrit aussi sa solution complète (`sinkAnalysis_<ts>.json` : variables actives, flux par unité, noms, produit principal de chaque recette). `subchain.js` en extrait un bloc, par exemple la filière nucléaire :

```bash
node tools/solver/subchain.js tools/solver/sinkAnalysis_<ts>.json block=nuclear [json=<rapport.json>]
```

- Racines du bloc : les centrales à uranium (`npp_uranium`).
- Aval : les déchets et tout ce qui en est fait (non fissile, plutonium, barres de plutonium jusqu'au broyeur) rejoignent le bloc en entier.
- Amont : chaque entrée est demandée à ses producteurs au prorata de leur production. Un sous-produit (qui n'est pas le produit principal de sa recette) est gratuit : il n'entraîne pas sa recette dans le bloc.
- Sortie : la chaîne radioactive du hub, ce qui doit lui être livré, la chaîne d'approvisionnement (part attribuée de chaque recette du plan), les ressources brutes et l'électricité nette.

### 4. Export GraphML (yEd)

Génération d'un fichier `.graphml` compatible yEd avec :
- Nœuds colorés par type (orange=recette, gris-bleu=miner, rouge=sink, teal=byproduct, violet=NPP)
- Labels : nom du produit principal + `(alternate)` si alt
- Edges colorés par catégorie d'item (bleu=eau, rouge=nucléaire, jaune=fluides, gris=défaut)
- Layout recommandé : Hierarchic dans yEd

### 5. Données collectées

- `data/resourceConfig.json` : nombre de nodes par ressource/purity (impure/normal/pure), type de miner, coût MW
- `data/gameData.json` : toutes les recettes, items, générateurs du jeu

## Ce qu'on projette de faire

### 1. Extraire les coordonnées des resource nodes

**Problème** : les coordonnées x/y/z des 490+ resource nodes sont dans la save (parsées avec `@etothepii/satisfactory-file-parser`), mais le **type de ressource et la purity** ne sont pas dans la save — ils sont hardcodés dans les fichiers `.pak` du jeu (Unreal Engine levels).

**Pistes** :
- Extraire du `.pak` avec FModel ou UnrealPak
- Utiliser le mod FICSIT Remote Monitoring (API JSON en jeu)
- Croiser les positions de la save avec des données communautaires connues
- Scraper la carte interactive satisfactory-calculator.com (données en binaire `.raw`)

### 2. Problème d'optimisation du placement d'usines

Une fois les coordonnées obtenues, optimiser :
- **Où placer les usines** pour minimiser les distances de transport
- **Quelles ressources acheminer où** en tenant compte de la topologie de la map
- **Clustering** des nodes proches pour regrouper la production
- Contraintes de transport (belts, trains, drones) avec leurs coûts en power et throughput

### 3. Édition de save / blueprints par code

- Le parser `@etothepii/satisfactory-file-parser` parse les saves 1.0 mais **ne supporte pas les blueprints 1.0** (format version 3)
- `satisfactory-json` ne supporte pas non plus le format 1.0
- **Option viable** : modifier la save directement avec `Parser.WriteSave()` pour placer des bâtiments
- Risque : corruption de save → toujours travailler sur une copie

## Fichiers

| Fichier | Description |
|---------|-------------|
| `tools/solver/analyzeSinkPoints.js` | Script principal LP + export xlsx + graphml + json (solution) |
| `tools/solver/subchain.js` | Extraction d'un bloc de la solution (filière nucléaire) |
| `data/resourceConfig.json` | Données des nodes par ressource (counts, purity, miners) |
| `tools/solver/sinkAnalysis_*.xlsx` | Résultats d'optimisation |
| `tools/solver/sinkAnalysis_*.graphml` | Graphe de production (yEd) |
| `data/gameData.json` | Données du jeu (recettes, items, buildings) |