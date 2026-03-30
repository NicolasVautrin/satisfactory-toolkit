# Viewer Server (Express + WebSocket)

Serveur Express qui charge et manipule les saves Satisfactory, expose les données d'entités via API REST et WebSocket, et sert les assets 3D (meshes, landscape, scenery).

## Lancement

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
node viewer/server.js
# → http://localhost:3000
```

Le serveur démarre sans save — charger via `/api/game/load-file` ou upload depuis le viewer.

## Gestion du serveur

- Le serveur reste actif en arrière-plan tant qu'il n'est pas tué
- **Arrêter** : `curl -s -X POST http://localhost:3000/api/shutdown`
- **Kill forcé** (si shutdown ne répond pas) : `powershell -Command 'Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`
- **Redémarrer** après modifications de `viewer/server.js` ou `viewer/lib/` : shutdown/kill, attendre 1s, relancer
- Quand lancé via `run_in_background`, la notification `status: completed` signifie que le monitoring s'est terminé, **pas** que le serveur s'est arrêté

## Fichiers

- `viewer/server.js` : routes Express, orchestration
- `viewer/lib/spline.js` : Hermite sampling, extraction splines save/CBP, quatRotate
- `viewer/lib/entityData.js` : classify, clearance, ports, buildSaveEntityData, buildCbpEntityData
- `viewer/lib/saveLoader.js` : loadSave, loadCbp, loadBlueprint, editEntities, injectBlueprint, state management
- `viewer/lib/merge.js` : CBP→Save conversion et merge

## API REST

> **Note** : Toutes les coordonnées échangées avec le serveur (REST et WebSocket) sont en **Unreal Engine space** (le client convertit Viewer ↔ UE en interne).


### Viewer (`/api/viewer/`)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/viewer/mesh-catalog?lod=` | GET | Liste des meshes buildings disponibles par LOD |
| `/api/viewer/scenery?lod=` | GET | Metadata scenery (placements, streaming, meshes/textures dispo) |
| `/api/viewer/landscape-data` | GET | Metadata tuiles landscape (coords, noms GLB) |
| `/api/viewer/landscape-map` | GET | Image JPEG assemblée de la map (cache on-demand) |
| `/api/viewer/glb` | POST | Batch GLB — `{ prefix, files[] }` → binaire (landscape, scenery, buildings) |
| `/api/viewer/camera` | GET | Position et orientation caméra en coordonnées Unreal |

### Game (`/api/game/`)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/game/load-file` | POST | Charge un fichier .sav/.cbp depuis le disque (`{ filePath }`) |
| `/api/game/upload` | POST | Upload et parse un fichier `.sav`, `.cbp` ou `.sbp` (binaire, header `X-Save-Name`) |
| `/api/game/entities` | GET | Retourne les entity data en mémoire (pour refresh sans re-upload) |
| `/api/game/entity/:index` | GET | Détails d'une entité (transform, clearance, ports world-space, splineLength, properties, components) |
| `/api/game/export` | POST | Exporte une sélection en blueprint (`{ indices, name }`) |
| `/api/game/edit` | POST | Endpoint unifié add/update/delete d'entités + connections (fonctionne sans save) |
| `/api/game/inject-blueprint` | POST | Injecte un blueprint dans la save avec un transform |
| `/api/game/download` | GET | Télécharge la save modifiée en `_edit.sav` |
| `/api/game/merge-cbp` | POST | Merge le CBP chargé dans la save |
| `/api/game/player-position` | GET | Position du joueur `{ success, position: {x,y,z} }` |
| `/api/game/move-player` | POST | Déplace le joueur dans la save |

### Wiki (`/api/wiki`)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/wiki` | GET | Index du wiki — liste des pages avec description courte |
| `/api/wiki?page=<name>` | GET | Page wiki — détail d'un type d'entité ou page système |

Pages système : `_general` (règles positionnement/connexion), `_edit` (doc API edit), `_query` (doc API consultation).
Pages entités : un alias par type (ex: `constructor`, `splitter`, `belt-6`, `lift`).

Chaque page entité contient : `className`, `typePath`, `clearance` (bounding boxes), `ports` (offset/dir/flow/type en espace local), `snapBehavior`.

Les fichiers JSON sont dans `data/wiki/` et relus à chaque requête (pas de cache) — éditables sans restart serveur.

Régénération : `node tools/generateEntityWiki.js`

