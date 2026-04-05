#!/usr/bin/env node
/**
 * CLI tool to plan a valid railway path between two transforms.
 * Takes start/end positions + rotations, outputs track segments that pass validation.
 *
 * Usage:
 *   node tools/planTrackPath.js --from "0,26000,0" --fromRot 270 --to "8000,26000,0" --toRot 90
 *   node tools/planTrackPath.js --from "0,0,0" --fromDir "0,1,0" --to "4000,4000,0" --toDir "1,0,0"
 *   node tools/planTrackPath.js --from "0,0,0" --fromRot 270 --to "0,20000,0" --toRot 270   # straight, auto-split
 *
 * Output: summary table + JSON segments ready for editEntities connections.
 */

const splineLimits = require('../data/splineLimits.json');
const { sampleHermiteSpline } = require('../lib/shared/hermite');
const Vector3D = require('../lib/shared/Vector3D');

const limits = splineLimits.track;
const TANGENT_SCALE = 0.6;

// ── Direction helpers ──────────────────────────────────────────────
function yawToDir(yawDeg) {
  const rad = yawDeg * Math.PI / 180;
  return { x: -Math.cos(rad), y: -Math.sin(rad), z: 0 };
}

function dirToYaw(dir) {
  const yaw = Math.atan2(-dir.y, -dir.x) * 180 / Math.PI;
  return Math.round(((yaw % 360) + 360) % 360);
}

// ── Segment validation ─────────────────────────────────────────────
function validateSegment(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = (to.z || 0) - (from.z || 0);
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < limits.min || dist > limits.max) {
    return { pass: false, dist: Math.round(dist), minRadius: Infinity, maxSlope: 0, reason: `length ${Math.round(dist)} outside [${limits.min}, ${limits.max}]` };
  }

  const end = new Vector3D(dx, dy, dz);
  const len = end.length;
  const straight = len > 1 ? end.norm() : new Vector3D(1, 0, 0);
  // Dirs are outward port directions. Negate dirIn for LeaveTangent (needs inward).
  const dirIn = from.dir ? new Vector3D(from.dir).norm().scale(-1) : straight;
  const dirOut = to.dir ? new Vector3D(to.dir).norm() : straight;
  const tScale = len * TANGENT_SCALE;

  const splineData = [
    { x: 0, y: 0, z: 0, ax: dirIn.x * tScale, ay: dirIn.y * tScale, az: dirIn.z * tScale, lx: dirIn.x * tScale, ly: dirIn.y * tScale, lz: dirIn.z * tScale },
    { x: dx, y: dy, z: dz, ax: dirOut.x * tScale, ay: dirOut.y * tScale, az: dirOut.z * tScale, lx: dirOut.x * tScale, ly: dirOut.y * tScale, lz: dirOut.z * tScale },
  ];

  const sampled = sampleHermiteSpline(splineData, 100);

  // Min curvature radius XY (excluding 100 UU guards at each end)
  const GUARD = 100;
  let cumLen = 0, guardStart = 0;
  for (let i = 1; i < sampled.length; i++) {
    cumLen += new Vector3D(sampled[i]).sub(new Vector3D(sampled[i - 1])).length;
    if (cumLen >= GUARD) { guardStart = i; break; }
  }
  let guardEnd = sampled.length - 1;
  cumLen = 0;
  for (let i = sampled.length - 1; i > 0; i--) {
    cumLen += new Vector3D(sampled[i]).sub(new Vector3D(sampled[i - 1])).length;
    if (cumLen >= GUARD) { guardEnd = i; break; }
  }

  let minR = Infinity;
  for (let i = Math.max(1, guardStart); i < Math.min(sampled.length - 1, guardEnd); i++) {
    const v1x = sampled[i].x - sampled[i - 1].x, v1y = sampled[i].y - sampled[i - 1].y;
    const v2x = sampled[i + 1].x - sampled[i].x, v2y = sampled[i + 1].y - sampled[i].y;
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

  let maxSlope = 0;
  for (let i = Math.max(1, guardStart); i <= guardEnd; i++) {
    const ddx = sampled[i].x - sampled[i - 1].x, ddy = sampled[i].y - sampled[i - 1].y;
    const ddz = sampled[i].z - sampled[i - 1].z;
    const hDist = Math.sqrt(ddx * ddx + ddy * ddy);
    if (hDist > 1e-6) {
      const slope = Math.atan(Math.abs(ddz) / hDist) * 180 / Math.PI;
      if (slope > maxSlope) maxSlope = slope;
    }
  }

  const radiusOk = !limits.minRadiusXY || minR >= limits.minRadiusXY;
  const slopeOk = !limits.maxSlopeDeg || maxSlope <= limits.maxSlopeDeg;
  const pass = radiusOk && slopeOk;

  return {
    pass,
    dist: Math.round(dist),
    minRadius: minR === Infinity ? Infinity : Math.round(minR),
    maxSlope: Math.round(maxSlope * 10) / 10,
    reason: !radiusOk ? `radius ${Math.round(minR)} < ${limits.minRadiusXY}` : !slopeOk ? `slope ${maxSlope.toFixed(1)} > ${limits.maxSlopeDeg}` : null,
  };
}

