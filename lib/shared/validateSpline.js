const SplineBuilder = require('./SplineBuilder');
const { sampleHermiteSpline } = require('./hermite');
const Vector3D = require('./Vector3D');
const splineLimits = require('../../data/splineLimits.json');

const GUARD_DIST = 100; // 2 × PORT_TANGENT

function validateSplineLength(type, length) {
  const limits = splineLimits[type];
  if (!limits) return;
  if (length < limits.min)
    throw new Error(`${type} too short: ${Math.round(length)} UU (min ${limits.min})`);
  if (length > limits.max)
    throw new Error(`${type} too long: ${Math.round(length)} UU (max ${limits.max})`);
}

function validateSplineShape(entity, portFrom, portTo) {
  const type = portFrom.portType;
  const pts = SplineBuilder._parseSplinePoints(entity);
  if (!pts || pts.length < 2) return;

  // U-turn check — skip for tracks (they can make 90° turns; min radius constraint suffices)
  const wSrcDir = portFrom.localDir();  // identity rotation → local = world
  const wDstDir = portTo.localDir();
  if (type !== 'track' && wSrcDir && wDstDir) {
    const p0 = pts[0], pN = pts[pts.length - 1];
    const span = new Vector3D(pN.x - p0.x, pN.y - p0.y, 0);
    const spanXY = span.length;
    if (spanXY > 1e-6) {
      const sn = { x: span.x / spanXY, y: span.y / spanXY };
      // All port dirs are outward: src outward opposes span (cosSrc ≈ -1),
      // dst outward aligns with span (cosDst ≈ +1). Same for belt/pipe/track.
      const cosSrc = wSrcDir.x * sn.x + wSrcDir.y * sn.y;
      const cosDst = wDstDir.x * sn.x + wDstDir.y * sn.y;
      if (cosSrc > 0.5 || cosDst < -0.5) {
        throw new Error(`${type} would require U-turn`);
      }
    }
  }

  const limits = splineLimits[type];
  if (!limits || (!limits.minRadiusXY && !limits.maxSlopeDeg)) return;

  const sampled = sampleHermiteSpline(pts, 100);
  const t = entity.transform.translation;
  const r = entity.transform.rotation;
  const world = sampled.map(p => new Vector3D(p).rotate(r).add(new Vector3D(t)));

  // Skip guard sections (GUARD_DIST from each end) for curvature/slope checks
  let guardSamples = 0;
  let cumLen = 0;
  for (let i = 1; i < world.length; i++) {
    cumLen += world[i].sub(world[i - 1]).length;
    if (cumLen >= GUARD_DIST) { guardSamples = i; break; }
  }
  let totalLen = cumLen;
  for (let i = guardSamples + 1; i < world.length; i++) totalLen += world[i].sub(world[i - 1]).length;
  let endGuardStart = world.length - 1;
  cumLen = 0;
  for (let i = world.length - 1; i > 0; i--) {
    cumLen += world[i].sub(world[i - 1]).length;
    if (cumLen >= GUARD_DIST) { endGuardStart = i; break; }
  }
  const iStart = guardSamples;
  const iEnd = endGuardStart;

  // Min curvature radius in XY plane (excluding guards)
  if (limits.minRadiusXY) {
    let minR = Infinity;
    for (let i = Math.max(1, iStart); i < Math.min(world.length - 1, iEnd); i++) {
      const v1x = world[i].x - world[i - 1].x, v1y = world[i].y - world[i - 1].y;
      const v2x = world[i + 1].x - world[i].x, v2y = world[i + 1].y - world[i].y;
      const l1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const l2 = Math.sqrt(v2x * v2x + v2y * v2y);
      if (l1 < 1e-6 || l2 < 1e-6) continue;
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > 1e-10) {
        const rv = (l1 + l2) / 2 / angle;
        if (rv < minR) minR = rv;
      }
    }
    if (minR < limits.minRadiusXY) {
      throw new Error(`${type} curvature too tight: radius ${Math.round(minR)} UU (min ${limits.minRadiusXY})`);
    }
  }

  // Max slope (excluding guards)
  if (limits.maxSlopeDeg) {
    const maxTan = Math.tan(limits.maxSlopeDeg * Math.PI / 180);
    for (let i = Math.max(1, iStart); i <= iEnd; i++) {
      const dx = world[i].x - world[i - 1].x, dy = world[i].y - world[i - 1].y;
      const dz = world[i].z - world[i - 1].z;
      const hDist = Math.sqrt(dx * dx + dy * dy);
      if (hDist > 1e-6 && Math.abs(dz) / hDist > maxTan) {
        const slopeDeg = Math.atan(Math.abs(dz) / hDist) * 180 / Math.PI;
        throw new Error(`${type} slope too steep: ${slopeDeg.toFixed(1)}° (max ${limits.maxSlopeDeg}°)`);
      }
    }
  }
}

module.exports = { validateSplineShape, validateSplineLength };
