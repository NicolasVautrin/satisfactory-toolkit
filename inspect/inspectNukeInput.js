/**
 * Find the world-space position of the nuclear plant's water input (FGPipeConnectionFactory).
 * Traces the pipe connected to it to deduce the connection point position.
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

// Nuclear area plants
const plants = pl.objects.filter(o =>
  o.typePath?.includes('GeneratorNuclear') && o.type === 'SaveEntity' &&
  Math.abs(o.transform?.rotation?.z) > 0.99
);

// For each plant, find its FGPipeConnectionFactory and trace the connected pipe
for (const plant of plants.slice(0, 4)) {
  const pos = plant.transform.translation;
  const rot = plant.transform.rotation;
  const pipeConnName = `${plant.instanceName}.FGPipeConnectionFactory`;
  const pipeConn = pl.objects.find(o => o.instanceName === pipeConnName);
  const connectedTo = pipeConn?.properties?.mConnectedComponent?.value?.pathName;

  console.log(`\nPlant (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}) rot_z=${rot.z.toFixed(4)}`);

  if (!connectedTo) {
    console.log(`  NOT connected`);
    continue;
  }

  // The connected component is a pipe's PipelineConnection. Find the pipe entity.
  const pipeInstName = connectedTo.split('.').slice(0, -1).join('.');
  const pipe = pl.objects.find(o => o.instanceName === pipeInstName);
  if (!pipe) {
    console.log(`  Pipe not found: ${pipeInstName}`);
    continue;
  }

  const pipePos = pipe.transform.translation;
  const spline = pipe.properties?.mSplineData?.values;
  console.log(`  Connected pipe: ${pipeInstName}`);
  console.log(`  Pipe origin: (${Math.round(pipePos.x)}, ${Math.round(pipePos.y)}, ${Math.round(pipePos.z)})`);

  if (spline && spline.length >= 2) {
    const p0 = spline[0].value?.properties?.Location?.value;
    const p1 = spline[spline.length - 1].value?.properties?.Location?.value;
    console.log(`  Spline start (local): (${Math.round(p0.x)}, ${Math.round(p0.y)}, ${Math.round(p0.z)})`);
    console.log(`  Spline end (local): (${Math.round(p1.x)}, ${Math.round(p1.y)}, ${Math.round(p1.z)})`);
    // World positions
    console.log(`  Spline start (world): (${Math.round(pipePos.x + p0.x)}, ${Math.round(pipePos.y + p0.y)}, ${Math.round(pipePos.z + p0.z)})`);
    console.log(`  Spline end (world): (${Math.round(pipePos.x + p1.x)}, ${Math.round(pipePos.y + p1.y)}, ${Math.round(pipePos.z + p1.z)})`);

    // Which end connects to nuke? connectedTo ends with Connection0 or Connection1
    const isConn1 = connectedTo.endsWith('Connection1');
    const nukeEnd = isConn1 ? p1 : p0;
    const nukeEndWorld = {
      x: pipePos.x + nukeEnd.x,
      y: pipePos.y + nukeEnd.y,
      z: pipePos.z + nukeEnd.z,
    };
    console.log(`  Nuke input world pos: (${Math.round(nukeEndWorld.x)}, ${Math.round(nukeEndWorld.y)}, ${Math.round(nukeEndWorld.z)})`);
    console.log(`  Offset from plant: (${Math.round(nukeEndWorld.x - pos.x)}, ${Math.round(nukeEndWorld.y - pos.y)}, ${Math.round(nukeEndWorld.z - pos.z)})`);
  }
}