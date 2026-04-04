const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent,
  splinePoint, wrapSplineData,
  nextId, findComp,
  Vector3D,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');

const TYPE_PATH       = '/Game/FactoryGame/Buildable/Factory/Train/Track/Build_RailroadTrack.Build_RailroadTrack_C';
const TYPE_INTEGRATED = '/Game/FactoryGame/Buildable/Factory/Train/Track/Build_RailroadTrackIntegrated.Build_RailroadTrackIntegrated_C';
const RECIPE          = '/Game/FactoryGame/Recipes/Buildings/Recipe_RailroadTrack.Recipe_RailroadTrack_C';
const RECIPE_INTEG    = '/Game/FactoryGame/Recipes/Buildings/Recipe_RailroadTrackIntegrated.Recipe_RailroadTrackIntegrated_C';

const FLAGS_TRACK_CONN = 262152;

function isConnectedToIntegrated(conns) {
  return conns.some(c => c.pathName && c.pathName.includes('RailroadTrackIntegrated'));
}
const TANGENT_SCALE = 0.6; // tangent magnitude relative to segment length (from save analysis)

/**
 * Build a rail spline from (0,0,0) to (dx,dy,dz) in local space.
 * Unlike makeSpline (pipes/belts), all tangents point in the travel direction.
 */
function makeRailSpline(dx, dy, dz, dirIn, dirOut) {
  const end = new Vector3D(dx, dy, dz);
  const len = end.length;
  if (len < 1) {
    const t = new Vector3D(1, 0, 0);
    return wrapSplineData([
      splinePoint(new Vector3D(0, 0, 0), t, t),
      splinePoint(new Vector3D(1, 0, 0), t, t),
    ]);
  }

  const straight = end.norm();
  const dirInN  = dirIn  ? new Vector3D(dirIn).norm()  : straight;
  const dirOutN = dirOut ? new Vector3D(dirOut).norm() : straight;
  const tScale  = len * TANGENT_SCALE;

  return wrapSplineData([
    splinePoint(new Vector3D(0, 0, 0), dirInN.scale(tScale), dirInN.scale(tScale)),
    splinePoint(end, dirOutN.scale(tScale), dirOutN.scale(tScale)),
  ]);
}

class RailroadTrack extends Builder {
  /**
   * @param entity    SaveEntity for the track
   * @param conn0     TrackConnection0 component (start)
   * @param conn1     TrackConnection1 component (end)
   * @param opts      { integrated: bool }
   */
  constructor(entity, conn0, conn1, opts = {}) {
    super(entity, conn0, conn1);
    this.integrated = opts.integrated || false;

    // Extract local offsets and tangent directions from spline endpoints
    const spline = entity.properties?.mSplineData?.values;
    let offset0 = { x: 0, y: 0, z: 0 }, offset1 = { x: 0, y: 0, z: 0 };
    let dir0 = null, dir1 = null;

    if (spline && spline.length >= 2) {
      const sp0 = spline[0].value?.properties;
      const spN = spline[spline.length - 1].value?.properties;
      if (sp0?.Location?.value) offset0 = sp0.Location.value;
      if (spN?.Location?.value) offset1 = spN.Location.value;
      if (sp0?.LeaveTangent?.value) dir0 = new Vector3D(sp0.LeaveTangent.value).norm();
      if (spN?.ArriveTangent?.value) dir1 = new Vector3D(spN.ArriveTangent.value).norm();
    }

    const p0 = new FlowPort(conn0, offset0, dir0);
    p0.flowType = null;  // track connections are bidirectional
    p0.portType = PortType.TRACK;
    p0._portName = 'TrackConnection0';
    p0._owner = this;

    const p1 = new FlowPort(conn1, offset1, dir1);
    p1.flowType = null;
    p1.portType = PortType.TRACK;
    p1._portName = 'TrackConnection1';
    p1._owner = this;

    this._ports = {
      TrackConnection0: p0,
      TrackConnection1: p1,
    };
  }

