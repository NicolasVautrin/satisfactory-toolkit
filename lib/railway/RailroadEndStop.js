const {
  ref, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, nextId, findComp, getClearance,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/Train/EndStop/Build_RailroadEndStop.Build_RailroadEndStop_C';
const RECIPE    = '/Game/FactoryGame/Buildable/Factory/Train/EndStop/Recipe_RailroadEndStop.Recipe_RailroadEndStop_C';

const FLAGS_TRACK_CONN = 262152;

class RailroadEndStop {
  constructor(entity, trackConn) {
    this.entity    = entity;
    this.inst      = entity.instanceName;
    this.trackConn = trackConn;
    this.components = [trackConn];
  }

  get clearance() { return getClearance(this.entity.typePath); }

  allObjects() {
    return [this.entity, ...this.components];
  }

  /**
   * Connect this end stop to a track endpoint.
   * @param track     RailroadTrack instance
   * @param portName  'TrackConnection0' or 'TrackConnection1'
   */
  connectToTrack(track, portName) {
    const otherComp = track._ports[portName].component;

    if (!this.trackConn.properties.mConnectedComponents) {
      this.trackConn.properties.mConnectedComponents = {
        type:    'ObjectArrayProperty',
        ueType:  'ArrayProperty',
        name:    'mConnectedComponents',
        subtype: 'ObjectProperty',
        values:  [],
      };
    }
    if (!otherComp.properties.mConnectedComponents) {
      otherComp.properties.mConnectedComponents = {
        type:    'ObjectArrayProperty',
        ueType:  'ArrayProperty',
        name:    'mConnectedComponents',
        subtype: 'ObjectProperty',
        values:  [],
      };
    }

    this.trackConn.properties.mConnectedComponents.values.push(ref(otherComp.instanceName));
    otherComp.properties.mConnectedComponents.values.push(ref(this.trackConn.instanceName));
  }

  /**
   * Create a new end stop.
   * @param x, y, z   World position
   * @param rotation   Quaternion
   */
  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id       = nextId();
    const baseName = `Build_RailroadEndStop_C_${id}`;
    const inst     = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const connName = `${inst}.TrackConnection0`;
    entity.components = [ref(connName)];

    entity.properties = {
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe:   makeRecipeProp(RECIPE),
    };

    const trackConn = makeComponent(
      '/Script/FactoryGame.FGRailroadTrackConnectionComponent',
      connName, inst, FLAGS_TRACK_CONN,
    );

    return new RailroadEndStop(entity, trackConn);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const trackConn = findComp(saveObjects, `${inst}.TrackConnection0`);
    return new RailroadEndStop(entity, trackConn);
  }
}

RailroadEndStop.TYPE_PATH = TYPE_PATH;

module.exports = RailroadEndStop;
