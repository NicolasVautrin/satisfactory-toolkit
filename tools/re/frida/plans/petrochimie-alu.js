// Petrochimie du complexe aluminium, phase 1 (utilisateur, 25/10/2026 : « go pour la petrochimie » ; « on va se contenter
// du coke pour toute la filiere alu et du caoutchouc uniquement pour le nuke » ; raffineries de petrole « au ras de
// l'eau, comme les extracteurs d'eau »). Au nord du module 1 (module-alu.js).
// Bloc 1, coke, a -17 m (pas d'eau, pas d'extracteurs dessous), rangee d'est en ouest a y -298 000 :
//  - F x 4 : residu lourd (alternative, 30 petrole -> 40 residu + 20 resine) pour le carburant dilue du bloc 2, a 80 % ;
//  - 8 paires H C : H residu lourd -> C coke (40 residu -> 120 coke) par un tuyau direct au nord ; 960 coke/min = le
//    besoin du module 1. H et F face au sud (cap 0 : entree de petrole au sud, residu et resine au nord), C face au nord
//    (cap 180 : entree de residu au nord, coke au sud).
//  - lignes superposees 5 m devant les connecteurs (les tuyaux des paires ne debordent que de 2 m au nord) : au sud,
//    petrole (+5 m, jonctions devant les F et H, alimente par le bout est) et collecteur de coke (+1 m, fusionneurs
//    devant les C, vers l'est) ; au nord, resine (+1 m, fusionneurs devant les F et H, vers l'est) et residu des F
//    (+5 m, jonctions).
//  - tronc du coke : du bout est, le long du couloir x -36 300 jusqu'au module 1, a +1 m (le petrole viendra du sud
//    dans le meme couloir, a +5 m : la pile du sud de la rangee qui tourne au sud) ; au bout, a l'est du module, un
//    ascenseur de 17 m monte le coke a la tete de la ligne de coke du module (repartiteur 'coke 0', entree a l'est).
// Resine : la ligne finit dans un broyeur, apres les raffineries de caoutchouc residuel (debordement). Sinon, quand le
// caoutchouc n'est pas consomme (le nucleaire ne le prend pas encore), la resine bloquerait les H, donc le coke, donc le
// module alu.
// Bloc 2, caoutchouc pour le nucleaire (chaine du solveur, 353 caoutchouc/min net), 60 m au nord du bloc 1 : rangee a
// 0 m d'est en ouest, R x 5 (caoutchouc residuel, 96 %), U x 6 (caoutchouc recycle, 95 %), P x 3 (plastique recycle,
// 95 %) ; dessous, a -17 m, 4 extracteurs d'eau a l'est et 3 melangeurs de carburant dilue (85,5 %) a l'ouest.
//  - R et U face au sud (cap 0), P face au nord (cap 180) : le plastique boucle au sud (P -> U), le caoutchouc au nord
//    (R, U -> P, puis sortie vers un conteneur tampon a l'ouest, en attendant le nucleaire).
//  - au sud, a +1 m : resine (repartiteurs devant les R, depuis le bout est ; le dernier deborde dans un broyeur) et
//    plastique (fusionneurs devant les P, repartiteurs devant les U, vers l'est) ; a +5 m : eau des R, carburant des U.
//  - au nord, a +1 m : caoutchouc (fusionneurs devant les R et U, repartiteurs devant les P, vers l'ouest) ; a +5 m :
//    carburant des P, relie au carburant des U par le bout ouest de la rangee.
//  - a -17 m, au sud de la rangee : eau (+5 m) des extracteurs vers les melangeurs et une colonne vers la ligne d'eau
//    des R ; residu (+9 m) du bloc 1 vers les melangeurs. Au nord : carburant (+5 m) des melangeurs, colonne vers la
//    ligne de carburant des P. Les deux colonnes portent une pompe Mk1.
// usage : node petrochimie-alu.js <phase> [--dry]
//   phases bloc 1 : raffineries | recettes | paires | petrole | coke | tronc | resine | residu | verifie
//   phases bloc 2 : raffineries2 | recettes2 | extracteurs2 | melangeurs | eau2 | residu2 | carburant | pompes2 |
//                   resine2 | plastique | caoutchouc
// Etat : petrochimie-alu1-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const WATER_VOLUME = PREFIX + 'FGWaterVolume_7'; // mer du nord (voir module-alu.js)
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  refinery: 'Recipe_OilRefinery_C', pipe: 'Recipe_PipelineMK2_C', junction: 'Recipe_PipelineJunction_Cross_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C',
  extractor: 'Recipe_WaterPump_C', pump1: 'Recipe_PipelinePump_C', blender: 'Recipe_Blender_C',
  sink: 'Recipe_ResourceSink_C', container: 'Recipe_StorageContainerMk2_C',
  H: 'Recipe_Alternate_HeavyOilResidue_C', F: 'Recipe_Alternate_HeavyOilResidue_C', C: 'Recipe_PetroleumCoke_C',
  R: 'Recipe_ResidualRubber_C', U: 'Recipe_Alternate_RecycledRubber_C', P: 'Recipe_Alternate_Plastic_1_C',
  M: 'Recipe_Alternate_DilutedFuel_C',
};

