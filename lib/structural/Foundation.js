/**
 * Foundation — lightweight buildable helper.
 *
 * Foundations live in the FGLightweightBuildableSubsystem and are
 * stored as plain transforms (no entity, no components).
 *
 * Usage:
 *   const lwSub = Foundation.getSubsystem(allObjects);
 *   const f = Foundation.create(lwSub, Foundation.Types.F_8x4, x, y, z);
 *   // f is the transform that was pushed into the subsystem — no need
 *   // to inject anything else into the save.
 */

// --- Foundation type paths (game asset references) ---
const Types = {
  // Foundations (concrete)
  F_8x1:        '/Game/FactoryGame/Buildable/Building/Foundation/Build_Foundation_8x1_01.Build_Foundation_8x1_01_C',
  F_8x2:        '/Game/FactoryGame/Buildable/Building/Foundation/Build_Foundation_8x2_01.Build_Foundation_8x2_01_C',
  F_8x4:        '/Game/FactoryGame/Buildable/Building/Foundation/Build_Foundation_8x4_01.Build_Foundation_8x4_01_C',
  // Ramps
  RAMP_8x1:     '/Game/FactoryGame/Buildable/Building/Ramp/Build_Ramp_8x1_01.Build_Ramp_8x1_01_C',
  RAMP_8x2:     '/Game/FactoryGame/Buildable/Building/Ramp/Build_Ramp_8x2_01.Build_Ramp_8x2_01_C',
  RAMP_8x4:     '/Game/FactoryGame/Buildable/Building/Ramp/Build_Ramp_8x4_01.Build_Ramp_8x4_01_C',
  RAMP_INV_8x1: '/Game/FactoryGame/Buildable/Building/Ramp/Build_RampInverted_8x1.Build_RampInverted_8x1_C',
  RAMP_FRAME:   '/Game/FactoryGame/Buildable/Building/Ramp/Build_Ramp_Frame_01.Build_Ramp_Frame_01_C',
  // Walls
  WALL_8x4:     '/Game/FactoryGame/Buildable/Building/Wall/Build_Wall_8x4_01.Build_Wall_8x4_01_C',
  // Pillars
  PILLAR_SMALL_CONCRETE: '/Game/FactoryGame/Buildable/Building/Pillars/Build_Pillar_Small_Concrete.Build_Pillar_Small_Concrete_C',
  PILLAR_SMALL_METAL:    '/Game/FactoryGame/Buildable/Building/Pillars/Build_Pillar_Small_Metal.Build_Pillar_Small_Metal_C',
  PILLAR_MID_CONCRETE:   '/Game/FactoryGame/Buildable/Building/Foundation/Build_PillarMiddle_Concrete.Build_PillarMiddle_Concrete_C',
  // Quarter pipes
  QP_MID_8x1:   '/Game/FactoryGame/Buildable/Building/Foundation/FicsitSet/Build_QuarterPipeMiddle_Ficsit_8x1.Build_QuarterPipeMiddle_Ficsit_8x1_C',
  // Catwalks
  CATWALK_STAIRS: '/Game/FactoryGame/Buildable/Building/Catwalk/Build_CatwalkStairs.Build_CatwalkStairs_C',
  CATWALK_CORNER: '/Game/FactoryGame/Buildable/Building/Catwalk/Build_CatwalkCorner.Build_CatwalkCorner_C',
  CATWALK_CROSS:  '/Game/FactoryGame/Buildable/Building/Catwalk/Build_CatwalkCross.Build_CatwalkCross_C',
  // Beams
  BEAM:         '/Game/FactoryGame/Prototype/Buildable/Beams/Build_Beam.Build_Beam_C',
  BEAM_PAINTED: '/Game/FactoryGame/Prototype/Buildable/Beams/Build_Beam_Painted.Build_Beam_Painted_C',
};

