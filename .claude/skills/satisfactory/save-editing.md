# Manipulation des Saves Satisfactory — satisfactoryLib

## Vue d'ensemble

La librairie `satisfactoryLib.js` permet de lire, modifier et écrire des sauvegardes Satisfactory via le parser `@etothepii/satisfactory-file-parser`. Elle fournit des classes pour créer tous types de bâtiments et les injecter dans une save.

## Structure d'un fichier .sav

Le parser `@etothepii/satisfactory-file-parser` produit un objet `save` avec cette structure :

```
save
├── header                          # Métadonnées (version, nom de session, durée de jeu...)
├── levels                          # Object keyed par level ID
│   ├── 'Persistent_Level'          # Level principal (la majorité des objets)
│   │   ├── objects[]               # Array de SaveEntity et SaveComponent (bâtiments, véhicules, acteurs...)
│   │   ├── collectables[]          # Array de ObjectReference — refs vers les objets déjà collectés
│   │   └── destroyedActorsMap      # Acteurs détruits (faune tuée, rochers minés...)
│   ├── '/Game/FactoryGame/...'     # Streaming sub-levels (zones géographiques UE)
│   │   ├── objects[]               #   ressources naturelles, faune de la zone
│   │   ├── collectables[]          #   refs vers collectables ramassés dans cette zone
│   │   └── destroyedActorsMap
│   └── ...                         # Autres sub-levels (un par zone de la map)
└── ...                             # Autres propriétés internes du parser
```

**`collectables[]`** : ce sont des `ObjectReference` simples (`{ levelName, pathName }`) — **pas de position 3D**. Ils référencent les objets déjà ramassés (power slugs, disques durs, Mercer spheres...). La position 3D de ces objets est codée en dur dans la map du jeu, pas dans la save.

**`objects[]`** : contient les `SaveEntity` (avec position 3D dans `transform.translation`) et les `SaveComponent` (sans position propre, rattachés à une entité parente). C'est là que se trouvent tous les bâtiments, véhicules, et acteurs du monde.

### Accès aux objets

```js
// Le level principal (contient la grande majorité des bâtiments)
const mainLevel = save.levels['Persistent_Level'];
// ou par heuristique (le plus gros level)
const mainLevel = Object.values(save.levels).find(l => l.objects?.length > 1000);

// TOUS les objets de tous les levels (pour les recherches)
const allObjects = Object.values(save.levels).flatMap(l => l.objects);
```

### SaveEntity vs SaveComponent

Les `objects[]` contiennent deux types d'objets mélangés :

#### SaveEntity — un bâtiment, véhicule ou acteur du monde

```
SaveEntity
├── typePath          # Chemin UE du blueprint (ex: '/Game/.../Build_SmelterMk1.Build_SmelterMk1_C')
├── instanceName      # Nom unique (ex: 'Persistent_Level:PersistentLevel.Build_SmelterMk1_C_123')
├── needTransform     # true pour les objets positionnés dans le monde
├── transform
│   ├── translation   # { x, y, z } — position monde (unreal units, 100 UU = 1m)
│   ├── rotation      # { x, y, z, w } — quaternion
│   └── scale3d       # { x, y, z } — échelle (généralement 1,1,1)
├── parentObject      # ref() vers le parent (BuildableSubsystem pour les bâtiments)
├── components[]      # Array de ref() vers les SaveComponent enfants
├── properties        # Object avec les propriétés spécifiques au type
│   ├── mCustomizationData    # Données de couleur/swatch
│   ├── mBuiltWithRecipe      # Recette utilisée pour construire
│   ├── mSplineData           # Spline (belts, pipes, rails)
│   ├── mConnectedComponent   # Connexion à un autre port (pipes, belts)
│   ├── mInventory            # Référence vers l'inventaire
│   ├── mPowerInfo            # Référence vers les infos électriques
│   └── ...                   # Propriétés spécifiques au type de bâtiment
├── specialProperties         # Données spéciales (trains: VehicleSpecialProperties, power: PowerLineSpecialProperties)
├── flags             # Bitfield interne
├── saveCustomVersion # Version du format de save (actuellement 52)
└── wasPlacedInLevel  # false pour les objets créés par script
```