// --- Geometrie du bloc 1 ----------------------------------------------------------------------------------
const Y1 = -298000, Z1 = -1700;            // axe de la rangee, base des raffineries (ras de l'eau, surface -17,3 m)
const X1 = (k) => -37400 - 1200 * k;       // pas de 12 m, comme le module 1
const K1 = [...Array(20).keys()];
const TYPE1 = (k) => (k < 4 ? 'F' : (k - 4) % 2 === 0 ? 'H' : 'C');
const YAW = { F: 0, H: 0, C: 180 };
const CLOCK = { F: 0.8 };                  // 4 x 40 x 0,8 = 128 residu/min pour 2,57 melangeurs de carburant dilue
// Lignes : jonction au cap 0 (Connection0 ouest, 1 est, 2 sud, 3 nord) ; fusionneur au cap 0 (Input1 ouest, Output1 est,
// Input2 sud, Input3 nord). Raffinerie au cap 0 : tuyaux a x-2 m, convoyeurs a x+2 m, entrees au sud (+9 m), sorties au
// nord ; au cap 180, l'inverse.
const Y1S = Y1 + 1400, Y1N = Y1 - 1400, ZB = Z1 + 100, ZF = Z1 + 500;
const FH = K1.filter((k) => TYPE1(k) !== 'C');   // d'est en ouest
const CS = K1.filter((k) => TYPE1(k) === 'C');
const FS = K1.filter((k) => TYPE1(k) === 'F');
// Tronc du coke : relais (fusionneurs) de 44 m au plus le long de x -36 300, au cap 90 (Input1 nord, Output1 sud,
// Input2 ouest) ; le premier prend le coke de l'ouest, le dernier (cap 0) le renvoie a l'est vers la montee
const XT = -36300;
const COKE_EST = { x: -40600, y: Y1S, z: ZB };   // relais entre les jonctions de petrole des F (x -40 000 et -41 200)
const TRONC = [-296600, -292160, -287720, -283280, -278840];
const Y_TETE = -274400;                          // ligne de coke du module 1 (nord de sa rangee)
const MONTEE = { x: -35700, bas: ZB, haut: 100 };
const MODULE1 = path.join(__dirname, 'module-alu1-state.json');

// --- Geometrie du bloc 2 ----------------------------------------------------------------------------------
const Y2 = -304000, Z2 = 0;
const X2 = (k) => -37400 - 1200 * k;
const K2 = [...Array(14).keys()];
const TYPE2 = (k) => (k < 5 ? 'R' : k < 11 ? 'U' : 'P');
const YAW2 = { R: 0, U: 0, P: 180 };
// 5 x 40 x 0,96 = 192 resine sur 224 ; 6 x 30 x 0,95 = 171 plastique = 3 x 60 x 0,95 ; carburant 171 + 85,5 = 256,5
// = 3 melangeurs a 85,5 % (128 residu = les 4 F du bloc 1) ; eau 192 + 256,5 = 448,5 sur 480 (4 extracteurs a 100 %)
const CLOCK2 = { R: 0.96, U: 0.95, P: 0.95, M: 0.855 };
const ref2 = (k) => st.actors['b2 raffinerie ' + k + ' ' + TYPE2(k)];
const S2 = Y2 + 1400, N2 = Y2 - 1400, ZB2 = Z2 + 100, ZF2 = Z2 + 500;
const KS = (t) => K2.filter((k) => TYPE2(k) === t);  // d'est en ouest
// -17 m : extracteurs (sortie au sud, molette 180, comme au module 1) et melangeurs au cap 180 (entrees de tuyau au sud,
// a x+2 m et x+6 m, 7 m devant ; sortie de carburant au nord a x+6 m, 7,4 m devant ; releve sur Build_Blender_C_2144552064)
const EXTRACTORS2 = [0, 2, 4, 6].map((k) => ({ k, x: X2(k) - 500, y: Y2 + 300 }));
const BLENDERS = [8, 10, 12].map((k) => ({ k, x: X2(k) - 600, y: Y2 }));
const YM = Y2 + 2600, ZW = Z1 + 500, ZR = Z1 + 900;   // eau et residu, au sud de la rangee
const YC = Y2 - 3000, ZC = Z1 + 500;                  // carburant, au nord
const X_EAU_COLONNE = X2(1) - 200;                    // sous la jonction d'eau de R 1
const X_CARB_COLONNE = X2(11) + 200;                  // sous la jonction de carburant de P 11
const X_RESIDU = [X1(3) - 200, -44100];               // tete (sous la jonction de residu de F 3 du bloc 1), relais
const X_COIN = X2(13) - 1600;                         // bout ouest : le carburant passe du nord au sud
// resine du bloc 1 : relais a l'est (couloir x -36 300), ascenseur de 17 m, puis au nord jusqu'a la ligne du bloc 2
const RESINE_RELAIS = {
  A: { at: { x: XT, y: Y1N, z: ZB }, yaw: 0 }, B: { at: { x: XT, y: Y1N, z: ZB2 }, yaw: -90 },
  C: { at: { x: XT, y: S2, z: ZB2 }, yaw: 180 },
};
const BROYEUR = { at: { x: -43000, y: -300800, z: Z2 }, yaw: 180 };   // entree au nord, 5 m devant
const TAMPON = { at: { x: -56500, y: N2, z: Z2 }, yaw: 90 };          // entrees a l'est (+1 et +5 m)

