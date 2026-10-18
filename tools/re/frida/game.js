// Commandes executees dans la partie en cours : se situer, se deplacer, sonder le sol, decouvrir
// l'environnement, construire et demonter. Charge apres ue.js et pump.js par host.py.
//
// Survie aux mises a jour du jeu : aucune adresse ni aucun offset du binaire.
//  - fonctions : resolues par nom decore exporte (ue.js) ;
//  - entree de vtable de Construct : retrouvee a l'execution parmi les implementations exportees ;
//  - disposition de FHitResult : calibree sur les valeurs passees au lancer de rayon.
'use strict';

const ECC_VISIBILITY = 3;
const TELEPORT_NONE = 0;
const QUERY_PARAMS = '?DefaultQueryParam@FCollisionQueryParams@@2U1@A';
const RESPONSE_PARAMS = '?DefaultResponseParam@FCollisionResponseParams@@2U1@A';
const PURITY = ['impure', 'normal', 'pure'];
const VTABLE_MAX_SLOTS = 2048;

// Acteurs construits pendant cette session : seuls eux peuvent etre demontes par dismantle()
// (Execute_Dismantle sur un objet sans IFGDismantleInterface ferait planter le jeu).
const builtPaths = new Set();

function r0(v) {
  return { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) };
}

// --- Contexte -----------------------------------------------------------------------------------

function gameContext(subsystem) {
  const world = native('getWorld')(subsystem);
  if (!isUObject(world)) throw new Error('monde introuvable');
  const pawn = native('getPlayerPawn')(subsystem, 0);
  const controller = native('getPlayerController')(subsystem, 0);
  return {
    subsystem,
    world,
    pawn: isUObject(pawn) ? pawn : NULL,
    controller: isUObject(controller) ? controller : NULL,
  };
}

function requirePawn(ctx) {
  if (ctx.pawn.isNull()) throw new Error('aucun personnage joueur');
  return ctx.pawn;
}

// "Classe /Chemin.Complet" -> { cls, path }
function splitFullName(obj) {
  const full = fullName(obj);
  const i = full.indexOf(' ');
  return i < 0 ? { cls: '', path: full } : { cls: full.slice(0, i), path: full.slice(i + 1) };
}

// Position et rotation d'un acteur (pour un pion : position des yeux)
function actorPose(actor) {
  const loc = zeroAlloc(24, 8);
  const rot = zeroAlloc(24, 8);
  native('getActorEyesViewPoint')(actor, loc.ptr, rot.ptr);
  return { location: readVec(loc.ptr), rotation: readRotator(rot.ptr) };
}

function viewPoint(ctx) {
  if (ctx.controller.isNull()) throw new Error('aucun controleur joueur');
  const loc = zeroAlloc(24, 8);
  const rot = zeroAlloc(24, 8);
  native('getPlayerViewPoint')(ctx.controller, loc.ptr, rot.ptr);
  return { location: readVec(loc.ptr), rotation: readRotator(rot.ptr) };
}

// --- Lancer de rayon vertical (altitude du sol) ---------------------------------------------------

const hitLayout = { location: null, normal: null, impactNormal: null, traceStart: null };

function sameVec(a, b) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01;
}

// FHitResult UE5 : ..., Location, ImpactPoint, Normal, ImpactNormal, TraceStart, TraceEnd, ...
// (FVector double de 0x18 chacun). TraceStart/TraceEnd sont retrouves en cherchant les valeurs passees
// au trace, et Location est 4 vecteurs avant TraceStart.
function calibrateHitResult(hit, start, end) {
  if (hitLayout.location !== null) return;
  for (let off = 0x60; off + 0x30 <= 0x1c0; off += 8) {
    if (sameVec(readVec(hit.add(off)), start) && sameVec(readVec(hit.add(off + 0x18)), end)) {
      hitLayout.traceStart = off;
      hitLayout.location = off - 4 * 0x18;
      hitLayout.normal = off - 2 * 0x18;
      hitLayout.impactNormal = off - 0x18;
      return;
    }
  }
  throw new Error('FHitResult : TraceStart introuvable, disposition inconnue');
}

// Lancer de rayon de start vers end. Le FHitResult reste en memoire (hit.ptr) pour etre passe a un hologramme.
function trace(ctx, start, end) {
  const hit = zeroAlloc(0x200, 16);
  const s = newVector(start);
  const e = newVector(end);
  const blocked = native('lineTraceSingleByChannel')(ctx.world, hit.ptr, s.ptr, e.ptr, ECC_VISIBILITY,
    dataExport('engine', QUERY_PARAMS), dataExport('engine', RESPONSE_PARAMS));
  if (blocked === 0) return { blocked: false, hit, location: null };
  calibrateHitResult(hit.ptr, start, end);
  return { blocked: true, hit, location: readVec(hit.ptr.add(hitLayout.location)) };
}

// Altitude du premier obstacle sous (x, y) entre zTop et zBottom, ou null
function traceDown(ctx, x, y, zTop, zBottom) {
  const t = trace(ctx, { x, y, z: zTop }, { x, y, z: zBottom });
  if (!t.blocked) return null;
  const loc = t.location;
  if (Math.abs(loc.x - x) > 1 || Math.abs(loc.y - y) > 1 || loc.z > zTop + 1 || loc.z < zBottom - 1) {
    throw new Error('FHitResult.Location incoherent : ' + JSON.stringify(loc));
  }
  return loc.z;
}

// --- Methodes virtuelles : entree de vtable retrouvee a l'execution -------------------------------
// Appeler l'export d'une methode virtuelle court-circuiterait la redefinition de la classe reelle. On
// parcourt donc la vtable de l'objet a la recherche de l'une des implementations exportees de la methode
// (nom decore : ?Methode@Classe@@<acces>EAA<signature>), a corps unique.
const VIRTUALS = {
  // virtual AActor* Construct(TArray<AActor*>& out_children, FNetConstructionID id) ; id (6 octets) passe par adresse
  construct: {
    method: 'Construct',
    signature: 'PEAVAActor@@AEAV?$TArray@PEAVAActor@@V?$TSizedDefaultAllocator@$0CA@@@@@UFNetConstructionID@@@Z',
    ret: 'pointer',
    args: ['pointer', 'pointer', 'pointer'],
  },
  // virtual void UpdateHologramPlacement(const FHitResult& hit) : ce que le pistolet appelle a chaque frame
  updateHologramPlacement: {
    method: 'UpdateHologramPlacement',
    signature: 'XAEBUFHitResult@@@Z',
    ret: 'void',
    args: ['pointer', 'pointer'],
  },
  // virtual void CheckValidPlacement() : base = CheckClearance ; + accroches, longueur, sol selon la classe
  checkValidPlacement: { method: 'CheckValidPlacement', signature: 'XXZ', ret: 'void', args: ['pointer'] },
  // virtual void CheckCanAfford(UFGInventoryComponent*) : PLANTE le jeu (check) si l'inventaire est nul
  checkCanAfford: { method: 'CheckCanAfford', signature: 'XPEAVUFGInventoryComponent@@@Z', ret: 'void', args: ['pointer', 'pointer'] },
  // virtual bool DoMultiStepPlacement(bool isInputFromARelease) : le clic du pistolet ; true = placement termine
  doMultiStepPlacement: { method: 'DoMultiStepPlacement', signature: '_N_N@Z', ret: 'uint8', args: ['pointer', 'int'] },
  // Machines : vitesse (1.0 = 100 %, bornee par le jeu selon les eclats) et pause
  setPendingPotential: { method: 'SetPendingPotential', signature: 'XM@Z', ret: 'void', args: ['pointer', 'float'] },
  setIsProductionPaused: { method: 'SetIsProductionPaused', signature: 'X_N@Z', ret: 'void', args: ['pointer', 'int'] },
  // virtual float GetCurrentMaxPotential() const : vitesse max selon les eclats inseres
  getCurrentMaxPotential: { method: 'GetCurrentMaxPotential', signature: 'MXZ', ret: 'float', args: ['pointer'] },
  // virtual int32 UFGInventoryComponent::AddStack(const FInventoryStack&, bool allowPartial) : nombre d'objets ajoutes
  addStack: { method: 'AddStack', signature: 'HAEBUFInventoryStack@@_N@Z', ret: 'int', args: ['pointer', 'pointer', 'int'] },
};

const virtualImpls = {};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadVirtualImplementations() {
  const exports = Process.getModuleByName(MOD.game).enumerateExports();
  for (const [key, v] of Object.entries(VIRTUALS)) {
    // [AU]FG : acteurs et objets du jeu ; E[AB]A : methode non const / const
    const re = new RegExp('^\\?' + v.method + '@([AU]FG\\w*)@@[A-Z]E[AB]A' + escapeRegExp(v.signature) + '$');
    const impls = new Map();
    for (const e of exports) {
      const m = re.exec(e.name);
      if (m !== null && sharedExportCount(e.address) === 1) impls.set(e.address.toString(), m[1]);
    }
    virtualImpls[key] = impls;
  }
}

// Zones executables du processus, triees : calculees UNE fois hors du thread du jeu (warmUp). Un appel a
// Process.findRangeByAddress par entree de vtable parcourait toute la carte memoire et a fige le jeu ~1 min.
let codeRanges = null;

function loadCodeRanges() {
  codeRanges = Process.enumerateRanges({ protection: '--x', coalesce: true })
    .map((r) => ({ start: r.base, end: r.base.add(r.size) }))
    .sort((a, b) => a.start.compare(b.start));
}

