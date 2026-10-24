# Commandes unitaires : `plans/fg.js`

Une commande correspond à une lecture ou à une action. Le résultat est en JSON. `node fg.js help` donne la liste à jour, tirée de l'en-tête du script.

```bash
node fg.js player | teleport <point> [cap] | markers [motif]     # markers : balises de la carte du jeu
node fg.js markers-add <nom> <point> [icone] | markers-remove <motif>   # pose / supprime des balises (AFGMapManager)
node fg.js save [etiquette]                              # sauvegarde nommee agent_<jjmmaa>_<hhmmss>[_<etiquette>], attend le .sav
node fg.js scan <classe> [--near <point|acteur>] [--radius m] [--limit n]
node fg.js pose|bounds|dump|rails|ports|signals <acteur...>   # dump <acteur> [champ...] ; fields <classe> [motif]
node fg.js load-mode <quai...> [load|unload]  |  dismantle <acteur...>
node fg.js call <fonction> [arg...]                      # appel brut de n'importe quelle fonction de l'agent
```

- **`<acteur>`** : un nom court (`Build_TrainStation_C_2146896367`) suffit.
- **`<point>`** : `x,y,z` en coordonnées monde, ou `@u,v,z` dans le repère d'une gare donné par `--frame <gare>[+décalage]`.
- **`--frame`** : chaque position du résultat est aussi donnée dans ce repère (`locationUvz`).
- **`scan <classe>`** accepte une classe de base : `FGBuildablePowerPole` rend tous les poteaux et pylônes, `FGResourceNode` tous les gisements. Les classes C++ s'écrivent sans leur préfixe `A` ou `U` (`FGRailroadSubsystem`, `FGMapManager`).
- **`fields <classe> [motif]`** : pour un bâtiment, utiliser la classe du blueprint (`Build_RadarTower_C`). Pour une classe C++, le nom sans préfixe (`FGRailroadTrackHologram`).
- **`bounds`** : boîte englobante dans le repère de l'acteur (sans son échelle, à lire sur `RootComponent.RelativeScale3D`), avec sa pose. Sert à mesurer un plan d'eau (`FGWaterVolume`) : son centre ne dit rien de son étendue.
- **`dump <acteur> <champ>`** avec un tableau : `--depth 0` en donne seulement la taille (`<N elements>`). Utile avant de lire un grand tableau, comme le brouillard de guerre de `FGMapManager.mFogOfWarRawData`, qui fait 512 × 512 × 4 octets.

## Sauvegarde

