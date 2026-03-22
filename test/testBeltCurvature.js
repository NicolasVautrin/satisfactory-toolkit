/**
 * Test belt curvature limits by creating belts attached to poles.
 * - Config A: Flat belt courbé — poles rapprochés de 1m vs l'original
 * - Config B: Belt 31° — endpoint haut décalé de 1m latéralement vs l'original
 *
 * Usage: node bin/testBeltCurvature.js
 */
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer, writeSaveToFile, Vector3D,
} = require('../satisfactoryLib');
const ConveyorPole = require('../lib/logistic/ConveyorPole');
const ConveyorBelt = require('../lib/logistic/ConveyorBelt');

const GAME_SAVES = 'C:/Users/nicolasv/AppData/Local/FactoryGame/Saved/SaveGames/76561198036887614';
const INPUT_SAV = `${GAME_SAVES}/TEST.sav`;
const OUTPUT_SAV = `${GAME_SAVES}/TEST_edit.sav`;

console.log(`Parsing ${INPUT_SAV}...`);
const save = Parser.ParseSave('TEST', readFileAsArrayBuffer(INPUT_SAV));
console.log('Parsed.');

const pl = save.levels['Persistent_Level'];
const newObjects = [];

function add(...items) {
  for (const item of items) {
    if (Array.isArray(item)) {
      for (const sub of item) newObjects.push(sub.entity, ...sub.components);
    } else {
      newObjects.push(item.entity, ...item.components);
    }
  }
}

