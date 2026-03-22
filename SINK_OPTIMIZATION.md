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

#### Coût power des miners

Basé sur les vrais nombres de nodes de la map (données wiki) :
- Chaque ressource a un nombre fixe de Miner Mk3 (45 MW chacun)
- Le coût MW/item extrait = (nombre_miners × 45) / extraction_max
- Données dans `data/resourceConfig.json`

#### Solver : HiGHS (remplace javascript-lp-solver)

- `javascript-lp-solver` produit des **résultats invalides** sur les grands modèles (violations de contraintes silencieuses)
- HiGHS (via npm `highs`) : solver industriel compilé en WASM, résultats fiables
- Le modèle est converti en format CPLEX LP avant résolution

#### Quirk découvert

`javascript-lp-solver` retourne 0 si les variables de sink sont ajoutées dans l'ordre décroissant de sinkPoints. Trié en ascendant ça marche, mais les résultats restent non fiables → remplacé par HiGHS.

### 2. Résultat actuel

**297.6M sink points/min** avec :
- 1507 Fuel Generator (Rocket Fuel) → 377 GW
- 252 NPP (Uranium) → 630 GW
- Items sinkés : Ballistic Warp Drive, Assembly Director System, AI Expansion Server, Plutonium Fuel Rod
- Filière nucléaire complète (waste → plutonium rod → sink)

### 3. Export GraphML (yEd)

Génération d'un fichier `.graphml` compatible yEd avec :
- Nœuds colorés par type (orange=recette, gris-bleu=miner, rouge=sink, teal=byproduct, violet=NPP)
- Labels : nom du produit principal + `(alternate)` si alt
- Edges colorés par catégorie d'item (bleu=eau, rouge=nucléaire, jaune=fluides, gris=défaut)
- Layout recommandé : Hierarchic dans yEd

### 4. Données collectées

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
| `tools/analyzeSinkPoints.js` | Script principal LP + export xlsx + graphml |
| `data/resourceConfig.json` | Données des nodes par ressource (counts, purity, miners) |
| `tools/sinkAnalysis_*.xlsx` | Résultats d'optimisation |
| `tools/sinkAnalysis_*.graphml` | Graphe de production (yEd) |
| `data/data/gameData.json` | Données du jeu (recettes, items, buildings) |