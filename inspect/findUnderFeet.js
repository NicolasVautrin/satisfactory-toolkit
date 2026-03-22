const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const SAVE_PATH = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614/TEST.sav');

const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST.sav', buf);

let allObjects = [];
for (const [, lvl] of Object.entries(save.levels)) {
  if (lvl.objects) allObjects.push(...lvl.objects);
}

const playerEntity = allObjects.find(o =>
  o.typePath && o.typePath.includes('Char_Player') && o.transform?.translation
);
const pp = playerEntity.transform.translation;
console.log(`Player: (${pp.x.toFixed(0)}, ${pp.y.toFixed(0)}, ${pp.z.toFixed(0)})`);

// "Sous mes pieds" = close in X/Y, at or below player Z
// Search within 15m horizontal, up to 30m below
const H_RADIUS = 1500;  // 15m horizontal
const Z_BELOW = 3000;   // 30m below
const Z_ABOVE = 200;    // 2m above (to catch what we're standing on)

const underFeet = allObjects.filter(o => {
  if (!o.typePath || !o.transform?.translation) return false;
  const pos = o.transform.translation;
  const dx = Math.abs(pos.x - pp.x);
  const dy = Math.abs(pos.y - pp.y);
  const dz = pos.z - pp.z; // negative = below
  return dx <= H_RADIUS && dy <= H_RADIUS && dz <= Z_ABOVE && dz >= -Z_BELOW;
});

// Sort by Z descending (highest first = closest under feet)
underFeet.sort((a, b) => b.transform.translation.z - a.transform.translation.z);

console.log(`\nObjects within ${H_RADIUS/100}m horizontal, from ${Z_ABOVE/100}m above to ${Z_BELOW/100}m below (${underFeet.length} total):\n`);

for (const o of underFeet) {
  const pos = o.transform.translation;
  const dz = ((pos.z - pp.z) / 100).toFixed(1);
  const hDist = (Math.sqrt((pos.x - pp.x) ** 2 + (pos.y - pp.y) ** 2) / 100).toFixed(1);
  const name = o.typePath.split('.').pop();
  console.log(`  Z${dz}m  H${hDist}m  ${name}  @ (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`);
}