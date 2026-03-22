const fs = require('fs');
const { Parser } = require('@etothepii/satisfactory-file-parser');
function readFileAsArrayBuffer(path) {
  const buf = fs.readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer('./bin/FICSIT_MAX_water.sav'));
const pl = save.levels['Persistent_Level'];

const AREA = { xMin: -245000, xMax: -220000, yMin: -245000, yMax: -225000 };
const pipeHoles = pl.objects.filter(o =>
  o.typePath?.includes('FoundationPassthrough_Pipe') && o.type === 'SaveEntity' &&
  o.transform?.translation?.x >= AREA.xMin && o.transform?.translation?.x <= AREA.xMax &&
  o.transform?.translation?.y >= AREA.yMin && o.transform?.translation?.y <= AREA.yMax
);

console.log(`Pipe holes in output: ${pipeHoles.length}`);

for (const h of pipeHoles.slice(0, 4)) {
  const hp = h.transform.translation;
  console.log(`\n=== PipeHole (${Math.round(hp.x)}, ${Math.round(hp.y)}, ${Math.round(hp.z)}) ===`);

  // Check top snapped connection
  const topRef = h.properties?.mTopSnappedConnection?.value?.pathName;
  const bottomRef = h.properties?.mBottomSnappedConnection?.value?.pathName;
  console.log(`  mTopSnappedConnection: ${topRef || 'MISSING'}`);
  console.log(`  mBottomSnappedConnection: ${bottomRef || 'MISSING'}`);

  // Check if top pipe still exists
  if (topRef) {
    const topPipeInst = topRef.split('.').slice(0, -1).join('.');
    const topPipe = pl.objects.find(o => o.instanceName === topPipeInst);
    console.log(`  Top pipe exists: ${!!topPipe}`);
    if (topPipe) {
      const spline = topPipe.properties?.mSplineData?.values;
      const origin = topPipe.transform.translation;
      if (spline && spline.length >= 2) {
        const p0 = spline[0].value?.properties?.Location?.value;
        const pN = spline[spline.length - 1].value?.properties?.Location?.value;
        console.log(`    origin: (${Math.round(origin.x)}, ${Math.round(origin.y)}, ${Math.round(origin.z)})`);
        console.log(`    spline start: (${Math.round(p0.x)}, ${Math.round(p0.y)}, ${Math.round(p0.z)})`);
        console.log(`    spline end: (${Math.round(pN.x)}, ${Math.round(pN.y)}, ${Math.round(pN.z)})`);
        console.log(`    world start: (${Math.round(origin.x+p0.x)}, ${Math.round(origin.y+p0.y)}, ${Math.round(origin.z+p0.z)})`);
        console.log(`    world end: (${Math.round(origin.x+pN.x)}, ${Math.round(origin.y+pN.y)}, ${Math.round(origin.z+pN.z)})`);
      }
      // Check conn0 and conn1 mConnectedComponent
      const conn0 = pl.objects.find(o => o.instanceName === `${topPipeInst}.PipelineConnection0`);
      const conn1 = pl.objects.find(o => o.instanceName === `${topPipeInst}.PipelineConnection1`);
      console.log(`    conn0 connected: ${conn0?.properties?.mConnectedComponent?.value?.pathName || 'NONE'}`);
      console.log(`    conn1 connected: ${conn1?.properties?.mConnectedComponent?.value?.pathName || 'NONE'}`);
    }
  }

  // Check bottom pipe
  if (bottomRef) {
    const bottomPipeInst = bottomRef.split('.').slice(0, -1).join('.');
    const bottomPipe = pl.objects.find(o => o.instanceName === bottomPipeInst);
    console.log(`  Bottom pipe exists: ${!!bottomPipe}`);
    if (bottomPipe) {
      const conn0 = pl.objects.find(o => o.instanceName === `${bottomPipeInst}.PipelineConnection0`);
      const conn1 = pl.objects.find(o => o.instanceName === `${bottomPipeInst}.PipelineConnection1`);
      console.log(`    conn0 connected: ${conn0?.properties?.mConnectedComponent?.value?.pathName || 'NONE'}`);
      console.log(`    conn1 connected: ${conn1?.properties?.mConnectedComponent?.value?.pathName || 'NONE'}`);
    }
  }
}