const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, nextId, findComp, getClearance,
  Vector3D,
} = require('../../satisfactoryLib');
const RailroadTrack  = require('./RailroadTrack');
const RailwayHelper  = require('./RailwayHelper');

const TRACK_LOCAL_OFFSET = { x: 800, y: 0, z: 0 };
const TRACK_LENGTH       = 1600;

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainDockingStation.Build_TrainDockingStation_C';
const RECIPE    = '/Game/FactoryGame/Buildable/Factory/Train/Station/Recipe_TrainDockingStation.Recipe_TrainDockingStation_C';

const FLAGS_LEGS          = 2097152;
const FLAGS_INVENTORY     = 262152;
const FLAGS_POWER_INFO    = 262152;
const FLAGS_POWER_CONN    = 2097152;
const FLAGS_PLATFORM_CONN = 262152;
const FLAGS_CONVEYOR      = 2097152;

const PORTS = {
  Input0:  { offset: { x: -300, y: 1600, z: 100 }, dir: { x: 0, y: 1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Output0: { offset: { x:  300, y: 1600, z: 100 }, dir: { x: 0, y: 1, z: 0 }, flow: 'output', type: PortType.BELT },
  Input1:  { offset: { x: -300, y: 1600, z: 500 }, dir: { x: 0, y: 1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Output1: { offset: { x:  300, y: 1600, z: 500 }, dir: { x: 0, y: 1, z: 0 }, flow: 'output', type: PortType.BELT },
};

class BeltStation {
  constructor(entity, components, track) {
    this.entity     = entity;
    this.inst       = entity.instanceName;
    this.components = components;
    this.track      = track;

    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }

    this._ports = FlowPort.fromLayout(this._componentMap, entity.transform, PORTS);
  }

  get clearance() { return getClearance(this.entity.typePath); }

  port(name) {
    if (name === 'TrackConnection0' || name === 'TrackConnection1') {
      if (!this.track) throw new Error(`BeltStation ${this.inst}: no integrated track`);
      return this.track.port(name);
    }
    const p = this._ports[name];
    if (!p) throw new Error(`BeltStation ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    const objs = [this.entity, ...this.components];
    if (this.track) objs.push(...this.track.allObjects());
    return objs;
  }

  /**
   * Set loading mode.
   * @param loading  true = load items onto train, false = unload from train
   */
  setLoadMode(loading) {
    this.entity.properties.mIsInLoadMode = {
      type: 'BoolProperty', ueType: 'BoolProperty',
      name: 'mIsInLoadMode', value: loading,
    };
  }

  /**
   * Dock another platform to this one.
   * @param srcSide  0 (back) or 1 (front) on this station
   * @param other    Platform object to dock
   * @param tgtSide  0 or 1 on target (default: opposite of srcSide)
   */
  dockStation(srcSide, other, tgtSide) {
    RailwayHelper.dock(this, srcSide, other, tgtSide);
  }

  /**
   * Create a new belt docking station with its integrated track.
   * @param x, y, z    World position
   * @param rotation    Quaternion
   * @param opts        { loadMode: bool }
   */
  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, opts = {}) {
    const id       = nextId();
    const baseName = `Build_TrainDockingStation_C_${id}`;
    const inst     = `Persistent_Level:PersistentLevel.${baseName}`;

    const origin   = new Vector3D(x, y, z);
    const trackPos = origin.add(new Vector3D(TRACK_LOCAL_OFFSET).rotate(rotation));
    const trackDir = new Vector3D(-1, 0, 0).rotate(rotation);
    const trackEnd = trackPos.add(trackDir.scale(TRACK_LENGTH));
    const track = RailroadTrack.create(
      { pos: trackPos, dir: trackDir },
      { pos: trackEnd, dir: trackDir },
      { integrated: true },
    );

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      legs:      `${inst}.FGFactoryLegs`,
      invPot:    `${inst}.InventoryPotential`,
      powerInfo: `${inst}.powerInfo`,
      platConn0: `${inst}.PlatformConnection0`,
      platConn1: `${inst}.PlatformConnection1`,
      inventory: `${inst}.inventory`,
      powerConn: `${inst}.FGPowerConnection`,
      input0:    `${inst}.Input0`,
      output0:   `${inst}.Output0`,
      input1:    `${inst}.Input1`,
      output1:   `${inst}.Output1`,
    };

    entity.components = Object.values(names).map(n => ref(n));

    entity.properties = {
      mInventory:          { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventory',          value: ref(names.inventory) },
      mRailroadTrack:      { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mRailroadTrack',      value: ref(track.inst) },
      mPowerInfo:          { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo',          value: ref(names.powerInfo) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref('', '') },
      mCustomizationData:  makeCustomizationData(),
      mBuiltWithRecipe:    makeRecipeProp(RECIPE),
    };

    if (opts.loadMode !== undefined) {
      entity.properties.mIsInLoadMode = {
        type: 'BoolProperty', ueType: 'BoolProperty',
        name: 'mIsInLoadMode', value: opts.loadMode,
      };
    }

    const legs      = makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', names.legs, inst, FLAGS_LEGS);
    const invPot    = makeInventoryPotential(names.invPot, inst);
    invPot.flags    = FLAGS_INVENTORY;
    const powerInfo = makePowerInfo(names.powerInfo, inst, 0.1);
    powerInfo.flags = FLAGS_POWER_INFO;
    const inventory = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.inventory, inst, FLAGS_INVENTORY);
    const powerConn = makePowerConnection(names.powerConn, inst, []);
    powerConn.flags = FLAGS_POWER_CONN;

    const platConn0 = makeComponent('/Script/FactoryGame.FGTrainPlatformConnection', names.platConn0, inst, FLAGS_PLATFORM_CONN);
    platConn0.properties = {
      mRailroadTrackConnection: {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mRailroadTrackConnection',
        value: ref(`${track.inst}.TrackConnection0`),
      },
    };
    const platConn1 = makeComponent('/Script/FactoryGame.FGTrainPlatformConnection', names.platConn1, inst, FLAGS_PLATFORM_CONN);
    platConn1.properties = {
      mRailroadTrackConnection: {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mRailroadTrackConnection',
        value: ref(`${track.inst}.TrackConnection1`),
      },
    };

    const makeConv = (name) => makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', name, inst, FLAGS_CONVEYOR);

    const components = [
      legs, invPot, powerInfo, platConn0, platConn1, inventory, powerConn,
      makeConv(names.input0), makeConv(names.output0),
      makeConv(names.input1), makeConv(names.output1),
    ];

    return new BeltStation(entity, components, track);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = [
      'FGFactoryLegs', 'InventoryPotential', 'powerInfo',
      'PlatformConnection0', 'PlatformConnection1', 'inventory', 'FGPowerConnection',
      'Input0', 'Output0', 'Input1', 'Output1',
    ];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));

    const trackRef = entity.properties?.mRailroadTrack?.value?.pathName;
    let track = null;
    if (trackRef) {
      const trackEntity = saveObjects.find(o => o.instanceName === trackRef);
      if (trackEntity) track = RailroadTrack.fromSave(trackEntity, saveObjects);
    }

    return new BeltStation(entity, components, track);
  }
}

BeltStation.TYPE_PATH = TYPE_PATH;
BeltStation.Ports = {
  INPUT0:  'Input0',
  OUTPUT0: 'Output0',
  INPUT1:  'Input1',
  OUTPUT1: 'Output1',
  TRACK0:  'TrackConnection0',
  TRACK1:  'TrackConnection1',
};

module.exports = BeltStation;
