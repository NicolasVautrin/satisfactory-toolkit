# 3D Entity Viewer

Viewer Three.js pour visualiser les entités d'une save Satisfactory dans le navigateur. Permet la sélection d'entités, l'inspection de propriétés, la visualisation des ports, l'export/import de blueprints, la suppression d'entités, et le merge de CBP dans une save.

## Lancement

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
node viewer/server.js
# → http://localhost:3000
```

Le serveur Express démarre sans save — l'utilisateur charge les fichiers `.sav`, `.cbp` ou `.sbp` via l'interface (bouton Open ou drag & drop).

## Gestion du serveur

- Le serveur reste actif en arrière-plan tant qu'il n'est pas tué
- **Arrêter** : `curl -s -X POST http://localhost:3000/api/shutdown`
- **Kill forcé** (si shutdown ne répond pas) : `powershell -Command 'Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`
- **Redémarrer** après modifications de `viewer/server.js` ou `viewer/lib/` : shutdown/kill, attendre 1s, relancer + hard reload (Ctrl+Shift+R) dans le navigateur
- Après modification de `viewer/public/` : un simple hard reload suffit (pas besoin de redémarrer le serveur)
- Quand lancé via `run_in_background`, la notification `status: completed` signifie que le monitoring s'est terminé, **pas** que le serveur s'est arrêté — le serveur continue de tourner

## Architecture

### Fichiers serveur
- `viewer/server.js` : routes Express, orchestration
- `viewer/lib/spline.js` : Hermite sampling, extraction splines save/CBP, quatRotate
- `viewer/lib/entityData.js` : classify, clearance, ports, buildSaveEntityData, buildCbpEntityData
- `viewer/lib/saveLoader.js` : loadSave, loadCbp, loadBlueprint, editEntities, injectBlueprint, state management
- `viewer/lib/merge.js` : CBP→Save conversion et merge

### Fichiers client
- `viewer/public/index.html` : point d'entrée, charge Three.js + Lucide icons via CDN
- `viewer/public/js/app.js` : orchestration client, handlers souris/clavier, wiring UI
- `viewer/public/js/engine/scene.js` : Three.js core, gameToViewer, constantes couleurs/catégories
- `viewer/public/js/engine/entities.js` : buildMeshes (boxes, belt splines, pipe splines, lifts), ports rendering
- `viewer/public/js/engine/selection.js` : raycasting, pickAt, pickPortAt, pickRect, sélection
- `viewer/public/js/engine/camera.js` : contrôles caméra FPS custom, persistance localStorage
- `viewer/public/js/engine/terrain.js` : rendu heightmap
- `viewer/public/js/engine/grid.js` : grille 3D de la scène (faces externes)
- `viewer/public/js/engine/placement.js` : placement interactif de blueprints (axes, clavier, bbox grid)
- `viewer/public/js/engine/entityGrid.js` : gridBox par entité (toggle world/entity alignment)
- `viewer/public/js/ui/toolbar.js` : barre de menus (File, Layers, Camera)
- `viewer/public/js/ui/filters.js` : toggles catégories/terrain/grid/ports/CBP (persistés localStorage)
- `viewer/public/js/ui/controls.js` : sensibilité caméra/grille, toggle gridBox alignment
- `viewer/public/js/ui/selPanel.js` : panneau sélection (droite) avec Export, Delete, Clear
- `viewer/public/js/ui/propsPanel.js` : panneau propriétés (gauche) avec Copy, GridBox, Close
- `viewer/public/js/ui/icons.js` : helper Lucide icons (refreshIcons)
- `viewer/public/js/upload.js` : upload fichiers + drag & drop

### Chargement des fichiers
Le viewer fonctionne par **upload client → serveur** :
1. L'utilisateur ouvre un fichier `.sav`, `.cbp` ou `.sbp` via le bouton **Open** ou par **drag & drop**
2. Le fichier est envoyé en POST binaire à `/api/upload` avec le nom en header `X-Save-Name`
3. Le serveur parse le fichier, construit les données d'entités, et renvoie le JSON
4. Le client reconstruit la scène 3D (clearMeshes + buildMeshes)

