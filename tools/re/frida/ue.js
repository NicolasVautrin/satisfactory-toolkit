// Helpers Unreal Engine pour les agents Frida (Satisfactory 1.2, build modulaire UE 5.6).
// Les fonctions moteur utilisees ici sont EXPORTEES par Core / CoreUObject : pas besoin de PDB.
'use strict';

const MOD = {
  game: 'FactoryGameSteam-FactoryGame-Win64-Shipping.dll',
  core: 'FactoryGameSteam-Core-Win64-Shipping.dll',
  coreUObject: 'FactoryGameSteam-CoreUObject-Win64-Shipping.dll',
  engine: 'FactoryGameSteam-Engine-Win64-Shipping.dll',
};

function exportOf(moduleName, mangled) {
  return Process.getModuleByName(moduleName).getExportByName(mangled);
}

// void UObjectBaseUtility::GetFullName(const UObject* StopOuter, FString& Result, EObjectFullNameFlags Flags) const
const fnGetFullName = new NativeFunction(
  exportOf(MOD.coreUObject, '?GetFullName@UObjectBaseUtility@@QEBAXPEBVUObject@@AEAVFString@@W4EObjectFullNameFlags@@@Z'),
  'void', ['pointer', 'pointer', 'pointer', 'int']);

// static void FMemory::Free(void*)
const fnFree = new NativeFunction(exportOf(MOD.core, '?Free@FMemory@@SAXPEAX@Z'), 'void', ['pointer']);

// FString = TArray<TCHAR> : { TCHAR* Data; int32 ArrayNum; int32 ArrayMax } (ArrayNum inclut le \0)
function newFString() {
  const buf = Memory.alloc(16);
  buf.writePointer(NULL);
  buf.add(8).writeU64(0);
  return buf;
}

function readFString(fstr) {
  const data = fstr.readPointer();
  const num = fstr.add(8).readS32();
  if (data.isNull() || num <= 1) return '';
  return data.readUtf16String(num - 1);
}

// FUtf8String : meme disposition que FString, caracteres UTF-8
function readUtf8FString(fstr) {
  const data = fstr.readPointer();
  const num = fstr.add(8).readS32();
  if (data.isNull() || num <= 1) return '';
  return data.readUtf8String(num - 1);
}

function freeFString(fstr) {
  const data = fstr.readPointer();
  if (!data.isNull()) fnFree(data);
}

// Garde-fou avant tout appel natif : un UObject commence par une vtable situee dans un module charge.
// Un faux pointeur passe a GetFullName planterait le jeu ; une lecture JS fautive leve juste une exception.
// ModuleMap : index des modules construit une fois (Process.findModuleByAddress reparcourt la liste a chaque
// appel : ~0,6 ms, soit 400 ms de jeu fige pour verifier 300 acteurs).
const loadedModules = new ModuleMap();

function isUObject(p) {
  try {
    if (p.isNull()) return false;
    const vtable = p.readPointer();
    return loadedModules.has(vtable) && loadedModules.has(vtable.readPointer());
  } catch (e) {
    return false;
  }
}

// "Classe Chemin.Complet" d'un UObject (ex: "BlueprintGeneratedClass /Game/.../Build_ConstructorMk1.Build_ConstructorMk1_C")
function fullName(obj) {
  if (obj.isNull()) return '<null>';
  if (!isUObject(obj)) return '<pas un UObject ' + obj + '>';
  const s = newFString();
  fnGetFullName(obj, NULL, s, 0);
  const out = readFString(s);
  freeFString(s);
  return out;
}

// FTransform UE5 (double, registres vectoriels alignes) : Rotation @0x00, Translation @0x20, Scale3D @0x40
function readTransform(p) {
  const d = (off) => p.add(off).readDouble();
  return {
    rotation: { x: d(0x00), y: d(0x08), z: d(0x10), w: d(0x18) },
    translation: { x: d(0x20), y: d(0x28), z: d(0x30) },
    scale: { x: d(0x40), y: d(0x48), z: d(0x50) },
  };
}

// Resolution RUNTIME par nom decore exporte — jamais d'adresse en dur (meme regle que tacticus-tools).
// Le nom decore porte la signature : si elle change a une mise a jour, getExportByName leve
// et on refuse de s'attacher au lieu de viser du code aleatoire.
// Ghidra / PDB servent a LIRE le code (decompilation, layouts), pas a resoudre les hooks.
function gameExport(mangled) {
  return exportOf(MOD.game, mangled);
}

// Le linker MSVC fusionne les corps identiques (/OPT:ICF) : ~14 800 des ~50 800 exports de FactoryGame
// partagent leur adresse. Ex. AFGHologram::Construct = un `return nullptr` de 3 octets commun a 2 406
// fonctions. APPELER une fonction fusionnee est correct (meme code) ; la HOOKER intercepte toutes les autres.
let exportAddressCounts = null;

function sharedExportCount(address) {
  if (exportAddressCounts === null) {
    exportAddressCounts = new Map();
    for (const e of Process.getModuleByName(MOD.game).enumerateExports()) {
      const key = e.address.toString();
      exportAddressCounts.set(key, (exportAddressCounts.get(key) || 0) + 1);
    }
  }
  return exportAddressCounts.get(address.toString()) || 0;
}

// Adresse d'un export a hooker : refuse un corps partage par plusieurs exports.
function hookableGameExport(mangled) {
  const address = gameExport(mangled);
  const shared = sharedExportCount(address);
  if (shared > 1) {
    throw new Error('corps partage par ' + shared + ' exports (ICF), hook refuse : ' + mangled);
  }
  return address;
}

