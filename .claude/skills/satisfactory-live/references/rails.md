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
  - Rails, convoyeurs et tuyaux : courbes échantillonnées.
- **Tracé dessiné à la main** : quand le traceur zigzague ou finit par un S d'un seul rail (les deux voies d'une double voie s'y rapprochent sous 6,2 m), écrire les joints dans `traces/<nom>.json` par un script : caps multiples de 10°, 20° de virage au plus par rail, 12 à 90 m. Le contrôler avec `node tracer.js controler <nom>`, qui utilise le modèle de la recherche (relief, surplombs, bâtiments sous le gabarit, rayon) et le voit à toute distance, puis faire `railplan check`. Exemple : ligne ouest du 24/10/2026, contournement d'un bloc de raffineries et d'une île.
- **Accroche à l'arrivée** : `--arrivee-a <rail>.<connecteur>` (voie simple) fait accrocher le dernier rail à un connecteur existant.
  - Le relevé et les obstacles sont mis en cache dans `plans/cache/` (ignoré par git). Les obstacles sont relus après une heure, ou avec `--frais`.
- **Recherche** : A* en plan, sur la position et le cap par pas de 10°. Elle avance par pas de 16 m et tourne de 10, 20 ou 30° par pas.
  - L'altitude suit un profil imposé : départ à plat, raccord de 64 m, pente régulière, puis à plat à l'altitude d'arrivée.
  - La pente vaut 10 % ; si rien ne passe, la plus douce trouvée par dichotomie jusqu'à 20 %. L'utilisateur : « pour la pente on est pas dogmatique ».
  - Mêmes entrées, même tracé.
- **Gabarit** : 6 m de large pour une voie, 12,5 m pour deux voies à 6,5 m ; il va de 0,5 m sous le rail à 7,5 m au-dessus.
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

**Un signal posé sur un joint fait par `railLink` ne coupe pas les blocs** (constaté le 24/10/2026 à l'anneau de Lund). Les connecteurs connaissent pourtant le signal (`mFacingSignal` / `mTrailingSignal`), mais le jeu fusionne les blocs des deux côtés. Le signal passe en erreur 3, le bloc contenant alors une boucle, et les trains s'arrêtent. Pour réparer, reposer le rail près du joueur (moins de 140 m environ), pour que le jeu fasse le raccord lui-même, puis reposer le signal. Ensuite, vérifier les blocs avec `railsignals.js` (« le jeu n'en fait qu'UN ») ou `mSignalBlockID` des rails. Un joint fait par `railLink` sans signal fonctionne pour la circulation.

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