function isCode(p) {
  let lo = 0;
  let hi = codeRanges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = codeRanges[mid];
    if (p.compare(r.start) < 0) hi = mid - 1;
    else if (p.compare(r.end) >= 0) lo = mid + 1;
    else return true;
  }
  return false;
}

// Tout ce qui est couteux et independant de la partie : a faire sur le thread de Frida, avant les commandes
function warmUp() {
  loadCodeRanges();
  loadVirtualImplementations();
  const impls = {};
  for (const key of Object.keys(VIRTUALS)) impls[key] = virtualImpls[key].size;
  return { codeRanges: codeRanges.length, virtualImpls: impls };
}

const virtualByVtable = new Map();

// Parcourt la vtable de l'objet (elle s'arrete a la premiere entree qui n'est pas du code : le localisateur
// RTTI de la vtable suivante) et exige exactement une entree egale a une implementation exportee de la methode.
function virtualMethod(obj, key) {
  const vtable = obj.readPointer();
  const cacheKey = vtable.toString() + ':' + key;
  let entry = virtualByVtable.get(cacheKey);
  if (entry === undefined) {
    const v = VIRTUALS[key];
    const impls = virtualImpls[key];
    const hits = [];
    for (let i = 0; i < VTABLE_MAX_SLOTS; i++) {
      const slot = vtable.add(i * 8).readPointer();
      if (!isCode(slot)) break;
      const name = impls.get(slot.toString());
      if (name !== undefined) hits.push({ index: i, name, address: slot });
    }
    if (hits.length !== 1) {
      throw new Error(v.method + ' introuvable ou ambigu dans la vtable de ' + fullName(obj) + ' : '
        + JSON.stringify(hits.map((h) => [h.index, h.name])));
    }
    entry = {
      label: hits[0].name + '::' + v.method + ' (vtable[' + hits[0].index + '])',
      fn: new NativeFunction(hits[0].address, v.ret, v.args),
    };
    virtualByVtable.set(cacheKey, entry);
  }
  return entry;
}

// --- Commandes (thread du jeu) ------------------------------------------------------------------

function playerOnGameThread(ctx) {
  const pawn = requirePawn(ctx);
  return {
    pawn: splitFullName(pawn),
    eyes: actorPose(pawn),
    view: ctx.controller.isNull() ? null : viewPoint(ctx),
  };
}

function teleportOnGameThread(ctx, location, yaw) {
  const pawn = requirePawn(ctx);
  const hasYaw = yaw !== undefined && yaw !== null;
  const rot = newRotator({ yaw: hasYaw ? yaw : actorPose(pawn).rotation.yaw });
  const dest = newVector(location);
  // bIsATest = false, bNoCheck = false : le moteur decale la destination si elle est obstruee
  if (native('teleportTo')(pawn, dest.ptr, rot.ptr, 0, 0) === 0) {
    throw new Error('teleportation refusee (destination obstruee ?)');
  }
  if (hasYaw && !ctx.controller.isNull()) native('setControlRotation')(ctx.controller, rot.ptr);
  return { eyes: actorPose(pawn) };
}

// --- Hologramme : creation, placement, validation, construction ----------------------------------

function spawnHologram(ctx, recipePath, location) {
  const instigator = requirePawn(ctx);
  const recipeSlot = zeroAlloc(8, 8); // TSubclassOf<UFGRecipe> passe par adresse
  recipeSlot.ptr.writePointer(requireRecipe(recipePath));
  const spawnAt = newVector(location);
  const noPreSpawn = zeroAlloc(0x40, 16); // TFunction vide : le jeu ne l'appelle que si son premier mot est non nul
  const holo = native('spawnHologramFromRecipe')(recipeSlot.ptr, instigator, spawnAt.ptr, instigator, noPreSpawn.ptr);
  if (!isUObject(holo)) throw new Error('hologramme non cree pour ' + recipePath);
  return holo;
}

// Noms des disqualificateurs courants (ex. FGCDEncroachingClearance) : ce qui rend l'hologramme rouge en jeu
function hologramDisqualifiers(holo) {
  const arr = zeroAlloc(16, 8);
  native('getConstructDisqualifiers')(holo, arr.ptr);
  return takePointerArray(arr.ptr).map((cls) => (isUObject(cls) ? splitFullName(cls).path.split('.').pop() : '?'));
}

function requireInventory(ctx) {
  const inventory = native('playerInventory')(requirePawn(ctx));
  if (!isUObject(inventory)) throw new Error('inventaire du joueur introuvable (requis par la validation)');
  return inventory;
}

// Validation du jeu (placement, chevauchements, cout) avec l'inventaire du joueur : jamais d'inventaire nul.
//  - apres une visee : ValidatePlacementAndCost, comme le pistolet a chaque frame ;
//  - sans visee (transform impose, cable) : ValidatePlacementAndCost s'arreterait sur FGCDInvalidAimLocation
//    sans faire les vrais controles ; on appelle donc directement CheckValidPlacement et CheckCanAfford.
function validateHologram(ctx, holo, aimed) {
  const inventory = requireInventory(ctx);
  if (aimed) {
    native('validatePlacementAndCost')(holo, inventory);
  } else {
    virtualMethod(holo, 'checkValidPlacement').fn(holo);
    virtualMethod(holo, 'checkCanAfford').fn(holo, inventory);
  }
  return hologramDisqualifiers(holo);
}

function constructHologram(ctx, holo) {
  const construct = virtualMethod(holo, 'construct');
  const id = zeroAlloc(8, 8);
  native('getNewNetConstructionID')(ctx.subsystem, id.ptr);
  const children = zeroAlloc(16, 8);
  const actor = construct.fn(holo, children.ptr, id.ptr);
  const childActors = takePointerArray(children.ptr);
  if (!isUObject(actor)) throw new Error('Construct n\'a rien cree (' + construct.label + ')');
  const built = splitFullName(actor);
  builtPaths.add(built.path);
  for (const c of childActors) if (isUObject(c)) builtPaths.add(splitFullName(c).path);
  return {
    actor: built.path,
    class: built.cls,
    construct: construct.label,
    children: childActors.map((c) => (isUObject(c) ? splitFullName(c).path : null)),
    pose: actorPose(actor),
  };
}

// Constructions gratuites (choix utilisateur) : le cout n'est jamais bloquant
const IGNORED_BY_DEFAULT = ['FGCDUnaffordable'];

// place(holo) positionne l'hologramme ; ensuite validation, puis construction si le jeu l'autorise.
// opts.dryRun : ne construit jamais. opts.ignore : disqualificateurs acceptes en plus du cout
// (ex. FGCDInvalidFloor pour un element en l'air). opts.force : construit malgre tout.
function placeValidateConstruct(ctx, recipePath, spawnAt, place, opts) {
  const holo = spawnHologram(ctx, recipePath, spawnAt);
  try {
    native('resetConstructDisqualifiers')(holo);
    const placement = place(holo) || {};
    const disqualifiers = validateHologram(ctx, holo, placement.mode === 'aim');
    const ignored = IGNORED_BY_DEFAULT.concat(opts.ignore || []);
    const blocking = disqualifiers.filter((d) => ignored.indexOf(d) < 0);
    const result = Object.assign(placement, { hologram: actorPose(holo), disqualifiers, blocking });
    if (opts.dryRun || (blocking.length > 0 && !opts.force)) return Object.assign(result, { built: false });
    return Object.assign(result, { built: true }, constructHologram(ctx, holo));
  } finally {
    native('destroyActor')(holo, 0, 1);
  }
}

// Gare / quai : la voie integree est un hologramme enfant que le jeu recale sur les connecteurs de quai apres chaque
// visee (AFGTrainStationHologram::SetHologramLocationAndRotation). Avec un transform impose, il faut le faire ici,
// sinon la voie construite a ses deux bouts au meme point
function syncPlatformTrack(holo) {
  if (!isA(holo, native('trainPlatformHologramStaticClass')())) return;
  const cls = native('getObjectClass')(holo);
  const track = holo.add(propertyOffset(cls, 'mRailroadTrackHologram')).readPointer();
  const conns = holo.add(propertyOffset(cls, 'mPlatformConnectionComponents'));
  if (!isUObject(track)) throw new Error('hologramme de quai sans hologramme de voie integree');
  native('trackHologramFromPlatformConnections')(track, conns.readPointer(), conns.add(8).readPointer());
}

// Position libre : transform impose
function buildOnGameThread(ctx, recipePath, location, yaw, opts) {
  return placeValidateConstruct(ctx, recipePath, location, (holo) => {
    const transform = newTransform(location, quatFromYaw(yaw || 0));
    native('setActorTransform')(holo, transform.ptr, 0, NULL, TELEPORT_NONE);
    syncPlatformTrack(holo);
    return { mode: 'transform' };
  }, opts || {});
}

// Quai de fret : chargement (true) ou dechargement (false) ; load omis = lecture seule
function platformLoadModeOnGameThread(path, load) {
  const actor = requireActor(path);
  if (!isA(actor, native('cargoPlatformStaticClass')())) throw new Error(path + ' n\'est pas un quai de fret (AFGBuildableTrainPlatformCargo)');
  if (load != null) native('cargoPlatformSetLoadMode')(actor, load ? 1 : 0);
  return { path: splitFullName(actor).path, load: native('cargoPlatformIsInLoadMode')(actor) !== 0 };
}

