# Pièges généraux : distance, téléportation, relief, électricité

## Ce que le jeu charge autour du joueur

- **Collisions des bâtiments** : seulement autour du joueur. Au-delà d'environ 100 m, un rayon traverse les rails et les fondations.
  - L'accroche d'un départ de rail et celle d'un signal fabriquent leur point touché sans rayon (`actorHit`).
  - Les recherches de connecteurs du jeu (`FindOverlappingConnections`, `FindAlignedConnections`) passent par les collisions. Loin du joueur, elles ne trouvent rien : voir `rails.md` (`railLink`) et `convoyeurs.md` (`belt` inscrit ses connecteurs).
- **Relief** : chargé bien plus loin. `ground` et `rays` marchent encore à 620 m, mais `ground` rendait `null` vers 1,9 km du joueur (21/10/2026). Pour construire au sol plus loin, il faut téléporter le joueur.
- **Pièces légères** (fondations, rampes, murs) : `lightweight(classe, centre, rayon)` les liste à toute distance, mais ne donne que leur position. Une rangée de fondations se reconnaît à ses centres alignés tous les 8 m.

## Téléportation

Seulement avec l'accord de l'utilisateur, pour la tournée demandée. Méthode éprouvée (tours radar, 21/10/2026) :
1. noter la position de départ (`player`) dans un fichier, pour pouvoir le ramener même si le script échoue ;
2. arriver « sur du dur », 3 m à côté d'un poteau ou d'une fondation existante, 2 m au-dessus. Le moteur décale la destination si elle est obstruée, et la refuse parfois : essayer alors l'autre côté, puis plus haut ;
3. attendre que le relief charge (`ground` non nul au point visé), puis quelques secondes pour les collisions des bâtiments ;
4. se reposer au sol à 20 m du chantier, pour ne pas gêner la pose (`FGCDEncroachingPlayer`) ;
5. ramener le joueur à son point de départ, dans un `finally`.

La cellule du monde d'un objet lointain peut mettre plus de 15 s à charger (ramassage de sphères, 18/10/2026).

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

## Pause, hôte, mémoire

- Jeu en pause : les appels expirent (« non exécuté »). Demander à l'utilisateur de reprendre la partie.
- Une commande de surveillance (`tail -f | grep`) ou une recherche abandonnée par l'outil continue de tourner. Un `grep` oublié sur le journal de session (300 Mo) a pris 25,8 Go et empêché Ghidra de démarrer. Arrêter ces processus dès qu'ils ne servent plus.
