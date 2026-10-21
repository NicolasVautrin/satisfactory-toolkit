# Commandes unitaires : `plans/fg.js`

Une commande correspond à une lecture ou à une action. Le résultat est en JSON. `node fg.js help` donne la liste à jour, tirée de l'en-tête du script.

```bash
node fg.js player | teleport <point> [cap] | markers [motif]     # markers : balises de la carte du jeu
node fg.js markers-add <nom> <point> [icone] | markers-remove <motif>   # pose / supprime des balises (AFGMapManager)
node fg.js save [etiquette]                              # sauvegarde nommee agent_<jjmmaa>_<hhmmss>[_<etiquette>], attend le .sav
node fg.js scan <classe> [--near <point|acteur>] [--radius m] [--limit n]
node fg.js pose|bounds|dump|rails|ports|signals <acteur...>   # dump <acteur> [champ...] ; fields <classe> [motif]
node fg.js load-mode <quai...> [load|unload]  |  dismantle <acteur...>
node fg.js call <fonction> [arg...]                      # appel brut de n'importe quelle fonction de l'agent
```

- **`<acteur>`** : un nom court (`Build_TrainStation_C_2146896367`) suffit.
- **`<point>`** : `x,y,z` en coordonnées monde, ou `@u,v,z` dans le repère d'une gare donné par `--frame <gare>[+décalage]`.
- **`--frame`** : chaque position du résultat est aussi donnée dans ce repère (`locationUvz`).
- **`scan <classe>`** accepte une classe de base : `FGBuildablePowerPole` rend tous les poteaux et pylônes, `FGResourceNode` tous les gisements. Les classes C++ s'écrivent sans leur préfixe `A` ou `U` (`FGRailroadSubsystem`, `FGMapManager`).
- **`fields <classe> [motif]`** : pour un bâtiment, utiliser la classe du blueprint (`Build_RadarTower_C`). Pour une classe C++, le nom sans préfixe (`FGRailroadTrackHologram`).
- **`bounds`** : boîte englobante dans le repère de l'acteur (sans son échelle, à lire sur `RootComponent.RelativeScale3D`), avec sa pose. Sert à mesurer un plan d'eau (`FGWaterVolume`) : son centre ne dit rien de son étendue.
- **`dump <acteur> <champ>`** avec un tableau : `--depth 0` en donne seulement la taille (`<N elements>`). Utile avant de lire un grand tableau, comme le brouillard de guerre de `FGMapManager.mFogOfWarRawData`, qui fait 512 × 512 × 4 octets.

## Sauvegarde

`node fg.js save <etiquette>` appelle `UFGSaveSession::SaveGame`, comme le menu du jeu. La sauvegarde est écrite au tick suivant : le jeu ne doit pas être en pause, sinon elle est écrite tout de suite. La commande attend que le fichier `.sav` du dossier `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\<compte>\` ait une taille stable, 60 s au plus. Une sauvegarde complète pèse autant que les sauvegardes automatiques du jeu, environ 8,5 Mo au 21/10/2026. Elle apparaît dans le menu de chargement, sous la session en cours. C'est l'utilisateur qui la recharge.

## Répartiteur intelligent

`node fg.js call smartRules <répartiteur> '[{"item":"any","output":0},{"item":"overflow","output":1}]'` remplace ses règles de tri.
- `item` : `any`, `overflow`, `none`, `undefined`, ou le chemin d'une classe d'objet.
- Sans règles, la commande lit les règles en place.
- `output` 0 = centre (`Output1`), 1 = `Output2` : vérifié au débit le 21/10/2026 (trop-plein mis sur 1, seul `Output2` raccordé, la foreuse en amont n'est plus bloquée). 2 = `Output3`, par déduction.
- Le trop-plein ne part que si les autres sorties sont bloquées et que le tampon du répartiteur est au moins à moitié plein.

## RPC utiles (via `fg.js call` ou `client.js`)

| RPC | Rôle |
|---|---|
| `ground(x, y, zHaut, zBas)` | altitude du relief ; `null` si le terrain n'est pas chargé, vers 1,9 km du joueur |
| `rays(segments, {who: true})` | lancers de rayons en lot ; `who` rend le composant touché |
| `check(recette, de, vers)` | pose à blanc : disqualificateurs du jeu, rien n'est construit |
| `buildAim(recette, de, vers, opts)` | construit à l'endroit visé si le jeu valide (`opts.onActor` : sur ce bâtiment, même loin) |
| `wire(a, b)` | câble entre deux bâtiments, ou un connecteur nommé (`<pylône>.PowerTowerConnection`) |
| `power(acteur)` | connecteur électrique : câbles, circuit, courant |
| `powerReach(depart, exclus, cible)` | parcours du réseau électrique jusqu'à un générateur |
| `lightweight(classe, centre, rayon)` | pièces légères (fondations, rampes...) : positions ; `lightweightRemove` les retire |
| `railLink(sous-système, railA, connA, railB, connB)` | relie deux connecteurs de rail sans collision ; voir `rails.md` |
| `saveGame(nom)` | sauvegarde nommée, sans attente (préférer `fg.js save`) |
| `addMapMarkers` / `removeMapMarkers` | balises (préférer `markers-add` / `markers-remove`) |
| `smartRules`, `setClock`, `pauseMany`, `addItems` | réglages des machines ; `addItems` fabrique des objets : seulement avec l'accord de l'utilisateur |