// Visee simulee : rayon from -> to, puis UpdateHologramPlacement(hit) comme le pistolet a chaque frame.
// C'est le jeu qui place l'hologramme : accroche aux gisements, grille des fondations, murs...
// opts.scrollRotation : rotation appliquee par le jeu au placement (touche R du pistolet ; 180 retourne un quai accroche)
function buildAimOnGameThread(ctx, recipePath, from, to, opts) {
  const aim = trace(ctx, from, to);
  if (!aim.blocked) throw new Error('la visee ne touche rien entre ' + JSON.stringify(r0(from)) + ' et ' + JSON.stringify(r0(to)));
  return placeValidateConstruct(ctx, recipePath, aim.location, (holo) => {
    if (opts && opts.scrollRotation != null) writeFields(holo, { mScrollRotation: Math.round(opts.scrollRotation) });
    const update = virtualMethod(holo, 'updateHologramPlacement');
    update.fn(holo, aim.hit.ptr);
    return { mode: 'aim', aimHit: r0(aim.location), placement: update.label };
  }, opts || {});
}

function actorsOfClass(ctx, cls) {
  const classSlot = zeroAlloc(8, 8); // TSubclassOf<AActor> passe par adresse
  classSlot.ptr.writePointer(cls);
  const arr = zeroAlloc(16, 8);
  native('getAllActorsOfClass')(ctx.subsystem, classSlot.ptr, arr.ptr);
  return takePointerArray(arr.ptr);
}

// Demonte un batiment par le chemin du demonteur du jeu (IFGDismantleInterface).
// Garde-fous : la cible doit etre un AFGBuildable (Execute_Dismantle sur un autre objet ferait planter le jeu),
// et un batiment non construit par cette session exige force = true.
// --- Electricite --------------------------------------------------------------------------------

const POWER_LINE_RECIPE = '/Game/FactoryGame/Recipes/Buildings/Recipe_PowerLine.Recipe_PowerLine_C';

function componentOfClass(actor, cls) {
  const classSlot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  classSlot.ptr.writePointer(cls);
  const comp = native('findComponentByClass')(actor, classSlot.ptr);
  return isUObject(comp) ? comp : NULL;
}

function requireActor(path) {
  const actor = findObject(path);
  if (actor.isNull()) throw new Error('objet introuvable : ' + path);
  return actor;
}

function powerStatus(actor) {
  const circuit = componentOfClass(actor, native('circuitConnectionStaticClass')());
  if (circuit.isNull()) return { connector: null };
  const status = {
    connector: splitFullName(circuit).path.split('.').pop(),
    wires: native('getNumConnections')(circuit),
    maxWires: native('getMaxNumConnections')(circuit),
    circuitId: native('getCircuitID')(circuit),
  };
  // HasPower seulement via un vrai UFGPowerConnectionComponent (FindComponentByClass filtre la classe)
  const power = componentOfClass(actor, native('powerConnectionStaticClass')());
  if (!power.isNull()) {
    const info = native('getPowerInfo')(power);
    if (isUObject(info)) status.hasPower = native('powerInfoHasPower')(info) !== 0;
  }
  return status;
}

// Cable entre les connecteurs electriques de deux batiments, valide par le jeu (longueur, connecteur plein,
// cable deja existant) puis construit par AFGWireHologram::Construct -> AFGBuildableWire::Connect.
function wireOnGameThread(ctx, fromPath, toPath, opts) {
  const from = requireActor(fromPath);
  const to = requireActor(toPath);
  const circuitClass = native('circuitConnectionStaticClass')();
  const fromConn = componentOfClass(from, circuitClass);
  const toConn = componentOfClass(to, circuitClass);
  if (fromConn.isNull()) throw new Error('aucun connecteur electrique sur ' + fromPath);
  if (toConn.isNull()) throw new Error('aucun connecteur electrique sur ' + toPath);
  return placeValidateConstruct(ctx, POWER_LINE_RECIPE, actorPose(from).location, (holo) => {
    const construct = virtualMethod(holo, 'construct');
    if (construct.label.indexOf('AFGWireHologram::') !== 0) {
      throw new Error('l\'hologramme n\'est pas un AFGWireHologram : ' + construct.label);
    }
    native('wireHologramSetConnection')(holo, 0, fromConn);
    native('wireHologramSetConnection')(holo, 1, toConn);
    return { mode: 'wire', from: powerStatus(from), to: powerStatus(to) };
  }, opts || {});
}

// --- Convoyeurs ---------------------------------------------------------------------------------

const CONNECTION_DIRECTION = ['input', 'output', 'any', 'snap-only'];

function factoryConnections(actor) {
  const classSlot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  classSlot.ptr.writePointer(native('factoryConnectionStaticClass')());
  const arr = zeroAlloc(16, 8);
  native('getComponentsByClass')(actor, arr.ptr, classSlot.ptr);
  return takePointerArray(arr.ptr).filter(isUObject).map((comp) => {
    const loc = zeroAlloc(24, 8);
    const normal = zeroAlloc(24, 8);
    native('getConnectorLocation')(comp, loc.ptr, 0);
    native('getConnectorNormal')(comp, normal.ptr);
    return {
      comp,
      name: splitFullName(comp).path.split('.').pop(),
      direction: CONNECTION_DIRECTION[native('getConnectionDirection')(comp)] || 'inconnue',
      connected: native('isConnectionConnected')(comp) !== 0,
      location: readVec(loc.ptr),
      normal: readVec(normal.ptr),
    };
  });
}

// Raccords de tuyau (UFGPipeConnectionComponentBase) : ses fonctions ne sont pas exportees ; classe retrouvee par son
// nom, position et orientation par les fonctions du composant de scene, liaison lue dans mConnectedComponent
const PIPE_CONNECTION_TYPE = ['tuyau', 'tuyau-consommateur', 'tuyau-producteur'];
function pipeConnections(actor) {
  const cls = findFirstObject('FGPipeConnectionComponentBase', native('uclassStaticClass')());
  if (cls.isNull()) return [];
  const classSlot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  classSlot.ptr.writePointer(cls);
  const arr = zeroAlloc(16, 8);
  native('getComponentsByClass')(actor, arr.ptr, classSlot.ptr);
  return takePointerArray(arr.ptr).filter(isUObject).map((comp) => {
    const loc = zeroAlloc(24, 8);
    const fwd = zeroAlloc(24, 8);
    native('sceneComponentLocation')(comp, loc.ptr);
    native('sceneComponentForward')(comp, fwd.ptr);
    const cls = native('getObjectClass')(comp);
    const type = comp.add(propertyOffset(cls, 'mPipeConnectionType')).readU8();
    const linked = comp.add(propertyOffset(cls, 'mConnectedComponent')).readPointer();
    return {
      comp,
      name: splitFullName(comp).path.split('.').pop(),
      direction: PIPE_CONNECTION_TYPE[type] || 'tuyau',
      connected: isUObject(linked),
      location: readVec(loc.ptr),
      normal: readVec(fwd.ptr),
    };
  });
}

// Connecteurs de convoyeur et de tuyau d'un acteur
function allConnections(actor) {
  return factoryConnections(actor).concat(pipeConnections(actor));
}

function requireConnection(path, name) {
  const conn = allConnections(requireActor(path)).find((c) => c.name === name);
  if (conn === undefined) throw new Error('connecteur ' + name + ' introuvable sur ' + path);
  if (conn.connected) throw new Error('connecteur ' + name + ' deja branche sur ' + path);
  return conn;
}

// Vise un connecteur. Le jeu (FindOverlappingConnections) retient le connecteur libre le plus proche du POINT
// TOUCHE dans une sphere de 3 m : le rayon doit donc toucher juste au connecteur, pas un batiment voisin.
// Rayon court partant 30 uu devant le connecteur et entrant dans son batiment ; a defaut, rayon vertical.
function aimAtConnector(ctx, conn) {
  const l = conn.location;
  const n = conn.normal;
  const along = trace(ctx, { x: l.x + n.x * 30, y: l.y + n.y * 30, z: l.z + n.z * 30 },
    { x: l.x - n.x * 150, y: l.y - n.y * 150, z: l.z - n.z * 150 });
  if (along.blocked) return along;
  const vertical = trace(ctx, { x: l.x, y: l.y, z: l.z + 100 }, { x: l.x, y: l.y, z: l.z - 200 });
  if (vertical.blocked) return vertical;
  throw new Error('la visee du connecteur ' + conn.name + ' ne touche rien');
}

function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

const BELT_MAX_CLICKS = 4;

