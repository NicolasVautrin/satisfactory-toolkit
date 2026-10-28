# Piles de machines : `plans/pile.js`

Règles de l'utilisateur : on empile verticalement quand il n'y a pas de fluide, jamais de pile sans plateforme, et on place l'atelier pour que les convoyeurs soient les plus courts. Seuls les consommateurs d'eau restent au niveau de l'eau.

Exception (22/10/2026) : dans les complexes sur l'eau (métallurgie, nucléaire), pas de fondations, les piles sont posées en l'air à l'étage 2 (voir les étages dans `SKILL.md`). La plateforme est alors donnée dans la configuration (`origine`, `cap`, `dessus`) au lieu d'être retrouvée par ses fondations, avec `"enLAir": true` : la machine du pied et les poteaux sont posés en ignorant `FGCDInvalidFloor`. Exemple : `plans/module-stators.js` (phase `piles`), qui écrit les configurations et lance `pile.js`.

```bash
node pile.js plan|machines|raccords|branches|ascenseurs|arrivees|collecteur|courant|recettes|verifie|tout|demonte --config <fichier.json> [--dry]
```

Machines à 1 ou 2 entrées (assembleuses, fonderies...), montées comme les piles d'assembleuses de l'utilisateur (relevées en (-35 950 ; -143 688)) :
- **Étages** : tous les 10 m, la première machine sur la plateforme. La cheminée de l'assembleuse (encombrement doux jusqu'à 10,75 m) déborde dans la machine du dessus ; ce refus est ignoré pour les étages, comme dans les piles de l'utilisateur.
- **Entrées** : un répartiteur 5 m derrière chaque entrée, tourné d'un quart de tour à chaque étage. L'ascenseur vers l'étage du dessus part du côté extérieur depuis un étage pair, de l'arrière depuis un étage impair ; les deux colonnes ne se croisent jamais et chaque branche est un convoyeur droit de 4 m.
- **Sortie** : un fusionneur 6 m devant la sortie, tourné de même ; le produit descend par le côté +x vers un étage pair, par l'avant vers un étage impair.
- **Arrivées** : une ligne par entrée, 15 m derrière les répartiteurs du pied, chacune à sa hauteur (3 m et 7 m chez l'utilisateur), avec un répartiteur par pile et une branche droite vers le pied.
- **Collecteur** : une ligne de fusionneurs 6 m devant les pieds ; sa dernière sortie est celle de l'atelier.
- `verifie` donne les raccords restant à faire : tête de chaque ligne d'arrivée, sortie du collecteur.

## Configuration

Le fichier de configuration donne :
- la recette ;
- la plateforme (`pres` : fondations retrouvées autour du point, cap de la grille et dessus lus en jeu) ;
- `dos` : le côté de l'arrière des piles ;
- le centre de la rangée, le nombre de piles et d'étages, le pas entre piles (16 m) ;
- la hauteur et le sens de chaque arrivée, le sens du collecteur ;
- les poteaux, et le poteau du réseau électrique.

Exemple : atelier de silice du complexe d'acide, 2 piles de 8. État : `plans/<nom>-pile-state.json`.

- **Poteaux** : `poteaux: [[lx, ly], ...]` (m, repère de la rangée). Avec au moins deux poteaux par pile, les étages de chaque pile se partagent ses poteaux par tranches. Sinon, une pile entière va sur un poteau, et un Mk3 (10 connexions) ne suffit pas pour une pile de 10 plus la chaîne et le réseau. Exemple : module alu, 4 poteaux pour 2 piles de 10 fonderies, câbles de 92 m au plus.
- **Les essais à blanc de bâtiments ne voient pas les rails** (filactif, 27/10/2026) : 15 raffineries ont été acceptées puis posées sur la double voie nord-sud à l'est des bandes (x -75 827 / -75 177). Avant de prolonger une rangée, chercher les voies (`scan FGBuildableRailroadTrack`, `fg.js rails`) et s'arrêter 10 m avant.
- **Constructeur à 3 ingrédients** (oscillateurs, 27/10/2026, `plans/oscillateurs.js`) :
  - `pile.js` monte une colonne par entrée de la machine. L'entrée inutile se déclare dans `libres: ["Input2"]`, pour ne pas poser une colonne vide.
  - Écart entre piles : 22 m. À 19 m, les ascenseurs latéraux de deux piles voisines se gênent (soft clearance). Étages de 14 m, comme les piles de l'utilisateur.
  - Une pile de 9 étages monte à 112 m au-dessus de son pied, et un câble ne dépasse pas 100 m. Il faut donc un second rang de poteaux en hauteur : `poteaux: [[lx, ly, h], ...]`, avec `h` en mètres au-dessus de la plateforme (oscillateurs : `h = 70`). `pile.js` répartit les étages entre les rangs par tranches.
- **Fonderie simple** : `Build_SmelterMk1_C` se construit avec `Recipe_SmelterBasicMk1_C`, et `Recipe_SmelterMk1_C` construit la fonderie à deux entrées (`Build_FoundryMk1_C`). `rules.js` (`BUILD_RECIPE`) fait la correspondance, et `pile.js` s'arrête si le bâtiment appris n'est pas le producteur de la recette.

## Bloc de fonderies au-dessus des générateurs : `plans/acier-compacte.js`

Lingots d'acier compacté (27/10/2026) : 200 fonderies en 2 rangées de 10 piles de 10, en l'air à +92 m, au-dessus des générateurs du module 1 de carburant pour fusées, au bord sud du champ, côté gares. Leçons :
- **Fonderie à deux entrées** (`Build_FoundryMk1_C`) : elle se construit avec `Recipe_SmelterMk1_C` (`rules.js` `BUILD_RECIPE`). Entrées 8 m derrière le centre, sortie 8 m devant : les arrivées passent à 28 m derrière l'axe et le collecteur à 20 m devant.
- **Rangées face à face** : collecteurs au milieu, axes à 24 m du milieu ; poteaux à 17 et 21 m devant l'axe, comme au module alu.
- **Déplacer une pile** : `pile.js` garde la plateforme dans son état (`<nom>-pile-state.json`, clé `plateforme`) et la préfère à la configuration. Il faut supprimer l'état, une fois les pièces démontées, même s'il ne vient que d'un essai à blanc.
- **Démontage groupé** (`dismantleMany`) : les 123 ascenseurs d'une rangée ont survécu au premier passage, pourtant comptés comme démontés. Relire l'emprise après coup et repasser.

## Module de raffineries sur l'eau : `plans/module-alu.js`

Module 1 du complexe aluminium (25/10/2026), au nord de la gare N266 O40 : une rangée de 28 raffineries à 0 m, ses lignes, 80 fonderies en piles à +64 m. Leçons :
- **Fluides échangés entre voisines** : alumine des raffineries d'alumine vers celles de ferraille, eau rendue par la ferraille vers l'alumine. Les raffineries alternent de sens (cap 0 / 180) pour que chaque fluide passe du même côté de la rangée.
- **Réseaux coupés** (utilisateur : « il faut que tu divises ton pipe principal ») :
  - alumine : un réseau par groupe de 7, qui produit ce qu'il consomme ;
  - eau : deux moitiés de 3 extracteurs, exactement l'appoint. Un surplus d'eau d'extracteur bloquerait la sortie d'eau des raffineries de ferraille.
- **Lignes superposées** 5 m devant la rangée (utilisateur : « surtout pense à stacker les convoyeurs et pipes ») : au sud, ferraille à +1 m, eau à +5 m, bauxite à +11 m, seconde ligne de bauxite à +16 m de relais en relais ; au nord, coke à +1 m, alumine à +5 m.
- **Ascenseur direct** d'un répartiteur à +11 m jusqu'à l'entrée d'une raffinerie, 4 m plus au nord : accepté par le jeu.
- **Extracteurs sous la rangée**, sortie au sud. La colonne file 2 m à plat, puis monte presque à la verticale. La pompe Mk1 n'est acceptée que sur la partie verticale (-12,2 m), pas dans le coude (`FGCDPipeAttachmentTooSharpTurn`).
- **Tampon en sortie de quai** (déchargement) : conteneur au cap du quai, entrées à 3 m des deux sorties superposées (phase `tampon`).
- **Montée de la ferraille** : relais U (+1 m, cap 0), V (+49 m, cap -90) et W (+67 m, cap 180) à la même verticale, avec des ascenseurs entre eux ; elle est placée hors de la pile de lignes.
- **Courant** : poteaux Mk3 en l'air ; un poteau par groupe pour les 7 raffineries, un autre pour les extracteurs, les pompes et les piles.

## Atelier en piles au-dessus d'un module : `plans/atelier-dissipateurs.js`

Atelier de dissipateurs (25/10/2026) : une unité par groupe du module 1, à +64 m, au nord de ses piles de fonderies. Chaque unité comprend 2 piles de 10 assembleuses de tôles d'aluminium plaqué et 2 piles de 8 assembleuses de dissipateurs, toutes posées par `pile.js` (configurations écrites par le script). Leçons :
- **Repère de `pile.js` avec un dos au sud** (`"dos": "y"`, cap 0) : entrées au sud, sorties au nord, +lx vers l'ouest. Les arrivées sont 26 m derrière l'axe des machines, le collecteur 17 m devant.
- **Unités en chaîne** : la queue d'une ligne d'arrivée et la tête du collecteur d'une unité restent libres. Un relais (fusionneur) les relie à l'unité voisine, à 84 m.
- **Collecteur vers l'arrivée de l'étage suivant** : quand la sortie et l'entrée regardent du même côté, un fusionneur relais au cap -90 fait tourner le flux. Sans lui, le convoyeur ferait demi-tour.
- **Deux sorties superposées réunies et montées** : fusionneur du bas (cap 180) → ascenseur → fusionneur du haut (cap -90 ; une entrée vient du bas, l'autre de la sortie du haut ; sortie au nord) → ascenseur → sommet (cap 180). C'est le montage U / V / W du module 1.
- **Raccords par direction** : on prend le connecteur libre dont la normale est la plus proche du sens voulu, comme `pile.js`. Il n'y a pas de nom à deviner.
- **Dégagement souple seul en cause** (un ascenseur à 5 m d'un relais existant) : accepté après un essai à blanc sans lui, comme pour les convoyeurs.

## Bloc cuivre sur deux étages : `plans/module-cuivre.js`

Cuivre de l'atelier de dissipateurs (25/10/2026) : 4 rangées de 31 raffineries (lingots purs et tôles à la vapeur), en 2 bandes à deux étages (0 et +32 m), à l'est du couloir x -36 300. Leçons :
- **Ligne qui distribue ce qu'elle collecte** : les lingots passent de raffinerie en raffinerie, avec des fusionneurs devant les producteurs et des répartiteurs devant les consommateurs. Le bout amont doit être un producteur, et deux consommateurs se suivent au bout aval : sans cela, le premier consommateur ne reçoit rien. Le surplus sort au bout aval.
- **Une ligne pour deux étages** : le minerai entre au bout ouest de la rangée du bas, file vers l'est, monte au bout est par un ascenseur de 32 m entre deux fusionneurs à la même verticale, puis revient vers l'ouest en haut.
- **Eau de l'étage +32 m** : extracteurs sous la rangée du bas. Chaque colonne passe hors de la pile de lignes : relais A à -7 m, 17 m devant l'axe, à 8,5 m au-dessus de la sortie de l'extracteur, qui pousse sur 10 m. Puis une colonne de 44 m monte jusqu'au relais B, 9 m plus loin, avec une pompe Mk2 (50 m) sur la partie verticale. Cette pompe, vers 0 m, est hors de portée de l'extracteur : il faut une seconde pompe Mk2 à -14 m sur le tuyau qui va de l'extracteur au relais A (`barres-em.js pompesBasses`, voir `convoyeurs.md`). Elle revient ensuite à la ligne par le connecteur ouest de B : un tuyau ne repart pas en arrière vers le connecteur qu'il vient de quitter.
- **Câbles** : 100 m au plus (`FGCDWireTooLong` à 120 m).
- **Réseaux** : quand un poteau gêne un plan, on déplace le poteau, pas le plan. On pose et raccorde le nouveau d'abord, puis on démonte l'ancien (`dismantle <acteur> true` pour un acteur d'une session précédente de l'agent). Ordre de souplesse de l'utilisateur : électricité, puis tuyaux, puis convoyeurs.

## Pétrochimie du complexe aluminium : `plans/petrochimie-alu.js`

Bloc 1 (coke), au nord du module 1, à -17 m, sans extracteurs : 4 raffineries de résidu lourd pour le carburant, puis 8 paires résidu lourd → coke, reliées par un tuyau direct. Leçons :
- **Tuyau direct entre deux raffineries voisines**, sorties face au même côté et à 8 m l'une de l'autre : il ne déborde que de 2 m devant les connecteurs. Les lignes restent donc à 5 m devant la rangée, comme au module 1.
- **Lignes en pile des deux côtés** : au sud, coke à +1 m et pétrole à +5 m ; au nord, résine à +1 m et résidu à +5 m.
- **Tronc du coke vers le module** : relais (fusionneurs) en l'air, espacés de 44 m au plus, au cap 90 pour filer au sud. À l'arrivée, un ascenseur de 17 m entre deux fusionneurs à la même verticale, sortie et entrée tournées du même côté, monte le coke à la tête de la ligne du module.
- **Vérifier les recettes de toutes les machines** après une série de réglages, en relisant `mCurrentRecipe` (voir la règle sur `Select-Object -First` dans `SKILL.md`).

Bloc 2 (caoutchouc pour le nucléaire) : boucle caoutchouc recyclé / plastique recyclé sur du carburant dilué, plus du caoutchouc résiduel sur la résine du bloc 1. Le plastique n'y est qu'un intermédiaire : il tourne dans la boucle et rien n'en sort. Leçons :
- **Mélangeur au cap 0** : ses 4 entrées sont au nord, à 7 m du centre (tuyaux à x-6 et x-2 m, convoyeurs à x+2 et x+6 m) ; ses sorties sont au sud (tuyau à x-6 m et 7,4 m, convoyeur à x-2 m). Relevé sur `Build_Blender_C_2144552064`. Il tient sous une rangée à 0 m quand il est posé à -17 m : 13,8 m de haut.
- **Deux colonnes pompées** montent l'eau et le carburant de -12 m à +5 m. Elles partent d'une ligne à -17 m placée à 12 m de la ligne du haut, et arrivent par le connecteur libre d'une jonction de la ligne du haut. La pompe reste sur la partie verticale.
- **Un seul réseau de carburant pour les deux côtés de la rangée** : une colonne alimente la ligne du nord, qui fait le tour par le bout ouest de la rangée, à +5 m au-dessus des convoyeurs, pour rejoindre la ligne du sud.
- **Débordement de la résine** : le dernier répartiteur finit dans un broyeur. La résine ne bloque ainsi jamais les raffineries de résidu, donc jamais le coke.
- **Trace d'un réseau de fluide** (`upstream`, `depth` 1) : une machine atteinte d'abord par un autre chemin (par le plastique, par exemple) n'apparaît plus en profondeur 1. Pour contrôler un tuyau, partir d'une de ses jonctions.

Pétrole des puits de l'ouest (oléoduc de 1,2 km, phases `puits`, `oleoduc` et `courantPuits`) :
- **Extracteur de pétrole** : sortie à 7,6 m du centre, du côté +y local, à +1,75 m ; cap = sens voulu de la sortie - 90.
- **Pose sur le gisement** : `buildAim` avec `onActor` = le gisement (`BP_ResourceNode<n>`). Loin du joueur, le jeu refuse avec `FGCDInvalidFloor` tant que le relief n'est pas chargé ; une source de streaming au-dessus du gisement règle le problème sans déplacer le joueur. Penser à la retirer ensuite.
- **Tracé** : relief lu dans le cache `relief5_*` de `tracer.js carte` (`plans/cache/`, champ `z` en mailles de `step` uu), et bâtiments dans son cache `obstacles_*` (segments et boîtes). Les jonctions relais sont à 48 m au plus et à 3 m au moins au-dessus du relief. Un tuyau entre deux jonctions part et arrive à l'horizontale : dans une pente, le contrôle se fait au tiers et aux deux tiers de la courbe.
- **`fluidContent`** ne lit que les réservoirs ; sur une jonction ou un tuyau, il rend n'importe quoi. Juger à la productivité des machines.
