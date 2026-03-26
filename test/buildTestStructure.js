const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer, writeSaveToFile, Vector3D,
  ConveyorPole, ConveyorBelt, ConveyorMerger,
  PipeSupport, Pipe, PipeJunction,
} = require('../satisfactoryLib');

const SAVE_DIR = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614');
const SAVE_PATH = path.join(SAVE_DIR, 'TEST.sav');

console.log('Reading save...');
const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST.sav', buf);


// Collect all regular objects
let allObjects = [];
let mainLevel = null;
for (const [levelId, lvl] of Object.entries(save.levels)) {
  if (lvl.objects) allObjects.push(...lvl.objects);
  if (lvl.objects?.some(o => o.typePath?.includes('Char_Player'))) mainLevel = lvl;
}

// Find player
const playerEntity = allObjects.find(o => o.typePath?.includes('Char_Player') && o.transform?.translation);
const pp = playerEntity.transform.translation;
console.log(`Player: (${pp.x.toFixed(0)}, ${pp.y.toFixed(0)}, ${pp.z.toFixed(0)})`);

// Get lightweight foundations near player
const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
const buildables = lwSub.specialProperties.buildables;
const foundationType = buildables.find(b => b.typeReference.pathName.includes('Foundation_8x1'));

const foundations = foundationType.instances
  .map(inst => ({ pos: inst.transform.translation, dist: new Vector3D(inst.transform.translation).sub(pp).length }))
  .sort((a, b) => a.dist - b.dist);

// Pick 4 foundations in different directions from player
// F1, F2 for conveyors (east-ish), F3, F4 for pipes (west-ish)
const f1 = foundations[0];
const f2 = foundations.find(f => {
  const d = new Vector3D(f.pos).sub(f1.pos).length;
  return d > 1200 && d < 2500;
});
// For pipes, pick foundations on the OTHER side of the player
const pipeDir = new Vector3D(f1.pos.x - pp.x, f1.pos.y - pp.y, 0); // direction player → f1
const f3 = foundations.find(f => {
  const toF = new Vector3D(f.pos.x - pp.x, f.pos.y - pp.y, 0);
  const dot = toF.x * pipeDir.x + toF.y * pipeDir.y;
  return dot < -200 * 200 && f.dist < 2000; // opposite side, within 20m
});
const f4 = f3 && foundations.find(f => {
  const d = new Vector3D(f.pos).sub(f3.pos).length;
  const toF = new Vector3D(f.pos.x - pp.x, f.pos.y - pp.y, 0);
  const dot = toF.x * pipeDir.x + toF.y * pipeDir.y;
  return dot < 0 && d > 1200 && d < 2500;
});

if (!f2 || !f3 || !f4) {
  console.error('Could not find suitable foundations!');
  console.log('f1:', f1?.pos, 'f2:', f2?.pos, 'f3:', f3?.pos, 'f4:', f4?.pos);
  process.exit(1);
}

console.log(`\nConveyor: F1 (${(f1.dist/100).toFixed(1)}m) → F2 (${(f2.dist/100).toFixed(1)}m), gap ${(new Vector3D(f1.pos).sub(f2.pos).length/100).toFixed(1)}m`);
console.log(`Pipe:     F3 (${(f3.dist/100).toFixed(1)}m) → F4 (${(f4.dist/100).toFixed(1)}m), gap ${(new Vector3D(f3.pos).sub(f4.pos).length/100).toFixed(1)}m`);

const newObjects = [];
function inject(...objs) { newObjects.push(...objs); }

// Foundation 8x1 = 100u tall, entity origin at center → top surface at Z + 50
// ConveyorPole: entity origin is at top of pole, snap is 100u below.
// So for snap to be AT foundation top level, place pole at foundationZ + 50 + 100 = foundationZ + 150
// For snap to be ABOVE foundation, add more: foundationZ + 150 gives snap at foundationZ + 50 (top surface)
const POLE_BASE_Z = 150; // above foundation origin → snap at foundation top

// PipeSupport: snap is 375u above entity origin.
// Place entity at foundation top → snap at foundationZ + 50 + 375 = foundationZ + 425
const PIPE_BASE_Z = 50; // above foundation origin → entity at foundation top

// ========================================
// CONVEYOR SECTION
// ========================================
console.log('\n--- Conveyor structure ---');

const poleStack1 = ConveyorPole.createStack(f1.pos.x, f1.pos.y, f1.pos.z + POLE_BASE_Z, 1);
for (const p of poleStack1) inject(...p.allObjects());
const topPole1 = poleStack1[poleStack1.length - 1];

const poleStack5 = ConveyorPole.createStack(f2.pos.x, f2.pos.y, f2.pos.z + POLE_BASE_Z, 5);
for (const p of poleStack5) inject(...p.allObjects());
const topPole5 = poleStack5[poleStack5.length - 1];

