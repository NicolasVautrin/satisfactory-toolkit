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
| `/api/game/entity/:index` | GET | Retourne les détails d'une entité (instanceName, properties, components) |
| `/api/game/export` | POST | Exporte une sélection en blueprint (`{ indices, name }`) |
| `/api/game/edit` | POST | Endpoint unifié add/update/delete d'entités + connections |
| `/api/game/inject-blueprint` | POST | Injecte un blueprint dans la save avec un transform |
| `/api/game/download` | GET | Télécharge la save modifiée en `_edit.sav` |
| `/api/game/merge-cbp` | POST | Merge le CBP chargé dans la save |
| `/api/game/move-player` | POST | Déplace le joueur dans la save |

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

Endpoint unifié pour add/update/delete d'entités + connections :
```json
{
  "anchor": {"x": -76426, "y": 223301, "z": 7946},
  "rotation": 90,
  "entities": [
    { "id": "s1", "type": "splitter", "position": {"x": 0, "y": 0, "z": 0} },
    { "id": "s2", "type": "splitter", "position": {"x": 800, "y": 0, "z": 0}, "rotation": 45 },
    { "id": "existing", "index": 12, "position": {"x": 0, "y": 400, "z": 0} },
    { "index": 5, "deleted": true }
  ],
  "connections": [
    { "from": "s1:Output1", "to": "existing:Input1" }
  ]
}
```
- **Add** (pas d'`index`, pas de `deleted`) : crée une nouvelle entité, `id` permet de référencer dans les connections
- **Update** (`index` + champs à modifier) : modifie position/rotation/properties d'une entité existante
- **Delete** (`index` + `deleted: true`) : soft delete (null le slot, indices stables)
- `anchor` : position absolue `{"x", "y", "z"}` ou relative caméra `{"fromCamera": 5000}`
- `rotation` : yaw global en degrés, tourne toutes les positions relatives autour de l'anchor
- `connections` : `id:portName` — appelle `attach` (wire + snap) entre les ports

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
1. Ajouter `Builder.PORT_LAYOUT = PORTS;` dans le fichier du builder (après `Builder.Ports = ...`)
2. Enregistrer le builder dans `lib/Registry.js` si pas déjà fait
3. Les ports apparaîtront automatiquement dans le viewer
