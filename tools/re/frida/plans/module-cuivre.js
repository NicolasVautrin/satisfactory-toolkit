// Bloc cuivre 1 (utilisateur, 25/10/2026 : « on dedie le module 1 aux dissipateurs », « commence par le cuivre », plan
// valide par « go ») : le cuivre de l'atelier de dissipateurs au-dessus du module 1 (800 lingots/min pour les toles
// d'aluminium plaque, 1 440 toles de cuivre/min), a l'est du couloir x -36 300 (« a l'est il faudra caser le cuivre et le
// fer »). Recettes du solveur : lingot de cuivre pur (L : 15 minerai + 10 eau -> 37,5 lingots) et tole de cuivre a la
// vapeur (T : 22,5 lingots + 22,5 eau -> 22,5 toles), toutes deux en raffinerie.
//  - 2 bandes (axes y -273 000, dans l'alignement du module 1, et y -279 400), chacune a 2 etages (0 et +32 m) ; une rangee
//    = 31 raffineries d'ouest en est, x -32 800 .. +3 200 (pas de 12 m) : T T L T L ... T L (16 T, 15 L ; 4 rangees = 64 T
//    + 60 L). L face au sud (cap 0 : minerai et eau au sud, lingots au nord), T face au nord (cap 180 : lingots et eau au
//    nord, toles au sud).
//  - au nord, a +1 m : lingots, d'est en ouest (fusionneurs devant les L, repartiteurs devant les T) ; le bout est est un L
//    et les deux T cote a cote sont au bout ouest : chaque T est en aval d'au moins un L. Surplus (202,5/min par rangee) au
//    bout ouest, libre pour l'atelier. A +5 m : eau des T.
//  - au sud : toles a +1 m (fusionneurs devant les T, vers l'ouest ; sortie au bout ouest, libre), eau des L a +5 m,
//    minerai a +11 m (repartiteurs devant les L et ascenseur direct jusqu'a l'entree, comme la bauxite du module 1). Le
//    minerai entre par le bout ouest de la rangee du bas, file vers l'est, monte au bout est par un ascenseur de 32 m et
//    revient vers l'ouest sur la rangee du haut.
//  - eau : 10 extracteurs par bande sous la rangee du bas (100 %), 4 reseaux par bande (eau des L du bas : 2 extracteurs,
//    150 m3/min ; des T du bas : 3, 360 ; idem en haut). Bas : colonne directe jusqu'a la ligne, pompe Mk1 (module 1).
//    Haut : relais A a -7 m hors de la pile de lignes, colonne jusqu'au relais B a +37 m 9 m plus loin, pompe Mk2 (50 m),
//    puis la ligne par le cote.
//  - minerai : tampon au quai 2 de N266 O40 (cuivre 2 400/min), sortie du bas, ascenseur, tronc a +17 m vers l'est le long
//    de y -269 300, tete de la bande 1 a l'ouest de sa rangee (x -34 200), puis tete de la bande 2 par un relais.
//  - courant (~4,2 GW) : poteaux Mk3 en l'air au nord de chaque rangee (P, 7 a 8 raffineries) et au nord de chaque bande
//    (Q, extracteurs et pompes) ; raccord par l'ouest des rangees (G, W, W2) a la ligne Mk1 sous la voie basse.
// usage : node module-cuivre.js <phase> [--dry]
//   phases : raffineries | recettes | extracteurs | eau | colonnes | pompes | minerai | lingots | toles | tampon | tronc |
//            courant | verifie
// Etat : module-cuivre1-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const WATER_VOLUME = PREFIX + 'FGWaterVolume_7'; // mer du nord, couvre x -1 100 .. +1 430 m, y -3 635 .. -2 067 m
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  refinery: 'Recipe_OilRefinery_C', extractor: 'Recipe_WaterPump_C',
  junction: 'Recipe_PipelineJunction_Cross_C', pipe: 'Recipe_PipelineMK2_C',
  pump1: 'Recipe_PipelinePump_C', pump2: 'Recipe_PipelinePumpMk2_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C',
  container: 'Recipe_StorageContainerMk2_C', pole: 'Recipe_PowerPoleMk3_C',
  L: 'Recipe_Alternate_PureCopperIngot_C', T: 'Recipe_Alternate_SteamedCopperSheet_C',
};

