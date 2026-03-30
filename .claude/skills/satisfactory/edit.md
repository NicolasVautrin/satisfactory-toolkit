# Éditeur d'entités (POST /api/game/edit)

Endpoint unifié pour créer, modifier, supprimer des entités, les connecter entre elles, et insérer des splitters/mergers/junctions/pumps sur des splines existantes. Fonctionne sans save chargée (crée un état minimal en mémoire).

Implémentation : `viewer/lib/editor.js` → `editEntities(batch)`.

## Format de requête

```json
{
  "anchor": {"x": 1000, "y": 2000, "z": 500},
  "rotation": 90,
  "entities": [...],
  "connections": [...]
}
```

| Champ | Description |
|-------|-------------|
| `anchor` | Position absolue `{x,y,z}` ou relative caméra `{fromCamera: distance_uu}`. Toutes les positions d'entités sont relatives à l'anchor. |
| `rotation` | Yaw global en degrés (optionnel). Tourne toutes les positions relatives autour de l'anchor et s'ajoute aux rotations individuelles. |
| `entities` | Opérations sur les entités (add, alias, delete). |
| `connections` | Connexions entre entités (direct, belt, pipe, insertion). |

## Système d'identifiants (alias)

Les connexions utilisent exclusivement des **id locaux** déclarés dans `entities[]`. Pour référencer une entité existante dans une connexion, la déclarer comme alias :

```json
{ "id": "belt1", "index": 42 }
```

Cet alias ne modifie pas l'entité — il crée juste un id utilisable dans `from`, `to`, `on`.

## Opérations sur les entités

| Opération | Format | Description |
|---|---|---|
| **Add** | `{id, type, position}` | Crée une entité. `type` = alias wiki (ex: `constructor`, `splitter`). `position` relative à `anchor`. |
| **Alias** | `{id, index}` | Crée un alias sur une entité existante (pour les connexions). |
| **Delete** | `{index, deleted: true}` | Soft delete (le slot devient null, indices stables). |

### Alias de types (typeAliases.js)

L'endpoint accept des alias courts au lieu du typePath complet :
- Producers : `smelter`, `constructor`, `assembler`, `manufacturer`, `foundry`, `refinery`, `blender`, `packager`, `collider`, `converter`, `encoder`, `nuclear`
- Extractors : `miner` (Mk3), `miner-1`/`miner-2`/`miner-3`, `oil-pump`, `water-pump`, `fracker`, `frack-node`
- Belts : `belt` (Mk6), `belt-1` à `belt-6`
- Lifts : `lift` (Mk6), `lift-1` à `lift-6`
- Splitters/Mergers : `splitter`, `smart-splitter`, `prog-splitter`, `merger`, `prio-merger`
- Pipes : `pipe-junction`, `pipe-pump`, `pipe-hole`
- Power : `power-line`

## Types de connexions

| Format | Description |
|---|---|
| `{from:"id:port", to:"id:port"}` | **Directe** — `from` snappe sur `to`. `from` doit être mobile (belt/pipe/lift ou splitter/merger/junction/pump vierge). |
| `{from:"id:port", to:"id:port", belt:tier}` | **Belt auto** — crée un belt (tier 1-6) entre les deux ports. Les deux peuvent être fixes. |
| `{from:"id:port", to:"id:port", pipe:tier}` | **Pipe auto** — crée un pipe (tier 1-2) entre les deux ports pipe. Les deux peuvent être fixes. |
| `{from:"id", on:"id", position:{x,y,z}}` | **Insertion** — insère l'entité `from` sur le belt/pipe `on`, coupe la spline en deux. |

Sémantique : `from` = entité mobile qui se repositionne, `to` = ancre fixe.

## Noms de ports

### Entités fixes (producers, extracteurs)

Voir la page wiki de chaque entité pour les noms exacts. Exemples courants :
- Constructor/Smelter : `Input0`, `Output0`
- Assembler/Foundry : `Input0`, `Input1`, `Output0`
- Manufacturer : `Input0`..`Input3`, `Output0`
- Refinery : `Input0`, `Output0`, `PipeInput0`, `PipeOutput0`
- Packager : `Input0`, `Output0`, `PipeInputFactory`, `PipeOutputFactory`