// --- Courant ----------------------------------------------------------------------------------------------
// ~1,3 GW (34 raffineries, 3 melangeurs, 4 extracteurs, 2 pompes, 1 broyeur) sur le circuit principal (80 GW de
// capacite, 18,6 consommes le 25/10/2026). Poteaux Mk3 en l'air (9,5 m) : deux relais au-dessus de l'eau depuis le
// poteau Q0 du module 1 (4 connexions libres), 3 poteaux au sud du bloc 1, 2 au nord du bloc 2 (raffineries), 2 a -17 m
// entre les blocs (extracteurs, pompe d'eau, broyeur ; melangeurs, pompe de carburant). 10 connexions au plus par poteau.
// --- Petrole : puits de l'ouest (alu 3 = gisement 28_101 normal, 15 et 16 impurs ; 300 + 150 + 150 = 600 m3/min a 250 %,
// un tuyau Mk2) ---------------------------------------------------------------------------------------------------------
// Extracteur de petrole : sortie a 7,6 m du centre, du cote +y local, a +1,75 m ; cap = sens de la sortie - 90.
// 28_101 (plage, -17 m) : cap 0, sortie au sud ; 16 (plateau, +23 m) : cap 180, sortie au nord ; 15 : cap 90, sortie a
// l'ouest. 15 et 16, a 750 m du joueur : relief charge par des sources de streaming le temps de la pose.
const PUITS = [
  { g: '28_101', at: { x: -35726, y: -209521, z: -1709 }, cap: 0 },
  { g: '16', at: { x: -43612, y: -190316, z: 2291 }, cap: 180, loin: true },
  { g: '15', at: { x: -32600, y: -192537, z: 2280 }, cap: 90, loin: true },
];
// Oleoduc (jonctions relais a 48 m au plus, 3 m au moins au-dessus du relief releve par tracer.js carte, mailles de 4 m) :
// plateau (+27 m) de 15 a 16 le long de y -192 400 ; rampe au nord le long de x -43 612 jusqu'a la plage (-11 m) ; a l'est
// le long de y -207 400 par la jonction de 28_101 ; tronc au nord le long de x -33 600 (l'ilot de y -257 500 .. -251 900 et
// le haut-fond de y -243 900 .. -239 100 sont sur x -36 300) ; sous la gare N266 O40 et le long du tronc du coke, x -36 300,
// relais decales de 13 m au moins de ceux du coke ; arrivee sur la tete de la ligne de petrole du bloc 1 ('petrole 0').
// [cle, x, y, z, connecteur d'entree, connecteur de sortie] dans le sens du petrole
const ZO = -1100;
const OLEODUC = [
  ['po 15', -34800, -192400, 2700, 'Connection1', 'Connection0'],
  ['po 15b', -39200, -192400, 2700, 'Connection1', 'Connection0'],
  ['po 16', -43612, -192400, 2700, 'Connection1', 'Connection3'],
  ['po rampe 1', -43612, -197200, 2700, 'Connection2', 'Connection3'],
  ['po rampe 2', -43612, -200800, 2600, 'Connection2', 'Connection3'],
  ['po rampe 3', -43612, -203200, 400, 'Connection2', 'Connection3'],
  ['po rampe 4', -43612, -205200, -450, 'Connection2', 'Connection3'],
  ['po plage', -43612, -207400, ZO, 'Connection2', 'Connection1'],
  ['po plage 2', -39700, -207400, ZO, 'Connection0', 'Connection1'],
  ['po 28_101', -35726, -207400, ZO, 'Connection0', 'Connection1'],
  ['po coin sud', -33600, -207400, ZO, 'Connection0', 'Connection3'],
  ...[...Array(11).keys()].map((i) => ['po tronc ' + (i + 1), -33600, Math.round(-207400 - 4745.45 * (i + 1)), ZO, 'Connection2', 'Connection3']),
  ...[...Array(8).keys()].map((i) => ['po nord ' + i, -36300, Math.round(-262800 - 4642.86 * i), ZO, 'Connection2', 'Connection3']),
];
// sortie de chaque puits -> connecteur de sa jonction
const PUITS_JONCTION = { '28_101': ['po 28_101', 'Connection3'], 16: ['po 16', 'Connection2'], 15: ['po 15', 'Connection1'] };
// Courant des puits (~400 MW a 250 %) : poteau Mk1 du circuit principal sur la crete (2 connexions libres), un Mk3 au-dessus
// de la plage de 28_101, un sur le plateau ; cables de 90 m au plus
const RESEAU_PUITS = PREFIX + 'Build_PowerPoleMk1_C_2146707679'; // (-39 088 ; -201 370 ; +75,7 m)
const POLES_PUITS = { 'puits plage': { x: -38000, y: -205600, z: Z2 }, 'puits plateau': { x: -38800, y: -195000, z: 2300 } };

