using System.Text.Json;
using System.Text.Json.Serialization;

namespace PakTool;

public class JsonEnvelope<T>
{
    [JsonPropertyName("mode")]
    public string Mode { get; set; } = "";

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("offset")]
    public int Offset { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }

    [JsonPropertyName("results")]
    public T[] Results { get; set; } = [];
}

public static class JsonOutput
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static void Write<T>(string mode, T[] results, int total, int offset, int limit)
    {
        var envelope = new JsonEnvelope<T>
        {
            Mode = mode,
            Total = total,
            Offset = offset,
            Limit = limit,
            Results = results,
        };
        Console.WriteLine(JsonSerializer.Serialize(envelope, Options));
    }

    public static void WriteExport(string type, string outputPath, int count, string elapsed, int errors, object[]? files = null)
    {
        var result = new Dictionary<string, object?>
        {
            ["mode"] = "export",
            ["type"] = type,
            ["outputPath"] = outputPath,
            ["count"] = count,
            ["elapsed"] = elapsed,
            ["errors"] = errors,
            ["files"] = files,
        };
        Console.WriteLine(JsonSerializer.Serialize(result, Options));
    }
}
