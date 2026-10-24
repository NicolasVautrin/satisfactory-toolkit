# Pièges généraux : distance, téléportation, relief, électricité

## Ce que le jeu charge autour du joueur

- **Collisions des bâtiments** : seulement autour du joueur. Au-delà d'environ 100 m, un rayon traverse les rails et les fondations.
  - L'accroche d'un départ de rail et celle d'un signal fabriquent leur point touché sans rayon (`actorHit`).
  - Les recherches de connecteurs du jeu (`FindOverlappingConnections`, `FindAlignedConnections`) passent par les collisions. Loin du joueur, elles ne trouvent rien : voir `rails.md` (`railLink`) et `convoyeurs.md` (`belt` inscrit ses connecteurs).
- **Relief** : chargé bien plus loin. `ground` et `rays` marchent encore à 620 m, mais `ground` rendait `null` vers 1,9 km du joueur (21/10/2026). Pour construire au sol plus loin, il faut téléporter le joueur.
- **Rochers et falaises** (`FGCliffActor`, `StaticMeshActor`) : la carte est en **World Partition** (`FGWorldSettings.WorldPartition_0.FGWorldPartitionRuntimeSpatialHash_0`, champ `StreamingGrids`, lu par réflexion). Chaque cellule est lue sur le disque quand une **source de streaming** est à portée ; le contrôleur du joueur en est une. Le 24/10/2026, 312 falaises sur 7 070 étaient en mémoire, et un relevé fait à 430 m du joueur ne voyait pas un massif de 200 m.

  | Grille | Cellule | Chargée à moins de |
  |---|---|---|
  | MainGrid (la plupart des rochers) | 128 m | 256 m |
  | ExplorationGrid | 205 m | 410 m |
  | ExplorationGridFar | 205 m | 1 000 m |
  | FoliageGrid | 265 m | 512 m |
  | LandscapeGrid | 512 m | 1 024 m |
  | HLOD0_256m_1023m (décor simplifié vu de loin, sans collision) | 256 m | 1 024 m |

  **Charger une zone sans déplacer le joueur** : RPC `streamingSourceAdd([{x,y,z}...])`. Elle pose un acteur invisible, sans collision et non sauvegardé, portant un `UWorldPartitionStreamingSourceComponent` (ajouté par `AActor::AddComponentByClass`). `streamingSources()` dit si le chargement est fini (`IsStreamingCompleted`), `streamingSourceRemove([chemins])` retire les sources. Essai à 1,4 km du joueur : 0 puis 30 falaises à moins de 150 m, en quelques secondes. `tracer.js` s'en sert à chaque relevé du relief (`loadArea` : sources tous les 300 m au plus, cache `relief4_`).
- **Pièces légères** (fondations, rampes, murs) : `lightweight(classe, centre, rayon)` les liste à toute distance, mais ne donne que leur position. Une rangée de fondations se reconnaît à ses centres alignés tous les 8 m.

## Téléportation

Seulement avec l'accord de l'utilisateur, pour la tournée demandée. Méthode éprouvée (tours radar, 21/10/2026) :
1. noter la position de départ (`player`) dans un fichier, pour pouvoir le ramener même si le script échoue ;
2. arriver « sur du dur », 3 m à côté d'un poteau ou d'une fondation existante, 2 m au-dessus. Le moteur décale la destination si elle est obstruée, et la refuse parfois : essayer alors l'autre côté, puis plus haut ;
3. attendre que le relief charge (`ground` non nul au point visé), puis quelques secondes pour les collisions des bâtiments ;
4. se reposer au sol à 20 m du chantier, pour ne pas gêner la pose (`FGCDEncroachingPlayer`) ;
5. ramener le joueur à son point de départ, dans un `finally`.

La cellule du monde d'un objet lointain peut mettre plus de 15 s à charger (ramassage de sphères, 18/10/2026).

Vers un point lointain (plus de 1,9 km) dont l'altitude est inconnue (balise posée sur la carte, z 0), le relief ne se charge qu'une fois le joueur arrivé. Le joueur posé en l'air tombe pendant l'attente : le 23/10/2026, il était passé de 500 à 169 m en 36 s. Sonder **à côté** de sa colonne, car un rayon à sa verticale touche le joueur lui-même (`PlayerNameWidget`, maillage du personnage), sonder souvent, et poser dès que le relief répond.

## Extracteur d'eau loin du joueur

`FGCDNeedsWaterVolume` : posé par `build` (transformation), l'extracteur est toujours refusé, même près du joueur. Posé par une visée, il l'est loin du joueur, parce que la visée ne touche plus rien (terrain non chargé). Solution vérifiée à blanc le 22/10/2026 à 1,6 km : `buildAim` avec `opts.onActor` = le volume d'eau (`FGWaterVolume_7` pour la mer du nord, 1 568 × 2 530 m, surface -17,3 m). Le point touché fabriqué sur ce volume suffit à `AFGWaterPumpHologram`. Le volume qui contient un point se trouve avec la boîte de `bounds` multipliée par `RelativeScale3D` de sa racine (scratchpad `volume-eau.js`). Les extracteurs de l'utilisateur ont leur pied à -18,15 m : viser ce z.

