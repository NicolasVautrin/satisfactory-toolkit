using System.Runtime.InteropServices;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse_Conversion.Textures;
using g3;
using Serilog;

namespace PakTool.Helpers;

/// <summary>
/// Converts ULandscapeComponent heightmap data to GLB mesh bytes.
/// Self-contained — reads properties via GetOrDefault, no dependency on fork-specific types.
/// </summary>
public static class LandscapeConverter
{
    public static byte[]? ConvertToGlb(UObject landscapeComponent, double simplifyRatio = 1.0)
    {
        try
        {
            // Read properties via GetOrDefault (works with NuGet CUE4Parse)
            var sectionBaseX = landscapeComponent.GetOrDefault("SectionBaseX", 0);
            var sectionBaseY = landscapeComponent.GetOrDefault("SectionBaseY", 0);
            var componentSizeQuads = landscapeComponent.GetOrDefault("ComponentSizeQuads", 0);
            var subsectionSizeQuads = landscapeComponent.GetOrDefault("SubsectionSizeQuads", 0);
            var numSubsections = landscapeComponent.GetOrDefault("NumSubsections", 1);
            var heightmapScaleBias = landscapeComponent.GetOrDefault("HeightmapScaleBias", new FVector4(0, 0, 0, 0));

            if (componentSizeQuads == 0) return null;

            // Get heightmap texture
            var heightmapTex = landscapeComponent.GetOrDefault<UTexture2D>("HeightmapTexture");
            if (heightmapTex == null) return null;

            // Read heightmap pixel data
            var heights = ReadHeightmap(heightmapTex, heightmapScaleBias, componentSizeQuads,
                subsectionSizeQuads, numSubsections);
            if (heights == null) return null;

            var vertsPerSide = componentSizeQuads + 1;

            // Get component relative location for world positioning
            var relLoc = GetRelativeLocation(landscapeComponent);

            // Build vertex positions
            var vertices = new List<float>();
            for (int y = 0; y < vertsPerSide; y++)
            for (int x = 0; x < vertsPerSide; x++)
            {
                float px = x + relLoc.X;
                float py = y + relLoc.Y;
                float pz = heights[y * vertsPerSide + x] + relLoc.Z;

                // UE coords: X=forward, Y=right, Z=up
                // glTF coords: X=right, Y=up, Z=backward
                vertices.Add(px);       // glTF X
                vertices.Add(pz);       // glTF Y (up)
                vertices.Add(-py);      // glTF Z (negate for handedness)
            }

            // Build triangle indices (grid)
            var indices = new List<int>();
            for (int y = 0; y < componentSizeQuads; y++)
            for (int x = 0; x < componentSizeQuads; x++)
            {
                int v0 = y * vertsPerSide + x;
                int v1 = (y + 1) * vertsPerSide + x;
                int v2 = (y + 1) * vertsPerSide + (x + 1);
                int v3 = y * vertsPerSide + (x + 1);

                // Two triangles per quad
                indices.Add(v0); indices.Add(v2); indices.Add(v1);
                indices.Add(v0); indices.Add(v3); indices.Add(v2);
            }

            // Simplify if requested
            if (simplifyRatio < 1.0)
                SimplifyMesh(vertices, indices, simplifyRatio);

            // Write minimal GLB
            return WriteGlb(vertices, indices);
        }
        catch (Exception ex)
        {
            Log.Debug("LandscapeConverter failed: {Msg}", ex.Message);
            return null;
        }
    }