const snap1 = topPole1.port(ConveyorPole.Ports.SIDE0).pos;
const snap5 = topPole5.port(ConveyorPole.Ports.SIDE1).pos;
console.log(`  Pole 1 snap: Z=${snap1.z.toFixed(0)}`);
console.log(`  Pole 5 snap: Z=${snap5.z.toFixed(0)}`);

// Create belt: pole1 side0 → pole5 side1
const belt = ConveyorBelt.create(null, null, 5);
belt.port(ConveyorBelt.Ports.INPUT).pos = { ...snap1 };
belt.port(ConveyorBelt.Ports.INPUT).dir = topPole1.port(ConveyorPole.Ports.SIDE0).dir;
belt.port(ConveyorBelt.Ports.OUTPUT).pos = { ...snap5 };
belt.port(ConveyorBelt.Ports.OUTPUT).dir = topPole5.port(ConveyorPole.Ports.SIDE1).dir;
belt.onPortSnapped();
belt.port(ConveyorBelt.Ports.INPUT).attach(topPole1.port(ConveyorPole.Ports.SIDE0));
belt.port(ConveyorBelt.Ports.OUTPUT).attach(topPole5.port(ConveyorPole.Ports.SIDE1));
inject(...belt.allObjects());
console.log(`  Belt from (${snap1.x.toFixed(0)},${snap1.y.toFixed(0)},${snap1.z.toFixed(0)}) to (${snap5.x.toFixed(0)},${snap5.y.toFixed(0)},${snap5.z.toFixed(0)})`);

// Merger at belt midpoint
const midBelt = new Vector3D(
  (snap1.x + snap5.x) / 2,
  (snap1.y + snap5.y) / 2,
  (snap1.z + snap5.z) / 2,
);
const merger = ConveyorMerger.create(0, 0, 0);
const belt2 = belt.attachMerger(merger, midBelt);
inject(...merger.allObjects());
inject(...belt2.allObjects());
const mp = merger.entity.transform.translation;
console.log(`  Merger at (${mp.x.toFixed(0)},${mp.y.toFixed(0)},${mp.z.toFixed(0)})`);

// ========================================
// PIPE SECTION
// ========================================
console.log('\n--- Pipe structure ---');

const pipeStack1 = PipeSupport.createStack(f3.pos.x, f3.pos.y, f3.pos.z + PIPE_BASE_Z, 1);
for (const ps of pipeStack1) inject(...ps.allObjects());
const topPS1 = pipeStack1[pipeStack1.length - 1];

const pipeStack5 = PipeSupport.createStack(f4.pos.x, f4.pos.y, f4.pos.z + PIPE_BASE_Z, 5);
for (const ps of pipeStack5) inject(...ps.allObjects());
const topPS5 = pipeStack5[pipeStack5.length - 1];

const psnap1 = topPS1.port(PipeSupport.Ports.SIDE0).pos;
const psnap5 = topPS5.port(PipeSupport.Ports.SIDE1).pos;
console.log(`  Support 1 snap: Z=${psnap1.z.toFixed(0)}`);
console.log(`  Support 5 snap: Z=${psnap5.z.toFixed(0)}`);

// Create pipe: support1 side0 → support5 side1
const pipe = Pipe.create(topPS1.port(PipeSupport.Ports.SIDE0), topPS5.port(PipeSupport.Ports.SIDE1));
pipe.port(Pipe.Ports.CONN0).attach(topPS1.port(PipeSupport.Ports.SIDE0));
pipe.port(Pipe.Ports.CONN1).attach(topPS5.port(PipeSupport.Ports.SIDE1));
inject(...pipe.allObjects());
console.log(`  Pipe from (${psnap1.x.toFixed(0)},${psnap1.y.toFixed(0)},${psnap1.z.toFixed(0)}) to (${psnap5.x.toFixed(0)},${psnap5.y.toFixed(0)},${psnap5.z.toFixed(0)})`);

// Junction at pipe midpoint
const midPipe = new Vector3D(
  (psnap1.x + psnap5.x) / 2,
  (psnap1.y + psnap5.y) / 2,
  (psnap1.z + psnap5.z) / 2,
);
const junction = PipeJunction.create(0, 0, 0);
const pipe2 = pipe.attachJunction(junction, midPipe);
inject(junction.entity, ...junction.components);
inject(...pipe2.allObjects());
const jp = junction.entity.transform.translation;
console.log(`  Junction at (${jp.x.toFixed(0)},${jp.y.toFixed(0)},${jp.z.toFixed(0)})`);

// ========================================
// INJECT INTO SAVE
// ========================================
console.log(`\nInjecting ${newObjects.length} new objects...`);
mainLevel.objects.push(...newObjects);

console.log('Writing save...');
const OUTPUT_PATH = path.join(SAVE_DIR, 'TEST_edit.sav');
const size = writeSaveToFile(save, OUTPUT_PATH);
console.log(`Done! ${(size / 1024 / 1024).toFixed(1)} MB`);