`node fg.js save <etiquette>` appelle `UFGSaveSession::SaveGame`, comme le menu du jeu. La sauvegarde est écrite au tick suivant : le jeu ne doit pas être en pause, sinon elle est écrite tout de suite. La commande attend que le fichier `.sav` du dossier `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\<compte>\` ait une taille stable, 60 s au plus. Une sauvegarde complète pèse autant que les sauvegardes automatiques du jeu, environ 8,5 Mo au 21/10/2026. Elle apparaît dans le menu de chargement, sous la session en cours. C'est l'utilisateur qui la recharge.

## Répartiteur intelligent

`node fg.js call smartRules <répartiteur> '[{"item":"any","output":0},{"item":"overflow","output":1}]'` remplace ses règles de tri.
- `item` : `any`, `overflow`, `none`, `undefined`, ou le chemin d'une classe d'objet.
- Sans règles, la commande lit les règles en place.
- `output` 0 = centre (`Output1`), 1 = `Output2` : vérifié au débit le 21/10/2026 (trop-plein mis sur 1, seul `Output2` raccordé, la foreuse en amont n'est plus bloquée). 2 = `Output3`, par déduction.
- Le trop-plein ne part que si les autres sorties sont bloquées et que le tampon du répartiteur est au moins à moitié plein.

## Noms des gares

`node fg.js rename <gare> <nom>` renomme une gare comme son panneau dans le jeu (`AFGTrainStationIdentifier::SetStationName`, nom fabriqué par `FText::FromString` du module Core). Le jeu filtre le texte puis applique le nom dans un rappel : la commande relit `mStationName` une seconde après.

Nom par défaut d'une nouvelle gare : la RPC `generateStationName` rend ce que le jeu proposerait (« Train Station 43 » le 24/10/2026, avec 42 gares). Règle lue dans Ghidra (`AFGRailroadSubsystem::GenerateStationName`) :
- première gare : le premier nom de la liste `mStationNames` (47 noms de villes) ;
- moins de 20 gares : un nom de cette liste tiré au hasard, le premier libre à partir de ce tirage ;
- sinon « Train Station N », avec N = nombre de gares + 1, en sautant les noms déjà portés à l'identique (`IsStationNameAvailable` compare le nom entier, sans tenir compte de la casse) ;
- 199 gares : « Train Simulator ».

Un nom choisi par l'utilisateur ne bloque donc pas le numéro du jeu, et un démontage de gare fait reculer le numéro proposé : ce numéro ne peut pas servir d'identifiant.

**Nommage de nos gares par leurs coordonnées** (règle de l'utilisateur, 24/10/2026, appliquée aux gares 25 à 43) :
- code = `N` ou `S` puis |y| en dizaines de mètres, `E` ou `O` puis |x| en dizaines de mètres, à la position du bâtiment de la gare (nord = -Y, est = +X). Exemple : `N211 O143` ;
- gares superposées (même code qu'une autre gare) : on ajoute ` h` puis l'altitude en dizaines de mètres, `N266 E126 h0`, `h3`, `h5` pour les trois étages de la gare de triage ;
- les trains vont par couples de gares (mêmes quais dans le même ordre) : la gare de chargement s'appelle `<code> -> <code du partenaire>`, celle de déchargement `<code> <- <code du partenaire>` ;
- les gares aux noms de villes restent comme elles sont.

`node fg.js nom-gare <gare> [--vers <partenaire> | --depuis <partenaire>] [--appliquer]` calcule ce nom (`--vers` : gare de chargement, `--depuis` : gare de déchargement). Avec `--appliquer`, il renomme la gare et relit le nom appliqué. Sans, il affiche seulement le nom actuel et le nom calculé.

Le jeu accepte ces noms en entier : 25 caractères au plus pour l'instant, relus après renommage. Les anciens numéros (25 à 43) restent dans les notes antérieures au 24/10/2026. Correspondance : 25 = N279 E331, 26 = N248 E258, 27 = N266 E126 h0, 28 = N258 E122 h0, 29 = N266 E126 h3, 30 = N258 E122 h3, 31 = N266 E126 h5, 32 = N258 E122 h5, 33 = N266 E102 h0, 34 = N258 E98 h0, 35 = N266 E102 h3, 36 = N258 E98 h3, 37 = N266 E102 h5, 38 = N258 E98 h5, 39 = N211 O96, 40 = N126 O39, 41 = N211 O119, 42 = N211 O143, 43 = N85 E78.

## Plans du jeu (blueprints) hors gabarit

La limite de taille est celle du concepteur, pas de la pose : un plan de 218 m se pose au pistolet sans problème.

- **Fabrication** : `blueprintFromActors(nom, bâtiments)` appelle `UFGCheatManager::Server_SaveDismantleSelectionToBlueprint_Implementation`. C'est la commande de développeur qui fait un plan de la sélection du pistolet de démontage : écriture du `.sbp` dans `SaveGames/blueprints/<session>/`, relecture des plans, puis au tick suivant le plan est mis en main dans le pistolet. Le code a été lu dans Ghidra. Elle est appelée sur un gestionnaire de triche créé à part (`UGameplayStatics::SpawnObject`, classe `CheatClass` du contrôleur, propriétaire = contrôleur), sans l'installer comme `CheatManager` : les triches restent désactivées (vérifié).
- **Voies intégrées** : une gare ou un quai posé depuis un plan ne refait pas sa voie. Il faut mettre dans la liste les voies intégrées (`Build_RailroadTrackIntegrated_C`, état railplan `integrated`). Sans elles, gare et quais se posent sans rails (constaté le 24/10/2026).
- **Gabarit** : la commande en fait un cube, d'arête égale à la moitié de la plus grande dimension (13 cases de 8 m pour 194 m). Les dimensions sont les entiers 32 bits aux octets 12, 16 et 20 du `.sbp`, après headerVersion, saveVersion et buildVersion, en cases de 8 m (4 × 4 × 4 = concepteur Mk1). On les corrige dans le fichier, puis dans le descripteur déjà chargé avec `blueprintDimensions` : la relecture des plans ne le met pas à jour. Le gabarit suit les axes du monde ; pour une boîte ajustée, faire le plan d'une copie posée nord-sud ou est-ouest.
- **Pose** : `blueprintPlacement` s'accroche à `AFGBlueprintHologram::GetRotationStep` (molette : 1° par cran, Maj : 10° ; 90° gardé quand le plan est accroché à un autre) et à `AFGHologram::ScrollRotate`. Le jeu fournit le verrouillage (touche H), puis la translation fine aux flèches et la hauteur avec Page haut / Page bas. Mais `ScrollRotate` ne fait rien sur un hologramme verrouillé (lu dans Ghidra) : l'accroche fait tourner sur place le plan verrouillé et met à jour `mScrollRotation`, pour qu'il ne saute pas au déverrouillage.
- Le plan « G15 gare v2 » (gare-contournement en miroir, écart 6,5 m, 43 bâtiments, gabarit 8 × 28 × 4) a été fait ainsi le 24/10/2026.

## Étiquettes Unreal

`node fg.js tags <acteur> [étiquette...]` lit ou remplace les étiquettes d'un acteur (`AActor::Tags`) ; `--vider` les enlève toutes. Elles servent à noter sur une gare ce qu'elle doit recevoir ou charger (choix de l'utilisateur, 23/10/2026).

- Le jeu ne les sauvegarde pas de lui-même : la propriété n'a pas le drapeau `CPF_SaveGame`. L'agent le pose à son démarrage (`install` rend `tagsSaveGame: true`). Le drapeau est cherché comme le décalage des propriétés : à l'endroit où des propriétés connues ont les drapeaux attendus (0x38 dans `FProperty` le 23/10/2026).
- Vérifié le 23/10/2026 : étiquette absente de la sauvegarde sans le drapeau, présente avec (propriété `Tags`, tableau de noms, dans l'enregistrement de la gare), puis relue en jeu après chargement de cette sauvegarde par l'utilisateur.
- **Lancer l'agent au menu principal, avant de charger une partie** (vérifié le 23/10/2026 : l'agent s'installe au menu, et l'étiquette est conservée au chargement). Chargée sans l'agent, une partie se charge normalement mais **perd ses étiquettes** (vérifié depuis une sauvegarde automatique), et la sauvegarde suivante ne les a plus. Les sauvegardes automatiques contiennent les étiquettes comme les manuelles.
- Pour chercher un texte dans un `.sav` (le lecteur npm du dépôt ne lit pas le format 1.2) : repérer les blocs par leur signature `C1 83 2A 9E`, décompresser (zlib) les données de chacun, mettre bout à bout, chercher.

## RPC utiles (via `fg.js call` ou `client.js`)

| RPC | Rôle |
|---|---|
| `ground(x, y, zHaut, zBas)` | altitude du relief ; `null` si le terrain n'est pas chargé, vers 1,9 km du joueur |
| `rays(segments, {who: true})` | lancers de rayons en lot ; `who` rend le composant touché |
| `sweeps([{from, to, half, yaw?, pitch?}])` | balayages de boîtes (demi-côtés en uu, axe X le long du trajet) avec la collision réelle ; rend le premier contact et le composant touché |
| `overlaps([{center, half, yaw?, pitch?}])` | une boîte posée touche-t-elle un obstacle bloquant ? |
| `relief(x0, y0, nx, ny, pas, zHaut, zBas)` | grille du relief naturel (relief et rochers), en traversant bâtiments et végétation (comptés dans `skipped`) ; environ 1 ms par maille |
| `check(recette, de, vers)` | pose à blanc : disqualificateurs du jeu, rien n'est construit |
| `buildAim(recette, de, vers, opts)` | construit à l'endroit visé si le jeu valide (`opts.onActor` : sur ce bâtiment, même loin) |
| `wire(a, b)` | câble entre deux bâtiments, ou un connecteur nommé (`<pylône>.PowerTowerConnection`) |
| `power(acteur)` | connecteur électrique : câbles, circuit, courant |
| `powerReach(depart, exclus, cible)` | parcours du réseau électrique jusqu'à un générateur |
| `lightweight(classe, centre, rayon)` | pièces légères (fondations, rampes...) : positions ; `lightweightRemove` les retire ; classe = chemin complet ou nom court (`Build_Foundation_8x1_01_C`) |
| `bubble(centre, rayon, classesLegeres)` | tout ce qui est dans une sphère : bâtiments, véhicules ferroviaires, pièces légères des classes données |
| `dismantleMany(chemins, force)` | démontage en série en un appel ; accepte locomotives et wagons (leur disparition prend une seconde) |
| `outline(chemins, couleur, montrer)` | contour du pistolet de démontage (`UFGOutlineComponent::ShowOutline`) ; couleurs lues dans l'enum `EOutlineColor` (`OC_RED`, `OC_DISMANTLE`...) |
| `sphere(centre, rayon)` / `sphereRemove(chemins)` | bulle visible : deux sphères d'hologramme (vue du dehors et du dedans), décor non sauvegardé |
| `powerLinks(chemins)` | voisins électriques directs de chaque acteur (câbles et liaisons internes) |
| `upstream(...)` | rend aussi `passives` : convoyeurs, raccords et stockages traversés (utile pour démonter une chaîne) |
| `railLink(sous-système, railA, connA, railB, connB)` | relie deux connecteurs de rail sans collision ; voir `rails.md` |
| `flushPipeNetwork(PipeSubsystem, n° de réseau)` | vide les tuyaux d'un réseau, comme le bouton « Purger » ; n° de réseau : `mPipeNetworkID` d'un connecteur de tuyau |
| `flushIntegrant(PipeSubsystem, bâtiment)` | vide le contenu d'un réservoir ou d'un tampon. La purge du réseau ne le fait pas |
| `fluidContent(réservoir)` | contenu et capacité d'un réservoir ou d'un tampon, en m³ (`mFluidBox` n'est pas lisible par réflexion) |
| `exportsMatching(motif, max)` | noms décorés des fonctions exportées du jeu, pour retrouver une fonction sans adresse |
| `saveGame(nom)` | sauvegarde nommée, sans attente (préférer `fg.js save`) |
| `renameStation(gare, nom)` | nom d'une gare (préférer `fg.js rename`, qui relit le nom appliqué) |
| `generateStationName(RailroadSubsystem, n)` | nom que le jeu donnerait à une nouvelle gare (`AFGRailroadSubsystem::GenerateStationName`), n appels |
| `ghost(blocs, opts)` / `ghostSet` / `ghostGet` / `ghostRemove` | fantôme d'un plan en blocs d'hologramme qui suit la visée (outil `plans/fantome.js`) |
| `blueprintFromActors(nom, bâtiments)` | plan du jeu fait d'une liste de bâtiments, sans gabarit du concepteur (voir « Plans du jeu ») |
| `blueprintRefresh(BlueprintSubsystem, nom)` | relecture des plans par le jeu ; rend le descripteur du plan |
| `blueprintDimensions(descripteur, {X,Y,Z})` | gabarit d'un plan déjà chargé, en cases de 8 m |
| `blueprintPlacement({on})` | pose des plans au pistolet : rotation de 1° par cran, même verrouillé (touche H) |
| `streamingSourceAdd([points])` / `streamingSources()` / `streamingSourceRemove([chemins])` | charge les cellules World Partition (rochers, collisions) autour de points lointains, sans déplacer le joueur (voir `pieges.md`) |
| `tags(acteur, [noms])` | étiquettes Unreal d'un acteur (`AActor::Tags`), lues ou remplacées (préférer `fg.js tags`) |
| `saveGameFlag(struct, propriété, on)` | lit, pose ou enlève le drapeau « à sauvegarder » (`CPF_SaveGame`) d'une propriété, en mémoire seulement |
| `addMapMarkers` / `removeMapMarkers` | balises (préférer `markers-add` / `markers-remove`) |
| `smartRules`, `setClock`, `pauseMany`, `addItems` | réglages des machines ; `addItems` fabrique des objets : seulement avec l'accord de l'utilisateur |