// --- Fonctions natives appelees par les agents -------------------------------------------------
// Resolues par nom decore au premier usage. Les structures > 8 octets (FVector, FRotator, FTransform,
// FNetConstructionID...) passent par adresse (ABI MSVC x64), d'ou les 'pointer'.
const NATIVE_SPECS = {
  // CoreUObject
  uobjectStaticClass: ['coreUObject', '?GetPrivateStaticClass@UObject@@CAPEAVUClass@@XZ', 'pointer', []],
  staticLoadClass: ['coreUObject', '?StaticLoadClass@@YAPEAVUClass@@PEAV1@PEAVUObject@@PEB_W2IPEAVUPackageMap@@@Z',
    'pointer', ['pointer', 'pointer', 'pointer', 'pointer', 'uint32', 'pointer']],
  staticFindObject: ['coreUObject', '?StaticFindObject@@YAPEAVUObject@@PEAVUClass@@PEAV1@PEB_W_N@Z',
    'pointer', ['pointer', 'pointer', 'pointer', 'int']],
  // Recherche par nom court, tous paquets confondus (Class, Name, EFindFirstObjectOptions, ELogVerbosity, Operation)
  staticFindFirstObject: ['coreUObject', '?StaticFindFirstObject@@YAPEAVUObject@@PEAVUClass@@PEB_WW4EFindFirstObjectOptions@@W4Type@ELogVerbosity@@1@Z',
    'pointer', ['pointer', 'pointer', 'int', 'int', 'pointer']],
  uclassStaticClass: ['coreUObject', '?GetPrivateStaticClass@UClass@@CAPEAV1@XZ', 'pointer', []],
  // Objet d'un TWeakObjectPtr (null s'il n'existe plus)
  weakObjectPtrGet: ['coreUObject', '?Get@FWeakObjectPtr@@QEBAPEAVUObject@@XZ', 'pointer', ['pointer']],
  // Reflexion : FName passe PAR VALEUR (8 octets en shipping, sinon MSVC le passerait par adresse)
  findPropertyByName: ['coreUObject', '?FindPropertyByName@UStruct@@QEBAPEAVFProperty@@VFName@@@Z', 'pointer', ['pointer', 'uint64']],
  fnameCtor: ['core', '??0FName@@QEAA@PEB_WW4EFindName@@@Z', 'pointer', ['pointer', 'pointer', 'int']],
  fnameToString: ['core', '?ToString@FName@@QEBAXAEAVFString@@@Z', 'void', ['pointer', 'pointer']],
  // Version du jeu (ex. ++FactoryGame+rel-main-1.2-CL-513885) : sert a invalider ce qui a ete appris en jeu
  buildVersion: ['core', '?GetBuildVersion@FApp@@SAPEB_WXZ', 'pointer', []],
  // Engine
  getWorld: ['engine', '?GetWorld@AActor@@UEBAPEAVUWorld@@XZ', 'pointer', ['pointer']],
  getPlayerPawn: ['engine', '?GetPlayerPawn@UGameplayStatics@@SAPEAVAPawn@@PEBVUObject@@H@Z', 'pointer', ['pointer', 'int']],
  getPlayerController: ['engine', '?GetPlayerController@UGameplayStatics@@SAPEAVAPlayerController@@PEBVUObject@@H@Z',
    'pointer', ['pointer', 'int']],
  getPlayerViewPoint: ['engine', '?GetPlayerViewPoint@APlayerController@@UEBAXAEAU?$TVector@N@Math@UE@@AEAU?$TRotator@N@34@@Z',
    'void', ['pointer', 'pointer', 'pointer']],
  setActorTransform: ['engine', '?SetActorTransform@AActor@@QEAA_NAEBU?$TTransform@N@Math@UE@@_NPEAUFHitResult@@W4ETeleportType@@@Z',
    'uint8', ['pointer', 'pointer', 'int', 'pointer', 'int']],
  destroyActor: ['engine', '?Destroy@AActor@@QEAA_N_N0@Z', 'uint8', ['pointer', 'int', 'int']],
  teleportTo: ['engine', '?TeleportTo@AActor@@UEAA_NAEBU?$TVector@N@Math@UE@@AEBU?$TRotator@N@34@_N2@Z',
    'uint8', ['pointer', 'pointer', 'pointer', 'int', 'int']],
  setControlRotation: ['engine', '?SetControlRotation@AController@@UEAAXAEBU?$TRotator@N@Math@UE@@@Z', 'void', ['pointer', 'pointer']],
  // virtuelle, mais AActor::FindComponentByClass n'est pas redefinie par les classes du jeu
  findComponentByClass: ['engine', '?FindComponentByClass@AActor@@UEBAPEAVUActorComponent@@V?$TSubclassOf@VUActorComponent@@@@@Z',
    'pointer', ['pointer', 'pointer']],
  // TArray rendu par valeur : pointeur cache (this, retour, &classe)
  getComponentsByClass: ['engine',
    '?K2_GetComponentsByClass@AActor@@QEBA?AV?$TArray@PEAVUActorComponent@@V?$TSizedDefaultAllocator@$0CA@@@@@V?$TSubclassOf@VUActorComponent@@@@@Z',
    'pointer', ['pointer', 'pointer', 'pointer']],
  // IsA sans offset : classe de l'objet puis test d'heritage (TSubclassOf passes par adresse)
  getObjectClass: ['engine', '?GetObjectClass@UGameplayStatics@@SAPEAVUClass@@PEBVUObject@@@Z', 'pointer', ['pointer']],
  classIsChildOf: ['engine', '?ClassIsChildOf@UKismetMathLibrary@@SA_NV?$TSubclassOf@VUObject@@@@0@Z', 'uint8', ['pointer', 'pointer']],
  getActorEyesViewPoint: ['engine', '?GetActorEyesViewPoint@AActor@@UEBAXAEAU?$TVector@N@Math@UE@@AEAU?$TRotator@N@34@@Z',
    'void', ['pointer', 'pointer', 'pointer']],
  // TSubclassOf passe PAR ADRESSE (verifie : AFGSignSubsystem::SweepForUntrackedWidgetSigns l'appelle avec &classe)
  getAllActorsOfClass: ['engine',
    '?GetAllActorsOfClass@UGameplayStatics@@SAXPEBVUObject@@V?$TSubclassOf@VAActor@@@@AEAV?$TArray@PEAVAActor@@V?$TSizedDefaultAllocator@$0CA@@@@@@Z',
    'void', ['pointer', 'pointer', 'pointer']],
  lineTraceSingleByChannel: ['engine',
    '?LineTraceSingleByChannel@UWorld@@QEBA_NAEAUFHitResult@@AEBU?$TVector@N@Math@UE@@1W4ECollisionChannel@@AEBUFCollisionQueryParams@@AEBUFCollisionResponseParams@@@Z',
    'uint8', ['pointer', 'pointer', 'pointer', 'pointer', 'int', 'pointer', 'pointer']],
  // Balayage d'une forme (boite) de start a end, orientee par un FQuat : premier obstacle bloquant
  sweepSingleByChannel: ['engine',
    '?SweepSingleByChannel@UWorld@@QEBA_NAEAUFHitResult@@AEBU?$TVector@N@Math@UE@@1AEBU?$TQuat@N@45@W4ECollisionChannel@@AEBUFCollisionShape@@AEBUFCollisionQueryParams@@AEBUFCollisionResponseParams@@@Z',
    'uint8', ['pointer', 'pointer', 'pointer', 'pointer', 'pointer', 'int', 'pointer', 'pointer', 'pointer']],
  // La forme posee en un point touche-t-elle un obstacle bloquant ?
  overlapBlockingTestByChannel: ['engine',
    '?OverlapBlockingTestByChannel@UWorld@@QEBA_NAEBU?$TVector@N@Math@UE@@AEBU?$TQuat@N@34@W4ECollisionChannel@@AEBUFCollisionShape@@AEBUFCollisionQueryParams@@AEBUFCollisionResponseParams@@@Z',
    'uint8', ['pointer', 'pointer', 'pointer', 'int', 'pointer', 'pointer', 'pointer']],
  // FactoryGame
  // Repartiteur intelligent : regles de tri (FSplitterSortRule de 16 octets passe par valeur = par adresse, ABI MSVC x64)
  splitterAddSortRule: ['game', '?AddSortRule@AFGBuildableSplitterSmart@@QEAAXUFSplitterSortRule@@@Z', 'void', ['pointer', 'pointer']],
  splitterRemoveSortRuleAt: ['game', '?RemoveSortRuleAt@AFGBuildableSplitterSmart@@QEAAXH@Z', 'void', ['pointer', 'int']],
  // Descripteurs speciaux des regles : trop-plein, n'importe quel objet, aucun, objet sans autre regle
  overflowDescriptorClass: ['game', '?Z_Construct_UClass_UFGOverflowDescriptor_NoRegister@@YAPEAVUClass@@XZ', 'pointer', []],
  wildCardDescriptorClass: ['game', '?Z_Construct_UClass_UFGWildCardDescriptor_NoRegister@@YAPEAVUClass@@XZ', 'pointer', []],
  noneDescriptorClass: ['game', '?Z_Construct_UClass_UFGNoneDescriptor_NoRegister@@YAPEAVUClass@@XZ', 'pointer', []],
  anyUndefinedDescriptorClass: ['game', '?Z_Construct_UClass_UFGAnyUndefinedDescriptor_NoRegister@@YAPEAVUClass@@XZ', 'pointer', []],
  spawnHologramFromRecipe: ['game',
    '?SpawnHologramFromRecipe@AFGHologram@@SAPEAV1@V?$TSubclassOf@VUFGRecipe@@@@PEAVAActor@@AEBU?$TVector@N@Math@UE@@PEAVAPawn@@AEBV?$TFunction@$$A6AXPEAVAFGHologram@@@Z@@@Z',
    'pointer', ['pointer', 'pointer', 'pointer', 'pointer', 'pointer']],
  getNewNetConstructionID: ['game', '?GetNewNetConstructionID@AFGBuildableSubsystem@@QEAAXAEAUFNetConstructionID@@@Z',
    'void', ['pointer', 'pointer']],
  executeDismantle: ['game', '?Execute_Dismantle@IFGDismantleInterface@@SAXPEAVUObject@@@Z', 'void', ['pointer']],
  // Contour du pistolet de demontage : UFGOutlineComponent::ShowOutline(acteur, couleur, createDefaultProxies,
  // onlyHighlightProxies) et HideOutline(acteur) ; le composant est mOutlineComponent du personnage
  outlineShow: ['game', '?ShowOutline@UFGOutlineComponent@@QEAAXPEAVAActor@@W4EOutlineColor@@_N2@Z', 'void', ['pointer', 'pointer', 'uint8', 'uint8', 'uint8']],
  outlineHide: ['game', '?HideOutline@UFGOutlineComponent@@QEAAXPEAVAActor@@@Z', 'void', ['pointer', 'pointer']],
  // Bulle de visualisation : acteur de decor (StaticMeshActor) apparu en deux temps, maillage et materiau charges par chemin
  staticLoadObject: ['coreUObject', '?StaticLoadObject@@YAPEAVUObject@@PEAVUClass@@PEAV1@PEB_W2IPEAVUPackageMap@@_NPEBVFLinkerInstancingContext@@@Z',
    'pointer', ['pointer', 'pointer', 'pointer', 'pointer', 'uint32', 'pointer', 'uint8', 'pointer']],
  beginDeferredSpawn: ['engine', '?BeginDeferredActorSpawnFromClass@UGameplayStatics@@SAPEAVAActor@@PEBVUObject@@V?$TSubclassOf@VAActor@@@@AEBU?$TTransform@N@Math@UE@@W4ESpawnActorCollisionHandlingMethod@@PEAV2@W4ESpawnActorScaleMethod@@@Z',
    'pointer', ['pointer', 'pointer', 'pointer', 'uint8', 'pointer', 'uint8']],
  finishSpawningActor: ['engine', '?FinishSpawningActor@UGameplayStatics@@SAPEAVAActor@@PEAV2@AEBU?$TTransform@N@Math@UE@@W4ESpawnActorScaleMethod@@@Z',
    'pointer', ['pointer', 'pointer', 'uint8']],
  // UActorComponent* AActor::AddComponentByClass(TSubclassOf<UActorComponent> (par adresse), bool bManualAttachment,
  // const FTransform& RelativeTransform, bool bDeferredFinish)
  addComponentByClass: ['engine', '?AddComponentByClass@AActor@@QEAAPEAVUActorComponent@@V?$TSubclassOf@VUActorComponent@@@@_NAEBU?$TTransform@N@Math@UE@@1@Z',
    'pointer', ['pointer', 'pointer', 'uint8', 'pointer', 'uint8']],
  // FCollisionQueryParams(FName TraceTag, const TStatId&, bool bTraceComplex, const AActor* IgnoreActor) ; AddIgnoredActor
  queryParamsCtor: ['engine', '??0FCollisionQueryParams@@QEAA@VFName@@AEBUTStatId@@_NPEBVAActor@@@Z', 'pointer', ['pointer', 'uint64', 'pointer', 'uint8', 'pointer']],
  queryAddIgnoredActor: ['engine', '?AddIgnoredActor@FCollisionQueryParams@@QEAAXPEBVAActor@@@Z', 'void', ['pointer', 'pointer']],
  // UActorComponent* AActor::GetComponentByClass(TSubclassOf<UActorComponent> (par adresse)) const
  actorComponentByClass: ['engine', '?GetComponentByClass@AActor@@QEBAPEAVUActorComponent@@V?$TSubclassOf@VUActorComponent@@@@@Z', 'pointer', ['pointer', 'pointer']],
  // bool UWorldPartitionStreamingSourceComponent::IsStreamingCompleted() const
  wpSourceStreamingCompleted: ['engine', '?IsStreamingCompleted@UWorldPartitionStreamingSourceComponent@@QEBA_NXZ', 'uint8', ['pointer']],
  staticMeshSetMesh: ['engine', '?SetStaticMesh@UStaticMeshComponent@@UEAA_NPEAVUStaticMesh@@@Z', 'uint8', ['pointer', 'pointer']],
  meshSetMaterial: ['engine', '?SetMaterial@UMeshComponent@@UEAAXHPEAVUMaterialInterface@@@Z', 'void', ['pointer', 'int', 'pointer']],
  sceneSetMobility: ['engine', '?SetMobility@USceneComponent@@UEAAXW4Type@EComponentMobility@@@Z', 'void', ['pointer', 'uint8']],
  setActorEnableCollision: ['engine', '?SetActorEnableCollision@AActor@@QEAAX_N@Z', 'void', ['pointer', 'uint8']],
  primitiveSetCollisionEnabled: ['engine', '?SetCollisionEnabled@UPrimitiveComponent@@UEAAXW4Type@ECollisionEnabled@@@Z', 'void', ['pointer', 'uint8']],
  primitiveSetCastShadow: ['engine', '?SetCastShadow@UPrimitiveComponent@@QEAAX_N@Z', 'void', ['pointer', 'uint8']],
  // Valeurs d'un enum lues en jeu : nom par index (FString rendue par valeur : pointeur cache), valeur par nom
  enumNameStringByIndex: ['coreUObject', '?GetNameStringByIndex@UEnum@@QEBA?AVFString@@H@Z', 'pointer', ['pointer', 'pointer', 'int']],
  enumValueByNameString: ['coreUObject', '?GetValueByNameString@UEnum@@QEBA_JAEBVFString@@W4EGetByNameFlags@@@Z', 'int64', ['pointer', 'pointer', 'int']],
  actorInstanceHandleAssign: ['engine', '??4FActorInstanceHandle@@QEAAAEAU0@PEAVAActor@@@Z', 'pointer', ['pointer', 'pointer']],
  sceneComponentLocation: ['engine', '?K2_GetComponentLocation@USceneComponent@@QEBA?AU?$TVector@N@Math@UE@@XZ', 'pointer', ['pointer', 'pointer']],
  sceneComponentForward: ['engine', '?GetForwardVector@USceneComponent@@QEBA?AU?$TVector@N@Math@UE@@XZ', 'pointer', ['pointer', 'pointer']],
  // AActor::CalculateComponentsBoundingBoxInLocalSpace(bNonColliding, bIncludeFromChildActors) : FBox (Min, Max, IsValid)
  // dans le repere de l'acteur, sans son echelle (GetActorBounds n'est pas exporte)
  actorLocalBox: ['engine', '?CalculateComponentsBoundingBoxInLocalSpace@AActor@@UEBA?AU?$TBox@N@Math@UE@@_N0@Z', 'pointer', ['pointer', 'pointer', 'uint8', 'uint8']],
  // UFGFactoryConnectionComponent::SetConnection(other) : raccorde deux connecteurs convoyeur (les deux cotes)
  factoryConnSetConnection: ['game', '?SetConnection@UFGFactoryConnectionComponent@@QEAAXPEAV1@@Z', 'void', ['pointer', 'pointer']],
  getChildDismantleActors: ['game', '?Execute_GetChildDismantleActors@IFGDismantleInterface@@SAXPEBVUObject@@AEAV?$TArray@PEAVAActor@@V?$TSizedDefaultAllocator@$0CA@@@@@@Z', 'void', ['pointer', 'pointer']],
  // Validation de l'hologramme (comme le pistolet a chaque frame). CheckCanAfford, appele par
  // ValidatePlacementAndCost, fait PLANTER le jeu (check) si l'inventaire est nul.
  resetConstructDisqualifiers: ['game', '?ResetConstructDisqualifiers@AFGHologram@@QEAAXXZ', 'void', ['pointer']],
  validatePlacementAndCost: ['game', '?ValidatePlacementAndCost@AFGHologram@@QEAAXPEAVUFGInventoryComponent@@@Z',
    'void', ['pointer', 'pointer']],
  getConstructDisqualifiers: ['game',
    '?GetConstructDisqualifiers@AFGHologram@@QEBAXAEAV?$TArray@V?$TSubclassOf@VUFGConstructDisqualifier@@@@V?$TSizedDefaultAllocator@$0CA@@@@@@Z',
    'void', ['pointer', 'pointer']],
  playerInventory: ['game', '?GetInventory@AFGCharacterPlayer@@QEBAPEAVUFGInventoryComponent@@XZ', 'pointer', ['pointer']],
  // Electricite : connecteurs de circuit, cables
  circuitConnectionStaticClass: ['game', '?GetPrivateStaticClass@UFGCircuitConnectionComponent@@CAPEAVUClass@@XZ', 'pointer', []],
  powerConnectionStaticClass: ['game', '?GetPrivateStaticClass@UFGPowerConnectionComponent@@CAPEAVUClass@@XZ', 'pointer', []],
  getNumConnections: ['game', '?GetNumConnections@UFGCircuitConnectionComponent@@QEBAHXZ', 'int', ['pointer']],
  // Connecteurs relies a celui-ci (bouts opposes des cables et liaisons cachees) : TArray rempli par reference
  circuitGetConnections: ['game',
    '?GetConnections@UFGCircuitConnectionComponent@@QEBAXAEAV?$TArray@PEAVUFGCircuitConnectionComponent@@V?$TSizedDefaultAllocator@$0CA@@@@@@Z',
    'void', ['pointer', 'pointer']],
  getMaxNumConnections: ['game', '?GetMaxNumConnections@UFGCircuitConnectionComponent@@QEBAHXZ', 'int', ['pointer']],
  getCircuitID: ['game', '?GetCircuitID@UFGCircuitConnectionComponent@@QEBAHXZ', 'int', ['pointer']],
  findCircuit: ['game', '?FindCircuit@AFGCircuitSubsystem@@QEBAPEAVUFGCircuit@@H@Z', 'pointer', ['pointer', 'int']],
  resetFuse: ['game', '?ResetFuse@UFGPowerCircuit@@QEAAXPEAVAFGPlayerController@@@Z', 'void', ['pointer', 'pointer']],
  getPowerInfo: ['game', '?GetPowerInfo@UFGPowerConnectionComponent@@QEBAPEAVUFGPowerInfoComponent@@XZ', 'pointer', ['pointer']],
  powerInfoHasPower: ['game', '?HasPower@UFGPowerInfoComponent@@QEBA_NXZ', 'uint8', ['pointer']],
  // Connecteurs de convoyeur (FVector rendus par valeur : pointeur cache)
  factoryConnectionStaticClass: ['game', '?GetPrivateStaticClass@UFGFactoryConnectionComponent@@CAPEAVUClass@@XZ', 'pointer', []],
  getConnectorLocation: ['game', '?GetConnectorLocation@UFGFactoryConnectionComponent@@QEBA?AU?$TVector@N@Math@UE@@_N@Z',
    'pointer', ['pointer', 'pointer', 'int']],
  getConnectorNormal: ['game', '?GetConnectorNormal@UFGFactoryConnectionComponent@@QEBA?AU?$TVector@N@Math@UE@@XZ',
    'pointer', ['pointer', 'pointer']],
  getConnectionDirection: ['game', '?GetDirection@UFGFactoryConnectionComponent@@QEBA?AW4EFactoryConnectionDirection@@XZ',
    'uint8', ['pointer']],
  isConnectionConnected: ['game', '?IsConnected@UFGFactoryConnectionComponent@@QEBA_NXZ', 'uint8', ['pointer']],
  // Recettes, lues dans le jeu (fonctions statiques Blueprint ; TArray rendus par valeur = pointeur cache en tete)
  recipeStaticClass: ['game', '?GetPrivateStaticClass@UFGRecipe@@CAPEAVUClass@@XZ', 'pointer', []],
  recipeIngredients: ['game',
    '?GetIngredients@UFGRecipe@@SA?AV?$TArray@UFItemAmount@@V?$TSizedDefaultAllocator@$0CA@@@@@PEBVUObject@@V?$TSubclassOf@VUFGRecipe@@@@@Z',
    'pointer', ['pointer', 'pointer', 'pointer']],
  recipeProducts: ['game',
    '?GetProducts@UFGRecipe@@SA?AV?$TArray@UFItemAmount@@V?$TSizedDefaultAllocator@$0CA@@@@@V?$TSubclassOf@VUFGRecipe@@@@@Z',
    'pointer', ['pointer', 'pointer']],
  recipeDuration: ['game', '?GetManufacturingDuration@UFGRecipe@@SAMV?$TSubclassOf@VUFGRecipe@@@@@Z', 'float', ['pointer']],
  recipeProducedIn: ['game',
    '?GetProducedIn@UFGRecipe@@SA?AV?$TArray@V?$TSubclassOf@VUObject@@@@V?$TSizedDefaultAllocator@$0CA@@@@@V?$TSubclassOf@VUFGRecipe@@@@@Z',
    'pointer', ['pointer', 'pointer']],
  // Classe du batiment construit par une recette de construction (TSubclassOf rendu par valeur = pointeur cache)
  buildableClassFromRecipe: ['game',
    '?GetBuildableClassFromRecipe@AFGBuildable@@SA?AV?$TSubclassOf@VAFGBuildable@@@@V?$TSubclassOf@VUFGRecipe@@@@@Z',
    'pointer', ['pointer', 'pointer']],
  recipeManagerGet: ['game', '?Get@AFGRecipeManager@@SAPEAV1@PEAVUObject@@@Z', 'pointer', ['pointer']],
  recipeManagerAvailable: ['game',
    '?GetAllAvailableRecipes@AFGRecipeManager@@QEBAXAEAV?$TArray@V?$TSubclassOf@VUFGRecipe@@@@V?$TSizedDefaultAllocator@$0CA@@@@@@Z',
    'void', ['pointer', 'pointer']],
  // Machines (n'appeler qu'apres isA : ces fonctions lisent/ecrivent des champs propres aux usines)
  factoryStaticClass: ['game', '?GetPrivateStaticClass@AFGBuildableFactory@@CAPEAVUClass@@XZ', 'pointer', []],
  manufacturerStaticClass: ['game', '?GetPrivateStaticClass@AFGBuildableManufacturer@@CAPEAVUClass@@XZ', 'pointer', []],
  getAvailableRecipes: ['game',
    '?GetAvailableRecipes@AFGBuildableManufacturer@@QEBAXAEAV?$TArray@V?$TSubclassOf@VUFGRecipe@@@@V?$TSizedDefaultAllocator@$0CA@@@@@@Z',
    'void', ['pointer', 'pointer']],
  // TSubclassOf rendu par valeur : pointeur cache (this, retour)
  getCurrentRecipe: ['game', '?GetCurrentRecipe@AFGBuildableManufacturer@@QEBA?AV?$TSubclassOf@VUFGRecipe@@@@XZ',
    'pointer', ['pointer', 'pointer']],
  setRecipe: ['game', '?SetRecipe@AFGBuildableManufacturer@@QEAAXV?$TSubclassOf@VUFGRecipe@@@@@Z', 'void', ['pointer', 'pointer']],
  getPendingPotential: ['game', '?GetPendingPotential@AFGBuildableFactory@@QEBAMXZ', 'float', ['pointer']],
  getCurrentPotential: ['game', '?GetCurrentPotential@AFGBuildableFactory@@QEBAMXZ', 'float', ['pointer']],
  isProductionPaused: ['game', '?IsProductionPaused@AFGBuildableFactory@@QEBA_NXZ', 'uint8', ['pointer']],
  getPotentialInventory: ['game', '?GetPotentialInventory@AFGBuildableFactory@@QEBAPEAVUFGInventoryComponent@@XZ', 'pointer', ['pointer']],
  // Inventaires : structures fabriquees par le jeu lui-meme (aucune disposition FInventoryItem/Stack a connaitre).
  // Retours de structure par valeur : pointeur cache en premier (fonctions statiques).
  makeInventoryItem: ['game', '?MakeInventoryItem@UFGInventoryLibrary@@SA?AUFInventoryItem@@V?$TSubclassOf@VUFGItemDescriptor@@@@@Z',
    'pointer', ['pointer', 'pointer']],
  makeInventoryStack: ['game', '?MakeInventoryStack@UFGInventoryLibrary@@SA?AUFInventoryStack@@HUFInventoryItem@@@Z',
    'pointer', ['pointer', 'int', 'pointer']],
  // Pieces legeres (fondations, rampes, murs, poutres...) : sous-systeme et reference d'instance (classe + numero).
  // Les numeros sont bornes par le jeu (pointeur nul hors du tableau) et RemoveByInstanceIndex ne retire qu'une
  // instance valide (FRuntimeBuildableInstanceData::IsValid) : un numero deja retire est sans effet.
  lwSubsystemGet: ['game', '?Get@AFGLightweightBuildableSubsystem@@SAPEAV1@PEAVUObject@@@Z', 'pointer', ['pointer']],
  lwRuntimeData: ['game',
    '?GetRuntimeDataForBuildableClassAndIndex@AFGLightweightBuildableSubsystem@@QEAAPEAUFRuntimeBuildableInstanceData@@V?$TSubclassOf@VAFGBuildable@@@@H@Z',
    'pointer', ['pointer', 'pointer', 'int']],
  lwDataIsValid: ['game', '?IsValid@FRuntimeBuildableInstanceData@@QEBA_NXZ', 'uint8', ['pointer']],
  lwRefCtor: ['game', '??0FLightweightBuildableInstanceRef@@QEAA@XZ', 'pointer', ['pointer']],
  lwRefInitialize: ['game',
    '?Initialize@FLightweightBuildableInstanceRef@@QEAAXPEAVAFGLightweightBuildableSubsystem@@V?$TSubclassOf@VAFGBuildable@@@@H@Z',
    'void', ['pointer', 'pointer', 'pointer', 'int']],
  // FTransform rendu par valeur : pointeur cache apres this
  lwRefTransform: ['game', '?GetBuildableTransform@FLightweightBuildableInstanceRef@@QEBA?AU?$TTransform@N@Math@UE@@XZ',
    'pointer', ['pointer', 'pointer']],
  lwRefRemove: ['game', '?Remove@FLightweightBuildableInstanceRef@@QEAA_NXZ', 'uint8', ['pointer']],
  // Taille de pile reelle d'un objet (statique ; TSubclassOf passe par adresse)
  itemStackSize: ['game', '?GetStackSize@UFGItemDescriptor@@SAHV?$TSubclassOf@VUFGItemDescriptor@@@@@Z', 'int', ['pointer']],
  // Retire num objets d'une classe (TSubclassOf passe par adresse, comme pour GetNumItems)
  inventoryRemove: ['game', '?Remove@UFGInventoryComponent@@QEAAXV?$TSubclassOf@VUFGItemDescriptor@@@@H@Z', 'void', ['pointer', 'pointer', 'int']],
  inventoryNumItems: ['game', '?GetNumItems@UFGInventoryComponent@@QEBAHV?$TSubclassOf@VUFGItemDescriptor@@@@@Z',
    'int', ['pointer', 'pointer']],
  // Non virtuelle : n'appeler que sur un AFGWireHologram (verifie via la vtable de Construct)
  wireHologramSetConnection: ['game', '?SetConnection@AFGWireHologram@@QEAAXHPEAVUFGCircuitConnectionComponent@@@Z',
    'void', ['pointer', 'int', 'pointer']],
  buildableStaticClass: ['game', '?GetPrivateStaticClass@AFGBuildable@@CAPEAVUClass@@XZ', 'pointer', []],
  resourceNodeStaticClass: ['game', '?GetPrivateStaticClass@AFGResourceNode@@CAPEAVUClass@@XZ', 'pointer', []],
  getResourcePurity: ['game', '?GetResourcePurity@AFGResourceNode@@QEBA?AW4EResourcePurity@@XZ', 'uint8', ['pointer']],
  // Objets a ramasser (spheres de Mercer, Somersloop, disques durs...) : meme fonction que la touche E du joueur
  itemPickupStaticClass: ['game', '?GetPrivateStaticClass@AFGItemPickup@@CAPEAVUClass@@XZ', 'pointer', []],
  characterPlayerStaticClass: ['game', '?GetPrivateStaticClass@AFGCharacterPlayer@@CAPEAVUClass@@XZ', 'pointer', []],
  isPickedUp: ['game', '?IsPickedUp@AFGItemPickup@@QEBA_NXZ', 'uint8', ['pointer']],
  pickUpItem: ['game', '?PickUpItem@AFGCharacterPlayer@@QEAAXPEAVAFGItemPickup@@@Z', 'void', ['pointer', 'pointer']],
  // Chemin de fer : connecteurs des rails (TVector / TArray rendus par valeur = pointeur cache apres this)
  railConnStaticClass: ['game', '?GetPrivateStaticClass@UFGRailroadTrackConnectionComponent@@CAPEAVUClass@@XZ', 'pointer', []],
  railTrackStaticClass: ['game', '?GetPrivateStaticClass@AFGBuildableRailroadTrack@@CAPEAVUClass@@XZ', 'pointer', []],
  railConnLocation: ['game', '?GetConnectorLocation@UFGRailroadTrackConnectionComponent@@QEBA?AU?$TVector@N@Math@UE@@XZ',
    'pointer', ['pointer', 'pointer']],
  railConnNormal: ['game', '?GetConnectorNormal@UFGRailroadTrackConnectionComponent@@QEBA?AU?$TVector@N@Math@UE@@XZ',
    'pointer', ['pointer', 'pointer']],
  railConnConnections: ['game',
    '?GetConnections@UFGRailroadTrackConnectionComponent@@QEBA?AV?$TArray@PEAVUFGRailroadTrackConnectionComponent@@V?$TSizedDefaultAllocator@$0CA@@@@@XZ',
    'pointer', ['pointer', 'pointer']],
  railConnTrack: ['game', '?GetTrack@UFGRailroadTrackConnectionComponent@@QEBAPEAVAFGBuildableRailroadTrack@@XZ', 'pointer', ['pointer']],
  railConnStation: ['game', '?GetStation@UFGRailroadTrackConnectionComponent@@QEBAPEAVAFGBuildableRailroadStation@@XZ', 'pointer', ['pointer']],
  railConnFacingSignal: ['game', '?GetFacingSignal@UFGRailroadTrackConnectionComponent@@QEBAPEAVAFGBuildableRailroadSignal@@XZ', 'pointer', ['pointer']],
  railConnTrailingSignal: ['game', '?GetTrailingSignal@UFGRailroadTrackConnectionComponent@@QEBAPEAVAFGBuildableRailroadSignal@@XZ', 'pointer', ['pointer']],
  railConnSwitchPositions: ['game', '?GetNumSwitchPositions@UFGRailroadTrackConnectionComponent@@QEBAHXZ', 'int', ['pointer']],
  // TWeakPtr<FFGRailroadSignalBlock> rendu par valeur (pointeur cache apres this) : { objet, compteur de references }
  railConnSignalBlock: ['game', '?GetSignalBlock@UFGRailroadTrackConnectionComponent@@QEBA?AV?$TWeakPtr@UFFGRailroadSignalBlock@@$00@@XZ',
    'pointer', ['pointer', 'pointer']],
  // Non virtuelle : n'appeler que sur un hologramme de signal (classe verifiee par isA)
  signalHologramStaticClass: ['game', '?GetPrivateStaticClass@AFGRailroadSignalHologram@@CAPEAVUClass@@XZ', 'pointer', []],
  signalSetLeftHanded: ['game', '?SetLeftHanded@AFGRailroadSignalHologram@@IEAAX_N@Z', 'void', ['pointer', 'uint8']],
  trainPlatformHologramStaticClass: ['game', '?GetPrivateStaticClass@AFGTrainPlatformHologram@@CAPEAVUClass@@XZ', 'pointer', []],
  trackHologramFromPlatformConnections: ['game', '?SetLocationAndRotationFromPlatformConnections@AFGRailroadTrackHologram@@QEAAXPEAVUFGTrainPlatformConnection@@0@Z', 'void', ['pointer', 'pointer', 'pointer']],
  cargoPlatformStaticClass: ['game', '?GetPrivateStaticClass@AFGBuildableTrainPlatformCargo@@CAPEAVUClass@@XZ', 'pointer', []],
  cargoPlatformSetLoadMode: ['game', '?SetIsInLoadMode@AFGBuildableTrainPlatformCargo@@UEAAX_N@Z', 'void', ['pointer', 'uint8']],
  cargoPlatformIsInLoadMode: ['game', '?GetIsInLoadMode@AFGBuildableTrainPlatformCargo@@UEBA_NXZ', 'uint8', ['pointer']],
  // Retrait d'une balise de la carte : ne lit que FMapMarker::MarkerGUID (Multicast_RemoveMapMarker sur le serveur)
  mapManagerRemoveMarker: ['game', '?RemoveMapMarker@AFGMapManager@@QEAAXAEBUFMapMarker@@@Z', 'void', ['pointer', 'pointer']],
  // Pose d'une balise : copie inMarker dans outMarker, nouveau GUID, Multicast_CreateUpdateMapMarker sur le serveur
  mapManagerAddMarker: ['game', '?AddNewMapMarker@AFGMapManager@@QEAA_NAEBUFMapMarker@@AEAU2@@Z', 'uint8', ['pointer', 'pointer', 'pointer']],
  // Liaison directe de deux connecteurs de rail (dans les deux sens, sans recherche par collision) ; ne met pas a jour les
  // graphes du systeme ferroviaire (seul AActor::ForceNetUpdate est appele) : voir railSubsystemRemoveTrack / AddTrack
  railConnAddConnection: ['game', '?AddConnection@UFGRailroadTrackConnectionComponent@@QEAAXPEAV1@@Z', 'void', ['pointer', 'pointer']],
  // Inscription d'un rail dans le systeme ferroviaire : AddTrack fusionne son graphe avec ceux des rails relies
  railSubsystemRemoveTrack: ['game', '?RemoveTrack@AFGRailroadSubsystem@@QEAAXPEAVAFGBuildableRailroadTrack@@@Z', 'void', ['pointer', 'pointer']],
  railSubsystemAddTrack: ['game', '?AddTrack@AFGRailroadSubsystem@@QEAAXPEAVAFGBuildableRailroadTrack@@@Z', 'void', ['pointer', 'pointer']],
  // Session de sauvegarde de la partie (celle du mode de jeu), depuis n'importe quel objet du monde
  saveSessionGet: ['game', '?Get@UFGSaveSession@@SAPEAV1@PEAVUObject@@@Z', 'pointer', ['pointer']],
  // Sauvegarde nommee : nom par reference (copie), delegue de fin passe par valeur (tampon detruit par l'appele ; vide =
  // jamais appele), donnee utilisateur. Ecrite au tick suivant du monde (tout de suite si le jeu est en pause) ; ignoree
  // si une sauvegarde est deja en cours ou si le nom est invalide (: / \ * < > @ ^ |)
  saveSessionSaveGame: ['game', '?SaveGame@UFGSaveSession@@QEAAXAEBVFString@@V?$TDelegate@$$A6AX_NAEBVFText@@PEAX@ZUFDefaultDelegateUserPolicy@@@@PEAX@Z', 'void', ['pointer', 'pointer', 'pointer', 'pointer']],
  // Nom d'une gare : FText::FromString (Core, statique : FText rendu par valeur = pointeur cache en premier) copie la
  // chaine ; SetStationName (identifiant de la gare) la passe au filtre de texte du jeu
  // (UFGBlueprintFunctionLibrary::FilterText) et applique le nom dans son rappel. Le destructeur de FText n'est pas
  // exporte : le texte cree n'est pas libere (quelques dizaines d'octets par renommage)
  textFromString: ['core', '?FromString@FText@@SA?AV1@AEBVFString@@@Z', 'pointer', ['pointer', 'pointer']],
  // Allocation par le moteur (tableaux que le moteur liberera lui-meme) : taille, alignement
  memMalloc: ['core', '?Malloc@FMemory@@SAPEAX_KI@Z', 'pointer', ['uint64', 'uint32']],
  trainStationSetName: ['game', '?SetStationName@AFGTrainStationIdentifier@@QEAAXAEBVFText@@@Z', 'void', ['pointer', 'pointer']],
  railTrackLength: ['game', '?GetLength@AFGBuildableRailroadTrack@@QEBAMXZ', 'float', ['pointer']],
  railTrackGraphId: ['game', '?GetTrackGraphID@AFGBuildableRailroadTrack@@QEBAHXZ', 'int', ['pointer']],
  // Liste du monde entier tenue pour le scanner d'objets (FGuid passe par reference)
  scannableSubsystemStaticClass: ['game', '?GetPrivateStaticClass@AFGScannableSubsystem@@CAPEAVUClass@@XZ', 'pointer', []],
  doesPickupExist: ['game', '?DoesPickupExist@AFGScannableSubsystem@@QEBA_NAEBUFGuid@@@Z', 'uint8', ['pointer', 'pointer']],
  hasDropPodBeenLooted: ['game', '?HasDropPodBeenLooted@AFGScannableSubsystem@@QEBA_NAEBUFGuid@@@Z', 'uint8', ['pointer', 'pointer']],
};

