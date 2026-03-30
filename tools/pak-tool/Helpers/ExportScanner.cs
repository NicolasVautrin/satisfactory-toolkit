using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using Serilog;

namespace PakTool.Helpers;

public static class ExportScanner
{
    public record ExportMatch(string Package, string ExportName, string ExportClass, string FullPath);

    /// <summary>
    /// Scans all packages, builds "pkg::name::class" strings, filters by regex.
    /// Header-only (ExportMap) when possible — no full deserialization.
    /// </summary>
    public static (List<ExportMatch> matches, int total) Scan(DefaultFileProvider provider, string regexp, int offset, int limit)
    {
        var regex = new Regex(regexp, RegexOptions.IgnoreCase);
        var all = new List<ExportMatch>();

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
                    {
                        var full = $"{cleanPath}::{export.ObjectName.Text}::{export.ClassName}";
                        if (regex.IsMatch(full))
                            all.Add(new(cleanPath, export.ObjectName.Text, export.ClassName, full));
                    }
                }
                else
                {
                    foreach (var obj in package.GetExports())
                    {
                        var full = $"{cleanPath}::{obj.Name}::{obj.ExportType}";
                        if (regex.IsMatch(full))
                            all.Add(new(cleanPath, obj.Name, obj.ExportType, full));
                    }
                }
            }
            catch { }
        }

        Log.Information("Found {Count} matching exports", all.Count);
        return (all.Skip(offset).Take(limit).ToList(), all.Count);
    }
}
