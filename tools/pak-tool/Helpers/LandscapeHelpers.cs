using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
using Serilog;

namespace PakTool.Helpers;

public static class LandscapeHelpers
{
    public static readonly Dictionary<string, (byte r, byte g, byte b)> DefaultLayerColors = new()
    {
        ["Grass_LayerInfo"]           = (106, 130,  58),
        ["Forest_LayerInfo"]          = ( 72, 100,  42),
        ["GrassRed_LayerInfo"]        = (140, 100,  55),
        ["RedJungle_LayerInfo"]       = (120,  70,  45),
        ["PurpleForest_LayerInfo"]    = ( 90,  70,  95),
        ["Cliff_LayerInfo"]           = (130, 120, 105),
        ["CoralRock_LayerInfo"]       = (160, 140, 110),
        ["DesertRock_LayerInfo"]      = (170, 150, 120),
        ["SandRock_LayerInfo"]        = (180, 160, 130),
        ["Sand_LayerInfo"]            = (200, 185, 150),
        ["WetSand_LayerInfo"]         = (170, 155, 125),
        ["SandCracks_LayerInfo"]      = (190, 170, 135),
        ["SandPebbles_LayerInfo"]     = (175, 160, 130),
        ["SandRipples_LayerInfo"]     = (195, 180, 145),
        ["Gravel_WeightLayerInfo"]    = (140, 130, 115),
        ["Soil_LayerInfo"]            = ( 95,  80,  55),
        ["Puddles_LayerInfo"]         = ( 70,  85,  75),
        ["Foliage_Eraser_LayerInfo"]  = (106, 130,  58),
        ["None"]                      = (106, 130,  58),
    };

    public static readonly Dictionary<string, string> TexturePaths = new()
    {
        ["Grass_LayerInfo"]        = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Grass/TX_Grass_01_Alb",
        ["Forest_LayerInfo"]       = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Forest/TX_Forest_01_Alb",
        ["GrassRed_LayerInfo"]     = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/GrassRed/TX_GrassRed_01_Alb",
        ["RedJungle_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/RedJungle/TX_Grass_RedJungle_01_Alb",
        ["Cliff_LayerInfo"]        = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Cliff/Cliff_Detail_Alb",
        ["DesertRock_LayerInfo"]   = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Cliff/Cliff_Macro_Alb_02",
        ["Sand_LayerInfo"]         = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Sand/Sand_02_Albedo",
        ["WetSand_LayerInfo"]      = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Sand/Sand_Dry_02_Alb",
        ["SandRock_LayerInfo"]     = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/SandRock/TX_SandRock_Alb_01",
        ["SandPebbles_LayerInfo"]  = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Pebbels/TX_SandPebbles_01_Alb",
        ["Gravel_WeightLayerInfo"] = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Stones/Gravel_Alb",
        ["Soil_LayerInfo"]         = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Soil/Soil_Alb",
        ["Puddles_LayerInfo"]      = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/Soil/TX_Puddles_01_Alb",
        ["CoralRock_LayerInfo"]    = "FactoryGame/Content/FactoryGame/World/Environment/Landscape/Texture/Tiles/SeaRocks/TX_SeaRocks_01_Alb",
    };

    /// <summary>
    /// Sample average colors from actual layer textures, updating layerColors in-place.
    /// </summary>
    public static void SampleLayerColors(DefaultFileProvider provider,
        Dictionary<string, (byte r, byte g, byte b)> layerColors)
    {
        foreach (var (layer, texPath) in TexturePaths)
        {
            try
            {
                var pkg = provider.LoadPackage(texPath);
                var tex = pkg.GetExports().OfType<UTexture2D>().FirstOrDefault();
                if (tex == null) continue;
                var decoded = tex.Decode();
                if (decoded == null) continue;
                using var bmp = decoded.ToSKBitmap();
                long rSum = 0, gSum = 0, bSum = 0;
                int count = 0;
                for (int y = 0; y < bmp.Height; y += 4)
                for (int x = 0; x < bmp.Width; x += 4)
                {
                    var px = bmp.GetPixel(x, y);
                    rSum += px.Red; gSum += px.Green; bSum += px.Blue;
                    count++;
                }
                if (count > 0)
                {
                    layerColors[layer] = ((byte)(rSum / count), (byte)(gSum / count), (byte)(bSum / count));
                    Log.Information("Layer {Layer}: avg color ({R},{G},{B})", layer, rSum / count, gSum / count, bSum / count);
                }
            }
            catch { }
        }
    }
}
