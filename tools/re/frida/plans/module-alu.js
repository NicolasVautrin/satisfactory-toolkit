// Module 1 du complexe aluminium (utilisateur, 25/10/2026 : « go pour la phase 1 » ; coin sud-ouest du complexe = gare
// N266 O40 <- S13 E101, extension vers l'ouest ; « surtout pense a stacker les convoyeurs et pipes »). Une rangee de
// 28 raffineries a l'etage 1 (base 0 m), sans fondations, au nord de la gare : 2 400 bauxite/min (quai 1) ->
// 2 880 alumine -> 4 800 ferraille d'aluminium (-> 2 400 lingots dans les piles de l'etage 2).
//  - 4 groupes de 7 raffineries, d'est en ouest : E A E E A E A (A = alumine baclee, 200 bauxite + 200 eau -> 240
//    alumine ; E = ferraille par electrode, 180 alumine + 60 coke -> 300 ferraille + 105 eau). Chaque groupe s'equilibre :
//    3 x 240 = 4 x 180 alumine ; dans cet ordre aucun troncon d'une ligne de fluide ne porte plus de 300 m3/min (un tuyau
//    Mk2 en porte 600 : une ligne commune de 2 880 etait impossible).
//  - A face au sud (cap 0 : entrees au sud, sortie d'alumine au nord) ; E face au nord (cap 180 : entrees au nord,
//    ferraille et eau au sud). Au nord : l'alumine passe de A a E. Au sud : l'eau rendue par E retourne a A.
//  - Lignes superposees 5 m devant les raffineries : au sud, bauxite (+1 m, repartiteurs devant les A), eau (+5 m,
//    jonctions), ferraille (+11 m, fusionneurs ; chaque E y monte par un ascenseur) ; au nord, coke (+1 m, repartiteurs
//    devant les E), alumine (+5 m, jonctions).
//  - Eau d'appoint (720 m3/min = 2 400 - 4 x 4 x 105) : 6 extracteurs a 100 % SOUS la rangee (regle de l'utilisateur),
//    sortie au sud, colonne qui monte jusqu'a une jonction de la ligne d'eau, pompe Mk1 dessus.
// Reperes : axes du monde, nord = -y. Raffinerie : connecteurs a +-9 m de son centre (cap 0 : entrees en +y), convoyeur a
// x+2 m, tuyau a x-2 m (releve sur une raffinerie du module des stators). Extracteur : sortie a 4,6 m du centre, +2,4 m.
//
// usage : node module-alu.js <phase> [--dry]
//   phases : raffineries | recettes | extracteurs | eau | pompes | alumine | coke | ferraille | bauxite | tampon | piles
//            [etapes pile.js] | montees | courant | verifie
// Etat : module-alu1-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
// Volume d'eau de la mer du nord (1 568 x 2 530 m, surface -17,3 m) : couvre le module (scratchpad volume-eau.js)
const WATER_VOLUME = PREFIX + 'FGWaterVolume_7';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  refinery: 'Recipe_OilRefinery_C', extractor: 'Recipe_WaterPump_C',
  A: 'Recipe_Alternate_SloppyAlumina_C', E: 'Recipe_Alternate_ElectroAluminumScrap_C',
  junction: 'Recipe_PipelineJunction_Cross_C', pipe: 'Recipe_PipelineMK2_C', pump1: 'Recipe_PipelinePump_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C',
};

