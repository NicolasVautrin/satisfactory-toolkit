// Gares du module 1 de carburant pour fusees (utilisateur, 26/10/2026 : « on va faire une gare de chargement cote sud de
// cette gare » [N211 O96], « il faudra 2 quai fluid 1 azote 1 acide nitrique », « oui charbon en q3, go pour les deux
// gares », « tu trouve une place pour la gare de dechargement devant le complexe rocket fuel sur la voie basse ») :
// couple N204 O100 -> N266 E53, quais q1 azote, q2 acide nitrique, q3 charbon, q4 vide (layouts/hub-gare.js,
// anneau-gare-sud.js, anneau-gare-nord.js, anneau-entree-nord.js).
// Cote dechargement (N266 E53, quais au nord a y -267 361) : tampons devant les quais (reservoir industriel de fluide,
// connexion sud face a la sortie du quai ; conteneur comme les tampons du bloc EM : x du quai - 3 m, 23 m au nord de l'axe,
// cap 180), puis lignes vers les tetes du module 1 (carburant-fusee-m1-state.json) par l'espace entre les emplacements 1
// et 2 (x 52 000 .. 52 500), a des hauteurs distinctes :
//  - acide nitrique a +13 m : au nord, a l'est jusqu'a x 52 150, au nord jusqu'a la tete ouest de la ligne d'acide des K
//    ('nitrique K 53400', Connection0) ;
//  - azote a +9 m : x 52 450 jusqu'a y -288 800, puis a l'est entre B2 et B3 a -4 m jusqu'a x 74 400 et au nord jusqu'a
//    la tete est des N ('azote N 74400', Connection2 : au nord de la tete, x 74 400 est pris par la colonne de carburant) ;
//  - charbon a +4,5 m (convoyeur, relais en fusionneurs) : x 52 700 jusqu'a y -296 000, a l'est jusqu'a x 75 200, au sud
//    en descendant a +13 m au-dessus de -17 m, jusqu'au repartiteur 'charbon N 0' (Input1, a l'est).
// Cote chargement (N204 O100) : tampons (tamponsCharge) ; acide nitrique depuis le quai q1 de N211 O96 (nitriqueN211).
// Azote du puits « N for nuke & rocket fuel » vers N204 O100 : azoteCharge ; charbon de la balise « coal for rocket
// fuel » : charbonCharge. Petrole de la balise « petrole for rocket fuel » : puitsPetrole [cap], petrole.
// usage : node gares-carburant.js <tampons|nitrique|azote|charbon|tamponsCharge|nitriqueN211|azoteCharge|charbonCharge|
//   azoteCourant|soufreDemonte|soufre|puitsPetrole|petrole|verifie> [--dry]
// Etat : gares-carburant-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  pipe: 'Recipe_PipelineMK2_C', junction: 'Recipe_PipelineJunction_Cross_C', tank: 'Recipe_IndustrialTank_C',
  container: 'Recipe_StorageContainerMk2_C', merger: 'Recipe_ConveyorAttachmentMerger_C', splitter: 'Recipe_ConveyorAttachmentSplitter_C', lift: 'Recipe_ConveyorLiftMk6_C', belt: 'Recipe_ConveyorBeltMk6_C',
};
const DECH = require('./anneau-vbd-est1-state.json').platforms;   // q1 azote, q2 acide, q3 charbon, q4 vide
const MOD = require('./carburant-fusee-m1-state.json').actors;
const CHARGE = require('./anneau-vb-sud1-state.json').platforms;    // N204 O100 : q1 azote, q2 acide, q3 charbon, q4 vide
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const Q96 = PREFIX + 'Build_TrainDockingStationLiquid_C_2146114221';  // N211 O96 q1, acide nitrique (dechargement)
const POTEAU_EM = PREFIX + 'Build_PowerPoleMk3_C_2147020032';       // circuit principal, (-96 200 ; -221 400 ; +32 m)
const NODE_PETROLE = PREFIX + 'BP_ResourceNode26_99';                // balise « petrole for rocket fuel », pur
const ZQ = 349;
const TANK = { azote: { x: 51491, y: -268461 }, nitrique: { x: 49891, y: -268461 } };
const CONTENEUR = { x: 48291, y: -268061, z: ZQ };