// Dimensions (unreal units): width/depth and height for each type
const Dims = {
  [Types.F_8x1]:        { size: 800, height: 100 },
  [Types.F_8x2]:        { size: 800, height: 200 },
  [Types.F_8x4]:        { size: 800, height: 400 },
  [Types.RAMP_8x1]:     { size: 800, height: 100 },
  [Types.RAMP_8x2]:     { size: 800, height: 200 },
  [Types.RAMP_8x4]:     { size: 800, height: 400 },
  [Types.RAMP_INV_8x1]: { size: 800, height: 100 },
  [Types.RAMP_FRAME]:   { size: 800, height: 400 },
  [Types.WALL_8x4]:     { size: 800, height: 400 },
  [Types.PILLAR_SMALL_CONCRETE]: { size: 400, height: 400 },
  [Types.PILLAR_SMALL_METAL]:    { size: 400, height: 400 },
  [Types.PILLAR_MID_CONCRETE]:   { size: 400, height: 400 },
  [Types.QP_MID_8x1]:   { size: 800, height: 100 },
  [Types.CATWALK_STAIRS]: { size: 800, height: 400 },
  [Types.CATWALK_CORNER]: { size: 800, height: 0 },
  [Types.CATWALK_CROSS]:  { size: 800, height: 0 },
  [Types.BEAM]:           { size: 0, height: 400 },
  [Types.BEAM_PAINTED]:   { size: 0, height: 400 },
};

// Recipes matching each foundation type
const Recipes = {
  [Types.F_8x1]:        '/Game/FactoryGame/Recipes/Buildings/Foundations/Recipe_Foundation_8x1_01.Recipe_Foundation_8x1_01_C',
  [Types.F_8x2]:        '/Game/FactoryGame/Recipes/Buildings/Foundations/Recipe_Foundation_8x2_01.Recipe_Foundation_8x2_01_C',
  [Types.F_8x4]:        '/Game/FactoryGame/Recipes/Buildings/Foundations/Recipe_Foundation_8x4_01.Recipe_Foundation_8x4_01_C',
  [Types.RAMP_8x1]:     '/Game/FactoryGame/Recipes/Buildings/Ramps/Recipe_Ramp_8x1_01.Recipe_Ramp_8x1_01_C',
  [Types.RAMP_8x2]:     '/Game/FactoryGame/Recipes/Buildings/Ramps/Recipe_Ramp_8x2_01.Recipe_Ramp_8x2_01_C',
  [Types.RAMP_8x4]:     '/Game/FactoryGame/Recipes/Buildings/Ramps/Recipe_Ramp_8x4_01.Recipe_Ramp_8x4_01_C',
  [Types.WALL_8x4]:     '/Game/FactoryGame/Recipes/Buildings/Walls/Recipe_Wall_8x4_01.Recipe_Wall_8x4_01_C',
};

// Beam-specific: types that require instanceSpecificData with BeamLength
const BEAM_TYPES = new Set([Types.BEAM, Types.BEAM_PAINTED]);
const BEAM_STRUCT_REF = '/Script/FactoryGame.BuildableBeamLightweightData';
const DEFAULT_BEAM_LENGTH = 400; // 4m in unreal units

// Default swatch (concrete)
const SWATCH_CONCRETE = '/Game/FactoryGame/Buildable/-Shared/Customization/Swatches/SwatchDesc_Concrete.SwatchDesc_Concrete_C';

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const DEFAULT_SCALE     = { x: 1, y: 1, z: 1 };
const EMPTY_REF         = { levelName: '', pathName: '' };
const BLACK_COLOR       = { r: 0, g: 0, b: 0, a: 1 };

// -----------------------------------------------------------------
// Subsystem access
// -----------------------------------------------------------------

/**
 * Find the FGLightweightBuildableSubsystem among save objects.
 */
function getSubsystem(allObjects) {
  const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
  if (!lwSub) throw new Error('LightweightBuildableSubsystem not found in save');
  return lwSub;
}

/**
 * Get (or create) the buildables entry for a given type path.
 */
