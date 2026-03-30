using CUE4Parse.FileProvider;
using PakTool.Helpers;

namespace PakTool.Commands;

public static class ListExportsCommand
{
    public static void Run(DefaultFileProvider provider, string regexp, int offset, int limit)
    {
        var (matches, total) = ExportScanner.Scan(provider, regexp, offset, limit);
        var paths = matches.Select(m => m.FullPath).ToArray();
        JsonOutput.Write("list-exports", paths, total, offset, limit);
    }
}
