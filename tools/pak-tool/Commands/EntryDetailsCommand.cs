using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.UEFormat.Enums;
using Serilog;

namespace PakTool.Commands;

public static class EntryDetailsCommand
{
    public static void Run(DefaultFileProvider provider, string packagePath)
    {
        var cleanPath = packagePath.Replace(".uasset", "").Replace(".umap", "");

        try
        {
            var package = provider.LoadPackage(cleanPath);
            var exports = package.GetExports().ToList();

            var entries = new List<object>();
            foreach (var obj in exports)
            {
                var entry = new Dictionary<string, object?>
                {
                    ["name"] = obj.Name,
                    ["class"] = obj.ExportType,
                };

                if (obj is UStaticMesh staticMesh)
                {
                    var meshInfo = GetMeshDetails(staticMesh);
                    if (meshInfo != null)
                        entry["mesh"] = meshInfo;
                }
                else if (obj is UTexture2D texture)
                {
                    entry["texture"] = GetTextureDetails(texture);
                }

                entries.Add(entry);
            }

            var result = new[]
            {
                new Dictionary<string, object?>
                {
                    ["package"] = cleanPath,
                    ["entries"] = entries,
                }
            };

            JsonOutput.Write("entry-details", result, 1, 0, 1);
        }
        catch (Exception ex)
        {
            Log.Error("Failed to load package {Path}: {Msg}", cleanPath, ex.Message);
        }
    }

    private static object? GetMeshDetails(UStaticMesh staticMesh)
    {
        try
        {
            var options = new ExporterOptions
            {
                LodFormat = ELodFormat.AllLods,
                MeshFormat = EMeshFormat.Gltf2,
                MaterialFormat = EMaterialFormat.FirstLayer,
                CompressionFormat = EFileCompressionFormat.None,
                ExportMorphTargets = false,
                ExportMaterials = false,
            };

            var meshExporter = new MeshExporter(staticMesh, options);
            var lods = new List<object>();
            for (int i = 0; i < meshExporter.MeshLods.Count; i++)
            {
                lods.Add(new
                {
                    index = i,
                    sizeKB = meshExporter.MeshLods[i].FileData.Length / 1024,
                });
            }

            return new
            {
                lodCount = meshExporter.MeshLods.Count,
                lods,
                materialCount = staticMesh.StaticMaterials?.Length ?? 0,
            };
        }
        catch (Exception ex)
        {
            Log.Debug("Failed to get mesh details for {Name}: {Msg}", staticMesh.Name, ex.Message);
            return null;
        }
    }

    private static object GetTextureDetails(UTexture2D texture)
    {
        return new
        {
            width = texture.ImportedSize.X,
            height = texture.ImportedSize.Y,
            format = texture.Format.ToString(),
        };
    }
}
