# Carte topographique et données de la map

## Carte SVG topographique

Le fichier `data/map_topo.svg` est une carte vectorielle topographique de la map Satisfactory générée programmatiquement.

### Caractéristiques

- **5000×5000 px** de viewBox
- **~14 MB** de SVG vectoriel
- **3 types de zones** : hors-map (noir), eau (bleu), continent (7 couches vertes/beiges)
- Zoomable à l'infini (vectoriel)

### Couches (ordre d'empilement)

| Ordre | Couleur   | Code      | Contenu |
|-------|-----------|-----------|---------|
| 0     | Noir      | `#111111` | Fond (hors-map) |
| 1     | Vert très foncé | `#2d5016` | Continent (base, altitude la plus basse) |
| 2     | Vert foncé | `#4a7a28` | Altitude ≥ 120 (luminance gris) |
| 3     | Vert      | `#7aa53c` | Altitude ≥ 135 |
| 4     | Vert-jaune | `#b8c95a` | Altitude ≥ 150 |
| 5     | Beige foncé | `#d4c07a` | Altitude ≥ 165 |
| 6     | Beige     | `#e8daa0` | Altitude ≥ 180 |
| 7     | Beige clair | `#f5edd0` | Altitude ≥ 195 (sommets) |
| 8     | Bleu      | `#2a7ab5` | Eau (océan + lacs + rivières, par-dessus le continent) |

### Processus de génération

1. **Source** : `data/map.jpg` — image satellite 5000×5000 du wiki (https://satisfactory.wiki.gg/images/Map.jpg)
2. **Classification des pixels** par excès de bleu (`B - (R+G)/2`) :
   - `> 10` → eau
   - `< -2` et luminance > 15 → continent
   - sinon → hors-map (noir)
3. **Seuillage** du continent à 6 niveaux de luminance (120, 135, 150, 165, 180, 195)
4. **Vectorisation** avec potrace (npm `potrace`) : chaque masque binaire (zone = noir, reste = blanc) est tracé avec `turdSize=500, optTolerance=5.0`
5. **Empilement** : continent du plus bas au plus haut, puis eau par-dessus

### Points clés pour la génération

- **Potrace trace les pixels noirs** : pour remplir une zone, mettre la zone en NOIR et le reste en BLANC
- **Ne pas utiliser `fill-rule="evenodd"`** : potrace génère un rectangle englobant dans le path, evenodd inverse le remplissage
- **L'eau du JPEG wiki** a un excès de bleu > 10 (océan `R=76 G=113 B=121`, lacs intérieurs similaires mais pas toujours bleus — certains lacs sont du même beige que le terrain)
- **Le hors-map** n'est pas que du noir RGB(0,0,0) — certains coins ont la couleur de l'océan

### Régénérer la carte

Script : `tools/generateTopoMap.js`

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
# Télécharger la source (si absente)
curl -sL -o data/map.jpg "https://satisfactory.wiki.gg/images/Map.jpg"
# Générer le SVG
node tools/generateTopoMap.js
# → data/map_topo.svg
```

Dépendances npm : `canvas`, `potrace`.

## Correspondance coordonnées jeu ↔ pixels SVG

La map SVG fait 5000×5000 px. L'axe X est décalé (la map n'est PAS centrée sur l'origine du jeu).

Calibration issue de SC-InteractiveMap (SCIM) :
- **X** : -324 698.8 → 425 301.8 (centre pixel = game X 50 301)
- **Y** : -375 000 → 375 000 (centré)

```js
const GAME_X_MIN = -324698.832031;
const GAME_X_MAX =  425301.832031;
const GAME_Y_MIN = -375000;
const GAME_Y_MAX =  375000;

function gameToPixel(gameX, gameY) {
  return {
    px: (gameX - GAME_X_MIN) / (GAME_X_MAX - GAME_X_MIN) * 5000,
    py: (gameY - GAME_Y_MIN) / (GAME_Y_MAX - GAME_Y_MIN) * 5000,
  };
}

function pixelToGame(px, py) {
  return {
    x: px / 5000 * (GAME_X_MAX - GAME_X_MIN) + GAME_X_MIN,
    y: py / 5000 * (GAME_Y_MAX - GAME_Y_MIN) + GAME_Y_MIN,
  };
}
```

## Données de la map — mapObjects.json

Le fichier `data/mapObjects.json` contient toutes les positions 3D des objets statiques de la map. Documentation complète dans `save-editing.md` section "Données du jeu".

### Accès rapide

```js
const data = require('./data/mapObjects.json');

function findMarkers(obj, depth = 0) {
  if (depth > 5) return [];
  if (obj.markers) return obj.markers;
  if (obj.options) return obj.options.flatMap(o => findMarkers(o, depth + 1));
  return [];
}

// Resource nodes (fer, cuivre, pétrole, etc.)
const resTab = data.options.find(t => t.tabId === 'resource_nodes');
const allNodes = findMarkers(resTab);
// → { pathName, x, y, z, type: 'Desc_OreCopper_C', purity: 'RP_Normal', ... }

// Filtrer par type
const copper = allNodes.filter(n => n.type === 'Desc_OreCopper_C');
const iron   = allNodes.filter(n => n.type === 'Desc_OreIron_C');
```

### Types de resource nodes

| `type` | Ressource |
|--------|-----------|
| `Desc_OreIron_C` | Fer |
| `Desc_OreCopper_C` | Cuivre |
| `Desc_OreGold_C` | Caterium |
| `Desc_Coal_C` | Charbon |
| `Desc_LiquidOil_C` | Pétrole |
| `Desc_Stone_C` | Calcaire |
| `Desc_RawQuartz_C` | Quartz |
| `Desc_OreUranium_C` | Uranium |
| `Desc_OreBauxite_C` | Bauxite |
| `Desc_Sulfur_C` | Soufre |
| `Desc_SAM_C` | SAM |
| `Desc_NitrogenGas_C` | Azote |

### Puretés

| `purity` | Débit relatif |
|----------|--------------|
| `RP_Inpure` | ×0.5 |
| `RP_Normal` | ×1.0 |
| `RP_Pure` | ×2.0 |

## Tiles du serveur satisfactory-calculator.com

La carte interactive de satisfactory-calculator.com utilise des tiles Leaflet :

```
https://static.satisfactory-calculator.com/imgMap/gameLayer/Stable/{z}/{x}/{y}.png
```

- Tiles de **256×256 px**
- Zoom levels **3 à 8** (zoom 8 = 65 536×65 536 px)
- `gameLayer` = terrain, il existe peut-être d'autres layers (`waterLayer`, `realisticLayer`)

## Superposition de données sur la carte SVG

Pour ajouter des éléments (nodes, tracés) sur la carte topo :

```js
// Ajouter des circles pour les nodes de cuivre
const copper = allNodes.filter(n => n.type === 'Desc_OreCopper_C');
let overlay = '';
for (const c of copper) {
  const { px, py } = gameToPixel(c.x, c.y);
  const color = c.purity === 'RP_Pure' ? '#FFD700' : c.purity === 'RP_Normal' ? '#FF8C00' : '#FF4444';
  overlay += `<circle cx="${px}" cy="${py}" r="15" fill="${color}" stroke="#000" stroke-width="1"/>`;
}

// Insérer avant </svg> dans data/map_topo.svg
```