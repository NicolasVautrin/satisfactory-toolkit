# Optimisation logistique — Outils de planification

## Vue d'ensemble

Scripts d'optimisation pour planifier la logistique ferroviaire et la production à l'échelle de la map. Trois axes :

1. **Placement de gares mono-ressource** (`optimizeStations.js`) — une boucle par ressource
2. **Placement de gares multi-ressources** (`optimizeStationsMulti.js`) — gares partagées, réseau MST
3. **Sink Points** (`analyzeSinkPoints.js`) — LP solver pour maximiser les sink points/min

## 1. Placement de gares mono-ressource — `tools/optimizeStations.js`

Optimise indépendamment pour chaque ressource : nombre, position et ordre des gares en boucle.

### Principe

Pour chaque ressource (cuivre, fer, bauxite…) :
1. **K-means++** pour trouver les positions initiales des gares
2. **TSP nearest-neighbor + 2-opt** pour ordonner la boucle
3. **Simulated Annealing** pour affiner (déplacement, ajout/suppression de gares, 2-opt)
4. Scan de k=2..15 gares, sélection du k optimal par coût total

### Fonction de coût

```
coût = longueur(boucle rail) + DIST_WEIGHT × Σ dist(node, gare assignée) + STATION_COST × nb_gares + pénalités
```

### Contraintes

- **MAX_THROUGHPUT** (7700/min) : throughput max par gare (hard constraint via pénalité)
- **MIN_THROUGHPUT** (7000/min) : throughput min par gare (soft constraint, pénalité plus faible)
- **Gares fixes** : positions imposées (ex: usine de traitement), non déplaçables par le SA
- **Affectation capacitée** : les nodes sont affectés à la gare la plus proche qui a de la capacité

### Usage

```bash
node tools/optimizeStations.js [distWeight] [stationCost]
# défauts : distWeight=3, stationCost=500000
```

### Sortie

- **Console** : tableau par k, détail des gares (position, nb nodes, throughput, conv max)
- **SVG** : `data/stations.svg` — multi-layers Inkscape (1 layer par ressource + 1 layer topo)

## 2. Placement de gares multi-ressources — `tools/optimizeStationsMulti.js`

Optimise un **réseau unique** de gares partagées entre toutes les ressources, connectées en arbre (MST) avec une gare racine (Usine).

### Principe

1. **K-means++** sur tous les nodes (toutes ressources) pour les positions initiales
2. **Allocation heuristique des docks** (proportionnelle à la demande locale)
3. **Simulated Annealing** pour affiner : positions, allocation des docks, ajout/suppression de gares
4. Scan de k = minThéorique..+10, sélection du k optimal

### Modèle de gare

- Chaque gare a **4 docks** (freight platforms)
- Chaque dock = **1925 items/min** de capacité
- Les 4 docks sont répartis entre les ressources (ex: `[2Cu 1Fe 1Bx]`)
- Le SA optimise cette répartition

### Fonction de coût

```
coût = Σ_gare 2 × pathDist(gare, Usine) + DIST_WEIGHT × Σ dist(node, gare) + pénalités
```

- **pathDist** = distance à travers l'arbre MST jusqu'à la racine (Usine)
- Chaque train fait un aller-retour point-à-point vers l'Usine (bypass des gares intermédiaires)
- Les troncs partagés sont comptés N fois (une par gare du sous-arbre) → favorise les branches naturelles
- Vitesse train : **120 km/h** (200 000 UU/min)

### Contraintes

- **DOCK_THROUGHPUT** (1925/min) : capacité max par dock (hard, par ressource)
- **MIN_DOCK_LOAD** (1733/min = 90%) : utilisation min par dock utilisé (soft)
- **Gare fixe** : position de l'Usine imposée, racine de l'arbre MST
- **Affectation multi-ressource** : un node va à la gare la plus proche ayant des docks pour sa ressource

### Mutations SA

| Mutation | Probabilité | Description |
|----------|------------|-------------|
| Déplacer | 40% | Déplace une gare non-fixe |
| Réallouer dock | 25% | Transfère un dock d'une ressource à une autre |
| Supprimer | 15% | Supprime une gare non-fixe |
| Ajouter | 20% | Ajoute une gare au node le plus mal desservi |

