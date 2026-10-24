# Convoyeurs, ascenseurs, répartiteurs : `plans/beltline.js`

## Chantier de foreuses autour d'une gare : ordre et outils

Leçons de la gare des mines (23/10/2026) : le relief découvert en échouant, des lignes tracées une par une qui se barrent la route, le courant posé avant les convoyeurs. Ordre à suivre :

1. **Carte du relief**, avant de placer quoi que ce soit : `node tracer.js carte --centre x,y|<acteur> [--rayon 150] [--pas 8] [--bande 5] [--acteurs a,b]`. Une case par maille, un chiffre ou une lettre par tranche d'altitude, `^` surplomb, `~` mer, `o` bâtiment au sol. On y lit les falaises, les plateaux, les arches. L'utilisateur : « juste que tu puisses te faire une carte mentale du relief ».
2. **Foreuses**, sortie orientée d'après le relief : `node foreuses.js <gisement>[@auto|@<cap>] ... --vers x,y|<acteur> --nom <chantier> [--dry]`.
   - Parmi les 8 directions, il retient celles où le sol devant la sortie laisse la place d'un premier poteau, sans bâtiment, puis prend la plus proche de `--vers`.
   - Il pose ensuite à 250 % avec 3 éclats.
   - Il réessaie si une bête est trop près, et signale une zone non chargée (décor simplifié `StaticMeshProxy` au-dessus du gisement : rapprocher le joueur).
3. **Parties hautes** propres à la gare (tampons en l'air : relais, convoyeur court, ascenseur par entrée) : script de la gare, modèle `convoyeurs-mines.js`.
4. **Plan groupé des lignes** : `node lignes-gare.js <plan.json> [--trace] [--pose]`.
   - Il affecte les départs aux arrivées en minimisant les croisements, avec des groupes : le cuivre ne va qu'aux entrées du cuivre.
   - Pour chaque croisement inévitable, une des deux lignes passe au-dessus sur poteaux de 6 m. L'outil choisit le plus petit côté du graphe des croisements, et trace les lignes surélevées d'abord.
   - Sur la gare des mines, il retrouve sans rien poser l'affectation obtenue après deux démontages : 3 croisements, cuivre surélevé.
5. **Courant, après les convoyeurs** : `node courant.js --source <acteur> --cibles a,b,... --nom <chantier> [--portee 70] [--cable-max 90] [--suivre lignes.json] [--dry]`.
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

- Ligne au sol sur poteaux (2 m par défaut) qui suivent le relief. Elle part d'un point 4 m devant la sortie de départ et arrive à un point d'approche 5 m devant l'entrée d'arrivée.
- **Recherche** :
  - A* sur une grille de 4 m, en 8 directions, avec un virage de 45° compté comme 6 m de plus ;
  - puis raccourcis en lignes droites de cap quelconque : de chaque point, le plus loin joignable.
  - L'utilisateur demande « grandes lignes droites sans escaliers, mais en suivant les vallées ».
- **Une ligne droite est posable si** :
  - ses poteaux sont espacés de 40 m au plus (portée raccourcie si le relief l'impose) ;
  - la pente reste sous 0,55 (30°) entre deux poteaux ;
  - le relief passe au moins 30 cm sous le convoyeur ;
  - aucun obstacle ne gêne, ni sur le convoyeur ni sur la colonne d'un poteau ;
  - le convoyeur ne passe jamais sous la mer.
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
  - le tracé peut franchir un convoyeur existant par-dessus, sur des poteaux 4 m plus hauts, avec un coût qui limite ces franchissements.
- **beltline** compare les sommets de poteaux, et non plus les sols, pour sa vérification de pente entre deux bouts. Avant cela, il refusait un poteau haut sous une sortie en surplomb, comme une foreuse à flanc de colline.

```bash
node beltline.js <ligne.json> check|build [--nom <nom>] [--pas <m>] [--jusqua <n>] [--suivre]
```

- `<ligne.json>` : recette, connecteur de départ, points du tracé (uu), raccord final facultatif, `groundAbove` (m).
- Tronçons de 40 m au plus ; le jeu ajoute un poteau au bout de chaque tronçon posé au sol ; état dans `<nom>-state.json`.
- Un bout refusé (sol en pente, végétation) est retenté à 3 et 6 m de côté ou 5 m en arrière ; pente maximale 30°.
- Le premier point du tracé sert de point de départ et n'est pas posé. Avec un raccord final, le dernier point est remplacé par ce raccord : le dernier tronçon part de l'avant-dernier point. Pour imposer un poteau d'approche, ajouter un point après lui.
- Le sol de chaque bout est cherché dans une fenêtre autour du z du point. Sous une gare ou des quais posés en l'air, prendre ce z sur le relief et non par `ground`, qui touche les bâtiments : sinon le poteau se pose sur le quai.
- Tracé : grandes lignes droites sans escaliers, mais en suivant les vallées ; jamais sous l'eau (règles de l'utilisateur).

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
