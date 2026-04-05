# Éditeur d'entités (POST /api/game/edit)

Endpoint unifié pour créer, modifier, supprimer des entités, les connecter entre elles, et insérer des splitters/mergers/junctions/pumps sur des splines existantes. Fonctionne sans save chargée (crée un état minimal en mémoire).

Implémentation : `viewer/lib/editor.js` → `editEntities(batch)`.

## Format de requête

```json
{
  "anchor": {"x": 1000, "y": 2000, "z": 500},
  "rotation": 90,
  "entities": [...],
  "connections": [...]
}
```

| Champ | Description |
|-------|-------------|
| `anchor` | Position absolue `{x,y,z}` ou relative caméra `{fromCamera: distance_uu}`. Toutes les positions d'entités sont relatives à l'anchor. |
| `rotation` | Yaw global en degrés (optionnel). Tourne toutes les positions relatives autour de l'anchor et s'ajoute aux rotations individuelles. |
| `entities` | Opérations sur les entités (add, alias, delete). |
| `connections` | Connexions entre entités (direct, belt, pipe, insertion). |

## Système d'identifiants (alias)

Les connexions utilisent exclusivement des **id locaux** déclarés dans `entities[]`. Pour référencer une entité existante dans une connexion, la déclarer comme alias :

```json
{ "id": "belt1", "index": 42 }
```

Cet alias ne modifie pas l'entité — il crée juste un id utilisable dans `from`, `to`, `on`.

## Opérations sur les entités

| Opération | Format | Description |
|---|---|---|
| **Add** | `{id, type, position}` | Crée une entité. `type` = alias wiki (ex: `constructor`, `splitter`). `position` relative à `anchor`. |
| **Alias** | `{id, index}` | Crée un alias sur une entité existante (pour les connexions). |
| **Delete** | `{index, deleted: true}` | Soft delete (le slot devient null, indices stables). |

### Alias de types (typeAliases.js)

L'endpoint accept des alias courts au lieu du typePath complet :
- Producers : `smelter`, `constructor`, `assembler`, `manufacturer`, `foundry`, `refinery`, `blender`, `packager`, `collider`, `converter`, `encoder`, `nuclear`
- Extractors : `miner` (Mk3), `miner-1`/`miner-2`/`miner-3`, `oil-pump`, `water-pump`, `fracker`, `frack-node`
- Belts : `belt` (Mk6), `belt-1` à `belt-6`
- Lifts : `lift` (Mk6), `lift-1` à `lift-6`
- Splitters/Mergers : `splitter`, `smart-splitter`, `prog-splitter`, `merger`, `prio-merger`
- Pipes : `pipe-junction`, `pipe-pump`, `pipe-hole`
- Railway : `track`, `train-station`, `belt-station`, `pipe-station`
- Power : `power-line`

## Types de connexions

| Format | Description |
|---|---|
| `{from:"id:port", to:"id:port"}` | **Directe** — `from` snappe sur `to`. `from` doit être mobile (belt/pipe/lift ou splitter/merger/junction/pump vierge). |
| `{id:"b1", from:"id:port", to:"id:port", belt:tier}` | **Belt auto** — crée un belt (tier 1-6) entre les deux ports. `id` obligatoire. |
| `{id:"p1", from:"id:port", to:"id:port", pipe:tier}` | **Pipe auto** — crée un pipe (tier 1-2) entre les deux ports pipe. `id` obligatoire. |
| `{id:"r1", from:..., to:..., track:true}` | **Track auto** — crée un rail entre deux endpoints. `from`/`to` = `"id:port"` ou `{x,y,z,rotation?}` (position libre). `id` obligatoire. |
| `{id:"b2", from:"id", on:"id", position:{x,y,z}}` | **Insertion** — insère l'entité `from` sur le belt/pipe `on`, coupe la spline en deux. `id` = la 2e spline créée. `id` obligatoire. |

Sémantique : `from` = entité mobile qui se repositionne, `to` = ancre fixe. Pour les splines auto (belt/pipe/track), `from` = port START, `to` = port END.