## Colonnes d'eau verticales et pompes

- Un tuyau peut monter à la verticale. On le pose de la sortie de l'extracteur, tournée vers sa jonction, jusqu'à la jonction de colonne insérée dans la ligne d'eau, à environ 3 m à l'horizontale. Le jeu fait un court coude puis une montée verticale.
- **L'extracteur ne pousse l'eau qu'à 10 m au-dessus de sa sortie** (sortie à -14,9 m, donc jusqu'à -4,9 m). La première pompe doit être sous cette limite. On la pose donc à une altitude donnée, pas à une fraction du tuyau. Le 22/10/2026, une Mk2 posée au quart d'une colonne de 52 m s'est retrouvée à -1,9 m, et l'étage 1 bis est resté sans eau.
- Hauteurs retenues :
  - étage 1 : Mk1 à -10 m ;
  - étage 1 bis : Mk2 à -12,5 m (50 m de poussée, lu en jeu ; 55 au maximum), puis Mk1 à +20 m.
- Une Mk2 posée dans le coude de la colonne est refusée (`FGCDPipeAttachmentTooSharpTurn`).
- Quand on retire une pompe, le jeu recolle les deux moitiés en un seul tuyau. Quand on en insère une, il crée deux tuyaux nouveaux, inconnus de l'agent : pour les démonter, il faut `dismantle` avec `force`.

## Sol refusé

`FGCDInvalidFloor` : le point est trop en pente ou dans l'eau. Chercher autour, en spirale par pas de 5 m, le point accepté par `check` le plus proche, en gardant les contraintes du plan. Exemple : une tour radar doit rester à moins de 990 m de ses gisements.

## Électricité

- Câbles (lu en jeu sur `Build_PowerLine_C`) :
  - 100 m au plus entre poteaux ;
  - 300 m entre pylônes (`mMaxPowerTowerLength`).
- Un pylône a deux connecteurs :
  - `PowerConnection` : 4 câbles, vers des poteaux, 100 m au plus ;
  - `PowerTowerConnection` : 3 liaisons entre pylônes, 300 m au plus.
- `wire` accepte un chemin de connecteur : `<pylône>.PowerTowerConnection`.
- Une machine n'accepte qu'un câble : pas de chaîne machine vers machine, il faut un poteau (Mk3 = 10 câbles).
- Le câble se mesure en 3D. Entre deux plateaux séparés par un ravin, un poteau au fond est trop loin des deux bords. Poser les poteaux sur le profil du sol relevé (tous les 5 m), avec des portées de 90 m au plus, en préférant les points hauts. Contrôler avec `power` : un câble refusé ne lève pas toujours d'erreur.
- `powerReach(depart, exclus, cible)` dit si un bâtiment atteint encore un générateur sans passer par les bâtiments exclus. Il sert avant de retirer des poteaux.

## Tours radar

Relevé en jeu le 21/10/2026 :
- **Rayon** : `mRevealRadius` vaut 1 km, mesuré à l'horizontale.
- **Ce qu'une tour détecte** : les gisements `BP_ResourceNode_C` et le centre des puits de fracturation (`FGResourceNodeFrackingCore`).
- **Ce qu'elle ne détecte pas** : les geysers, les puits satellites, les dépôts `BP_ResourceDeposit`.
- **Sans courant**, une tour ne détecte rien.
- `mScannedResourceNodes` liste ce que chaque tour détecte. 13 tours couvrent les 476 gisements détectables.

## Sauvegardes

- Une sauvegarde nommée (`fg.js save`) lancée en même temps que la sauvegarde automatique du jeu (toutes les 5 min) n'est pas écrite : relancer `save` (22/10/2026).
- Le lecteur du projet (`@etothepii/satisfactory-file-parser` 3.3.1) ne lit plus les sauvegardes de cette partie depuis le 19/10/2026 (« Unknown object type 1718788 ») : format de la version du jeu. Pour l'agent, lire le monde en jeu (`bubble`, `scan`, `lightweight`).

## Pause, hôte, mémoire

- Jeu en pause : les appels expirent (« non exécuté »). Demander à l'utilisateur de reprendre la partie.
- Une commande de surveillance (`tail -f | grep`) ou une recherche abandonnée par l'outil continue de tourner. Un `grep` oublié sur le journal de session (300 Mo) a pris 25,8 Go et empêché Ghidra de démarrer. Arrêter ces processus dès qu'ils ne servent plus.
