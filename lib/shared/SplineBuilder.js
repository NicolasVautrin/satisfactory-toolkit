const Builder = require('./Builder');
const Vector3D = require('./Vector3D');
const { sampleHermiteSpline } = require('./hermite');

/**
 * Base class for spline entities with 2 endpoints: ConveyorBelt, Pipe, RailroadTrack.
 *
 * isSnappable: always true (spline builders can always reposition).
 * snapPorts: negate anchor dir (opposition), update port positions, rebuild spline.
 * snapToPos: same but from a free position (no anchor port).
 * Validates shape when both ports have been snapped.
 */
class SplineBuilder extends Builder {
  isSnappable(srcPort, anchorPort) {
    return true;
  }

  /**
   * Snap srcPort onto anchorPort. Rebuilds spline after each snap.
   * Validates shape only when both endpoints have been snapped.
   */
  snapPorts(srcPort, anchorPort) {
    super.snapPorts(srcPort, anchorPort);
    const wPos = anchorPort.worldPos();
    const wDir = anchorPort.worldDir();
    this._applySnap(srcPort, wPos, wDir);
  }

  /**
   * Snap srcPort to a free world position (no anchor port).
   */
  snapToPos(srcPort, pos, dir) {
    this._applySnap(srcPort, pos, dir);
  }

  /**
   * Rebuild spline from current port _pos/_dir (no snap, no validation).
   * Called by insertBelt/insertPipe after manually setting port positions.
   */
  rebuildSpline() {
    this._applySnap(null, null, null);
  }

  /**
   * Internal: update port positions/dirs and rebuild spline.
   * Uses this.constructor.Ports to resolve port names generically.
   */
  _applySnap(snappedPort, wPos, wDir) {
    const portNames = Object.values(this.constructor.Ports);
    const port0 = this._ports[portNames[0]];
    const port1 = this._ports[portNames[portNames.length - 1]];

    let wP0Pos, wP0Dir, wP1Pos, wP1Dir;
    if (!snappedPort) {
      // No-args: _pos/_dir are world-space (set by caller, e.g. insertBelt/insertPipe)
      wP0Pos = port0._pos;
      wP0Dir = port0._dir;
      wP1Pos = port1._pos;
      wP1Dir = port1._dir;
    } else if (snappedPort === port0) {
      wP0Pos = wPos;
      wP0Dir = wDir ? { x: -wDir.x, y: -wDir.y, z: -(wDir.z||0) } : port0.worldDir();
      wP1Pos = port1.worldPos();
      wP1Dir = port1.worldDir();
    } else {
      wP1Pos = wPos;
      wP1Dir = wDir ? { x: -wDir.x, y: -wDir.y, z: -(wDir.z||0) } : port1.worldDir();
      wP0Pos = port0.worldPos();
      wP0Dir = port0.worldDir();
    }

    this.entity.transform.translation = { ...wP0Pos };
    this.entity.transform.rotation = { x: 0, y: 0, z: 0, w: 1 };
    const dx = wP1Pos.x - wP0Pos.x;
    const dy = wP1Pos.y - wP0Pos.y;
    const dz = (wP1Pos.z || 0) - (wP0Pos.z || 0);

    port0._pos = { x: 0, y: 0, z: 0 };
    port0._dir = wP0Dir;
    port1._pos = { x: dx, y: dy, z: dz };
    port1._dir = wP1Dir;

    if (snappedPort) {
      if (!this._snappedPorts) this._snappedPorts = new Set();
      this._snappedPorts.add(snappedPort._portName);
    }

    this._buildSpline(port0, port1);
  }

  /**
   * Build spline and validate. Overridable by subclasses (e.g. RailroadTrack
   * defers until both endpoints are snapped).
   */
  _buildSpline(port0, port1) {
    const { makeSpline } = require('../../satisfactoryLib');
    this.entity.properties.mSplineData = makeSpline(port0, port1);

    if (this._snappedPorts && this._snappedPorts.size >= 2) {
      const { validateSplineShape } = require('./validateSpline');
      validateSplineShape(this.entity, port0, port1);
    }
  }
}

SplineBuilder.IS_SPLINE = true;

// ── Static spline helpers (inspection, not editing) ─────────────────

/**
 * Parse mSplineData from entity properties into control points.
 * @returns {Array<{x,y,z, ax,ay,az, lx,ly,lz}>|null}
 */
SplineBuilder._parseSplinePoints = function(entity) {
  const splineData = entity.properties?.mSplineData;
  const values = splineData?.values;
  if (!values || values.length < 2) return null;

  const points = [];
  for (const pt of values) {
    const props = pt.value?.properties || pt.properties;
    if (!props) continue;
    const loc = props.Location?.value || props.Location;
    const arrive = props.ArriveTangent?.value || props.ArriveTangent;
    const leave = props.LeaveTangent?.value || props.LeaveTangent;
    if (!loc) continue;
    points.push({
      x: loc.x, y: loc.y, z: loc.z,
      ax: arrive?.x || 0, ay: arrive?.y || 0, az: arrive?.z || 0,
      lx: leave?.x || 0, ly: leave?.y || 0, lz: leave?.z || 0,
    });
  }
  return points.length >= 2 ? points : null;
};

/**
 * Compute spline-based ports and length for a spline entity.
 * @param {object} entity       SaveEntity
 * @param {string[]} portNames  [startPortName, endPortName]
 * @param {string} portType     'belt', 'pipe', or 'track'
 * @returns {{ ports, splineLength }|null}
 */
SplineBuilder._splinePorts = function(entity, portNames, portType) {
  const points = SplineBuilder._parseSplinePoints(entity);
  if (!points) return null;

  const t = entity.transform.translation;
  const r = entity.transform.rotation;

  const sampled = sampleHermiteSpline(points, 6);
  const worldPts = sampled.map(p => new Vector3D(p).rotate(r).add(new Vector3D(t)));

  let splineLength = 0;
  for (let i = 0; i < worldPts.length - 1; i++) {
    splineLength += worldPts[i + 1].sub(worldPts[i]).length;
  }
  splineLength = Math.round(splineLength * 10) / 10;

  const first = worldPts[0];
  const last = worldPts[worldPts.length - 1];

  const p0 = points[0];
  const pN = points[points.length - 1];
  const dir0 = new Vector3D(p0.lx, p0.ly, p0.lz).rotate(r);
  const dirN = new Vector3D(pN.lx, pN.ly, pN.lz).rotate(r);
  let dir0n = dir0.length > 0 ? dir0.norm() : null;
  const dirNn = dirN.length > 0 ? dirN.norm() : null;
  // LeaveTangent at P0 points in travel direction (inward) — negate for outward convention
  if (dir0n) dir0n = dir0n.scale(-1);

  return {
    ports: [
      { name: portNames[0], pos: first, dir: dir0n, flow: 'input', type: portType },
      { name: portNames[1], pos: last, dir: dirNn, flow: 'output', type: portType },
    ],
    splineLength,
  };
};

module.exports = SplineBuilder;