Les endpoints positionnels (`{x,y,z}` au lieu de `"id:port"`) ne sont supportés que pour les tracks.

**⚠ Les connexions track sont toujours explicites** — un endpoint positionnel crée un port libre (non connecté). Même si deux tracks ont des endpoints à la même position, ils ne sont **pas** connectés automatiquement. Pour les connecter, ajouter une connexion directe `{from: "r1:TrackConnection1", to: "r2:TrackConnection1"}` dans le batch.

### Endpoints positionnels track

Un endpoint positionnel track accepte un champ `rotation` optionnel (yaw en degrés) qui spécifie la **direction outward du port** (vers l'extérieur du track, à l'opposé du track) :
- `rotation: 0` → direction (-1, 0, 0) = -X
- `rotation: 90` → direction (0, -1, 0) = -Y
- `rotation: 180` → direction (+1, 0, 0) = +X
- `rotation: 270` → direction (0, +1, 0) = +Y

**Convention outward** : tous les ports (belt, pipe, track) pointent vers l'extérieur. Pour un track :
- `from` (= TC0) : la rotation donne la direction **opposée** au sens de parcours. Ex: track allant vers le nord → `from` rotation 90 (-Y = outward sud).
- `to` (= TC1) : la rotation donne la direction **dans** le sens de parcours. Ex: track arrivant par le nord → `to` rotation 270 (+Y = outward nord).

Sans `rotation`, la direction est calculée depuis le span (droite).

Les positions sont relatives à l'anchor et transformées par la rotation du batch (comme les positions d'entités).

### Outil de planification de chemin railway

Pour planifier un chemin railway entre deux transforms, utiliser `tools/planTrackPath.js` :
```bash
node tools/planTrackPath.js --from "0,26000,0" --fromRot 270 --to "8000,26000,0" --toRot 90
```

L'outil prend deux transforms (position + rotation/direction) et retourne la liste minimale de segments track valides (longueur, courbure, pente). Utilise une courbe de Bézier cubique pour trouver les waypoints intermédiaires.

Options : `--from "x,y,z"`, `--to "x,y,z"`, `--fromRot N` / `--toRot N` (yaw degrés, direction outward du port) ou `--fromDir "x,y,z"` / `--toDir "x,y,z"` (vecteur outward).

Sortie : tableau récapitulatif + JSON directement utilisable dans les connections `editEntities`.

**Utiliser systématiquement avant d'écrire un test track** pour valider chaque segment courbe et déterminer les positions d'apex.

### Docking station (gares)

Les dock stations (belt-station, pipe-station) se connectent via les ports TrackConnection. Le builder détecte automatiquement la connexion dock↔station et :
- Repositionne le dock adjacent à la station/dock cible
- Connecte les tracks intégrés
- Connecte les platform connections internes

Convention : `from` = dock mobile, `to` = station/dock fixe. Le choix du port (TC0 ou TC1) détermine le côté et l'orientation du dock.

### Outil de validation de splines

Pour planifier des layouts track/belt/pipe, utiliser `tools/validateSpline.js` :
```bash
node tools/validateSpline.js --type track --from "0,0,0" --fromRot 0 --to "4000,4000,0" --toRot 270
node tools/validateSpline.js --type belt --from "0,0,0" --fromDir "0,1,0" --to "0,2000,100" --toDir "0,-1,0"
```

Options : `--type belt|pipe|track`, `--from "x,y,z"`, `--to "x,y,z"`, `--fromDir "x,y,z"` / `--toDir "x,y,z"` (vecteur) ou `--fromRot N` / `--toRot N` (yaw degrés).

Affiche : longueur, U-turn, courbure min XY, pente max, pass/fail. **Utiliser systématiquement avant d'écrire un test track** pour valider chaque segment.

## Noms de ports

### Entités fixes (producers, extracteurs)

