// Filiere carburant pour fusees, mer du nord, entre le bloc cuivre et les modules fer (utilisateur, 25-26/10/2026 :
// « on va pas tout faire tout de suite, juste assez pour couvrir le nuke. par contre le layout doit prendre en compte la
// filiere totale »). Recettes de la solution de l'optimiseur (sinkAnalysis_163330), lues en jeu.
// Module = 1/7 de la filiere du plan : 7 melangeurs de carburant pour fusees + 2 nitro -> 1 000 m3/min -> 96 generateurs a
// 250 % (60 GW) + 120 charbon compacte/min (le nucleaire en veut 116). 7 modules = la filiere du plan (49 / 14 melangeurs,
// 672 generateurs, 840 charbon compacte). Emplacements : 3 de front (x 8 500 .. 74 000), rangees de ~265 m vers le nord
// depuis la voie basse ; module 1 = le plus a l'est (le plus pres du soufre, balise « S for rocket fuel »).
// Rangees (du sud au nord), machines de x ~54 900 a 74 000, couloir de transferts a l'ouest (x 52 200 .. 54 400) :
//  - H, -17 m : 16 raffineries (2 paires residu lourd P -> coke C, tuyau direct ; 12 residu lourd F vers la ligne de
//    residu) ; au sud petrole (+5 m, tete est libre) et coke (+1 m, vers l'ouest) ; au nord resine (+1 m, vers l'ouest)
//    et residu (+5 m). P et C a 87,5 %, F a 93,75 % (450 residu = 280 Turbo Blend + 170 carburant dilue).
//  - B1 : 7 raffineries de caoutchouc residuel R a 0 m (92,9 % : 260 resine), sous elles 5 extracteurs d'eau ; a l'est,
//    4 melangeurs de carburant dilue D a -17 m (85 %). Eau (-17 m, +5) des extracteurs vers D et une colonne (pompe Mk1)
//    vers la ligne d'eau des R ; residu (+9) vers D ; carburant au nord (+5). Resine a 0 m (repartiteurs devant les R,
//    debordement au broyeur) ; caoutchouc au nord vers un conteneur tampon (rien ne le consomme encore).
//  - B2, -17 m : 10 melangeurs Turbo Blend T (93,3 %) ; au sud soufre (+1, tete est libre), residu (+5), carburant (+9),
//    coke (+13, ascenseur vers la 2e entree) ; turbocarburant au nord (+5).
//  - B3, -17 m : 2 nitro N (est) + 7 carburant pour fusees K (ouest). K : turbo (+5) et acide nitrique (+9, tete ouest
//    libre : N211 O96) ; N : azote (+5) et carburant (+9), soufre (+1) et charbon (+13), tetes est libres. Au nord :
//    carburant pour fusees (+5, deux troncons de 500 m3/min) et charbon compacte (+1, vers l'ouest, sortie libre).
//  - Generateurs : 2 etages, +32 m (troncon est) et +64 m (troncon ouest), au-dessus du module (rien sous eux a moins
//    de 13,5 m : gabarit lu en jeu ; 28 m au moins entre deux etages) ; 3 paires de rangees par etage autour d'un
//    collecteur de jonctions, 8 colonnes a 24 m ; collecteurs alimentes par un tuyau le long d'y (est a +32, ouest a +64).
// usage : node carburant-fusee.js <phase> [--module 1] [--dry]
// Etat : carburant-fusee-m<n>-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const MOD = Number((process.argv.find((a) => a.startsWith('--module=')) || '--module=1').split('=')[1]);
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const WATER_VOLUME = PREFIX + 'FGWaterVolume_7';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  refinery: 'Recipe_OilRefinery_C', blender: 'Recipe_Blender_C', generator: 'Recipe_GeneratorFuel_C',
  pipe: 'Recipe_PipelineMK2_C', junction: 'Recipe_PipelineJunction_Cross_C', pump1: 'Recipe_PipelinePump_C',
  pump2: 'Recipe_PipelinePumpMk2_C', extractor: 'Recipe_WaterPump_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C', sink: 'Recipe_ResourceSink_C',
  container: 'Recipe_StorageContainerMk2_C',
  P: 'Recipe_Alternate_HeavyOilResidue_C', F: 'Recipe_Alternate_HeavyOilResidue_C', C: 'Recipe_PetroleumCoke_C',
  R: 'Recipe_ResidualRubber_C', D: 'Recipe_Alternate_DilutedFuel_C', T: 'Recipe_Alternate_TurboBlendFuel_C',
  K: 'Recipe_RocketFuel_C', N: 'Recipe_Alternate_RocketFuel_Nitro_C',
};
const CLOCK = { P: 0.875, C: 0.875, F: 0.9375, R: 6.5 / 7, D: 0.85, T: 420 / 450, K: 1, N: 1 };

// --- Emplacements (bord est XE, bord sud YS) -----------------------------------------------------------------
const SLOTS = { 1: { XE: 74000, YS: -268500 } };
const { XE, YS } = SLOTS[MOD];
const Z1 = -1700, Z0 = 0;
const ZB = Z1 + 100, ZF = Z1 + 500, ZF2 = Z1 + 900, ZS2 = Z1 + 1300;   // lignes a -17 m : +1, +5, +9, +13 m
const ZB0 = Z0 + 100, ZF0 = Z0 + 500;                                   // lignes a 0 m
const dx = (v) => XE - 74000 + v;                                       // coordonnees du module 1 -> module courant
const dy = (v) => YS + 268500 + v;
// Couloir ouest (x) : coke 52 800 (montee a 52 200), residu 53 400, carburant / turbo 54 000, resine 54 400
const XC = { coke: dx(52800), cokeHaut: dx(52200), residu: dx(53400), carburant: dx(54000), resine: dx(54400), resineHaut: dx(53800) };
const XEST = dx(74400);                                                 // couloir est (carburant des N, collecteur +32)

