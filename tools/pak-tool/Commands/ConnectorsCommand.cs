using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using PakTool.Helpers;
using Serilog;

namespace PakTool.Commands;

public static class ConnectorsCommand
{
    private static readonly HashSet<string> ConnectionTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "FGFactoryConnectionComponent",
        "FGPipeConnectionComponent",
        "FGPowerConnectionComponent",
    };

    // EFactoryConnectionDirection
    private static string DirectionToString(int dir) => dir switch
    {
        0 => "input",
        1 => "output",
        2 => "any",
        3 => "snap-only",
        _ => $"unknown({dir})",
    };

    // EPipeConnectionType
    private static string PipeTypeToString(int t) => t switch
    {
        0 => "any",
        1 => "producer",
        2 => "consumer",
        _ => $"unknown({t})",
    };

    public static void Export(string outputDir, int parallelism)
    {
        var scanProvider = ProviderFactory.CreateProvider();

        // Find all Build_* blueprint packages
        var buildPaths = scanProvider.Files.Keys
            .Where(k => k.Contains("/Buildable/", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.EndsWith(".uasset"))
            .Where(k =>
            {
                var fileName = k.Split('/').Last().Replace(".uasset", "");
                return fileName.StartsWith("Build_", StringComparison.OrdinalIgnoreCase);
            })
            .ToList();

        Log.Information("Scanning {Count} Build_* blueprints for connectors with {N} consumers...",
            buildPaths.Count, parallelism);

        var watch = Stopwatch.StartNew();
        var errors = 0;
        var allBuildings = new ConcurrentDictionary<string, List<object>>();

        var queue = new BlockingCollection<string>();
        foreach (var p in buildPaths) queue.Add(p);
        queue.CompleteAdding();

        var processed = 0;
        var consumers = Enumerable.Range(0, parallelism).Select(i => Task.Run(() =>
        {
            var myProvider = ProviderFactory.CreateProvider();

            foreach (var packagePath in queue.GetConsumingEnumerable())
            {
                try
                {
                    var cleanPath = packagePath.Replace(".uasset", "");
                    var exports = myProvider.LoadPackage(cleanPath).GetExports().ToList();

                    var connectors = new List<object>();

                    foreach (var obj in exports)
                    {
                        if (!ConnectionTypes.Contains(obj.ExportType)) continue;

                        var loc = obj.GetOrDefault("RelativeLocation", new FVector(0, 0, 0));
                        var rot = obj.GetOrDefault("RelativeRotation", new FRotator(0, 0, 0));

                        var entry = new Dictionary<string, object>
                        {
                            ["name"] = obj.Name,
                            ["type"] = obj.ExportType,
                            ["x"] = Math.Round(loc.X, 2),
                            ["y"] = Math.Round(loc.Y, 2),
                            ["z"] = Math.Round(loc.Z, 2),
                        };

                        // Add rotation only if non-zero
                        if (Math.Abs(rot.Pitch) > 0.01 || Math.Abs(rot.Yaw) > 0.01 || Math.Abs(rot.Roll) > 0.01)
                        {
                            var (qx, qy, qz, qw) = MathHelpers.EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);
                            entry["qx"] = Math.Round(qx, 6);
                            entry["qy"] = Math.Round(qy, 6);
                            entry["qz"] = Math.Round(qz, 6);
                            entry["qw"] = Math.Round(qw, 6);
                        }

                        // Direction for factory connections
                        if (obj.ExportType == "FGFactoryConnectionComponent")
                        {
                            var dir = obj.GetOrDefault("mDirection", -1);
                            if (dir >= 0) entry["direction"] = DirectionToString(dir);

                            var connectorClearance = obj.GetOrDefault("mConnectorClearance", -1f);
                            if (connectorClearance >= 0) entry["clearance"] = Math.Round(connectorClearance, 1);
                        }

                        // Pipe connection type
                        if (obj.ExportType == "FGPipeConnectionComponent")
                        {
                            var pipeType = obj.GetOrDefault("mPipeConnectionType", -1);
                            if (pipeType >= 0) entry["pipeType"] = PipeTypeToString(pipeType);
                        }

                        // Power: max connections
                        if (obj.ExportType == "FGPowerConnectionComponent")
                        {
                            var maxConns = obj.GetOrDefault("mMaxNumConnectionLinks", -1);
                            if (maxConns >= 0) entry["maxConnections"] = maxConns;
                        }

                        connectors.Add(entry);
                    }

                    if (connectors.Count > 0)
                    {
                        var className = MathHelpers.ExtractClassName(packagePath);
                        allBuildings[className] = connectors;
                    }
                }
                catch (Exception ex)
                {
                    if (Interlocked.Increment(ref errors) <= 10)
                        Log.Warning("Error processing {Path}: {Msg}", packagePath, ex.Message);
                }

                var n = Interlocked.Increment(ref processed);
                if (n % 50 == 0) Log.Information("  Processed {N}/{Total}...", n, buildPaths.Count);
            }
        })).ToArray();

        Task.WaitAll(consumers);

        // Write to JSON file
        var outPath = Path.Combine(outputDir, "connectors.json");
        Directory.CreateDirectory(outputDir);
        var jsonOptions = new JsonSerializerOptions { WriteIndented = true };
        var sorted = allBuildings.OrderBy(kv => kv.Key)
            .ToDictionary(kv => kv.Key, kv => kv.Value);
        File.WriteAllText(outPath, JsonSerializer.Serialize(sorted, jsonOptions));

        watch.Stop();
        Log.Information("Done: {Count} buildings with connectors in {Time} ({Errors} errors)",
            allBuildings.Count, watch.Elapsed, errors);

        JsonOutput.WriteExport("connectors", outputDir, allBuildings.Count, watch.Elapsed.ToString(), errors,
            [new { path = "connectors.json", buildings = allBuildings.Count }]);
    }
}
