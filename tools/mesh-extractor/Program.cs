using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Nanite;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.Writers;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Landscape;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Meshes.glTF;
using CUE4Parse_Conversion.Textures;
using CUE4Parse_Conversion.UEFormat.Enums;
using Serilog;
using Serilog.Sinks.SystemConsole.Themes;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console(theme: AnsiConsoleTheme.Literate)
    .CreateLogger();

// ── Config ────────────────────────────────────────────────
var gameDir = @"C:\Program Files (x86)\Steam\steamapps\common\Satisfactory\FactoryGame\Content\Paks";
var toolkitDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
var outputDir = Path.Combine(toolkitDir, "data", "meshes");

Log.Information("Game: {GameDir}", gameDir);
Log.Information("Output: {OutputDir}", outputDir);
Log.Information("Toolkit: {ToolkitDir}", toolkitDir);

// ── Init Oodle (once, before any provider) ───────────────
var oodleDll = Path.Combine(toolkitDir, "tools", "mesh-extractor", "oodle-data-shared.dll");
OodleHelper.Initialize(oodleDll);

var version = new VersionContainer(EGame.GAME_UE5_3, ETexturePlatform.DesktopMobile);

// ── Parse -p N (required for terrain/buildings) ──────────
int parallelism = 0;
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "-p" && i + 1 < args.Length && int.TryParse(args[i + 1], out var p))
    {
        parallelism = Math.Clamp(p, 1, 16);
        break;
    }
}

// ── Main provider (for scanning, listing, etc.) ──────────
var provider = CreateProvider(gameDir, version);
Log.Information("Loaded {Count} files from provider", provider.Files.Count);

// ── Export options ─────────────────────────────────────────
var options = new ExporterOptions
{
    LodFormat = ELodFormat.AllLods,
    MeshFormat = EMeshFormat.Gltf2,
    NaniteMeshFormat = ENaniteMeshFormat.OnlyNaniteLOD,
    MaterialFormat = EMaterialFormat.FirstLayer,
    TextureFormat = ETextureFormat.Png,
    CompressionFormat = EFileCompressionFormat.None,
    Platform = version.Platform,
    SocketFormat = ESocketFormat.None,
    ExportMorphTargets = false,
    ExportMaterials = true,
};

var mode = args.Length > 0 ? args[0] : "buildings";

switch (mode)
{
    case "list":
        ListAssets(provider);
        break;
    case "buildings":
        if (parallelism == 0) { Log.Error("buildings requires -p N (e.g. -p 4)"); return; }
        ExportBuildings(gameDir, version, options, outputDir, parallelism);
        break;
    case "landscape":
        ExportLandscape(provider, options, outputDir);
        break;
    case "search":
        var query = args.Length > 1 ? args[1] : "Landscape";
        SearchAssets(provider, query, args);
        break;
    case "inspect":
        var inspectPath = args.Length > 1 ? args[1] : "";
        InspectPackage(provider, inspectPath);
        break;
    case "scan-landscape":
        ScanForLandscape(provider);
        break;
    case "landscape-origin":
    {
        var pkg = provider.LoadPackage("FactoryGame/Content/FactoryGame/Map/GameLevel01/Persistent_Level");
        foreach (var obj in pkg.GetExports())
        {
            if (obj is ALandscapeProxy lp)
            {
                var rootRef = lp.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("RootComponent");
                var rootComp = rootRef?.ResolvedObject?.Object?.Value as CUE4Parse.UE4.Assets.Exports.Component.USceneComponent;
                if (rootComp != null)
                {
                    var loc = rootComp.GetRelativeLocation();
                    var scale = rootComp.GetRelativeScale3D();
                    Log.Information("LANDSCAPE ACTOR {Name}: loc=({X},{Y},{Z}) scale=({SX},{SY},{SZ})",
                        lp.Name, loc.X, loc.Y, loc.Z, scale.X, scale.Y, scale.Z);
                }
                else
                {
                    Log.Warning("LANDSCAPE ACTOR {Name}: no RootComponent resolved", lp.Name);
                }
            }
        }
        break;
    }
    case "texture":
        var texturePath = args.Length > 1 ? args[1] : "";
        ExportTexture(provider, texturePath, outputDir);
        break;
    case "dump-landscape":
        var dumpPkg = args.Length > 1 ? args[1] : "FactoryGame/Content/FactoryGame/Map/GameLevel01/Persistent_Level/_Generated_/085M34SZ923WS8WSPBXC3089W";
        DumpLandscapeInfo(provider, dumpPkg);
        break;
    case "bake-terrain":
        BakeTerrainTextures(provider, outputDir);
        break;
    case "terrain":
        if (parallelism == 0) { Log.Error("terrain requires -p N (e.g. -p 4)"); return; }
        var tRatio = GetArg(args, "--ratio") ?? "0.15";
        var tError = GetArg(args, "--error") ?? "0.01";
        ExportTerrainSinglePass(gameDir, version, options, outputDir, parallelism, tRatio, tError);
        break;
    case "fix-metadata":
        FixMetadataZ(provider, outputDir);
        break;
    case "smoke-test":
        SmokeTestParallel(gameDir, version, options, outputDir);
        break;
    case "scan-meshes":
        var scanFilter = args.Length > 1 ? args[1] : "";
        ScanStaticMeshes(provider, scanFilter);
        break;
    case "scenery":
        if (parallelism == 0) { Log.Error("scenery requires -p N (e.g. -p 4)"); return; }
        ExportScenery(gameDir, version, options, outputDir, parallelism);
        break;
    case "scan-actors":
        ScanActors(provider, outputDir);
        break;
    case "scan-hism":
        ScanHISM(provider, outputDir);
        break;
    default:
        Log.Error("Unknown mode: {Mode}. Use: list, buildings, landscape, terrain -p N, search <query>, smoke-test", mode);
        break;
}

// ── Helper: get named arg value ──────────────────────────
static string? GetArg(string[] args, string name)
{
    for (int i = 0; i < args.Length - 1; i++)
        if (args[i] == name) return args[i + 1];
    return null;
}

// ── Create a fresh provider instance ─────────────────────
static DefaultFileProvider CreateProvider(string gameDir, VersionContainer version)
{
    var p = new DefaultFileProvider(gameDir, SearchOption.TopDirectoryOnly, version);
    p.Initialize();
    p.SubmitKey(new FGuid(), new FAesKey("0x0000000000000000000000000000000000000000000000000000000000000000"));
    p.PostMount();
    return p;
}

