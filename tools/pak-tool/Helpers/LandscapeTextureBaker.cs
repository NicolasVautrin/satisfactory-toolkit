using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse_Conversion.Textures;
using Serilog;

namespace PakTool.Helpers;

/// <summary>
/// Bakes landscape tile textures from weightmap data.
/// Uses typed ULandscapeComponent API from CUE4Parse source.
/// </summary>
public static class LandscapeTextureBaker
{
    public static void BakeTile(ULandscapeComponent comp, Dictionary<string, (byte r, byte g, byte b)> layerColors, string outPath)
    {
        try
        {
            var wmSize = comp.ComponentSizeQuads + 1;

            var allocations = comp.GetWeightmapLayerAllocations();
            var weightmaps = comp.GetWeightmapTextures();

            if (weightmaps.Length == 0 || allocations.Length == 0)
            {
                WriteSolidTile(outPath, wmSize, wmSize, (106, 130, 58));
                return;
            }

            var wmBitmaps = new SkiaSharp.SKBitmap?[weightmaps.Length];
            for (int i = 0; i < weightmaps.Length; i++)
            {
                var decoded = weightmaps[i]?.Decode();
                wmBitmaps[i] = decoded?.ToSKBitmap();
            }

            using var bmp = new SkiaSharp.SKBitmap(wmSize, wmSize);

            for (int ly = 0; ly < wmSize; ly++)
            for (int lx = 0; lx < wmSize; lx++)
            {
                float rAcc = 0, gAcc = 0, bAcc = 0, totalWeight = 0;

                foreach (var alloc in allocations)
                {
                    var wmIdx = alloc.WeightmapTextureIndex;
                    var ch = alloc.WeightmapTextureChannel;
                    if (wmIdx >= wmBitmaps.Length || wmBitmaps[wmIdx] == null) continue;

                    var wmBmp = wmBitmaps[wmIdx]!;
                    var sx = Math.Min(lx, wmBmp.Width - 1);
                    var sy = Math.Min(ly, wmBmp.Height - 1);
                    var pixel = wmBmp.GetPixel(sx, sy);

                    byte weight = ch switch { 0 => pixel.Red, 1 => pixel.Green, 2 => pixel.Blue, 3 => pixel.Alpha, _ => 0 };
                    if (weight == 0) continue;

                    var layerName = alloc.GetLayerName();
                    if (!layerColors.TryGetValue(layerName, out var col))
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