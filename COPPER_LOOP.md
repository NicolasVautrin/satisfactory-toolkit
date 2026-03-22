# Boucle ferroviaire optimisée — Nodes de cuivre

## Objectif

Trouver le tracé d'une **boucle fermée** (circuit ferroviaire) qui minimise :

```
coût = longueur(boucle) + Σ distance_XY(node_cuivre_i, boucle)
```

Le tracé ne passe pas forcément PAR chaque node, mais doit passer **au plus près** de l'ensemble des nodes de cuivre de la map.

## Livrables

1. **Waypoints** du tracé optimisé (coordonnées XY du jeu)
2. **SVG** superposant sur la carte topo (`map_topo.svg`) :
   - Les nodes de cuivre (cercles colorés par pureté)
   - La spline du tracé ferroviaire (boucle fermée)

## Données d'entrée

- `data/mapObjects.json` → tous les nodes de cuivre (`type === 'Desc_OreCopper_C'`) avec positions X, Y, Z et pureté
- `map_topo.svg` → carte topo vectorielle (5000×5000 px)

## Correspondance coordonnées jeu ↔ pixels SVG

À calibrer. La map SVG fait 5000×5000 px, les coordonnées jeu couvrent environ -375 000 à +375 000 UU.

```
pixelX = (gameX + 375000) / 750000 * 5000
pixelY = (gameY + 375000) / 750000 * 5000
```

À vérifier avec des points connus (positions de nodes connus vs leur position visuelle sur la carte).

## Algorithme d'optimisation

### Étape 1 — Données
- Charger tous les nodes de cuivre (X, Y en plan horizontal)
- Ignorer Z (altitude) pour l'optimisation du tracé

### Étape 2 — Solution initiale
- Calculer l'enveloppe convexe des nodes de cuivre → boucle initiale
- Ou utiliser un TSP (Travelling Salesman) sur les nodes comme point de départ

### Étape 3 — Optimisation
Le problème est une variante du **TSP avec couverture** :
- La boucle ne doit pas forcément visiter chaque node
- Mais la distance de chaque node au tracé contribue au coût
- Il faut équilibrer longueur du tracé vs proximité aux nodes

Approches possibles :
- **Greedy insertion** : partir de l'enveloppe convexe, ajouter/déplacer des waypoints pour réduire le coût
- **Simulated annealing** : perturber les waypoints aléatoirement, accepter les améliorations
- **2-opt / 3-opt** : optimisation locale classique du TSP

### Étape 4 — Rendu SVG
- Convertir les waypoints en coordonnées pixel
- Dessiner la boucle en `<path>` (spline cubique ou polyline)
- Dessiner les nodes de cuivre en `<circle>` avec couleur par pureté :
  - Pure → or/jaune
  - Normal → orange
  - Impure → rouge
- Superposer sur la carte topo existante

## Script

`tools/optimizeCopperLoop.js` — script autonome qui :
1. Charge le mapData
2. Optimise la boucle
3. Génère un SVG avec la carte topo + nodes + tracé