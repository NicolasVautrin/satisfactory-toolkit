# 3D Entity Viewer (Client)

Viewer Three.js pour visualiser les entités d'une save Satisfactory dans le navigateur. Sélection d'entités, inspection de propriétés, visualisation des ports, export/import de blueprints.

## Fichiers client

- `viewer/public/index.html` : point d'entrée, charge Three.js + Lucide icons via CDN
- `viewer/public/js/app.js` : orchestration client, handlers souris/clavier, wiring UI
- `viewer/public/js/engine/scene.js` : Three.js core, gameToViewer, constantes couleurs/catégories
- `viewer/public/js/engine/entities.js` : buildMeshes (boxes, belt splines, pipe splines, lifts), ports rendering
- `viewer/public/js/engine/selection.js` : raycasting, pickAt, pickPortAt, pickRect, sélection
- `viewer/public/js/engine/camera.js` : contrôles caméra FPS custom, persistance localStorage
- `viewer/public/js/engine/landscape.js` : base plane + streaming tuiles 3D landscape
- `viewer/public/js/engine/scenery.js` : rochers, resource nodes, fracking (InstancedMesh)
- `viewer/public/js/engine/batchGlb.js` : helper batch GLB (fetchBatchGlb, parseBatchResponse)
- `viewer/public/js/engine/meshCatalog.js` : chargement GLB buildings par LOD
- `viewer/public/js/engine/grid.js` : grille 3D de la scène (faces externes)
- `viewer/public/js/engine/placement.js` : placement interactif de blueprints (axes, clavier, bbox grid)
- `viewer/public/js/engine/entityGrid.js` : gridBox par entité (toggle world/entity alignment)
- `viewer/public/js/ui/toolbar.js` : barre de menus (File, Layers, Camera)
- `viewer/public/js/ui/filters.js` : toggles catégories/landscape/scenery/grid/ports/CBP (persistés localStorage)
- `viewer/public/js/ui/controls.js` : sensibilité caméra/grille, toggle gridBox alignment
- `viewer/public/js/ui/selPanel.js` : panneau sélection (droite) avec Export, Delete, Clear
- `viewer/public/js/ui/propsPanel.js` : panneau propriétés (gauche) avec Copy, GridBox, Close
- `viewer/public/js/ui/icons.js` : helper Lucide icons (refreshIcons)
- `viewer/public/js/upload.js` : upload fichiers + drag & drop

## Chargement des fichiers

Le viewer fonctionne par **upload client → serveur** :
1. L'utilisateur ouvre un fichier `.sav`, `.cbp` ou `.sbp` via le bouton **Open** ou par **drag & drop**
2. Le fichier est envoyé en POST binaire à `/api/game/upload` avec le nom en header `X-Save-Name`
3. Le serveur parse le fichier, construit les données d'entités, et renvoie le JSON
4. Le client reconstruit la scène 3D (clearMeshes + buildMeshes)

Le bouton **Refresh** (File menu) re-demande les données au serveur sans re-uploader.

## Conversion coordonnées Unreal → Three.js

- **Positions** : `gameToViewer(x, y, z) = Vector3(-x, y, z)` — réflexion axe X
- **Quaternions** : `(rx, ry, rz, rw) → (rx, -ry, -rz, rw)` — conjugaison pour la réflexion X

## Rendu Three.js

