# Entity Wiki

Catalogue JSON des types d'entités Satisfactory pour l'API d'édition programmatique.

## Structure

- `_index.json` — sommaire avec description courte de chaque page
- `_general.json` — règles de positionnement, rotation, connexion de ports
- `_edit.json` — documentation de l'API POST /api/game/edit
- `_query.json` — documentation des API de consultation (entity, camera)
- `<alias>.json` — une page par type d'entité (constructor, splitter, belt-6, etc.)

## Endpoint

`GET /api/wiki` — sans paramètre retourne l'index, avec `?page=<name>` retourne la page.

## Format d'une page entité

```json
{
  "alias": "constructor",
  "className": "Build_ConstructorMk1_C",
  "typePath": "/Game/.../Build_ConstructorMk1.Build_ConstructorMk1_C",
  "clearance": [{ "min": {x,y,z}, "max": {x,y,z} }],
  "ports": [
    { "name": "Input0", "offset": {x,y,z}, "dir": {x,y,z}, "flow": "input", "type": "belt" }
  ],
  "snapBehavior": "Description du comportement lors d'un attach"
}
```

- **offsets/dirs** : en espace local de l'entité (avant rotation)
- **clearance** : bounding boxes, la première est la box principale
- **snapBehavior** : ce qui se passe quand l'entité est connectée via l'API edit

## Régénération

```bash
node tools/generateEntityWiki.js
```

Lit `viewer/lib/typeAliases.js`, `lib/Registry.js` (PORT_LAYOUT), `data/clearanceData.json` et génère tous les fichiers.

## Édition manuelle

Les fichiers sont relus à chaque requête (pas de cache serveur). Modifier un JSON et re-requêter l'endpoint suffit, pas besoin de redémarrer le serveur.
