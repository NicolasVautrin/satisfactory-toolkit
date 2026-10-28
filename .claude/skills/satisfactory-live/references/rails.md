# Voies ferrées : `plans/railplan.js`

## Sommaire
- Tracé automatique : `plans/tracer.js`
- Plans de voies (repère, commandes, `check`, greffe sur une ligne existante)
- Raccords et distance du joueur, `railLink`
- Blocs fusionnés, relief, pose par zones
- Gare de triage en anneaux
- Modèle de gare validé
- Hélices
- Pièges propres aux rails (aiguillages, quais, démontage, points libres)
- Conventions de signalisation (convergences, blocs de chemin, gares, lignes)

## Tracé automatique : `plans/tracer.js`

Une ligne entre deux poses se calcule, elle ne se dessine pas à la main. L'utilisateur demande un outil déterministe, « capable de se faufiler à travers des mesh » (22/10/2026). Il ne veut pas voir le tracé avant la pose : « pas besoin de me montrer le tracé, réalise-le ».

```bash
node tracer.js rail --de x,y,z@cap --a x,y,z@cap --nom <nom> [--double] [--aller-de <rail>.<connecteur>] [--retour-a <rail>.<connecteur>]
node tracer.js valider <nom>          # balayage du gabarit avec la collision réelle du jeu
node railplan.js layouts/trace.js check|build --origin 0,0,0 --axis 0 --nom <nom> --trace <nom>
node verif-plan.js --plan layouts/trace --origin 0,0,0 --axis 0 --nom <nom> --trace <nom>
```

- **Monde** :
  - Relief et rochers : grille de 4 m relevée par la RPC `relief`, qui traverse bâtiments et végétation.
  - Bâtiments : boîtes d'encombrement, connues à toute distance.
  - Câbles et poteaux électriques : ignorés, transparents comme la végétation (utilisateur, 23/10/2026 ; pas de collision en jeu pour les câbles).
  - Surplombs (arches de roche) : sous une maille plus haute de 8 m que ses voisines, un rayon descendant jusqu'au relief puis un rayon montant cherchent le dessous de la roche. La maille prend l'altitude du sol, et la roche reste un obstacle à sa hauteur seulement. Les bâtiments sous la roche sont traversés.
  - Sol rocheux (falaise `CliffMesh` et non relief nu `Landscape`) : le rayon descendant s'y arrête s'il est au niveau du sol de la maille voisine (6 m près) et qu'un balayage horizontal à 2 m au-dessus l'y relie à l'air libre. Sinon, c'est l'intérieur d'un rocher. Une maille rejetée au premier sondage peut encore être reconnue de proche en proche depuis un surplomb voisin. Avant le 25/10/2026, seul le `Landscape` comptait : sur le plateau de cuivre de S13 E101, la cime d'un arbre géant (`TitanTree`, 222 à 242 m au-dessus d'un sol de falaise à 162 m) était vue comme un massif plein, et `courant.js` contournait par la cuvette. Le cache est passé de `relief4` à `relief5`.
  - Rails, convoyeurs et tuyaux : courbes échantillonnées.
- **Tracé dessiné à la main** : quand le traceur zigzague ou finit par un S d'un seul rail (les deux voies d'une double voie s'y rapprochent sous 6,2 m), écrire les joints dans `traces/<nom>.json` par un script : caps multiples de 10°, 20° de virage au plus par rail, 12 à 90 m. Le contrôler avec `node tracer.js controler <nom>`, qui utilise le modèle de la recherche (relief, surplombs, bâtiments sous le gabarit, rayon) et le voit à toute distance, puis faire `railplan check`. Exemple : ligne ouest du 24/10/2026, contournement d'un bloc de raffineries et d'une île.
- **Accroche à l'arrivée** : `--arrivee-a <rail>.<connecteur>` (voie simple) fait accrocher le dernier rail à un connecteur existant.
  - Le relevé et les obstacles sont mis en cache dans `plans/cache/` (ignoré par git). Les obstacles sont relus après une heure, ou avec `--frais`.
- **Recherche** : A* en plan, sur la position et le cap par pas de 10°. Elle avance par pas de 16 m et tourne de 10, 20 ou 30° par pas.
  - L'altitude suit un profil imposé : départ à plat, raccord de 64 m, pente régulière, puis à plat à l'altitude d'arrivée.
  - La pente vaut 10 % ; si rien ne passe, la plus douce trouvée par dichotomie jusqu'à 20 %. L'utilisateur : « pour la pente on est pas dogmatique ».
  - Mêmes entrées, même tracé.
- **Gabarit** : 6 m de large pour une voie, 13 m pour deux voies à 7 m (12,5 m pour les doubles voies à 6,5 m posées avant le 26/10/2026) ; il va de 0,5 m sous le rail à 7,5 m au-dessus.
- **Tronçons** : 90 m au plus, avec 20° de virage au plus. Au-delà, les deux voies d'une double voie se rapprochent au milieu du tronçon : 5,9 m sur 79 m tournant de 30°, et le jeu fusionne les blocs.
- **Le jeu ne refuse pas un rail ni une gare qui traverse le relief** (essai à blanc du 22/10/2026). Seuls `tracer.js` et `valider` le voient.
- **Rectitude** : chaque tracé affiche sa sinuosité (longueur sur corde, 1 = droit), son virage en trop (somme des virages moins l'écart des caps de départ et d'arrivée), ses changements de sens de virage et son écart à la corde. Elle est aussi écrite dans `traces/<nom>.json` (`rectitude`). Un S ou un détour se voit au virage en trop et aux changements de sens.
- **Surplombs** : depuis le 23/10/2026, le relevé les sonde (voir Monde). Avant, la grille ne gardait que le dessus de chaque maille, et une arche de roche était vue comme un mur plein jusqu'à son sommet, que le tracé contournait par un bout.
  - Exemple (23/10/2026), ligne des mines : une arche barre la vallée vers y = -103 600, dessous à 137-139 m, dessus à 140,5 m. Avec une gare à 115 m, le tracé faisait 358 m pour 218 m de corde, 260° de virage en trop. Avec la gare à 138 m (8 %), il passe dessus en une courbe : 223 m, aucun virage en trop.
  - Un S sans raison visible reste à vérifier sur la carte (`tracer.js carte`) : `^` pour un surplomb, une rangée de chiffres hauts pour un mur.
- **Un tronçon déjà posé est un obstacle** pour le tracé suivant. Pour comparer des variantes avant de démonter, le passer en `--ignore`.
- **Câbles** : ils ne sont plus des obstacles (voir Monde ci-dessus).
- **Première ligne** (22/10/2026), de la ligne sud de l'anneau 1 au plateau de la balise ICI :
  - 828 m à 10 %, 20 tronçons par voie, tracé trouvé en 1 min (relevé du relief 2 min la première fois) ;
  - joints conformes, aucun contact ;
  - le premier essai, qui cherchait aussi l'altitude et la pente, a été abandonné après 5 min.

## Plans de voies

Un plan décrit une gare et ses voies dans le **repère de la gare**, en mètres :
- origine à la sortie de la gare ;
- u le long des quais ;
- v à 90° de u, du côté de la voie ouest ;
- z vertical.

```bash
node railplan.js <plan> check    --beside <gare> --offset <m>   # ou --origin x,y,z --axis <cap>
node railplan.js <plan> build    (mêmes options) [--nom <gare>] # état : plans/<nom>-state.json (ignoré par git)
node railplan.js <plan> remove <rail|signal|quais...> --nom <gare>   # le build suivant les reconstruit
node railplan.js <plan> teardown --nom <gare>
```

**`check`** ne construit rien. Il pose chaque rail à blanc, et le jeu donne alors sa courbe et ses refus : longueur 12 à 100 m, rayon 15 m minimum, pente 25° maximum. Il vérifie ensuite :
- le découpage en blocs selon les signaux du plan ;
- les règles du wiki (voir `trains.md` du skill `satisfactory`) ;
- les écarts entre voies de blocs différents : au moins 6 m à l'horizontale ou 7 m en hauteur, sinon le jeu fusionne les blocs.

Sur un terrain déjà occupé, les rails existants faussent la vérification à blanc. Pour vérifier un tracé sans rien démolir, lancer `check` avec l'origine relevée de 150 m, là où rien n'existe : les rails existants deviennent des cordes, et les bouts sont libres.

