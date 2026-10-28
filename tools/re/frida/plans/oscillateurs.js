// Oscillateurs du nucleaire (utilisateur, 27/10/2026 : « ok va pour les oscillateurs », plan accepte : « go ») : recettes
// de l'optimiseur (sinkAnalysis_163330), lues en jeu : Insulated Crystal Oscillator (fabricant : 10 quartz cristal + 7
// caoutchouc + 1 limiteur IA -> 1,875/min), Pure Quartz Crystal (raffinerie : 67,5 quartz + 37,5 m3 d'eau -> 52,5).
// 50,4 oscillateurs/min -> 27 fabricants, 10 raffineries (675 quartz, 375 m3), 354 caoutchouc, 50,4 limiteurs.
//  - Quartz cristal : 10 raffineries a la suite des 7 de caterium de l'etage du haut de la bande 4 (k 7 a 16, montage
//    de barres-em.js : eau au sud a +5 m, minerai au sud a +11 m, produit au nord a +1 m). Eau : reseau du haut de la
//    bande 4 prolonge vers l'est ; 3 extracteurs de plus (k 7, 11, 15 : seules places acceptees entre ceux du bas, essai a blanc du 27/10), colonnes a deux pompes Mk2
//    (basse a -14 m, haute) ; la colonne d'un extracteur arrive sur la jonction de la raffinerie k-1 (branche opposee).
//    Minerai d'est en ouest (le caterium arrive de l'ouest) ; cristaux d'ouest en est, sortie au bout est.
//  - Quartz brut : quai q3 (quartz) de N211 O96 -> tampon (comme les autres quais du site) -> ascenseur a +55 m -> nord le
//    long de x du tampon (au-dessus des bandes 1 et 2, sous l'atelier) -> ouest a y -236 400 -> descente a +43 m -> tete
//    de la rangee (repartiteur de k 16).
// usage : node oscillateurs.js <phase> [--dry]
//   phases : raffineries | extracteurs | eau | colonnes | pompes | minerai | cristaux | tampon | brut | courant |
//            limiteurs | cristauxLigne | caoutchouc   (piles : node pile.js <etape> --config oscillateurs-pile-config-state.json)
// Etat : oscillateurs-state.json (non versionne).
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
  box: 'Recipe_StorageContainerMk2_C', Q: 'Recipe_Alternate_PureQuartzCrystal_C',
};
// Geometrie de barres-em.js (bande 4, etage du haut)
const X = (k) => -134000 + 1200 * k;
const Y = -238200, ZH = 3200, SIDE = 1400, ZB = 100, ZF = 500, ZM = 1100;
const KQ = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const EXTQ = [7, 11, 15].map((k) => ({ k, x: X(k) - 600, s: 1 }));
const XJ = (e) => e.x - 800; // = X(k-1) - 200 : jonction de la raffinerie k-1
const WATER = PREFIX + 'FGWaterVolume105'; // x < -110 000 (barres-em.js)
const BEM = JSON.parse(fs.readFileSync(path.join(__dirname, 'barres-em-state.json'), 'utf8'));
const EAU_EST = BEM.actors['b4 haut eau sud -127000']; // bout est de la ligne d'eau du haut de la bande 4
// Quartz brut : quai q3 de N211 O96 (2145698689, x -101 724), tampon a quai.x - 300, y -213 770 (comme barres-em.js)
const QUAI = PREFIX + 'Build_TrainDockingStation_C_2145698689';
const TP = { x: -102024, y: -213770, z: 349 };
const ZL = 5500, YW = -236400, XU = -113400;
const spread = (a, b, max) => { const n = Math.ceil(Math.abs(b - a) / max); return [...Array(n - 1).keys()].map((i) => Math.round(a + (b - a) * (i + 1) / n)); };
const E = { x: 1, y: 0 }, W = { x: -1, y: 0 }, N = { x: 0, y: -1 }, S = { x: 0, y: 1 };

