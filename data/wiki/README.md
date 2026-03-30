# Entity Wiki

Catalogue des types d'entités Satisfactory pour l'API d'édition programmatique.

## Structure

- `_general.json` — règles de positionnement, rotation, connexion de ports
- `_edit.json` — documentation de l'API POST /api/game/edit
- `_query.json` — documentation des API de consultation (entity, camera)
- Pages entités — générées à la volée par `Builder.wikiPage()`, pas de fichiers JSON

## Endpoint

`GET /api/wiki` — sans paramètre retourne l'index, avec `?page=<name>` retourne la page.

## Pages entités (dynamiques)

Générées à la volée par le serveur depuis `Builder.wikiPage()` (défini dans `lib/shared/Builder.js`, overridable par chaque Builder).

```json
{
  "alias": "constructor",
  "className": "Build_ConstructorMk1_C",
  "typePath": "/Game/.../Build_ConstructorMk1.Build_ConstructorMk1_C",
  "clearance": [{ "min": {"x":"...","y":"...","z":"..."}, "max": {"x":"...","y":"...","z":"..."} }],
  "ports": [
    { "name": "Input0", "offset": {"x":"...","y":"...","z":"..."}, "dir": {"x":"...","y":"...","z":"..."}, "flow": "input", "type": "belt" }
  ],
  "snapBehavior": "Description du comportement lors d'un attach"
}
```

Les pages tiered (belt, lift, miner) ont un tableau `tiers` au lieu de `className`/`typePath`.

Pour ajouter des infos spécifiques à un Builder, overrider `Builder.wikiPage()` (voir `ConveyorLift.wikiPage` pour l'exemple avec la polarisation).

## Pages système (fichiers JSON)

Les 3 pages système (`_general`, `_edit`, `_query`) restent en fichiers JSON dans ce répertoire. Elles sont relues à chaque requête — éditables sans restart serveur.