**`build`** pose la gare, les quais (accrochés par le jeu), les rails puis les signaux. Il vérifie chaque joint : une liaison entre deux branches d'un même côté est anormale. Il vérifie aussi que chaque raccord voulu est bien fait (voir plus bas). L'audit des blocs se fait ensuite avec `node railsignals.js --station <chemin complet de la gare>`, et le contrôle des joints d'un plan entier avec `node verif-plan.js --plan <plan> <options du plan>`.

**Greffe sur une ligne existante** (gare 2 de la plaine, 20/10/2026) : un rail du plan peut être déclaré `existing: <chemin du rail>`. Il n'est ni construit ni démonté, mais ses connecteurs servent d'accroche, au check comme au build, et il entre dans les blocs et les écarts. Autres champs d'un rail :
- `fromGrade` / `toGrade` : pente d'un bout libre ;
- `toAuto: true` : direction d'arrivée laissée au jeu, sans arrondi au pas de 10° ; une chaîne de rails accrochés suit alors un arc de cercle.

Un plan peut compter plusieurs gares : chaque gare se construit avec son propre plan, dans son repère (origine à sa sortie). Le plan des voies déclare ensuite les voies intégrées de la gare et de ses quais en rails `existing`, une par bâtiment, prises dans `state.integrated`.

Prolonger un plan existant : ajouter au plan les nouveaux rails, avec des identifiants à eux, derrière une option. Exemple : `layouts/hub.js`, options `--ouest`, `--colonne` et `--rangee`, pour la voie basse de la gare de triage. Les joints des rails déjà posés ne doivent pas bouger. Ensuite, `build --rails '<motif>'`. Le motif est encadré par `^(…)$` : `X[SN]\d` ne prend que les rails 1 à 9, il faut écrire `X[SN]\d+`.

## Raccords et distance du joueur

**Un chantier de rails se fait à distance, sans déplacer le joueur**, jusqu'à environ 1 km (utilisateur, 28/10/2026 : « tu as tous les outils pour pouvoir faire ça à distance » ; je lui avais demandé cinq téléportations pour reposer 700 m de voie). Ce qu'il faut savoir, joint par joint :

| Joint | De loin ? | Comment |
|---|---|---|
| Départ sur le bout d'un rail neuf, jamais raccordé (chaîne de rails posés à la suite) | oui, jusqu'à ~1 km | `rail` depuis `{ path, name }` du rail précédent |
| Arrivée sur un bout libéré par un démontage, ou sur un joint existant | oui, si le connecteur est à plat et au pas de 10° | arrivée forcée de la RPC `rail` ; un signal posé ensuite coupe les blocs |
| Départ sur un bout libéré ou un joint existant | non au-delà de ~140 m | départ en point libre au point exact du connecteur, puis `railLink` ; aucun signal sur ce joint. S'il en faut un, poser le rail dans l'autre sens pour que ce joint soit une arrivée |
| Arrivée hors du pas de 10° | non | direction libre (`auto`) jusqu'au point exact, puis `railLink`, sans signal |

`voie-7m.js pose` suit ces règles. Ne demander une téléportation que si un joint qui doit porter un signal ne peut être ni une arrivée forcée ni un départ depuis un rail neuf.

- **Joint déjà raccordé** (création d'aiguillage) : un rail qui en part ne s'y raccorde que si le joueur est assez près. C'était le cas à 36, 70 et 139 m, et pas à 170, 336 ni 420 m.
- **Bout libéré par le démontage d'un voisin** : même limite, au départ comme à l'arrivée. Les bouts bas du canyon, à 280 m, ne se sont raccordés qu'après une téléportation à 40 m (21/10/2026).
  - Depuis que la RPC `rail` force l'accroche d'arrivée (`mSnappedConnectionComponents` réécrit avant `Construct`), une **arrivée** sur un bout libéré se raccorde de loin, si le connecteur est à plat et au pas de 10°. Le 27/10/2026, la voie sud du canyon s'est raccordée au rail gardé de l'est à environ 1 km du joueur. Le signal reposé sur ce joint coupe bien les blocs (validation 1).
  - Hors du pas de 10° (cap -5 de N279, 27/10/2026), l'arrivée forcée est refusée (« accroche à l'arrivée impossible hors de portée »). Si le joint ne doit pas porter de signal, poser le rail en direction libre (`auto`) jusqu'au point exact du connecteur, puis le relier par `railLink`. À N279, ce rail de 12 m dans l'axe du quai finissait à 0,000 m du connecteur, avec 0,05° d'écart de cap.
- **Bout jamais raccordé** : il se raccorde de loin, mais pas au-delà d'environ 1 km. Le 21/10/2026, sur la voie basse, des départs sont restés libres à 1,2 et 1,5 km du joueur ; à 670 m, ils se sont raccordés.
- **Au-delà de la portée**, le jeu pose le rail mais laisse le bout libre, sans erreur.

**Ce que montre le code du jeu** (lu dans Ghidra le 21/10/2026) :
- Juste avant la construction, l'hologramme tenait les bons connecteurs (`mSnappedConnectionComponents`).
- C'est donc pendant la construction que le départ n'est pas relié. `ConfigureComponents` ne fait la liaison directe (`AddConnection`) que sous condition. Sinon, il s'en remet à `FindAlignedConnections`, qui cherche par collision (`OverlapMultiByChannel`, sphère de 1 m). Loin du joueur, il ne trouve rien.

**`build` contrôle chaque raccord voulu**, et répare aussitôt un raccord manqué avec la RPC `railLink` (« départ relié par railLink »). Il ne s'arrête sur « NON RACCORDE » que si le raccord manque encore. Dans ce cas, rapprocher le joueur, puis `remove` et `build` du rail.

**Levier d'aiguillage (Railroad Switch Control)** : un aiguillage sans levier ne bascule jamais. Le jeu vérifie le levier (`mSwitchControl`) dans `UFGRailroadTrackConnectionComponent::SetSwitchPosition` (lu avec Ghidra le 26/10/2026). Les trains automatiques suivent alors la position en cours, quel que soit leur itinéraire.
- **Qui pose le levier :** l'hologramme du rail qui crée la bifurcation (`TryPlaceSwitchControl`). Un raccord fait par `railLink` n'en avait pas.
- **Incident du 26/10/2026 :** 90 aiguillages sur 202 étaient sans levier après les chantiers à 7 m. Le N279 #2 a été envoyé au bout d'une ligne externe de 40 m et a déraillé.
- **Depuis :**
  - `railLink` pose le levier dès qu'un connecteur devient un aiguillage ;
  - la RPC `switchControl(<connecteur>)` en pose un à la main ;
  - `switchPosition(<connecteur>[, position])` lit ou règle la position et rend la branche désignée ;
  - le recensement se fait avec `plans/aiguillages-sans-levier.js`, la pose avec `plans/poser-leviers.js`, qui remet aussi sur la voie principale les aiguillages pointés vers une impasse.
- Après chaque chantier de voies, relancer `aiguillages-sans-levier.js`.

`railLink(<RailroadSubsystem>, <rail A>, <connecteur A>, <rail B>, <connecteur B>)` :
1. appelle `UFGRailroadTrackConnectionComponent::AddConnection`, qui relie les deux connecteurs dans les deux sens ;
2. appelle `AFGRailroadSubsystem::RemoveTrack` puis `AddTrack` sur le rail A, pour réinscrire ses graphes (itinéraires des trains, courant des rails).

