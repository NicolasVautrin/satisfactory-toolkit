using System.Numerics;
using CUE4Parse.UE4.Objects.Core.Math;

namespace PakTool.Helpers;

public static class MathHelpers
{
    public static (double qx, double qy, double qz, double qw) EulerToQuat(double pitch, double yaw, double roll)
    {
        const double degToRad = Math.PI / 180.0;
        double sp = Math.Sin(pitch * degToRad * 0.5), cp = Math.Cos(pitch * degToRad * 0.5);
        double sy = Math.Sin(yaw * degToRad * 0.5), cy = Math.Cos(yaw * degToRad * 0.5);
        double sr = Math.Sin(roll * degToRad * 0.5), cr = Math.Cos(roll * degToRad * 0.5);

        return (
            qx:  cr * sp * sy - sr * cp * cy,
            qy: -cr * sp * cy - sr * cp * sy,
            qz:  cr * cp * sy - sr * sp * cy,
            qw:  cr * cp * cy + sr * sp * sy
        );
    }

    public static (double x, double y, double z) QuatRotate(double qx, double qy, double qz, double qw, double vx, double vy, double vz)
    {
        double cx = qy * vz - qz * vy;
        double cy = qz * vx - qx * vz;
        double cz = qx * vy - qy * vx;
        return (
            vx + 2 * (qw * cx + qy * cz - qz * cy),
            vy + 2 * (qw * cy + qz * cx - qx * cz),
            vz + 2 * (qw * cz + qx * cy - qy * cx)
        );
    }

    public static Matrix4x4 UnrealToGltfTransform(FVector loc, FRotator rot, FVector scale)
    {
        // Swap Y/Z + scale cm→m (same convention as Gltf.SwapYZ / PrepareTris)
        var translation = new Vector3(loc.X * 0.01f, loc.Z * 0.01f, loc.Y * 0.01f);
        var scaling = new Vector3(scale.X, scale.Z, scale.Y);

        // Convert FRotator to quaternion, then swap Y/Z components
        var (qx, qy, qz, qw) = EulerToQuat(rot.Pitch, rot.Yaw, rot.Roll);
        var rotation = new Quaternion((float)qx, (float)qz, (float)qy, (float)qw);

        return Matrix4x4.CreateScale(scaling)
             * Matrix4x4.CreateFromQuaternion(rotation)
             * Matrix4x4.CreateTranslation(translation);
    }

    public static string ExtractClassName(string assetPath)
    {
        var fileName = Path.GetFileNameWithoutExtension(assetPath);
        if (fileName.StartsWith("Build_", StringComparison.OrdinalIgnoreCase))
            return fileName + "_C";
        return fileName;
    }
}
