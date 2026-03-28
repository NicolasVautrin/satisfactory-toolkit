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

## Commandes d'exploration

### list-entries — Lister les exports d'un package

Parcourt les fichiers .pak, filtre par regex sur le path, retourne nom + classe de chaque export. **Header-only** : pas de désérialisation, très rapide (~30k packages en quelques secondes).

```bash
# Tous les packages contenant "smelter"
dotnet run -- list-entries "smelter" --limit 5

# Filtrer aussi par type d'export
dotnet run -- list-entries "smelter" --type "StaticMesh" --limit 10

# Tous les packages (attention : ~30k résultats)
dotnet run -- list-entries ".*" --limit 10 --offset 100
```

Sortie JSON :
```json
{
  "mode": "list-entries",
  "total": 64,
  "offset": 0,
  "limit": 5,
  "results": [
    {
      "package": "FactoryGame/Content/.../SM_SmelterMk1",
      "entries": [
        { "name": "SM_SmelterMk1", "class": "StaticMesh" },
        { "name": "MI_SmelterMk1", "class": "MaterialInstanceConstant" }
      ]
    }
  ]
}
```

### entry-details — Détails d'un package

Désérialise les exports d'un package pour obtenir les détails fins (LODs, dimensions texture, materials).

```bash
dotnet run -- entry-details "FactoryGame/Content/.../SM_SmelterMk1"
```

Sortie JSON avec infos par type :
- **StaticMesh** : lodCount, lods (index + sizeKB), materialCount
- **Texture2D** : width, height, format

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