// Rangee H
const YH = dy(-271000), YHS = YH + 1400, YHN = YH - 1400;
const KH = [...Array(16).keys()];
const XH = (k) => dx(73400) - 1200 * k;
const TH = (k) => (k < 4 ? (k % 2 === 0 ? 'P' : 'C') : 'F');
const YAWH = { P: 0, F: 0, C: 180 };
// Relais du coke (+1 m, au sud) entre les jonctions de petrole, vers l'ouest
const COKE_RELAIS = [dx(65400), dx(61800), dx(57000)];
const RESINE_RELAIS = [dx(64800 - 600), dx(59400 - 600)].map((x) => x);   // entre les fusionneurs de resine (pas de 12 m)

// Rangee B1
const YB1 = dy(-278000);
const KR = [...Array(7).keys()];
const XR = (k) => dx(55600) + 1400 * k;                // R a 0 m, cap 0 (entrees au sud)
const XX = (i) => dx(55900) + 2000 * i;                // extracteurs, sous les R, sortie au sud
const XD = (j) => dx(65900) + 1900 * j;                // D, cap 180 (entrees au sud)
const YX = YB1 + 300;
const YB1S = YB1 + 2600, YB1N = YB1 - 3000;            // lignes a -17 m
const YRS = YB1 + 1400, YRN = YB1 - 1400;              // lignes a 0 m
const X_COLONNE = XR(0) - 200;                         // colonne d'eau sous la jonction d'eau de R 0
const BROYEUR = { at: { x: dx(66600), y: YRS, z: Z0 }, yaw: 0 };    // au bout est de la ligne de resine (entree a l'ouest)
const TAMPON = { at: { x: dx(66600), y: YRN, z: Z0 }, yaw: 90 };     // conteneur du caoutchouc

// Rangee B2
const YB2 = dy(-286000), YB2S = YB2 + 1200, YB2N = YB2 - 1240;
const KT = [...Array(10).keys()];
const XT = (k) => dx(73000) - 1900 * k;

// Rangee B3
const YB3 = dy(-293000), YB3S = YB3 + 1200, YB3N = YB3 - 1240;
const K3 = [...Array(9).keys()];
const X3 = (k) => dx(73000) - 1900 * k;
const T3 = (k) => (k < 2 ? 'N' : 'K');
const SEG_EST = K3.filter((k) => k < 4), SEG_OUEST = K3.filter((k) => k >= 4);   // 500 m3/min chacun