// ── Smoke test: N parallel providers on 20 packages ──────
static void SmokeTestParallel(string gameDir, VersionContainer version, ExporterOptions options, string outputDir)
{
    var rawDir = Path.Combine(outputDir, "terrain", "smoke_test");
    Directory.CreateDirectory(rawDir);

    // Find 20 _Generated_ packages with landscape components
    var scanProvider = CreateProvider(gameDir, version);
    var allPkgs = scanProvider.Files.Keys
        .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
        .ToList();

    var testPkgs = new List<string>();
    foreach (var pkgPath in allPkgs)
    {
        try
        {
            var cleanPath = pkgPath.Replace(".uasset", "").Replace(".umap", "");
            var exports = scanProvider.LoadPackage(cleanPath).GetExports().ToList();
            if (exports.OfType<ALandscapeProxy>().Any() && exports.OfType<ULandscapeComponent>().Any())
            {
                testPkgs.Add(pkgPath);
                if (testPkgs.Count >= 20) break;
            }
        }
        catch { }
    }

    Log.Information("Smoke test: {Count} packages, 4 consumers", testPkgs.Count);

    var queue = new BlockingCollection<string>();
    foreach (var p in testPkgs) queue.Add(p);
    queue.CompleteAdding();

    var ok = 0;
    var failed = 0;
    var watch = Stopwatch.StartNew();

    var consumers = Enumerable.Range(0, 4).Select(i => Task.Run(() =>
    {
        var myProvider = CreateProvider(gameDir, version);
        Log.Information("  Consumer {I}: provider ready", i);

        foreach (var pkg in queue.GetConsumingEnumerable())
        {
            try
            {
                var cleanPath = pkg.Replace(".uasset", "").Replace(".umap", "");
                var exports = myProvider.LoadPackage(cleanPath).GetExports().ToList();
                var proxy = exports.OfType<ALandscapeProxy>().First();
                var comp = exports.OfType<ULandscapeComponent>().First();
                var tileName = $"smoke_{i}_{comp.SectionBaseX}_{comp.SectionBaseY}";

                var glbPath = Path.Combine(rawDir, $"{tileName}.glb");
                if (proxy.TryConvert(new[] { comp }, ELandscapeExportFlags.Mesh, out var mesh, out _, out _) && mesh != null)
                {
                    using var ar = new FArchiveWriter();
                    new Gltf(tileName, mesh.LODs.First(), null, options).Save(options.MeshFormat, ar);
                    File.WriteAllBytes(glbPath, ar.GetBuffer());
                }

                if (File.Exists(glbPath))
                {
                    var size = new FileInfo(glbPath).Length / 1024;
                    Log.Information("  Consumer {I}: {Tile} OK ({Size} KB)", i, tileName, size);
                    Interlocked.Increment(ref ok);
                }
                else
                {
                    Log.Warning("  Consumer {I}: {Tile} FAILED (no output)", i, tileName);
                    Interlocked.Increment(ref failed);
                }
            }
            catch (Exception ex)
            {
                Log.Warning("  Consumer {I}: FAILED — {Msg}", i, ex.Message);
                Interlocked.Increment(ref failed);
            }
        }
    })).ToArray();

    Task.WaitAll(consumers);
    watch.Stop();

    // Cleanup
    try { Directory.Delete(rawDir, true); } catch { }

    Log.Information("Smoke test done: {OK} OK, {Failed} failed in {Time}", ok, failed, watch.Elapsed);
    if (failed == 0)
        Log.Information("✓ Multi-provider parallel export is SAFE");
    else
        Log.Error("✗ {Failed} failures — multi-provider may have issues", failed);
}