    /// <summary>
    /// Read heightmap heights from BGRA texture.
    /// Height is encoded as uint16 in R (high byte) and G (low byte).
    /// </summary>
    private static float[]? ReadHeightmap(UTexture2D heightmapTex, FVector4 scaleBias,
        int componentSizeQuads, int subsectionSizeQuads, int numSubsections)
    {
        var decoded = heightmapTex.Decode();
        if (decoded == null) return null;

        using var bmp = decoded;
        var vertsPerSide = componentSizeQuads + 1;
        var subsectionSizeVerts = subsectionSizeQuads + 1;
        var heights = new float[vertsPerSide * vertsPerSide];

        int hmOffsetX = (int)(bmp.Width * scaleBias.Z);
        int hmOffsetY = (int)(bmp.Height * scaleBias.W);

        const float LANDSCAPE_ZSCALE = 1.0f / 128.0f;
        const float MID_VALUE = 32768f;

        for (int y = 0; y < vertsPerSide; y++)
        for (int x = 0; x < vertsPerSide; x++)
        {
            // Convert component XY to texel XY (accounting for subsections)
            ComponentXYToTexelXY(x, y, subsectionSizeVerts, numSubsections,
                out var texelX, out var texelY);

            var px = Math.Clamp(texelX + hmOffsetX, 0, bmp.Width - 1);
            var py = Math.Clamp(texelY + hmOffsetY, 0, bmp.Height - 1);
            var pixel = bmp.GetPixel(px, py);

            // Height is uint16: R=high byte, G=low byte
            ushort rawHeight = (ushort)((pixel.Red << 8) | pixel.Green);
            heights[y * vertsPerSide + x] = (rawHeight - MID_VALUE) * LANDSCAPE_ZSCALE;
        }

        return heights;
    }

    private static void ComponentXYToTexelXY(int compX, int compY, int subsectionSizeVerts,
        int numSubsections, out int texelX, out int texelY)
    {
        // Convert component vertex coord to texel coord, accounting for subsection layout
        int subNumX = (compX - 1) / (subsectionSizeVerts - 1);
        int subNumY = (compY - 1) / (subsectionSizeVerts - 1);
        int subX = (compX - 1) % (subsectionSizeVerts - 1) + 1;
        int subY = (compY - 1) % (subsectionSizeVerts - 1) + 1;

        if (subNumX < 0) { subNumX = 0; subX = 0; }
        if (subNumY < 0) { subNumY = 0; subY = 0; }

        texelX = subNumX * subsectionSizeVerts + subX;
        texelY = subNumY * subsectionSizeVerts + subY;
    }

    private static FVector GetRelativeLocation(UObject component)
    {
        // Try to read RelativeLocation from the component's properties
        try
        {
            var loc = component.GetOrDefault<FVector>("RelativeLocation");
            return loc;
        }
        catch
        {
            return new FVector(0, 0, 0);
        }
    }

    /// <summary>
    /// Simplify mesh in-place using geometry3Sharp QEM Reducer.
    /// Replaces vertices and indices lists with simplified data.
    /// </summary>
    private static void SimplifyMesh(List<float> vertices, List<int> indices, double ratio)
    {
        var dmesh = new DMesh3();

        // Add vertices
        for (int i = 0; i < vertices.Count; i += 3)
            dmesh.AppendVertex(new Vector3d(vertices[i], vertices[i + 1], vertices[i + 2]));

        // Add triangles
        for (int i = 0; i < indices.Count; i += 3)
            dmesh.AppendTriangle(indices[i], indices[i + 1], indices[i + 2]);

        var origTriCount = dmesh.TriangleCount;
        var targetTriCount = Math.Max(4, (int)(origTriCount * ratio));

        var reducer = new Reducer(dmesh);
        reducer.ReduceToTriangleCount(targetTriCount);
        dmesh.CompactInPlace();

        // Replace vertices and indices
        vertices.Clear();
        foreach (var vid in dmesh.VertexIndices())
        {
            var v = dmesh.GetVertex(vid);
            vertices.Add((float)v.x);
            vertices.Add((float)v.y);
            vertices.Add((float)v.z);
        }

        indices.Clear();
        foreach (var tid in dmesh.TriangleIndices())
        {
            var tri = dmesh.GetTriangle(tid);
            indices.Add(tri.a);
            indices.Add(tri.b);
            indices.Add(tri.c);
        }

        Log.Debug("Simplified {Orig} → {New} triangles ({Ratio:P0})",
            origTriCount, dmesh.TriangleCount, (double)dmesh.TriangleCount / origTriCount);
    }

