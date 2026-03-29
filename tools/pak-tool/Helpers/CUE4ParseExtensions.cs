using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse_Conversion.Textures;
using SkiaSharp;

namespace PakTool.Helpers;

/// <summary>
/// Extension methods to bridge API differences between CUE4Parse versions.
/// The source build returns CTexture from Decode() instead of SKBitmap.
/// </summary>
public static class CUE4ParseExtensions
{
    // ── USceneComponent / UStaticMeshComponent extensions ─────

    public static FVector GetRelativeLocation(this USceneComponent comp)
        => comp.GetOrDefault("RelativeLocation", new FVector(0, 0, 0));

    public static FRotator GetRelativeRotation(this USceneComponent comp)
        => comp.GetOrDefault("RelativeRotation", new FRotator(0, 0, 0));

    public static FVector GetRelativeScale3D(this USceneComponent comp)
        => comp.GetOrDefault("RelativeScale3D", new FVector(1, 1, 1));

    public static FVector GetRelativeLocation(this UStaticMeshComponent comp)
        => comp.GetOrDefault("RelativeLocation", new FVector(0, 0, 0));

    public static FRotator GetRelativeRotation(this UStaticMeshComponent comp)
        => comp.GetOrDefault("RelativeRotation", new FRotator(0, 0, 0));

    public static FVector GetRelativeScale3D(this UStaticMeshComponent comp)
        => comp.GetOrDefault("RelativeScale3D", new FVector(1, 1, 1));

    // ── CTexture → SKBitmap conversion ──────────────────────

    /// <summary>
    /// Convert CTexture to SKBitmap, using the actual pixel format from the decoder.
    /// DXTDecoder outputs PF_R8G8B8A8 (RGBA), AssetRipper outputs PF_B8G8R8A8 (BGRA).
    /// </summary>
    public static SKBitmap ToSKBitmap(this CTexture tex)
    {
        var skColorType = tex.PixelFormat switch
        {
            CUE4Parse.UE4.Assets.Exports.Texture.EPixelFormat.PF_B8G8R8A8 => SKColorType.Bgra8888,
            _ => SKColorType.Rgba8888,
        };
        var bmp = new SKBitmap(tex.Width, tex.Height, skColorType, SKAlphaType.Unpremul);
        var pixelsPtr = bmp.GetPixels();
        System.Runtime.InteropServices.Marshal.Copy(tex.Data, 0, pixelsPtr, tex.Data.Length);
        return bmp;
    }

    /// <summary>
    /// Decode a UTexture2D and return as SKBitmap.
    /// </summary>
    public static SKBitmap? DecodeAsBitmap(this UTexture2D texture, int maxSize = 0)
    {
        var ctex = maxSize > 0 ? texture.Decode(maxSize) : texture.Decode();
        return ctex?.ToSKBitmap();
    }

    // ── Texture extensions ───────────────────────────────────

    public static byte[]? EncodeToPng(this SKBitmap bitmap)
    {
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 90);
        return data?.ToArray();
    }

    public static byte[]? EncodeToPng(this CTexture tex)
    {
        using var bmp = tex.ToSKBitmap();
        return bmp.EncodeToPng();
    }
}