**Un signal posé sur un joint fait par `railLink` ne coupe pas les blocs** (constaté le 24/10/2026 à l'anneau de Lund). Les connecteurs connaissent pourtant le signal (`mFacingSignal` / `mTrailingSignal`), mais le jeu fusionne les blocs des deux côtés. Le signal passe en erreur 3, le bloc contenant alors une boucle, et les trains s'arrêtent. Pour réparer, reposer le rail près du joueur (moins de 140 m environ), pour que le jeu fasse le raccord lui-même, puis reposer le signal. Ensuite, vérifier les blocs avec `railsignals.js` (« le jeu n'en fait qu'UN ») ou `mSignalBlockID` des rails. Un joint fait par `railLink` sans signal fonctionne pour la circulation.
- **Diagnostic d'un blocage** (anneau de la voie basse, 27/10/2026 : 5 trains en `LongWaitAtSignal`) : lire `mBlockValidation` et `mAspect` des signaux devant chaque train arrêté. Un signal en validation 3 arrête tout. Chercher ensuite, sur les deux rails de son joint, un `mOverlappingTracks` qui cite le rail voisin raccordé : c'est la trace d'un joint fait par `railLink`. Reposer ce rail joueur à moins de 140 m, puis le signal ; les signaux de chemin voisins redeviennent valides.

Le 21/10/2026, à 1,2 km du joueur, `railLink` a relié XSc6 à XSu1, et `verif-plan` est revenu propre. Les rails étaient déjà dans le même graphe : la fusion de deux graphes séparés n'est **pas encore vérifiée**.

Une arrivée sur un aiguillage loin du joueur prend le mauvais connecteur du joint : poser plutôt le rail depuis le joint.

Avec beaucoup de rails dans un plan, `build` ne relit que les rails du plan qui aboutissent au joint. Avant, il relisait tout, soit environ 600 lectures par rail à la gare de triage, ce qui le rendait très lent.

## Blocs fusionnés, relief, pose par zones

**Blocs fusionnés par le jeu** : deux voies trop proches « se touchent » (`AFGRailroadTrack.mOverlappingTracks`, calculé à la pose près du joueur). Le jeu met alors leurs rails dans le même bloc, et les signaux passent en erreur (« le bloc contient une boucle »). `railsignals.js` le signale (« le jeu n'en fait qu'UN »). Mesuré le 20/10/2026 avec des paires de rails d'essai : contact à 6 m d'axe en axe, plus de contact dès 6,2 m.

**Une double voie se pose à 7,5 m d'axe en axe** (utilisateur, 28/10/2026 : « on passe le standard d'ecartement a 7.5 »). Le standard était de 7 m depuis le 26/10/2026 (« faut passer l'écart des rails à 7m, 6.5 c'est trop juste », puis, après le banc d'essai et la lecture du code du jeu, « on passe le standard à 7m »). Le seuil de contact calculé le plus exigeant est de 6,74 m (hélices voisines R 17, voir « Collisions entre trains »), mais deux déraillements ont eu lieu le 28/10 : à 7 m au pied des hélices de l'anneau Z, puis à 6,5 m dans les courbes de la ligne o76 (voie-7m.js, refaite à 7,5 m). Les voies posées avant le 26/10 sont à 6,5 m, celles du 26 au 28/10 à 7 m. Les liens A–Z et Z–ouest de l'étage 1 du hub ont été posés à 10 m pendant le passage par un standard de 10 m, fondé sur un calcul faux (caisse de 6,04 m).

Le wiki ne donne aucun écart minimal, mais il confirme le risque : « Trains can collide if they are on the same track with improper signaling or if two tracks are too close » (Tutorial:Trains). Depuis la version 1.2.0.0, la collision porte sur tout le modèle du véhicule (« Collision boxes changed so physical collision applies to the whole model », historique de la page Railway).

**Bouts d'anneau** : dans un quart de cercle de 18 m, une caisse déborde vers l'extérieur de la courbe. Son coin s'écarte jusqu'à 3,6 à 4,5 m de l'axe de sa voie, contre 3,02 m en ligne droite (calcul pour des bogies à ±6 m puis au centre). Quand les deux voies d'une double voie partent d'un même point en courbes opposées (sortie et entrée d'anneau), il faut donc jusqu'à 9,1 m entre les axes au point de départ. À 6,5 m, deux trains longs qui s'y croisent peuvent se toucher. C'est la cause retenue des quatre déraillements du 26/10/2026 (11 h à 19 h, bouts des anneaux vbd3, vbd4 et vbd5) : le calcul la donne, et l'utilisateur a vu le dernier se produire, mais le choc n'a pas été mesuré.

**Collisions entre trains (lu dans le code du jeu avec Ghidra, 26/10/2026)** :
- `AFGRailroadSubsystem::TickTrainMovement` appelle, pour chaque train qui avance, `SolveVehicleCollisions` avec son seul véhicule de tête dans le sens de marche.
- `SweepRailroadPositions` fait le test. Chaque véhicule est une gélule : un segment centré sur sa position sur la voie, dans l'axe de la tangente de la voie en ce point. La demi-longueur du segment vaut `mLength / 2 − 250` uu, le rayon 250 uu. `mLength` = 1 600 uu pour la locomotive comme pour le wagon (lu en jeu), soit 5,5 m de demi-segment.
- Seul l'avant de la tête est testé : le bout de son segment dans le sens de marche, une sphère de 2,5 m balayée entre l'ancienne et la nouvelle position. Il y a contact s'il passe à moins de 5 m du segment d'un véhicule d'un autre train.
- La charge des wagons ne compte pas, et le modèle 3D non plus. C'est pour ça que « c'est la locomotive qui compte » : c'est la tête qui touche.
- **Après un contact**, les deux trains s'arrêtent net (vitesse 0). Ils déraillent si la vitesse relative en travers dépasse `TrainConstants::MIN_SPEED_FOR_DERAILMENT` = 833,3 cm/s (30 km/h). Il y a des étincelles au-dessus de 27,8 cm/s.
- **Seuils qu'on en déduit**, avec R le rayon des courbes : la tête déborde de sa voie de √(R² + 5,5²) − R vers l'extérieur de sa courbe, et le bout de gélule d'un véhicule en courbe d'autant.
  - Voies droites parallèles : contact sous 5 m.
  - Bout d'anneau (quarts R 18 opposés depuis la double voie, les deux maxima tombent face à J) : contact sous 5 + 2 × 0,82 = **6,64 m**.
  - Quarts R 16,25 (liens à 10 m) : 6,81 m.
  - Hélices voisines R 17 au même niveau : **6,74 m**. Les hélices du hub sont à 7 m depuis le 26/10/2026 (`hub-helices.js` GAP). La descendante D a été rapprochée du côté est : rail de 12,5 m après le coin NE. U et les côtés d'anneau n'ont pas bougé. Mesuré : 7,000 m en bas et à chaque tour, aux 3 anneaux.
  - **7,5 m depuis le 28/10/2026** : deux trains ont déraillé à 7 m au pied des hélices de l'anneau Z. L'un descendait D, l'autre montait vers U, et leurs têtes se sont touchées à l'entrée des deux quarts R 17 dos à dos. Le seuil de 6,74 m ne suffit donc pas en pratique. L'hélice ouest U a été reculée de 0,5 m (GAP 7,5 ; le côté ouest UW est figé, la droite NW → UDV passe à 25,5 m), D n'a pas bougé. Mesuré : 7,50 m en bas et à chaque tour, aux 3 anneaux.
  - **Chantier** : `chantier-liens-hub.js --etages 0,1,2 --ecarts` (93 rails, 15 signaux). Il s'est arrêté à la convergence UMG de l'étage 1, le piège connu. La reprise s'est faite étage par étage : les `nB1` (rail qui repart de UMG) d'abord, puis le reste du lot par `railplan build --rails`, et les raccords hors du lot par `railLink`. `--ecarts` relancé ne trouve plus rien. Avant le chantier, tous les trains passent en manuel ; ceux qui sont sur le lot sont relevés puis démontés, et reposés après par `trains.js tournee`.
  - Ou bien 5 m d'écart en hauteur au point le plus proche (la distance se mesure en 3D).
- **Banc d'essai** (`plans/banc-croisement.js`) : à 6,5 m, déraillement au 6e croisement environ (tête d'ESSAI2 sortant du virage contre le wagon 3 d'ESSAI1). À 7 m, 14 croisements à 65-98 km/h sans contact. C'est conforme au seuil de 6,64 m.

**Liens écartés** (`layouts/hub.js`, constante `LIENS` : étage → { lien : écart }) : les côtés de l'anneau ne bougent pas, car les hélices du centre sont raccordées au côté nord. Les deux voies du lien s'écartent symétriquement, et les quarts de cercle des bouts rétrécissent à R − (écart − 6,49) / 2, soit 16,25 m pour 10 m. **Tout le hub est à 7 m depuis le 26/10/2026** (`plans/chantier-liens-hub.js --etages 0,1,2`, sauvegarde `agent_261026_202751_avant-liens-hub-7m`). Sont concernés les liens entre anneaux aux 3 étages, l'arrivée du canyon à l'anneau 0 en bas (virages reconstruits par le plan, accrochés aux droites gardées), les lignes externes sud et la ligne externe est des étages. Ces deux dernières ont des quarts de rayon `EXT_R` = 17,75 m, et leurs droites suivantes reviennent par un S de 0,25 m aux bouts inchangés.