// Convoyeur pose comme le pistolet : visee du connecteur de depart (accroche), clic, puis visee de l'arrivee
// et clics jusqu'a ce que le jeu declare le placement termine. Arrivee :
//  - { path, name } : connecteur d'un batiment (accroche, aucun poteau) ;
//  - { x, y, z }    : point libre vise depuis le dessus ; le jeu ajoute un poteau en bout (etape de hauteur).
// Entre deux clics, validation du jeu : CanConstruct en depend pour l'etape du poteau.
function beltOnGameThread(ctx, recipePath, fromPath, fromName, to, opts) {
  const start = requireConnection(fromPath, fromName);
  let endConn = null;
  const endAim = () => {
    if (to.path !== undefined) {
      const conn = requireConnection(to.path, to.name);
      try {
        return aimAtConnector(ctx, conn);
      } catch (e) {
        const l = conn.location, n = conn.normal;
        endConn = conn;
        return actorHit(ctx, requireActor(to.path), { x: l.x - n.x * 20, y: l.y - n.y * 20, z: l.z });
      }
    }
    const aim = trace(ctx, { x: to.x, y: to.y, z: to.z + 1000 }, { x: to.x, y: to.y, z: to.z - 1000 });
    if (!aim.blocked) throw new Error('rien sous le point d\'arrivee ' + JSON.stringify(r0(to)));
    return aim;
  };
  return placeValidateConstruct(ctx, recipePath, start.location, (holo) => {
    const update = virtualMethod(holo, 'updateHologramPlacement');
    const click = virtualMethod(holo, 'doMultiStepPlacement');
    const inventory = requireInventory(ctx);
    // Depart : une accroche reussie amene l'hologramme sur le connecteur (a la longueur du bras pres pour
    // un ascenseur : opts.snapTolerance). Loin du joueur, les batiments n'ont pas de collision : le point touche est
    // alors fabrique sur le batiment de depart (actorHit), juste devant le connecteur.
    // Le jeu cherche alors le connecteur par recouvrement (collision absente) : on inscrit nous-memes les connecteurs
    // accroches dans mSnappedConnectionComponents[0 | 1], sinon le troncon serait pose au bon endroit mais pas raccorde.
    const snapSlots = holo.add(propertyOffset(native('getObjectClass')(holo), 'mSnappedConnectionComponents'));
    let startAim;
    let fabricated = false;
    try {
      startAim = aimAtConnector(ctx, start);
    } catch (e) {
      const l = start.location, n = start.normal;
      startAim = actorHit(ctx, requireActor(fromPath), { x: l.x - n.x * 20, y: l.y - n.y * 20, z: l.z });
      fabricated = true;
    }
    update.fn(holo, startAim.hit.ptr);
    if (fabricated && snapSlots.readPointer().isNull()) snapSlots.writePointer(start.comp);
    const snapped = distance(actorPose(holo).location, start.location);
    const tolerance = (opts && opts.snapTolerance) || 5;
    if (snapped > tolerance) throw new Error('accroche au depart echouee (' + Math.round(snapped) + ' uu du connecteur ' + fromName + ')');
    if (click.fn(holo, 0) !== 0) throw new Error('placement termine des le depart : etat de l\'hologramme inattendu');
    // Arrivee : visee, validation, clic... jusqu'a la fin du placement. opts.endScroll : rotation de la molette pour
    // l'arrivee (ascenseur : 180 tourne la sortie du bas a l'oppose de celle du haut)
    if (opts && opts.endScroll != null) writeFields(holo, { mScrollRotation: Math.round(opts.endScroll) });
    const aim = endAim();
    for (let clicks = 1; clicks <= BELT_MAX_CLICKS; clicks++) {
      update.fn(holo, aim.hit.ptr);
      if (endConn !== null && snapSlots.add(8).readPointer().isNull()) snapSlots.add(8).writePointer(endConn.comp);
      native('resetConstructDisqualifiers')(holo);
      native('validatePlacementAndCost')(holo, inventory);
      if (click.fn(holo, 0) !== 0) {
        native('resetConstructDisqualifiers')(holo);
        return { mode: 'aim', from: fromName, to: to.path !== undefined ? to.name : r0(aim.location), clicks: clicks + 1 };
      }
    }
    throw new Error('placement non termine apres ' + (BELT_MAX_CLICKS + 1) + ' clics ; disqualificateurs : '
      + JSON.stringify(hologramDisqualifiers(holo)));
  }, opts || {});
}

// --- Chemin de fer --------------------------------------------------------------------------------

const compName = (comp) => splitFullName(comp).path.split('.').pop();
const pathOrNull = (obj) => (isUObject(obj) ? splitFullName(obj).path : null);

// Bloc de signalisation du jeu auquel appartient un connecteur (identifiant = adresse de l'objet bloc, stable tant
// que le bloc existe ; null hors bloc). Le TWeakPtr copie incremente le compteur faible du bloc sans qu'on puisse
// appeler son destructeur (inline) : TEMP -- fuite d'un compteur par lecture, negligeable pour des audits ponctuels ;
// a remplacer par la lecture du champ du connecteur par reflexion si le bloc y est expose.
function signalBlockId(comp) {
  const weak = zeroAlloc(16, 8);
  native('railConnSignalBlock')(comp, weak.ptr);
  const obj = weak.ptr.readPointer();
  return obj.isNull() ? null : obj.toString();
}

// Connecteurs de rail d'un acteur (rail, rail integre d'une gare ou d'un quai) : position, normale (vers l'exterieur),
// rails raccordes (plusieurs = aiguillage), gare, signaux
function trackConnections(actor) {
  const classSlot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  classSlot.ptr.writePointer(native('railConnStaticClass')());
  const arr = zeroAlloc(16, 8);
  native('getComponentsByClass')(actor, arr.ptr, classSlot.ptr);
  return takePointerArray(arr.ptr).filter(isUObject).map((comp) => {
    const loc = zeroAlloc(24, 8);
    const normal = zeroAlloc(24, 8);
    native('railConnLocation')(comp, loc.ptr);
    native('railConnNormal')(comp, normal.ptr);
    const links = zeroAlloc(16, 8);
    native('railConnConnections')(comp, links.ptr);
    return {
      comp,
      name: compName(comp),
      location: readVec(loc.ptr),
      normal: readVec(normal.ptr),
      connections: takePointerArray(links.ptr).filter(isUObject)
        .map((other) => ({ track: pathOrNull(native('railConnTrack')(other)), name: compName(other) })),
      station: pathOrNull(native('railConnStation')(comp)),
      facingSignal: pathOrNull(native('railConnFacingSignal')(comp)),
      trailingSignal: pathOrNull(native('railConnTrailingSignal')(comp)),
      switchPositions: native('railConnSwitchPositions')(comp),
      block: signalBlockId(comp),
    };
  });
}

const publicConnection = ({ comp, ...rest }) => Object.assign(rest, { location: r0(rest.location), yaw: Math.round(Math.atan2(rest.normal.y, rest.normal.x) * 1800 / Math.PI) / 10 });

function railInfo(path) {
  const actor = requireActor(path);
  if (!isA(actor, native('railTrackStaticClass')())) {
    return { path, class: splitFullName(actor).cls, connections: trackConnections(actor).map(publicConnection) };
  }
  return {
    path,
    class: splitFullName(actor).cls,
    length: Math.round(native('railTrackLength')(actor)),
    graph: native('railTrackGraphId')(actor),
    connections: trackConnections(actor).map(publicConnection),
  };
}

// Bouts de voie libres (aucun rail raccorde) autour d'un point, les plus proches d'abord
function railEndsOnGameThread(ctx, center, radius, limit) {
  const origin = center || actorPose(requirePawn(ctx)).location;
  const found = [];
  for (const t of actorsOfClass(ctx, native('railTrackStaticClass')())) {
    if (!isUObject(t)) continue;
    const p = actorPose(t).location;
    if (radius && Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z) > radius + 10000) continue;
    for (const c of trackConnections(t)) {
      if (c.connections.length) continue;
      const d = Math.hypot(c.location.x - origin.x, c.location.y - origin.y, c.location.z - origin.z);
      if (radius && d > radius) continue;
      found.push(Object.assign(publicConnection(c), { track: splitFullName(t).path, class: splitFullName(t).cls, distance: Math.round(d) }));
    }
  }
  found.sort((a, b) => a.distance - b.distance);
  return { origin: r0(origin), total: found.length, ends: found.slice(0, limit || 20) };
}

function requireRailConnection(path, name) {
  const conn = trackConnections(requireActor(path)).find((c) => c.name === name);
  if (conn === undefined) throw new Error('connecteur de rail ' + name + ' introuvable sur ' + path);
  return conn;
}

// Point touche fabrique sur un acteur, sans rayon jusqu'a lui : le jeu ne garde les collisions de ses batiments
// qu'autour du joueur (au-dela d'environ 100 m, un rayon traverse les rails). Les accroches de rail et de signal
// (TrySnapToActor) ne lisent que l'acteur touche (FHitResult.HitObjectHandle) et le point : on part de la visee du point
// (rayon vers le relief, charge bien plus loin) et on y ecrit l'acteur avec l'operateur d'affectation du jeu.
// Ne vaut pas pour l'arrivee d'un rail : TryFindAndSnapToOverlappingConnection cherche les connecteurs par collision.
let hitHandleOffset = null;
function actorHit(ctx, actor, p) {
  if (hitHandleOffset === null) {
    const field = fieldsOf(findFirstObject('HitResult')).find((f) => f.name === 'HitObjectHandle');
    if (!field) throw new Error('FHitResult.HitObjectHandle introuvable par reflexion');
    hitHandleOffset = field.offset;
  }
  const t = pointAim(ctx, p);
  native('actorInstanceHandleAssign')(t.hit.ptr.add(hitHandleOffset), actor);
  return t;
}

// Visee d'un bout de voie : point 1 m a l'interieur du rail. Le jeu accroche alors l'extremite la plus proche du point
function aimAtRailEnd(ctx, conn) {
  const l = conn.location;
  const n = conn.normal;
  return actorHit(ctx, native('railConnTrack')(conn.comp), { x: l.x - n.x * 100, y: l.y - n.y * 100, z: l.z });
}

// Bout de rail vise a un aiguillage (plusieurs connecteurs au meme point) : le point touche est replace 10 cm a
// l'exterieur du connecteur voulu (du cote ou pointe sa normale), sur le rail touche.
//  - depart : AFGRailroadTrackHologram::TrySnapToActor prend le bout du rail touche le plus proche, puis passe au
//    connecteur d'en face (rail voisin) si le point touche est du cote interieur ;
//  - arrivee : UFGRailroadTrackConnectionComponent::FindClosestOverlappingConnection retient le connecteur dont le point
//    situe 5 cm devant lui (le long de sa normale) est le plus proche du point touche.
function aimAtRailEndForTrack(ctx, conn) {
  const l = conn.location;
  const n = conn.normal;
  return actorHit(ctx, native('railConnTrack')(conn.comp), { x: l.x + n.x * 10, y: l.y + n.y * 10, z: l.z + n.z * 10 });
}

