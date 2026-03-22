const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer, writeSaveToFile, initSession,
  TrainStation, BeltStation, RailroadTrack,
  Locomotive, FreightWagon, Train,
  RailroadSubsystem, Vector3D,
} = require('../satisfactoryLib');

const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614');
const INPUT_SAV  = `${GAME_SAVES}/TEST.sav`;
const OUTPUT_SAV = `${GAME_SAVES}/TEST_edit.sav`;

console.log('Reading save...');
const buf = readFileAsArrayBuffer(INPUT_SAV);
const save = Parser.ParseSave('TEST.sav', buf);

const mainLevel = Object.values(save.levels).find(l => l.objects?.length > 1000);
const allObjects = Object.values(save.levels).flatMap(l => l.objects);

const sessionId = initSession();
console.log('Session:', sessionId);

// ─── Read markers "station A" and "station B" ───────────────────────────────
const mapMgr = allObjects.find(o => o.typePath?.includes('FGMapManager'));
const markers = mapMgr.properties.mMapMarkers?.values || [];

function findMarker(name) {
  const m = markers.find(m => {
    const n = m.value?.properties?.Name?.value || '';
    return n.toLowerCase().trim() === name.toLowerCase();
  });
  if (!m) throw new Error(`Marker "${name}" not found in save`);
  const loc = m.value.properties.Location.value.properties;
  return { x: loc.X.value, y: loc.Y.value, z: loc.Z.value };
}

const mA = findMarker('station A');
const mB = findMarker('station B');
console.log(`Marker A: (${mA.x}, ${mA.y}, ${mA.z})`);
console.log(`Marker B: (${mB.x}, ${mB.y}, ${mB.z})`);

// ─── Config ──────────────────────────────────────────────────────────────────
const Z = -1000;  // Rail Z level (from existing infrastructure nearby)

// Both stations face south (-Y), matching A→B direction.
// -90° around Z: sin(-45°) = -0.7071, cos(-45°) = 0.7071
// local +X → world -Y (south)
const rot = { x: 0, y: 0, z: -0.7071067811865476, w: 0.7071067811865476 };

const BYPASS_OFFSET = 6000;  // lateral offset west (-X) for bypass rail
const BYPASS_EXTEND = 2000;  // extend bypass beyond gare bounds for smoother turns

// ─── Create stations ─────────────────────────────────────────────────────────
// dockStation(belt) places belt SOUTH of station (side 0 = back = +X local = -Y world)
// Layout per gare (north → south): StationX.TC1 — [Station] — [Belt] — BeltX.TC0

const stationA = TrainStation.create(mA.x, mA.y, Z, rot, { name: 'Gare A' });
const beltA    = BeltStation.create(0, 0, 0);
stationA.dockStation(beltA);

const stationB = TrainStation.create(mB.x, mB.y, Z, rot, { name: 'Gare B' });
const beltB    = BeltStation.create(0, 0, 0);
stationB.dockStation(beltB);

// ─── Port positions ──────────────────────────────────────────────────────────
const northA = stationA.port('TrackConnection1');  // north end of Gare A
const southA = beltA.port('TrackConnection0');     // south end of Gare A
const northB = stationB.port('TrackConnection1');  // north end of Gare B
const southB = beltB.port('TrackConnection0');     // south end of Gare B

// ─── Main track: southA → northB (single track between stations) ─────────────
const mainDir = northB.pos.sub(southA.pos).norm();
const mainTrack = RailroadTrack.create(
  { pos: southA.pos, dir: mainDir },
  { pos: northB.pos, dir: mainDir },
);
// SWITCH at southA: main track + bypass A
beltA.track.connect('TrackConnection0', mainTrack, 'TrackConnection0');
// SWITCH at northB: main track + bypass B
stationB.track.connect('TrackConnection1', mainTrack, 'TrackConnection1');

// ─── Bypass A: southA → 3-segment loop west → northA ────────────────────────
// Layout: 90° turn south→west, straight north on west side, 90° turn east→north
//
//                northA
//                  ↑ seg3 (90° east→north)
//   NW_A ─────────╯
//     │
//     │ seg2 (straight north)
//     │
//   SW_A ─────────╮
//                  ↓ seg1 (90° south→west)
//                southA

const avgAX = (southA.pos.x + northA.pos.x) / 2;
const swA = new Vector3D(avgAX - BYPASS_OFFSET, southA.pos.y - BYPASS_EXTEND, Z);
const nwA = new Vector3D(avgAX - BYPASS_OFFSET, northA.pos.y + BYPASS_EXTEND, Z);

