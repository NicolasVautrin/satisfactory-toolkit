const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, writeSaveToFile, initSession } = require('../satisfactoryLib');
const Blueprint = require('../lib/Blueprint');

const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614');
const BP_DIR     = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/blueprints/08072023');
const INPUT_SAV  = `${GAME_SAVES}/TEST.sav`;
const OUTPUT_SAV = `${GAME_SAVES}/TEST_edit.sav`;

// Blueprint to inject
const BP_NAME = 'manufacturer x3 uranium';
const SBP_PATH = `${BP_DIR}/${BP_NAME}.sbp`;
const CFG_PATH = `${BP_DIR}/${BP_NAME}.sbpcfg`;

// Player position (from save)
const PLAYER_X = 293834;
const PLAYER_Y = 94610;
const PLAYER_Z = -54;

// ── Load save ──────────────────────────────────────────────────────
const buf  = readFileAsArrayBuffer(INPUT_SAV);
const save = Parser.ParseSave('TEST', buf);

const mainLevel  = Object.values(save.levels).find(l => l.objects?.length > 1000);
const allObjects = Object.values(save.levels).flatMap(l => l.objects);

const sessionId = initSession();
console.log('Session:', sessionId);

// ── Load and inject blueprint ──────────────────────────────────────
const bp = Blueprint.fromFile(SBP_PATH, CFG_PATH, PLAYER_X, PLAYER_Y, PLAYER_Z);
console.log(`Blueprint "${BP_NAME}" loaded: ${bp._objects.length} objects`);

// Inject into save
const newObjects = bp.allObjects();
mainLevel.objects.push(...newObjects);
console.log(`Injected ${newObjects.length} objects at (${PLAYER_X}, ${PLAYER_Y}, ${PLAYER_Z})`);

// ── Save ───────────────────────────────────────────────────────────
writeSaveToFile(save, OUTPUT_SAV);
console.log('Saved to', OUTPUT_SAV);