const nativeCache = new Map();

function native(name) {
  let fn = nativeCache.get(name);
  if (fn === undefined) {
    const spec = NATIVE_SPECS[name];
    if (spec === undefined) throw new Error('fonction native inconnue : ' + name);
    const [moduleKey, mangled, ret, args] = spec;
    fn = new NativeFunction(exportOf(MOD[moduleKey], mangled), ret, args);
    nativeCache.set(name, fn);
  }
  return fn;
}

// Donnee exportee (variable globale) d'un module moteur
function dataExport(moduleKey, mangled) {
  return exportOf(MOD[moduleKey], mangled);
}

// --- Memoire et structures UE5 (double precision) -----------------------------------------------

// Bloc mis a zero et aligne (FTransform est aligne sur 16 : chargements SSE). Garder l'objet retourne
// en vie tant que le natif utilise .ptr : Frida libere la memoire quand `base` n'est plus reference.
function zeroAlloc(size, align = 16) {
  const base = Memory.alloc(size + align);
  base.writeByteArray(new Uint8Array(size + align));
  const misalign = base.and(align - 1).toInt32();
  return { base, ptr: misalign === 0 ? base : base.add(align - misalign) };
}

function writeVector(p, v) {
  p.writeDouble(v.x);
  p.add(8).writeDouble(v.y);
  p.add(16).writeDouble(v.z);
}

