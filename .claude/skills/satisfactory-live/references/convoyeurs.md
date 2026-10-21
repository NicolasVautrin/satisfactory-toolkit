# Convoyeurs, ascenseurs, répartiteurs : `plans/beltline.js`

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
