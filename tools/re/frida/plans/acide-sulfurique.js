// Acide sulfurique du nucleaire (utilisateur, 27/10/2026 : « qu'est-ce qu'on fait du soufre ? », « y'a la place dans le
// prolongement des raffineries caterium et cuivre ? », « go ») : usine commune, sans radioactif, dimensionnee pour les
// 3,5 modules (optimiseur : 756 acide/min pour 50,4 melangeurs d'uranium non fissile). Recette lue en jeu : 50 soufre +
// 50 m3 d'eau -> 50 m3 d'acide (raffinerie) -> 15 raffineries.
//  - Rangee : etage du bas de la bande 3, a la suite du caterium (k 19 a 33, montage de barres-em.js : eau au sud a +5 m,
//    soufre au sud a +11 m, entree par l'est, d'est en ouest ; acide au nord a +5 m, collecteur de tuyaux, sortie libre a
//    l'ouest vers les futurs melangeurs d'uranium non fissile). Reseau d'eau a part : 7 extracteurs sous la rangee
//    (k 20 a 32, pas de 2 ; 840 m3 pour 750), colonnes directes avec pompe Mk2 basse (a portee de l'extracteur).
//  - Soufre : quai q2 de N211 O119 (2145682217, x -121 979, trains de N248 E258) -> tampon (comme les autres quais) ->
//    sortie haute (8,5 m) -> ascenseur a 56,5 m -> nord le long de x du tampon (au-dessus des bandes et de la ligne du
//    caoutchouc, entre les unites 1 et 2 de l'atelier) -> descente a 50 m -> est le long de y -228 000 (sous la ligne du
//    quartz brut a 55 m, sous l'atelier) -> descente a +11 m -> tete de la rangee (repartiteur de k 33).
// usage : node acide-sulfurique.js <phase> [--dry]
//   phases : raffineries | extracteurs | eau | pompes | soufre | acide | tampon | ligne | courant
// Etat : acide-sulfurique-state.json (non versionne).
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
  box: 'Recipe_StorageContainerMk2_C', pole: 'Recipe_PowerPoleMk3_C', acid: 'Recipe_SulfuricAcid_C',
};
// Geometrie de barres-em.js (bande 3, etage du bas)
const X = (k) => -134000 + 1200 * k;
const Y = -231800, Z = 0, SIDE = 1400, ZF = 500, ZM = 1100;
const KA = [...Array(15).keys()].map((i) => 19 + i);           // k 19 a 33
const EXTA = [20, 22, 24, 26, 28, 30, 32].map((k) => ({ k, x: X(k) - 600 }));
const WATER = (x) => PREFIX + (x < -110000 ? 'FGWaterVolume105' : 'FGWaterVolume_7');
// Soufre
const QUAI = PREFIX + 'Build_TrainDockingStation_C_2145682217';
const TP = { x: -122279, y: -213770, z: 349 };
const ZN = 5650, ZE = 5000, YE = -228000, XU = -93000;
const spread = (a, b, max) => { const n = Math.ceil(Math.abs(b - a) / max); return [...Array(n - 1).keys()].map((i) => Math.round(a + (b - a) * (i + 1) / n)); };

const FILE = path.join(__dirname, 'acide-sulfurique-state.json');
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
// Cable vers le poteau le plus proche qui a une place libre (circuit raccorde)
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