// ── Bezier path planning ───────────────────────────────────────────
function sampleBezier(P0, C0, C1, P1, n) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * P0.x + 3 * u * u * t * C0.x + 3 * u * t * t * C1.x + t * t * t * P1.x;
    const y = u * u * u * P0.y + 3 * u * u * t * C0.y + 3 * u * t * t * C1.y + t * t * t * P1.y;
    const z = u * u * u * P0.z + 3 * u * u * t * C0.z + 3 * u * t * t * C1.z + t * t * t * P1.z;
    // Tangent = derivative of Bezier
    const tx = 3 * (u * u * (C0.x - P0.x) + 2 * u * t * (C1.x - C0.x) + t * t * (P1.x - C1.x));
    const ty = 3 * (u * u * (C0.y - P0.y) + 2 * u * t * (C1.y - C0.y) + t * t * (P1.y - C1.y));
    const tz = 3 * (u * u * (C0.z - P0.z) + 2 * u * t * (C1.z - C0.z) + t * t * (P1.z - C1.z));
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    points.push({
      x: Math.round(x), y: Math.round(y), z: Math.round(z),
      dir: tLen > 1e-6 ? { x: tx / tLen, y: ty / tLen, z: tz / tLen } : null,
    });
  }
  return points;
}

function planPath(start, end) {
  // Try 1 segment directly
  const direct = validateSegment(start, end);
  if (direct.pass) {
    return { segments: [{ from: start, to: end, ...direct }] };
  }

  const dist = Math.sqrt(
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2 + ((end.z || 0) - (start.z || 0)) ** 2,
  );

  // Determine min segments needed from distance alone
  const minSegFromDist = Math.ceil(dist / limits.max);

  // Bezier planning: try increasing segment counts and arm ratios
  for (let nSeg = Math.max(2, minSegFromDist); nSeg <= 8; nSeg++) {
    // Arm ratio range: start small (tighter curve) and grow (wider curve)
    for (let armRatio = 0.2; armRatio <= 3.0; armRatio += 0.05) {
      const arm = dist * armRatio;
      // Convert outward port dirs to travel dirs for Bezier: negate TC0, keep TC1
      const sd = { x: -start.dir.x, y: -start.dir.y, z: -(start.dir.z || 0) };
      const ed = end.dir;
      const C0 = { x: start.x + sd.x * arm, y: start.y + sd.y * arm, z: (start.z || 0) + (sd.z || 0) * arm };
      const C1 = { x: end.x - ed.x * arm, y: end.y - ed.y * arm, z: (end.z || 0) - (ed.z || 0) * arm };

      const waypoints = sampleBezier(
        { x: start.x, y: start.y, z: start.z || 0 },
        C0, C1,
        { x: end.x, y: end.y, z: end.z || 0 },
        nSeg,
      );

      let allValid = true;
      const segments = [];
      for (let i = 0; i < nSeg; i++) {
        const fp = waypoints[i], tp = waypoints[i + 1];
        // Bezier tangents are travel dirs. Convert to outward: negate for TC0 (from), keep for TC1 (to).
        const fromDir = i === 0 ? start.dir : (fp.dir ? { x: -fp.dir.x, y: -fp.dir.y, z: -fp.dir.z } : null);
        const toDir = i === nSeg - 1 ? end.dir : tp.dir;
        const fromPt = { x: fp.x, y: fp.y, z: fp.z, dir: fromDir };
        const toPt = { x: tp.x, y: tp.y, z: tp.z, dir: toDir };
        const result = validateSegment(fromPt, toPt);
        if (!result.pass) { allValid = false; break; }
        segments.push({ from: fromPt, to: toPt, ...result });
      }

      if (allValid) return { segments, armRatio, nSeg };
    }
  }

  return null;
}

