/**
 * Registry — maps typePath classNames to Builder classes.
 *
 * Each entry stores the Builder class itself.
 * The Registry resolves typePath → Builder and calls Builder.fromBlueprint(entity, blueprintTransform).
 */

let _instance = null;

class Registry {
  constructor() {
    this._builders = {};  // className → Builder (must have static fromBlueprint)
  }

  /**
   * Register a Builder with a single TYPE_PATH.
   * @param {Function} Builder  Class with static TYPE_PATH and fromBlueprint(entity, blueprintTransform)
   */
  register(Builder) {
    const className = Builder.TYPE_PATH.split('.').pop();
    this._builders[className] = Builder;
    return this;
  }

  /**
   * Register a Builder for a specific className.
   * @param {string} className  e.g. 'Build_MinerMk3_C'
   * @param {Function} Builder  Class with static fromBlueprint(entity, blueprintTransform)
   */
  registerAs(className, Builder) {
    this._builders[className] = Builder;
    return this;
  }

  /**
   * Get the Builder for a typePath or className.
   * @param {string} typePathOrClass
   * @returns {Function|null}  Builder class with fromBlueprint, or null
   */
  get(typePathOrClass) {
    const className = typePathOrClass.includes('.')
      ? typePathOrClass.split('.').pop()
      : typePathOrClass;
    return this._builders[className] || null;
  }

  /**
   * Check if a Builder exists for the given typePath or className.
   */
  has(typePathOrClass) {
    return this.get(typePathOrClass) !== null;
  }

  /**
   * Get the singleton instance with all known Builders registered.
   * @returns {Registry}
   */
  static default() {
    if (_instance) return _instance;
    _instance = new Registry();

    // Producers
    const Refinery         = require('./producers/Refinery');
    const Constructor      = require('./producers/Constructor');
    const Smelter          = require('./producers/Smelter');
    const Foundry          = require('./producers/Foundry');
    const Assembler        = require('./producers/Assembler');
    const Manufacturer     = require('./producers/Manufacturer');
    const Blender          = require('./producers/Blender');
    const Packager         = require('./producers/Packager');
    const HadronCollider   = require('./producers/HadronCollider');
    const Converter        = require('./producers/Converter');
    const QuantumEncoder   = require('./producers/QuantumEncoder');
    const NukePlant        = require('./producers/NukePlant');

    [
      Refinery, Constructor, Smelter, Foundry, Assembler,
      Manufacturer, Blender, Packager, HadronCollider,
      Converter, QuantumEncoder,
    ].forEach(B => _instance.register(B));

    // NukePlant — no TYPE_PATH
    _instance.registerAs('Build_GeneratorNuclear_C', NukePlant);

    // Extractors
    const Miner             = require('./extractors/Miner');
    const OilPump           = require('./extractors/OilPump');
    const FrackingExtractor = require('./extractors/FrackingExtractor');
    const FrackingSmasher   = require('./extractors/FrackingSmasher');
    const WaterExtractor    = require('./extractors/WaterExtractor');

    _instance.register(OilPump);
    _instance.register(FrackingExtractor);
    _instance.register(FrackingSmasher);

    // WaterExtractor has no TYPE_PATH — register manually
    _instance.registerAs('Build_WaterPump_C', WaterExtractor);

    // Miner — multi-tier
    for (const [, cfg] of Object.entries(Miner.TIERS)) {
      const className = cfg.typePath.split('.').pop();
      _instance.registerAs(className, Miner);
    }

    // Logistic
    const ConveyorBelt       = require('./logistic/ConveyorBelt');
    const ConveyorLift       = require('./logistic/ConveyorLift');
    const ConveyorSplitter   = require('./logistic/ConveyorSplitter');
    const ConveyorMerger     = require('./logistic/ConveyorMerger');
    const PowerLine          = require('./logistic/PowerLine');
    const PipeJunction       = require('./logistic/PipeJunction');
    const PipePump           = require('./logistic/PipePump');
    const PipeHole           = require('./logistic/PipeHole');

    // ConveyorBelt — multi-tier
    for (const [, cfg] of Object.entries(ConveyorBelt.TIERS)) {
      const className = cfg.typePath.split('.').pop();
      _instance.registerAs(className, ConveyorBelt);
    }

    // ConveyorLift — multi-tier
    for (const [, cfg] of Object.entries(ConveyorLift.TIERS)) {
      const className = cfg.typePath.split('.').pop();
      _instance.registerAs(className, ConveyorLift);
    }

    // Splitter variants
    for (const [, cfg] of Object.entries(ConveyorSplitter.VARIANTS)) {
      const className = cfg.typePath.split('.').pop();
      _instance.registerAs(className, ConveyorSplitter);
    }

    // Merger variants
    for (const [, cfg] of Object.entries(ConveyorMerger.VARIANTS)) {
      const className = cfg.typePath.split('.').pop();
      _instance.registerAs(className, ConveyorMerger);
    }

    // PowerLine
    _instance.registerAs('Build_PowerLine_C', PowerLine);

    // Pipe infrastructure
    _instance.registerAs('Build_PipelineJunction_Cross_C', PipeJunction);
    _instance.registerAs('Build_PipelinePumpMk2_C', PipePump);
    _instance.registerAs('Build_FoundationPassthrough_Pipe_C', PipeHole);


    // Generic builder for simple entities (foundations, beams, power poles, etc.)
    // These have no complex components — just entity + transform + properties.
    _instance._genericBuilder = GenericBuilder;

    return _instance;
  }

  /**
   * Create a machine from a blueprint entity, applying the blueprint transform.
   * Falls back to GenericBuilder for unknown types.
   * @param {object} entity  Raw blueprint entity (local space)
   * @param {Transform} blueprintTransform  Blueprint placement transform
   */
  createFromBlueprint(entity, blueprintTransform) {
    const Builder = this.get(entity.typePath);
    if (Builder) return Builder.fromBlueprint(entity, blueprintTransform);
    return GenericBuilder.fromBlueprint(entity, blueprintTransform);
  }
}

/**
 * Generic builder for entities without a dedicated Builder class.
 * Creates the entity with proper flags/transform and copies all properties.
 */
class GenericBuilder {
  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('./shared/Transform');
    const { makeEntity, nextId, ref } = require('../satisfactoryLib');
    const className = entity.typePath.split('.').pop();
    const id = nextId();
    const inst = `Persistent_Level:PersistentLevel.${className}_${id}`;

    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));

    const e = makeEntity(entity.typePath, inst);
    e.transform = worldTransform.toSave();
    e.properties = JSON.parse(JSON.stringify(entity.properties || {}));
    if (entity.specialProperties) {
      e.specialProperties = JSON.parse(JSON.stringify(entity.specialProperties));
    }
    e.components = [];

    return { entity: e, allObjects: () => [e] };
  }
}

module.exports = Registry;