// --- Geometrie --------------------------------------------------------------------------------------------
const XW = -32800;
const X = (k) => XW + 1200 * k;               // k = 0 a l'ouest
const K = [...Array(31).keys()];
const TYPE = (k) => (k <= 1 || k % 2 ? 'T' : 'L');
const YAW = { L: 0, T: 180 };
const BANDES = { 1: -273000, 2: -279400 };
const ETAGES = { bas: 0, haut: 3200 };
const ROWS = [];
for (const b of [1, 2]) for (const e of ['bas', 'haut']) ROWS.push({ id: 'b' + b + ' ' + e, b, e, Y: BANDES[b], Z: ETAGES[e] });
// Extracteurs sous la rangee du bas de chaque bande : [k, etage alimente, cote de la ligne] ; x = X(k) - 600 (entre deux
// raffineries), 3 m vers leur cote, sortie vers ce cote (molette 180 = sud, 0 = nord)
const EXT = [[1, 'bas', 'nord'], [4, 'haut', 'nord'], [7, 'bas', 'sud'], [10, 'haut', 'sud'], [13, 'bas', 'nord'],
  [16, 'haut', 'nord'], [19, 'bas', 'sud'], [22, 'haut', 'sud'], [25, 'bas', 'nord'], [28, 'haut', 'nord']]
  .map(([k, e, c]) => ({ k, e, c, x: X(k) - 600, s: c === 'sud' ? 1 : -1 }));
// Haut : la ligne recoit la colonne par une jonction 8 m a l'ouest de l'extracteur (relais B -> Connection0)
const XJ = (e) => (e.e === 'bas' ? e.x : e.x - 800);
const ZB = 100, ZF = 500, ZM = 1100;            // convoyeurs, fluides, minerai (au-dessus de la base de la rangee)
const SIDE = 1400;                               // lignes 5 m devant les connecteurs (+-9 m)
// Minerai : tampon du quai 2, tronc, tetes des bandes
const QUAI2 = PREFIX + 'Build_TrainDockingStation_C_2144346622'; // N266 O40 <- S13 E101, quai 2 (cuivre 2 400/min)
const TAMPON = { at: { x: -43929, y: -268061, z: 349 }, yaw: 180 }; // comme le tampon du quai 1, 7 m au nord du quai
// (P empietait sur le poteau G du module 1, en (-44 000 ; -269 400) : poteau deplace de 7 m vers l'ouest, a la demande
// de l'utilisateur, 25/10/2026 : « bouge le poteau electrique plutot que de refaire tes plans »)
const TRONC = {
  P: { at: { x: -43929, y: -269300, z: 449 }, yaw: -90 }, Ph: { at: { x: -43929, y: -269300, z: 1700 }, yaw: 0 },
  T1: { at: { x: -39000, y: -269300, z: 1700 }, yaw: 0 }, R: { at: { x: -34200, y: -269300, z: 1700 }, yaw: -90 },
};
const XH = -34200;                               // tetes des bandes, a l'ouest des rangees (X(0) - 14 m)
// Courant
const LIGNE_MK1 = PREFIX + 'Build_PowerPoleMk1_C_2144794865'; // (-30 502 ; -262 745 ; -17 m), sous la voie basse
const GROUPES_P = [[0, 6, X(3)], [7, 14, X(10) + 600], [15, 22, X(18) + 600], [23, 30, X(26) + 600]];
const GROUPES_Q = [[[1, 4, 7], X(5)], [[10, 13, 16, 19], X(15)], [[22, 25, 28], X(25)]];
// relais entre les poteaux Q (120 m : FGCDWireTooLong ; un cable fait 100 m au plus)
const RELAIS_Q = { Q01: X(10), Q12: X(20) };

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'module-cuivre1-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '') + (r.snapped ? ' accroches=' + JSON.stringify(r.snapped) : '');
  console.log(key.padEnd(40), what + extra);
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw, opts) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { if (!DRY) console.log(key.padEnd(40), 'saute (bout absent)'); return null; }
  const r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
