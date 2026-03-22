/**
 * Inspect FoundationPassthrough_Pipe structure in save.
 */
const fs = require('fs');
const { Parser } = require('@etothepii/satisfactory-file-parser');

const INPUT_SAV = process.argv[2] || './bin/FICSIT_MAX_backup.sav';
function readFileAsArrayBuffer(path) {
  const buf = fs.readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer(INPUT_SAV));
const pl = save.levels['Persistent_Level'];

const AREA = { xMin: -245000, xMax: -220000, yMin: -245000, yMax: -225000 };
const pipeHoles = pl.objects.filter(o =>
  o.typePath?.includes('FoundationPassthrough_Pipe') && o.type === 'SaveEntity' &&
  o.transform?.translation?.x >= AREA.xMin && o.transform?.translation?.x <= AREA.xMax &&
  o.transform?.translation?.y >= AREA.yMin && o.transform?.translation?.y <= AREA.yMax
);

console.log(`Pipe holes: ${pipeHoles.length}`);

// Detailed first 2
for (const h of pipeHoles.slice(0, 2)) {
  const hp = h.transform.translation;
  const hr = h.transform.rotation;
  console.log(`\n=== ${h.instanceName} ===`);
  console.log(`  typePath: ${h.typePath}`);
  console.log(`  pos: (${hp.x}, ${hp.y}, ${hp.z})`);
  console.log(`  rot: (x=${hr.x}, y=${hr.y}, z=${hr.z}, w=${hr.w})`);
  console.log(`  components: ${JSON.stringify(h.components)}`);
  console.log(`  properties keys: ${Object.keys(h.properties || {})}`);
  for (const [k, v] of Object.entries(h.properties || {})) {
    console.log(`    ${k}: ${JSON.stringify(v).substring(0, 200)}`);
  }

  // Find components
  for (const cRef of (h.components || [])) {
    const comp = pl.objects.find(o => o.instanceName === cRef.pathName);
    if (!comp) { console.log(`  [NOT FOUND] ${cRef.pathName}`); continue; }
    console.log(`\n  Component: ${cRef.pathName}`);
    console.log(`    typePath: ${comp.typePath}`);
    console.log(`    flags: ${comp.flags}`);
    for (const [k, v] of Object.entries(comp.properties || {})) {
      console.log(`    ${k}: ${JSON.stringify(v).substring(0, 200)}`);
    }
  }

  // Find pipes connected to/from this pipe hole position (within 50u)
  console.log(`\n  --- Pipes near this pipe hole ---`);
  const pipes = pl.objects.filter(o => {
    if (!o.typePath?.includes('Pipeline') || o.type !== 'SaveEntity') return false;
    const pp = o.transform?.translation;
    if (!pp) return false;
    const d = Math.sqrt((pp.x-hp.x)**2 + (pp.y-hp.y)**2 + (pp.z-hp.z)**2);
    return d < 2000;
  });
  for (const pipe of pipes) {
    const pp = pipe.transform.translation;
    const spline = pipe.properties?.mSplineData?.values;
    if (!spline || spline.length < 2) continue;
    const p0 = spline[0].value?.properties?.Location?.value;
    const pN = spline[spline.length-1].value?.properties?.Location?.value;
    const start = { x: pp.x + p0.x, y: pp.y + p0.y, z: pp.z + p0.z };
    const end = { x: pp.x + pN.x, y: pp.y + pN.y, z: pp.z + pN.z };

    // Check if either endpoint is near the pipe hole
    const d0 = Math.sqrt((start.x-hp.x)**2 + (start.y-hp.y)**2 + (start.z-hp.z)**2);
    const d1 = Math.sqrt((end.x-hp.x)**2 + (end.y-hp.y)**2 + (end.z-hp.z)**2);
    if (d0 < 500 || d1 < 500) {
      console.log(`    ${pipe.instanceName.split('.').pop()}`);
      console.log(`      start: (${Math.round(start.x)}, ${Math.round(start.y)}, ${Math.round(start.z)}) dist=${Math.round(d0)}`);
      console.log(`      end: (${Math.round(end.x)}, ${Math.round(end.y)}, ${Math.round(end.z)}) dist=${Math.round(d1)}`);
    }
  }
}