- **InstancedMesh** pour la performance (milliers d'entités)
- Les entités avec clearance data sont rendues comme des **box** (BoxGeometry)
- Les entités sans clearance sont des cubes de taille par défaut (200 unités)
- Les **belts** avec splines sont rendus comme des **box** (section carrée 30u)
- Les **pipes** avec splines sont rendus comme des **cylindres** (CylinderGeometry, 6 segments)
- Les **ConveyorLifts** sont rendus comme un shaft rectangulaire (30u section) + 2 cubes (50u) aux extrémités
- Les **lightweight buildables** (fondations, murs, rampes) sont chargés depuis le subsystem
- Les FGConveyorChainActor ne sont PAS inclus (les belts individuels ont leurs propres splines)

### Landscape

Chargement en 2 étapes :
1. **Base plane** : image JPEG assemblée de toute la map (`/api/viewer/landscape-map`), affichée immédiatement sur un PlaneGeometry avec UVs en viewer-space
2. **Streaming tuiles 3D** : batchs de 50 GLB (`POST /api/viewer/glb`), chargées par distance à la caméra après les autres layers

Matériau partagé `MeshLambertMaterial` avec la texture assemblée, UVs calculées en world-space.

### Scenery

Chargement par batchs de 100 GLB via `POST /api/viewer/glb` :
- **Resource nodes** : groupés par type de ressource, chaque type = 1 InstancedMesh coloré
- **Streaming actors** (rochers, falaises) : les meshes rock/cliff utilisent un ShaderMaterial avec projection de la texture landscape, les autres utilisent leur texture PNG ou un matériau flat
- **Fracking** : satellites groupés par ressource + cores

### Ports

Les ports de connexion (belt/pipe) sont visualisés sur les bâtiments :
- **Forme** : cube = belt, sphère = pipe
- **Couleur** : vert = input, orange = output
- **Taille** : gros + opaque = non connecté, petit + transparent = connecté
- **Direction** : cône pointant dans la direction du port (100u connecté, 200u non connecté)
- Toggle "Ports" dans le menu Layers (persisté localStorage)
- Les ports sont cliquables pour inspecter l'entité parente (mais pas sélectionnables)

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

### Persistance

- **Caméra** : position sauvegardée dans `localStorage` toutes les 3 secondes, clé séparée pour save vs CBP
- **Layers** : état des toggles (catégories, landscape, scenery, grid, ports, CBP) persisté sous `viewer_layers`
- **GridBox** : mode d'alignement (world/entity) persisté sous `viewer_gridBoxAlign`

## Panneaux UI

### Panneau propriétés (gauche)

Affiché au clic sur une entité ou un port :
- ClassName, catégorie, position, rotation, ports, index
- Boutons **Copy** (JSON), **GridBox** (grille 3D), **Close**

### Panneau sélection (droite)

Affiché quand des entités sont sélectionnées :
- Compteur total
- Boutons **Export** (blueprint), **Delete** (suppression), **Clear**
- Liste des classes groupées par type avec compteur

## Export Blueprint

1. Calcule le centroïde des entités sélectionnées
2. Crée un blueprint via `Blueprint.create(name, cx, cy, cz, bpRotation)`
3. Clone les entités + composants + lightweight buildables
4. Télécharge `.sbp` et `.sbpcfg`

## Import Blueprint (.sbp)

1. Charger un `.sbp` via Open ou drag & drop
2. Le blueprint apparaît en overlay cyan au centre de la caméra
3. Déplacer/tourner avec le clavier + Enter pour injecter, Escape pour annuler
4. **File > Download Save** pour télécharger la save modifiée

## Icônes (Lucide)

Le viewer utilise [Lucide](https://lucide.dev) via CDN UMD. Appeler `refreshIcons(container)` après chaque mise à jour du DOM contenant des icônes.

## Modifier le viewer

### Changer le rendu d'un type d'entité

Le rendu est déterminé par les champs de l'entité :
- `lift` : shaft + 2 cubes (ConveyorLift)
- `sp` + cat 2 : box-spline (belts)
- `sp` + autre cat : cylindre-spline (pipes, rails)
- `box` : clearance box par instance (beams)
- Sinon : clearance data de la classe ou cube par défaut

Pour un rendu custom, modifier `buildMeshes()` dans `entities.js`.

### Ajouter une catégorie
Modifier `CAT_NAMES`/`CAT_COLORS` dans `viewer/public/js/engine/scene.js`.
