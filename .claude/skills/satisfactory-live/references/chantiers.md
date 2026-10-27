# Scripts de chantier et outils annexes (`plans/`)

Chaque chantier a son script, avec des phases (`node <script> <phase> [--dry]`) et un fichier d'état `<nom>-state.json` (non versionné) qui garde les chemins de ce qui a été posé. L'en-tête de chaque script décrit son plan, ses phases et les accords de l'utilisateur : le lire avant de reprendre un chantier.

Les scripts génériques sont décrits ailleurs :
- voies, gares et trains (`railplan.js`, `trains.js`, `regulateur.js`) : `rails.md` ;
- convoyeurs (`beltline.js`, `tracer.js`) : `convoyeurs.md` ;
- piles de machines (`pile.js`) : `piles.md`.

## Complexes et modules

| Script | Chantier |
|---|---|
| `carburant-fusee.js` | Filière carburant pour fusées (mer du nord, entre le bloc cuivre et les modules fer) : module 1 = 7 mélangeurs de carburant pour fusées + 2 nitro, 96 générateurs à 250 %, 120 charbon compacté/min ; layout prévu pour les 7 modules |
| `gares-carburant.js` | Couple de gares du module 1 de carburant (N204 O100 -> N266 E53 : azote, acide nitrique, charbon) : tampons, lignes vers les têtes du module, et arrivées soufre, pétrole, azote, charbon |
| `module-rotors.js` | Unités de rotors de la métallurgie (rangées de 12 raffineries, étages 0 et +32 m) |
| `logistique-rotors.js` | Logistique des rotors à la gare hub0-est2 (chargement des rotors, déchargement fer et cuivre avec tampons) |
| `rotors-29.js` | Lignes de rotors vers le quai 4 de la gare 29 (relais en l'air, ascenseur jusqu'au tampon) |
| `arrivee-minerai-stators.js` | Minerai de fer des modules de stators 1 à 4 depuis la gare hub0-est1, avec tampons |
| `gare27-vers-40.js` | Gare 27 en déchargement du couple 40 -> 27 (raccords en sortie des tampons) |
| `bouts-anneaux.js` | Bouts des anneaux de la voie basse remis à 7 m d'axe en axe (`liste`, `essai`, `pose <anneau> <W|E|X>`) |
| `usine-beton.js` | Usine de béton commune du nucléaire (chenal est, au sud des arches) : 24 raffineries Wet Concrete sur deux étages, 20 extracteurs, calcaire par quatre têtes (gisements 110, 124, 54_833), courant ; fins de ligne des gisements dans `traces/calcaire-*-fin-ligne.json` (`beltline.js`) |

## Eau

| Script | Rôle |
|---|---|
| `reprise-eau.js` | Reprise des colonnes d'eau des premiers modules : extracteurs sous la ligne d'eau qu'ils alimentent, montée presque verticale |
| `pompes-colonnes.js` | Correction des pompes des colonnes de l'étage 1 bis : Mk2 à -12,5 m, Mk1 à +20 m (voir `pieges.md`, colonnes d'eau) |

## Tours et outils

| Script | Rôle |
|---|---|
| `tower.js` / `tower-phases.js` | Pile de machines alimentée par une foreuse, sur le modèle des tours du joueur (tour de béton du gisement 557) ; recettes et connecteurs lus en jeu ; phases `plan` à `verify`, `teardown` |
| `verify.js` | Vérification stricte d'une tour : chaque connecteur de chaque élément, état réel du jeu |
| `knowledge.js` | Connaissances lues en jeu et gardées entre les sessions (`data/live/knowledge.json`) : connecteurs de chaque bâtiment, débits des convoyeurs, cadences des foreuses ; valables tant que la version du jeu ne change pas |
| `frame.js` | Repère local d'une gare (origine à sa sortie, u le long des quais, v à 90°, en mètres) : option `--frame` de `fg.js` |
