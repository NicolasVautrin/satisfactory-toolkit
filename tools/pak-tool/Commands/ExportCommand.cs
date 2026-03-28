using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.RegularExpressions;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Textures;
using CUE4Parse_Conversion.UEFormat.Enums;
using PakTool.Helpers;
using Serilog;

namespace PakTool.Commands;

public static class ExportCommand
{
    private static ExporterOptions DefaultOptions => new()
    {
        LodFormat = ELodFormat.AllLods,
        MeshFormat = EMeshFormat.Gltf2,
        MaterialFormat = EMaterialFormat.FirstLayer,
        TextureFormat = ETextureFormat.Png,
        CompressionFormat = EFileCompressionFormat.None,
        Platform = ProviderFactory.Version.Platform,
        SocketFormat = ESocketFormat.None,
        ExportMorphTargets = false,
        ExportMaterials = true,
    };

    // ── export buildings ─────────────────────────────────────
    public static void Buildings(string outputDir, int parallelism)
    {
        var options = DefaultOptions;
        var scanProvider = ProviderFactory.CreateProvider();
        var buildablePaths = scanProvider.Files.Keys
            .Where(k => k.Contains("/Buildable/", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.EndsWith(".uasset"))
            .ToList();

        Log.Information("Scanning {Count} Buildable packages with {N} consumers...", buildablePaths.Count, parallelism);

        var watch = Stopwatch.StartNew();
        var errors = 0;
        var bestMeshes = new ConcurrentDictionary<string, (Dictionary<int, byte[]> lods, long lod0Size)>();

        var queue = new BlockingCollection<string>();
        foreach (var p in buildablePaths) queue.Add(p);
        queue.CompleteAdding();

        var processed = 0;
        var consumers = Enumerable.Range(0, parallelism).Select(i => Task.Run(() =>
        {
            var myProvider = ProviderFactory.CreateProvider();
            Log.Information("Consumer {I} ready ({Count} files)", i, myProvider.Files.Count);

            foreach (var packagePath in queue.GetConsumingEnumerable())
            {
                try
                {
                    var cleanPath = packagePath.Replace(".uasset", "");
                    var allExports = myProvider.LoadPackage(cleanPath).GetExports();

                    foreach (var obj in allExports)
                    {
                        if (obj is not UStaticMesh staticMesh) continue;

                        var meshExporter = new MeshExporter(staticMesh, options);
                        if (meshExporter.MeshLods.Count == 0) continue;

                        var className = MathHelpers.ExtractClassName(packagePath);
                        var lod0Size = meshExporter.MeshLods[0].FileData.LongLength;

                        bestMeshes.AddOrUpdate(className,
                            _ => (ExtractLods(meshExporter), lod0Size),
                            (_, existing) => existing.lod0Size >= lod0Size ? existing : (ExtractLods(meshExporter), lod0Size));
                    }
                }
                catch (Exception ex)
                {
                    if (Interlocked.Increment(ref errors) <= 10)
                        Log.Warning("Error processing {Path}: {Msg}", packagePath, ex.Message);
                }

                var n = Interlocked.Increment(ref processed);
                if (n % 100 == 0) Log.Information("  Processed {N}/{Total}...", n, buildablePaths.Count);
            }
        })).ToArray();

        Task.WaitAll(consumers);

        // Write best meshes to disk
        var files = new List<object>();
        var exported = 0;
        foreach (var (className, (lods, _)) in bestMeshes)
        {
            foreach (var (lodIndex, data) in lods)
            {
                var relPath = Path.Combine($"lod{lodIndex}", $"{className}.glb");
                var outPath = Path.Combine(outputDir, relPath);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                File.WriteAllBytes(outPath, data);
                files.Add(new { path = relPath, sizeKB = data.Length / 1024 });
            }
            exported++;
        }

        watch.Stop();
        Log.Information("Done: {ClassCount} buildings, {MeshCount} files in {Time} ({Errors} errors)",
            bestMeshes.Count, files.Count, watch.Elapsed, errors);

        JsonOutput.WriteExport("buildings", outputDir, bestMeshes.Count, watch.Elapsed.ToString(), errors,
            files.ToArray());
    }

    // ── export scenery ───────────────────────────────────────
    public static void Scenery(string outputDir, int parallelism)
    {
        var options = DefaultOptions;
        var scanProvider = ProviderFactory.CreateProvider();
        var sceneryPaths = scanProvider.Files.Keys
            .Where(k => k.StartsWith("factorygame/content/", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.EndsWith(".uasset"))
            .Where(k => k.Contains("/World/Environment/", StringComparison.OrdinalIgnoreCase)
                      || k.Contains("/Resource/RawResources/", StringComparison.OrdinalIgnoreCase)
                      || k.Contains("/Developers/", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/Texture", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/Material", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/Audio", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/VFX", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/Particle", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/Decal", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/UI/", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("FoliageType", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/Landscape/", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("/Atmosphere/", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Log.Information("Scanning {Count} scenery packages with {N} consumers...", sceneryPaths.Count, parallelism);

        var watch = Stopwatch.StartNew();
        var errors = 0;
        var allMeshes = new ConcurrentDictionary<string, (Dictionary<int, byte[]> lods, long lod0Size, string path)>();
        var allTextures = new ConcurrentDictionary<string, byte[]>();

        var queue = new BlockingCollection<string>();
        foreach (var p in sceneryPaths) queue.Add(p);
        queue.CompleteAdding();

        var processed = 0;
        var consumers = Enumerable.Range(0, parallelism).Select(i => Task.Run(() =>
        {
            var myProvider = ProviderFactory.CreateProvider();
            Log.Information("Consumer {I} ready ({Count} files)", i, myProvider.Files.Count);

            foreach (var packagePath in queue.GetConsumingEnumerable())
            {
                try
                {
                    var cleanPath = packagePath.Replace(".uasset", "");
                    var allExports = myProvider.LoadPackage(cleanPath).GetExports();

                    foreach (var obj in allExports)
                    {
                        if (obj is not UStaticMesh staticMesh) continue;

                        var meshExporter = new MeshExporter(staticMesh, options);
                        if (meshExporter.MeshLods.Count == 0) continue;

                        var meshName = staticMesh.Name;
                        var lod0Size = meshExporter.MeshLods[0].FileData.LongLength;

                        allMeshes.AddOrUpdate(meshName,
                            _ => (ExtractLods(meshExporter), lod0Size, packagePath),
                            (_, existing) => existing.lod0Size >= lod0Size ? existing : (ExtractLods(meshExporter), lod0Size, packagePath));

                        if (!allTextures.ContainsKey(meshName))
                        {
                            try
                            {
                                var texBytes = TextureHelpers.ExtractDiffuseTexture(staticMesh, myProvider);
                                if (texBytes != null) allTextures.TryAdd(meshName, texBytes);
                            }
                            catch { }
                        }
                    }
                }
                catch (Exception ex)
                {
                    if (Interlocked.Increment(ref errors) <= 10)
                        Log.Warning("Error processing {Path}: {Msg}", packagePath, ex.Message);
                }

                var n = Interlocked.Increment(ref processed);
                if (n % 100 == 0) Log.Information("  Processed {N}/{Total}...", n, sceneryPaths.Count);
            }
        })).ToArray();

        Task.WaitAll(consumers);

        var sceneryDir = Path.Combine(outputDir, "scenery");
        var exported = 0;
        foreach (var (meshName, (lods, _, _)) in allMeshes.OrderBy(kv => kv.Key))
        {
            foreach (var (lodIndex, data) in lods)
            {
                var lodDir = Path.Combine(sceneryDir, $"lod{lodIndex}");
                Directory.CreateDirectory(lodDir);
                File.WriteAllBytes(Path.Combine(lodDir, $"{meshName}.glb"), data);
            }
            exported++;
        }

        var texDir = Path.Combine(sceneryDir, "textures");
        Directory.CreateDirectory(texDir);
        foreach (var (meshName, pngData) in allTextures.OrderBy(kv => kv.Key))
            File.WriteAllBytes(Path.Combine(texDir, $"{meshName}.png"), pngData);

        watch.Stop();
        Log.Information("Done: {Count} scenery meshes, {TexCount} textures in {Time} ({Errors} errors)",
            allMeshes.Count, allTextures.Count, watch.Elapsed, errors);

        JsonOutput.WriteExport("scenery", sceneryDir, allMeshes.Count, watch.Elapsed.ToString(), errors);
    }

    // ── export landscape ─────────────────────────────────────
    public static void Landscape(string outputDir, int parallelism,
        string simplifyRatio = "0.15")
    {
        var options = DefaultOptions;

        // Sample layer colors from game textures
        var layerColors = new Dictionary<string, (byte r, byte g, byte b)>(LandscapeHelpers.DefaultLayerColors);
        var scanProvider = ProviderFactory.CreateProvider();
        LandscapeHelpers.SampleLayerColors(scanProvider, layerColors);

        var landscapePaths = scanProvider.Files.Keys
            .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
            .ToList();

        var simplifyRatioVal = double.TryParse(simplifyRatio, System.Globalization.CultureInfo.InvariantCulture, out var r) ? r : 0.15;

        var landscapeDir = Path.Combine(outputDir, "landscape");
        var glbDir = Path.Combine(landscapeDir, "glb");
        var imgDir = Path.Combine(landscapeDir, "img");
        Directory.CreateDirectory(glbDir);
        Directory.CreateDirectory(imgDir);

        var watch = Stopwatch.StartNew();
        var seen = new ConcurrentDictionary<string, byte>();
        var tileResults = new ConcurrentBag<(string tile, int x, int y, long wMinX, long wMinY, long wMaxX, long wMaxY, int comps)>();
        var exported = 0;

        var queue = new BlockingCollection<string>();
        foreach (var p in landscapePaths) queue.Add(p);
        queue.CompleteAdding();
        Log.Information("Queued {Count} packages for {N} consumers", landscapePaths.Count, parallelism);

        var consumers = Enumerable.Range(0, parallelism).Select(i => Task.Run(() =>
        {
            var myProvider = ProviderFactory.CreateProvider();
            Log.Information("Consumer {I} ready ({Count} files)", i, myProvider.Files.Count);

            foreach (var pkgPath in queue.GetConsumingEnumerable())
            {
                try
                {
                    var cleanPath = pkgPath.Replace(".uasset", "").Replace(".umap", "");
                    var exports = myProvider.LoadPackage(cleanPath).GetExports().ToList();

                    // Find landscape components (by ExportType, no fork-specific types needed)
                    var landscapeComps = exports.Where(e => e.ExportType == "LandscapeComponent").ToList();
                    if (landscapeComps.Count == 0) continue;

                    foreach (var comp in landscapeComps)
                    {
                        var bx = comp.GetOrDefault("SectionBaseX", 0);
                        var by = comp.GetOrDefault("SectionBaseY", 0);
                        var sq = comp.GetOrDefault("ComponentSizeQuads", 0);
                        if (sq == 0) continue;

                        var tileName = $"comp_{bx}_{by}";
                        if (!seen.TryAdd(tileName, 0)) continue;

                        // 1. Export GLB (with in-process simplification)
                        var glbBytes = LandscapeConverter.ConvertToGlb(comp, simplifyRatioVal);
                        if (glbBytes != null)
                            File.WriteAllBytes(Path.Combine(glbDir, $"{tileName}.glb"), glbBytes);

                        // 2. Bake PNG (weightmaps)
                        var pngPath = Path.Combine(imgDir, $"{tileName}.png");
                        LandscapeTextureBaker.BakeTile(comp, layerColors, pngPath);

                        tileResults.Add((tileName, bx, by,
                            (long)bx * 100, (long)by * 100,
                            (long)(bx + sq) * 100, (long)(by + sq) * 100, 1));

                        var n = Interlocked.Increment(ref exported);
                        if (n % 20 == 0) Log.Information("  Exported {N} tiles...", n);
                    }
                }
                catch (Exception ex)
                {
                    Log.Debug("Failed {Path}: {Msg}", pkgPath, ex.Message);
                }
            }
        })).ToArray();

        Task.WaitAll(consumers);

        // Write metadata JSON
        var metadataPath = Path.Combine(landscapeDir, "metadata.json");
        var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
        var sortedMeta = tileResults.OrderBy(t => t.tile).Select(t => new
        {
            tile = t.tile, x = t.x, y = t.y,
            worldMinX = t.wMinX, worldMinY = t.wMinY, worldMaxX = t.wMaxX, worldMaxY = t.wMaxY,
            components = t.comps
        }).ToArray();
        File.WriteAllText(metadataPath, System.Text.Json.JsonSerializer.Serialize(sortedMeta, jsonOptions));

        watch.Stop();
        Log.Information("All done: {N} tiles in {Time}", exported, watch.Elapsed);

        JsonOutput.WriteExport("landscape", landscapeDir, exported, watch.Elapsed.ToString(), 0);
    }

    // ── export texture ───────────────────────────────────────
    public static void Texture(CUE4Parse.FileProvider.DefaultFileProvider provider, string assetPath, string outputDir)
    {
        var cleanPath = assetPath.Replace(".uasset", "").Replace(".ubulk", "");
        try
        {
            var exports = provider.LoadPackage(cleanPath).GetExports().ToList();
            foreach (var obj in exports)
            {
                if (obj is UTexture2D texture)
                {
                    Log.Information("Texture {Name}: size {W}x{H}", texture.Name, texture.ImportedSize.X, texture.ImportedSize.Y);
                    var decoded = texture.Decode(16384) ?? texture.Decode();
                    if (decoded == null) { Log.Error("Failed to decode {Name}", texture.Name); return; }

                    var encoded = decoded.EncodeToPng();
                    if (encoded == null) { Log.Error("Failed to encode {Name}", texture.Name); return; }

                    var outPath = Path.Combine(outputDir, $"{texture.Name}.png");
                    File.WriteAllBytes(outPath, encoded);
                    Log.Information("Exported {Name} ({W}x{H}) → {Path}", texture.Name, decoded.Width, decoded.Height, outPath);

                    JsonOutput.WriteExport("texture", outputDir, 1, "0", 0,
                        new object[] { new { path = $"{texture.Name}.png", sizeKB = encoded.Length / 1024 } });
                    return;
                }
            }
            Log.Error("No UTexture2D found in {Path}", cleanPath);
        }
        catch (Exception ex) { Log.Error("Failed: {Msg}", ex.Message); }
    }

    // ── export mesh (by filter) ──────────────────────────────
    public static void Mesh(CUE4Parse.FileProvider.DefaultFileProvider provider, string filter, string? typeFilter, string outputDir)
    {
        var options = DefaultOptions;
        var pathRegex = new Regex(filter, RegexOptions.IgnoreCase);
        Regex? typeRegex = typeFilter != null ? new Regex(typeFilter, RegexOptions.IgnoreCase) : null;

        var matchingPaths = provider.Files.Keys
            .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
            .Where(k => pathRegex.IsMatch(k))
            .ToList();

        Log.Information("Matched {Count} packages", matchingPaths.Count);

        var watch = Stopwatch.StartNew();
        var files = new List<object>();
        var errors = 0;

        foreach (var pkgPath in matchingPaths)
        {
            try
            {
                var cleanPath = pkgPath.Replace(".uasset", "").Replace(".umap", "");
                var allExports = provider.LoadPackage(cleanPath).GetExports();

                foreach (var obj in allExports)
                {
                    if (obj is not UStaticMesh staticMesh) continue;
                    if (typeRegex != null && !typeRegex.IsMatch(obj.ExportType)) continue;

                    var meshExporter = new MeshExporter(staticMesh, options);
                    if (meshExporter.MeshLods.Count == 0) continue;

                    for (int j = 0; j < meshExporter.MeshLods.Count; j++)
                    {
                        var relPath = Path.Combine($"lod{j}", $"{staticMesh.Name}.glb");
                        var outPath = Path.Combine(outputDir, relPath);
                        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                        File.WriteAllBytes(outPath, meshExporter.MeshLods[j].FileData);
                        files.Add(new { path = relPath, sizeKB = meshExporter.MeshLods[j].FileData.Length / 1024 });
                    }

                    Log.Information("Exported {Name} ({LodCount} LODs)", staticMesh.Name, meshExporter.MeshLods.Count);
                }
            }
            catch (Exception ex)
            {
                errors++;
                if (errors <= 10) Log.Warning("Error: {Msg}", ex.Message);
            }
        }

        watch.Stop();
        JsonOutput.WriteExport("mesh", outputDir, files.Count, watch.Elapsed.ToString(), errors, files.ToArray());
    }

    // ── export actors (Persistent_Level) ─────────────────────
    public static void Actors(CUE4Parse.FileProvider.DefaultFileProvider provider, string outputDir)
    {
        var pkg = provider.LoadPackage("FactoryGame/Content/FactoryGame/Map/GameLevel01/Persistent_Level");
        var exports = pkg.GetExports().ToList();
        Log.Information("Persistent_Level: {Count} exports", exports.Count);

        var placements = new List<object>();

        foreach (var obj in exports)
        {
            if (obj.ExportType != "StaticMeshActor") continue;

            var rootRef = obj.GetOrDefault<FPackageIndex>("RootComponent");
            if (rootRef == null) continue;
            var rootComp = rootRef.ResolvedObject?.Object?.Value as UStaticMeshComponent;
            if (rootComp == null) continue;
            var meshRef = rootComp.GetStaticMesh();
            if (meshRef == null) continue;

            var loc = rootComp.GetRelativeLocation();
            var rot = rootComp.GetRelativeRotation();
            var scale = rootComp.GetRelativeScale3D();
            var (qx, qy, qz, qw) = MathHelpers.EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);

            placements.Add(new
            {
                mesh = meshRef.Name, type = "StaticMeshActor",
                x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                qx = Math.Round(qx, 6), qy = Math.Round(qy, 6), qz = Math.Round(qz, 6), qw = Math.Round(qw, 6),
                sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
            });
        }

        // BP actors
        var bpActorTypes = new HashSet<string> {
            "BP_ResourceNode_C", "BP_ResourceNodeGeyser_C", "BP_FrackingSatellite_C",
            "BP_FrackingCore_C", "BP_ResourceDeposit_C", "BP_Water_C",
        };
        var bpPlacements = new List<object>();

        foreach (var obj in exports)
        {
            if (!bpActorTypes.Contains(obj.ExportType)) continue;
            var rootRef = obj.GetOrDefault<FPackageIndex>("RootComponent");
            if (rootRef == null) continue;
            var rootComp = rootRef.ResolvedObject?.Object?.Value as CUE4Parse.UE4.Assets.Exports.Component.USceneComponent;
            if (rootComp == null) continue;

            var loc = rootComp.GetRelativeLocation();
            var rot = rootComp.GetRelativeRotation();
            var scale = rootComp.GetRelativeScale3D();

            var resourceType = "";
            var descProp = obj.GetOrDefault<FPackageIndex>("mResourceClass");
            if (descProp?.ResolvedObject != null) resourceType = descProp.ResolvedObject.Name.Text;

            var purityName = obj.GetOrDefault<FName>("mPurity");
            var purity = purityName.Text ?? "";

            bpPlacements.Add(new
            {
                mesh = obj.ExportType.Replace("_C", ""), type = obj.ExportType,
                resource = resourceType, purity,
                x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                pitch = Math.Round(rot.Pitch, 2), yaw = Math.Round(rot.Yaw, 2), roll = Math.Round(rot.Roll, 2),
                sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
            });
        }

        var result = new { staticMeshes = placements, bpActors = bpPlacements };
        var outPath = Path.Combine(outputDir, "scenery_placements.json");
        var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
        File.WriteAllText(outPath, System.Text.Json.JsonSerializer.Serialize(result, jsonOptions));

        Log.Information("Wrote {Count} total placements to {Path}", placements.Count + bpPlacements.Count, outPath);
        JsonOutput.WriteExport("actors", outputDir, placements.Count + bpPlacements.Count, "0", 0,
            new object[] { new { path = "scenery_placements.json" } });
    }

    // ── export streaming (HISM cells) ────────────────────────
    public static void Streaming(CUE4Parse.FileProvider.DefaultFileProvider provider, string outputDir)
    {
        var cellPaths = provider.Files.Keys
            .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.EndsWith(".umap"))
            .ToList();

        Log.Information("Scanning {Count} streaming cells for scenery actors...", cellPaths.Count);

        var placements = new List<object>();
        var scanned = 0;
        var actorTypes = new HashSet<string> { "StaticMeshActor", "FGCliffActor" };

        foreach (var cellPath in cellPaths)
        {
            scanned++;
            if (scanned % 500 == 0) Log.Information("  scanned {N}/{Total}...", scanned, cellPaths.Count);

            try
            {
                var cleanPath = cellPath.Replace(".umap", "");
                var exports = provider.LoadPackage(cleanPath).GetExports().ToList();

                foreach (var obj in exports)
                {
                    if (!actorTypes.Contains(obj.ExportType)) continue;

                    var rootRef = obj.GetOrDefault<FPackageIndex>("RootComponent");
                    if (rootRef == null) continue;
                    var rootComp = rootRef.ResolvedObject?.Object?.Value as UStaticMeshComponent;
                    if (rootComp == null) continue;
                    var meshRef = rootComp.GetStaticMesh();
                    if (meshRef == null) continue;

                    var loc = rootComp.GetRelativeLocation();
                    var rot = rootComp.GetRelativeRotation();
                    var scale = rootComp.GetRelativeScale3D();
                    var (qx, qy, qz, qw) = MathHelpers.EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);

                    placements.Add(new
                    {
                        mesh = meshRef.Name, type = obj.ExportType,
                        x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                        qx = Math.Round(qx, 6), qy = Math.Round(qy, 6), qz = Math.Round(qz, 6), qw = Math.Round(qw, 6),
                        sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
                    });
                }
            }
            catch { }
        }

        var outPath = Path.Combine(outputDir, "scenery_streaming.json");
        var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = false };
        File.WriteAllText(outPath, System.Text.Json.JsonSerializer.Serialize(placements, jsonOptions));

        Log.Information("Wrote {Count} placements from {Scanned} cells to {Path}", placements.Count, scanned, outPath);
        JsonOutput.WriteExport("streaming", outputDir, placements.Count, "0", 0,
            new object[] { new { path = "scenery_streaming.json" } });
    }

    // ── Helper: extract LODs from MeshExporter ───────────────
    private static Dictionary<int, byte[]> ExtractLods(MeshExporter meshExporter)
    {
        var lods = new Dictionary<int, byte[]>();
        for (var j = 0; j < meshExporter.MeshLods.Count; j++)
            lods[j] = meshExporter.MeshLods[j].FileData;
        return lods;
    }
}
