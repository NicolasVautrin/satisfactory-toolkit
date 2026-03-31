using PakTool;
using PakTool.Commands;
using Serilog;
using Serilog.Sinks.SystemConsole.Themes;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console(theme: AnsiConsoleTheme.Literate,
        standardErrorFromLevel: Serilog.Events.LogEventLevel.Verbose)
    .CreateLogger();

// ── Parse global options ─────────────────────────────────
var parallelism = ParseInt(args, "-p") ?? Environment.ProcessorCount;
var offset = ParseInt(args, "--offset") ?? 0;
var limit = ParseInt(args, "--limit") ?? 50;
var outputDir = ParseString(args, "--output")
    ?? Path.Combine(ProviderFactory.ToolkitDir, "data", "viewer-assets");
var gameDir = ParseString(args, "--game-dir");
if (gameDir != null) ProviderFactory.GameDirOverride = gameDir;

Log.Information("Output: {OutputDir}", outputDir);
Log.Information("Game: {GameDir}", ProviderFactory.GameDir);

var mode = args.Length > 0 ? args[0] : "help";

switch (mode)
{
    // ── Exploration ──────────────────────────────────────
    case "list-exports":
    {
        var provider = ProviderFactory.CreateProvider();
        Log.Information("Loaded {Count} files from provider", provider.Files.Count);
        var regexp = ParseString(args, "--regexp") ?? ".*";
        ListExportsCommand.Run(provider, regexp, offset, limit);
        break;
    }
    case "export-details":
    {
        var provider = ProviderFactory.CreateProvider();
        Log.Information("Loaded {Count} files from provider", provider.Files.Count);
        var regexp = ParseString(args, "--regexp") ?? "";
        if (string.IsNullOrWhiteSpace(regexp)) { Log.Error("Usage: export-details --regexp <filter> [--jsonpath <path>] [--offset N] [--limit N]"); break; }
        var jsonpath = ParseString(args, "--jsonpath");
        ExportDetailsCommand.Run(provider, regexp, jsonpath, offset, limit);
        break;
    }

    // ── Export ───────────────────────────────────────────
    case "export":
    {
        var subMode = args.Length > 1 ? args[1] : "help";
        switch (subMode)
        {
            case "catalog":
                ExportCommand.Catalog(outputDir, parallelism);
                break;
            case "scenery":
                ExportCommand.Scenery(outputDir, parallelism);
                break;
            case "landscape":
            {
                var ratio = ParseString(args, "--ratio") ?? "0.15";
                ExportCommand.Landscape(outputDir, parallelism, ratio);
                break;
            }
            case "texture":
            {
                var provider = ProviderFactory.CreateProvider();
                var texPath = args.Length > 2 ? args[2] : "";
                if (string.IsNullOrWhiteSpace(texPath)) { Log.Error("Usage: export texture <asset-path>"); break; }
                ExportCommand.Texture(provider, texPath, outputDir);
                break;
            }
            case "mesh":
            {
                var provider = ProviderFactory.CreateProvider();
                Log.Information("Loaded {Count} files from provider", provider.Files.Count);
                var filter = args.Length > 2 && !args[2].StartsWith("-") ? args[2] : ".*";
                var typeFilter = ParseString(args, "--type");
                ExportCommand.Mesh(provider, filter, typeFilter, outputDir);
                break;
            }
            case "water":
                ExportCommand.Water(outputDir, parallelism);
                break;
            case "connectors":
                ConnectorsCommand.Export(outputDir, parallelism);
                break;
            default:
                Log.Error("Unknown export sub-command: {Sub}. Use: catalog, scenery, landscape, texture, mesh, water, connectors", subMode);
                break;
        }
        break;
    }

    case "help":
    default:
        Console.Error.WriteLine("""
        Usage: pak-tool <command> [options]

        EXPLORATION (JSON → stdout):
          list-exports                  List exports matching regex on pkg::name::class
            --regexp <regex>            Filter (default: .*)
            --offset N  --limit N       Pagination (default 0, 50)

          export-details                Deep dump of matched exports (Newtonsoft JSON)
            --regexp <regex>            Filter on pkg::name::class (required)
            --jsonpath <path>           JSONPath filter on output
            --offset N  --limit N       Pagination (default 0, 50)

        EXPORT (files to disk, JSON confirmation → stdout):
          export catalog                Bulk building meshes → catalog/lod0..lod5/
          export scenery                Bulk scenery meshes + textures + layout → scenery/
          export landscape              Bulk terrain tiles + bake + simplify → landscape/
          export water                  Water meshes + layout → water/
          export texture <path>         Single texture as PNG
          export mesh <filter>          Meshes matching regex filter
            [--type <regex>]            Filter by entry type
          export connectors             All building port offsets → JSON

        GLOBAL OPTIONS:
          --offset N                    Pagination offset (default: 0)
          --limit N                     Pagination limit (default: 50)
          --output <dir>                Output directory (default: data/viewer-assets/)
          --game-dir <dir>              Satisfactory Paks directory (default: Steam install)
          -p N                          Parallelism for bulk exports (default: CPU count)
        """);
        break;
}

// ── Argument helpers ─────────────────────────────────────
static int? ParseInt(string[] args, string name)
{
    for (int i = 0; i < args.Length - 1; i++)
        if (args[i] == name && int.TryParse(args[i + 1], out var v)) return v;
    return null;
}

static string? ParseString(string[] args, string name)
{
    for (int i = 0; i < args.Length - 1; i++)
        if (args[i] == name) return args[i + 1];
    return null;
}
