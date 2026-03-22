const {
  ref, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makePowerInfo,
  nextId, findComp,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Vehicle/Train/Locomotive/BP_Locomotive.BP_Locomotive_C';
const RECIPE    = '/Game/FactoryGame/Recipes/Vehicle/Train/Recipe_Locomotive.Recipe_Locomotive_C';

const FLAGS_POWER_CONN = 2097152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_HEALTH     = 262152;
const TARGET_CONSUMPTION = 25;

class Locomotive {
  constructor(entity, components) {
    this.entity     = entity;
    this.inst       = entity.instanceName;
    this.components = components;

    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  /**
   * Place the locomotive on a track at a given offset.
   * @param track    RailroadTrack instance
   * @param offset   Offset along the spline (default 0)
   * @param forward  Direction on track: 1 or -1 (default 1)
   */
  setTrackPosition(track, offset = 0, forward = 1) {
    this.entity.properties.mTrackPosition = {
      type:    'StructProperty',
      ueType:  'StructProperty',
      name:    'mTrackPosition',
      value:   {
        root:         'Persistent_Level',
        instanceName: track.inst,
        offset:       offset,
        forward:      forward,
      },
      subtype: 'RailroadTrackPosition',
    };
  }

  /**
   * Create a new Locomotive.
   * @param x, y, z    World position
   * @param rotation    Quaternion
   * @param opts        { reversed: bool, ownerPlayerState: string }
   */
  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, opts = {}) {
    const id       = nextId();
    const baseName = `BP_Locomotive_C_${id}`;
    const inst     = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.parentObject = ref('', '');
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      slidingShoe: `${inst}.SlidingShoe`,
      healthComp:  `${inst}.HealthComponent`,
      powerInfo:   `${inst}.powerInfo`,
    };

    entity.components = Object.values(names).map(n => ref(n));

    entity.properties = {
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe:   makeRecipeProp(RECIPE),
      mIsSimulated:       { type: 'BoolProperty', ueType: 'BoolProperty', name: 'mIsSimulated', value: true },
      mHealthComponent:   { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mHealthComponent', value: ref(names.healthComp) },
      mLastSafeLocation:  { type: 'StructProperty', ueType: 'StructProperty', name: 'mLastSafeLocation', value: { x, y, z }, subtype: 'Vector' },
    };

    if (opts.reversed) {
      entity.properties.mIsOrientationReversed = {
        type: 'BoolProperty', ueType: 'BoolProperty',
        name: 'mIsOrientationReversed', value: true,
      };
    }

    if (opts.ownerPlayerState) {
      entity.properties.mOwningPlayerState = {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mOwningPlayerState', value: ref(opts.ownerPlayerState),
      };
    }

    entity.specialProperties = {
      type:           'VehicleSpecialProperties',
      objects:        [],
      vehicleInFront: ref('', ''),
      vehicleBehind:  ref('', ''),
    };

    // Components
    const slidingShoe = makePowerConnection(names.slidingShoe, inst, []);
    slidingShoe.flags = FLAGS_POWER_CONN;
    const healthComp  = makeComponent('/Script/FactoryGame.FGHealthComponent', names.healthComp, inst, FLAGS_HEALTH);
    const powerInfo   = makePowerInfo(names.powerInfo, inst, TARGET_CONSUMPTION);
    powerInfo.flags   = FLAGS_POWER_INFO;

    return new Locomotive(entity, [slidingShoe, healthComp, powerInfo]);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['SlidingShoe', 'HealthComponent', 'powerInfo'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new Locomotive(entity, components);
  }
}

Locomotive.TYPE_PATH = TYPE_PATH;

module.exports = Locomotive;