const bypassA1 = RailroadTrack.create(
  { pos: southA.pos, dir: new Vector3D(0, -1, 0) },   // depart south
  { pos: swA,        dir: new Vector3D(-1, 0, 0) },    // arrive heading west
);
const bypassA2 = RailroadTrack.create(
  { pos: swA, dir: new Vector3D(0, 1, 0) },            // depart north
  { pos: nwA, dir: new Vector3D(0, 1, 0) },            // arrive north (straight section)
);
const bypassA3 = RailroadTrack.create(
  { pos: nwA,        dir: new Vector3D(1, 0, 0) },     // depart east
  { pos: northA.pos, dir: new Vector3D(0, 1, 0) },     // arrive heading north
);
bypassA1.connect('TrackConnection1', bypassA2, 'TrackConnection0');
bypassA2.connect('TrackConnection1', bypassA3, 'TrackConnection0');
beltA.track.connect('TrackConnection0', bypassA1, 'TrackConnection0');       // SWITCH at southA
stationA.track.connect('TrackConnection1', bypassA3, 'TrackConnection1');    // connect to northA

// ─── Bypass B: southB → 3-segment loop west → northB ────────────────────────
const avgBX = (southB.pos.x + northB.pos.x) / 2;
const swB = new Vector3D(avgBX - BYPASS_OFFSET, southB.pos.y - BYPASS_EXTEND, Z);
const nwB = new Vector3D(avgBX - BYPASS_OFFSET, northB.pos.y + BYPASS_EXTEND, Z);

const bypassB1 = RailroadTrack.create(
  { pos: southB.pos, dir: new Vector3D(0, -1, 0) },
  { pos: swB,        dir: new Vector3D(-1, 0, 0) },
);
const bypassB2 = RailroadTrack.create(
  { pos: swB, dir: new Vector3D(0, 1, 0) },
  { pos: nwB, dir: new Vector3D(0, 1, 0) },
);
const bypassB3 = RailroadTrack.create(
  { pos: nwB,        dir: new Vector3D(1, 0, 0) },
  { pos: northB.pos, dir: new Vector3D(0, 1, 0) },
);
bypassB1.connect('TrackConnection1', bypassB2, 'TrackConnection0');
bypassB2.connect('TrackConnection1', bypassB3, 'TrackConnection0');
beltB.track.connect('TrackConnection0', bypassB1, 'TrackConnection0');       // connect to southB
stationB.track.connect('TrackConnection1', bypassB3, 'TrackConnection1');    // SWITCH at northB

// ─── Dump positions ──────────────────────────────────────────────────────────
const fmt = p => `(${[p.x, p.y, p.z].map(v => Math.round(v)).join(', ')})`;

console.log('\n--- Gare A ---');
console.log('StationA:', fmt(stationA.entity.transform.translation));
console.log('BeltA:   ', fmt(beltA.entity.transform.translation));
console.log('  northA (StA.TC1):', fmt(northA.pos));
console.log('  southA (BtA.TC0):', fmt(southA.pos));
console.log('  bypass SW:', fmt(swA), ' NW:', fmt(nwA));

console.log('\n--- Gare B ---');
console.log('StationB:', fmt(stationB.entity.transform.translation));
console.log('BeltB:   ', fmt(beltB.entity.transform.translation));
console.log('  northB (StB.TC1):', fmt(northB.pos));
console.log('  southB (BtB.TC0):', fmt(southB.pos));
console.log('  bypass SW:', fmt(swB), ' NW:', fmt(nwB));

console.log('\n--- Main track ---');
console.log('from:', fmt(southA.pos), 'to:', fmt(northB.pos));
console.log('length:', Math.round(northB.pos.sub(southA.pos).length));

