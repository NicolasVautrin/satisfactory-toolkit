/**
 * Test script: creates a conveyor belt with a merger attached,
 * and a pipe with a junction attached.
 *
 * - Conveyor: pole stack(1) → pole stack(3), merger at midpoint
 * - Pipe: support → support, junction at midpoint
 *
 * Usage: node bin/testAttach.js [input.sav] [output.sav]
 */
const fs = require('fs');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer, Vector3D,
  ConveyorBelt, ConveyorPole, ConveyorMerger,
  Pipe, PipeSupport, PipeJunction,
} = require('../satisfactoryLib');

const INPUT_SAV = process.argv[2] || './bin/FICSIT_MAX_backup.sav';
const OUTPUT_SAV = process.argv[3] || './bin/FICSIT_MAX_test_attach.sav';

// Player position (from save)
const PLAYER = { x: -238781, y: -217041, z: 3475 };

// ============================
// MAIN
// ============================
console.log(`Parsing ${INPUT_SAV}...`);
const t0 = Date.now();
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer(INPUT_SAV));
console.log(`Parsed in ${Date.now() - t0}ms`);

const pl = save.levels['Persistent_Level'];
const newObjects = [];

function add(...items) {
  for (const item of items) {
    if (Array.isArray(item)) {
      // stack of poles
      for (const pole of item) newObjects.push(pole.entity, ...pole.components);
    } else {
      newObjects.push(item.entity, ...item.components);
    }
  }
}

// ============================================================
// CONVEYOR: pole stack(1) → pole stack(3) with merger at middle
// ============================================================
const BELT_Y = PLAYER.y + 500;

// Stack of 1 pole at start
const poleStack1 = ConveyorPole.createStack(PLAYER.x, BELT_Y, PLAYER.z, 1);
const pole1Top = poleStack1[poleStack1.length - 1];

// Stack of 3 poles at end (1500u away along X)
const poleStack3 = ConveyorPole.createStack(PLAYER.x + 1500, BELT_Y, PLAYER.z, 3);
const pole3Top = poleStack3[poleStack3.length - 1];

// Create belt between the two top poles
// pole port('0') = +X side, port('1') = -X side
const belt = ConveyorBelt.create(pole1Top.port(ConveyorPole.Ports.SIDE0), pole3Top.port(ConveyorPole.Ports.SIDE1));
pole1Top.port(ConveyorPole.Ports.SIDE0).attach(belt.port(ConveyorBelt.Ports.INPUT));
pole3Top.port(ConveyorPole.Ports.SIDE1).attach(belt.port(ConveyorBelt.Ports.OUTPUT));

console.log('Belt created between pole stack(1) and pole stack(3)');

// Attach merger at midpoint
const merger = ConveyorMerger.create(0, 0, 0);
const p1Snap = pole1Top.port(ConveyorPole.Ports.SIDE0);
const p3Snap = pole3Top.port(ConveyorPole.Ports.SIDE1);
const midBelt = new Vector3D(
  (p1Snap.pos.x + p3Snap.pos.x) / 2,
  (p1Snap.pos.y + p3Snap.pos.y) / 2,
  (p1Snap.pos.z + p3Snap.pos.z) / 2,
);
const belt2 = belt.attachMerger(merger, midBelt);

console.log('Merger attached at midpoint of belt');

add(poleStack1, poleStack3, belt, belt2, merger);

// ============================================================
// PIPE: support → support with junction at middle
// ============================================================
const PIPE_Y = PLAYER.y + 1000;

// Support 1
const ps1 = PipeSupport.create(PLAYER.x, PIPE_Y, PLAYER.z);
// Support 2, 1500u away along X
const ps2 = PipeSupport.create(PLAYER.x + 1500, PIPE_Y, PLAYER.z);

// Create pipe between the two supports
const pipe = Pipe.create(ps1.port(PipeSupport.Ports.SIDE0), ps2.port(PipeSupport.Ports.SIDE1));
ps1.port(PipeSupport.Ports.SIDE0).attach(pipe.port(Pipe.Ports.CONN0));
ps2.port(PipeSupport.Ports.SIDE1).attach(pipe.port(Pipe.Ports.CONN1));

console.log('Pipe created between 2 supports');

// Attach junction at midpoint
const junction = PipeJunction.create(0, 0, 0);
const ps1Snap = ps1.port(PipeSupport.Ports.SIDE0);
const ps2Snap = ps2.port(PipeSupport.Ports.SIDE1);
const midPipe = new Vector3D(
  (ps1Snap.pos.x + ps2Snap.pos.x) / 2,
  (ps1Snap.pos.y + ps2Snap.pos.y) / 2,
  (ps1Snap.pos.z + ps2Snap.pos.z) / 2,
);
const pipe2 = pipe.attachJunction(junction, midPipe);

console.log('Junction attached at midpoint of pipe');

add(ps1, ps2, pipe, pipe2, junction);

// ============================================================
// Inject into save and write
// ============================================================
for (const obj of newObjects) {
  pl.objects.push(obj);
}
console.log(`\nAdded ${newObjects.length} objects`);

console.log(`\nWriting ${OUTPUT_SAV}...`);
const t1 = Date.now();
let headerBuf;
const bodyChunks = [];
Parser.WriteSave(save,
  h => { headerBuf = h; },
  c => { bodyChunks.push(c); }
);
const outputBuf = Buffer.concat([headerBuf, ...bodyChunks]);
fs.writeFileSync(OUTPUT_SAV, outputBuf);
console.log(`Written in ${Date.now() - t1}ms (${(outputBuf.length / 1024 / 1024).toFixed(1)} MB)`);
console.log('\nDone! Load the save to see the conveyor+merger and pipe+junction.');