Voir la page wiki de chaque entité pour les noms exacts. Exemples courants :
- Constructor/Smelter : `Input0`, `Output0`
- Assembler/Foundry : `Input0`, `Input1`, `Output0`
- Manufacturer : `Input0`..`Input3`, `Output0`
- Refinery : `Input0`, `Output0`, `PipeInput0`, `PipeOutput0`
- Packager : `Input0`, `Output0`, `PipeInputFactory`, `PipeOutputFactory`

### Logistique (ports virtuels)

| Type | Ports | Flow |
|------|-------|------|
| Belt | `ConveyorAny0` (input), `ConveyorAny1` (output) | Polarisés |
| Lift | `bottom`, `top` | Bidirectionnels, polarisés par la 1ère connexion |
| Pipe | `PipelineConnection0`, `PipelineConnection1` | — |
| Splitter | `Input1`, `Output1`, `Output2`, `Output3` | Fixés |
| Merger | `Input1`, `Input2`, `Input3`, `Output1` | Fixés |
| Junction | `0`, `1`, `2`, `3` | Tous input (4 directions) |
| Pump | `input`, `output` | Fixés |
| Track | `TrackConnection0` (START), `TrackConnection1` (END) | Bidirectionnels |
| Train Station | `TrackConnection0`, `TrackConnection1` | Bidirectionnels (via integrated track) |
| Belt Station | `TrackConnection0`, `TrackConnection1`, `Input0`, `Output0`, `Input1`, `Output1` | TC = track, I/O = belt |
| Pipe Station | `TrackConnection0`, `TrackConnection1`, `PipeFactoryInput0/1`, `PipeFactoryOutput0/1` | TC = track, pipes |

## Règles de snap

| Entité qui snappe (from) | Peut snapper sur (to) | Condition |
|---|---|---|
| belt / pipe / lift / track | tout port compatible | toujours |
| splitter / merger (vierge) | endpoint belt ou lift | aucun port déjà connecté |
| junction / pump (vierge) | endpoint pipe | aucun port déjà connecté |
| producer / extracteur | rien | utiliser `belt:tier` ou `pipe:tier` |
| belt-station / pipe-station | train-station ou autre dock (port TC) | repositionnable, dock uniquement sur station ou dock |

- Après la première connexion, splitter/merger/junction/pump deviennent **fixes** (ne peuvent plus snapper).
- Un port belt ne peut se connecter qu'à un port belt, un port pipe qu'à un port pipe.
- Un port input se connecte à un port output (pas input↔input ni output↔output).
- Flag `IS_SPLINE = true` sur ConveyorBelt, Pipe, ConveyorLift, RailroadTrack — validation dans `snapTo()`.
- Les dock stations sont **repositionnables** : elles se repositionnent automatiquement à côté de la station/dock cible lors du docking.
- Un dock ne peut se connecter qu'à une **train-station** ou un **autre dock** (pas à un track autonome).
- Les connexions dock↔station et dock↔dock se font via les ports **TrackConnection** (TC0/TC1).

## Polarité des lifts

Les ports d'un lift sont bidirectionnels (`flowType = null`) à la création. La première connexion à un port polarisé fixe la polarité :

- `lift.bottom` connecté à un `Output` (ou `ConveyorAny1`) → bottom = INPUT, top = OUTPUT
- `lift.bottom` connecté à un `Input` (ou `ConveyorAny0`) → bottom = OUTPUT, top = INPUT

`fromSave` restaure la polarité en inspectant le nom du composant connecté (y compris belt `ConveyorAny0` = input, `ConveyorAny1` = output).

Deux lifts top↔top ne peuvent se connecter que si leurs polarités sont **opposées**.

## Direction du bras top (lift)

La propriété `properties.topDir` sur une entité lift permet d'orienter le bras supérieur. 4 directions cardinales en entity-local space :

| Nom | Valeur | Description |
|-----|--------|-------------|
| FRONT | `{x:1, y:0}` | Même direction que le bras bottom |
| BACK | `{x:-1, y:0}` | Opposé au forward |
| RIGHT | `{x:0, y:1}` | Droite |
| LEFT | `{x:0, y:-1}` | Gauche |

