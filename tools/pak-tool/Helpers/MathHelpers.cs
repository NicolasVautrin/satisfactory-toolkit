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

    public static string ExtractClassName(string assetPath)
    {
        var parts = assetPath.Replace('\\', '/').Split('/');
        for (var i = 0; i < parts.Length; i++)
        {
            if (!parts[i].Equals("Buildable", StringComparison.OrdinalIgnoreCase)) continue;
            if (i + 2 < parts.Length)
                return $"Build_{parts[i + 2]}_C";
        }
        return Path.GetFileNameWithoutExtension(assetPath);
    }
}