// ─── Verify junctions ───────────────────────────────────────────────────────
console.log('\n--- Junctions ---');
const junctions = [
  ['StA.TC0 ↔ BltA.TC1 (dock)',  stationA.track._ports.TrackConnection0.pos, beltA.track._ports.TrackConnection1.pos],
  ['southA ↔ main.TC0',          southA.pos, mainTrack._ports.TrackConnection0.pos],
  ['southA ↔ bypA1.TC0',         southA.pos, bypassA1._ports.TrackConnection0.pos],
  ['bypA1.TC1 ↔ bypA2.TC0',      bypassA1._ports.TrackConnection1.pos, bypassA2._ports.TrackConnection0.pos],
  ['bypA2.TC1 ↔ bypA3.TC0',      bypassA2._ports.TrackConnection1.pos, bypassA3._ports.TrackConnection0.pos],
  ['northA ↔ bypA3.TC1',         northA.pos, bypassA3._ports.TrackConnection1.pos],
  ['northB ↔ main.TC1',          northB.pos, mainTrack._ports.TrackConnection1.pos],
  ['northB ↔ bypB3.TC1',         northB.pos, bypassB3._ports.TrackConnection1.pos],
  ['bypB2.TC1 ↔ bypB3.TC0',      bypassB2._ports.TrackConnection1.pos, bypassB3._ports.TrackConnection0.pos],
  ['bypB1.TC1 ↔ bypB2.TC0',      bypassB1._ports.TrackConnection1.pos, bypassB2._ports.TrackConnection0.pos],
  ['southB ↔ bypB1.TC0',         southB.pos, bypassB1._ports.TrackConnection0.pos],
  ['StB.TC0 ↔ BltB.TC1 (dock)',  stationB.track._ports.TrackConnection0.pos, beltB.track._ports.TrackConnection1.pos],
];
for (const [label, a, b] of junctions) {
  const dist = new Vector3D(a).sub(b).length;
  console.log(`  ${label}: ${dist < 1 ? 'OK' : 'MISMATCH dist=' + dist.toFixed(0)}`);
}

// ─── Verify switches ────────────────────────────────────────────────────────
console.log('\n--- Switches (expect 2 connections each) ---');
const southAconns = beltA.track.components[0].properties?.mConnectedComponents?.values?.length || 0;
const northBconns = stationB.track.components[1].properties?.mConnectedComponents?.values?.length || 0;
console.log(`  BeltA.TC0 (southA):    ${southAconns} connections`);
console.log(`  StationB.TC1 (northB): ${northBconns} connections`);

// ─── Create train (locomotive + freight wagon) ──────────────────────────────
const playerState = allObjects.find(o => o.typePath?.includes('BP_PlayerState_C'));
const ownerOpts = playerState ? { ownerPlayerState: playerState.instanceName } : {};

const loco = Locomotive.create(
  stationA.entity.transform.translation.x,
  stationA.entity.transform.translation.y,
  Z + 50,
  rot,
  ownerOpts,
);

const wagon = FreightWagon.create(
  beltA.entity.transform.translation.x,
  beltA.entity.transform.translation.y,
  Z + 50,
  rot,
  ownerOpts,
);

// Place vehicles on the integrated tracks of their respective platforms
loco.setTrackPosition(stationA.track, 800, 1);
wagon.setTrackPosition(beltA.track, 800, 1);

// Create train with timetable: Gare A → Gare B (loop)
const train = Train.create(
  [loco, wagon],
  [stationA.stationId.instanceName, stationB.stationId.instanceName],
);

console.log('\n--- Train ---');
console.log('Locomotive:', loco.inst);
console.log('Wagon:     ', wagon.inst);
console.log('Train:     ', train.inst);
console.log('Timetable: Gare A → Gare B (loop)');

// ─── Loop circuit explanation ────────────────────────────────────────────────
console.log('\n--- Loop circuit ---');
console.log('A→B: Gare A (south exit) → main track → Gare B (north entry)');
console.log('B→A: Gare B (south exit) → bypass B (U-turn) → main track (north) → bypass A (U-turn) → Gare A (north entry)');

// ─── Register in RailroadSubsystem (mandatory!) ─────────────────────────────
const rrSub = RailroadSubsystem.find(allObjects);
rrSub.registerStation(stationA);
rrSub.registerStation(stationB);
rrSub.registerTrain(train);
console.log('\nRegistered 2 stations + 1 train in RailroadSubsystem');

// ─── Inject all objects ──────────────────────────────────────────────────────
const objs = [
  ...stationA.allObjects(), ...beltA.allObjects(),
  ...stationB.allObjects(), ...beltB.allObjects(),
  ...mainTrack.allObjects(),
  ...bypassA1.allObjects(), ...bypassA2.allObjects(), ...bypassA3.allObjects(),
  ...bypassB1.allObjects(), ...bypassB2.allObjects(), ...bypassB3.allObjects(),
  ...train.allObjects(),
];
console.log(`\nInjecting ${objs.length} objects`);
for (const obj of objs) {
  mainLevel.objects.push(obj);
}

// ─── Save ────────────────────────────────────────────────────────────────────
console.log('Writing save...');
const size = writeSaveToFile(save, OUTPUT_SAV);
console.log(`Done! ${(size / 1024 / 1024).toFixed(1)} MB -> ${OUTPUT_SAV}`);
