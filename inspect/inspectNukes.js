/**
 * Inspect nuclear power plants and pipe holes in the nuclear area.
 */
const fs = require('fs');
const { Parser } = require('@etothepii/satisfactory-file-parser');

const INPUT_SAV = process.argv[2] || './bin/FICSIT_MAX_backup.sav';

function readFileAsArrayBuffer(path) {
  const buf = fs.readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

console.log(`Parsing ${INPUT_SAV}...`);
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer(INPUT_SAV));
const pl = save.levels['Persistent_Level'];

// Nuclear area plants (rot_z ≈ 1.0)
const plants = pl.objects.filter(o =>
  o.typePath?.includes('GeneratorNuclear') && o.type === 'SaveEntity' &&
  Math.abs(o.transform?.rotation?.z) > 0.99
);
console.log(`Nuclear area plants: ${plants.length}`);

// Sort by X then Y
plants.sort((a, b) => a.transform.translation.x - b.transform.translation.x || a.transform.translation.y - b.transform.translation.y);
for (const p of plants) {
  const pos = p.transform.translation;
  console.log(`  (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`);
}

// Pipe holes in nuclear area
const pipeHoles = pl.objects.filter(o =>
  o.typePath?.includes('FoundationPassthrough_Pipe') && o.type === 'SaveEntity'
);

const AREA = { xMin: -245000, xMax: -220000, yMin: -245000, yMax: -225000 };
const nearbyHoles = pipeHoles.filter(h => {
  const p = h.transform?.translation;
  return p && p.x >= AREA.xMin && p.x <= AREA.xMax && p.y >= AREA.yMin && p.y <= AREA.yMax;
});

console.log(`\nPipe holes in nuclear area: ${nearbyHoles.length}`);
nearbyHoles.sort((a, b) => a.transform.translation.x - b.transform.translation.x || a.transform.translation.y - b.transform.translation.y);

for (const h of nearbyHoles) {
  const hp = h.transform.translation;
  const hr = h.transform.rotation;
  // Find closest plant
  let minDist = Infinity, closestPlant = null;
  for (const p of plants) {
    const pp = p.transform.translation;
    const d = Math.sqrt((hp.x-pp.x)**2 + (hp.y-pp.y)**2 + (hp.z-pp.z)**2);
    if (d < minDist) { minDist = d; closestPlant = p; }
  }
  const cp = closestPlant?.transform?.translation;
  const offsetX = hp.x - cp.x, offsetY = hp.y - cp.y, offsetZ = hp.z - cp.z;

  console.log(`\n  ${h.instanceName}`);
  console.log(`    pos: (${Math.round(hp.x)}, ${Math.round(hp.y)}, ${Math.round(hp.z)})`);
  console.log(`    rot: (z=${hr?.z?.toFixed(4)}, w=${hr?.w?.toFixed(4)})`);
  console.log(`    closest plant at: (${Math.round(cp.x)}, ${Math.round(cp.y)})`);
  console.log(`    offset from plant: (${Math.round(offsetX)}, ${Math.round(offsetY)}, ${Math.round(offsetZ)})`);

  // Show components and connections
  const hCompNames = (h.components || []).map(c => c.pathName);
  const hComps = pl.objects.filter(o => hCompNames.includes(o.instanceName));
  for (const hc of hComps) {
    if (!hc.typePath?.includes('Pipe')) continue;
    const connName = hc.properties?.mConnectedComponent?.value?.pathName || 'none';
    console.log(`    ${hc.instanceName.split('.').pop()}: connected=${connName}`);
  }
}

// Also check: what's a nuclear plant's pipe connection connected to?
console.log(`\n=== Tracing pipe connections from nuclear plants ===`);
for (const plant of plants.slice(0, 4)) {
  const pos = plant.transform.translation;
  const pipeConn = pl.objects.find(o =>
    o.instanceName === `${plant.instanceName}.FGPipeConnectionFactory`
  );
  const connectedTo = pipeConn?.properties?.mConnectedComponent?.value?.pathName;
  console.log(`\n  Plant (${Math.round(pos.x)}, ${Math.round(pos.y)}):`);
  console.log(`    FGPipeConnectionFactory -> ${connectedTo || 'none'}`);
  if (connectedTo) {
    // Trace what this pipe connects to
    const connComp = pl.objects.find(o => o.instanceName === connectedTo);
    if (connComp) {
      const parentName = connComp.instanceName.split('.').slice(0, -1).join('.');
      const parent = pl.objects.find(o => o.instanceName === parentName);
      console.log(`      -> parent: ${parent?.typePath?.split('/').pop() || parentName}`);
    }
  }
}