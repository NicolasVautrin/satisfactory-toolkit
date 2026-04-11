const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makeSpline,
  splinePoint, wrapSplineData,
  nextId, findComp,
  Vector3D,
} = require('../../satisfactoryLib');
const SplineBuilder = require('../shared/SplineBuilder');

const TYPE_PATH       = '/Game/FactoryGame/Buildable/Factory/Train/Track/Build_RailroadTrack.Build_RailroadTrack_C';
const TYPE_INTEGRATED = '/Game/FactoryGame/Buildable/Factory/Train/Track/Build_RailroadTrackIntegrated.Build_RailroadTrackIntegrated_C';
const RECIPE          = '/Game/FactoryGame/Recipes/Buildings/Recipe_RailroadTrack.Recipe_RailroadTrack_C';
const RECIPE_INTEG    = '/Game/FactoryGame/Recipes/Buildings/Recipe_RailroadTrackIntegrated.Recipe_RailroadTrackIntegrated_C';

const FLAGS_TRACK_CONN = 262152;

function isConnectedToIntegrated(conns) {
  return conns.some(c => c.pathName && c.pathName.includes('RailroadTrackIntegrated'));
}

class RailroadTrack extends SplineBuilder {
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
      if (sp0?.LeaveTangent?.value) dir0 = new Vector3D(sp0.LeaveTangent.value).norm().scale(-1); // outward
      if (spN?.ArriveTangent?.value) dir1 = new Vector3D(spN.ArriveTangent.value).norm(); // already outward
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
   * Used by RailroadTrack.create() and RailwayHelper.
   * Dirs are outward (will be negated by makeSpline).
   */
  rebuildSpline(wStartPos, wStartDir, wEndPos, wEndDir) {
    this.entity.transform.translation = { ...wStartPos };
    this.entity.transform.rotation = { x: 0, y: 0, z: 0, w: 1 };
    const dx = wEndPos.x - wStartPos.x;
    const dy = wEndPos.y - wStartPos.y;
    const dz = (wEndPos.z || 0) - (wStartPos.z || 0);

    const p0 = this._ports[RailroadTrack.Ports.START];
    const p1 = this._ports[RailroadTrack.Ports.END];
    p0._pos = { x: 0, y: 0, z: 0 };
    p0._dir = wStartDir || p0._dir;
    p1._pos = { x: dx, y: dy, z: dz };
    p1._dir = wEndDir || p1._dir;

    this.entity.properties.mSplineData = makeSpline(p0, p1);
  }

  /**
   * Override: tracks support multi-snap (switches = up to 3 snaps per port).
   * Does NOT call super.snapPorts (which has single-snap guard via isSnappable).
   */
  snapPorts(srcPort, anchorPort) {
    if (srcPort.portType && anchorPort.portType && srcPort.portType !== anchorPort.portType) {
      throw new Error(`Incompatible port types: ${srcPort.portType} and ${anchorPort.portType}`);
    }
    anchorPort._snappedBy.push(srcPort);
    super._applySnap(srcPort, anchorPort.worldPos(), anchorPort.worldDir());
  }

  /**
   * Override: snap to a free world position.
   */
  snapToPos(srcPort, pos, dir) {
    super._applySnap(srcPort, pos, dir);
  }

  /**
   * Override: defer makeSpline + validate until both endpoints are snapped.
   * At first snap, only _pos/_dir are set (by _applySnap). At second snap,
   * the spline is built and validated.
   */
  _buildSpline(port0, port1) {
    if (!this._snappedPorts || this._snappedPorts.size < 2) return;
    super._buildSpline(port0, port1);
  }

