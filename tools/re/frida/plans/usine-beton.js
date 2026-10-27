// Usine de beton commune du nucleaire (utilisateur, 27/10/2026 : « hors nuke, si on doit etablir une fabrique, tu dois la
// dimensionner pour les 3.5 modules » ; « pour le beton on commence avec le gisement pur, on fera l'appoint plus tard » ;
// plan valide par « go »). Chenal est (FGWaterVolume_1, surface -17,3 m), au sud des arches qui le traversent (releve fait
// avec des sources de streaming : scratchpad arches-stream.js). Recette Wet Concrete lue en jeu : 120 calcaire + 100 m3
// d'eau -> 80 beton par raffinerie ; 24 raffineries = 1 920 beton/min (besoin des 3,5 modules : 1 915).
//  - une rangee est-ouest de 12 raffineries (pas de 12 m, x -85 600 .. -72 400, axe y -150 000), deux etages sur la meme
//    emprise : bas (base 0 m, cap 0 : calcaire et eau au sud, beton au nord), haut (base +32 m, cap 180 : calcaire et eau au
//    nord, beton au sud). Raffinerie : connecteurs a +-9 m de son centre, convoyeur a x+2 m, tuyau a x-2 m (cap 0).
//  - lignes 5 m devant les connecteurs (y = axe +-14 m) : calcaire a +1 m (repartiteurs), eau a +5 m (jonctions) ; beton a
//    +1 m de l'autre cote (fusionneurs), vers l'ouest, sortie libre au bout ouest (tampon et lignes vers le nord : phase
//    suivante, avec tracer.js).
//  - calcaire : 1 440/min par etage, plus qu'un Mk6 : chaque ligne est alimentee par ses deux bouts (tetes = fusionneurs) :
//    bas ouest k0-k9 (gisement 110, 1 200), bas est k11-k10 (54_833, 240) ; haut ouest k0-k3 (124, 480 sur 600), haut est
//    k11-k4 (54_833, 960). Les lignes des gisements jusqu'aux tetes : phase suivante.
//  - eau : 20 extracteurs a 100 %, 10 de chaque cote (sud pour le bas, nord pour le haut) : ligne interieure (k pairs) et
//    exterieure (k 1 ou 3, 5, 7, 11), x = X(k) - 6 m (entre deux raffineries), valides a blanc (streaming). Par etage,
//    deux reseaux de 5 extracteurs (600 m3/min, la limite d'un tuyau Mk2) : ouest k0-k5, est k6-k11. Colonne de chaque
//    extracteur jusqu'a sa jonction de ligne ; pompes : bas Mk1 entre -13 et -6 m ; haut Mk2 vers -12,5 m puis Mk1 vers
//    +20 m (references/pieges.md : l'extracteur ne pousse qu'a 10 m au-dessus de sa sortie).
// Reperes : axes du monde, nord = -y. Hauteurs : etages du skill satisfactory-live.
//
// usage : node usine-beton.js <phase> [--dry]
//   phases : raffineries | recettes | extracteurs | eau | pompes | calcaire | beton | arrivees | courant | verifie
// Foreuses : node foreuses.js 110 124_5785 --vers ... --nom calcaire-beton (54_833 : foreuse de l'utilisateur reprise).
// Etat : usine-beton-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const WATER_VOLUME = PREFIX + 'FGWaterVolume_1'; // chenal est (surface -17,3 m)
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  refinery: 'Recipe_OilRefinery_C', extractor: 'Recipe_WaterPump_C',
  junction: 'Recipe_PipelineJunction_Cross_C', pipe: 'Recipe_PipelineMK2_C',
  pump1: 'Recipe_PipelinePump_C', pump2: 'Recipe_PipelinePumpMk2_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', concrete: 'Recipe_Alternate_WetConcrete_C', pole: 'Recipe_PowerPoleMk3_C',
};
// Courant (circuit 2976, celui de tous les poteaux du secteur) : raccord au Mk1 a 75 m au sud (2 cables sur 4)
const GRID = PREFIX + 'Build_PowerPoleMk1_C_2146198506';
// Foreuses de calcaire (foreuses.js --nom calcaire-beton) ; 54_833 : foreuse refaite par l'utilisateur avec sa ligne
// jusqu'au pied de l'aiguille (27/10/2026), passee a 250 % et 3 eclats ; fin de ligne : traces/calcaire-54-fin-ligne.json
// 110 : foreuse refaite aussi par l'utilisateur avec sa ligne ; fin de ligne : traces/calcaire-110-fin-ligne.json ; foreuses de
// 110 et 124 raccordees au courant apres coup (foreuses.js ne pose pas de cable)
const MINER = { g110: PREFIX + 'Build_MinerMk3_C_2145245063', g124: PREFIX + 'Build_MinerMk3_C_2145295703', g54: PREFIX + 'Build_MinerMk3_C_2145290294' };
REC.lift = 'Recipe_ConveyorLiftMk6_C';

