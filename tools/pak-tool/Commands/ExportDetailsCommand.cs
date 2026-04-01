using CUE4Parse.FileProvider;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PakTool.Helpers;
using Serilog;

namespace PakTool.Commands;

public static class ExportDetailsCommand
{
    public static void Run(DefaultFileProvider provider, string regexp, string? jsonpath, int offset, int limit, bool refresh = false)
    {
        var (matches, total) = ExportScanner.ScanOrLoad(provider, regexp, offset, limit, refresh);

        if (matches.Count == 0)
        {
            Log.Error("No exports matched regexp '{Regexp}'", regexp);
            return;
        }

        Log.Information("Deserializing {Count}/{Total} matched exports...", matches.Count, total);

        // Group by package to avoid loading the same package multiple times
        var byPackage = matches.GroupBy(m => m.Package);
        var exports = new List<object>();

        foreach (var group in byPackage)
        {
            try
            {
                var package = provider.LoadPackage(group.Key);
                var allExports = package.GetExports().ToList();
                var names = group.Select(m => m.ExportName).ToHashSet();

                foreach (var obj in allExports)
                {
                    if (names.Contains(obj.Name))
                        exports.Add(obj);
                }
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to load {Path}: {Msg}", group.Key, ex.Message);
            }
        }

        Log.Information("Serializing {Count} exports...", exports.Count);

        var serializer = JsonSerializer.CreateDefault();
        var root = JArray.FromObject(exports, serializer);

        if (jsonpath != null)
        {
            var tokens = root.SelectTokens(jsonpath).ToList();
            Log.Information("JSONPath matched {Count} tokens", tokens.Count);
            Console.WriteLine(new JArray(tokens).ToString(Formatting.Indented));
        }
        else
        {
            Console.WriteLine(root.ToString(Formatting.Indented));
        }
    }
}