// Generateurs
const ZG = { haut: 6400, bas: 3200 };                  // +64 m (troncon ouest), +32 m (troncon est)
const YM = [dy(-273000), dy(-282000), dy(-291000)];
const XG = (c) => dx(72800) - 2400 * c;
const KG = [...Array(8).keys()];
const XGH = { bas: XEST, haut: XC.residu };            // collecteurs le long d'y
const YRELAIS_G = [dy(-277500), dy(-286500)];

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'carburant-fusee-m' + MOD + '-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
const A = (k) => st.actors[k];

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '') + (r.snapped ? ' accroches=' + JSON.stringify(r.snapped) : '');
  console.log(key.padEnd(40), what + extra);
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw, opts) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, AIR, opts || {}));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(40), 'saute (bout absent)'); return null; }
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
// Pompe sur la partie verticale d'un tuyau (le jeu la refuse a plat et dans les coudes)
async function pompe(key, recipe, pipe, zmin, zmax) {
  if (st.actors[key]) return;
  if (!pipe) { console.log(key.padEnd(40), 'saute (tuyau absent)'); return; }
  const w = await pipePoints(pipe), cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  let r = null;
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax)) {
    const t = await call('buildAim', recipe, { x: p.x, y: p.y + 300, z: p.z + 300 }, p, { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    r = DRY ? t : await call('buildAim', recipe, { x: p.x, y: p.y + 300, z: p.z + 300 }, p, { onActor: pipe });
    console.log(key.padEnd(40), 'a', (p.z / 100).toFixed(1), 'm');
    break;
  }
  if (!r) throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
}
// Ligne de jonctions a (y, z), chainee d'est en ouest (Connection0 ouest -> Connection1 est de la voisine)
async function junctionLine(prefix, xs, y, z) {
  const sorted = [...new Set(xs)].sort((a, b) => b - a);
  for (const x of sorted) await build(prefix + ' ' + x, REC.junction, { x, y, z }, 0);
  for (let i = 1; i < sorted.length; i++) await link(prefix + ' ' + sorted[i - 1] + ' > ' + sorted[i], REC.pipe, A(prefix + ' ' + sorted[i - 1]), 'Connection0', A(prefix + ' ' + sorted[i]), 'Connection1');
  return (x) => A(prefix + ' ' + x);
}
// Ligne de jonctions le long d'y, chainee du sud au nord (Connection3 nord -> Connection2 sud de la voisine)
async function junctionColumn(prefix, x, ys, z) {
  const sorted = [...new Set(ys)].sort((a, b) => b - a);
  for (const y of sorted) await build(prefix + ' ' + y, REC.junction, { x, y, z }, 0);
  for (let i = 1; i < sorted.length; i++) await link(prefix + ' ' + sorted[i - 1] + ' > ' + sorted[i], REC.pipe, A(prefix + ' ' + sorted[i - 1]), 'Connection3', A(prefix + ' ' + sorted[i]), 'Connection2');
  return (y) => A(prefix + ' ' + y);
}
// Entrees / sorties laterales des repartiteurs et fusionneurs : cap 0 -> 2 sud, 3 nord ; cap 180 -> 2 nord, 3 sud ;
// cap 90 (flux vers le sud) -> 2 ouest, 3 est ; cap -90 (flux vers le nord) -> 2 est, 3 ouest
const SIDE = { 0: { S: 2, N: 3 }, 180: { N: 2, S: 3 }, 90: { W: 2, E: 3 }, '-90': { E: 2, W: 3 } };
const side = (yaw, s) => SIDE[yaw][s];
// Montee d'un convoyeur : fusionneur bas (cap a) -> ascenseur -> fusionneur haut (cap a + 180) au meme point
async function montee(prefix, at, zhaut, yawBas) {
  const bas = await build(prefix + ' bas', REC.merger, at, yawBas);
  const haut = await build(prefix + ' haut', REC.merger, { x: at.x, y: at.y, z: zhaut }, yawBas === 0 ? 180 : yawBas === 180 ? 0 : -yawBas);
  await link(prefix + ' ascenseur', REC.lift, bas, 'Output1', haut, 'Input1', { snapTolerance: 400 });
  return { bas, haut };
}
async function recettes(list) {
  for (const { key, t } of list) {
    const a = A(key);
    if (!a || DRY) { console.log(key.padEnd(40), DRY ? REC[t] + ' a ' + Math.round(CLOCK[t] * 1000) / 10 + ' %' : 'absent'); continue; }
    const r = await call('setRecipe', a, REC[t]);
    if (CLOCK[t] !== 1) await call('setClock', a, CLOCK[t]);
    console.log(key.padEnd(40), r.recipe, 'a', Math.round(CLOCK[t] * 1000) / 10, '%');
  }
}

const h = (k) => A('H ' + k + ' ' + TH(k));
const r0 = (k) => A('R ' + k);
const d1 = (j) => A('D ' + j);
const t2 = (k) => A('T ' + k);
const b3 = (k) => A('B3 ' + k + ' ' + T3(k));

const PHASES = {
  // ------------------------------------------------------------------------------------------- Rangee H (-17 m)
  async raffineries() {
    for (const k of KH) await build('H ' + k + ' ' + TH(k), REC.refinery, { x: XH(k), y: YH, z: Z1 }, YAWH[TH(k)]);
  },
  async recettesH() { await recettes(KH.map((k) => ({ key: 'H ' + k + ' ' + TH(k), t: TH(k) }))); },
  async paires() {
    for (const k of KH.filter((q) => TH(q) === 'P')) await link('paire ' + k, REC.pipe, h(k), 'PipeOutputFactory', h(k + 1), 'PipeInputFactory');
  },
  // Petrole au sud (+5) : une jonction devant chaque P et F, tete est (Connection1 de la premiere) libre
  async petrole() {
    const PF = KH.filter((k) => TH(k) !== 'C');
    const J = await junctionLine('petrole', PF.map((k) => XH(k) - 200), YHS, ZF);
    for (const k of PF) await link('petrole > H ' + k, REC.pipe, J(XH(k) - 200), 'Connection3', h(k), 'PipeInputFactory');
  },
  // Coke au sud (+1), vers l'ouest (cap 180), relais entre les jonctions de petrole, puis le couloir ouest jusqu'a la
  // ligne de coke de B2 (+13 m), par une montee
  async coke() {
    const CS = KH.filter((k) => TH(k) === 'C');
    const pts = CS.map((k) => ({ key: 'coke ' + k, x: XH(k) - 200, k })).concat(COKE_RELAIS.map((x, i) => ({ key: 'coke relais ' + i, x })));
    for (const p of pts) await build(p.key, REC.merger, { x: p.x, y: YHS, z: ZB }, 180);
    for (const k of CS) await link('H ' + k + ' > coke', REC.belt, h(k), 'Output1', A('coke ' + k), 'Input' + side(180, 'N'));
    for (let i = 1; i < pts.length; i++) await link(pts[i - 1].key + ' > ' + pts[i].key, REC.belt, A(pts[i - 1].key), 'Output1', A(pts[i].key), 'Input1');
    // couloir : vers le nord (cap -90) a x XC.coke, de YHS a YB2S
    const ys = [YHS, YHS - 5000, YHS - 10000];
    for (const [i, y] of ys.entries()) await build('coke couloir ' + i, REC.merger, { x: XC.coke, y, z: ZB }, -90);
    await link(pts[pts.length - 1].key + ' > couloir', REC.belt, A(pts[pts.length - 1].key), 'Output1', A('coke couloir 0'), 'Input' + side(-90, 'E'));
    for (let i = 1; i < ys.length; i++) await link('coke couloir ' + (i - 1) + ' > ' + i, REC.belt, A('coke couloir ' + (i - 1)), 'Output1', A('coke couloir ' + i), 'Input1');
    // arrivee : fusionneur T (cap 180) au sud de la ligne de B2, montee de 12 m a l'ouest, puis vers l'est
    await build('coke T', REC.merger, { x: XC.coke, y: YB2S, z: ZB }, 180);
    await link('coke couloir > T', REC.belt, A('coke couloir ' + (ys.length - 1)), 'Output1', A('coke T'), 'Input' + side(180, 'S'));
    const m = await montee('coke montee', { x: XC.cokeHaut, y: YB2S, z: ZB }, ZS2, 180);
    await link('coke T > montee', REC.belt, A('coke T'), 'Output1', m.bas, 'Input1');
  },
  // Resine au nord (+1), vers l'ouest, jusqu'au couloir x XC.resine, au nord jusqu'a YRS, montee de 17 m, vers l'est
  // le long des R (repartiteurs a 0 m) ; le dernier deborde dans le broyeur
  async resine() {
    const PF = KH.filter((k) => TH(k) !== 'C');
    const pts = PF.map((k) => ({ key: 'resine ' + k, x: XH(k) + 200 }));
    for (const p of pts) await build(p.key, REC.merger, { x: p.x, y: YHN, z: ZB }, 180);
    for (const k of PF) await link('H ' + k + ' > resine', REC.belt, h(k), 'Output1', A('resine ' + k), 'Input' + side(180, 'S'));
    for (let i = 1; i < pts.length; i++) await link(pts[i - 1].key + ' > ' + pts[i].key, REC.belt, A(pts[i - 1].key), 'Output1', A(pts[i].key), 'Input1');
    await build('resine couloir', REC.merger, { x: XC.resine, y: YHN, z: ZB }, -90);
    await link('resine > couloir', REC.belt, A(pts[pts.length - 1].key), 'Output1', A('resine couloir'), 'Input' + side(-90, 'E'));
    await build('resine T', REC.merger, { x: XC.resine, y: YRS, z: ZB }, 180);
    await link('resine couloir > T', REC.belt, A('resine couloir'), 'Output1', A('resine T'), 'Input' + side(180, 'S'));
    // montee : le fusionneur T est le bas ; haut au meme point, cap 0
    await build('resine haut', REC.merger, { x: XC.resine, y: YRS, z: ZB0 }, 0);
    await link('resine ascenseur', REC.lift, A('resine T'), 'Output1', A('resine haut'), 'Input1', { snapTolerance: 400 });
  },
  // Residu au nord (+5) : jonction devant la sortie de tuyau de chaque F ; prolonge jusqu'au couloir x XC.residu
  async residu() {
    const FS = KH.filter((k) => TH(k) === 'F');
    const J = await junctionLine('residu H', FS.map((k) => XH(k) - 200).concat([XC.residu]), YHN, ZF);
    for (const k of FS) await link('H ' + k + ' > residu', REC.pipe, h(k), 'PipeOutputFactory', J(XH(k) - 200), 'Connection2');
  },

  // ------------------------------------------------------------------------------------------- Rangee B1
  async raffineriesR() {
    for (const k of KR) await build('R ' + k, REC.refinery, { x: XR(k), y: YB1, z: Z0 }, 0);
  },
  async extracteurs() {
    for (const i of [...Array(5).keys()]) {
      const key = 'extracteur ' + i;
      if (A(key)) continue;
      const r = await call('buildAim', REC.extractor, { x: XX(i), y: YX, z: 1000 }, { x: XX(i), y: YX, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: 180 });
      report(key, r);
      if (r.hologram) console.log('   hologramme', JSON.stringify(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },
  async melangeursD() {
    for (const j of [...Array(4).keys()]) await build('D ' + j, REC.blender, { x: XD(j), y: YB1, z: Z1 }, 180);
  },
  async recettesB1() {
    await recettes(KR.map((k) => ({ key: 'R ' + k, t: 'R' })).concat([...Array(4).keys()].map((j) => ({ key: 'D ' + j, t: 'D' }))));
  },
  // Eau (-17 m, +5, au sud) : extracteurs -> D et colonne -> ligne d'eau des R (0 m, +5, au sud) ; pompe Mk1
  async eau() {
    const xs = [...Array(5).keys()].map(XX).concat([...Array(4).keys()].map((j) => XD(j) + 200), [X_COLONNE]);
    const J = await junctionLine('eau bas', xs, YB1S, ZF);
    for (const i of [...Array(5).keys()]) await link('extracteur ' + i + ' > eau', REC.pipe, A('extracteur ' + i), 'FGPipeConnectionFactory', J(XX(i)), 'Connection3');
    for (const j of [...Array(4).keys()]) await link('eau > D ' + j, REC.pipe, J(XD(j) + 200), 'Connection3', d1(j), 'PipeInputFactory');
    const R = await junctionLine('eau R', KR.map((k) => XR(k) - 200), YRS, ZF0);
    for (const k of KR) await link('eau > R ' + k, REC.pipe, R(XR(k) - 200), 'Connection3', r0(k), 'PipeInputFactory');
    await link('colonne eau', REC.pipe, J(X_COLONNE), 'Connection3', R(X_COLONNE), 'Connection2');
    await pompe('pompe eau', REC.pump1, st.links['colonne eau'], ZF + 300, Z0);
  },
  // Residu (-17 m, +9, au sud) : couloir (x XC.residu) depuis la ligne de H, devant les D, puis jusqu'a B2
  async residuB1() {
    // relais (tuyaux de 56 m au plus) entre les jonctions d'eau, 4 m plus bas
    const J = await junctionLine('residu B1', [XC.residu, dx(56900), dx(58900), dx(62900)].concat([...Array(4).keys()].map((j) => XD(j) + 600)), YB1S, ZF2);
    for (const j of [...Array(4).keys()]) await link('residu > D ' + j, REC.pipe, J(XD(j) + 600), 'Connection3', d1(j), 'PipeInputFactory1');
    await link('residu H > B1', REC.pipe, A('residu H ' + XC.residu), 'Connection3', J(XC.residu), 'Connection2');
  },
  // Carburant (-17 m, +5, au nord des D) jusqu'au couloir x XC.carburant
  async carburantB1() {
    const J = await junctionLine('carburant B1', [...Array(4).keys()].map((j) => XD(j) + 600).concat([XC.carburant, dx(58000), dx(62000)]), YB1N, ZF);
    for (const j of [...Array(4).keys()]) await link('D ' + j + ' > carburant', REC.pipe, d1(j), 'PipeOutputFactory', J(XD(j) + 600), 'Connection2');
  },
  // Resine a 0 m : repartiteurs devant les R (cap 0, vers l'est) depuis le haut de la montee ; broyeur au bout
  async resineR() {
    for (const k of KR) await build('resine R ' + k, REC.splitter, { x: XR(k) + 200, y: YRS, z: ZB0 }, 0);
    const W = await build('broyeur', REC.sink, BROYEUR.at, BROYEUR.yaw);
    await link('resine haut > R 0', REC.belt, A('resine haut'), 'Output1', A('resine R 0'), 'Input1');
    for (let k = 1; k < KR.length; k++) await link('resine R ' + (k - 1) + ' > ' + k, REC.belt, A('resine R ' + (k - 1)), 'Output1', A('resine R ' + k), 'Input1');
    for (const k of KR) await link('resine > R ' + k, REC.belt, A('resine R ' + k), 'Output' + side(0, 'N'), r0(k), 'Input0');
    await link('resine > broyeur', REC.belt, A('resine R ' + (KR.length - 1)), 'Output1', W, 'Input0');
  },
  // Caoutchouc a 0 m (au nord des R, +1, vers l'est) -> conteneur tampon
  async caoutchouc() {
    for (const k of KR) await build('caoutchouc ' + k, REC.merger, { x: XR(k) + 200, y: YRN, z: ZB0 }, 0);
    const T = await build('tampon caoutchouc', REC.container, TAMPON.at, TAMPON.yaw);
    for (const k of KR) await link('R ' + k + ' > caoutchouc', REC.belt, r0(k), 'Output1', A('caoutchouc ' + k), 'Input' + side(0, 'S'));
    for (let k = 1; k < KR.length; k++) await link('caoutchouc ' + (k - 1) + ' > ' + k, REC.belt, A('caoutchouc ' + (k - 1)), 'Output1', A('caoutchouc ' + k), 'Input1');
    await link('caoutchouc > tampon', REC.belt, A('caoutchouc ' + (KR.length - 1)), 'Output1', T, 'Input0');
  },

  // ------------------------------------------------------------------------------------------- Rangee B2 (-17 m)
  async melangeursT() {
    for (const k of KT) await build('T ' + k, REC.blender, { x: XT(k), y: YB2, z: Z1 }, 180);
  },
  async recettesT() { await recettes(KT.map((k) => ({ key: 'T ' + k, t: 'T' }))); },
  // Soufre (+1, repartiteurs cap 180 vers l'ouest, tete est libre) -> Input0
  async soufreT() {
    for (const k of KT) await build('soufre T ' + k, REC.splitter, { x: XT(k) - 200, y: YB2S, z: ZB }, 180);
    for (let k = 1; k < KT.length; k++) await link('soufre T ' + (k - 1) + ' > ' + k, REC.belt, A('soufre T ' + (k - 1)), 'Output1', A('soufre T ' + k), 'Input1');
    for (const k of KT) await link('soufre > T ' + k, REC.belt, A('soufre T ' + k), 'Output' + side(180, 'N'), t2(k), 'Input0');
  },
  // Residu (+5) devant PipeInputFactory, depuis le couloir ; carburant (+9) devant PipeInputFactory1, depuis le couloir,
  // prolonge au bout est (couloir est, vers les N de B3)
  async fluidesT() {
    const R = await junctionLine('residu T', [XC.residu].concat(KT.map((k) => XT(k) + 200)), YB2S, ZF);
    for (const k of KT) await link('residu > T ' + k, REC.pipe, R(XT(k) + 200), 'Connection3', t2(k), 'PipeInputFactory');
    // colonne entre les deux lignes, ses bouts a 20 m de leurs jonctions de tete (pas au meme point, 2 m plus bas)
    const ys = [YB1S - 2000, YB1S - 6000, YB2S + 2000];
    await junctionColumn('residu couloir', XC.residu, ys, ZF2 - 200);
    await link('residu B1 > couloir', REC.pipe, A('residu B1 ' + XC.residu), 'Connection3', A('residu couloir ' + ys[0]), 'Connection2');
    await link('residu couloir > T', REC.pipe, A('residu couloir ' + ys[2]), 'Connection3', R(XC.residu), 'Connection2');
    const C = await junctionLine('carburant T', [XC.carburant, XEST].concat(KT.map((k) => XT(k) + 600)), YB2S, ZF2);
    for (const k of KT) await link('carburant > T ' + k, REC.pipe, C(XT(k) + 600), 'Connection3', t2(k), 'PipeInputFactory1');
    await link('carburant B1 > T', REC.pipe, A('carburant B1 ' + XC.carburant), 'Connection3', C(XC.carburant), 'Connection2');
  },
  // Coke (+13) : repartiteurs cap 0 (vers l'est) depuis le haut de la montee, ascenseur vers Input1
  async cokeT() {
    const ks = [...KT].reverse(); // d'ouest en est
    for (const k of ks) await build('coke T ' + k, REC.splitter, { x: XT(k) - 600, y: YB2S, z: ZS2 }, 0);
    await link('coke montee > T ' + ks[0], REC.belt, A('coke montee haut'), 'Output1', A('coke T ' + ks[0]), 'Input1');
    for (let i = 1; i < ks.length; i++) await link('coke T ' + ks[i - 1] + ' > ' + ks[i], REC.belt, A('coke T ' + ks[i - 1]), 'Output1', A('coke T ' + ks[i]), 'Input1');
    for (const k of ks) await link('coke > T ' + k, REC.lift, A('coke T ' + k), 'Output' + side(0, 'N'), t2(k), 'Input1', { snapTolerance: 400 });
  },
  // Turbocarburant (+5, au nord) jusqu'au couloir, puis au nord jusqu'a la ligne des K de B3
  async turbo() {
    const J = await junctionLine('turbo T', KT.map((k) => XT(k) + 600).concat([XC.carburant]), YB2N, ZF);
    for (const k of KT) await link('T ' + k + ' > turbo', REC.pipe, t2(k), 'PipeOutputFactory', J(XT(k) + 600), 'Connection2');
  },

  // ------------------------------------------------------------------------------------------- Rangee B3 (-17 m)
  async melangeursB3() {
    for (const k of K3) await build('B3 ' + k + ' ' + T3(k), REC.blender, { x: X3(k), y: YB3, z: Z1 }, 180);
  },
  async recettesB3() { await recettes(K3.map((k) => ({ key: 'B3 ' + k + ' ' + T3(k), t: T3(k) }))); },
  // K : turbo (+5) depuis le couloir, acide nitrique (+9, tete ouest libre) ; N : azote (+5) et carburant (+9) par l'est
  async fluidesK() {
    const KS = K3.filter((k) => T3(k) === 'K');
    const TU = await junctionLine('turbo K', [XC.carburant].concat(KS.map((k) => X3(k) + 200)), YB3S, ZF);
    for (const k of KS) await link('turbo > K ' + k, REC.pipe, TU(X3(k) + 200), 'Connection3', b3(k), 'PipeInputFactory');
    await link('turbo couloir', REC.pipe, A('turbo T ' + XC.carburant), 'Connection3', TU(XC.carburant), 'Connection2');
    const NI = await junctionLine('nitrique K', [XC.residu].concat(KS.map((k) => X3(k) + 600)), YB3S, ZF2);
    for (const k of KS) await link('nitrique > K ' + k, REC.pipe, NI(X3(k) + 600), 'Connection3', b3(k), 'PipeInputFactory1');
  },
  // N (Nitro Rocket Fuel, recette alternative a debloquer) : azote et carburant
  async fluidesN() {
    const NS = K3.filter((k) => T3(k) === 'N');
    const AZ = await junctionLine('azote N', [XEST].concat(NS.map((k) => X3(k) + 200)), YB3S, ZF);
    for (const k of NS) await link('azote > N ' + k, REC.pipe, AZ(X3(k) + 200), 'Connection3', b3(k), 'PipeInputFactory');
    const CA = await junctionLine('carburant N', NS.map((k) => X3(k) + 600), YB3S, ZF2);
    for (const k of NS) await link('carburant > N ' + k, REC.pipe, CA(X3(k) + 600), 'Connection3', b3(k), 'PipeInputFactory1');
    // carburant : du bout est de la ligne de B2 (XEST) au nord, jusqu'a la ligne des N (prolongee a l'est)
    await junctionColumn('carburant est', XEST + 400, [YB2S - 3000], ZF2);
    await link('carburant T > est', REC.pipe, A('carburant T ' + XEST), 'Connection3', A('carburant est ' + (YB2S - 3000)), 'Connection2');
    await build('carburant N est', REC.junction, { x: XEST + 400, y: YB3S, z: ZF2 }, 0);
    await link('carburant est > N', REC.pipe, A('carburant est ' + (YB2S - 3000)), 'Connection3', A('carburant N est'), 'Connection2');
    await link('carburant N est > ligne', REC.pipe, A('carburant N est'), 'Connection0', CA(X3(NS[0]) + 600), 'Connection1');
  },
  // N : soufre (+1) et charbon (+13, ascenseur), repartiteurs cap 180 depuis les tetes est libres
  async solidesN() {
    const NS = K3.filter((k) => T3(k) === 'N');
    for (const k of NS) await build('soufre N ' + k, REC.splitter, { x: X3(k) - 200, y: YB3S, z: ZB }, 180);
    for (const k of NS) await build('charbon N ' + k, REC.splitter, { x: X3(k) - 600, y: YB3S, z: ZS2 }, 180);
    for (let i = 1; i < NS.length; i++) {
      await link('soufre N ' + NS[i - 1] + ' > ' + NS[i], REC.belt, A('soufre N ' + NS[i - 1]), 'Output1', A('soufre N ' + NS[i]), 'Input1');
      await link('charbon N ' + NS[i - 1] + ' > ' + NS[i], REC.belt, A('charbon N ' + NS[i - 1]), 'Output1', A('charbon N ' + NS[i]), 'Input1');
    }
    for (const k of NS) {
      await link('soufre > N ' + k, REC.belt, A('soufre N ' + k), 'Output' + side(180, 'N'), b3(k), 'Input0');
      await link('charbon > N ' + k, REC.lift, A('charbon N ' + k), 'Output' + side(180, 'N'), b3(k), 'Input1', { snapTolerance: 400 });
    }
  },
  // Au nord : carburant pour fusees (+5, deux troncons) et charbon compacte (+1, vers l'ouest, sortie libre au couloir)
  async sortiesB3() {
    const E = await junctionLine('fusee est', SEG_EST.map((k) => X3(k) + 600).concat([XGH.bas]), YB3N, ZF);
    for (const k of SEG_EST) await link('B3 ' + k + ' > fusee', REC.pipe, b3(k), 'PipeOutputFactory', E(X3(k) + 600), 'Connection2');
    const W = await junctionLine('fusee ouest', SEG_OUEST.map((k) => X3(k) + 600).concat([XGH.haut]), YB3N, ZF);
    for (const k of SEG_OUEST) await link('B3 ' + k + ' > fusee', REC.pipe, b3(k), 'PipeOutputFactory', W(X3(k) + 600), 'Connection2');
    const pts = K3.map((k) => ({ key: 'compacte ' + k, x: X3(k) + 200 })).concat([{ key: 'compacte sortie', x: XC.coke }]);
    for (const p of pts) await build(p.key, REC.merger, { x: p.x, y: YB3N, z: ZB }, 180);
    for (const k of K3) await link('B3 ' + k + ' > compacte', REC.belt, b3(k), 'Output1', A('compacte ' + k), 'Input' + side(180, 'S'));
    for (let i = 1; i < pts.length; i++) await link(pts[i - 1].key + ' > ' + pts[i].key, REC.belt, A(pts[i - 1].key), 'Output1', A(pts[i].key), 'Input1');
  },

  // ------------------------------------------------------------------------------------------- Generateurs
  async generateurs() {
    for (const niv of ['bas', 'haut']) for (const [p, ym] of YM.entries()) for (const c of KG) {
      await build('G ' + niv + ' ' + p + ' N ' + c, REC.generator, { x: XG(c), y: ym - 1300, z: ZG[niv] }, 180);
      await build('G ' + niv + ' ' + p + ' S ' + c, REC.generator, { x: XG(c), y: ym + 1300, z: ZG[niv] }, 0);
    }
  },
  async eclats() {
    for (const [key, a] of Object.entries(st.actors).filter(([k]) => k.startsWith('G '))) {
      if (DRY) { console.log(key.padEnd(40), '3 eclats, 250 %'); continue; }
      await call('addShards', a, 3);
      const s = await call('setClock', a, 2.5);
      console.log(key.padEnd(40), 'cadence', s.pendingPotential, 'eclats', s.powerShards);
    }
  },
  // Collecteurs : jonctions entre les rangees N et S de chaque paire, du collecteur le long d'y a la derniere colonne
  async collecteurs() {
    for (const niv of ['bas', 'haut']) {
      const zj = ZG[niv] + 180;
      for (const [p, ym] of YM.entries()) {
        const J = await junctionLine('collecteur ' + niv + ' ' + p, KG.map(XG).concat([XGH[niv]]), ym, zj);
        for (const c of KG) {
          await link('collecteur ' + niv + ' ' + p + ' > N ' + c, REC.pipe, J(XG(c)), 'Connection3', A('G ' + niv + ' ' + p + ' N ' + c), 'FGPipeConnectionFactory');
          await link('collecteur ' + niv + ' ' + p + ' > S ' + c, REC.pipe, J(XG(c)), 'Connection2', A('G ' + niv + ' ' + p + ' S ' + c), 'FGPipeConnectionFactory');
        }
      }
      // le long d'y, du sud au nord, par les bouts des collecteurs et des relais entre les paires
      const ys = YM.concat(YRELAIS_G);
      for (const y of YRELAIS_G) await build('montant ' + niv + ' ' + y, REC.junction, { x: XGH[niv], y, z: zj }, 0);
      const col = (y) => A('montant ' + niv + ' ' + y);
      const all = [...new Set(ys)].sort((a, b) => b - a);
      for (let i = 1; i < all.length; i++) {
        const a = YM.includes(all[i - 1]) ? A('collecteur ' + niv + ' ' + YM.indexOf(all[i - 1]) + ' ' + XGH[niv]) : col(all[i - 1]);
        const b = YM.includes(all[i]) ? A('collecteur ' + niv + ' ' + YM.indexOf(all[i]) + ' ' + XGH[niv]) : col(all[i]);
        await link('montant ' + niv + ' ' + all[i - 1] + ' > ' + all[i], REC.pipe, a, 'Connection3', b, 'Connection2');
      }
    }
  },
  // Colonnes : du bout du troncon de B3 (-12 m) vers le sud jusqu'au montant, par des jonctions relais (pente des tuyaux
  // d'environ 1,4 au plus, comme les colonnes d'eau) ; pompes Mk2 sur les premiers tuyaux.
  //  - +32 m (est, x 74 400) : 2 sauts de 16 m jusqu'au bout nord du montant (collecteur de la paire 2, Connection3) ;
  //  - +64 m (ouest, x 53 400) : 78 m a monter -> sous le montant vers le sud, puis dans l'intervalle entre les paires
  //    1 et 2 (y -284 300 .. -288 700, sans generateurs) jusqu'au relais -286 500 du montant (Connection1, a l'est).
  async colonnes() {
    const CHEMINS = {
      bas: { seg: 'fusee est', pts: [{ x: XEST, y: dy(-292600), z: 1100, in: 'Connection3', out: 'Connection2' }],
        fin: [A('collecteur bas 2 ' + XEST), 'Connection3'] },
      haut: { seg: 'fusee ouest', pts: [{ x: XC.residu, y: dy(-292000), z: 1600, in: 'Connection3', out: 'Connection2' },
        { x: XC.residu, y: dy(-288600), z: 4400, in: 'Connection3', out: 'Connection1' },
        { x: dx(55000), y: YRELAIS_G[1], z: 5000, in: 'Connection3', out: 'Connection0' }],
        fin: [A('montant haut ' + YRELAIS_G[1]), 'Connection1'] },
    };
    for (const [niv, c] of Object.entries(CHEMINS)) {
      const keys = c.pts.map((p, i) => 'colonne ' + niv + ' ' + i);
      for (const [i, p] of c.pts.entries()) await build(keys[i], REC.junction, { x: p.x, y: p.y, z: p.z }, 0);
      await link('colonne ' + niv + ' pied', REC.pipe, A(c.seg + ' ' + XGH[niv]), 'Connection2', A(keys[0]), c.pts[0].in);
      for (let i = 1; i < keys.length; i++) await link('colonne ' + niv + ' ' + (i - 1) + ' > ' + i, REC.pipe, A(keys[i - 1]), c.pts[i - 1].out, A(keys[i]), c.pts[i].in);
      await link('colonne ' + niv + ' > montant', REC.pipe, A(keys[keys.length - 1]), c.pts[keys.length - 1].out, c.fin[0], c.fin[1]);
      await pompe('pompe ' + niv + ' 0', REC.pump2, st.links['colonne ' + niv + ' pied'], ZF + 300, c.pts[0].z - 200);
      if (niv === 'haut') await pompe('pompe haut 1', REC.pump2, st.links['colonne haut 0 > 1'], c.pts[0].z + 300, c.pts[1].z - 200);
    }
  },

  // Courant : poteaux Mk3 en l'air dans les couloirs entre les rangees (10 connexions au plus, cables de 70 m au plus),
  // relies au poteau Mk1 du circuit principal au bord de la voie basse ; generateurs par 4 (2 colonnes, rangees N et S)
  // sur un poteau dans le couloir de leur collecteur, 1,5 m au sud du tuyau ; paires reliees par des relais dans les
  // intervalles (y -277 500 et -286 500), etages relies a la verticale ; le champ rejoint le relais M des rangees.
  async courant() {
    const POLE = 'Recipe_PowerPoleMk3_C';
    const P = {
      S0: { x: dx(61000), y: dy(-268000), z: Z1 },
      L1e: { x: dx(67000), y: dy(-273900), z: Z1 }, L1w: { x: dx(60000), y: dy(-273900), z: Z1 },
      L1r: { x: dx(59800), y: dy(-273900), z: Z0 },
      L2w: { x: dx(59900), y: dy(-279800), z: Z1 }, L2e: { x: dx(68750), y: dy(-279800), z: Z1 },
      M: { x: dx(64000), y: dy(-282900), z: Z1 },
      L3e: { x: dx(70000), y: dy(-288400), z: Z1 }, L3m: { x: dx(64000), y: dy(-288400), z: Z1 }, L3w: { x: dx(58500), y: dy(-288400), z: Z1 },
    };
    const XQ = [dx(71600), dx(66800), dx(62000), dx(57200)];
    for (const niv of ['bas', 'haut']) {
      for (const [p, ym] of YM.entries()) for (const [q, x] of XQ.entries()) P['G ' + niv + ' ' + p + ' ' + q] = { x, y: ym + 150, z: ZG[niv] };
      for (const [i, y] of YRELAIS_G.entries()) P['GR ' + niv + ' ' + i] = { x: XQ[2], y, z: ZG[niv] };
    }
    for (const [n, at] of Object.entries(P)) await build('poteau ' + n, POLE, at, 0);
    const p = (n) => A('poteau ' + n);
    const SOURCE = PREFIX + 'Build_PowerPoleMk1_C_2144799861';   // circuit principal, (62 948 ; -262 795 ; -17 m)
    const plan = [['S0', SOURCE], ['L1w', p('S0')], ['L1e', p('L1w')], ['L1r', p('L1w')], ['L2w', p('L1w')], ['L2e', p('L1e')],
      ['M', p('L2w')], ['L3m', p('M')], ['L3e', p('L3m')], ['L3w', p('L3m')]];
    KH.forEach((k) => plan.push([k < 8 ? 'L1e' : k < 14 ? 'L1w' : 'S0', h(k)]));
    KR.forEach((k) => plan.push(['L1r', r0(k)]));
    plan.push(['L1r', A('broyeur')]);
    [...Array(5).keys()].forEach((i) => plan.push(['L2w', A('extracteur ' + i)]));
    plan.push(['L2w', A('pompe eau')]);
    [...Array(4).keys()].forEach((j) => plan.push(['L2e', d1(j)]));
    KT.forEach((k) => plan.push([k < 4 ? 'L3e' : k < 7 ? 'L3m' : 'L3w', t2(k)]));
    K3.forEach((k) => plan.push([k < 4 ? 'L3e' : k < 7 ? 'L3m' : 'L3w', b3(k)]));
    plan.push(['L3e', A('pompe bas 0')], ['L3w', A('pompe haut 0')], ['L3w', A('pompe haut 1')]);
    for (const niv of ['bas', 'haut']) {
      for (const [pi] of YM.entries()) {
        for (let q = 1; q < 4; q++) plan.push(['G ' + niv + ' ' + pi + ' ' + q, p('G ' + niv + ' ' + pi + ' ' + (q - 1))]);
        for (const [q] of XQ.entries()) for (const c of [2 * q, 2 * q + 1]) for (const r of ['N', 'S']) plan.push(['G ' + niv + ' ' + pi + ' ' + q, A('G ' + niv + ' ' + pi + ' ' + r + ' ' + c)]);
      }
      for (const i of [0, 1]) plan.push(['GR ' + niv + ' ' + i, p('G ' + niv + ' ' + i + ' 2')], ['GR ' + niv + ' ' + i, p('G ' + niv + ' ' + (i + 1) + ' 2')]);
      plan.push(['GR haut 0', p('GR bas 0')]);
    }
    plan.push(['GR bas 1', p('M')]);
    const count = {};
    for (const [a, b] of plan) { count[a] = (count[a] || 0) + 1; const kb = Object.keys(st.actors).find((k) => k.startsWith('poteau ') && st.actors[k] === b); if (kb) count[kb.slice(7)] = (count[kb.slice(7)] || 0) + 1; }
    const over = Object.entries(count).filter(([, n]) => n > 10);
    if (over.length) throw new Error('poteaux trop charges : ' + JSON.stringify(over));
    for (const [a, b] of plan) {
      const key = a + ' > ' + (b ? short(b) : '?');
      if (st.wires[key]) continue;
      if (!p(a) || !b) { console.log(('cable ' + key).padEnd(40), 'saute (bout absent)'); continue; }
      const r = await call('wire', p(a), b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
  },

  async verifie() {
    let libres = 0;
    for (const [key, a] of Object.entries(st.actors)) {
      const conns = await call('connections', a);
      const free = conns.filter((c) => !c.connected).map((c) => c.name);
      libres += free.length;
      if (free.length) console.log(key.padEnd(40), 'libres :', free.join(' '));
    }
    console.log(Object.keys(st.actors).length, 'acteurs,', Object.keys(st.links).length, 'liaisons,', libres, 'connecteurs libres');
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node carburant-fusee.js <' + Object.keys(PHASES).join('|') + '> [--module=1] [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