#### SaveComponent — une sous-partie d'une entité

```
SaveComponent
├── typePath          # Type du composant (ex: '/Script/FactoryGame.FGPipeConnectionComponent')
├── instanceName      # Nom unique (ex: 'Persistent_Level:PersistentLevel.Build_X.PipelineConnection0')
├── parentEntityName  # instanceName de l'entité parente
├── properties        # Propriétés du composant
│   ├── mConnectedComponent   # Pour les connexions : ref vers l'autre port
│   ├── mConnectedComponents  # Pour les rails : array de refs (switches)
│   ├── mWires                # Pour les power connections : array de refs vers les power lines
│   ├── mFluidBox             # Pour les pipes : données de fluide
│   └── ...
├── flags
└── saveCustomVersion
```

### Relations entre objets

```
                    ┌─────────────────┐
                    │   SaveEntity    │
                    │  (ex: Smelter)  │
                    │                 │
                    │  components: [  │
                    │    ref(Input0), │
                    │    ref(Output0),│
                    │    ref(Power),  │
                    │  ]              │
                    └──┬──────┬───┬───┘
                       │      │   │
          ┌────────────┘      │   └────────────┐
          ▼                   ▼                 ▼
  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐
  │ SaveComponent │  │ SaveComponent │  │SaveComponent │
  │   Input0      │  │   Output0     │  │  PowerConn   │
  │               │  │               │  │              │
  │ mConnected    │  │ mConnected    │  │ mWires: [    │
  │ Component:    │  │ Component:    │  │  ref(line1)  │
  │  ref(belt.C1) │  │  ref(belt.C0) │  │ ]            │
  └───────────────┘  └───────────────┘  └──────────────┘
```

Les connexions sont **bidirectionnelles** : si A est connecté à B, B est aussi connecté à A.

### Conventions de nommage

- **Entité** : `Persistent_Level:PersistentLevel.{ClassName}_{Id}`
- **Composant** : `{EntityInstanceName}.{ComponentName}` (ex: `.PipelineConnection0`, `.Input0`, `.PowerConnection`)
- **Id généré par la lib** : `{sessionId}_{counter}` (ex: `200326223845_001`)

### Types de propriétés courants

| Type UE | Type JS | Exemple |
|---------|---------|---------|
| `BoolProperty` | `boolean` | `{ type: 'BoolProperty', value: true }` |
| `IntProperty` / `Int32Property` | `number` | `{ type: 'Int32Property', value: 42 }` |
| `FloatProperty` | `number` | `{ type: 'FloatProperty', value: 3.14 }` |
| `ObjectProperty` | `ref()` | `{ type: 'ObjectProperty', value: ref('path') }` |
| `TextProperty` | `string` | `{ type: 'TextProperty', value: { flags: 18, historyType: 255, value: 'nom' } }` |
| `StructProperty` | `object` | `{ type: 'StructProperty', subtype: 'Vector', value: {x,y,z} }` |
| `ArrayProperty` | `array` | `{ type: 'ObjectArrayProperty', subtype: 'ObjectProperty', values: [...] }` |
| `StructArrayProperty` | `array` | `{ type: 'StructArrayProperty', subtype: 'StructProperty', values: [...] }` |

### Unités de mesure

- **Position** : Unreal Units (UU). **100 UU = 1 mètre**
- **Rotation** : Quaternion `{x, y, z, w}`
- **Fondation 8m** : 800 UU de côté

### Recherches courantes dans la save

#### Trouver la position du joueur

```js
const playerEntity = allObjects.find(o =>
  o.typePath?.includes('Char_Player') && o.transform?.translation
);
const playerPos = playerEntity.transform.translation;
console.log(`Player: (${playerPos.x.toFixed(0)}, ${playerPos.y.toFixed(0)}, ${playerPos.z.toFixed(0)})`);
```

Le `Char_Player` est le pawn du joueur. En multijoueur, il peut y en avoir plusieurs. Si `Char_Player` n'est pas trouvé, chercher `BP_PlayerState` ou les entités avec `player` dans le typePath.

