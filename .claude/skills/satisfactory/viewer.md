# 3D Entity Viewer

Viewer Three.js pour visualiser les entités d'une save Satisfactory dans le navigateur. Permet la sélection d'entités et l'export en blueprint.

## Lancement

```bash
export PATH="/c/nvm4w/nodejs:/mingw64/bin:/usr/bin:$PATH"
node viewer/server.js <save-name>
# Ex: node viewer/server.js TEST
# → http://localhost:3000
```

Le serveur Express charge la save, extrait les entités/splines/clearance, et sert l'application sur le port 3000.

## Gestion du serveur

- Le serveur reste actif en arrière-plan tant qu'il n'est pas tué
- **Arrêter** : `curl -s -X POST http://localhost:3000/api/shutdown`
- **Kill forcé** (si shutdown ne répond pas) : `powershell -Command 'Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`
- **Redémarrer** après modifications de `viewer/server.js` : shutdown/kill, attendre 1s, relancer + hard reload (Ctrl+Shift+R) dans le navigateur
- Après modification de `viewer/public/index.html` : un simple hard reload suffit (pas besoin de redémarrer le serveur)
- Quand lancé via `run_in_background`, la notification `status: completed` signifie que le monitoring s'est terminé, **pas** que le serveur s'est arrêté — le serveur continue de tourner
- Les données sont cachées côté client après le premier chargement — le serveur n'est requis que pour le chargement initial et l'export

## Architecture

### Fichiers
- `viewer/server.js` : serveur Express, parsing de save, API REST
- `viewer/public/index.html` : rendu Three.js, contrôles caméra FPS custom, UI

### API REST (server.js)
| Endpoint | Méthode | Description |
|---|---|---|
| `/api/saves` | GET | Liste des saves disponibles (nom, taille, date) + save courante |
| `/api/load` | POST | Charge une save par nom (`{ name }`) |
| `/api/entities` | GET | Retourne les données d'entités préparées pour le client |
| `/api/export` | POST | Exporte une sélection en blueprint (`{ indices, name }`) |
| `/api/shutdown` | POST | Arrête le serveur |

### Données serveur → client
Le serveur prépare un objet compact pour le client :
- `classNames` : tableau des noms de classes uniques
- `clearance` : bounding boxes par index de classe (depuis `data/clearanceData.json`)
- `entities` : tableau d'objets `{ c, tx, ty, tz, rx, ry, rz, rw, cat, sp? }` où :
  - `c` = index dans classNames
  - `tx/ty/tz` = position, `rx/ry/rz/rw` = rotation quaternion
  - `cat` = catégorie (0-7)
  - `sp` = points de spline `[[x,y,z], ...]` (optionnel, pour belts/pipes/lifts/rails)

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
- Les belts, pipes, rails avec splines sont rendus comme des **cylindres** (CylinderGeometry, 6 segments) le long des points de spline
- Les ConveyorLifts sont rendus comme des splines verticales (bottom → top via `mTopTransform`)
- Les **lightweight buildables** (fondations, murs, rampes) sont chargés depuis le subsystem, pas depuis `levels[*].objects`
- Les FGConveyorChainActor ne sont PAS inclus (les belts individuels ont leurs propres splines)

### Splines
Le serveur extrait les splines Hermite (`mSplineData`) des entités, les échantillonne (3 samples par span), et les transforme en coordonnées monde via la rotation quaternion de l'entité. Le client reçoit directement les points monde.

## Contrôles caméra

Contrôles FPS custom (pas d'OrbitControls ni CameraControls — incompatibles avec ce viewer).

| Action | Contrôle |
|---|---|
| Rotation caméra (yaw/pitch) | Clic gauche + drag |
| Sélection d'entité | Clic gauche sans bouger |
| Sélection rectangulaire | Shift + clic gauche + drag |
| Pan (déplacement plan caméra) | Clic droit + drag |
| Zoom (avance/recule) | Molette |
| Sensibilité Zoom/Pan/Rot | Boutons −/+ dans la toolbar |

La vitesse de zoom (`flyStep`) est un pas fixe en unités, ajustable via les boutons −/+ (x2 par clic). La rotation et le pan sont gérés par des multiplicateurs de sensibilité.

### Persistance caméra
La position de caméra (position, yaw, pitch, flyStep) est sauvegardée dans `localStorage` toutes les 3 secondes, par save. Elle est restaurée automatiquement au chargement d'une save.

## Sélection et export

### Sélection
- **Clic** sur une entité : toggle sélection (raycaster sur InstancedMesh)
- **Shift + drag** : sélection rectangulaire (projection screen-space de toutes les entités visibles)
- **Ctrl + shift + drag** : ajoute à la sélection existante
- Les entités sélectionnées sont colorées en rouge (`#ff4444`)
- Un panneau latéral (280px) affiche les entités sélectionnées groupées par classe, avec compteur
- Possibilité de retirer une classe entière de la sélection via le bouton ✕

### Export Blueprint
Le bouton "Export Blueprint" (toolbar) exporte les entités sélectionnées :
1. Calcule le centroïde des entités sélectionnées
2. Crée un blueprint via `Blueprint.create(name, cx, cy, cz)`
3. Clone les entités sélectionnées + leurs composants associés
4. Écrit les fichiers `.sbp` et `.sbpcfg` dans le dossier blueprints du jeu

**Note** : seules les entités normales (pas lightweight) peuvent être exportées — le tableau `entities` du serveur ne contient que les entités avec index dans le tableau `entities` du parsing (les lightweight sont ajoutées après).

### Filtres par catégorie
Les checkboxes dans la toolbar permettent de masquer/afficher les catégories. Les catégories masquées ne sont pas sélectionnables (ni par clic ni par rectangle).

## Modifier le viewer

### Ajouter une catégorie ou changer la classification
Modifier `CATEGORY_PATTERNS` dans `viewer/server.js` (côté serveur) et `CAT_NAMES`/`CAT_COLORS` dans `viewer/public/index.html` (côté client).

### Changer le rendu d'un type d'entité
Le rendu est déterminé par la présence de `sp` (spline) dans les données :
- Avec `sp` : rendu en cylindres le long de la spline
- Sans `sp` : rendu en box (clearance data ou taille par défaut)

Pour un rendu custom, modifier `buildScene()` dans `index.html`.

### Ajouter une API endpoint
Ajouter la route dans `viewer/server.js`. Les variables `allObjects`, `entities`, `entityData` sont accessibles dans le scope du module.