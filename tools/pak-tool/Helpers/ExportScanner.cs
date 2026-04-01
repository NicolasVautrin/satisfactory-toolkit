using System.Text.Json;
using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using Serilog;

namespace PakTool.Helpers;

public static class ExportScanner
{
    public record ExportMatch(string Package, string ExportName, string ExportClass, string FullPath);

    private static readonly string CachePath = Path.Combine(
        AppContext.BaseDirectory, "..", "..", "..", "exports-index.json");

    /// <summary>
    /// Load from cache or scan all packages, then filter by regex and paginate.
    /// </summary>
    public static (List<ExportMatch> matches, int total) ScanOrLoad(
        DefaultFileProvider? provider, string regexp, int offset, int limit, bool refresh = false)
    {
        var allPaths = LoadOrBuildCache(provider, refresh);
        return Filter(allPaths, regexp, offset, limit);
    }

    /// <summary>
    /// Returns the full list of "pkg::name::class" strings, from cache or fresh scan.
    /// </summary>
    private static List<string> LoadOrBuildCache(DefaultFileProvider? provider, bool refresh)
    {
        var cachePath = Path.GetFullPath(CachePath);

        if (!refresh && File.Exists(cachePath))
        {
            Log.Information("Loading exports index from {Path}", cachePath);
            var json = File.ReadAllText(cachePath);
            var cached = JsonSerializer.Deserialize<List<string>>(json) ?? [];
            Log.Information("Loaded {Count} exports from cache", cached.Count);
            return cached;
        }

        if (provider == null)
            throw new InvalidOperationException("No cache found and no provider supplied — run list-exports first");

        var allPaths = ScanAll(provider);

        Log.Information("Writing {Count} exports to {Path}", allPaths.Count, cachePath);
        File.WriteAllText(cachePath, JsonSerializer.Serialize(allPaths));

        return allPaths;
    }

    /// <summary>
    /// Scan all packages (no filter) and return all "pkg::name::class" strings.
    /// </summary>
    private static List<string> ScanAll(DefaultFileProvider provider)
    {
        var all = new List<string>();

        var packagePaths = provider.Files.Keys
            .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
            .OrderBy(k => k)
            .ToList();

        Log.Information("Scanning {Count} packages...", packagePaths.Count);
        var scanned = 0;

        foreach (var pkgPath in packagePaths)
        {
            scanned++;
            if (scanned % 5000 == 0) Log.Information("  scanned {N}/{Total}...", scanned, packagePaths.Count);

            var cleanPath = pkgPath.Replace(".uasset", "").Replace(".umap", "");
            try
            {
                var package = provider.LoadPackage(cleanPath);

                if (package is Package pkg)
                {
                    foreach (var export in pkg.ExportMap)
                        all.Add($"{cleanPath}::{export.ObjectName.Text}::{export.ClassName}");
                }
                else
                {
                    foreach (var obj in package.GetExports())
                        all.Add($"{cleanPath}::{obj.Name}::{obj.ExportType}");
                }
            }
            catch { }
        }

        Log.Information("Scanned {Count} total exports", all.Count);
        return all;
    }

    /// <summary>
    /// Filter cached paths by regex, parse into ExportMatch, paginate.
    /// </summary>
    private static (List<ExportMatch> matches, int total) Filter(
        List<string> allPaths, string regexp, int offset, int limit)
    {
        var regex = new Regex(regexp, RegexOptions.IgnoreCase);
        var filtered = new List<ExportMatch>();

        foreach (var full in allPaths)
        {
            if (!regex.IsMatch(full)) continue;

            var parts = full.Split("::", 3);
            if (parts.Length == 3)
                filtered.Add(new(parts[0], parts[1], parts[2], full));
        }

        Log.Information("Found {Count} matching exports", filtered.Count);
        return (filtered.Skip(offset).Take(limit).ToList(), filtered.Count);
    }
}