const FILE = path.join(__dirname, 'oscillateurs-state.json');
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
  // degagement souple seul en cause (convoyeur a 52,5 m, 9,5 m au-dessus de la ligne de minerai de la bande 1) : accepte
  // apres un essai a blanc sans lui, comme barres-em.js
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
async function conn(actor, direction, dir) {
  const list = (await call('connections', actor)).filter((c) => c.direction === direction && !c.connected);
  const score = (c) => c.normal.x * dir.x + c.normal.y * dir.y;
  list.sort((a, b) => score(b) - score(a));
  if (!list.length || score(list[0]) < 0.7) throw new Error('aucun connecteur ' + direction + ' libre vers ' + JSON.stringify(dir) + ' sur ' + short(actor));
  return list[0].name;
}
async function linkDir(key, recipe, from, fromDir, to, toDir, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(40), 'a construire'); return null; }
  return link(key, recipe, from, await conn(from, 'output', fromDir), to, await conn(to, 'input', toDir), opts);
}
// Cable vers le poteau le plus proche qui a une place libre (circuit raccorde)
async function wireNearest(key, actor) {
  if (st.wires[key] || DRY || !actor) return;
  const at = (await call('pose', actor)).location;
  for (const it of (await call('scan', 'FGBuildablePowerPole', at, 8000, 30, {})).items) {
    const pw = await call('power', it.path);
    if (pw.wires >= pw.maxWires || pw.circuitId < 0) continue;
    const w = await call('wire', it.path, actor, {});
    if (w.built) { st.wires[key] = w.actor || true; save(); console.log(('cable ' + key).padEnd(40), short(it.path), Math.round(it.distance / 100) + ' m'); return; }
  }
  throw new Error(key + ' : aucun poteau libre a moins de 80 m');
}
// Pompe sur la partie d'un tuyau comprise entre zmin et zmax : premier point accepte a blanc (barres-em.js)
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
const REF = (k) => st.actors['raffinerie ' + k];
const PILE = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'oscillateurs-pile-state.json'), 'utf8'));
const J = (x) => (x === X(6) - 200 ? EAU_EST : st.actors['eau ' + x]);

