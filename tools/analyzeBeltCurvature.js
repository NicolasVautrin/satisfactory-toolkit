/**
 * Analyze minimum radius of curvature on all conveyor belts in a save.
 *
 * Usage: node bin/analyzeBeltCurvature.js [input.sav]
 */
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const GAME_SAVES = 'C:/Users/nicolasv/AppData/Local/FactoryGame/Saved/SaveGames/76561198036887614';
const INPUT_SAV = process.argv[2] || `${GAME_SAVES}/TEST.sav`;

// --- Curvature computation ---

function splineMinRadius(splineValues, steps = 128) {
  const segments = splineValues.length - 1;
  let maxK = 0, bestT = 0, bestSeg = 0;

  for (let seg = 0; seg < segments; seg++) {
    const sp0 = splineValues[seg].value.properties;
    const sp1 = splineValues[seg + 1].value.properties;
    const p0 = sp0.Location.value;
    const p1 = sp1.Location.value;
    const t0 = sp0.LeaveTangent.value;
    const t1 = sp1.ArriveTangent.value;

    // Skip extreme endpoints (t=0 on first seg, t=1 on last seg) to avoid
    // degenerate curvature at endpoints where tangent magnitude approaches 0
    const iStart = (seg === 0) ? 2 : 0;
    const iEnd = (seg === segments - 1) ? steps - 2 : steps;

    for (let i = iStart; i <= iEnd; i++) {
      const t = i / steps;
      // First derivative
      const d1x = (6*t*t - 6*t)*p0.x + (3*t*t - 4*t + 1)*t0.x + (-6*t*t + 6*t)*p1.x + (3*t*t - 2*t)*t1.x;
      const d1y = (6*t*t - 6*t)*p0.y + (3*t*t - 4*t + 1)*t0.y + (-6*t*t + 6*t)*p1.y + (3*t*t - 2*t)*t1.y;
      const d1z = (6*t*t - 6*t)*p0.z + (3*t*t - 4*t + 1)*t0.z + (-6*t*t + 6*t)*p1.z + (3*t*t - 2*t)*t1.z;
      // Second derivative
      const d2x = (12*t - 6)*p0.x + (6*t - 4)*t0.x + (-12*t + 6)*p1.x + (6*t - 2)*t1.x;
      const d2y = (12*t - 6)*p0.y + (6*t - 4)*t0.y + (-12*t + 6)*p1.y + (6*t - 2)*t1.y;
      const d2z = (12*t - 6)*p0.z + (6*t - 4)*t0.z + (-12*t + 6)*p1.z + (6*t - 2)*t1.z;
      // Cross product |r' × r''|
      const cx = d1y * d2z - d1z * d2y;
      const cy = d1z * d2x - d1x * d2z;
      const cz = d1x * d2y - d1y * d2x;
      const crossLen = Math.sqrt(cx*cx + cy*cy + cz*cz);
      const d1Len = Math.sqrt(d1x*d1x + d1y*d1y + d1z*d1z);
      // Skip points where tangent is too small (degenerate / cusps)
      if (d1Len < 10) continue;
      const kappa = crossLen / (d1Len * d1Len * d1Len);
      if (kappa > maxK) { maxK = kappa; bestT = t; bestSeg = seg; }
    }
  }

  return {
    minRadius: maxK > 1e-10 ? 1 / maxK : Infinity,
    maxCurvature: maxK,
    atT: bestT,
    atSegIndex: bestSeg,
  };
}

function splineLength(splineValues, steps = 128) {
  const segments = splineValues.length - 1;
  let totalLen = 0;
  for (let seg = 0; seg < segments; seg++) {
    const sp0 = splineValues[seg].value.properties;
    const sp1 = splineValues[seg + 1].value.properties;
    const p0 = sp0.Location.value;
    const p1 = sp1.Location.value;
    const t0 = sp0.LeaveTangent.value;
    const t1 = sp1.ArriveTangent.value;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2*t3 - 3*t2 + 1, h10 = t3 - 2*t2 + t, h01 = -2*t3 + 3*t2, h11 = t3 - t2;
      const cur = {
        x: h00*p0.x + h10*t0.x + h01*p1.x + h11*t1.x,
        y: h00*p0.y + h10*t0.y + h01*p1.y + h11*t1.y,
        z: h00*p0.z + h10*t0.z + h01*p1.z + h11*t1.z,
      };
      const dx = cur.x - prev.x, dy = cur.y - prev.y, dz = cur.z - prev.z;
      totalLen += Math.sqrt(dx*dx + dy*dy + dz*dz);
      prev = cur;
    }
  }
  return totalLen;
}

// --- Main ---

console.log(`Parsing ${INPUT_SAV}...`);
const t0 = Date.now();
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer(INPUT_SAV));
console.log(`Parsed in ${Date.now() - t0}ms`);

const allObjects = save.levels['Persistent_Level'].objects;

// Find all conveyor belts
const beltPattern = /ConveyorBeltMk\d/;
const belts = allObjects.filter(o => o.typePath && beltPattern.test(o.typePath) && o.properties?.mSplineData);

console.log(`\nFound ${belts.length} conveyor belts\n`);

// Analyze each belt
const results = [];
for (const belt of belts) {
  const spline = belt.properties.mSplineData.values;
  if (!spline || spline.length < 2) continue;

  const { minRadius, maxCurvature, atT, atSegIndex } = splineMinRadius(spline);
  const len = splineLength(spline);

  // Extract tier from typePath
  const tierMatch = belt.typePath.match(/Mk(\d)/);
  const tier = tierMatch ? parseInt(tierMatch[1]) : '?';

  results.push({
    inst: belt.instanceName,
    tier,
    splinePoints: spline.length,
    length: len,
    minRadius,
    maxCurvature,
    pos: belt.transform.translation,
  });
}

// Sort by minRadius ascending (tightest curves first)
results.sort((a, b) => a.minRadius - b.minRadius);

// Summary stats
const finite = results.filter(r => isFinite(r.minRadius));
const straight = results.filter(r => !isFinite(r.minRadius));

console.log(`=== Résumé ===`);
console.log(`Belts avec courbure: ${finite.length}`);
console.log(`Belts droits (R=∞): ${straight.length}`);

if (finite.length > 0) {
  console.log(`\nRayon de courbure min global: ${finite[0].minRadius.toFixed(1)}u (${(finite[0].minRadius/100).toFixed(2)}m)`);

  // Distribution
  const buckets = [100, 200, 500, 1000, 2000, 5000, 10000, Infinity];
  console.log(`\n=== Distribution des rayons de courbure min ===`);
  let prev = 0;
  for (const b of buckets) {
    const count = finite.filter(r => r.minRadius >= prev && r.minRadius < b).length;
    const label = isFinite(b) ? `${prev}-${b}u` : `${prev}u+`;
    if (count > 0) console.log(`  ${label.padEnd(15)} ${count} belts`);
    prev = b;
  }

  // Top 20 tightest curves
  console.log(`\n=== Top 20 virages les plus serrés ===`);
  console.log('Rmin (u)    Rmin (m)   Longueur   Tier  Position');
  console.log('-'.repeat(80));
  for (const r of finite.slice(0, 20)) {
    const pos = `(${Math.round(r.pos.x)}, ${Math.round(r.pos.y)}, ${Math.round(r.pos.z)})`;
    console.log(
      `${r.minRadius.toFixed(1).padStart(10)}  ${(r.minRadius/100).toFixed(2).padStart(8)}m  ${r.length.toFixed(0).padStart(8)}u  Mk${r.tier}   ${pos}`
    );
  }
}