function getOrCreateTypeEntry(lwSub, typePath) {
  const buildables = lwSub.specialProperties.buildables;
  let entry = buildables.find(b => b.typeReference.pathName === typePath);
  if (!entry) {
    entry = {
      typeReference: { levelName: '', pathName: typePath },
      instances:     [],
    };
    buildables.push(entry);
  }
  return entry;
}

// -----------------------------------------------------------------
// Creation
// -----------------------------------------------------------------

/**
 * Create a single foundation instance.
 *
 * @param {object} lwSub      - The lightweight buildable subsystem entity
 * @param {string} typePath   - One of Foundation.Types.*
 * @param {number} x          - World X
 * @param {number} y          - World Y
 * @param {number} z          - World Z  (center of the foundation)
 * @param {object} [rotation] - Quaternion {x,y,z,w}  (default: identity)
 * @param {object} [opts]     - Optional overrides: { swatch, recipe, beamLength }
 * @returns {object} The instance that was pushed
 */
function create(lwSub, typePath, x, y, z, rotation, opts) {
  const entry = getOrCreateTypeEntry(lwSub, typePath);
  const recipe = (opts && opts.recipe) || Recipes[typePath] || '';
  const swatch = (opts && opts.swatch) || SWATCH_CONCRETE;

  let instanceSpecificData;
  if (BEAM_TYPES.has(typePath)) {
    const beamLength = (opts && opts.beamLength) || DEFAULT_BEAM_LENGTH;
    instanceSpecificData = {
      hasValidStruct:  true,
      structReference: { levelName: '', pathName: BEAM_STRUCT_REF },
      properties: {
        BeamLength: {
          type:   'FloatProperty',
          ueType: 'FloatProperty',
          name:   'BeamLength',
          value:  beamLength,
        },
      },
    };
  } else {
    instanceSpecificData = { hasValidStruct: false };
  }

  const instance = {
    transform: {
      rotation:    rotation ? { ...rotation } : { ...IDENTITY_ROTATION },
      translation: { x, y, z },
      scale3d:     { ...DEFAULT_SCALE },
    },
    primaryColor:         { ...BLACK_COLOR },
    secondaryColor:       { ...BLACK_COLOR },
    usedSwatchSlot:       { levelName: '', pathName: swatch },
    usedMaterial:         { ...EMPTY_REF },
    usedPattern:          { ...EMPTY_REF },
    usedSkin:             { ...EMPTY_REF },
    usedRecipe:           { levelName: '', pathName: recipe },
    usedPaintFinish:      { ...EMPTY_REF },
    patternRotation:      0,
    blueprintProxy:       { ...EMPTY_REF },
    instanceSpecificData,
  };
  entry.instances.push(instance);
  return instance;
}

/**
 * Create a rectangular grid of foundations.
 *
 * The grid is centered on (cx, cy) and extends in the local X/Y axes
 * defined by the rotation quaternion.  With identity rotation the grid
 * extends along world +X (columns) and +Y (rows).
 *
 * @param {object}  lwSub      - The lightweight buildable subsystem entity
 * @param {string}  typePath   - One of Foundation.Types.*
 * @param {number}  cx         - Center X of the grid
 * @param {number}  cy         - Center Y of the grid
 * @param {number}  z          - Z (center height of every foundation)
 * @param {number}  cols       - Number of columns (local X direction)
 * @param {number}  rows       - Number of rows    (local Y direction)
 * @param {object}  [rotation] - Quaternion {x,y,z,w}
 * @returns {object[]} Array of created instances
 */
function createGrid(lwSub, typePath, cx, cy, z, cols, rows, rotation) {
  const dims = Dims[typePath];
  if (!dims) throw new Error(`Unknown foundation type: ${typePath}`);

  const rot = rotation || IDENTITY_ROTATION;

  // Local axes from quaternion (only need forward/right in XY plane)
  const { fwd, right } = axesFromQuat(rot);

  const step = dims.size; // 800u per tile
  const instances = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Offset from grid center
      const offC = (c - (cols - 1) / 2) * step;
      const offR = (r - (rows - 1) / 2) * step;

      const x = cx + right.x * offC + fwd.x * offR;
      const y = cy + right.y * offC + fwd.y * offR;

      instances.push(create(lwSub, typePath, x, y, z, rot));
    }
  }

  return instances;
}

