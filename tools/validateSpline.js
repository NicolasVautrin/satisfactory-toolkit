#!/usr/bin/env node
/**
 * CLI tool to validate spline geometry (belt, pipe, track).
 * Tests length, U-turn, curvature XY, slope against splineLimits.json.
 *
 * Usage:
 *   node tools/validateSpline.js --type track --from "0,0,0" --to "2000,0,0"
 *   node tools/validateSpline.js --type track --from "0,0,0" --fromDir "-1,0,0" --to "0,6000,0" --toDir "0,1,0"
 *   node tools/validateSpline.js --type belt --from "0,0,0" --fromDir "0,1,0" --to "0,2000,0" --toDir "0,-1,0"
 */

const splineLimits = require('../data/splineLimits.json');
const { sampleHermiteSpline } = require('../lib/shared/hermite');
const Vector3D = require('../lib/shared/Vector3D');

// ── Parse CLI args ──────────────────────────────────────────────────
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

const type = arg('type') || 'track';
const from = parseVec(arg('from'));
const to = parseVec(arg('to'));
let fromDir = parseVec(arg('fromDir'));
let toDir = parseVec(arg('toDir'));

// Support --fromRot / --toRot (yaw degrees → direction = -X rotated by yaw)
function yawToDir(yawDeg) {
  const rad = yawDeg * Math.PI / 180;
  return { x: -Math.cos(rad), y: -Math.sin(rad), z: 0 };
}
if (!fromDir && arg('fromRot') !== null) fromDir = yawToDir(parseFloat(arg('fromRot')));
if (!toDir && arg('toRot') !== null) toDir = yawToDir(parseFloat(arg('toRot')));

if (!from || !to) {
  console.error('Usage: node tools/validateSpline.js --type belt|pipe|track --from "x,y,z" --to "x,y,z" [--fromDir "x,y,z"] [--toDir "x,y,z"]');
  process.exit(1);
}

// ── Build spline ────────────────────────────────────────────────────
const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