// ── CLI ────────────────────────────────────────────────────────────
function parseVec(str) {
  if (!str) return null;
  const [x, y, z] = str.split(',').map(Number);
  return { x, y, z: z || 0 };
}

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const from = parseVec(arg('from'));
const to = parseVec(arg('to'));
let fromDir = parseVec(arg('fromDir'));
let toDir = parseVec(arg('toDir'));

if (!fromDir && arg('fromRot') !== null) fromDir = yawToDir(parseFloat(arg('fromRot')));
if (!toDir && arg('toRot') !== null) toDir = yawToDir(parseFloat(arg('toRot')));

if (!from || !to) {
  console.error('Usage: node tools/planTrackPath.js --from "x,y,z" --to "x,y,z" [--fromRot N | --fromDir "x,y,z"] [--toRot N | --toDir "x,y,z"]');
  process.exit(1);
}

// Default dirs: straight line direction
if (!fromDir && !toDir) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = (to.z || 0) - (from.z || 0);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len > 1e-6) {
    fromDir = { x: dx / len, y: dy / len, z: dz / len };
    toDir = { x: dx / len, y: dy / len, z: dz / len };
  }
}
if (!fromDir) fromDir = { x: 1, y: 0, z: 0 };
if (!toDir) toDir = { x: 1, y: 0, z: 0 };

const start = { x: from.x, y: from.y, z: from.z || 0, dir: fromDir };
const end = { x: to.x, y: to.y, z: to.z || 0, dir: toDir };

const result = planPath(start, end);

if (!result) {
  console.error('\nFailed to find valid track path.\n');
  process.exit(1);
}

// ── Output ─────────────────────────────────────────────────────────
const totalLen = result.segments.reduce((s, seg) => s + seg.dist, 0);
console.log(`\nTrack path: ${result.segments.length} segment${result.segments.length > 1 ? 's' : ''}, total ${totalLen} UU\n`);

console.log('  #  From                          To                            Length  Radius  Slope');
console.log('  ─  ────────────────────────────  ────────────────────────────  ──────  ──────  ─────');
for (let i = 0; i < result.segments.length; i++) {
  const seg = result.segments[i];
  const fRot = dirToYaw(seg.from.dir);
  const tRot = dirToYaw(seg.to.dir);
  const fromStr = `(${seg.from.x}, ${seg.from.y}, ${seg.from.z}) r${fRot}`;
  const toStr = `(${seg.to.x}, ${seg.to.y}, ${seg.to.z}) r${tRot}`;
  const radiusStr = seg.minRadius === Infinity ? '  Inf' : String(seg.minRadius).padStart(5);
  console.log(`  ${i + 1}  ${fromStr.padEnd(30)}${toStr.padEnd(30)}${String(seg.dist).padStart(6)}  ${radiusStr}  ${seg.maxSlope.toFixed(1)}`);
}

// JSON output for editEntities
console.log('\nJSON (for editEntities connections):');
const json = result.segments.map((seg, i) => ({
  from: { x: seg.from.x, y: seg.from.y, z: seg.from.z, rotation: dirToYaw(seg.from.dir) },
  to: { x: seg.to.x, y: seg.to.y, z: seg.to.z, rotation: dirToYaw(seg.to.dir) },
}));
console.log(JSON.stringify(json, null, 2));
console.log();
