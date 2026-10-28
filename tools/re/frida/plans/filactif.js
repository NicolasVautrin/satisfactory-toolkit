// Filactif des cellules d'uranium infusees, usine commune des 3,5 modules (utilisateur, 27/10/2026 : « go pour le
// filactif », « tu fais le quickwire sur chaque module ou tu centralises ? », « ok go », puis « pour les raffineries, on
// peut pas s'etaler au-dessus des rails » : double voie nord-sud a x -75 827 / -75 177, raffineries jusqu'a k 47) :
// recette de l'optimiseur Fused Quickwire (assembleuse : 7,5 lingots de caterium + 37,5 de cuivre -> 90/min) ; 6 300/min
// -> 70 assembleuses, 44 raffineries de caterium pur, 70 de cuivre pur, dans le prolongement est des bandes du bloc EM :
// bande 4 (cette tranche : caterium en haut k 19 a 47, cuivre en bas k 30 a 47), bandes 1 et 2 (k 36 a 46, montees de
// minerai deplacees au nouveau bout est), bande 3 (caterium en haut k 32 a 46, cuivre en bas k 39 a 46, minerai par les
// bouts des chaines de la bande 4).
// Minerai de la bande 4 : surplus des foreuses de la cote (cuivre a 40 %, caterium a 27 % : ~360 et ~430/min libres au
// bout des chaines) ; plus tard le caterium de N211 O143 q1 (600/min) en tete de la chaine du caterium.
//  - Caterium : etage du haut de la bande 4, k 19 a 47 (montage de barres-em.js). Minerai : bout de la chaine du haut
//    (repartiteur de k 6, Output1) -> ascenseur -> couloir a 25 m entre les deux etages (y -237 800, sous les raffineries
//    de quartz) -> ascenseur -> repartiteurs de k 19 a 47 (d'ouest en est). Eau a part : 7 extracteurs, colonnes a deux
//    pompes Mk2, jonction de la raffinerie k-1. Lingots au nord a +1 m, d'ouest en est, sortie au bout est.
//  - Cuivre : etage du bas de la bande 4, k 30 a 47 : la chaine de minerai continue depuis k 29. Eau a part : 2
//    extracteurs, colonnes directes avec pompe Mk2 basse. Lingots au nord a +1 m, d'ouest en est, sortie au bout est.
//  - Bandes 1 et 2 : cuivre aux deux etages, k 36 a 46 (11 + 11 par bande). La montee du minerai des barres EM (bout est,
//    x -90 600) passe au nouveau bout (X(46) + 14 m = -77 400) : la chaine du bas continue vers l'est depuis k 35, monte,
//    et revient vers l'ouest en haut jusqu'au repartiteur de k 35 (utilisateur : « il va falloir bouger cet ascenseur (ma
//    selection) et celui de la bande 2 aussi »). Eau a part par etage (un extracteur chacun, 110 m3/min) ; lingots au
//    nord a +1 m vers l'est, sorties libres au bout est.
//  - Assembleuses : piles a +64 m (pile.js), une rangee par groupe de raffineries de cuivre (a venir).
// usage : node filactif.js <phase> [--dry]
//   phases : catRaffineries | catExtracteurs | catEau | catColonnes | catPompes | catMinerai | catLingots |
//            cuRaffineries | cuExtracteurs | cuEau | cuPompes | cuMinerai | cuLingots | reseau | courant |
//            b12Raffineries | b12Extracteurs | b12Eau | b12Colonnes | b12Pompes | b12Minerai | b12Raccord | b12Lingots | b12Courant |
//            b3Raffineries | b3Extracteurs | b3Eau | b3Colonnes | b3Pompes | b3Minerai | b3Lingots | b3Courant
// Etat : filactif-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const SOFT = 'FGCDEncroachingSoftClearance';
const REC = {
  refinery: 'Recipe_OilRefinery_C', extractor: 'Recipe_WaterPump_C', junction: 'Recipe_PipelineJunction_Cross_C',
  pipe: 'Recipe_PipelineMK2_C', pump2: 'Recipe_PipelinePumpMk2_C', splitter: 'Recipe_ConveyorAttachmentSplitter_C',
  merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C',
  pole: 'Recipe_PowerPoleMk3_C', C: 'Recipe_Alternate_PureCateriumIngot_C', L: 'Recipe_Alternate_PureCopperIngot_C',
};
// Geometrie de barres-em.js (bande 4)
const X = (k) => -134000 + 1200 * k;
const Y = -238200, ZH = 3200, SIDE = 1400, ZB = 100, ZF = 500, ZM = 1100;
// k 47 au plus : la double voie nord-sud passe a x -75 827 (raffinerie de k 47 a -77 600, 10 m de marge)
const KC = [...Array(29).keys()].map((i) => 19 + i);           // caterium, haut, k 19 a 47 (696 m3 d'eau)
const KL = [...Array(18).keys()].map((i) => 30 + i);           // cuivre, bas, k 30 a 47 (270 minerai, 180 m3)
const EXTC = [23, 27, 31, 35, 39, 43, 47].map((k) => ({ k, x: X(k) - 600 }));  // haut : colonne vers la jonction de k-1 (7 x 120 m3)
const EXTL = [33, 41].map((k) => ({ k, x: X(k) - 600 }));      // bas : colonne directe
const WATER = (x) => PREFIX + (x < -110000 ? 'FGWaterVolume105' : 'FGWaterVolume_7');
const BEM = JSON.parse(fs.readFileSync(path.join(__dirname, 'barres-em-state.json'), 'utf8'));
const CAT_BOUT = BEM.actors['b4 haut minerai 6'];   // bout de la chaine du caterium (Output1 libre, vers l'est)
const CU_BOUT = BEM.actors['b4 bas minerai 29'];    // bout de la chaine du cuivre (Output1 libre, vers l'est)
// couloir du caterium entre les etages : y -237 800 (a x+2 des raffineries, au-dessus des ascenseurs d'entree du bas,
// les relais sont refuses a y -237 000 / -237 400 ; essai a blanc du 27/10)
const ZC = 2500, YC = -237800;
// Bandes 1 et 2 (barres-em.js) : rangees prolongees de k 36 a 46 (k 47 mettrait la montee a 4 m de la voie)
const KB = [...Array(11).keys()].map((i) => 36 + i);
const B12 = { 1: -219000, 2: -225400 };
const XBOUT = X(46) + 1400;
// extracteurs a 36 m l'un de l'autre (20 m d'emprise) : bas -> jonction a son x ; haut -> jonction de k 42
const EXTB = { bas: 40, haut: 43 };
const MONTEE_EM = ['minerai bas > bout', 'minerai bout > haut', 'minerai montee', 'minerai bout bas', 'minerai bout haut'];
// Bande 3 (barres-em.js : caterium k 0 a 17 aux deux etages, acide sulfurique en bas k 19 a 33, soufre descendu a
// x -93 000) : caterium en haut k 32 a 46, cuivre en bas k 39 a 46 (fin de rangee a k 46 comme les bandes 1 et 2, le
// cuivre loin de l'arrivee du soufre). Minerai : branche Output2 (sud, libre) des repartiteurs de k 47 de la bande 4, a
// x -77 400, tout droit vers le sud a la hauteur de la ligne (relais R a mi-chemin), puis V (cap 180) -> repartiteur de
// k 46, rangees vers l'ouest. Eau : 4 extracteurs en haut (480 m3 pour 360), 1 en bas (120 pour 80), a 24 m au moins
// l'un de l'autre et de l'extracteur de k 32 de l'acide.
const Y3 = -231800;
const K3C = [...Array(15).keys()].map((i) => 32 + i);
const K3L = [...Array(8).keys()].map((i) => 39 + i);
const EXT3C = [36, 40, 44, 47], EXT3L = 42, YR3 = -233600;
// Assembleuses (recette de l'optimiseur Fused Quickwire, 7,5 caterium + 37,5 cuivre -> 90/min) : 7 piles de 10 a +64 m,
// en l'air (pile.js), sortie libre au pied de chaque pile, 900/min = un convoyeur, deux par module (utilisateur, 28/10 :
// « ben c'est 2 convoyeurs par module »). Rangees A1, A2, A3 de 2 piles au-dessus des bandes 1, 2 et 3 (dos au nord :
// arrivees 26 m au nord de l'axe, a +3 m cuivre et +7 m caterium, vers l'ouest depuis le bout est), A4 (1 pile) a
// l'ouest de A2, nourrie par les queues des trois rangees (surplus de cuivre 75 + 75 + 225 = 375, une pile).
const TOP = 6400, ZCU = TOP + 300, ZCA = TOP + 700;
const RANGEES = {
  A1: { x: -82000, y: B12[1] + 1200, piles: 2 }, A2: { x: -82000, y: B12[2] + 1200, piles: 2 },
  A3: { x: -82000, y: Y3, piles: 2 }, A4: { x: -86500, y: B12[2] + 1200, piles: 1 },
};
const pileFile = (r) => path.join(__dirname, 'filactif-' + r + '-pile-state.json');
const pileSt = (r) => JSON.parse(fs.readFileSync(pileFile(r), 'utf8'));
// tetes (pile est, entree Input1 face a l'est) et queues (pile ouest, Output1 face a l'ouest) des arrivees : 0 cuivre, 1 caterium
const tete = (r, f) => pileSt(r).parts['arrivee ' + f + ' pile ' + (RANGEES[r].piles - 1)];
const queue = (r, f) => pileSt(r).parts['arrivee ' + f + ' pile 0'];
const YA = (r) => RANGEES[r].y - 2600; // y des arrivees
// Montees des lingots, au bout est des collecteurs (x -78 600, au-dessus du fusionneur de k 46) : bas (+1 m) ->
// ascenseur -> R (+25 m, cap -90, sortie au nord) -> ascenseur -> W (+67 m, cap 180, sortie vers la tete) ; haut (+33 m)
// -> ascenseur -> W (entree est). Bande 4 (fin a k 47, x -77 400) : cuivre -> R4 (+25 m) -> Wc (+67 m, cap 90) vers le
// sud ; caterium -> Rk (+71 m, cap 90) vers le sud (tronc).
const XM = X(46) + 200, XT = X(47) + 200, ZR = 2500;
// tronc du caterium a +71 m le long de x -77 400 : bande 4 -> T3 (fusionneur : caterium de la bande 3 par K, +75 m) ->
// S3 (repartiteur, branche vers A3) -> S2 (vers A2) -> E1 (fin, vers A1) ; relais a mi-chemin
const YT3 = -235600, XS = -84500;
const spread = (a, b, max) => { const n = Math.ceil(Math.abs(b - a) / max); return [...Array(n - 1).keys()].map((i) => Math.round(a + (b - a) * (i + 1) / n)); };