Exemple :
```json
{"id": "lift1", "type": "lift", "position": {"x": 0, "y": 0, "z": 0}, "properties": {"topDir": {"x": 0, "y": 1}}}
```

Le `topDir` est en entity-local space. Il est converti en quaternion (`topRot`) à la création du lift. Le bottom snap change la rotation de l'entity mais pas `mTopTransform.Rotation`, donc la direction world du bras top dépend de la rotation finale du lift après snap.

## Limites de longueur / hauteur

Validées automatiquement lors de la création de belts, pipes et lifts. Définies dans `data/splineLimits.json`.

| Type | Min (UU) | Max (UU) |
|------|----------|----------|
| belt | 200 | 5600 |
| pipe | 200 | 5600 |
| track | 1200 | 9900 |
| lift | 400 | 4800 |

Un belt/pipe trop court ou trop long, ou un lift hors limites, provoque une erreur avec rollback.

**Tracks aux stations** : un track connecté à un port de station (integrated track) doit faire **exactement 1200 UU**. Utiliser des stubs courts aux stations, puis connecter les tracks du réseau aux stubs. Voir guards de connexion dans `trains.md`.

## Validation de forme des splines (courbure / pente / U-turn)

Après création d'un belt ou pipe auto (`belt:tier` / `pipe:tier`), `validateSplineShape()` vérifie :

### U-turn (belts + pipes)
Le belt/pipe ne doit pas faire demi-tour. Vérifié via les directions des ports world-space :
- Le port source doit pointer **vers** la destination (`cos(dirSrc, span) > -0.5`)
- Le port destination doit pointer **à l'opposé** de la source (`cos(dirDst, span) < 0.5`)

Si violation → erreur `"belt would require U-turn"` + rollback.

### Courbure XY min (belts + tracks)
Rayon de courbure minimum dans le plan XY, mesuré sur la spline samplée (hors guard sections de 100 UU à chaque extrémité).

| Type | Min radius XY |
|------|---------------|
| belt | 180 UU |
| track | 900 UU |

### Pente max (belts + tracks)
Pente maximale en Z, mesurée segment par segment sur la spline samplée (hors guard sections).

| Type | Max slope |
|------|-----------|
| belt | 40° |
| track | 25° |

### Guard sections et splines
Les splines Hermite ont des **guard sections** de 100 UU (2×PORT_TANGENT) à chaque extrémité. Ces sections sont droites et alignées avec la direction outward du port — elles permettent au belt/pipe de dégager du bâtiment avant de tourner.

La courbure la plus serrée se produit à la **transition guard → segment central**, quand la direction du port est perpendiculaire à la direction globale du belt. C'est pourquoi la validation de courbure/pente exclut les guard sections.

## Placement des entités pour `belt:tier` auto

**IMPORTANT** : lors de la création de belts auto entre bâtiments, les ports source et destination doivent être orientés de manière compatible. Règles :

1. **Le port source doit pointer vers la destination** — pas perpendiculairement, pas en arrière.
2. **Le port destination doit pointer à l'opposé de la source** — le belt arrive "de face" au port.
3. **Les constructors ont Input0 en -Y et Output0 en +Y.** Pour un belt droit entre deux constructors, les placer sur l'axe Y (pas X).
4. **Les splitters/mergers ont des ports en ±X et ±Y.** Utiliser `rotation` pour aligner les ports avec la direction du belt.
5. **Les lift bottom ports pointent en +X (local).** Après snap sur un splitter/merger, la direction world dépend de la rotation du lift. Placer les entités connectées au lift top **dans la direction du bras top**.
6. **Rotation du lift après snap** : le lift tourne pour que son bottom (+X local) fasse face au port anchor. La rotation = angle de +X vers `wOpposed` (= -anchorDir). Exemples : snap sur port -X → wOpposed +X → rotation **0°** (identité). Snap sur port +X → wOpposed -X → rotation **180°**.
7. **Le `topDir` est en entity-local space.** La direction world du bras top = topDir transformé par la rotation de l'entité. Pour un lift à rotation 0° : RIGHT {0,1} → world +Y, LEFT {0,-1} → world -Y. Pour un lift à rotation 180° : RIGHT {0,1} → world -Y, LEFT {0,-1} → world +Y.

