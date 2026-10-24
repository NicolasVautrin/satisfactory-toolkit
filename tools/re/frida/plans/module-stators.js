// Module de stators de la metallurgie (mer du nord), 90 stators / min, sans fondations (machines posees en l'air) :
//  - etage 0 (eau) : 4 extracteurs a 100 %, poses par un point touche fabrique sur le volume d'eau (loin du joueur) ;
//  - etage 1 (base 0 m) et 1 bis (base +32 m) : 12 raffineries de lingots de fer purs chacun, entrees au sud
//    (ligne de minerai 5 m devant, ligne d'eau 10 m devant et 5 m plus haut), sorties au nord (collecteur 6 m devant) ;
//    tuyaux : les 12 de l'etage 1 et les 5 de l'est de l'etage 1 bis ; fil : les 7 de l'ouest de l'etage 1 bis ;
//  - etage 2 (base +64 m) : 11 piles de 6 posees par pile.js (configurations ecrites par la phase `piles`).
// Colonnes d'eau : un extracteur a chaque bout de chaque ligne d'eau, pompe Mk1 (etage 1) ou Mk2 (etage 1 bis) en bas.
// Lingots : collecteur tuyaux -> relais et ascenseurs a l'est des piles ; collecteur fil -> a l'ouest.
// Repere : axes du monde, nord = -y. Hauteurs : voir les etages du skill satisfactory-live.
//
// Modules suivants : meme montage decale de 60 m vers le nord par module (--module n) ; leurs stators rejoignent la
// descente du module 1 par un tronc a x 123 000 (+64,5 m), phase `sortie`.
//
// usage : node module-stators.js <phase> [--module n] [--dry]
//   phases : extracteurs | raffineries | eau | colonnes | pompes | minerai | collecteurs | montees | courant | piles
//            | liaisons | reglages | evacuation (module 1) | sortie (modules 2 et suivants) | verifie
// Etat : module<n>-stators-state.json a cote de ce fichier (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const argOf = (name) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const MOD = Number(argOf('module') || 1);
const NAME = 'module' + MOD;
const PITCH = -6000;                             // 60 m vers le nord par module
const DY = PITCH * (MOD - 1);
const LEVEL = 'Persistent_Level:PersistentLevel.';
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.' + LEVEL;
// Volume d'eau de la mer du nord (1 568 x 2 530 m, surface -17,3 m), retrouve par scratchpad volume-eau.js
const WATER_VOLUME = PREFIX + 'FGWaterVolume_7';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  refinery: 'Recipe_OilRefinery_C', extractor: 'Recipe_WaterPump_C', junction: 'Recipe_PipelineJunction_Cross_C',
  pipe: 'Recipe_PipelineMK2_C', pump1: 'Recipe_PipelinePump_C', pump2: 'Recipe_PipelinePumpMK2_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C', pole: 'Recipe_PowerPoleMk3_C',
  ingot: 'Recipe_Alternate_PureIronIngot_C',
};

