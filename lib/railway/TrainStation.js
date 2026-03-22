const {
  ref, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, nextId, findComp, getClearance,
  Vector3D,
} = require('../../satisfactoryLib');
const RailroadTrack  = require('./RailroadTrack');
const RailwayHelper  = require('./RailwayHelper');

const TRACK_LOCAL_OFFSET = { x: 800, y: 0, z: 0 };
const TRACK_LENGTH       = 1600;

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainStation.Build_TrainStation_C';
const RECIPE    = '/Game/FactoryGame/Buildable/Factory/Train/Station/Recipe_TrainStation.Recipe_TrainStation_C';

const FLAGS_LEGS          = 2097152;
const FLAGS_INVENTORY     = 262152;
const FLAGS_POWER_INFO    = 262152;
const FLAGS_POWER_CONN    = 2097152;
const FLAGS_PLATFORM_CONN = 262152;

class TrainStation {
  constructor(entity, components, track, stationId) {
    this.entity     = entity;
    this.inst       = entity.instanceName;
    this.components = components;
    this.track      = track;
    this.stationId  = stationId;

    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }
  }

  get clearance() { return getClearance(this.entity.typePath); }

  port(name) {
    if (name === 'TrackConnection0' || name === 'TrackConnection1') {
      if (!this.track) throw new Error(`TrainStation ${this.inst}: no integrated track`);
      return this.track.port(name);
    }
    throw new Error(`TrainStation ${this.inst}: unknown port "${name}"`);
  }

  allObjects() {
    const objs = [this.entity, ...this.components];
    if (this.track) objs.push(...this.track.allObjects());
    if (this.stationId) objs.push(this.stationId);
    return objs;
  }

  /**
   * Create a new TrainStation with its integrated track and station identifier.
   * @param x, y, z   World position
   * @param rotation   Quaternion (default identity)
   * @param opts       { name: string } station name
   */
  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, opts = {}) {
    const id       = nextId();
    const baseName = `Build_TrainStation_C_${id}`;
    const inst     = `Persistent_Level:PersistentLevel.${baseName}`;

    // Create the integrated track: origin at local (800,0,0), spline 1600u along local -X
    const origin    = new Vector3D(x, y, z);
    const trackPos  = origin.add(new Vector3D(TRACK_LOCAL_OFFSET).rotate(rotation));
    const trackDir  = new Vector3D(-1, 0, 0).rotate(rotation);
    const trackEnd  = trackPos.add(trackDir.scale(TRACK_LENGTH));
    const track = RailroadTrack.create(
      { pos: trackPos, dir: trackDir },
      { pos: trackEnd, dir: trackDir },
      { integrated: true },
    );

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      legs:        `${inst}.FGFactoryLegs`,
      invPot:      `${inst}.InventoryPotential`,
      powerInfo:   `${inst}.powerInfo`,
      platConn0:   `${inst}.PlatformConnection0`,
      platConn1:   `${inst}.PlatformConnection1`,
      powerConn:   `${inst}.PowerConnection`,
    };

    entity.components = Object.values(names).map(n => ref(n));

    entity.properties = {
      mRailroadTrack:      { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mRailroadTrack',      value: ref(track.inst) },
      mPowerInfo:          { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo',          value: ref(names.powerInfo) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref('', '') },
      mCustomizationData:  makeCustomizationData(),
      mBuiltWithRecipe:    makeRecipeProp(RECIPE),
    };

    // Components
    const legs      = makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', names.legs, inst, FLAGS_LEGS);
    const invPot    = makeInventoryPotential(names.invPot, inst);
    invPot.flags    = FLAGS_INVENTORY;
    const powerInfo = makePowerInfo(names.powerInfo, inst, 0.1);
    powerInfo.flags = FLAGS_POWER_INFO;
    const powerConn = makePowerConnection(names.powerConn, inst, []);
    powerConn.flags = FLAGS_POWER_CONN;

    // Platform connections link to the integrated track's endpoints
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

    const components = [legs, invPot, powerInfo, platConn0, platConn1, powerConn];

    // Station identifier (gives the station a name on the map)
    const stIdName = `Persistent_Level:PersistentLevel.FGTrainStationIdentifier_${id}`;
    const stationIdObj = makeEntity('/Script/FactoryGame.FGTrainStationIdentifier', stIdName);
    stationIdObj.needTransform = true;
    stationIdObj.transform = {
      rotation:    { x: 0, y: 0, z: 0, w: 1 },
      translation: { x: 0, y: 0, z: 0 },
      scale3d:     { x: 1, y: 1, z: 1 },
    };
    stationIdObj.parentObject  = ref('', '');
    stationIdObj.properties = {
      mStation: {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mStation', value: ref(inst),
      },
    };
    if (opts.name) {
      stationIdObj.properties.mStationName = {
        type:   'TextProperty',
        ueType: 'TextProperty',
        name:   'mStationName',
        value:  { flags: 18, historyType: 255, hasCultureInvariantString: true, value: opts.name },
      };
    }

    return new TrainStation(entity, components, track, stationIdObj);
  }

  /**
   * Dock another platform behind this station (side 0 only).
   * @param other    Platform object to dock
   * @param tgtSide  0 or 1 on target (default: 1)
   */
  dockStation(other, tgtSide) {
    RailwayHelper.dock(this, 0, other, tgtSide);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['FGFactoryLegs', 'InventoryPotential', 'powerInfo',
      'PlatformConnection0', 'PlatformConnection1', 'PowerConnection'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));

    // Find integrated track
    const trackRef = entity.properties?.mRailroadTrack?.value?.pathName;
    let track = null;
    if (trackRef) {
      const trackEntity = saveObjects.find(o => o.instanceName === trackRef);
      if (trackEntity) track = RailroadTrack.fromSave(trackEntity, saveObjects);
    }

    // Find station identifier
    const stationId = saveObjects.find(o =>
      o.typePath === '/Script/FactoryGame.FGTrainStationIdentifier'
      && o.properties?.mStation?.value?.pathName === inst
    );

    return new TrainStation(entity, components, track, stationId);
  }
}

TrainStation.TYPE_PATH = TYPE_PATH;

module.exports = TrainStation;