### Logistique (ports virtuels)

| Type | Ports | Flow |
|------|-------|------|
| Belt | `ConveyorAny0` (input), `ConveyorAny1` (output) | Polarisés |
| Lift | `bottom`, `top` | Bidirectionnels, polarisés par la 1ère connexion |
| Pipe | `PipelineConnection0`, `PipelineConnection1` | — |
| Splitter | `Input1`, `Output1`, `Output2`, `Output3` | Fixés |
| Merger | `Input1`, `Input2`, `Input3`, `Output1` | Fixés |
| Junction | `0`, `1`, `2`, `3` | Tous input (4 directions) |
| Pump | `input`, `output` | Fixés |

## Règles de snap

| Entité qui snappe (from) | Peut snapper sur (to) | Condition |
|---|---|---|
| belt / pipe / lift / track | tout port compatible | toujours |
| splitter / merger (vierge) | endpoint belt ou lift | aucun port déjà connecté |
| junction / pump (vierge) | endpoint pipe | aucun port déjà connecté |
| producer / extracteur | rien | utiliser `belt:tier` ou `pipe:tier` |

- Après la première connexion, splitter/merger/junction/pump deviennent **fixes** (ne peuvent plus snapper).
- Un port belt ne peut se connecter qu'à un port belt, un port pipe qu'à un port pipe.
- Un port input se connecte à un port output (pas input↔input ni output↔output).
- Flag `IS_SPLINE = true` sur ConveyorBelt, Pipe, ConveyorLift, RailroadTrack — validation dans `snapTo()`.

## Polarité des lifts

Les ports d'un lift sont bidirectionnels (`flowType = null`) à la création. La première connexion à un port polarisé fixe la polarité :

- `lift.bottom` connecté à un `Output` (ou `ConveyorAny1`) → bottom = INPUT, top = OUTPUT
- `lift.bottom` connecté à un `Input` (ou `ConveyorAny0`) → bottom = OUTPUT, top = INPUT

`fromSave` restaure la polarité en inspectant le nom du composant connecté (y compris belt `ConveyorAny0` = input, `ConveyorAny1` = output).

Deux lifts top↔top ne peuvent se connecter que si leurs polarités sont **opposées**.

## Rollback

Si une connexion échoue, **toutes** les entités ajoutées dans le batch sont supprimées (rollback atomique).

## Exemples

**Deux constructors reliés par un belt :**
```json
{
  "anchor": {"fromCamera": 5000},
  "entities": [
    {"id": "c1", "type": "constructor", "position": {"x": 0, "y": 0, "z": 0}},
    {"id": "c2", "type": "constructor", "position": {"x": 1000, "y": 0, "z": 0}}
  ],
  "connections": [
    {"from": "c1:Output0", "to": "c2:Input0", "belt": 6}
  ]
}
```

**Connecter à une entité existante (index 42) :**
```json
{
  "entities": [
    {"id": "existing", "index": 42},
    {"id": "c1", "type": "constructor", "position": {"x": 1000, "y": 0, "z": 0}}
  ],
  "connections": [
    {"from": "existing:Output0", "to": "c1:Input0", "belt": 6}
  ]
}
```

**Insérer un splitter sur un belt existant (index 42) :**
```json
{
  "entities": [
    {"id": "belt1", "index": 42},
    {"id": "s1", "type": "splitter"}
  ],
  "connections": [
    {"from": "s1", "on": "belt1", "position": {"x": 1000, "y": 2000, "z": 500}}
  ]
}
```

**Insérer une junction sur un pipe existant (index 55) :**
```json
{
  "entities": [
    {"id": "pipe1", "index": 55},
    {"id": "j1", "type": "pipe-junction"}
  ],
  "connections": [
    {"from": "j1", "on": "pipe1", "position": {"x": 2000, "y": 500, "z": 375}}
  ]
}
```