// --- Geometrie du module (uu ; module 1, puis decalage DY) ------------------------------------------
const X = (k) => 116600 - 1200 * k;          // raffinerie k (0 = est), pas de 12 m
const K = [...Array(12).keys()];
const Y_REF = -271500 + DY, Y_ORE = -270100 + DY, Y_WATER = -269600 + DY, Y_COLL = -273000 + DY;
const Y_STATORS = -269200 + DY;                // collecteur des assembleuses (etage 2)
const LEVELS = { 1: 0, '1b': 3200 };          // base des raffineries
const GROUP = (lv, k) => (lv === '1' || k <= 4 ? 'T' : 'F'); // T = lingots pour les tuyaux, F = pour le fil
const TOP = 6400;                              // base des piles (etage 2)
const EXTRACTORS = {                           // centre, molette (cap), ligne d'eau desservie et bout
  E1: { x: 120360, scroll: 270, lv: '1', end: 'est' },
  E2: { x: 99240, scroll: 90, lv: '1', end: 'ouest' },
  E3: { x: 123860, scroll: 270, lv: '1b', end: 'est' },
  E4: { x: 95740, scroll: 90, lv: '1b', end: 'ouest' },
};
const MIDS = { est: { x: 120000, z: 1500 }, ouest: { x: 99600, z: 1500 } }; // jonctions d'appui des colonnes 1 bis
const RELAYS = {                               // relais des lingots (fusionneurs ; une seule entree utilisee)
  R1: { at: [121800, Y_COLL, 100], yaw: 0 },     // tuyaux, etage 1 -> ascenseur
  M1: { at: [121800, Y_COLL, 3300], yaw: -90 },  // tuyaux, reunion etage 1 (Input2, est) + etage 1 bis (Input3, ouest)
  R3: { at: [121800, Y_COLL, 6700], yaw: 90 },   // tuyaux, haut (Input1 nord, sortie sud)
  R4: { at: [98400, Y_COLL, 3300], yaw: 180 },   // fil, etage 1 bis -> ascenseur
  R5: { at: [98400, Y_COLL, 6700], yaw: 90 },    // fil, haut (Input2 ouest, sortie sud)
};
const SPLIT0 = { bas: { at: [118000, Y_ORE, 100], yaw: 180 }, haut: { at: [118000, Y_ORE, 3300], yaw: 90 } };
const Y_POLE = -274500 + DY;
const POLES = {                                 // poteaux Mk3 des raffineries, extracteurs et pompes
  PE1: [118400, Y_POLE, 0], PM1: [110000, Y_POLE, 0], PW1: [101600, Y_POLE, 0],
  PE1b: [118400, Y_POLE, 3200], PM1b: [110000, Y_POLE, 3200], PW1b: [101600, Y_POLE, 3200],
};
if (MOD === 1) POLES.PG = [110000, -268200, 0];  // relais vers le reseau de la gare de triage (module 1 seulement)
const GRID_POLE = PREFIX + 'Build_PowerPoleMk1_C_2144861798'; // poteau du reseau pres des quais (110 498 ; -262 745 ; -17 m)
// Piles de l'etage 2 : repere plateforme d'origine (110 000 ; -272 000), cap 0 (x vers l'est, y vers le sud)
const PILES = {
  T: { recette: 'Recipe_Alternate_SteelPipe_Iron_C', centre: [88, 0], piles: 2, dos: 'y', arrivees: [{ entree: 'Input0', hauteur: 3, sens: '+lx' }], collecteur: { sens: '+lx' }, horloge: 0.9, reseau: 'PE1b' },
  F: { recette: 'Recipe_Alternate_Wire_1_C', centre: [-56, 0], piles: 6, dos: 'y', arrivees: [{ entree: 'Input0', hauteur: 3, sens: '-lx' }], collecteur: { sens: '-lx' }, horloge: 720 / 810, reseau: 'PW1b' },
  A: { recette: 'Recipe_Stator_C', centre: [32, 11], piles: 3, dos: '-y', arrivees: [{ entree: 'Input1', hauteur: 3, sens: '+lx' }, { entree: 'Input0', hauteur: 7, sens: '-lx' }], collecteur: { sens: '+lx' }, horloge: 1, reseau: 'PM1b' },
};

// --- Etat ---------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, NAME + '-stators-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');
const P3 = ([x, y, z]) => ({ x, y, z });

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '') + (r.snapped ? ' accroches=' + JSON.stringify(r.snapped) : '');
  console.log(key.padEnd(34), what + extra);
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}

async function build(key, recipe, at, yaw, opts) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}

// Convoyeur, ascenseur ou tuyau d'un connecteur a l'autre (le jeu raccorde les deux bouts, meme loin du joueur)
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(34), 'saute (bout absent)'); return null; }
  const r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}

const ref = (lv, k) => st.actors['raffinerie ' + lv + '-' + k];
const junction = (lv, k) => st.actors['jonction ' + lv + '-' + k];
const splitter = (lv, k) => st.actors['repartiteur ' + lv + '-' + k];
const merger = (lv, k) => st.actors['fusionneur ' + lv + '-' + k];

// Point d'un tuyau a la fraction `f` de sa longueur (points de spline relus dans le jeu, interpolation lineaire)
async function pointOnPipe(pipe, f) {
  const pose = await call('pose', pipe);
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData;
  const yaw = pose.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = pose.location;
  const w = pts.map((p) => ({ x: o.x + p.Location.X * c - p.Location.Y * s, y: o.y + p.Location.X * s + p.Location.Y * c, z: o.z + p.Location.Z }));
  const seg = w.slice(1).map((b, i) => Math.hypot(b.x - w[i].x, b.y - w[i].y, b.z - w[i].z));
  let left = seg.reduce((a, b) => a + b, 0) * f;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) { const t = left / seg[i]; return { x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t }; }
    left -= seg[i];
  }
  return w[w.length - 1];
}

