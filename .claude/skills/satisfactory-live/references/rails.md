# Voies ferrées : `plans/railplan.js`

## Sommaire
- Plans de voies (repère, commandes, `check`, greffe sur une ligne existante)
- Raccords et distance du joueur, `railLink`
- Blocs fusionnés, relief, pose par zones
- Gare de triage en anneaux
- Modèle de gare validé
- Hélices
- Pièges propres aux rails (aiguillages, quais, démontage, points libres)

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

- **Joint déjà raccordé** (création d'aiguillage) : un rail qui en part ne s'y raccorde que si le joueur est assez près. C'était le cas à 36, 70 et 139 m, et pas à 170, 336 ni 420 m.
- **Bout libéré par le démontage d'un voisin** : même limite, au départ comme à l'arrivée. Les bouts bas du canyon, à 280 m, ne se sont raccordés qu'après une téléportation à 40 m (21/10/2026).
- **Bout jamais raccordé** : il se raccorde de loin, mais pas au-delà d'environ 1 km. Le 21/10/2026, sur la voie basse, des départs sont restés libres à 1,2 et 1,5 km du joueur ; à 670 m, ils se sont raccordés.
- **Au-delà de la portée**, le jeu pose le rail mais laisse le bout libre, sans erreur.

**Ce que montre le code du jeu** (lu dans Ghidra le 21/10/2026) :
- Juste avant la construction, l'hologramme tenait les bons connecteurs (`mSnappedConnectionComponents`).
- C'est donc pendant la construction que le départ n'est pas relié. `ConfigureComponents` ne fait la liaison directe (`AddConnection`) que sous condition. Sinon, il s'en remet à `FindAlignedConnections`, qui cherche par collision (`OverlapMultiByChannel`, sphère de 1 m). Loin du joueur, il ne trouve rien.

**`build` contrôle chaque raccord voulu**, et répare aussitôt un raccord manqué avec la RPC `railLink` (« départ relié par railLink »). Il ne s'arrête sur « NON RACCORDE » que si le raccord manque encore. Dans ce cas, rapprocher le joueur, puis `remove` et `build` du rail.

`railLink(<RailroadSubsystem>, <rail A>, <connecteur A>, <rail B>, <connecteur B>)` :
1. appelle `UFGRailroadTrackConnectionComponent::AddConnection`, qui relie les deux connecteurs dans les deux sens ;
2. appelle `AFGRailroadSubsystem::RemoveTrack` puis `AddTrack` sur le rail A, pour réinscrire ses graphes (itinéraires des trains, courant des rails).

Le 21/10/2026, à 1,2 km du joueur, `railLink` a relié XSc6 à XSu1, et `verif-plan` est revenu propre. Les rails étaient déjà dans le même graphe : la fusion de deux graphes séparés n'est **pas encore vérifiée**.

Une arrivée sur un aiguillage loin du joueur prend le mauvais connecteur du joint : poser plutôt le rail depuis le joint.

Avec beaucoup de rails dans un plan, `build` ne relit que les rails du plan qui aboutissent au joint. Avant, il relisait tout, soit environ 600 lectures par rail à la gare de triage, ce qui le rendait très lent.

## Blocs fusionnés, relief, pose par zones

**Blocs fusionnés par le jeu** : deux voies trop proches « se touchent » (`AFGRailroadTrack.mOverlappingTracks`, calculé à la pose près du joueur). Le jeu met alors leurs rails dans le même bloc, et les signaux passent en erreur (« le bloc contient une boucle »). `railsignals.js` le signale (« le jeu n'en fait qu'UN »). Mesuré le 20/10/2026 avec des paires de rails d'essai : contact à 6 m d'axe en axe, plus de contact dès 6,2 m. **Une double voie se pose donc à 6,5 m d'axe en axe.**

**Relief** : `rays(segments, { who: true })` rend aussi le composant touché :
- relief : `LandscapeHeightfieldCollisionComponent` ;
- rocher : `StaticMeshComponent`, dont `dump <composant> StaticMesh` donne le maillage ;
- végétation : `FGFoliageInstancedSMC` ;
- bâtiment.

Un relevé du sol tous les 5 à 25 m suffit pour placer un tracé ou des poteaux.

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

### Limites du jeu

Mesurées à blanc le 21/10/2026 sur un quart de tour :
- **Règles annoncées** par le jeu : `mMinBendRadius` 15 m, `mMaxGrade` 25°.
- **Rayon** : un quart de cercle à pente constante de 25° passe dès 16,5 m (16,25 m est refusé, `FGCDTrackTrunToSharp`). Un quart dont la pente change en chemin (0 → 25°, ou 12,5 → 25°) demande 17 m. Le rayon minimal d'une hélice à bouts de niveau est donc de 17 m.
- **Pente** : 25,5° passe encore, 26° est refusé (`FGCDTrackTooSteep`).
- **Exemple** : à 17 m et 25°, la voie extérieure (23,5 m) monte à 18,6°. Chaque tour monte de 49,8 m, et 2 tours avec raccords montent de 87,2 m.

## Pièges propres aux rails

- **Aiguillages** : pour accrocher la bonne branche, on vise 10 cm à l'extérieur du connecteur voulu.
- **Quais** :
  - la rotation à 180° est relative au bâtiment auquel le quai s'accroche ;
  - un quai ne s'accroche pas à un bout de gare déjà raccordé à un rail.
- **Démontage d'une gare ou d'un quai** : il peut laisser sa voie intégrée. Une voie orpheline de longueur nulle a fait monter le joueur sans fin avec le hover pack. `teardown` et `remove` les retirent.
- **Point libre** : la visée part de 50 cm au-dessus du point, avec des normales verticales. Sinon le bout de voie prend la pente du sol, loin en dessous. Le point touché est ensuite remplacé par le point voulu : une voie se pose donc en l'air, au-dessus de l'eau.
  - Point en l'air au-dessus d'un bâtiment (voie à un étage d'hélice, au-dessus d'une voie ou d'une gare) : au-delà de 2 m sous le point, la visée traverse tout ce qui n'est pas le relief. Sinon l'hologramme s'accroche au bâtiment touché : le 21/10/2026, les rails à blanc de l'étage 1 partaient vers les bouts de voie de l'étage du bas, 25 m plus bas.
  - Le bout de voie prend la pente de la normale visée : `grade` (fraction, positive = monte vers `yaw`) incline cette normale. Sans `grade`, un rail entre deux altitudes fait un S, 1,5 fois plus raide au milieu qu'en moyenne ; avec la même `grade` aux deux bouts, il est droit.
  - Le cap d'un point libre est arrondi au pas de rotation du jeu (10°) : hors de ce pas, le rail ondule en plan. Choisir un cap multiple de 10°, ou partir d'un bout de voie existant.
- **Courbes et S** : un quart de cercle se pose en deux rails, 50° puis 40°, pour que le joint du milieu tombe sur un cap multiple de 10°. Un S entre deux voies parallèles se fait en deux arcs de 10° ou 20° : le rayon vaut décalage / (2 (1 − cos θ)), et la longueur 2 × rayon × sin θ.
