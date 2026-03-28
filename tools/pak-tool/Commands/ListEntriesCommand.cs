using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using Serilog;

namespace PakTool.Commands;

public static class ListEntriesCommand
{
    public static void Run(DefaultFileProvider provider, string filter, string? typeFilter, int offset, int limit)
    {
        var pathRegex = new Regex(filter, RegexOptions.IgnoreCase);
        Regex? typeRegex = typeFilter != null ? new Regex(typeFilter, RegexOptions.IgnoreCase) : null;

        // 1. Filter paths by regex (instant, ~50k keys)
        var matchingPaths = provider.Files.Keys
            .Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap"))
            .Where(k => pathRegex.IsMatch(k))
            .OrderBy(k => k)
            .ToList();

        Log.Information("Path filter matched {Count} packages", matchingPaths.Count);

        // 2. Load each package and read entries from ExportMap (header-only for Package/IoPackage)
        var allResults = new List<PackageEntries>();
        var errors = 0;

        foreach (var pkgPath in matchingPaths)
        {
            try
            {
                var cleanPath = pkgPath.Replace(".uasset", "").Replace(".umap", "");
                var package = provider.LoadPackage(cleanPath);

                var entries = ReadEntries(package, typeRegex);
                if (entries.Length > 0)
                    allResults.Add(new PackageEntries { Package = cleanPath, Entries = entries });
            }
            catch (Exception ex)
            {
                errors++;
                if (errors <= 3)
                    Log.Debug("Failed to load {Path}: {Msg}", pkgPath, ex.Message);
            }
        }

        if (errors > 0)
            Log.Information("{Errors} packages failed to load", errors);

        // 3. Paginate
        var total = allResults.Count;
        var page = allResults.Skip(offset).Take(limit).ToArray();

        JsonOutput.Write("list-entries", page, total, offset, limit);
    }

    private static EntryInfo[] ReadEntries(IPackage package, Regex? typeRegex)
    {
        var entries = new List<EntryInfo>();

        // Try to read ExportMap without full deserialization
        if (package is Package pkg)
        {
            foreach (var export in pkg.ExportMap)
            {
                var className = export.ClassName;
                if (typeRegex != null && !typeRegex.IsMatch(className)) continue;
                entries.Add(new EntryInfo { Name = export.ObjectName.Text, Class = className });
            }
        }
        else
        {
            // Fallback: use GetExports() (triggers deserialization)
            foreach (var obj in package.GetExports())
            {
                var className = obj.ExportType;
                if (typeRegex != null && !typeRegex.IsMatch(className)) continue;
                entries.Add(new EntryInfo { Name = obj.Name, Class = className });
            }
        }

        return entries.ToArray();
    }

    private class PackageEntries
    {
        public string Package { get; set; } = "";
        public EntryInfo[] Entries { get; set; } = [];
    }

    private class EntryInfo
    {
        public string Name { get; set; } = "";
        public string Class { get; set; } = "";
    }
}
