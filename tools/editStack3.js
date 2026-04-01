#!/usr/bin/env node
// Build a 3-constructor stack with splitter (input) + merger (output) + 4 lifts + 6 belts
const BASE = 'http://localhost:3000';

async function post(body) {
  const r = await fetch(`${BASE}/api/game/edit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.success) throw new Error(data.error);
  return data;
}

function idx(result, id) {
  const e = result.added.find(a => a.id === id);
  if (!e) throw new Error(`Entity "${id}" not found in added`);
  return e.index;
}

async function main() {
  // Get anchor from camera
  const cam = await (await fetch(`${BASE}/api/viewer/camera`)).json();
  const yaw = cam.yaw * Math.PI / 180, pitch = cam.pitch * Math.PI / 180;
  const dist = 5000, cos = Math.cos(pitch);
  const anchor = {
    x: cam.position.x + Math.cos(yaw) * cos * dist,
    y: cam.position.y + Math.sin(yaw) * cos * dist,
    z: cam.position.z + Math.sin(pitch) * dist,
  };
  console.log('Anchor:', anchor);

  // 1. Three constructors stacked
  const r1 = await post({
    anchor,
    entities: [
      { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
      { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 1000 }, rotation: 180 },
      { id: 'c3', type: 'constructor', position: { x: 0, y: 0, z: 2000 } },
    ],
  });
  const c1 = idx(r1, 'c1'), c2 = idx(r1, 'c2'), c3 = idx(r1, 'c3');
  console.log(`Constructors: c1=${c1} c2=${c2} c3=${c3}`);

  // 2. Splitter + belt → c1:Input0
  const r2 = await post({
    anchor,
    entities: [
      { id: 'spl', type: 'splitter', position: { x: 0, y: -800, z: 0 } },
      { id: 'c1', index: c1 },
    ],
    connections: [{ from: 'spl:Output1', to: 'c1:Input0', belt: 6 }],
  });
  const spl = idx(r2, 'spl');
  console.log(`Splitter: spl=${spl}`);

  // 3. LiftIn1 → spl:Output2 + belt → c2:Input0
  const r3 = await post({
    entities: [
      { id: 'spl', index: spl },
      { id: 'liftIn1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 1100 } },
    ],
    connections: [{ from: 'liftIn1:bottom', to: 'spl:Output2' }],
  });
  const li1 = idx(r3, 'liftIn1');
  await post({
    entities: [{ id: 'li1', index: li1 }, { id: 'c2', index: c2 }],
    connections: [{ from: 'li1:top', to: 'c2:Input0', belt: 6 }],
  });
  console.log(`LiftIn1: ${li1} → c2`);

  // 4. LiftIn2 → spl:Output3 + belt → c3:Input0
  const r4 = await post({
    entities: [
      { id: 'spl', index: spl },
      { id: 'liftIn2', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 2100 } },
    ],
    connections: [{ from: 'liftIn2:bottom', to: 'spl:Output3' }],
  });
  const li2 = idx(r4, 'liftIn2');
  await post({
    entities: [{ id: 'li2', index: li2 }, { id: 'c3', index: c3 }],
    connections: [{ from: 'li2:top', to: 'c3:Input0', belt: 6 }],
  });
  console.log(`LiftIn2: ${li2} → c3`);

  // 5. Merger + belt from c1:Output0
  const r5 = await post({
    anchor,
    entities: [
      { id: 'c1', index: c1 },
      { id: 'mrg', type: 'merger', position: { x: 0, y: 800, z: 0 } },
    ],
    connections: [{ from: 'c1:Output0', to: 'mrg:Input1', belt: 6 }],
  });
  const mrg = idx(r5, 'mrg');
  console.log(`Merger: mrg=${mrg}`);

  // 6. LiftOut1 → mrg:Input2 + belt ← c2:Output0
  const r6 = await post({
    entities: [
      { id: 'mrg', index: mrg },
      { id: 'liftOut1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 1100 } },
    ],
    connections: [{ from: 'liftOut1:bottom', to: 'mrg:Input2' }],
  });
  const lo1 = idx(r6, 'liftOut1');
  await post({
    entities: [{ id: 'c2', index: c2 }, { id: 'lo1', index: lo1 }],
    connections: [{ from: 'c2:Output0', to: 'lo1:top', belt: 6 }],
  });
  console.log(`LiftOut1: c2 → ${lo1}`);

  // 7. LiftOut2 → mrg:Input3 + belt ← c3:Output0
  const r7 = await post({
    entities: [
      { id: 'mrg', index: mrg },
      { id: 'liftOut2', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 2100 } },
    ],
    connections: [{ from: 'liftOut2:bottom', to: 'mrg:Input3' }],
  });
  const lo2 = idx(r7, 'liftOut2');
  await post({
    entities: [{ id: 'c3', index: c3 }, { id: 'lo2', index: lo2 }],
    connections: [{ from: 'c3:Output0', to: 'lo2:top', belt: 6 }],
  });
  console.log(`LiftOut2: c3 → ${lo2}`);

  console.log('DONE — 15 entities created');
}

main().catch(err => { console.error(err.message); process.exit(1); });