Le chantier relève les raccords vers des rails hors du lot, puis les refait avec `railLink` si la pose ne les a pas faits. C'est le cas de la ligne des mines sur RAXos / RAXis à l'étage 2. Mesuré ensuite : 7,000 m à chaque bout, 6,99 m sur la ligne est, aucun contact entre voies. Les liens entre anneaux font 81,6 m.

**Relief** : `rays(segments, { who: true })` rend aussi le composant touché :
- relief : `LandscapeHeightfieldCollisionComponent` ;
- rocher : `StaticMeshComponent`, dont `dump <composant> StaticMesh` donne le maillage ;
- végétation : `FGFoliageInstancedSMC` ;
- bâtiment.

Un relevé du sol tous les 5 à 25 m suffit pour placer un tracé ou des poteaux.

**Signaux des grandes lignes** (`plans/signaux-ligne.js`, règle de l'utilisateur du 24/10/2026 : un signal de bloc tous les 2 rails, blocs de 200 m au moins) :
- `plan|pose --signal <signal de départ>` suit la voie depuis le connecteur observé de ce signal, dans le sens de marche, jusqu'au signal suivant. Il pose les signaux à gauche, puis vérifie avec `mSignalBlockID` que chaque signal coupe le bloc. Si le joint a été fait par `railLink`, il retire le signal et essaie le rail suivant.
- `retirer --signal <…>` enlève les signaux posés sur cette ligne (état `plans/signaux-lignes-state.json`).
- Fait le 24/10/2026 sur 12 voies, avec 61 signaux tous validés par le jeu : Lund-Tilburg, voie basse entre l'anneau 4 et Lund, voie basse entre le hub et l'anneau 1, ligne « ici », ligne du terminus à 41 m, ligne des mines. L'audit a donné 175 blocs du jeu, identiques au calcul.

**`build --forcer <regex>`** : un rail visé refusé pour le seul gabarit (`FGCDEncroachingSoftClearance`) est reposé de force. C'est le cas des branches emboîtées d'un embranchement qui se frôlent près de leur aiguillage. Tout autre refus (pente, rayon, longueur) reste bloquant.

**`build --rails <regex>`** ne pose que les rails choisis, sans les signaux, qui viennent au lancement complet. C'est utile quand les aiguillages sont trop éloignés pour une seule position du joueur. À la gare de triage des hélices (21/10/2026), les rails ont été posés en trois positions par chantier : 66 rails à l'étage 1, 65 rails pour le second module de l'étage bas.
- Un départ depuis la voie intégrée d'une gare à 172 m du joueur a échoué (« accroche au départ échouée : aucun bout de voie »), alors qu'il passait à 70 m.
- Juste après une téléportation, attendre quelques secondes que les collisions se chargent.
- En cas d'échec, `check` indique le rail fautif.
- **Ordre des poses** : un rail qui part d'un joint où un rail du même côté est déjà posé, mais pas celui d'en face, échoue (« aucun connecteur de normale attendue »). Il faut d'abord poser le rail d'en face.
- `plans/zones.js` choisit, pour une position du joueur, les rails à poser dans l'ordre du plan :
  - leurs deux joints sont à moins de 125 m ;
  - chaque bout trouve son accroche : un bout d'en face déjà posé, ou aucun rail encore posé à ce joint.
- Deux gares superposées à 24,9 m d'écart (étage 1 au-dessus de l'étage bas) se posent sans refus, quais compris.

## Gare de triage en anneaux

Plans : `layouts/hub.js`, `hub-helices.js`, `hub-tout.js` et `hub-gare.js`. Origine (141 339 ; -261 512 ; 349), axe 180. Les états sont `plans/hub<étage>-state.json`.

La suite est : anneau, paire de gares, anneau, paire de gares, anneau. Chaque anneau tourne dans le sens des aiguilles d'une montre, le sens des gares (nord vers l'est, sud vers l'ouest). Il est de niveau et forme un seul bloc de chemin : signaux de chemin à toutes ses entrées, de bloc à toutes ses sorties, et aucun train ne s'y arrête.
- Avec la circulation à gauche, tout raccord se fait par l'extérieur : aiguillage de départ, puis convergence d'arrivée, en virant à gauche, sans croisement. Dans l'autre sens de rotation, ce serait convergence puis aiguillage, en virant à droite.
- Raccords : voies principales en quarts de cercle de 18 m aux côtés est et ouest ; gares aux quatre coins, dans l'alignement des côtés nord et sud ; lignes externes au sud.
- Deux aiguillages sont à 24 m au moins l'un de l'autre (deux rails de 12 m). Les coins, de 28 m, servent d'écart.
- Gare et quais font 34 m de large, centrés sur leur voie : on a mesuré `bounds` à ±17 m.
- **Courbe en S près d'un coin d'anneau** : le milieu d'une courbe en S tombait à 1,4 m ou 4,4 m du milieu d'un coin, et le jeu y a accroché la seconde moitié (aiguillages parasites). Un bout libre posé près d'un joint existant s'y accroche. Garder les points libres à bonne distance des joints, ou poser en droite.
- La vérification automatique de `build`, faite quand il n'y a pas encore d'état, pose tout à blanc. Les accroches aux gares échouent au-delà de 170 m du joueur. Si le tracé a déjà été vérifié à blanc (`--ebauche`), créer l'état vide (`{"built":[],"rails":{},"platforms":[],"signals":{}}`), puis construire par zones.

## Modèle de gare validé : `layouts/gare-contournement.js`

L'utilisateur a validé ce modèle le 18/10/2026. Il comprend :
- **Gare et quais** : une gare et N quais de fret (chargement par défaut), retournés comme à Breda, c'est-à-dire avec les entrées et sorties de convoyeur du côté opposé à la voie ouest. La gare est décalée de 16 m de l'axe de la ligne à double voie.
- **Contournement** : il reste dans l'axe de la ligne, décalé seulement en hauteur. Après chaque aiguillage, un palier de niveau, puis une rampe, puis une ligne droite à −9 m.
- **Boucle de demi-tour** : elle part de la sortie de la gare vers la voie ouest. Elle descend tout droit, fait demi-tour sous la ligne après l'aiguillage sud, puis rejoint la voie ouest par une courbe en S.
- **Signaux** : signaux de chemin à l'entrée des convergences, signaux de bloc en sortie. Les zones de convergence sont de niveau.

```bash
node railplan.js layouts/gare-contournement.js check --beside Breda --offset 64 --quais 4
node railplan.js layouts/gare-contournement.js build --beside Breda --offset 64 --quais 4 --chargement oui --nom ma-gare
```

Validé à blanc : 2 quais = 186 m, 4 quais = 218 m (construit puis démonté sans défaut), 6 quais = 250 m.

