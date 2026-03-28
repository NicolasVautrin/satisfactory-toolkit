using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.FileProvider;
using CUE4Parse_Conversion.Textures;
namespace PakTool.Helpers;

public static class TextureHelpers
{
    public static byte[]? ExtractDiffuseTexture(UStaticMesh staticMesh, DefaultFileProvider provider)
    {
        if (staticMesh.StaticMaterials == null || staticMesh.StaticMaterials.Length == 0)
            return null;

        foreach (var matSlot in staticMesh.StaticMaterials)
        {
            if (matSlot.MaterialInterface == null) continue;
            try
            {
                var matObj = matSlot.MaterialInterface.Load<UMaterialInterface>();
                if (matObj == null) continue;

                var matParams = new CMaterialParams();
                matObj.GetParams(matParams);

                if (matParams.Diffuse is UTexture2D diffTex)
                {
                    var decoded = diffTex.Decode(512) ?? diffTex.Decode();
                    if (decoded != null)
                    {
                        var encoded = decoded.EncodeToPng();
                        if (encoded != null) return encoded;
                    }
                }
            }
            catch { /* material loading can fail for various reasons */ }
        }

        return null;
    }
}