### Configuration

```js
const RESOURCES = [
  { id: 'copper',  label: 'Cuivre',  abbr: 'Cu', type: 'Desc_OreCopper_C', color: '#00ccff' },
  { id: 'iron',    label: 'Fer',     abbr: 'Fe', type: 'Desc_OreIron_C',   color: '#ff6b6b' },
  { id: 'bauxite', label: 'Bauxite', abbr: 'Bx', type: 'Desc_OreBauxite_C', color: '#cc5de8' },
];

const FIXED_STATIONS = [
  { x: 335302, y: 45000, label: 'Usine' },
];
```

### Usage

```bash
node tools/optimizeStationsMulti.js [distWeight]
# défaut : distWeight=3
```

### Sortie

- **Console** : scan de k, SA, puis détail par gare avec allocation docks, throughput par ressource/dock, round-trip time, warnings
- **SVG** : `data/stations_multi.svg` — layers Inkscape : carte topo, réseau ferré (MST + gares), 1 layer par ressource (nodes + convoyeurs)

### Format du rapport

```
G 3 (149959, 4666) [2Cu 2Fe] Cu:3600/2dk Fe:3600/2dk total=7200/m rt=1.9min conv_max=393m
```

- `[2Cu 2Fe]` : allocation des 4 docks
- `Cu:3600/2dk` : 3600/min de cuivre sur 2 docks
- `rt=1.9min` : round-trip train vers l'Usine
- `!!` = overflow (throughput > capacité dock), `~` = under-utilisation du dock

## Référence commune

### Débits des miners (Miner Mk3, 100%)

| Pureté | Débit/min |
|--------|-----------|
| Impure | 300 |
| Normal | 600 |
| Pure | 1 200 |

### Capacité d'une gare (référence)

- **1 Freight Platform** = **1925 items/min** effectifs (1 dock)
- **4 platforms** = 7700/min (capacité max par gare)
- **1 Freight Car** = 32 stacks (ex: 3 200 items pour du minerai, stack size 100)

### Types de ressources disponibles

`Desc_OreIron_C`, `Desc_OreCopper_C`, `Desc_OreBauxite_C`, `Desc_Coal_C`, `Desc_LiquidOil_C`, `Desc_Stone_C`, `Desc_RawQuartz_C`, `Desc_OreUranium_C`, `Desc_Sulfur_C`, `Desc_SAM_C`, `Desc_NitrogenGas_C`, `Desc_OreGold_C`.

### SVG multi-layers Inkscape

Les SVG utilisent les attributs Inkscape pour créer des calques activables/désactivables :

```xml
<g inkscape:groupmode="layer" inkscape:label="Cuivre (55 nodes)" id="layer-copper">
```

Ouvrir dans Inkscape, puis `Shift+Ctrl+L` pour le panneau Calques.

### Couleurs de pureté des nodes

| Pureté | Couleur |
|--------|---------|
| Impure | Blanc `#ffffff` |
| Normal | Orange `#ee8822` |
| Pure | Rouge vif `#dd2222` |

### Calibration coordonnées jeu ↔ SVG

Calibration SCIM (SC-InteractiveMap) — l'axe X est décalé :

```js
const GAME_X_MIN = -324698.832031;  // pixel 0
const GAME_X_MAX =  425301.832031;  // pixel 5000
const GAME_Y_MIN = -375000;
const GAME_Y_MAX =  375000;
```

Conversion Inkscape → jeu :
```
gameX = inkX / 5000 × 750000.7 - 324698.8
gameY = inkY / 5000 × 750000   - 375000
```

## 2. Sink Points — `tools/analyzeSinkPoints.js`

LP solver (HiGHS) qui maximise les sink points/min avec toutes les ressources de la map.

Documentation complète dans `SINK_OPTIMIZATION.md`.

### Modèle LP

- **Variables** : mines (extraction), recettes (production), sinks (destruction), générateurs (power)
- **Contraintes** : flow par item ≥ 0, limites d'extraction, power via item virtuel `PowerUnit`
- **Solver** : HiGHS (WASM) — `javascript-lp-solver` produit des résultats invalides sur grands modèles