// --- Geometrie --------------------------------------------------------------------------------------------
const Y = -150000;
const XW = -85600;
const X = (k) => XW + 1200 * k;               // k = 0 a l'ouest
const K = [...Array(12).keys()];
const ZB = 100, ZF = 500;                      // convoyeurs, fluides (au-dessus de la base de l'etage)
const SIDE = 1400;                             // lignes 5 m devant les connecteurs (+-9 m)
// s : cote des entrees (+1 sud, -1 nord) ; db / dp : decalage en x du convoyeur / du tuyau de la raffinerie
const FLOORS = {
  bas: { Z: 0, yaw: 0, s: 1, db: 200, dp: -200 },
  haut: { Z: 3200, yaw: 180, s: -1, db: -200, dp: 200 },
};
const HALF = { ouest: K.filter((k) => k <= 5), est: K.filter((k) => k >= 6) };
// Extracteurs : 10 par cote ; ligne interieure a 15 m (sud) / 25 m (nord) de l'axe, exterieure a 35 m / 45 m
const EXT = [];
// (bas : k3 au lieu de k1 sur la ligne exterieure, refuse a blanc le 27/10/2026, FGCDResourceIsTooShallow contre l'ilot)
for (const [floor, s, yIn, yOut, outs] of [['bas', 1, Y + 1500, Y + 3500, [3, 5, 7, 11]], ['haut', -1, Y - 2500, Y - 4500, [1, 5, 7, 11]]]) {
  for (const k of [0, 2, 4, 6, 8, 10]) EXT.push({ floor, s, k, x: X(k) - 600, y: yIn, ligne: 'int' });
  for (const k of outs) EXT.push({ floor, s, k, x: X(k) - 600, y: yOut, ligne: 'ext' });
}
const extKey = (e) => e.floor + ' extracteur ' + e.k;
const half = (k) => (k <= 5 ? 'ouest' : 'est');
// Calcaire : segments de ligne par etage, dans le sens du flux (tete d'abord)
const SEGMENTS = {
  bas: [{ id: 'ouest', ks: K.filter((k) => k <= 9), cap: 0 }, { id: 'est', ks: [11, 10], cap: 180 }],
  haut: [{ id: 'ouest', ks: [0, 1, 2, 3], cap: 0 }, { id: 'est', ks: [11, 10, 9, 8, 7, 6, 5, 4], cap: 180 }],
};

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'usine-beton-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '') + (r.snapped ? ' accroches=' + JSON.stringify(r.snapped) : '');
  console.log(key.padEnd(44), what + extra);
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
  if (!from || !to) { if (!DRY) console.log(key.padEnd(44), 'saute (bout absent)'); return null; }
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
// Pompe sur une colonne : premier point accepte a blanc entre zmin et zmax, le plus proche de zmid (module-cuivre.js)
async function pompe(key, recipe, pipe, zmin, zmax, zmid) {
  if (st.actors[key]) return;
  if (!pipe) { console.log(key.padEnd(44), 'saute (colonne absente)'); return; }
  const w = await pipePoints(pipe), cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  const mid = zmid == null ? (zmin + zmax) / 2 : zmid;
  let r = null;
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax).sort((a, b) => Math.abs(a.z - mid) - Math.abs(b.z - mid))) {
    const aim = [{ x: p.x, y: p.y + 300, z: p.z + 300 }, p];
    const t = await call('buildAim', recipe, aim[0], aim[1], { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    r = DRY ? t : await call('buildAim', recipe, aim[0], aim[1], { onActor: pipe });
    console.log(key.padEnd(44), 'a', (p.z / 100).toFixed(1), 'm');
    break;
  }
  if (!r) throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
}
// Tuyau qui part d'une pompe vers le haut : inserer une pompe remplace le tuyau par deux tuyaux neufs (references/pieges.md)
async function upperPipe(pump) {
  const pz = (await call('pose', pump)).location.z;
  for (const c of await call('connections', pump)) {
    const other = (await call('dump', pump + '.' + c.name, 1, 1, ['mConnectedComponent'])).mConnectedComponent;
    if (!other) continue;
    const pipe = other.slice(0, other.lastIndexOf('.'));
    if (Math.max(...(await pipePoints(pipe)).map((p) => p.z)) > pz + 500) return pipe;
  }
  return null;
}
// Ligne de jonctions d'est en ouest (Connection0 -> Connection1 de voisine en voisine)
async function junctionLine(prefix, xs, y, z) {
  const sorted = [...new Set(xs)].sort((a, b) => b - a);
  for (const x of sorted) await build(prefix + ' ' + x, REC.junction, { x, y, z }, 0, AIR);
  for (let i = 1; i < sorted.length; i++) await link(prefix + ' ' + sorted[i - 1] + ' > ' + sorted[i], REC.pipe, st.actors[prefix + ' ' + sorted[i - 1]], 'Connection0', st.actors[prefix + ' ' + sorted[i]], 'Connection1');
  return (x) => st.actors[prefix + ' ' + x];
}
const ref = (f, k) => st.actors[f + ' raffinerie ' + k];

const PHASES = {
  async raffineries() {
    for (const [f, F] of Object.entries(FLOORS)) for (const k of K) await build(f + ' raffinerie ' + k, REC.refinery, { x: X(k), y: Y, z: F.Z }, F.yaw, AIR);
  },

  async recettes() {
    for (const f of Object.keys(FLOORS)) for (const k of K) {
      const key = f + ' raffinerie ' + k, a = st.actors[key];
      if (!a || DRY) { console.log(key.padEnd(44), DRY ? REC.concrete : 'absente'); continue; }
      const r = await call('setRecipe', a, REC.concrete);
      console.log(key.padEnd(44), r.recipe);
    }
  },

  // poses par un point touche fabrique sur le volume d'eau ; sortie tournee vers la rangee (molette 0 = nord, 180 = sud)
  async extracteurs() {
    for (const e of EXT) {
      const key = extKey(e);
      if (st.actors[key]) continue;
      const r = await call('buildAim', REC.extractor, { x: e.x, y: e.y, z: 1000 }, { x: e.x, y: e.y, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: e.s > 0 ? 0 : 180 });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // Lignes d'eau a +5 m cote entrees, deux reseaux par etage ; branche vers la raffinerie (Connection3 au nord, Connection2
  // au sud), colonne de chaque extracteur jusqu'a sa jonction (arrivee par le cote de sa sortie)
  async eau() {
    for (const [f, F] of Object.entries(FLOORS)) {
      const y = Y + SIDE * F.s, z = F.Z + ZF, toRef = F.s > 0 ? 'Connection3' : 'Connection2';
      for (const [h, ks] of Object.entries(HALF)) {
        const exts = EXT.filter((e) => e.floor === f && half(e.k) === h);
        const J = await junctionLine(f + ' eau ' + h, ks.map((k) => X(k) + F.dp).concat(exts.map((e) => e.x)), y, z);
        for (const k of ks) await link(f + ' eau > raffinerie ' + k, REC.pipe, J(X(k) + F.dp), toRef, ref(f, k), 'PipeInputFactory');
        for (const e of exts) {
          // sortie de l'extracteur a 4,6 m de son centre, vers la rangee : du cote de la rangee par rapport a la ligne si
          // ligne interieure en bas (sortie au nord de la ligne), sinon du cote exterieur
          const outY = e.y - 460 * e.s, side = (outY - y) * F.s < 0 ? toRef : (toRef === 'Connection3' ? 'Connection2' : 'Connection3');
          if (f === 'haut' && e.ligne === 'ext') {
            // 52 m de montee et 26 m d'ecart : plus long qu'un tuyau (56 m, FGCDPipeTooLong le 27/10/2026) ; relais a +15 m,
            // 3 m vers la ligne depuis la sortie (une colonne ne commence pas sous une jonction)
            const R = await build('haut relais ' + e.k, REC.junction, { x: e.x, y: outY + 300, z: 1500 }, 0, AIR);
            await link('haut colonne ' + e.k, REC.pipe, st.actors[extKey(e)], 'FGPipeConnectionFactory', R, 'Connection3');
            await link('haut colonne haute ' + e.k, REC.pipe, R, 'Connection2', J(e.x), side);
            continue;
          }
          await link(f + ' colonne ' + e.k, REC.pipe, st.actors[extKey(e)], 'FGPipeConnectionFactory', J(e.x), side);
        }
      }
    }
  },

  async pompes() {
    for (const e of EXT) {
      const col = st.links[e.floor + ' colonne ' + e.k];
      if (e.floor === 'bas') await pompe('bas pompe ' + e.k, REC.pump1, col, -1300, -600, -1000);
      else {
        await pompe('haut pompe Mk2 ' + e.k, REC.pump2, col, -1400, -1050, -1250);
        // la Mk1 : ligne exterieure, sur le tuyau du relais (+15 m) a la ligne ; interieure, sur le tuyau neuf au-dessus de la Mk2
        let up = st.links['haut colonne haute ' + e.k];
        if (e.ligne === 'int' && !st.actors['haut pompe Mk1 ' + e.k] && st.actors['haut pompe Mk2 ' + e.k]) {
          up = st.links['haut colonne ' + e.k + ' (au-dessus de la Mk2)'] || await upperPipe(st.actors['haut pompe Mk2 ' + e.k]);
          if (up) { st.links['haut colonne ' + e.k + ' (au-dessus de la Mk2)'] = up; save(); }
        }
        await pompe('haut pompe Mk1 ' + e.k, REC.pump1, up, 1500, 2500, 2000);
      }
    }
  },

  // Calcaire a +1 m cote entrees : repartiteurs devant les entrees (convoyeur de la raffinerie), une tete (fusionneur) par
  // segment, 14 m avant le premier repartiteur ; branche vers la raffinerie : cap 0 -> Output3 au nord / Output2 au sud,
  // cap 180 -> Output2 au nord / Output3 au sud
  async calcaire() {
    for (const [f, F] of Object.entries(FLOORS)) {
      const y = Y + SIDE * F.s, z = F.Z + ZB, refNorth = F.s > 0; // en bas la raffinerie est au nord de la ligne
      for (const seg of SEGMENTS[f]) {
        const dir = seg.cap === 0 ? 1 : -1, branch = (seg.cap === 0) === refNorth ? 'Output3' : 'Output2';
        const S = (k) => st.actors[f + ' calcaire ' + k];
        for (const k of seg.ks) await build(f + ' calcaire ' + k, REC.splitter, { x: X(k) + F.db, y, z }, seg.cap, AIR);
        const head = await build(f + ' calcaire tete ' + seg.id, REC.merger, { x: X(seg.ks[0]) + F.db - 1400 * dir, y, z }, seg.cap, AIR);
        await link(f + ' calcaire tete ' + seg.id + ' > ' + seg.ks[0], REC.belt, head, 'Output1', S(seg.ks[0]), 'Input1');
        for (let i = 1; i < seg.ks.length; i++) await link(f + ' calcaire ' + seg.ks[i - 1] + ' > ' + seg.ks[i], REC.belt, S(seg.ks[i - 1]), 'Output1', S(seg.ks[i]), 'Input1');
        for (const k of seg.ks) await link(f + ' calcaire > raffinerie ' + k, REC.belt, S(k), branch, ref(f, k), 'Input0');
      }
    }
  },

  // Beton a +1 m de l'autre cote, vers l'ouest : fusionneurs (cap 180) devant les sorties ; la raffinerie arrive par
  // Input3 (au sud) en bas, Input2 (au nord) en haut ; sortie libre au bout ouest (Output1 du fusionneur k0)
  async beton() {
    for (const [f, F] of Object.entries(FLOORS)) {
      const y = Y - SIDE * F.s, z = F.Z + ZB, M = (k) => st.actors[f + ' beton ' + k], fromRef = F.s > 0 ? 'Input3' : 'Input2';
      for (const k of K) await build(f + ' beton ' + k, REC.merger, { x: X(k) + F.db, y, z }, 180, AIR);
      for (const k of K) await link(f + ' raffinerie ' + k + ' > beton', REC.belt, ref(f, k), 'Output1', M(k), fromRef);
      for (let k = K.length - 1; k > 0; k--) await link(f + ' beton ' + k + ' > ' + (k - 1), REC.belt, M(k), 'Output1', M(k - 1), 'Input1');
    }
  },

  // Arrivees du calcaire jusqu'aux tetes, en l'air au-dessus de l'eau (tracer.js ne trace qu'au sol, jamais sur l'eau) ;
  // ascenseur entre deux connecteurs du meme cote, comme dans module-cuivre.js (fusionneur cap 0 / cap 180 superposes) :
  //  - 124 : foreuse -> pied (-14 m, sous la tete haut ouest, entree nord) -> ascenseur de 47 m -> tete haut ouest ;
  //  - 110 : ligne de tracer.js -> arrivee sur la rive ouest (-14 m) -> relais (-7 m) -> tete bas ouest (+1 m) ;
  //  - 54_833 : ligne de tracer.js -> repartiteur sur la rive est (-10 m) : sud -> tete bas est (240/min), ouest -> pied
  //    (-10 m, sous la tete haut est, entree sud) -> ascenseur de 43 m -> tete haut est (le reste, 960/min).
  async arrivees() {
    const T = (n) => st.actors[n];
    const P124 = await build('arrivee 124 pied', REC.merger, { x: X(0) - 200 - 1400, y: Y - SIDE, z: -1400 }, 180, AIR);
    await link('foreuse 124 > pied', REC.belt, MINER.g124, 'Output0', P124, 'Input2');
    await link('124 montee', REC.lift, P124, 'Output1', T('haut calcaire tete ouest'), 'Input1', { snapTolerance: 400 });
    const A110 = await build('arrivee 110', REC.merger, { x: -93600, y: Y + SIDE, z: -1400 }, 0, AIR);
    const R110 = await build('arrivee 110 relais', REC.merger, { x: -90200, y: Y + SIDE, z: -700 }, 0, AIR);
    await link('110 arrivee > relais', REC.belt, A110, 'Output1', R110, 'Input1');
    await link('110 relais > tete', REC.belt, R110, 'Output1', T('bas calcaire tete ouest'), 'Input1');
    const S54 = await build('arrivee 54', REC.splitter, { x: -67000, y: -149500, z: -1000 }, 180, AIR);
    const P54 = await build('arrivee 54 pied', REC.merger, { x: X(11) - 200 + 1400, y: Y - SIDE, z: -1000 }, 0, AIR);
    await link('54 > tete bas', REC.belt, S54, 'Output3', T('bas calcaire tete est'), 'Input1');
    await link('54 > pied haut', REC.belt, S54, 'Output1', P54, 'Input2');
    await link('54 montee', REC.lift, P54, 'Output1', T('haut calcaire tete est'), 'Input1', { snapTolerance: 400 });
  },

  // Poteaux Mk3 en l'air (10 cables au plus) : P au nord de la rangee (y axe - 24 m), un pour 6 raffineries, a chaque etage ;
  // Q entre les deux lignes d'extracteurs de chaque cote (sud y axe + 25 m pour le bas, nord y axe - 35 m pour le haut), un
  // pour deux extracteurs et leurs pompes. Arbre : reseau -> Qb2 ; Qb en chaine ; Qb1 -> Pb0 ; Pb0 -> Pb1, Ph0, Qh1 ;
  // Pb1 -> Ph1 ; Qh en chaine.
  async courant() {
    const P = { Pb0: { x: X(2) + 600, f: 'bas', ks: [0, 1, 2, 3, 4, 5] }, Pb1: { x: X(8) + 600, f: 'bas', ks: [6, 7, 8, 9, 10, 11] },
      Ph0: { x: X(2) + 600, f: 'haut', ks: [0, 1, 2, 3, 4, 5] }, Ph1: { x: X(8) + 600, f: 'haut', ks: [6, 7, 8, 9, 10, 11] } };
    for (const [n, p] of Object.entries(P)) await build('poteau ' + n, REC.pole, { x: p.x, y: Y - 2400, z: FLOORS[p.f].Z }, 0, AIR);
    const Q = {};
    for (const [f, yq] of [['bas', Y + 2500], ['haut', Y - 3500]]) {
      const exts = EXT.filter((e) => e.floor === f).sort((a, b) => a.x - b.x);
      for (let i = 0; i < 5; i++) {
        const pair = exts.slice(2 * i, 2 * i + 2), n = (f === 'bas' ? 'Qb' : 'Qh') + i;
        Q[n] = pair;
        await build('poteau ' + n, REC.pole, { x: Math.round((pair[0].x + pair[1].x) / 2), y: yq, z: 0 }, 0, AIR);
      }
    }
    const p = (n) => st.actors['poteau ' + n];
    const plan = [['Qb2', GRID], ['Qb0', p('Qb1')], ['Qb1', p('Qb2')], ['Qb2', p('Qb3')], ['Qb3', p('Qb4')], ['Qb1', p('Pb0')],
      ['Pb0', p('Pb1')], ['Pb0', p('Ph0')], ['Pb0', p('Qh1')], ['Pb1', p('Ph1')],
      ['Qh0', p('Qh1')], ['Qh1', p('Qh2')], ['Qh2', p('Qh3')], ['Qh3', p('Qh4')]];
    for (const [n, q] of Object.entries(P)) for (const k of q.ks) plan.push([n, ref(q.f, k)]);
    for (const [n, pair] of Object.entries(Q)) for (const e of pair) {
      plan.push([n, st.actors[extKey(e)]]);
      for (const pk of e.floor === 'bas' ? ['bas pompe ' + e.k] : ['haut pompe Mk2 ' + e.k, 'haut pompe Mk1 ' + e.k]) plan.push([n, st.actors[pk]]);
    }
    st.wires = st.wires || {};
    for (const [a, b] of plan) {
      const key = a + ' > ' + (b ? short(b) : '?');
      if (st.wires[key]) continue;
      if (!p(a) || !b) { if (!DRY) console.log(('cable ' + key).padEnd(44), 'saute (bout absent)'); continue; }
      const r = await call('wire', p(a), b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
  },

  async verifie() {
    for (const [key, a] of Object.entries(st.actors)) {
      const conns = await call('connections', a);
      const free = conns.filter((c) => !c.connected).map((c) => c.name);
      if (free.length) console.log(key.padEnd(44), 'libres :', free.join(' '));
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node usine-beton.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