  /**
   * Override: track wiring uses mConnectedComponents (array, supports switches).
   * Pure wiring — no snap/reposition.
   */
  wirePorts(srcPort, anchorPort) {
    const myComp    = srcPort.component;
    const otherComp = anchorPort.component;

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
      throw new Error(`Port ${srcPort._portName} already has 3 connections (switch limit)`);
    if (otherConns.length >= 3)
      throw new Error(`Port ${anchorPort._portName} already has 3 connections (switch limit)`);

    // Guard 2: integrated track ports → max 1 connection
    const myIsIntegrated = this.integrated || myComp.instanceName.includes('RailroadTrackIntegrated');
    const otherIsIntegrated = anchorPort._owner?.integrated || otherComp.instanceName.includes('RailroadTrackIntegrated');
    if (myIsIntegrated && myConns.length >= 1)
      throw new Error(`Integrated track port ${srcPort._portName} already connected (max 1)`);
    if (otherIsIntegrated && otherConns.length >= 1)
      throw new Error(`Integrated track port ${anchorPort._portName} already connected (max 1)`);

    // Guard 3: port connected to an integrated track → max 1 connection
    if (isConnectedToIntegrated(myConns) && myConns.length >= 1)
      throw new Error(`Port ${srcPort._portName} is connected to an integrated track (max 1 connection)`);
    if (isConnectedToIntegrated(otherConns) && otherConns.length >= 1)
      throw new Error(`Port ${anchorPort._portName} is connected to an integrated track (max 1 connection)`);

    // Guard 4: track connecting to integrated must be at least 1200 UU
    if (myIsIntegrated || otherIsIntegrated) {
      const nonIntegOwner = myIsIntegrated ? anchorPort._owner : this;
      const nonIntegIsIntegrated = myIsIntegrated ? otherIsIntegrated : myIsIntegrated;
      if (!nonIntegIsIntegrated && nonIntegOwner?._ports?.TrackConnection0 && nonIntegOwner?._ports?.TrackConnection1) {
        const p0 = nonIntegOwner._ports.TrackConnection0.worldPos();
        const p1 = nonIntegOwner._ports.TrackConnection1.worldPos();
        const len = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2);
        const MIN_STUB = 1200;
        if (len < MIN_STUB - 1)
          throw new Error(`Track connecting to integrated track must be at least ${MIN_STUB} UU (got ${Math.round(len)})`);
      }
    }

    myConns.push(ref(otherComp.instanceName));
    otherConns.push(ref(myComp.instanceName));
  }

  /**
   * Override: snap + wire for tracks. Adds direction enforcement via snapPorts
   * before wiring, so that the spline curves toward the connected track.
   */
  attachPorts(srcPort, anchorPort) {
    if (anchorPort.worldDir()) {
      this.snapPorts(srcPort, anchorPort);
    }
    this.wirePorts(srcPort, anchorPort);
  }

  /**
   * Override: connect by port names. Resolves ports and delegates to attachPorts.
   */
  connectPorts(myPortName, other, otherPortName) {
    this.attachPorts(this.port(myPortName), other.port(otherPortName));
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

    // Temporary spline — tangents aligned with span so constructor gets correct port dirs
    const spanDir = new Vector3D(dx, dy, dz);
    const spanNorm = spanDir.length > 1 ? spanDir.norm() : new Vector3D(1, 0, 0);
    entity.properties = {
      mSplineData:        wrapSplineData([
        splinePoint(new Vector3D(0, 0, 0), spanNorm, spanNorm),
        splinePoint(new Vector3D(dx, dy, dz), spanNorm, spanNorm),
      ]),
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

    const track = new RailroadTrack(entity, conn0, conn1, { integrated });
    // Now rebuild with proper dirs via makeSpline(portFrom, portTo)
    track.rebuildSpline(fromPos, from?.dir || null, toPos, to?.dir || null);
    return track;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const conn0 = findComp(saveObjects, `${inst}.TrackConnection0`);
    const conn1 = findComp(saveObjects, `${inst}.TrackConnection1`);
    const integrated = entity.typePath.includes('Integrated');
    const track = new RailroadTrack(entity, conn0, conn1, { integrated });
    if (entity.properties.mSplineData) {
      track._snappedPorts = new Set([RailroadTrack.Ports.START, RailroadTrack.Ports.END]);
    }
    return track;
  }
}

RailroadTrack.Ports       = { START: 'TrackConnection0', END: 'TrackConnection1' };
RailroadTrack.TYPE_PATH   = TYPE_PATH;
RailroadTrack.TYPE_INTEGRATED = TYPE_INTEGRATED;

RailroadTrack.getPorts = function(entity) {
  return SplineBuilder._splinePorts(entity, ['TrackConnection0', 'TrackConnection1'], 'track');
};

module.exports = RailroadTrack;