function quatZ(angle) {
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

/**
 * Figure out which side (0 or 1) of a pole faces toward a target position.
 * Returns the side index whose direction has a positive dot product with the target vector.
 */
function poleSideToward(pole, targetPos) {
  const snapPos = pole.port(ConveyorPole.Ports.SIDE0).pos;
  const toTarget = new Vector3D(targetPos).sub(snapPos).norm();
  const dir0 = pole.port(ConveyorPole.Ports.SIDE0).dir;
  const dot = dir0.x * toTarget.x + dir0.y * toTarget.y + dir0.z * toTarget.z;
  return dot > 0 ? ConveyorPole.Ports.SIDE0 : ConveyorPole.Ports.SIDE1;
}

// ==================================================================
// Reference from save:
//
// Flat curved belt (2pts):
//   Belt start: (-259879, -197349, 1761)
//   Belt end:   (-259742, -197725, 1761)
//   Pole1: (-259879, -197349, 1461) rot=q(0,0,-0.985,0.174)
//   Pole2: (-259742, -197725, 1461) rot=q(0,0,-0.985,0.174)
//   Both poles parallel, same rotation.
//   SNAP_OFFSET = +300 → snap z = 1461+300 = 1761 ✓
//
// Steep belt 31° (4pts):
//   Belt start: (-258990, -198622, 1761)
//   Belt end:   (-258529, -199305, 2261)
//   Pole1: (-258990, -198622, 1461) rot=q(0,0,0.819,0.574)
//   Pole2 at end: need to figure out z from belt end z=2261, so pole z = 2261-300 = 1961
//   Pole2 rotation: same as pole1
// ==================================================================

const PERP_OFFSET = 500; // offset to avoid overlapping with originals

// ==================================================================
// Config A: Flat belt — rapprocher 100u (50u each side)
// ==================================================================
{
  const poleRot = { x: 0, y: 0, z: -0.985, w: 0.174 };
  const refPole1 = new Vector3D(-259879, -197349, 1461);
  const refPole2 = new Vector3D(-259742, -197725, 1461);
  const beltDir = new Vector3D(refPole2).sub(refPole1).norm();
  const perpDir = new Vector3D(-beltDir.y, beltDir.x, 0);
  const offset = new Vector3D(perpDir).scale(PERP_OFFSET);

  const pole1Pos = new Vector3D(refPole1).add(new Vector3D(beltDir).scale(50)).add(offset);
  const pole2Pos = new Vector3D(refPole2).sub(new Vector3D(beltDir).scale(50)).add(offset);

  const pole1 = ConveyorPole.create(pole1Pos.x, pole1Pos.y, pole1Pos.z, poleRot);
  const pole2 = ConveyorPole.create(pole2Pos.x, pole2Pos.y, pole2Pos.z, poleRot);

  // Pick the right side of each pole based on direction toward the other
  const side1 = poleSideToward(pole1, pole2.port(ConveyorPole.Ports.SIDE0).pos);
  const side2 = poleSideToward(pole2, pole1.port(ConveyorPole.Ports.SIDE0).pos);

  const belt = ConveyorBelt.create(pole1.port(side1), pole2.port(side2), 1);
  pole1.port(side1).attach(belt.port(ConveyorBelt.Ports.INPUT));
  pole2.port(side2).attach(belt.port(ConveyorBelt.Ports.OUTPUT));

  add(pole1, pole2, belt);

  console.log(`\nConfig A (flat, shorter):`);
  console.log(`  pole1 entity z=${pole1Pos.z.toFixed(0)}, snap z=${pole1.port(ConveyorPole.Ports.SIDE0).pos.z.toFixed(0)}`);
  console.log(`  pole2 entity z=${pole2Pos.z.toFixed(0)}, snap z=${pole2.port(ConveyorPole.Ports.SIDE0).pos.z.toFixed(0)}`);
  console.log(`  side1=${side1}, side2=${side2}`);
}

// ==================================================================
// Config B: Steep belt — décaler endpoint haut de 100u latéralement
//   Same rotation on both poles. Pole z derived from belt endpoint z.
// ==================================================================
{
  const poleRot = { x: 0, y: 0, z: 0.819, w: 0.574 };
  // Pole z = belt endpoint z - SNAP_OFFSET(300)
  const pole1Pos = new Vector3D(-258990, -198622, 1761 - 300); // z=1461
  const refEndBelt = new Vector3D(-258529, -199305, 2261);
  const pole2Pos = new Vector3D(refEndBelt.x, refEndBelt.y, refEndBelt.z - 300); // z=1961

  const horizDir = new Vector3D(pole2Pos.x - pole1Pos.x, pole2Pos.y - pole1Pos.y, 0).norm();
  const perpDir = new Vector3D(-horizDir.y, horizDir.x, 0);
  const offset = new Vector3D(perpDir).scale(PERP_OFFSET);

  // Apply offset + lateral shift on pole2
  const p1 = new Vector3D(pole1Pos).add(offset);
  const p2 = new Vector3D(pole2Pos).add(offset).add(new Vector3D(perpDir).scale(100));

  const pole1 = ConveyorPole.create(p1.x, p1.y, p1.z, poleRot);
  const pole2 = ConveyorPole.create(p2.x, p2.y, p2.z, poleRot);

  const side1 = poleSideToward(pole1, pole2.port(ConveyorPole.Ports.SIDE0).pos);
  const side2 = poleSideToward(pole2, pole1.port(ConveyorPole.Ports.SIDE0).pos);

  const belt = ConveyorBelt.create(pole1.port(side1), pole2.port(side2), 1);
  pole1.port(side1).attach(belt.port(ConveyorBelt.Ports.INPUT));
  pole2.port(side2).attach(belt.port(ConveyorBelt.Ports.OUTPUT));

  add(pole1, pole2, belt);

  console.log(`\nConfig B (steep, shifted):`);
  console.log(`  pole1 entity z=${p1.z.toFixed(0)}, snap z=${pole1.port(ConveyorPole.Ports.SIDE0).pos.z.toFixed(0)}`);
  console.log(`  pole2 entity z=${p2.z.toFixed(0)}, snap z=${pole2.port(ConveyorPole.Ports.SIDE0).pos.z.toFixed(0)}`);
  console.log(`  side1=${side1}, side2=${side2}`);
}

// ==================================================================
// Inject and save
// ==================================================================
for (const obj of newObjects) {
  pl.objects.push(obj);
}

console.log(`\nInjected ${newObjects.length} objects. Saving to TEST_edit...`);
const size = writeSaveToFile(save, OUTPUT_SAV);
console.log(`Saved to ${OUTPUT_SAV} (${(size / 1024 / 1024).toFixed(1)} MB)`);
