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

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainDockingStationLiquid.Build_TrainDockingStationLiquid_C';
const RECIPE    = '/Game/FactoryGame/Buildable/Factory/Train/Station/Recipe_TrainDockingStationLiquid.Recipe_TrainDockingStationLiquid_C';

const FLAGS_LEGS          = 2097152;
const FLAGS_INVENTORY     = 262152;
const FLAGS_POWER_INFO    = 262152;
const FLAGS_POWER_CONN    = 2097152;
const FLAGS_PLATFORM_CONN = 262152;
const FLAGS_PIPE          = 2097152;

const PORTS = {
  PipeFactoryInput0:  { offset: { x: -300, y: 1600, z: 175 }, dir: { x: 0, y: 1, z: 0 }, flow: 'input',  type: PortType.PIPE },
  PipeFactoryOutput0: { offset: { x:  300, y: 1600, z: 175 }, dir: { x: 0, y: 1, z: 0 }, flow: 'output', type: PortType.PIPE },
  PipeFactoryInput1:  { offset: { x: -300, y: 1600, z: 575 }, dir: { x: 0, y: 1, z: 0 }, flow: 'input',  type: PortType.PIPE },
  PipeFactoryOutput1: { offset: { x:  300, y: 1600, z: 575 }, dir: { x: 0, y: 1, z: 0 }, flow: 'output', type: PortType.PIPE },
};

class PipeStation {
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
      if (!this.track) throw new Error(`PipeStation ${this.inst}: no integrated track`);
      return this.track.port(name);
    }
    const p = this._ports[name];
    if (!p) throw new Error(`PipeStation ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    const objs = [this.entity, ...this.components];
    if (this.track) objs.push(...this.track.allObjects());
    return objs;
  }

  /**
   * Set loading mode.
   * @param loading  true = load fluid onto train, false = unload from train
   */
  setLoadMode(loading) {
    this.entity.properties.mIsInLoadMode = {
      type: 'BoolProperty', ueType: 'BoolProperty',
      name: 'mIsInLoadMode', value: loading,
    };
  }

  /**
   * Dock another platform to this one.
   * Positions and rotates the other platform, rebuilds its integrated track,
   * connects tracks and platform connections.
   * @param srcSide  0 (back) or 1 (front) on this station
   * @param other    Platform object to dock
   * @param tgtSide  0 or 1 on target (default: opposite of srcSide)
   */
  dockStation(srcSide, other, tgtSide) {
    RailwayHelper.dock(this, srcSide, other, tgtSide);
  }

  /**
   * Create a new pipe docking station with its integrated track.
   * @param x, y, z    World position
   * @param rotation    Quaternion
   * @param opts        { loadMode: bool }
   */
  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, opts = {}) {
    const id       = nextId();
    const baseName = `Build_TrainDockingStationLiquid_C_${id}`;
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
      pipeIn0:   `${inst}.PipeFactoryInput0`,
      pipeOut0:  `${inst}.PipeFactoryOutput0`,
      pipeIn1:   `${inst}.PipeFactoryInput1`,
      pipeOut1:  `${inst}.PipeFactoryOutput1`,
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

    const makePipe = (name) => makeComponent('/Script/FactoryGame.FGPipeConnectionFactory', name, inst, FLAGS_PIPE);

    const components = [
      legs, invPot, powerInfo, platConn0, platConn1, inventory, powerConn,
      makePipe(names.pipeIn0), makePipe(names.pipeOut0),
      makePipe(names.pipeIn1), makePipe(names.pipeOut1),
    ];

    return new PipeStation(entity, components, track);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = [
      'FGFactoryLegs', 'InventoryPotential', 'powerInfo',
      'PlatformConnection0', 'PlatformConnection1', 'inventory', 'FGPowerConnection',
      'PipeFactoryInput0', 'PipeFactoryOutput0',
      'PipeFactoryInput1', 'PipeFactoryOutput1',
    ];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));

    const trackRef = entity.properties?.mRailroadTrack?.value?.pathName;
    let track = null;
    if (trackRef) {
      const trackEntity = saveObjects.find(o => o.instanceName === trackRef);
      if (trackEntity) track = RailroadTrack.fromSave(trackEntity, saveObjects);
    }

    return new PipeStation(entity, components, track);
  }
}

PipeStation.TYPE_PATH = TYPE_PATH;
PipeStation.Ports = {
  INPUT0:  'PipeFactoryInput0',
  OUTPUT0: 'PipeFactoryOutput0',
  INPUT1:  'PipeFactoryInput1',
  OUTPUT1: 'PipeFactoryOutput1',
  TRACK0:  'TrackConnection0',
  TRACK1:  'TrackConnection1',
};

module.exports = PipeStation;