// --- Geometrie ------------------------------------------------------------------------------------------
const Y_R = -273000;                         // axe de la rangee (raffineries de 22 m : y -284..-262 m autour)
const BASE = 0;                              // etage 1
const X = (k) => -37400 - 1200 * k;          // raffinerie k (0 = est), pas de 12 m ; x -37 400 .. -69 800
const K = [...Array(28).keys()];
const TYPE = (k) => 'EAEEAEA'[k % 7];
const YAW = { A: 0, E: 180 };
// extracteurs : entre deux raffineries (apres la raffinerie k), centre 3 m au sud de l'axe, sortie au sud
const EXTRACTORS = [2, 6, 11, 15, 20, 25].map((k) => ({ k, x: X(k) - 600, y: Y_R + 300 }));
// lignes de fluides, 5 m devant les connecteurs (a +-9 m), a +5 m : eau au sud, alumine au nord. Jonction au cap 0 :
// Connection0 ouest, 1 est, 2 sud, 3 nord ; lignes chainees d'est en ouest (0 -> 1)
const Y_S = Y_R + 1400, Y_N = Y_R - 1400, Z_FLUID = BASE + 500;
// jonctions d'une ligne, d'est en ouest : { key, x, to: [acteur, connecteur] | null (colonne d'extracteur), port }
function fluidLine(side) {
  const js = [];
  for (const k of K) {
    const t = TYPE(k), ref = 'raffinerie ' + k + ' ' + t;
    // au sud : entree d'eau des A (x-2), sortie d'eau des E (x+2) ; au nord : sortie d'alumine des A (x-2), entree des E (x+2)
    const port = side === 'eau' ? (t === 'A' ? 'PipeInputFactory' : 'PipeOutputFactory') : (t === 'A' ? 'PipeOutputFactory' : 'PipeInputFactory');
    js.push({ key: side + ' ' + k, k, x: X(k) + (t === 'A' ? -200 : 200), ref, port, branch: side === 'eau' ? 'Connection3' : 'Connection2' });
    const e = side === 'eau' && EXTRACTORS.find((q) => q.k === k);
    if (e) js.push({ key: side + ' extracteur ' + k, k, x: e.x, extractor: 'extracteur ' + k, branch: 'Connection3' });
  }
  return js.sort((a, b) => b.x - a.x);
}
// Reseaux separes (utilisateur, 25/10/2026 : « il faut que tu divises ton pipe principal », « y'a bcp plus que 600 m3 qui
// circule ») : en regime chaque troncon porte 300 m3/min au plus, mais un reseau unique laissait courir l'alumine
// (2 880) ou l'eau (2 400) d'un bout a l'autre de la rangee aux arrets et aux demarrages. Alumine : un reseau par groupe
// de 7 (720 produits = 720 consommes) ; eau : deux moities de 3 extracteurs (360 = l'appoint exact de 14 raffineries ; un
// surplus d'eau d'extracteur bloquerait la sortie d'eau des E)
const NETWORK = { alumine: (k) => Math.floor(k / 7), eau: (k) => Math.floor(k / 14) };
// Convoyeurs a +1 m (attaches a z +1 m : connecteurs a la hauteur des entrees / sorties des raffineries).
// Coke, au nord : un repartiteur devant l'entree de chaque E (x-2), cap 180 (Input1 a l'est, Output1 a l'ouest, Output3
// au sud vers la raffinerie) ; ligne vers l'ouest, alimentee par le bout est.
// Ferraille, au sud : un fusionneur devant la sortie de chaque E (x-2), cap 0 (Input1 a l'ouest, Output1 a l'est, Input3
// au nord depuis la raffinerie) ; un collecteur par groupe de 7 (4 E, 1 200/min = un convoyeur Mk6), vers l'est.
const Z_BELT = BASE + 100;
const E_OF = (c) => K.filter((k) => Math.floor(k / 7) === c && TYPE(k) === 'E'); // E du groupe c, d'est en ouest
// Bauxite, au sud a +11 m (au-dessus de l'eau a +5 m et de la ferraille a +1 m) : un repartiteur devant chaque A (x+2),
// cap 180, et un ascenseur direct de sa sortie nord (Output2) a l'entree de la raffinerie (accepte a blanc). Deux lignes
// de 1 200/min (un quai sort deux convoyeurs) : ligne 1 = groupes 0-1, alimentee par le bout est (relais H1) ; ligne 2 =
// groupes 2-3 : relais a +16 m au-dessus de la ligne 1 depuis le bout est (H2), puis ascenseur de R2 jusqu'a l'entree de
// son premier repartiteur. Arrivees depuis les deux sorties superposees du quai 1 (+4,5 et +8,5 m), superposees elles
// aussi, par les relais F1 (+8 m) et F2 (+13 m).
const Z_BAUX = BASE + 1100, Z_BAUX2 = BASE + 1600;
const BAUX = { 1: [1, 4, 6, 8, 11, 13], 2: [15, 18, 20, 22, 25, 27] };
const QUAI1 = PREFIX + 'Build_TrainDockingStation_C_2144346731'; // N266 O40 <- S13 E101, quai 1 (bauxite)
// Etage 2 (+64 m) : 80 fonderies (lingot d'aluminium pur), 2 piles de 10 au-dessus de chaque groupe (1 200 ferraille ->
// 600 lingots), posees par pile.js (plateforme en l'air, centre au-dessus du groupe, arrivee a +67 m au sud, flux vers
// l'ouest : tete a l'est). Montee de la ferraille de chaque groupe, 7 m au sud de la pile de lignes (y+21) a son bout
// est : collecteur -> U (+1 m, cap 0) -> ascenseur de 48 m -> V (+49 m, cap -90) -> ascenseur -> W (+67 m, cap 180) ->
// convoyeur vers l'ouest jusqu'a la tete d'arrivee des piles.
// Courant (~1,3 GW : 28 raffineries, 80 fonderies, 6 extracteurs, 6 pompes) : poteaux Mk3 en l'air. G relie le module au
// reseau principal (poteau Mk1 de la ligne sous la voie basse, -17 m) ; au nord de la rangee, par groupe, P (les 7
// raffineries, chaine P0-P1-P2-P3) et Q (extracteurs, pompes, piles de fonderies par le poteau du pied, via pile.js).
const GRID_POLE = PREFIX + 'Build_PowerPoleMk1_C_2144794265'; // (-40 002 ; -262 795 ; -17 m), circuit principal
// deplace de (-44 000 ; -269 400) le 25/10/2026 : il genait le tronc de minerai du bloc cuivre (module-cuivre.js)
const POLE_G = { x: -44700, y: -269400, z: BASE };
const POLE_P = (c) => ({ x: X(7 * c + 3), y: Y_R - 2400, z: BASE });
const POLE_Q = (c) => ({ x: X(7 * c + 3) - 800, y: Y_R - 2400, z: BASE });
const TOP = BASE + 6400;
const Y_RISE = Y_R + 2100;
const RISE = (c) => ({ x: X(7 * c) + 600, U: 100, V: 4900, W: 6700 });
const RELAIS_B = {
  F1: { at: [-38000, -269000, 800], yaw: 0 }, F2: { at: [-38000, -269000, 1300], yaw: 0 },
  H1: { at: [-35600, Y_S, Z_BAUX], yaw: 180 }, H2: { at: [-35600, Y_S, Z_BAUX2], yaw: 180 },
  B2a: { at: [-40300, Y_S, Z_BAUX2], yaw: 180 }, B2b: { at: [-45000, Y_S, Z_BAUX2], yaw: 180 },
  B2c: { at: [-49700, Y_S, Z_BAUX2], yaw: 180 }, R2: { at: [-54100, Y_S, Z_BAUX2], yaw: 180 },
};

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'module-alu1-state.json');
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

