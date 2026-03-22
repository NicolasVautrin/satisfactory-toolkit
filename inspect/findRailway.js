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
console.log(`Total objects: ${allObjects.length}\n`);

// Railway-related keywords
const RAIL_KEYWORDS = [
  'Rail', 'Train', 'Station', 'Locomotive', 'Freight',
  'Platform', 'RailroadSwitch', 'RailroadSignal', 'RailroadEndStop',
];

const railObjects = allObjects.filter(o => {
  if (!o.typePath) return false;
  return RAIL_KEYWORDS.some(kw => o.typePath.includes(kw));
});

console.log(`Railway objects found: ${railObjects.length}\n`);

// Group by typePath
const byType = {};
for (const obj of railObjects) {
  if (!byType[obj.typePath]) byType[obj.typePath] = [];
  byType[obj.typePath].push(obj);
}

for (const [typePath, objs] of Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`\n${'='.repeat(120)}`);
  console.log(`TYPE: ${typePath}  (${objs.length} instances)`);
  console.log('='.repeat(120));

  // Dump first instance in detail
  const obj = objs[0];
  console.log(`  instanceName: ${obj.instanceName}`);

  if (obj.transform) {
    const t = obj.transform.translation;
    const r = obj.transform.rotation;
    console.log(`  position: (${t.x.toFixed(0)}, ${t.y.toFixed(0)}, ${t.z.toFixed(0)})`);
    console.log(`  rotation: (${r.x.toFixed(4)}, ${r.y.toFixed(4)}, ${r.z.toFixed(4)}, ${r.w.toFixed(4)})`);
  }

  if (obj.components?.length) {
    console.log(`  components (${obj.components.length}):`);
    for (const compRef of obj.components) {
      const compName = compRef.pathName || compRef;
      console.log(`    - ${compName}`);
      // Find the actual component
      const comp = allObjects.find(o => o.instanceName === compName);
      if (comp) {
        console.log(`      typePath: ${comp.typePath}`);
        if (comp.properties && Object.keys(comp.properties).length > 0) {
          console.log(`      properties: ${JSON.stringify(comp.properties, null, 8).substring(0, 500)}`);
        }
      }
    }
  }

  if (obj.properties && Object.keys(obj.properties).length > 0) {
    console.log(`  properties:`);
    for (const [propName, propVal] of Object.entries(obj.properties)) {
      const str = JSON.stringify(propVal, null, 4);
      if (str.length > 800) {
        console.log(`    ${propName}: ${str.substring(0, 800)}...`);
      } else {
        console.log(`    ${propName}: ${str}`);
      }
    }
  }

  if (obj.specialProperties) {
    console.log(`  specialProperties: ${JSON.stringify(obj.specialProperties, null, 4).substring(0, 1000)}`);
  }

  // Show flags
  console.log(`  flags: ${obj.flags}`);
  if (obj.needTransform !== undefined) console.log(`  needTransform: ${obj.needTransform}`);
  if (obj.wasPlacedInLevel !== undefined) console.log(`  wasPlacedInLevel: ${obj.wasPlacedInLevel}`);
  if (obj.parentObject) console.log(`  parentObject: ${obj.parentObject.pathName}`);
  if (obj.saveCustomVersion !== undefined) console.log(`  saveCustomVersion: ${obj.saveCustomVersion}`);
}