function readVec(p) {
  return { x: p.readDouble(), y: p.add(8).readDouble(), z: p.add(16).readDouble() };
}

function newVector(v) {
  const m = zeroAlloc(24, 8);
  writeVector(m.ptr, v);
  return m;
}

// FRotator : Pitch, Yaw, Roll (degres)
function newRotator(r) {
  const m = zeroAlloc(24, 8);
  m.ptr.writeDouble(r.pitch || 0);
  m.ptr.add(8).writeDouble(r.yaw || 0);
  m.ptr.add(16).writeDouble(r.roll || 0);
  return m;
}

function readRotator(p) {
  return { pitch: p.readDouble(), yaw: p.add(8).readDouble(), roll: p.add(16).readDouble() };
}

// Quaternion d'un lacet seul (meme convention que FRotator(0, yaw, 0).Quaternion() et que le toolkit)
function quatFromYaw(yawDeg) {
  const h = (yawDeg * Math.PI) / 360;
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
}

// FRotator::Quaternion (degres) : tangage > 0 leve l'axe X local
function quatFromRotator(pitchDeg, yawDeg, rollDeg) {
  const h = Math.PI / 360;
  const sp = Math.sin(pitchDeg * h), cp = Math.cos(pitchDeg * h);
  const sy = Math.sin(yawDeg * h), cy = Math.cos(yawDeg * h);
  const sr = Math.sin(rollDeg * h), cr = Math.cos(rollDeg * h);
  return {
    x: cr * sp * sy - sr * cp * cy,
    y: -cr * sp * cy - sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy,
  };
}

