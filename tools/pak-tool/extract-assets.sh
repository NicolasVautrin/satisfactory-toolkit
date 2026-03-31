#!/bin/bash
# Extract all viewer assets from Satisfactory .pak files.
# Requires: .NET 8, Satisfactory installed
# Output: data/viewer-assets/
#
# Structure:
#   catalog/lod0..lod5/   Building meshes (GLB, 6 LOD levels)
#   scenery/lod0..lod4/   Scenery meshes (GLB) + textures/
#   scenery/scenery_layout.json   Merged placements (Persistent_Level + streaming cells)
#   landscape/glb/        Terrain tiles (simplified GLB)
#   landscape/img/        Terrain textures (baked PNG)
#   landscape/landscape_layout.json   Tile coordinates
#   water/glb/            Water plane meshes (GLB)
#   water/water_layout.json   Water placements + rivers

set -e
cd "$(dirname "$0")"

echo "=== Catalog (building meshes) ==="
time dotnet run -- export catalog

echo ""
echo "=== Scenery (meshes + textures + layout) ==="
time dotnet run -- export scenery

echo ""
echo "=== Landscape (terrain tiles + textures) ==="
time dotnet run -- export landscape --ratio 0.15

echo ""
echo "=== Water (meshes + layout) ==="
time dotnet run -- export water

echo ""
echo "Done. Assets in data/viewer-assets/"
