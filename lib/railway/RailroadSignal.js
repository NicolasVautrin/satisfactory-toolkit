const {
  ref, makeCustomizationData, makeRecipeProp,
  makeEntity, nextId,
} = require('../../satisfactoryLib');

const TYPE_BLOCK = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Build_RailroadBlockSignal.Build_RailroadBlockSignal_C';
const TYPE_PATH  = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Build_RailroadPathSignal.Build_RailroadPathSignal_C';
const RECIPE_BLOCK = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Recipe_RailroadBlockSignal.Recipe_RailroadBlockSignal_C';
const RECIPE_PATH  = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Recipe_RailroadPathSignal.Recipe_RailroadPathSignal_C';

class RailroadSignal {
  constructor(entity) {
    this.entity  = entity;
    this.inst    = entity.instanceName;
    this.isBlock = entity.typePath === TYPE_BLOCK;
    this.isPath  = entity.typePath === TYPE_PATH;
  }

  allObjects() {
    return [this.entity];
  }

  /**
   * Set which track connections this signal guards and observes.
   * @param guarded   Array of TrackConnection pathNames (signals guard these)
   * @param observed  Array of TrackConnection pathNames (signals observe these)
   */
  setConnections(guarded, observed) {
    if (guarded && guarded.length > 0) {
      this.entity.properties.mGuardedConnections = {
        type:    'ObjectArrayProperty',
        ueType:  'ArrayProperty',
        name:    'mGuardedConnections',
        subtype: 'ObjectProperty',
        values:  guarded.map(p => ref(p)),
      };
    }
    if (observed && observed.length > 0) {
      this.entity.properties.mObservedConnections = {
        type:    'ObjectArrayProperty',
        ueType:  'ArrayProperty',
        name:    'mObservedConnections',
        subtype: 'ObjectProperty',
        values:  observed.map(p => ref(p)),
      };
    }
  }

  /**
   * Create a railroad signal.
   * @param x, y, z   World position
   * @param rotation   Quaternion
   * @param opts       { type: 'block'|'path' }
   */
  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, opts = {}) {
    const isPath   = opts.type === 'path';
    const typePath = isPath ? TYPE_PATH : TYPE_BLOCK;
    const recipe   = isPath ? RECIPE_PATH : RECIPE_BLOCK;
    const prefix   = isPath ? 'Build_RailroadPathSignal_C' : 'Build_RailroadBlockSignal_C';

    const id       = nextId();
    const baseName = `${prefix}_${id}`;
    const inst     = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(typePath, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    entity.properties = {
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe:   makeRecipeProp(recipe),
    };

    return new RailroadSignal(entity);
  }

  static fromSave(entity) {
    return new RailroadSignal(entity);
  }
}

RailroadSignal.TYPE_BLOCK  = TYPE_BLOCK;
RailroadSignal.TYPE_PATH   = TYPE_PATH;

module.exports = RailroadSignal;
