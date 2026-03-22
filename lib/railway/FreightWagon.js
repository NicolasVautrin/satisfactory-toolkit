const {
  ref, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent,
  nextId, findComp,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Vehicle/Train/Wagon/BP_FreightWagon.BP_FreightWagon_C';
const RECIPE    = '/Game/FactoryGame/Recipes/Vehicle/Train/Recipe_FreightWagon.Recipe_FreightWagon_C';

const FLAGS_INVENTORY = 262152;
const FLAGS_HEALTH    = 262152;

class FreightWagon {
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
   * Place the wagon on a track at a given offset.
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
   * Create a new FreightWagon.
   * @param x, y, z    World position
   * @param rotation    Quaternion
   * @param opts        { ownerPlayerState: string }
   */
  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, opts = {}) {
    const id       = nextId();
    const baseName = `BP_FreightWagon_C_${id}`;
    const inst     = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.parentObject = ref('', '');
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      storageInv: `${inst}.StorageInventory`,
      healthComp: `${inst}.HealthComponent`,
    };

    entity.components = Object.values(names).map(n => ref(n));

    entity.properties = {
      mStorageInventory: {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mStorageInventory', value: ref(names.storageInv),
      },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe:   makeRecipeProp(RECIPE),
      mIsSimulated:       { type: 'BoolProperty', ueType: 'BoolProperty', name: 'mIsSimulated', value: true },
      mHealthComponent:   { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mHealthComponent', value: ref(names.healthComp) },
      mLastSafeLocation:  { type: 'StructProperty', ueType: 'StructProperty', name: 'mLastSafeLocation', value: { x, y, z }, subtype: 'Vector' },
    };

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
    const storageInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.storageInv, inst, FLAGS_INVENTORY);
    const healthComp = makeComponent('/Script/FactoryGame.FGHealthComponent', names.healthComp, inst, FLAGS_HEALTH);

    return new FreightWagon(entity, [storageInv, healthComp]);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['StorageInventory', 'HealthComponent'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new FreightWagon(entity, components);
  }
}

FreightWagon.TYPE_PATH = TYPE_PATH;

module.exports = FreightWagon;