  /**
   * Rebuild the rail spline from two world-space endpoints.
   * Updates entity transform, spline data, and port local-space offsets.
   */
  rebuildSpline(wStartPos, wStartDir, wEndPos, wEndDir) {
    this.entity.transform.translation = { ...wStartPos };
    this.entity.transform.rotation = { x: 0, y: 0, z: 0, w: 1 };
    const dx = wEndPos.x - wStartPos.x;
    const dy = wEndPos.y - wStartPos.y;
    const dz = (wEndPos.z || 0) - (wStartPos.z || 0);
    this.entity.properties.mSplineData = makeRailSpline(dx, dy, dz, wStartDir, wEndDir);

    const p0 = this._ports[RailroadTrack.Ports.START];
    const p1 = this._ports[RailroadTrack.Ports.END];
    p0._pos = { x: 0, y: 0, z: 0 };
    p0._dir = wStartDir;
    p1._pos = { x: dx, y: dy, z: dz };
    p1._dir = wEndDir;
  }

  /**
   * Called when a port is snapped to an anchor position.
   * Rebuilds the spline, keeping the other port's world position.
   */
  onPortSnapped(snappedPort, wPos, wDir) {
    const p0 = this._ports[RailroadTrack.Ports.START];
    const p1 = this._ports[RailroadTrack.Ports.END];

    if (snappedPort === p0) {
      // p0 moved to wPos — capture p1 world pos BEFORE changing transform
      const wEndPos = p1.worldPos(), wEndDir = p1.worldDir();
      this.rebuildSpline(wPos, wDir || p0.worldDir(), wEndPos, wEndDir);
    } else {
      // p1 moved to wPos — capture p0 world pos BEFORE changing transform
      const wStartPos = p0.worldPos(), wStartDir = p0.worldDir();
      this.rebuildSpline(wStartPos, wStartDir, wPos, wDir || p1.worldDir());
    }
  }

  /**
   * Connect this track's endpoint to another track's endpoint.
   * Railroad connections use mConnectedComponents (array, can have multiple for switches).
   * @param portName   'TrackConnection0' or 'TrackConnection1'
   * @param other      Another RailroadTrack
   * @param otherPort  Port name on the other track
   */
  connectPorts(myPortName, other, otherPortName) {
    return this.connect(myPortName, other, otherPortName);
  }