### Résultat actuel

**297.6M sink points/min** avec mix Fuel Generator (Rocket Fuel) + NPP (Uranium).

### Sorties

- `tools/sinkAnalysis_*.xlsx` — résultats détaillés
- `tools/sinkAnalysis_*.graphml` — graphe de production (ouvrir avec yEd, layout Hierarchic)

### Usage

```bash
node tools/analyzeSinkPoints.js
```

## 3. Layout d'usine — `data/copperFactory_map.svg`

Visualisation SVG du complexe de raffineries sur l'eau (océan est), superposé à la carte topo.

### Complexe actuel (6159 raffineries)

| Bloc | Raffineries | Étages | Rangées/ét. | Recette |
|------|------------|--------|-------------|---------|
| Alumina Solution (Sloppy) | 98 | 1 | 2 | 200 Bauxite + 200 Water → 240 Sol/m |
| Electrode Al Scrap | 130 | 1 | 2 | 180 Sol + 60 Pet Coke → 300 Scrap + 105 Water/m |
| Pure Iron Ingot | 2594 | 4 | 10 | 35 Fe Ore + 10 Water → 65 Ingot/m |
| Pure Copper Ingot | 2234 | 4 | 8 | 15 Cu Ore + 10 Water → 37.5 Ingot/m |
| Steamed Copper Sheet | 1103 | 4 | 4 | 22.5 Ingot + 22.5 Water → 22.5 Sheet/m |

### Paramètres du layout

- **70 raffineries par rangée** (840m de large)
- **12m de gap** entre rangées (cell Y = 34m)
- **Aluminium** : alternance 3 Alumina + 4 Scrap par groupe (10 groupes/rangée), plain-pied
- **Fer/Cuivre** : 4 étages (STACK_HEIGHT = 2400 UU = 24m/ét., total 96m)
- **Position** : ancré en bas à SVG (4400, 3160), s'étend vers le nord dans l'océan
- **Eau totale** : ~77 000 m³/min (609 Water Extractors)

### Machines hors eau (à placer sur terre)

| Recette | Machines | Type |
|---------|----------|------|
| Copper Powder | 115 | Constructor |
| Fused Quickwire | 528 | Assembler |
| Steel Ingot [ALT] | 262 | Foundry |
| Iron Plate | 243 | Constructor |
| Steel Pipe [ALT] | 995 | Constructor |
| Screw [ALT] | 406 | Constructor |
| + assemblers, manufacturers... | ~2000+ | Divers |

## 4. Boucle ferroviaire — `tools/optimizeCopperLoop.js`

Script historique qui optimise le tracé d'une boucle fermée passant au plus près de tous les nodes de cuivre. Remplacé par `optimizeStations.js` pour l'approche multi-ressources avec gares.

### Usage

```bash
node tools/optimizeCopperLoop.js [distWeight]
# Sortie : data/copperLoop.svg + data/copperLoop.html
```

## Fichiers

| Fichier | Description |
|---------|-------------|
| `tools/optimizeStations.js` | Placement de gares mono-ressource (boucle par ressource) |
| `tools/optimizeStationsMulti.js` | Placement de gares multi-ressources (MST, docks partagés) |
| `tools/optimizeCopperLoop.js` | Boucle ferroviaire cuivre (historique) |
| `tools/analyzeSinkPoints.js` | LP solver sink points (HiGHS) |
| `data/copperFactory_map.svg` | Layout du complexe raffineries sur la carte topo |
| `data/stations.svg` | Carte des gares mono-ressource (Inkscape) |
| `data/stations_multi.svg` | Carte des gares multi-ressources (Inkscape) |
| `data/copperLoop.svg` | Tracé boucle cuivre (historique) |
| `SINK_OPTIMIZATION.md` | Documentation détaillée du solver sink points |
| `data/mapObjects.json` | Données du jeu (nodes, items, recettes) |
| `data/resourceConfig.json` | Nodes de ressources pour le LP solver |
| `data/map_topo.svg` | Carte topo vectorielle 5000×5000 |