const PHASES = {
  async raffineries() {
    for (const k of KQ) {
      await build('raffinerie ' + k, REC.refinery, { x: X(k), y: Y, z: ZH }, 0);
      if (!DRY && REF(k) && !st.links['recette ' + k]) {
        const r = await call('setRecipe', REF(k), REC.Q);
        st.links['recette ' + k] = r.recipe || true; save();
        console.log(('recette ' + k).padEnd(40), r.recipe);
      }
    }
  },

  // poses par un point touche fabrique sur le volume d'eau (barres-em.js), sortie vers le sud
  async extracteurs() {
    for (const e of EXTQ) {
      const key = 'extracteur ' + e.k;
      if (st.actors[key]) continue;
      const y = Y + 300 * e.s;
      const r = await call('buildAim', REC.extractor, { x: e.x, y, z: 1000 }, { x: e.x, y, z: -1815 }, { dryRun: DRY, onActor: WATER, scrollRotation: 180 });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // ligne d'eau du haut prolongee vers l'est (jonctions devant chaque raffinerie, x-2) ; branche Connection3 -> raffinerie
  async eau() {
    const xs = KQ.map((k) => X(k) - 200).sort((a, b) => b - a); // d'est en ouest
    for (const x of xs) await build('eau ' + x, REC.junction, { x, y: Y + SIDE, z: ZH + ZF }, 0);
    const chain = xs.concat([X(6) - 200]);
    for (let i = 1; i < chain.length; i++) await link('eau ' + chain[i - 1] + ' > ' + chain[i], REC.pipe, J(chain[i - 1]), 'Connection0', J(chain[i]), 'Connection1');
    for (const k of KQ) await link('eau > raffinerie ' + k, REC.pipe, J(X(k) - 200), 'Connection3', REF(k), 'PipeInputFactory');
  },

  // extracteur -> relais A (-7 m, 17 m au sud de l'axe) -> colonne -> relais B (+37 m, 26 m au sud) -> jonction de la
  // raffinerie k-1 (branche Connection2)
  async colonnes() {
    for (const e of EXTQ) {
      const A = await build('relais A ' + e.k, REC.junction, { x: e.x, y: Y + 1700, z: -700 }, 0);
      const B = await build('relais B ' + e.k, REC.junction, { x: e.x, y: Y + 2600, z: ZH + ZF }, 0);
      await link('extracteur ' + e.k + ' > A', REC.pipe, st.actors['extracteur ' + e.k], 'FGPipeConnectionFactory', A, 'Connection3');
      await link('colonne haute ' + e.k, REC.pipe, A, 'Connection2', B, 'Connection3');
      await link('B ' + e.k + ' > ligne', REC.pipe, B, 'Connection0', J(XJ(e)), 'Connection2');
    }
  },

  // pompe Mk2 haute (colonne, 0 a 25 m) et basse (tuyau extracteur -> A, -16 a -9 m : a portee de l'extracteur)
  async pompes() {
    for (const e of EXTQ) {
      await pompe('pompe haute ' + e.k, st.links['colonne haute ' + e.k], 0, 2500);
      await pompe('pompe basse ' + e.k, st.links['extracteur ' + e.k + ' > A'], -1600, -900);
    }
  },

  // minerai au sud a +11 m, d'est en ouest : repartiteurs devant les raffineries (x+2, cap 180), branche Output2 ->
  // ascenseur -> Input0
  async minerai() {
    const Sp = (k) => st.actors['minerai ' + k];
    for (const k of KQ) await build('minerai ' + k, REC.splitter, { x: X(k) + 200, y: Y + SIDE, z: ZH + ZM }, 180);
    for (let k = 16; k > 7; k--) await link('minerai ' + k + ' > ' + (k - 1), REC.belt, Sp(k), 'Output1', Sp(k - 1), 'Input1');
    for (const k of KQ) await link('minerai > raffinerie ' + k, REC.lift, Sp(k), 'Output2', REF(k), 'Input0', { snapTolerance: 400 });
  },

  // cristaux au nord a +1 m, d'ouest en est : fusionneurs devant les raffineries (x+2, cap 0, Input2 au sud) ; sortie au
  // bout est (Output1 de k 16), vers les oscillateurs
  async cristaux() {
    const M = (k) => st.actors['cristaux ' + k];
    for (const k of KQ) await build('cristaux ' + k, REC.merger, { x: X(k) + 200, y: Y - SIDE, z: ZH + ZB }, 0);
    for (const k of KQ) await link('raffinerie ' + k + ' > cristaux', REC.belt, REF(k), 'Output1', M(k), 'Input2');
    for (let k = 7; k < 16; k++) await link('cristaux ' + k + ' > ' + (k + 1), REC.belt, M(k), 'Output1', M(k + 1), 'Input1');
  },

  // tampon en sortie du quai du quartz (« il faut des tampons en sortie de quai »)
  async tampon() {
    const t = await build('tampon quartz', REC.box, TP, 180);
    await link('quai > tampon (bas)', REC.belt, QUAI, 'Output0', t, 'Input0');
    await link('quai > tampon (haut)', REC.belt, QUAI, 'Output1', t, 'Input1');
  },

  // tampon -> P (cap 180, entree au sud) -> ascenseur -> Ph (+55 m, cap -90, entree ouest) -> nord -> coin (cap 180) ->
  // ouest a y -236 400 -> U (cap 90, entree est) -> ascenseur -> D (+43 m, cap -90) -> repartiteur de k 16 (entree est)
  async brut() {
    const P = await build('brut P', REC.merger, { x: TP.x, y: -215000, z: 449 }, 180);
    const Ph = await build('brut Ph', REC.merger, { x: TP.x, y: -215000, z: ZL }, -90);
    const ns = [Ph];
    for (const y of spread(-215000, YW, 4000)) ns.push(await build('brut nord ' + y, REC.merger, { x: TP.x, y, z: ZL }, -90));
    const C1 = await build('brut coin', REC.merger, { x: TP.x, y: YW, z: ZL }, 180);
    const ew = [C1];
    for (const x of spread(TP.x, XU, 4000)) ew.push(await build('brut ouest ' + x, REC.merger, { x, y: YW, z: ZL }, 180));
    const U = await build('brut U', REC.merger, { x: XU, y: YW, z: ZL }, 90);
    const D = await build('brut D', REC.merger, { x: XU, y: YW, z: ZH + ZM }, -90);
    await link('tampon > P', REC.belt, st.actors['tampon quartz'], 'Output1', P, 'Input3');
    await link('brut montee', REC.lift, P, 'Output1', Ph, 'Input3', { snapTolerance: 400 });
    for (let i = 1; i < ns.length; i++) await linkDir('brut nord ' + i, REC.belt, ns[i - 1], N, ns[i], S);
    await link('brut > coin', REC.belt, ns[ns.length - 1], 'Output1', C1, 'Input3');
    ew.push(U);
    for (let i = 1; i < ew.length - 1; i++) await linkDir('brut ouest ' + i, REC.belt, ew[i - 1], W, ew[i], E);
    await link('brut > U', REC.belt, ew[ew.length - 2], 'Output1', U, 'Input3');
    await link('brut descente', REC.lift, U, 'Output1', D, 'Input1', { snapTolerance: 400 });
    await link('brut > rangee', REC.belt, D, 'Output1', st.actors['minerai 16'], 'Input1');
  },

  // Arrivees des piles d'oscillateurs (pile.js, oscillateurs-pile-config-state.json : 3 piles de 9, x -110 300 / -108 100
  // / -105 900, dos au nord) : tetes a l'ouest, entree Input1 face a l'ouest ; relais finaux a x -112 400 / -113 400.
  // Les lignes de l'atelier occupent 67 a 83 m a l'ouest des unites : on les croise au-dessous ou au-dessus.
  // Limiteurs : collecteur de A3 (65 m, vers l'ouest) -> R0 (-112 400, cap 90) -> sud -> F0 (65 m, cap 0, entree nord)
  // -> tete (58 m)
  async limiteurs() {
    const A3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'barres-em-A3-pile-state.json'), 'utf8'));
    const R0 = await build('limiteurs R0', REC.merger, { x: -112400, y: -224300, z: 6500 }, 90);
    const F0 = await build('limiteurs F0', REC.merger, { x: -112400, y: -221705, z: 6500 }, 0);
    await link('A3 > limiteurs R0', REC.belt, A3.parts['collecteur pile 0'], 'Output1', R0, 'Input3');
    await link('limiteurs R0 > F0', REC.belt, R0, 'Output1', F0, 'Input3');
    await link('limiteurs F0 > tete', REC.belt, F0, 'Output1', PILE().parts['arrivee 0 pile 0'], 'Input1');
  },

  // Cristaux : bout est du collecteur de la bande 4 (33 m) -> C0 (cap -90, entree ouest) -> ascenseur -> C1 (81 m, cap
  // 90) -> C2 (cap 180, entree nord) -> ascenseur -> C3 (95 m, cap 90, entree ouest) -> sud le long de x -113 400 au-dessus
  // de l'atelier -> U (95 m, cap 90) -> ascenseur -> F1 (70 m, cap 0, entree sud) -> tete
  async cristauxLigne() {
    const XC = -113400;
    const C0 = await build('cristaux C0', REC.merger, { x: XC, y: -239600, z: ZH + ZB }, -90);
    const C1 = await build('cristaux C1', REC.merger, { x: XC, y: -239600, z: 8100 }, 90);
    const C2 = await build('cristaux C2', REC.merger, { x: XC, y: -239000, z: 8100 }, 180);
    const C3 = await build('cristaux C3', REC.merger, { x: XC, y: -239000, z: 9500 }, 90);
    const ns = [C3];
    for (const y of spread(-239000, -221705, 4500)) ns.push(await build('cristaux sud ' + y, REC.merger, { x: XC, y, z: 9500 }, 90));
    const U = await build('cristaux U', REC.merger, { x: XC, y: -221705, z: 9500 }, 90);
    const F1 = await build('cristaux F1', REC.merger, { x: XC, y: -221705, z: 7000 }, 0);
    ns.push(U);
    await link('cristaux 16 > C0', REC.belt, st.actors['cristaux 16'], 'Output1', C0, 'Input3');
    await link('cristaux montee 1', REC.lift, C0, 'Output1', C1, 'Input1', { snapTolerance: 400 });
    await link('cristaux C1 > C2', REC.belt, C1, 'Output1', C2, 'Input2');
    await link('cristaux montee 2', REC.lift, C2, 'Output1', C3, 'Input2', { snapTolerance: 400 });
    for (let i = 1; i < ns.length; i++) await link('cristaux sud ' + i, REC.belt, ns[i - 1], 'Output1', ns[i], 'Input1');
    await link('cristaux descente', REC.lift, U, 'Output1', F1, 'Input2', { snapTolerance: 400 });
    await link('cristaux F1 > tete', REC.belt, F1, 'Output1', PILE().parts['arrivee 1 pile 0'], 'Input1');
  },

  // Caoutchouc : conteneur 2 du trieur de N211 O143 (sorties a l'ouest, basse a 4,5 m) -> K0 (cap 180) -> ascenseur ->
  // K1 (52,5 m, cap 0) -> est le long de y -215 600 (au-dessus des troncs, sous l'atelier) -> coin (x -113 400, cap -90,
  // entree ouest) -> nord -> L (52,5 m, cap -90) -> ascenseur -> F2 (58 m, cap 0, entree nord) -> tete du rang interieur
  async caoutchouc() {
    const CONT = PREFIX + 'Build_StorageContainerMk2_C_2144004216', XK = -149634, YK = -215600, ZK = 5250, XC = -113400;
    const outs = (await call('connections', CONT)).filter((c) => c.direction === 'output').sort((a, b) => a.location.z - b.location.z);
    const K0 = await build('caoutchouc K0', REC.merger, { x: XK, y: YK, z: outs[0].location.z }, 180);
    const K1 = await build('caoutchouc K1', REC.merger, { x: XK, y: YK, z: ZK }, 0);
    // contournement de la colonne des stators de N211 O143 q2 (fusionneur 2147024653 et ascenseur a x -146 334,
    // y -215 400 / -215 800, de 4 a 75 m) : deux relais 10 m au sud
    const ew = [K1];
    ew.push(await build('caoutchouc detour 1', REC.merger, { x: -147600, y: -214600, z: ZK }, 0));
    ew.push(await build('caoutchouc detour 2', REC.merger, { x: -144600, y: -214600, z: ZK }, 0));
    for (const x of spread(XK, XC, 4500).slice(1)) ew.push(await build('caoutchouc est ' + x, REC.merger, { x, y: YK, z: ZK }, 0));
    const Co = await build('caoutchouc coin', REC.merger, { x: XC, y: YK, z: ZK }, -90);
    const nn = [Co];
    for (const y of spread(YK, -222405, 4500)) nn.push(await build('caoutchouc nord ' + y, REC.merger, { x: XC, y, z: ZK }, -90));
    const L = await build('caoutchouc L', REC.merger, { x: XC, y: -222405, z: ZK }, -90);
    const F2 = await build('caoutchouc F2', REC.merger, { x: XC, y: -222405, z: 5800 }, 0);
    nn.push(L);
    await link('conteneur 2 > K0', REC.belt, CONT, outs[0].name, K0, 'Input1');
    await link('caoutchouc montee', REC.lift, K0, 'Output1', K1, 'Input1', { snapTolerance: 400 });
    for (let i = 1; i < ew.length; i++) await link('caoutchouc est ' + i, REC.belt, ew[i - 1], 'Output1', ew[i], 'Input1');
    await link('caoutchouc > coin', REC.belt, ew[ew.length - 1], 'Output1', Co, 'Input3');
    for (let i = 1; i < nn.length; i++) await link('caoutchouc nord ' + i, REC.belt, nn[i - 1], 'Output1', nn[i], 'Input1');
    await link('caoutchouc montee 2', REC.lift, L, 'Output1', F2, 'Input3', { snapTolerance: 400 });
    await link('caoutchouc F2 > tete', REC.belt, F2, 'Output1', PILE().parts['arrivee 2 pile 0'], 'Input1');
  },

  // raffineries, extracteurs et pompes sur le poteau le plus proche qui a une place libre ; poteau Mk3 au bout est de la
  // rangee (les poteaux voisins sont pleins), raccorde au Mk3 2147019138 (-109 400 ; -241 400 ; 0 m, 7 cables sur 10)
  async courant() {
    const P = await build('poteau est', 'Recipe_PowerPoleMk3_C', { x: -114000, y: -240600, z: ZH }, 0);
    if (!DRY && P && !st.wires['poteau est']) {
      const w = await call('wire', PREFIX + 'Build_PowerPoleMk3_C_2147019138', P, {});
      if (!w.built) throw new Error('poteau est : cable refuse ' + JSON.stringify(w.blocking));
      st.wires['poteau est'] = w.actor || true; save();
      console.log('cable poteau est'.padEnd(40), 'sur Build_PowerPoleMk3_C_2147019138');
    }
    // poteau Mk3 « eau » entre les extracteurs 11 et 15 (le poteau est en est a 93 m), raccorde au poteau est
    const Pe = await build('poteau eau', 'Recipe_PowerPoleMk3_C', { x: -118400, y: -235400, z: 0 }, 0);
    if (!DRY && Pe && !st.wires['poteau eau']) {
      const w = await call('wire', P, Pe, {});
      if (!w.built) throw new Error('poteau eau : cable refuse ' + JSON.stringify(w.blocking));
      st.wires['poteau eau'] = w.actor || true; save();
      console.log('cable poteau eau'.padEnd(40), 'sur le poteau est');
    }
    for (const k of KQ) await wireNearest('raffinerie ' + k, REF(k));
    for (const e of EXTQ) {
      await wireNearest('extracteur ' + e.k, st.actors['extracteur ' + e.k]);
      await wireNearest('pompe haute ' + e.k, st.actors['pompe haute ' + e.k]);
      await wireNearest('pompe basse ' + e.k, st.actors['pompe basse ' + e.k]);
    }
  },
};

(async () => {
  const phase = process.argv[2];
  if (!PHASES[phase]) throw new Error('phase inconnue : ' + phase + ' (' + Object.keys(PHASES).join(' | ') + ')');
  await PHASES[phase]();
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