// Visee d'un point exact, meme en l'air (voie sur pylones) : rayon vers le sol sous le point, puis point d'impact
// remplace par le point voulu (Location et ImpactPoint, ranges l'un apres l'autre dans FHitResult) et normales mises a
// la verticale (sinon le jeu incline le bout de voie comme le sol touche, loin en dessous). Si le rayon touche une
// fondation, le jeu recale le point sur sa grille comme avec le pistolet.
// Le rayon part 50 cm au-dessus du point : plus haut, il toucherait ce qui surplombe le point (quai au-dessus d'une voie
// en contrebas) et l'hologramme s'y accrocherait.
function pointAim(ctx, p) {
  const t = trace(ctx, { x: p.x, y: p.y, z: p.z + 50 }, { x: p.x, y: p.y, z: p.z - 100000 });
  if (!t.blocked) throw new Error('rien sous le point ' + JSON.stringify(r0(p)));
  writeVector(t.hit.ptr.add(hitLayout.location), p);
  writeVector(t.hit.ptr.add(hitLayout.location + 0x18), p);
  writeVector(t.hit.ptr.add(hitLayout.normal), { x: 0, y: 0, z: 1 });
  writeVector(t.hit.ptr.add(hitLayout.impactNormal), { x: 0, y: 0, z: 1 });
  return Object.assign(t, { location: { x: p.x, y: p.y, z: p.z } });
}

function snappedRailConnections(holo) {
  const at = holo.add(propertyOffset(native('getObjectClass')(holo), 'mSnappedConnectionComponents'));
  return [at.readPointer(), at.add(8).readPointer()];
}

// Rail pose comme le pistolet : visee du depart (bout de voie ou point libre), clic, visee de l'arrivee, clic.
//  - from / to = { path, name } : connecteur d'un rail (accroche verifiee) ;
//  - from / to = { x, y, z, yaw } : point libre au sol ; yaw = direction de la voie en ce point (degres), imposee par
//    la rotation de l'hologramme (mScrollRotation, arrondie au pas de rotation du jeu).
// Le jeu trace la courbe et la valide (longueur, rayon de courbure, pente) : disqualificateurs FGCD...
function railOnGameThread(ctx, recipe, from, to, opts) {
  const isConn = (e) => e && e.path !== undefined;
  const startConn = isConn(from) ? requireRailConnection(from.path, from.name) : null;
  const endConn = isConn(to) ? requireRailConnection(to.path, to.name) : null;
  const groundAim = (p) => pointAim(ctx, p);
  const spawnAt = startConn ? startConn.location : from;
  return placeValidateConstruct(ctx, recipe || 'Recipe_RailroadTrack_C', spawnAt, (holo) => {
    const update = virtualMethod(holo, 'updateHologramPlacement');
    const click = virtualMethod(holo, 'doMultiStepPlacement');
    const inventory = requireInventory(ctx);
    if (!startConn) writeFields(holo, { mScrollRotation: Math.round(from.yaw || 0) });
    update.fn(holo, (startConn ? aimAtRailEndForTrack(ctx, startConn) : groundAim(from)).hit.ptr);
    if (startConn && !snappedRailConnections(holo)[0].equals(startConn.comp)) {
      const got = snappedRailConnections(holo)[0];
      throw new Error('accroche au depart echouee : ' + (isUObject(got) ? compName(got) + ' de ' + pathOrNull(native('railConnTrack')(got)) : 'aucun bout de voie'));
    }
    if (click.fn(holo, 0) !== 0) throw new Error('placement termine des le depart : etat de l\'hologramme inattendu');
    if (!endConn) writeFields(holo, { mScrollRotation: Math.round(to.yaw || 0), mUseCustomEndRotation: true });
    update.fn(holo, (endConn ? aimAtRailEndForTrack(ctx, endConn) : groundAim(to)).hit.ptr);
    let endForced = false;
    if (endConn && !snappedRailConnections(holo)[1].equals(endConn.comp)) {
      const got = snappedRailConnections(holo)[1];
      if (isUObject(got)) throw new Error('accroche a l\'arrivee echouee : ' + compName(got) + ' de ' + pathOrNull(native('railConnTrack')(got)));
      // Aucun connecteur trouve : l'arrivee le cherche par collision (FindClosestOverlappingConnection), et loin du joueur
      // le jeu n'a pas les collisions du joint. Meme geometrie qu'une accroche : bout de voie pose exactement sur le
      // connecteur, dans son prolongement (cap = oppose de sa normale, au pas de rotation de 10 deg), puis connecteur ecrit
      // dans mSnappedConnectionComponents[1], que Construct raccorde
      const n = endConn.normal;
      const yaw = Math.atan2(-n.y, -n.x) * 180 / Math.PI;
      if (Math.abs(n.z) > 0.01 || Math.abs(yaw - Math.round(yaw / 10) * 10) > 0.5) {
        throw new Error('accroche a l\'arrivee impossible hors de portee : connecteur ' + endConn.name + ' en pente ou hors du pas de 10 deg');
      }
      writeFields(holo, { mScrollRotation: Math.round(yaw), mUseCustomEndRotation: true });
      update.fn(holo, groundAim(endConn.location).hit.ptr);
      holo.add(propertyOffset(native('getObjectClass')(holo), 'mSnappedConnectionComponents')).add(8).writePointer(endConn.comp);
      endForced = true;
    }
    native('resetConstructDisqualifiers')(holo);
    native('validatePlacementAndCost')(holo, inventory);
    const spline = dumpObject(holo, 3, 50, ['mSplineData']).mSplineData;
    const rules = readProperties(holo, { mMinLength: 'float', mMaxLength: 'float', mMinBendRadius: 'float', mMaxGrade: 'float' });
    if (click.fn(holo, 0) === 0) throw new Error('placement non termine apres 2 clics ; disqualificateurs : ' + JSON.stringify(hologramDisqualifiers(holo)));
    native('resetConstructDisqualifiers')(holo);
    return {
      mode: 'aim',
      from: startConn ? startConn.name : r0(from),
      to: endConn ? endConn.name : r0(to),
      endForced,
      rules,
      spline,
    };
  }, opts || {});
}

// Signal pose comme le pistolet sur un joint de rails. guard = connecteur dont les trains SORTANTS sont arretes par le
// signal (le jeu garde aussi les branches soeurs situees du meme cote du joint). Le jeu decide du sens par la rotation de
// l'hologramme : mScrollRotation 0 = cote du rail vise. Cote d'affichage (gauche / droite) : opts.leftHanded, sinon
// celui du signal oppose deja present sur le joint (le jeu refuse deux signaux opposes de cotes differents), sinon droite.
// Le jeu refuse : signal deja present dans ce sens, bout de voie (FGCDSignalCannotBePlaceAtTheEndOfATrack).
function signalOnGameThread(ctx, recipe, guard, opts) {
  const conn = requireRailConnection(guard.path, guard.name);
  const options = opts || {};
  return placeValidateConstruct(ctx, recipe || 'Recipe_RailroadBlockSignal_C', conn.location, (holo) => {
    if (!isA(holo, native('signalHologramStaticClass')())) throw new Error((recipe || '') + ' ne donne pas un hologramme de signal');
    const update = virtualMethod(holo, 'updateHologramPlacement');
    const left = options.leftHanded != null ? !!options.leftHanded
      : conn.trailingSignal ? readProperties(requireActor(conn.trailingSignal), { mIsLeftHanded: 'bool' }).mIsLeftHanded : false;
    writeFields(holo, { mScrollRotation: 0 });
    native('signalSetLeftHanded')(holo, left ? 1 : 0);
    update.fn(holo, aimAtRailEnd(ctx, conn).hit.ptr);
    const snapped = holo.add(propertyOffset(native('getObjectClass')(holo), 'mSnappedConnection')).readPointer();
    // Branche soeur (meme joint, meme cote) : rails superposes pres d'une convergence, la visee touche l'autre branche.
    // Le jeu gardant toutes les branches soeurs du joint, le resultat est le meme
    const sibling = isUObject(snapped) && !snapped.equals(conn.comp) && (() => {
      const s = trackConnections(native('railConnTrack')(snapped)).find((c) => c.comp.equals(snapped));
      return s && distance(s.location, conn.location) < 10 && s.normal.x * conn.normal.x + s.normal.y * conn.normal.y + s.normal.z * conn.normal.z > 0.9;
    })();
    if (!snapped.equals(conn.comp) && !sibling) {
      throw new Error('accroche du signal echouee : ' + (isUObject(snapped) ? compName(snapped) + ' de ' + pathOrNull(native('railConnTrack')(snapped)) : 'pas sur un joint (rail non touche par la visee ?)'));
    }
    return { mode: 'aim', guard: guard.name, leftHanded: left, viaSibling: sibling ? pathOrNull(native('railConnTrack')(snapped)) + '.' + compName(snapped) : null };
  }, options);
}

// --- Machines -----------------------------------------------------------------------------------

function requireFactory(path) {
  const actor = requireActor(path);
  if (!isA(actor, native('factoryStaticClass')())) throw new Error(path + ' n\'est pas une machine (AFGBuildableFactory)');
  return actor;
}