// --- Phases -------------------------------------------------------------------------------------------
const PHASES = {
  async extracteurs() {
    for (const [name, e] of Object.entries(EXTRACTORS)) {
      const key = 'extracteur ' + name;
      if (st.actors[key]) continue;
      const r = await call('buildAim', REC.extractor, { x: e.x, y: Y_WATER, z: 1000 }, { x: e.x, y: Y_WATER, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: e.scroll });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  async raffineries() {
    for (const [lv, base] of Object.entries(LEVELS)) for (const k of K) await build('raffinerie ' + lv + '-' + k, REC.refinery, { x: X(k), y: Y_REF, z: base }, 0, AIR);
  },

  // Lignes d'eau : une jonction devant chaque entree d'eau (x - 2 m), chainees d'est en ouest ; branche vers la raffinerie
  async eau() {
    for (const [lv, base] of Object.entries(LEVELS)) {
      for (const k of K) await build('jonction ' + lv + '-' + k, REC.junction, { x: X(k) - 200, y: Y_WATER, z: base + 500 }, 0, AIR);
      for (const k of K.slice(1)) await link('eau ' + lv + ' ' + (k - 1) + '>' + k, REC.pipe, junction(lv, k - 1), 'Connection0', junction(lv, k), 'Connection1');
      for (const k of K) await link('eau ' + lv + ' >raffinerie ' + k, REC.pipe, junction(lv, k), 'Connection3', ref(lv, k), 'PipeInputFactory');
    }
  },

  // Colonnes montantes : extracteur -> bout de la ligne d'eau (etage 1 : direct ; etage 1 bis : par une jonction d'appui)
  async colonnes() {
    for (const [name, e] of Object.entries(EXTRACTORS)) {
      const ex = st.actors['extracteur ' + name];
      const head = e.end === 'est' ? { j: junction(e.lv, 0), port: 'Connection1' } : { j: junction(e.lv, 11), port: 'Connection0' };
      if (e.lv === '1') { await link('colonne ' + name, REC.pipe, ex, 'FGPipeConnectionFactory', head.j, head.port); continue; }
      const m = MIDS[e.end];
      const mid = await build('appui ' + name, REC.junction, { x: m.x, y: Y_WATER, z: m.z }, 0, AIR);
      const [inPort, outPort] = e.end === 'est' ? ['Connection1', 'Connection0'] : ['Connection0', 'Connection1'];
      await link('colonne ' + name + ' bas', REC.pipe, ex, 'FGPipeConnectionFactory', mid, inPort);
      await link('colonne ' + name + ' haut', REC.pipe, mid, outPort, head.j, head.port);
    }
  },

  // Pompes en bas des colonnes (sortie de l'extracteur ~ -14,9 m ; l'extracteur pousse a ~10 m) : Mk1 pour l'etage 1
  // (+5 m), Mk2 pour l'etage 1 bis (+37 m). Posees sur le tuyau, dans son sens (PipelineConnection0 -> 1).
  async pompes() {
    for (const [name, e] of Object.entries(EXTRACTORS)) {
      const key = 'pompe ' + name;
      if (st.actors[key]) continue;
      const pipe = st.links['colonne ' + name + (e.lv === '1' ? '' : ' bas')];
      if (!pipe) { console.log(key.padEnd(34), 'saute (colonne absente)'); continue; }
      const p = await pointOnPipe(pipe, 0.25);
      const r = await call('buildAim', e.lv === '1' ? REC.pump1 : REC.pump2, { x: p.x, y: p.y, z: p.z + 1000 }, p, { dryRun: DRY, onActor: pipe });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // Minerai : repartiteur de tete (etage 1) + ascenseur vers celui de l'etage 1 bis ; une ligne par etage
  async minerai() {
    const s0 = await build('repartiteur tete bas', REC.splitter, P3(SPLIT0.bas.at), SPLIT0.bas.yaw, AIR);
    const s0b = await build('repartiteur tete haut', REC.splitter, P3(SPLIT0.haut.at), SPLIT0.haut.yaw, AIR);
    await link('minerai tete > etage 1 bis', REC.lift, s0, 'Output2', s0b, 'Input1', { snapTolerance: 400 });
    for (const [lv, base] of Object.entries(LEVELS)) {
      for (const k of K) await build('repartiteur ' + lv + '-' + k, REC.splitter, { x: X(k) + 200, y: Y_ORE, z: base + 100 }, 180, AIR);
      await link('minerai ' + lv + ' tete', REC.belt, lv === '1' ? s0 : s0b, lv === '1' ? 'Output1' : 'Output2', splitter(lv, 0), 'Input1');
      for (const k of K.slice(1)) await link('minerai ' + lv + ' ' + (k - 1) + '>' + k, REC.belt, splitter(lv, k - 1), 'Output1', splitter(lv, k), 'Input1');
      for (const k of K) await link('minerai ' + lv + ' >raffinerie ' + k, REC.belt, splitter(lv, k), 'Output2', ref(lv, k), 'Input0');
    }
  },

  // Collecteurs : un fusionneur 6 m devant chaque sortie ; tuyaux vers l'est, fil vers l'ouest
  async collecteurs() {
    for (const [lv, base] of Object.entries(LEVELS)) {
      for (const k of K) {
        const east = GROUP(lv, k) === 'T';
        await build('fusionneur ' + lv + '-' + k, REC.merger, { x: X(k) + 200, y: Y_COLL, z: base + 100 }, east ? 0 : 180, AIR);
        await link('collecte ' + lv + ' raffinerie ' + k, REC.belt, ref(lv, k), 'Output1', merger(lv, k), east ? 'Input2' : 'Input3');
      }
      for (const k of K.slice(1)) {
        if (GROUP(lv, k) === 'T' && GROUP(lv, k - 1) === 'T') await link('collecte ' + lv + ' ' + k + '>' + (k - 1), REC.belt, merger(lv, k), 'Output1', merger(lv, k - 1), 'Input1');
        if (GROUP(lv, k) === 'F' && GROUP(lv, k - 1) === 'F') await link('collecte ' + lv + ' ' + (k - 1) + '>' + k, REC.belt, merger(lv, k - 1), 'Output1', merger(lv, k), 'Input1');
      }
    }
  },

  // Montees des lingots : relais et ascenseurs hors de l'emprise des piles (est pour les tuyaux, ouest pour le fil)
  async montees() {
    for (const [name, r] of Object.entries(RELAYS)) await build('relais ' + name, REC.merger, P3(r.at), r.yaw, AIR);
    const R = (n) => st.actors['relais ' + n];
    const lift = { snapTolerance: 400 };
    await link('tuyaux etage 1 > R1', REC.belt, merger('1', 0), 'Output1', R('R1'), 'Input1');
    await link('tuyaux R1 > M1', REC.lift, R('R1'), 'Output1', R('M1'), 'Input2', lift);
    await link('tuyaux etage 1 bis > M1', REC.belt, merger('1b', 0), 'Output1', R('M1'), 'Input3');
    await link('tuyaux M1 > R3', REC.lift, R('M1'), 'Output1', R('R3'), 'Input1', lift);
    await link('fil etage 1 bis > R4', REC.belt, merger('1b', 11), 'Output1', R('R4'), 'Input1');
    await link('fil R4 > R5', REC.lift, R('R4'), 'Output1', R('R5'), 'Input2', lift);
  },

  // Piles de l'etage 2 par pile.js (configurations ecrites dans le scratchpad du module)
  async piles() {
    const phase = process.argv[3] || 'tout';
    for (const [g, p] of Object.entries(PILES).filter(([g]) => !process.env.GROUPE || process.env.GROUPE === g)) {
      const cfg = {
        nom: NAME + '-' + g, recette: p.recette,
        plateforme: { origine: { x: 110000, y: -272000 + DY }, cap: 0, dessus: TOP },
        dos: p.dos, centre: p.centre, piles: p.piles, etages: 6, pas: 16, espacement: 10,
        arrivees: p.arrivees, collecteur: p.collecteur, reseau: st.actors['poteau ' + p.reseau] || undefined, enLAir: true,
      };
      const file = path.join(__dirname, NAME + '-' + g + '-config-state.json'); // genere : ignore comme les etats
      fs.writeFileSync(file, JSON.stringify(cfg, null, 1) + '\n');
      console.log('=== piles ' + g + ' : ' + phase);
      const args = [path.join(__dirname, 'pile.js'), phase, '--config', file].concat(DRY ? ['--dry'] : []);
      process.stdout.write(execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
    }
  },

  // Raccords entre groupes : relais hauts -> tetes d'arrivee des piles ; collecteurs fil / tuyaux -> assembleuses
  async liaisons() {
    const ps = (g) => JSON.parse(fs.readFileSync(path.join(__dirname, NAME + '-' + g + '-pile-state.json'), 'utf8'));
    const T = ps('T'), F = ps('F'), A = ps('A');
    const R = (n) => st.actors['relais ' + n];
    await link('tuyaux R3 > arrivee T', REC.belt, R('R3'), 'Output1', T.parts['arrivee 0 pile 0'], 'Input1');
    await link('fil R5 > arrivee F', REC.belt, R('R5'), 'Output1', F.parts['arrivee 0 pile 5'], 'Input1');
    await link('fil collecteur F > assembleuses', REC.belt, F.parts['collecteur pile 0'], 'Output1', A.parts['arrivee 0 pile 0'], 'Input1');
    await link('tuyaux collecteur T > assembleuses', REC.belt, T.parts['collecteur pile 1'], 'Output1', A.parts['arrivee 1 pile 2'], 'Input1');
  },

  // Evacuation des stators vers le quai 119 956 de hub0-est1 (chargement, sans tampon : les sorties des assembleuses
  // et les 48 emplacements du quai suffisent a ce debit, accord utilisateur 22/10/2026) : collecteur des assembleuses
  // -> relais V1 -> relais D1 (+64,5 m) -> ascenseur de 47 m -> relais D2 (+17,5 m) -> entree haute du quai.
  // Les 3 autres quais de hub0-est1 dechargent le minerai de fer.
  async evacuation() {
    const A = JSON.parse(fs.readFileSync(path.join(__dirname, NAME + '-A-pile-state.json'), 'utf8'));
    const hub = JSON.parse(fs.readFileSync(path.join(__dirname, 'hub0-est1-state.json'), 'utf8'));
    const quais = [];
    for (const p of hub.platforms) quais.push({ p, x: (await call('pose', p)).location.x });
    quais.sort((a, b) => a.x - b.x);                 // le plus a l'ouest d'abord
    const quai = quais[0].p;
    const v1 = await build('relais V1', REC.merger, { x: 119000, y: -269200, z: 6475 }, 0, AIR);
    const d1 = await build('relais D1', REC.merger, { x: 123000, y: -269200, z: 6449 }, 0, AIR);
    const d2 = await build('relais D2', REC.merger, { x: 123000, y: -269200, z: 1749 }, 180, AIR);
    await link('stators > V1', REC.belt, A.parts['collecteur pile 2'], 'Output1', v1, 'Input1');
    await link('stators V1 > D1', REC.belt, v1, 'Output1', d1, 'Input1');
    await link('stators D1 > D2', REC.lift, d1, 'Output1', d2, 'Input1', { snapTolerance: 400 });
    await link('stators D2 > quai', REC.belt, d2, 'Output1', quai, 'Input1');
    if (DRY) return;
    for (const [i, q] of quais.entries()) {
      const r = await call('platformLoadMode', q.p, i === 0);
      console.log(('quai x ' + Math.round(q.x)).padEnd(34), r.load ? 'chargement (stators)' : 'dechargement (minerai)');
    }
  },

  // Modules 2 et suivants : stators -> relais V -> tronc a x 123 000 (+64,5 m) : J (son module par l'ouest, les modules
  // plus au nord par le nord, sortie au sud) -> relais K a mi-chemin (convoyeurs de 56 m au plus) -> J du module
  // precedent, ou D1 (entree nord) pour le module 2, d'ou la descente du module 1 mene au quai.
  async sortie() {
    if (MOD < 2) throw new Error('sortie : modules 2 et suivants (le module 1 a la phase evacuation)');
    const A = JSON.parse(fs.readFileSync(path.join(__dirname, NAME + '-A-pile-state.json'), 'utf8'));
    const prevState = JSON.parse(fs.readFileSync(path.join(__dirname, 'module' + (MOD - 1) + '-stators-state.json'), 'utf8'));
    const target = MOD === 2 ? { path: prevState.actors['relais D1'], name: 'Input3' } : { path: prevState.actors['tronc J'], name: 'Input1' };
    const v = await build('relais V', REC.merger, { x: 119000, y: Y_STATORS, z: 6475 }, 0, AIR);
    const j = await build('tronc J', REC.merger, { x: 123000, y: Y_STATORS, z: 6449 }, 90, AIR);
    const k = await build('tronc K', REC.merger, { x: 123000, y: Y_STATORS - PITCH / 2, z: 6449 }, 90, AIR);
    await link('stators > V', REC.belt, A.parts['collecteur pile 2'], 'Output1', v, 'Input1');
    await link('stators V > J', REC.belt, v, 'Output1', j, 'Input2');
    await link('tronc J > K', REC.belt, j, 'Output1', k, 'Input1');
    await link('tronc K > aval', REC.belt, k, 'Output1', target.path, target.name);
  },

  async courant() {
    for (const [name, at] of Object.entries(POLES)) await build('poteau ' + name, REC.pole, P3(at), 0, AIR);
    const p = (n) => st.actors['poteau ' + n];
    // module 1 : relie au reseau de la gare de triage ; modules suivants : au poteau central du module precedent (60 m)
    const prev = MOD > 1 ? JSON.parse(fs.readFileSync(path.join(__dirname, 'module' + (MOD - 1) + '-stators-state.json'), 'utf8')).actors['poteau PM1'] : null;
    const plan = (MOD === 1 ? [['PG', GRID_POLE], ['PG', 'PM1']] : [['PM1', prev]])
      .concat([['PM1', 'PE1'], ['PM1', 'PW1'], ['PM1', 'PM1b'], ['PM1b', 'PE1b'], ['PM1b', 'PW1b']]);
    const owner = (k) => (k <= 3 ? 'E' : k <= 7 ? 'M' : 'W');
    for (const [lv] of Object.entries(LEVELS)) for (const k of K) plan.push(['P' + owner(k) + (lv === '1' ? '1' : '1b'), 'raffinerie ' + lv + '-' + k]);
    for (const [name, e] of Object.entries(EXTRACTORS)) {
      const pole = e.end === 'est' ? 'PE1' : 'PW1';
      plan.push([pole, 'extracteur ' + name]);
      plan.push([pole, 'pompe ' + name]);
    }
    for (const [a, b] of plan) {
      const key = a + '>' + b;
      if (st.wires[key]) continue;
      const from = p(a), to = b && b.startsWith('/Game') ? b : (p(b) || st.actors[b]);
      if (!from || !to) { console.log(('cable ' + key).padEnd(34), 'saute (bout absent)'); continue; }
      const r = await call('wire', from, to, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor; save(); }
    }
  },

  async reglages() {
    for (const [lv] of Object.entries(LEVELS)) for (const k of K) {
      const r = await call('setRecipe', ref(lv, k), REC.ingot);
      console.log(('raffinerie ' + lv + '-' + k).padEnd(34), r.recipe, 'courant', r.power && r.power.hasPower);
    }
  },

  async verifie() {
    const problems = [];
    for (const [key, a] of [...Object.entries(st.actors), ...Object.entries(st.links)]) {
      let conns;
      // une colonne coupee par sa pompe a ete remplacee par deux tuyaux : controlee par la pompe
      try { conns = await call('connections', a); } catch (e) { if (/introuvable/.test(e.message)) continue; throw e; }
      const free = conns.filter((c) => !c.connected).map((c) => c.name);
      // bouts libres attendus : entree de minerai, fin des lignes de minerai, branches d'eau sud, relais, tetes
      if (free.length) problems.push(key + ' : libres ' + free.join(' '));
    }
    console.log(Object.keys(st.actors).length + ' batiments, ' + Object.keys(st.links).length + ' convoyeurs / tuyaux, ' + Object.keys(st.wires).length + ' cables');
    console.log(problems.join('\n'));
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node module-stators.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
