/**
 * Test script: places 2 pipe supports with different rotations near the player,
 * and connects a pipe between them.
 *
 * Usage: node bin/testPipeSupports.js [input.sav] [output.sav]
 */
const fs = require('fs');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer,
  Pipe, PipeSupport,
} = require('../satisfactoryLib');

const INPUT_SAV = process.argv[2] || './bin/FICSIT_MAX_backup.sav';
const OUTPUT_SAV = process.argv[3] || './bin/FICSIT_MAX_test_supports.sav';

// Player position from save
const PLAYER = { x: -238781, y: -217041, z: 3475 };


// ============================
// MAIN
// ============================
console.log(`Parsing ${INPUT_SAV}...`);
const t0 = Date.now();
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer(INPUT_SAV));
console.log(`Parsed in ${Date.now() - t0}ms`);

const pl = save.levels['Persistent_Level'];
const newEntities = [];

function addEntities(...items) {
  for (const item of items) {
    newEntities.push(item.entity, ...item.components);
  }
}

// Support 1: 500u devant le joueur (Y+), rotation identité
const s1 = PipeSupport.create(PLAYER.x, PLAYER.y + 500, PLAYER.z);
addEntities(s1);
console.log(`Support 1: identity rotation at (${PLAYER.x}, ${PLAYER.y + 500}, ${PLAYER.z})`);

// Support 2: 1500u devant le joueur (Y+), tourné 45° autour de Z
const angle = Math.PI / 4; // 45°
const rot45z = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
const s2 = PipeSupport.create(PLAYER.x, PLAYER.y + 1500, PLAYER.z, rot45z);
addEntities(s2);
console.log(`Support 2: 45° Z rotation at (${PLAYER.x}, ${PLAYER.y + 1500}, ${PLAYER.z})`);

// Pipe between the two supports
const pipe = Pipe.create(s1.port(PipeSupport.Ports.SIDE0), s2.port(PipeSupport.Ports.SIDE1));
addEntities(pipe);
s1.port(PipeSupport.Ports.SIDE0).attach(pipe.port(Pipe.Ports.CONN0));
s2.port(PipeSupport.Ports.SIDE1).attach(pipe.port(Pipe.Ports.CONN1));
console.log(`Pipe between support 1 (port 0) and support 2 (port 1)`);

// Add to save
for (const obj of newEntities) {
  pl.objects.push(obj);
}
console.log(`\nAdded ${newEntities.length} objects`);

// Write
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
console.log('\nDone! Load the save to see the 2 supports + pipe near your position.');
