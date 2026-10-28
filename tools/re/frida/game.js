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

// Decalage de FHitResult.Component (TWeakObjectPtr<UPrimitiveComponent>), lu par reflexion
let hitComponentOff = null;
function hitComponentOffset() {
  if (hitComponentOff === null) {
    const field = fieldsOf(findFirstObject('HitResult')).find((f) => f.name === 'Component');
    if (!field) throw new Error('FHitResult.Component introuvable par reflexion');
    hitComponentOff = field.offset;
  }
  return hitComponentOff;
}

// Parametres de requete des rayons et balayages : ceux du moteur par defaut, ou (le temps d'un releve) une requete qui
// ignore la vegetation (utilisateur, 24/10/2026 : « normalement la vegetation est transparente » ; « fais-le pour la
// vegetation tout de suite ») : FCollisionQueryParams construit par le moteur, chaque InstancedFoliageActor charge ajoute
// aux acteurs ignores. Les rayons traversent alors les arbres d'un coup, sans relance.
let traceQueryParams = null;
const queryParams = () => traceQueryParams || dataExport('engine', QUERY_PARAMS);
function foliageQueryParams(ctx) {
  const p = Memory.alloc(0x400);
  const stat = zeroAlloc(16, 8);
  native('queryParamsCtor')(p, uint64(0), stat.ptr, 0, NULL); // FName NAME_None, TStatId vide, rayons simples
  let n = 0;
  for (const a of actorsOfClass(ctx, loadClass('/Script/Foliage.InstancedFoliageActor'))) {
    if (isUObject(a)) { native('queryAddIgnoredActor')(p, a); n++; }
  }
  p.foliageIgnored = n;
  return p;
}
function withoutFoliage(ctx, fn) {
  traceQueryParams = foliageQueryParams(ctx);
  try { return fn(); } finally { traceQueryParams = null; }
}

// Lancer de rayon de start vers end. Le FHitResult reste en memoire (hit.ptr) pour etre passe a un hologramme.
function trace(ctx, start, end) {
  const hit = zeroAlloc(0x200, 16);
  const s = newVector(start);
  const e = newVector(end);
  const blocked = native('lineTraceSingleByChannel')(ctx.world, hit.ptr, s.ptr, e.ptr, ECC_VISIBILITY,
    queryParams(), dataExport('engine', RESPONSE_PARAMS));
  if (blocked === 0) return { blocked: false, hit, location: null };
  calibrateHitResult(hit.ptr, start, end);
  return { blocked: true, hit, location: readVec(hit.ptr.add(hitLayout.location)) };
}

// FCollisionShape : type (ECollisionShape : Line 0, Box 1, Sphere 2, Capsule 3), puis l'union de flottants ; pour une
// boite, ses trois demi-cotes (uu). Le type est ecrit sur 4 octets : enum sans type sous-jacent, ou uint8 suivi du
// remplissage jusqu'a l'alignement des flottants (16 octets dans les deux cas)
function newBoxShape(half) {
  const m = zeroAlloc(16, 8);
  m.ptr.writeS32(1);
  m.ptr.add(4).writeFloat(half.x);
  m.ptr.add(8).writeFloat(half.y);
  m.ptr.add(12).writeFloat(half.z);
  return m;
}

function newQuat(q) {
  const m = zeroAlloc(32, 16);
  m.ptr.writeDouble(q.x);
  m.ptr.add(8).writeDouble(q.y);
  m.ptr.add(16).writeDouble(q.z);
  m.ptr.add(24).writeDouble(q.w);
  return m;
}

// Orientation d'une boite balayee de start a end : axe X local le long du trajet (lacet et tangage du segment),
// sauf yaw / pitch imposes
function sweepRotation(start, end, yaw, pitch) {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const h = Math.hypot(dx, dy);
  const y = yaw != null ? yaw : (h > 1e-6 ? (Math.atan2(dy, dx) * 180) / Math.PI : 0);
  const p = pitch != null ? pitch : (h > 1e-6 || Math.abs(dz) > 1e-6 ? (Math.atan2(dz, h) * 180) / Math.PI : 0);
  return quatFromRotator(p, y, 0);
}

// Balayage d'une boite (demi-cotes half, uu) de start a end : premier obstacle bloquant (canal Visibility, comme les
// rayons). Le FHitResult a la meme disposition que celui d'un rayon (Location = centre de la boite au contact)
function sweepBox(ctx, start, end, half, yaw, pitch) {
  const hit = zeroAlloc(0x200, 16);
  const s = newVector(start);
  const e = newVector(end);
  const q = newQuat(sweepRotation(start, end, yaw, pitch));
  const shape = newBoxShape(half);
  const blocked = native('sweepSingleByChannel')(ctx.world, hit.ptr, s.ptr, e.ptr, q.ptr, ECC_VISIBILITY, shape.ptr,
    queryParams(), dataExport('engine', RESPONSE_PARAMS));
  if (blocked === 0) return { blocked: false, hit };
  calibrateHitResult(hit.ptr, start, end);
  return {
    blocked: true,
    hit,
    location: readVec(hit.ptr.add(hitLayout.location)),
    impact: readVec(hit.ptr.add(hitLayout.location + 0x18)),
    normal: readVec(hit.ptr.add(hitLayout.normal)),
  };
}

// Ce qu'un rayon a touche : batiment (acteur Build_*, pieces legeres), vegetation (le jeu la degage a la construction)
// ou nature (relief, rochers)
function hitKind(name) {
  if (/\.Build_\w+_C_\d+|Lightweight/i.test(name)) return 'batiment';
  if (/Foliage/i.test(name)) return 'vegetation';
  return 'nature';
}