// Points d'un tuyau (spline relue dans le jeu), en coordonnees monde
async function pipePoints(pipe) {
  const pose = await call('pose', pipe);
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData;
  const yaw = pose.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = pose.location;
  return pts.map((p) => ({ x: o.x + p.Location.X * c - p.Location.Y * s, y: o.y + p.Location.X * s + p.Location.Y * c, z: o.z + p.Location.Z }));
}

const PHASES = {
  async raffineries() {
    for (const k of K) await build('raffinerie ' + k + ' ' + TYPE(k), REC.refinery, { x: X(k), y: Y_R, z: BASE }, YAW[TYPE(k)], AIR);
  },

  async recettes() {
    for (const k of K) {
      const a = st.actors['raffinerie ' + k + ' ' + TYPE(k)];
      if (!a) { console.log(('raffinerie ' + k).padEnd(34), 'absente'); continue; }
      if (DRY) { console.log(('raffinerie ' + k + ' ' + TYPE(k)).padEnd(34), REC[TYPE(k)]); continue; }
      const r = await call('setRecipe', a, REC[TYPE(k)]);
      console.log(('raffinerie ' + k + ' ' + TYPE(k)).padEnd(34), r.recipe);
    }
  },

  // extracteurs poses par un point touche fabrique sur le volume d'eau (loin du joueur), molette 180 = sortie au sud
  async extracteurs() {
    for (const e of EXTRACTORS) {
      const key = 'extracteur ' + e.k;
      if (st.actors[key]) continue;
      const r = await call('buildAim', REC.extractor, { x: e.x, y: e.y, z: 1000 }, { x: e.x, y: e.y, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: 180 });
      report(key, r);
      if (r.hologram) console.log('   hologramme', JSON.stringify(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // Lignes de fluides : jonctions, chainage d'est en ouest, branches vers les raffineries ; eau : colonnes des extracteurs
  async eau() { await PHASES.fluide('eau'); },
  async alumine() { await PHASES.fluide('alumine'); },
  async fluide(side) {
    const js = fluidLine(side), y = side === 'eau' ? Y_S : Y_N;
    for (const j of js) await build('jonction ' + j.key, REC.junction, { x: j.x, y, z: Z_FLUID }, 0, AIR);
    const J = (j) => st.actors['jonction ' + j.key];
    for (let i = 1; i < js.length; i++) {
      if (NETWORK[side](js[i - 1].k) !== NETWORK[side](js[i].k)) continue; // coupure entre deux reseaux
      await link(side + ' ' + js[i - 1].key + ' > ' + js[i].key, REC.pipe, J(js[i - 1]), 'Connection0', J(js[i]), 'Connection1');
    }
    for (const j of js) {
      if (j.extractor) await link('colonne ' + j.extractor, REC.pipe, st.actors[j.extractor], 'FGPipeConnectionFactory', J(j), j.branch);
      else await link(side + ' > ' + j.ref, REC.pipe, J(j), j.branch, st.actors[j.ref], j.port);
    }
  },

  // Pompes Mk1 en bas des colonnes : l'extracteur ne pousse l'eau qu'a 10 m au-dessus de sa sortie (-14,9 m). La colonne
  // file 2 m a plat puis monte presque a la verticale : a plat et dans le coude, le jeu refuse la pompe (TooSharpTurn,
  // empietement sur l'extracteur) ; premier point accepte a blanc entre -13 et -6 m, sur la partie verticale
  async pompes() {
    for (const e of EXTRACTORS) {
      const key = 'pompe ' + e.k, pipe = st.links['colonne extracteur ' + e.k];
      if (st.actors[key]) continue;
      if (!pipe) { console.log(key.padEnd(34), 'saute (colonne absente)'); continue; }
      const w = await pipePoints(pipe), cand = [];
      for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
      let r = null;
      for (const p of cand.filter((q) => q.z >= -1300 && q.z <= -600)) {
        const aim = [{ x: p.x, y: p.y + 300, z: p.z + 300 }, p];
        const t = await call('buildAim', REC.pump1, aim[0], aim[1], { dryRun: true, onActor: pipe });
        if (t.blocking && t.blocking.length) continue;
        r = DRY ? t : await call('buildAim', REC.pump1, aim[0], aim[1], { onActor: pipe });
        console.log(key.padEnd(34), 'a', (p.z / 100).toFixed(1), 'm');
        break;
      }
      if (!r) throw new Error(key + ' : aucun point accepte entre -13 et -6 m');
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  async coke() {
    const es = K.filter((k) => TYPE(k) === 'E');
    for (const k of es) await build('coke ' + k, REC.splitter, { x: X(k) - 200, y: Y_N, z: Z_BELT }, 180, AIR);
    const S = (k) => st.actors['coke ' + k];
    for (let i = 1; i < es.length; i++) await link('coke ' + es[i - 1] + ' > ' + es[i], REC.belt, S(es[i - 1]), 'Output1', S(es[i]), 'Input1');
    for (const k of es) await link('coke > raffinerie ' + k, REC.belt, S(k), 'Output3', st.actors['raffinerie ' + k + ' E'], 'Input0');
  },

  async ferraille() {
    for (const c of [0, 1, 2, 3]) {
      const es = E_OF(c);
      for (const k of es) await build('ferraille ' + k, REC.merger, { x: X(k) - 200, y: Y_S, z: Z_BELT }, 0, AIR);
      const M = (k) => st.actors['ferraille ' + k];
      for (const k of es) await link('raffinerie ' + k + ' > ferraille', REC.belt, st.actors['raffinerie ' + k + ' E'], 'Output1', M(k), 'Input3');
      // d'ouest en est : es est d'est en ouest
      for (let i = es.length - 1; i > 0; i--) await link('ferraille ' + es[i] + ' > ' + es[i - 1], REC.belt, M(es[i]), 'Output1', M(es[i - 1]), 'Input1');
    }
  },

  async bauxite() {
    const S = (k) => st.actors['bauxite ' + k], A = (k) => st.actors['raffinerie ' + k + ' A'];
    for (const [ln, ks] of Object.entries(BAUX)) {
      for (const k of ks) await build('bauxite ' + k, REC.splitter, { x: X(k) + 200, y: Y_S, z: Z_BAUX }, 180, AIR);
      for (let i = 1; i < ks.length; i++) await link('bauxite ' + ln + ' ' + ks[i - 1] + ' > ' + ks[i], REC.belt, S(ks[i - 1]), 'Output1', S(ks[i]), 'Input1');
      for (const k of ks) await link('bauxite > raffinerie ' + k, REC.lift, S(k), 'Output2', A(k), 'Input0', { snapTolerance: 400 });
    }
    for (const [n, r] of Object.entries(RELAIS_B)) await build('relais ' + n, REC.merger, { x: r.at[0], y: r.at[1], z: r.at[2] }, r.yaw, AIR);
    const R = (n) => st.actors['relais ' + n];
    // quai 1 -> F1 / F2 : par le tampon (phase tampon)
    await link('F1 > H1', REC.belt, R('F1'), 'Output1', R('H1'), 'Input3');
    await link('F2 > H2', REC.belt, R('F2'), 'Output1', R('H2'), 'Input3');
    await link('H1 > ligne 1', REC.belt, R('H1'), 'Output1', S(1), 'Input1');
    const chain = ['H2', 'B2a', 'B2b', 'B2c', 'R2'];
    for (let i = 1; i < chain.length; i++) await link(chain[i - 1] + ' > ' + chain[i], REC.belt, R(chain[i - 1]), 'Output1', R(chain[i]), 'Input1');
    await link('R2 > ligne 2', REC.lift, R('R2'), 'Output1', S(15), 'Input1', { snapTolerance: 400 });
  },

  // Tampon en sortie du quai 1 (utilisateur, 25/10/2026 : « il faut des tampons en sortie de quai » ; le quai bloque ses
  // entrees et sorties pendant les 27 s du dechargement) : conteneur en l'air au cap 180, entrees Input0 / Input1 a 3 m
  // des sorties superposees du quai (+4,5 et +8,5 m), sorties au nord vers les relais F1 / F2 des lignes de bauxite
  async tampon() {
    const t = await build('tampon quai 1', 'Recipe_StorageContainerMk2_C', { x: -42329, y: -268061, z: 349 }, 180, AIR);
    const R = (n) => st.actors['relais ' + n];
    await link('quai 1 > tampon (bas)', REC.belt, QUAI1, 'Output0', t, 'Input0');
    await link('quai 1 > tampon (haut)', REC.belt, QUAI1, 'Output1', t, 'Input1');
    await link('tampon > F1', REC.belt, t, 'Output1', R('F1'), 'Input1');
    await link('tampon > F2', REC.belt, t, 'Output2', R('F2'), 'Input1');
  },

  // Piles de fonderies de chaque groupe (pile.js ; configuration ecrite ici, etat <nom>-pile-state.json)
  async piles() {
    const { execFileSync } = require('child_process');
    const steps = (process.argv[3] || 'machines,raccords,branches,ascenseurs,arrivees,collecteur,recettes').split(',');
    for (const c of [0, 1, 2, 3]) {
      const nom = 'module-alu1-G' + c, file = path.join(__dirname, nom + '-config-state.json');
      const cfg = {
        nom, recette: 'Recipe_PureAluminumIngot_C',
        plateforme: { origine: { x: X(7 * c + 3), y: Y_R }, cap: 0, dessus: TOP },
        dos: 'y', centre: [0, 0], piles: 2, etages: 10, pas: 16, espacement: 10,
        arrivees: [{ entree: 'Input0', hauteur: 3, sens: '+lx' }], collecteur: { sens: '-lx' }, enLAir: true,
        reseau: st.actors['poteau Q' + c] || undefined, // poteau du groupe (phase courant du module, avant « piles courant »)
        // deux poteaux par pile (5 etages chacun), devant le collecteur : 10 fonderies + chaine + reseau depassaient les
        // 10 connexions d'un Mk3 ; cables de 92 m au plus jusqu'a l'etage du haut
        poteaux: [[-8, 17], [8, 17], [-8, 21], [8, 21]],
      };
      fs.writeFileSync(file, JSON.stringify(cfg, null, 1));
      for (const s of steps) {
        const out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
        const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
        console.log(('piles G' + c + ' ' + s).padEnd(34), bad.length ? bad.slice(0, 3).join(' / ') : 'ok');
      }
    }
  },

  async montees() {
    for (const c of [0, 1, 2, 3]) {
      const r = RISE(c), es = E_OF(c);
      const U = await build('montee ' + c + ' U', REC.merger, { x: r.x, y: Y_RISE, z: r.U }, 0, AIR);
      const V = await build('montee ' + c + ' V', REC.merger, { x: r.x, y: Y_RISE, z: r.V }, -90, AIR);
      const W = await build('montee ' + c + ' W', REC.merger, { x: r.x, y: Y_RISE, z: r.W }, 180, AIR);
      await link('ferraille ' + c + ' > U', REC.belt, st.actors['ferraille ' + es[0]], 'Output1', U, 'Input1');
      await link('montee ' + c + ' U > V', REC.lift, U, 'Output1', V, 'Input2', { snapTolerance: 400 });
      await link('montee ' + c + ' V > W', REC.lift, V, 'Output1', W, 'Input2', { snapTolerance: 400 });
      if (DRY) continue;
      const ps = JSON.parse(fs.readFileSync(path.join(__dirname, 'module-alu1-G' + c + '-pile-state.json'), 'utf8'));
      const head = Object.entries(ps.parts).filter(([k]) => /^arrivee 0 pile/.test(k)).map(([, v]) => v);
      // tete : le repartiteur d'arrivee le plus a l'est (flux vers l'ouest)
      let best = null;
      for (const h of head) { const p = (await call('pose', h)).location; if (!best || p.x > best.x) best = { h, x: p.x }; }
      await link('montee ' + c + ' W > piles', REC.belt, W, 'Output1', best.h, 'Input1');
    }
  },

  async courant() {
    const pole = 'Recipe_PowerPoleMk3_C';
    const G = await build('poteau G', pole, POLE_G, 0, AIR);
    for (const c of [0, 1, 2, 3]) { await build('poteau P' + c, pole, POLE_P(c), 0, AIR); await build('poteau Q' + c, pole, POLE_Q(c), 0, AIR); }
    const p = (n) => st.actors['poteau ' + n];
    const plan = [['G', GRID_POLE], ['G', p('P0')], ['P0', p('P1')], ['P1', p('P2')], ['P2', p('P3')]];
    for (const c of [0, 1, 2, 3]) {
      plan.push(['P' + c, p('Q' + c)]);
      for (let k = 7 * c; k < 7 * c + 7; k++) plan.push(['P' + c, st.actors['raffinerie ' + k + ' ' + TYPE(k)]]);
      for (const e of EXTRACTORS.filter((q) => Math.floor(q.k / 7) === c)) { plan.push(['Q' + c, st.actors['extracteur ' + e.k]]); plan.push(['Q' + c, st.actors['pompe ' + e.k]]); }
    }
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
      const p = await call('pose', a);
      const conns = await call('connections', a);
      console.log(key.padEnd(30), Math.round(p.location.x), Math.round(p.location.y), Math.round(p.location.z), 'cap', Math.round(p.rotation.yaw),
        conns.map((c) => c.name + (c.connected ? '*' : '')).join(' '));
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node module-alu.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
