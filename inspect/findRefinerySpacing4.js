const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const SAVE_PATH = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614/TEST_edit.sav');

console.log('Reading:', SAVE_PATH);
const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST_edit.sav', buf);

let allObjects = [];
for (const [levelId, lvl] of Object.entries(save.levels)) {
  if (lvl.objects) allObjects.push(...lvl.objects);
}

const refineries = allObjects.filter(o => {
  if (!o.typePath || !o.transform?.translation) return false;
  return o.typePath.toLowerCase().includes('build_oilrefinery');
}).map(o => {
  const q = o.transform.rotation;
  const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  return {
    x:      o.transform.translation.x,
    y:      o.transform.translation.y,
    z:      o.transform.translation.z,
    yawDeg: ((yaw * 180 / Math.PI) % 360 + 360) % 360,
    name:   o.instanceName,
  };
});

// Focus on yaw ~310 group (116 refineries)
const group310 = refineries.filter(r => Math.abs(r.yawDeg - 310) < 5 || Math.abs(r.yawDeg - 310 + 360) < 5);
console.log(`\nYaw ~310 group: ${group310.length} refineries`);

// Print all positions sorted by x
group310.sort((a, b) => a.x - b.x);
for (const r of group310) {
  console.log(`  (${r.x.toFixed(0)}, ${r.y.toFixed(0)}, ${r.z.toFixed(0)}) yaw=${r.yawDeg.toFixed(1)}°`);
}

// Compute all pairwise nearest-neighbor distances
console.log('\nNearest neighbor distances:');
const nnDists = [];
for (let i = 0; i < group310.length; i++) {
  let minD = Infinity, minJ = -1;
  for (let j = 0; j < group310.length; j++) {
    if (i === j) continue;
    const dx = group310[j].x - group310[i].x;
    const dy = group310[j].y - group310[i].y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minD) { minD = d; minJ = j; }
  }
  nnDists.push(minD);
}
// Histogram of NN distances
const hist = {};
for (const d of nnDists) {
  const key = Math.round(d / 100) * 100;
  hist[key] = (hist[key] || 0) + 1;
}
const sorted = Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0]));
console.log('NN distance histogram:');
for (const [d, count] of sorted) {
  console.log(`  ${d} UU (${(d/100).toFixed(0)}m): ${count}x`);
}

// The NN distance of ~2000 suggests the in-row step is ~2000 UU
// Let's find pairs at that distance and extract direction
const pairs = [];
for (let i = 0; i < group310.length; i++) {
  for (let j = i + 1; j < group310.length; j++) {
    const dx = group310[j].x - group310[i].x;
    const dy = group310[j].y - group310[i].y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 3000) {
      pairs.push({ d, dx, dy });
    }
  }
}
pairs.sort((a, b) => a.d - b.d);
console.log(`\nClose pairs (< 3000 UU): ${pairs.length}`);
for (const p of pairs.slice(0, 20)) {
  console.log(`  d=${p.d.toFixed(0)} vec=(${p.dx.toFixed(0)}, ${p.dy.toFixed(0)})`);
}

// Find the two dominant directions
// Direction 1: along rows (most common short distance)
// Direction 2: between rows (perpendicular)

// Get the most common vector direction
const shortPairs = pairs.filter(p => p.d < 2500);
if (shortPairs.length > 0) {
  // Align vectors
  let refDx = shortPairs[0].dx;
  let refDy = shortPairs[0].dy;
  let sumDx = 0, sumDy = 0;
  for (const p of shortPairs) {
    const dot = p.dx * refDx + p.dy * refDy;
    if (dot >= 0) { sumDx += p.dx; sumDy += p.dy; }
    else          { sumDx -= p.dx; sumDy -= p.dy; }
  }
  const len = Math.sqrt(sumDx * sumDx + sumDy * sumDy);
  const dirX = sumDx / len;
  const dirY = sumDy / len;
  const perpX = -dirY;
  const perpY = dirX;

  console.log(`\nIn-row dir: (${dirX.toFixed(3)}, ${dirY.toFixed(3)})`);
  console.log(`Perp dir:   (${perpX.toFixed(3)}, ${perpY.toFixed(3)})`);

  // Project all onto perp axis
  const projected = group310.map(r => ({
    ...r,
    perp:  r.x * perpX + r.y * perpY,
    along: r.x * dirX  + r.y * dirY,
  }));
  projected.sort((a, b) => a.perp - b.perp);

  // Print all perpendicular projections
  console.log('\nPerp projections (sorted):');
  for (const r of projected) {
    console.log(`  perp=${r.perp.toFixed(0)} along=${r.along.toFixed(0)} (${r.x.toFixed(0)}, ${r.y.toFixed(0)})`);
  }

  // Cluster into rows with gap detection
  // Look at gaps between consecutive perp values
  console.log('\nGaps between consecutive perp values:');
  for (let i = 1; i < projected.length; i++) {
    const gap = projected[i].perp - projected[i-1].perp;
    if (gap > 500) {
      console.log(`  *** GAP at index ${i}: ${gap.toFixed(0)} UU (${(gap/100).toFixed(1)}m)`);
    }
  }

  // Cluster with gap > 1000 UU = new row
  const rows = [];
  let currentRow = [projected[0]];
  for (let i = 1; i < projected.length; i++) {
    if (projected[i].perp - currentRow[currentRow.length - 1].perp > 1000) {
      rows.push(currentRow);
      currentRow = [projected[i]];
    } else {
      currentRow.push(projected[i]);
    }
  }
  rows.push(currentRow);

  console.log(`\n========== ROWS (gap threshold 1000 UU) ==========`);
  const rowCenters = [];
  for (const [i, row] of rows.entries()) {
    const avgPerp = row.reduce((s, r) => s + r.perp, 0) / row.length;
    rowCenters.push(avgPerp);
    console.log(`Row ${i}: ${row.length} refineries, perpAvg = ${avgPerp.toFixed(0)}`);
  }

  if (rowCenters.length >= 2) {
    console.log('\nRow-to-row spacing:');
    const spacings = [];
    for (let i = 1; i < rowCenters.length; i++) {
      const gap = rowCenters[i] - rowCenters[i - 1];
      spacings.push(gap);
      console.log(`  Row ${i-1} -> ${i}: ${gap.toFixed(0)} UU (${(gap/100).toFixed(1)}m)  [gap between buildings: ${(gap - 2200).toFixed(0)} UU = ${((gap - 2200)/100).toFixed(1)}m]`);
    }

    // Summary
    const freq = {};
    for (const s of spacings) {
      const key = Math.round(s / 100) * 100;
      freq[key] = (freq[key] || 0) + 1;
    }
    console.log('\nSpacing frequency:');
    for (const [val, count] of Object.entries(freq).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${val} UU (${(val/100).toFixed(0)}m): ${count}x`);
    }
  }
}