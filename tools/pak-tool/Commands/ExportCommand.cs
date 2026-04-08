using System.Collections.Concurrent;
using System.Numerics;
using System.Diagnostics;
using System.Text.RegularExpressions;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Writers;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Landscape;
using CUE4Parse_Conversion.Materials;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Meshes.glTF;
using CUE4Parse_Conversion.Meshes.PSK;
using CUE4Parse_Conversion.Textures;
using CUE4Parse_Conversion.UEFormat.Enums;
using PakTool.Helpers;
using Serilog;
using SharpGLTF.Geometry;
using SharpGLTF.Geometry.VertexTypes;
using SharpGLTF.Scenes;
using VERTEX = SharpGLTF.Geometry.VertexTypes.VertexPositionNormalTangent;

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

    // ── export catalog ──────────────────────────────────────
    public static void Catalog(string outputDir, int parallelism)
    {
        var options = DefaultOptions;

        // Clean existing catalog directories
        var catalogDir = Path.Combine(outputDir, "catalog");
        if (Directory.Exists(catalogDir))
        {
            foreach (var lodDir in Directory.GetDirectories(catalogDir, "lod*"))
                Directory.Delete(lodDir, true);
            Log.Information("Cleaned existing catalog directories");
        }

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
                    var allExports = myProvider.LoadPackage(cleanPath).GetExports().ToArray();
                    var className = MathHelpers.ExtractClassName(packagePath);

                    // Pass 1: direct UStaticMesh in this package
                    foreach (var obj in allExports)
                    {
                        if (obj is not UStaticMesh staticMesh) continue;

                        var meshExporter = new MeshExporter(staticMesh, options);
                        if (meshExporter.MeshLods.Count == 0) continue;

                        var lod0Size = meshExporter.MeshLods[0].FileData.LongLength;

                        bestMeshes.AddOrUpdate(className,
                            _ => (ExtractLods(meshExporter), lod0Size),
                            (_, existing) => existing.lod0Size >= lod0Size ? existing : (ExtractLods(meshExporter), lod0Size));
                    }

                    // Pass 2: resolve mesh references for Build_* packages without inline UStaticMesh
                    if (className.StartsWith("Build_") && !bestMeshes.ContainsKey(className))
                    {
                        var meshParts = ResolveMeshesFromBlueprint(allExports);
                        if (meshParts.Count > 0)
                        {
                            var lodParts = new List<(CStaticMeshLod lod, Matrix4x4 transform)>();
                            foreach (var (mesh, transform) in meshParts)
                            {
                                if (mesh.TryConvert(out var converted) && converted.LODs.Count > 0)
                                    lodParts.Add((converted.LODs[0], transform));
                            }
                            if (lodParts.Count > 0)
                            {
                                var glbData = BuildCompositeGlb(className, lodParts, options);
                                if (glbData != null)
                                    bestMeshes.TryAdd(className, (new Dictionary<int, byte[]> { [0] = glbData }, glbData.LongLength));
                            }
                        }
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

        // Write best meshes to disk (only Build_* classes)
        var files = new List<object>();
        var exported = 0;
        foreach (var (className, (lods, _)) in bestMeshes)
        {
            if (!className.StartsWith("Build_")) continue;
            foreach (var (lodIndex, data) in lods)
            {
                var relPath = Path.Combine("catalog", $"lod{lodIndex}", $"{className}.glb");
                var outPath = Path.Combine(outputDir, relPath);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                File.WriteAllBytes(outPath, data);
                files.Add(new { path = relPath, sizeKB = data.Length / 1024 });
            }
            exported++;
        }

        // ── Export spline segments (belt, pipe, track) ──────────────────
        ExportSplineSegments(scanProvider, outputDir, options, files);

        watch.Stop();
        Log.Information("Done: {ClassCount} catalog meshes ({Total} total), {MeshCount} files in {Time} ({Errors} errors)",
            exported, bestMeshes.Count, files.Count, watch.Elapsed, errors);

        JsonOutput.WriteExport("catalog", outputDir, exported, watch.Elapsed.ToString(), errors,
            files.ToArray());
    }

    private static byte[]? BuildCompositeGlb(string name, List<(CStaticMeshLod lod, Matrix4x4 transform)> parts, ExporterOptions options)
    {
        var sceneBuilder = new SceneBuilder();
        var materialExports = options.ExportMaterials ? new List<MaterialExporter2>() : null;
        var idx = 0;
        foreach (var (lod, transform) in parts)
        {
            var mesh = new MeshBuilder<VERTEX, VertexColorXTextureX, VertexEmpty>($"{name}_{idx++}");
            for (var i = 0; i < lod.Sections.Value.Length; i++)
                Gltf.ExportStaticMeshSections(i, lod, lod.Sections.Value[i], materialExports, mesh, options);
            sceneBuilder.AddRigidMesh(mesh, transform);
        }
        return sceneBuilder.ToGltf2().WriteGLB().Array;
    }

    /// <summary>
    /// Export normalized spline segment GLBs (belt, pipe, track) centered and scaled to 1 UU length.
    /// </summary>
    private static void ExportSplineSegments(CUE4Parse.FileProvider.DefaultFileProvider provider,
        string outputDir, ExporterOptions options, List<object> files)
    {
        var segments = new[] {
            (mesh: "SM_ConveyorBelt_Mk1", file: "spline_belt"),
            (mesh: "SM_Pipe",             file: "spline_pipe"),
            (mesh: "SM_TrainTrack_02",    file: "spline_track"),
        };

        foreach (var (meshName, fileName) in segments)
        {
            try
            {
                var meshPath = provider.Files.Keys
                    .FirstOrDefault(k => k.Contains($"/{meshName}.") && k.EndsWith(".uasset"));
                if (meshPath == null) { Log.Warning("Spline mesh not found: {Name}", meshName); continue; }

                var allExports = provider.LoadPackage(meshPath.Replace(".uasset", "")).GetExports().ToArray();
                var staticMesh = allExports.OfType<UStaticMesh>().FirstOrDefault();
                if (staticMesh == null || !staticMesh.TryConvert(out var converted) || converted.LODs.Count == 0)
                { Log.Warning("Could not convert spline mesh: {Name}", meshName); continue; }

                var lod = converted.LODs[0];
                var bounds = staticMesh.RenderData?.Bounds;

                var transform = Matrix4x4.Identity;
                if (bounds != null)
                {
                    var center = bounds.Origin;
                    var meshLen = bounds.BoxExtent.X * 2;
                    var scaleX = meshLen > 0 ? 1f / meshLen : 1f;
                    // Normalize length (X) to 1 UU; keep Y/Z cross-section as-is
                    // Gltf.ExportStaticMeshSections already converts vertices to meters (×0.01)
                    // so scale Y/Z = 1 (no additional conversion needed)
                    transform = MathHelpers.UnrealToGltfTransform(
                        new FVector(-center.X * scaleX, -center.Y, -center.Z),
                        new FRotator(0, 0, 0),
                        new FVector(scaleX, 1f, 1f));
                }

                var glbData = BuildCompositeGlb(fileName,
                    new List<(CStaticMeshLod, Matrix4x4)> { (lod, transform) }, options);
                if (glbData != null)
                {
                    var relPath = Path.Combine("catalog", $"{fileName}.glb");
                    var outPath = Path.Combine(outputDir, relPath);
                    Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                    File.WriteAllBytes(outPath, glbData);
                    files.Add(new { path = relPath, sizeKB = glbData.Length / 1024 });
                    Log.Information("Exported spline segment: {File} ({Size} KB)", fileName, glbData.Length / 1024);
                }
            }
            catch (Exception ex)
            {
                Log.Warning("Error exporting spline segment {Name}: {Msg}", meshName, ex.Message);
            }
        }
    }

    /// <summary>
    /// Resolve all mesh references from a Blueprint package that has no inline UStaticMesh.
    /// Returns multiple meshes with their relative transforms for composite GLB export.
    /// </summary>
    private static List<(UStaticMesh mesh, Matrix4x4 transform)> ResolveMeshesFromBlueprint(UObject[] allExports)
    {
        var result = new List<(UStaticMesh mesh, Matrix4x4 transform)>();
        var seen = new HashSet<string>();

        void TryAdd(UStaticMesh? mesh, UObject comp)
        {
            if (mesh == null || !seen.Add(mesh.Name)) return;
            var transform = Matrix4x4.Identity;
            if (mesh.Name.StartsWith("SM_TrainTrack"))
            {
                // Center the track mesh on the station origin and stretch to 1600 UU
                var bounds = mesh.RenderData?.Bounds;
                if (bounds != null)
                {
                    var center = bounds.Origin;
                    var meshLen = bounds.BoxExtent.X * 2; // full length along X
                    var scaleX = meshLen > 0 ? 1600f / meshLen : 1f;
                    transform = MathHelpers.UnrealToGltfTransform(
                        new FVector(-center.X * scaleX, -center.Y, -center.Z),
                        new FRotator(0, 0, 0),
                        new FVector(scaleX, 1, 1));
                }
            }
            else if (comp is UStaticMeshComponent smc)
            {
                var loc = smc.GetRelativeLocation();
                var rot = smc.GetRelativeRotation();
                var scl = smc.GetRelativeScale3D();

                transform = MathHelpers.UnrealToGltfTransform(loc, rot, scl);
            }
            else
            {
                // Fallback for FGColoredInstanceMeshProxy and other non-mapped subclasses
                var loc = comp.GetOrDefault("RelativeLocation", new FVector(0, 0, 0));
                var rot = comp.GetOrDefault("RelativeRotation", new FRotator(0, 0, 0));
                var scl = comp.GetOrDefault("RelativeScale3D", new FVector(1, 1, 1));
                transform = MathHelpers.UnrealToGltfTransform(loc, rot, scl);
            }
            result.Add((mesh, transform));
        }

        // Pattern C: native UStaticMeshComponent subclass
        foreach (var obj in allExports)
            if (obj is UStaticMeshComponent smc)
                TryAdd(smc.GetLoadedStaticMesh(), obj);

        // Pattern A: direct StaticMesh property (FGColoredInstanceMeshProxy, etc.)
        foreach (var obj in allExports)
        {
            var meshRef = obj.GetOrDefault<FPackageIndex>("StaticMesh");
            if (meshRef is { IsNull: false })
                TryAdd(meshRef.Load<UStaticMesh>(), obj);
        }

        // Pattern B: AbstractInstanceDataObject → Instances[].StaticMesh
        foreach (var obj in allExports)
        {
            var instances = obj.GetOrDefault<UScriptArray>("Instances");
            if (instances == null) continue;
            foreach (var prop in instances.Properties)
            {
                if ((prop.GenericValue as FScriptStruct)?.StructType is not FStructFallback sf) continue;
                var meshRef = sf.GetOrDefault<FPackageIndex>("StaticMesh");
                if (meshRef is { IsNull: false })
                    TryAdd(meshRef.Load<UStaticMesh>(), obj);
            }
        }

        if (result.Any(r => r.mesh.Name == "SpaceElevator"))
            RebaseSpaceElevator(result);

        return result;
    }

    /// <summary>
    /// SpaceElevator: shift root mesh up so global min Z of all parts = 0.
    /// The mesh geometry extends far below the entity origin; in-game the base is at Z=0.
    /// </summary>
    private static void RebaseSpaceElevator(List<(UStaticMesh mesh, Matrix4x4 transform)> parts)
    {
        // Compute global min Z (UE) across all parts.
        // In glTF matrix: M42 = translation Y (= UE Z after Y/Z swap), column 1 length = scale on that axis.
        // Mesh bounds are in UE space (cm), ×0.01 for glTF meters.
        float globalMinZ = float.MaxValue;
        foreach (var (mesh, tr) in parts)
        {
            if (mesh.RenderData?.Bounds == null) continue;
            var b = mesh.RenderData.Bounds;
            var gltfScaleZ = MathF.Sqrt(tr.M21 * tr.M21 + tr.M22 * tr.M22 + tr.M23 * tr.M23);
            var gltfTransZ = tr.M42;
            var bottomZ = (b.Origin.Z - b.BoxExtent.Z) * 0.01f * gltfScaleZ + gltfTransZ;
            if (bottomZ < globalMinZ) globalMinZ = bottomZ;
        }

        if (globalMinZ >= -0.1f || globalMinZ == float.MaxValue) return;

        // Shift ALL parts up (GLB nodes are flat, no parent-child hierarchy)
        for (int i = 0; i < parts.Count; i++)
        {
            var (m, tr) = parts[i];
            tr.M42 -= globalMinZ;
            parts[i] = (m, tr);
        }
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
            .Where(k => !k.Contains("/Waterfall", StringComparison.OrdinalIgnoreCase))  // segfault in CUE4Parse material loading
            .Where(k => !k.Contains("/Sky/", StringComparison.OrdinalIgnoreCase))        // segfault in CUE4Parse material loading
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
            Log.Information("Consumer {I} creating provider...", i);
            var myProvider = ProviderFactory.CreateProvider();
            Log.Information("Consumer {I} ready ({Count} files)", i, myProvider.Files.Count);

            foreach (var packagePath in queue.GetConsumingEnumerable())
            {
                try
                {
                    var cleanPath = packagePath.Replace(".uasset", "");
                    Log.Debug("Consumer {I}: loading {Path}", i, cleanPath);
                    var allExports = myProvider.LoadPackage(cleanPath).GetExports();

                    foreach (var obj in allExports)
                    {
                        if (obj is not UStaticMesh staticMesh) continue;

                        Log.Debug("Consumer {I}: exporting mesh {Name}", i, staticMesh.Name);
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
                                Log.Debug("Consumer {I}: extracting texture for {Name}", i, meshName);
                                var texBytes = TextureHelpers.ExtractDiffuseTexture(staticMesh, myProvider);
                                if (texBytes != null) allTextures.TryAdd(meshName, texBytes);
                            }
                            catch (Exception texEx)
                            {
                                Log.Debug("Consumer {I}: texture extraction failed for {Name}: {Msg}", i, meshName, texEx.Message);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    if (Interlocked.Increment(ref errors) <= 10)
                        Log.Warning("Consumer {I} error processing {Path}: {Type}: {Msg}", i, packagePath, ex.GetType().Name, ex.Message);
                }

                var n = Interlocked.Increment(ref processed);
                if (n % 50 == 0) Log.Information("  Processed {N}/{Total} ({Meshes} meshes, {Textures} textures, {Errors} errors)...",
                    n, sceneryPaths.Count, allMeshes.Count, allTextures.Count, errors);
            }
            Log.Information("Consumer {I} finished", i);
        })).ToArray();

        Log.Information("Waiting for {N} consumers...", consumers.Length);
        try { Task.WaitAll(consumers); }
        catch (AggregateException agg) {
            foreach (var ex in agg.Flatten().InnerExceptions)
                Log.Error("Consumer crashed: {Type}: {Msg}\n{Stack}", ex.GetType().Name, ex.Message, ex.StackTrace);
        }
        Log.Information("All consumers done. {Meshes} meshes, {Textures} textures, {Errors} errors",
            allMeshes.Count, allTextures.Count, errors);

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

        // ── Extract placements (Persistent_Level + streaming cells) → scenery_layout.json ──
        Log.Information("Extracting scenery placements...");
        var actorsTask = Task.Run(() => ExtractActors(ProviderFactory.CreateProvider()));
        var streamingTask = Task.Run(() => ExtractStreaming(ProviderFactory.CreateProvider()));
        try { Task.WaitAll(actorsTask, streamingTask); }
        catch (AggregateException agg) {
            foreach (var ex in agg.Flatten().InnerExceptions)
                Log.Error("Placement extraction crashed: {Type}: {Msg}\n{Stack}", ex.GetType().Name, ex.Message, ex.StackTrace);
        }
        var (staticMeshes, bpActors) = actorsTask.IsCompletedSuccessfully
            ? actorsTask.Result : (new List<object>(), new List<object>());
        var streaming = streamingTask.IsCompletedSuccessfully
            ? streamingTask.Result : new List<object>();
        var layout = new { staticMeshes, bpActors, streaming };
        var layoutPath = Path.Combine(sceneryDir, "scenery_layout.json");
        var jsonOpts = new System.Text.Json.JsonSerializerOptions { WriteIndented = false };
        File.WriteAllText(layoutPath, System.Text.Json.JsonSerializer.Serialize(layout, jsonOpts));
        Log.Information("Wrote scenery_layout.json: {SM} static meshes, {BP} BP actors, {ST} streaming",
            staticMeshes.Count, bpActors.Count, streaming.Count);

        watch.Stop();
        Log.Information("Done: {Count} scenery meshes, {TexCount} textures, {Placements} placements in {Time} ({Errors} errors)",
            allMeshes.Count, allTextures.Count, staticMeshes.Count + bpActors.Count + streaming.Count, watch.Elapsed, errors);

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
        var tileResults = new ConcurrentBag<(string tile, int x, int y, long wMinX, long wMinY, long wMaxX, long wMaxY, int comps)>();
        var exported = 0;

        // Clean existing GLB/PNG
        if (Directory.Exists(glbDir)) foreach (var f in Directory.GetFiles(glbDir, "*.glb")) File.Delete(f);
        if (Directory.Exists(imgDir)) foreach (var f in Directory.GetFiles(imgDir, "*.png")) File.Delete(f);

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

                    var proxy = exports.OfType<ALandscapeProxy>().FirstOrDefault();
                    if (proxy == null) continue;

                    foreach (var comp in exports.OfType<ULandscapeComponent>())
                    {
                        var tileName = $"comp_{comp.SectionBaseX}_{comp.SectionBaseY}";
                        var bx = comp.SectionBaseX;
                        var by = comp.SectionBaseY;
                        var sq = comp.ComponentSizeQuads;

                        // 1. Export GLB via CUE4Parse Gltf class + geometry3Sharp simplification
                        if (proxy.TryConvert(new[] { comp }, ELandscapeExportFlags.Mesh, out var mesh, out _, out _) && mesh != null)
                        {
                            using var ar = new FArchiveWriter();
                            new Gltf(tileName, mesh.LODs.First(), null, options).Save(options.MeshFormat, ar);
                            var rawGlb = ar.GetBuffer();

                            var finalGlb = simplifyRatioVal < 1.0
                                ? LandscapeConverter.SimplifyGlb(rawGlb, simplifyRatioVal) ?? rawGlb
                                : rawGlb;

                            File.WriteAllBytes(Path.Combine(glbDir, $"{tileName}.glb"), finalGlb);
                        }

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
        var metadataPath = Path.Combine(landscapeDir, "landscape_layout.json");
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
    // ── Extract Persistent_Level placements (used by Scenery) ──
    private static (List<object> staticMeshes, List<object> bpActors) ExtractActors(
        CUE4Parse.FileProvider.DefaultFileProvider provider)
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

        var bpActorTypes = new HashSet<string> {
            "BP_ResourceNode_C", "BP_ResourceNodeGeyser_C", "BP_FrackingSatellite_C",
            "BP_FrackingCore_C", "BP_ResourceDeposit_C",
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
            // BP actors use BoxComponent as root — its scale is the collision shape, not visual mesh
            // Export scale=1 since the GLB mesh is already at correct visual size

            var resourceType = "";
            var descProp = obj.GetOrDefault<FPackageIndex>("mResourceClass");
            if (descProp?.ResolvedObject != null) resourceType = descProp.ResolvedObject.Name.Text;

            var purityName = obj.GetOrDefault<FName>("mPurity");
            var purity = purityName.Text ?? "";

            var (bqx, bqy, bqz, bqw) = MathHelpers.EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);
            bpPlacements.Add(new
            {
                mesh = obj.ExportType.Replace("_C", ""), type = obj.ExportType,
                resource = resourceType, purity,
                x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                qx = Math.Round(bqx, 6), qy = Math.Round(bqy, 6), qz = Math.Round(bqz, 6), qw = Math.Round(bqw, 6),
            });
        }

        Log.Information("Persistent_Level: {SM} static meshes, {BP} BP actors", placements.Count, bpPlacements.Count);
        return (placements, bpPlacements);
    }

    // ── Extract streaming cell placements (used by Scenery) ──
    private static List<object> ExtractStreaming(CUE4Parse.FileProvider.DefaultFileProvider provider)
    {
        var cellPaths = provider.Files.Keys
            .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.EndsWith(".umap"))
            .ToList();

        Log.Information("Scanning {Count} streaming cells...", cellPaths.Count);

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

        Log.Information("Streaming: {Count} placements from {Scanned} cells", placements.Count, scanned);
        return placements;
    }

    // ── export water (placements + meshes) ────────────────────
    public static void Water(string outputDir, int parallelism)
    {
        var options = DefaultOptions;
        var provider = ProviderFactory.CreateProvider();
        Log.Information("Loaded {Count} files from provider", provider.Files.Count);

        var waterTypes = new HashSet<string> { "BP_Water_C", "BP_LakeWater_C", "BP_TranslucentWater_C" };
        var placements = new List<object>();
        var meshNames = new HashSet<string>();

        // ── 1. Persistent_Level (BP_Water_C) ────────────────
        var pkg = provider.LoadPackage("FactoryGame/Content/FactoryGame/Map/GameLevel01/Persistent_Level");
        var exports = pkg.GetExports().ToList();
        Log.Information("Persistent_Level: {Count} exports", exports.Count);

        foreach (var obj in exports)
        {
            if (!waterTypes.Contains(obj.ExportType)) continue;
            var rootRef = obj.GetOrDefault<FPackageIndex>("RootComponent");
            if (rootRef == null) continue;
            var rootComp = rootRef.ResolvedObject?.Object?.Value as USceneComponent;
            if (rootComp == null) continue;

            var loc = rootComp.GetRelativeLocation();
            var rot = rootComp.GetRelativeRotation();
            var scale = rootComp.GetRelativeScale3D();
            var (qx, qy, qz, qw) = MathHelpers.EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);

            // Try to get the static mesh name from the component
            var meshName = "WaterPlane";
            if (rootComp is UStaticMeshComponent smc)
            {
                var meshRef = smc.GetStaticMesh();
                if (meshRef != null) meshName = meshRef.Name;
            }
            else
            {
                // BP actors: look for a StaticMeshComponent child
                foreach (var child in exports)
                {
                    if (child is not UStaticMeshComponent childSmc) continue;
                    var outer = child.GetOrDefault<FPackageIndex>("Outer");
                    if (outer?.ResolvedObject?.Object?.Value == obj)
                    {
                        var childMesh = childSmc.GetStaticMesh();
                        if (childMesh != null) meshName = childMesh.Name;
                        break;
                    }
                }
            }

            meshNames.Add(meshName);
            placements.Add(new
            {
                mesh = meshName, type = obj.ExportType,
                x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                qx = Math.Round(qx, 6), qy = Math.Round(qy, 6), qz = Math.Round(qz, 6), qw = Math.Round(qw, 6),
                sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
            });
        }

        Log.Information("Found {Count} water actors in Persistent_Level", placements.Count);

        // ── 2. Streaming cells (BP_LakeWater_C, BP_TranslucentWater_C) ──
        var cellPaths = provider.Files.Keys
            .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.EndsWith(".umap"))
            .ToList();

        Log.Information("Scanning {Count} streaming cells for water actors...", cellPaths.Count);
        var scanned = 0;

        foreach (var cellPath in cellPaths)
        {
            scanned++;
            if (scanned % 500 == 0) Log.Information("  scanned {N}/{Total}...", scanned, cellPaths.Count);

            try
            {
                var cleanPath = cellPath.Replace(".umap", "");
                var cellExports = provider.LoadPackage(cleanPath).GetExports().ToList();

                foreach (var obj in cellExports)
                {
                    if (!waterTypes.Contains(obj.ExportType)) continue;
                    var rootRef = obj.GetOrDefault<FPackageIndex>("RootComponent");
                    if (rootRef == null) continue;
                    var rootComp = rootRef.ResolvedObject?.Object?.Value as USceneComponent;
                    if (rootComp == null) continue;

                    var loc = rootComp.GetRelativeLocation();
                    var rot = rootComp.GetRelativeRotation();
                    var scale = rootComp.GetRelativeScale3D();
                    var (qx, qy, qz, qw) = MathHelpers.EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);

                    // Try to find mesh name from child StaticMeshComponent
                    var meshName = "WaterPlane";
                    foreach (var child in cellExports)
                    {
                        if (child is not UStaticMeshComponent childSmc) continue;
                        var outer = child.GetOrDefault<FPackageIndex>("Outer");
                        if (outer?.ResolvedObject?.Object?.Value == obj)
                        {
                            var childMesh = childSmc.GetStaticMesh();
                            if (childMesh != null) meshName = childMesh.Name;
                            break;
                        }
                    }

                    meshNames.Add(meshName);
                    placements.Add(new
                    {
                        mesh = meshName, type = obj.ExportType,
                        x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                        qx = Math.Round(qx, 6), qy = Math.Round(qy, 6), qz = Math.Round(qz, 6), qw = Math.Round(qw, 6),
                        sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
                    });
                }
            }
            catch { }
        }

        // ── 3. Ocean HISM actors (BPW_OceanSplineTool_02_C) ──
        var oceanType = "BPW_OceanSplineTool_02_C";
        var oceanCount = 0;

        // Helper: extract "WaterPlane Instances" HISM from exports
        // Each HISM.Outer → parent actor → RootComponent → actor world location
        void ExtractOceanHISM(IReadOnlyList<CUE4Parse.UE4.Assets.Exports.UObject> exps)
        {
            foreach (var obj in exps)
            {
                if (obj is not UInstancedStaticMeshComponent hism) continue;
                if (!obj.Name.Contains("WaterPlane")) continue;

                var instances = hism.GetInstances();
                if (instances.Length == 0) continue;

                var smRef = hism.GetStaticMesh();
                var mName = smRef?.Name ?? "WaterPlane";
                meshNames.Add(mName);

                // Get parent actor location via Outer
                var actorLoc = CUE4Parse.UE4.Objects.Core.Math.FVector.ZeroVector;
                var outerActor = obj.Outer?.Object?.Value;
                if (outerActor != null)
                {
                    var rootRef = outerActor.GetOrDefault<FPackageIndex>("RootComponent");
                    if (rootRef?.ResolvedObject?.Object?.Value is USceneComponent rootSc)
                        actorLoc = rootSc.GetRelativeLocation();
                }

                Log.Information("  HISM '{Name}': {Count} instances (mesh={Mesh})", obj.Name, instances.Length, mName);

                foreach (var inst in instances)
                {
                    var t = inst.TransformData;
                    var instLoc = t.Translation + actorLoc;
                    var instRot = t.Rotation;
                    var instScale = t.Scale3D;

                    placements.Add(new
                    {
                        mesh = mName, type = "OceanHISM",
                        x = Math.Round(instLoc.X, 1), y = Math.Round(instLoc.Y, 1), z = Math.Round(instLoc.Z, 1),
                        qx = Math.Round(instRot.X, 6), qy = Math.Round(instRot.Y, 6),
                        qz = Math.Round(instRot.Z, 6), qw = Math.Round(instRot.W, 6),
                        sx = Math.Round(instScale.X, 3), sy = Math.Round(instScale.Y, 3), sz = Math.Round(instScale.Z, 3),
                    });
                    oceanCount++;
                }
            }
        }

        // Scan Persistent_Level + streaming cells for ocean HISM
        ExtractOceanHISM(exports);

        scanned = 0;
        foreach (var cellPath in cellPaths)
        {
            scanned++;
            if (scanned % 500 == 0) Log.Information("  ocean scan {N}/{Total}...", scanned, cellPaths.Count);
            try
            {
                var cleanPath = cellPath.Replace(".umap", "");
                var cellExports = provider.LoadPackage(cleanPath).GetExports().ToList();
                ExtractOceanHISM(cellExports);
            }
            catch { }
        }

        Log.Information("Found {Count} ocean HISM instances", oceanCount);

        // ── 4. Waterfalls (BP_WaterFallTool_02_C) — ISM instances ──
        var waterfallCount = 0;

        void ExtractWaterfallISM(IReadOnlyList<CUE4Parse.UE4.Assets.Exports.UObject> exps)
        {
            foreach (var obj in exps)
            {
                if (obj.ExportType != "BP_WaterFallTool_02_C") continue;

                var rootRef = obj.GetOrDefault<FPackageIndex>("RootComponent");
                if (rootRef == null) continue;
                var rootComp = rootRef.ResolvedObject?.Object?.Value as USceneComponent;
                if (rootComp == null) continue;
                var actorLoc = rootComp.GetRelativeLocation();

                // Find all ISM and StaticMeshComponent children
                foreach (var child in exps)
                {
                    var outer = child.Outer?.Object?.Value;
                    if (outer != obj) continue;

                    if (child is UInstancedStaticMeshComponent ism)
                    {
                        var instances = ism.GetInstances();
                        if (instances.Length == 0) continue;
                        var smRef = ism.GetStaticMesh();
                        var mName = smRef?.Name ?? child.Name;
                        meshNames.Add(mName);

                        foreach (var inst in instances)
                        {
                            var t = inst.TransformData;
                            var instLoc = t.Translation + actorLoc;
                            placements.Add(new
                            {
                                mesh = mName, type = "Waterfall",
                                x = Math.Round(instLoc.X, 1), y = Math.Round(instLoc.Y, 1), z = Math.Round(instLoc.Z, 1),
                                qx = Math.Round(t.Rotation.X, 6), qy = Math.Round(t.Rotation.Y, 6),
                                qz = Math.Round(t.Rotation.Z, 6), qw = Math.Round(t.Rotation.W, 6),
                                sx = Math.Round(t.Scale3D.X, 3), sy = Math.Round(t.Scale3D.Y, 3), sz = Math.Round(t.Scale3D.Z, 3),
                            });
                            waterfallCount++;
                        }
                    }
                    else if (child is UStaticMeshComponent smc && child is not UInstancedStaticMeshComponent)
                    {
                        var smRef = smc.GetStaticMesh();
                        var mName = smRef?.Name ?? child.Name;
                        meshNames.Add(mName);

                        var loc = smc.GetRelativeLocation() + actorLoc;
                        var rot = smc.GetRelativeRotation();
                        var scale = smc.GetRelativeScale3D();
                        var (qx, qy, qz, qw) = MathHelpers.EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);

                        placements.Add(new
                        {
                            mesh = mName, type = "Waterfall",
                            x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                            qx = Math.Round(qx, 6), qy = Math.Round(qy, 6), qz = Math.Round(qz, 6), qw = Math.Round(qw, 6),
                            sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
                        });
                        waterfallCount++;
                    }
                }
            }
        }

        ExtractWaterfallISM(exports);
        scanned = 0;
        foreach (var cellPath in cellPaths)
        {
            scanned++;
            if (scanned % 500 == 0) Log.Information("  waterfall scan {N}/{Total}...", scanned, cellPaths.Count);
            try
            {
                var cleanPath = cellPath.Replace(".umap", "");
                var cellExports = provider.LoadPackage(cleanPath).GetExports().ToList();
                ExtractWaterfallISM(cellExports);
            }
            catch { }
        }
        Log.Information("Found {Count} waterfall instances", waterfallCount);

        // ── 5. Rivers (BP_River_PROT_C) — spline data ──────
        var rivers = new List<object>();

        void ExtractRivers(IReadOnlyList<CUE4Parse.UE4.Assets.Exports.UObject> exps)
        {
            foreach (var obj in exps)
            {
                if (obj.ExportType != "BP_River_PROT_C") continue;

                var rootRef = obj.GetOrDefault<FPackageIndex>("RootComponent");
                if (rootRef == null) continue;
                var rootComp = rootRef.ResolvedObject?.Object?.Value as USceneComponent;
                if (rootComp == null) continue;
                var actorLoc = rootComp.GetRelativeLocation();
                var actorRot = rootComp.GetRelativeRotation();
                var (aqx, aqy, aqz, aqw) = MathHelpers.EulerToQuat(actorRot.Pitch, actorRot.Yaw, actorRot.Roll);

                // Collect SplineMeshComponent children sorted by index for width data
                // SM_RiverPlane base width = 1000 UE units (BoxExtent.Y = 500)
                const double baseWidth = 1000.0;
                var smcList = exps
                    .Where(e => e.Outer?.Object?.Value == obj && e.ExportType.Contains("SplineMesh"))
                    .OrderBy(e => e.Name) // SplineMeshComponent_0, _1, _2...
                    .ToList();

                // Extract per-point widths from segments (N segments → N+1 widths)
                var widths = new List<double>();
                foreach (var smc in smcList)
                {
                    var sp = smc.GetOrDefault<FStructFallback>("SplineParams");
                    if (sp == null) continue;
                    var startScale = sp.GetOrDefault<FVector2D>("StartScale", new FVector2D(1, 1));
                    var endScale = sp.GetOrDefault<FVector2D>("EndScale", new FVector2D(1, 1));
                    if (widths.Count == 0)
                        widths.Add(Math.Round(startScale.X * baseWidth * 0.5, 1)); // half-width
                    widths.Add(Math.Round(endScale.X * baseWidth * 0.5, 1)); // half-width
                }

                // Find SplineComponent child
                foreach (var child in exps)
                {
                    if (child is not USplineComponent) continue;
                    var outer = child.Outer?.Object?.Value;
                    if (outer != obj) continue;

                    // SplineCurves is a struct with Position, Rotation, Scale sub-curves
                    var splineCurves = child.GetOrDefault<FStructFallback>("SplineCurves");
                    if (splineCurves == null) continue;

                    var posCurve = splineCurves.GetOrDefault<FStructFallback>("Position");
                    if (posCurve == null) continue;

                    var points = posCurve.GetOrDefault<UScriptArray>("Points");
                    if (points == null || points.Properties.Count == 0) continue;

                    var splinePoints = new List<object>();
                    int ptIdx = 0;
                    foreach (var pointProp in points.Properties)
                    {
                        var point = (pointProp?.GenericValue as FScriptStruct)?.StructType as FStructFallback;
                        if (point == null) continue;
                        // InterpCurvePoint<FVector>: InVal, OutVal, ArriveTangent, LeaveTangent
                        var posLocal = point.GetOrDefault("OutVal", FVector.ZeroVector);
                        var arrLocal = point.GetOrDefault("ArriveTangent", FVector.ZeroVector);
                        var lveLocal = point.GetOrDefault("LeaveTangent", FVector.ZeroVector);

                        // Rotate local coords by actor rotation
                        var pos = MathHelpers.QuatRotate(aqx, aqy, aqz, aqw, posLocal.X, posLocal.Y, posLocal.Z);
                        var arrive = MathHelpers.QuatRotate(aqx, aqy, aqz, aqw, arrLocal.X, arrLocal.Y, arrLocal.Z);
                        var leave = MathHelpers.QuatRotate(aqx, aqy, aqz, aqw, lveLocal.X, lveLocal.Y, lveLocal.Z);

                        var hw = ptIdx < widths.Count ? widths[ptIdx] : 500.0; // fallback half-width

                        splinePoints.Add(new
                        {
                            x = Math.Round(pos.x + actorLoc.X, 1),
                            y = Math.Round(pos.y + actorLoc.Y, 1),
                            z = Math.Round(pos.z + actorLoc.Z, 1),
                            ax = Math.Round(arrive.x, 1), ay = Math.Round(arrive.y, 1), az = Math.Round(arrive.z, 1),
                            lx = Math.Round(leave.x, 1), ly = Math.Round(leave.y, 1), lz = Math.Round(leave.z, 1),
                            w = hw,
                        });
                        ptIdx++;
                    }

                    if (splinePoints.Count >= 2)
                    {
                        rivers.Add(new { points = splinePoints });
                        Log.Information("  River: {Count} spline points", splinePoints.Count);
                    }
                }
            }
        }

        ExtractRivers(exports);
        scanned = 0;
        foreach (var cellPath in cellPaths)
        {
            scanned++;
            if (scanned % 500 == 0) Log.Information("  river scan {N}/{Total}...", scanned, cellPaths.Count);
            try
            {
                var cleanPath = cellPath.Replace(".umap", "");
                var cellExports = provider.LoadPackage(cleanPath).GetExports().ToList();
                ExtractRivers(cellExports);
            }
            catch { }
        }
        Log.Information("Found {Count} rivers", rivers.Count);

        Log.Information("Total: {Count} water placements, {RiverCount} rivers, {MeshCount} unique meshes: {Meshes}",
            placements.Count, rivers.Count, meshNames.Count, string.Join(", ", meshNames));

        // ── 6. Write placements ─────────────────────────────
        var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
        var waterDir = Path.Combine(outputDir, "water");
        Directory.CreateDirectory(waterDir);
        var placementsPath = Path.Combine(waterDir, "water_layout.json");
        var outputData = new { placements, rivers };
        File.WriteAllText(placementsPath, System.Text.Json.JsonSerializer.Serialize(outputData, jsonOptions));

        // ── 7. Export water mesh GLBs ───────────────────────
        var glbDir = Path.Combine(waterDir, "glb");
        Directory.CreateDirectory(glbDir);
        var exported = 0;

        var waterMeshPackages = provider.Files.Keys
            .Where(k => k.EndsWith(".uasset"))
            .Where(k => k.Contains("WaterPlane", StringComparison.OrdinalIgnoreCase)
                      || k.Contains("GeneratedWaterPlanes", StringComparison.OrdinalIgnoreCase)
                      || k.Contains("SM_OceanPlane", StringComparison.OrdinalIgnoreCase)
                      || k.Contains("SM_Waterfall", StringComparison.OrdinalIgnoreCase)
                      || k.Contains("SM_SplashModule", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("Material", StringComparison.OrdinalIgnoreCase))
            .Where(k => !k.Contains("Texture", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Log.Information("Scanning {Count} water mesh packages...", waterMeshPackages.Count);

        foreach (var packagePath in waterMeshPackages)
        {
            try
            {
                var cleanPath = packagePath.Replace(".uasset", "");
                var allExports = provider.LoadPackage(cleanPath).GetExports();

                foreach (var obj in allExports)
                {
                    if (obj is not UStaticMesh staticMesh) continue;

                    var meshExporter = new MeshExporter(staticMesh, options);
                    if (meshExporter.MeshLods.Count == 0) continue;

                    var name = staticMesh.Name;
                    var data = meshExporter.MeshLods[0].FileData;
                    File.WriteAllBytes(Path.Combine(glbDir, $"{name}.glb"), data);
                    exported++;
                    Log.Information("  Exported {Name}.glb ({Size} KB)", name, data.Length / 1024);
                }
            }
            catch (Exception ex)
            {
                Log.Warning("Error processing {Path}: {Msg}", packagePath, ex.Message);
            }
        }

        Log.Information("Done: {Placements} placements, {Rivers} rivers, {Meshes} meshes exported",
            placements.Count, rivers.Count, exported);
        JsonOutput.WriteExport("water", outputDir, placements.Count, "0", 0,
            new object[] { new { path = "water/water_layout.json" }, new { path = "water/glb/" } });
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