// FTransform UE5 : Rotation @0x00 (quat), Translation @0x20, Scale3D @0x40 (W de padding a 0)
function newTransform(location, rotation, scale = { x: 1, y: 1, z: 1 }) {
  const m = zeroAlloc(0x60, 16);
  const p = m.ptr;
  p.writeDouble(rotation.x);
  p.add(0x08).writeDouble(rotation.y);
  p.add(0x10).writeDouble(rotation.z);
  p.add(0x18).writeDouble(rotation.w);
  writeVector(p.add(0x20), location);
  writeVector(p.add(0x40), scale);
  return m;
}

// TArray<T*> rendu par le jeu : lit les pointeurs puis libere le buffer avec l'allocateur du jeu
function takePointerArray(arr) {
  const data = arr.readPointer();
  const num = arr.add(8).readS32();
  const out = [];
  for (let i = 0; i < num; i++) out.push(data.add(i * 8).readPointer());
  if (!data.isNull()) fnFree(data);
  return out;
}

function wideString(s) {
  return Memory.allocUtf16String(s);
}

// UClass* d'une classe Blueprint par chemin complet (ex. "/Game/.../Recipe_ConstructorMk1.Recipe_ConstructorMk1_C").
// A appeler sur le thread du jeu : peut charger le package.
function loadClass(path) {
  const cls = native('staticLoadClass')(native('uobjectStaticClass')(), NULL, wideString(path), NULL, 0, NULL);
  if (!isUObject(cls)) throw new Error('classe introuvable : ' + path);
  return cls;
}