const FILE = path.join(__dirname, 'gares-carburant-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links']) st[k] = st[k] || {};
// reservoir d'azote pose a la main lors du releve de ses connecteurs (26/10/2026)
if (!st.actors['tampon azote']) st.actors['tampon azote'] = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.Build_IndustrialTank_C_2146616982';
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
const A = (k) => st.actors[k];

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '') + (r.snapped ? ' accroches=' + JSON.stringify(r.snapped) : '');
  console.log(key.padEnd(36), what + extra);
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(36), 'saute (bout absent)'); return null; }
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
// Pompe sur la partie inclinee ou verticale du tuyau st.links[linkKey] (comme carburant-fusee.js). La pompe coupe le
// tuyau en deux tuyaux neufs (l'ancien disparait) : l'etat garde ces deux-la, '<linkKey> (amont)' et '(aval)'.
async function pompe(key, recipe, linkKey, zmin, zmax) {
  if (st.actors[key]) return;
  const pipe = st.links[linkKey];
  if (!pipe) { console.log(key.padEnd(36), 'saute (tuyau absent)'); return; }
  const w = await pipePoints(pipe), cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  let r = null;
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax)) {
    const t = await call('buildAim', recipe, { x: p.x, y: p.y + 300, z: p.z + 300 }, p, { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    r = DRY ? t : await call('buildAim', recipe, { x: p.x, y: p.y + 300, z: p.z + 300 }, p, { onActor: pipe });
    console.log(key.padEnd(36), 'a', (p.z / 100).toFixed(1), 'm');
    break;
  }
  if (!r) throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
  report(key, r);
  if (!r.built) return;
  st.actors[key] = r.actor;
  for (const [c, side] of [['Connection0', 'amont'], ['Connection1', 'aval']]) {
    const d = await call('dump', r.actor + '.' + c, 1, 1, ['mConnectedComponent']);
    if (d.mConnectedComponent) st.links[linkKey + ' (' + side + ')'] = d.mConnectedComponent.split('.').slice(0, -1).join('.');
  }
  delete st.links[linkKey];
  save();
}
// chaine de points : [cle, {x,y,z}, connecteur d'entree, connecteur de sortie, cap (fusionneurs)]
async function chaine(prefix, recipe, linkRecipe, pts) {
  for (const [k, at, , , yaw] of pts) await build(prefix + ' ' + k, recipe, at, yaw || 0);
  for (let i = 1; i < pts.length; i++) await link(prefix + ' ' + pts[i - 1][0] + ' > ' + pts[i][0], linkRecipe, A(prefix + ' ' + pts[i - 1][0]), pts[i - 1][3], A(prefix + ' ' + pts[i][0]), pts[i][2]);
}

const PHASES = {
  async tampons() {
    await build('tampon nitrique', REC.tank, { x: TANK.nitrique.x, y: TANK.nitrique.y, z: ZQ }, 0);
    await link('q1 > tampon azote', REC.pipe, DECH[0], 'PipeFactoryOutput0', A('tampon azote'), 'ConnectionAny0');
    await link('q2 > tampon nitrique', REC.pipe, DECH[1], 'PipeFactoryOutput0', A('tampon nitrique'), 'ConnectionAny0');
    const C = await build('tampon charbon', REC.container, CONTENEUR, 180);
    await link('q3 > tampon (bas)', REC.belt, DECH[2], 'Output0', C, 'Input0');
    await link('q3 > tampon (haut)', REC.belt, DECH[2], 'Output1', C, 'Input1');
  },
  // jonctions : Connection0 ouest, 1 est, 2 sud, 3 nord
  async nitrique() {
    const z = 1300; // au-dessus du convoyeur de charbon (+4,5 m) qui croise la ligne a y -272 400
    const pts = [['0', { x: 49891, y: -271400, z }, 'Connection2', 'Connection1'], ['1', { x: 52150, y: -271400, z }, 'Connection0', 'Connection3']];
    for (const [i, y] of [-276000, -280600, -285200, -289400].entries()) pts.push(['n' + i, { x: 52150, y, z }, 'Connection2', 'Connection3']);
    await chaine('nitrique', REC.junction, REC.pipe, pts);
    await link('tampon nitrique > ligne', REC.pipe, A('tampon nitrique'), 'ConnectionAny1', A('nitrique 0'), 'Connection2');
    await link('ligne nitrique > tete K', REC.pipe, A('nitrique n3'), 'Connection3', MOD['nitrique K 53400'], 'Connection0');
  },
  async azote() {
    const z = 900;
    const pts = [['0', { x: 51491, y: -270400, z }, 'Connection2', 'Connection1'], ['1', { x: 52450, y: -270400, z }, 'Connection0', 'Connection3']];
    for (const [i, y] of [-275400, -280400, -285400].entries()) pts.push(['n' + i, { x: 52450, y, z }, 'Connection2', 'Connection3']);
    // a l'est dans le couloir entre B2 et B3, a +13 m au-dessus de -17 m (au-dessus du tuyau du turbo du couloir ouest,
    // a 4 m au nord des poteaux L3) ; la colonne de carburant pour fusees est occupe x 74 400 au nord de la tete
    pts.push(['coin', { x: 52450, y: -288800, z }, 'Connection2', 'Connection1']);
    for (const [i, x] of [57000, 62000, 67000, 72000].entries()) pts.push(['e' + i, { x, y: -288800, z: -400 }, 'Connection0', 'Connection1']);
    pts.push(['fin', { x: 74400, y: -288800, z: -400 }, 'Connection0', 'Connection3']);
    await chaine('azote', REC.junction, REC.pipe, pts);
    await link('tampon azote > ligne', REC.pipe, A('tampon azote'), 'ConnectionAny1', A('azote 0'), 'Connection2');
    await link('ligne azote > tete N', REC.pipe, A('azote fin'), 'Connection3', MOD['azote N 74400'], 'Connection2');
  },
  // fusionneurs relais : cap 0 -> Input2 sud, Input3 nord ; cap -90 (vers le nord) -> Input2 est, Input3 ouest ;
  // cap 90 (vers le sud) -> Input2 ouest, Input3 est ; cap 180 (vers l'ouest) -> Input2 nord, Input3 sud
  async charbon() {
    const z = 449;
    const pts = [['0', { x: 48291, y: -270000, z }, null, 'Output1', -90], ['1', { x: 48291, y: -272400, z }, 'Input1', 'Output1', 0]];
    pts[1][2] = 'Input2'; // arrive du sud, part a l'est
    pts.push(['2', { x: 52700, y: -272400, z }, 'Input3', 'Output1', -90]);
    for (const [i, y] of [-277400, -282400, -287400, -292400].entries()) pts.push(['n' + i, { x: 52700, y, z }, 'Input1', 'Output1', -90]);
    pts.push(['coin no', { x: 52700, y: -296000, z }, 'Input2', 'Output1', 0]);
    for (const [i, x] of [57500, 62500, 67500, 72500].entries()) pts.push(['e' + i, { x, y: -296000, z }, 'Input1', 'Output1', 0]);
    pts.push(['coin ne', { x: 75200, y: -296000, z }, 'Input2', 'Output1', 90]);
    pts.push(['arrivee', { x: 75200, y: -291800, z: -400 }, 'Input2', 'Output1', 180]);
    await chaine('charbon', REC.merger, REC.belt, pts);
    await link('tampon charbon > ligne', REC.belt, A('tampon charbon'), 'Output1', A('charbon 0'), 'Input1');
    await link('ligne charbon > repartiteur N', REC.belt, A('charbon arrivee'), 'Output1', MOD['charbon N 0'], 'Input1');
  },
  // --- Cote chargement (N204 O100, quais au sud a y -202 020) : tampons (ligne -> tampon -> quai), image de N266 E53 ---
  async tamponsCharge() {
    const T = await build('chargement tampon azote', REC.tank, { x: -98519, y: -200920, z: ZQ }, 0);
    await link('tampon azote > q1 chargement', REC.pipe, T, 'ConnectionAny1', CHARGE[0], 'PipeFactoryInput0');
    const N = await build('chargement tampon nitrique', REC.tank, { x: -96919, y: -200920, z: ZQ }, 0);
    await link('tampon nitrique > q2 chargement', REC.pipe, N, 'ConnectionAny1', CHARGE[1], 'PipeFactoryInput0');
    const C = await build('chargement tampon charbon', REC.container, { x: -95319, y: -201320, z: ZQ }, 180);
    await link('tampon charbon > q3 chargement (bas)', REC.belt, C, 'Output1', CHARGE[2], 'Input0'); // conteneur : sorties Output1 / Output2
    await link('tampon charbon > q3 chargement (haut)', REC.belt, C, 'Output2', CHARGE[2], 'Input1');
  },
  // Acide nitrique de N211 O96 (quai q1, dechargement, sortie au nord) : tampon, montee a +16 m (pompe Mk1, poteau Mk3
  // du bloc EM), a l'est le long de y -215 800 (le bloc EM commence a y -217 600), au sud le long de x -91 000 au-dessus
  // de la voie de sortie, des coins ouest de l'anneau 1 et de la voie basse, puis a l'ouest au sud de N204 O100 jusqu'a
  // son tampon d'acide (connexion sud)
  async nitriqueN211() {
    const T = await build('N211 O96 tampon nitrique', REC.tank, { x: -97824, y: -214170, z: ZQ }, 0);
    await link('N211 O96 q1 > tampon', REC.pipe, Q96, 'PipeFactoryOutput0', T, 'ConnectionAny0');
    const pts = [
      ['L0', { x: -97824, y: -215800, z: 1600 }, 'Connection2', 'Connection1'],
      ['La', { x: -94400, y: -215800, z: 1600 }, 'Connection0', 'Connection1'],
      ['Lb', { x: -91000, y: -215800, z: 1600 }, 'Connection0', 'Connection2'],
      ['Lc', { x: -91000, y: -211000, z: 1600 }, 'Connection3', 'Connection2'],
      ['Ld', { x: -91000, y: -206200, z: 1600 }, 'Connection3', 'Connection2'],
      ['Le', { x: -91000, y: -201400, z: 1600 }, 'Connection3', 'Connection2'],
      ['Lf', { x: -91000, y: -199000, z: 1000 }, 'Connection3', 'Connection0'],
      ['Lg', { x: -94000, y: -199000, z: 800 }, 'Connection1', 'Connection0'],
      ['Lh', { x: -96919, y: -199000, z: 600 }, 'Connection1', 'Connection3'],
    ];
    await chaine('acide N211', REC.junction, REC.pipe, pts);
    await link('tampon N211 > montee', REC.pipe, T, 'ConnectionAny1', A('acide N211 L0'), 'Connection2');
    await link('acide N211 > tampon chargement', REC.pipe, A('acide N211 Lh'), 'Connection3', A('chargement tampon nitrique'), 'ConnectionAny0');
    await pompe('pompe acide N211', 'Recipe_PipelinePump_C', 'tampon N211 > montee', 700, 1500);
    if (A('pompe acide N211') && !st.links['cable pompe acide N211']) {
      const r = await call('wire', POTEAU_EM, A('pompe acide N211'), { dryRun: DRY });
      report('cable pompe acide N211', r);
      if (r.built) { st.links['cable pompe acide N211'] = r.actor || true; save(); }
    }
  },

  // Reprise du 26/10/2026 : demonte le premier trace du soufre, au nord des modules fer (du coude 'k1' de x 152 000 a
  // l'arrivee 'haut' a +25 m et son ascenseur), avant que la phase soufre pose le trace sud. Ne fait rien si ce trace
  // n'est plus la (son coude 'k1' n'existe pas dans le nouveau).
  async soufreDemonte() {
    if (!st.actors['soufre k1']) { console.log('premier trace du soufre deja demonte'); return; }
    const old = (k) => /^soufre (k[1-5]|n-\d+|w\d+|m-\d+|v\d+|s-\d+|haut)$/.test(k);
    const links = Object.keys(st.links).filter((k) => { const m = /^soufre (\S+) > (\S+)$/.exec(k); return m && (old('soufre ' + m[1]) || old('soufre ' + m[2])); });
    const actors = Object.keys(st.actors).filter(old);
    console.log('a demonter :', links.length, 'convoyeurs et ascenseurs,', actors.length, 'fusionneurs');
    if (DRY) return;
    for (const [table, keys] of [[st.links, links], [st.actors, actors]]) {
      for (const k of keys) {
        const r = await call('dismantle', table[k], true);
        console.log(k.padEnd(36), JSON.stringify(r).slice(0, 120));
        delete table[k]; save();
      }
    }
  },

  // Azote du puits « N for nuke & rocket fuel » vers le tampon q1 de N204 O100 (utilisateur, 26/10/2026 : « oui » au
  // couloir le long de la cote sud). L'utilisateur a pose le depart : jonction 2146475626 des extracteurs libres
  // 2147355280 et 2147355600, tuyau jusqu'a un bout libre a -12,6 m (2146448438, PipelineConnection1). Suite a -12 m : a
  // l'est jusqu'a x -233 500, au nord jusqu'a y -202 300 (13 m au sud des rails des anneaux ; poteau Mk2 a x -232 320),
  // a l'est le long de la cote jusqu'a x -102 500 (falaises au sud jusqu'a y -199 500 / -200 500), au sud sous la sortie
  // de N204 O100 jusqu'a y -199 000, puis montee avec pompe Mk2 jusqu'au reservoir q1 (ConnectionAny0, au sud).
  // Depart refait le 28/10/2026 (le depart de l'utilisateur a disparu avec l'ancien site nucleaire ; utilisateur :
  // « reformer le pipe qui allait a l'est ») : jonction d0 a l'est des extracteurs 2147355280 (au sud, par Connection2)
  // et 2147355600 (au nord, par Connection3), a l'est le long de y -186 450 (jonctions tous les 45 m), au nord le long
  // de XO jusqu'a a0, puis le trace d'origine. Releve du relief : la mer de -17 a -29 m sous tout le trace.
  async azoteCharge() {
    const z = -1200, XO = -233500, XE = -102500, YC = -202300, YD = -186450;
    const pts = [['d0', { x: -247000, y: YD, z }, 'Connection2', 'Connection1']];
    for (const x of [-242500, -238000]) pts.push(['d' + x, { x, y: YD, z }, 'Connection0', 'Connection1']);
    pts.push(['d1', { x: XO, y: YD, z }, 'Connection0', 'Connection3']);
    pts.push(['a0', { x: XO, y: -191455, z }, 'Connection2', 'Connection3']);
    // la pompe a coupe le tuyau a3 > fin en deux (amont, aval) : il est pose
    if (!st.links['azote charge a3 > fin'] && st.links['azote charge a3 > fin (amont)']) st.links['azote charge a3 > fin'] = st.links['azote charge a3 > fin (amont)'];
    for (const y of [-195070, -198685]) pts.push(['n' + y, { x: XO, y, z }, 'Connection2', 'Connection3']);
    pts.push(['a1', { x: XO, y: YC, z }, 'Connection2', 'Connection1']);
    const N = 28;
    for (let k = 1; k < N; k++) { const x = Math.round(XO + (XE - XO) * k / N); pts.push(['e' + x, { x, y: YC, z }, 'Connection0', 'Connection1']); }
    pts.push(['a2', { x: XE, y: YC, z }, 'Connection0', 'Connection2']);
    pts.push(['a3', { x: XE, y: -199000, z }, 'Connection3', 'Connection1']);
    pts.push(['fin', { x: -98519, y: -199000, z: 524 }, 'Connection0', 'Connection3']);
    await chaine('azote charge', REC.junction, REC.pipe, pts);
    await link('extracteur 2147355280 > azote charge', REC.pipe, PREFIX + 'Build_FrackingExtractor_C_2147355280', 'FGPipeConnectionFactory', A('azote charge d0'), 'Connection2');
    await link('extracteur 2147355600 > azote charge', REC.pipe, PREFIX + 'Build_FrackingExtractor_C_2147355600', 'FGPipeConnectionFactory', A('azote charge d0'), 'Connection3');
    await link('azote charge > tampon q1', REC.pipe, A('azote charge fin'), 'Connection3', A('chargement tampon azote'), 'ConnectionAny0');
    await pompe('pompe azote charge', 'Recipe_PipelinePumpMk2_C', 'azote charge a3 > fin', -800, 300);
    if (A('pompe azote charge') && !st.links['cable pompe azote charge']) {
      const r = await call('wire', PREFIX + 'Build_PowerPoleMk1_C_2146726235', A('pompe azote charge'), { dryRun: DRY });
      report('cable pompe azote charge', r);
      if (r.built) { st.links['cable pompe azote charge'] = r.actor || true; save(); }
    }
  },

  // Courant du pressuriseur du puits d'azote (utilisateur, 28/10/2026 : « il faut retrouver de l'elec pour le pressurizer
  // d'azote ») : son poteau a disparu avec l'ancien site nucleaire. Poteau Mk3 P1 au nord du pressuriseur, relais P2 en
  // l'air a mi-chemin du poteau 2147375910 du circuit principal (-258 897 ; -181 661 ; +80 m, 140 m de P1 : un cable
  // fait 100 m au plus).
  async azoteCourant() {
    const SMASHER = PREFIX + 'Build_FrackingSmasher_C_2147363664', MAIN = PREFIX + 'Build_PowerPoleMk1_C_2147375910';
    const P1 = await build('poteau puits azote', 'Recipe_PowerPoleMk3_C', { x: -251395, y: -188700, z: -1378 }, 0);
    const P2 = await build('poteau relais puits azote', 'Recipe_PowerPoleMk3_C', { x: -255146, y: -185180, z: 3300 }, 0);
    for (const [key, a, b] of [['cable pressuriseur', P1, SMASHER], ['cable puits > relais', P2, P1], ['cable relais > reseau', MAIN, P2]]) {
      if (st.links[key] || !a || !b) continue;
      const r = await call('wire', a, b, { dryRun: DRY });
      report(key, r);
      if (r.built) { st.links[key] = r.actor || true; save(); }
    }
  },

  // Charbon de la balise « coal for rocket fuel » (gisement normal BP_ResourceNode122, libere par l'utilisateur le
  // 26/10/2026) vers le conteneur du quai q3 de N204 O100 (Input0, au sud, 4,5 m) : foreuse Mk3 2146395096 (foreuses.js
  // --nom charbon-fusee, 250 %, sortie au nord-est), cable sur le poteau Mk1 2146211346. Le droit vers le nord est barre
  // par un rocher a surplombs (y -177 000 .. -185 000) : convoyeur a -10 m par la mer a l'est, vers l'est le long de la
  // sortie jusqu'a x -87 700 (ilot affleurant a x -86 700, y -157 000), au nord jusqu'a y -197 000 (sous la voie a 3,5 m
  // et au-dessus d'un ancien convoyeur a -13,5 m), a l'ouest jusqu'a x -95 319, puis montee jusqu'au conteneur (sous
  // le tuyau d'acide nitrique a 7 m sur y -199 000).
  async charbonCharge() {
    const F = require('./foreuses-charbon-fusee-state.json')['122'];
    const z = -1000, Y0 = F.sortie.y, XN = -87700, YN = -197000, XC = -95319;
    const pts = [['m0', { x: -96500, y: Y0, z }, 'Input1', 'Output1', 0], ['m1', { x: -92100, y: Y0, z }, 'Input1', 'Output1', 0],
      ['k1', { x: XN, y: Y0, z }, 'Input3', 'Output1', -90]];
    for (let k = 1; k < 11; k++) { const y = Math.round(Y0 + (YN - Y0) * k / 11); pts.push(['n' + y, { x: XN, y, z }, 'Input1', 'Output1', -90]); }
    pts.push(['k2', { x: XN, y: YN, z }, 'Input3', 'Output1', 180]);
    pts.push(['w', { x: -91500, y: YN, z }, 'Input1', 'Output1', 180]);
    pts.push(['k3', { x: XC, y: YN, z }, 'Input2', 'Output1', -90]);
    await chaine('charbon charge', REC.merger, REC.belt, pts);
    await link('foreuse charbon > ligne', REC.belt, F.foreuse, 'Output0', A('charbon charge m0'), 'Input1');
    await link('charbon charge > conteneur q3', REC.belt, A('charbon charge k3'), 'Output1', A('chargement tampon charbon'), 'Input0');
    if (!st.links['cable foreuse charbon']) {
      const r = await call('wire', PREFIX + 'Build_PowerPoleMk1_C_2146211346', F.foreuse, { dryRun: DRY });
      report('cable foreuse charbon', r);
      if (r.built) { st.links['cable foreuse charbon'] = r.actor || true; save(); }
    }
  },

  // Soufre de la balise « S for rocket fuel » (gisement pur BP_ResourceNode71_UAID_40B076DF2F7912DC01_2042985647, foreuse
  // 2146603280 posee par foreuses.js --nom soufre-fusee : 250 %, 3 eclats, sortie a l'ouest a 234,9 m) jusqu'aux deux tetes
  // de soufre du module 1 (utilisateur : « amene le directement ») : a plat a 234 m sur 200 m (relief releve dessous :
  // 232 m au plus), colonne de 6 ascenseurs au-dessus de l'eau (x 167 000) jusqu'a +25 m (regle : verticales pour les
  // grandes hauteurs), puis a +25 m au-dessus de la mer, tout droit vers l'ouest AU SUD de la voie basse (y -247 468, a
  // 46 m de sa ligne externe sud) jusqu'a x 76 600 ; ascenseur jusqu'a -8 m, puis au nord SOUS la voie basse (rails a
  // 3,5 m, fondations au ras de l'eau a -17,5 m ; utilisateur : « essaye de passer sous la voie du bas, on est sur que ca
  // derangera pas ») et dans l'interstice entre le module et le bloc a l'est jusqu'a y -282 000 ; a l'ouest jusqu'a
  // 'haut' (x 75 800), ascenseur jusqu'a -16 m, puis vers le nord deux repartiteurs : soufre des T ('soufre T 0') et des
  // N ('soufre N 0'), entrees Input1 a l'est. Aucun trace dans la mer au nord de la voie basse,
  // reservee aux extensions de la metallurgie (utilisateur, 26/10/2026 : « tu vois bien que ca va nous faire chier pour
  // tous les futur extensions de la metallurgie au nord » ; le premier trace passait au nord des modules fer).
  // Fusionneurs relais : cap 180 -> Input1 est, Input2 nord, Input3 sud ; cap 0 -> Input1 ouest, Input2 sud, Input3 nord ;
  // cap -90 -> Input1 sud, Input2 est, Input3 ouest ; cap 90 -> Input1 nord, Input2 ouest, Input3 est ; repartiteur cap -90 :
  // Output1 nord, Output3 ouest.
  async soufre() {
    const FOREUSE = require('./foreuses-soufre-fusee-state.json')['71_UAID_40B076DF2F7912DC01_2042985647'].foreuse;
    const Y0 = -247468, ZH = 23387, ZM = 2500, ZN = -800, ZB = -1600, XN = 76600, YA = -282000;
    const pts = [];
    for (const x of [182000, 177000, 172000]) pts.push(['h' + x, { x, y: Y0, z: ZH }, 'Input1', 'Output1', 180]);
    const NT = 6;
    for (let i = 0; i <= NT; i++) pts.push(['t' + i, { x: 167000, y: Y0, z: Math.round(ZH - (ZH - ZM) * i / NT) }, 'Input1', 'Output1', i % 2 ? 0 : 180]);
    for (const x of [162000, 157000]) pts.push(['o' + x, { x, y: Y0, z: ZM }, 'Input1', 'Output1', 180]);
    for (let k = 1; k < 18; k++) { const x = Math.round(157000 - (157000 - XN) * k / 18); pts.push(['o' + x, { x, y: Y0, z: ZM }, 'Input1', 'Output1', 180]); }
    // coin sud : comme 'haut' / 'bas', ascenseur de la sortie sud du fusionneur du haut (cap 90) a l'entree sud de celui
    // du bas (cap -90)
    pts.push(['coin sud', { x: XN, y: Y0, z: ZM }, 'Input3', 'Output1', 90]);
    pts.push(['pied sud', { x: XN, y: Y0, z: ZN }, 'Input1', 'Output1', -90, 'ascenseur']);
    for (let k = 1; k < 8; k++) { const y = Math.round(Y0 + (YA - Y0) * k / 8); pts.push(['r' + y, { x: XN, y, z: ZN }, 'Input1', 'Output1', -90]); }
    pts.push(['coin nord', { x: XN, y: YA, z: ZN }, 'Input3', 'Output1', 180]);
    pts.push(['haut', { x: 75800, y: YA, z: ZN }, 'Input3', 'Output1', 90]);
    // chaine : les ascenseurs de la colonne et de l'arrivee, convoyeurs ailleurs
    for (const [k, at, , , yaw] of pts) await build('soufre ' + k, REC.merger, at, yaw);
    await link('foreuse soufre > ligne', REC.belt, FOREUSE, 'Output0', A('soufre ' + pts[0][0]), 'Input1');
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], lift = (a[0][0] === 't' && b[0][0] === 't') || b[5] === 'ascenseur';
      await link('soufre ' + a[0] + ' > ' + b[0], lift ? REC.lift : REC.belt, A('soufre ' + a[0]), a[3], A('soufre ' + b[0]), b[2], lift ? { snapTolerance: 400 } : undefined);
    }
    // arrivee : ascenseur jusqu'a -16 m, repartiteurs vers le nord
    const D = await build('soufre bas', REC.merger, { x: 75800, y: -282000, z: ZB }, -90);
    await link('soufre haut > bas', REC.lift, A('soufre haut'), 'Output1', D, 'Input1', { snapTolerance: 400 });
    const SPT = await build('soufre vers T', REC.splitter, { x: 75800, y: -284800, z: ZB }, -90);
    const R = await build('soufre relais N', REC.merger, { x: 75800, y: -288300, z: ZB }, -90);
    const SPN = await build('soufre vers N', REC.splitter, { x: 75800, y: -291800, z: ZB }, -90);
    await link('soufre bas > vers T', REC.belt, D, 'Output1', SPT, 'Input1');
    await link('soufre vers T > relais', REC.belt, SPT, 'Output1', R, 'Input1');
    await link('soufre relais > vers N', REC.belt, R, 'Output1', SPN, 'Input1');
    await link('soufre > tete T', REC.belt, SPT, 'Output3', MOD['soufre T 0'], 'Input1');
    await link('soufre > tete N', REC.belt, SPN, 'Output3', MOD['soufre N 0'], 'Input1');
    // courant de la foreuse : poteau Mk1 du circuit principal a 48 m
    if (!st.links['cable foreuse soufre']) {
      const r = await call('wire', PREFIX + 'Build_PowerPoleMk1_C_2146963761', FOREUSE, { dryRun: DRY });
      report('cable foreuse soufre', r);
      if (r.built) { st.links['cable foreuse soufre'] = r.actor || true; save(); }
    }
  },

  // Petrole de la balise « petrole for rocket fuel » (gisement pur BP_ResourceNode26_99, libre) : extracteur a 250 %
  // (3 eclats), cable sur le poteau Mk1 2145600005 de la ligne x 45 000 (circuit principal, 38 m)
  async puitsPetrole() {
    if (A('puits 26_99')) return;
    const at = (await call('pose', NODE_PETROLE)).location;
    const src = await call('streamingSourceAdd', [{ x: at.x, y: at.y, z: at.z + 300 }]);
    try {
      for (let t = 0; t < 60; t++) { await new Promise((r) => setTimeout(r, 2000)); if ((await call('streamingSources', {})).every((s) => s.completed)) break; }
      const r = await call('buildAim', 'Recipe_OilPump_C', { x: at.x, y: at.y, z: at.z + 1000 }, at, { dryRun: DRY, scrollRotation: Number(process.argv[3] || 0), onActor: NODE_PETROLE });
      report('puits 26_99', r);
      if (!r.built) return;
      st.actors['puits 26_99'] = r.actor; save();
      await call('addShards', r.actor, 3);
      const s = await call('setClock', r.actor, 2.5);
      const o = (await call('connections', r.actor))[0];
      console.log('   cadence', s.pendingPotential, 'eclats', s.powerShards, '| sortie', JSON.stringify(o.location), JSON.stringify(o.normal));
    } finally {
      await call('streamingSourceRemove', src);
    }
    const w = await call('wire', PREFIX + 'Build_PowerPoleMk1_C_2145600005', A('puits 26_99'), { dryRun: DRY });
    report('cable puits 26_99', w);
    if (w.built) { st.links['cable puits 26_99'] = w.actor || true; save(); }
  },
  // Oleoduc a -12 m au-dessus de la mer, au sud de la voie basse : a l'est jusqu'a x 50 000 (rocher de 44 m a x 54 000 ..
  // 57 000 sur y -229 000), au nord jusqu'a y -236 000 (ilot a x 70 000 .. 77 000, y -233 000 .. -228 000), a l'est
  // jusqu'a x 73 200, au nord sous la voie basse (rails a 3,5 m) jusqu'a la tete 'petrole 73200' (Connection2, au sud).
  // Sortie de l'extracteur au sud (cap de pose 0) : premiere jonction 10 m au sud, puis a l'est.
  async petrole() {
    const z = -1200;
    const out = (await call('connections', A('puits 26_99')))[0];
    if (out.normal.y < 0.9) throw new Error('sortie de l\'extracteur non tournee vers le sud : ' + JSON.stringify(out.normal));
    const y0 = Math.round(out.location.y + 1000);
    const pts = [['p0', { x: Math.round(out.location.x), y: y0, z }, 'Connection3', 'Connection1'],
      ['e', { x: 50000, y: y0, z }, 'Connection0', 'Connection3'],
      ['n', { x: 50000, y: -231600, z }, 'Connection2', 'Connection3'],
      ['c', { x: 50000, y: -236000, z }, 'Connection2', 'Connection1']];
    for (const x of [54640, 59280, 63920, 68560]) pts.push(['o' + x, { x, y: -236000, z }, 'Connection0', 'Connection1']);
    pts.push(['k', { x: 73200, y: -236000, z }, 'Connection0', 'Connection3']);
    for (const y of [-240800, -245600, -250400, -255200, -260000, -264800]) pts.push(['m' + y, { x: 73200, y, z }, 'Connection2', 'Connection3']);
    await chaine('petrole', REC.junction, REC.pipe, pts);
    await link('puits 26_99 > oleoduc', REC.pipe, A('puits 26_99'), 'FGPipeConnectionFactory', A('petrole p0'), 'Connection3');
    await link('oleoduc > tete petrole', REC.pipe, A('petrole m-264800'), 'Connection3', MOD['petrole 73200'], 'Connection2');
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
  console.error('usage : node gares-carburant.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
