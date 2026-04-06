const {
  ref, makeCustomizationData, makeRecipeProp,
  makeEntity, nextId,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');

const TYPE_BLOCK = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Build_RailroadBlockSignal.Build_RailroadBlockSignal_C';
const TYPE_PATH  = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Build_RailroadPathSignal.Build_RailroadPathSignal_C';
const RECIPE_BLOCK = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Recipe_RailroadBlockSignal.Recipe_RailroadBlockSignal_C';
const RECIPE_PATH  = '/Game/FactoryGame/Buildable/Factory/Train/Signal/Recipe_RailroadPathSignal.Recipe_RailroadPathSignal_C';

class RailroadSignal extends Builder {
  constructor(entity) {
    super(entity);
    this.isBlock = entity.typePath === TYPE_BLOCK;
    this.isPath  = entity.typePath === TYPE_PATH;
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

  /**
   * Attach this signal to a TrackConnection port.
   * Sets position, rotation and mGuardedConnections automatically.
   * @param {FlowPort} port  A TrackConnection FlowPort
   * @param {'outward'|'inward'} facing  Signal direction relative to port outward
   */
  attachToPort(port, facing = 'outward') {
    // Guard: must be a TrackConnection
    if (!port.component?.instanceName?.includes('TrackConnection')) {
      throw new Error(`Signal can only attach to a TrackConnection port (got ${port._portName})`);
    }
    // Guard: port must be connected
    const conns = port.component?.properties?.mConnectedComponents?.values;
    if (!conns || conns.length === 0) {
      throw new Error(`Signal port must be connected (${port._portName} has no connections)`);
    }

    // Position = exact port position
    const pos = port.worldPos();
    this.entity.transform.translation = { x: pos.x, y: pos.y, z: pos.z };

    // Rotation = outward dir of port (or negated for 'inward')
    const dir = port.worldDir();
    const dx = facing === 'inward' ? -dir.x : dir.x;
    const dy = facing === 'inward' ? -dir.y : dir.y;
    const yaw = Math.atan2(dy, dx);
    const half = yaw / 2;
    this.entity.transform.rotation = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

    // Wire mGuardedConnections
    this.setConnections([port.component.instanceName], []);
  }

  static fromSave(entity) {
    return new RailroadSignal(entity);
  }
}

RailroadSignal.TYPE_BLOCK  = TYPE_BLOCK;
RailroadSignal.TYPE_PATH   = TYPE_PATH;

module.exports = RailroadSignal;