function className(cls) {
  return isUObject(cls) ? splitFullName(cls).path.split('.').pop() : null;
}

function availableRecipes(actor) {
  const arr = zeroAlloc(16, 8);
  native('getAvailableRecipes')(actor, arr.ptr);
  return takePointerArray(arr.ptr).filter(isUObject);
}

const POWER_SHARD = '/Game/FactoryGame/Resource/Environment/Crystal/Desc_CrystalShard.Desc_CrystalShard_C';

function itemCount(inventory, itemClass) {
  const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  slot.ptr.writePointer(itemClass);
  return native('inventoryNumItems')(inventory, slot.ptr);
}

function machineStatus(actor) {
  const status = {
    class: splitFullName(actor).cls,
    pendingPotential: native('getPendingPotential')(actor),
    currentPotential: native('getCurrentPotential')(actor),
    maxPotential: virtualMethod(actor, 'getCurrentMaxPotential').fn(actor),
    paused: native('isProductionPaused')(actor) !== 0,
    power: powerStatus(actor),
  };
  const potentialInventory = native('getPotentialInventory')(actor);
  if (isUObject(potentialInventory)) status.powerShards = itemCount(potentialInventory, loadClass(POWER_SHARD));
  if (isA(actor, native('manufacturerStaticClass')())) {
    const recipe = zeroAlloc(8, 8);
    native('getCurrentRecipe')(actor, recipe.ptr);
    status.recipe = className(recipe.ptr.readPointer());
    status.availableRecipes = availableRecipes(actor).map(className);
  }
  return status;
}

// Recette par nom court (Recipe_IronPlate_C) ou chemin complet, parmi les recettes debloquees de la machine
function setRecipeOnGameThread(path, recipe) {
  const actor = requireFactory(path);
  if (!isA(actor, native('manufacturerStaticClass')())) throw new Error(path + ' n\'a pas de recette (pas un AFGBuildableManufacturer)');
  const wanted = recipe.split('.').pop();
  const cls = availableRecipes(actor).find((c) => className(c) === wanted);
  if (cls === undefined) throw new Error('recette ' + wanted + ' non disponible pour cette machine');
  const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  slot.ptr.writePointer(cls);
  native('setRecipe')(actor, slot.ptr);
  // SetRecipe ne fait rien si l'inventaire d'entree n'est pas vide : on relit pour confirmer
  const status = machineStatus(actor);
  if (status.recipe !== wanted) throw new Error('recette refusee par le jeu (inventaire d\'entree non vide ?), actuelle : ' + status.recipe);
  return status;
}

// --- Recettes : lues dans le jeu -----------------------------------------------------------------

function classSlotOf(cls) {
  const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  slot.ptr.writePointer(cls);
  return slot;
}

function isSubclass(cls, parent) {
  return native('classIsChildOf')(classSlotOf(cls).ptr, classSlotOf(parent).ptr) !== 0;
}

// TArray<FItemAmount> rendu par le jeu : disposition de FItemAmount par reflexion, buffer libere ensuite
function takeItemAmounts(arr) {
  const st = requireStruct('/Script/FactoryGame.ItemAmount');
  const size = structSize(st);
  const offClass = propertyOffset(st, 'ItemClass');
  const offAmount = propertyOffset(st, 'Amount');
  const data = arr.readPointer();
  const num = arr.add(8).readS32();
  const out = [];
  for (let i = 0; i < num; i++) {
    const e = data.add(i * size);
    out.push({ item: className(e.add(offClass).readPointer()), amount: e.add(offAmount).readS32() });
  }
  if (!data.isNull()) fnFree(data);
  return out;
}

// Recette par chemin complet (charge la classe) ou par nom court (Recipe_ConstructorMk1_C : recettes deja chargees,
// ce qui est le cas de toutes celles que le joueur a debloquees)
function requireRecipe(name) {
  const cls = name.indexOf('/') >= 0 ? loadClass(name) : findFirstObject(name, native('uclassStaticClass')());
  if (cls.isNull() || !isSubclass(cls, native('recipeStaticClass')())) throw new Error('recette introuvable : ' + name);
  return cls;
}

// Classe du batiment construit par une recette de construction (Recipe_ConstructorMk1_C -> Build_ConstructorMk1_C)
function buildClassOfRecipe(recipeCls) {
  const ret = zeroAlloc(8, 8);
  native('buildableClassFromRecipe')(ret.ptr, classSlotOf(recipeCls).ptr);
  const cls = ret.ptr.readPointer();
  if (!isUObject(cls)) throw new Error(className(recipeCls) + ' ne construit pas de batiment');
  return cls;
}

function nearestOfClass(ctx, cls, origin) {
  let best = null;
  for (const a of actorsOfClass(ctx, cls)) {
    if (!isUObject(a)) continue;
    const pose = actorPose(a);
    const d = Math.hypot(pose.location.x - origin.x, pose.location.y - origin.y, pose.location.z - origin.z);
    if (best === null || d < best.distance) best = { actor: a, pose, distance: d };
  }
  return best;
}

// Disposition des connecteurs du batiment d'une recette, relevee sur l'exemplaire le plus proche deja present dans la
// partie (aucune construction necessaire). sample = null si aucun exemplaire n'existe encore.
function layoutOnGameThread(ctx, recipe, near) {
  const cls = buildClassOfRecipe(requireRecipe(recipe));
  const origin = near || actorPose(requirePawn(ctx)).location;
  const best = nearestOfClass(ctx, cls, origin);
  const out = { recipe: className(requireRecipe(recipe)), buildClass: className(cls), sample: null };
  if (best === null) return out;
  return Object.assign(out, {
    sample: splitFullName(best.actor).path,
    location: best.pose.location,
    rotation: best.pose.rotation,
    connectors: factoryConnections(best.actor).map(({ name, direction, location, normal }) => ({ name, direction, location, normal })),
  });
}

function recipeInfo(ctx, cls) {
  const slot = classSlotOf(cls);
  const ingredients = zeroAlloc(16, 8);
  native('recipeIngredients')(ingredients.ptr, ctx.subsystem, slot.ptr);
  const products = zeroAlloc(16, 8);
  native('recipeProducts')(products.ptr, slot.ptr);
  const producedIn = zeroAlloc(16, 8);
  native('recipeProducedIn')(producedIn.ptr, slot.ptr);
  const duration = native('recipeDuration')(slot.ptr);
  const perMinute = (list) => list.map((e) => Object.assign(e, { perMinute: duration > 0 ? (e.amount * 60) / duration : null }));
  return {
    recipe: className(cls),
    duration,
    ingredients: perMinute(takeItemAmounts(ingredients.ptr)),
    products: perMinute(takeItemAmounts(products.ptr)),
    producedIn: takePointerArray(producedIn.ptr).map(className),
  };
}

function availableRecipesOnGameThread(ctx) {
  const manager = native('recipeManagerGet')(ctx.subsystem);
  if (!isUObject(manager)) throw new Error('gestionnaire de recettes introuvable');
  const arr = zeroAlloc(16, 8);
  native('recipeManagerAvailable')(manager, arr.ptr);
  return takePointerArray(arr.ptr).filter(isUObject);
}

// Cree `count` objets (eclats de puissance par defaut) directement dans l'inventaire de potentiel de la machine.
// Gratuit (choix utilisateur). Le jeu filtre les emplacements et previent la machine (OnPotentialInventoryItemChanged).
function addPotentialItemsOnGameThread(path, count, itemPath) {
  const actor = requireFactory(path);
  const inventory = native('getPotentialInventory')(actor);
  if (!isUObject(inventory)) throw new Error(path + ' n\'a pas d\'inventaire de potentiel');
  const itemClass = loadClass(itemPath || POWER_SHARD);
  const classSlot = zeroAlloc(8, 8);
  classSlot.ptr.writePointer(itemClass);
  // Tampons larges : FInventoryItem / FInventoryStack sont remplis par le jeu, leur taille exacte n'importe pas
  const item = zeroAlloc(0x80, 16);
  native('makeInventoryItem')(item.ptr, classSlot.ptr);
  const stack = zeroAlloc(0x80, 16);
  native('makeInventoryStack')(stack.ptr, count, item.ptr);
  const added = virtualMethod(inventory, 'addStack').fn(inventory, stack.ptr, 1);
  return Object.assign({ item: className(itemClass), requested: count, added }, machineStatus(actor));
}

function dismantleOnGameThread(ctx, path, force) {
  if (!builtPaths.has(path) && !force) {
    throw new Error('refuse : ' + path + ' n\'a pas ete construit par cette session (force requis)');
  }
  const obj = findObject(path);
  if (obj.isNull()) {
    builtPaths.delete(path);
    throw new Error('objet introuvable (deja demonte ?) : ' + path);
  }
  if (!isA(obj, native('buildableStaticClass')())) throw new Error('refuse : ' + path + ' n\'est pas un AFGBuildable');
  // Comme le pistolet : les "enfants" (voie integree d'une gare ou d'un quai) d'abord, sinon ils restent seuls
  // (constate le 18/10/2026 : voies integrees orphelines apres demontage de quais)
  const kids = zeroAlloc(16, 8);
  native('getChildDismantleActors')(obj, kids.ptr);
  const children = takePointerArray(kids.ptr).filter((c) => isUObject(c) && !c.equals(obj) && isA(c, native('buildableStaticClass')()));
  const childPaths = children.map((c) => splitFullName(c).path);
  for (const c of children) native('executeDismantle')(c);
  native('executeDismantle')(obj);
  builtPaths.delete(path);
  return { dismantled: path, children: childPaths };
}