let splineData;
if (type === 'track') {
  // Rail spline: 2-point hermite (same logic as makeRailSpline in RailroadTrack.js)
  const TANGENT_SCALE = 0.6;
  const end = new Vector3D(dx, dy, dz);
  const len = end.length;
  const straight = len > 1 ? end.norm() : new Vector3D(1, 0, 0);
  const dirInN = fromDir ? new Vector3D(fromDir).norm() : straight;
  const dirOutN = toDir ? new Vector3D(toDir).norm() : straight;
  const tScale = len * TANGENT_SCALE;
  splineData = [
    { x: 0, y: 0, z: 0, ax: dirInN.x * tScale, ay: dirInN.y * tScale, az: dirInN.z * tScale, lx: dirInN.x * tScale, ly: dirInN.y * tScale, lz: dirInN.z * tScale },
    { x: dx, y: dy, z: dz, ax: dirOutN.x * tScale, ay: dirOutN.y * tScale, az: dirOutN.z * tScale, lx: dirOutN.x * tScale, ly: dirOutN.y * tScale, lz: dirOutN.z * tScale },
  ];
} else {
  // Belt / pipe: 4-point spline with guard sections
  const { makeSpline } = require('../satisfactoryLib');
  const wrapped = makeSpline(dx, dy, dz, fromDir, toDir);
  const Builder = require('../lib/shared/Builder');
  const fakeEntity = {
    properties: { mSplineData: wrapped },
    transform: { translation: from, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  };
  splineData = Builder._parseSplinePoints(fakeEntity);
}

if (!splineData || splineData.length < 2) {
  console.error('Failed to build spline');
  process.exit(1);
}

// ── Sample and validate ─────────────────────────────────────────────
const GUARD_DIST = 100;
const sampled = sampleHermiteSpline(splineData, 100);
// Transform to world (entity at from, identity rotation)
const world = sampled.map(p => ({
  x: from.x + p.x, y: from.y + p.y, z: from.z + p.z,
}));

// Total spline length
let totalLen = 0;
for (let i = 1; i < world.length; i++) {
  const d = new Vector3D(world[i]).sub(new Vector3D(world[i - 1]));
  totalLen += d.length;
}

// Guard section indices
let guardStart = 0, cumLen = 0;
for (let i = 1; i < world.length; i++) {
  cumLen += new Vector3D(world[i]).sub(new Vector3D(world[i - 1])).length;
  if (cumLen >= GUARD_DIST) { guardStart = i; break; }
}
let guardEnd = world.length - 1;
cumLen = 0;
for (let i = world.length - 1; i > 0; i--) {
  cumLen += new Vector3D(world[i]).sub(new Vector3D(world[i - 1])).length;
  if (cumLen >= GUARD_DIST) { guardEnd = i; break; }
}

// U-turn check
let uTurnResult = 'SKIP (no dirs)';
if (fromDir && toDir) {
  const span = new Vector3D(dx, dy, 0);
  const spanXY = span.length;
  if (spanXY > 1e-6) {
    const sn = { x: span.x / spanXY, y: span.y / spanXY };
    const cosSrc = fromDir.x * sn.x + fromDir.y * sn.y;
    const cosDst = toDir.x * sn.x + toDir.y * sn.y;
    const uTurnFail = type === 'track'
      ? (cosSrc < -0.5 || cosDst < -0.5)
      : (cosSrc < -0.5 || cosDst > 0.5);
    if (uTurnFail) {
      uTurnResult = `FAIL (cosSrc=${cosSrc.toFixed(3)}, cosDst=${cosDst.toFixed(3)})`;
    } else {
      uTurnResult = `OK (cosSrc=${cosSrc.toFixed(3)}, cosDst=${cosDst.toFixed(3)})`;
    }
  }
}

// Min curvature radius XY (excluding guards)
let minR = Infinity;
for (let i = Math.max(1, guardStart); i < Math.min(world.length - 1, guardEnd); i++) {
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

// Max slope (excluding guards)
let maxSlope = 0;
for (let i = Math.max(1, guardStart); i <= guardEnd; i++) {
  const ddx = world[i].x - world[i - 1].x, ddy = world[i].y - world[i - 1].y;
  const ddz = world[i].z - world[i - 1].z;
  const hDist = Math.sqrt(ddx * ddx + ddy * ddy);
  if (hDist > 1e-6) {
    const slope = Math.atan(Math.abs(ddz) / hDist) * 180 / Math.PI;
    if (slope > maxSlope) maxSlope = slope;
  }
}

// ── Validate against limits ─────────────────────────────────────────
const limits = splineLimits[type] || {};
const results = [];

const lenOk = dist >= (limits.min || 0) && dist <= (limits.max || Infinity);
results.push({ check: 'Length', value: `${Math.round(dist)} UU`, limit: `${limits.min || '-'}-${limits.max || '-'}`, status: lenOk ? 'OK' : 'FAIL' });

results.push({ check: 'U-turn', value: uTurnResult, limit: 'cosSrc>-0.5, cosDst<0.5', status: uTurnResult.startsWith('OK') || uTurnResult.startsWith('SKIP') ? 'OK' : 'FAIL' });

if (limits.minRadiusXY) {
  const curveOk = minR >= limits.minRadiusXY;
  results.push({ check: 'Min radius XY', value: `${minR === Infinity ? 'Inf' : Math.round(minR)} UU`, limit: `>=${limits.minRadiusXY}`, status: curveOk ? 'OK' : 'FAIL' });
}

if (limits.maxSlopeDeg) {
  const slopeOk = maxSlope <= limits.maxSlopeDeg;
  results.push({ check: 'Max slope', value: `${maxSlope.toFixed(1)} deg`, limit: `<=${limits.maxSlopeDeg} deg`, status: slopeOk ? 'OK' : 'FAIL' });
}

// ── Output ──────────────────────────────────────────────────────────
console.log(`\nSpline validation: ${type}`);
console.log(`  From: (${from.x}, ${from.y}, ${from.z})${fromDir ? ` dir (${fromDir.x}, ${fromDir.y}, ${fromDir.z})` : ''}`);
console.log(`  To:   (${to.x}, ${to.y}, ${to.z})${toDir ? ` dir (${toDir.x}, ${toDir.y}, ${toDir.z})` : ''}`);
console.log(`  Spline length: ${Math.round(totalLen)} UU (straight: ${Math.round(dist)} UU)\n`);
console.log('  Check           Value                    Limit              Status');
console.log('  ──────────────  ───────────────────────  ─────────────────  ──────');
for (const r of results) {
  console.log(`  ${r.check.padEnd(16)}${r.value.toString().padEnd(25)}${r.limit.toString().padEnd(19)}${r.status}`);
}

const allOk = results.every(r => r.status === 'OK');
console.log(`\n  Result: ${allOk ? 'PASS' : 'FAIL'}\n`);
process.exit(allOk ? 0 : 1);