const PHASES = {
  async raffineries() {
    for (const k of KA) {
      await build('raffinerie ' + k, REC.refinery, { x: X(k), y: Y, z: Z }, 0);
      if (!DRY && REF(k) && !st.links['recette ' + k]) {
        const r = await call('setRecipe', REF(k), REC.acid);
        st.links['recette ' + k] = r.recipe || true; save();
        console.log(('recette ' + k).padEnd(40), r.recipe);
      }
    }
  },

  // sous la rangee, 3 m au sud de l'axe, sortie au sud (barres-em.js)
  async extracteurs() {
    for (const e of EXTA) {
      const key = 'extracteur ' + e.k;
      if (st.actors[key]) continue;
      const y = Y + 300;
      const r = await call('buildAim', REC.extractor, { x: e.x, y, z: 1000 }, { x: e.x, y, z: -1815 }, { dryRun: DRY, onActor: WATER(e.x), scrollRotation: 180 });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // ligne d'eau au sud a +5 m : jonctions devant les raffineries (x-2, branche Connection3) et des extracteurs (x de
  // l'extracteur, colonne directe sur Connection3), enchainees d'est en ouest
  async eau() {
    const xs = KA.map((k) => X(k) - 200).concat(EXTA.map((e) => e.x)).sort((a, b) => b - a);
    for (const x of xs) await build('eau ' + x, REC.junction, { x, y: Y + SIDE, z: Z + ZF }, 0);
    const J = (x) => st.actors['eau ' + x];
    for (let i = 1; i < xs.length; i++) await link('eau ' + xs[i - 1] + ' > ' + xs[i], REC.pipe, J(xs[i - 1]), 'Connection0', J(xs[i]), 'Connection1');
    for (const k of KA) await link('eau > raffinerie ' + k, REC.pipe, J(X(k) - 200), 'Connection3', REF(k), 'PipeInputFactory');
    for (const e of EXTA) await link('colonne ' + e.k, REC.pipe, st.actors['extracteur ' + e.k], 'FGPipeConnectionFactory', J(e.x), 'Connection3');
  },

  // pompe Mk2 basse sur chaque colonne, a portee de l'extracteur (-16 a -9 m)
  async pompes() {
    for (const e of EXTA) await pompe('pompe ' + e.k, st.links['colonne ' + e.k], -1600, -900);
  },

  // soufre au sud a +11 m, d'est en ouest : repartiteurs devant les raffineries (x+2, cap 180), branche Output2 ->
  // ascenseur -> Input0
  async soufre() {
    const Sp = (k) => st.actors['soufre ' + k];
    for (const k of KA) await build('soufre ' + k, REC.splitter, { x: X(k) + 200, y: Y + SIDE, z: Z + ZM }, 180);
    for (let k = 33; k > 19; k--) await link('soufre ' + k + ' > ' + (k - 1), REC.belt, Sp(k), 'Output1', Sp(k - 1), 'Input1');
    for (const k of KA) await link('soufre > raffinerie ' + k, REC.lift, Sp(k), 'Output2', REF(k), 'Input0', { snapTolerance: 400 });
  },

  // acide au nord a +5 m : jonctions devant les sorties (x-2, branche Connection2), enchainees d'est en ouest ; sortie
  // libre a l'ouest (Connection0 de la jonction de k 19)
  async acide() {
    const xs = KA.map((k) => X(k) - 200).sort((a, b) => b - a);
    for (const x of xs) await build('acide ' + x, REC.junction, { x, y: Y - SIDE, z: Z + ZF }, 0);
    const J = (x) => st.actors['acide ' + x];
    for (let i = 1; i < xs.length; i++) await link('acide ' + xs[i - 1] + ' > ' + xs[i], REC.pipe, J(xs[i - 1]), 'Connection0', J(xs[i]), 'Connection1');
    for (const k of KA) await link('raffinerie ' + k + ' > acide', REC.pipe, REF(k), 'PipeOutputFactory', J(X(k) - 200), 'Connection2');
  },

  // tampon en sortie du quai du soufre (« il faut des tampons en sortie de quai »)
  async tampon() {
    const t = await build('tampon soufre', REC.box, TP, 180);
    await link('quai > tampon (bas)', REC.belt, QUAI, 'Output0', t, 'Input0');
    await link('quai > tampon (haut)', REC.belt, QUAI, 'Output1', t, 'Input1');
  },

  // tampon (sortie haute) -> P (8,5 m, cap 180, entree sud) -> ascenseur -> Ph (56,5 m, cap -90, entree ouest) -> nord ->
  // C1 (cap -90) -> ascenseur -> C2 (50 m, cap 0, entree nord) -> est -> U (cap 90, entree ouest) -> ascenseur -> D
  // (+11 m, cap -90) -> repartiteur de k 33 (entree est)
  async ligne() {
    const P = await build('soufre P', REC.merger, { x: TP.x, y: -215000, z: 849 }, 180);
    const Ph = await build('soufre Ph', REC.merger, { x: TP.x, y: -215000, z: ZN }, -90);
    const ns = [Ph];
    for (const y of spread(-215000, YE, 4500)) ns.push(await build('soufre nord ' + y, REC.merger, { x: TP.x, y, z: ZN }, -90));
    const C1 = await build('soufre C1', REC.merger, { x: TP.x, y: YE, z: ZN }, -90);
    const C2 = await build('soufre C2', REC.merger, { x: TP.x, y: YE, z: ZE }, 0);
    ns.push(C1);
    const ew = [C2];
    for (const x of spread(TP.x, XU, 4500)) ew.push(await build('soufre est ' + x, REC.merger, { x, y: YE, z: ZE }, 0));
    const U = await build('soufre U', REC.merger, { x: XU, y: YE, z: ZE }, 90);
    const D = await build('soufre D', REC.merger, { x: XU, y: YE, z: Z + ZM }, -90);
    await link('tampon > P', REC.belt, st.actors['tampon soufre'], 'Output2', P, 'Input3');
    await link('soufre montee', REC.lift, P, 'Output1', Ph, 'Input3', { snapTolerance: 400 });
    for (let i = 1; i < ns.length; i++) await link('soufre nord ' + i, REC.belt, ns[i - 1], 'Output1', ns[i], 'Input1');
    await link('soufre descente 1', REC.lift, C1, 'Output1', C2, 'Input3', { snapTolerance: 400 });
    for (let i = 1; i < ew.length; i++) await link('soufre est ' + i, REC.belt, ew[i - 1], 'Output1', ew[i], 'Input1');
    await link('soufre > U', REC.belt, ew[ew.length - 1], 'Output1', U, 'Input2');
    await link('soufre descente 2', REC.lift, U, 'Output1', D, 'Input1', { snapTolerance: 400 });
    await link('soufre > rangee', REC.belt, D, 'Output1', st.actors['soufre 33'], 'Input1');
  },

  // raffineries, extracteurs et pompes sur le poteau le plus proche qui a une place libre ; sinon poteau Mk3 au nord de
  // la rangee (a sa hauteur), raccorde au poteau libre le plus proche
  async courant() {
    const items = KA.map((k) => ['raffinerie ' + k, REF(k)]).concat(EXTA.flatMap((e) => [['extracteur ' + e.k, st.actors['extracteur ' + e.k]], ['pompe ' + e.k, st.actors['pompe ' + e.k]]]));
    for (const [key, a] of items) {
      if (await wireNearest(key, a) || st.wires[key] || DRY) continue;
      // poteau neuf au-dessus de la machine, 24 m au nord de l'axe de la rangee, raccorde au poteau libre le plus proche
      const at = (await call('pose', a)).location;
      const pk = 'poteau ' + Math.round(at.x / 100);
      const P = await build(pk, REC.pole, { x: at.x, y: Y - 2400, z: Z }, 0);
      if (!(await wireNearest(pk, P))) throw new Error(pk + ' : aucun poteau libre a moins de 80 m');
      if (!(await wireNearest(key, a))) throw new Error(key + ' : toujours sans poteau libre');
    }
  },
};

(async () => {
  const phase = process.argv[2];
  if (!PHASES[phase]) throw new Error('phase inconnue : ' + phase + ' (' + Object.keys(PHASES).join(' | ') + ')');
  await PHASES[phase]();
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
