# Convoyeurs, ascenseurs, répartiteurs : `plans/beltline.js`

## Chantier de foreuses autour d'une gare : ordre et outils

Leçons de la gare des mines (23/10/2026) : le relief découvert en échouant, des lignes tracées une par une qui se barrent la route, le courant posé avant les convoyeurs. Ordre à suivre :

1. **Carte du relief**, avant de placer quoi que ce soit : `node tracer.js carte --centre x,y|<acteur> [--rayon 150] [--pas 8] [--bande 5] [--acteurs a,b]`. Une case par maille, un chiffre ou une lettre par tranche d'altitude, `^` surplomb, `~` mer, `o` bâtiment au sol. On y lit les falaises, les plateaux, les arches. L'utilisateur : « juste que tu puisses te faire une carte mentale du relief ».
2. **Foreuses**, orientées par le chemin de leur ligne : `node foreuses.js <gisement>[@auto|@<cap>] ... --ligne-vers <acteur>.<connecteur> --nom <chantier> [--ligne-nom <nom>] [--dry]`.
   - Le chemin d'abord, l'orientation ensuite (utilisateur, 27/10/2026 : « on trouve le path et seulement ensuite on oriente la foreuse, le path ne doit pas dépendre de l'orientation de celle-ci »). Une seule recherche du traceur part à la fois des sorties des 8 caps, à coût égal. La foreuse à poser compte comme obstacle à tous ses caps, son emprise étant lue dans `clearanceData.json`. Le cap est celui de la sortie d'où part le chemin.
   - Sortie prévue à 8 m du centre du gisement, dans l'axe du cap, et 1,3 m au-dessus. Après la pose, la ligne est retracée depuis la vraie sortie, sur le même relevé : `traces/<--ligne-nom, foreuse-<gisement>>-ligne.json`, à poser par `beltline.js`.
   - Essais à blanc du 27/10/2026, avec `--remplace` de la ligne posée à la main : le gisement 110 donne le cap 45 (foreuse refaite par l'utilisateur au cap 40) ; le 54_833 donne le cap 135 (l'utilisateur sort par le côté d'un répartiteur, au cap 120).
   - Sans `--ligne-vers`, ancien choix : parmi les 8 directions où le sol devant la sortie laisse la place d'un premier poteau, sans bâtiment, la plus proche de `--vers`. C'est ce choix qui avait mal orienté les foreuses de calcaire de l'usine de béton.
   - Il pose ensuite à 250 % avec 3 éclats.
   - La zone est chargée par une source de streaming le temps de la visée et de la pose. Il réessaie si une bête est trop près, et signale un gisement déjà exploité.
3. **Parties hautes** propres à la gare (tampons en l'air : relais, convoyeur court, ascenseur par entrée) : script de la gare, modèle `convoyeurs-mines.js`.
4. **Plan groupé des lignes** : `node lignes-gare.js <plan.json> [--trace] [--pose]`.
   - Il affecte les départs aux arrivées en minimisant les croisements, avec des groupes : le cuivre ne va qu'aux entrées du cuivre.
   - Pour chaque croisement inévitable, une des deux lignes passe au-dessus sur poteaux de 6 m. L'outil choisit le plus petit côté du graphe des croisements, et trace les lignes surélevées d'abord.
   - Sur la gare des mines, il retrouve sans rien poser l'affectation obtenue après deux démontages : 3 croisements, cuivre surélevé.
5. **Courant, après les convoyeurs** : `node courant.js --source <acteur> --cibles a,b,... --nom <chantier> [--portee 70] [--cable-max 90] [--suivre lignes.json] [--dry]`.
   - Réseau déjà présent près des cibles (`fg.js scan Build_PowerPoleMk1_C --near ...`, puis `fg.js call power <poteau>` pour son circuit et ses câbles libres) : un passage par groupe de cibles, avec pour source le poteau existant le plus proche. Exemple : cuivre et fer de S13 E101 (25/10/2026), trois passages sur la ligne Mk1 du plateau, quatre câbles directs et un seul poteau neuf.
   - `--cable-max` borne la longueur réelle d'un câble ; la portée ne borne que l'horizontale. Sans elle, l'outil tirait des câbles de 128 à 163 m entre un fond de vallée et des poteaux posés sur un massif.
   - `--suivre traces/<ligne>-ligne.json,...` pose d'abord une chaîne de poteaux le long de lignes de convoyeurs. Le premier poteau est raccordé au réseau par la recherche de chemin. Ensuite, de chaque poteau, l'outil va au point le plus loin de la ligne joignable par un câble dégagé, à 5 m de côté et au niveau de la ligne. C'est la route des chantiers lointains : à vol d'oiseau, des falaises de 100 m séparaient la gare S13 E101 de sa cuvette.
   - Un poteau inséré pour dégager un câble ne monte pas à plus de 12 m au-dessus du sol des deux bouts, et deux poteaux sont toujours à 3 m au moins l'un de l'autre.
   - Pendant la pose, garder la zone chargée avec `node zone-chargee.js pose x0,y0,x1,y1`, puis `retire`.
   - Il cherche un chemin de poteaux Mk2 par A*, avec des portées de 30 à 70 m, chaque câble à au moins 1 m du relief, surplombs compris.
   - Les poteaux ne vont ni sur les convoyeurs ni sur les bâtiments.
   - Une gare n'accepte qu'un câble : l'outil passe par un premier poteau.
   - Sur la gare des mines, le plan à blanc fait 9 poteaux, contre 13 posés à la main, dont des câbles à travers la falaise.

Le réseau électrique (câbles et poteaux) est transparent pour les traceurs (utilisateur : « il devrait être transparent comme la végétation »).

## Tracé automatique : `tracer.js convoyeur`

```bash
node tracer.js convoyeur --de <acteur>.<connecteur> --a <acteur>.<connecteur> --nom <nom> [--poteau 2] [--marge 60] [--frais]
node beltline.js traces/<nom>-ligne.json build --nom <nom>-sol
```

- Ligne au sol sur poteaux qui suivent le relief : le convoyeur passe de 1 à 6 m au-dessus du sol, à `--poteau` m (2 par défaut) de préférence. Elle part d'un point 4 m devant la sortie de départ et arrive à un point d'approche 5 m devant l'entrée d'arrivée.
- **Recherche** :
  - A* sur une grille de 4 m, en 8 directions, avec un virage de 45° compté comme 6 m de plus ;
  - chaque nœud garde l'ensemble des hauteurs de convoyeur encore possibles (1 à 6 m au-dessus du sol), propagé de maille en maille par les règles des lignes droites : la grille enjambe un creux ou un talus sur des poteaux plus hauts. Chaque mètre de la plus basse hauteur possible au-dessus de `--poteau` coûte 5 m par maille ;
  - **ascenseurs** aux falaises de 8 m et plus : relais en l'air (fusionneur) du côté haut, convoyeur à plat jusqu'à lui (40 m au plus), jusqu'à 3 colonnes de 47 m, chacune 4 m plus loin que la précédente, pied 1 m au-dessus du plus haut sol sous la colonne et 5 m au-delà. En descente, la ligne repart du pied tout droit ; en montée, elle arrive au pied. Un ascenseur coûte 30 m ;
  - puis raccourcis en lignes droites de cap quelconque : de chaque point, le plus loin joignable, à 45° au plus du sens d'un connecteur de relais ou d'ascenseur ;
  - départ au-dessus du vide (foreuse au sommet d'une aiguille) : seule une descente en part.
  - L'utilisateur demande « grandes lignes droites sans escaliers, mais en suivant les vallées ».
- **`--remplace <acteur>.<connecteur> [--sortie <connecteur>]`** : ignore une ligne existante, suivie depuis ce connecteur comme le fait `diag-convoyeur`, avec ses poteaux et les convoyeurs branchés aux autres sorties de ses répartiteurs. Sert à retracer une ligne, ou à essayer le traceur sur une ligne posée à la main.
- **Piloter la recherche** (utilisateur, 27/10/2026 : « tu imposes pas des points de passage au tracer pour le piloter un minimum ? ») :
  - `--par x,y;x,y` : points de passage, en uu, atteints dans l'ordre. Chaque nœud porte le nombre de points déjà atteints : la recherche reste optimale, et les lignes droites ne sautent jamais un point de passage. Un point fermé à toutes les hauteurs est signalé ;
  - `--eviter x0,y0,x1,y1;…` : rectangles interdits à toute hauteur (zone d'extension future, abords d'un bâtiment), pris en compte par tous les contrôles du gabarit, ascenseurs et lignes droites compris.
- **Grille de 4 m, aveugle aux passages étroits et aux grottes** (choix de l'utilisateur, 27/10/2026 : « je préfère un tracer un peu plus rapide qui reste aveugle à ce genre de passage ») : le relevé prend la plus haute des 4 mailles voisines, un obstacle déborde donc jusqu'à 4 m. Sous un grand toit de roche, les surplombs ne sont trouvés que de proche en proche : des mailles restent au toit, et lesquelles dépend de la zone relevée. Passage du caterium de la côte (2147219490, sol 55-79 m, toit vers 150 m, roche jusqu'à 280-380 m) : fermé même avec `--par` et `--releve 2` ; `diag-convoyeur` de la ligne posée y voit des dizaines de mailles au toit. Un tel passage se trace à la main.
- **Coupe** : `node tracer.js coupe --de x,y|<acteur> --a x,y|<acteur> [--pas m] [--dz m]`, ou `coupe --ligne traces/<nom>-ligne.json` pour le profil en long d'une ligne tracée (convoyeur `=`, poteaux `|`, ascenseurs `H`), ou les deux pour couper un segment dans le relevé de la ligne. Une colonne par pas, une rangée par tranche d'altitude ; `#` relief et roche (vide entre le sol et le dessous d'un surplomb), `~` mer, `o` bâtiment. Le relevé couvre 80 m autour du trajet : un surplomb n'est trouvé que par contraste avec des mailles hors de la roche (à 20 m de marge, toute la ligne du caterium était sous le toit, sol vu à 275 m au lieu de 80 m). Le fichier de ligne garde la zone relevée par la recherche (`releve`) : la coupe relit le même relevé.
- **Surplombs, relevé `relief8`** (27/10/2026, passage du caterium) : une maille voisine d'un surplomb est sondée si un balayage horizontal l'atteint à 2, 6 ou 12 m au-dessus du sol voisin (à 2 m seulement, un bloc au sol fermait le passage). Une maille rejetée est retentée depuis une voisine d'un autre niveau : le sondage cherche le sol à 6 m près de celui de la voisine.
- **Une ligne droite est posable si** :
  - ses poteaux sont espacés de 40 m au plus ;
  - la pente reste sous 0,55 (30°) entre deux poteaux ;
  - le relief passe sous la corde entre deux poteaux d'au moins 30 cm plus 5 % du dénivelé de la portée ;
  - aucun obstacle ne gêne, ni sur le convoyeur ni sur la colonne d'un poteau ;
  - le convoyeur ne passe jamais sous la mer.
- **Forme réelle d'une portée** (mesurée le 27/10/2026 sur 10 tronçons posés de la ligne 110) : le jeu pose les bouts à l'horizontale sur chaque poteau, et la courbe passe sous la corde du côté bas, jusqu'à 4,4 % du dénivelé (0,35 m pour 8 m sur 32 m). D'où la marge de 5 %.
- **Poteaux imposés** (utilisateur, 27/10/2026 : « le jeu ne détecte pas quand un belt traverse le décor, il faut que tu imposes certains poteaux, les maximums locaux sur le plan horizontal ou vertical ») :
  - **en vertical, sur les crêtes** : une portée de plus de 40 m est coupée à sa crête ; une portée dont le relief passe trop près sous le convoyeur reçoit un poteau à sa crête. La crête est le point du relief le plus haut au-dessus de la corde entre les deux poteaux : sur une pente, le plus haut point tout court serait le bout haut. Les poteaux ne sont remontés (convoyeur jusqu'à 6 m du sol) que lorsqu'une portée est trop courte pour être coupée (8 m au plus court). À défaut, poteaux régulièrement espacés, de plus en plus serrés ;
  - **en horizontal, aux coudes** : une ligne droite ne s'écarte jamais de plus de 4 m (une maille) des points de la recherche qu'elle saute ; au-delà, elle s'arrête au coude et un poteau y est posé.
  - Essais du 27/10/2026 (lignes posées à la main ignorées, aucun contact avec la roche au balayage réel) : 110 902 m et 35 poteaux (30 avant, sans crêtes ni coudes ; 61 depuis la sortie prévue de la foreuse, espacement régulier seul), 54 9 poteaux, caterium 8.
- **Sol sous un poteau** : `tracer.js` le relit dans la fenêtre de `beltline.js` (15 m au-dessus, 30 m sous le sol prévu) ; sans sol naturel, il cherche un bâtiment comme `beltline.js` (fondation au-dessus d'un trou sur la ligne 110). `beltline.js` règle la hauteur du poteau sur le sol trouvé (`top`) : alerte si elle sort de 1 à 7 m.
- **Obstacles** : ceux de `tracer.js`, plus les ascenseurs, en colonne du pied au sommet (`mTopTransform`). La foreuse de départ reste un obstacle ; seul l'ascenseur d'arrivée est ignoré. Relancer avec `--frais` après chaque ligne posée, pour que la suivante l'évite.
- **Montée à une entrée en hauteur** (tampons d'une gare en l'air) :
  1. convoyeur court de l'entrée jusqu'au bord de la plateforme, sur un poteau posé dessus ;
  2. ascenseur descendant accroché au bout de ce convoyeur ;
  3. ligne au sol jusqu'au pied de l'ascenseur.

  Deux entrées superposées d'un même conteneur (+1 et +5 m) ne peuvent pas prendre chacune un ascenseur dans la même colonne : écarter leurs convoyeurs courts de 3 m de part et d'autre. Script de référence : `plans/convoyeurs-ici.js`, 7 lignes du terminus de l'ancien Venray.
- **Bouts de ligne** (leçons de la pose du 23/10/2026) :
  - deux poteaux dans l'axe du connecteur d'arrivée, à 12 m et à 6 m : les deux derniers tronçons sont droits ;
  - un tronçon court a des bouts horizontaux : c'est une courbe d'Hermite dont la pente au milieu vaut 1,5 fois la moyenne. Une moyenne de 0,55 sur 5 m est refusée (`FGCDConveyorTooSteep`), et même 0,3 sur 6 m au bout d'une ligne sur poteaux de 6 m : `tracer.js` vise 0,2 sur les deux derniers poteaux ;
  - départ d'une sortie hors de l'axe de la grille (cap 160) : la maille de départ peut retomber dans la foreuse. `tracer.js` recule alors le point de départ le long de l'axe, jusqu'à 20 m ;
  - pas de poteau sur un sol raide (bord de colline) : beltline le décale de 3 à 6 m, hors de l'axe, et le tronçon suivant tourne trop. Le premier point praticable de l'axe est pris à 4, 8, 12 ou 16 m ;
  - **le jeu donne un poteau 1 m plus court que demandé** : `tracer.js` demande 1 m de plus ;
  - le pied d'un ascenseur se règle 1 m au-dessus du plus haut des deux sols : sous lui, et à son point d'approche ;
  - le tracé peut franchir un convoyeur existant par-dessus, sur des poteaux 4 m plus hauts, avec un coût qui limite ces franchissements ;
  - **sol exact sous chaque poteau** : `tracer.js` le relit à la fin et affiche `ATTENTION` quand il s'écarte de plus de 1,5 m du sol prévu. Le relevé en mailles lisse le bord d'une marche, alors que beltline cherche le sol à la verticale du point. Ligne du caterium 169 de S13 E101 (25/10/2026) : un poteau prévu à 126 m a été posé à 115 m, au pied d'une marche de 11 m, et le tronçon suivant a été refusé (`FGCDInvalidPlacement`). Correction : démonter le tronçon et son poteau, retirer le dernier tronçon de l'état, déplacer le point dans `traces/<nom>-ligne.json` sur le sol prévu, puis `beltline ... check` et `build`.
- **beltline** compare les sommets de poteaux, et non plus les sols, pour sa vérification de pente entre deux bouts. Avant cela, il refusait un poteau haut sous une sortie en surplomb, comme une foreuse à flanc de colline.
- **Échec** : « recherche abandonnée après N nœuds » (limite de 400 000 atteinte) n'est pas « grille fermée » (aucun chemin dans le modèle).
- **Diagnostic d'une ligne posée** : `node tracer.js diag-convoyeur --de <foreuse>.Output0 [--sortie <connecteur>]` suit la ligne réelle jusqu'au premier fusionneur. `--sortie` choisit la sortie d'un répartiteur qui en a plusieurs de branchées. La ligne est rejouée tous les 4 m dans le modèle de la recherche. Pour chaque tronçon, il affiche :
  - le refus de la grille : mer, maille fermée par un obstacle, pente du sol, bosse ;
  - le sol du modèle et la hauteur réelle du convoyeur ;
  - les ascenseurs.

  Lignes de calcaire 110 et 54 de l'usine de béton (27/10/2026), posées à la main après « grille fermée » :
  - le traceur ne pose pas d'ascenseur : une falaise (110, 35 m) ou une foreuse au sommet d'une aiguille (54, 108 m) ferme la grille ;
  - la grille demande une pente du sol de 0,55 au plus entre deux mailles de 4 m : un creux de 4 m ou un talus de 6 m, que la vraie ligne enjambe sur des poteaux plus hauts, la ferme aussi ;
  - sous l'arche `CliffPillar_320`, des mailles non sondées ont fait un mur à 193 m, corrigé dans le relevé (`relief6`).

```bash
node beltline.js <ligne.json> check|build [--nom <nom>] [--pas <m>] [--jusqua <n>] [--suivre]
```

- `<ligne.json>` : recette, connecteur de départ, points du tracé (uu), raccord final facultatif, `groundAbove` (m).
- Tronçons de 40 m au plus ; le jeu ajoute un poteau au bout de chaque tronçon posé au sol ; état dans `<nom>-state.json`.
- **Points d'ascenseur** (écrits par `tracer.js`) : `{ lift: "descente"|"montee", x, y (relais), top, foot, u, cols, entry, exit }`. beltline pose le relais en l'air (fusionneur, `ignore: FGCDInvalidFloor`, sortie dans le sens de la ligne), puis les ascenseurs depuis le haut : un ascenseur montant accroché au bout d'un convoyeur se pose à l'envers. Le pied de chacun doit regarder la colonne suivante : molettes 180, 0, 90 et 270 essayées, l'ascenseur est démonté et reposé (1,5 s d'attente) tant que le pied est mal tourné ou la colonne à plus de 2 m du plan. Descente : convoyeur jusqu'à l'entrée du relais, ascenseurs, la ligne repart du pied. Montée : ascenseurs, convoyeur jusqu'au pied, la ligne repart de la sortie du relais. Un ascenseur commencé est repris au lancement suivant (`pending` dans l'état). `check` n'essaie que le relais.
- Un bout refusé (sol en pente, végétation) est retenté à 3 et 6 m de côté ou 5 m en arrière ; pente maximale 30°.
- Le premier point du tracé sert de point de départ et n'est pas posé. Avec un raccord final, le dernier point est remplacé par ce raccord : le dernier tronçon part de l'avant-dernier point. Pour imposer un poteau d'approche, ajouter un point après lui.
- Le sol de chaque bout est cherché dans une fenêtre autour du z du point. Sous une gare ou des quais posés en l'air, prendre ce z sur le relief et non par `ground`, qui touche les bâtiments : sinon le poteau se pose sur le quai.
- Tracé : grandes lignes droites sans escaliers, mais en suivant les vallées ; jamais sous l'eau (règles de l'utilisateur).

## Piles de convoyeurs : `plans/pile-convoyeurs.js`

Plusieurs lignes qui vont dans la même direction passent en pile, sur des poteaux empilables, plutôt que côte à côte au sol. L'utilisateur, le 24/10/2026 : « il faut vraiment que tu apprennes à utiliser les stack de convoyeur ». Chaque ligne garde son étage : il n'y a ni croisement à gérer, ni ordre des arrivées à respecter.

```bash
node pile-convoyeurs.js layouts/<plan>.json axe|colonnes|convoyeurs|verifie [--dry] [--ligne <id>]
```

- **Plan** :
  - `colonnes` : liste de `{ x, y, socle? }` dans le sens de marche ;
  - `lignes` : liste de `{ id, etage, de: "<acteur>.<connecteur>", entree, sortie, a: "<acteur>.<connecteur>" }`. Une ligne entre dans la pile à la colonne `entree` et en sort à la colonne `sortie`.
  - `socle` : poteaux vides sous l'étage 1, pour passer au-dessus d'une ligne existante.
  - Exemples : `layouts/pile-s13e101-plateau.json`, `layouts/pile-s13e101-cuvette.json`.
- **Phases** :
  - `axe` contrôle l'axe hors du jeu, sur le relief et les bâtiments relevés par `tracer.js` : portée de 56 m au plus, pente sous 0,55, étage le plus bas à 30 cm au moins au-dessus du relief, colonnes et convoyeurs de tous les étages libres de bâtiments et de surplombs. Il contrôle aussi chaque entrée et chaque sortie, comme une courbe d'Hermite entre le connecteur et l'accroche : longueur, pente, relief et bâtiments (ceux des deux bouts exceptés). Le relevé à 4 m retient la plus haute des mailles voisines : contre une paroi, il signale du relief qui n'y est pas. Vérifier alors la courbe sur le sol relevé au point près (RPC `reliefPoints`, de chaque côté à 1,5 m) ;
  - `colonnes` pose les poteaux de chaque colonne, du sol jusqu'à son étage le plus haut ;
  - `convoyeurs` pose les tronçons de chaque ligne, du connecteur de départ à celui d'arrivée ;
  - `verifie` contrôle les raccords de chaque ligne, bout à bout.
- **Faits du jeu**, établis lors de l'essai du 25/10/2026 :
  - un poteau empilable monte de 2 m par étage ; son point d'accroche (`SnapOnly0`) est 3 m au-dessus de sa base, tourné dans le sens de marche ;
  - deux convoyeurs se raccordent l'un à l'autre au point d'accroche ; le poteau ne fait que porter ;
  - **empiler** : il faut un point touché fabriqué sur le poteau du dessous (`AFGStackablePoleHologram::TrySnapToActor` pose le nouveau à sa position + 2 m, au même cap). Loin du joueur, un vrai rayon ne touche pas le poteau, qui n'a pas de collision : le poteau se posait alors debout sur le sommet du premier, au cap 0 ;
  - **accrocher un convoyeur à un étage** : point touché fabriqué sur le poteau de l'étage, 30 cm avant l'accroche, du côté d'arrivée ;
  - **dégagement souple** (`FGCDEncroachingSoftClearance`) : un convoyeur ne fait ignorer que les bâtiments de ses deux accroches (`AFGConveyorBeltHologram::GetIgnoredClearanceActors`), donc ni le poteau d'où il part (il s'accroche au bout du tronçon précédent), ni l'étage au-dessus de son arrivée. Ce refus est accepté s'il est seul, après vérification à blanc ;
  - les poteaux se posent sans attendre de démontage, mais un ascenseur reposé juste après en avoir démonté un autre voit encore le précédent : attendre 1,5 s.
- **Entrées et sorties de pile** : chacune est un seul convoyeur, de 56 m au plus. Il faut le sol à peu près au même niveau, ou une portée assez longue pour la montée.
  - Un ascenseur qui alimente une pile s'arrête à la hauteur de son étage, en l'air : son convoyeur jusqu'à la colonne reste à plat. C'est l'option `falaise.pile` de `convoyeurs-s13e101.js` : au sol, ces convoyeurs montaient de 7 à 11 m en 10 m.
  - Une sortie vers une entrée basse descend d'une colonne surélevée par un `socle` : sans lui, l'étage passait sous le relief qui remonte vers les pieds des quais.
  - Une colonne de sortie se place dans l'axe d'approche du connecteur d'arrivée. Un pied d'ascenseur tourné contre une paroi n'a pas d'approche : à S13 E101, q4-b est à 2 m du pied de la banquette. Une sortie de foreuse tournée à l'opposé de la pile donne un crochet : la 515 sort au nord-est et la pile repart vers l'ouest-nord-ouest, d'où un crochet de 110° sur 19 m, au rayon le plus serré de 1,9 m (le minimum du jeu est de 1,8 m). Tourner la foreuse vers la pile quand c'est possible.

## Raccords

- C'est le jeu qui raccorde un tronçon à la construction (`AFGConveyorBeltHologram::ConfigureComponents`), aux connecteurs de `mSnappedConnectionComponents[0|1]`, avant que le tronçon n'entre dans une chaîne de convoyeurs.
- Au bout d'un tronçon posé sur un poteau, la recherche du jeu (`FindOverlappingConnections`) retient souvent le point d'accroche du poteau (`SnapOnly0`), qui ne se raccorde pas. Loin du joueur, elle ne trouve rien.
- `belt` inscrit donc lui-même les connecteurs de départ et d'arrivée après chaque visée. Le raccord se fait alors à toute distance, sans téléporter le joueur (vérifié à 128 m le 18/10/2026). Le résultat donne `snapped`, les connecteurs retenus, et beltline s'arrête si un joint reste libre.
- **Ne jamais raccorder après coup** avec `connect` (`SetConnection`) un tronçon déjà construit : les chaînes de convoyeurs deviennent incohérentes et le jeu plante (`AFGConveyorChainActor::GetItemsForSegment`, plantage du 18/10/2026). Pour réparer un joint ouvert : démonter le tronçon et le reposer entre ses deux voisins (`belt` de `<précédent>.ConveyorAny1` vers `<suivant>.ConveyorAny0`).

## Ascenseurs

`belt` avec une recette d'ascenseur et `opts.endZ`, l'altitude de l'autre bout.
- La hauteur se lit sur le rayon de visée, à son croisement avec l'axe de l'ascenseur (`FHologramHelpers::CalcPoleHeight`).
- `endScroll: 180` tourne la sortie basse à l'opposé de l'entrée.
- L'ascenseur se pose à la longueur de son bras du connecteur de départ : `snapTolerance` 400 depuis un fusionneur (3 m), 1000 depuis un autre ascenseur (4 m).
- Deux ascenseurs bout à bout descendent plus de 48 m, au-dessus de l'eau, sans sol.

Orientation :
- un ascenseur accroché par le haut (descente) ou à une entrée se pose bien, bras tourné vers le connecteur ;
- un ascenseur MONTANT accroché au bout (sortie) d'un convoyeur se pose à l'envers, colonne par-dessus les 2 derniers mètres du convoyeur. Ni la molette ni le rayon de visée n'y changent rien : construire alors la chaîne depuis le haut, en partant d'une entrée ;
- `endScroll` 90 / 270 tourne le bras du bout libre d'un quart de tour par rapport à l'autre bout ;
- accroché sous un autre ascenseur, le second se décale de 4 m, mais il s'est une fois empilé sur la même colonne : vérifier la position obtenue.
- Entre deux fusionneurs face à face à 4 m l'un de l'autre (sortie du haut vers l'entrée arrière du bas), l'ascenseur descend ou monte en ligne droite, sans demi-tour : c'est le montage des lignes de la côte du bloc EM (`barres-em.js`, 25/10/2026), comme répartiteur → raffinerie du bloc cuivre. Règle de l'utilisateur : pour les grandes hauteurs, lignes à plat et ascenseurs plutôt que de longues rampes.

**Le jeu ne vérifie pas les convoyeurs ni les ascenseurs contre la roche.** Une construction acceptée peut traverser un rocher (capture de l'utilisateur, 25/10/2026 : tunnel sous une arche, sondé seulement au sol et au plafond dans l'axe de la ligne, sans les parois). Dans un relief fermé (grotte, arche), demander le chemin à l'utilisateur ou le relever sur les côtés, pas seulement dans l'axe.

## Fusionneurs, répartiteurs, pompes

- **Poser sur un convoyeur ou un tuyau existant** : `buildAim` avec `opts.onActor`, même loin du joueur et sans sol. Un poteau en l'air est refusé (`FGCDInvalidFloor`).
- **Démonter un fusionneur posé sur un convoyeur** : le jeu recoud les deux moitiés en un nouveau convoyeur, avec un nouveau nom. Relire les noms avant de démonter la suite.
- **Remplacer un répartiteur par un répartiteur intelligent** (21/10/2026) :
  1. démonter le répartiteur : le jeu recoud l'entrée et la sortie centrale en un seul convoyeur, et le convoyeur de la sortie latérale garde un bout libre ;
  2. poser le répartiteur intelligent sur le convoyeur recousu, au même point (`buildAim` avec `opts.onActor`) : il prend le même cap ;
  3. démonter le premier tronçon de la sortie latérale, puis le reposer avec `belt` de la nouvelle sortie au `ConveyorAny0` du tronçon suivant ;
  4. régler les règles avec `smartRules` (voir `commandes.md`).
- **Pompe** : elle se pose directement sur un tuyau existant, sans sol, en suivant sa pente (essai à blanc du 20/10/2026). Inutile de la poser à part puis de refaire deux tuyaux.
  - **Attention au sens** : la sortie (Connection1, côté +X local de la pompe) doit regarder vers l'aval.
  - À l'essai, l'hologramme était orienté dans le sens du tuyau, de son `PipelineConnection0` vers son `PipelineConnection1`. Vérifier son cap à blanc avant de construire.
  - Le retournement par `scrollRotation: 180` n'est pas encore vérifié.
- `opts.fabricatedStart` force le point touché fabriqué au départ, même près du joueur.

## Hauteur des poteaux

`"poleHeight": <m>` sur un sommet (ou sur la ligne) ; RPC `belt` `opts.poleHeight` (uu). Le jeu lit la hauteur là où le rayon de visée croise l'axe du poteau (`FHologramHelpers::CalcPoleHeight`) : un rayon vertical ne donne rien et le poteau prend 7 m ; l'agent remplace le rayon par un rayon horizontal à la hauteur voulue. Le poteau obtenu fait 1 m de moins que demandé (2 → 1 m). Sert à passer sous un convoyeur existant (7 m).
