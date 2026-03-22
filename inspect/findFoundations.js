const fs = require('fs');
const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, Vector3D } = require('../satisfactoryLib');

const SAVE_PATH = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614/TEST.sav');

console.log('Reading save file...');
const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST.sav', buf);

// Collect all objects from levels (save.levels is an object keyed by level ID)
let allObjects = [];
if (save.levels && typeof save.levels === 'object') {
  for (const [levelId, lvl] of Object.entries(save.levels)) {
    if (lvl.objects) allObjects.push(...lvl.objects);
    if (lvl.collectables) allObjects.push(...lvl.collectables);
  }
}
console.log(`Total objects: ${allObjects.length}`);

// Find player pawn / character
const playerCandidates = allObjects.filter(o =>
  o.typePath && (
    o.typePath.includes('Char_Player') ||
    o.typePath.includes('BP_PlayerState') ||
    o.typePath.includes('PlayerCharacter')
  )
);

console.log('\n=== Player-related entities ===');
for (const p of playerCandidates) {
  const pos = p.transform?.translation;
  console.log(`  ${p.typePath}`);
  console.log(`    instanceName: ${p.instanceName}`);
  if (pos) console.log(`    position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`);
}

// Find player position from Char_Player
let playerEntity = allObjects.find(o =>
  o.typePath && o.typePath.includes('Char_Player') && o.transform?.translation
);

if (!playerEntity) {
  // Fallback: any entity with "player" in typePath that has a position
  const playerish = allObjects.filter(o => o.typePath && o.typePath.toLowerCase().includes('player') && o.transform?.translation);
  console.log('\nChar_Player not found. Player-like entities with position:');
  for (const p of playerish.slice(0, 20)) {
    const pos = p.transform.translation;
    console.log(`  ${p.typePath} @ (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`);
  }
  if (playerish.length > 0) playerEntity = playerish[0];
  else {
    console.log('No player entity found at all!');
    process.exit(1);
  }
}

const playerPos = playerEntity.transform.translation;
console.log(`\nPlayer position: (${playerPos.x.toFixed(0)}, ${playerPos.y.toFixed(0)}, ${playerPos.z.toFixed(0)})`);

// Find foundations
const foundations = allObjects.filter(o =>
  o.typePath && (
    o.typePath.includes('Foundation') ||
    o.typePath.includes('Build_Foundation')
  ) && o.transform?.translation
);

console.log(`\nTotal foundations in save: ${foundations.length}`);

// Compute distances and sort
const withDist = foundations.map(f => {
  const pos = f.transform.translation;
  const dist = new Vector3D(pos).sub(playerPos).length;
  return { entity: f, pos, dist };
});

withDist.sort((a, b) => a.dist - b.dist);

// Show nearest foundations
const RADIUS = 5000; // 50m in UE units (1 UE unit = 1cm)
const nearby = withDist.filter(f => f.dist <= RADIUS);

console.log(`\nFoundations within ${RADIUS/100}m of player: ${nearby.length}`);
console.log('');

// Show top 30 nearest
const toShow = withDist.slice(0, 30);
for (const f of toShow) {
  const pos = f.pos;
  const typeName = f.entity.typePath.split('.').pop();
  console.log(`  [${(f.dist/100).toFixed(1)}m] ${typeName} @ (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}) - ${f.entity.instanceName}`);
}

// Show distinct foundation types
const types = new Set(foundations.map(f => f.entity.typePath));
console.log(`\nDistinct foundation types (${types.size}):`);
for (const t of types) {
  const count = foundations.filter(f => f.entity.typePath === t).length;
  console.log(`  ${t.split('.').pop()} x${count}`);
}