### Système

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/shutdown` | POST | Arrête le serveur |

### Batch GLB (`POST /api/viewer/glb`)

Endpoint générique pour charger plusieurs fichiers GLB en une seule requête :
```json
{ "prefix": "terrain/glb", "files": ["comp_-1016_-1016", "comp_-1016_-1143"] }
```
- `prefix` : chemin relatif dans `data/meshes/` (ex: `terrain/glb`, `scenery/lod2`, `lod2`)
- `files` : noms sans extension `.glb`
- **LOD fallback** : si le prefix contient `lod{N}`, tente `lod{N-1}` → ... → `lod0` automatiquement
- **Réponse binaire** : `[uint32 count][uint32 nameLen][name][uint32 glbLen][glb]...`
- Compression gzip automatique via middleware `compression`

### Edit (`POST /api/game/edit`)

Voir section dédiée [Éditeur](#éditeur-post-apigameedit) ci-dessous.

### Alias de types (typeAliases.js)

L'endpoint edit accepte des alias courts au lieu du typePath complet :
- Producers : `smelter`, `constructor`, `assembler`, `manufacturer`, `foundry`, `refinery`, `blender`, `packager`, `collider`, `converter`, `encoder`, `nuclear`
- Extractors : `miner` (Mk3), `miner-1`/`miner-2`/`miner-3`, `oil-pump`, `water-pump`, `fracker`, `frack-node`
- Belts : `belt` (Mk6), `belt-1` à `belt-6`
- Lifts : `lift` (Mk6), `lift-1` à `lift-6`
- Splitters/Mergers : `splitter`, `smart-splitter`, `prog-splitter`, `merger`, `prio-merger`
- Pipes : `pipe-junction`, `pipe-pump`, `pipe-hole`
- Power : `power-line`

## WebSocket

Le serveur expose un WebSocket sur le même port. Messages serveur → client :
- `entityAdded` : `{ type, index, item, classUpdate }` — nouvelle entité ajoutée
- `entitiesDeleted` : `{ type, indices }` — entités supprimées (le client fait un refresh)
- `connectionsUpdated` : `{ type, entities: [{ index, connections }] }` — état de connexion modifié
- `editResult` : `{ type, results }` — résultat d'un edit (add/update/delete)

Le client envoie la position caméra toutes les secondes : `{ type: 'camera', position, yaw, pitch }`.

## Index unifié (items[])

Toutes les opérations (inspect, delete, export, create, attach) utilisent un index unifié via `saveState.items[]` :
- `items[0..N-1]` → entités régulières (`{ type: 'entity', entity }`)
- `items[N..N+M-1]` → lightweight buildables (`{ type: 'lw', lw }`)

## Données serveur → client

Le serveur prépare un objet compact pour le client :
- `classNames` : tableau des noms de classes uniques
- `clearance` : bounding boxes par index de classe (depuis `data/clearanceData.json`)
- `portLayouts` : définitions des ports par index de classe (offset, direction, flow, type)
- `entities` : tableau d'objets `{ c, tx, ty, tz, rx, ry, rz, rw, cat, sp?, lift?, box?, cn? }` où :
  - `c` = index dans classNames
  - `tx/ty/tz` = position, `rx/ry/rz/rw` = rotation quaternion
  - `cat` = catégorie (0-7)
  - `sp` = points de spline `[[x,y,z], ...]` (optionnel, pour belts/pipes/rails)
  - `lift` = 2 endpoints `[[x,y,z], [x,y,z]]` (optionnel, pour ConveyorLifts)
  - `box` = clearance box par instance (optionnel, pour beams)
  - `cn` = état de connexion des ports `[0|1, ...]` (optionnel, même ordre que portLayouts)

### Entités filtrées
- `Build_PipelineFlowIndicator_C` : exclu du chargement (indicateur cosmétique, pas un bâtiment)

### Catégories d'entités (8)
| Index | Nom | Couleur | Regex de classification |
|---|---|---|---|
| 0 | Producers | orange | Constructor, Smelter, Foundry, Assembler, Manufacturer, Refinery, Blender, Packager, HadronCollider, Converter, QuantumEncoder, NuclearPower |
| 1 | Extractors | vert | Miner, WaterPump, OilPump, Fracking |
| 2 | Belts | bleu | Conveyor, Splitter, Merger |
| 3 | Pipes | cyan | Pipeline, PipeHyper, Valve, JunctionCross, PipelinePump |
| 4 | Power | jaune | PowerLine, PowerPole, PowerSwitch, PowerStorage, Generator, PowerTower |
| 5 | Railway | violet | Train, Railroad, Station, Locomotive, FreightWagon |
| 6 | Structural | gris | Foundation, Wall_, Ramp, Beam, Pillar, Roof, Stair, Walkway, Catwalk, Fence, Frame |
| 7 | Other | blanc cassé | Tout le reste |

### Positionnement des connexions lift ↔ splitter
Un ConveyorLift directement connecté à un splitter est positionné **exactement sur le port du splitter** (offset = 100 unités depuis le centre). Le delta en espace local du splitter correspond au port :
- Input1 : `(-100, 0, 0)`
- Output1 : `(+100, 0, 0)`
- Output2 : `(0, +100, 0)`
- Output3 : `(0, -100, 0)`

## Modifier le serveur

### Ajouter une API endpoint
Ajouter la route dans `viewer/server.js`. Utiliser `getSaveState()` et `getCbpState()` depuis `saveLoader.js`.

### Ajouter une catégorie ou changer la classification
Modifier `CATEGORY_PATTERNS` dans `viewer/lib/entityData.js`.

### Ajouter des ports à un bâtiment
1. Le Builder doit hériter de `Builder` (`lib/shared/Builder.js`)
2. Pour les bâtiments fixes : ajouter `MyBuilder.PORT_LAYOUT = PORTS;` — `getPorts` hérité transforme en world space
3. Pour les spline-based : override `MyBuilder.getPorts = function(entity) { return Builder._splinePorts(entity, portNames, type); };`
4. Ancien format : `Builder.PORT_LAYOUT = PORTS;` dans le fichier du builder (après `Builder.Ports = ...`)
2. Enregistrer le builder dans `lib/Registry.js` si pas déjà fait
3. Les ports apparaîtront automatiquement dans le viewer

## Éditeur (POST /api/game/edit)

Endpoint unifié pour créer, modifier, supprimer des entités, les connecter entre elles, et insérer des splitters/mergers/junctions/pumps sur des splines existantes. Fonctionne sans save chargée.

### Système d'identifiants

Les connexions utilisent exclusivement des **id locaux** déclarés dans `entities[]`. Pour référencer une entité existante dans une connexion, la déclarer comme alias :

```json
{ "id": "belt1", "index": 42 }
```

Cet alias ne modifie pas l'entité — il crée juste un id utilisable dans `from`, `to`, `on`.

### Opérations sur les entités

| Opération | Format | Description |
|---|---|---|
| **Add** | `{id, type, position}` | Crée une entité. `type` = alias wiki (ex: `constructor`, `splitter`). `position` relative à `anchor`. |
| **Alias** | `{id, index}` | Crée un alias sur une entité existante (pour les connexions). |
| **Modify** | `{index, position?, rotation?, properties?}` | Modifie une entité existante. |
| **Delete** | `{index, deleted: true}` | Soft delete (le slot devient null, indices stables). |

### Types de connexions

| Format | Description |
|---|---|
| `{from:"id:port", to:"id:port"}` | **Directe** — `from` snappe sur `to`. `from` doit être mobile. |
| `{from:"id:port", to:"id:port", belt:tier}` | **Belt auto** — crée un belt (tier 1-6) entre les deux ports. Les deux peuvent être fixes. |
| `{from:"id:port", to:"id:port", pipe:tier}` | **Pipe auto** — crée un pipe (tier 1-2) entre les deux ports pipe. |
| `{from:"id", on:"id", position:{x,y,z}}` | **Insertion** — insère l'entité `from` sur le belt/pipe `on`, coupe la spline en deux. |

### Règles de snap

| Entité qui snappe (from) | Peut snapper sur (to) | Condition |
|---|---|---|
| belt / pipe / lift / track | tout port compatible | toujours |
| splitter / merger (vierge) | endpoint belt ou lift | aucun port déjà connecté |
| junction / pump (vierge) | endpoint pipe | aucun port déjà connecté |
| producer / extracteur | rien | utiliser `belt:tier` ou `pipe:tier` |

### Rollback

Si une connexion échoue, **toutes** les entités ajoutées dans le batch sont supprimées (rollback atomique).

### Exemples

**Deux constructors reliés par un belt :**
```json
{
  "anchor": {"fromCamera": 5000},
  "entities": [
    {"id": "c1", "type": "constructor", "position": {"x": 0, "y": 0, "z": 0}},
    {"id": "c2", "type": "constructor", "position": {"x": 1000, "y": 0, "z": 0}}
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