// Objet charge par nom court (ex. "Recipe_Concrete_C", "Default__Build_MinerMk3_C"), ou NULL
function findFirstObject(name, cls) {
  const obj = native('staticFindFirstObject')(cls || native('uobjectStaticClass')(), wideString(name), 0, 0, NULL);
  return isUObject(obj) ? obj : NULL;
}

// --- Reflexion Unreal sans offset code en dur ------------------------------------------------------
// FindPropertyByName donne le FProperty ; il reste a savoir ou FProperty range son decalage (Offset_Internal)
// et ou UStruct range sa taille (PropertiesSize). On les etalonne sur des structures moteur dont la disposition
// est intrinseque : FQuat (X=0, Y=8, Z=16, W=24), et les tailles de FVector2D, FVector, FQuat, FTransform.

const reflection = { offsetField: null, sizeField: null };

const FNAME_FIND = 0;

function fname(str) {
  const buf = zeroAlloc(16, 8);
  native('fnameCtor')(buf.ptr, wideString(str), FNAME_FIND);
  return buf.ptr.readU64();
}

function findProperty(struct, name) {
  const prop = native('findPropertyByName')(struct, fname(name));
  if (prop.isNull()) throw new Error('propriete ' + name + ' introuvable');
  return prop;
}

function requireStruct(path) {
  const s = findObject(path);
  if (s.isNull()) throw new Error('structure ' + path + ' introuvable');
  return s;
}

