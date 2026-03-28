# Satisfactory Toolkit

Toolkit Node.js pour l'édition de saves, la manipulation de blueprints et l'optimisation logistique dans Satisfactory.

## Setup

Node.js est installé via nvm4w. Il faut ajouter le chemin au PATH avant d'exécuter les commandes :

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
```

## Browser automation

Pour interagir avec le navigateur (console, screenshots, debug), utiliser le MCP **chrome-devtools** (`mcp__chrome-devtools__*`), PAS `claude-in-chrome`.

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

## 3D Entity Viewer

Viewer Three.js pour visualiser les entités d'une save dans le navigateur.

### Lancement

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
node viewer/server.js
# → http://localhost:3000
```

Le serveur démarre sans save — charger les fichiers `.sav` et `.cbp` via le bouton Open ou drag & drop dans le navigateur.

### Gestion du serveur

- Le serveur Express reste actif en arrière-plan tant qu'il n'est pas tué
- Pour **arrêter** le serveur : `curl -s -X POST http://localhost:3000/api/shutdown`
- Si le shutdown ne répond pas (ancienne instance) : `powershell -Command 'Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`
- Pour **redémarrer** après des modifications : d'abord shutdown/kill, attendre 1s, puis relancer
- **Important** : quand un serveur est lancé via `run_in_background`, la notification `status: completed` signifie que le monitoring s'est terminé, **pas** que le serveur s'est arrêté — le serveur continue de tourner
- Après modification de `viewer/server.js` ou de fichiers sous `viewer/lib/`, il faut **redémarrer le serveur** ET **hard reload** (Ctrl+Shift+R) dans le navigateur
- Après modification de `viewer/public/`, un simple **hard reload** suffit (pas besoin de redémarrer le serveur)
- **Relancer le serveur automatiquement** après modification de fichiers serveur — l'utilisateur a une confirmation via le tool approval
- **Ne pas supprimer les entités de test avant un restart** — le restart perd la save de toute façon, supprimer avant est inutile
- **Après le démarrage du serveur**, toujours charger la save TEST : `curl -s -X POST http://localhost:3000/api/load-file -H "Content-Type: application/json" -d '{"filePath":"C:/Users/nicolasv/AppData/Local/FactoryGame/Saved/SaveGames/76561198036887614/TEST.sav"}'`

### Contrôles caméra

Contrôles FPS custom sans librairie externe (pas d'OrbitControls/CameraControls — incompatibles avec ce viewer) :

- **Clic gauche + drag** : rotation caméra (yaw/pitch)
- **Clic gauche sans bouger** : sélection d'entité (raycaster, objet le plus proche)
- **Shift + clic gauche + drag** : sélection rectangulaire
- **Clic droit + drag** : pan (déplacement dans le plan de la caméra)
- **Molette** : zoom (avance/recule dans la direction du regard)
- **Boutons −/+** toolbar : sensibilité Zoom (flyStep), Pan, Rot

La vitesse de zoom (`flyStep`) est un pas fixe en unités, ajustable via les boutons −/+ (×2 par clic). La rotation et le pan sont gérés par des multiplicateurs de sensibilité.

### Architecture

- `viewer/server.js` : charge la save, extrait les entités/splines/clearance, sert l'API `/api/entities` et l'export `/api/export`
- `viewer/public/index.html` : rendu Three.js avec InstancedMesh, contrôles caméra FPS custom
- Entités classées en 8 catégories : Producers, Extractors, Belts, Pipes, Power, Railway, Structural, Other
- Les ConveyorLifts sont rendus comme des splines verticales (pas de clearance data)
- Les FGConveyorChainActor ne sont PAS inclus (les belts individuels Build_ConveyorBelt* ont leurs propres splines)
- Les lightweight buildables (fondations, murs, rampes) sont chargés depuis le LightweightBuildable subsystem

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
