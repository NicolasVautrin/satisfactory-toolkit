const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent,
  splinePoint, wrapSplineData,
  nextId, findComp,
  Vector3D,
} = require('../../satisfactoryLib');

const TYPE_PATH       = '/Game/FactoryGame/Buildable/Factory/Train/Track/Build_RailroadTrack.Build_RailroadTrack_C';
const TYPE_INTEGRATED = '/Game/FactoryGame/Buildable/Factory/Train/Track/Build_RailroadTrackIntegrated.Build_RailroadTrackIntegrated_C';
const RECIPE          = '/Game/FactoryGame/Recipes/Buildings/Recipe_RailroadTrack.Recipe_RailroadTrack_C';
const RECIPE_INTEG    = '/Game/FactoryGame/Recipes/Buildings/Recipe_RailroadTrackIntegrated.Recipe_RailroadTrackIntegrated_C';

const FLAGS_TRACK_CONN = 262152;
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

class RailroadTrack {
  /**
   * @param entity    SaveEntity for the track
   * @param conn0     TrackConnection0 component (start)
   * @param conn1     TrackConnection1 component (end)
   * @param opts      { integrated: bool }
   */
  constructor(entity, conn0, conn1, opts = {}) {
    this.entity     = entity;
    this.inst       = entity.instanceName;
    this.integrated = opts.integrated || false;
    this.components = [conn0, conn1];

    this._rebuildPorts(conn0, conn1);
  }

  _rebuildPorts(conn0, conn1) {
    conn0 = conn0 || this.components[0];
    conn1 = conn1 || this.components[1];
    const { translation } = this.entity.transform;

    // Extract positions and directions from spline endpoints
    const spline = this.entity.properties?.mSplineData?.values;
    let pos0 = new Vector3D(translation);
    let pos1 = new Vector3D(translation);
    let dir0 = null, dir1 = null;

    if (spline && spline.length >= 2) {
      const sp0 = spline[0].value?.properties;
      const spN = spline[spline.length - 1].value?.properties;

      if (sp0?.Location?.value) {
        pos0 = new Vector3D(translation).add(sp0.Location.value);
      }
      if (spN?.Location?.value) {
        pos1 = new Vector3D(translation).add(spN.Location.value);
      }
      // Direction from tangents: LeaveTangent at start, ArriveTangent at end
      if (sp0?.LeaveTangent?.value) {
        dir0 = new Vector3D(sp0.LeaveTangent.value).norm();
      }
      if (spN?.ArriveTangent?.value) {
        dir1 = new Vector3D(spN.ArriveTangent.value).norm();
      }
    }

    const p0 = new FlowPort(conn0, pos0, dir0);
    p0.flowType = null;  // track connections are bidirectional
    p0.portType = PortType.TRACK;
    p0._portName = 'TrackConnection0';
    p0._owner = this;

    const p1 = new FlowPort(conn1, pos1, dir1);
    p1.flowType = null;
    p1.portType = PortType.TRACK;
    p1._portName = 'TrackConnection1';
    p1._owner = this;

    this._ports = {
      TrackConnection0: p0,
      TrackConnection1: p1,
    };
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`RailroadTrack ${this.inst}: unknown port "${name}"`);
    return p;
  }

  onPortSnapped() {
    const p0 = this._ports[RailroadTrack.Ports.START];
    const p1 = this._ports[RailroadTrack.Ports.END];
    const startPos = p0.pos;
    const endPos = p1.pos;
    this.entity.transform.translation = { ...startPos };
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = endPos.z - startPos.z;
    this.entity.properties.mSplineData = makeRailSpline(dx, dy, dz, p0.dir, p1.dir);
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  /**
   * Connect this track's endpoint to another track's endpoint.
   * Railroad connections use mConnectedComponents (array, can have multiple for switches).
   * @param portName   'TrackConnection0' or 'TrackConnection1'
   * @param other      Another RailroadTrack
   * @param otherPort  Port name on the other track
   */
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

    myComp.properties.mConnectedComponents.values.push(ref(otherComp.instanceName));
    otherComp.properties.mConnectedComponents.values.push(ref(myComp.instanceName));
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

module.exports = RailroadTrack;
