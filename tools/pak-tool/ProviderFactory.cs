using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Versions;

namespace PakTool;

public static class ProviderFactory
{
    public static readonly string GameDir =
        @"C:\Program Files (x86)\Steam\steamapps\common\Satisfactory\FactoryGame\Content\Paks";

    public static readonly string OodleDll =
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "oodle-data-shared.dll");

    public static readonly string ToolkitDir =
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));

    public static readonly VersionContainer Version =
        new(EGame.GAME_UE5_3, ETexturePlatform.DesktopMobile);

    private static bool _oodleInitialized;

    public static void EnsureOodle()
    {
        if (_oodleInitialized) return;
        OodleHelper.Initialize(OodleDll);
        _oodleInitialized = true;
    }

    public static DefaultFileProvider CreateProvider()
    {
        EnsureOodle();
        var p = new DefaultFileProvider(GameDir, SearchOption.TopDirectoryOnly, Version);
        p.Initialize();
        p.SubmitKey(new FGuid(), new FAesKey("0x0000000000000000000000000000000000000000000000000000000000000000"));
        p.PostMount();
        return p;
    }
}
