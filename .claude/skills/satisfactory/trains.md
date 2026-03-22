# Trains et Réseau Ferré - Satisfactory 1.0

## Déblocage et prérequis

- Débloqué au **Tier 6** (Monorail Technologies)
- Nécessite : Computers, Heavy Modular Frames, Motors
- Les stations consomment **50 MW** en permanence et alimentent tout le réseau ferré connecté

## Composition des trains

### Ratio locomotive / wagons
- **Ratio recommandé : 1 locomotive pour 4 Freight Cars**
- Plus de wagons = accélération/freinage plus lents + mauvaises performances en montée
- Exemple : 5 freight cars -> utiliser 2 locomotives
- **Le poids d'un wagon est identique qu'il soit vide ou plein** (pas d'impact sur les performances)

### Capacité des wagons et plateformes

| | Freight Car (wagon) | Freight Platform (dock) |
|---|---|---|
| **Items** | 32 stacks | 48 stacks (1.5×) |
| **Fluides** | 1 600 m³ | 2 400 m³ (1.5×) |

- Ne jamais mélanger items et fluides dans un même wagon
- Le surplus de capacité du dock (50%) sert de buffer

## Construction des voies

### Dimensions et coûts
- Coût : 1 Steel Pipe + 1 Steel Beam pour les 18 premiers mètres, puis 1 de chaque par 12m supplémentaires
- Segment minimum : 12m (1.5 fondations)
- Segment maximum : 100m (12.5 fondations)
- Largeur : 6m
- Hauteur visuelle : 1.3m, hitbox : 0.5m (les rails passent sous les fondations)

### Virages
- Rayon de courbure minimum pour un virage à 90° : **17m** depuis le centre du rail
- Un demi-tour (180°) tient dans un espace de 5x2.5 fondations
- Si "Turning Radius too tight" apparaît : découper la courbe en segments de 45°
- Maintenir **Left Ctrl** pour des sections parfaitement droites

### Pentes
- Surface plane : 28m de dénivelé sur 94.5m (ratio 1:3.375)
- Sur rampes 2m : ratio 1:2.7
- Avec supports en poutre : ratio max 1:2.25
- Les rampes 4m ne supportent pas les rails directement

### Aiguillages (switches)
- Créés en joignant 2 segments puis en ajoutant un 3ème au point de jonction
- Maximum 3 branches par jonction
- Un Railroad Switch Control est placé automatiquement

### Transmission d'énergie
- Les rails conduisent l'électricité vers les locomotives et les stations
- Les simples croisements ne transmettent PAS l'énergie : il faut une jonction physique

## Signaux

### Deux types de signaux

#### Block Signal
- Divise le réseau en **blocs** entre chaque signal
- Quand un train occupe un bloc, le signal passe au **rouge** et aucun autre train ne peut entrer
- Fonctionne comme un feu tricolore simple
- Idéal pour les lignes droites et les doubles voies

#### Path Signal
- Plus avancé : utilise un système de **réservation de chemin**
- Plusieurs trains peuvent entrer dans le même bloc si leurs chemins **ne se croisent pas**
- Un train ne peut pas entrer s'il ne peut pas **sortir** du bloc (prévient les deadlocks)
- **Interdit** d'avoir une station dans un bloc contrôlé par un Path Signal
- Idéal pour les intersections et les zones à fort trafic

### Règles de placement

- **Les signaux sont directionnels !** Les trains ne peuvent PAS aller à contre-sens
- Pour une voie bidirectionnelle : signaux des DEUX côtés
- Touche **R** pour alterner placement gauche/droite
- Minimum 2 signaux opposés par jonction pour les voies bidirectionnelles
- Les signaux se clipsent aux jonctions de rails ou librement le long des segments (min 12m des extrémités)
- **Tous les signaux d'entrée d'un bloc doivent être du même type** (pas de mélange Block/Path)

### Règle d'or : "Path In, Block Out"
Pour les intersections complexes :
- **Path Signal** à l'entrée de l'intersection
- **Block Signal** à la sortie
- Empêche plusieurs signaux d'entrée de passer au vert simultanément

### États des signaux
- **Vert** : bloc libre (Block) ou chemin réservé (Path)
- **Rouge** : bloc occupé ou en attente de réservation
- **Erreur** : placement invalide, connexions manquantes, types de signaux mixés, station dans un bloc Path

### Espacement recommandé
- Blocs de **300 à 400m** sur les longues lignes droites
- L'espacement entre signaux doit être **au moins égal à la longueur du plus long train**
- Les trains freinent **250m** avant un signal rouge ; distance insuffisante = arrêt brutal

## Design de stations

### Composition d'une station
- 1 **Train Station** (toujours en premier)
- N **Freight Platforms** (1 par wagon) — configurer en "load" ou "unload"
- Des **Empty Platforms** pour espacer si certains wagons ne chargent pas à cette station
- Optionnel : **Fluid Freight Platforms** pour les fluides

### Règles importantes
- Les stations sont **directionnelles** : elles déterminent la direction d'arrivée (pas de départ)
- Pour les trains bidirectionnels : les deux stations doivent faire face à la fin de la voie
- **Construire la station AVANT de connecter les rails** pour éviter les problèmes d'alignement

### Buffering (critique !)
- Placer des **Industrial Storage Containers** avant chaque plateforme de chargement et après chaque plateforme de déchargement
- Raison : pendant l'animation de chargement/déchargement, la plateforme **bloque toutes les I/O pendant 27.08 secondes**
- Les Industrial Storage Containers correspondent parfaitement aux double entrées/sorties des Freight Platforms

### Séparation du trafic
- **Sortir les stations de la voie principale** pour ne pas bloquer les trains de passage
- Créer des bretelles d'entrée/sortie avec signaux appropriés
- Un train arrêté en station ne doit jamais bloquer la ligne principale

## Layout du réseau

### Double voie (recommandé)
- **Toujours utiliser des voies à sens unique** dès qu'il y a plus d'un train
- Deux voies parallèles, une dans chaque sens
- Choisir une convention (trafic à droite ou à gauche) et s'y tenir
- Évite les deadlocks et les collisions frontales

### Voie unique bidirectionnelle
- Acceptable uniquement pour un seul train
- Si plusieurs trains : ajouter des **voies de croisement** (passing lanes)
- Risque élevé de deadlock avec le pathfinding automatique

### Roundabouts (ronds-points)
- **Pas très compatibles avec les Path Signals** si trop compacts
- Option 1 : rond-point simple avec un seul train à la fois (pas de Path Signal)
- Option 2 : rond-point élargi avec sections entre entrées/sorties **plus longues que le plus long train**
- Les blocs après chaque sortie doivent pouvoir contenir le train le plus long

## Automatisation (timetables)

### Configuration
- Créer une entrée par station, dans l'ordre du parcours
- Chaque station mentionnée **une seule fois**
- Le train boucle automatiquement de la dernière à la première station

### Limitations
- Le timetable ne peut PAS imposer de conditions (ex: attendre d'être plein)
- Il définit uniquement la **séquence des arrêts**
- Le pathfinding automatique prend le chemin le plus court et **ignore les autres trains**

### Dépannage
- Si le pathfinding échoue : vérifier l'orientation des stations et la connexion des rails
- Tester manuellement en conduisant le train pour détecter les déconnexions
- Les trains ajoutent une pénalité de 200m aux chemins passant par des stations non utilisées

## Calcul de throughput

### Formule de base

**Temps de remplissage (TtF)** :
```
TtF = (Stack Size × 32) / Belt Speed + 0.4513 min
```

Le 0.4513 min (27.08s) correspond au lockout de la plateforme pendant l'animation.

### Deux cas de figure

**Si TtF >= Round-trip Duration (RtD)** (le train revient avant que le wagon soit plein) :
```
Throughput = ((RtD - 0.4513) / RtD) × Belt Speed
```

**Si TtF < RtD** (le wagon est plein avant le retour du train) :
```
Throughput = (TtF / RtD) × Belt Speed
```

### Throughput max théorique (belts Mk.5, 1560 items/min)

| Stack Size | Throughput max |
|-----------|---------------|
| 50        | 1 083 /min    |
| 100       | 1 279 /min    |
| 200       | 1 405 /min    |
| 500       | 1 494 /min    |

### Fluides
- Throughput max : **896.5 m³/min** par plateforme
- Avec recyclage de canisters (double wagons) : **1 793 m³/min**

### Dimensionner son train
```
Nombre de wagons = (throughput désiré × round trip time) / capacité par wagon
```

## Erreurs courantes à éviter

1. **Rails qui se touchent involontairement** : ils fusionnent dans le même bloc
2. **Signaux trop proches des stations** : cause des erreurs
3. **Voie bidirectionnelle avec un seul signal** : les trains ne peuvent aller que dans un sens
4. **Mélanger Block et Path sur les entrées d'un même bloc** : erreur de signal
5. **Path Signals sur terrain non plat** : bug de collision connu
6. **Oublier les buffers aux stations** : le lockout de 27s bloque toute la chaîne
7. **Segments de rail avec un switch aux deux extrémités** : bug connu, découper en deux segments

## Création programmatique avec satisfactoryLib

La librairie `satisfactoryLib.js` expose des modules pour créer un réseau ferré complet dans une save Satisfactory. Tous les modules sont dans `lib/railway/`.

### Modules disponibles

| Module               | Classe              | Description                                      |
|----------------------|---------------------|--------------------------------------------------|
| `RailroadTrack`      | `RailroadTrack`     | Segment de rail avec spline et 2 ports (TC0/TC1) |
| `TrainStation`       | `TrainStation`      | Station avec track intégré et nom sur la carte   |
| `BeltStation`        | `BeltStation`       | Plateforme cargo (2 belts I/O) — items           |
| `PipeStation`        | `PipeStation`       | Plateforme cargo (2 pipes I/O) — fluides         |
| `Locomotive`         | `Locomotive`        | Locomotive électrique (25 MW)                    |
| `FreightWagon`       | `FreightWagon`      | Wagon de fret avec inventaire                    |
| `Train`              | `Train`             | Entité logique : chaîne de véhicules + timetable |
| `RailroadSignal`     | `RailroadSignal`    | Signal Block ou Path                             |
| `RailroadEndStop`    | `RailroadEndStop`   | Butoir de fin de ligne                           |
| `RailroadSubsystem`  | `RailroadSubsystem` | Singleton : enregistrement stations + trains     |
| `RailwayHelper`      | (fonctions)         | `dock()` et `reposition()` pour les plateformes  |

### Import type

```js
const {
  TrainStation, BeltStation, PipeStation,
  RailroadTrack, RailroadSignal, RailroadEndStop,
  Locomotive, FreightWagon, Train,
  RailroadSubsystem, RailwayHelper, Vector3D,
  readFileAsArrayBuffer, writeSaveToFile, initSession,
} = require('./satisfactoryLib');
```

### Orientation des stations

Les stations ont un **rail intégré** de 1600 UU le long de l'axe **local -X**. L'origine du rail est à local `(800, 0, 0)`.

| Rotation (quaternion Z) | Direction face | local +X → world | TC0 | TC1 |
|-------------------------|---------------|-------------------|-----|-----|
| `z=0, w=1` (0°) | +X (est) | +X | ouest | est |
| `z=0.7071, w=0.7071` (+90°) | +Y (nord) | +Y | sud | nord |
| `z=-0.7071, w=0.7071` (-90°) | -Y (sud) | -Y | sud | nord |
| `z=1, w=0` (180°) | -X (ouest) | -X | est | ouest |

**⚠ Piège courant** : avec rotation -90° (`z=-0.7071`), `TC0` est **au sud** (à `center + (0, -800, 0)`) et `TC1` est **au nord** (à `center + (0, +800, 0)`). La direction du rail intégré pointe vers **+Y** (nord).

### Docking — layout résultant

`stationA.dockStation(beltA)` place la belt au **côté back** (side 0 = +X local) de la station.

Avec rotation -90° (face sud), la belt est au **sud** de la station :

```
  StationA.TC1 (nord, exposé)     ← entrée du train
  ── [StationA intégré] ──
  StationA.TC0 === BeltA.TC1      ← jonction interne (dock)
  ── [BeltA intégré] ──
  BeltA.TC0 (sud, exposé)         ← sortie du train
```

### Créer une station complète

```js
// Rotation : quaternion (ici 90° autour de Z)
const rot = { x: 0, y: 0, z: 0.7071, w: 0.7071 };

// Station principale (apparaît sur la carte avec son nom)
const station = TrainStation.create(x, y, z, rot, { name: 'Ma Gare' });

// Docking de plateformes cargo derrière la station
const belt1 = BeltStation.create(0, 0, 0); // position temporaire
station.dockStation(belt1);                 // auto-positionné par dock()

const belt2 = BeltStation.create(0, 0, 0);
belt1.dockStation(0, belt2);               // chaîner les plateformes

// Configurer le mode chargement/déchargement
belt1.setLoadMode(true);   // charge les items dans le train
belt2.setLoadMode(false);  // décharge les items du train
```

**`dockStation()`** repositionne automatiquement la plateforme, crée son track intégré, et connecte les PlatformConnections entre elles. Pas besoin de calculer les positions manuellement.

### Créer des segments de rail

```js
// Rail simple entre deux positions
const track = RailroadTrack.create(
  { pos: new Vector3D(x1, y1, z1), dir: new Vector3D(0, -1, 0) },  // départ + direction
  { pos: new Vector3D(x2, y2, z2), dir: new Vector3D(0, -1, 0) },  // arrivée + direction
);

// Les directions contrôlent la courbure de la spline
// Pour un rail droit : même direction aux deux extrémités
// Pour une courbe : directions différentes (ex: virage à 90°)
```

**Ports** : chaque track a `TrackConnection0` (début) et `TrackConnection1` (fin).

### Connecter des rails entre eux

```js
// Connexion simple (bout à bout)
track1.connect('TrackConnection1', track2, 'TrackConnection0');

// Récupérer le port d'une station pour s'y connecter
const exitPort = station.port('TrackConnection1');
const mainTrack = RailroadTrack.create(
  { pos: exitPort.pos, dir: exitPort.dir },
  { pos: destinationPos, dir: destinationDir },
);
station.track.connect('TrackConnection1', mainTrack, 'TrackConnection0');
```

### Créer un aiguillage (switch)

Un aiguillage se crée en connectant **plusieurs tracks au même port** :

```js
// Le port TrackConnection1 de stationA a maintenant 2 connexions = switch
stationA.track.connect('TrackConnection1', mainTrack,  'TrackConnection0');
stationA.track.connect('TrackConnection1', bypassTrack, 'TrackConnection0');
```

### Créer un bypass (demi-tour)

Pattern courant pour retourner un train à une station terminus :

```js
const exitPos  = station.port('TrackConnection1').pos;
const entryPos = belt.port('TrackConnection0').pos;
const midPoint = new Vector3D(
  exitPos.x - 3000,                      // décalage latéral
  (exitPos.y + entryPos.y) / 2,          // milieu
  z,
);

const bypass1 = RailroadTrack.create(
  { pos: exitPos,  dir: new Vector3D(0, -1, 0) },
  { pos: midPoint, dir: new Vector3D(0,  1, 0) },
);
const bypass2 = RailroadTrack.create(
  { pos: midPoint, dir: new Vector3D(0,  1, 0) },
  { pos: entryPos, dir: new Vector3D(0,  1, 0) },
);
bypass1.connect('TrackConnection1', bypass2, 'TrackConnection0');

// Raccorder aux switches de la station
station.track.connect('TrackConnection1', bypass1, 'TrackConnection0');
belt.track.connect('TrackConnection0', bypass2, 'TrackConnection1');
```

### Placer des signaux

```js
// Block Signal
const blockSig = RailroadSignal.create(x, y, z, rot);
// ou Path Signal
const pathSig = RailroadSignal.create(x, y, z, rot, { type: 'path' });

// Connecter le signal aux TrackConnections qu'il garde/observe
signal.setConnections(
  [guardedTrackConnectionPathName],   // mGuardedConnections
  [observedTrackConnectionPathName],  // mObservedConnections
);
```

### Créer un butoir (end stop)

```js
// Petit segment terminal + butoir
const stub = RailroadTrack.create(
  { pos: lastPos,    dir: direction },
  { pos: endStopPos, dir: direction },
);
lastTrack.connect('TrackConnection1', stub, 'TrackConnection0');

const endStop = RailroadEndStop.create(endStopPos.x, endStopPos.y, endStopPos.z, rot);
endStop.connectToTrack(stub, 'TrackConnection1');
```

### Créer un train avec timetable

```js
// Véhicules
const loco   = Locomotive.create(x, y, z, rot);
const wagon1 = FreightWagon.create(x, y, z, rot);
const wagon2 = FreightWagon.create(x, y, z, rot);

// Positionner sur un rail
loco.setTrackPosition(someTrack, 0, 1);    // offset 0, direction forward
wagon1.setTrackPosition(someTrack, 0, 1);
wagon2.setTrackPosition(someTrack, 0, 1);

// Créer le train avec timetable
// Les stops sont les instanceNames des FGTrainStationIdentifier
const train = Train.create(
  [loco, wagon1, wagon2],
  [stationA.stationId.instanceName, stationB.stationId.instanceName],
);

// Ou ajouter/modifier le timetable après coup
train.setTimeTable([stIdA, stIdB]);
```

`Train.create()` chaîne automatiquement les `vehicleInFront`/`vehicleBehind`.

### ⚠ Enregistrement obligatoire dans le RailroadSubsystem

**CRITIQUE** : Après création, les stations et trains doivent être **enregistrés** dans le singleton `RailroadSubsystem`. Sans cela :
- Les stations affichent **"Invalid Train Station Identifier"** en jeu
- Les trains ne sont pas gérés par le système ferroviaire

```js
const rrSub = RailroadSubsystem.find(allObjects);
rrSub.registerStation(stationA);   // → ajoute stationId à mTrainStationIdentifiers
rrSub.registerStation(stationB);
rrSub.registerTrain(train);        // → ajoute à mTrains
```

Le `RailroadSubsystem` n'existe que si la save contient déjà de l'infrastructure ferroviaire.

### Injecter dans la save

```js
// Enregistrer dans le subsystem AVANT d'injecter
const rrSub = RailroadSubsystem.find(allObjects);
rrSub.registerStation(stationA);
rrSub.registerStation(stationB);
rrSub.registerTrain(train);

// Collecter tous les objets
const objs = [
  ...stationA.allObjects(), ...belt1.allObjects(),
  ...stationB.allObjects(), ...belt2.allObjects(),
  ...mainTrack.allObjects(),
  ...endStop.allObjects(),
  ...train.allObjects(),
];

// Injecter dans le mainLevel
for (const obj of objs) {
  mainLevel.objects.push(obj);
}

// Sauvegarder (toujours avec suffixe _edit !)
writeSaveToFile(save, OUTPUT_SAV);
```

### Charger un réseau existant depuis une save

Chaque classe a une méthode `fromSave()` pour lire les objets existants :

```js
const allObjects = Object.values(save.levels).flatMap(l => l.objects);

// Trouver toutes les stations
const stations = allObjects
  .filter(o => o.typePath === TrainStation.TYPE_PATH)
  .map(o => TrainStation.fromSave(o, allObjects));

// Trouver tous les trains
const trains = allObjects
  .filter(o => o.typePath === Train.TYPE_TRAIN)
  .map(o => Train.fromSave(o, allObjects));
```

### Script d'inspection

`inspect/findRailway.js` — liste tous les objets ferroviaires d'une save avec leurs positions, rotations et propriétés.

### Checklist railway

1. ☐ Rotation correcte (`z=-0.7071` pour face sud, pas `z=+0.7071`)
2. ☐ Dock belt **après** positionnement de la station
3. ☐ Main track entre les bons ports (vérifier nord/sud avec les positions)
4. ☐ Bypasses avec tangentes correctes (U-turn : départ sud → arrivée nord)
5. ☐ Vérifier les jonctions (distance < 1 entre ports connectés)
6. ☐ Vérifier les aiguillages (≥2 `mConnectedComponents` sur les switch ports)
7. ☐ **`RailroadSubsystem.registerStation()`** pour chaque station
8. ☐ **`RailroadSubsystem.registerTrain()`** pour chaque train
9. ☐ `setTrackPosition()` pour chaque véhicule
10. ☐ Trouver le `ownerPlayerState` dans la save pour les véhicules

### Référence complète

Le test end-to-end `test/testRailway.js` montre un exemple complet avec :
- 2 gares avec BeltStations dockées
- 1 voie principale + 2 bypasses (demi-tours)
- Locomotive + FreightWagon avec timetable
- Enregistrement dans le RailroadSubsystem
- Vérification des jonctions et switches
- Injection dans la save

### Ports des plateformes

| Plateforme     | Ports belt/pipe                                       | Ports track          |
|----------------|-------------------------------------------------------|----------------------|
| `BeltStation`  | `Input0`, `Output0`, `Input1`, `Output1`              | `TrackConnection0/1` |
| `PipeStation`  | `PipeFactoryInput0/1`, `PipeFactoryOutput0/1`         | `TrackConnection0/1` |
| `TrainStation` | (aucun — pas de belt/pipe)                            | `TrackConnection0/1` |

## Sources

- [Railway - Official Wiki](https://satisfactory.wiki.gg/wiki/Railway)
- [Train Signals - Official Wiki](https://satisfactory.wiki.gg/wiki/Train_Signals)
- [Tutorial:Trains - Official Wiki](https://satisfactory.wiki.gg/wiki/Tutorial:Trains)
- [Tutorial:Train throughput - Official Wiki](https://satisfactory.wiki.gg/wiki/Tutorial:Train_throughput)
- [Train Signal Manual - Modding Docs](https://docs.ficsit.app/satisfactory-modding/latest/CommunityResources/TrainSignalGuide.html)
- [Train Logistics Guide - Supercraft](https://supercraft.host/article/satisfactory-train-logistics/)