Le modèle ne pose pas de dalle (la gare est posée en l'air si le sol est plus bas), ne raccorde pas le courant et ne nomme pas la gare. Les bouts EN, ES, WN et WS restent à raccorder au réseau.

## Hélices

### Hélice à double voie : `layouts/helice-double.js`

Ascenseur ferroviaire demandé le 21/10/2026 (« pente maximale, rayon minimum »). Deux voies concentriques, écartées de 6,5 m, montent ensemble : elles sont à la même altitude à chaque angle. Un rail fait un quart de tour.
- La voie intérieure porte la pente maximale ; l'extérieure monte du même dénivelé, avec une pente plus douce.
- En bas et en haut, un quart de tour de raccord fait passer la pente de 0 au maximum : les quatre bouts sont de niveau et libres.
- Le plan n'a ni gare ni quais : `railplan.js` ne construit alors que les rails.

```bash
node railplan.js layouts/helice-double.js check|build --origin x,y,z --axis <cap multiple de 10> [--rayon 17] [--pente 25] [--tours 2] [--sens horaire|antihoraire] [--nom <nom>]
```

**Pas de sortie à un étage intermédiaire** : la voie intérieure est enfermée par l'extérieure. Une ligne qui en sortirait devrait croiser la voie extérieure juste après l'aiguillage, à 1-5 m de hauteur, alors que le jeu en demande 7.

### Hélices à étages (`layouts/hub-helices.js`)

Pour des étages, il faut deux hélices à voie unique côte à côte :
- la montante d'un côté de la ligne, la descendante de l'autre ;
- la double voie passe entre elles, chaque voie tangente à son hélice, et les deux hélices repassent au point de tangence à chaque tour ;
- un quart de tour de niveau (palier) avant chaque aiguillage de la montante et après chaque convergence de la descendante ;
- l'écart entre étages vaut π × r × tan(pente) ; à 17 m et 25°, il est de 24,9 m, et deux gares de 20,7 m de haut s'y superposent (acceptées par le jeu).
- **Signaux** :
  - **hélice montante** : un signal de bloc au point de séparation de chaque aiguillage d'étage, et un au bout du premier quart de montée. La branche de l'hélice monte dès l'aiguillage, donc le bloc n'est pas de niveau ; avec une seule entrée, un signal de bloc suffit.
  - **hélice descendante** : la zone de chaque convergence se limite au palier et au dernier rail de la voie d'étage, qui sont de niveau. Elle a deux signaux de chemin en entrée, et un signal de bloc posé au point de convergence, qui garde la descente.
- **Plusieurs anneaux à hélices** (23/10/2026, anneau A du Hub nord) : `hub-helices.js` prend un décalage en u et un préfixe de noms (`geometry(du)`, `plan({ du, prefix })`). Dans `hub.js`, un anneau reçoit `helices: { du, prefix }`. L'anneau A a la même paire que l'anneau 0, à la même distance de son côté est, avec les noms `AU*` et `AD*`. La ligne externe est des étages reste propre à l'anneau 0 (`extEst`).
- **Greffer des hélices sur un anneau déjà posé** :
  1. démonter sa droite nord (`remove RAn1 RAn2`) à chaque étage ;
  2. poser l'étage 0 (hélices complètes et raccord du bas), puis les étages 1 et 2.
  - **Ordre aux convergences** : à un point où deux rails arrivent dans le même sens, poser d'abord le rail qui en repart (`build --rails "^RAnC$"`, `"^RAnB1$"`). Sinon le second arrivant ne trouve que l'autre arrivée, de même normale (« aucun connecteur de normale attendue »).
  - **Aiguillage existant** : le jeu peut accrocher une arrivée à une autre branche du même aiguillage (même point, même sens). L'agent l'accepte, et `railplan` relie ensuite la branche voulue par `railLink`. Vérifier les deux branches avec `fg.js rails`.
  - **Ordre aux aiguillages** : à un point de séparation, la voie qui arrive doit exister avant qu'une des branches soit posée, si l'autre branche existe déjà. Exemple : `RZnB1` posé en premier, puis `RZUb1` refusé à `RZUDV` ; poser `RZnA` d'abord.
- **Anneau sur une double voie quelconque** (`layouts/anneau-voie-basse.js`, ligne ouest du 24/10/2026) :
  - `--axis` quelconque, origine sur la voie qui va dans le sens +u, au centre. Axe 0 sur une voie est-ouest : ligne externe au nord. L'anneau est symétrique, il n'y a pas d'autre modèle.
  - `--keep` accepte un fichier JSON (`plans/<nom>-keep.json`). Un côté sans rails gardés (`ES`/`EN` ou `WS`/`WN`) a ses raccords libres et n'a pas de signaux ; on les ajoute quand le côté est prolongé.
  - `keep.Y` raccorde une gare en boucle de retournement (une seule voie d'accès) au point P de cette voie, dans l'axe u. La ligne externe y descend en pente régulière, au besoin jusqu'à 30 % (raccord de gare), en deux quarts de cercle emboîtés qui se rejoignent en P sans croisement. P peut être d'un côté ou de l'autre (`s = ±1`).
  - Coupures des quarts : intérieur à 40° de P, extérieur à 50°. Ainsi, aucun rail ne fait moins de 12 m (`FGCDTrackTooShort`) et les deux bouts libres sont à 8,5 m : à 2 m, le jeu accrochait le rail suivant au mauvais bout (`FGCDTrackTrunToSharp`).
  - `Yd2` et `Ya1` touchent P. Ils se posent une fois P libéré de l'ancienne voie : avant, le jeu les refuse (`FGCDEncroachingSoftClearance`).
  - Blocs : la zone d'embranchement, la voie d'accès et la gare forment un seul bloc. Il a une entrée (`xXo`, bloc) et une sortie (`eXi`, chemin), donc un train à la fois par gare et aucun signal en P.
- **Anneaux en série sur une ligne droite** (25/10/2026, ligne droite de la voie basse entre le triage et le coude, voies y -261 512 / -262 161 ; utilisateur : « pose les anneaux tout le long de la voie basse », « prévois la place pour les gares entre chaque anneau ») :
  - même pas que le triage : 117,05 m du côté ouest d'un anneau au côté est du suivant (gare + 4 quais, sortie à 31,05 m, entrée à 6 m), soit 234,55 m de centre à centre pour des anneaux de 117,5 m. Le premier part du côté ouest de l'anneau Z (x 80 751) : centres 63 171, 39 716, 16 261, -7 194, -30 649, -54 104 (états `anneau-vbd1` à `anneau-vbd6`) ;
  - `node anneau-ici.js pose --x <centre> --voie -261512,-262161 --nom anneau-vbd<k>` ; le joueur à moins de 60 m (téléporté à côté d'un poteau alimenté de la ligne électrique à -17 m). Enlever d'abord les signaux de ligne sous les anneaux : l'outil refuse de couper un rail qui en porte. Chaque anneau apporte ses signaux, et la voie de 81 m entre deux anneaux forme un bloc.
- **Gare entre deux anneaux déjà posés** (N266 O40 <- S13 E101, 25/10/2026) : `hub-gare.js` (origine = sortie de la gare, 31,05 m à l'ouest de l'anneau est, sur le côté nord), puis `anneau-gare-nord.js` pour la sortie. L'entrée vient du coin NE de l'anneau ouest, dont le joint existe déjà : ajouter `GARE` (bout libre de la dernière voie intégrée) au fichier `<anneau>-keep.json`, puis `railplan.js layouts/anneau-voie-basse.js build ... --keep <fichier> --rails "^Ein$"` et de nouveau `build` sans filtre pour le signal `xEi`. L'anneau n'est pas démonté. `verif-plan` de la sortie signale alors G5 raccordé : c'est attendu.
- **Élargir un anneau** (anneau Z, 23/10/2026, refait comme l'anneau A avec ligne externe et hélices) : le côté est reste, car il porte les gares. Démonter aux trois étages ce qui bouge (côtés nord, sud et ouest, coins ouest, raccords ouest, voies vers l'ouest et leurs signaux), puis poser. Les bouts des voies vers l'ouest (`SEND`, `NEND`) restent fixes, car le prolongement de l'étage du bas y est accroché.

### Limites du jeu

Mesurées à blanc le 21/10/2026 sur un quart de tour :
- **Règles annoncées** par le jeu : `mMinBendRadius` 15 m, `mMaxGrade` 25°.
- **Rayon** : un quart de cercle à pente constante de 25° passe dès 16,5 m (16,25 m est refusé, `FGCDTrackTrunToSharp`). Un quart dont la pente change en chemin (0 → 25°, ou 12,5 → 25°) demande 17 m. Le rayon minimal d'une hélice à bouts de niveau est donc de 17 m.
- **Pente** : 25,5° passe encore, 26° est refusé (`FGCDTrackTooSteep`).
- **Exemple** : à 17 m et 25°, la voie extérieure (23,5 m) monte à 18,6°. Chaque tour monte de 49,8 m, et 2 tours avec raccords montent de 87,2 m.

## Pièges propres aux rails

- **Aiguillages** : pour accrocher la bonne branche, on vise 10 cm à l'extérieur du connecteur voulu.
- **Bout libre au-dessus de la végétation** : la visée descend sous le point et traverse la végétation en repartant 5 cm sous chaque contact. Avant le correctif du 23/10/2026, elle repartait 1 m plus bas. Un buisson posé au sol envoyait alors le rayon sous le relief, puis sur le repli sous le joueur, qui touchait le toit d'un quai : `FGCDInvalidAimLocation` à la pose, alors que la vérification à blanc passait. Le repli sous le joueur traverse aussi les bâtiments, car le joueur peut voler au-dessus d'une gare.
- **Terminus en l'air** (`layouts/terminus-ici.js`, 23/10/2026) : modèle du terminus du complexe d'acide. La gare est reculée pour que la voie retour s'écarte à 22 m. La boucle compte trois arcs de R = 22 / (4 cos 40° − 2) = 20,7 m, avec des caps de joints multiples de 10°.
- **Quais** :
  - la rotation à 180° est relative au bâtiment auquel le quai s'accroche ;
  - un quai ne s'accroche pas à un bout de gare déjà raccordé à un rail.
- **Démontage d'une gare ou d'un quai** : il peut laisser sa voie intégrée. Une voie orpheline de longueur nulle a fait monter le joueur sans fin avec le hover pack. `teardown` et `remove` les retirent.
- **Point libre** : la visée part de 50 cm au-dessus du point, avec des normales verticales. Sinon le bout de voie prend la pente du sol, loin en dessous. Le point touché est ensuite remplacé par le point voulu : une voie se pose donc en l'air, au-dessus de l'eau.
  - Point en l'air au-dessus d'un bâtiment (voie à un étage d'hélice, au-dessus d'une voie ou d'une gare) : au-delà de 2 m sous le point, la visée traverse tout ce qui n'est pas le relief. Sinon l'hologramme s'accroche au bâtiment touché : le 21/10/2026, les rails à blanc de l'étage 1 partaient vers les bouts de voie de l'étage du bas, 25 m plus bas.
  - Le bout de voie prend la pente de la normale visée : `grade` (fraction, positive = monte vers `yaw`) incline cette normale. Sans `grade`, un rail entre deux altitudes fait un S, 1,5 fois plus raide au milieu qu'en moyenne ; avec la même `grade` aux deux bouts, il est droit.
  - Le cap d'un point libre est arrondi au pas de rotation du jeu (10°) : hors de ce pas, le rail ondule en plan. Choisir un cap multiple de 10°, ou partir d'un bout de voie existant.
- **Courbes et S** : un quart de cercle se pose en deux rails, 50° puis 40°, pour que le joint du milieu tombe sur un cap multiple de 10°. Un S entre deux voies parallèles se fait en deux arcs de 10° ou 20° : le rayon vaut décalage / (2 (1 − cos θ)), et la longueur 2 × rayon × sin θ.

## Conventions de signalisation

Conventions du projet, recoupées avec le wiki (`satisfactory.wiki.gg/wiki/Train_Signals`, lu le 27/10/2026). Les appliquer sans relire le wiki. `node railsignals.js --station <gare>` les contrôle sur tout le réseau relié à la gare.

| Où | Règle | Raison |
|---|---|---|
| Tout bloc | Ses signaux d'entrée sont tous du même type, bloc ou chemin. | Sinon erreur du jeu « Block has conflicting entry signal types ». |
| Tout signal | Tout signal, bloc ou chemin, délimite un bloc. Le type du bloc est donné par ses signaux d'entrée. | Wiki : « A block is the area between two signals ». |
| Convergence (deux voies qui se rejoignent) et jonction où des trajets se croisent | Signaux de **chemin** à toutes les entrées, signal de **bloc** à la sortie, juste après l'aiguillage. | Wiki, bug actuel : à la libération d'un bloc, plusieurs signaux de bloc d'entrée peuvent passer au vert, et les trains se percutent. |
| Bloc de chemin | **De niveau** : moins de 1 m de dénivelé (seuil de `railsignals.js`). Si une branche est en pente, couper son dernier rail pour finir à plat, et mettre le signal de chemin au joint. | Wiki : sinon les chemins sont mal découpés et des trains peuvent se percuter. Les signaux de bloc n'ont pas cette contrainte. |
| Gare | Jamais dans un bloc de chemin. L'entrée est un signal de **bloc** ; la sortie est un signal de **chemin** si elle donne sur une jonction (gare de triage, voie basse, boucle de N85 E78), sinon de bloc. | Erreur du jeu « Path block cannot contain stations ». Un signal de chemin juste après une gare est un montage prévu par le jeu. |
| Gare | Au moins un rail de 12 m entre la gare et ses signaux d'entrée et de sortie (voir plus bas). | Un train de 81,5 m dans une gare de 80 m doit rester entier dans le bloc de la gare. |
| Avant un signal de chemin | Bloc long : au moins un train, et pas de signal de bloc juste avant. | Le chemin n'est réservé que depuis le bloc qui précède : un bloc court fait ralentir les trains. |
| Grandes lignes | Un signal de bloc tous les 2 rails, blocs de 200 m au moins (`signaux-ligne.js`), posé à gauche (bord extérieur, circulation à gauche). | Règle de l'utilisateur (24/10/2026). |
| Tout bloc | Au moins la longueur du plus long train (81,5 m). | Un train arrêté au signal de sortie ne doit pas déborder dans le bloc d'avant. |
| Joint fait par `railLink` | Pas de signal dessus. | Le jeu ne coupe pas les blocs à ce joint (24/10/2026). |

Application à la boucle de N85 E78 (27/10/2026, `scratchpad boucle-n85.js`). La sortie de la gare est passée en signal de chemin. Le rail de la branche de S13 E101 (139,8 → 138 m) a été coupé en une descente de 52,9 m et un rail à plat de 18,5 m, avec le signal de chemin à leur joint. Un signal de bloc est posé 18 m après l'aiguillage. La zone de l'aiguillage fait 91 m et est de niveau.

## Signal d'entrée de gare

Règle de l'utilisateur (26/10/2026) : **pas de signal à l'entrée ni à la sortie d'une gare, toujours un rail d'au moins 12 m entre le signal et la gare**. Un train locomotive + 4 wagons fait 81,5 m pour 80 m de gare + 4 quais : à quai, sa queue dépasse de 1,5 m. Avec le signal collé au quai, elle occupait le bloc d'avant, qui dans le hub est le bloc de l'anneau (« un train en gare bloque l'anneau à l'entrée de celle-ci »).

`node entrees-gares.js liste` contrôle la règle sur toutes les gares. `corriger <gare>` coupe le rail d'approche droit en deux (12 m côté gare) et met le signal à la jonction. Le joueur doit être à moins de 140 m.

**Contact avec la courbe de l'anneau** : dans les gares du hub (`hub.js`, `anneau-gare-*.js` : entrée à `ENT` = 6 m du côté de l'anneau), le rail d'entrée part d'un aiguillage tangent à la courbe du coin (rayon 18 m), à 24 m de la gare. Le jeu met dans le même bloc deux rails à moins de 6 m d'axe en axe (`mOverlappingTracks`). Le long des 13,6 premiers mètres, la courbe est à moins de 6,2 m du rail d'entrée. Un joint à 12 m de la gare tombe dans cette zone : le 26/10/2026 à N266 E102 h0, les deux rails coupés touchaient la courbe, et anneau, rails et gare n'ont plus fait qu'un bloc (signal en validation 3). Entrée remise dans son état d'origine. Pour respecter la règle, la gare doit commencer à au moins 25,6 m de l'aiguillage (`ENT` ≥ 7,6 m). `corriger` refuse donc un rail d'approche qui touche un autre rail.

**Solution retenue** (utilisateur, 26/10/2026 : « on les avance de 6m 18 + 12 ca doit fonctionner ») : gare avancée de 6 m vers sa sortie, `ENT` = 12 m. Le rail d'entrée de 30 m est coupé en 18 m depuis l'aiguillage (fin du quart de cercle du coin, dans le bloc de l'anneau) et 12 m jusqu'au quai, sans contact, dans le bloc de la gare. Le signal de bloc est à leur jonction, et la sortie passe de 31,05 à 25,05 m. Dans `hub.js`, c'est l'option `--ent E<k>=12` / `W<k>=12` (rails `Ein<k>` + `Eing<k>`, `Win<k>` + `Wing<k>`). Pilote fait à N266 E102 h5 (`hub2-est2`, 26/10/2026) : bloc de la gare de 117 m (80 + 12 + 25), signal d'entrée valide, rail de 12 m sans contact. Déroulement :
1. `railplan.js layouts/hub.js remove xEi<k> eEo<k> Ein<k> Eo<k> --nom hub<f> --etage <f>` ;
2. `railplan.js layouts/hub-gare.js teardown --nom hub<f>-est<k>`, puis `build` à la sortie donnée par `layout({ etage, ent: 'E<k>=12' })` ;
3. `railplan.js layouts/hub.js build ... --ent E<k>=12 --rails 'Ein<k>|Eing<k>|Eo<k>' --signaux 'xEi<k>|eEo<k>'` ;
4. remettre le nom de la gare, ses étiquettes et le mode des quais, puis contrôler (`entrees-gares.js liste`, `railsignals.js --station`).

Le joueur doit être à moins de 140 m de tous les joints. Un rail démonté puis rétabli par Ctrl+Z change d'identifiant : corriger alors l'état du plan avant `remove`.

**Gare à tampons** (N266 E126 h0 / h3 / h5, 26/10/2026) : `deplacer-tampons.js releve <nom> --gares <etats> --decalage dx,dy,dz` avant tout démontage, puis `demonte`. Ensuite, les étapes ci-dessus pour chaque étage, puis `repose` et `verifie`. Les conteneurs sont reposés décalés, et les ascenseurs fixés sur un conteneur sont reposés depuis lui. Les convoyeurs sont refaits entre les nouveaux ports, et les points fixes des lignes ne bougent pas. Le contenu des conteneurs est perdu (« on s'en fou du contenu, ça vire »). Sur des gares empilées, le rayon qui accroche les quais doit partir sous l'étage du dessus : `hub-gare.js --visee 20`. Le toit des quais est à 15-19 m. À 40 m, le rayon touche l'étage supérieur ; à 8 ou 12 m, il part sous le toit et le quai ne s'accroche pas. Bilan à E126 : 3 gares, 7 conteneurs, 2 ascenseurs, 21 convoyeurs. Un regroupeur à 4,4 m devant une sortie n'absorbait pas le décalage, et il a été décalé lui aussi.

`plans/chantier-gare-hub.js --gare est<k>|ouest<k> --etages 0[,1,2] --site x,y,z [--deplacement <nom>] [--depuis <étape>]` enchaîne tout ce chantier pour une gare du hub, avec le joueur téléporté au chantier puis ramené. Ce n'est qu'après le relevé de `deplacer-tampons.js` qu'on peut le lancer, et il vaut mieux mesurer d'abord la distance des points fixes aux sorties des conteneurs. Fait à N266 E102 h0 (26/10/2026) en un seul passage.

Gares « nord » des anneaux de la voie du nord (vbd) : `plans/chantier-gare-anneau.js <gare> [--rester]`, avec les gares décrites dans sa table `GARES`. La sortie passe par `anneau-gare-nord.js --ent 12` et l'entrée par `anneau-entree-nord.js --ent 12`. Une entrée posée avec l'anneau est démontée directement et retirée de l'état de l'anneau. Faites le 26/10/2026 : N266 O40 et N266 E53 (deux quais fluides : cuves et tuyaux déplacés comme les conteneurs). Avant le relevé, `deplacer-tampons.js ecarts <nom>` montre les liaisons vers des points fixes qui ne passeront pas. Une avance courte avec 6 m d'écart latéral ne passe pas : prendre une autre entrée du point fixe tournée vers le tampon (O40 b7 : `Input2` d'un regroupeur), ou décaler le point fixe (E126 ; `releve --suivre`, pompe d'O96).

Voie basse, faites le 26/10/2026 : N211 O96, O119 et O143 (gares nord) et N204 O100 (gare sud, `anneau-gare-sud.js --ent 12`, gare reculée de 6 m vers l'ouest). **Une gare démontée disparaît des horaires des trains qui la desservent.** Le train du carburant est resté à quai à N204, sa seule gare restante, après la reconstruction de E53. Les scripts de chantier relèvent donc ces horaires au contrôle et les remettent à l'identique (arrêts, arrêt suivant, conduite) une fois la gare renommée.

## Trains et tournées (`plans/trains.js`)

Commandes de l'agent ajoutées le 26/10/2026 (« il va falloir que tu te dotes des outils capables de contrôler tout le trafic ferroviaire ») :
- `trains(opts)` : chaque train avec son nom, ses véhicules dans l'ordre (classe, position, sens), sa conduite automatique, son état (`ETrainStatus`), son erreur (`ESelfDrivingLocomotiveError` : pas de courant, pas d'horaire, gare inaccessible, longue attente à un signal…), son état de quai, la gare où il est à quai, sa vitesse en km/h et son horaire (gares, règle d'attente, arrêt suivant). Filtres : `path` (train ou véhicule), `station` (motif sur les gares de l'horaire), `near` + `radius`.
- `stations(opts)` : gares par leur nom en jeu, avec leur bâtiment et leur position.
- `trainTimetable(train, stops, opts)` : écrit l'horaire (`AFGRailroadTimeTable::SetStops`, puis `SetCurrentStop`) ; `opts.selfDriving`. Un arrêt = `{station, definition, duration, durationAndRule, ignoreFilters}`, la station donnée par chemin ou par nom exact.
- `trainSelfDriving(train, on)`, `trainName(train, nom)`, `enums(nom)`.
- Disposition de `FTimeTableStop` et `FTrainDockingRuleSet` lue par réflexion. Un `bool` natif se passe à Frida en entier (0 / 1) ; une chaîne passée au jeu doit rester référencée en JavaScript pendant l'appel.

**Poser un train** : `buildAim` de `Recipe_Locomotive_C` puis de `Recipe_FreightWagon_C`, en visant le milieu de chaque voie intégrée avec `onActor` (la gare puis ses quais, dans l'ordre). Le véhicule se cale sur le rail, tourne vers la sortie de la gare (du connecteur 0 vers le connecteur 1 de sa voie) et s'attelle au précédent : un seul train se forme. La voie intégrée d'une gare est son champ `mRailroadTrack`.

**Atteler loin du joueur** : un véhicule visé près d'un autre s'y accroche. Le jeu cherche alors le rail sous le voisin par une collision (`ApproximateTrackPositionForVehicle` : sphère d'un mètre, fonction non exportée). Loin du joueur, les rails n'ont pas de collision : sans correctif, l'hologramme reste en (0, 0, 0) avec `FGCDMustHaveRailRoadTrack` et `FGCDNotEnoughSpaceOnTrack`. Depuis le 26/10/2026, `buildAim` refait ce calcul avec le rail que le voisin connaît (`repairFarVehicleSnap` dans `game.js`) : même côté d'attelage, même position (demi-longueur de chacun), sens du rail pour une visée verticale, puis les deux contrôles du jeu (place sur la voie, empiètement). La construction attelle ensuite au voisin (`ConstructVehicle` -> `CoupleTrains`). Le résultat porte `vehicleSnap` (`repaired`, voisin, côté) quand la reprise a eu lieu. Constaté à N204 O100, joueur à 1,7 km : locomotive + 4 wagons attelés. Une visée non verticale n'est pas reprise : son sens dépend de `mScrollTrackDirection`, champ non exposé.

**Tournée** : `node trains.js tournee <gare de chargement>` ajoute un train à la tournée. Il y a un wagon par quai étiqueté non vide (q1…). L'horaire va de la gare de chargement « A -> B » à la gare couplée « B <- A ». Le train porte le nom « A -> B », puis « #2 », « #3 » pour les suivants, et roule en conduite automatique. La gare de chargement doit être libre, ses voies comprises : `tournee` refuse tant qu'un véhicule est à moins de 12 m du milieu de la voie de la gare ou d'un quai. Le 27/10/2026, le #3 de N279 posé à l'instant où le #2 quittait les quais a vu 2 de ses wagons s'atteler à la queue du #2. Règle d'attente par défaut : charger ou décharger une fois, 0 s (utilisateur : « y'a aucune raison de positionner cette attente »). `regle` la change sur des trains existants en gardant leurs gares et leur arrêt suivant.
- L'utilisateur ne veut pas de calcul du nombre de trains (« ça dépendra beaucoup du trafic ») : on pose un train et on ajuste. Sur un long trajet (N279 E331 -> N211 O96, environ 4,3 km), au moins 2 trains d'emblée.
- `node trains.js liste [--gare motif]` ; `horaire <train> <gare>… [--auto]` ; `auto <train> on|off` ; `nom <train> <nom>`.
- Pour l'instant, un seul train par tournée de la métallurgie (utilisateur, 27/10/2026 : « pas besoin de 2 trains par parcours pour l'instant »).

**Retirer un train** : le passer en manuel (`auto <train> off`), puis démonter ses véhicules (`fg.js dismantle`). Relire ensuite chaque véhicule. Le 27/10/2026, sur un train encore à 45 km/h, la locomotive et le premier wagon ont survécu au premier démontage, sans erreur ; un second `dismantle` les a retirés.

**Déraillement** (26/10/2026, deux trains à l'est de l'anneau vbd3) : `trainRerail` (`AFGTrain::Rerail`, ce que fait la touche E du jeu) remet un train sur ses rails, à sa position sur la voie. Un seul train à la fois : deux trains remis en même temps alors qu'ils se touchent déraillent de nouveau aussitôt, un wagon s'est retrouvé à -61 m. Remettre le premier, le faire partir pour dégager, puis remettre le second (`node trains.js rerail <train>`). Loin du joueur, un train qui a déraillé reste « déraillé » sans que ses véhicules tombent ni soient marqués : la remise sur rail ne fait alors rien. Il faut amener le joueur sur place (téléportation près d'un poteau) : les véhicules tombent, puis la remise sur rail marche. Après une remise sur rail, un train peut rester arrêté devant un signal au rouge alors que la voie est libre (itinéraire figé) : couper puis rétablir sa conduite automatique.

**Retenir un train à quai** : la gare copie la règle d'attente à l'arrivée du train (`mCurrentDockedWithRuleSet`, `mCurrentDockForDuration`). Changer l'horaire pendant l'arrêt ne fait rien. `stationReleaseDock` (`AFGBuildableRailroadStation::ClearRuleSetTimeRequirement`) lève la durée en cours, et le train part dès que sa règle est remplie. Un train retenu ne doit jamais l'être encore quand un autre train a besoin de sa gare : ce dernier attend devant l'anneau et bloque la ligne.
- Lu avec Ghidra le 26/10/2026 : `StartDocking` remet le compteur de la gare à zéro, recopie la règle de l'horaire, puis appelle `AFGTrain::OnDocked`. Le compteur monte pendant l'arrêt (`Factory_Tick`). Chaque quai de marchandises relit la règle et le compteur de la gare à chaque mise à jour (`AFGBuildableTrainPlatformCargo::EvaluateRuleSet`). Avec « charger / décharger une fois », il ne laisse partir le train qu'une fois la durée dépassée.
- Donc, pour retenir un train déjà à quai, on écrit la durée dans la copie de la gare : `stationHoldDock <gare> <s>`, ou `stationHold` dans `game.js`. La retenue s'arrête d'elle-même si l'agent tombe.
- Un arrêt sans rien à transférer dure **0,1 s** (N279 le 26/10/2026, tampons vides). Un relevé par seconde ne voit pas un tel arrêt : les arrivées se prennent sur l'événement `OnDocked`.

## Régulation d'une tournée (`plans/regulateur.js`)

Demande de l'utilisateur, le 26/10/2026 : « on passe à la régulation de la ligne n279 », « il faut que tu maintiennes un temps moyen par boucle », « on s'en fout du temps d'arrêt », « est-ce qu'on peut taguer ça pour ne pas avoir à le refaire ? ». Le régulateur de `game.js` (`lineRegStart`) démarre avec l'agent (`install`) et n'occupe pas l'hôte :
- **Tournée régulée :** celle de toute gare qui porte l'étiquette `regulation`. Les étiquettes sont sauvegardées avec la partie. Tous les trains dont l'horaire passe par cette gare sont régulés, groupés par horaire. Le régulateur les relit toutes les 10 s : un train ajouté ou refait est pris tout seul.
- **Arrivées :** il s'accroche à `AFGTrain::OnDocked` et relève les départs à chaque image, pour les seuls trains à quai.
- **Boucle :** somme des trajets moyens, chacun moyenné sur ses 10 dernières mesures. Les arrêts en gare n'y entrent pas. Il y a autant de trajets que de gares à l'horaire. Les mesures sont gardées en étiquette sur la gare de départ : `trajet > <gare suivante> : <mesures en s>`.
- **Calcul à l'arrivée seulement**, dans `OnDocked` (utilisateur, 28/10/2026 : « on a dit qu'on ne faisait pas de calcul à chaque image mais sur onDocked ») ; à chaque image, le régulateur ne fait que relever le départ des trains à quai.
- **Train arrivé derrière un train retenu** (28/10/2026) : un train qui arrive moins de 60 s (`lineRegs.queueS`) après le départ d'un train de sa tournée retenu à cette gare attendait derrière lui, à l'entrée. Son trajet n'est pas mesuré (événement `nonMesure`, `derriere`). Cette attente, créée par le régulateur, comptait avant dans le trajet : la moyenne montait, l'intervalle et les retenues aussi (retour de la N279 mesuré à 1 450–2 000 s, pour 240 s sans attente). Les autres attentes en ligne restent comptées (utilisateur : « une attente peut être normale sur un trajet » : croisements, signaux).
- **Trajets aberrants écartés** (utilisateur, 28/10/2026 : « il faut trouver une manière de plafonner », puis « on pourrait écarter les valeurs qui s'éloignent trop de la moyenne », après une heure de trains en manuel qui avait triplé les moyennes et fait retenir des trains 800 s à quai) : dès 3 mesures, une mesure hors de [moyenne ÷ 1,5 ; moyenne × 1,5] est écartée (événement `ecarte`) et mise en attente. Si les 3 dernières écartées se suivent et se ressemblent (à 25 % de leur médiane : `outlierMax`, `outlierSpread`), le temps de trajet a vraiment changé et elles entrent dans la moyenne (événement `nouveauTemps`). Une suite d'incidents ne se ressemble pas : les trajets de 3 602, 2 671 et 1 087 s de l'arrêt restent écartés. L'ancienne règle acceptait toute suite de 3 écarts, et c'est ce qui avait laissé passer l'arrêt. Un plafond (mesure ramenée dans la borne) a été essayé le même jour : il laissait les moyennes fausses descendre de 5 % par trajet seulement. Les mesures gardées en étiquette sont relues avec la même règle au démarrage.
- **Intervalle :** boucle ÷ nombre de trains.
- **Retenue :** à chaque gare, un train arrivé moins d'un intervalle après le départ du précédent est retenu jusqu'à cet intervalle, au plus un intervalle.

Commandes :
- `node regulateur.js regule "<gare>"` : pose l'étiquette ;
- `node regulateur.js deregule "<gare>"` : retire l'étiquette ;
- `node regulateur.js etat` : état de chaque tournée ;
- `node regulateur.js arrete` | `reprend` : arrêt d'urgence, qui lève les retenues.

Comme pour les étiquettes des quais, l'agent doit tourner avant le chargement de la partie, sinon les étiquettes sont perdues.

**Charge des tournées régulées** (utilisateur : « est-ce que tu es capable de déterminer si une tournée nécessite un train supplémentaire et a contrario si une ligne n'est pas consommée ? ») :
- **Relevés :** à chaque arrivée et à chaque départ, quai par quai, le remplissage du wagon en face et celui du stock du quai. Les inventaires sont lus par `mInventoryStacks` et la capacité par `GetSlotSize`, fluides compris.
- **D'où viennent les quais :** la gare ne liste ses quais (`mDockedPlatformList`) que pendant l'arrêt, juste avant `OnDocked`.
- **Diagnostic** par quai, sur les 10 derniers passages, dès 3 passages. Les seuils de départ sont 10 % (vide), 90 % (plein) et 25 % (stock resté au quai).

| Gare | Constat | Diagnostic |
|---|---|---|
| Chargement | Trains arrivés vides, repartis pleins, et du stock reste au quai | Il manque un train |
| Chargement | Trains repartis vides | Ligne pas alimentée |
| Chargement | Trains arrivés déjà pleins | Ligne pas consommée au déchargement |
| Déchargement | Quai plein, ou trains repartis encore chargés | Ligne pas consommée |
| Déchargement | Trains vides à l'arrivée | Rien n'arrive |

- **Ce que veut dire un arrêt de 0,1 s :** rien n'a pu être transféré. Ce sont soit des wagons vides avec rien à charger, soit des wagons pleins devant un quai de déchargement plein. J'en avais d'abord conclu « ligne pas alimentée » sur la N279, et l'utilisateur a corrigé : « ça devrait être ligne pas consommée ».
- **Constaté le 27/10 sur la N279 :** le cuivre, la silice et le quartz sont à 100 % partout, donc la ligne n'est pas consommée : le module nucléaire n'est pas construit. L'acide nitrique (q1) est vide aux deux bouts : ligne pas alimentée.
- **Commande :** `node regulateur.js etat` affiche, sous chaque tournée, la charge gare par gare et quai par quai.

Constaté sur la N279 : trajets de 252 s à l'aller et 230 s au retour, intervalle de 241 s. Une retenue de 167 s a remis les deux trains en opposition (écart de 268 s à l'arrêt suivant, pour 267 visés). Ensuite, des retenues de quelques dizaines de secondes suffisent : 27 s retenus, train parti 30 s après son arrivée.
