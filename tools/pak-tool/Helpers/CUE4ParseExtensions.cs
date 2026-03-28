using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse_Conversion.Textures;
using SkiaSharp;

namespace PakTool.Helpers;

/// <summary>
/// Extension methods to bridge API differences between CUE4Parse NuGet and the local fork.
/// The fork added convenience methods that don't exist in the NuGet package.
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

    // ── Texture extensions ───────────────────────────────────

    /// <summary>
    /// Encode a decoded texture bitmap to PNG bytes.
    /// Bridges the fork's Encode(ETextureFormat, bool, out ext) API.
    /// </summary>
    public static byte[]? EncodeToPng(this SKBitmap bitmap)
    {
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 90);
        return data?.ToArray();
    }

    /// <summary>
    /// Decode a UTexture2D and return as SKBitmap.
    /// In the NuGet, Decode() already returns SKBitmap (not a wrapper needing ToSkBitmap).
    /// This is a no-op passthrough for compatibility.
    /// </summary>
    public static SKBitmap? DecodeAsBitmap(this UTexture2D texture, int maxSize = 0)
    {
        return maxSize > 0 ? texture.Decode(maxSize) : texture.Decode();
    }
}
