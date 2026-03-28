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
    ?? Path.Combine(ProviderFactory.ToolkitDir, "data", "meshes");

Log.Information("Output: {OutputDir}", outputDir);

var mode = args.Length > 0 ? args[0] : "help";

switch (mode)
{
    // ── Exploration ──────────────────────────────────────
    case "list-entries":
    {
        var provider = ProviderFactory.CreateProvider();
        Log.Information("Loaded {Count} files from provider", provider.Files.Count);
        var filter = args.Length > 1 && !args[1].StartsWith("-") ? args[1] : ".*";
        var typeFilter = ParseString(args, "--type");
        ListEntriesCommand.Run(provider, filter, typeFilter, offset, limit);
        break;
    }
    case "entry-details":
    {
        var provider = ProviderFactory.CreateProvider();
        Log.Information("Loaded {Count} files from provider", provider.Files.Count);
        var path = args.Length > 1 ? args[1] : "";
        if (string.IsNullOrWhiteSpace(path)) { Log.Error("Usage: entry-details <package-path>"); break; }
        EntryDetailsCommand.Run(provider, path);
        break;
    }

    // ── Export ───────────────────────────────────────────
    case "export":
    {
        var subMode = args.Length > 1 ? args[1] : "help";
        switch (subMode)
        {
            case "buildings":
                ExportCommand.Buildings(outputDir, parallelism);
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
            case "actors":
            {
                var provider = ProviderFactory.CreateProvider();
                Log.Information("Loaded {Count} files from provider", provider.Files.Count);
                ExportCommand.Actors(provider, outputDir);
                break;
            }
            case "streaming":
            {
                var provider = ProviderFactory.CreateProvider();
                Log.Information("Loaded {Count} files from provider", provider.Files.Count);
                ExportCommand.Streaming(provider, outputDir);
                break;
            }
            default:
                Log.Error("Unknown export sub-command: {Sub}. Use: buildings, scenery, landscape, texture, mesh, actors, streaming", subMode);
                break;
        }
        break;
    }

    case "help":
    default:
        Console.Error.WriteLine("""
        Usage: pak-tool <command> [options]

        EXPLORATION (JSON → stdout):
          list-entries <filter>         List package entries matching regex filter
            --type <regex>              Filter by entry type
            --offset N  --limit N       Pagination (default 0, 50)

          entry-details <path>          Detailed info on a package (deserializes)

        EXPORT (files to disk, JSON confirmation → stdout):
          export buildings              Bulk building meshes
          export scenery                Bulk scenery meshes + textures
          export landscape              Bulk terrain tiles + bake + simplify
          export texture <path>         Single texture as PNG
          export mesh <filter>          Meshes matching regex filter
            [--type <regex>]            Filter by entry type
          export actors                 Persistent_Level placements → JSON
          export streaming              Streaming cell placements → JSON

        GLOBAL OPTIONS:
          --offset N                    Pagination offset (default: 0)
          --limit N                     Pagination limit (default: 50)
          --output <dir>                Output directory (default: data/meshes/)
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
