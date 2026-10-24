---
name: satisfactory-live
description: "Agir dans la partie Satisfactory en cours avec l'agent Frida (tools/re/frida) : lire le monde, construire, démonter, téléporter le joueur, poser des rails, gares et signaux (railplan.js), des convoyeurs et ascenseurs (beltline.js), des piles de machines (pile.js), câbler le courant, poser des balises, sauvegarder la partie. À utiliser dès qu'une demande vise le jeu lancé (« construis », « pose », « démonte », « prolonge la voie », « téléporte-moi », « raccorde au courant », « mets une balise », « sauvegarde », « où suis-je », un bâtiment ou une position dans la partie), même si l'utilisateur ne nomme ni Frida ni l'agent. Pas pour éditer un fichier .sav (satisfactoryLib, skill satisfactory) ni pour le viewer 3D."
---

# Agir dans la partie en cours (agent Frida)

L'agent `tools/re/frida/` agit dans le jeu lancé (Satisfactory 1.2, Steam) : il lit le monde, construit, démonte et déplace le joueur. Tout passe par les fonctions du jeu, retrouvées par leur nom exporté ou par réflexion. Le module du jeu exporte presque toutes ses fonctions sous leur nom C++ décoré.

## Démarrer

```bash
cd tools/re/frida
python -u host.py > <scratchpad>/host.log 2>&1      # en arrière-plan ; prêt quand le log contient "ready"
curl -s -X POST http://127.0.0.1:8766/shutdown      # arrêt (retire proprement les accroches)
```

- L'agent est formé de `ue.js`, `pump.js` et `game.js`, concaténés. Relancer l'hôte après toute modification de ces fichiers.
- À son démarrage, l'agent fait sauvegarder les étiquettes Unreal des acteurs (`tagsSaveGame: true` dans le log), qui notent ce qu'une gare charge ou reçoit. **Lancer l'agent avant de charger une partie**, sinon ces étiquettes sont perdues : voir `references/commandes.md`, section Étiquettes.
- L'hôte ne traite qu'**un appel à la fois** : les appels simultanés échouent. Lancer les commandes l'une après l'autre.
- Les fonctions appelables sont listées dans `host.py` (`ALLOWED`). Une nouvelle RPC doit y être ajoutée.
- « timeout : … non exécuté (jeu en pause ou partie non chargée ?) » veut dire que le jeu ne tourne pas. L'agent travaille dans la boucle du jeu (`TickFactory`), qui s'arrête en pause : demander à l'utilisateur de reprendre la partie.

## Règles de travail

Ces règles viennent de l'utilisateur ou d'incidents réels. La raison suit chaque règle, pour juger des cas limites.

- **Sauvegarder avant tout changement important** : `node plans/fg.js save <etiquette>` avant une démolition, une grande construction ou des réglages en série. L'utilisateur veut pouvoir revenir en arrière facilement. Citer le nom de la sauvegarde dans la réponse : c'est lui qui la recharge.
- **Ne toucher que ce que la demande vise.** Une nouvelle consigne porte sur la tâche suivante, pas sur ce qui vient d'être fait. Le 21/10/2026, j'ai démonté 14 rails que l'utilisateur ne visait pas (« ma requête concernait uniquement la prochaine tâche »).
- **Ne téléporter le joueur qu'avec son accord.** L'accord vaut pour la tournée demandée, pas pour la suite. Arriver « sur du dur », à côté d'un poteau ou d'une fondation existante, attendre que le terrain charge, puis ramener le joueur à son point de départ, même en cas d'échec : voir `references/pieges.md`.
- **Contrôler après chaque pose, puis dire ce qui est vérifié et ce qui est déduit.** Le jeu peut construire sans raccorder, sans erreur. Contrôles : `verif-plan.js` pour les voies, `fg.js rails` et `fg.js power`, recensement des bâtiments.
- **Aucune adresse ni décalage du binaire écrit en dur** : l'agent doit survivre à une mise à jour du jeu. Ghidra (serveur MCP sur le port 13338, projet `C:\Users\nicolasv\ghidra-projects\satisfactory_cl513885`) sert à **lire** le code du jeu, jamais à fournir une adresse.
- **Lire en jeu** ce qui s'y lit (recettes, positions, connecteurs, gisements), plutôt que `gameData.json` ou `mapObjects.json`.
- **Les constructions sont gratuites**, par choix de l'utilisateur : le coût n'est pas prélevé.
- **Pas de capture d'écran** sans demande de l'utilisateur.

Règles de jeu de l'utilisateur, détaillées dans la mémoire du projet :
- foreuses, pressuriseurs et générateurs toujours à 250 % ; extracteurs d'eau à 100 % (120 m³/min) ;
- ne jamais arrêter la chaîne d'approvisionnement des centrales ;
- pas de convoyeur sous l'eau ;
- voies à 10 % de pente au plus, sauf raccords de gare et hélices ;
- double voie à 6,5 m d'axe en axe, circulation à gauche ;
- gares sur le modèle validé ;
- ne jamais raccorder après coup un convoyeur déjà construit (`SetConnection` fait planter le jeu).