    /// <summary>
    /// Write a minimal GLB (glTF 2.0 binary) from raw vertices and indices.
    /// </summary>
    private static byte[] WriteGlb(List<float> vertices, List<int> indices)
    {
        // Compute bounding box
        float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
        float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;
        for (int i = 0; i < vertices.Count; i += 3)
        {
            minX = Math.Min(minX, vertices[i]);     maxX = Math.Max(maxX, vertices[i]);
            minY = Math.Min(minY, vertices[i + 1]); maxY = Math.Max(maxY, vertices[i + 1]);
            minZ = Math.Min(minZ, vertices[i + 2]); maxZ = Math.Max(maxZ, vertices[i + 2]);
        }

        var vertBytes = MemoryMarshal.AsBytes(CollectionsMarshal.AsSpan(vertices)).ToArray();
        var idxBytes = MemoryMarshal.AsBytes(CollectionsMarshal.AsSpan(indices)).ToArray();

        int vertCount = vertices.Count / 3;
        int idxCount = indices.Count;
        int bufferLength = vertBytes.Length + idxBytes.Length;

        // Pad to 4-byte alignment
        int vertPad = (4 - vertBytes.Length % 4) % 4;
        int idxPad = (4 - idxBytes.Length % 4) % 4;
        int paddedBufferLength = vertBytes.Length + vertPad + idxBytes.Length + idxPad;

        var json = System.Text.Json.JsonSerializer.Serialize(new
        {
            asset = new { version = "2.0", generator = "PakTool" },
            scene = 0,
            scenes = new[] { new { nodes = new[] { 0 } } },
            nodes = new[] { new { mesh = 0 } },
            meshes = new[] { new { primitives = new[] { new { attributes = new { POSITION = 0 }, indices = 1, mode = 4 } } } },
            accessors = new object[]
            {
                new { bufferView = 0, componentType = 5126, count = vertCount, type = "VEC3",
                    min = new[] { minX, minY, minZ }, max = new[] { maxX, maxY, maxZ } },
                new { bufferView = 1, componentType = 5125, count = idxCount, type = "SCALAR",
                    min = new[] { 0 }, max = new[] { vertCount - 1 } },
            },
            bufferViews = new object[]
            {
                new { buffer = 0, byteOffset = 0, byteLength = vertBytes.Length, target = 34962 },
                new { buffer = 0, byteOffset = vertBytes.Length + vertPad, byteLength = idxBytes.Length, target = 34963 },
            },
            buffers = new[] { new { byteLength = paddedBufferLength } },
        });

        var jsonBytes = System.Text.Encoding.UTF8.GetBytes(json);
        int jsonPad = (4 - jsonBytes.Length % 4) % 4;
        int jsonChunkLength = jsonBytes.Length + jsonPad;
        int binChunkLength = paddedBufferLength;

        // GLB: header (12) + JSON chunk (8 + data) + BIN chunk (8 + data)
        int totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

        using var ms = new MemoryStream(totalLength);
        using var bw = new BinaryWriter(ms);

        // GLB header
        bw.Write(0x46546C67u); // magic "glTF"
        bw.Write(2u);           // version
        bw.Write((uint)totalLength);

        // JSON chunk
        bw.Write((uint)jsonChunkLength);
        bw.Write(0x4E4F534Au); // "JSON"
        bw.Write(jsonBytes);
        for (int i = 0; i < jsonPad; i++) bw.Write((byte)0x20); // pad with spaces

        // BIN chunk
        bw.Write((uint)binChunkLength);
        bw.Write(0x004E4942u); // "BIN\0"
        bw.Write(vertBytes);
        for (int i = 0; i < vertPad; i++) bw.Write((byte)0);
        bw.Write(idxBytes);
        for (int i = 0; i < idxPad; i++) bw.Write((byte)0);

        return ms.ToArray();
    }
}