// Classe a scanner : categorie, chemin complet, ou nom court d'une classe deja chargee (ex. BP_WAT2_C)
function scanClass(kind) {
  if (kind === 'buildable') return native('buildableStaticClass')();
  if (kind === 'resourceNode') return native('resourceNodeStaticClass')();
  if (kind === 'pickup') return native('itemPickupStaticClass')();
  if (kind.indexOf('/') >= 0) return loadClass(kind);
  return findFirstObject(kind, native('uclassStaticClass')());
}

// Objet a ramasser charge. La liste du scanner donne le chemin de reference (.../Persistent_Level.Persistent_Level:
// PersistentLevel.BP_WAT23_3) ; une fois sa cellule chargee, l'acteur vit dans le paquet de la cellule
// (.../Persistent_Level/_Generated_/<cellule>.Persistent_Level:PersistentLevel.BP_WAT23_3) : on le retrouve par son
// nom pres de sa position.
const PICKUP_SEARCH_RADIUS = 2000;

function loadedPickup(ctx, path, near) {
  const direct = findObject(path);
  if (!direct.isNull() || !near) return direct;
  const suffix = ':' + path.split(':').pop();
  for (const a of actorsOfClass(ctx, native('itemPickupStaticClass')())) {
    if (!isUObject(a)) continue;
    const p = actorPose(a).location;
    if (Math.hypot(p.x - near.x, p.y - near.y, p.z - near.z) > PICKUP_SEARCH_RADIUS) continue;
    if (splitFullName(a).path.endsWith(suffix)) return a;
  }
  return NULL;
}

// Ramasse un objet comme le joueur avec la touche E (AFGCharacterPlayer::PickUpItem). L'objet doit etre charge :
// le monde est diffuse par cellules, il faut donc etre a proximite (near = position donnee par la liste du scanner).
function pickupOnGameThread(ctx, path, near) {
  const pawn = requirePawn(ctx);
  if (!isA(pawn, native('characterPlayerStaticClass')())) throw new Error('le pion du joueur n\'est pas un AFGCharacterPlayer');
  const item = loadedPickup(ctx, path, near);
  if (item.isNull()) throw new Error('objet introuvable : ' + path);
  if (!isA(item, native('itemPickupStaticClass')())) throw new Error(path + ' n\'est pas un objet a ramasser (AFGItemPickup)');
  const before = native('isPickedUp')(item) !== 0;
  if (!before) native('pickUpItem')(pawn, item);
  return { path: splitFullName(item).path, class: splitFullName(item).cls, alreadyPickedUp: before, pickedUp: native('isPickedUp')(item) !== 0 };
}

// Resume leger d'une machine pour les scans (sans la liste des recettes disponibles)
function machineBrief(actor) {
  if (!isA(actor, native('factoryStaticClass')())) return null;
  const brief = { potential: native('getPendingPotential')(actor), paused: native('isProductionPaused')(actor) !== 0 };
  if (isA(actor, native('manufacturerStaticClass')())) {
    const recipe = zeroAlloc(8, 8);
    native('getCurrentRecipe')(actor, recipe.ptr);
    brief.recipe = className(recipe.ptr.readPointer());
  }
  return brief;
}

function scanOnGameThread(ctx, kind, center, radius, limit, withMachine) {
  const cls = scanClass(kind);
  if (cls.isNull()) return { origin: r0(center || actorPose(requirePawn(ctx)).location), total: 0, inRadius: 0, items: [], note: 'classe non chargee : ' + kind };
  const actors = actorsOfClass(ctx, cls);
  const origin = center || actorPose(requirePawn(ctx)).location;
  const found = [];
  for (const a of actors) {
    if (!isUObject(a)) continue;
    const pose = actorPose(a);
    const dx = pose.location.x - origin.x;
    const dy = pose.location.y - origin.y;
    const dz = pose.location.z - origin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (radius && distance > radius) continue;
    found.push({ actor: a, pose, distance });
  }
  found.sort((a, b) => a.distance - b.distance);
  const items = found.slice(0, limit).map(({ actor, pose, distance }) => {
    const name = splitFullName(actor);
    const item = {
      path: name.path,
      class: name.cls,
      location: r0(pose.location),
      yaw: Math.round(pose.rotation.yaw * 10) / 10,
      distance: Math.round(distance),
    };
    if (kind === 'resourceNode') item.purity = PURITY[native('getResourcePurity')(actor)] || 'inconnue';
    if (isA(actor, native('itemPickupStaticClass')())) item.pickedUp = native('isPickedUp')(actor) !== 0;
    if (withMachine) {
      const brief = machineBrief(actor);
      if (brief !== null) item.machine = brief;
    }
    return item;
  });
  return { origin: r0(origin), total: actors.length, inRadius: found.length, items };
}

// --- Monde entier : objets a ramasser et capsules, d'apres le scanner du jeu ---------------------------------
// Le monde est diffuse par cellules : un acteur lointain n'existe pas en memoire. Le jeu precalcule pourtant la liste
// complete pour son scanner d'objets (AFGWorldScannableDataGenerator -> AFGScannableSubsystem), avec classe, position
// et chemin de chaque acteur ; on la lit par reflexion. Ce qui a deja ete ramasse est exclu par DoesPickupExist.
const SCANNABLE_LISTS = { pickups: 'mAvailableItemPickups', dropPods: 'mAvailableDropPods' };

let scannableLayoutCache = null;

function scannableLayout() {
  if (scannableLayoutCache !== null) return scannableLayoutCache;
  const st = requireStruct('/Script/FactoryGame.WorldScannableData');
  const soft = requireStruct('/Script/CoreUObject.SoftObjectPath');
  const top = requireStruct('/Script/CoreUObject.TopLevelAssetPath');
  const actor = fieldsOf(st).find((f) => f.name === 'Actor');
  // FSoftObjectPtr se termine par son FSoftObjectPath (le pointeur faible le precede)
  const pathAt = actor.offset + actor.size - structSize(soft);
  const assetPath = pathAt + propertyOffset(soft, 'AssetPath');
  scannableLayoutCache = {
    size: structSize(st),
    guid: propertyOffset(st, 'ActorGuid'),
    cls: propertyOffset(st, 'ActorClass'),
    location: propertyOffset(st, 'ActorLocation'),
    pkg: assetPath + propertyOffset(top, 'PackageName'),
    asset: assetPath + propertyOffset(top, 'AssetName'),
    sub: pathAt + propertyOffset(soft, 'SubPathString'),
  };
  return scannableLayoutCache;
}

// opts : classes (noms courts, ex. ['BP_WAT2_C']), all (inclure ce qui est deja ramasse), center, radius, limit
function worldScannablesOnGameThread(ctx, list, opts) {
  const field = SCANNABLE_LISTS[list];
  if (field === undefined) throw new Error('liste inconnue : ' + list + ' (' + Object.keys(SCANNABLE_LISTS).join(', ') + ')');
  const sub = actorsOfClass(ctx, native('scannableSubsystemStaticClass')()).find(isUObject);
  if (sub === undefined) throw new Error('sous-systeme de scan introuvable');
  const L = scannableLayout();
  const arr = sub.add(propertyOffset(native('getObjectClass')(sub), field));
  const data = arr.readPointer();
  const num = arr.add(8).readS32();
  const origin = opts.center || actorPose(requirePawn(ctx)).location;
  const classes = opts.classes || null;
  const byClass = {};
  const found = [];
  for (let i = 0; i < num; i++) {
    const e = data.add(i * L.size);
    const cls = className(e.add(L.cls).readPointer());
    const remaining = list === 'pickups' ? native('doesPickupExist')(sub, e.add(L.guid)) !== 0
      : native('hasDropPodBeenLooted')(sub, e.add(L.guid)) === 0;
    const stat = byClass[cls] || (byClass[cls] = { total: 0, remaining: 0 });
    stat.total++;
    if (remaining) stat.remaining++;
    if ((!remaining && !opts.all) || (classes !== null && classes.indexOf(cls) < 0)) continue;
    const location = readVec(e.add(L.location));
    const distance = Math.hypot(location.x - origin.x, location.y - origin.y, location.z - origin.z);
    if (opts.radius && distance > opts.radius) continue;
    found.push({ e, cls, remaining, location, distance });
  }
  found.sort((a, b) => a.distance - b.distance);
  const items = found.slice(0, opts.limit || 50).map(({ e, cls, remaining, location, distance }) => {
    const subPath = readUtf8FString(e.add(L.sub));
    const path = fnameString(e.add(L.pkg)) + '.' + fnameString(e.add(L.asset)) + (subPath ? ':' + subPath : '');
    return { path, class: cls, remaining, location: r0(location), distance: Math.round(distance) };
  });
  return { list, total: num, matching: found.length, byClass, items };
}

// --- RPC ----------------------------------------------------------------------------------------

function withContext(label, fn) {
  return onGameThread(label, (subsystem) => fn(gameContext(subsystem)));
}

