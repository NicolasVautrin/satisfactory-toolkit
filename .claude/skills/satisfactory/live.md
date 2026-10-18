# Agir dans la partie en cours (agent Frida)

L'agent `tools/re/frida/` agit dans le jeu lancé (Satisfactory 1.2, Steam) : il lit le monde, construit, démonte et déplace le joueur. Tout passe par les fonctions du jeu, retrouvées par leur nom exporté ou par réflexion, **sans adresse ni décalage écrit en dur** : l'agent doit survivre à une mise à jour du jeu.

- Les constructions sont gratuites, par choix de l'utilisateur : le coût n'est pas prélevé.
- Ce qu'on peut lire en jeu (recettes, positions des objets, connecteurs) se découvre par l'agent, pas par `gameData.json` ou `mapObjects.json`.

## Hôte

```bash
cd tools/re/frida
python -u host.py > <scratchpad>/host.log 2>&1      # en arrière-plan ; prêt quand le log contient "ready"
curl -s -X POST http://127.0.0.1:8766/shutdown      # arrêt (retire proprement les accroches)
```

- L'agent est formé de `ue.js`, `pump.js` et `game.js`, concaténés.
- Relancer l'hôte après toute modification de ces fichiers.
- L'hôte ne traite qu'**un appel à la fois** : ne jamais lancer d'appels en parallèle.
- Les fonctions appelables sont listées dans `host.py` (`ALLOWED`).

## Commandes unitaires : `plans/fg.js`

Une commande correspond à une lecture ou à une action. Le résultat est en JSON. **Utiliser ces commandes plutôt que d'écrire un script pour chaque vérification.**

```bash
node fg.js player | teleport <point> [cap] | markers [motif]     # markers : balises de la carte du jeu
node fg.js scan <classe> [--near <point|acteur>] [--radius m] [--limit n]
node fg.js pose|bounds|dump|rails|ports|signals <acteur...>   # dump <acteur> [champ...] ; fields <classe> [motif]
node fg.js load-mode <quai...> [load|unload]  |  dismantle <acteur...>
node fg.js call <fonction> [arg...]                      # appel brut de n'importe quelle fonction de l'agent
```

- **`<acteur>`** : un nom court (`Build_TrainStation_C_2146896367`) suffit.
- **`<point>`** : `x,y,z` en coordonnées monde, ou `@u,v,z` dans le repère d'une gare donné par `--frame <gare>[+décalage]`.
- **`--frame`** : chaque position du résultat est aussi donnée dans ce repère (`locationUvz`).
- **`bounds`** : boîte englobante dans le repère de l'acteur (sans son échelle, à lire sur `RootComponent.RelativeScale3D`), avec sa pose. Sert à mesurer un plan d'eau (`FGWaterVolume`) : son centre ne dit rien de son étendue.

## Plans de voies : `plans/railplan.js`

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
- les règles du wiki (voir `trains.md`) ;
- les écarts entre voies de blocs différents : au moins 6 m à l'horizontale ou 7 m en hauteur, sinon le jeu fusionne les blocs.

Sur un terrain déjà occupé, les rails existants faussent la vérification à blanc.

**`build`** pose la gare, les quais (accrochés par le jeu), les rails puis les signaux. Il vérifie chaque joint : une liaison entre deux branches d'un même côté est anormale. L'audit des blocs se fait ensuite avec `node railsignals.js --station <chemin complet de la gare>`.

## Modèle de gare validé : `plans/layouts/gare-contournement.js`

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

## Pièges connus

- **Collisions et distance du joueur** : le jeu ne garde les collisions de ses bâtiments qu'autour du joueur. Au-delà d'environ 100 m, un rayon traverse les rails.
  - L'accroche d'un départ de rail et celle d'un signal fabriquent leur point touché sans rayon (`actorHit`).
  - L'arrivée d'un rail sur un joint existant cherche ce joint par collision. Hors de portée, l'agent pose le bout sur le connecteur et le déclare accroché. Ce repli n'a pas encore été exercé en conditions réelles.
- **Aiguillages** : pour accrocher la bonne branche, on vise 10 cm à l'extérieur du connecteur voulu.
- **Quais** :
  - la rotation à 180° est relative au bâtiment auquel le quai s'accroche ;
  - un quai ne s'accroche pas à un bout de gare déjà raccordé à un rail.
- **Démontage d'une gare ou d'un quai** : il peut laisser sa voie intégrée. Une voie orpheline de longueur nulle a fait monter le joueur sans fin avec le hover pack. `teardown` et `remove` les retirent.
- **Point libre** : la visée part de 50 cm au-dessus du point, avec des normales verticales. Sinon le bout de voie prend la pente du sol, loin en dessous.

Autres scripts : `railmap.js` (tracé autour d'une gare), `railsignals.js` (audit des blocs, comparé à ceux du jeu), `collect.js` (ramassage des sphères de Mercer et autres objets).