async function pipePoints(pipe) {
  const pose = await call('pose', pipe);
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData;
  const yaw = pose.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = pose.location;
  return pts.map((p) => ({ x: o.x + p.Location.X * c - p.Location.Y * s, y: o.y + p.Location.X * s + p.Location.Y * c, z: o.z + p.Location.Z }));
}
// Pompe sur la partie verticale d'une colonne : premier point accepte a blanc entre zmin et zmax (module-alu.js)
async function pompe(key, recipe, pipe, zmin, zmax) {
  if (st.actors[key]) return;
  if (!pipe) { console.log(key.padEnd(40), 'saute (colonne absente)'); return; }
  const w = await pipePoints(pipe), cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  let r = null;
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax)) {
    const aim = [{ x: p.x, y: p.y + 300, z: p.z + 300 }, p];
    const t = await call('buildAim', recipe, aim[0], aim[1], { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    r = DRY ? t : await call('buildAim', recipe, aim[0], aim[1], { onActor: pipe });
    console.log(key.padEnd(40), 'a', (p.z / 100).toFixed(1), 'm');
    break;
  }
  if (!r) throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
}
// Ligne de jonctions d'est en ouest (Connection0 -> Connection1 de voisine en voisine)
async function junctionLine(prefix, xs, y, z) {
  const sorted = [...new Set(xs)].sort((a, b) => b - a);
  for (const x of sorted) await build(prefix + ' ' + x, REC.junction, { x, y, z }, 0, AIR);
  for (let i = 1; i < sorted.length; i++) await link(prefix + ' ' + sorted[i - 1] + ' > ' + sorted[i], REC.pipe, st.actors[prefix + ' ' + sorted[i - 1]], 'Connection0', st.actors[prefix + ' ' + sorted[i]], 'Connection1');
  return (x) => st.actors[prefix + ' ' + x];
}
const ref = (row, k) => st.actors[row.id + ' raffinerie ' + k + ' ' + TYPE(k)];
const extKey = (b, e) => 'b' + b + ' extracteur ' + e.k;
const OF = (t) => K.filter((k) => TYPE(k) === t);

const PHASES = {
  async raffineries() {
    for (const row of ROWS) for (const k of K) await build(row.id + ' raffinerie ' + k + ' ' + TYPE(k), REC.refinery, { x: X(k), y: row.Y, z: row.Z }, YAW[TYPE(k)], AIR);
  },

  async recettes() {
    for (const row of ROWS) for (const k of K) {
      const key = row.id + ' raffinerie ' + k + ' ' + TYPE(k), a = st.actors[key];
      if (!a || DRY) { console.log(key.padEnd(40), DRY ? REC[TYPE(k)] : 'absente'); continue; }
      const r = await call('setRecipe', a, REC[TYPE(k)]);
      console.log(key.padEnd(40), r.recipe);
    }
  },

  // poses par un point touche fabrique sur le volume d'eau (module-alu.js)
  async extracteurs() {
    for (const b of [1, 2]) for (const e of EXT) {
      const key = extKey(b, e);
      if (st.actors[key]) continue;
      const y = BANDES[b] + 300 * e.s;
      const r = await call('buildAim', REC.extractor, { x: e.x, y, z: 1000 }, { x: e.x, y, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: e.s > 0 ? 180 : 0 });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // Lignes d'eau a +5 m : des L au sud (jonction a x-2, branche Connection3), des T au nord (x+2, branche Connection2) ;
  // jonctions des extracteurs de l'etage ; colonnes directes pour le bas
  async eau() {
    for (const row of ROWS) {
      const exts = EXT.filter((e) => e.e === row.e);
      for (const [cote, t, dx, branch, ext] of [['sud', 'L', -200, 'Connection3', 'Connection3'], ['nord', 'T', 200, 'Connection2', 'Connection2']]) {
        const es = exts.filter((e) => e.c === cote), y = row.Y + (cote === 'sud' ? SIDE : -SIDE);
        const J = await junctionLine(row.id + ' eau ' + cote, OF(t).map((k) => X(k) + dx).concat(es.map(XJ)), y, row.Z + ZF);
        for (const k of OF(t)) await link(row.id + ' eau > raffinerie ' + k, REC.pipe, J(X(k) + dx), branch, ref(row, k), 'PipeInputFactory');
        if (row.e === 'bas') for (const e of es) await link('b' + row.b + ' colonne ' + e.k, REC.pipe, st.actors[extKey(row.b, e)], 'FGPipeConnectionFactory', J(e.x), ext);
      }
    }
  },

  // Colonnes de l'etage du haut : extracteur -> relais A (-7 m, 17 m devant l'axe) -> colonne -> relais B (+37 m, 26 m
  // devant) -> par l'ouest jusqu'a la jonction de la ligne (14 m devant, 8 m a l'ouest)
  async colonnes() {
    for (const b of [1, 2]) for (const e of EXT.filter((q) => q.e === 'haut')) {
      const Y = BANDES[b], s = e.s, row = ROWS.find((r) => r.b === b && r.e === 'haut');
      const [toward, away] = s > 0 ? ['Connection3', 'Connection2'] : ['Connection2', 'Connection3'];
      const A = await build('b' + b + ' relais A ' + e.k, REC.junction, { x: e.x, y: Y + 1700 * s, z: -700 }, 0, AIR);
      const B = await build('b' + b + ' relais B ' + e.k, REC.junction, { x: e.x, y: Y + 2600 * s, z: row.Z + ZF }, 0, AIR);
      const J = st.actors[row.id + ' eau ' + e.c + ' ' + XJ(e)];
      await link('b' + b + ' extracteur ' + e.k + ' > A', REC.pipe, st.actors[extKey(b, e)], 'FGPipeConnectionFactory', A, toward);
      await link('b' + b + ' colonne haute ' + e.k, REC.pipe, A, away, B, toward);
      await link('b' + b + ' B ' + e.k + ' > ligne', REC.pipe, B, 'Connection0', J, away);
    }
  },

  async pompes() {
    for (const b of [1, 2]) for (const e of EXT) {
      if (e.e === 'bas') await pompe('b' + b + ' pompe ' + e.k, REC.pump1, st.links['b' + b + ' colonne ' + e.k], -1300, -600);
      else await pompe('b' + b + ' pompe ' + e.k, REC.pump2, st.links['b' + b + ' colonne haute ' + e.k], 0, 2500);
    }
  },

  // Minerai a +11 m au sud : repartiteurs devant les L (x+2) et ascenseur direct jusqu'a l'entree ; bas vers l'est (cap 0,
  // branche Output3 au nord), haut vers l'ouest (cap 180, branche Output2 au nord) ; montee de 32 m au bout est
  async minerai() {
    for (const b of [1, 2]) {
      const Y = BANDES[b], y = Y + SIDE;
      for (const e of ['bas', 'haut']) {
        const row = ROWS.find((r) => r.b === b && r.e === e), ls = OF('L');
        for (const k of ls) await build(row.id + ' minerai ' + k, REC.splitter, { x: X(k) + 200, y, z: row.Z + ZM }, e === 'bas' ? 0 : 180, AIR);
        const S = (k) => st.actors[row.id + ' minerai ' + k];
        const chain = e === 'bas' ? ls : [...ls].reverse();
        for (let i = 1; i < chain.length; i++) await link(row.id + ' minerai ' + chain[i - 1] + ' > ' + chain[i], REC.belt, S(chain[i - 1]), 'Output1', S(chain[i]), 'Input1');
        for (const k of ls) await link(row.id + ' minerai > raffinerie ' + k, REC.lift, S(k), e === 'bas' ? 'Output3' : 'Output2', ref(row, k), 'Input0', { snapTolerance: 400 });
      }
      const last = OF('L').slice(-1)[0], xb = X(last) + 1400;
      const U = await build('b' + b + ' minerai bout bas', REC.merger, { x: xb, y, z: ETAGES.bas + ZM }, 0, AIR);
      const V = await build('b' + b + ' minerai bout haut', REC.merger, { x: xb, y, z: ETAGES.haut + ZM }, 180, AIR);
      await link('b' + b + ' minerai bas > bout', REC.belt, st.actors['b' + b + ' bas minerai ' + last], 'Output1', U, 'Input1');
      await link('b' + b + ' minerai montee', REC.lift, U, 'Output1', V, 'Input1', { snapTolerance: 400 });
      await link('b' + b + ' minerai bout > haut', REC.belt, V, 'Output1', st.actors['b' + b + ' haut minerai ' + last], 'Input1');
    }
  },

  // Lingots, au nord a +1 m, d'est en ouest : fusionneurs devant les L (x+2, Input3), repartiteurs devant les T (x-2,
  // Output3) ; sortie du surplus au bout ouest (Output1 du repartiteur de T 0), libre
  async lingots() {
    for (const row of ROWS) {
      const y = row.Y - SIDE, z = row.Z + ZB, A = (k) => st.actors[row.id + ' lingots ' + k];
      for (const k of K) await build(row.id + ' lingots ' + k, TYPE(k) === 'L' ? REC.merger : REC.splitter, { x: X(k) + (TYPE(k) === 'L' ? 200 : -200), y, z }, 180, AIR);
      for (const k of OF('L')) await link(row.id + ' raffinerie ' + k + ' > lingots', REC.belt, ref(row, k), 'Output1', A(k), 'Input3');
      for (const k of OF('T')) await link(row.id + ' lingots > raffinerie ' + k, REC.belt, A(k), 'Output3', ref(row, k), 'Input0');
      for (let k = K.length - 1; k > 0; k--) await link(row.id + ' lingots ' + k + ' > ' + (k - 1), REC.belt, A(k), 'Output1', A(k - 1), 'Input1');
    }
  },

  // Toles, au sud a +1 m, vers l'ouest : fusionneurs devant les T (x-2, Input2 au nord) ; sortie au bout ouest, libre
  async toles() {
    for (const row of ROWS) {
      const y = row.Y + SIDE, z = row.Z + ZB, ts = OF('T'), M = (k) => st.actors[row.id + ' toles ' + k];
      for (const k of ts) await build(row.id + ' toles ' + k, REC.merger, { x: X(k) - 200, y, z }, 180, AIR);
      for (const k of ts) await link(row.id + ' raffinerie ' + k + ' > toles', REC.belt, ref(row, k), 'Output1', M(k), 'Input2');
      const chain = [...ts].reverse(); // d'est en ouest
      for (let i = 1; i < chain.length; i++) await link(row.id + ' toles ' + chain[i - 1] + ' > ' + chain[i], REC.belt, M(chain[i - 1]), 'Output1', M(chain[i]), 'Input1');
    }
  },

  // Tampon en sortie du quai 2 (« il faut des tampons en sortie de quai »), comme celui du quai 1
  async tampon() {
    const t = await build('tampon quai 2', REC.container, TAMPON.at, TAMPON.yaw, AIR);
    await link('quai 2 > tampon (bas)', REC.belt, QUAI2, 'Output0', t, 'Input0');
    await link('quai 2 > tampon (haut)', REC.belt, QUAI2, 'Output1', t, 'Input1');
  },

  // Tronc du minerai : sortie du bas du tampon -> P -> ascenseur -> P' (+17 m) -> T1 -> R -> tete de la bande 1 (repartiteur :
  // Output2 vers la rangee du bas, Output1 vers la bande 2) -> relais -> tete de la bande 2
  async tronc() {
    for (const [n, r] of Object.entries(TRONC)) await build('tronc ' + n, REC.merger, r.at, r.yaw, AIR);
    const T = (n) => st.actors['tronc ' + n];
    const H1 = await build('tete b1', REC.splitter, { x: XH, y: BANDES[1] + SIDE, z: ZM }, -90, AIR);
    const M = await build('relais b2', REC.merger, { x: XH, y: BANDES[1] - SIDE - 400, z: ZM }, -90, AIR);
    const H2 = await build('tete b2', REC.splitter, { x: XH, y: BANDES[2] + SIDE, z: ZM }, -90, AIR);
    await link('tampon > P', REC.belt, st.actors['tampon quai 2'], 'Output1', T('P'), 'Input1');
    await link('P > Ph', REC.lift, T('P'), 'Output1', T('Ph'), 'Input3', { snapTolerance: 400 });
    await link('Ph > T1', REC.belt, T('Ph'), 'Output1', T('T1'), 'Input1');
    await link('T1 > R', REC.belt, T('T1'), 'Output1', T('R'), 'Input3');
    await link('R > tete b1', REC.belt, T('R'), 'Output1', H1, 'Input1');
    await link('tete b1 > relais b2', REC.belt, H1, 'Output1', M, 'Input1');
    await link('relais b2 > tete b2', REC.belt, M, 'Output1', H2, 'Input1');
    const first = OF('L')[0];
    await link('tete b1 > bas', REC.belt, H1, 'Output2', st.actors['b1 bas minerai ' + first], 'Input1');
    await link('tete b2 > bas', REC.belt, H2, 'Output2', st.actors['b2 bas minerai ' + first], 'Input1');
  },

  async courant() {
    const p = (n) => st.actors['poteau ' + n];
    await build('poteau G', REC.pole, { x: -34800, y: -268500, z: 0 }, 0, AIR);
    await build('poteau W1', REC.pole, { x: -34800, y: BANDES[1] - 2400, z: 0 }, 0, AIR);
    await build('poteau W2', REC.pole, { x: -34800, y: BANDES[2] - 2400, z: 0 }, 0, AIR);
    const plan = [['G', LIGNE_MK1], ['G', p('W1')], ['W1', p('W2')]];
    for (const row of ROWS) for (let i = 0; i < GROUPES_P.length; i++) await build('poteau ' + row.id + ' P' + i, REC.pole, { x: GROUPES_P[i][2], y: row.Y - 2400, z: row.Z }, 0, AIR);
    for (const b of [1, 2]) for (let i = 0; i < GROUPES_Q.length; i++) await build('poteau b' + b + ' Q' + i, REC.pole, { x: GROUPES_Q[i][1], y: BANDES[b] - 3200, z: 0 }, 0, AIR);
    for (const b of [1, 2]) for (const [n, x] of Object.entries(RELAIS_Q)) await build('poteau b' + b + ' ' + n, REC.pole, { x, y: BANDES[b] - 3200, z: 0 }, 0, AIR);
    for (const b of [1, 2]) {
      const bas = 'b' + b + ' bas', haut = 'b' + b + ' haut';
      plan.push(['W' + b, p(bas + ' P0')], ['W' + b, p('b' + b + ' Q0')], [bas + ' P0', p(haut + ' P0')]);
      for (const r of [bas, haut]) for (let i = 1; i < GROUPES_P.length; i++) plan.push([r + ' P' + (i - 1), p(r + ' P' + i)]);
      const q = (n) => 'b' + b + ' ' + n;
      plan.push([q('Q0'), p(q('Q01'))], [q('Q01'), p(q('Q1'))], [q('Q1'), p(q('Q12'))], [q('Q12'), p(q('Q2'))]);
      for (const row of ROWS.filter((r) => r.b === b)) GROUPES_P.forEach(([k0, k1], i) => { for (let k = k0; k <= k1; k++) plan.push([row.id + ' P' + i, ref(row, k)]); });
      GROUPES_Q.forEach(([ks], i) => { for (const k of ks) plan.push(['b' + b + ' Q' + i, st.actors['b' + b + ' extracteur ' + k]], ['b' + b + ' Q' + i, st.actors['b' + b + ' pompe ' + k]]); });
    }
    for (const [a, b] of plan) {
      const key = a + ' > ' + (b ? short(b) : '?');
      if (st.wires[key]) continue;
      if (!p(a) || !b) { if (!DRY) console.log(('cable ' + key).padEnd(40), 'saute (bout absent)'); continue; }
      const r = await call('wire', p(a), b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
  },

  async verifie() {
    for (const [key, a] of Object.entries(st.actors)) {
      const conns = await call('connections', a);
      const free = conns.filter((c) => !c.connected).map((c) => c.name);
      if (free.length) console.log(key.padEnd(40), 'libres :', free.join(' '));
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node module-cuivre.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
