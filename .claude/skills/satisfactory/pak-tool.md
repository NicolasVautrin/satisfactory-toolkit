# pak-tool — Extracteur d'assets UE depuis les .pak de Satisfactory

Outil C# (.NET 8) qui parse les fichiers .pak du jeu via CUE4Parse (NuGet) pour explorer et exporter des assets (meshes, textures, landscape, placements d'acteurs).

## Emplacement

`tools/pak-tool/` — projet C# standalone (PakTool.csproj)

## Lancement

```bash
cd tools/pak-tool
dotnet run -- <command> [options]
```

Les **logs** (Serilog) vont sur **stderr**. La **sortie JSON** va sur **stdout** — c'est ce qui permet à une IA de parser la sortie sans bruit.

### Bonnes pratiques d'exécution

- Les exports longs (scenery, water, landscape) prennent **2-5 minutes** — utiliser un `timeout` suffisant (300000+)
- **Ne pas lancer 2 fois** la même commande : utiliser `2>&1` pour capturer stderr+stdout ensemble, et `tail -20` ou `grep` pour filtrer la sortie pertinente en une seule commande
- Exemple complet : `cd /c/Users/nicolasv/satisfactory-toolkit/tools/pak-tool && dotnet run -- export water 2>&1 | tail -5`
- Toujours `cd` dans le répertoire du projet avant `dotnet run`

## Commandes d'exploration

### list-exports — Lister les exports

Scanne tous les packages, construit `{pkg}::{exportName}::{exportClass}`, filtre par regex. **Header-only** : pas de désérialisation.

```bash
# Tous les exports contenant "smelter"
dotnet run -- list-exports --regexp "smelter" --limit 5

# Seulement les StaticMesh
dotnet run -- list-exports --regexp "::StaticMesh$" --limit 10

# SplineComponent dans les packages River
dotnet run -- list-exports --regexp "River.*::SplineComponent" --limit 10
```

Sortie JSON : tableau de strings au format `pkg::name::class`.

### export-details — Deep dump d'exports

Même filtre `--regexp` sur `pkg::name::class`, puis désérialise et dump en JSON complet (Newtonsoft). Filtre optionnel `--jsonpath`.

```bash
# Dump complet d'un export
dotnet run -- export-details --regexp "BP_River_PROT::RiverSpline" 2>/dev/null

# Filtre JSONPath
dotnet run -- export-details --regexp "00BZ6X.*::SplineMesh" --jsonpath "$..SplineParams" 2>/dev/null

# Paginer les exports d'un streaming cell
dotnet run -- export-details --regexp "00BZ6X" --offset 0 --limit 5 2>/dev/null
```

Sortie : tableau JSON (Newtonsoft) sur stdout. Avec `--jsonpath`, seuls les tokens matchés.

## Commandes d'export

Toutes les commandes `export` écrivent des fichiers sur disque et une confirmation JSON sur stdout.

```bash
# Meshes de bâtiments (GLB, parallèle)
dotnet run -- export buildings -p 8

# Meshes de décor + textures diffuses
dotnet run -- export scenery -p 8

# Terrain (heightmap → GLB simplifié + texture baked)
dotnet run -- export landscape -p 8 --ratio 0.15

# Une texture spécifique en PNG
dotnet run -- export texture "FactoryGame/Content/.../TX_Smelter_Alb"

# Meshes par filtre regex
dotnet run -- export mesh "smelter" --type "StaticMesh"

# Placements d'acteurs (Persistent_Level → JSON)
dotnet run -- export actors

# Placements streaming cells → JSON
dotnet run -- export streaming
```

## Options globales

| Option | Défaut | Description |
|--------|--------|-------------|
| `--offset N` | 0 | Pagination offset |
| `--limit N` | 50 | Pagination limit |
| `--output <dir>` | `data/meshes/` | Répertoire de sortie pour les exports |
| `-p N` | CPU count | Parallélisme pour les exports bulk |
| `--ratio N` | 0.15 | Ratio de simplification landscape (0.0-1.0) |

## Architecture

```
tools/pak-tool/
├── Program.cs                    # CLI dispatcher (~130 lignes)
├── ProviderFactory.cs            # Création DefaultFileProvider CUE4Parse
├── JsonOutput.cs                 # Enveloppe JSON paginée (stdout)
├── Commands/
│   ├── ListEntriesCommand.cs     # list-entries (header-only, ExportMap)
│   ├── EntryDetailsCommand.cs    # entry-details (désérialisation)
│   └── ExportCommand.cs          # Tous les exports (buildings, scenery, landscape, etc.)
├── Helpers/
│   ├── CUE4ParseExtensions.cs   # Extensions pour combler le NuGet vs fork
│   ├── LandscapeConverter.cs     # Heightmap → GLB (geometry3Sharp simplification)
│   ├── LandscapeTextureBaker.cs  # Weightmap → PNG (bake couleurs par layer)
│   ├── LandscapeHelpers.cs       # Constantes layerColors, texturePaths
│   ├── MathHelpers.cs            # EulerToQuat, ExtractClassName
│   └── TextureHelpers.cs         # ExtractDiffuseTexture
└── PakTool.csproj                # NuGet only (CUE4Parse, geometry3Sharp, Serilog)
```

## Dépendances

- **CUE4Parse 1.2.2** — Parser d'assets UE4/5 (.pak, .utoc)
- **CUE4Parse-Conversion 1.2.1** — Export meshes/textures
- **geometry3Sharp 1.0.324** — Simplification de mesh in-process (QEM Reducer)
- **Serilog** — Logging sur stderr

## Concepts clés

### Hiérarchie des assets UE

```
provider.Files (~50k paths)
  └── Package (.uasset/.umap)
        └── ExportMap (N entries)
              ├── StaticMesh (mesh 3D)
              ├── Texture2D (texture)
              ├── MaterialInstanceConstant (material)
              ├── BlueprintGeneratedClass (blueprint)
              └── ...
```

- `LoadPackage()` parse le header + ExportMap sans désérialiser les objets
- `ExportsLazy[i].Value` déclenche la désérialisation complète d'un export
- `list-entries` utilise uniquement l'ExportMap (rapide)
- `entry-details` désérialise pour obtenir les détails (LODs, dimensions, etc.)

### Pipeline landscape

1. Lecture du heightmap (UTexture2D BGRA, R<<8|G = uint16 height)
2. Construction de la grille de vertices (componentSizeQuads + 1 par côté)
3. Simplification in-process via geometry3Sharp `Reducer` (ratio configurable)
4. Écriture GLB binaire minimal (JSON chunk + BIN chunk)
5. Bake des textures via weightmap → PNG coloré par layer

### Parallélisme multi-provider

Pour les exports bulk (buildings, scenery, landscape), chaque thread consommateur crée son propre `DefaultFileProvider` — CUE4Parse n'est pas thread-safe sur un provider partagé.