function uniqueOffset(from, to, test, what) {
  const hits = [];
  for (let o = from; o < to; o += 4) {
    try {
      if (test(o)) hits.push(o);
    } catch (e) { /* lecture hors zone : offset ignore */ }
  }
  if (hits.length !== 1) throw new Error('etalonnage ' + what + ' : ' + hits.length + ' candidats ' + JSON.stringify(hits));
  return hits[0];
}

function calibrateReflection() {
  if (reflection.offsetField !== null) return reflection;
  const quat = requireStruct('/Script/CoreUObject.Quat');
  const quatProps = ['X', 'Y', 'Z', 'W'].map((n) => findProperty(quat, n));
  reflection.offsetField = uniqueOffset(0x20, 0x100,
    (o) => quatProps.every((p, i) => p.add(o).readS32() === i * 8), 'FProperty::Offset_Internal');
  const sizes = [['Vector2D', 16], ['Vector', 24], ['Quat', 32], ['Transform', 96]]
    .map(([n, size]) => [requireStruct('/Script/CoreUObject.' + n), size]);
  reflection.sizeField = uniqueOffset(0x28, 0x200,
    (o) => sizes.every(([s, size]) => s.add(o).readS32() === size), 'UStruct::PropertiesSize');
  return reflection;
}

// FProperty::PropertyFlags (EPropertyFlags, 64 bits) : etalonne comme Offset_Internal, sur des drapeaux connus.
// CPF_ZeroConstructor 0x200, CPF_IsPlainOldData 0x40000000 (champs de FQuat, eux aussi CPF_SaveGame), CPF_SaveGame
// 0x1000000 : FGTrainStationIdentifier.mStationName est sauvegarde (vu dans une sauvegarde le 23/10/2026), comme le mode
// des quais (FGBuildableTrainPlatformCargo.mIsInLoadMode) ; AActor.Tags est editable (CPF_Edit 0x1,
// CPF_BlueprintVisible 0x4, CPF_ZeroConstructor). Releve du 23/10/2026 : PropertyFlags a 0x38, juste avant
// Offset_Internal (0x44).
const CPF_SAVEGAME = uint64(0x1000000);
let propertyFlagsField = null;
function propertyFlagsOffset() {
  if (propertyFlagsField !== null) return propertyFlagsField;
  const quat = requireStruct('/Script/CoreUObject.Quat');
  const quatProps = ['X', 'Y', 'Z', 'W'].map((n) => findProperty(quat, n));
  const ident = findProperty(requireStruct('/Script/FactoryGame.FGTrainStationIdentifier'), 'mStationName');
  const tags = findProperty(requireStruct('/Script/Engine.Actor'), 'Tags');
  const load = findProperty(requireStruct('/Script/FactoryGame.FGBuildableTrainPlatformCargo'), 'mIsInLoadMode');
  const has = (p, o, mask) => !p.add(o).readU64().and(uint64(mask)).equals(0);
  const hits = [];
  for (let o = 0x20; o < 0x100; o += 8) {
    try {
      // Pas de condition sur le CPF_SaveGame de Tags : l'agent le pose, et il reste pose en memoire quand l'hote redemarre
      if (quatProps.every((p) => has(p, o, 0x200) && has(p, o, 0x40000000) && has(p, o, 0x1000000))
        && has(ident, o, 0x1000000) && has(load, o, 0x1000000) && has(tags, o, 0x1) && has(tags, o, 0x4)
        && has(tags, o, 0x200)) hits.push(o);
    } catch (e) { /* lecture hors zone */ }
  }
  if (hits.length !== 1) throw new Error('etalonnage FProperty::PropertyFlags : ' + hits.length + ' candidats ' + JSON.stringify(hits));
  propertyFlagsField = hits[0];
  return propertyFlagsField;
}

function propertyOffset(struct, name) {
  return findProperty(struct, name).add(calibrateReflection().offsetField).readS32();
}

function structSize(struct) {
  return struct.add(calibrateReflection().sizeField).readS32();
}

// Lit des proprietes d'un objet par nom ; types : 'float' | 'double' | 'int' | 'bool' | 'object'
function readProperties(obj, types) {
  const cls = native('getObjectClass')(obj);
  const out = {};
  for (const [name, type] of Object.entries(types)) {
    const p = obj.add(propertyOffset(cls, name));
    out[name] = type === 'float' ? p.readFloat() : type === 'double' ? p.readDouble() : type === 'int' ? p.readS32()
      : type === 'bool' ? p.readU8() !== 0 : p.readPointer();
  }
  return out;
}

// --- Enumeration et lecture generique des champs ---------------------------------------------------
// Toujours sans decalage code en dur. Etalonnage sur des structures dont la disposition est connue a l'avance :
//  - FField::NamePrivate : le FName de X, Y, Z, W dans les FProperty de FQuat ;
//  - FField::Next : X -> Y -> Z -> W ;
//  - UStruct::ChildProperties : tete de cette liste dans FQuat ;
//  - FField::ClassPrivate : FFieldClass commun aux 4 champs, dont le premier membre est le FName "DoubleProperty" ;
//  - FProperty::ElementSize : 8 pour X de FQuat, 24 pour Translation et 32 pour Rotation de FTransform ;
//  - premier membre propre des sous-classes de FProperty (FStructProperty::Struct, FArrayProperty::Inner,
//    FObjectProperty::PropertyClass, FBoolProperty::FieldSize...) : Rotation de FTransform -> FQuat ;
//  - UStruct::SuperStruct : AFGBuildableManufacturer -> AFGBuildableFactory ;
//  - FArrayProperty::Inner (precede de ArrayFlags depuis UE 5.1, donc pas forcement en tete) :
//    GameplayTags de FGameplayTagContainer -> FStructProperty dont la structure est FGameplayTag.

function fnameString(nameAddr) {
  const s = newFString();
  native('fnameToString')(nameAddr, s);
  const out = readFString(s);
  freeFString(s);
  return out;
}

function calibrateFields() {
  if (reflection.nameField !== undefined) return reflection;
  calibrateReflection();
  const quat = requireStruct('/Script/CoreUObject.Quat');
  const names = ['X', 'Y', 'Z', 'W'];
  const props = names.map((n) => findProperty(quat, n));
  const ids = names.map((n) => fname(n).toString());
  const nameField = uniqueOffset(0x8, 0x80, (o) => props.every((p, i) => p.add(o).readU64().toString() === ids[i]), 'FField::NamePrivate');
  // Ordre de chainage non suppose : X -> Y -> Z -> W ou l'inverse. FProperty::PropertyLinkNext chaine aussi les
  // champs, mais c'est un membre de la classe derivee : FField::Next, lui, precede le nom.
  const nextField = uniqueOffset(0x8, nameField, (o) => {
    const at = (i) => props[i].add(o).readPointer();
    return [0, 1, 2].every((i) => at(i).equals(props[i + 1])) || [1, 2, 3].every((i) => at(i).equals(props[i - 1]));
  }, 'FField::Next');
  const childField = uniqueOffset(0x28, 0x200, (o) => {
    const head = quat.add(o).readPointer();
    return o < reflection.sizeField && (head.equals(props[0]) || head.equals(props[3]));
  }, 'UStruct::ChildProperties');
  const doubleId = fname('DoubleProperty').toString();
  const classField = uniqueOffset(0x8, 0x80, (o) => {
    const c = props[0].add(o).readPointer();
    return props.every((p) => p.add(o).readPointer().equals(c)) && c.readU64().toString() === doubleId;
  }, 'FField::ClassPrivate');
  const transform = requireStruct('/Script/CoreUObject.Transform');
  const rotation = findProperty(transform, 'Rotation');
  const translation = findProperty(transform, 'Translation');
  const elementSizeField = uniqueOffset(0x8, 0x80, (o) => props[0].add(o).readS32() === 8
    && translation.add(o).readS32() === 24 && rotation.add(o).readS32() === 32, 'FProperty::ElementSize');
  const derivedField = uniqueOffset(0x30, 0xa0, (o) => rotation.add(o).readPointer().equals(quat), 'FProperty (taille de la base)');
  const manufacturer = native('manufacturerStaticClass')();
  const factory = native('factoryStaticClass')();
  const superField = uniqueOffset(0x28, 0x200, (o) => manufacturer.add(o).readPointer().equals(factory), 'UStruct::SuperStruct');
  const tags = findProperty(requireStruct('/Script/GameplayTags.GameplayTagContainer'), 'GameplayTags');
  const tag = requireStruct('/Script/GameplayTags.GameplayTag');
  const innerField = uniqueOffset(derivedField, derivedField + 0x20, (o) => {
    const inner = tags.add(o).readPointer();
    return !inner.isNull() && inner.add(derivedField).readPointer().equals(tag);
  }, 'FArrayProperty::Inner');
  return Object.assign(reflection, { nameField, nextField, childField, classField, elementSizeField, derivedField, superField, innerField });
}