/**
 * Stack foundations vertically (useful for pillars or tall bases).
 *
 * @param {object}  lwSub      - The lightweight buildable subsystem entity
 * @param {string}  typePath   - One of Foundation.Types.*
 * @param {number}  x          - World X
 * @param {number}  y          - World Y
 * @param {number}  zBase      - Z of the first (bottom) foundation center
 * @param {number}  count      - Number of foundations to stack
 * @param {object}  [rotation] - Quaternion {x,y,z,w}
 * @returns {object[]} Array of created instances (bottom to top)
 */
function createStack(lwSub, typePath, x, y, zBase, count, rotation) {
  const dims = Dims[typePath];
  if (!dims) throw new Error(`Unknown foundation type: ${typePath}`);

  const instances = [];
  for (let i = 0; i < count; i++) {
    instances.push(create(lwSub, typePath, x, y, zBase + i * dims.height, rotation));
  }
  return instances;
}

// -----------------------------------------------------------------
// Queries
// -----------------------------------------------------------------

/**
 * List all lightweight buildable type paths that look structural.
 */
function listStructuralTypes(lwSub) {
  const keywords = [
    'foundation', 'floor', 'platform', 'frame', 'pillar',
    'ramp', 'wall', 'stair', 'beam', 'fence', 'walkway',
    'catwalk', 'roof', 'quarter', 'inverted', 'corner', 'diagonal',
  ];
  return lwSub.specialProperties.buildables
    .filter(b => {
      const lower = b.typeReference.pathName.toLowerCase();
      return keywords.some(kw => lower.includes(kw));
    })
    .map(b => ({
      typePath: b.typeReference.pathName,
      name:     b.typeReference.pathName.split('.').pop(),
      count:    b.instances.length,
    }));
}

/**
 * Get all instances of a given type, optionally sorted by distance to a point.
 */
function getInstances(lwSub, typePath, sortByDistanceTo) {
  const entry = lwSub.specialProperties.buildables
    .find(b => b.typeReference.pathName === typePath);
  if (!entry) return [];

  const instances = entry.instances.map(inst => ({
    instance: inst,
    pos:      inst.transform.translation,
  }));

  if (sortByDistanceTo) {
    const p = sortByDistanceTo;
    for (const i of instances) {
      const dx = i.pos.x - p.x, dy = i.pos.y - p.y, dz = i.pos.z - p.z;
      i.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    instances.sort((a, b) => a.dist - b.dist);
  }

  return instances;
}

// -----------------------------------------------------------------
// Math helpers
// -----------------------------------------------------------------

/**
 * Extract forward (local +Y) and right (local +X) vectors from a quaternion.
 */
function axesFromQuat(q) {
  // Right = local X
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const ry = 2 * (q.x * q.y + q.z * q.w);
  // Forward = local Y
  const fx = 2 * (q.x * q.y - q.z * q.w);
  const fy = 1 - 2 * (q.x * q.x + q.z * q.z);

  return {
    right: { x: rx, y: ry },
    fwd:   { x: fx, y: fy },
  };
}

/**
 * Build a yaw-only quaternion from an angle in degrees.
 * Yaw rotates around the Z axis.
 */
function yawRotation(degrees) {
  const rad = degrees * Math.PI / 180;
  return {
    x: 0,
    y: 0,
    z: Math.sin(rad / 2),
    w: Math.cos(rad / 2),
  };
}

// -----------------------------------------------------------------
// Exports
// -----------------------------------------------------------------

module.exports = {
  Types,
  Dims,
  Recipes,
  BEAM_TYPES,
  DEFAULT_BEAM_LENGTH,
  getSubsystem,
  getOrCreateTypeEntry,
  create,
  createGrid,
  createStack,
  listStructuralTypes,
  getInstances,
  axesFromQuat,
  yawRotation,
};