Object.assign(rpc.exports, {
  install() {
    const warm = warmUp();
    installPump();
    return Object.assign(pumpStatus(), warm);
  },
  status() {
    return Object.assign(pumpStatus(), { build: native('buildVersion')().readUtf16String(), hitLayout, built: Array.from(builtPaths) });
  },
  // Disposition des connecteurs du batiment d'une recette (cf. layoutOnGameThread)
  layout(recipe, near) {
    return withContext('layout', (ctx) => layoutOnGameThread(ctx, recipe, near || null));
  },
  // Champs d'une structure ou d'une classe par reflexion (ex. "/Script/FactoryGame.WorldScannableData", "FGScannableSubsystem")
  fields(name) {
    return withContext('fields', () => {
      const st = name.indexOf('/') >= 0 ? findObject(name) : findFirstObject(name);
      if (st.isNull()) throw new Error('structure ou classe introuvable : ' + name);
      return { reflection: calibrateFields(), fields: fieldsOf(st).map(describeField) };
    });
  },
  // Tous les champs d'un objet, lus par reflexion (depth : descente dans structures et tableaux ; limit : elements)
  // only : noms des champs a lire (ex. ['mClearanceData']), sinon tous
  dump(objectName, depth, limit, only) {
    return withContext('dump', () => {
      const obj = objectName.indexOf('/') >= 0 || objectName.indexOf(':') >= 0 ? findObject(objectName) : findFirstObject(objectName);
      if (obj.isNull()) throw new Error('objet introuvable : ' + objectName);
      return dumpObject(obj, depth == null ? 1 : depth, limit == null ? 20 : limit, only || null);
    });
  },
  // Chemin de fer : connecteurs d'un rail / d'une gare, bouts de voie libres, pose d'un rail (cf. railOnGameThread)
  rails(path) {
    return withContext('rails', () => railInfo(path));
  },
  railEnds(center, radius, limit) {
    return withContext('railEnds', (ctx) => railEndsOnGameThread(ctx, center || null, radius || 0, limit || 20));
  },
  signal(recipe, guard, opts) {
    return withContext('signal', (ctx) => signalOnGameThread(ctx, recipe, guard, opts));
  },
  rail(recipe, from, to, opts) {
    return withContext('rail', (ctx) => railOnGameThread(ctx, recipe, from, to, opts));
  },
  // Liste du monde entier (cf. worldScannablesOnGameThread) : list = pickups | dropPods
  world(list, opts) {
    return withContext('world', (ctx) => worldScannablesOnGameThread(ctx, list, opts || {}));
  },
  pickup(path, near) {
    return withContext('pickup', (ctx) => pickupOnGameThread(ctx, path, near || null));
  },
  // Thread du jeu, sans effet : verifie que la pompe tourne
  ping() {
    return withContext('ping', (ctx) => ({ tid: Process.getCurrentThreadId(), subsystem: splitFullName(ctx.subsystem).path }));
  },
  player() {
    return withContext('player', playerOnGameThread);
  },
  teleport(location, yaw) {
    return withContext('teleport', (ctx) => teleportOnGameThread(ctx, location, yaw));
  },
  ground(x, y, zTop, zBottom) {
    return withContext('ground', (ctx) => ({
      z: traceDown(ctx, x, y, zTop == null ? 100000 : zTop, zBottom == null ? -50000 : zBottom),
    }));
  },
  // Lancers de rayons en lot : [{from, to}] -> [{hit, location}]. Les collisions ne sont chargees qu'autour du joueur.
  rays(segments) {
    return withContext('rays', (ctx) => segments.map(({ from, to }) => {
      const t = trace(ctx, from, to);
      return t.blocked ? { hit: true, location: r0(t.location) } : { hit: false };
    }));
  },
  // opts.machine : ajoute recette / vitesse / pause des machines
  scan(kind, center, radius, limit, opts) {
    return withContext('scan', (ctx) => scanOnGameThread(ctx, kind, center || null, radius || 0, limit || 50,
      !!(opts && opts.machine)));
  },
  build(recipePath, location, yaw, opts) {
    return withContext('build', (ctx) => buildOnGameThread(ctx, recipePath, location, yaw, opts));
  },
  // Visee simulee de `from` vers `to` ; construit si le jeu valide (opts.dryRun / opts.force)
  buildAim(recipePath, from, to, opts) {
    return withContext('buildAim', (ctx) => buildAimOnGameThread(ctx, recipePath, from, to, opts));
  },
  // Construction possible ? Disqualificateurs du jeu, sans rien construire
  check(recipePath, from, to) {
    return withContext('check', (ctx) => buildAimOnGameThread(ctx, recipePath, from, to, { dryRun: true }));
  },
  // Construit au sol, `distance` uu devant la camera, oriente comme le regard
  buildInFront(recipePath, distance) {
    return withContext('buildInFront', (ctx) => {
      const view = viewPoint(ctx);
      const yaw = view.rotation.yaw;
      const d = distance || 2000;
      const x = view.location.x + Math.cos((yaw * Math.PI) / 180) * d;
      const y = view.location.y + Math.sin((yaw * Math.PI) / 180) * d;
      const z = traceDown(ctx, x, y, view.location.z + 3000, view.location.z - 10000);
      if (z === null) throw new Error('pas de sol devant la camera');
      return buildOnGameThread(ctx, recipePath, { x, y, z }, yaw, {});
    });
  },
  wire(fromPath, toPath, opts) {
    return withContext('wire', (ctx) => wireOnGameThread(ctx, fromPath, toPath, opts));
  },
  power(path) {
    return withContext('power', () => powerStatus(requireActor(path)));
  },
  // Recette lue dans le jeu : duree, ingredients et produits (quantite et debit/min a 100 %), producteurs
  recipe(name) {
    return withContext('recipe', (ctx) => recipeInfo(ctx, requireRecipe(name)));
  },
  // Recettes debloquees ; producer (ex. Build_ConstructorMk1_C) filtre sur le batiment producteur
  recipes(producer) {
    return withContext('recipes', (ctx) => {
      const all = availableRecipesOnGameThread(ctx);
      if (!producer) return all.map(className);
      return all.map((cls) => recipeInfo(ctx, cls)).filter((r) => r.producedIn.indexOf(producer) >= 0);
    });
  },
  // Proprietes d'un objet par reflexion (ex. "Default__Build_MinerMk3_C", { mExtractCycleTime: 'float' })
  props(objectName, types) {
    return withContext('props', () => {
      const obj = objectName.indexOf('/') >= 0 ? findObject(objectName) : findFirstObject(objectName);
      if (obj.isNull()) throw new Error('objet introuvable : ' + objectName);
      return Object.assign({ reflection: calibrateReflection() }, readProperties(obj, types));
    });
  },
  // Position, orientation et classe d'un acteur (pour apprendre la disposition de ses connecteurs)
  pose(path) {
    return withContext('pose', () => {
      const actor = requireActor(path);
      return Object.assign({ class: splitFullName(actor).cls }, actorPose(actor));
    });
  },
  // Boite englobante de tous les composants dans le repere de l'acteur (sans son echelle), avec la pose de l'acteur
  bounds(path) {
    return withContext('bounds', () => {
      const actor = requireActor(path);
      const box = zeroAlloc(0x40, 8);
      native('actorLocalBox')(actor, box.ptr, 1, 0);
      return Object.assign({ class: splitFullName(actor).cls, min: readVec(box.ptr), max: readVec(box.ptr.add(24)), valid: box.ptr.add(48).readU8() !== 0 }, actorPose(actor));
    });
  },
  machine(path) {
    return withContext('machine', () => machineStatus(requireFactory(path)));
  },
  setRecipe(path, recipe) {
    return withContext('setRecipe', () => setRecipeOnGameThread(path, recipe));
  },
  // potential : 1.0 = 100 % ; le jeu borne selon les eclats de puissance inseres
  setClock(path, potential) {
    return withContext('setClock', () => {
      const actor = requireFactory(path);
      virtualMethod(actor, 'setPendingPotential').fn(actor, potential);
      return machineStatus(actor);
    });
  },
  // Eclats de puissance (ou autre objet de potentiel via itemPath), crees gratuitement dans la machine
  addShards(path, count, itemPath) {
    return withContext('addShards', () => addPotentialItemsOnGameThread(path, count || 1, itemPath));
  },
  pause(path, paused) {
    return withContext('pause', () => {
      const actor = requireFactory(path);
      virtualMethod(actor, 'setIsProductionPaused').fn(actor, paused ? 1 : 0);
      return machineStatus(actor);
    });
  },
  connections(path) {
    return withContext('connections', () => allConnections(requireActor(path)).map((c) => ({
      name: c.name, direction: c.direction, connected: c.connected, location: r0(c.location), normal: c.normal,
    })));
  },
  // to = { path, name } (connecteur) ou { x, y, z } (bout libre avec poteau)
  // Raccorde deux connecteurs convoyeur libres (reparation d'un troncon pose sans raccord)
  connect(pathA, nameA, pathB, nameB) {
    return withContext('connect', () => {
      const a = requireConnection(pathA, nameA);
      const b = requireConnection(pathB, nameB);
      if (distance(a.location, b.location) > 50) throw new Error('connecteurs trop eloignes : ' + Math.round(distance(a.location, b.location)) + ' uu');
      native('factoryConnSetConnection')(a.comp, b.comp);
      const after = allConnections(requireActor(pathA)).find((c) => c.name === nameA);
      return { connected: after.connected, gap: Math.round(distance(a.location, b.location)) };
    });
  },
  belt(recipePath, fromPath, fromName, to, opts) {
    return withContext('belt', (ctx) => beltOnGameThread(ctx, recipePath, fromPath, fromName, to, opts));
  },
  platformLoadMode(path, load) {
    return withContext('platformLoadMode', () => platformLoadModeOnGameThread(path, load));
  },
  dismantle(path, force) {
    return withContext('dismantle', (ctx) => dismantleOnGameThread(ctx, path, force === true));
  },
});
