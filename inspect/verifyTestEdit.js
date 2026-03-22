const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const SAVE_PATH = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614/TEST_edit.sav');
const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST_edit.sav', buf);

let allObjects = [];
for (const [, lvl] of Object.entries(save.levels)) {
  if (lvl.objects) allObjects.push(...lvl.objects);
}

// Find merger
const mergers = allObjects.filter(o => o.typePath?.includes('ConveyorMerger') || o.typePath?.includes('ConveyorAttachmentConveyorMerger'));
console.log(`=== Mergers found: ${mergers.length} ===`);
for (const m of mergers) {
  const t = m.transform;
  if (t) {
    console.log(`  ${m.instanceName}`);
    console.log(`  typePath: ${m.typePath}`);
    console.log(`  pos: (${t.translation.x.toFixed(0)}, ${t.translation.y.toFixed(0)}, ${t.translation.z.toFixed(0)})`);
    console.log(`  rot: (${t.rotation.x.toFixed(4)}, ${t.rotation.y.toFixed(4)}, ${t.rotation.z.toFixed(4)}, ${t.rotation.w.toFixed(4)})`);
    console.log(`  scale: (${t.scale3d.x}, ${t.scale3d.y}, ${t.scale3d.z})`);
    console.log(`  properties:`, Object.keys(m.properties || {}));
    console.log(`  components:`, m.components?.map(c => c.pathName));
  }
}

// Find junction
const junctions = allObjects.filter(o => o.typePath?.includes('PipelineJunction'));
console.log(`\n=== Junctions found: ${junctions.length} ===`);
for (const j of junctions) {
  const t = j.transform;
  if (t) {
    console.log(`  ${j.instanceName}`);
    console.log(`  typePath: ${j.typePath}`);
    console.log(`  pos: (${t.translation.x.toFixed(0)}, ${t.translation.y.toFixed(0)}, ${t.translation.z.toFixed(0)})`);
    console.log(`  rot: (${t.rotation.x.toFixed(4)}, ${t.rotation.y.toFixed(4)}, ${t.rotation.z.toFixed(4)}, ${t.rotation.w.toFixed(4)})`);
    console.log(`  properties:`, Object.keys(j.properties || {}));
    console.log(`  components:`, j.components?.map(c => c.pathName));
  }
}

// Find our new belts (recently created IDs are hex-like)
const newBelts = allObjects.filter(o => o.typePath?.includes('ConveyorBeltMk5') && o.transform);
console.log(`\n=== Mk5 Belts: ${newBelts.length} ===`);
for (const b of newBelts) {
  const t = b.transform;
  const spline = b.properties?.mSplineData?.values;
  console.log(`  ${b.instanceName}`);
  console.log(`  origin: (${t.translation.x.toFixed(0)}, ${t.translation.y.toFixed(0)}, ${t.translation.z.toFixed(0)})`);
  if (spline) {
    const first = spline[0].value.properties.Location.value;
    const last = spline[spline.length - 1].value.properties.Location.value;
    console.log(`  spline start (local): (${first.x.toFixed(0)}, ${first.y.toFixed(0)}, ${first.z.toFixed(0)})`);
    console.log(`  spline end (local):   (${last.x.toFixed(0)}, ${last.y.toFixed(0)}, ${last.z.toFixed(0)})`);
    console.log(`  spline start (world): (${(t.translation.x+first.x).toFixed(0)}, ${(t.translation.y+first.y).toFixed(0)}, ${(t.translation.z+first.z).toFixed(0)})`);
    console.log(`  spline end (world):   (${(t.translation.x+last.x).toFixed(0)}, ${(t.translation.y+last.y).toFixed(0)}, ${(t.translation.z+last.z).toFixed(0)})`);
  }
  // Check connections
  const comps = b.components?.map(c => c.pathName) || [];
  for (const cn of comps) {
    const comp = allObjects.find(o => o.instanceName === cn);
    if (comp?.properties?.mConnectedComponent) {
      console.log(`  ${cn.split('.').pop()} → ${comp.properties.mConnectedComponent.value.pathName}`);
    } else {
      console.log(`  ${cn.split('.').pop()} → (not connected)`);
    }
  }
}

// Find new pipes (Mk2)
const newPipes = allObjects.filter(o => o.typePath?.includes('PipelineMK2') && o.transform);
console.log(`\n=== New PipelineMK2 (showing last 5): ${newPipes.length} total ===`);
for (const p of newPipes.slice(-5)) {
  const t = p.transform;
  const spline = p.properties?.mSplineData?.values;
  console.log(`  ${p.instanceName}`);
  console.log(`  origin: (${t.translation.x.toFixed(0)}, ${t.translation.y.toFixed(0)}, ${t.translation.z.toFixed(0)})`);
  if (spline) {
    const first = spline[0].value.properties.Location.value;
    const last = spline[spline.length - 1].value.properties.Location.value;
    console.log(`  spline start (world): (${(t.translation.x+first.x).toFixed(0)}, ${(t.translation.y+first.y).toFixed(0)}, ${(t.translation.z+first.z).toFixed(0)})`);
    console.log(`  spline end (world):   (${(t.translation.x+last.x).toFixed(0)}, ${(t.translation.y+last.y).toFixed(0)}, ${(t.translation.z+last.z).toFixed(0)})`);
  }
  const comps = p.components?.map(c => c.pathName) || [];
  for (const cn of comps) {
    const comp = allObjects.find(o => o.instanceName === cn);
    if (comp?.properties?.mConnectedComponent) {
      console.log(`  ${cn.split('.').pop()} → ${comp.properties.mConnectedComponent.value.pathName}`);
    }
  }
}

// Find merger components
if (mergers.length > 0) {
  console.log('\n=== Merger component details ===');
  const m = mergers[mergers.length - 1]; // our new one
  for (const cRef of (m.components || [])) {
    const comp = allObjects.find(o => o.instanceName === cRef.pathName);
    if (comp) {
      const conn = comp.properties?.mConnectedComponent;
      console.log(`  ${cRef.pathName.split('.').pop()}: connected=${conn ? conn.value.pathName : 'none'}`);
    } else {
      console.log(`  ${cRef.pathName.split('.').pop()}: COMPONENT NOT FOUND IN SAVE!`);
    }
  }
}