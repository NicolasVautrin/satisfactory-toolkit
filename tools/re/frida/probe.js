// Sonde LECTURE SEULE : journalise ce que le jeu appelle quand le joueur construit.
// N'appelle aucune fonction de construction et ne modifie rien.
// Charge apres ue.js par run.py.
'use strict';

const TARGETS = {
  // AFGBuildable* AFGBuildableSubsystem::BeginSpawnBuildable(TSubclassOf<AFGBuildable> inClass, const FTransform& inTransform)
  beginSpawnBuildable: '?BeginSpawnBuildable@AFGBuildableSubsystem@@QEAAPEAVAFGBuildable@@V?$TSubclassOf@VAFGBuildable@@@@AEBU?$TTransform@N@Math@UE@@@Z',
  // void AFGBuildableSubsystem::AddBuildable(AFGBuildable* buildable)
  addBuildable: '?AddBuildable@AFGBuildableSubsystem@@QEAAXPEAVAFGBuildable@@@Z',
  // virtual AActor* AFGBuildableHologram::Construct(TArray<AActor*>& out_children, FNetConstructionID constructionID)
  // (pas AFGHologram::Construct : son export est un `return nullptr` partage par 2 406 fonctions)
  hologramConstruct: '?Construct@AFGBuildableHologram@@UEAAPEAVAActor@@AEAV?$TArray@PEAVAActor@@V?$TSizedDefaultAllocator@$0CA@@@@@UFNetConstructionID@@@Z',
  // static AFGHologram* AFGHologram::SpawnHologramFromRecipe(TSubclassOf<UFGRecipe>, AActor* owner, const FVector& location, APawn* instigator, const TFunction<void(AFGHologram*)>& preSpawn)
  spawnHologramFromRecipe: '?SpawnHologramFromRecipe@AFGHologram@@SAPEAV1@V?$TSubclassOf@VUFGRecipe@@@@PEAVAActor@@AEBU?$TVector@N@Math@UE@@PEAVAPawn@@AEBV?$TFunction@$$A6AXPEAVAFGHologram@@@Z@@@Z',
  // Pistolet de construction : clic local, puis RPC serveur (en solo le joueur est aussi le serveur)
  internalConstructHologram: '?InternalConstructHologram@UFGBuildGunStateBuild@@QEAAXUFNetConstructionID@@@Z',
  serverConstructHologram: '?Server_ConstructHologram@UFGBuildGunStateBuild@@QEAAXUFNetConstructionID@@UFConstructHologramMessage@@@Z',
  // Message de construction : etat de l'hologramme serialise puis rejoue cote serveur
  serializeConstructMessage: '?SerializeConstructMessage@AFGHologram@@UEAAXAEAVFArchive@@UFNetConstructionID@@@Z',
  serializeConstructMessageBuildable: '?SerializeConstructMessage@AFGBuildableHologram@@MEAAXAEAVFArchive@@UFNetConstructionID@@@Z',
  postDeserialization: '?PostConstructMessageDeserialization@AFGHologram@@UEAAXXZ',
  postDeserializationBelt: '?PostConstructMessageDeserialization@AFGConveyorBeltHologram@@MEAAXXZ',
  // Configuration du batiment cree, appelee par AFGBuildableHologram::ConstructInstance
  configureActor: '?ConfigureActor@AFGBuildableHologram@@MEBAXPEAVAFGBuildable@@@Z',
  configureActorBelt: '?ConfigureActor@AFGConveyorBeltHologram@@MEBAXPEAVAFGBuildable@@@Z',
  configureComponents: '?ConfigureComponents@AFGBuildableHologram@@MEBAXPEAVAFGBuildable@@@Z',
  configureComponentsBelt: '?ConfigureComponents@AFGConveyorBeltHologram@@MEBAXPEAVAFGBuildable@@@Z',
};

function emit(event, fields) {
  send(Object.assign({ event, tid: Process.getCurrentThreadId() }, fields));
}

function round(v) {
  return { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) };
}

// UClass* depuis un TSubclassOf passe par valeur ou par adresse (l'ABI MSVC depend du type)
function subclassArg(arg) {
  return isUObject(arg) ? arg : arg.readPointer();
}

function hook(key, callbacks) {
  try {
    const address = hookableGameExport(TARGETS[key]);
    Interceptor.attach(address, callbacks);
    return { key, address: address.toString() };
  } catch (e) {
    return { key, error: e.message };
  }
}

function logThis(key, label) {
  return hook(key, {
    onEnter(args) {
      emit(label, { self: fullName(args[0]) });
    },
  });
}

function logConfigure(key, label) {
  return hook(key, {
    onEnter(args) {
      emit(label, { hologram: fullName(args[0]), buildable: fullName(args[1]) });
    },
  });
}

function installHooks() {
  return [
    hook('beginSpawnBuildable', {
      onEnter(args) {
        this.cls = fullName(subclassArg(args[1]));
        try {
          this.transform = readTransform(args[2]);
        } catch (e) {
          this.transform = 'illisible: ' + e.message;
        }
      },
      onLeave(retval) {
        emit('BeginSpawnBuildable', { cls: this.cls, transform: this.transform, actor: retval.toString() });
      },
    }),
    hook('addBuildable', {
      onEnter(args) {
        emit('AddBuildable', { buildable: fullName(args[1]) });
      },
    }),
    hook('hologramConstruct', {
      onEnter(args) {
        emit('HologramConstruct', { hologram: fullName(args[0]) });
      },
    }),
    hook('spawnHologramFromRecipe', {
      onEnter(args) {
        this.recipe = fullName(subclassArg(args[0]));
        this.owner = fullName(args[1]);
        try {
          this.location = round(readVec(args[2]));
        } catch (e) {
          this.location = 'illisible: ' + e.message;
        }
      },
      onLeave(retval) {
        emit('SpawnHologramFromRecipe', { recipe: this.recipe, owner: this.owner, location: this.location, hologram: fullName(retval) });
      },
    }),
    logThis('internalConstructHologram', 'BuildGun.InternalConstructHologram'),
    logThis('serverConstructHologram', 'BuildGun.Server_ConstructHologram'),
    logThis('serializeConstructMessage', 'Hologram.SerializeConstructMessage'),
    logThis('serializeConstructMessageBuildable', 'BuildableHologram.SerializeConstructMessage'),
    logThis('postDeserialization', 'Hologram.PostConstructMessageDeserialization'),
    logThis('postDeserializationBelt', 'BeltHologram.PostConstructMessageDeserialization'),
    logConfigure('configureActor', 'BuildableHologram.ConfigureActor'),
    logConfigure('configureActorBelt', 'BeltHologram.ConfigureActor'),
    logConfigure('configureComponents', 'BuildableHologram.ConfigureComponents'),
    logConfigure('configureComponentsBelt', 'BeltHologram.ConfigureComponents'),
  ];
}

Object.assign(rpc.exports, {
  info() {
    return Object.values(MOD).map((name) => {
      const m = Process.findModuleByName(name);
      return { name, base: m ? m.base.toString() : null, size: m ? m.size : 0 };
    });
  },
  start() {
    return installHooks();
  },
});