Deux slots indépendants côté serveur : `saveState` (save) et `cbpState` (CBP/blueprint). Le bouton **Refresh** (File menu) re-demande les données au serveur sans re-uploader le fichier — utile après un hard reload du navigateur.

### API REST (server.js)
| Endpoint | Méthode | Description |
|---|---|---|
| `/api/upload` | POST | Upload et parse un fichier `.sav`, `.cbp` ou `.sbp` (binaire, header `X-Save-Name`) |
| `/api/entities` | GET | Retourne les entity data en mémoire (pour refresh sans re-upload) |
| `/api/inspect/:index` | GET | Retourne les détails d'une entité (instanceName, properties, components) |
| `/api/terrain` | GET | Retourne les données de heightmap pour le terrain |
| `/api/camera` | GET | Position et orientation caméra en coordonnées Unreal (`{ position, yaw, pitch }`) |
| `/api/export` | POST | Exporte une sélection en blueprint (`{ indices, name }`) |
| `/api/edit` | POST | Endpoint unifié add/update/delete d'entités + connections (voir section Edit) |
| `/api/inject-blueprint` | POST | Injecte un blueprint dans la save avec un transform (`{ transform: { tx, ty, tz, yaw } }`) |
| `/api/download-save` | GET | Télécharge la save modifiée en `_edit.sav` |
| `/api/merge` | POST | Merge le CBP chargé dans la save chargée, retourne un `.sav` modifié |
| `/api/shutdown` | POST | Arrête le serveur |

### WebSocket
Le serveur expose un WebSocket sur le même port. Messages serveur → client :
- `entityAdded` : `{ type, index, item, classUpdate }` — nouvelle entité ajoutée
- `entitiesDeleted` : `{ type, indices }` — entités supprimées (le client fait un refresh)
- `connectionsUpdated` : `{ type, entities: [{ index, connections }] }` — état de connexion modifié

Le client envoie la position caméra toutes les secondes : `{ type: 'camera', position, yaw, pitch }`.

### Alias de types (typeAliases.js)
Les endpoints `create-entity` et `batch` acceptent des alias courts au lieu du typePath complet :
- Producers : `smelter`, `constructor`, `assembler`, `manufacturer`, `foundry`, `refinery`, `blender`, `packager`, `collider`, `converter`, `encoder`, `nuclear`
- Extractors : `miner` (Mk3), `miner-1`/`miner-2`/`miner-3`, `oil-pump`, `water-pump`, `fracker`, `frack-node`
- Belts : `belt` (Mk6), `belt-1` à `belt-6`
- Lifts : `lift` (Mk6), `lift-1` à `lift-6`
- Splitters/Mergers : `splitter`, `smart-splitter`, `prog-splitter`, `merger`, `prio-merger`
- Pipes : `pipe-junction`, `pipe-pump`, `pipe-hole`
- Power : `power-line`

Résolution : alias (insensible à la casse) → className → typePath complet. Accepte aussi les className directement ou les typePath complets.

### Edit (POST /api/edit)
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
- **Update** (`index` + champs à modifier) : modifie position/rotation/properties d'une entité existante, `id` pour référencer dans les connections
- **Delete** (`index` + `deleted: true`) : soft delete (null le slot, indices stables)
- `anchor` : position absolue `{"x", "y", "z"}` ou relative caméra `{"fromCamera": 5000}` (distance devant la caméra)
- `rotation` : yaw global en degrés, tourne toutes les positions relatives autour de l'anchor
- `entities[].position` : position relative à l'anchor (tournée par le yaw global)
- `entities[].rotation` : yaw additionnel en degrés (en plus du yaw global)
- `connections` : `id:portName` — appelle `attach` (wire + snap) entre les ports

### Index unifié (items[])
Toutes les opérations (inspect, delete, export, create, attach) utilisent un index unifié via `saveState.items[]` :
- `items[0..N-1]` → entités régulières (`{ type: 'entity', entity }`)
- `items[N..N+M-1]` → lightweight buildables (`{ type: 'lw', lw }`)

