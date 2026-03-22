# Satisfactory Toolkit

Toolkit Node.js pour l'édition de saves, la manipulation de blueprints et l'optimisation logistique dans Satisfactory.

## Setup

Node.js est installé via nvm4w. Il faut ajouter le chemin au PATH avant d'exécuter les commandes :

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
```

## Organisation du projet

```
satisfactory-toolkit/
├── .claude/skills/satisfactory/ # Skill Claude Code (/satisfactory)
├── satisfactoryLib.js          # Lib principale (entity/component creators, spline, wiring)
├── data/
│   ├── mapObjects.json         # Positions des resource nodes, wells, slugs sur la carte
│   ├── resourceConfig.json     # Config miners/extracteurs pour le LP solver
│   ├── gameData.json           # Items, recettes, buildings du jeu
│   └── clearanceData.json      # Bounding boxes des bâtiments (généré)
├── lib/
│   ├── shared/                 # Vector3D, Quaternion, Transform, FlowPort
│   ├── extractors/             # Miner, WaterExtractor, OilPump, Fracking...
│   ├── logistic/               # ConveyorBelt/Pole/Merger, Pipe/Support/Junction...
│   ├── producers/              # Constructor, Smelter, Manufacturer...
│   ├── railway/                # BeltStation, TrainStation, Locomotive...
│   ├── structural/             # Foundation (lightweight buildables)
│   ├── Blueprint.js            # Blueprint composite (create + fromFile)
│   ├── Registry.js             # TypePath → Builder mapping
│   └── generateClearanceData.js # Générateur depuis Docs du jeu
├── tools/                      # Scripts d'édition/optimisation
├── inspect/                    # Scripts d'exploration de saves
└── test/                       # Tests des modules lib/
```

## Sink Points Optimization

Documentation complète dans [SINK_OPTIMIZATION.md](SINK_OPTIMIZATION.md).

Script : `tools/analyzeSinkPoints.js` — LP solver (HiGHS) pour maximiser les sink points/min avec contraintes de power et ressources. Génère xlsx + graphml (yEd).

## Save Editing

Les scripts manipulent les sauvegardes Satisfactory via `@etothepii/satisfactory-file-parser`. La lib partagée est `satisfactoryLib.js`.

### Clearance Data (bounding boxes)

`data/clearanceData.json` contient les bounding boxes de 495 bâtiments, extraites du `mClearanceData` des Docs du jeu. Clé = `ClassName` (ex: `Build_SmelterMk1_C`).

```js
const clearance = require('../data/clearanceData.json');
const className = typePath.split('.').pop(); // 'Build_SmelterMk1_C'
const { boxes } = clearance[className];
// boxes[0] = { min: {x,y,z}, max: {x,y,z}, type?, relativeTransform?, excludeForSnapping? }
```

Pour regénérer après une mise à jour du jeu : `node lib/generateClearanceData.js`

Les Docs du jeu sont à : `<SatisfactoryInstall>/CommunityResources/Docs/en-US.json` (format UTF-16LE avec BOM).

**Note** : Les port offsets (positions des connections belt/pipe/power) ne sont **pas** dans les Docs — ils doivent être extraits des saves via `inspect/dumpPortOffsets.js`.

### Lightweight Buildables (Satisfactory 1.0+)

Les fondations, rampes, murs, poutres, piliers et autres pièces structurelles ne sont **pas** dans `save.levels[*].objects`. Elles sont stockées dans le **Lightweight Buildable Subsystem** :

```js
const { Foundation } = require('../satisfactoryLib');
const lwSub = Foundation.getSubsystem(allObjects);

// Créer une fondation
Foundation.create(lwSub, Foundation.Types.F_8x1, x, y, z);

// Créer une grille 5x3
Foundation.createGrid(lwSub, Foundation.Types.F_8x1, cx, cy, z, 5, 3);

// Poutre peinte de 20m
Foundation.create(lwSub, Foundation.Types.BEAM_PAINTED, x, y, z, rot, { beamLength: 2000 });
```

Les instances lightweight ont un format complet : `transform`, `primaryColor`, `secondaryColor`, `usedSwatchSlot`, `usedRecipe`, `instanceSpecificData` (pour les poutres : `BeamLength`).

Pas besoin d'injecter dans `mainLevel.objects` — les lightweight sont déjà dans le subsystem.

### Positionnement des belts et pipes

Toujours prendre en compte les **ports offsets** (`SNAP_OFFSET`) des supports/poles pour positionner correctement en Z les belts ou les pipes. Les offsets sont définis dans `lib/logistic/ConveyorPole.js` et `lib/logistic/PipeSupport.js`.

**Dumper les positions/directions des ports** avant de créer quoi que ce soit, pour vérifier visuellement que les positions et orientations sont correctes.

Utiliser le **dot product** entre la direction du port de départ et celui d'arrivée pour vérifier qu'ils sont bien en opposition (dot < 0). Si les ports ne sont pas en opposition, le belt/pipe sera mal orienté.

### Map Markers (balises)

Les balises posées en jeu sont dans `FGMapManager.mMapMarkers` :

```js
const mapMgr = allObjects.find(o => o.typePath?.includes('FGMapManager'));
const markers = mapMgr.properties.mMapMarkers?.values || [];

for (const m of markers) {
  const props = m.value?.properties || {};
  const loc   = props.Location?.value?.properties;
  const name  = props.Name?.value || '';
  const icon  = props.IconID?.value;
  const x = loc.X.value, y = loc.Y.value, z = loc.Z.value;
  console.log(`(${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}) icon=${icon} "${name}"`);
}
```

Les coordonnées sont en 3D (suivent le relief). Utile pour repérer des emplacements de construction en posant une balise nommée en jeu puis en la retrouvant dans la save.

### Session ID et traçabilité

Appeler `initSession()` au début de chaque script d'édition. Cette fonction retourne un `sessionId` au format `ddMMyyHHmmss` qui est utilisé comme préfixe dans tous les `instanceName` générés (ex: `Build_ConveyorBeltMk1_C_200326223845_001`).

**Conserver le sessionId** (le logger en console) pour pouvoir retrouver les objets injectés dans la save :

```js
const sessionId = initSession();
console.log('Session:', sessionId);
// Recherche ultérieure : grep sessionId dans les instanceName de la save
```

### Test d'une édition de save

Toujours sauvegarder dans un fichier **suffixé `_edit`** par rapport à la save de départ, jamais écraser la save de référence. Exemple :

```js
const INPUT_SAV = `${GAME_SAVES}/TEST.sav`;
const OUTPUT_SAV = `${GAME_SAVES}/TEST_edit.sav`;
```
