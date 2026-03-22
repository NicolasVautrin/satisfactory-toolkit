const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, Vector3D } = require('../satisfactoryLib');

const SAVE_PATH = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614/TEST.sav');

console.log('Reading save file...');
const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST.sav', buf);

// Collect all objects from levels
let allObjects = [];
for (const [levelId, lvl] of Object.entries(save.levels)) {
  if (lvl.objects) allObjects.push(...lvl.objects);
}
console.log(`Total objects: ${allObjects.length}`);

// Find player
const playerEntity = allObjects.find(o =>
  o.typePath && o.typePath.includes('Char_Player') && o.transform?.translation
);
const playerPos = playerEntity.transform.translation;
console.log(`Player position: (${playerPos.x.toFixed(0)}, ${playerPos.y.toFixed(0)}, ${playerPos.z.toFixed(0)})`);

// Filter: only entities with a position (buildings/structures), exclude components, items, resources
const structures = allObjects.filter(o => {
  if (!o.typePath || !o.transform?.translation) return false;
  const tp = o.typePath.toLowerCase();
  // Exclude non-building things
  if (tp.includes('char_player')) return false;
  if (tp.includes('bp_playerstate')) return false;
  if (tp.includes('item') && !tp.includes('build_')) return false;
  if (tp.includes('pickup')) return false;
  if (tp.includes('drop')) return false;
  if (tp.includes('crate')) return false;
  // Keep only Build_ entities and other factory/game entities
  return true;
});

console.log(`Entities with position (potential structures): ${structures.length}`);

// Compute distances
const withDist = structures.map(s => {
  const pos = s.transform.translation;
  const dist = new Vector3D(pos).sub(playerPos).length;
  return { typePath: s.typePath, instanceName: s.instanceName, pos, dist };
});
withDist.sort((a, b) => a.dist - b.dist);

// Show within various radii
for (const radiusM of [25, 50, 100, 200, 500]) {
  const r = radiusM * 100;
  const inRadius = withDist.filter(f => f.dist <= r);
  console.log(`\n=== Within ${radiusM}m: ${inRadius.length} structures ===`);

  // Group by type
  const byType = {};
  for (const s of inRadius) {
    const shortName = s.typePath.split('.').pop();
    if (!byType[shortName]) byType[shortName] = [];
    byType[shortName].push(s);
  }

  const sorted = Object.entries(byType).sort((a, b) => {
    // Sort by nearest instance
    return a[1][0].dist - b[1][0].dist;
  });

  for (const [name, items] of sorted) {
    const nearest = items[0];
    console.log(`  ${name} x${items.length} (nearest: ${(nearest.dist/100).toFixed(1)}m)`);
  }
}

// Show the 50 nearest with details
console.log('\n=== 50 nearest structures ===');
for (const s of withDist.slice(0, 50)) {
  const shortName = s.typePath.split('.').pop();
  const p = s.pos;
  console.log(`  [${(s.dist/100).toFixed(1)}m] ${shortName} @ (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`);
}