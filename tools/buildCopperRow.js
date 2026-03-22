const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer, writeSaveToFile, initSession,
  Vector3D, Foundation,
} = require('../satisfactoryLib');
const Refinery = require('../lib/producers/Refinery');

const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614');
const INPUT_SAV  = `${GAME_SAVES}/TEST.sav`;
const OUTPUT_SAV = `${GAME_SAVES}/TEST_edit.sav`;

// ── Layout parameters (from existing pattern) ──────────────────────
const REF_COUNT    = 70;
const REF_X_START  = 291442;
const REF_X_STEP   = 1200;   // 12m between refineries
const REF_Y        = 99508;
const REF_Z        = -152;   // 1st floor
const REF_ROT      = { x: 0, y: 0, z: 0, w: 1 };

const FOUND_Z      = -202;   // foundation Z = refinery Z - 50
const FOUND_Y_ROWS = [98608, 99408, 100208, 101008];
const FOUND_X_STEP = 800;

// ── Load save ──────────────────────────────────────────────────────
const buf  = readFileAsArrayBuffer(INPUT_SAV);
const save = Parser.ParseSave('TEST.sav', buf);

const mainLevel  = Object.values(save.levels).find(l => l.objects?.length > 1000);
const allObjects = Object.values(save.levels).flatMap(l => l.objects);

const sessionId = initSession();
console.log('Session:', sessionId);

// ── Recipe path ────────────────────────────────────────────────────
const RECIPE_PATH = '/Game/FactoryGame/Recipes/AlternateRecipes/New_Update3/Recipe_Alternate_PureCopperIngot.Recipe_Alternate_PureCopperIngot_C';
console.log('Recipe:', RECIPE_PATH);

// ── Collect existing foundations at Z=-202 ─────────────────────────
const lwSub = Foundation.getSubsystem(allObjects);
const buildables = lwSub.specialProperties.buildables;

const existingFoundations = new Set();
for (const b of buildables) {
  if (!b.typeReference.pathName.includes('Foundation_8x1')) continue;
  for (const inst of b.instances) {
    const p = inst.transform.translation;
    if (Math.abs(p.z - FOUND_Z) < 10) {
      existingFoundations.add(`${Math.round(p.x)},${Math.round(p.y)}`);
    }
  }
}
console.log(`Existing foundations at Z=${FOUND_Z}: ${existingFoundations.size}`);

// ── Compute required foundation X positions ────────────────────────
// Each refinery at X occupies [X-500, X+500].
// We need foundations covering the full X span of all 70 refineries.
const refXMin = REF_X_START - 500;
const refXMax = REF_X_START + (REF_COUNT - 1) * REF_X_STEP + 500;

// Foundation grid: align to existing grid (291342 is on grid)
const gridOriginX = 291342;
const foundXStart = gridOriginX + Math.floor((refXMin - gridOriginX) / FOUND_X_STEP) * FOUND_X_STEP;
const foundXEnd   = gridOriginX + Math.ceil((refXMax - gridOriginX) / FOUND_X_STEP) * FOUND_X_STEP;

let newFoundations = 0;
for (let fx = foundXStart; fx <= foundXEnd; fx += FOUND_X_STEP) {
  for (const fy of FOUND_Y_ROWS) {
    const key = `${fx},${fy}`;
    if (!existingFoundations.has(key)) {
      Foundation.create(lwSub, Foundation.Types.F_8x1, fx, fy, FOUND_Z);
      newFoundations++;
    }
  }
}
console.log(`New foundations created: ${newFoundations}`);

// ── Create refineries ──────────────────────────────────────────────
// Skip index 0 (existing refinery at REF_X_START)
const newObjects = [];
let created = 0;

for (let i = 1; i < REF_COUNT; i++) {
  const x = REF_X_START + i * REF_X_STEP;
  const refinery = Refinery.create(x, REF_Y, REF_Z, REF_ROT);
  refinery.setRecipe(RECIPE_PATH);
  newObjects.push(...refinery.allObjects());
  created++;
}

console.log(`Refineries created: ${created} (indices 1-${REF_COUNT - 1})`);
console.log(`Total new objects: ${newObjects.length}`);

// ── Inject into save ───────────────────────────────────────────────
for (const obj of newObjects) {
  mainLevel.objects.push(obj);
}

// ── Write ──────────────────────────────────────────────────────────
const size = writeSaveToFile(save, OUTPUT_SAV);
console.log(`Saved: ${OUTPUT_SAV}`);
console.log(`Size: ${(size / 1024 / 1024).toFixed(1)} MB`);

// ── Summary ────────────────────────────────────────────────────────
console.log('\n=== Row layout ===');
console.log(`X range: ${REF_X_START} .. ${REF_X_START + (REF_COUNT - 1) * REF_X_STEP}`);
console.log(`Y: ${REF_Y}, Z: ${REF_Z}`);
console.log(`Total width: ${(REF_COUNT - 1) * REF_X_STEP / 100}m`);
console.log(`Foundation grid: ${foundXStart}..${foundXEnd} x ${FOUND_Y_ROWS.join(',')} at Z=${FOUND_Z}`);