/**
 * Short aliases for common typePaths.
 * Used by POST /api/create-entity to avoid passing full UE paths.
 *
 * Resolution order:
 *   1. Exact alias match (case-insensitive)
 *   2. Exact className match (e.g. "Build_SmelterMk1_C")
 *   3. Full typePath (passthrough)
 */

const Registry = require('../../lib/Registry');

const ALIASES = {
  // ── Producers ────────────────────────────────
  smelter:        'Build_SmelterMk1_C',
  constructor:    'Build_ConstructorMk1_C',
  assembler:      'Build_AssemblerMk1_C',
  manufacturer:   'Build_ManufacturerMk1_C',
  foundry:        'Build_FoundryMk1_C',
  refinery:       'Build_OilRefinery_C',
  blender:        'Build_Blender_C',
  packager:       'Build_Packager_C',
  collider:       'Build_HadronCollider_C',
  converter:      'Build_Converter_C',
  encoder:        'Build_QuantumEncoder_C',
  nuclear:        'Build_GeneratorNuclear_C',

  // ── Extractors ───────────────────────────────
  'miner-1':      'Build_MinerMk1_C',
  'miner-2':      'Build_MinerMk2_C',
  'miner-3':      'Build_MinerMk3_C',
  miner:          'Build_MinerMk3_C',
  'oil-pump':     'Build_OilPump_C',
  'water-pump':   'Build_WaterPump_C',
  fracker:        'Build_FrackingSmasher_C',
  'frack-node':   'Build_FrackingExtractor_C',

  // ── Belts ────────────────────────────────────
  'belt-1':       'Build_ConveyorBeltMk1_C',
  'belt-2':       'Build_ConveyorBeltMk2_C',
  'belt-3':       'Build_ConveyorBeltMk3_C',
  'belt-4':       'Build_ConveyorBeltMk4_C',
  'belt-5':       'Build_ConveyorBeltMk5_C',
  'belt-6':       'Build_ConveyorBeltMk6_C',
  belt:           'Build_ConveyorBeltMk6_C',

  // ── Lifts ────────────────────────────────────
  'lift-1':       'Build_ConveyorLiftMk1_C',
  'lift-2':       'Build_ConveyorLiftMk2_C',
  'lift-3':       'Build_ConveyorLiftMk3_C',
  'lift-4':       'Build_ConveyorLiftMk4_C',
  'lift-5':       'Build_ConveyorLiftMk5_C',
  'lift-6':       'Build_ConveyorLiftMk6_C',
  lift:           'Build_ConveyorLiftMk6_C',

  // ── Splitters / Mergers ──────────────────────
  splitter:       'Build_ConveyorAttachmentSplitter_C',
  'smart-splitter': 'Build_ConveyorAttachmentSplitterSmart_C',
  'prog-splitter':  'Build_ConveyorAttachmentSplitterProgrammable_C',
  merger:         'Build_ConveyorAttachmentMerger_C',
  'prio-merger':  'Build_ConveyorAttachmentMergerPriority_C',

  // ── Pipes ────────────────────────────────────
  'pipe-junction': 'Build_PipelineJunction_Cross_C',
  'pipe-pump':     'Build_PipelinePumpMk2_C',
  'pipe-hole':     'Build_FoundationPassthrough_Pipe_C',

  // ── Power ────────────────────────────────────
  'power-line':   'Build_PowerLine_C',
};

// Build className → typePath lookup from Registry
const registry = Registry.default();
const classToTypePath = {};
for (const [cls, Builder] of Object.entries(registry._builders)) {
  // Try to find the typePath from various sources
  if (Builder.TYPE_PATH) {
    classToTypePath[cls] = Builder.TYPE_PATH;
  } else if (Builder.TIERS) {
    for (const tier of Object.values(Builder.TIERS)) {
      if (tier.typePath.includes(cls)) {
        classToTypePath[cls] = tier.typePath;
        break;
      }
    }
  } else if (Builder.VARIANTS) {
    for (const variant of Object.values(Builder.VARIANTS)) {
      if (variant.typePath.includes(cls)) {
        classToTypePath[cls] = variant.typePath;
        break;
      }
    }
  }
}

// Hardcode the ones without TYPE_PATH/TIERS/VARIANTS
const MANUAL_TYPEPATHS = {
  Build_GeneratorNuclear_C: '/Game/FactoryGame/Buildable/Factory/GeneratorNuclear/Build_GeneratorNuclear.Build_GeneratorNuclear_C',
  Build_WaterPump_C: '/Game/FactoryGame/Buildable/Factory/WaterPump/Build_WaterPump.Build_WaterPump_C',
  Build_PowerLine_C: '/Game/FactoryGame/Buildable/Factory/PowerLine/Build_PowerLine.Build_PowerLine_C',
  Build_PipelineJunction_Cross_C: '/Game/FactoryGame/Buildable/Factory/PipelineJunction/Build_PipelineJunction_Cross.Build_PipelineJunction_Cross_C',
  Build_PipelinePumpMk2_C: '/Game/FactoryGame/Buildable/Factory/PipelinePumpMk2/Build_PipelinePumpMk2.Build_PipelinePumpMk2_C',
  Build_FoundationPassthrough_Pipe_C: '/Game/FactoryGame/Buildable/Factory/FoundationPassthrough_Pipe/Build_FoundationPassthrough_Pipe.Build_FoundationPassthrough_Pipe_C',
};
Object.assign(classToTypePath, MANUAL_TYPEPATHS);

/**
 * Resolve an alias, className, or typePath to a full typePath.
 * @param {string} input  Alias ("splitter"), className ("Build_ConveyorAttachmentSplitter_C"), or full typePath
 * @returns {string} Full typePath
 * @throws {Error} If input cannot be resolved
 */
function resolveTypePath(input) {
  // 1. Alias match (case-insensitive)
  const alias = ALIASES[input.toLowerCase()];
  if (alias) {
    const tp = classToTypePath[alias];
    if (tp) return tp;
    // alias maps to className but no typePath found — shouldn't happen
    throw new Error(`Alias "${input}" maps to ${alias} but no typePath found`);
  }

  // 2. Exact className match
  if (classToTypePath[input]) return classToTypePath[input];

  // 3. Full typePath passthrough (contains a dot)
  if (input.includes('.')) return input;

  // 4. Fuzzy: try to find a className that contains the input
  const lower = input.toLowerCase();
  const match = Object.keys(classToTypePath).find(cls => cls.toLowerCase().includes(lower));
  if (match) return classToTypePath[match];

  throw new Error(`Cannot resolve typePath for "${input}". Use GET /api/aliases for available aliases.`);
}

/**
 * Get all available aliases.
 */
function getAliases() {
  return ALIASES;
}

module.exports = { resolveTypePath, getAliases };