// Surface naturelle sous (x, y) : premier relief ou rocher en descendant de zTop, en traversant batiments et vegetation
// (un rayon parti de l'interieur d'une collision ne la touche pas en sortant, mais en touche les faces internes : on
// repart 5 cm sous chaque contact, jusqu'a 400 fois ; un batiment pose sur le sol a son dernier contact au ras du sol,
// un pas plus grand ferait partir le rayon sous le relief). null si rien jusqu'a zBottom ou batiment trop epais.
function naturalTop(ctx, x, y, zTop, zBottom, whoOff, skipped) {
  let z = zTop;
  const seen = {}; // mailles traversees, comptees une fois par sorte
  for (let k = 0; k < 400; k++) {
    const t = trace(ctx, { x, y, z }, { x, y, z: zBottom });
    if (!t.blocked) return null;
    const comp = native('weakObjectPtrGet')(t.hit.ptr.add(whoOff));
    const kind = comp.isNull() ? 'nature' : hitKind(splitFullName(comp).path);
    if (kind === 'nature') return t.location.z;
    if (!seen[kind]) { seen[kind] = true; skipped[kind] = (skipped[kind] || 0) + 1; }
    z = t.location.z - 5;
  }
  return null;
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
  // Joueur aux commandes d'un vehicule (locomotive, constate le 21/10/2026) : le pion est le vehicule, l'inventaire est
  // celui du personnage, toujours present (partie solo : le premier Char_Player). GetInventory n'est appele que sur un
  // personnage.
  let character = requirePawn(ctx);
  const cls = scanClass('Char_Player_C');
  if (!cls.isNull() && !isA(character, cls)) character = actorsOfClass(ctx, cls).filter(isUObject)[0] || NULL;
  const inventory = character.isNull() ? NULL : native('playerInventory')(character);
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
// opts.pitch / opts.roll : inclinaison (degres, FRotator) ; opts.holoFields : champs de l'hologramme ecrits avant la
// validation (ex. { mCurrentLength: 3800 } pour la longueur d'une poutre, en uu)
function buildOnGameThread(ctx, recipePath, location, yaw, opts) {
  const o = opts || {};
  return placeValidateConstruct(ctx, recipePath, location, (holo) => {
    const transform = newTransform(location, quatFromRotator(o.pitch || 0, yaw || 0, o.roll || 0));
    native('setActorTransform')(holo, transform.ptr, 0, NULL, TELEPORT_NONE);
    syncPlatformTrack(holo);
    if (o.holoFields) writeFields(holo, o.holoFields);
    return { mode: 'transform' };
  }, o);
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
  // opts.onActor : point touche fabrique sur ce batiment au point `to` (loin du joueur, il n'a pas de collision)
  const aim = opts && opts.onActor ? actorHit(ctx, requireActor(opts.onActor), to) : trace(ctx, from, to);
  if (!aim.blocked) throw new Error('la visee ne touche rien entre ' + JSON.stringify(r0(from)) + ' et ' + JSON.stringify(r0(to)));
  return placeValidateConstruct(ctx, recipePath, aim.location, (holo) => {
    if (opts && opts.scrollRotation != null) writeFields(holo, { mScrollRotation: Math.round(opts.scrollRotation) });
    const update = virtualMethod(holo, 'updateHologramPlacement');
    // opts.vehicleScroll [delta, step] : AFGRailroadVehicleHologram::ScrollRotate (touche R du pistolet : sens d'un
    // vehicule ferroviaire ; ecrire mScrollRotation ne le change pas, constate le 26/10/2026), visee refaite apres
    if (opts && opts.vehicleScroll) {
      update.fn(holo, aim.hit.ptr);
      exportByPattern('vehicleHoloScroll', 'game', /^\?ScrollRotate@AFGRailroadVehicleHologram@@UEAAXHH@Z$/, 'void', ['pointer', 'int', 'int']);
      native('vehicleHoloScroll')(holo, opts.vehicleScroll[0], opts.vehicleScroll[1]);
    }
    update.fn(holo, aim.hit.ptr);
    const vehicleSnap = repairFarVehicleSnap(holo, aim);
    return Object.assign({ mode: 'aim', aimHit: r0(aim.location), placement: update.label }, vehicleSnap ? { vehicleSnap } : {});
  }, opts || {});
}

// Vehicule ferroviaire accroche a un autre loin du joueur (utilisateur, 26/10/2026 : « corrige l'agent »). Le jeu cale
// l'hologramme contre le vehicule touche (AFGRailroadVehicleHologram::SetHologramLocationAndRotation), mais retrouve le
// rail sous ce vehicule par une collision (ApproximateTrackPositionForVehicle : SphereOverlapActors de 1 m, fonction non
// exportee). Loin du joueur, les rails n'ont pas de collision : position invalide, hologramme en (0, 0, 0),
// FGCDMustHaveRailRoadTrack et FGCDNotEnoughSpaceOnTrack. On refait le meme calcul avec le rail que le vehicule connait
// (GetTrackPosition), puis les deux controles du jeu (place sur la voie, empietement) ; la construction attelle ensuite
// au vehicule accroche (ConstructVehicle -> CoupleTrains). Lu dans Ghidra le 26/10/2026.
const VEHICLE_SNAP_NATIVES = [
  ['trackPosMove', 'game', /^\?MoveTrackPosition@AFGRailroadSubsystem@@SA_NAEAUFRailroadTrackPosition@@MAEAMM@Z$/, 'uint8', ['pointer', 'float', 'pointer', 'float']],
  ['trackPosWorld', 'game', /^\?GetWorldLocationAndDirection@FRailroadTrackPosition@@QEBAXAEAU\?\$TVector@N@Math@UE@@0@Z$/, 'void', ['pointer', 'pointer', 'pointer']],
  ['trackPosIsValid', 'game', /^\?IsValid@FRailroadTrackPosition@@QEBA_NXZ$/, 'uint8', ['pointer']],
  // FRailroadTrackPosition rendu par valeur : adresse du resultat en 2e argument, apres this
  ['trackClosestPos', 'game', /^\?FindTrackPositionClosestToWorldLocation@AFGBuildableRailroadTrack@@QEAA\?AUFRailroadTrackPosition@@AEBU\?\$TVector@N@Math@UE@@@Z$/, 'pointer', ['pointer', 'pointer', 'pointer']],
  ['vehicleTrackPos', 'game', /^\?GetTrackPosition@AFGRailroadVehicle@@QEBAAEBUFRailroadTrackPosition@@XZ$/, 'pointer', ['pointer']],
  ['vehicleHoloOverlap', 'game', /^\?OverlapRailroadVehicle@AFGRailroadVehicleHologram@@AEBAPEAVAFGRailroadVehicle@@AEBU\?\$TTransform@N@Math@UE@@AEBU\?\$TVector@N@45@@Z$/, 'pointer', ['pointer', 'pointer', 'pointer']],
  // TSubclassOf passe par adresse
  ['addConstructDisqualifier', 'game', /^\?AddConstructDisqualifier@AFGHologram@@QEAAXV\?\$TSubclassOf@VUFGConstructDisqualifier@@@@@Z$/, 'void', ['pointer', 'pointer']],
  ['FGCDEncroachingVehicle', 'game', /^\?StaticClass@UFGCDEncroachingVehicle@@SAPEAVUClass@@XZ$/, 'pointer', []],
  ['FGCDNotEnoughSpaceOnTrack', 'game', /^\?StaticClass@UFGCDNotEnoughSpaceOnTrack@@SAPEAVUClass@@XZ$/, 'pointer', []],
];

let vehicleSnapFields = null;
function vehicleSnapLayout() {
  if (vehicleSnapFields) return vehicleSnapFields;
  for (const spec of VEHICLE_SNAP_NATIVES) exportByPattern(...spec);
  const cls = (n) => { const c = findFirstObject(n, native('uclassStaticClass')()); if (c.isNull()) throw new Error('classe introuvable : ' + n); return c; };
  const holo = cls('FGRailroadVehicleHologram'), vehicle = cls('FGRailroadVehicle');
  const pos = requireStruct('/Script/FactoryGame.RailroadTrackPosition');
  const field = (s, n) => { const f = fieldsOf(s).find((x) => x.name === n); if (!f) throw new Error('champ introuvable : ' + n); return f.offset; };
  vehicleSnapFields = {
    holoClass: holo,
    holo: { length: propertyOffset(holo, 'mLength'), trackPos: propertyOffset(holo, 'mTrackPosition'), snapped: propertyOffset(holo, 'mSnappedVehicle') },
    vehicle: { length: propertyOffset(vehicle, 'mLength'), front: propertyOffset(vehicle, 'mCoupledVehicleFront'), back: propertyOffset(vehicle, 'mCoupledVehicleBack') },
    pos: { size: structSize(pos), track: field(pos, 'Track'), forward: field(pos, 'Forward') },
  };
  return vehicleSnapFields;
}

// null si rien a reprendre (pas un vehicule, pas d'accroche, ou le jeu a trouve le rail : joueur proche)
function repairFarVehicleSnap(holo, aim) {
  const L = vehicleSnapLayout();
  if (!isA(holo, L.holoClass)) return null;
  const neighbor = holo.add(L.holo.snapped).readPointer();
  const holoPos = holo.add(L.holo.trackPos);
  if (!isUObject(neighbor) || native('trackPosIsValid')(holoPos) !== 0) return null;
  const who = splitFullName(neighbor).path;
  // Sens du vehicule : le jeu le tire de la visee (perpendiculaire au rayon, signe selon mScrollTrackDirection, champ non
  // expose). Rayon vertical : sens nul, le vehicule suit le sens du rail. Seul ce cas est refait.
  const ts = readVec(aim.hit.ptr.add(hitLayout.traceStart)), hl = readVec(aim.hit.ptr.add(hitLayout.location));
  if ((hl.x - ts.x) ** 2 + (hl.y - ts.y) ** 2 >= 1e-8) return { repaired: false, neighbor: who, reason: 'visee non verticale' };
  // Cote d'accroche : l'attelage libre ; les deux libres (ou pris), celui du cote de la visee
  const pose = actorPose(neighbor);
  const p = (pose.rotation.pitch * Math.PI) / 180, y = (pose.rotation.yaw * Math.PI) / 180;
  const fwd = { x: Math.cos(p) * Math.cos(y), y: Math.cos(p) * Math.sin(y), z: Math.sin(p) };
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const front = isUObject(neighbor.add(L.vehicle.front).readPointer()), back = isUObject(neighbor.add(L.vehicle.back).readPointer());
  const toAim = { x: aim.location.x - pose.location.x, y: aim.location.y - pose.location.y, z: aim.location.z - pose.location.z };
  const behind = front === back ? dot(fwd, toAim) <= 0 : front;
  if (behind ? back : front) return { repaired: false, neighbor: who, reason: 'attelage deja pris' };
  // ApproximateTrackPositionForVehicle avec le rail du vehicule : point le plus proche du vehicule, sens du vehicule
  const track = native('weakObjectPtrGet')(native('vehicleTrackPos')(neighbor).add(L.pos.track));
  if (!isUObject(track)) return { repaired: false, neighbor: who, reason: 'vehicule voisin sans rail' };
  const pos = zeroAlloc(L.pos.size, 8), at = newVector(pose.location);
  const loc = zeroAlloc(24, 8), dir = zeroAlloc(24, 8), moved = zeroAlloc(4, 4);
  native('trackClosestPos')(track, pos.ptr, at.ptr);
  native('trackPosWorld')(pos.ptr, loc.ptr, dir.ptr);
  pos.ptr.add(L.pos.forward).writeFloat(dot(readVec(dir.ptr), fwd) < 0 ? -1 : 1);
  // Centre du nouveau vehicule a une demi-longueur de chacun, du cote choisi ; puis sens du rail (visee verticale)
  const length = holo.add(L.holo.length).readFloat();
  native('trackPosMove')(pos.ptr, (length + neighbor.add(L.vehicle.length).readFloat()) * (behind ? -0.5 : 0.5), moved.ptr, 0);
  pos.ptr.add(L.pos.forward).writeFloat(1);
  native('trackPosWorld')(pos.ptr, loc.ptr, dir.ptr);
  Memory.copy(holoPos, pos.ptr, L.pos.size);
  const l = readVec(loc.ptr), d = readVec(dir.ptr);
  const rot = quatFromRotator((Math.atan2(d.z, Math.hypot(d.x, d.y)) * 180) / Math.PI, (Math.atan2(d.y, d.x) * 180) / Math.PI, 0);
  native('setActorTransform')(holo, newTransform(l, rot).ptr, 0, NULL, TELEPORT_NONE);
  // Controles du jeu, refaits sur la position reprise (ceux de la visee portaient sur la position invalide) :
  // empietement sur un autre vehicule que le voisin (boite de mLength/2 x 2 m x 2 m, 2 m au-dessus du rail), et place sur
  // la voie a une demi-longueur de chaque cote (a 1 uu pres)
  native('resetConstructDisqualifiers')(holo);
  const disqualifiers = [];
  const box = newTransform({ x: l.x, y: l.y, z: l.z + 200 }, rot), extents = newVector({ x: length * 0.5, y: 200, z: 200 });
  const other = native('vehicleHoloOverlap')(holo, box.ptr, extents.ptr);
  if (isUObject(other) && !other.equals(neighbor)) disqualifiers.push('FGCDEncroachingVehicle');
  for (const s of [1, -1]) {
    const probe = zeroAlloc(L.pos.size, 8);
    Memory.copy(probe.ptr, holoPos, L.pos.size);
    moved.ptr.writeFloat(0);
    native('trackPosMove')(probe.ptr, length * 0.5 * s, moved.ptr, 0);
    if (Math.abs(moved.ptr.readFloat()) + 1 < Math.abs(length * 0.5) && disqualifiers.indexOf('FGCDNotEnoughSpaceOnTrack') < 0) disqualifiers.push('FGCDNotEnoughSpaceOnTrack');
  }
  for (const k of disqualifiers) {
    const slot = zeroAlloc(8, 8);
    slot.ptr.writePointer(native(k)());
    native('addConstructDisqualifier')(holo, slot.ptr);
  }
  return { repaired: true, neighbor: who, side: behind ? 'arriere' : 'avant', location: r0(l), yaw: Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI), disqualifiers };
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

// Bout de cable : un batiment (son premier connecteur electrique) ou un connecteur nomme
// (ex. <tour>.PowerTowerConnection, la liaison entre tours, plus longue que celle des poteaux)
function circuitEnd(path) {
  const obj = requireActor(path);
  const circuitClass = native('circuitConnectionStaticClass')();
  if (isA(obj, circuitClass)) return { actor: requireActor(path.slice(0, path.lastIndexOf('.'))), conn: obj };
  const conn = componentOfClass(obj, circuitClass);
  if (conn.isNull()) throw new Error('aucun connecteur electrique sur ' + path);
  return { actor: obj, conn };
}

// Cable entre les connecteurs electriques de deux batiments, valide par le jeu (longueur, connecteur plein,
// cable deja existant) puis construit par AFGWireHologram::Construct -> AFGBuildableWire::Connect.
function wireOnGameThread(ctx, fromPath, toPath, opts) {
  const { actor: from, conn: fromConn } = circuitEnd(fromPath);
  const { actor: to, conn: toConn } = circuitEnd(toPath);
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
  const endAim = (holoAt) => {
    if (to.path !== undefined) {
      const conn = requireConnection(to.path, to.name);
      endConn = conn;
      try {
        return aimAtConnector(ctx, conn);
      } catch (e) {
        const l = conn.location, n = conn.normal;
        return actorHit(ctx, requireActor(to.path), { x: l.x - n.x * 20, y: l.y - n.y * 20, z: l.z });
      }
    }
    // opts.endOnActor : point touche fabrique sur ce batiment au point `to` (support de tuyau), sans imposer de
    // connecteur : le jeu accroche le bout comme sous le pistolet. Le cote du point touche decide du sens : 30 cm
    // avant le point d'accroche, du cote d'ou arrive le tuyau, celui-ci traverse le support ; au point d'accroche
    // meme (ou en imposant SnapOnly0 par to.path), le bout se retourne face au support : boucle a chaque support.
    if (opts && opts.endOnActor) return actorHit(ctx, requireActor(opts.endOnActor), to);
    // opts.exactEnd : le bout est pose exactement au point donne (point touche fabrique au-dessus du sol), par exemple
    // pour une ligne a altitude constante
    if (opts && opts.exactEnd) return pointAim(ctx, to);
    // opts.endZ (ascenseur) : la hauteur se lit sur le rayon de visee, la ou il croise l'axe vertical de l'ascenseur
    // (FHologramHelpers::CalcPoleHeight). Rayon horizontal fabrique qui croise cet axe a l'altitude voulue.
    if (opts && opts.endZ != null && holoAt) {
      const t = pointAim(ctx, { x: holoAt.x, y: holoAt.y, z: opts.endZ });
      writeVector(t.hit.ptr.add(hitLayout.traceStart), { x: holoAt.x - 1000, y: holoAt.y, z: opts.endZ });
      writeVector(t.hit.ptr.add(hitLayout.traceStart + 0x18), { x: holoAt.x + 1000, y: holoAt.y, z: opts.endZ });
      return t;
    }
    const aim = trace(ctx, { x: to.x, y: to.y, z: to.z + 1000 }, { x: to.x, y: to.y, z: to.z - 1000 });
    if (!aim.blocked) throw new Error('rien sous le point d\'arrivee ' + JSON.stringify(r0(to)));
    // opts.poleHeight (uu) : hauteur du poteau ajoute en bout. Le jeu la lit la ou le rayon de visee croise l'axe du
    // poteau (FHologramHelpers::CalcPoleHeight) ; un rayon vertical, sur l'axe, ne donne pas de hauteur et le poteau
    // prend sa hauteur maximale (7 m constates). Point touche garde au sol, rayon remplace par un rayon horizontal
    // dans l'axe du convoyeur, a la hauteur voulue au-dessus du point touche.
    if (opts && opts.poleHeight != null) {
      const d = { x: to.x - start.location.x, y: to.y - start.location.y };
      const k = 1000 / (Math.hypot(d.x, d.y) || 1);
      const z = aim.location.z + opts.poleHeight;
      writeVector(aim.hit.ptr.add(hitLayout.traceStart), { x: to.x - d.x * k, y: to.y - d.y * k, z });
      writeVector(aim.hit.ptr.add(hitLayout.traceStart + 0x18), { x: to.x + d.x * k, y: to.y + d.y * k, z });
    }
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
      // opts.fabricatedStart : point touche fabrique sur le batiment de depart meme pres du joueur (le rayon peut
      // toucher le poteau sous le joint, qui oriente alors un ascenseur a l'envers)
      if (opts && opts.fabricatedStart) throw new Error('point touche fabrique demande');
      startAim = aimAtConnector(ctx, start);
    } catch (e) {
      const l = start.location, n = start.normal;
      startAim = actorHit(ctx, requireActor(fromPath), { x: l.x - n.x * 20, y: l.y - n.y * 20, z: l.z });
      // Rayon de visee aligne sur le connecteur, de l'exterieur vers l'interieur, comme un joueur qui le regarde :
      // un ascenseur prend son orientation du rayon (vertical, il se pose a l'envers par-dessus le convoyeur)
      writeVector(startAim.hit.ptr.add(hitLayout.traceStart), { x: l.x + n.x * 100, y: l.y + n.y * 100, z: l.z });
      writeVector(startAim.hit.ptr.add(hitLayout.traceStart + 0x18), { x: l.x - n.x * 100, y: l.y - n.y * 100, z: l.z });
      fabricated = true;
    }
    // opts.startScroll : rotation de la molette au depart (ascenseur accroche au bout d'un convoyeur : 180 le retourne)
    if (opts && opts.startScroll != null) writeFields(holo, { mScrollRotation: Math.round(opts.startScroll) });
    update.fn(holo, startAim.hit.ptr);
    // ConfigureComponents raccorde le troncon construit aux connecteurs de mSnappedConnectionComponents, avant qu'il
    // n'entre dans une chaine de convoyeurs. Or au bout d'un troncon pose sur un poteau, FindOverlappingConnections
    // retient souvent le point d'accroche du poteau (SnapOnly0), qui ne se raccorde pas ; loin du joueur il ne trouve
    // rien. On y inscrit donc le connecteur vise, apres chaque visee (le jeu le recalcule).
    snapSlots.writePointer(start.comp);
    const snapped = distance(actorPose(holo).location, start.location);
    const tolerance = (opts && opts.snapTolerance) || 5;
    if (snapped > tolerance) throw new Error('accroche au depart echouee (' + Math.round(snapped) + ' uu du connecteur ' + fromName + ')');
    if (click.fn(holo, 0) !== 0) throw new Error('placement termine des le depart : etat de l\'hologramme inattendu');
    // Arrivee : visee, validation, clic... jusqu'a la fin du placement. opts.endScroll : rotation de la molette pour
    // l'arrivee (ascenseur : 180 tourne la sortie du bas a l'oppose de celle du haut)
    if (opts && opts.endScroll != null) writeFields(holo, { mScrollRotation: Math.round(opts.endScroll) });
    const aim = endAim(actorPose(holo).location);
    for (let clicks = 1; clicks <= BELT_MAX_CLICKS; clicks++) {
      update.fn(holo, aim.hit.ptr);
      snapSlots.writePointer(start.comp);
      if (endConn !== null) snapSlots.add(8).writePointer(endConn.comp);
      native('resetConstructDisqualifiers')(holo);
      native('validatePlacementAndCost')(holo, inventory);
      if (click.fn(holo, 0) !== 0) {
        native('resetConstructDisqualifiers')(holo);
        // Connecteurs que ConfigureComponents raccordera au troncon construit (null : bout libre ou poteau)
        const snappedNames = [0, 8].map((o) => {
          const c = snapSlots.add(o).readPointer();
          return isUObject(c) ? splitFullName(c).path.split('.').slice(-2).join('.') : null;
        });
        return { mode: 'aim', from: fromName, to: to.path !== undefined ? to.name : r0(aim.location), clicks: clicks + 1, snapped: snappedNames, fabricatedStart: fabricated };
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
  let t;
  // Point en l'air au-dessus d'un batiment (voie a un etage d'helice, au-dessus d'une voie ou d'une gare) : l'hologramme
  // s'accrocherait a ce que le rayon touche (bout de la voie du dessous, constate le 21/10/2026 : rails a blanc de
  // l'etage 1 tires 25 m plus bas). A plus de 2 m sous le point, on passe a travers tout ce qui n'est pas le relief.
  // (60 traversees : deux gares superposees en comptent plus de 10, plancher, toit, quais...)
  // La vegetation est toujours traversee, meme au ras du point (le jeu la degage a la construction), en repartant 5 cm
  // sous le contact : un buisson pose au sol, depasse d'un metre, envoyait le rayon sous le relief, puis sur le repli
  // sous le joueur, qui touchait le toit d'un quai -> FGCDInvalidAimLocation (boucle du terminus de l'ancien Venray,
  // 23/10/2026).
  // Seuls les batiments sont traverses (en plus de la vegetation), pas les rochers ni les falaises : au-dessus d'une
  // falaise du decor (FGCliffActor) sans Landscape dessous, le rayon traversait tout et ne trouvait rien (rail A18 de la
  // ligne des mines, 23/10/2026 : « rien sous le point ni sous le joueur »)
  const kindOf = (h) => { const c = native('weakObjectPtrGet')(h.hit.ptr.add(hitComponentOffset())); return c.isNull() ? 'nature' : hitKind(splitFullName(c).path); };
  const foliage = (h) => kindOf(h) === 'vegetation';
  const through = (x, y, zTop, minDrop) => {
    let h = trace(ctx, { x, y, z: zTop }, { x, y, z: zTop - 100000 });
    for (let k = 0; h.blocked && k < 200; k++) {
      const veg = foliage(h);
      if (!veg && !(zTop - h.location.z > minDrop && kindOf(h) === 'batiment')) break;
      h = trace(ctx, { x, y, z: h.location.z - (veg ? 5 : 100) }, { x, y, z: zTop - 100000 });
    }
    return h;
  };
  t = through(p.x, p.y, p.z + 50, 250);
  if (!t.blocked) {
    // Relief non charge (a plus de ~1,3 km du joueur) : le point touche d'un rayon sous les pieds du joueur sert de
    // gabarit, deplace ensuite au point voulu (actorHit y inscrit l'acteur vise) ; ce rayon traverse aussi batiments
    // et vegetation jusqu'au relief (le joueur peut voler au-dessus d'une gare)
    const me = actorPose(requirePawn(ctx)).location;
    t = through(me.x, me.y, me.z - 250, 0);
    if (!t.blocked) throw new Error('rien sous le point ' + JSON.stringify(r0(p)) + ' ni sous le joueur');
    writeVector(t.hit.ptr.add(hitLayout.traceStart), { x: p.x, y: p.y, z: p.z + 50 });
    writeVector(t.hit.ptr.add(hitLayout.traceStart + 0x18), { x: p.x, y: p.y, z: p.z - 100000 });
  }
  writeVector(t.hit.ptr.add(hitLayout.location), p);
  writeVector(t.hit.ptr.add(hitLayout.location + 0x18), p);
  // p.grade : pente de la voie en ce point (fraction, > 0 = monte vers p.yaw). Le bout de rail prend la pente de la
  // surface visee : normale d'un plan qui monte de p.grade le long de p.yaw (sinon horizontale)
  let n = { x: 0, y: 0, z: 1 };
  if (p.grade) {
    const a = ((p.yaw || 0) * Math.PI) / 180, k = Math.hypot(p.grade, 1);
    n = { x: (-p.grade * Math.cos(a)) / k, y: (-p.grade * Math.sin(a)) / k, z: 1 / k };
  }
  writeVector(t.hit.ptr.add(hitLayout.normal), n);
  writeVector(t.hit.ptr.add(hitLayout.impactNormal), n);
  return Object.assign(t, { location: { x: p.x, y: p.y, z: p.z } });
}

function isLandscapeHit(t) {
  const comp = native('weakObjectPtrGet')(t.hit.ptr.add(hitComponentOffset()));
  return !comp.isNull() && /^Landscape/.test(splitFullName(comp).cls);
}

function snappedRailConnections(holo) {
  const at = holo.add(propertyOffset(native('getObjectClass')(holo), 'mSnappedConnectionComponents'));
  return [at.readPointer(), at.add(8).readPointer()];
}

// Rail pose comme le pistolet : visee du depart (bout de voie ou point libre), clic, visee de l'arrivee, clic.
//  - from / to = { path, name } : connecteur d'un rail (accroche verifiee) ;
//  - from / to = { x, y, z, yaw, grade } : point libre au sol ; yaw = direction de la voie en ce point (degres), imposee par
//    la rotation de l'hologramme (mScrollRotation, arrondie au pas de rotation du jeu) ; grade = pente en ce point
//    (fraction, cf. pointAim), sans quoi le bout est a plat et le rail fait un S entre deux points d altitudes differentes ;
//    auto = direction d arrivee calculee par le jeu (cf. plus bas).
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
    // to.auto : direction d'arrivee laissee au jeu (pas de mUseCustomEndRotation), qui n'est pas arrondie au pas de 10 deg
    if (!endConn && !to.auto) writeFields(holo, { mScrollRotation: Math.round(to.yaw || 0), mUseCustomEndRotation: true });
    update.fn(holo, (endConn ? aimAtRailEndForTrack(ctx, endConn) : groundAim(to)).hit.ptr);
    let endForced = false;
    // aiguillage existant : plusieurs bouts libres au meme point, dans le meme sens (branches qui partent du joint) ; le
    // jeu peut accrocher l'arrivee a une autre branche que celle visee. Accepte : l'appelant (railplan) relie ensuite la
    // branche voulue par railLink (anneau A du Hub nord, 23/10/2026 : entree de la gare est 1 au lieu du coin nord-est)
    const sameJoint = (got, want) => {
      const loc = zeroAlloc(24, 8), nor = zeroAlloc(24, 8);
      native('railConnLocation')(got, loc.ptr); native('railConnNormal')(got, nor.ptr);
      const l = readVec(loc.ptr), n = readVec(nor.ptr);
      return Math.hypot(l.x - want.location.x, l.y - want.location.y, l.z - want.location.z) < 30
        && n.x * want.normal.x + n.y * want.normal.y + n.z * want.normal.z > 0.99;
    };
    if (endConn && !snappedRailConnections(holo)[1].equals(endConn.comp)) {
      const got = snappedRailConnections(holo)[1];
      if (isUObject(got) && !sameJoint(got, endConn)) throw new Error('accroche a l\'arrivee echouee : ' + compName(got) + ' de ' + pathOrNull(native('railConnTrack')(got)));
    }
    if (endConn && !snappedRailConnections(holo)[1].equals(endConn.comp) && !isUObject(snappedRailConnections(holo)[1])) {
      const got = snappedRailConnections(holo)[1];
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
    // Construct raccorde le rail aux connecteurs de mSnappedConnectionComponents[0|1] (ConfigureComponents), mais le jeu
    // les recherche par collision (TryFindAndSnapToOverlappingConnection -> FindClosestOverlappingConnection) a chaque
    // mise a jour et les efface quand il ne trouve rien : loin du joueur, l'accroche du depart, reussie a la visee, etait
    // perdue (departs restes libres a 1,2 et 1,5 km, 21/10/2026). On reinscrit donc les connecteurs voulus avant Construct.
    const lost = snappedRailConnections(holo).map((c) => (isUObject(c) ? compName(c) + ' de ' + pathOrNull(native('railConnTrack')(c)) : null));
    const slots = holo.add(propertyOffset(native('getObjectClass')(holo), 'mSnappedConnectionComponents'));
    let startForced = false;
    if (startConn && !slots.readPointer().equals(startConn.comp)) { slots.writePointer(startConn.comp); startForced = true; }
    if (endConn && !slots.add(8).readPointer().equals(endConn.comp)) { slots.add(8).writePointer(endConn.comp); endForced = true; }
    // connecteurs que Construct va raccorder (mSnappedConnectionComponents[0|1]) : nom + rail, ou null
    const snapped = snappedRailConnections(holo).map((c) => (isUObject(c) ? compName(c) + ' de ' + pathOrNull(native('railConnTrack')(c)) : null));
    return {
      mode: 'aim',
      snapped,
      snappedByGame: lost,
      from: startConn ? startConn.name : r0(from),
      to: endConn ? endConn.name : r0(to),
      startForced,
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

// Facteur de charge (la productivite affichee par le jeu) : octet mCurrentProductivity, 255 = 100 %. Echelle verifiee
// sur trois foreuses contre leur duree de production mesuree (mLastProductivityMeasurement*). null sans mesure.
const productivityOffsets = new Map();
function productivity(actor) {
  const cls = native('getObjectClass')(actor);
  if (!productivityOffsets.has(cls.toString())) {
    let off = null;
    try { off = propertyOffset(cls, 'mCurrentProductivity'); } catch (e) { /* classe sans mesure */ }
    productivityOffsets.set(cls.toString(), off);
  }
  const off = productivityOffsets.get(cls.toString());
  return off === null ? null : actor.add(off).readU8() / 255;
}

// Etiquettes Unreal (AActor::Tags) sauvegardees par le jeu : drapeau CPF_SaveGame pose sur la propriete des le
// demarrage de l'agent (utilisateur, 23/10/2026 : « je continue a preferer les tags » ; essai : etiquette presente dans
// la sauvegarde puis relue apres chargement). En memoire seulement : l'agent doit tourner AVANT qu'on charge une partie.
// Erreur rendue sans bloquer l'installation.
function enableTagsSaveGame() {
  try {
    const at = findProperty(requireStruct('/Script/Engine.Actor'), 'Tags').add(propertyFlagsOffset());
    at.writeU64(at.readU64().or(CPF_SAVEGAME));
    return true;
  } catch (e) {
    return 'echec : ' + e.message;
  }
}

function machineStatus(actor) {
  const status = {
    class: splitFullName(actor).cls,
    pendingPotential: native('getPendingPotential')(actor),
    currentPotential: native('getCurrentPotential')(actor),
    maxPotential: virtualMethod(actor, 'getCurrentMaxPotential').fn(actor),
    productivity: productivity(actor),
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
const SPECIAL_DESCRIPTORS = {
  any: 'wildCardDescriptorClass',
  overflow: 'overflowDescriptorClass',
  none: 'noneDescriptorClass',
  undefined: 'anyUndefinedDescriptorClass',
};
function smartRulesOnGameThread(path, rules) {
  const actor = requireActor(path);
  const off = propertyOffset(native('getObjectClass')(actor), 'mSortRules'); // leve une erreur hors repartiteur intelligent
  const read = () => {
    const data = actor.add(off).readPointer();
    const num = actor.add(off + 8).readS32();
    const out = [];
    for (let i = 0; i < num; i++) out.push({ item: className(data.add(16 * i).readPointer()), output: data.add(16 * i + 8).readS32() });
    return out;
  };
  if (rules) {
    while (actor.add(off + 8).readS32() > 0) native('splitterRemoveSortRuleAt')(actor, 0);
    for (const r of rules) {
      const cls = SPECIAL_DESCRIPTORS[r.item] ? native(SPECIAL_DESCRIPTORS[r.item])() : loadClass(r.item);
      if (!isUObject(cls)) throw new Error('classe d\'objet introuvable : ' + r.item);
      const rule = zeroAlloc(16, 8);
      rule.ptr.writePointer(cls);
      rule.ptr.add(8).writeS32(r.output);
      native('splitterAddSortRule')(actor, rule.ptr);
    }
  }
  return { rules: read() };
}

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

// Cree `count` objets de la classe itemPath dans un inventaire (chemin complet d'un UFGInventoryComponent, ex.
// <centrale>.FuelInventory). Uniquement sur accord explicite de l'utilisateur : c'est fabriquer des objets.
function addItemsOnGameThread(inventoryPath, count, itemPath) {
  const inventory = requireActor(inventoryPath);
  const itemClass = loadClass(itemPath);
  const classSlot = zeroAlloc(8, 8);
  classSlot.ptr.writePointer(itemClass);
  const item = zeroAlloc(0x80, 16);
  native('makeInventoryItem')(item.ptr, classSlot.ptr);
  const stack = zeroAlloc(0x80, 16);
  native('makeInventoryStack')(stack.ptr, count, item.ptr);
  const added = virtualMethod(inventory, 'addStack').fn(inventory, stack.ptr, 1);
  return { item: className(itemClass), requested: count, added, now: itemCount(inventory, itemClass) };
}

// Retire des objets d'une classe d'un inventaire (UFGInventoryComponent::Remove) ; count borne au stock present.
// Seulement a la demande de l'utilisateur (23/10/2026 : 525 stators d'un ancien quai de chargement, « vire les »)
function removeItemsOnGameThread(inventoryPath, count, itemPath) {
  const inventory = requireActor(inventoryPath);
  const itemClass = loadClass(itemPath);
  const before = itemCount(inventory, itemClass);
  const n = Math.min(count, before);
  if (n > 0) {
    const classSlot = zeroAlloc(8, 8);
    classSlot.ptr.writePointer(itemClass);
    native('inventoryRemove')(inventory, classSlot.ptr, n);
  }
  return { item: className(itemClass), requested: count, before, now: itemCount(inventory, itemClass) };
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
  // Batiment, ou vehicule ferroviaire (locomotive, wagon : meme interface de demontage que le pistolet)
  const vehicle = findFirstObject('FGRailroadVehicle', native('uclassStaticClass')());
  if (!isA(obj, native('buildableStaticClass')()) && !(!vehicle.isNull() && isA(obj, vehicle))) {
    throw new Error('refuse : ' + path + ' n\'est ni un AFGBuildable ni un vehicule ferroviaire');
  }
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

// Noms et valeurs d'un enum du jeu (ex. EOutlineColor), lus en jeu : { OC_RED: 250, ... }
function enumValues(enumName) {
  const e = findFirstObject(enumName, findFirstObject('Enum', native('uclassStaticClass')()));
  if (e.isNull()) throw new Error('enum introuvable : ' + enumName);
  const out = {};
  for (let i = 0; i < 256; i++) {
    const s = newFString();
    native('enumNameStringByIndex')(e, s, i);
    const name = readFString(s);
    freeFString(s);
    if (!name || name === 'None') break;
    const text = Memory.allocUtf16String(name);
    const f = Memory.alloc(16);
    f.writePointer(text);
    f.add(8).writeS32(name.length + 1);
    f.add(12).writeS32(name.length + 1);
    out[name.split('::').pop()] = Number(native('enumValueByNameString')(e, f, 0));
  }
  return out;
}

// Contour (comme le pistolet de demontage) sur des acteurs : couleur = nom d'EOutlineColor (OC_RED...), show false = retire
function outlineOnGameThread(ctx, paths, color, show) {
  const pawn = requirePawn(ctx);
  const comp = pawn.add(propertyOffset(native('getObjectClass')(pawn), 'mOutlineComponent')).readPointer();
  if (!isUObject(comp)) throw new Error('composant de contour introuvable sur le personnage');
  const colors = enumValues('EOutlineColor');
  const value = colors[color || 'OC_RED'];
  if (show && value === undefined) throw new Error('couleur inconnue : ' + color + ' (connues : ' + Object.keys(colors).join(', ') + ')');
  let done = 0;
  const failed = [];
  for (const path of paths) {
    const a = findObject(path);
    if (a.isNull()) { failed.push(path.split('.').pop() + ' : introuvable'); continue; }
    if (show) native('outlineShow')(comp, a, value, 1, 0);
    else native('outlineHide')(comp, a);
    done++;
  }
  return { done, failed, colors };
}

// Bulle de visualisation : deux spheres en materiau d'hologramme du pistolet de construction, sans collision ni ombre.
// Le materiau n'est dessine que d'un cote : la sphere du moteur se voit du dehors, la voute celeste du jeu (faces vers
// l'interieur) du dedans. Acteurs de decor (StaticMeshActor) : le jeu ne les sauvegarde pas ; sphereRemove les retire.
const SPHERE_MESHES = ['/Engine/BasicShapes/Sphere.Sphere', '/Game/FactoryGame/World/Environment/DayNight/StaticMeshes/SM_SkySphere_ExtraUV.SM_SkySphere_ExtraUV'];
const SPHERE_MATERIAL = '/Game/FactoryGame/Equipment/BuildGun/Material/Hologram_Blue_Inst.Hologram_Blue_Inst';

function loadObject(path) {
  const o = native('staticLoadObject')(native('uobjectStaticClass')(), NULL, wideString(path), NULL, 0, NULL, 1, NULL);
  if (!isUObject(o)) throw new Error('objet introuvable : ' + path);
  return o;
}

// Une sphere : apparait a l'echelle 1, prend son maillage, puis est mise au rayon voulu d'apres sa boite mesuree en jeu
function spawnSphere(pawn, center, radius, meshPath, material) {
  const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  slot.ptr.writePointer(loadClass('/Script/Engine.StaticMeshActor'));
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const xf = newTransform(center, identity);
  const spawn = enumValues('ESpawnActorCollisionHandlingMethod').AlwaysSpawn;
  const scaleMethod = enumValues('ESpawnActorScaleMethod').OverrideRootScale;
  const a = native('beginDeferredSpawn')(pawn, slot.ptr, xf.ptr, spawn, NULL, scaleMethod);
  if (!isUObject(a)) throw new Error('apparition refusee');
  const comp = a.add(propertyOffset(native('getObjectClass')(a), 'StaticMeshComponent')).readPointer();
  native('sceneSetMobility')(comp, enumValues('EComponentMobility').Movable);
  native('finishSpawningActor')(a, xf.ptr, scaleMethod);
  native('setActorEnableCollision')(a, 0);
  native('primitiveSetCollisionEnabled')(comp, enumValues('ECollisionEnabled').NoCollision);
  native('primitiveSetCastShadow')(comp, 0);
  native('staticMeshSetMesh')(comp, loadObject(meshPath));
  native('meshSetMaterial')(comp, 0, loadObject(material));
  const box = zeroAlloc(0x40, 8);
  native('actorLocalBox')(a, box.ptr, 1, 0);
  const half = (box.ptr.add(24).readDouble() - box.ptr.readDouble()) / 2;
  if (!(half > 0)) { native('destroyActor')(a, 0, 1); throw new Error('maillage sans taille : ' + meshPath); }
  const s = radius / half;
  native('setActorTransform')(a, newTransform(center, identity, { x: s, y: s, z: s }).ptr, 0, NULL, TELEPORT_NONE);
  return { path: splitFullName(a).path, mesh: meshPath.split('.').pop(), meshRadius: Math.round(half), scale: s };
}

// --- Fantome de plan : blocs d'hologramme qui suivent la visee du joueur ------------------------------------------
// Utilisateur, 24/10/2026 : « un hologramme de la gare que je puisse manipuler, un peu comme un blueprint » (un plan du
// jeu est limite a quelques dizaines de metres). Un acteur de decor par bloc (StaticMeshActor, cube du moteur, materiau
// d'hologramme, sans collision ; le jeu ne le sauvegarde pas). Repere du plan : u (cap axis), v = u + 90, z vertical, en
// metres ; bloc = { u, v, z, lu, lv, lz (demi-longueurs), yaw, pitch (degres, relatifs a u) }. En suivi (un tick sur
// GHOST_PERIOD_MS), le centre du plan (center, en u v) va au point vise et le sens de marche (-u) suit le regard.
const GHOST_MESH = '/Engine/BasicShapes/Cube.Cube';
const GHOST_PERIOD_MS = 100;
const ghost = { actors: [], parts: [], follow: false, frame: null, z: 15000, center: [0, 0], last: 0, half: null };
const degRad = (d) => (d * Math.PI) / 180;

// FRotator(pitch, yaw, 0).Quaternion() (formule du moteur)
function ueQuat(pitchDeg, yawDeg) {
  const sp = Math.sin(degRad(pitchDeg) / 2), cp = Math.cos(degRad(pitchDeg) / 2);
  const sy = Math.sin(degRad(yawDeg) / 2), cy = Math.cos(degRad(yawDeg) / 2);
  return { x: sp * sy, y: -sp * cy, z: cp * sy, w: cp * cy };
}

function ghostSpawnBlock(pawn, material, origin) {
  const slot = zeroAlloc(8, 8);
  slot.ptr.writePointer(loadClass('/Script/Engine.StaticMeshActor'));
  const xf = newTransform(origin, { x: 0, y: 0, z: 0, w: 1 });
  const scaleMethod = enumValues('ESpawnActorScaleMethod').OverrideRootScale;
  const a = native('beginDeferredSpawn')(pawn, slot.ptr, xf.ptr, enumValues('ESpawnActorCollisionHandlingMethod').AlwaysSpawn, NULL, scaleMethod);
  if (!isUObject(a)) throw new Error('apparition refusee');
  const comp = a.add(propertyOffset(native('getObjectClass')(a), 'StaticMeshComponent')).readPointer();
  native('sceneSetMobility')(comp, enumValues('EComponentMobility').Movable);
  native('finishSpawningActor')(a, xf.ptr, scaleMethod);
  native('setActorEnableCollision')(a, 0);
  native('primitiveSetCollisionEnabled')(comp, enumValues('ECollisionEnabled').NoCollision);
  native('primitiveSetCastShadow')(comp, 0);
  native('staticMeshSetMesh')(comp, loadObject(GHOST_MESH));
  native('meshSetMaterial')(comp, 0, loadObject(material));
  return a;
}

// Demi-cotes du cube a l'echelle 1, mesurees en jeu sur le premier bloc
function ghostMeasure(a) {
  const box = zeroAlloc(0x40, 8);
  native('actorLocalBox')(a, box.ptr, 1, 0);
  const p = box.ptr;
  const half = { x: (p.add(24).readDouble() - p.readDouble()) / 2, y: (p.add(32).readDouble() - p.add(8).readDouble()) / 2, z: (p.add(40).readDouble() - p.add(16).readDouble()) / 2 };
  if (!(half.x > 0 && half.y > 0 && half.z > 0)) throw new Error('cube sans taille : ' + GHOST_MESH);
  return half;
}

function ghostPlace(frame) {
  const a = degRad(frame.axis), b = degRad(frame.axis + 90);
  ghost.parts.forEach((p, i) => {
    const du = (p.u - ghost.center[0]) * 100, dv = (p.v - ghost.center[1]) * 100;
    const loc = { x: frame.x + du * Math.cos(a) + dv * Math.cos(b), y: frame.y + du * Math.sin(a) + dv * Math.sin(b), z: frame.z + p.z * 100 };
    const s = { x: (p.lu * 100) / ghost.half.x, y: (p.lv * 100) / ghost.half.y, z: (p.lz * 100) / ghost.half.z };
    native('setActorTransform')(ghost.actors[i], newTransform(loc, ueQuat(p.pitch || 0, frame.axis + (p.yaw || 0)), s).ptr, 0, NULL, TELEPORT_NONE);
  });
  ghost.frame = frame;
}

// Molette et touches du joueur (utilisateur : « je dois pouvoir le faire pivoter finement avec la molette souris ») :
// APlayerController::WasInputKeyJustPressed / IsInputKeyDown (Engine), noms decores retrouves dans les exports. FKey passe
// par valeur (MSVC : copie a l'adresse donnee, detruite par l'appele) : copie neuve a chaque appel, avec son seul nom et
// des details nuls, que le destructeur laisse tels quels ; disposition de FKey lue par reflexion (InputCore.Key).
const GHOST_KEYS = ['MouseScrollUp', 'MouseScrollDown', 'LeftShift', 'LeftControl', 'LeftMouseButton', 'RightMouseButton'];
function ghostInputInit() {
  if (ghost.keys) return ghost.keys;
  for (const [key, re] of [['pcWasKeyJustPressed', /^\?WasInputKeyJustPressed@APlayerController@@QEBA_NUFKey@@@Z$/],
    ['pcIsKeyDown', /^\?IsInputKeyDown@APlayerController@@QEBA_NUFKey@@@Z$/]]) {
    if (NATIVE_SPECS[key]) continue;
    const names = Process.getModuleByName(MOD.engine).enumerateExports().map((e) => e.name).filter((n) => re.test(n));
    if (names.length !== 1) throw new Error(key + ' : exports inattendus ' + JSON.stringify(names));
    NATIVE_SPECS[key] = ['engine', names[0], 'uint8', ['pointer', 'pointer']];
  }
  const st = requireStruct('/Script/InputCore.Key');
  const kn = fieldsOf(st).find((x) => x.name === 'KeyName');
  if (!kn) throw new Error('InputCore.Key : champ KeyName absent');
  const name = {};
  for (const k of GHOST_KEYS) { const b = zeroAlloc(16, 8); native('fnameCtor')(b.ptr, wideString(k), 1); name[k] = b.ptr.readU64(); }
  ghost.keys = { size: structSize(st), off: kn.offset, name, buf: zeroAlloc(structSize(st), 16) };
  return ghost.keys;
}
function ghostKey(fn, controller, k) {
  const K = ghost.keys;
  K.buf.ptr.writeByteArray(new Uint8Array(K.size));
  K.buf.ptr.add(K.off).writeU64(K.name[k]);
  return native(fn)(controller, K.buf.ptr) !== 0;
}

// Tache de tick. Chaque tick : molette = rotation de 1 deg (Maj : 10 deg), Ctrl + molette = altitude de 1 m (un cran
// n'est vu que pendant son tick) ; clic gauche = fige, clic droit = reprend le suivi (utilisateur, 24/10/2026). En suivi,
// toutes les GHOST_PERIOD_MS : centre du plan au point vise. Orientation :
// ghost.axis (cap de u ; le sens de marche dans les quais est axis + 180), fixee au regard a la creation
function ghostFollow(subsystem) {
  if (!ghost.actors.length) return;
  const ctx = gameContext(subsystem);
  let changed = false;
  if (ghost.input !== false && !ctx.controller.isNull()) {
    try {
      ghostInputInit();
      if (ghostKey('pcWasKeyJustPressed', ctx.controller, 'LeftMouseButton')) ghost.follow = false;
      if (ghostKey('pcWasKeyJustPressed', ctx.controller, 'RightMouseButton')) ghost.follow = true;
      const up = ghostKey('pcWasKeyJustPressed', ctx.controller, 'MouseScrollUp');
      const down = ghostKey('pcWasKeyJustPressed', ctx.controller, 'MouseScrollDown');
      if (up || down) {
        const s = up ? 1 : -1;
        if (ghostKey('pcIsKeyDown', ctx.controller, 'LeftControl')) ghost.z += 100 * s;
        else ghost.axis = (((ghost.axis + s * (ghostKey('pcIsKeyDown', ctx.controller, 'LeftShift') ? 10 : 1)) % 360) + 360) % 360;
        changed = true;
      }
    } catch (e) {
      ghost.input = false;
      send({ event: 'ghost.input.error', message: e.message });
    }
  }
  const now = Date.now();
  if (ghost.follow && now - ghost.last >= GHOST_PERIOD_MS) {
    ghost.last = now;
    const v = viewPoint(ctx);
    const p = degRad(v.rotation.pitch), y = degRad(v.rotation.yaw);
    const to = { x: v.location.x + 300000 * Math.cos(p) * Math.cos(y), y: v.location.y + 300000 * Math.cos(p) * Math.sin(y), z: v.location.z + 300000 * Math.sin(p) };
    const t = trace(ctx, v.location, to);
    if (t.blocked) { ghostPlace({ x: t.location.x, y: t.location.y, z: ghost.z, axis: ghost.axis }); return; }
  }
  if (changed && ghost.frame) ghostPlace(Object.assign({}, ghost.frame, { z: ghost.z, axis: ghost.axis }));
}

// --- Pose des plans au pistolet : rotation fine, et rotation en mode verrouille (H) -----------------------------------
// Utilisateur, 24/10/2026 (plan « G15 gare ») : « la rotation est pas super fine » ; « on devrait pouvoir pivoter la gare
// quand elle est figee ». Lu dans Ghidra : AFGHologram::Scroll(delta) -> ScrollRotate(delta, 10) ; ScrollRotate ne fait
// RIEN quand mHologramIsLocked (touche H : position = mHologramLockLocation + mHologramNudgeOffset, fleches et Page haut /
// bas du jeu pour la translation), sinon mScrollRotation += delta x GetRotationStep().
//  - AFGBlueprintHologram::GetRotationStep rend bpPlace.step (1 deg ; 10 deg avec Maj), sauf accroche a un autre plan (90) ;
//  - plan verrouille : a l'entree de ScrollRotate, l'hologramme tourne sur place de delta x pas (lacet de l'acteur) et
//    mScrollRotation (lu par reflexion) suit, pour qu'il ne saute pas au deverrouillage.
// Accroches par nom decore, refusees si le corps est partage (ICF).
const bpPlace = { installed: false, on: false, step: 1 };
function bpPlaceInstall() {
  if (bpPlace.installed) return;
  const rotAddr = hookableGameExport('?GetRotationStep@AFGBlueprintHologram@@UEBAHXZ');
  const scrollAddr = hookableGameExport('?ScrollRotate@AFGHologram@@UEAAXHH@Z');
  if (!NATIVE_SPECS.hologramIsLocked) {
    const names = Process.getModuleByName(MOD.game).enumerateExports().map((e) => e.name).filter((n) => /^\?IsHologramLocked@AFGHologram@@QEBA_NXZ$/.test(n));
    if (names.length !== 1) throw new Error('IsHologramLocked : exports inattendus ' + JSON.stringify(names));
    NATIVE_SPECS.hologramIsLocked = ['game', names[0], 'uint8', ['pointer']];
  }
  const bpHoloClass = loadClass('/Script/FactoryGame.FGBlueprintHologram');
  const rotOrig = new NativeFunction(rotAddr, 'int', ['pointer'], { exceptions: 'propagate' });
  Interceptor.replace(rotAddr, new NativeCallback(function (self) {
    const s = rotOrig(self);
    return bpPlace.on && s !== 90 ? bpPlace.step : s;
  }, 'int', ['pointer']));
  Interceptor.attach(scrollAddr, {
    onEnter(args) {
      if (!bpPlace.on) return;
      try {
        const self = args[0], delta = args[1].toInt32();
        if (!delta || !isA(self, bpHoloClass) || native('hologramIsLocked')(self) === 0) return;
        const d = delta * bpPlace.step;
        const at = self.add(propertyOffset(native('getObjectClass')(self), 'mScrollRotation'));
        let r = at.readS32() + d;
        while (r > 180) r -= 360;
        while (r < -180) r += 360;
        at.writeS32(r);
        const p = actorPose(self);
        native('setActorTransform')(self, newTransform(p.location, ueQuat(0, p.rotation.yaw + d)).ptr, 0, NULL, TELEPORT_NONE);
      } catch (e) { send({ event: 'bpPlace.error', message: e.message }); }
    },
  });
  bpPlace.installed = true;
}
// Tache de tick : pas de rotation selon Maj
function bpPlaceKeys(subsystem) {
  if (!bpPlace.on) return;
  const ctx = gameContext(subsystem);
  if (ctx.controller.isNull()) return;
  ghostInputInit();
  bpPlace.step = ghostKey('pcIsKeyDown', ctx.controller, 'LeftShift') ? 10 : 1;
}

// --- Sources de streaming World Partition -----------------------------------------------------------------------------
// Utilisateur, 24/10/2026 : « retrouve comment le jeu les charge » (rochers lointains absents des rayons du releve). La
// carte est en World Partition (FGWorldSettings.WorldPartition_0.FGWorldPartitionRuntimeSpatialHash_0, lu par
// reflexion) : 6 grilles de cellules (MainGrid : cellules de 128 m chargees a 256 m d'une source ; LandscapeGrid 1 024 m ;
// HLOD0 1 024 m...), chaque cellule lue sur le disque quand une source de streaming est a portee ; le controleur du
// joueur en est une. UWorldPartitionStreamingSourceComponent fait d'un acteur une source : ajoute a un StaticMeshActor sans
// maillage ni collision (invisible ; le jeu ne le sauvegarde pas) pose au point voulu, il fait charger les cellules
// autour, rochers et collisions compris, sans deplacer le joueur. Retirer l'acteur rend les cellules au streaming normal.
const streamSources = new Map(); // chemin de l'acteur -> { actor, comp, location }
function streamingSourceAdd(pawn, location) {
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  slot.ptr.writePointer(loadClass('/Script/Engine.StaticMeshActor'));
  const xf = newTransform(location, identity);
  const scaleMethod = enumValues('ESpawnActorScaleMethod').OverrideRootScale;
  const a = native('beginDeferredSpawn')(pawn, slot.ptr, xf.ptr, enumValues('ESpawnActorCollisionHandlingMethod').AlwaysSpawn, NULL, scaleMethod);
  if (!isUObject(a)) throw new Error('apparition refusee');
  native('finishSpawningActor')(a, xf.ptr, scaleMethod);
  native('setActorEnableCollision')(a, 0);
  const cslot = zeroAlloc(8, 8);
  cslot.ptr.writePointer(loadClass('/Script/Engine.WorldPartitionStreamingSourceComponent'));
  const comp = native('addComponentByClass')(a, cslot.ptr, 1, newTransform({ x: 0, y: 0, z: 0 }, identity).ptr, 0);
  if (!isUObject(comp)) { native('destroyActor')(a, 0, 1); throw new Error('composant de source de streaming refuse'); }
  const path = splitFullName(a).path;
  streamSources.set(path, { actor: a, comp, location });
  return path;
}
// Sources posees par un agent precedent (hote relance en plein releve : le retrait n'a pas pu se faire) : StaticMeshActor
// portant une source de streaming (AActor::GetComponentByClass ; AddComponentByClass ne la range pas dans
// InstanceComponents, vu le 24/10/2026) ; reprises dans streamSources
function streamingSourceAdopt(ctx) {
  const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  slot.ptr.writePointer(loadClass('/Script/Engine.WorldPartitionStreamingSourceComponent'));
  for (const a of actorsOfClass(ctx, loadClass('/Script/Engine.StaticMeshActor'))) {
    if (!isUObject(a)) continue;
    const path = splitFullName(a).path;
    if (streamSources.has(path)) continue;
    const c = native('actorComponentByClass')(a, slot.ptr);
    if (isUObject(c)) streamSources.set(path, { actor: a, comp: c, location: actorPose(a).location, adopted: true });
  }
}
function streamingSourceList() {
  const out = [];
  for (const [path, s] of streamSources) {
    if (!isUObject(s.actor) || !isUObject(s.comp)) { streamSources.delete(path); continue; }
    out.push({ path, location: s.location, completed: native('wpSourceStreamingCompleted')(s.comp) !== 0, adopted: !!s.adopted });
  }
  return out;
}

function ghostRemoveAll() {
  pump.tickHooks.delete('ghost');
  const n = ghost.actors.filter((a) => isUObject(a) && native('destroyActor')(a, 0, 1) !== 0).length;
  ghost.actors = []; ghost.parts = []; ghost.frame = null; ghost.follow = false;
  return n;
}

function sphereOnGameThread(ctx, center, radius, material) {
  const pawn = requirePawn(ctx);
  const spheres = SPHERE_MESHES.map((m) => spawnSphere(pawn, center, radius, m, material || SPHERE_MATERIAL));
  return { paths: spheres.map((s) => s.path), spheres, center: r0(center), radius };
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
  const brief = { potential: native('getPendingPotential')(actor), productivity: productivity(actor), paused: native('isProductionPaused')(actor) !== 0 };
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

// Acces aux instances legeres d'une classe : at(i) = null hors du tableau, sinon { valid, location } (la reference
// lw.ref est alors initialisee sur cette instance, prete pour lwRefRemove)
function lightweightOf(ctx, classPath) {
  const sub = native('lwSubsystemGet')(ctx.subsystem);
  if (!isUObject(sub)) throw new Error('sous-systeme des pieces legeres introuvable');
  // Chemin complet, ou nom court d'une classe deja chargee (ex. Build_Foundation_8x4_01_C) : sans instance, pas chargee
  const cls = classPath.indexOf('/') >= 0 ? loadClass(classPath) : findFirstObject(classPath, native('uclassStaticClass')());
  if (cls.isNull()) throw new Error('classe non chargee : ' + classPath);
  const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
  slot.ptr.writePointer(cls);
  const ref = zeroAlloc(0x100, 16), xf = zeroAlloc(0x60, 16);
  native('lwRefCtor')(ref.ptr);
  let n = 0;
  return {
    ref,
    count: () => n,
    at(i) {
      const data = native('lwRuntimeData')(sub, slot.ptr, i);
      if (data.isNull()) return null;
      n = Math.max(n, i + 1);
      if (native('lwDataIsValid')(data) === 0) return { valid: false };
      native('lwRefInitialize')(ref.ptr, sub, slot.ptr, i);
      native('lwRefTransform')(ref.ptr, xf.ptr);
      return { valid: true, location: readVec(xf.ptr.add(0x20)) };
    },
  };
}

// --- Trafic ferroviaire ---------------------------------------------------------------------------
// Trains (AFGTrain), horaires (AFGRailroadTimeTable) et conduite automatique (utilisateur, 26/10/2026 : « il va falloir
// que tu te dotes des outils capables de controler tout le trafic ferroviaire »). Fonctions du jeu retrouvees par leur
// nom decore dans les exports ; champs des trains et dispositions de FTimeTableStop / FTrainDockingRuleSet lus par
// reflexion : aucun decalage ecrit en dur.

// Fonction exportee retrouvee par motif (une seule correspondance exigee), inscrite dans NATIVE_SPECS au premier usage
function exportByPattern(key, mod, re, ret, args) {
  if (NATIVE_SPECS[key]) return;
  const names = Process.getModuleByName(MOD[mod]).enumerateExports().map((e) => e.name).filter((n) => re.test(n));
  if (names.length !== 1) throw new Error(key + ' : exports inattendus ' + JSON.stringify(names));
  NATIVE_SPECS[key] = [mod, names[0], ret, args];
}

const RAIL_TRAFFIC_NATIVES = [
  ['trainGetTimeTable', 'game', /^\?GetTimeTable@AFGTrain@@QEBAPEAVAFGRailroadTimeTable@@XZ$/, 'pointer', ['pointer']],
  ['trainNewTimeTable', 'game', /^\?NewTimeTable@AFGTrain@@QEAAPEAVAFGRailroadTimeTable@@XZ$/, 'pointer', ['pointer']],
  ['trainIsSelfDriving', 'game', /^\?IsSelfDrivingEnabled@AFGTrain@@QEBA_NXZ$/, 'uint8', ['pointer']],
  ['trainSetSelfDriving', 'game', /^\?SetSelfDrivingEnabled@AFGTrain@@QEAAX_N@Z$/, 'void', ['pointer', 'bool']],
  ['timeTableSetStops', 'game', /^\?SetStops@AFGRailroadTimeTable@@QEAA_NAEBV\?\$TArray@UFTimeTableStop@@/, 'uint8', ['pointer', 'pointer']],
  ['timeTableSetCurrentStop', 'game', /^\?SetCurrentStop@AFGRailroadTimeTable@@QEAAXH@Z$/, 'void', ['pointer', 'int']],
  ['stationGetIdentifier', 'game', /^\?GetStationIdentifier@AFGBuildableRailroadStation@@QEBAPEAVAFGTrainStationIdentifier@@XZ$/, 'pointer', ['pointer']],
  ['textToString', 'core', /^\?ToString@FText@@QEBAAEBVFString@@XZ$/, 'pointer', ['pointer']],
];

// Classes, decalages des champs et valeurs des enums, lus une fois
let railTraffic = null;
function railTrafficLayout() {
  if (railTraffic) return railTraffic;
  for (const spec of RAIL_TRAFFIC_NATIVES) exportByPattern(...spec);
  const cls = (n) => { const c = findFirstObject(n, native('uclassStaticClass')()); if (c.isNull()) throw new Error('classe introuvable : ' + n); return c; };
  const C = { train: cls('FGTrain'), timeTable: cls('FGRailroadTimeTable'), vehicle: cls('FGRailroadVehicle'),
    ident: cls('FGTrainStationIdentifier'), station: cls('FGBuildableRailroadStation') };
  const field = (struct, name) => { const f = fieldsOf(struct).find((x) => x.name === name); if (!f) throw new Error('champ introuvable : ' + name); return f.offset; };
  const stop = requireStruct('/Script/FactoryGame.TimeTableStop'), rules = requireStruct('/Script/FactoryGame.TrainDockingRuleSet');
  const sim = requireStruct('/Script/FactoryGame.TrainSimulationData');
  const byValue = (e) => { const out = {}; for (const [k, v] of Object.entries(enumValues(e))) out[v] = k; return out; };
  railTraffic = {
    C,
    train: { name: propertyOffset(C.train, 'mTrainName'), timeTable: propertyOffset(C.train, 'TimeTable'),
      status: propertyOffset(C.train, 'mTrainStatus'), error: propertyOffset(C.train, 'mSelfDrivingError'),
      docking: propertyOffset(C.train, 'mDockingState'), dockedAt: propertyOffset(C.train, 'mDockedAtStation'),
      derailed: propertyOffset(C.train, 'mIsDerailed'), sim: propertyOffset(C.train, 'mSimulationData') },
    sim: { vehicles: field(sim, 'SimulatedVehicles'), velocity: field(sim, 'Velocity') },
    vehicle: { reversed: propertyOffset(C.vehicle, 'mIsOrientationReversed'), length: propertyOffset(C.vehicle, 'mLength') },
    timeTable: { stops: propertyOffset(C.timeTable, 'mStops'), current: propertyOffset(C.timeTable, 'mCurrentStop') },
    ident: { name: propertyOffset(C.ident, 'mStationName'), station: propertyOffset(C.ident, 'mStation') },
    stop: { size: structSize(stop), station: field(stop, 'Station'), rules: field(stop, 'DockingRuleSet') },
    rules: { definition: field(rules, 'DockingDefinition'), duration: field(rules, 'DockForDuration'),
      durationAndRule: field(rules, 'IsDurationAndRule'), ignoreFilters: field(rules, 'IgnoreFullLoadUnloadIfTransferBlockedByFilters'),
      load: field(rules, 'LoadFilterDescriptors'), unload: field(rules, 'UnloadFilterDescriptors') },
    enums: { status: byValue('ETrainStatus'), error: byValue('ESelfDrivingLocomotiveError'), docking: byValue('ETrainDockingState'),
      definition: byValue('ETrainDockingDefinition'), definitionByName: enumValues('ETrainDockingDefinition') },
  };
  if (railTraffic.stop.size < railTraffic.stop.rules + structSize(rules)) throw new Error('taille de FTimeTableStop incoherente : ' + railTraffic.stop.size);
  return railTraffic;
}

function textString(p) {
  const s = native('textToString')(p);
  const data = s.readPointer(), num = s.add(8).readS32();
  return data.isNull() || num <= 1 ? '' : data.readUtf16String(num - 1);
}

// TArray de pointeurs appartenant a un objet du jeu : lu sans etre libere (contrairement a takePointerArray)
function readPointerArray(p) {
  const data = p.readPointer(), num = p.add(8).readS32(), out = [];
  for (let i = 0; i < num; i++) out.push(data.add(i * 8).readPointer());
  return out;
}

// Identifiant de gare (AFGTrainStationIdentifier) d'une gare, d'un identifiant, ou d'un nom de gare (mStationName exact)
function stationIdentifierOf(ctx, ref) {
  const L = railTrafficLayout();
  if (ref.indexOf('/') >= 0 || ref.indexOf(':') >= 0) {
    const o = requireActor(ref);
    if (isA(o, L.C.ident)) return o;
    if (isA(o, L.C.station)) return native('stationGetIdentifier')(o);
    throw new Error(ref + ' : ni gare ni identifiant de gare');
  }
  const found = actorsOfClass(ctx, L.C.ident).filter((i) => isUObject(i) && textString(i.add(L.ident.name)) === ref);
  if (found.length !== 1) throw new Error('gare « ' + ref + ' » : ' + found.length + ' identifiants portent ce nom');
  return found[0];
}

function stationLabel(ident) {
  const L = railTrafficLayout();
  if (!isUObject(ident)) return null;
  const st = ident.add(L.ident.station).readPointer();
  return { name: textString(ident.add(L.ident.name)), station: isUObject(st) ? splitFullName(st).path : null };
}

function readDockingRules(p) {
  const L = railTrafficLayout();
  const classes = (arr) => readPointerArray(arr).map((c) => (isUObject(c) ? splitFullName(c).path.split('.').pop() : null));
  return { definition: L.enums.definition[p.add(L.rules.definition).readU8()] || p.add(L.rules.definition).readU8(),
    duration: p.add(L.rules.duration).readFloat(), durationAndRule: p.add(L.rules.durationAndRule).readU8() !== 0,
    ignoreFilters: p.add(L.rules.ignoreFilters).readU8() !== 0,
    load: classes(p.add(L.rules.load)), unload: classes(p.add(L.rules.unload)) };
}

function readTimeTable(tt) {
  const L = railTrafficLayout();
  if (!isUObject(tt)) return null;
  const arr = tt.add(L.timeTable.stops), data = arr.readPointer(), num = arr.add(8).readS32();
  const stops = [];
  for (let i = 0; i < num; i++) {
    const s = data.add(i * L.stop.size);
    stops.push(Object.assign({ station: stationLabel(s.add(L.stop.station).readPointer()) }, readDockingRules(s.add(L.stop.rules))));
  }
  return { path: splitFullName(tt).path, current: tt.add(L.timeTable.current).readS32(), stops };
}

function trainInfo(train) {
  const L = railTrafficLayout();
  const sim = train.add(L.train.sim);
  const vehicles = readPointerArray(sim.add(L.sim.vehicles)).filter(isUObject).map((v) => {
    const n = splitFullName(v);
    return { path: n.path, class: n.cls, location: r0(actorPose(v).location), reversed: v.add(L.vehicle.reversed).readU8() !== 0,
      length: Math.round(v.add(L.vehicle.length).readFloat()) };
  });
  const docked = train.add(L.train.dockedAt).readPointer();
  return {
    path: splitFullName(train).path,
    name: textString(train.add(L.train.name)),
    vehicles,
    selfDriving: native('trainIsSelfDriving')(train) !== 0,
    status: L.enums.status[train.add(L.train.status).readU8()],
    error: L.enums.error[train.add(L.train.error).readU8()],
    docking: L.enums.docking[train.add(L.train.docking).readU8()],
    dockedAt: isUObject(docked) ? (isA(docked, L.C.station) ? stationLabel(native('stationGetIdentifier')(docked)) : splitFullName(docked).path) : null,
    derailed: train.add(L.train.derailed).readU8() !== 0,
    speed: Math.round(sim.add(L.sim.velocity).readFloat() * 0.036), // uu/s -> km/h
    timetable: readTimeTable(native('trainGetTimeTable')(train)),
  };
}

// Horaire d'un train : stops = [{ station (chemin d'une gare / d'un identifiant, ou nom exact de la gare), definition
// (nom d'ETrainDockingDefinition, avec ou sans prefixe TDD_), duration (s), durationAndRule, ignoreFilters }] ; current :
// arret suivant (index). Filtres de chargement / dechargement vides. AFGRailroadTimeTable::SetStops copie le tableau.
function trainTimetableSet(ctx, trainPath, stops, current) {
  const L = railTrafficLayout();
  const train = requireActor(trainPath);
  if (!isA(train, L.C.train)) throw new Error(trainPath + ' : pas un train (AFGTrain)');
  let tt = native('trainGetTimeTable')(train);
  if (!isUObject(tt)) tt = native('trainNewTimeTable')(train);
  if (!isUObject(tt)) throw new Error('horaire non cree');
  const buf = zeroAlloc(L.stop.size * Math.max(1, stops.length), 16);
  stops.forEach((s, i) => {
    const p = buf.ptr.add(i * L.stop.size), r = p.add(L.stop.rules);
    const ident = stationIdentifierOf(ctx, s.station);
    if (!isUObject(ident)) throw new Error('arret ' + i + ' : identifiant de gare introuvable');
    const defName = s.definition ? (s.definition.startsWith('TDD_') ? s.definition : 'TDD_' + s.definition) : null;
    const def = defName === null ? 0 : L.enums.definitionByName[defName];
    if (def === undefined) throw new Error('arret ' + i + ' : regle inconnue ' + s.definition + ' (' + Object.keys(L.enums.definitionByName).join(', ') + ')');
    p.add(L.stop.station).writePointer(ident);
    r.add(L.rules.definition).writeU8(def);
    r.add(L.rules.duration).writeFloat(s.duration || 0);
    r.add(L.rules.durationAndRule).writeU8(s.durationAndRule ? 1 : 0);
    r.add(L.rules.ignoreFilters).writeU8(s.ignoreFilters ? 1 : 0);
  });
  const arr = zeroAlloc(16, 8);
  arr.ptr.writePointer(buf.ptr); arr.ptr.add(8).writeS32(stops.length); arr.ptr.add(12).writeS32(stops.length);
  if (native('timeTableSetStops')(tt, arr.ptr) === 0) throw new Error('horaire refuse par le jeu (SetStops)');
  native('timeTableSetCurrentStop')(tt, current || 0);
  return readTimeTable(tt);
}

// Enregistreur de trains (utilisateur, 26/10/2026 : « il faudra une boucle rapide pour tester la position des trains
// avant deraillement ») : a chaque tick du jeu, position, cap et vitesse de chaque vehicule des trains suivis et etat de
// ces trains, dans un tampon des keepMs dernieres millisecondes ; fige afterMs apres qu'un train suivi passe derailee.
// Un releve toutes les periodMs (100 ms par defaut ; utilisateur : « a chaque image c'est trop »).
const trainRec = { trains: [], buf: [], keepMs: 15000, afterMs: 1500, periodMs: 100, last: 0, t0: 0, ticks: 0, frozenAt: null, derailed: null, derailedValue: null };

function trainRecTick() {
  const now = Date.now();
  if (trainRec.frozenAt !== null && now - trainRec.frozenAt > trainRec.afterMs) { pump.tickHooks.delete('trainRec'); return; }
  if (now - trainRec.last < trainRec.periodMs) return;
  trainRec.last = now;
  const L = railTrafficLayout();
  const sample = { t: now - trainRec.t0, trains: [] };
  for (const tr of trainRec.trains) {
    if (!isUObject(tr.train)) continue;
    const status = tr.train.add(L.train.status).readU8();
    const sim = tr.train.add(L.train.sim);
    sample.trains.push({ n: tr.name, s: status, v: Math.round(sim.add(L.sim.velocity).readFloat() * 0.036),
      veh: tr.vehicles.map((v) => { const p = actorPose(v); return [Math.round(p.location.x), Math.round(p.location.y), Math.round(p.location.z), Math.round(p.rotation.yaw * 10) / 10]; }) });
    // fige sur un PASSAGE au deraillement : un train deja deraille au lancement (remis sur rails sans mise a jour du statut)
    // figeait l'enregistreur des le premier releve (26/10/2026)
    if (status === trainRec.derailedValue && tr.lastStatus !== undefined && tr.lastStatus !== status && trainRec.frozenAt === null) {
      trainRec.frozenAt = now; trainRec.derailed = tr.name;
    }
    tr.lastStatus = status;
  }
  trainRec.buf.push(sample);
  while (trainRec.buf.length && sample.t - trainRec.buf[0].t > trainRec.keepMs) trainRec.buf.shift();
  trainRec.ticks++;
}

// Regulateur des tournees (utilisateur, 26/10/2026 : « on passe a la regulation de la ligne n279 » ; « il faut que tu
// maintiennes un temps moyen par boucle » ; « on s'en fout du temps d'arret » ; « est-ce qu'on peut taguer ca [...]
// pour ne pas avoir a le refaire ? ») : les trains d'une meme tournee sont espaces d'un intervalle = boucle / nombre de
// trains.
// - Tournee regulee : celle d'une gare portant l'etiquette « regulation » (AActor::Tags, sauvegardees avec la partie,
//   cf. enableTagsSaveGame). Tous les trains dont l'horaire passe par elle, groupes par horaire (une tournee par suite de
//   gares), relus toutes les 10 s : demarrage de l'hote, chargement d'une partie, train ajoute ou refait.
// - Boucle = somme des trajets moyens (moyenne des lineRegs.window dernieres mesures), sans les arrets en gare ; les
//   attentes en ligne en font partie. Calcul a l'arrivee (OnDocked) seulement : un train arrive juste apres le depart d'un
//   train retenu de sa tournee n'est pas mesure (il attendait derriere, cf. lineRegArrive). Mesures
//   gardees en etiquette sur la gare de depart : « trajet > <gare suivante> : <mesures en s> ». Une mesure a plus de
//   lineRegs.outlier fois la moyenne (ou moins de 1 / outlier) est ecartee, sauf suite de mesures semblables (cf.
//   lineRegMeasure).
// - A chaque arrivee (accroche de AFGTrain::OnDocked : un arret sans rien a transferer dure 0,1 s, un releve par seconde
//   ne le voyait pas), un train arrive moins d'un intervalle apres le depart du precedent de cette gare y est retenu
//   jusqu'a cet intervalle (stationHold), au plus un intervalle. Departs releves a chaque image, trains a quai seulement.
// Installe avec l'agent (install) ; tourne dans la boucle du jeu, n'occupe pas l'hote.
const REG_TAG = 'regulation';
const LEG_TAG_RE = /^trajet > (.+) : ([\d. ]+)$/i;
const lineRegs = { lines: new Map(), hook: null, on: false, ticks: 0, scans: 0, lastScan: 0, scanMs: 10000, error: null,
  window: 10, minHoldS: 5, maxHoldFactor: 1, outlier: 1.5, outlierMax: 3, outlierSpread: 0.25, queueS: 60 };

// Retenue d'un train a quai pendant holdS secondes de plus. La gare garde une copie de la regle de l'arret
// (mCurrentDockedWithRuleSet) et compte le temps a quai (mCurrentDockForDuration, AFGBuildableRailroadStation::Factory_Tick) ;
// chaque quai de marchandises relit les deux a chaque mise a jour (AFGBuildableTrainPlatformCargo::EvaluateRuleSet) et
// ne laisse partir le train qu'une fois la duree depassee (UpdateDockingSequence ; lu avec Ghidra le 26/10/2026). Duree
// exigee = temps deja passe a quai + retenue, « duree ET regle » : la retenue tombe d'elle-meme si l'agent s'arrete.
// Rend la duree exigee (temps a quai de la gare).
function stationHold(st, holdS) {
  const L = railTrafficLayout();
  const elapsed = st.add(propertyOffset(L.C.station, 'mCurrentDockForDuration')).readFloat();
  return stationHoldSet(st, elapsed + holdS);
}

function stationHoldSet(st, total) {
  const L = railTrafficLayout();
  const rules = st.add(propertyOffset(L.C.station, 'mCurrentDockedWithRuleSet'));
  rules.add(L.rules.duration).writeFloat(total);
  rules.add(L.rules.durationAndRule).writeU8(1);
  return total;
}

// Etiquettes Unreal d'un acteur (AActor::Tags, TArray<FName>)
function actorTagsArray(actor) {
  return actor.add(propertyOffset(native('getObjectClass')(actor), 'Tags'));
}

function actorTags(actor) {
  const arr = actorTagsArray(actor), data = arr.readPointer(), n = arr.add(8).readS32(), out = [];
  for (let i = 0; i < n; i++) out.push(fnameString(data.add(8 * i)));
  return out;
}

// Remplace la liste (tableau alloue par FMemory, que le moteur libere avec l'acteur ; noms crees par FNAME_Add)
function actorTagsSet(actor, tags) {
  const arr = actorTagsArray(actor), old = arr.readPointer();
  const data = tags.length ? native('memMalloc')(8 * tags.length, 8) : NULL;
  tags.forEach((t, i) => {
    const buf = zeroAlloc(16, 8);
    native('fnameCtor')(buf.ptr, wideString(t), 1); // EFindName::FNAME_Add
    data.add(8 * i).writeU64(buf.ptr.readU64());
  });
  arr.writePointer(data); arr.add(8).writeS32(tags.length); arr.add(12).writeS32(tags.length);
  if (!old.isNull()) fnFree(old);
}

function stationName(st) {
  const L = railTrafficLayout();
  return textString(native('stationGetIdentifier')(st).add(L.ident.name));
}

// --- Charge des tournees regulees (utilisateur, 26/10/2026 : « est-ce que tu es capable de determiner si une tournee
// necessite un train supplementaire et a contrario si une ligne n'est pas consommee ? ») : a chaque arrivee et a chaque
// depart, remplissage de chaque quai (son stock) et du wagon en face. La gare ne liste ses quais que pendant l'arret
// (mDockedPlatformList, rempli par AFGBuildableRailroadStation::DockVehiclesToPlatforms juste avant AFGTrain::OnDocked) :
// quai et wagon sont gardes de l'arrivee au depart. Diagnostic par quai : lineRegCargoDiagnosis.
let invLayout = null;
function inventoryLayout() {
  if (invLayout) return invLayout;
  exportByPattern('invSizeLinear', 'game', /^\?GetSizeLinear@UFGInventoryComponent@@QEBAHXZ$/, 'int', ['pointer']);
  exportByPattern('invSlotSize', 'game', /^\?GetSlotSize@UFGInventoryComponent@@QEBAHHV\?\$TSubclassOf@VUFGItemDescriptor@@@@@Z$/, 'int', ['pointer', 'int', 'pointer']);
  const cls = (n) => { const c = findFirstObject(n, native('uclassStaticClass')()); if (c.isNull()) throw new Error('classe introuvable : ' + n); return c; };
  const field = (struct, name) => { const f = fieldsOf(struct).find((x) => x.name === name); if (!f) throw new Error('champ introuvable : ' + name); return f.offset; };
  const stack = requireStruct('/Script/FactoryGame.InventoryStack'), item = requireStruct('/Script/FactoryGame.InventoryItem');
  const C = { inv: cls('FGInventoryComponent'), cargo: native('cargoPlatformStaticClass')(), wagon: cls('FGFreightWagon') };
  invLayout = {
    C, stacks: propertyOffset(C.inv, 'mInventoryStacks'), stackSize: structSize(stack), num: field(stack, 'NumItems'),
    itemClass: field(stack, 'Item') + field(item, 'ItemClass'), platInv: propertyOffset(C.cargo, 'mInventory'),
    platVehicle: propertyOffset(C.cargo, 'mDockedRailroadVehicle'), wagonInv: propertyOffset(C.wagon, 'mStorageInventory'),
    docked: propertyOffset(railTrafficLayout().C.station, 'mDockedPlatformList'),
  };
  return invLayout;
}

// Remplissage d'un inventaire : objets / capacite des cases pour l'objet present (GetSlotSize, fluides compris) ; null
// sans inventaire
function inventoryFill(inv) {
  const I = inventoryLayout();
  if (!isUObject(inv)) return null;
  const arr = inv.add(I.stacks), data = arr.readPointer(), n = arr.add(8).readS32();
  let items = 0, cls = NULL;
  for (let i = 0; i < n; i++) {
    const s = data.add(i * I.stackSize), num = s.add(I.num).readS32();
    if (num > 0) { items += num; if (cls.isNull()) cls = s.add(I.itemClass).readPointer(); }
  }
  if (cls.isNull()) return { fill: 0, items: 0, item: null };
  let cap = 0;
  const slots = native('invSizeLinear')(inv);
  for (let i = 0; i < slots; i++) cap += native('invSlotSize')(inv, i, cls);
  return { fill: cap > 0 ? items / cap : 0, items, item: isUObject(cls) ? splitFullName(cls).path.split('.').pop() : null };
}

// A l'arrivee : chaque quai de fret de la gare (q = rang dans la liste, quais vides compris), son stock et le wagon en face
function lineRegCargoArrive(st) {
  const I = inventoryLayout();
  return readPointerArray(st.add(I.docked)).map((plat, i) => {
    if (!isUObject(plat) || !isA(plat, I.C.cargo)) return null;
    const wagon = plat.add(I.platVehicle).readPointer();
    const wagonInv = isUObject(wagon) && isA(wagon, I.C.wagon) ? wagon.add(I.wagonInv).readPointer() : NULL;
    const quai = inventoryFill(plat.add(I.platInv).readPointer()), w = inventoryFill(wagonInv);
    return { q: i + 1, plat, wagonInv, load: native('cargoPlatformIsInLoadMode')(plat) !== 0,
      quaiIn: quai && quai.fill, wagonIn: w && w.fill, item: (w && w.item) || (quai && quai.item) };
  }).filter(Boolean);
}

function lineRegCargoDepart(line, station, recs) {
  const I = inventoryLayout();
  const st = line.cargo[station] || (line.cargo[station] = {});
  for (const r of recs) {
    const quai = isUObject(r.plat) ? inventoryFill(r.plat.add(I.platInv).readPointer()) : null, w = inventoryFill(r.wagonInv);
    const q = st[r.q] || (st[r.q] = { load: r.load, item: null, samples: [] });
    q.load = r.load;
    q.item = (w && w.item) || (quai && quai.item) || r.item || q.item;
    q.samples.push({ wagonIn: r.wagonIn, wagonOut: w && w.fill, quaiIn: r.quaiIn, quaiOut: quai && quai.fill });
    if (q.samples.length > lineRegs.window) q.samples.shift();
  }
}

// Diagnostic d'un quai sur ses derniers passages (au moins 3). Seuils de depart, choix de conception a ajuster sur les
// constats : 10 % = vide, 90 % = plein, 25 % = stock qui reste au quai apres le depart d'un train plein
function lineRegCargoDiagnosis(q) {
  const mean = (k) => { const v = q.samples.map((s) => s[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const m = { wagonIn: mean('wagonIn'), wagonOut: mean('wagonOut'), quaiIn: mean('quaiIn'), quaiOut: mean('quaiOut') };
  let diag = 'en observation';
  if (m.wagonIn === null || m.wagonOut === null) diag = 'pas de wagon en face';
  else if (q.samples.length >= 3 && q.load) {
    // trains deja pleins en arrivant : ils n'ont pas pu decharger, ce n'est pas un manque de trains (N279, 26/10/2026 :
    // arrets de 0,1 s aux deux bouts, l'utilisateur : « ca devrait etre ligne pas consommee »)
    diag = m.wagonIn >= 0.9 ? 'trains arrives deja pleins : ligne pas consommee au dechargement'
      : m.wagonOut <= 0.1 ? 'ligne pas alimentee : trains partis vides'
      : m.wagonOut >= 0.9 && m.quaiOut >= 0.25 ? 'il manque un train : trains arrives vides partis pleins, du stock reste au quai' : 'ok';
  } else if (q.samples.length >= 3) {
    diag = m.wagonIn <= 0.1 ? 'rien n\'arrive : trains vides a l\'arrivee'
      : m.wagonOut >= 0.1 || m.quaiIn >= 0.9 ? 'ligne pas consommee : quai plein ou trains repartis charges' : 'ok';
  }
  const first = q.samples[0], last = q.samples[q.samples.length - 1];
  return { m, diag, trend: first && last && first.quaiIn != null && last.quaiIn != null ? last.quaiIn - first.quaiIn : null };
}

function lineRegCargoState(line) {
  const pct = (x) => (x == null ? null : Math.round(x * 100));
  const out = {};
  for (const [station, quais] of Object.entries(line.cargo)) {
    out[station] = Object.entries(quais).map(([q, d]) => {
      const x = lineRegCargoDiagnosis(d);
      return { q: Number(q), item: d.item, load: d.load, n: d.samples.length, wagonIn: pct(x.m.wagonIn), wagonOut: pct(x.m.wagonOut),
        quaiIn: pct(x.m.quaiIn), quaiOut: pct(x.m.quaiOut), trend: pct(x.trend), diag: x.diag };
    });
  }
  return out;
}

// Mesure ajoutee a la moyenne glissante holder[key] = { v (moyenne des lineRegs.window dernieres), n (mesures), s }
function lineRegAdd(holder, key, v) {
  const e = holder[key] || (holder[key] = { v: null, n: 0, s: [] });
  e.s.push(v);
  if (e.s.length > lineRegs.window) e.s.shift();
  e.n++;
  e.v = e.s.reduce((a, b) => a + b, 0) / e.s.length;
}

// Mesure d'un trajet (utilisateur, 28/10/2026, apres une heure de trains en manuel qui avait triple les moyennes et fait
// retenir les trains 800 s a quai : « il faut trouver une maniere de plafonner », « on pourrait ecarter les valeurs qui
// s'eloignent trop de la moyenne ») : des 3 mesures, une valeur hors de [moyenne / outlier, moyenne x outlier] est
// ecartee et mise en attente. Si les outlierMax dernieres ecartees se suivent et se ressemblent (a outlierSpread pres de
// leur mediane), le temps de trajet a vraiment change : elles entrent dans la moyenne. Une suite d'incidents ne se
// ressemble pas (trains en manuel : 3 602, 2 671, 1 087 s) et reste ecartee ; l'ancienne regle acceptait toute suite de 3.
// Rend { kept, regime }.
function lineRegMeasure(holder, key, v) {
  const leg = holder[key];
  if (!leg || leg.s.length < 3 || (v <= leg.v * lineRegs.outlier && v >= leg.v / lineRegs.outlier)) {
    lineRegAdd(holder, key, v);
    holder[key].pending = [];
    return { kept: true, regime: false };
  }
  const p = leg.pending = (leg.pending || []).concat(v).slice(-lineRegs.outlierMax);
  if (p.length < lineRegs.outlierMax) return { kept: false };
  const m = p.slice().sort((a, b) => a - b)[Math.floor(p.length / 2)];
  if (!p.every((x) => Math.abs(x - m) <= m * lineRegs.outlierSpread)) return { kept: false };
  for (const x of p) lineRegAdd(holder, key, x);
  leg.pending = [];
  return { kept: true, regime: true };
}

function lineRegEvent(line, e) {
  line.events.push(Object.assign({ t: Math.round((Date.now() - line.t0) / 100) / 10 }, e));
  if (line.events.length > 200) line.events.shift();
}

// Boucle (s) : trajets moyens dans l'ordre de l'horaire, sans les arrets ; null tant qu'un trajet manque
function lineRegCycle(line) {
  let T = 0;
  for (let i = 0; i < line.order.length; i++) {
    const leg = line.legs[line.order[i] + ' > ' + line.order[(i + 1) % line.order.length]];
    if (!leg) return null;
    T += leg.v;
  }
  return T;
}

function lineRegHeadway(line) {
  const T = lineRegCycle(line);
  return T === null || !line.trains.length ? null : T / line.trains.length;
}

// Mesures d'un trajet gardees en etiquette sur sa gare de depart (remplace l'etiquette du meme trajet)
function lineRegSaveLeg(st, next, m) {
  const tags = actorTags(st).filter((t) => { const x = LEG_TAG_RE.exec(t); return !x || x[1].toLowerCase() !== next.toLowerCase(); });
  tags.push('trajet > ' + next + ' : ' + m.s.map((v) => v.toFixed(1)).join(' '));
  actorTagsSet(st, tags);
}

function lineRegNew(key, order, stationsByName) {
  const line = { key, order, trains: [], stations: {}, legs: {}, cargo: {}, events: [], t0: Date.now() };
  for (let i = 0; i < order.length; i++) {
    line.stations[order[i]] = { lastDep: null, lastTrain: null, lastPath: null };
    const st = stationsByName[order[i]], next = order[(i + 1) % order.length];
    if (!st) continue;
    for (const t of actorTags(st)) {
      const x = LEG_TAG_RE.exec(t);
      if (!x || x[1].toLowerCase() !== next.toLowerCase()) continue;
      // relues avec la meme regle : des mesures aberrantes gardees avant elle (trains en manuel) sont ecartees
      for (const v of x[2].trim().split(/\s+/).map(Number).filter((n) => n > 0)) lineRegMeasure(line.legs, order[i] + ' > ' + next, v);
    }
  }
  lineRegEvent(line, { start: order.join(' -> '), cycle: lineRegCycle(line) });
  return line;
}

// Train ajoute a une tournee ; deja a quai : heure d'arrivee inconnue, pas de retenue a cet arret (partial)
function lineRegTrain(train, now) {
  const L = railTrafficLayout();
  const tr = { train, path: splitFullName(train).path, name: textString(train.add(L.train.name)), at: null, from: null };
  const d = train.add(L.train.dockedAt).readPointer();
  if (isUObject(d) && isA(d, L.C.station)) tr.at = { name: stationName(d), station: d, t: now, hold: 0, partial: true };
  return tr;
}

// Leve les retenues en cours d'une tournee (AFGBuildableRailroadStation::ClearRuleSetTimeRequirement)
function lineRegRelease(line) {
  exportByPattern('stationClearRuleSetTime', 'game', /^\?ClearRuleSetTimeRequirement@AFGBuildableRailroadStation@@QEAAXXZ$/, 'void', ['pointer']);
  const out = [];
  for (const t of line.trains) {
    if (t.at && t.at.hold && isUObject(t.at.station)) { native('stationClearRuleSetTime')(t.at.station); out.push(t.name + ' @ ' + t.at.name); }
  }
  return out;
}

// Tournees regulees : trains dont l'horaire passe par une gare etiquetee, groupes par suite de gares (commencee a la
// premiere gare etiquetee, par ordre alphabetique, pour que la cle ne depende pas de l'arret suivant)
function lineRegScan(subsystem) {
  const L = railTrafficLayout(), ctx = { subsystem };
  const regulated = new Set(), stationsByName = {};
  for (const id of actorsOfClass(ctx, L.C.ident)) {
    if (!isUObject(id)) continue;
    const st = id.add(L.ident.station).readPointer();
    if (!isUObject(st)) continue;
    const name = textString(id.add(L.ident.name));
    stationsByName[name] = st;
    if (actorTags(st).some((t) => t.toLowerCase() === REG_TAG)) regulated.add(name);
  }
  const groups = new Map();
  if (regulated.size) {
    for (const t of actorsOfClass(ctx, L.C.train)) {
      if (!isUObject(t)) continue;
      const tt = native('trainGetTimeTable')(t);
      if (!isUObject(tt)) continue;
      const order = readTimeTable(tt).stops.map((s) => s.station && s.station.name);
      if (order.length < 2 || order.some((n) => !n)) continue;
      const anchor = order.filter((n) => regulated.has(n)).sort()[0];
      if (!anchor) continue;
      const i = order.indexOf(anchor), rot = order.slice(i).concat(order.slice(0, i)), key = rot.join(' | ');
      if (!groups.has(key)) groups.set(key, { order: rot, trains: [] });
      groups.get(key).trains.push(t);
    }
  }
  for (const [key, line] of lineRegs.lines) if (!groups.has(key)) { lineRegRelease(line); lineRegs.lines.delete(key); }
  const now = Date.now();
  for (const [key, g] of groups) {
    let line = lineRegs.lines.get(key);
    if (!line) { line = lineRegNew(key, g.order, stationsByName); lineRegs.lines.set(key, line); }
    const before = line.trains.length;
    line.trains = line.trains.filter((tr) => g.trains.some((p) => p.equals(tr.train)));
    for (const p of g.trains) if (!line.trains.some((tr) => tr.train.equals(p))) line.trains.push(lineRegTrain(p, now));
    if (line.trains.length !== before) lineRegEvent(line, { trains: line.trains.map((t) => t.name), headway: lineRegHeadway(line) });
  }
}

function lineRegArrive(line, tr, st, now) {
  const name = stationName(st);
  tr.at = { name, station: st, t: now, hold: 0 };
  try { tr.at.cargo = lineRegCargoArrive(st); } catch (e) { lineRegs.error = 'charge a l\'arrivee : ' + e.message; }
  const s = line.stations[name] || (line.stations[name] = { lastDep: null, lastTrain: null, lastPath: null });
  if (tr.from) {
    const key = tr.from.name + ' > ' + name, v = (now - tr.from.t) / 1000;
    // Arrive moins de queueS apres le depart d'un train de la tournee retenu ici : il attendait derriere lui, a l'entree de
    // la gare. Cette attente vient du regulateur : la compter allongeait la boucle, donc l'intervalle et les retenues
    // (28/10/2026, retour de la N279 mesure 1 450 a 2 000 s pour 240 s). Trajet non mesure. Les autres attentes en ligne
    // font partie du trajet (utilisateur : « une attente peut etre normale sur un trajet »).
    if (s.lastHeld && s.lastPath !== tr.path && s.lastDep !== null && (now - s.lastDep) / 1000 < lineRegs.queueS && s.lastDep > tr.from.t) {
      lineRegEvent(line, { train: tr.name, leg: key, nonMesure: Math.round(v), derriere: s.lastTrain });
    } else {
      // trajet aberrant ecarte (deraillement, train arrete en ligne ou en manuel ; utilisateur, 27/10/2026 : « ca va faire
      // exploser les temps de trajet cet incident »)
      const r = lineRegMeasure(line.legs, key, v);
      if (!r.kept) lineRegEvent(line, { train: tr.name, leg: key, ecarte: Math.round(v), moyenne: Math.round(line.legs[key].v) });
      else {
        if (r.regime) lineRegEvent(line, { train: tr.name, leg: key, nouveauTemps: Math.round(line.legs[key].v) });
        if (isUObject(tr.from.station)) lineRegSaveLeg(tr.from.station, name, line.legs[key]);
      }
    }
  }
  const h = lineRegHeadway(line);
  const ev = { train: tr.name, arrive: name, headway: h === null ? null : Math.round(h) };
  if (h !== null && s.lastDep !== null && s.lastPath !== tr.path) {
    const target = s.lastDep + h * 1000; // depart vise : un intervalle apres le train precedent
    ev.sincePrev = Math.round((now - s.lastDep) / 1000);
    if ((target - now) / 1000 >= lineRegs.minHoldS) {
      tr.at.hold = Math.min(h * lineRegs.maxHoldFactor, (target - now) / 1000);
      // appele depuis AFGTrain::OnDocked : la gare vient de remettre son compteur a zero et de recopier la regle de
      // l'horaire (AFGBuildableRailroadStation::StartDocking) ; la retenue ecrite ici n'est plus ecrasee
      stationHoldSet(st, tr.at.hold);
      ev.hold = Math.round(tr.at.hold);
    }
  }
  lineRegEvent(line, ev);
}

function lineRegDepart(line, tr, now) {
  const a = tr.at, s = line.stations[a.name] || (line.stations[a.name] = { lastDep: null, lastTrain: null, lastPath: null });
  s.lastDep = now; s.lastTrain = tr.name; s.lastPath = tr.path; s.lastHeld = !!a.hold;
  if (a.cargo) { try { lineRegCargoDepart(line, a.name, a.cargo); } catch (e) { lineRegs.error = 'charge au depart : ' + e.message; } }
  tr.from = { name: a.name, station: a.station, t: now };
  tr.at = null;
  lineRegEvent(line, { train: tr.name, depart: a.name, dwell: Math.round((now - a.t) / 1000), held: a.hold ? Math.round(a.hold) : 0 });
}

// Arrivee : accroche de AFGTrain::OnDocked(train, gare), appelee par la gare au debut de l'arret
function lineRegOnDocked(train, st) {
  for (const line of lineRegs.lines.values()) {
    const tr = line.trains.find((t) => t.train.equals(train));
    if (tr) { if (!tr.at) lineRegArrive(line, tr, st, Date.now()); return; }
  }
}

// A chaque image : releve des tournees toutes les 10 s, departs des trains a quai (aucun calcul : il se fait a l'arrivee,
// dans OnDocked). Les erreurs sont gardees
// (lineRegs.error) : une erreur levee retirerait la tache de la boucle du jeu
function lineRegTick(subsystem) {
  lineRegs.ticks++;
  try {
    const now = Date.now();
    if (now - lineRegs.lastScan >= lineRegs.scanMs) { lineRegs.lastScan = now; lineRegs.scans++; lineRegScan(subsystem); }
    let L = null;
    for (const line of lineRegs.lines.values()) {
      for (const tr of line.trains) {
        if (!tr.at || !isUObject(tr.train)) continue;
        L = L || railTrafficLayout();
        if (!isUObject(tr.train.add(L.train.dockedAt).readPointer())) lineRegDepart(line, tr, now);
      }
    }
  } catch (e) {
    lineRegs.error = new Date().toTimeString().slice(0, 8) + ' ' + e.message;
  }
}

function lineRegStart() {
  if (lineRegs.on) return;
  // nom decore : refuse si la signature change a une mise a jour, ou si le corps est partage (ICF)
  const addr = hookableGameExport('?OnDocked@AFGTrain@@QEAAXPEAVAFGBuildableRailroadStation@@@Z');
  lineRegs.hook = Interceptor.attach(addr, {
    onEnter(args) {
      if (!lineRegs.on) return;
      try { lineRegOnDocked(args[0], args[1]); } catch (e) { lineRegs.error = 'OnDocked : ' + e.message; }
    },
  });
  lineRegs.lastScan = 0;
  pump.tickHooks.set('lineReg', lineRegTick);
  lineRegs.on = true;
}

function lineRegStop() {
  pump.tickHooks.delete('lineReg');
  if (lineRegs.hook) { lineRegs.hook.detach(); lineRegs.hook = null; }
  lineRegs.on = false;
  const released = [];
  for (const line of lineRegs.lines.values()) released.push(...lineRegRelease(line));
  lineRegs.lines.clear();
  return released;
}

function lineRegulatorState(nEvents) {
  const now = Date.now(), r = (x) => (x == null ? null : Math.round(x)), r1 = (x) => Math.round(x * 10) / 10;
  return {
    on: lineRegs.on, ticks: lineRegs.ticks, scans: lineRegs.scans, error: lineRegs.error,
    lines: Array.from(lineRegs.lines.values()).map((line) => {
      const stations = {}, legs = {};
      for (const [k, s] of Object.entries(line.stations)) stations[k] = { sinceLastDepS: s.lastDep === null ? null : r((now - s.lastDep) / 1000), lastTrain: s.lastTrain };
      for (const [k, l] of Object.entries(line.legs)) legs[k] = { v: r1(l.v), n: l.n, s: l.s.map(r1) };
      return {
        order: line.order, upS: r((now - line.t0) / 1000), cycleS: r(lineRegCycle(line)), headwayS: r(lineRegHeadway(line)),
        trains: line.trains.map((t) => ({ name: t.name, path: t.path,
          at: t.at ? { station: t.at.name, sinceS: r((now - t.at.t) / 1000), hold: r(t.at.hold), partial: !!t.at.partial } : null,
          from: t.from ? { station: t.from.name, sinceS: r((now - t.from.t) / 1000) } : null })),
        stations, legs, cargo: lineRegCargoState(line), events: line.events.slice(-(nEvents || 20)),
      };
    }),
  };
}

// Levier d'aiguillage sur un connecteur de rail : hologramme du levier place par
// AFGRailroadSwitchControlHologram::SetHologramLocationAndRotationFromConnection (connecteur commande, position et cap pris
// sur lui), puis construction (voir la commande switchControl). opts : dryRun, force, ignore
function placeSwitchControl(ctx, conn, opts) {
  exportByPattern('switchHoloFromConnection', 'game', /^\?SetHologramLocationAndRotationFromConnection@AFGRailroadSwitchControlHologram@@QEAAXPEAVUFGRailroadTrackConnectionComponent@@@Z$/, 'void', ['pointer', 'pointer']);
  const loc = zeroAlloc(24, 8);
  native('railConnLocation')(conn, loc.ptr);
  const res = placeValidateConstruct(ctx, 'Recipe_RailroadSwitchControl_C', readVec(loc.ptr), (holo) => {
    native('switchHoloFromConnection')(holo, conn);
    return { mode: 'connection' };
  }, opts || {});
  if (res.built) res.switchControl = dumpObject(conn, 1, 1, ['mSwitchControl']).mSwitchControl || null;
  return res;
}

// Connecteur devenu aiguillage (2 branches ou plus) sans levier : pose le levier. Rend son chemin, { failed } si le jeu le
// refuse, null s'il n'y avait rien a faire
function ensureSwitchControl(ctx, conn) {
  const links = zeroAlloc(16, 8);
  native('railConnConnections')(conn, links.ptr);
  if (takePointerArray(links.ptr).filter(isUObject).length < 2) return null;
  if (dumpObject(conn, 1, 1, ['mSwitchControl']).mSwitchControl) return null;
  const r = placeSwitchControl(ctx, conn, {});
  return r.built ? r.switchControl : { failed: r.blocking };
}

function withContext(label, fn) {
  return onGameThread(label, (subsystem) => fn(gameContext(subsystem)));
}

Object.assign(rpc.exports, {
  install() {
    const warm = warmUp();
    installPump();
    // regulateur des tournees etiquetees : il tourne des le demarrage de l'agent (une erreur ne bloque pas l'agent)
    let regulator = 'en marche';
    try { lineRegStart(); } catch (e) { regulator = 'ERREUR ' + e.message; }
    return Object.assign(pumpStatus(), warm, { tagsSaveGame: enableTagsSaveGame(), regulator });
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
  // Rail construit : levier pose a chaque bout devenu aiguillage (le sien ou celui du rail voisin), car le jeu ne le
  // construit pas avec le rail de l'agent (utilisateur, 26/10/2026 : « je t'avais pourtant demande de le faire en auto » ;
  // 20 aiguillages sans levier apres les chantiers de bouts d'anneau, raccords faits par la pose et non par railLink)
  rail(recipe, from, to, opts) {
    return withContext('rail', (ctx) => {
      const res = railOnGameThread(ctx, recipe, from, to, opts);
      if (res.built && res.actor) {
        const comps = [];
        for (const c of trackConnections(requireActor(res.actor))) {
          comps.push(c.comp);
          for (const o of c.connections) if (o.track) comps.push(requireRailConnection(o.track, o.name).comp);
        }
        res.switchControls = comps.map((c) => ensureSwitchControl(ctx, c)).filter(Boolean);
      }
      return res;
    });
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
  // opts.who : composant touche (FHitResult.Component), pour savoir si c'est le relief, un arbre, un rocher, un batiment
  rays(segments, opts) {
    return withContext('rays', (ctx) => {
      const who = opts && opts.who ? hitComponentOffset() : null;
      return segments.map(({ from, to }) => {
        const t = trace(ctx, from, to);
        if (!t.blocked) return { hit: false };
        const out = { hit: true, location: r0(t.location) };
        if (who !== null) {
          const comp = native('weakObjectPtrGet')(t.hit.ptr.add(who));
          out.component = comp.isNull() ? null : splitFullName(comp);
        }
        return out;
      });
    });
  },
  // Balayages de boites en lot : [{from, to, half: {x,y,z}, yaw?, pitch?}] -> [{hit, location (centre de la boite au
  // contact), impact (point touche), normal, component}]. Axe X de la boite le long du trajet sauf yaw / pitch imposes.
  // Relief et rochers : charges loin du joueur ; batiments : collisions chargees a ~100 m seulement
  sweeps(items) {
    return withContext('sweeps', (ctx) => withoutFoliage(ctx, () => {
      const who = hitComponentOffset();
      return items.map(({ from, to, half, yaw, pitch }) => {
        const t = sweepBox(ctx, from, to, half, yaw, pitch);
        if (!t.blocked) return { hit: false };
        const comp = native('weakObjectPtrGet')(t.hit.ptr.add(who));
        return { hit: true, location: r0(t.location), impact: r0(t.impact), normal: t.normal, component: comp.isNull() ? null : splitFullName(comp) };
      });
    }));
  },
  // Relief naturel sur une grille : nx * ny mailles de `step` uu depuis (x0, y0) ; altitude (uu, arrondie) du relief ou des
  // rochers, batiments et vegetation traverses (comptes dans skipped), null sans sol entre zTop et zBottom
  relief(x0, y0, nx, ny, step, zTop, zBottom) {
    return withContext('relief', (ctx) => withoutFoliage(ctx, () => {
      const who = hitComponentOffset();
      const skipped = {};
      const z = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const h = naturalTop(ctx, x0 + i * step, y0 + j * step, zTop, zBottom, who, skipped);
          z.push(h === null ? null : Math.round(h));
        }
      }
      return { x0, y0, nx, ny, step, z, skipped, foliageIgnored: traceQueryParams.foliageIgnored };
    }));
  },
  // Relief naturel en une liste de points [{x, y}] (meme regle que relief) : releve fin des seules mailles accidentees
  // d'un releve grossier (tracer.js, releve a deux finesses, 24/10/2026)
  reliefPoints(points, zTop, zBottom) {
    return withContext('reliefPoints', (ctx) => withoutFoliage(ctx, () => {
      const who = hitComponentOffset();
      const skipped = {};
      const z = points.map((p) => { const h = naturalTop(ctx, p.x, p.y, zTop, zBottom, who, skipped); return h === null ? null : Math.round(h); });
      return { z, skipped };
    }));
  },
  // Tests de boites posees en lot : [{center, half, yaw?, pitch?}] -> [true si un obstacle bloquant la touche]
  overlaps(items) {
    return withContext('overlaps', (ctx) => items.map(({ center, half, yaw, pitch }) => {
      const c = newVector(center);
      const q = newQuat(quatFromRotator(pitch || 0, yaw || 0, 0));
      const shape = newBoxShape(half);
      return native('overlapBlockingTestByChannel')(ctx.world, c.ptr, q.ptr, ECC_VISIBILITY, shape.ptr,
        dataExport('engine', QUERY_PARAMS), dataExport('engine', RESPONSE_PARAMS)) !== 0;
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
  // Parcours du reseau electrique depuis un batiment, par ses connecteurs (cables, liaisons cachees), sans traverser
  // les batiments `exclude` : premier generateur dont la classe contient `target` (ex. GeneratorNuclear), ou rien.
  // Sert a savoir si retirer des poteaux couperait un batiment de la production.
  powerReach(startPath, exclude, target, maxNodes) {
    return withContext('powerReach', () => {
      const circuitClass = native('circuitConnectionStaticClass')();
      const skip = new Set((exclude || []).map((p) => requireActor(p).toString()));
      const start = requireActor(startPath);
      const seen = new Set([start.toString()]), queue = [{ actor: start, depth: 0 }];
      let visited = 0;
      while (queue.length && visited < (maxNodes || 200000)) {
        const { actor, depth } = queue.shift();
        visited++;
        const cls = splitFullName(actor).cls;
        if (actor !== start && target && cls.indexOf(target) >= 0) return { found: splitFullName(actor).path, depth, visited };
        const slot = zeroAlloc(8, 8); slot.ptr.writePointer(circuitClass);
        const arr = zeroAlloc(16, 8);
        native('getComponentsByClass')(actor, arr.ptr, slot.ptr);
        for (const comp of takePointerArray(arr.ptr)) {
          if (!isUObject(comp)) continue;
          const links = zeroAlloc(16, 8);
          native('circuitGetConnections')(comp, links.ptr);
          for (const other of takePointerArray(links.ptr)) {
            if (!isUObject(other)) continue;
            const path = splitFullName(other).path, owner = findObject(path.slice(0, path.lastIndexOf('.')));
            if (owner.isNull() || seen.has(owner.toString()) || skip.has(owner.toString())) continue;
            seen.add(owner.toString());
            queue.push({ actor: owner, depth: depth + 1 });
          }
        }
      }
      return { found: null, visited };
    });
  },
  // Voisins electriques directs (cables, liaisons internes) de chaque acteur : sert a reperer, avant un demontage, les
  // batiments hors de la zone qui y sont relies
  powerLinks(paths) {
    return withContext('powerLinks', () => {
      const circuitClass = native('circuitConnectionStaticClass')();
      return paths.map((p) => {
        const actor = requireActor(p);
        const links = new Set();
        const slot = zeroAlloc(8, 8); slot.ptr.writePointer(circuitClass);
        const arr = zeroAlloc(16, 8);
        native('getComponentsByClass')(actor, arr.ptr, slot.ptr);
        for (const comp of takePointerArray(arr.ptr)) {
          if (!isUObject(comp)) continue;
          const conns = zeroAlloc(16, 8);
          native('circuitGetConnections')(comp, conns.ptr);
          for (const other of takePointerArray(conns.ptr)) {
            if (!isUObject(other)) continue;
            const path = splitFullName(other).path;
            links.add(path.slice(0, path.lastIndexOf('.')));
          }
        }
        return { path: p, links: [...links] };
      });
    });
  },
  // Circuit electrique par son numero (power().circuitId) : chemin de l'objet, a lire ensuite avec dump
  // (mPowerProduced, mPowerConsumed, mPowerProductionCapacity, mIsFuseTriggered...)
  circuit(subsystemPath, id) {
    return withContext('circuit', () => {
      const c = native('findCircuit')(requireActor(subsystemPath), id);
      return isUObject(c) ? { path: splitFullName(c).path } : { path: null };
    });
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
  // Pieces legeres d'une classe (chemin complet, ex. .../Build_Foundation_8x1_01.Build_Foundation_8x1_01_C) : instances
  // valides a moins de radius (uu, en plan) de center ; sans center, toutes. -> { count, items: [{ index, location }] }
  lightweight(classPath, center, radius) {
    return withContext('lightweight', (ctx) => {
      const lw = lightweightOf(ctx, classPath), items = [];
      for (let i = 0; ; i++) {
        const st = lw.at(i);
        if (st === null) break;
        if (!st.valid) continue;
        if (center && Math.hypot(st.location.x - center.x, st.location.y - center.y) > radius) continue;
        items.push({ index: i, location: r0(st.location) });
      }
      return { count: lw.count(), items };
    });
  },
  // Retire des pieces legeres par numero, chacune seulement si elle est encore la ou on l'attend (at[k], a 20 uu pres)
  lightweightRemove(classPath, indices, at) {
    return withContext('lightweightRemove', (ctx) => {
      const lw = lightweightOf(ctx, classPath);
      return indices.map((i, k) => {
        const st = lw.at(i);
        if (st === null || !st.valid) return { index: i, removed: false, reason: 'absente' };
        if (at && at[k] && Math.hypot(st.location.x - at[k].x, st.location.y - at[k].y, st.location.z - at[k].z) > 20) {
          return { index: i, removed: false, reason: 'ailleurs : ' + JSON.stringify(r0(st.location)) };
        }
        return { index: i, removed: native('lwRefRemove')(lw.ref.ptr) !== 0 };
      });
    });
  },
  // Taille de pile reelle (UFGItemDescriptor::GetStackSize) de chaque objet : chemins de classes
  stackSize(itemPaths) {
    return withContext('stackSize', () => itemPaths.map((p) => {
      const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
      const cls = loadClass(p);
      slot.ptr.writePointer(cls);
      return { item: className(cls), stackSize: native('itemStackSize')(slot.ptr) };
    }));
  },
  addItems(inventoryPath, count, itemPath) {
    return withContext('addItems', () => addItemsOnGameThread(inventoryPath, count, itemPath));
  },
  removeItems(inventoryPath, count, itemPath) {
    return withContext('removeItems', () => removeItemsOnGameThread(inventoryPath, count, itemPath));
  },
  // Regles de tri d'un repartiteur intelligent (AFGBuildableSplitterSmart.mSortRules) : sans rules, les lit ; avec rules
  // = [{ item, output }], les remplace. item : 'any' | 'overflow' | 'none' | 'undefined' | chemin de classe d'objet ;
  // output : 0, 1 (centre) ou 2.
  smartRules(path, rules) {
    return withContext('smartRules', () => smartRulesOnGameThread(path, rules));
  },
  addShards(path, count, itemPath) {
    return withContext('addShards', () => addPotentialItemsOnGameThread(path, count || 1, itemPath));
  },
  // Rearme le disjoncteur d'un circuit, comme le bouton du jeu (UFGPowerCircuit::ResetFuse avec le controleur du joueur)
  resetFuse(subsystemPath, id) {
    return withContext('resetFuse', (ctx) => {
      const c = native('findCircuit')(requireActor(subsystemPath), id);
      if (!isUObject(c)) throw new Error('circuit ' + id + ' introuvable');
      const pawn = requirePawn(ctx);
      const controller = pawn.add(propertyOffset(native('getObjectClass')(pawn), 'Controller')).readPointer();
      if (!isUObject(controller)) throw new Error('controleur du joueur introuvable');
      native('resetFuse')(c, controller);
      return { circuit: splitFullName(c).path };
    });
  },
  // Toutes les machines (AFGBuildableFactory, generateurs compris) : pause, cadence, consommation a cette cadence
  // (mPowerConsumption x cadence ^ mPowerConsumptionExponent, lus par reflexion)
  machines() {
    return withContext('machines', (ctx) => {
      const byClass = new Map();
      const out = [];
      for (const a of actorsOfClass(ctx, native('factoryStaticClass')())) {
        if (!isUObject(a)) continue;
        const cls = native('getObjectClass')(a);
        if (!byClass.has(cls.toString())) {
          let power = null, exponent = null;
          try { power = propertyOffset(cls, 'mPowerConsumption'); exponent = propertyOffset(cls, 'mPowerConsumptionExponent'); } catch (e) { /* sans consommation */ }
          byClass.set(cls.toString(), { power, exponent });
        }
        const off = byClass.get(cls.toString());
        const name = splitFullName(a);
        const p = actorPose(a).location;
        const potential = native('getCurrentPotential')(a);
        const base = off.power === null ? 0 : a.add(off.power).readFloat();
        const exp = off.exponent === null ? 1 : a.add(off.exponent).readFloat();
        out.push({ path: name.path, cls: name.cls, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z),
          paused: native('isProductionPaused')(a) !== 0, potential, mw: Math.round(base * Math.pow(potential, exp) * 10) / 10 });
      }
      return out;
    });
  },
  // Pause (true) ou reprise (false) d'une liste de machines ; renvoie le nombre traite et les echecs
  pauseMany(paths, paused) {
    return withContext('pauseMany', () => {
      let done = 0;
      const failed = [];
      for (const path of paths) {
        try {
          const actor = requireFactory(path);
          virtualMethod(actor, 'setIsProductionPaused').fn(actor, paused ? 1 : 0);
          done++;
        } catch (e) { failed.push(path.split('.').pop() + ' : ' + e.message); }
      }
      return { done, failed };
    });
  },
  // Machines en amont d'une liste d'acteurs, par les convoyeurs et les tuyaux. On traverse convoyeurs, ascenseurs,
  // repartiteurs, fusionneurs, stockages, tuyaux, jonctions, pompes, vannes et reservoirs ; on remonte a leur tour les
  // machines a recette ; on s'arrete aux quais de gare et aux ports de drones (relies a une autre gare ou un autre port,
  // a remonter a part). Un tuyau
  // n'a pas de sens : une machine n'y est une source que par un raccord producteur.
  // down : vers l'aval (sorties, raccords producteurs ; une machine n'est atteinte par un tuyau que par un consommateur)
  upstream(paths, maxNodes, down) {
    return withContext('upstream', () => {
      const beltDir = down ? 'output' : 'input';
      const ownPipe = down ? 'tuyau-producteur' : 'tuyau-consommateur';
      const otherPipe = down ? 'tuyau-consommateur' : 'tuyau-producteur';
      const uclass = native('uclassStaticClass')();
      const manufacturer = native('manufacturerStaticClass')();
      const extractor = findFirstObject('FGBuildableResourceExtractorBase', uclass);
      const generator = findFirstObject('FGBuildableGenerator', uclass);
      const cargo = findFirstObject('FGBuildableTrainPlatformCargo', uclass);
      const drone = findFirstObject('FGBuildableDroneStation', uclass);
      const kindOf = (a) => (isA(a, cargo) ? 'quai' : !drone.isNull() && isA(a, drone) ? 'drone'
        : isA(a, manufacturer) || isA(a, extractor) || isA(a, generator) ? 'machine' : 'passif');
      const linkedOf = (comp) => {
        const p = comp.add(propertyOffset(native('getObjectClass')(comp), 'mConnectedComponent')).readPointer();
        return isUObject(p) ? p : null;
      };
      const pipeType = (comp) => PIPE_CONNECTION_TYPE[comp.add(propertyOffset(native('getObjectClass')(comp), 'mPipeConnectionType')).readU8()];
      const ownerOf = (comp) => {
        const path = splitFullName(comp).path;
        return findObject(path.slice(0, path.lastIndexOf('.')));
      };
      const seen = new Set();
      const queue = [];
      const machines = [];
      const platforms = [];
      const passives = []; // convoyeurs, ascenseurs, raccords, stockages, tuyaux traverses (pour un demontage)
      for (const p of paths) {
        const a = requireActor(p);
        seen.add(a.toString());
        queue.push({ actor: a, depth: 0 });
      }
      let visited = 0;
      while (queue.length && visited < (maxNodes || 50000)) {
        const { actor, depth } = queue.shift();
        visited++;
        const passive = kindOf(actor) === 'passif';
        const links = [];
        for (const c of factoryConnections(actor)) if (c.direction === beltDir && c.connected) links.push({ comp: linkedOf(c.comp), pipe: false });
        for (const c of pipeConnections(actor)) if (c.connected && (passive || c.direction === ownPipe)) links.push({ comp: linkedOf(c.comp), pipe: true });
        for (const { comp, pipe } of links) {
          if (comp === null) continue;
          const owner = ownerOf(comp);
          if (owner.isNull() || seen.has(owner.toString())) continue;
          const kind = kindOf(owner);
          // Par un tuyau, une machine voisine qui consomme le meme fluide n'est pas une source
          if (pipe && kind !== 'passif' && pipeType(comp) !== otherPipe) continue;
          seen.add(owner.toString());
          const name = splitFullName(owner);
          const short = name.path.split('.').pop();
          if (kind === 'quai' || kind === 'drone') { platforms.push({ path: short, kind, depth: depth + 1, paused: native('isProductionPaused')(owner) !== 0 }); continue; }
          if (kind === 'machine') {
            const m = { path: short, cls: name.cls.split('.').pop(), depth: depth + 1, paused: native('isProductionPaused')(owner) !== 0 };
            if (isA(owner, manufacturer)) {
              const recipe = zeroAlloc(8, 8);
              native('getCurrentRecipe')(owner, recipe.ptr);
              m.recipe = className(recipe.ptr.readPointer());
            }
            machines.push(m);
            queue.push({ actor: owner, depth: depth + 1 });
          } else {
            passives.push(short);
            queue.push({ actor: owner, depth });
          }
        }
      }
      return { visited, truncated: queue.length > 0, machines, platforms, passives };
    });
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
  // Etiquettes Unreal d'un acteur (AActor::Tags, TArray<FName>) : sans tags, les lit ; avec tags, remplace la liste
  // (tableau alloue par FMemory, que le moteur libere avec l'acteur ; noms crees par FNAME_Add). Essai du 23/10/2026 :
  // l'utilisateur veut savoir si le jeu les sauvegarde (pour noter les matieres attendues sur une gare)
  tags(path, tags) {
    return withContext('tags', () => {
      const actor = requireActor(path);
      if (tags) actorTagsSet(actor, tags);
      return { tags: actorTags(actor) };
    });
  },
  // Drapeau « a sauvegarder » (CPF_SaveGame) d'une propriete : struct = chemin d'une classe ou structure (ex.
  // /Script/Engine.Actor), name = propriete ; on = true / false le pose ou l'enleve, absent le lit. En memoire seulement :
  // a refaire a chaque lancement du jeu, AVANT tout chargement de partie (sinon la valeur sauvegardee est ignoree, a
  // verifier). Essai du 23/10/2026 sur AActor.Tags (utilisateur : « je continue a preferer les tags, on essaye »)
  saveGameFlag(structPath, name, on) {
    return withContext('saveGameFlag', () => {
      const prop = findProperty(requireStruct(structPath), name);
      const at = prop.add(propertyFlagsOffset());
      const before = at.readU64();
      if (on === true) at.writeU64(before.or(CPF_SAVEGAME));
      if (on === false) at.writeU64(before.and(CPF_SAVEGAME.not()));
      const after = at.readU64();
      return { property: structPath + '.' + name, flagsOffset: propertyFlagsOffset(), before: '0x' + before.toString(16),
        after: '0x' + after.toString(16), saveGame: !after.and(CPF_SAVEGAME).equals(0) };
    });
  },
  // Renomme une gare (comme son panneau dans le jeu) : nom passe a l'identifiant de la gare (mStationIdentifier). Le jeu
  // filtre le texte puis l'applique dans un rappel : relire le nom un peu apres (dump de l'identifiant, mStationName)
  renameStation(path, name) {
    return withContext('renameStation', () => {
      const station = requireActor(path);
      const id = station.add(propertyOffset(native('getObjectClass')(station), 'mStationIdentifier')).readPointer();
      if (!isUObject(id)) throw new Error(path + ' : pas d\'identifiant de gare (mStationIdentifier)');
      const chars = wideString(name);
      const str = Memory.alloc(16);
      str.writePointer(chars); str.add(8).writeS32(name.length + 1); str.add(12).writeS32(name.length + 1);
      const text = zeroAlloc(32, 16);
      native('textFromString')(text.ptr, str);
      native('trainStationSetName')(id, text.ptr);
      return { identifier: splitFullName(id).path, requested: name };
    });
  },
  dismantle(path, force) {
    return withContext('dismantle', (ctx) => dismantleOnGameThread(ctx, path, force === true));
  },
  // Bulle visible (sphere d'hologramme) de rayon donne (uu) ; materiau = chemin d'un materiau (bleu par defaut)
  sphere(center, radius, material) {
    return withContext('sphere', (ctx) => sphereOnGameThread(ctx, center, radius, material));
  },
  // Fantome de plan (voir ghostFollow) : parts = blocs du plan ; opts = { center: [u, v] (m), z (uu, altitude des rails),
  // follow (suivi de la visee, oui par defaut), frame: {x, y, z, axis} (position fixe), material }. Remplace le precedent.
  ghost(parts, opts) {
    return withContext('ghost', (ctx) => {
      const o = opts || {};
      ghostRemoveAll();
      const pawn = requirePawn(ctx);
      const view = viewPoint(ctx), at = view.location;
      const material = o.material || SPHERE_MATERIAL;
      for (let i = 0; i < parts.length; i++) {
        const a = ghostSpawnBlock(pawn, material, at);
        if (!ghost.half) ghost.half = ghostMeasure(a);
        ghost.actors.push(a);
      }
      ghost.parts = parts;
      ghost.center = o.center || [0, 0];
      ghost.z = o.z != null ? o.z : 15000;
      ghost.follow = o.follow !== false && !o.frame;
      // orientation initiale : les trains traversent les quais dans le sens du regard ; ensuite, la molette
      ghost.axis = o.frame ? o.frame.axis : (((view.rotation.yaw + 180) % 360) + 360) % 360;
      ghost.input = true;
      ghostPlace(o.frame || { x: at.x, y: at.y, z: ghost.z, axis: ghost.axis });
      pump.tickHooks.set('ghost', ghostFollow);
      return { blocks: ghost.actors.length, follow: ghost.follow, frame: ghost.frame };
    });
  },
  // Reglages du fantome : { follow, z (uu), frame: {x, y, z, axis} } ; rend l'etat
  ghostSet(opts) {
    return withContext('ghostSet', () => {
      const o = opts || {};
      if (!ghost.actors.length) throw new Error('aucun fantome');
      if (o.follow != null) ghost.follow = !!o.follow;
      if (o.z != null) ghost.z = o.z;
      if (o.axis != null) ghost.axis = ((o.axis % 360) + 360) % 360;
      if (o.frame) { ghost.follow = false; ghost.z = o.frame.z; ghost.axis = o.frame.axis; }
      if (ghost.frame) ghostPlace(Object.assign({}, o.frame || ghost.frame, { z: ghost.z, axis: ghost.axis }));
      return { blocks: ghost.actors.length, follow: ghost.follow, z: ghost.z, axis: ghost.axis, center: ghost.center, frame: ghost.frame, input: ghost.input };
    });
  },
  ghostGet() {
    return withContext('ghostGet', () => ({ blocks: ghost.actors.length, follow: ghost.follow, z: ghost.z, axis: ghost.axis, center: ghost.center, frame: ghost.frame, input: ghost.input }));
  },
  ghostRemove() {
    return withContext('ghostRemove', () => ({ removed: ghostRemoveAll() }));
  },
  // Plan du jeu fait d'une liste de batiments, sans le gabarit du concepteur (utilisateur, 24/10/2026 : « c'est une limite
  // du concepteur, pas de la restitution ») : UFGCheatManager::Server_SaveDismantleSelectionToBlueprint_Implementation
  // (commande de developpeur qui fait un plan de la selection du pistolet de demontage : gabarit calcule sur l'encombrement
  // des batiments, ecriture du .sbp, RefreshBlueprintsAndDescriptors, puis au tick suivant Client_GotoBlueprintBuildMode =
  // le plan en main dans le pistolet ; lu dans Ghidra). Appelee sur un gestionnaire cree a part par
  // UGameplayStatics::SpawnObject (classe CheatClass du controleur, proprietaire = controleur : GetWorld et le personnage
  // passent par lui), sans l'installer comme CheatManager du controleur : les triches restent desactivees.
  blueprintFromActors(name, paths) {
    return withContext('blueprintFromActors', (ctx) => {
      if (ctx.controller.isNull()) throw new Error('aucun controleur joueur');
      for (const [key, mod, re, ret, args] of [
        ['spawnObject', 'engine', /^\?SpawnObject@UGameplayStatics@@SAPEAVUObject@@V\?\$TSubclassOf@VUObject@@@@PEAV2@@Z$/, 'pointer', ['pointer', 'pointer']],
        ['cheatSaveSelectionToBlueprint', 'game', /^\?Server_SaveDismantleSelectionToBlueprint_Implementation@UFGCheatManager@@/, 'void', ['pointer', 'pointer', 'pointer', 'pointer']],
      ]) {
        if (NATIVE_SPECS[key]) continue;
        const names = Process.getModuleByName(MOD[mod]).enumerateExports().map((e) => e.name).filter((n) => re.test(n));
        if (names.length !== 1) throw new Error(key + ' : exports inattendus ' + JSON.stringify(names));
        NATIVE_SPECS[key] = [mod, names[0], ret, args];
      }
      const cheatClass = ctx.controller.add(propertyOffset(native('getObjectClass')(ctx.controller), 'CheatClass')).readPointer();
      if (!isUObject(cheatClass)) throw new Error('classe du gestionnaire de triche introuvable (CheatClass)');
      const slot = zeroAlloc(8, 8); // TSubclassOf passe par adresse
      slot.ptr.writePointer(cheatClass);
      const cm = native('spawnObject')(slot.ptr, ctx.controller);
      if (!isUObject(cm)) throw new Error('gestionnaire de triche non cree');
      const actors = paths.map((p) => { const a = requireActor(p); if (!isA(a, native('buildableStaticClass')())) throw new Error(p + ' : pas un batiment'); return a; });
      const data = Memory.alloc(8 * Math.max(1, actors.length));
      actors.forEach((a, i) => data.add(8 * i).writePointer(a));
      const list = zeroAlloc(16, 8);
      list.ptr.writePointer(data); list.ptr.add(8).writeS32(actors.length); list.ptr.add(12).writeS32(actors.length);
      const none = zeroAlloc(16, 8);
      const chars = wideString(name);
      const str = zeroAlloc(16, 8);
      str.ptr.writePointer(chars); str.ptr.add(8).writeS32(name.length + 1); str.ptr.add(12).writeS32(name.length + 1);
      native('cheatSaveSelectionToBlueprint')(cm, str.ptr, list.ptr, none.ptr);
      return { name, actors: actors.length, cheatManager: splitFullName(cm).path, cheatClass: splitFullName(cheatClass).path };
    });
  },
  // Relecture des plans par le jeu (AFGBlueprintSubsystem::RefreshBlueprintsAndDescriptors), par exemple apres une
  // retouche du fichier .sbp, puis descripteur du plan `name` (GetBlueprintDescriptorByNameString) : chemin pour dump
  blueprintRefresh(subsystemPath, name) {
    return withContext('blueprintRefresh', () => {
      const sub = requireActor(subsystemPath);
      for (const [key, re, ret, args] of [['bpRefresh', /^\?RefreshBlueprintsAndDescriptors@AFGBlueprintSubsystem@@QEAAXXZ$/, 'void', ['pointer']],
        ['bpDescriptorByName', /^\?GetBlueprintDescriptorByNameString@AFGBlueprintSubsystem@@QEAAPEAVUFGBlueprintDescriptor@@AEBVFString@@@Z$/, 'pointer', ['pointer', 'pointer']]]) {
        if (NATIVE_SPECS[key]) continue;
        const names = Process.getModuleByName(MOD.game).enumerateExports().map((e) => e.name).filter((n) => re.test(n));
        if (names.length !== 1) throw new Error(key + ' : exports inattendus ' + JSON.stringify(names));
        NATIVE_SPECS[key] = ['game', names[0], ret, args];
      }
      native('bpRefresh')(sub);
      if (!name) return { refreshed: true };
      // (le descripteur deja charge garde ses dimensions : voir blueprintDimensions)
      const chars = wideString(name), str = zeroAlloc(16, 8);
      str.ptr.writePointer(chars); str.ptr.add(8).writeS32(name.length + 1); str.ptr.add(12).writeS32(name.length + 1);
      const d = native('bpDescriptorByName')(sub, str.ptr);
      return { refreshed: true, descriptor: isUObject(d) ? splitFullName(d).path : null };
    });
  },
  // Sources de streaming (voir streamSources) : en pose une a chaque point {x, y, z} ; rend leurs chemins
  streamingSourceAdd(points) {
    return withContext('streamingSourceAdd', (ctx) => {
      if (ctx.pawn.isNull()) throw new Error('pas de joueur (requis pour faire apparaitre un acteur)');
      return points.map((p) => streamingSourceAdd(ctx.pawn, p));
    });
  },
  // Sources de streaming posees et chargement fini ou non (UWorldPartitionStreamingSourceComponent::IsStreamingCompleted)
  streamingSources(opts) {
    return withContext('streamingSources', (ctx) => {
      if (opts && opts.adopter) streamingSourceAdopt(ctx); // sources laissees par un agent precedent
      return streamingSourceList();
    });
  },
  // Retire des sources de streaming (chemins, ou toutes sans argument)
  streamingSourceRemove(paths) {
    return withContext('streamingSourceRemove', () => {
      const out = [];
      for (const [path, s] of streamSources) {
        if (paths && paths.length && !paths.includes(path)) continue;
        out.push({ path, removed: isUObject(s.actor) && native('destroyActor')(s.actor, 0, 1) !== 0 });
        streamSources.delete(path);
      }
      return out;
    });
  },
  // Reglage de la pose des plans au pistolet (voir bpPlace) : { on (oui par defaut) } ; rend l'etat
  blueprintPlacement(opts) {
    return withContext('blueprintPlacement', () => {
      const o = opts || {};
      bpPlaceInstall();
      bpPlace.on = o.on !== false;
      if (bpPlace.on) pump.tickHooks.set('bpPlace', bpPlaceKeys); else pump.tickHooks.delete('bpPlace');
      return { on: bpPlace.on, step: bpPlace.step };
    });
  },
  // Gabarit d'un plan deja charge (UFGBlueprintDescriptor::mDimensions, FIntVector en cases de 8 m, emplacement lu par
  // reflexion) : la relecture des plans ne le met pas a jour apres une retouche de l'en-tete du .sbp (constate le 24/10/2026)
  blueprintDimensions(descriptorPath, dims) {
    return withContext('blueprintDimensions', () => {
      const d = findObject(descriptorPath);
      if (!isUObject(d)) throw new Error('descripteur introuvable : ' + descriptorPath);
      const f = fieldsOf(native('getObjectClass')(d)).find((x) => x.name === 'mDimensions');
      if (!f || f.type !== 'StructProperty' || f.size !== 12) throw new Error('mDimensions : ' + (f ? f.type + ' de ' + f.size + ' octets' : 'absent') + ', attendu FIntVector de 12 octets');
      const p = d.add(f.offset);
      const before = [p.readS32(), p.add(4).readS32(), p.add(8).readS32()];
      p.writeS32(dims.X); p.add(4).writeS32(dims.Y); p.add(8).writeS32(dims.Z);
      return { before, after: [p.readS32(), p.add(4).readS32(), p.add(8).readS32()] };
    });
  },
  sphereRemove(paths) {
    return withContext('sphereRemove', () => [].concat(paths).map((path) => {
      const a = findObject(path);
      if (a.isNull()) return { path, removed: false, reason: 'introuvable' };
      if (splitFullName(a).cls !== 'StaticMeshActor') throw new Error('refuse : ' + path + ' n\'est pas une bulle (StaticMeshActor)');
      return { path, removed: native('destroyActor')(a, 0, 1) !== 0 };
    }));
  },
  // Surbrillance (contour du pistolet de demontage) d'une liste d'acteurs ; show false la retire
  outline(paths, color, show) {
    return withContext('outline', (ctx) => outlineOnGameThread(ctx, paths, color, show !== false));
  },
  // Demontage en serie dans un seul appel (memes regles que dismantle) ; l'appelant fixe l'ordre et la taille des lots
  dismantleMany(paths, force) {
    return withContext('dismantleMany', (ctx) => {
      let done = 0, gone = 0;
      const failed = [];
      for (const path of paths) {
        try {
          dismantleOnGameThread(ctx, path, force === true);
          done++;
        } catch (e) {
          if (/introuvable/.test(e.message)) gone++;
          else failed.push(path.split('.').pop() + ' : ' + e.message);
        }
      }
      return { done, gone, failed };
    });
  },
  // Tout ce qui est dans une bulle (distance 3D au centre) : batiments et vehicules ferroviaires (acteurs), et pieces
  // legeres (fondations, murs...) des classes donnees (noms courts ; une classe sans instance n'est pas chargee)
  bubble(center, radius, lwClasses) {
    return withContext('bubble', (ctx) => {
      const inside = (l) => Math.hypot(l.x - center.x, l.y - center.y, l.z - center.z) <= radius;
      const actors = [];
      const vehicle = findFirstObject('FGRailroadVehicle', native('uclassStaticClass')());
      for (const cls of [native('buildableStaticClass')(), vehicle]) {
        if (cls.isNull()) continue;
        for (const a of actorsOfClass(ctx, cls)) {
          if (!isUObject(a)) continue;
          const l = actorPose(a).location;
          if (!inside(l)) continue;
          const n = splitFullName(a);
          actors.push({ path: n.path, class: n.cls, location: r0(l) });
        }
      }
      const lightweight = [];
      for (const c of lwClasses || []) {
        let lw;
        try { lw = lightweightOf(ctx, c); } catch (e) { continue; }
        for (let i = 0; ; i++) {
          const st = lw.at(i);
          if (st === null) break;
          if (st.valid && inside(st.location)) lightweight.push({ class: c, index: i, location: r0(st.location) });
        }
      }
      return { actors, lightweight };
    });
  },
  // Relie deux connecteurs de rail sans recherche par collision (UFGRailroadTrackConnectionComponent::AddConnection, comme
  // ConfigureComponents a la construction), puis reinscrit le rail A dans le systeme ferroviaire (RemoveTrack + AddTrack,
  // qui fusionne son graphe avec ceux des rails relies). Repare un joint reste libre parce que pose loin du joueur.
  // Raccord direct de deux connecteurs de rail. Si l'un d'eux devient un aiguillage (2 branches ou plus) sans levier, le
  // levier est pose aussitot (utilisateur, 26/10/2026 : « quand tu fais un railLink il faudrait placer le signal en auto si
  // necessaire ») : sans levier, l'aiguillage ne bascule jamais (voir switchControl)
  railLink(subsystemPath, trackA, nameA, trackB, nameB) {
    return withContext('railLink', (ctx) => {
      const sub = requireActor(subsystemPath);
      const ta = requireActor(trackA), tb = requireActor(trackB);
      const a = requireRailConnection(trackA, nameA), b = requireRailConnection(trackB, nameB);
      const graphs = () => [native('railTrackGraphId')(ta), native('railTrackGraphId')(tb)];
      const before = graphs();
      native('railConnAddConnection')(a.comp, b.comp);
      native('railSubsystemRemoveTrack')(sub, ta);
      native('railSubsystemAddTrack')(sub, ta);
      const switchControls = [a.comp, b.comp].map((c) => ensureSwitchControl(ctx, c)).filter(Boolean);
      return { graphsBefore: before, graphsAfter: graphs(), switchControls };
    });
  },
  // Recalcul complet d'un reseau ferre (graphe, blocs, etats des signaux) au tick suivant, comme apres la pose ou le
  // demontage d'un rail : AFGRailroadSubsystem::MarkGraphForFullRebuild(graphId). Graphes donnes par des rails
  // (utilisateur, 26/10/2026 : « t'as moyen de reset les signaux ? »)
  railRebuild(subsystemPath, trackPaths) {
    return withContext('railRebuild', () => {
      exportByPattern('railSubsystemMarkFullRebuild', 'game', /^\?MarkGraphForFullRebuild@AFGRailroadSubsystem@@AEAAXH@Z$/, 'void', ['pointer', 'int']);
      const sub = requireActor(subsystemPath);
      const ids = [...new Set(trackPaths.map((p) => native('railTrackGraphId')(requireActor(p))))];
      for (const id of ids) native('railSubsystemMarkFullRebuild')(sub, id);
      return { graphs: ids };
    });
  },
  // Noms decores des exports du module du jeu qui correspondent a un motif (recherche d'une fonction par son nom, sans
  // adresse ecrite en dur)
  // module : game (defaut), core, coreUObject, engine
  exportsMatching(pattern, max, module) {
    const re = new RegExp(pattern), out = [];
    for (const e of Process.getModuleByName(MOD[module || 'game']).enumerateExports()) {
      if (re.test(e.name)) out.push(e.name);
      if (out.length >= (max || 50)) break;
    }
    return out;
  },
  // Vide un reseau de tuyaux, comme le bouton « Purger » du jeu : AFGPipeSubsystem::FlushPipeNetwork(int32 networkID), nom
  // decore retrouve dans les exports (24/10/2026 : eau rejetee par le melangeur d'uranium non fissile du site sud bloquee
  // dans un reseau plein, dechets des centrales plus evacues)
  flushPipeNetwork(subsystemPath, networkId) {
    return withContext('flushPipeNetwork', () => {
      const sub = requireActor(subsystemPath);
      if (!NATIVE_SPECS.pipeFlushNetwork) {
        const names = Process.getModuleByName(MOD.game).enumerateExports().map((e) => e.name).filter((n) => /^\?FlushPipeNetwork@AFGPipeSubsystem@@/.test(n));
        if (names.length !== 1 || !/XH@Z$/.test(names[0])) throw new Error('FlushPipeNetwork : exports inattendus ' + JSON.stringify(names));
        NATIVE_SPECS.pipeFlushNetwork = ['game', names[0], 'void', ['pointer', 'int']];
      }
      native('pipeFlushNetwork')(sub, networkId);
      return { flushed: networkId, fn: NATIVE_SPECS.pipeFlushNetwork[1] };
    });
  },
  // Vide le contenu d'un batiment fluide (reservoir, tampon...), comme son bouton « Purger » : la purge du reseau ne vide
  // que les tuyaux (utilisateur, 24/10/2026 : « flusher le network c'est pas comme flusher le reservoir »).
  // AFGPipeSubsystem::FlushIntegrant(AActor*), nom decore retrouve dans les exports
  flushIntegrant(subsystemPath, actorPath) {
    return withContext('flushIntegrant', () => {
      const sub = requireActor(subsystemPath), a = requireActor(actorPath);
      if (!NATIVE_SPECS.pipeFlushIntegrant) {
        const names = Process.getModuleByName(MOD.game).enumerateExports().map((e) => e.name).filter((n) => /^\?FlushIntegrant@AFGPipeSubsystem@@/.test(n));
        if (names.length !== 1 || !/PEAVAActor@@@Z$/.test(names[0])) throw new Error('FlushIntegrant : exports inattendus ' + JSON.stringify(names));
        NATIVE_SPECS.pipeFlushIntegrant = ['game', names[0], 'void', ['pointer', 'pointer']];
      }
      native('pipeFlushIntegrant')(sub, a);
      return { flushed: actorPath };
    });
  },
  // Contenu d'un reservoir ou d'un tampon (m3) : AFGBuildablePipeReservoir::GetFluidContent / GetFluidContentMax (mFluidBox
  // n'expose aucun champ a la reflexion), noms decores retrouves dans les exports
  fluidContent(path) {
    return withContext('fluidContent', () => {
      const a = requireActor(path);
      for (const [key, fn] of [['reservoirContent', 'GetFluidContent'], ['reservoirContentMax', 'GetFluidContentMax']]) {
        if (NATIVE_SPECS[key]) continue;
        const names = Process.getModuleByName(MOD.game).enumerateExports().map((e) => e.name).filter((n) => n.startsWith('?' + fn + '@AFGBuildablePipeReservoir@@QEBAMXZ'));
        if (names.length !== 1) throw new Error(fn + ' : exports inattendus ' + JSON.stringify(names));
        NATIVE_SPECS[key] = ['game', names[0], 'float', ['pointer']];
      }
      return { content: native('reservoirContent')(a), max: native('reservoirContentMax')(a) };
    });
  },
  // Nom que le jeu donnerait a une nouvelle gare : AFGRailroadSubsystem::GenerateStationName (const, FText rendu par
  // valeur : this puis tampon de retour), lu par FText::ToString (Core) ; n appels pour voir si le choix varie. Noms
  // decores retrouves dans les exports. Les FText rendus ne sont pas liberes (destructeur non exporte, quelques octets)
  generateStationName(subsystemPath, n) {
    return withContext('generateStationName', () => {
      const sub = requireActor(subsystemPath);
      for (const [key, mod, re] of [['railGenerateStationName', MOD.game, /^\?GenerateStationName@AFGRailroadSubsystem@@QEBA\?AVFText@@XZ$/],
        ['textToString', MOD.core, /^\?ToString@FText@@QEBAAEBVFString@@XZ$/]]) {
        if (NATIVE_SPECS[key]) continue;
        const names = Process.getModuleByName(mod).enumerateExports().map((e) => e.name).filter((x) => re.test(x));
        if (names.length !== 1) throw new Error(key + ' : exports inattendus ' + JSON.stringify(names));
        NATIVE_SPECS[key] = [key === 'textToString' ? 'core' : 'game', names[0], 'pointer', key === 'textToString' ? ['pointer'] : ['pointer', 'pointer']];
      }
      const out = [];
      for (let i = 0; i < (n || 1); i++) {
        const text = zeroAlloc(32, 16);
        native('railGenerateStationName')(sub, text.ptr);
        const str = native('textToString')(text.ptr);
        const data = str.readPointer(), num = str.add(8).readS32();
        out.push(data.isNull() || num <= 0 ? '' : data.readUtf16String(num - 1));
      }
      return out;
    });
  },
  // Valeurs d'un enum du jeu par nom (ex. ETrainDockingDefinition)
  enums(name) {
    return withContext('enums', () => enumValues(name));
  },
  // Trains (cf. trainInfo) : opts.path (un train, ou un de ses vehicules), opts.station (motif sur les noms des gares de
  // l'horaire), opts.near {x, y, z} + opts.radius (uu, premier vehicule)
  trains(opts) {
    return withContext('trains', (ctx) => {
      const o = opts || {};
      const L = railTrafficLayout();
      let list = actorsOfClass(ctx, L.C.train).filter(isUObject);
      if (o.path) {
        const a = requireActor(o.path);
        const t = isA(a, L.C.train) ? a : isA(a, L.C.vehicle) ? a.add(propertyOffset(L.C.vehicle, 'mTrain')).readPointer() : NULL;
        if (!isUObject(t)) throw new Error(o.path + ' : ni train ni vehicule d\'un train');
        list = [t];
      }
      let out = list.map(trainInfo);
      if (o.station) { const re = new RegExp(o.station); out = out.filter((t) => t.timetable && t.timetable.stops.some((s) => s.station && re.test(s.station.name))); }
      if (o.near) out = out.filter((t) => t.vehicles.length && Math.hypot(t.vehicles[0].location.x - o.near.x, t.vehicles[0].location.y - o.near.y, t.vehicles[0].location.z - (o.near.z || 0)) <= (o.radius || 10000));
      return out;
    });
  },
  // Horaire d'un train (cf. trainTimetableSet) ; opts.current (arret suivant), opts.selfDriving (true / false)
  trainTimetable(trainPath, stops, opts) {
    return withContext('trainTimetable', (ctx) => {
      const o = opts || {};
      trainTimetableSet(ctx, trainPath, stops, o.current);
      if (o.selfDriving != null) native('trainSetSelfDriving')(requireActor(trainPath), o.selfDriving === true ? 1 : 0); // bool natif : entier pour Frida
      return trainInfo(requireActor(trainPath));
    });
  },
  // Gares (identifiants AFGTrainStationIdentifier) : nom en jeu, batiment, position ; opts.name : motif sur le nom
  stations(opts) {
    return withContext('stations', (ctx) => {
      const L = railTrafficLayout();
      const re = opts && opts.name ? new RegExp(opts.name) : null;
      return actorsOfClass(ctx, L.C.ident).filter(isUObject).map((i) => {
        const st = i.add(L.ident.station).readPointer();
        return { name: textString(i.add(L.ident.name)), identifier: splitFullName(i).path,
          station: isUObject(st) ? splitFullName(st).path : null, location: isUObject(st) ? r0(actorPose(st).location) : null };
      }).filter((s) => !re || re.test(s.name));
    });
  },
  // Nom d'un train (AFGTrain::SetTrainName, FText fait par FText::FromString ; le FText rendu n'est pas libere)
  trainName(trainPath, name) {
    return withContext('trainName', () => {
      const L = railTrafficLayout();
      exportByPattern('textFromString', 'core', /^\?FromString@FText@@SA\?AV1@AEBVFString@@@Z$/, 'pointer', ['pointer', 'pointer']);
      exportByPattern('trainSetName', 'game', /^\?SetTrainName@AFGTrain@@QEAAXAEBVFText@@@Z$/, 'void', ['pointer', 'pointer']);
      const train = requireActor(trainPath);
      if (!isA(train, L.C.train)) throw new Error(trainPath + ' : pas un train (AFGTrain)');
      // chars garde la chaine en vie pendant l'appel (Frida libere un tampon sans reference JS)
      const chars = wideString(name), str = zeroAlloc(16, 8);
      str.ptr.writePointer(chars); str.ptr.add(8).writeS32(name.length + 1); str.ptr.add(12).writeS32(name.length + 1);
      const text = zeroAlloc(32, 16); // FText rendu par valeur
      native('textFromString')(text.ptr, str.ptr);
      native('trainSetName')(train, text.ptr);
      return Object.assign(trainInfo(train), { chars: chars.isNull() ? null : name.length });
    });
  },
  // Enregistreur (cf. trainRecTick) : suit les trains donnes (chemins de trains ou de vehicules) ; opts.periodMs (100 ms),
  // opts.keepMs (15 s), opts.afterMs (1,5 s apres le deraillement). Remet le tampon a zero.
  trainRecorder(paths, opts) {
    return withContext('trainRecorder', () => {
      const L = railTrafficLayout(), o = opts || {};
      trainRec.trains = paths.map((p) => {
        const a = requireActor(p);
        const t = isA(a, L.C.train) ? a : isA(a, L.C.vehicle) ? a.add(propertyOffset(L.C.vehicle, 'mTrain')).readPointer() : NULL;
        if (!isUObject(t)) throw new Error(p + ' : ni train ni vehicule d\'un train');
        return { train: t, name: textString(t.add(L.train.name)) || splitFullName(t).path.split('.').pop(),
          vehicles: readPointerArray(t.add(L.train.sim).add(L.sim.vehicles)).filter(isUObject) };
      });
      trainRec.derailedValue = Number(Object.keys(L.enums.status).find((v) => L.enums.status[v] === 'TS_Derailed'));
      Object.assign(trainRec, { buf: [], keepMs: o.keepMs || 15000, afterMs: o.afterMs || 1500, periodMs: o.periodMs || 100, last: 0,
        t0: Date.now(), ticks: 0, frozenAt: null, derailed: null });
      pump.tickHooks.set('trainRec', trainRecTick);
      return { trains: trainRec.trains.map((t) => ({ name: t.name, vehicles: t.vehicles.length })), keepMs: trainRec.keepMs };
    });
  },
  // Tampon de l'enregistreur : opts.everyMs (un echantillon par intervalle, defaut : tous), opts.lastMs (fenetre de fin)
  trainRecorderGet(opts) {
    const o = opts || {};
    const end = trainRec.buf.length ? trainRec.buf[trainRec.buf.length - 1].t : 0;
    let last = -Infinity;
    const samples = trainRec.buf.filter((s) => {
      if (o.lastMs && s.t < end - o.lastMs) return false;
      if (o.everyMs && s.t - last < o.everyMs) return false;
      last = s.t;
      return true;
    });
    return { running: pump.tickHooks.has('trainRec'), ticks: trainRec.ticks, derailed: trainRec.derailed,
      frozenAt: trainRec.frozenAt === null ? null : trainRec.frozenAt - trainRec.t0, statusNames: railTraffic ? railTraffic.enums.status : null, samples };
  },
  // Levier d'aiguillage (AFGBuildableRailroadSwitchControl) sur un connecteur de rail qui en manque. Un aiguillage sans
  // levier ne bascule jamais (UFGRailroadTrackConnectionComponent::SetSwitchPosition ne fait rien sans mSwitchControl, lu
  // avec Ghidra le 26/10/2026) : les trains suivent sa position en cours. Le jeu pose le levier avec l'hologramme du rail
  // qui cree la bifurcation (AFGRailroadTrackHologram::TryPlaceSwitchControl) ; un raccord fait par railLink n'en a pas.
  // Ici : hologramme du levier place par AFGRailroadSwitchControlHologram::SetHologramLocationAndRotationFromConnection
  // (connecteur commande, position et cap pris sur lui), puis construction. opts : dryRun, force, ignore
  switchControl(connectorPath, opts) {
    return withContext('switchControl', (ctx) => placeSwitchControl(ctx, requireActor(connectorPath), opts));
  },
  // Position d'un aiguillage (connecteur qui fait face aux branches) : lecture, ou reglage si `position` est donne (par son
  // levier ; sans levier, rien ne change). Rend la position et la branche (rail) qu'elle designe
  switchPosition(connectorPath, position) {
    return withContext('switchPosition', () => {
      exportByPattern('railConnGetSwitchPosition', 'game', /^\?GetSwitchPosition@UFGRailroadTrackConnectionComponent@@QEBAHXZ$/, 'int', ['pointer']);
      exportByPattern('railConnSetSwitchPosition', 'game', /^\?SetSwitchPosition@UFGRailroadTrackConnectionComponent@@QEAAXH@Z$/, 'void', ['pointer', 'int']);
      const conn = requireActor(connectorPath);
      if (position != null) native('railConnSetSwitchPosition')(conn, position);
      const links = zeroAlloc(16, 8);
      native('railConnConnections')(conn, links.ptr);
      const branches = takePointerArray(links.ptr).filter(isUObject).map((other) => pathOrNull(native('railConnTrack')(other)));
      const pos = native('railConnGetSwitchPosition')(conn);
      return { position: pos, branch: branches[pos] || null, branches, switchControl: dumpObject(conn, 1, 1, ['mSwitchControl']).mSwitchControl || null };
    });
  },
  trainRecorderStop() {
    pump.tickHooks.delete('trainRec');
    return { ticks: trainRec.ticks, samples: trainRec.buf.length };
  },
  // Etat du regulateur des tournees (cf. lineRegTick) : par tournee, boucle, intervalle, trains, gares, trajets, derniers
  // evenements (opts.events : nombre, 20)
  lineRegulatorStatus(opts) {
    return lineRegulatorState(opts && opts.events);
  },
  // Remet en marche le regulateur des tournees (installe avec l'agent ; apres lineRegulatorStop)
  lineRegulatorStart() {
    return withContext('lineRegulatorStart', () => { lineRegStart(); return lineRegulatorState(0); });
  },
  // Arrete le regulateur des tournees jusqu'a lineRegulatorStart ou au prochain demarrage de l'agent, et leve les
  // retenues en cours. Pour ne plus reguler une tournee : retirer l'etiquette « regulation » de sa gare
  lineRegulatorStop() {
    return withContext('lineRegulatorStop', () => ({ released: lineRegStop(), state: lineRegulatorState(0) }));
  },
  // Retient le train a quai d'une gare holdS secondes de plus (cf. stationHold) ; rend le temps a quai et la duree exigee
  stationHoldDock(stationPath, holdS) {
    return withContext('stationHoldDock', () => {
      const L = railTrafficLayout();
      const st = requireActor(stationPath);
      if (!isA(st, L.C.station)) throw new Error(stationPath + ' : pas une gare (AFGBuildableRailroadStation)');
      const total = stationHold(st, holdS);
      return { station: splitFullName(st).path, elapsed: st.add(propertyOffset(L.C.station, 'mCurrentDockForDuration')).readFloat(), total };
    });
  },
  // Leve l'attente en cours a une gare (AFGBuildableRailroadStation::ClearRuleSetTimeRequirement) : le train a quai part
  // des que sa regle (charger / decharger une fois...) est remplie. La gare garde une copie de la regle prise a l'arrivee
  // (mCurrentDockedWithRuleSet, mCurrentDockForDuration) : changer l'horaire pendant l'arret ne fait rien (26/10/2026)
  stationReleaseDock(stationPath) {
    return withContext('stationReleaseDock', () => {
      const L = railTrafficLayout();
      exportByPattern('stationClearRuleSetTime', 'game', /^\?ClearRuleSetTimeRequirement@AFGBuildableRailroadStation@@QEAAXXZ$/, 'void', ['pointer']);
      const st = requireActor(stationPath);
      if (!isA(st, L.C.station)) throw new Error(stationPath + ' : pas une gare (AFGBuildableRailroadStation)');
      const off = propertyOffset(L.C.station, 'mCurrentDockForDuration');
      const before = st.add(off).readFloat();
      native('stationClearRuleSetTime')(st);
      return { station: splitFullName(st).path, dockForDurationBefore: before, dockForDurationAfter: st.add(off).readFloat() };
    });
  },
  // Remet un train deraille sur ses rails (AFGTrain::Rerail, comme la touche E du jeu), puis recalcule son etat
  // (AFGTrain::UpdateTrainStatus) : loin du joueur, un train qui a deraille reste « TS_Derailed » sans que ses vehicules
  // soient marques derailles ni tombes (physique calculee pres du joueur seulement), et Rerail ne fait rien (26/10/2026)
  trainRerail(trainPath) {
    return withContext('trainRerail', () => {
      const L = railTrafficLayout();
      exportByPattern('trainRerail', 'game', /^\?Rerail@AFGTrain@@QEAAXXZ$/, 'void', ['pointer']);
      exportByPattern('trainUpdateStatus', 'game', /^\?UpdateTrainStatus@AFGTrain@@AEAAXXZ$/, 'void', ['pointer']);
      const train = requireActor(trainPath);
      if (!isA(train, L.C.train)) throw new Error(trainPath + ' : pas un train (AFGTrain)');
      native('trainRerail')(train);
      native('trainUpdateStatus')(train);
      return trainInfo(train);
    });
  },
  // Conduite automatique d'un train (AFGTrain::SetSelfDrivingEnabled) ; rend l'etat du train
  trainSelfDriving(trainPath, on) {
    return withContext('trainSelfDriving', () => {
      const L = railTrafficLayout();
      const train = requireActor(trainPath);
      if (!isA(train, L.C.train)) throw new Error(trainPath + ' : pas un train (AFGTrain)');
      native('trainSetSelfDriving')(train, on !== false ? 1 : 0); // bool natif : entier pour Frida
      return trainInfo(train);
    });
  },
  // Sauvegarde nommee de la partie (UFGSaveSession::SaveGame, comme le menu du jeu), sans delegue de fin : elle est ecrite
  // au tick suivant ; c'est le fichier <SaveGames>/<compte>/<nom>.sav qui fait foi (plans/fg.js save attend son ecriture)
  saveGame(name) {
    return withContext('saveGame', (ctx) => {
      const session = native('saveSessionGet')(ctx.subsystem);
      if (!isUObject(session)) throw new Error('session de sauvegarde introuvable');
      const text = Memory.allocUtf16String(name);
      const str = Memory.alloc(16);
      str.writePointer(text); str.add(8).writeS32(name.length + 1); str.add(12).writeS32(name.length + 1);
      const delegate = zeroAlloc(0x40, 16); // TDelegate vide : non lie
      native('saveSessionSaveGame')(session, str, delegate.ptr, NULL);
      return { session: splitFullName(session).path, name };
    });
  },
  // Retire des balises de la carte par leur GUID ({ A, B, C, D }, champ markerGuid de mMapMarkers) :
  // AFGMapManager::RemoveMapMarker ne lit que ce champ, le reste du FMapMarker passe est laisse a zero
  removeMapMarkers(managerPath, guids) {
    return withContext('removeMapMarkers', () => {
      const manager = findObject(managerPath);
      if (manager.isNull()) throw new Error('gestionnaire de carte introuvable : ' + managerPath);
      const marker = requireStruct('/Script/FactoryGame.MapMarker');
      const buf = zeroAlloc(structSize(marker), 16);
      const guid = buf.ptr.add(propertyOffset(marker, 'markerGuid'));
      for (const g of guids) {
        guid.writeS32(g.A); guid.add(4).writeS32(g.B); guid.add(8).writeS32(g.C); guid.add(12).writeS32(g.D);
        native('mapManagerRemoveMarker')(manager, buf.ptr);
      }
      return { removed: guids.length };
    });
  },
  // Pose des balises sur la carte (AFGMapManager::AddNewMapMarker, qui copie la balise, lui donne un GUID et la diffuse) :
  // markers = [{ name, location: {x,y,z}, icon, type, color: {r,g,b,a}, scale }] ; icon, type, color et scale par defaut
  // ceux des balises posees par l'utilisateur (16, gris fonce, 1). -> GUID de chaque balise
  addMapMarkers(managerPath, markers) {
    return withContext('addMapMarkers', () => {
      const manager = findObject(managerPath);
      if (manager.isNull()) throw new Error('gestionnaire de carte introuvable : ' + managerPath);
      const struct = requireStruct('/Script/FactoryGame.MapMarker');
      const size = structSize(struct);
      const f = {};
      for (const x of fieldsOf(struct)) f[x.name] = x;
      const need = (n, type, bytes) => {
        if (!f[n] || f[n].type !== type || (bytes && f[n].size !== bytes)) {
          throw new Error('FMapMarker.' + n + ' : ' + (f[n] ? f[n].type + ' de ' + f[n].size + ' octets' : 'absent') + ', attendu ' + type);
        }
        return f[n].offset;
      };
      const oLoc = need('Location', 'StructProperty', 24), oName = need('Name', 'StrProperty', 16);
      const oIcon = need('IconID', 'IntProperty', 4), oColor = need('Color', 'StructProperty', 16);
      const oScale = need('Scale', 'FloatProperty', 4), oGuid = need('markerGuid', 'StructProperty', 16);
      const oType = f.MapMarkerType && f.MapMarkerType.size === 1 ? f.MapMarkerType.offset : null;
      if (oType === null) throw new Error('FMapMarker.MapMarkerType : taille inattendue');
      return markers.map((m) => {
        const inBuf = zeroAlloc(size, 16), outBuf = zeroAlloc(size, 16);
        const p = inBuf.ptr;
        p.add(oLoc).writeDouble(m.location.x); p.add(oLoc + 8).writeDouble(m.location.y); p.add(oLoc + 16).writeDouble(m.location.z);
        const text = Memory.allocUtf16String(m.name || '');
        p.add(oName).writePointer(text); p.add(oName + 8).writeS32((m.name || '').length + 1); p.add(oName + 12).writeS32((m.name || '').length + 1);
        p.add(oIcon).writeS32(m.icon == null ? 350 : m.icon);
        p.add(oType).writeU8(m.type == null ? 16 : m.type);
        const c = m.color || { r: 0.132868, g: 0.132868, b: 0.135633, a: 1 };
        p.add(oColor).writeFloat(c.r); p.add(oColor + 4).writeFloat(c.g); p.add(oColor + 8).writeFloat(c.b); p.add(oColor + 12).writeFloat(c.a);
        p.add(oScale).writeFloat(m.scale == null ? 1 : m.scale);
        const ok = native('mapManagerAddMarker')(manager, p, outBuf.ptr) !== 0;
        const g = outBuf.ptr.add(oGuid);
        // La copie de sortie tient des chaines allouees par le moteur : sans le destructeur de FMapMarker (non exporte),
        // on libere Name et CategoryName ; le reste (LastEditedBy) fuit de quelques octets par balise
        freeFString(outBuf.ptr.add(oName));
        if (f.CategoryName) freeFString(outBuf.ptr.add(f.CategoryName.offset));
        return { name: m.name, added: ok, guid: { A: g.readS32(), B: g.add(4).readS32(), C: g.add(8).readS32(), D: g.add(12).readS32() } };
      });
    });
  },
});