### Positionnement des connexions lift ↔ splitter
Un ConveyorLift directement connecté à un splitter est positionné **exactement sur le port du splitter** (offset = 100 unités depuis le centre). Le delta en espace local du splitter correspond au port :
- Input1 : `(-100, 0, 0)`
- Output1 : `(+100, 0, 0)`
- Output2 : `(0, +100, 0)`
- Output3 : `(0, -100, 0)`

En monde, il faut tourner cet offset par le yaw du splitter.

### Données serveur → client
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

### Conversion coordonnées Unreal → Three.js
- **Positions** : `gameToViewer(x, y, z) = Vector3(-x, y, z)` — réflexion axe X
- **Quaternions** : `(rx, ry, rz, rw) → (rx, -ry, -rz, rw)` — conjugaison pour la réflexion X

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

### Rendu Three.js
- **InstancedMesh** pour la performance (milliers d'entités)
- Les entités avec clearance data sont rendues comme des **box** (BoxGeometry)
- Les entités sans clearance sont des cubes de taille par défaut (200 unités)
- Les **belts** avec splines sont rendus comme des **box** (section carrée 30u)
- Les **pipes** avec splines sont rendus comme des **cylindres** (CylinderGeometry, 6 segments)
- Les **ConveyorLifts** sont rendus comme un shaft rectangulaire (30u section) + 2 cubes (50u) aux extrémités
- Les **lightweight buildables** (fondations, murs, rampes) sont chargés depuis le subsystem
- Les FGConveyorChainActor ne sont PAS inclus (les belts individuels ont leurs propres splines)

### Ports
Les ports de connexion (belt/pipe) sont visualisés sur les bâtiments :
- **Forme** : cube = belt, sphère = pipe
- **Couleur** : vert = input, orange = output
- **Taille** : gros + opaque = non connecté, petit + transparent = connecté
- **Direction** : cône pointant dans la direction du port (100u connecté, 200u non connecté)
- Toggle "Ports" dans le menu Layers (persisté localStorage)
- Les ports sont cliquables pour inspecter l'entité parente (mais pas sélectionnables)
- Les port layouts sont définis via `Builder.PORT_LAYOUT` sur chaque classe de builder dans `lib/`

### GridBox par entité
- Bouton grille dans le panneau propriétés (toggle on/off par entité)
- Grille 3D centrée sur l'entité, dimensionnée par sa clearance box, pas de 800u
- Mode d'alignement configurable dans Camera menu : axes de l'entité ou axes du monde
- Persisté en localStorage (`viewer_gridBoxAlign`)

## Contrôles

### Caméra
Contrôles FPS custom (pas d'OrbitControls ni CameraControls — incompatibles avec ce viewer).

| Action | Contrôle |
|---|---|
| Rotation caméra (yaw/pitch) | Clic gauche + drag |
| Inspection d'entité | Clic gauche sans bouger |
| Sélection d'entité | Ctrl + clic gauche |
| Sélection rectangulaire | Shift + clic gauche + drag |
| Ajouter à la sélection | Ctrl + shift + drag |
| Pan (déplacement plan caméra) | Clic droit + drag |
| Fermer panneau propriétés | Clic droit sans bouger |
| Zoom (avance/recule) | Molette |
| Sensibilité Zoom/Pan/Rot/Grid | Boutons −/+ dans Camera menu |

### Placement de blueprint
Quand un `.sbp` est chargé, le mode placement s'active :

| Touche | Action |
|---|---|
| Q / D | Translation X |
| Z / S | Translation Y |
| R / F | Translation Z (up/down) |
| A / E | Rotation Z (yaw) |
| Enter | Injecter le blueprint dans la save |
| Escape | Annuler le placement |

Modificateurs de sensibilité :
- Normal : 100u / 15°
- **Shift** : 10u / 1° (fin)
- **Ctrl** : 800u / 90° (grille fondation)

Le blueprint est affiché en cyan avec un repère RGB au centroïde (suit la rotation) et une gridBox alignée sur les axes du monde.

### Persistance caméra
Position de caméra sauvegardée dans `localStorage` toutes les 3 secondes, avec clé séparée pour save vs CBP.

### Persistance layers
L'état des toggles (catégories, terrain, grid, ports, CBP) est persisté dans `localStorage` sous la clé `viewer_layers`.

## Panneau propriétés (gauche)

Affiché au clic sur une entité ou un port :
- Nom de la save
- ClassName
- Catégorie (avec pastille couleur)
- Position X/Y/Z (coordonnées Unreal)
- Rotation quaternion
- Ports : nom, type (belt/pipe), flow (in/out), état connecté/déconnecté
- Index de l'entité
- Bouton **Copy** : copie un JSON sérialisé dans le presse-papier
- Bouton **GridBox** : toggle une grille 3D autour de l'entité
- Bouton **Close** (ou clic droit dans le vide)

## Panneau sélection (droite)

Affiché quand des entités sont sélectionnées :
- Compteur total
- Boutons d'action en haut : **Export** (blueprint), **Delete** (suppression), **Clear** (vider la sélection)
- Liste des classes sélectionnées groupées par type, avec compteur et bouton ✕ pour retirer une classe

## Export Blueprint

Le bouton Export dans le panneau de sélection :
1. Calcule le centroïde des entités sélectionnées
2. Extrait le yaw de la première entité pour aligner le blueprint avec la grille
3. Crée un blueprint via `Blueprint.create(name, cx, cy, cz, bpRotation)`
4. Clone les entités sélectionnées + leurs composants + lightweight buildables
5. Télécharge les fichiers `.sbp` et `.sbpcfg`

## Import Blueprint (.sbp)

1. Charger un `.sbp` via Open ou drag & drop
2. Le blueprint apparaît en overlay cyan au centre de la caméra
3. Déplacer/tourner avec le clavier (Q/D/Z/S/R/F/A/E + Shift/Ctrl)
4. **Enter** pour injecter dans la save en mémoire
5. **Escape** pour annuler
6. **File > Download Save** pour télécharger la save modifiée

Le serveur génère un dummy `.sbpcfg` pour parser le `.sbp` seul.

## Suppression d'entités

Le bouton Delete dans le panneau de sélection :
1. Confirmation dialog
2. `POST /api/edit` avec `{ entities: [{ index, deleted: true }, ...] }`
3. Le serveur soft-delete les entités (null dans items[], indices stables)
4. Le client reconstruit la scène via WS `entitiesDeleted`

## Icônes (Lucide)

Le viewer utilise [Lucide](https://lucide.dev) via CDN UMD. Les icônes sont rendues avec `<i data-lucide="icon-name" class="icon">` et activées par `lucide.createIcons()` via le helper `icons.js`. Appeler `refreshIcons(container)` après chaque mise à jour du DOM contenant des icônes.

## Modifier le viewer

### Ajouter une catégorie ou changer la classification
Modifier `CATEGORY_PATTERNS` dans `viewer/lib/entityData.js` (côté serveur) et `CAT_NAMES`/`CAT_COLORS` dans `viewer/public/js/engine/scene.js` (côté client).

### Ajouter des ports à un bâtiment
1. Ajouter `Builder.PORT_LAYOUT = PORTS;` dans le fichier du builder (après `Builder.Ports = ...`)
2. Enregistrer le builder dans `lib/Registry.js` si pas déjà fait
3. Les ports apparaîtront automatiquement dans le viewer

### Ajouter une API endpoint
Ajouter la route dans `viewer/server.js`. Utiliser `getSaveState()` et `getCbpState()` depuis `saveLoader.js`.

### Changer le rendu d'un type d'entité
Le rendu est déterminé par les champs de l'entité :
- `lift` : rendu en shaft + 2 cubes (ConveyorLift)
- `sp` + cat 2 : rendu en box-spline (belts)
- `sp` + autre cat : rendu en cylindre-spline (pipes, rails)
- `box` : clearance box par instance (beams)
- Sinon : clearance data de la classe ou cube par défaut

Pour un rendu custom, modifier `buildMeshes()` dans `entities.js`.