// ── List Buildable assets ─────────────────────────────────
static void ListAssets(DefaultFileProvider provider)
{
    var buildable = provider.Files.Keys
        .Where(k => k.Contains("Buildable", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset"))
        .OrderBy(k => k)
        .ToList();

    Log.Information("Found {Count} Buildable assets", buildable.Count);
    foreach (var path in buildable.Take(100))
        Console.WriteLine(path);

    if (buildable.Count > 100)
        Console.WriteLine($"... and {buildable.Count - 100} more");
}

// ── Search assets by name ─────────────────────────────────
static void SearchAssets(DefaultFileProvider provider, string query, string[] args)
{
    var matches = provider.Files.Keys
        .Where(k => k.Contains(query, StringComparison.OrdinalIgnoreCase))
        .OrderBy(k => k)
        .ToList();

    Log.Information("Found {Count} assets matching '{Query}'", matches.Count, query);
    var limit = 200;
    for (int ii = 0; ii < args.Length - 1; ii++)
        if (args[ii] == "--limit" && int.TryParse(args[ii + 1], out var l)) limit = l;
    foreach (var path in matches.Take(limit))
        Console.WriteLine(path);

    if (matches.Count > limit)
        Console.WriteLine($"... and {matches.Count - limit} more");
}

// ── Export building meshes — multi-provider queue ─────────
static void ExportBuildings(string gameDir, VersionContainer version, ExporterOptions options,
    string outputDir, int parallelism)
{
    var scanProvider = CreateProvider(gameDir, version);
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
        var myProvider = CreateProvider(gameDir, version);
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

                    var className = ExtractClassName(packagePath);
                    var lod0Size = meshExporter.MeshLods[0].FileData.LongLength;

                    bestMeshes.AddOrUpdate(className,
                        _ => {
                            var lods = new Dictionary<int, byte[]>();
                            for (var j = 0; j < meshExporter.MeshLods.Count; j++)
                                lods[j] = meshExporter.MeshLods[j].FileData;
                            return (lods, lod0Size);
                        },
                        (_, existing) => {
                            if (existing.lod0Size >= lod0Size) return existing;
                            var lods = new Dictionary<int, byte[]>();
                            for (var j = 0; j < meshExporter.MeshLods.Count; j++)
                                lods[j] = meshExporter.MeshLods[j].FileData;
                            return (lods, lod0Size);
                        });
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
    var exported = 0;
    foreach (var (className, (lods, lod0Size)) in bestMeshes)
    {
        foreach (var (lodIndex, data) in lods)
        {
            var lodDir = $"lod{lodIndex}";
            var outPath = Path.Combine(outputDir, lodDir, $"{className}.glb");
            Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            File.WriteAllBytes(outPath, data);
            Log.Information("[{N}] {Class} LOD{Lod} → {Size} KB",
                ++exported, className, lodIndex, data.Length / 1024);
        }
    }

    watch.Stop();
    Log.Information("Done: {ClassCount} buildings, {MeshCount} meshes in {Time} ({Errors} errors)",
        bestMeshes.Count, exported, watch.Elapsed, errors);
}

// ── Export landscape ──────────────────────────────────────
static void ExportLandscape(DefaultFileProvider provider, ExporterOptions options, string outputDir)
{
    // Search for LandscapeStreamingProxy or ALandscapeProxy
    var landscapePaths = provider.Files.Keys
        .Where(k => k.Contains("Landscape", StringComparison.OrdinalIgnoreCase)
                     || k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
        .ToList();

    Log.Information("Found {Count} potential landscape packages", landscapePaths.Count);

    var landscapeDir = Path.Combine(outputDir, "landscape");
    Directory.CreateDirectory(landscapeDir);

    var exported = 0;
    var watch = Stopwatch.StartNew();

    foreach (var packagePath in landscapePaths)
    {
        try
        {
            var cleanPath = packagePath.Replace(".uasset", "").Replace(".umap", "");
            var allExports = provider.LoadPackage(cleanPath).GetExports();

            foreach (var obj in allExports)
            {
                if (obj is ALandscapeProxy landscape)
                {
                    Log.Information("Found LandscapeProxy: {Name} in {Path}", landscape.Name, packagePath);

                    // Gather landscape components
                    var components = allExports
                        .OfType<ULandscapeComponent>()
                        .ToArray();

                    if (components.Length == 0)
                    {
                        Log.Warning("No LandscapeComponents found alongside {Name}", landscape.Name);
                        continue;
                    }

                    var exporter = new LandscapeExporter(landscape, components, options);
                    if (exporter.TryWriteToDir(new DirectoryInfo(landscapeDir), out var label, out var savedPath))
                    {
                        exported++;
                        Log.Information("[{N}] Landscape exported: {Label}", exported, label);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Log.Debug("Skipped {Path}: {Msg}", packagePath, ex.Message);
        }
    }

    watch.Stop();
    Log.Information("Landscape: exported {Count} in {Time}", exported, watch.Elapsed);
}

// ── Helper: extract className from asset path ─────────────
// ── Inspect a package's exports ───────────────────────────
static void InspectPackage(DefaultFileProvider provider, string assetPath)
{
    if (string.IsNullOrWhiteSpace(assetPath))
    {
        Log.Error("Usage: inspect <asset-path>");
        return;
    }

    var cleanPath = assetPath.Replace(".uasset", "").Replace(".umap", "");
    try
    {
        var exports = provider.LoadPackage(cleanPath).GetExports().ToList();
        Log.Information("Package {Path}: {Count} exports", cleanPath, exports.Count);
        foreach (var obj in exports)
        {
            var typeName = obj.GetType().Name;
            Log.Information("  [{Type}] {Name} (class: {Class})", typeName, obj.Name, obj.ExportType);
        }
    }
    catch (Exception ex)
    {
        Log.Error("Failed to load {Path}: {Msg}", cleanPath, ex.Message);
    }
}

// ── Scan _Generated_ packages for ALandscapeProxy ────────
static void ScanForLandscape(DefaultFileProvider provider)
{
    var generatedPaths = provider.Files.Keys
        .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
        .ToList();

    Log.Information("Scanning {Count} _Generated_ packages for landscape actors...", generatedPaths.Count);

    var found = 0;
    var scanned = 0;
    foreach (var packagePath in generatedPaths)
    {
        scanned++;
        if (scanned % 500 == 0) Log.Information("  scanned {N}/{Total}...", scanned, generatedPaths.Count);

        try
        {
            var cleanPath = packagePath.Replace(".uasset", "").Replace(".umap", "");
            var pkg = provider.LoadPackage(cleanPath);

            foreach (var lazy in pkg.ExportsLazy)
            {
                var obj = lazy.Value;
                if (obj is ALandscapeProxy landscape)
                {
                    found++;
                    Log.Information("FOUND [{N}] LandscapeProxy '{Name}' in {Path}", found, landscape.Name, packagePath);
                }
                else if (obj is ULandscapeComponent comp)
                {
                    found++;
                    Log.Information("FOUND [{N}] LandscapeComponent '{Name}' in {Path}", found, comp.Name, packagePath);
                }
                else if (obj.ExportType.Contains("Landscape", StringComparison.OrdinalIgnoreCase))
                {
                    found++;
                    Log.Information("FOUND [{N}] {Type} '{Name}' in {Path}", found, obj.ExportType, obj.Name, packagePath);
                }
            }
        }
        catch { /* skip unloadable packages */ }
    }

    Log.Information("Scan complete: {Found} landscape objects in {Scanned} packages", found, scanned);
}

// ── Scan all packages for UStaticMesh exports ───────────
static void ScanStaticMeshes(DefaultFileProvider provider, string filter)
{
    var allPaths = provider.Files.Keys
        .Where(k => k.StartsWith("factorygame/content/factorygame/", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset"))
        .Where(k => !k.Contains("/Texture", StringComparison.OrdinalIgnoreCase))
        .Where(k => !k.Contains("/Material", StringComparison.OrdinalIgnoreCase))
        .Where(k => !k.Contains("/Audio", StringComparison.OrdinalIgnoreCase))
        .Where(k => !k.Contains("/Animation", StringComparison.OrdinalIgnoreCase))
        .Where(k => !k.Contains("/VFX", StringComparison.OrdinalIgnoreCase))
        .Where(k => !k.Contains("/UI/", StringComparison.OrdinalIgnoreCase))
        .Where(k => !k.Contains("/Wwise", StringComparison.OrdinalIgnoreCase))
        .Where(k => string.IsNullOrEmpty(filter) || k.Contains(filter, StringComparison.OrdinalIgnoreCase))
        .OrderBy(k => k)
        .ToList();

    Log.Information("Scanning {Count} packages for UStaticMesh (filter: '{Filter}')...", allPaths.Count, filter);

    var results = new List<(string path, string meshName, int naniteTriangles, int lodCount)>();
    var scanned = 0;
    var errors = 0;

    foreach (var pkgPath in allPaths)
    {
        scanned++;
        if (scanned % 500 == 0) Log.Information("  scanned {N}/{Total}...", scanned, allPaths.Count);

        try
        {
            var cleanPath = pkgPath.Replace(".uasset", "");
            var exports = provider.LoadPackage(cleanPath).GetExports().ToList();

            foreach (var obj in exports)
            {
                if (obj is UStaticMesh sm)
                {
                    var meshExporter = new MeshExporter(sm, new ExporterOptions
                    {
                        LodFormat = ELodFormat.AllLods,
                        MeshFormat = EMeshFormat.Gltf2,
                        NaniteMeshFormat = ENaniteMeshFormat.OnlyNaniteLOD,
                        MaterialFormat = EMaterialFormat.FirstLayer,
                        CompressionFormat = EFileCompressionFormat.None,
                        ExportMorphTargets = false,
                        ExportMaterials = false,
                    });
                    var lodCount = meshExporter.MeshLods.Count;
                    var lod0Size = lodCount > 0 ? meshExporter.MeshLods[0].FileData.Length / 1024 : 0;
                    results.Add((pkgPath, sm.Name, lod0Size, lodCount));
                }
            }
        }
        catch
        {
            errors++;
        }
    }

    // Group by top-level directory
    var grouped = results
        .GroupBy(r => {
            var rel = r.path.Replace("factorygame/content/factorygame/", "", StringComparison.OrdinalIgnoreCase);
            var parts = rel.Split('/');
            return parts.Length >= 2 ? parts[0] + "/" + parts[1] : parts[0];
        })
        .OrderBy(g => g.Key);

    Log.Information("Found {Count} UStaticMesh in {Scanned} packages ({Errors} errors)", results.Count, scanned, errors);
    Console.WriteLine();

    foreach (var group in grouped)
    {
        Console.WriteLine($"── {group.Key} ({group.Count()} meshes) ──");
        foreach (var r in group.OrderBy(r => r.meshName))
        {
            Console.WriteLine($"  {r.meshName}  LODs={r.lodCount}  LOD0={r.naniteTriangles}KB  {r.path}");
        }
        Console.WriteLine();
    }
}

// ── Single-pass terrain export (mesh GLB + baked PNG) — multi-provider queue ──
static void ExportTerrainSinglePass(string gameDir, VersionContainer version, ExporterOptions options,
    string outputDir, int parallelism, string simplifyRatio = "0.15", string simplifyError = "0.01")
{
    // Layer name → average RGB color
    var layerColors = new Dictionary<string, (byte r, byte g, byte b)>
    {
        ["Grass_LayerInfo"]           = (106, 130,  58),
        ["Forest_LayerInfo"]          = ( 72, 100,  42),
        ["GrassRed_LayerInfo"]        = (140, 100,  55),
        ["RedJungle_LayerInfo"]       = (120,  70,  45),
        ["PurpleForest_LayerInfo"]    = ( 90,  70,  95),
        ["Cliff_LayerInfo"]           = (130, 120, 105),
        ["CoralRock_LayerInfo"]       = (160, 140, 110),
        ["DesertRock_LayerInfo"]      = (170, 150, 120),
        ["SandRock_LayerInfo"]        = (180, 160, 130),
        ["Sand_LayerInfo"]            = (200, 185, 150),
        ["WetSand_LayerInfo"]         = (170, 155, 125),
        ["SandCracks_LayerInfo"]      = (190, 170, 135),
        ["SandPebbles_LayerInfo"]     = (175, 160, 130),
        ["SandRipples_LayerInfo"]     = (195, 180, 145),
        ["Gravel_WeightLayerInfo"]    = (140, 130, 115),
        ["Soil_LayerInfo"]            = ( 95,  80,  55),
        ["Puddles_LayerInfo"]         = ( 70,  85,  75),
        ["Foliage_Eraser_LayerInfo"]  = (106, 130,  58),
        ["None"]                      = (106, 130,  58),
    };

    // Sample actual average colors from layer textures using main provider
    var scanProvider = CreateProvider(gameDir, version);
    var texturePaths = new Dictionary<string, string>
    {
        ["Grass_LayerInfo"]        = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Grass/TX_Grass_01_Alb",
        ["Forest_LayerInfo"]       = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Forest/TX_Forest_01_Alb",
        ["GrassRed_LayerInfo"]     = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/GrassRed/TX_GrassRed_01_Alb",
        ["RedJungle_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/RedJungle/TX_Grass_RedJungle_01_Alb",
        ["Cliff_LayerInfo"]        = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Cliff/Cliff_Detail_Alb",
        ["DesertRock_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Cliff/Cliff_Macro_Alb_02",
        ["Sand_LayerInfo"]         = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Sand/Sand_02_Albedo",
        ["WetSand_LayerInfo"]      = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Sand/Sand_Dry_02_Alb",
        ["SandRock_LayerInfo"]     = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/SandRock/TX_SandRock_Alb_01",
        ["SandPebbles_LayerInfo"]  = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Pebbels/TX_SandPebbles_01_Alb",
        ["Gravel_WeightLayerInfo"] = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Stones/Gravel_Alb",
        ["Soil_LayerInfo"]         = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Soil/Soil_Alb",
        ["Puddles_LayerInfo"]      = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Soil/TX_Puddles_01_Alb",
        ["CoralRock_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/SeaRocks/TX_SeaRocks_01_Alb",
    };

    foreach (var (layer, texPath) in texturePaths)
    {
        try
        {
            var pkg = scanProvider.LoadPackage(texPath);
            var tex = pkg.GetExports().OfType<UTexture2D>().FirstOrDefault();
            if (tex == null) continue;
            var decoded = tex.Decode();
            if (decoded == null) continue;
            using var bmp = decoded.ToSkBitmap();
            long rSum = 0, gSum = 0, bSum = 0;
            int count = 0;
            for (int y = 0; y < bmp.Height; y += 4)
            for (int x = 0; x < bmp.Width; x += 4)
            {
                var px = bmp.GetPixel(x, y);
                rSum += px.Red; gSum += px.Green; bSum += px.Blue;
                count++;
            }
            if (count > 0)
            {
                layerColors[layer] = ((byte)(rSum / count), (byte)(gSum / count), (byte)(bSum / count));
                Log.Information("Layer {Layer}: avg color ({R},{G},{B})", layer, rSum / count, gSum / count, bSum / count);
            }
        }
        catch { }
    }

    // Find all _Generated_ landscape packages
    var landscapePaths = scanProvider.Files.Keys
        .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
        .ToList();

    var terrainDir = Path.Combine(outputDir, "terrain");
    var rawDir = Path.Combine(terrainDir, "raw");
    var glbDir = Path.Combine(terrainDir, "glb");
    var imgDir = Path.Combine(terrainDir, "img");
    Directory.CreateDirectory(rawDir);
    Directory.CreateDirectory(glbDir);
    Directory.CreateDirectory(imgDir);

    var watch = Stopwatch.StartNew();
    var seen = new ConcurrentDictionary<string, byte>();
    var tileResults = new ConcurrentBag<(string tile, int x, int y, long wMinX, long wMinY, long wMaxX, long wMaxY, int comps)>();
    var exported = 0;
    var ratio = simplifyRatio;
    var error = simplifyError;

    // ── Queue ──
    var queue = new BlockingCollection<string>();
    foreach (var p in landscapePaths) queue.Add(p);
    queue.CompleteAdding();
    Log.Information("Queued {Count} packages for {N} consumers", landscapePaths.Count, parallelism);

    // ── N consumers — each creates its own provider ──
    var consumers = Enumerable.Range(0, parallelism).Select(i => Task.Run(() =>
    {
        var myProvider = CreateProvider(gameDir, version);
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
                    if (!seen.TryAdd(tileName, 0)) continue;

                    var bx = comp.SectionBaseX;
                    var by = comp.SectionBaseY;
                    var sq = comp.ComponentSizeQuads;

                    // 1. Export GLB raw — TryConvert + Gltf → sync write
                    var rawGlb = Path.Combine(rawDir, $"{tileName}.glb");
                    if (proxy.TryConvert(new[] { comp }, ELandscapeExportFlags.Mesh, out var mesh, out _, out _) && mesh != null)
                    {
                        using var ar = new FArchiveWriter();
                        new Gltf(tileName, mesh.LODs.First(), null, options).Save(options.MeshFormat, ar);
                        File.WriteAllBytes(rawGlb, ar.GetBuffer());
                    }

                    // 2. Bake PNG
                    var pngPath = Path.Combine(imgDir, $"{tileName}.png");
                    BakeTileTexture(new[] { comp }, layerColors, pngPath);

                    // 3. Simplify raw → glb/
                    if (File.Exists(rawGlb))
                    {
                        var outPath = Path.Combine(glbDir, $"{tileName}.glb");
                        var nodePath = @"C:\nvm4w\nodejs\node.exe";
                        var gltfCli = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
                        var psi = new ProcessStartInfo(nodePath, $"\"{gltfCli}\" simplify \"{rawGlb}\" \"{outPath}\" --ratio {ratio} --error {error}")
                        {
                            UseShellExecute = false, CreateNoWindow = true,
                            RedirectStandardOutput = true, RedirectStandardError = true,
                            WorkingDirectory = outputDir,
                        };
                        using var proc = Process.Start(psi);
                        if (proc != null)
                        {
                            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
                            var stderrTask = proc.StandardError.ReadToEndAsync();
                            proc.WaitForExit(120_000);
                            if (proc.ExitCode != 0 || !File.Exists(outPath))
                            {
                                var errFile = Path.Combine(glbDir, $"{tileName}_error.txt");
                                File.WriteAllText(errFile, $"exit={proc.ExitCode}\nstdout:\n{stdoutTask.Result}\nstderr:\n{stderrTask.Result}");
                                Log.Warning("Simplify failed {Tile}: exit={Code} see {ErrFile}", tileName, proc.ExitCode, errFile);
                            }
                        }
                    }

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
    var metadataPath = Path.Combine(terrainDir, "metadata.json");
    var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
    var sortedMeta = tileResults.OrderBy(t => t.tile).Select(t => new {
        tile = t.tile, x = t.x, y = t.y,
        worldMinX = t.wMinX, worldMinY = t.wMinY, worldMaxX = t.wMaxX, worldMaxY = t.wMaxY,
        components = t.comps
    }).ToArray();
    File.WriteAllText(metadataPath, System.Text.Json.JsonSerializer.Serialize(sortedMeta, jsonOptions));

    watch.Stop();
    Log.Information("All done: {N} tiles in {Time}", exported, watch.Elapsed);
}

static void FixMetadataZ(DefaultFileProvider provider, string outputDir)
{
    var terrainDir = Path.Combine(outputDir, "terrain");
    var metadataPath = Path.Combine(terrainDir, "metadata.json");
    if (!File.Exists(metadataPath))
    {
        Log.Error("No metadata.json found at {Path}", metadataPath);
        return;
    }

    var landscapePaths = provider.Files.Keys
        .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
        .ToList();

    // Build tile -> worldZ mapping from proxy RootComponent RelativeLocation
    var tileZ = new Dictionary<string, double>();

    foreach (var pkgPath in landscapePaths)
    {
        try
        {
            var cleanPath = pkgPath.Replace(".uasset", "").Replace(".umap", "");
            var exports = provider.LoadPackage(cleanPath).GetExports().ToList();
            var proxies = exports.OfType<ALandscapeProxy>().ToList();

            foreach (var proxy in proxies)
            {
                var match = System.Text.RegularExpressions.Regex.Match(proxy.Name, @"_508_(-?\d+)_(-?\d+)_(\d+)");
                if (!match.Success) continue;

                var tileX = int.Parse(match.Groups[1].Value);
                var tileY = int.Parse(match.Groups[2].Value);
                var proxyN = match.Groups[3].Value;
                var tileKey = $"tile_{tileX}_{tileY}_{proxyN}";

                // Log ALL proxies (no dedup) to compare Z across N variants
                var rootRef = proxy.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("RootComponent");
                if (rootRef != null)
                {
                    var rootComp = rootRef.ResolvedObject?.Object?.Value as CUE4Parse.UE4.Assets.Exports.Component.USceneComponent;
                    if (rootComp != null)
                    {
                        var loc = rootComp.GetRelativeLocation();
                        var scale = rootComp.GetRelativeScale3D();
                        var comps = proxy.LandscapeComponents.Length;
                        tileZ[tileKey] = loc.Z;
                        Log.Information("{Key}: loc=({X},{Y},{Z}) scale=({SX},{SY},{SZ}) comps={C}",
                            tileKey, loc.X, loc.Y, loc.Z, scale.X, scale.Y, scale.Z, comps);
                    }
                }
                else
                {
                    Log.Warning("Tile {Key}: no RootComponent", tileKey);
                }
            }
        }
        catch { }
    }

    // Read existing metadata, add worldZ, write back
    var jsonText = File.ReadAllText(metadataPath);
    var meta = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement[]>(jsonText)!;
    var updated = new List<object>();

    foreach (var entry in meta)
    {
        var tile = entry.GetProperty("tile").GetString()!;
        var x = entry.GetProperty("x").GetInt32();
        var y = entry.GetProperty("y").GetInt32();
        var wMinX = entry.GetProperty("worldMinX").GetInt64();
        var wMinY = entry.GetProperty("worldMinY").GetInt64();
        var wMaxX = entry.GetProperty("worldMaxX").GetInt64();
        var wMaxY = entry.GetProperty("worldMaxY").GetInt64();
        var comps = entry.GetProperty("components").GetInt32();

        var z = tileZ.TryGetValue(tile, out var zVal) ? zVal : 0.0;
        updated.Add(new { tile, x, y, worldMinX = wMinX, worldMinY = wMinY, worldMaxX = wMaxX, worldMaxY = wMaxY, worldZ = z, components = comps });
    }

    var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
    File.WriteAllText(metadataPath, System.Text.Json.JsonSerializer.Serialize(updated, jsonOptions));
    Log.Information("Updated {Path}: {Count} tiles, {Found} with Z offset", metadataPath, updated.Count, tileZ.Count);
}

static void BakeTileTexture(ULandscapeComponent[] components, Dictionary<string, (byte r, byte g, byte b)> layerColors, string outPath)
{
    int minBX = int.MaxValue, minBY = int.MaxValue, maxBX = int.MinValue, maxBY = int.MinValue;
    foreach (var c in components)
    {
        minBX = Math.Min(minBX, c.SectionBaseX);
        minBY = Math.Min(minBY, c.SectionBaseY);
        maxBX = Math.Max(maxBX, c.SectionBaseX + c.ComponentSizeQuads);
        maxBY = Math.Max(maxBY, c.SectionBaseY + c.ComponentSizeQuads);
    }

    var compSize = components[0].ComponentSizeQuads;
    var wmSize = compSize + 1;
    var gridW = (maxBX - minBX) / compSize;
    var gridH = (maxBY - minBY) / compSize;
    var texW = gridW * wmSize;
    var texH = gridH * wmSize;

    using var bmp = new SkiaSharp.SKBitmap(texW, texH);

    foreach (var comp in components)
    {
        var allocations = comp.GetWeightmapLayerAllocations();
        var weightmaps = comp.GetWeightmapTextures();

        var cx = (comp.SectionBaseX - minBX) / compSize;
        var cy = (comp.SectionBaseY - minBY) / compSize;
        var px0 = cx * wmSize;
        var py0 = cy * wmSize;

        var wmBitmaps = new SkiaSharp.SKBitmap?[weightmaps.Length];
        for (int i = 0; i < weightmaps.Length; i++)
        {
            var decoded = weightmaps[i]?.Decode();
            wmBitmaps[i] = decoded?.ToSkBitmap();
        }

        for (int ly = 0; ly < wmSize; ly++)
        for (int lx = 0; lx < wmSize; lx++)
        {
            float rAcc = 0, gAcc = 0, bAcc = 0, totalWeight = 0;

            foreach (var alloc in allocations)
            {
                var wmIdx = alloc.WeightmapTextureIndex;
                var ch = alloc.WeightmapTextureChannel;
                if (wmIdx >= wmBitmaps.Length || wmBitmaps[wmIdx] == null) continue;

                var wmBmp = wmBitmaps[wmIdx]!;
                var sx = Math.Min(lx, wmBmp.Width - 1);
                var sy = Math.Min(ly, wmBmp.Height - 1);
                var pixel = wmBmp.GetPixel(sx, sy);

                byte weight = ch switch { 0 => pixel.Red, 1 => pixel.Green, 2 => pixel.Blue, 3 => pixel.Alpha, _ => 0 };
                if (weight == 0) continue;

                var layerName = alloc.GetLayerName();
                if (!layerColors.TryGetValue(layerName, out var col))
                    col = (106, 130, 58);

                float w = weight / 255f;
                rAcc += col.r * w;
                gAcc += col.g * w;
                bAcc += col.b * w;
                totalWeight += w;
            }

            byte fr = 106, fg = 130, fb = 58;
            if (totalWeight > 0)
            {
                fr = (byte)Math.Clamp(rAcc / totalWeight, 0, 255);
                fg = (byte)Math.Clamp(gAcc / totalWeight, 0, 255);
                fb = (byte)Math.Clamp(bAcc / totalWeight, 0, 255);
            }

            var outX = px0 + lx;
            var outY = py0 + ly;
            if (outX < texW && outY < texH)
                bmp.SetPixel(outX, outY, new SkiaSharp.SKColor(fr, fg, fb));
        }

        foreach (var wb in wmBitmaps) wb?.Dispose();
    }

    using var img = SkiaSharp.SKImage.FromBitmap(bmp);
    using var data = img.Encode(SkiaSharp.SKEncodedImageFormat.Png, 90);
    using var fs = File.Create(outPath);
    data.SaveTo(fs);
}


// ── Dump landscape component info ────────────────────────
static void DumpLandscapeInfo(DefaultFileProvider provider, string packagePath)
{
    var cleanPath = packagePath.Replace(".uasset", "").Replace(".umap", "");
    var exports = provider.LoadPackage(cleanPath).GetExports().ToList();

    var components = exports.OfType<ULandscapeComponent>().ToList();
    Log.Information("Package has {Count} LandscapeComponents", components.Count);

    // Collect all unique layers across all components
    var allLayers = new HashSet<string>();

    foreach (var comp in components.Take(4)) // just dump first 4
    {
        Log.Information("Component {Name}: base=({BX},{BY}), size={Size}q, subsections={Sub}x{SubSize}",
            comp.Name, comp.SectionBaseX, comp.SectionBaseY,
            comp.ComponentSizeQuads, comp.NumSubsections, comp.SubsectionSizeQuads);

        var allocations = comp.GetWeightmapLayerAllocations();
        Log.Information("  {Count} layer allocations:", allocations.Length);
        foreach (var alloc in allocations)
        {
            var name = alloc.GetLayerName();
            allLayers.Add(name);
            Log.Information("    Layer '{Name}' → Weightmap[{Idx}] channel {Ch}",
                name, alloc.WeightmapTextureIndex, alloc.WeightmapTextureChannel);
        }

        var weightmaps = comp.GetWeightmapTextures();
        Log.Information("  {Count} weightmap textures", weightmaps.Length);
        for (var i = 0; i < weightmaps.Length; i++)
        {
            var wm = weightmaps[i];
            var decoded = wm?.Decode();
            Log.Information("    Weightmap[{Idx}]: {Name} → {W}x{H}",
                i, wm?.Name ?? "null", decoded?.Width ?? 0, decoded?.Height ?? 0);
        }
    }

    Log.Information("All unique layers: {Layers}", string.Join(", ", allLayers.OrderBy(x => x)));
}

// ── Bake terrain textures ────────────────────────────────
static void BakeTerrainTextures(DefaultFileProvider provider, string outputDir)
{
    // Layer name → average RGB color (fallback values, will be overwritten from textures)
    var layerColors = new Dictionary<string, (byte r, byte g, byte b)>
    {
        ["Grass_LayerInfo"]           = (106, 130,  58),
        ["Forest_LayerInfo"]          = ( 72, 100,  42),
        ["GrassRed_LayerInfo"]        = (140, 100,  55),
        ["RedJungle_LayerInfo"]       = (120,  70,  45),
        ["PurpleForest_LayerInfo"]    = ( 90,  70,  95),
        ["Cliff_LayerInfo"]           = (130, 120, 105),
        ["CoralRock_LayerInfo"]       = (160, 140, 110),
        ["DesertRock_LayerInfo"]      = (170, 150, 120),
        ["SandRock_LayerInfo"]        = (180, 160, 130),
        ["Sand_LayerInfo"]            = (200, 185, 150),
        ["WetSand_LayerInfo"]         = (170, 155, 125),
        ["SandCracks_LayerInfo"]      = (190, 170, 135),
        ["SandPebbles_LayerInfo"]     = (175, 160, 130),
        ["SandRipples_LayerInfo"]     = (195, 180, 145),
        ["Gravel_WeightLayerInfo"]    = (140, 130, 115),
        ["Soil_LayerInfo"]            = ( 95,  80,  55),
        ["Puddles_LayerInfo"]         = ( 70,  85,  75),
        ["Foliage_Eraser_LayerInfo"]  = (106, 130,  58),
        ["None"]                      = (106, 130,  58),
    };

    // Sample actual average colors from layer textures
    var texturePaths = new Dictionary<string, string>
    {
        ["Grass_LayerInfo"]        = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Grass/TX_Grass_01_Alb",
        ["Forest_LayerInfo"]       = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Forest/TX_Forest_01_Alb",
        ["GrassRed_LayerInfo"]     = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/GrassRed/TX_GrassRed_01_Alb",
        ["RedJungle_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/RedJungle/TX_Grass_RedJungle_01_Alb",
        ["Cliff_LayerInfo"]        = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Cliff/Cliff_Detail_Alb",
        ["DesertRock_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Cliff/Cliff_Macro_Alb_02",
        ["Sand_LayerInfo"]         = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Sand/Sand_02_Albedo",
        ["WetSand_LayerInfo"]      = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Sand/Sand_Dry_02_Alb",
        ["SandRock_LayerInfo"]     = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/SandRock/TX_SandRock_Alb_01",
        ["SandPebbles_LayerInfo"]  = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Pebbels/TX_SandPebbles_01_Alb",
        ["Gravel_WeightLayerInfo"] = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Stones/Gravel_Alb",
        ["Soil_LayerInfo"]         = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Soil/Soil_Alb",
        ["Puddles_LayerInfo"]      = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Soil/TX_Puddles_01_Alb",
        ["CoralRock_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/SeaRocks/TX_SeaRocks_01_Alb",
    };

    foreach (var (layer, texPath) in texturePaths)
    {
        try
        {
            var pkg = provider.LoadPackage(texPath);
            var tex = pkg.GetExports().OfType<UTexture2D>().FirstOrDefault();
            if (tex == null) continue;
            var decoded = tex.Decode();
            if (decoded == null) continue;
            using var bmp = decoded.ToSkBitmap();
            long rSum = 0, gSum = 0, bSum = 0;
            int count = 0;
            for (int y = 0; y < bmp.Height; y += 4)
            for (int x = 0; x < bmp.Width; x += 4)
            {
                var px = bmp.GetPixel(x, y);
                rSum += px.Red; gSum += px.Green; bSum += px.Blue;
                count++;
            }
            if (count > 0)
            {
                layerColors[layer] = ((byte)(rSum / count), (byte)(gSum / count), (byte)(bSum / count));
                Log.Information("Layer {Layer}: avg color ({R},{G},{B})", layer, rSum / count, gSum / count, bSum / count);
            }
        }
        catch (Exception ex) { Log.Debug("Failed to sample {Layer}: {Msg}", layer, ex.Message); }
    }

    // Find all landscape packages
    var landscapePaths = provider.Files.Keys
        .Where(k => k.Contains("_Generated_", StringComparison.OrdinalIgnoreCase))
        .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
        .ToList();

    var terrainDir = Path.Combine(outputDir, "terrain");
    Directory.CreateDirectory(terrainDir);
    var baked = 0;
    var watch = Stopwatch.StartNew();

    foreach (var pkgPath in landscapePaths)
    {
        try
        {
            var cleanPath = pkgPath.Replace(".uasset", "").Replace(".umap", "");
            var exports = provider.LoadPackage(cleanPath).GetExports().ToList();
            var components = exports.OfType<ULandscapeComponent>().ToList();
            if (components.Count == 0) continue;

            var proxyName = exports.OfType<ALandscapeProxy>().Select(p => p.Name).FirstOrDefault();
            if (proxyName == null) continue;

            var match = System.Text.RegularExpressions.Regex.Match(proxyName, @"_508_(-?\d+)_(-?\d+)_(\d+)");
            if (!match.Success) continue;
            var tileX = int.Parse(match.Groups[1].Value);
            var tileY = int.Parse(match.Groups[2].Value);

            var outPath = Path.Combine(terrainDir, $"tile_{tileX}_{tileY}.png");
            if (File.Exists(outPath)) { baked++; continue; }

            // Find component grid extent
            int minBX = int.MaxValue, minBY = int.MaxValue, maxBX = int.MinValue, maxBY = int.MinValue;
            foreach (var c in components)
            {
                minBX = Math.Min(minBX, c.SectionBaseX);
                minBY = Math.Min(minBY, c.SectionBaseY);
                maxBX = Math.Max(maxBX, c.SectionBaseX + c.ComponentSizeQuads);
                maxBY = Math.Max(maxBY, c.SectionBaseY + c.ComponentSizeQuads);
            }

            var compSize = components[0].ComponentSizeQuads;
            var wmSize = compSize + 1;
            var gridW = (maxBX - minBX) / compSize;
            var gridH = (maxBY - minBY) / compSize;
            var texW = gridW * wmSize;
            var texH = gridH * wmSize;

            using var bmp = new SkiaSharp.SKBitmap(texW, texH);

            foreach (var comp in components)
            {
                var allocations = comp.GetWeightmapLayerAllocations();
                var weightmaps = comp.GetWeightmapTextures();

                var cx = (comp.SectionBaseX - minBX) / compSize;
                var cy = (comp.SectionBaseY - minBY) / compSize;
                var px0 = cx * wmSize;
                var py0 = cy * wmSize;

                var wmBitmaps = new SkiaSharp.SKBitmap?[weightmaps.Length];
                for (int i = 0; i < weightmaps.Length; i++)
                {
                    var decoded = weightmaps[i]?.Decode();
                    wmBitmaps[i] = decoded?.ToSkBitmap();
                }

                for (int ly = 0; ly < wmSize; ly++)
                for (int lx = 0; lx < wmSize; lx++)
                {
                    float rAcc = 0, gAcc = 0, bAcc = 0, totalWeight = 0;

                    foreach (var alloc in allocations)
                    {
                        var wmIdx = alloc.WeightmapTextureIndex;
                        var ch = alloc.WeightmapTextureChannel;
                        if (wmIdx >= wmBitmaps.Length || wmBitmaps[wmIdx] == null) continue;

                        var wmBmp = wmBitmaps[wmIdx]!;
                        var sx = Math.Min(lx, wmBmp.Width - 1);
                        var sy = Math.Min(ly, wmBmp.Height - 1);
                        var pixel = wmBmp.GetPixel(sx, sy);

                        byte weight = ch switch { 0 => pixel.Red, 1 => pixel.Green, 2 => pixel.Blue, 3 => pixel.Alpha, _ => 0 };
                        if (weight == 0) continue;

                        var layerName = alloc.GetLayerName();
                        if (!layerColors.TryGetValue(layerName, out var col))
                            col = (106, 130, 58);

                        float w = weight / 255f;
                        rAcc += col.r * w;
                        gAcc += col.g * w;
                        bAcc += col.b * w;
                        totalWeight += w;
                    }

                    byte fr = 106, fg = 130, fb = 58;
                    if (totalWeight > 0)
                    {
                        fr = (byte)Math.Clamp(rAcc / totalWeight, 0, 255);
                        fg = (byte)Math.Clamp(gAcc / totalWeight, 0, 255);
                        fb = (byte)Math.Clamp(bAcc / totalWeight, 0, 255);
                    }

                    var outX = px0 + lx;
                    var outY = py0 + ly;
                    if (outX < texW && outY < texH)
                        bmp.SetPixel(outX, outY, new SkiaSharp.SKColor(fr, fg, fb));
                }

                foreach (var wb in wmBitmaps) wb?.Dispose();
            }

            using var img = SkiaSharp.SKImage.FromBitmap(bmp);
            using var data = img.Encode(SkiaSharp.SKEncodedImageFormat.Png, 90);
            using var fs = File.Create(outPath);
            data.SaveTo(fs);
            baked++;
            Log.Information("[{N}] Baked tile_{X}_{Y}.png ({W}x{H})", baked, tileX, tileY, texW, texH);
        }
        catch (Exception ex)
        {
            Log.Debug("Skipped {Path}: {Msg}", pkgPath, ex.Message);
        }
    }

    watch.Stop();
    Log.Information("Baked {Count} terrain textures in {Time}", baked, watch.Elapsed);
}

// ── Export a texture as PNG ──────────────────────────────
static void ExportTexture(DefaultFileProvider provider, string assetPath, string outputDir)
{
    if (string.IsNullOrWhiteSpace(assetPath))
    {
        Log.Error("Usage: texture <asset-path>");
        return;
    }

    var cleanPath = assetPath.Replace(".uasset", "").Replace(".ubulk", "");
    try
    {
        var exports = provider.LoadPackage(cleanPath).GetExports().ToList();
        foreach (var obj in exports)
        {
            if (obj is UTexture2D texture)
            {
                // Try max resolution first, fallback to default
                Log.Information("Texture {Name}: size {W}x{H}",
                    texture.Name, texture.ImportedSize.X, texture.ImportedSize.Y);
                var decoded = texture.Decode(16384); // max mip size
                if (decoded == null) decoded = texture.Decode();
                if (decoded == null)
                {
                    Log.Error("Failed to decode texture {Name}", texture.Name);
                    return;
                }

                var encoded = decoded.Encode(ETextureFormat.Png, false, out var ext);
                if (encoded == null)
                {
                    Log.Error("Failed to encode texture {Name}", texture.Name);
                    return;
                }

                var outPath = Path.Combine(outputDir, $"{texture.Name}.png");
                File.WriteAllBytes(outPath, encoded);
                Log.Information("Exported {Name} ({W}x{H}) → {Path}",
                    texture.Name, decoded.Width, decoded.Height, outPath);
                return;
            }
        }
        Log.Error("No UTexture2D found in {Path}", cleanPath);
    }
    catch (Exception ex)
    {
        Log.Error("Failed: {Msg}", ex.Message);
    }
}

// ── Export scenery meshes (World/Environment + Resource/RawResources) ──
static void ExportScenery(string gameDir, VersionContainer version, ExporterOptions options,
    string outputDir, int parallelism)
{
    var scanProvider = CreateProvider(gameDir, version);
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
    var allTextures = new ConcurrentDictionary<string, byte[]>(); // meshName → PNG bytes

    var queue = new BlockingCollection<string>();
    foreach (var p in sceneryPaths) queue.Add(p);
    queue.CompleteAdding();

    var processed = 0;
    var consumers = Enumerable.Range(0, parallelism).Select(i => Task.Run(() =>
    {
        var myProvider = CreateProvider(gameDir, version);
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
                        _ => {
                            var lods = new Dictionary<int, byte[]>();
                            for (var j = 0; j < meshExporter.MeshLods.Count; j++)
                                lods[j] = meshExporter.MeshLods[j].FileData;
                            return (lods, lod0Size, packagePath);
                        },
                        (_, existing) => {
                            if (existing.lod0Size >= lod0Size) return existing;
                            var lods = new Dictionary<int, byte[]>();
                            for (var j = 0; j < meshExporter.MeshLods.Count; j++)
                                lods[j] = meshExporter.MeshLods[j].FileData;
                            return (lods, lod0Size, packagePath);
                        });

                    // ── Extract diffuse texture ──
                    if (!allTextures.ContainsKey(meshName))
                    {
                        try
                        {
                            var texBytes = ExtractDiffuseTexture(staticMesh, myProvider);
                            if (texBytes != null) allTextures.TryAdd(meshName, texBytes);
                        }
                        catch { /* texture extraction is best-effort */ }
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

    // Write meshes to disk under scenery/
    var sceneryDir = Path.Combine(outputDir, "scenery");
    var exported = 0;
    foreach (var (meshName, (lods, lod0Size, srcPath)) in allMeshes.OrderBy(kv => kv.Key))
    {
        foreach (var (lodIndex, data) in lods)
        {
            var lodDir = Path.Combine(sceneryDir, $"lod{lodIndex}");
            var outPath = Path.Combine(lodDir, $"{meshName}.glb");
            Directory.CreateDirectory(lodDir);
            File.WriteAllBytes(outPath, data);
        }
        exported++;
        if (exported % 50 == 0)
            Log.Information("  Written {N}/{Total}...", exported, allMeshes.Count);
    }

    // Write textures to disk under scenery/textures/
    var texDir = Path.Combine(sceneryDir, "textures");
    Directory.CreateDirectory(texDir);
    var texExported = 0;
    foreach (var (meshName, pngData) in allTextures.OrderBy(kv => kv.Key))
    {
        var outPath = Path.Combine(texDir, $"{meshName}.png");
        File.WriteAllBytes(outPath, pngData);
        texExported++;
    }

    watch.Stop();
    Log.Information("Done: {Count} scenery meshes, {TexCount} textures, {MeshFiles} files in {Time} ({Errors} errors)",
        allMeshes.Count, texExported, exported, watch.Elapsed, errors);
}

// ── Scan Persistent_Level for placed actors with mesh + transform ──
static void ScanActors(DefaultFileProvider provider, string outputDir)
{
    var pkg = provider.LoadPackage("FactoryGame/Content/FactoryGame/Map/GameLevel01/Persistent_Level");
    var exports = pkg.GetExports().ToList();
    Log.Information("Persistent_Level: {Count} exports", exports.Count);

    // 1. Find StaticMeshActors → get RootComponent (which is the StaticMeshComponent)
    var placements = new List<object>();

    // Build index: export name → export object for resolving references
    var exportsByIndex = exports.ToArray();

    // Debug: dump properties of first 3 StaticMeshActors
    var debugCount = 0;
    foreach (var obj in exports)
    {
        if (obj.ExportType != "StaticMeshActor") continue;
        if (debugCount++ < 3)
        {
            Log.Information("=== StaticMeshActor: {Name} ===", obj.Name);
            foreach (var prop in obj.Properties)
                Log.Information("  Actor prop: {Name} = {Type} {Val}", prop.Name, prop.GetType().Name, prop.Tag?.ToString() ?? "");

            var rootRef = obj.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("RootComponent");
            if (rootRef?.ResolvedObject?.Object?.Value is CUE4Parse.UE4.Assets.Exports.Component.USceneComponent sc)
            {
                Log.Information("  RootComp type: {Type}", sc.GetType().Name);
                foreach (var prop in sc.Properties)
                    Log.Information("    Comp prop: {Name} = {Type}", prop.Name, prop.GetType().Name);
                var loc = sc.GetRelativeLocation();
                var rot = sc.GetRelativeRotation();
                var scale = sc.GetRelativeScale3D();
                Log.Information("    RelLoc: ({X},{Y},{Z})", loc.X, loc.Y, loc.Z);
                Log.Information("    RelRot: P={P} Y={Y} R={R}", rot.Pitch, rot.Yaw, rot.Roll);
                Log.Information("    RelScale: ({X},{Y},{Z})", scale.X, scale.Y, scale.Z);
            }
        }

        // Still collect placements for now
        var rootRef2 = obj.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("RootComponent");
        if (rootRef2 == null) continue;
        var rootComp = rootRef2.ResolvedObject?.Object?.Value as UStaticMeshComponent;
        if (rootComp == null) continue;
        var meshRef = rootComp.GetStaticMesh();
        if (meshRef == null) continue;

        var loc2 = rootComp.GetRelativeLocation();
        var rot2 = rootComp.GetRelativeRotation();
        var scale2 = rootComp.GetRelativeScale3D();

        double degToRad = Math.PI / 180.0;
        double sp = Math.Sin(rot2.Pitch * degToRad * 0.5), cp = Math.Cos(rot2.Pitch * degToRad * 0.5);
        double sy = Math.Sin(rot2.Yaw   * degToRad * 0.5), cy = Math.Cos(rot2.Yaw   * degToRad * 0.5);
        double sr = Math.Sin(rot2.Roll   * degToRad * 0.5), cr = Math.Cos(rot2.Roll   * degToRad * 0.5);
        double qx =  cr*sp*sy - sr*cp*cy;
        double qy = -cr*sp*cy - sr*cp*sy;
        double qz =  cr*cp*sy - sr*sp*cy;
        double qw =  cr*cp*cy + sr*sp*sy;

        placements.Add(new
        {
            mesh = meshRef.Name,
            type = "StaticMesh",
            x = Math.Round(loc2.X, 1), y = Math.Round(loc2.Y, 1), z = Math.Round(loc2.Z, 1),
            qx = Math.Round(qx, 6), qy = Math.Round(qy, 6), qz = Math.Round(qz, 6), qw = Math.Round(qw, 6),
            sx = Math.Round(scale2.X, 3), sy = Math.Round(scale2.Y, 3), sz = Math.Round(scale2.Z, 3),
        });
    }

    // 2. BP actors (ResourceNode, Geyser, FrackingSatellite, etc.) — get position from RootComponent
    var bpActorTypes = new HashSet<string> {
        "BP_ResourceNode_C", "BP_ResourceNodeGeyser_C", "BP_FrackingSatellite_C",
        "BP_FrackingCore_C", "BP_ResourceDeposit_C", "BP_Water_C",
    };

    var bpPlacements = new List<object>();
    foreach (var obj in exports)
    {
        var classType = obj.ExportType;
        if (!bpActorTypes.Contains(classType)) continue;

        // Try to get RootComponent → SceneComponent → RelativeLocation
        var rootRef = obj.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("RootComponent");
        if (rootRef == null) continue;
        var rootComp = rootRef.ResolvedObject?.Object?.Value as CUE4Parse.UE4.Assets.Exports.Component.USceneComponent;
        if (rootComp == null) continue;

        var loc = rootComp.GetRelativeLocation();
        var rot = rootComp.GetRelativeRotation();
        var scale = rootComp.GetRelativeScale3D();

        // Try to get the resource type property
        var resourceType = "";
        var descProp = obj.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("mResourceClass");
        if (descProp?.ResolvedObject != null)
            resourceType = descProp.ResolvedObject.Name.Text;

        // Get purity
        var purityName = obj.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FName>("mPurity");
        var purity = purityName.Text ?? "";

        bpPlacements.Add(new
        {
            mesh = classType.Replace("_C", ""),
            type = classType,
            resource = resourceType,
            purity,
            x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
            pitch = Math.Round(rot.Pitch, 2), yaw = Math.Round(rot.Yaw, 2), roll = Math.Round(rot.Roll, 2),
            sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
        });
    }

    // Summary
    Log.Information("StaticMeshComponents: {Count}", placements.Count);
    var smGrouped = placements.Cast<dynamic>().GroupBy(a => (string)a.mesh).OrderByDescending(g => g.Count());
    foreach (var g in smGrouped.Take(20))
        Log.Information("  {Mesh}: {Count}", g.Key, g.Count());

    Log.Information("BP actors: {Count}", bpPlacements.Count);
    var bpGrouped = bpPlacements.Cast<dynamic>().GroupBy(a => (string)a.type).OrderByDescending(g => g.Count());
    foreach (var g in bpGrouped)
        Log.Information("  {Type}: {Count}", g.Key, g.Count());

    // Write combined JSON
    var result = new { staticMeshes = placements, bpActors = bpPlacements };
    var outPath = Path.Combine(outputDir, "scenery_placements.json");
    var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
    File.WriteAllText(outPath, System.Text.Json.JsonSerializer.Serialize(result, jsonOptions));
    Log.Information("Wrote {Count} total placements to {Path}", placements.Count + bpPlacements.Count, outPath);
}

// ── Scan streaming cells for StaticMeshActor/FGCliffActor placements ──
static void ScanHISM(DefaultFileProvider provider, string outputDir)
{
    // Find all _Generated_ streaming cell packages
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

                var rootRef = obj.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("RootComponent");
                if (rootRef == null) continue;
                var rootComp = rootRef.ResolvedObject?.Object?.Value as UStaticMeshComponent;
                if (rootComp == null) continue;

                var meshRef = rootComp.GetStaticMesh();
                if (meshRef == null) continue;

                var loc = rootComp.GetRelativeLocation();
                var rot = rootComp.GetRelativeRotation();
                var scale = rootComp.GetRelativeScale3D();

                // FRotator → FQuat (UE formula)
                double degToRad = Math.PI / 180.0;
                double sp = Math.Sin(rot.Pitch * degToRad * 0.5), cp = Math.Cos(rot.Pitch * degToRad * 0.5);
                double sy = Math.Sin(rot.Yaw   * degToRad * 0.5), cy = Math.Cos(rot.Yaw   * degToRad * 0.5);
                double sr = Math.Sin(rot.Roll   * degToRad * 0.5), cr = Math.Cos(rot.Roll   * degToRad * 0.5);
                double qx =  cr*sp*sy - sr*cp*cy;
                double qy = -cr*sp*cy - sr*cp*sy;
                double qz =  cr*cp*sy - sr*sp*cy;
                double qw =  cr*cp*cy + sr*sp*sy;

                placements.Add(new
                {
                    mesh = meshRef.Name,
                    type = obj.ExportType,
                    x = Math.Round(loc.X, 1), y = Math.Round(loc.Y, 1), z = Math.Round(loc.Z, 1),
                    qx = Math.Round(qx, 6), qy = Math.Round(qy, 6), qz = Math.Round(qz, 6), qw = Math.Round(qw, 6),
                    sx = Math.Round(scale.X, 3), sy = Math.Round(scale.Y, 3), sz = Math.Round(scale.Z, 3),
                });
            }
        }
        catch { }
    }

    // Summary
    var grouped = placements.Cast<dynamic>().GroupBy(a => (string)a.mesh).OrderByDescending(g => g.Count());
    Log.Information("Found {Count} scenery actors in {Scanned} cells", placements.Count, scanned);
    foreach (var g in grouped.Take(30))
        Log.Information("  {Mesh}: {Count}", g.Key, g.Count());

    // Write JSON
    var outPath = Path.Combine(outputDir, "scenery_streaming.json");
    var jsonOptions = new System.Text.Json.JsonSerializerOptions { WriteIndented = false };
    File.WriteAllText(outPath, System.Text.Json.JsonSerializer.Serialize(placements, jsonOptions));
    Log.Information("Wrote {Path}", outPath);
}

static string ExtractClassName(string assetPath)
{
    // Path like: factorygame/content/factorygame/buildable/factory/smeltermk1/mesh/SM_SmelterMk1.uasset
    // We want the building folder name and convert to Build_SmelterMk1_C format
    var parts = assetPath.Replace('\\', '/').Split('/');

    // Find "Buildable" index, then take the class folder
    for (var i = 0; i < parts.Length; i++)
    {
        if (!parts[i].Equals("Buildable", StringComparison.OrdinalIgnoreCase)) continue;
        // Skip category (Factory, Logistics, etc.) and take building name
        if (i + 2 < parts.Length)
        {
            var buildingName = parts[i + 2];
            return $"Build_{buildingName}_C";
        }
    }

    // Fallback: use filename without extension
    return Path.GetFileNameWithoutExtension(assetPath);
}

// ── Extract diffuse texture from a UStaticMesh's first material ──
static byte[]? ExtractDiffuseTexture(UStaticMesh staticMesh, DefaultFileProvider provider)
{
    if (staticMesh.StaticMaterials == null || staticMesh.StaticMaterials.Length == 0)
        return null;

    foreach (var matSlot in staticMesh.StaticMaterials)
    {
        if (matSlot.MaterialInterface == null) continue;
        try
        {
            // Use CMaterialParams — CUE4Parse's built-in texture classifier
            var matObj = matSlot.MaterialInterface.Load<UMaterialInterface>();
            if (matObj == null) continue;

            var matParams = new CMaterialParams();
            matObj.GetParams(matParams);

            // Diffuse is the classified diffuse texture
            if (matParams.Diffuse is UTexture2D diffTex)
            {
                var decoded = diffTex.Decode(512) ?? diffTex.Decode();
                if (decoded != null)
                {
                    var encoded = decoded.Encode(ETextureFormat.Png, false, out _);
                    if (encoded != null) return encoded;
                }
            }
        }
        catch { /* material loading can fail for various reasons */ }
    }

    return null;
}
