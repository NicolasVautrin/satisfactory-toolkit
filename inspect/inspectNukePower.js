const fs = require('fs');
const { Parser } = require('@etothepii/satisfactory-file-parser');
function readFileAsArrayBuffer(path) {
  const buf = fs.readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer('./bin/FICSIT_MAX_backup.sav'));
const pl = save.levels['Persistent_Level'];

const plants = pl.objects.filter(o =>
  o.typePath?.includes('GeneratorNuclear') && o.type === 'SaveEntity' &&
  Math.abs(o.transform?.rotation?.z) > 0.99
);

// Check first 2 nukes' power connections
for (const plant of plants.slice(0, 2)) {
  const pos = plant.transform.translation;
  const pcName = `${plant.instanceName}.PowerConnection`;
  const pc = pl.objects.find(o => o.instanceName === pcName);
  console.log(`\nNuke (${Math.round(pos.x)}, ${Math.round(pos.y)}):`);
  console.log(`  PowerConnection: ${pcName}`);
  console.log(`  typePath: ${pc?.typePath}`);
  console.log(`  flags: ${pc?.flags}`);
  const wires = pc?.properties?.mWires?.values || [];
  console.log(`  mWires (${wires.length}): ${wires.map(w => w.pathName).join(', ')}`);
}