const POLES = {
  'relais 0': { x: X1(3), y: -282100, z: Z1 }, 'relais 1': { x: X1(3), y: -288800, z: Z1 },
  'b1 0': { x: X1(3), y: Y1 + 2600, z: Z1 }, 'b1 1': { x: X1(10), y: Y1 + 2600, z: Z1 }, 'b1 2': { x: X1(16), y: Y1 + 2600, z: Z1 },
  'b2 0': { x: X2(3), y: Y2 - 2400, z: Z2 }, 'b2 1': { x: X2(10), y: Y2 - 2400, z: Z2 },
  'b2 2': { x: -41600, y: Y2 + 2000, z: Z1 }, 'b2 3': { x: -51200, y: Y2 + 2000, z: Z1 },
};

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'petrochimie-alu1-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };

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
const ref1 = (k) => st.actors['raffinerie ' + k + ' ' + TYPE1(k)];

// Points d'un tuyau (spline relue dans le jeu), en coordonnees monde
async function pipePoints(pipe) {
  const pose = await call('pose', pipe);
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData;
  const yaw = pose.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = pose.location;
  return pts.map((p) => ({ x: o.x + p.Location.X * c - p.Location.Y * s, y: o.y + p.Location.X * s + p.Location.Y * c, z: o.z + p.Location.Z }));
}

