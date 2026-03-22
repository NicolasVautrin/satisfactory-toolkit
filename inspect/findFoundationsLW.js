const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, Vector3D } = require('../satisfactoryLib');

const SAVE_PATH = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614/TEST.sav');

const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST.sav', buf);

// Get player position from regular objects
let allObjects = [];
for (const [, lvl] of Object.entries(save.levels)) {
  if (lvl.objects) allObjects.push(...lvl.objects);
}
const playerEntity = allObjects.find(o => o.typePath?.includes('Char_Player') && o.transform?.translation);
const pp = playerEntity.transform.translation;
console.log(`Player: (${pp.x.toFixed(0)}, ${pp.y.toFixed(0)}, ${pp.z.toFixed(0)})\n`);

// Get lightweight buildables
const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
const buildables = lwSub.specialProperties.buildables;

console.log(`=== Lightweight Buildable types: ${buildables.length} ===\n`);

let totalInstances = 0;
const allInstances = []; // {type, pos, dist}

for (const b of buildables) {
  const typeName = b.typeReference.pathName.split('.').pop();
  const count = b.instances.length;
  totalInstances += count;
  console.log(`  ${typeName} x${count}`);

  for (const inst of b.instances) {
    const pos = inst.transform.translation;
    const dist = new Vector3D(pos).sub(pp).length;
    allInstances.push({ typeName, pos, dist });
  }
}

console.log(`\nTotal lightweight instances: ${totalInstances}`);

// Sort by distance
allInstances.sort((a, b) => a.dist - b.dist);

// Show nearest 40
console.log(`\n=== 40 nearest lightweight buildables ===\n`);
for (const inst of allInstances.slice(0, 40)) {
  const p = inst.pos;
  console.log(`  [${(inst.dist/100).toFixed(1)}m] ${inst.typeName} @ (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`);
}

// Show within radii
for (const radiusM of [25, 50, 100, 200]) {
  const r = radiusM * 100;
  const inR = allInstances.filter(i => i.dist <= r);
  console.log(`\n=== Within ${radiusM}m: ${inR.length} lightweight buildables ===`);
  const byType = {};
  for (const i of inR) {
    byType[i.typeName] = (byType[i.typeName] || 0) + 1;
  }
  for (const [name, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name} x${count}`);
  }
}