// FProperty::ArrayDim (nombre d'elements d'un tableau de taille fixe, ex. FVector mConnectionLocations[2] d'un cable),
// etalonne a part : 1 pour les champs de FQuat et FTransform, 2 pour AFGBuildableWire::mConnectionLocations.
let arrayDimField;
function calibrateArrayDim() {
  if (arrayDimField !== undefined) return arrayDimField;
  const quat = requireStruct('/Script/CoreUObject.Quat');
  const singles = ['X', 'Y', 'Z', 'W'].map((n) => findProperty(quat, n));
  const transform = requireStruct('/Script/CoreUObject.Transform');
  singles.push(findProperty(transform, 'Rotation'), findProperty(transform, 'Translation'));
  const wire = findFirstObject('FGBuildableWire', native('uclassStaticClass')());
  if (wire.isNull()) throw new Error('classe FGBuildableWire introuvable pour etalonner FProperty::ArrayDim');
  const pair = findProperty(wire, 'mConnectionLocations');
  arrayDimField = uniqueOffset(0x8, 0x80, (o) => singles.every((p) => p.add(o).readS32() === 1) && pair.add(o).readS32() === 2,
    'FProperty::ArrayDim');
  return arrayDimField;
}

// Champs declares par une structure ou une classe, classes parentes comprises (les plus anciens d'abord)
function fieldsOf(struct) {
  const r = calibrateFields();
  const dimField = calibrateArrayDim();
  const chain = [];
  for (let s = struct; !s.isNull(); s = s.add(r.superField).readPointer()) chain.unshift(s);
  const out = [];
  for (const s of chain) {
    for (let p = s.add(r.childField).readPointer(); !p.isNull(); p = p.add(r.nextField).readPointer()) {
      out.push({
        prop: p,
        name: fnameString(p.add(r.nameField)),
        type: fnameString(p.add(r.classField).readPointer()),
        offset: p.add(r.offsetField).readS32(),
        size: p.add(r.elementSizeField).readS32(),
        dim: p.add(dimField).readS32(),
      });
    }
  }
  return out;
}

// Description d'un champ pour l'affichage : type, et structure / type d'element quand il y en a
function describeField(f) {
  const r = calibrateFields();
  const d = { name: f.name, type: f.type, offset: f.offset, size: f.size, dim: f.dim };
  try {
    if (f.type === 'StructProperty') d.struct = fullName(f.prop.add(r.derivedField).readPointer()).split(' ').pop();
    if (f.type === 'ArrayProperty' || f.type === 'SetProperty') {
      const inner = f.prop.add(f.type === 'ArrayProperty' ? r.innerField : r.derivedField).readPointer();
      d.inner = fnameString(inner.add(r.classField).readPointer());
      if (d.inner === 'StructProperty') d.struct = fullName(inner.add(r.derivedField).readPointer()).split(' ').pop();
    }
  } catch (e) {
    d.error = e.message;
  }
  return d;
}

const READERS = {
  FloatProperty: (a) => a.readFloat(),
  DoubleProperty: (a) => a.readDouble(),
  IntProperty: (a) => a.readS32(),
  UInt32Property: (a) => a.readU32(),
  Int8Property: (a) => a.readS8(),
  Int16Property: (a) => a.readS16(),
  UInt16Property: (a) => a.readU16(),
  Int64Property: (a) => Number(a.readS64().toString()),
  UInt64Property: (a) => Number(a.readU64().toString()),
  ByteProperty: (a) => a.readU8(),
  NameProperty: (a) => fnameString(a),
  StrProperty: (a) => readFString(a),
  Utf8StrProperty: (a) => readUtf8FString(a),
};

// Valeur d'un champ a l'adresse `addr` ; depth limite la descente dans les structures et tableaux
function readField(addr, f, depth, limit) {
  const r = calibrateFields();
  const reader = READERS[f.type];
  if (reader) return reader(addr);
  if (f.type === 'EnumProperty') return f.size === 1 ? addr.readU8() : f.size === 2 ? addr.readU16() : addr.readS32();
  if (f.type === 'BoolProperty') {
    // FBoolProperty : FieldSize, ByteOffset, ByteMask, FieldMask (uint8) en tete de la classe derivee
    const b = f.prop.add(r.derivedField);
    return (addr.add(b.add(1).readU8()).readU8() & b.add(3).readU8()) !== 0;
  }
  if (f.type === 'ObjectProperty' || f.type === 'ClassProperty') {
    const o = addr.readPointer();
    return o.isNull() ? null : fullName(o).split(' ').pop();
  }
  if (f.type === 'StructProperty') {
    const sub = f.prop.add(r.derivedField).readPointer();
    return depth > 0 ? readStruct(addr, sub, depth - 1, limit) : '<' + fullName(sub).split('.').pop() + '>';
  }
  if (f.type === 'ArrayProperty') {
    const data = addr.readPointer();
    const num = addr.add(8).readS32();
    if (depth <= 0) return '<' + num + ' elements>';
    const ip = f.prop.add(r.innerField).readPointer();
    const inner = { prop: ip, name: '', type: fnameString(ip.add(r.classField).readPointer()), offset: 0, size: ip.add(r.elementSizeField).readS32() };
    const out = [];
    for (let i = 0; i < Math.min(num, limit); i++) out.push(readField(data.add(i * inner.size), inner, depth - 1, limit));
    return out;
  }
  return '<' + f.type + '>';
}

// only : liste de noms de champs a lire (premier niveau seulement), sinon tous
function readStruct(addr, struct, depth, limit, only) {
  const out = {};
  for (const f of fieldsOf(struct)) {
    if (only && only.indexOf(f.name) < 0) continue;
    try {
      if (f.dim > 1) {
        const items = [];
        for (let i = 0; i < f.dim; i++) items.push(readField(addr.add(f.offset + i * f.size), f, depth, limit));
        out[f.name] = items;
      } else {
        out[f.name] = readField(addr.add(f.offset), f, depth, limit);
      }
    } catch (e) {
      out[f.name] = '<illisible : ' + e.message + '>';
    }
  }
  return out;
}

// Tous les champs d'un UObject, lus par reflexion
function dumpObject(obj, depth, limit, only) {
  return readStruct(obj, native('getObjectClass')(obj), depth, limit, only);
}

// Ecrit des champs d'un UObject par nom ({ mScrollRotation: 90, mUseCustomEndRotation: true }) ; types numeriques
// et booleens seulement (le booleen respecte son masque : un champ de bits ne touche pas ses voisins)
function writeFields(obj, values) {
  const r = calibrateFields();
  const fields = fieldsOf(native('getObjectClass')(obj));
  for (const [name, value] of Object.entries(values)) {
    const f = fields.find((x) => x.name === name);
    if (!f) throw new Error('champ ' + name + ' introuvable');
    const a = obj.add(f.offset);
    if (f.type === 'IntProperty') a.writeS32(value);
    else if (f.type === 'FloatProperty') a.writeFloat(value);
    else if (f.type === 'DoubleProperty') a.writeDouble(value);
    else if (f.type === 'BoolProperty') {
      const b = f.prop.add(r.derivedField);
      const byte = a.add(b.add(1).readU8());
      const mask = b.add(3).readU8();
      byte.writeU8(value ? (byte.readU8() | mask) : (byte.readU8() & ~mask & 0xff));
    } else throw new Error('ecriture non geree pour ' + name + ' (' + f.type + ')');
  }
}

// obj est-il une instance de cls (ou d'une sous-classe) ?
function isA(obj, cls) {
  if (!isUObject(obj)) return false;
  const objClass = zeroAlloc(8, 8);
  const parent = zeroAlloc(8, 8);
  objClass.ptr.writePointer(native('getObjectClass')(obj));
  parent.ptr.writePointer(cls);
  return native('classIsChildOf')(objClass.ptr, parent.ptr) !== 0;
}

// UObject par chemin complet (ex. "Persistent_Level:PersistentLevel.Build_ConstructorMk1_C_123")
function findObject(path) {
  const obj = native('staticFindObject')(native('uobjectStaticClass')(), NULL, wideString(path), 0);
  return isUObject(obj) ? obj : NULL;
}
