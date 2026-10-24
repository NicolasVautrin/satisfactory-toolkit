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
