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
const TANGENT_SCALE = 1.17;

// ── Direction helpers ──────────────────────────────────────────────
function yawToDir(yawDeg) {
  const rad = yawDeg * Math.PI / 180;
  return { x: Math.cos(rad), y: Math.sin(rad), z: 0 };
}

function dirToYaw(dir) {
  const yaw = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
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

  const RADIUS_MARGIN = 1.05; // 5% margin for snap adjustments
  const radiusOk = !limits.minRadiusXY || minR >= limits.minRadiusXY * RADIUS_MARGIN;
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
    for (let armRatio = 0.2; armRatio <= 10.0; armRatio += 0.05) {
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

// ── U-turn planning (intermediate waypoint optimization) ─────────
// When start/end tangents oppose (dot < -0.5), insert a waypoint perpendicular
// to the span and binary-search on its distance until both halves validate.

function planUTurn(start, end) {
  // Check if this is a U-turn: travel dirs roughly opposing
  const travelStart = { x: -start.dir.x, y: -start.dir.y }; // -outward = travel
  const travelEnd = { x: end.dir.x, y: end.dir.y };          // outward = travel (TC1)
  const dot = travelStart.x * travelEnd.x + travelStart.y * travelEnd.y;
  if (dot > -0.5) return null; // not a U-turn

  const spanX = end.x - start.x, spanY = end.y - start.y;
  const spanLen = Math.sqrt(spanX * spanX + spanY * spanY);
  if (spanLen < 1) return null;

  // Perpendicular to span (unit), pointing to the "outside" of the turn
  // Use cross product of travel direction × span to determine side
  const cross = travelStart.x * spanY - travelStart.y * spanX;
  const side = cross >= 0 ? 1 : -1;
  const perpX = -spanY / spanLen * side;
  const perpY = spanX / spanLen * side;

  // Midpoint of span
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const midZ = ((start.z || 0) + (end.z || 0)) / 2;

  // Direction at the apex: perpendicular to the perp = along the span
  // Travel at apex goes from start-side to end-side (along span direction)
  const apexTravelX = spanX / spanLen, apexTravelY = spanY / spanLen;
  // Outward for TC1 of seg1 = travel at apex
  const apexDirTC1 = { x: apexTravelX, y: apexTravelY, z: 0 };
  // Outward for TC0 of seg2 = -travel at apex (opposing)
  const apexDirTC0 = { x: -apexTravelX, y: -apexTravelY, z: 0 };

  // Binary search on distance d
  let lo = spanLen * 0.5, hi = spanLen * 20;
  let bestResult = null;

  for (let iter = 0; iter < 40; iter++) {
    const d = (lo + hi) / 2;
    const wx = midX + perpX * d;
    const wy = midY + perpY * d;
    const wz = midZ;

    const seg1From = { x: start.x, y: start.y, z: start.z || 0, dir: start.dir };
    const seg1To = { x: Math.round(wx), y: Math.round(wy), z: Math.round(wz), dir: apexDirTC1 };
    const seg2From = { x: Math.round(wx), y: Math.round(wy), z: Math.round(wz), dir: apexDirTC0 };
    const seg2To = { x: end.x, y: end.y, z: end.z || 0, dir: end.dir };

    // Each half might itself need planPath (multi-segment)
    const r1 = planPath(seg1From, seg1To);
    const r2 = planPath(seg2From, seg2To);

    if (r1 && r2) {
      const segments = [...r1.segments, ...r2.segments];
      if (!bestResult || segments.length < bestResult.segments.length || d < bestResult.d) {
        bestResult = { segments, d, uTurn: true };
      }
      hi = d; // try tighter
    } else {
      lo = d; // need wider
    }
  }

  return bestResult;
}

// ── Dubins path planning (Curve-Straight-Curve) ──────────────────
// Finds shortest path between two oriented points using arcs + straight line.
// Four path types: LSL, RSR (same-side tangent), LSR, RSL (cross tangent).

function mod2pi(a) { return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }

function dubinsCSC(x0, y0, th0, x1, y1, th1, R, type) {
  const lS = type[0] === 'L', lE = type[2] === 'L';
  // Circle centers: left = heading + 90°, right = heading - 90°
  const cx0 = x0 + R * Math.cos(th0 + (lS ? 1 : -1) * Math.PI / 2);
  const cy0 = y0 + R * Math.sin(th0 + (lS ? 1 : -1) * Math.PI / 2);
  const cx1 = x1 + R * Math.cos(th1 + (lE ? 1 : -1) * Math.PI / 2);
  const cy1 = y1 + R * Math.sin(th1 + (lE ? 1 : -1) * Math.PI / 2);
  const ddx = cx1 - cx0, ddy = cy1 - cy0;
  const D = Math.sqrt(ddx * ddx + ddy * ddy);
  const phi = Math.atan2(ddy, ddx);

  function tryAlpha(al) {
    const t0x = cx0 + R * Math.cos(al), t0y = cy0 + R * Math.sin(al);
    const t1x = lS === lE ? cx1 + R * Math.cos(al) : cx1 - R * Math.cos(al);
    const t1y = lS === lE ? cy1 + R * Math.sin(al) : cy1 - R * Math.sin(al);
    const sLen = Math.sqrt((t1x - t0x) ** 2 + (t1y - t0y) ** 2);
    const a0s = Math.atan2(y0 - cy0, x0 - cx0);
    const a0e = Math.atan2(t0y - cy0, t0x - cx0);
    const arc1 = lS ? mod2pi(a0e - a0s) : mod2pi(a0s - a0e);
    const a1s = Math.atan2(t1y - cy1, t1x - cx1);
    const a1e = Math.atan2(y1 - cy1, x1 - cx1);
    const arc2 = lE ? mod2pi(a1e - a1s) : mod2pi(a1s - a1e);
    return { length: R * arc1 + sLen + R * arc2, arc1, arc2, sLen, cx0, cy0, cx1, cy1, t0: { x: t0x, y: t0y }, t1: { x: t1x, y: t1y }, lS, lE, a0s, a1s };
  }

  if (lS === lE) {
    // Same-side (outer) tangent: two solutions
    const p1 = tryAlpha(phi + Math.PI / 2), p2 = tryAlpha(phi - Math.PI / 2);
    return p1.length < p2.length ? p1 : p2;
  }
  // Cross (inner) tangent: requires D ≥ 2R
  if (D < 2 * R - 1e-6) return null;
  const a = Math.acos(Math.min(1, 2 * R / D));
  const p1 = tryAlpha(phi - a), p2 = tryAlpha(phi + a);
  return p1.length < p2.length ? p1 : p2;
}

function sampleDubinsWaypoints(path, R, nSeg, z0, z1) {
  const { arc1, arc2, sLen, cx0, cy0, cx1, cy1, lS, lE, a0s, a1s } = path;
  const arc1L = R * arc1, arc2L = R * arc2, total = arc1L + sLen + arc2L;
  const wps = [];
  for (let i = 0; i <= nSeg; i++) {
    const d = total * i / nSeg;
    let x, y, heading;
    if (d <= arc1L + 1e-6) {
      const f = arc1L > 1e-6 ? Math.min(d / arc1L, 1) : 0;
      const ang = lS ? a0s + f * arc1 : a0s - f * arc1;
      x = cx0 + R * Math.cos(ang); y = cy0 + R * Math.sin(ang);
      heading = lS ? ang + Math.PI / 2 : ang - Math.PI / 2;
    } else if (d <= arc1L + sLen + 1e-6) {
      const f = sLen > 1e-6 ? (d - arc1L) / sLen : 0;
      x = path.t0.x + f * (path.t1.x - path.t0.x);
      y = path.t0.y + f * (path.t1.y - path.t0.y);
      heading = Math.atan2(path.t1.y - path.t0.y, path.t1.x - path.t0.x);
    } else {
      const f = arc2L > 1e-6 ? Math.min((d - arc1L - sLen) / arc2L, 1) : 0;
      const ang = lE ? a1s + f * arc2 : a1s - f * arc2;
      x = cx1 + R * Math.cos(ang); y = cy1 + R * Math.sin(ang);
      heading = lE ? ang + Math.PI / 2 : ang - Math.PI / 2;
    }
    wps.push({ x, y, z: z0 + (z1 - z0) * d / total, heading });
  }
  return wps;
}

function planDubins(start, end) {
  const th0 = Math.atan2(-start.dir.y, -start.dir.x); // travel = -outward (TC0)
  const th1 = Math.atan2(end.dir.y, end.dir.x);        // travel = +outward (TC1)
  const z0 = start.z || 0, z1 = end.z || 0;

  // Try increasing planning radii (above validation min 900 for Hermite margin)
  for (const R of [1600, 2000, 2500, 3000, 4000, 5000, 6000, 8000]) {
    const paths = ['LSL', 'RSR', 'LSR', 'RSL']
      .map(type => { const p = dubinsCSC(start.x, start.y, th0, end.x, end.y, th1, R, type); return p ? { ...p, type } : null; })
      .filter(Boolean)
      .sort((a, b) => a.length - b.length);

    for (const path of paths) {
      for (let nSeg = Math.max(1, Math.ceil(path.length / (limits.max * 0.9))); nSeg <= 10; nSeg++) {
        const wps = sampleDubinsWaypoints(path, R, nSeg, z0, z1);
        let ok = true;
        const segments = [];
        for (let i = 0; i < nSeg; i++) {
          const w0 = wps[i], w1 = wps[i + 1];
          const fromDir = i === 0 ? start.dir : { x: -Math.cos(w0.heading), y: -Math.sin(w0.heading), z: 0 };
          const toDir = i === nSeg - 1 ? end.dir : { x: Math.cos(w1.heading), y: Math.sin(w1.heading), z: 0 };
          const fp = { x: Math.round(w0.x), y: Math.round(w0.y), z: Math.round(w0.z), dir: fromDir };
          const tp = { x: Math.round(w1.x), y: Math.round(w1.y), z: Math.round(w1.z), dir: toDir };
          const v = validateSegment(fp, tp);
          if (!v.pass) { ok = false; break; }
          segments.push({ from: fp, to: tp, ...v });
        }
        if (ok) return { segments, dubinsType: path.type, dubinsR: R };
      }
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

// --fromRot / --toRot = anchor outward (virtual port outward, same as editor convention).
// Negate to get the track port outward used internally for planning.
if (!fromDir && arg('fromRot') !== null) {
  const a = yawToDir(parseFloat(arg('fromRot')));
  fromDir = { x: -a.x, y: -a.y, z: -a.z };
}
if (!toDir && arg('toRot') !== null) {
  const a = yawToDir(parseFloat(arg('toRot')));
  toDir = { x: -a.x, y: -a.y, z: -a.z };
}

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

let result = planPath(start, end);

if (!result) {
  result = planUTurn(start, end);
}

if (!result) {
  result = planDubins(start, end);
}

if (!result) {
  console.error('\nFailed to find valid track path.\n');
  process.exit(1);
}

// ── Output ─────────────────────────────────────────────────────────

// Port outward → anchor rotation (negate then convert to yaw).
// Output rotations are editor-compatible: they represent the virtual anchor port outward.
function toAnchorRot(portDir) {
  return dirToYaw({ x: -portDir.x, y: -portDir.y, z: -(portDir.z || 0) });
}

const totalLen = result.segments.reduce((s, seg) => s + seg.dist, 0);
const planner = result.dubinsType ? ` [Dubins ${result.dubinsType} R=${result.dubinsR}]` : result.armRatio ? ` [Bézier arm=${result.armRatio.toFixed(2)}]` : '';
console.log(`\nTrack path: ${result.segments.length} segment${result.segments.length > 1 ? 's' : ''}, total ${totalLen} UU${planner}\n`);

console.log('  #  From                          To                            Length  Radius  Slope');
console.log('  ─  ────────────────────────────  ────────────────────────────  ──────  ──────  ─────');
for (let i = 0; i < result.segments.length; i++) {
  const seg = result.segments[i];
  const fRot = toAnchorRot(seg.from.dir);
  const tRot = toAnchorRot(seg.to.dir);
  const fromStr = `(${seg.from.x}, ${seg.from.y}, ${seg.from.z}) r${fRot}`;
  const toStr = `(${seg.to.x}, ${seg.to.y}, ${seg.to.z}) r${tRot}`;
  const radiusStr = seg.minRadius === Infinity ? '  Inf' : String(seg.minRadius).padStart(5);
  console.log(`  ${i + 1}  ${fromStr.padEnd(30)}${toStr.padEnd(30)}${String(seg.dist).padStart(6)}  ${radiusStr}  ${seg.maxSlope.toFixed(1)}`);
}

// JSON output for editEntities
console.log('\nJSON (for editEntities connections):');
const json = result.segments.map((seg, i) => ({
  from: { x: seg.from.x, y: seg.from.y, z: seg.from.z, rotation: toAnchorRot(seg.from.dir) },
  to: { x: seg.to.x, y: seg.to.y, z: seg.to.z, rotation: toAnchorRot(seg.to.dir) },
}));
console.log(JSON.stringify(json, null, 2));
console.log();