  connect(portName, other, otherPort) {
    const myComp    = this._ports[portName].component;
    const otherComp = other._ports[otherPort].component;

    if (!myComp.properties.mConnectedComponents) {
      myComp.properties.mConnectedComponents = {
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

    const myConns = myComp.properties.mConnectedComponents.values;
    const otherConns = otherComp.properties.mConnectedComponents.values;

    // Guard 0: duplicate connection (check both directions)
    if (myConns.some(c => c.pathName === otherComp.instanceName) ||
        otherConns.some(c => c.pathName === myComp.instanceName))
      throw new Error(`Ports already connected`);

    // Guard 1: max 3 connections per port (switch limit)
    if (myConns.length >= 3)
      throw new Error(`Port ${portName} already has 3 connections (switch limit)`);
    if (otherConns.length >= 3)
      throw new Error(`Port ${otherPort} already has 3 connections (switch limit)`);

    // Guard 2: integrated track ports → max 1 connection
    // Check via component instanceName because `other` may be a TrainStation
    // whose ports are shared from its integrated track
    const myIsIntegrated = this.integrated || myComp.instanceName.includes('RailroadTrackIntegrated');
    const otherIsIntegrated = other.integrated || otherComp.instanceName.includes('RailroadTrackIntegrated');
    if (myIsIntegrated && myConns.length >= 1)
      throw new Error(`Integrated track port ${portName} already connected (max 1)`);
    if (otherIsIntegrated && otherConns.length >= 1)
      throw new Error(`Integrated track port ${otherPort} already connected (max 1)`);

    // Guard 3: port connected to an integrated track → max 1 connection
    if (isConnectedToIntegrated(myConns) && myConns.length >= 1)
      throw new Error(`Port ${portName} is connected to an integrated track (max 1 connection)`);
    if (isConnectedToIntegrated(otherConns) && otherConns.length >= 1)
      throw new Error(`Port ${otherPort} is connected to an integrated track (max 1 connection)`);

    // Guard 4: track connecting to integrated must be exactly minimum length (1200 UU)
    if (myIsIntegrated || otherIsIntegrated) {
      const nonInteg = myIsIntegrated ? other : this;
      const nonIntegIsIntegrated = myIsIntegrated ? otherIsIntegrated : myIsIntegrated;
      if (!nonIntegIsIntegrated && nonInteg._ports?.TrackConnection0 && nonInteg._ports?.TrackConnection1) {
        const p0 = nonInteg._ports.TrackConnection0.worldPos();
        const p1 = nonInteg._ports.TrackConnection1.worldPos();
        const len = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2);
        const MIN_TRACK = 1200;
        if (Math.abs(len - MIN_TRACK) > 1)
          throw new Error(`Track connecting to integrated track must be exactly ${MIN_TRACK} UU (got ${Math.round(len)})`);
      }
    }

    myConns.push(ref(otherComp.instanceName));
    otherConns.push(ref(myComp.instanceName));
  }

  /**
   * Create a new railroad track.
   * @param from  {x,y,z} start position (or {pos, dir})
   * @param to    {x,y,z} end position (or {pos, dir})
   * @param opts  { integrated: bool }
   */
  static create(from, to, opts = {}) {
    const integrated = opts.integrated || false;
    const typePath   = integrated ? TYPE_INTEGRATED : TYPE_PATH;
    const recipe     = integrated ? RECIPE_INTEG : RECIPE;
    const prefix     = integrated ? 'Build_RailroadTrackIntegrated_C' : 'Build_RailroadTrack_C';

    const id       = nextId();
    const baseName = `${prefix}_${id}`;
    const inst     = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(typePath, inst);

    const fromPos = from?.pos || from || { x: 0, y: 0, z: 0 };
    const toPos   = to?.pos || to || { x: 100, y: 0, z: 0 };

    entity.transform = {
      rotation:    { x: 0, y: 0, z: 0, w: 1 },
      translation: { ...fromPos },
      scale3d:     { x: 1, y: 1, z: 1 },
    };

    const conn0Name = `${inst}.TrackConnection0`;
    const conn1Name = `${inst}.TrackConnection1`;
    entity.components = [ref(conn1Name), ref(conn0Name)];

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dz = toPos.z - fromPos.z;

    entity.properties = {
      mSplineData:        makeRailSpline(dx, dy, dz, from?.dir || null, to?.dir || null),
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe:   makeRecipeProp(recipe),
    };

    const conn0 = makeComponent(
      '/Script/FactoryGame.FGRailroadTrackConnectionComponent',
      conn0Name, inst, FLAGS_TRACK_CONN,
    );
    const conn1 = makeComponent(
      '/Script/FactoryGame.FGRailroadTrackConnectionComponent',
      conn1Name, inst, FLAGS_TRACK_CONN,
    );

    return new RailroadTrack(entity, conn0, conn1, { integrated });
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const conn0 = findComp(saveObjects, `${inst}.TrackConnection0`);
    const conn1 = findComp(saveObjects, `${inst}.TrackConnection1`);
    const integrated = entity.typePath.includes('Integrated');
    return new RailroadTrack(entity, conn0, conn1, { integrated });
  }
}

RailroadTrack.Ports       = { START: 'TrackConnection0', END: 'TrackConnection1' };
RailroadTrack.TYPE_PATH   = TYPE_PATH;
RailroadTrack.TYPE_INTEGRATED = TYPE_INTEGRATED;

RailroadTrack.IS_SPLINE = true;

RailroadTrack.getPorts = function(entity) {
  return Builder._splinePorts(entity, ['TrackConnection0', 'TrackConnection1'], 'track');
};

module.exports = RailroadTrack;