// Pompe Mk1 sur la partie verticale d'une colonne (le jeu la refuse a plat et dans les coudes) : premier point accepte
// a blanc entre zmin et zmax (module-alu.js, phase pompes)
async function pompe(key, pipe, zmin, zmax) {
  if (st.actors[key]) return;
  if (!pipe) { console.log(key.padEnd(34), 'saute (colonne absente)'); return; }
  const w = await pipePoints(pipe), cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  let r = null;
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax)) {
    const aim = [{ x: p.x, y: p.y + 300, z: p.z + 300 }, p];
    const t = await call('buildAim', REC.pump1, aim[0], aim[1], { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    r = DRY ? t : await call('buildAim', REC.pump1, aim[0], aim[1], { onActor: pipe });
    console.log(key.padEnd(34), 'a', (p.z / 100).toFixed(1), 'm');
    break;
  }
  if (!r) throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
}

// Ligne de jonctions d'est en ouest a (y, z) : chainage Connection0 -> Connection1 de voisine en voisine
async function junctionLine(prefix, xs, y, z) {
  const sorted = [...xs].sort((a, b) => b - a);
  for (const x of sorted) await build(prefix + ' ' + x, REC.junction, { x, y, z }, 0, AIR);
  for (let i = 1; i < sorted.length; i++) await link(prefix + ' ' + sorted[i - 1] + ' > ' + sorted[i], REC.pipe, st.actors[prefix + ' ' + sorted[i - 1]], 'Connection0', st.actors[prefix + ' ' + sorted[i]], 'Connection1');
  return (x) => st.actors[prefix + ' ' + x];
}

const PHASES = {
  async raffineries() {
    for (const k of K1) await build('raffinerie ' + k + ' ' + TYPE1(k), REC.refinery, { x: X1(k), y: Y1, z: Z1 }, YAW[TYPE1(k)], AIR);
  },

  async recettes() {
    for (const k of K1) {
      const t = TYPE1(k), a = ref1(k);
      if (!a || DRY) { console.log(('raffinerie ' + k + ' ' + t).padEnd(34), DRY ? REC[t] : 'absente'); continue; }
      const r = await call('setRecipe', a, REC[t]);
      if (CLOCK[t]) await call('setClock', a, CLOCK[t]);
      console.log(('raffinerie ' + k + ' ' + t).padEnd(34), r.recipe, CLOCK[t] ? 'a ' + CLOCK[t] * 100 + ' %' : '');
    }
  },

  // residu de H (sortie au nord, x-2) -> C voisine (entree au nord, x+2 : 8 m plus a l'ouest), tuyau direct
  async paires() {
    for (const k of K1.filter((q) => TYPE1(q) === 'H')) await link('paire ' + k, REC.pipe, ref1(k), 'PipeOutputFactory', ref1(k + 1), 'PipeInputFactory');
  },

  // Petrole, au sud a +5 m : une jonction devant l'entree de chaque F et H, chainage d'est en ouest ; tete (jonction du
  // bout est, Connection1) libre pour le tuyau des puits
  async petrole() {
    for (const k of FH) await build('petrole ' + k, REC.junction, { x: X1(k) - 200, y: Y1S, z: ZF }, 0, AIR);
    const J = (k) => st.actors['petrole ' + k];
    for (let i = 1; i < FH.length; i++) await link('petrole ' + FH[i - 1] + ' > ' + FH[i], REC.pipe, J(FH[i - 1]), 'Connection0', J(FH[i]), 'Connection1');
    for (const k of FH) await link('petrole > raffinerie ' + k, REC.pipe, J(k), 'Connection3', ref1(k), 'PipeInputFactory');
  },

  // Coke, au sud a +1 m : un fusionneur devant la sortie de chaque C, collecteur vers l'est
  async coke() {
    for (const k of CS) await build('coke ' + k, REC.merger, { x: X1(k) - 200, y: Y1S, z: ZB }, 0, AIR);
    const M = (k) => st.actors['coke ' + k];
    for (const k of CS) await link('raffinerie ' + k + ' > coke', REC.belt, ref1(k), 'Output1', M(k), 'Input3');
    for (let i = CS.length - 1; i > 0; i--) await link('coke ' + CS[i] + ' > ' + CS[i - 1], REC.belt, M(CS[i]), 'Output1', M(CS[i - 1]), 'Input1');
  },

  // Tronc du coke jusqu'a la tete de la ligne de coke du module 1
  async tronc() {
    const E = await build('coke est', REC.merger, COKE_EST, 0, AIR);
    for (let i = 0; i < TRONC.length; i++) await build('tronc ' + i, REC.merger, { x: XT, y: TRONC[i], z: ZB }, 90, AIR);
    const T = (i) => st.actors['tronc ' + i];
    const B = await build('montee coke 0', REC.merger, { x: XT, y: Y_TETE, z: ZB }, 0, AIR);
    const U = await build('montee coke 1', REC.merger, { x: MONTEE.x, y: Y_TETE, z: MONTEE.bas }, 0, AIR);
    const V = await build('montee coke 2', REC.merger, { x: MONTEE.x, y: Y_TETE, z: MONTEE.haut }, 180, AIR);
    await link('coke ' + CS[0] + ' > coke est', REC.belt, st.actors['coke ' + CS[0]], 'Output1', E, 'Input1');
    await link('coke est > tronc 0', REC.belt, E, 'Output1', T(0), 'Input2');
    for (let i = 1; i < TRONC.length; i++) await link('tronc ' + (i - 1) + ' > ' + i, REC.belt, T(i - 1), 'Output1', T(i), 'Input1');
    await link('tronc ' + (TRONC.length - 1) + ' > montee', REC.belt, T(TRONC.length - 1), 'Output1', B, 'Input3');
    await link('montee coke 0 > 1', REC.belt, B, 'Output1', U, 'Input1');
    await link('montee coke 1 > 2', REC.lift, U, 'Output1', V, 'Input1', { snapTolerance: 400 });
    const tete = JSON.parse(fs.readFileSync(MODULE1, 'utf8')).actors['coke 0'];
    await link('montee coke > module 1', REC.belt, V, 'Output1', tete, 'Input1');
  },

  // Resine, au nord a +1 m : un fusionneur devant la sortie de convoyeur de chaque F et H, collecteur vers l'est ; tete
  // (Output1 du fusionneur du bout est) libre pour le bloc 2
  async resine() {
    for (const k of FH) await build('resine ' + k, REC.merger, { x: X1(k) + 200, y: Y1N, z: ZB }, 0, AIR);
    const M = (k) => st.actors['resine ' + k];
    for (const k of FH) await link('raffinerie ' + k + ' > resine', REC.belt, ref1(k), 'Output1', M(k), 'Input2');
    for (let i = FH.length - 1; i > 0; i--) await link('resine ' + FH[i] + ' > ' + FH[i - 1], REC.belt, M(FH[i]), 'Output1', M(FH[i - 1]), 'Input1');
  },

  // Residu des F, au nord a +5 m : une jonction devant la sortie de tuyau de chaque F ; bouts libres pour les melangeurs
  async residu() {
    for (const k of FS) await build('residu ' + k, REC.junction, { x: X1(k) - 200, y: Y1N, z: ZF }, 0, AIR);
    const J = (k) => st.actors['residu ' + k];
    for (let i = 1; i < FS.length; i++) await link('residu ' + FS[i - 1] + ' > ' + FS[i], REC.pipe, J(FS[i - 1]), 'Connection0', J(FS[i]), 'Connection1');
    for (const k of FS) await link('residu > raffinerie ' + k, REC.pipe, J(k), 'Connection2', ref1(k), 'PipeOutputFactory');
  },

  // --- Bloc 2 ---------------------------------------------------------------------------------------------
  async raffineries2() {
    for (const k of K2) await build('b2 raffinerie ' + k + ' ' + TYPE2(k), REC.refinery, { x: X2(k), y: Y2, z: Z2 }, YAW2[TYPE2(k)], AIR);
  },

  async recettes2() {
    const all = K2.map((k) => ({ key: 'b2 raffinerie ' + k + ' ' + TYPE2(k), t: TYPE2(k) }))
      .concat(BLENDERS.map((b) => ({ key: 'b2 melangeur ' + b.k, t: 'M' })));
    for (const { key, t } of all) {
      const a = st.actors[key];
      if (!a || DRY) { console.log(key.padEnd(34), DRY ? REC[t] : 'absent'); continue; }
      const r = await call('setRecipe', a, REC[t]);
      await call('setClock', a, CLOCK2[t]);
      console.log(key.padEnd(34), r.recipe, 'a', CLOCK2[t] * 100, '%');
    }
  },

  async extracteurs2() {
    for (const e of EXTRACTORS2) {
      const key = 'b2 extracteur ' + e.k;
      if (st.actors[key]) continue;
      const r = await call('buildAim', REC.extractor, { x: e.x, y: e.y, z: 1000 }, { x: e.x, y: e.y, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: 180 });
      report(key, r);
      if (r.hologram) console.log('   hologramme', JSON.stringify(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  async melangeurs() {
    for (const b of BLENDERS) await build('b2 melangeur ' + b.k, REC.blender, { x: b.x, y: b.y, z: Z1 }, 180, AIR);
  },

  // Eau : ligne a -17 m (+5 m) au sud, des extracteurs vers les melangeurs et la colonne ; ligne des R a +5 m au sud
  async eau2() {
    const xs = EXTRACTORS2.map((e) => e.x).concat(BLENDERS.map((b) => b.x + 200), [X_EAU_COLONNE]);
    const J = await junctionLine('b2 eau bas', xs, YM, ZW);
    for (const e of EXTRACTORS2) await link('b2 colonne extracteur ' + e.k, REC.pipe, st.actors['b2 extracteur ' + e.k], 'FGPipeConnectionFactory', J(e.x), 'Connection3');
    for (const b of BLENDERS) await link('b2 eau > melangeur ' + b.k, REC.pipe, J(b.x + 200), 'Connection3', st.actors['b2 melangeur ' + b.k], 'PipeInputFactory');
    const R = await junctionLine('b2 eau R', KS('R').map((k) => X2(k) - 200), S2, ZF2);
    for (const k of KS('R')) await link('b2 eau > raffinerie ' + k, REC.pipe, R(X2(k) - 200), 'Connection3', ref2(k), 'PipeInputFactory');
    await link('b2 colonne eau', REC.pipe, J(X_EAU_COLONNE), 'Connection3', R(X_EAU_COLONNE), 'Connection2');
  },

  // Residu des F du bloc 1 : de la jonction de F 3 (Connection3, au nord) a la tete de la ligne a -17 m (+9 m)
  async residu2() {
    const xs = X_RESIDU.concat(BLENDERS.map((b) => b.x + 600));
    const J = await junctionLine('b2 residu', xs, YM, ZR);
    await link('b2 residu bloc 1 > tete', REC.pipe, st.actors['residu 3'], 'Connection3', J(X_RESIDU[0]), 'Connection2');
    for (const b of BLENDERS) await link('b2 residu > melangeur ' + b.k, REC.pipe, J(b.x + 600), 'Connection3', st.actors['b2 melangeur ' + b.k], 'PipeInputFactory1');
  },

  // Carburant : ligne a -17 m (+5 m) au nord des melangeurs, colonne vers la ligne des P (nord, +5 m), puis par le bout
  // ouest jusqu'a la ligne des U (sud, +5 m)
  async carburant() {
    const xs = BLENDERS.map((b) => b.x + 600).concat([X_CARB_COLONNE]);
    const J = await junctionLine('b2 carburant bas', xs, YC, ZC);
    for (const b of BLENDERS) await link('b2 melangeur ' + b.k + ' > carburant', REC.pipe, st.actors['b2 melangeur ' + b.k], 'PipeOutputFactory', J(b.x + 600), 'Connection2');
    const P = await junctionLine('b2 carburant P', KS('P').map((k) => X2(k) + 200), N2, ZF2);
    for (const k of KS('P')) await link('b2 carburant > raffinerie ' + k, REC.pipe, P(X2(k) + 200), 'Connection2', ref2(k), 'PipeInputFactory');
    await link('b2 colonne carburant', REC.pipe, J(X_CARB_COLONNE), 'Connection2', P(X_CARB_COLONNE), 'Connection3');
    const U = await junctionLine('b2 carburant U', KS('U').map((k) => X2(k) - 200), S2, ZF2);
    for (const k of KS('U')) await link('b2 carburant > raffinerie ' + k, REC.pipe, U(X2(k) - 200), 'Connection3', ref2(k), 'PipeInputFactory');
    const NO = await build('b2 carburant coin nord', REC.junction, { x: X_COIN, y: N2, z: ZF2 }, 0, AIR);
    const SO = await build('b2 carburant coin sud', REC.junction, { x: X_COIN, y: S2, z: ZF2 }, 0, AIR);
    const pw = KS('P').slice(-1)[0], uw = KS('U').slice(-1)[0];
    await link('b2 carburant P > coin nord', REC.pipe, P(X2(pw) + 200), 'Connection0', NO, 'Connection1');
    await link('b2 carburant coin nord > sud', REC.pipe, NO, 'Connection2', SO, 'Connection3');
    await link('b2 carburant coin sud > U', REC.pipe, SO, 'Connection1', U(X2(uw) - 200), 'Connection0');
  },

  // Pompes Mk1 sur les deux colonnes (de +5 m a -17 m vers +5 m a 0 m), sur leur partie verticale
  async pompes2() {
    await pompe('b2 pompe eau', st.links['b2 colonne eau'], ZW + 300, Z2);
    await pompe('b2 pompe carburant', st.links['b2 colonne carburant'], ZC + 300, Z2);
  },

  // Resine : du bout est du bloc 1 (relais A, ascenseur, B) au bout est de la ligne du bloc 2 (C), repartiteurs devant les
  // R ; le dernier deborde dans le broyeur (la resine ne doit jamais bloquer les H, donc le coke)
  async resine2() {
    const S = (k) => st.actors['b2 resine ' + k];
    for (const k of KS('R')) await build('b2 resine ' + k, REC.splitter, { x: X2(k) + 200, y: S2, z: ZB2 }, 180, AIR);
    for (const [n, r] of Object.entries(RESINE_RELAIS)) await build('b2 resine relais ' + n, REC.merger, r.at, r.yaw, AIR);
    const W = await build('b2 broyeur', REC.sink, BROYEUR.at, BROYEUR.yaw, AIR);
    const R = (n) => st.actors['b2 resine relais ' + n];
    const rs = KS('R');
    for (let i = 1; i < rs.length; i++) await link('b2 resine ' + rs[i - 1] + ' > ' + rs[i], REC.belt, S(rs[i - 1]), 'Output1', S(rs[i]), 'Input1');
    for (const k of rs) await link('b2 resine > raffinerie ' + k, REC.belt, S(k), 'Output2', ref2(k), 'Input0');
    await link('b2 resine bloc 1 > A', REC.belt, st.actors['resine 0'], 'Output1', R('A'), 'Input1');
    await link('b2 resine A > B', REC.lift, R('A'), 'Output1', R('B'), 'Input2', { snapTolerance: 400 });
    await link('b2 resine B > C', REC.belt, R('B'), 'Output1', R('C'), 'Input3');
    await link('b2 resine C > ligne', REC.belt, R('C'), 'Output1', S(rs[0]), 'Input1');
    await link('b2 resine > broyeur', REC.belt, S(rs[rs.length - 1]), 'Output1', W, 'Input0');
  },

  // Plastique : fusionneurs devant les P (cap 0, vers l'est), puis repartiteurs devant les U
  async plastique() {
    const ps = KS('P'), us = KS('U');
    for (const k of ps) await build('b2 plastique ' + k, REC.merger, { x: X2(k) - 200, y: S2, z: ZB2 }, 0, AIR);
    for (const k of us) await build('b2 plastique ' + k, REC.splitter, { x: X2(k) + 200, y: S2, z: ZB2 }, 0, AIR);
    const M = (k) => st.actors['b2 plastique ' + k];
    for (const k of ps) await link('b2 raffinerie ' + k + ' > plastique', REC.belt, ref2(k), 'Output1', M(k), 'Input3');
    for (const k of us) await link('b2 plastique > raffinerie ' + k, REC.belt, M(k), 'Output3', ref2(k), 'Input0');
    const chain = ps.concat(us).sort((a, b) => b - a); // d'ouest en est
    for (let i = 1; i < chain.length; i++) await link('b2 plastique ' + chain[i - 1] + ' > ' + chain[i], REC.belt, M(chain[i - 1]), 'Output1', M(chain[i]), 'Input1');
  },

  // Caoutchouc : fusionneurs devant les R et U (cap 180, vers l'ouest), repartiteurs devant les P, sortie vers le tampon
  async caoutchouc() {
    const ins = KS('R').concat(KS('U')), ps = KS('P');
    for (const k of ins) await build('b2 caoutchouc ' + k, REC.merger, { x: X2(k) + 200, y: N2, z: ZB2 }, 180, AIR);
    for (const k of ps) await build('b2 caoutchouc ' + k, REC.splitter, { x: X2(k) - 200, y: N2, z: ZB2 }, 180, AIR);
    const T = await build('b2 tampon caoutchouc', REC.container, TAMPON.at, TAMPON.yaw, AIR);
    const M = (k) => st.actors['b2 caoutchouc ' + k];
    for (const k of ins) await link('b2 raffinerie ' + k + ' > caoutchouc', REC.belt, ref2(k), 'Output1', M(k), 'Input3');
    for (const k of ps) await link('b2 caoutchouc > raffinerie ' + k, REC.belt, M(k), 'Output3', ref2(k), 'Input0');
    const chain = ins.concat(ps); // d'est en ouest
    for (let i = 1; i < chain.length; i++) await link('b2 caoutchouc ' + chain[i - 1] + ' > ' + chain[i], REC.belt, M(chain[i - 1]), 'Output1', M(chain[i]), 'Input1');
    await link('b2 caoutchouc > tampon', REC.belt, M(chain[chain.length - 1]), 'Output1', T, 'Input0');
  },

  async courant() {
    for (const [n, at] of Object.entries(POLES)) await build('poteau ' + n, 'Recipe_PowerPoleMk3_C', at, 0, AIR);
    const p = (n) => st.actors['poteau ' + n], A = st.actors;
    const q0 = JSON.parse(fs.readFileSync(MODULE1, 'utf8')).actors['poteau Q0'];
    const plan = [['relais 0', q0], ['relais 0', p('relais 1')], ['relais 1', p('b1 0')], ['b1 0', p('b1 1')], ['b1 1', p('b1 2')],
      ['b1 0', p('b2 2')], ['b2 2', p('b2 0')], ['b2 0', p('b2 1')], ['b2 1', p('b2 3')]];
    for (const k of K1) plan.push(['b1 ' + (k < 7 ? 0 : k < 14 ? 1 : 2), ref1(k)]);
    for (const k of K2) plan.push(['b2 ' + (k < 7 ? 0 : 1), ref2(k)]);
    for (const e of EXTRACTORS2) plan.push(['b2 2', A['b2 extracteur ' + e.k]]);
    plan.push(['b2 2', A['b2 pompe eau']], ['b2 2', A['b2 broyeur']]);
    for (const b of BLENDERS) plan.push(['b2 3', A['b2 melangeur ' + b.k]]);
    plan.push(['b2 3', A['b2 pompe carburant']]);
    for (const [a, b] of plan) {
      const key = a + ' > ' + (b ? short(b) : '?');
      if (st.wires[key]) continue;
      if (!p(a) || !b) { console.log(('cable ' + key).padEnd(34), 'saute (bout absent)'); continue; }
      const r = await call('wire', p(a), b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
  },

  // --- Petrole --------------------------------------------------------------------------------------------
  // Extracteurs sur les gisements, visee verticale sur le gisement lui-meme ; 3 eclats et 250 % (regle de l'utilisateur)
  async puits() {
    const loin = PUITS.filter((p) => p.loin && !st.actors['puits ' + p.g]);
    let sources = [];
    if (loin.length) {
      sources = await call('streamingSourceAdd', loin.map((p) => ({ x: p.at.x, y: p.at.y, z: p.at.z + 300 })));
      for (let t = 0; t < 60; t++) {
        await new Promise((r) => setTimeout(r, 2000));
        if ((await call('streamingSources', {})).every((s) => s.completed)) break;
      }
    }
    try {
      for (const p of PUITS) {
        const key = 'puits ' + p.g;
        if (st.actors[key]) continue;
        const node = PREFIX + 'BP_ResourceNode' + p.g;
        const r = await call('buildAim', 'Recipe_OilPump_C', { x: p.at.x, y: p.at.y, z: p.at.z + 1000 }, p.at, { dryRun: DRY, scrollRotation: p.cap, onActor: node });
        report(key, r);
        if (!r.built) continue;
        st.actors[key] = r.actor; save();
        await call('addShards', r.actor, 3);
        const s = await call('setClock', r.actor, 2.5);
        const o = (await call('connections', r.actor))[0];
        console.log('   cadence', s.pendingPotential, 'eclats', s.powerShards, '| sortie', JSON.stringify(o.location), JSON.stringify(o.normal));
      }
    } finally {
      if (sources.length) await call('streamingSourceRemove', sources);
    }
  },

  async oleoduc() {
    for (const [key, x, y, z] of OLEODUC) await build(key, REC.junction, { x, y, z }, 0, AIR);
    const J = (k) => st.actors[k];
    for (let i = 1; i < OLEODUC.length; i++) {
      const a = OLEODUC[i - 1], b = OLEODUC[i];
      await link(a[0] + ' > ' + b[0], REC.pipe, J(a[0]), a[5], J(b[0]), b[4]);
    }
    for (const [g, [k, c]] of Object.entries(PUITS_JONCTION)) await link('puits ' + g + ' > ' + k, REC.pipe, st.actors['puits ' + g], 'FGPipeConnectionFactory', J(k), c);
    const fin = OLEODUC[OLEODUC.length - 1];
    await link(fin[0] + ' > petrole 0', REC.pipe, J(fin[0]), fin[5], st.actors['petrole 0'], 'Connection1');
  },

  async courantPuits() {
    for (const [n, at] of Object.entries(POLES_PUITS)) await build('poteau ' + n, 'Recipe_PowerPoleMk3_C', at, 0, AIR);
    const p = (n) => st.actors['poteau ' + n];
    const plan = [['puits plage', RESEAU_PUITS], ['puits plateau', RESEAU_PUITS], ['puits plage', st.actors['puits 28_101']],
      ['puits plateau', st.actors['puits 15']], ['puits plateau', st.actors['puits 16']]];
    for (const [a, b] of plan) {
      const key = a + ' > ' + (b ? short(b) : '?');
      if (st.wires[key]) continue;
      if (!p(a) || !b) { console.log(('cable ' + key).padEnd(34), 'saute (bout absent)'); continue; }
      const r = await call('wire', p(a), b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
  },

  async verifie() {
    for (const [key, a] of Object.entries(st.actors)) {
      const conns = await call('connections', a);
      console.log(key.padEnd(30), conns.map((c) => c.name + (c.connected ? '*' : '')).join(' '));
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node petrochimie-alu.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