const FILE = path.join(__dirname, 'filactif-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(40), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw, opts) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, opts || AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(40), 'a construire'); return null; }
  let r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  // degagement souple seul en cause : accepte apres un essai a blanc sans lui (barres-em.js)
  if (!r.built && r.blocking && r.blocking.length === 1 && r.blocking[0] === SOFT) {
    const o = Object.assign({}, opts || {}, { ignore: [SOFT] });
    const t = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({}, o, { dryRun: true }));
    if (!(t.blocking && t.blocking.length)) {
      console.log(key.padEnd(40), 'degagement souple seul en cause, accepte');
      r = DRY ? t : await call('belt', recipe, from, fromName, { path: to, name: toName }, o);
    }
  }
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
async function wireNearest(key, actor) {
  if (st.wires[key] || DRY || !actor) return false;
  const at = (await call('pose', actor)).location;
  for (const it of (await call('scan', 'FGBuildablePowerPole', at, 8000, 30, {})).items) {
    const pw = await call('power', it.path);
    if (pw.wires >= pw.maxWires || pw.circuitId < 0) continue;
    const w = await call('wire', it.path, actor, {});
    if (w.built) { st.wires[key] = w.actor || true; save(); console.log(('cable ' + key).padEnd(40), short(it.path), Math.round(it.distance / 100) + ' m'); return true; }
  }
  return false;
}
async function pompe(key, pipe, zmin, zmax) {
  if (st.actors[key]) return;
  if (!pipe) { console.log(key.padEnd(40), 'a construire'); return; }
  const pose = await call('pose', pipe);
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData;
  const yaw = pose.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = pose.location;
  const w = pts.map((p) => ({ x: o.x + p.Location.X * c - p.Location.Y * s, y: o.y + p.Location.X * s + p.Location.Y * c, z: o.z + p.Location.Z }));
  const cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax)) {
    const aim = [{ x: p.x, y: p.y + 300, z: p.z + 300 }, p];
    const t = await call('buildAim', REC.pump2, aim[0], aim[1], { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    const r = DRY ? t : await call('buildAim', REC.pump2, aim[0], aim[1], { onActor: pipe });
    console.log(key.padEnd(40), 'a', (p.z / 100).toFixed(1), 'm');
    report(key, r);
    if (r.built) { st.actors[key] = r.actor; save(); }
    return;
  }
  throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
}
async function extracteurs(prefix, list) {
  for (const e of list) {
    const key = prefix + ' extracteur ' + e.k;
    if (st.actors[key]) continue;
    const y = (e.y || Y) + 300;
    const r = await call('buildAim', REC.extractor, { x: e.x, y, z: 1000 }, { x: e.x, y, z: -1815 }, { dryRun: DRY, onActor: WATER(e.x), scrollRotation: 180 });
    report(key, r);
    if (r.built) { st.actors[key] = r.actor; save(); }
  }
}
// rangee : raffineries cap 0 a (X(k), y, z), recette ; y = axe de la bande (bande 4 par defaut)
async function rangee(prefix, ks, z, recipe, y = Y) {
  for (const k of ks) {
    const key = prefix + ' raffinerie ' + k;
    await build(key, REC.refinery, { x: X(k), y, z }, 0);
    if (!DRY && st.actors[key] && !st.links['recette ' + key]) {
      const r = await call('setRecipe', st.actors[key], recipe);
      st.links['recette ' + key] = r.recipe || true; save();
      console.log(('recette ' + key).padEnd(40), r.recipe);
    }
  }
}
// ligne d'eau au sud a +5 m : jonctions x-2 des raffineries (+ jonctions d'extracteurs donnees), d'est en ouest ;
// branche Connection3 -> raffinerie
async function ligneEau(prefix, ks, z, extra, y = Y) {
  const xs = ks.map((k) => X(k) - 200).concat(extra || []).sort((a, b) => b - a);
  for (const x of xs) await build(prefix + ' eau ' + x, REC.junction, { x, y: y + SIDE, z: z + ZF }, 0);
  const J = (x) => st.actors[prefix + ' eau ' + x];
  for (let i = 1; i < xs.length; i++) await link(prefix + ' eau ' + xs[i - 1] + ' > ' + xs[i], REC.pipe, J(xs[i - 1]), 'Connection0', J(xs[i]), 'Connection1');
  for (const k of ks) await link(prefix + ' eau > raffinerie ' + k, REC.pipe, J(X(k) - 200), 'Connection3', st.actors[prefix + ' raffinerie ' + k], 'PipeInputFactory');
  return J;
}
// minerai au sud a +11 m : repartiteurs x+2 ; vers l'est (cap 0, branche Output3) ou l'ouest (cap 180, branche
// Output2) -> ascenseur -> Input0
async function chaineMinerai(prefix, ks, z, y = Y, est = true) {
  const Sp = (k) => st.actors[prefix + ' minerai ' + k];
  for (const k of ks) await build(prefix + ' minerai ' + k, REC.splitter, { x: X(k) + 200, y: y + SIDE, z: z + ZM }, est ? 0 : 180);
  const chain = est ? ks : [...ks].reverse();
  for (let i = 1; i < chain.length; i++) await link(prefix + ' minerai ' + chain[i - 1] + ' > ' + chain[i], REC.belt, Sp(chain[i - 1]), 'Output1', Sp(chain[i]), 'Input1');
  for (const k of ks) await link(prefix + ' minerai > raffinerie ' + k, REC.lift, Sp(k), est ? 'Output3' : 'Output2', st.actors[prefix + ' raffinerie ' + k], 'Input0', { snapTolerance: 400 });
  return Sp;
}
// lingots au nord a +1 m, d'ouest en est : fusionneurs x+2 cap 0, Input2 au sud ; sortie au bout est (Output1)
async function collecteur(prefix, ks, z, y = Y) {
  const M = (k) => st.actors[prefix + ' lingots ' + k];
  for (const k of ks) await build(prefix + ' lingots ' + k, REC.merger, { x: X(k) + 200, y: y - SIDE, z: z + ZB }, 0);
  for (const k of ks) await link(prefix + ' raffinerie ' + k + ' > lingots', REC.belt, st.actors[prefix + ' raffinerie ' + k], 'Output1', M(k), 'Input2');
  for (let i = 1; i < ks.length; i++) await link(prefix + ' lingots ' + ks[i - 1] + ' > ' + ks[i], REC.belt, M(ks[i - 1]), 'Output1', M(ks[i]), 'Input1');
}
// colonne d'un extracteur de l'etage du haut : extracteur -> A (-7 m, 17 m au sud) -> colonne -> B (+37 m, 26 m au sud)
// -> jonction de la raffinerie k-1 (Connection2) ; s = suffixe des cles ('' pour un seul extracteur par etage)
async function colonneHaute(p, k, y, s) {
  const x = X(k) - 600;
  const A = await build(p + ' relais A' + s, REC.junction, { x, y: y + 1700, z: -700 }, 0);
  const B = await build(p + ' relais B' + s, REC.junction, { x, y: y + 2600, z: ZH + ZF }, 0);
  await link(p + ' extracteur > A' + s, REC.pipe, st.actors[p + ' extracteur ' + k], 'FGPipeConnectionFactory', A, 'Connection3');
  await link(p + ' colonne' + s, REC.pipe, A, 'Connection2', B, 'Connection3');
  await link(p + ' B > ligne' + s, REC.pipe, B, 'Connection0', st.actors[p + ' eau ' + (X(k - 1) - 200)], 'Connection2');
}
// Poteaux Mk3 propres a une bande (p = 'b1'...), au nord de chaque etage (y - 24 m, a sa hauteur) : machine -> poteau
// de son etage a 60 m au plus, une place gardee sur chaque poteau pour la chaine ; sinon poteau neuf a son x, raccorde
// au poteau propre le plus proche (100 m au plus), le premier au poteau libre le plus proche du reseau. Sans cela, le
// poteau libre le plus proche donnait des cables de 80 m jusqu'aux poteaux de la voie ferree (bandes 1 et 2).
// items [cle, z]
async function poteauxBande(p, y, items) {
  if (DRY) return;
  const own = (z) => Object.keys(st.actors).filter((k) => k.startsWith(p + ' poteau ') && (z === undefined || k.endsWith(' ' + z)));
  const loc = async (a) => (await call('pose', a)).location;
  async function wireTo(key, a, poles, maxD, keep) {
    const at = await loc(a), cands = [];
    for (const pk of poles) { const l = await loc(st.actors[pk]); cands.push([pk, Math.hypot(l.x - at.x, l.y - at.y, l.z - at.z)]); }
    for (const [pk, d] of cands.sort((u, v) => u[1] - v[1])) {
      if (d > maxD) break;
      const pw = await call('power', st.actors[pk]);
      if (pw.wires >= pw.maxWires - keep) continue;
      const w = await call('wire', st.actors[pk], a, {});
      if (w.built) { st.wires[key] = w.actor || true; save(); console.log(('cable ' + key).padEnd(40), pk, Math.round(d / 100) + ' m'); return true; }
    }
    return false;
  }
  const chain = async (pk) => st.wires[pk] || (await wireTo(pk, st.actors[pk], own().filter((q) => q !== pk && st.wires[q]), 10000, 0)) || (await wireNearest(pk, st.actors[pk]));
  for (const pk of own()) if (!(await chain(pk))) throw new Error(pk + ' : poteau non raccorde');
  for (const [key, z] of items) {
    const a = st.actors[key];
    if (!a || st.wires[key]) continue;
    if (await wireTo(key, a, own(z), 6000, 1)) continue;
    const at = await loc(a);
    const pk = p + ' poteau ' + Math.round(at.x / 100) + ' ' + z;
    await build(pk, REC.pole, { x: at.x, y: y - 2400, z }, 0);
    if (!(await chain(pk))) throw new Error(pk + ' : aucun poteau libre a 100 m');
    if (!(await wireTo(key, a, [pk], 6000, 1))) throw new Error(key + ' : poteau neuf hors de portee');
  }
}
// items [cle, z, y de la bande, etiquette] : sur le poteau le plus proche qui a une place libre ; sinon poteau Mk3 au
// nord de la rangee (y - 24 m, a sa hauteur), raccorde au poteau libre le plus proche
async function alimente(items) {
  for (const [key, z, y, tag] of items) {
    const a = st.actors[key];
    if (!a || st.wires[key] || DRY) continue;
    if (await wireNearest(key, a)) continue;
    const at = (await call('pose', a)).location;
    const pk = (tag ? tag + ' ' : '') + 'poteau ' + Math.round(at.x / 100) + ' ' + z;
    const P = await build(pk, REC.pole, { x: at.x, y: y - 2400, z }, 0);
    if (!(await wireNearest(pk, P))) throw new Error(pk + ' : aucun poteau libre a moins de 80 m');
    if (!(await wireNearest(key, a))) throw new Error(key + ' : toujours sans poteau libre');
  }
}

const PHASES = {
  async catRaffineries() { await rangee('cat', KC, ZH, REC.C); },
  async catExtracteurs() { await extracteurs('cat', EXTC); },
  async catEau() { await ligneEau('cat', KC, ZH); },
  // extracteur -> A (-7 m, 17 m au sud) -> colonne -> B (+37 m, 26 m au sud) -> jonction de la raffinerie k-1 (Connection2)
  async catColonnes() {
    for (const e of EXTC) {
      const A = await build('cat relais A ' + e.k, REC.junction, { x: e.x, y: Y + 1700, z: -700 }, 0);
      const B = await build('cat relais B ' + e.k, REC.junction, { x: e.x, y: Y + 2600, z: ZH + ZF }, 0);
      await link('cat extracteur ' + e.k + ' > A', REC.pipe, st.actors['cat extracteur ' + e.k], 'FGPipeConnectionFactory', A, 'Connection3');
      await link('cat colonne haute ' + e.k, REC.pipe, A, 'Connection2', B, 'Connection3');
      await link('cat B ' + e.k + ' > ligne', REC.pipe, B, 'Connection0', st.actors['cat eau ' + (X(e.k - 1) - 200)], 'Connection2');
    }
  },
  async catPompes() {
    for (const e of EXTC) {
      await pompe('cat pompe haute ' + e.k, st.links['cat colonne haute ' + e.k], 0, 2500);
      await pompe('cat pompe basse ' + e.k, st.links['cat extracteur ' + e.k + ' > A'], -1600, -900);
    }
  },
  // bout de la chaine du caterium (k 6, 43 m, Output1 vers l'est) -> ascenseur -> T1 (25 m, cap -90, entree est) -> T2
  // (cap 0, entree sud) -> est a y -237 400 -> V1 (cap 90, entree ouest) -> ascenseur -> V2 (43 m, cap 0, entree sud) ->
  // repartiteurs de k 19 a 31
  async catMinerai() {
    const Sp = await chaineMinerai('cat', KC, ZH);
    const xb = (await call('pose', CAT_BOUT)).location.x;
    const T1 = await build('cat T1', REC.merger, { x: xb, y: Y + SIDE, z: ZC }, -90);
    const T2 = await build('cat T2', REC.merger, { x: xb, y: YC, z: ZC }, 0);  // T1 -> T2 : 10 m au nord
    const XV = X(19) - 1600;
    const ew = [T2];
    for (const x of spread(xb, XV, 4500)) ew.push(await build('cat couloir ' + x, REC.merger, { x, y: YC, z: ZC }, 0));
    const V1 = await build('cat V1', REC.merger, { x: XV, y: YC, z: ZC }, 90);
    const V2 = await build('cat V2', REC.merger, { x: XV, y: YC, z: ZH + ZM }, 0);
    await link('cat bout > T1', REC.lift, CAT_BOUT, 'Output1', T1, 'Input2', { snapTolerance: 400 });
    await link('cat T1 > T2', REC.belt, T1, 'Output1', T2, 'Input2');
    for (let i = 1; i < ew.length; i++) await link('cat couloir ' + i, REC.belt, ew[i - 1], 'Output1', ew[i], 'Input1');
    await link('cat couloir > V1', REC.belt, ew[ew.length - 1], 'Output1', V1, 'Input2');
    await link('cat montee', REC.lift, V1, 'Output1', V2, 'Input2', { snapTolerance: 400 });
    await link('cat V2 > rangee', REC.belt, V2, 'Output1', Sp(19), 'Input1');
  },
  async catLingots() { await collecteur('cat', KC, ZH); },

  async cuRaffineries() { await rangee('cu', KL, 0, REC.L); },
  async cuExtracteurs() { await extracteurs('cu', EXTL); },
  // ligne d'eau au sud a +5 m ; colonnes directes : extracteur -> jonction a son x (Connection3)
  async cuEau() {
    const J = await ligneEau('cu', KL, 0, EXTL.map((e) => e.x));
    for (const e of EXTL) await link('cu colonne ' + e.k, REC.pipe, st.actors['cu extracteur ' + e.k], 'FGPipeConnectionFactory', J(e.x), 'Connection3');
  },
  async cuPompes() { for (const e of EXTL) await pompe('cu pompe ' + e.k, st.links['cu colonne ' + e.k], -1600, -900); },
  // la chaine du cuivre continue depuis k 29
  async cuMinerai() {
    const Sp = await chaineMinerai('cu', KL, 0);
    await link('cu bout > rangee', REC.belt, CU_BOUT, 'Output1', Sp(30), 'Input1');
  },
  async cuLingots() { await collecteur('cu', KL, 0); },

  // reseau : les poteaux voisins sont pleins ; chaine de poteaux Mk3 au nord des rangees (y -240 600), a 32 m depuis le
  // poteau « est » du quartz (2143819849, 5 cables sur 10) puis vers l'est (64 a 84 m entre poteaux, cables de 100 m au
  // plus), et un second rang a 0 m sous chacun
  async reseau() {
    let prev = PREFIX + 'Build_PowerPoleMk3_C_2143819849';
    for (const x of [-105600, -99200, -90800, -82400]) {
      const key = x === -99200 && st.actors['poteau -992 3200'] ? 'poteau -992 3200' : 'reseau haut ' + x;
      const P = await build(key, REC.pole, { x, y: Y - 2400, z: ZH }, 0);
      const Q = await build('reseau bas ' + x, REC.pole, { x, y: Y - 2400, z: 0 }, 0);
      for (const [k, a, b] of [['reseau ' + x + ' haut', prev, P], ['reseau ' + x + ' bas', P, Q]]) {
        if (DRY || st.wires[k] || !a || !b) continue;
        const w = await call('wire', a, b, {});
        if (!w.built) throw new Error(k + ' : cable refuse ' + JSON.stringify(w.blocking));
        st.wires[k] = w.actor || true; save();
        console.log(('cable ' + k).padEnd(40), 'ok');
      }
      prev = P;
    }
  },

  // raffineries, extracteurs et pompes sur le poteau le plus proche qui a une place libre ; sinon poteau Mk3 au nord de
  // la rangee (a sa hauteur), raccorde au poteau libre le plus proche
  async courant() {
    const items = KC.map((k) => ['cat raffinerie ' + k, ZH]).concat(KL.map((k) => ['cu raffinerie ' + k, 0]))
      .concat(EXTC.flatMap((e) => [['cat extracteur ' + e.k, 0], ['cat pompe haute ' + e.k, 0], ['cat pompe basse ' + e.k, 0]]))
      .concat(EXTL.flatMap((e) => [['cu extracteur ' + e.k, 0], ['cu pompe ' + e.k, 0]]));
    await alimente(items.map(([key, z]) => [key, z, Y, '']));
  },

  // --- Bandes 1 et 2, k 36 a 46 : cuivre pur aux deux etages ---
  async b12Raffineries() {
    for (const [b, y] of Object.entries(B12)) for (const [e, z] of [['bas', 0], ['haut', ZH]]) await rangee('b' + b + ' ' + e, KB, z, REC.L, y);
  },
  async b12Extracteurs() {
    for (const [b, y] of Object.entries(B12)) for (const e of ['bas', 'haut']) await extracteurs('b' + b + ' ' + e, [{ k: EXTB[e], x: X(EXTB[e]) - 600, y }]);
  },
  // bas : colonne directe extracteur -> jonction a son x (Connection3) ; haut : ligne seule (colonne : b12Colonnes)
  async b12Eau() {
    const xe = X(EXTB.bas) - 600;
    for (const [b, y] of Object.entries(B12)) {
      const J = await ligneEau('b' + b + ' bas', KB, 0, [xe], y);
      await link('b' + b + ' bas colonne', REC.pipe, st.actors['b' + b + ' bas extracteur ' + EXTB.bas], 'FGPipeConnectionFactory', J(xe), 'Connection3');
      await ligneEau('b' + b + ' haut', KB, ZH, [], y);
    }
  },
  // haut : colonne vers la jonction de k 42
  async b12Colonnes() {
    for (const [b, y] of Object.entries(B12)) await colonneHaute('b' + b + ' haut', EXTB.haut, y, '');
  },
  async b12Pompes() {
    for (const b of Object.keys(B12)) {
      await pompe('b' + b + ' bas pompe', st.links['b' + b + ' bas colonne'], -1600, -900);
      await pompe('b' + b + ' haut pompe haute', st.links['b' + b + ' haut colonne'], 0, 2500);
      await pompe('b' + b + ' haut pompe basse', st.links['b' + b + ' haut extracteur > A'], -1600, -900);
    }
  },
  // Rallonge du minerai, sans toucher aux repartiteurs de k 35 : chaine du bas k 36 a 46 vers l'est -> U (bout bas) ->
  // ascenseur -> V (bout haut, cap 180) -> chaine du haut k 46 a 36 vers l'ouest. L'ancienne montee des barres EM (5
  // pieces par bande) n'existe plus en jeu (remplacee par l'utilisateur par un ascenseur direct k 35 bas -> k 35 haut) :
  // ses cles sont retirees de barres-em-state.json.
  async b12Minerai() {
    const BEM_FILE = path.join(__dirname, 'barres-em-state.json');
    for (const [b, y] of Object.entries(B12)) {
      const p = 'b' + b;
      const old = MONTEE_EM.map((n) => p + ' ' + n).filter((key) => BEM.actors[key] || BEM.links[key]);
      const gone = [];
      for (const key of old) { try { await call('pose', BEM.actors[key] || BEM.links[key]); } catch (e) { gone.push(key); } }
      if (gone.length !== old.length) throw new Error(p + ' : pieces de l\'ancienne montee encore en jeu : ' + old.filter((k) => !gone.includes(k)).join(', '));
      if (gone.length && !DRY) {
        for (const key of gone) { delete BEM.actors[key]; delete BEM.links[key]; }
        fs.writeFileSync(BEM_FILE, JSON.stringify(BEM, null, 1) + '\n');
        console.log((p + ' montee des barres EM').padEnd(40), gone.length + ' cles retirees de barres-em-state.json');
      }
      const bas = await chaineMinerai(p + ' bas', KB, 0, y, true);
      const haut = await chaineMinerai(p + ' haut', KB, ZH, y, false);
      const U = await build(p + ' bout bas', REC.merger, { x: XBOUT, y: y + SIDE, z: ZM }, 0);
      const V = await build(p + ' bout haut', REC.merger, { x: XBOUT, y: y + SIDE, z: ZH + ZM }, 180);
      await link(p + ' bas 46 > bout', REC.belt, bas(46), 'Output1', U, 'Input1');
      await link(p + ' montee', REC.lift, U, 'Output1', V, 'Input1', { snapTolerance: 400 });
      await link(p + ' bout > haut 46', REC.belt, V, 'Output1', haut(46), 'Input1');
    }
  },
  // Raccord (coupure de quelques secondes) : demonte ce qui tient la sortie du repartiteur de k 35 du bas et l'entree de
  // celui du haut (ascenseur direct de l'utilisateur), puis convoyeurs 35 bas -> 36 bas et 36 haut -> 35 haut
  async b12Raccord() {
    const freeOf = async (a, name) => !(await call('connections', a)).find((c) => c.name === name).connected;
    const holder = async (a, name) => {
      const c = (await call('dump', a + '.' + name, 1, 30, ['mConnectedComponent'])).mConnectedComponent;
      return typeof c === 'string' && c.startsWith('/') ? c.slice(0, c.lastIndexOf('.')) : null;
    };
    for (const b of Object.keys(B12)) {
      const p = 'b' + b, EB = BEM.actors[p + ' bas minerai 35'], EH = BEM.actors[p + ' haut minerai 35'];
      const bas36 = st.actors[p + ' bas minerai 36'], haut36 = st.actors[p + ' haut minerai 36'];
      if (!bas36 || !haut36) throw new Error(p + ' : rallonge absente (b12Minerai d\'abord)');
      if (!st.links[p + ' em bas 35 > 36'] || !st.links[p + ' haut 36 > em 35']) {
        const occ = [...new Set([await holder(EB, 'Output1'), await holder(EH, 'Input1')].filter(Boolean))]
          .filter((a) => a !== st.links[p + ' em bas 35 > 36'] && a !== st.links[p + ' haut 36 > em 35']);
        console.log((p + ' raccord').padEnd(40), occ.length ? 'a demonter : ' + occ.map(short).join(', ') : 'connecteurs libres');
        if (DRY) continue;
        for (let pass = 0; pass < 3 && occ.length && !((await freeOf(EB, 'Output1')) && (await freeOf(EH, 'Input1'))); pass++) {
          for (const a of occ) { try { await call('dismantle', a, true); } catch (e) { /* deja demonte */ } }
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      await link(p + ' em bas 35 > 36', REC.belt, EB, 'Output1', bas36, 'Input1');
      await link(p + ' haut 36 > em 35', REC.belt, haut36, 'Output1', EH, 'Input1');
    }
  },
  async b12Lingots() {
    for (const [b, y] of Object.entries(B12)) for (const [e, z] of [['bas', 0], ['haut', ZH]]) await collecteur('b' + b + ' ' + e, KB, z, y);
  },
  async b12Courant() {
    for (const [b, y] of Object.entries(B12)) {
      const p = 'b' + b;
      const items = [];
      for (const [e, z] of [['bas', 0], ['haut', ZH]]) for (const k of KB) items.push([p + ' ' + e + ' raffinerie ' + k, z]);
      for (const key of [p + ' bas extracteur ' + EXTB.bas, p + ' bas pompe', p + ' haut extracteur ' + EXTB.haut, p + ' haut pompe haute', p + ' haut pompe basse']) items.push([key, 0]);
      await poteauxBande(p, y, items);
    }
  },

  // --- Bande 3 : caterium en haut k 32 a 46, cuivre en bas k 39 a 46 ---
  async b3Raffineries() {
    await rangee('b3 haut', K3C, ZH, REC.C, Y3);
    await rangee('b3 bas', K3L, 0, REC.L, Y3);
  },
  async b3Extracteurs() {
    await extracteurs('b3 haut', EXT3C.map((k) => ({ k, x: X(k) - 600, y: Y3 })));
    await extracteurs('b3 bas', [{ k: EXT3L, x: X(EXT3L) - 600, y: Y3 }]);
  },
  async b3Eau() {
    const xe = X(EXT3L) - 600;
    const J = await ligneEau('b3 bas', K3L, 0, [xe], Y3);
    await link('b3 bas colonne', REC.pipe, st.actors['b3 bas extracteur ' + EXT3L], 'FGPipeConnectionFactory', J(xe), 'Connection3');
    await ligneEau('b3 haut', K3C, ZH, [], Y3);
  },
  async b3Colonnes() { for (const k of EXT3C) await colonneHaute('b3 haut', k, Y3, ' ' + k); },
  async b3Pompes() {
    await pompe('b3 bas pompe', st.links['b3 bas colonne'], -1600, -900);
    for (const k of EXT3C) {
      await pompe('b3 haut pompe haute ' + k, st.links['b3 haut colonne ' + k], 0, 2500);
      await pompe('b3 haut pompe basse ' + k, st.links['b3 haut extracteur > A ' + k], -1600, -900);
    }
  },
  // repartiteur de k 47 de la bande 4 (Output2, sud) -> R (cap 90, entree nord) -> V (cap 180, entree nord) -> k 46
  async b3Minerai() {
    for (const [e, z, src] of [['haut', ZH, 'cat minerai 47'], ['bas', 0, 'cu minerai 47']]) {
      const p = 'b3 ' + e;
      const Sp = await chaineMinerai(p, e === 'haut' ? K3C : K3L, z, Y3, false);
      const R = await build(p + ' relais minerai', REC.merger, { x: XBOUT, y: YR3, z: z + ZM }, 90);
      const V = await build(p + ' tete minerai', REC.merger, { x: XBOUT, y: Y3 + SIDE, z: z + ZM }, 180);
      await link(p + ' b4 47 > relais', REC.belt, st.actors[src], 'Output2', R, 'Input1');
      await link(p + ' relais > tete', REC.belt, R, 'Output1', V, 'Input2');
      await link(p + ' tete > 46', REC.belt, V, 'Output1', Sp(46), 'Input1');
    }
  },
  async b3Lingots() {
    await collecteur('b3 haut', K3C, ZH, Y3);
    await collecteur('b3 bas', K3L, 0, Y3);
  },
  async b3Courant() {
    const items = K3C.map((k) => ['b3 haut raffinerie ' + k, ZH]).concat(K3L.map((k) => ['b3 bas raffinerie ' + k, 0]))
      .concat([['b3 bas extracteur ' + EXT3L, 0], ['b3 bas pompe', 0]])
      .concat(EXT3C.flatMap((k) => [['b3 haut extracteur ' + k, 0], ['b3 haut pompe haute ' + k, 0], ['b3 haut pompe basse ' + k, 0]]));
    await poteauxBande('b3', Y3, items);
  },

  // Piles d'assembleuses (pile.js) : node filactif.js piles [etapes] [A1,A2,...] ; etapes par defaut : machines a
  // recettes, sans collecteur (chaque pile garde sa sortie). courant : poteau du reseau = 'reseau' de la rangee.
  async piles() {
    const { execFileSync } = require('child_process');
    const args = process.argv.slice(3).filter((a) => !a.startsWith('--'));
    const steps = (args[0] || 'machines,raccords,branches,ascenseurs,arrivees,recettes').split(',');
    const list = args[1] ? args[1].split(',') : Object.keys(RANGEES);
    for (const r of list) {
      const R = RANGEES[r], file = path.join(__dirname, 'filactif-' + r + '-config-state.json');
      const cfg = {
        nom: 'filactif-' + r, recette: 'Recipe_Alternate_Quickwire_C', plateforme: { origine: { x: R.x, y: R.y }, cap: 0, dessus: TOP },
        dos: '-y', centre: [0, 0], piles: R.piles, etages: 10, pas: 16, espacement: 10, enLAir: true,
        arrivees: [{ entree: 'Input0', hauteur: 3, sens: '-lx' }, { entree: 'Input1', hauteur: 7, sens: '-lx' }],
        collecteur: { sens: '-lx' }, poteaux: R.piles === 2 ? [[0, 20], [16, 20], [0, 24], [16, 24]] : [[8, 20], [8, 24]],
      };
      // poteau du reseau (courant) : poteau Mk3 du haut de la bande en dessous (60 a 70 m), A4 au premier poteau de A2
      const RESEAU = { A1: () => st.actors['b1 poteau -824 3200'], A2: () => st.actors['b2 poteau -848 3200'],
        A3: () => st.actors['b3 poteau -836 3200'], A4: () => pileSt('A2').poles['poteau 0'] };
      if (steps.includes('courant')) cfg.reseau = RESEAU[r]();
      fs.writeFileSync(file, JSON.stringify(cfg, null, 1));
      for (const s of steps) {
        let out;
        try {
          out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
        } catch (err) { out = String(err.stdout || '') + String(err.stderr || ''); console.log((r + ' ' + s).padEnd(24), 'ECHEC', out.split('\n').filter((l) => l.trim()).slice(-3).join(' / ')); throw new Error(r + ' ' + s); }
        const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
        console.log((r + ' ' + s).padEnd(24), bad.length ? bad.slice(0, 3).join(' / ') : 'ok');
        if (process.argv.includes('--verbose')) console.log(out);
      }
    }
  },

  // Cuivre des bandes 1 et 2 vers A1 et A2 (deux collecteurs reunis), de la bande 3 et de la bande 4 vers A3 (JM)
  async montees() {
    const LIFT = { snapTolerance: 400 };
    for (const [b, r] of [['1', 'A1'], ['2', 'A2']]) {
      const p = 'b' + b, y = B12[b] - SIDE;
      const R = await build(p + ' montee R', REC.merger, { x: XM, y, z: ZR }, -90);
      const W = await build(p + ' montee W', REC.merger, { x: XM, y, z: ZCU }, 180);
      await link(p + ' bas > R', REC.lift, st.actors[p + ' bas lingots 46'], 'Output1', R, 'Input2', LIFT);
      await link(p + ' R > W', REC.lift, R, 'Output1', W, 'Input2', LIFT);
      await link(p + ' haut > W', REC.lift, st.actors[p + ' haut lingots 46'], 'Output1', W, 'Input1', LIFT);
      await link(p + ' W > ' + r, REC.belt, W, 'Output1', tete(r, 0), 'Input1');
    }
    // bande 3 (cuivre en bas) : R -> W (sortie a l'ouest) -> JM (entree sud) ; bande 4 : R4 -> Wc -> JR (entree nord) -> JM
    const y3 = Y3 - SIDE;
    const R3 = await build('b3 montee R', REC.merger, { x: XM, y: y3, z: ZR }, -90);
    const W3 = await build('b3 montee W', REC.merger, { x: XM, y: y3, z: ZCU }, 180);
    const JM = await build('A3 cuivre JM', REC.merger, { x: XM - 800, y: YA('A3'), z: ZCU }, 180);
    const R4 = await build('b4 montee R', REC.merger, { x: XT, y: Y - SIDE, z: ZR }, -90);
    const Wc = await build('b4 montee Wc', REC.merger, { x: XT, y: Y - SIDE, z: ZCU }, 90);
    const JR = await build('A3 cuivre JR', REC.merger, { x: XT, y: YA('A3'), z: ZCU }, 180);
    await link('b3 bas > R', REC.lift, st.actors['b3 bas lingots 46'], 'Output1', R3, 'Input2', LIFT);
    await link('b3 R > W', REC.lift, R3, 'Output1', W3, 'Input2', LIFT);
    await link('b3 W > JM', REC.belt, W3, 'Output1', JM, 'Input3');
    await link('b4 cu > R', REC.lift, st.actors['cu lingots 47'], 'Output1', R4, 'Input2', LIFT);
    await link('b4 R > Wc', REC.lift, R4, 'Output1', Wc, 'Input1', LIFT);
    await link('b4 Wc > JR', REC.belt, Wc, 'Output1', JR, 'Input2');
    await link('A3 JR > JM', REC.belt, JR, 'Output1', JM, 'Input1');
    await link('A3 JM > A3', REC.belt, JM, 'Output1', tete('A3', 0), 'Input1');
  },

  // Caterium : bande 4 -> Rk -> T3 <- K (bande 3) -> S3 (-> A3) -> relais -> S2 (-> A2) -> relais -> E1 (-> A1)
  async tronc() {
    const LIFT = { snapTolerance: 400 };
    const Rk = await build('b4 montee Rk', REC.merger, { x: XT, y: Y - SIDE, z: ZCA }, 90);
    const K = await build('b3 montee K', REC.merger, { x: XM, y: Y3 - SIDE, z: ZCA + 400 }, -90);
    const T3 = await build('tronc T3', REC.merger, { x: XT, y: YT3, z: ZCA }, 90);
    const S3 = await build('tronc S3', REC.splitter, { x: XT, y: YA('A3'), z: ZCA }, 90);
    const T2 = await build('tronc relais 2', REC.merger, { x: XT, y: Y3 + 1200, z: ZCA }, 90);
    const S2 = await build('tronc S2', REC.splitter, { x: XT, y: YA('A2'), z: ZCA }, 90);
    const T1 = await build('tronc relais 1', REC.merger, { x: XT, y: B12[1] - 4600, z: ZCA }, 90);
    const E1 = await build('tronc E1', REC.merger, { x: XT, y: YA('A1'), z: ZCA }, 180);
    await link('b4 cat > Rk', REC.lift, st.actors['cat lingots 47'], 'Output1', Rk, 'Input3', LIFT);
    await link('b3 cat > K', REC.lift, st.actors['b3 haut lingots 46'], 'Output1', K, 'Input2', LIFT);
    await link('tronc Rk > T3', REC.belt, Rk, 'Output1', T3, 'Input1');
    await link('tronc K > T3', REC.belt, K, 'Output1', T3, 'Input2');
    await link('tronc T3 > S3', REC.belt, T3, 'Output1', S3, 'Input1');
    await link('tronc S3 > A3', REC.belt, S3, 'Output2', tete('A3', 1), 'Input1');
    await link('tronc S3 > relais 2', REC.belt, S3, 'Output1', T2, 'Input1');
    await link('tronc relais 2 > S2', REC.belt, T2, 'Output1', S2, 'Input1');
    await link('tronc S2 > A2', REC.belt, S2, 'Output2', tete('A2', 1), 'Input1');
    await link('tronc S2 > relais 1', REC.belt, S2, 'Output1', T1, 'Input1');
    await link('tronc relais 1 > E1', REC.belt, T1, 'Output1', E1, 'Input2');
    await link('tronc E1 > A1', REC.belt, E1, 'Output1', tete('A1', 1), 'Input1');
  },

  // Queues des rangees A1, A2, A3 (surplus) -> M (cuivre +67 m, caterium +71 m, x -84 500, a la hauteur des arrivees de
  // A2) -> tetes de A4 : A1 par le sud (T, relais, entree sud), A3 par le nord, A2 par l'est
  async surplus() {
    for (const [f, z, nom] of [[0, ZCU, 'cuivre'], [1, ZCA, 'caterium']]) {
      const p = 'A4 ' + nom;
      const M = await build(p + ' M', REC.merger, { x: XS, y: YA('A2'), z }, 180);
      const T1 = await build(p + ' T1', REC.merger, { x: XS, y: YA('A1'), z }, -90);
      const R1 = await build(p + ' relais 1', REC.merger, { x: XS, y: YA('A1') - 3200, z }, -90);
      const T3 = await build(p + ' T3', REC.merger, { x: XS, y: YA('A3'), z }, 90);
      const R3 = await build(p + ' relais 3', REC.merger, { x: XS, y: YA('A3') + 3800, z }, 90);
      await link(p + ' A1 > T1', REC.belt, queue('A1', f), 'Output1', T1, 'Input2');
      await link(p + ' T1 > relais 1', REC.belt, T1, 'Output1', R1, 'Input1');
      await link(p + ' relais 1 > M', REC.belt, R1, 'Output1', M, 'Input3');
      await link(p + ' A3 > T3', REC.belt, queue('A3', f), 'Output1', T3, 'Input3');
      await link(p + ' T3 > relais 3', REC.belt, T3, 'Output1', R3, 'Input1');
      await link(p + ' relais 3 > M', REC.belt, R3, 'Output1', M, 'Input2');
      await link(p + ' A2 > M', REC.belt, queue('A2', f), 'Output1', M, 'Input1');
      await link(p + ' M > A4', REC.belt, M, 'Output1', tete('A4', f), 'Input1');
    }
  },
};

(async () => {
  const phase = process.argv[2];
  if (!PHASES[phase]) throw new Error('phase inconnue : ' + phase + ' (' + Object.keys(PHASES).join(' | ') + ')');
  await PHASES[phase]();
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