### Exemple : constructor → belt → lift bottom
```json
{
  "entities": [
    {"id": "c1", "type": "constructor", "position": {"x": 0, "y": 0, "z": 0}, "rotation": 90},
    {"id": "lift1", "type": "lift", "position": {"x": -1500, "y": 0, "z": 0}}
  ],
  "connections": [
    {"id": "b1", "from": "c1:Output0", "to": "lift1:bottom", "belt": 6}
  ]
}
```
Constructor rotation 90° → Output0 pointe en -X. Lift en -X → belt va en -X, lift bottom pointe en +X (face au belt). ✓

### Exemple : splitter + lift + constructor (1 edit)
```json
{
  "anchor": {"x": 0, "y": 0, "z": 0},
  "entities": [
    {"id": "c1", "type": "constructor", "position": {"x": 0, "y": 0, "z": 0}},
    {"id": "c2", "type": "constructor", "position": {"x": 0, "y": 0, "z": 2000}},
    {"id": "spl", "type": "splitter", "position": {"x": 0, "y": -800, "z": 0}, "rotation": 90},
    {"id": "liftIn", "type": "lift", "position": {"x": 0, "y": 0, "z": 0},
     "properties": {"height": 2000, "topDir": {"x": 0, "y": 1}}}
  ],
  "connections": [
    {"id": "b1", "from": "spl:Output1", "to": "c1:Input0", "belt": 6},
    {"from": "liftIn:bottom", "to": "spl:Output2"},
    {"id": "b2", "from": "liftIn:top", "to": "c2:Input0", "belt": 6}
  ]
}
```

## Repositionnement interdit

Les entités existantes (référencées par `index`) ne peuvent **pas** être repositionnées via `position` ou `rotation`. Seules les `properties` peuvent être mises à jour. Le repositionnement ne se fait que via les connexions (snap).

## Clearance

La validation de clearance (détection de chevauchement OBB) est **toujours active** — pas de bypass possible. Les entités spline (belts, pipes, lifts, tracks) sont exclues du check.

## Rollback

Si une connexion ou validation échoue, **toutes** les entités ajoutées dans le batch sont supprimées (rollback atomique).

## Exemples

**Deux constructors reliés par un belt :**
Constructor Output0 pointe en +Y, Input0 en -Y → placer c2 en +Y de c1 pour un belt droit.
```json
{
  "anchor": {"fromCamera": 5000},
  "entities": [
    {"id": "c1", "type": "constructor", "position": {"x": 0, "y": 0, "z": 0}},
    {"id": "c2", "type": "constructor", "position": {"x": 0, "y": 2000, "z": 0}}
  ],
  "connections": [
    {"from": "c1:Output0", "to": "c2:Input0", "belt": 6}
  ]
}
```

**Connecter à une entité existante (index 42) :**
```json
{
  "entities": [
    {"id": "existing", "index": 42},
    {"id": "c1", "type": "constructor", "position": {"x": 1000, "y": 0, "z": 0}}
  ],
  "connections": [
    {"from": "existing:Output0", "to": "c1:Input0", "belt": 6}
  ]
}
```

**Insérer un splitter sur un belt existant (index 42) :**
```json
{
  "entities": [
    {"id": "belt1", "index": 42},
    {"id": "s1", "type": "splitter"}
  ],
  "connections": [
    {"from": "s1", "on": "belt1", "position": {"x": 1000, "y": 2000, "z": 500}}
  ]
}
```

**Insérer une junction sur un pipe existant (index 55) :**
```json
{
  "entities": [
    {"id": "pipe1", "index": 55},
    {"id": "j1", "type": "pipe-junction"}
  ],
  "connections": [
    {"from": "j1", "on": "pipe1", "position": {"x": 2000, "y": 500, "z": 375}}
  ]
}
```