Étages des complexes sur l'eau (métallurgie et nucléaire, mer du nord), mêmes hauteurs partout. Pas de fondations : les machines sont posées en l'air (refus `FGCDInvalidFloor` ignoré). C'est la machine la plus haute d'un étage, mesurée en jeu (`fg.js bounds`), qui fixe la base de l'étage du dessus, avec 2 m de marge :
- étage 0, plan d'eau (-17,3 m) : extracteurs d'eau (sommet -2,4 m), et les machines à fluide basses, mélangeurs (15 m) ou conditionneurs (12 m), posés à -17 m entre eux ;
- étage 1, base 0 m : machines à fluide, dont les raffineries (cheminée à 30 m) et les centrales nucléaires ; une pompe de relevage (20 m) par colonne d'eau ;
- étage 1 bis, base +32 m : machines à fluide (raffineries de la métallurgie) ;
- étage 2, base +64 m : ce qui ne consomme pas de fluide, en piles verticales.

Nucléaire :
- rien ne se construit au-dessus des centrales (27 m de haut) : leurs piles vont à côté ;
- matières radioactives en flux tendu, par convoyeur direct, sans stockage ni train ;
- répartition du radioactif par arbre équilibré de répartiteurs (1, 2, 4, 8, 16), jamais par ligne de répartiteurs ;
- déchets en sortie de centrale : alerter dès une dizaine d'unités en attente.

## Commandes de base : `plans/fg.js`

Une commande correspond à une lecture ou à une action, avec un résultat en JSON. Les préférer à un script écrit pour chaque vérification. `node fg.js help` affiche la liste à jour, tirée de l'en-tête du script.

```bash
node fg.js player | teleport <point> [cap] | save [etiquette]
node fg.js scan <classe> [--near <point|acteur>] [--radius m] [--limit n]
node fg.js pose|bounds|dump|rails|ports|signals <acteur...>     # dump <acteur> [champ...] ; fields <classe> [motif]
node fg.js markers [motif] | markers-add <nom> <point> | markers-remove <motif>
node fg.js dismantle <acteur...> | load-mode <quai...> [load|unload]
node fg.js call <fonction> [arg...]                            # appel brut d'une RPC de l'agent
```

Pour les scripts, `require('./plans/client.js').call(<rpc>, ...args)` appelle l'hôte directement.

## Où trouver le détail

| Sujet | Fichier |
|---|---|
| Commandes `fg.js` en détail : repères `@u,v,z`, `bounds`, répartiteur intelligent, sauvegarde, RPC utiles | `references/commandes.md` |
| Voies ferrées : `railplan.js`, raccords à distance et `railLink`, blocs et écarts, gare de triage, modèle de gare, hélices | `references/rails.md` |
| Convoyeurs, ascenseurs, répartiteurs, pompes, hauteur des poteaux : `beltline.js` ; chantier de foreuses autour d'une gare, dans l'ordre : carte du relief (`tracer.js carte`), foreuses orientées (`foreuses.js`), plan groupé des lignes (`lignes-gare.js`), courant après les convoyeurs (`courant.js`) | `references/convoyeurs.md` |
| Piles de machines : `pile.js` | `references/piles.md` |
| Distance au joueur, téléportation, relief, électricité, tours radar | `references/pieges.md` |

Les règles du jeu sur les trains (signaux, blocs, débit) sont dans le skill `satisfactory`, fichier `trains.md`.

Autres scripts de `plans/` :
- `tampons-quais.js` : tampons des quais de chargement d'une gare (montage validé, toutes gares) : fondations, conteneur à 3 m des entrées, deux convoyeurs Mk6 de 3 m, puis vérification. Les quais sont lus dans l'état de la gare : `node tampons-quais.js <etat> fondations|conteneurs|raccords|verifie --noms a,b,c,d` ;
- `tracer.js` : tracé automatique et déterministe d'une ligne entre deux poses. Il se faufile entre le relief, les rochers, les bâtiments et les câbles, puis le valide avec la collision réelle du jeu. Voir `references/rails.md`. L'utilisateur le veut posé directement, sans lui montrer le tracé ;
- `bulle.js` : démolition d'une zone en bulle (sphère centrée sur le joueur, une balise ou un point). Étapes :
  1. `inventaire` : tout ce qui est dans la bulle, fondations comprises, en un appel (8 s pour 1 000 bâtiments) ;
  2. `surligner` : contour rouge du pistolet de démontage sur les bâtiments ; les fondations ne peuvent pas l'être ;
  3. `voir` / `cacher` : sphère d'hologramme qui montre la bulle ;
  4. `demolir` : par lots de 150, en 16 s pour 860 bâtiments et 790 fondations.

  Foreuses et réseau électrique (pylônes, poteaux, câbles) sont laissés d'office (consigne de l'utilisateur, 22/10/2026) ; `--tout` les inclut. Montrer la bulle et attendre son feu vert avant `demolir`. Un train garé hors de la bulle n'y est pas : le chercher (`scan FGRailroadVehicle`) avant de retirer les voies d'une gare ;
- `railmap.js` : tracé autour d'une gare ;
- `railsignals.js` : audit des blocs, comparé à ceux du jeu ;
- `verif-plan.js` : joints construits comparés au plan ;
- `zones.js` : rails posables depuis une position du joueur ;
- `collect.js` : ramassage des sphères de Mercer et autres objets.