#### Trouver les fondations (regular entities)

Les anciennes fondations (pre-1.0) sont des SaveEntity classiques :

```js
const foundations = allObjects.filter(o =>
  o.typePath?.includes('Build_Foundation') && o.transform?.translation
);
// Trier par distance au joueur
const sorted = foundations.map(f => {
  const dist = new Vector3D(f.transform.translation).sub(playerPos).length;
  return { entity: f, dist };
}).sort((a, b) => a.dist - b.dist);
```

#### Trouver les fondations lightweight (Satisfactory 1.0+)

Depuis la 1.0, les fondations sont des **lightweight buildables** stockées dans un subsystem spécial, pas dans les `objects[]` :

```js
const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
const buildables = lwSub.specialProperties.buildables;

for (const b of buildables) {
  const typeName = b.typeReference.pathName.split('.').pop();
  console.log(`${typeName} x${b.instances.length}`);

  for (const inst of b.instances) {
    const pos = inst.transform.translation;
    // inst contient aussi : primaryColor, secondaryColor, usedSwatchSlot, usedRecipe
    console.log(`  (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`);
  }
}
```

#### Trouver les balises (map markers)

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

Les coordonnées sont en 3D (suivent le relief). Poser une balise nommée en jeu puis la retrouver dans la save est le moyen le plus simple pour repérer un emplacement de construction.

#### Trouver des bâtiments par type et proximité

```js
// Chercher tous les smelters à moins de 50m du joueur
const RADIUS = 50 * 100; // 50m en UU
const smelters = allObjects.filter(o => {
  if (!o.typePath?.includes('Build_SmelterMk1') || !o.transform?.translation) return false;
  return new Vector3D(o.transform.translation).sub(playerPos).length <= RADIUS;
});
```

#### Trouver un objet et ses composants

```js
// Trouver une entité
const entity = allObjects.find(o => o.instanceName === 'Persistent_Level:PersistentLevel.Build_SmelterMk1_C_123');

// Trouver ses composants
for (const compRef of entity.components) {
  const comp = allObjects.find(o => o.instanceName === compRef.pathName);
  const shortName = compRef.pathName.split('.').pop();
  const connected = comp?.properties?.mConnectedComponent?.value?.pathName || 'none';
  console.log(`  ${shortName} → ${connected}`);
}
```

## Structure d'un script type

```js
const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer, writeSaveToFile, initSession,
  Vector3D, // ... + classes nécessaires
} = require('./satisfactoryLib');  // ou '../satisfactoryLib' selon le dossier

const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/<steamId>');
const INPUT_SAV  = `${GAME_SAVES}/MA_SAVE.sav`;
const OUTPUT_SAV = `${GAME_SAVES}/MA_SAVE_edit.sav`;  // TOUJOURS suffixer _edit !

// 1. Lire la save
const buf  = readFileAsArrayBuffer(INPUT_SAV);
const save = Parser.ParseSave('MA_SAVE.sav', buf);

// 2. Accéder aux objets
const mainLevel  = Object.values(save.levels).find(l => l.objects?.length > 1000);
const allObjects = Object.values(save.levels).flatMap(l => l.objects);

// 3. Initialiser la session (obligatoire avant toute création)
const sessionId = initSession();
console.log('Session:', sessionId);  // conserver pour traçabilité

// 4. Créer des objets...
// ...

// 5. Injecter dans la save
for (const obj of newObjects) {
  mainLevel.objects.push(obj);
}

// 6. Sauvegarder
const size = writeSaveToFile(save, OUTPUT_SAV);
console.log(`Done! ${(size / 1024 / 1024).toFixed(1)} MB`);
```

## Règles fondamentales

- **Toujours appeler `initSession()`** avant de créer quoi que ce soit — génère un sessionId au format `ddMMyyHHmmss` pour traçabilité et charge les clearance data
- **Jamais écraser la save originale** — toujours suffixer `_edit`
- **Logger le sessionId** (ex: `Build_ConveyorBeltMk1_C_200326223845_001`) pour retrouver les objets injectés via grep dans la save
- **Dumper les positions/directions** avant de créer belts/pipes pour vérifier visuellement

## Fonctions de base (satisfactoryLib.js)

### I/O

| Fonction | Description |
|----------|-------------|
| `readFileAsArrayBuffer(path)` | Lit un fichier .sav en ArrayBuffer |
| `writeSaveToFile(save, path)` | Écrit la save modifiée, retourne la taille |
| `initSession()` | Initialise le sessionId et les clearance data |
| `nextId()` | Génère un ID unique `{sessionId}_{counter}` |

### Création d'entités

| Fonction | Description |
|----------|-------------|
| `makeEntity(typePath, instanceName)` | Crée un SaveEntity avec flags et parentObject par défaut |
| `makeComponent(typePath, instanceName, parentEntity, flags)` | Crée un SaveComponent |
| `ref(pathName, levelName)` | Crée une référence `{levelName, pathName}` |

### Composants

| Fonction | Description |
|----------|-------------|
| `makePipeConnection(inst, parent, networkId, connectedTo)` | Connexion pipe standard |
| `makePipeConnectionFactory(inst, parent, networkId, connectedTo, outputInv)` | Connexion pipe de bâtiment |
| `makePowerConnection(inst, parent, wireRefs)` | Connexion électrique avec câbles |
| `makePowerInfo(inst, parent, targetConsumption)` | Info de consommation électrique |
| `makeInventoryPotential(inst, parent)` | Inventaire potentiel |
| `makeCustomizationData()` | Données de customisation (swatch béton par défaut) |
| `makeRecipeProp(recipe)` | Propriété recette de construction |
| `makeFluidBox(value)` | FluidBox pour les connexions pipe |

### Splines

| Fonction | Description |
|----------|-------------|
| `makeSpline(dx, dy, dz, dirIn, dirOut)` | Crée une spline Hermite 5 points (pipes/belts) |
| `splinePoint(loc, arriveTangent, leaveTangent)` | Un point de spline |
| `wrapSplineData(points)` | Encapsule les points dans mSplineData |
| `projectOnSpline(splineValues, origin, position)` | Projette un point sur une spline existante |
| `evalHermite(p0, p1, t0, t1, t)` | Évalue un segment Hermite cubique à t∈[0,1] |
| `quatFromBasis(forward, right, up)` | Quaternion depuis une base orthonormale |

### Câblage

| Fonction | Description |
|----------|-------------|
| `wirePowerLine(powerLine, from, to)` | Câble une ligne électrique et met à jour mWires des deux côtés |

## Vector3D

Classe utilitaire pour les calculs 3D. Accepte `(x, y, z)` ou `({x, y, z})`.

```js
const v = new Vector3D(100, 200, -50);
const v2 = new Vector3D({ x: 100, y: 200, z: -50 }); // équivalent

v.add(v2)        // addition
v.sub(v2)        // soustraction
v.scale(2)       // multiplication scalaire
v.dot(v2)        // produit scalaire
v.cross(v2)      // produit vectoriel
v.length          // norme (getter)
v.norm()          // vecteur unitaire
v.rotate(quat)    // rotation complète par quaternion
v.rotateZ(quat)   // rotation Z uniquement (bâtiments à plat)
```

## FlowPort — Le système de ports

Chaque bâtiment/logistique expose ses connexions via des `FlowPort`. C'est le cœur du système de wiring.

### Types de ports

| `portType` | Usage |
|------------|-------|
| `PortType.BELT` | Conveyor belt |
| `PortType.PIPE` | Pipeline |
| `PortType.POWER` | Électricité |
| `PortType.TRACK` | Rail (TrackConnection) |

### Types de flux

| `flowType` | Direction |
|------------|-----------|
| `FlowType.INPUT` | Entrée (consomme) |
| `FlowType.OUTPUT` | Sortie (produit) |

### Méthodes

```js
// Récupérer un port
const output = miner.port('Output0');
// output.pos → position monde {x, y, z}
// output.dir → direction monde {x, y, z}
// output.component → le SaveComponent sous-jacent

// Connecter deux ports (set mConnectedComponent des deux côtés)
portA.wire(portB);

// Snapper un port sur un autre (aligne position + direction, recalcule la spline)
support.port('Top').snapTo(belt.port('ConveyorAny0'));

// Wire + snap en une opération
support.port('Top').attach(belt.port('ConveyorAny0'));

// Déconnecter
portA.detach();
```

### FlowPort.fromLayout

Construit automatiquement les ports d'un bâtiment depuis un layout déclaratif :

```js
const PORTS = {
  Output0: { offset: { x: 0, y: 800, z: 100 }, dir: { x: 0, y: 1, z: 0 }, flow: 'output', type: PortType.BELT },
  Input0:  { offset: { x: 0, y: -800, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
};
// Les offsets sont en espace local, fromLayout les transforme en coordonnées monde
this._ports = FlowPort.fromLayout(componentMap, entity.transform, PORTS);
```

## Catalogue des classes

### Extracteurs (`lib/extractors/`)

| Classe | Tiers | Ports |
|--------|-------|-------|
| `Miner` | 1, 2, 3 | `Output0` (belt) |
| `WaterExtractor` | — | ports pipe |
| `OilPump` | — | ports pipe |
| `FrackingSmasher` | — | — |
| `FrackingExtractor` | — | ports pipe |

```js
const miner = Miner.create(x, y, z, rot, { tier: 2 });
miner.port('Output0');  // FlowPort belt de sortie
miner.powerConn;        // FlowPort power
miner.allObjects();     // [entity, ...components]
```

### Producteurs (`lib/producers/`)

| Classe | Ports belt | Ports pipe |
|--------|-----------|------------|
| `Smelter` | Input0, Output0 | — |
| `Constructor` | Input0, Output0 | — |
| `Foundry` | Input0, Input1, Output0 | — |
| `Assembler` | Input0, Input1, Output0 | — |
| `Manufacturer` | Input0..3, Output0 | — |
| `Refinery` | Input0, Output0 | PipeInput0, PipeOutput0 |
| `Blender` | Input0, Input1, Output0 | PipeInput0, PipeInput1, PipeOutput0, PipeOutput1 |
| `Packager` | Input0, Output0 | PipeInput0, PipeOutput0 |
| `HadronCollider` | Input0, Input1, Output0 | — |
| `Converter` | Input0, Input1, Output0 | — |
| `QuantumEncoder` | Input0..3, Output0..1 | PipeInput0 |
| `NukePlant` | — | PipeInput0, PipeOutput0 |

Pattern commun :
```js
const machine = Constructor.create(x, y, z, rot, { tier: 1 });
machine.port('Input0');   // FlowPort belt input
machine.port('Output0');  // FlowPort belt output
machine.powerConn;        // FlowPort power
machine.allObjects();     // pour injection
```

### Logistique (`lib/logistic/`)

#### ConveyorBelt
```js
const belt = ConveyorBelt.create(
  { pos: startPos, dir: startDir },
  { pos: endPos,   dir: endDir },
  { tier: 5 },  // Mk.1 à Mk.6
);
belt.port('ConveyorAny0');  // début (output)
belt.port('ConveyorAny1');  // fin (input)
belt.recalcSpline();        // recalculer après snap
```

#### Pipe
```js
const pipe = Pipe.create(
  { pos: startPos, dir: startDir },
  { pos: endPos,   dir: endDir },
  { tier: 2 },  // Mk.1 ou Mk.2
);
pipe.port('PipelineConnection0');  // début
pipe.port('PipelineConnection1');  // fin
pipe.recalcSpline();
```

#### Supports et Poles

Les supports/poles ont des ports **sibling** (haut/bas) qui auto-wirent quand les deux sont snappés :

```js
const pole = ConveyorPole.create(x, y, z, rot);
// pole.port('Top') et pole.port('Bottom')
// Quand on snap un belt sur Top et un autre sur Bottom, ils sont auto-wirés

pole.port('Top').attach(belt1.port('ConveyorAny1'));
pole.port('Bottom').attach(belt2.port('ConveyorAny0'));
// → belt1 et belt2 sont maintenant connectés via le pole
```

**Important** : Prendre en compte le `SNAP_OFFSET` des poles/supports pour le positionnement en Z.

#### PowerLine
```js
const pl = PowerLine.create(fromPowerPort, toPowerPort);
wirePowerLine(pl, fromPowerPort, toPowerPort);
// pl.entity pour l'injection
```

#### Autres logistiques

| Classe | Description |
|--------|-------------|
| `ConveyorLift` | Élévateur de convoyeur |
| `ConveyorMerger` | Merger (3 inputs → 1 output) |
| `ConveyorSplitter` | Splitter (1 input → 3 outputs) |
| `ConveyorPoleSimple` | Pole simple (1 seul côté) |
| `PipeHole` | Trou de passage mural pipe |
| `PipeJunction` | Jonction pipe (cross) |
| `PipePump` | Pompe de pipeline |
| `PipeSupport` | Support pipe (haut/bas) |
| `PipeSupportSimple` | Support pipe simple |

### Structures (`lib/structural/`)

#### Foundation (lightweight buildables)

Depuis Satisfactory 1.0, les fondations, rampes, murs, poutres, piliers et catwalks sont des **lightweight buildables**. Ils ne sont **pas** dans `save.levels[*].objects` mais dans le **Lightweight Buildable Subsystem** (`FGLightweightBuildableSubsystem`).

Format des instances lightweight : `transform`, `primaryColor`, `secondaryColor`, `usedSwatchSlot`, `usedRecipe`, `instanceSpecificData` (poutres : `BeamLength`).

**Créer :**

```js
const { Foundation } = require('./satisfactoryLib');
const lwSub = Foundation.getSubsystem(allObjects);

Foundation.create(lwSub, Foundation.Types.F_8x1, x, y, z);
Foundation.createGrid(lwSub, Foundation.Types.F_8x1, cx, cy, z, 5, 3);
Foundation.create(lwSub, Foundation.Types.BEAM_PAINTED, x, y, z, rot, { beamLength: 2000 });
```

**Lire les existants** (voir aussi "Recherches courantes > Fondations lightweight") :

```js
const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
const buildables = lwSub.specialProperties.buildables;
// buildables[i].typeReference.pathName → type, buildables[i].instances[] → positions
```

**Pas besoin de push dans mainLevel.objects** — les lightweight sont déjà dans le subsystem.

Types disponibles :
- Fondations : `F_8x1`, `F_8x2`, `F_8x4`
- Rampes : `RAMP_8x1`, `RAMP_8x2`, `RAMP_8x4`, `RAMP_INV_8x1`, `RAMP_FRAME`
- Murs : `WALL_8x4`
- Piliers : `PILLAR_SMALL_CONCRETE`, `PILLAR_SMALL_METAL`, `PILLAR_MID_CONCRETE`
- Catwalks : `CATWALK_STAIRS`, `CATWALK_CORNER`, `CATWALK_CROSS`
- Poutres : `BEAM`, `BEAM_PAINTED`

### Railway (`lib/railway/`)

Documentation complète (orientation, docking, aiguillages, bypasses, RailroadSubsystem, checklist) dans le fichier `trains.md`, section "Création programmatique avec satisfactoryLib".

## Données du jeu — mapObjects.json

Le fichier `data/mapObjects.json` est extrait des Docs du jeu et contient toutes les positions 3D des objets de la map. C'est la seule source de coordonnées pour les objets dont la position n'est pas dans la save (collectables, resource nodes, slugs...).

Les coordonnées Z de ces markers donnent aussi une **approximation de l'altitude du terrain** à cet endroit — utile pour estimer le Z quand on veut placer un bâtiment dans une zone.

### Structure

```js
const data = require('./data/mapObjects.json');
// data.options[] — array de tabs, chacun avec des markers {x, y, z, pathName, ...}
```

### Tabs disponibles

| Tab | Markers | Champs par marker | Description |
|-----|---------|-------------------|-------------|
| `resource_nodes` | 459 | `pathName, x, y, z, type, purity, obstructed` | Nodes minables (fer, cuivre, pétrole...) |
| `resource_wells` | 149 | `pathName, x, y, z, type, purity, core` | Puits de ressources (fracking) |
| `power_slugs` | 1 242 | `pathName, x, y, z, type` | Power slugs (`green`, `yellow`, `purple`) |
| `artifacts` | 404 | `pathName, x, y, z, shrinePathName, type` | Mercer spheres, Somersloop, etc. |
| `collectibles` | 5 402 | `levelName, pathName, x, y, z, itemQuantity, itemId, itemName` | Drop pods (disques durs), objets ramassables |
| (unnamed) | 1 489 | `x, y, radius` | Zones géographiques de la map |

### Exemples d'utilisation

```js
const data = require('./data/mapObjects.json');

// Trouver tous les markers d'un tab (structure récursive : tab → options → options → markers)
function findMarkers(obj, depth = 0) {
  if (depth > 5) return [];
  if (obj.markers) return obj.markers;
  if (obj.options) return obj.options.flatMap(o => findMarkers(o, depth + 1));
  return [];
}

// Resource nodes avec coordonnées
const resTab = data.options.find(t => t.tabId === 'resource_nodes');
const allNodes = findMarkers(resTab);
// allNodes[0] = { pathName, x, y, z, type: 'Desc_OreIron_C', purity: 'RP_Normal', ... }

// Nodes non-minés dans un rayon (croiser avec la save pour trouver ceux déjà minés)
const minedNodes = new Set();
for (const obj of allObjects) {
  const res = obj.properties?.mExtractableResource;
  if (res?.value?.pathName) minedNodes.add(res.value.pathName);
}
const unmined = allNodes.filter(n => !minedNodes.has(n.pathName));

// Drop pods (disques durs) avec positions
const collTab = data.options.find(t => t.tabId === 'collectibles');
const dropPods = findMarkers(collTab);
// dropPods[0] = { pathName, x, y, z, itemQuantity, itemId, itemName, ... }

// Estimer l'altitude du terrain autour d'une position
function estimateZ(x, y, radius = 5000) {
  const nearby = allNodes.filter(n => {
    const dx = n.x - x, dy = n.y - y;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  });
  if (nearby.length === 0) return null;
  return nearby.reduce((s, n) => s + n.z, 0) / nearby.length;
}
```

### Lien avec la save

Les `pathName` des markers correspondent aux `pathName` dans la save :
- **`collectables[]`** d'un level : si un pathName y apparaît, l'objet a été ramassé
- **`mExtractableResource`** d'un Miner : référence le pathName du node miné
- Permet de croiser les données de la map avec l'état de la save (quels nodes sont minés, quels slugs ramassés, etc.)

## Clearance Data (bounding boxes)

`data/clearanceData.json` — bounding boxes de 495 bâtiments, extraites du `mClearanceData` des Docs du jeu. Clé = `ClassName` (ex: `Build_SmelterMk1_C`).

```js
const clearance = require('./data/clearanceData.json');
const className = typePath.split('.').pop(); // 'Build_SmelterMk1_C'
const { boxes } = clearance[className];
// boxes[0] = { min: {x,y,z}, max: {x,y,z}, type?, relativeTransform?, excludeForSnapping? }
```

Regénérer après mise à jour du jeu : `node lib/generateClearanceData.js`

Les Docs du jeu sont à : `<SatisfactoryInstall>/CommunityResources/Docs/en-US.json` (format UTF-16LE avec BOM).

**Note** : Les port offsets (positions des connections belt/pipe/power) ne sont **pas** dans les Docs — ils doivent être extraits des saves via `inspect/dumpPortOffsets.js`.

## Viewer 3D (Three.js)

Viewer interactif pour visualiser les entités d'une save en 3D et exporter des sélections en blueprint.

### Lancement

```bash
node viewer/server.js <save-name>
# ex: node viewer/server.js TEST
# → http://localhost:3000
```

### Architecture

```
viewer/
├── server.js         # Express: charge la save, API JSON, export blueprint
└── public/
    └── index.html    # Three.js viewer (InstancedMesh + GPU picking)
```

### Fonctionnalités

- **Rendu 3D** : bâtiments en clearance boxes, splines pour belts/pipes/rails (Hermite cubique)
- **InstancedMesh** : ~60k entités rendues efficacement (16 meshes : 8 catégories × 2 types box/spline)
- **GPU picking** : sélection par clic (readPixels) — encode l'index entité en couleur RGB
- **Box selection** : Shift+drag pour sélectionner par rectangle
- **Catégories filtrables** : Producers, Extractors, Belts, Pipes, Power, Railway, Structural, Other
- **Export blueprint** : sélection → POST /api/export → crée .sbp + .sbpcfg au centroid de la sélection

### Contrôles

| Action | Contrôle |
|--------|----------|
| Orbite | Clic gauche + drag |
| Pan | Clic droit ou clic molette + drag |
| Zoom | Molette |
| Sélection simple | Clic gauche sur entité |
| Sélection additive | Ctrl + clic |
| Sélection rectangle | Shift + drag |
| Sliders | Zoom / Rotate / Pan sensibilité dans la toolbar |

### API serveur

- `GET /api/entities` — données des entités (classNames dédupliqués, clearance par className, spline points échantillonnés)
- `POST /api/export` — `{ indices: number[], name: string }` → crée blueprint au centroid de la sélection

## Positionnement et rotations

### Quaternions courants

| Rotation | Quaternion |
|----------|------------|
| Identité (face +X) | `{ x: 0, y: 0, z: 0, w: 1 }` |
| 90° autour de Z | `{ x: 0, y: 0, z: 0.7071, w: 0.7071 }` |
| 180° autour de Z | `{ x: 0, y: 0, z: 1, w: 0 }` |
| 270° autour de Z | `{ x: 0, y: 0, z: -0.7071, w: 0.7071 }` |

### Positionnement des belts et pipes

Toujours prendre en compte les **port offsets** (`SNAP_OFFSET`) des supports/poles pour positionner correctement en Z les belts ou les pipes. Les offsets sont définis dans `lib/logistic/ConveyorPole.js` et `lib/logistic/PipeSupport.js`.

**Dumper les positions/directions des ports** avant de créer quoi que ce soit, pour vérifier visuellement que les positions et orientations sont correctes.

### Vérification des connexions (dot product)

Toujours vérifier que les ports sont en opposition avant de connecter des belts/pipes :

```js
const dot = dirA.dot(dirB);
// dot < 0 → ports en opposition → OK
// dot > 0 → ports dans le même sens → ERREUR, le belt sera inversé
```

## Injection et collecte des objets

Chaque classe expose `allObjects()` qui retourne tous les SaveEntity + SaveComponent à injecter :

```js
const objs = [
  ...miner.allObjects(),
  ...belt.allObjects(),
  ...pole.allObjects(),
  pl.entity,  // PowerLine n'a pas de méthode allObjects standard
];

for (const obj of objs) {
  mainLevel.objects.push(obj);
}
```

**Exception** : les Foundation (lightweight buildables) sont dans le subsystem, pas besoin de push (voir section Foundation).

## Scripts utilitaires (`tools/`)

| Script | Description |
|--------|-------------|
| `analyzeSinkPoints.js` | LP solver sink points (HiGHS) → xlsx + graphml |
| `createMinerBlueprint.js` | Blueprint miners sur nodes non-minés |
| `injectMiners.js` | Injection de miners dans la save |
| `rebuildWaterNetwork.js` | Reconstruction réseau eau nucléaire |
| `analyzeBeltCurvature.js` | Analyse du rayon de courbure des belts |

## Scripts d'inspection (`inspect/`)

14 scripts pour explorer/débugger les saves. Notamment :

| Script | Description |
|--------|-------------|
| `findRailway.js` | Liste tous les objets ferroviaires |
| `dumpPortOffsets.js` | Extrait les offsets de ports depuis la save |

## Commande d'exécution

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
node tools/monScript.js
```