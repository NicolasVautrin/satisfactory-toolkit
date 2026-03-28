using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
using Serilog;

namespace PakTool.Helpers;

/// <summary>
/// Bakes landscape tile textures from weightmap data.
/// Reads properties via GetOrDefault — no fork-specific types needed.
/// </summary>
public static class LandscapeTextureBaker
{
    public static void BakeTile(UObject component, Dictionary<string, (byte r, byte g, byte b)> layerColors, string outPath)
    {
        try
        {
            var componentSizeQuads = component.GetOrDefault("ComponentSizeQuads", 0);
            if (componentSizeQuads == 0) return;

            var wmSize = componentSizeQuads + 1;

            // Read weightmap textures and layer allocations from properties
            var weightmapTextures = component.GetOrDefault<UTexture2D[]>("WeightmapTextures", []);
            var allocations = ReadWeightmapAllocations(component);

            if (weightmapTextures.Length == 0 || allocations.Length == 0)
            {
                // Write a solid default color tile
                WriteSolidTile(outPath, wmSize, wmSize, (106, 130, 58));
                return;
            }

            // Decode weightmap textures
            var wmBitmaps = new SkiaSharp.SKBitmap?[weightmapTextures.Length];
            for (int i = 0; i < weightmapTextures.Length; i++)
            {
                var decoded = weightmapTextures[i]?.Decode();
                wmBitmaps[i] = decoded;
            }

            using var bmp = new SkiaSharp.SKBitmap(wmSize, wmSize);

            for (int ly = 0; ly < wmSize; ly++)
            for (int lx = 0; lx < wmSize; lx++)
            {
                float rAcc = 0, gAcc = 0, bAcc = 0, totalWeight = 0;

                foreach (var alloc in allocations)
                {
                    if (alloc.wmIndex >= wmBitmaps.Length || wmBitmaps[alloc.wmIndex] == null) continue;

                    var wmBmp = wmBitmaps[alloc.wmIndex]!;
                    var sx = Math.Min(lx, wmBmp.Width - 1);
                    var sy = Math.Min(ly, wmBmp.Height - 1);
                    var pixel = wmBmp.GetPixel(sx, sy);

                    byte weight = alloc.channel switch { 0 => pixel.Red, 1 => pixel.Green, 2 => pixel.Blue, 3 => pixel.Alpha, _ => 0 };
                    if (weight == 0) continue;

                    if (!layerColors.TryGetValue(alloc.layerName, out var col))
                        col = (106, 130, 58);

                    float w = weight / 255f;
                    rAcc += col.r * w;
                    gAcc += col.g * w;
                    bAcc += col.b * w;
                    totalWeight += w;
                }

                byte fr = 106, fg = 130, fb = 58;
                if (totalWeight > 0)
                {
                    fr = (byte)Math.Clamp(rAcc / totalWeight, 0, 255);
                    fg = (byte)Math.Clamp(gAcc / totalWeight, 0, 255);
                    fb = (byte)Math.Clamp(bAcc / totalWeight, 0, 255);
                }

                bmp.SetPixel(lx, ly, new SkiaSharp.SKColor(fr, fg, fb));
            }

            foreach (var wb in wmBitmaps) wb?.Dispose();

            using var img = SkiaSharp.SKImage.FromBitmap(bmp);
            using var data = img.Encode(SkiaSharp.SKEncodedImageFormat.Png, 90);
            using var fs = File.Create(outPath);
            data.SaveTo(fs);
        }
        catch (Exception ex)
        {
            Log.Debug("BakeTile failed: {Msg}", ex.Message);
        }
    }

    private record struct WeightmapAlloc(string layerName, int wmIndex, int channel);

    private static WeightmapAlloc[] ReadWeightmapAllocations(UObject component)
    {
        try
        {
            // Use GetOrDefault to get the array of struct values
            var allocArray = component.GetOrDefault<CUE4Parse.UE4.Assets.Objects.FStructFallback[]>("WeightmapLayerAllocations");
            if (allocArray == null || allocArray.Length == 0) return [];

            var allocs = new List<WeightmapAlloc>();
            foreach (var structVal in allocArray)
            {
                var wmIdx = structVal.GetOrDefault("WeightmapTextureIndex", (byte)0);
                var wmCh = structVal.GetOrDefault("WeightmapTextureChannel", (byte)0);
                var layerInfo = structVal.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("LayerInfo");
                var layerName = layerInfo?.ResolvedObject?.Name.Text ?? "None";
                allocs.Add(new WeightmapAlloc(layerName, wmIdx, wmCh));
            }

            return allocs.ToArray();
        }
        catch
        {
            return [];
        }
    }

    private static void WriteSolidTile(string outPath, int w, int h, (byte r, byte g, byte b) color)
    {
        using var bmp = new SkiaSharp.SKBitmap(w, h);
        var c = new SkiaSharp.SKColor(color.r, color.g, color.b);
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
            bmp.SetPixel(x, y, c);

        using var img = SkiaSharp.SKImage.FromBitmap(bmp);
        using var data = img.Encode(SkiaSharp.SKEncodedImageFormat.Png, 90);
        using var fs = File.Create(outPath);
        data.SaveTo(fs);
    }
}
