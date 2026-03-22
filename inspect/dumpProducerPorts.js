const fs = require('fs');
const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const savePath = path.join(process.env.LOCALAPPDATA, 'FactoryGame', 'Saved', 'SaveGames', '76561198036887614', 'TEST.sav');
console.log('Reading:', savePath);
const ab = readFileAsArrayBuffer(savePath);
const save = Parser.ParseSave('TEST', ab);

const allObjects = Object.values(save.levels).flatMap(l => l.objects);

// Build a lookup map: instanceName -> object
const objectMap = new Map();
for (const obj of allObjects) {
  objectMap.set(obj.instanceName, obj);
}

// Building types to find
const BUILDING_TYPES = [
  { name: 'SmelterMk1',      pattern: 'Build_SmelterMk1' },
  { name: 'ConstructorMk1',  pattern: 'Build_ConstructorMk1' },
  { name: 'AssemblerMk1',    pattern: 'Build_AssemblerMk1' },
  { name: 'FoundryMk1',      pattern: 'Build_FoundryMk1' },
  { name: 'OilRefinery',     pattern: 'Build_OilRefinery' },
  { name: 'Packager',        pattern: 'Build_Packager' },
  { name: 'Blender',         pattern: 'Build_Blender' },
  { name: 'HadronCollider',  pattern: 'Build_HadronCollider' },
  { name: 'QuantumEncoder',  pattern: 'Build_QuantumEncoder' },
  { name: 'Converter',       pattern: 'Build_Converter' },
];

for (const buildingDef of BUILDING_TYPES) {
  // Find one instance
  const entity = allObjects.find(o => o.typePath && o.typePath.includes(buildingDef.pattern));

  console.log('\n' + '='.repeat(80));
  if (!entity) {
    console.log(`${buildingDef.name}: NOT FOUND in save`);
    continue;
  }

  console.log(`${buildingDef.name}`);
  console.log(`  typePath: ${entity.typePath}`);
  console.log(`  instanceName: ${entity.instanceName}`);

  if (entity.transform) {
    const t = entity.transform.translation;
    const r = entity.transform.rotation;
    console.log(`  position: { x: ${t.x}, y: ${t.y}, z: ${t.z} }`);
    console.log(`  rotation: { x: ${r.x}, y: ${r.y}, z: ${r.z}, w: ${r.w} }`);
  }

  // Get components
  const components = entity.components || [];
  console.log(`  components count: ${components.length}`);

  // Group components by typePath
  const grouped = {};

  for (const compRef of components) {
    const compName = compRef.pathName || compRef;
    const comp = objectMap.get(compName);

    if (!comp) {
      console.log(`  WARNING: component not found: ${compName}`);
      continue;
    }

    const typePath = comp.typePath || 'UNKNOWN';
    // Extract short type name
    const typeShort = typePath.split('.').pop() || typePath;

    if (!grouped[typeShort]) {
      grouped[typeShort] = [];
    }

    // Extract short component name (after last dot)
    const shortName = (comp.instanceName || compName).split('.').pop();
    grouped[typeShort].push(shortName);
  }

  // Print grouped
  console.log('  --- Components by type ---');
  const sortedTypes = Object.keys(grouped).sort();
  for (const type of sortedTypes) {
    const names = grouped[type].sort();
    console.log(`  [${type}] (${names.length})`);
    for (const n of names) {
      console.log(`    - ${n}`);
    }
  }
}

console.log('\n' + '='.repeat(80));
console.log('Done.');