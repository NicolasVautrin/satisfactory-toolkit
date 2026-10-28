// Filiere carburant pour fusees, mer du nord, entre le bloc cuivre et les modules fer (utilisateur, 25-26/10/2026 :
// « on va pas tout faire tout de suite, juste assez pour couvrir le nuke. par contre le layout doit prendre en compte la
// filiere totale »). Recettes de la solution de l'optimiseur (sinkAnalysis_163330), lues en jeu.
// Module = 1/7 de la filiere du plan : 7 melangeurs de carburant pour fusees + 2 nitro -> 1 000 m3/min -> 96 generateurs a
// 250 % (60 GW) + 120 charbon compacte/min (le nucleaire en veut 116). 7 modules = la filiere du plan (49 / 14 melangeurs,
// 672 generateurs, 840 charbon compacte). Emplacements : 3 de front (x 8 500 .. 74 000), rangees de ~265 m vers le nord
// depuis la voie basse ; module 1 = le plus a l'est (le plus pres du soufre, balise « S for rocket fuel ») ; module 2 au
// nord du module 1, plus au large (SLOTS).
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
// source : poteau du circuit principal ou se branche le reseau du module (phase courant).
// Module 2 (utilisateur, 27/10/2026 : « on fait un 2nd module de rocket fuel », « je prefererais que tu le fasses au nord du
// premier module en t'enfoncant dans la mer ») : meme x, au nord de la ligne de charbon du module 1 (y -296 000, son
// element le plus au nord), disposition compacte (plus bas). Courant depuis le poteau L3w du module 1, par un poteau
// relais entre les deux modules (S0, YS + 2 900).
const SLOTS = {
  // module 1 compact : 30 m plus au nord que l'etale (ysCompact) : les extracteurs de B1 a YS - 32 m (y -271 700) sont sur
  // un fond trop haut (FGCDResourceIsTooShallow), il suffit des y -274 200 ; S0 a la place de celui de l'etale
  // module 1 refait en compact le 27/10/2026 (refonte-fusee-m1.js ; etat de l'etale archive : carburant-fusee-m1-etale-state.json)
  1: { XE: 74000, YS: -268500, ysCompact: -271500, source: 'Build_PowerPoleMk1_C_2144799861', s0dy: 3500, layout: 'compact' }, // (62 948 ; -262 795 ; -17 m)
  // modules compacts suivants : pas de 162 m vers le nord (YS - 16 200), courant sur le L3w du module precedent (1 cable
  // libre : 9 / 10 au module 1)
  2: { XE: 74000, YS: -287700, source: 'Build_PowerPoleMk3_C_2144562419', layout: 'compact' }, // L3w du module 1 compact (58 500 ; -281 200)
};
if (!SLOTS[MOD]) { console.error('module ' + MOD + ' : emplacement non defini (SLOTS)'); process.exit(2); }
const XE = SLOTS[MOD].XE;
// Disposition « etale » (module 1 : rangees H, B1, B2, B3 du sud au nord, ~250 m) ou « compact » (variante 2,
// utilisateur 27/10/2026 : « oui prepare la variante 2 et verifie a blanc ») : B1, B2 et B3 resserrees d'apres les boites
// de clearance du jeu (melangeur 18 x 16 x 7 m, raffinerie 10 x 22 x 15 m, lignes a +-12 m des melangeurs), les 16
// raffineries H a 0 m au-dessus des melangeurs T de B2 ; generateurs toujours a +32 / +64 m (raffinerie : 15 m de
// clearance, generateur : gabarit de 13,5 m dessous). ~150 m du sud au nord (pas de 159 m entre modules compacts).
// --layout=etale|compact force la disposition (essai a blanc de comparaison)
const LAYOUT = (process.argv.find((a) => a.startsWith('--layout=')) || '').split('=')[1] || SLOTS[MOD].layout || 'etale';
const COMPACT = LAYOUT === 'compact';
const YS = COMPACT && SLOTS[MOD].ysCompact != null ? SLOTS[MOD].ysCompact : SLOTS[MOD].YS;
const Z1 = -1700, Z0 = 0;
const ZB = Z1 + 100, ZF = Z1 + 500, ZF2 = Z1 + 900, ZS2 = Z1 + 1300;   // lignes a -17 m : +1, +5, +9, +13 m
const ZB0 = Z0 + 100, ZF0 = Z0 + 500;                                   // lignes a 0 m
const dx = (v) => XE - 74000 + v;                                       // coordonnees du module 1 -> module courant
const dy = (v) => YS + 268500 + v;
// Couloir ouest (x) : coke 52 800 (montee a 52 200), residu 53 400, carburant / turbo 54 000, resine 54 400
const XC = { coke: dx(52800), cokeHaut: dx(52200), residu: dx(53400), carburant: dx(54000), resine: dx(54400), resineHaut: dx(53800) };
const XEST = dx(74400);                                                 // couloir est (carburant des N, collecteur +32)

// Rangee H (compact : a 0 m, a l'aplomb de B2)
const YH = COMPACT ? YS - 8300 : dy(-271000), YHS = YH + 1400, YHN = YH - 1400;
const ZH = COMPACT ? Z0 : Z1, ZHB = ZH + 100, ZHF = ZH + 500;          // niveau de H et de ses lignes (+1, +5 m)
const KH = [...Array(16).keys()];
const XH = (k) => dx(73400) - 1200 * k;
const TH = (k) => (k < 4 ? (k % 2 === 0 ? 'P' : 'C') : 'F');
const YAWH = { P: 0, F: 0, C: 180 };
// Relais du coke (+1 m, au sud) entre les jonctions de petrole, vers l'ouest
const COKE_RELAIS = [dx(65400), dx(61800), dx(57000)];
const RESINE_RELAIS = [dx(64800 - 600), dx(59400 - 600)].map((x) => x);   // entre les fusionneurs de resine (pas de 12 m)

// Rangee B1
const YB1 = COMPACT ? YS - 3500 : dy(-278000);
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
// compact : B2 a 48 m de B1 (raccord du carburant de B1 vers B2 : pente de 2,0 a 46 m, 1,1 a 48 m)
const YB2 = COMPACT ? YS - 8300 : dy(-286000), YB2S = YB2 + 1200, YB2N = YB2 - 1240;
const KT = [...Array(10).keys()];
const XT = (k) => dx(73000) - 1900 * k;

// Rangee B3
const YB3 = COMPACT ? YS - 11300 : dy(-293000), YB3S = YB3 + 1200, YB3N = YB3 - 1240;
// jonction relais du carburant des N, entre la ligne sud de B2 et celle de B3 (couloir est)
const Y_CARB_EST = COMPACT ? (YB2S + YB3S) / 2 : YB2S - 3000;
const K3 = [...Array(9).keys()];
const X3 = (k) => dx(73000) - 1900 * k;
const T3 = (k) => (k < 2 ? 'N' : 'K');
const SEG_EST = K3.filter((k) => k < 4), SEG_OUEST = K3.filter((k) => k >= 4);   // 500 m3/min chacun

// Generateurs
const ZG = { haut: 6400, bas: 3200 };                  // +64 m (troncon ouest), +32 m (troncon est)
// paires de rangees N / S (+-13 m du collecteur, generateurs de 20 m) : compact, paires jointives a 2 m
const YM = COMPACT ? [YS - 2400, YS - 7200, YS - 12000] : [dy(-273000), dy(-282000), dy(-291000)];
const XG = (c) => dx(72800) - 2400 * c;
const KG = [...Array(8).keys()];
const XGH = { bas: XEST, haut: XC.residu };            // collecteurs le long d'y
const YRELAIS_G = COMPACT ? [YS - 4800, YS - 9600] : [dy(-277500), dy(-286500)];

// --- Etat -------------------------------------------------------------------------------------------------
// disposition forcee autre que celle de l'emplacement (--layout) : etat a part, pour ne pas confondre avec ce qui est pose
const FILE = path.join(__dirname, 'carburant-fusee-m' + MOD + (LAYOUT !== (SLOTS[MOD].layout || 'etale') ? '-' + LAYOUT : '') + '-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
// A blanc, le jeu ne valide chaque piece que contre l'existant : le plan est releve (pieces, liaisons, cables) pour le
// controle de la phase tout (chevauchements entre pieces neuves, longueurs et pentes des liaisons). Une piece planifiee
// est designee par 'PLAN:<cle>'
const PLAN = {}, PLAN_LINKS = [], PLAN_WIRES = [];
const PLAN_FILE = path.join(__dirname, 'carburant-fusee-m' + MOD + '-' + LAYOUT + '-plan-state.json'); // dernier plan releve (non versionne)
const planRef = (k) => 'PLAN:' + k;
const isPlan = (p) => typeof p === 'string' && p.startsWith('PLAN:');
const A = (k) => st.actors[k] || (DRY && PLAN[k] ? planRef(k) : undefined);

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
  if (DRY) { PLAN[key] = { recipe, at, yaw, blocking: r.blocking || [] }; return planRef(key); }
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(40), 'saute (bout absent)'); return null; }
  if (DRY && (isPlan(from) || isPlan(to))) { PLAN_LINKS.push({ key, recipe, from, fromName, to, toName }); return null; }
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
    for (const k of KH) await build('H ' + k + ' ' + TH(k), REC.refinery, { x: XH(k), y: YH, z: ZH }, YAWH[TH(k)]);
  },
  async recettesH() { await recettes(KH.map((k) => ({ key: 'H ' + k + ' ' + TH(k), t: TH(k) }))); },
  async paires() {
    for (const k of KH.filter((q) => TH(q) === 'P')) await link('paire ' + k, REC.pipe, h(k), 'PipeOutputFactory', h(k + 1), 'PipeInputFactory');
  },
  // Petrole au sud (+5) : une jonction devant chaque P et F, tete est (Connection1 de la premiere) libre
  async petrole() {
    const PF = KH.filter((k) => TH(k) !== 'C');
    const J = await junctionLine('petrole', PF.map((k) => XH(k) - 200), YHS, ZHF);
    for (const k of PF) await link('petrole > H ' + k, REC.pipe, J(XH(k) - 200), 'Connection3', h(k), 'PipeInputFactory');
  },
  // Coke au sud (+1), vers l'ouest (cap 180), relais entre les jonctions de petrole, puis le couloir ouest jusqu'a la
  // ligne de coke de B2 (+13 m), par une montee
  async coke() {
    const CS = KH.filter((k) => TH(k) === 'C');
    const pts = CS.map((k) => ({ key: 'coke ' + k, x: XH(k) - 200, k })).concat(COKE_RELAIS.map((x, i) => ({ key: 'coke relais ' + i, x })));
    for (const p of pts) await build(p.key, REC.merger, { x: p.x, y: YHS, z: ZHB }, 180);
    for (const k of CS) await link('H ' + k + ' > coke', REC.belt, h(k), 'Output1', A('coke ' + k), 'Input' + side(180, 'N'));
    for (let i = 1; i < pts.length; i++) await link(pts[i - 1].key + ' > ' + pts[i].key, REC.belt, A(pts[i - 1].key), 'Output1', A(pts[i].key), 'Input1');
    if (COMPACT) {
      // H au-dessus de B2 : descente de 5 m (x 53 800, a l'est du couloir de la resine x 53 000 qu'elle ne doit pas
      // croiser, et des arrivees x 52 150 .. 52 700) jusqu'au debut de la ligne de coke des T (+13 m)
      const haut = await build('coke descente', REC.merger, { x: XC.resineHaut, y: YB2S, z: ZHB }, 180);
      const bas = await build('coke montee haut', REC.merger, { x: XC.resineHaut, y: YB2S, z: ZS2 }, 0);
      await link(pts[pts.length - 1].key + ' > descente', REC.belt, A(pts[pts.length - 1].key), 'Output1', haut, 'Input1');
      await link('coke descente ascenseur', REC.lift, haut, 'Output1', bas, 'Input1', { snapTolerance: 400 });
      return;
    }
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
    for (const p of pts) await build(p.key, REC.merger, { x: p.x, y: YHN, z: ZHB }, 180);
    for (const k of PF) await link('H ' + k + ' > resine', REC.belt, h(k), 'Output1', A('resine ' + k), 'Input' + side(180, 'S'));
    for (let i = 1; i < pts.length; i++) await link(pts[i - 1].key + ' > ' + pts[i].key, REC.belt, A(pts[i - 1].key), 'Output1', A(pts[i].key), 'Input1');
    if (COMPACT) {
      // H a 0 m, au nord des R : vers le sud au couloir (x 53 000, 0 m : a l'ouest de la descente du coke, pour ne pas
      // croiser son convoyeur), un relais a mi-chemin, puis le debut de la ligne des R (fusionneur cap 0, entree nord)
      const ymid = Math.round((YHN + YRS) / 2), xr = dx(53000);
      await build('resine couloir', REC.merger, { x: xr, y: YHN, z: ZB0 }, 90);
      await link('resine > couloir', REC.belt, A(pts[pts.length - 1].key), 'Output1', A('resine couloir'), 'Input' + side(90, 'E'));
      await build('resine relais', REC.merger, { x: xr, y: ymid, z: ZB0 }, 90);
      await link('resine couloir > relais', REC.belt, A('resine couloir'), 'Output1', A('resine relais'), 'Input1');
      await build('resine haut', REC.merger, { x: xr, y: YRS, z: ZB0 }, 0);
      await link('resine relais > haut', REC.belt, A('resine relais'), 'Output1', A('resine haut'), 'Input' + side(0, 'N'));
      return;
    }
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
    const J = await junctionLine('residu H', FS.map((k) => XH(k) - 200).concat([XC.residu]), YHN, ZHF);
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
      if (DRY && r.hologram) PLAN[key] = { recipe: REC.extractor, at: r.hologram.location, yaw: r.hologram.rotation.yaw, blocking: r.blocking || [] };
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
    // compact : H est au nord de B1, au-dessus de B2 ; il alimente la ligne des T, qui alimente celle de B1 (fluidesT)
    if (!COMPACT) await link('residu H > B1', REC.pipe, A('residu H ' + XC.residu), 'Connection3', J(XC.residu), 'Connection2');
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
    const ys = COMPACT ? [Math.round((YB1S + YB2S) / 2)] : [YB1S - 2000, YB1S - 6000, YB2S + 2000];
    await junctionColumn('residu couloir', XC.residu, ys, ZF2 - 200);
    await link('residu B1 > couloir', REC.pipe, A('residu B1 ' + XC.residu), 'Connection3', A('residu couloir ' + ys[0]), 'Connection2');
    await link('residu couloir > T', REC.pipe, A('residu couloir ' + ys[ys.length - 1]), 'Connection3', R(XC.residu), 'Connection2');
    // compact : la ligne de residu de H (0 m, au nord) descend sur la jonction de tete de la ligne des T
    if (COMPACT) await link('residu H > T', REC.pipe, A('residu H ' + XC.residu), 'Connection2', R(XC.residu), 'Connection3');
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
    await junctionColumn('carburant est', XEST + 400, [Y_CARB_EST], ZF2);
    await link('carburant T > est', REC.pipe, A('carburant T ' + XEST), 'Connection3', A('carburant est ' + Y_CARB_EST), 'Connection2');
    await build('carburant N est', REC.junction, { x: XEST + 400, y: YB3S, z: ZF2 }, 0);
    await link('carburant est > N', REC.pipe, A('carburant est ' + Y_CARB_EST), 'Connection3', A('carburant N est'), 'Connection2');
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
  // Colonnes : du bout du troncon de B3 (-12 m) vers le sud jusqu'au montant, par des jonctions relais ; pompes Mk2 sur
  // les premiers tuyaux.
  //  - +32 m (est, x 74 400) : 2 sauts de 16 m jusqu'au bout nord du montant (collecteur de la paire 2, Connection3) ;
  //  - +64 m (ouest, x 53 400) : 78 m a monter -> sous le montant vers le sud, puis dans l'intervalle entre les paires
  //    1 et 2 (y -284 300 .. -288 700, sans generateurs) jusqu'au relais -286 500 du montant (Connection1, a l'est).
  // Compact : les troncons de B3 sont a 5 m du collecteur nord, trop pres pour monter : la colonne part vers le sud dans
  // son couloir (est x XEST, ouest x XC.residu), monte sous les generateurs (hors de leur aplomb) et entre dans le bout du
  // collecteur de la paire 0 par son cote exterieur (est Connection1, ouest Connection0), le connecteur tourne vers elle.
  // Jamais par le bout du montant (Connection2, tourne vers le sud) : il faudrait le depasser et revenir en epingle
  // (montage de l'utilisateur, 27/10/2026). Le jeu n'impose pas de pente aux tuyaux ; tuyaux <= 54 m.
  async colonnes() {
    const S = (x, y, z, inn, out) => ({ x, y, z, in: inn, out });
    const CHEMINS = COMPACT ? {
      bas: { seg: 'fusee est', pts: [S(XEST, YS - 8500, 600, 'Connection3', 'Connection2'), S(XEST, YS - 4500, 1800, 'Connection3', 'Connection2')],
        fin: [A('collecteur bas 0 ' + XEST), 'Connection1'] },
      haut: { seg: 'fusee ouest', pts: [S(XC.residu, YS - 9800, 1400, 'Connection3', 'Connection2'), S(XC.residu, YS - 5800, 4000, 'Connection3', 'Connection2')],
        fin: [A('collecteur haut 0 ' + XC.residu), 'Connection0'] },
    } : {
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
    // compact : S0 entre les deux modules (relais vers la source, 69 m), S1 au bord sud ; couloirs B1 / B2 (y - 56 m) a
    // -17 m (L1w extracteurs, L1e melangeurs D et broyeur) et a 0 m (L1r raffineries R, Hw / He raffineries H) ; couloir
    // B2 / B3 (y - 97 m, entre les lignes) a -17 m (L3w / L3m / L3e : T et B3, pompes de la colonne haute)
    // S0 : YS + s0dy (module 1 : poteau source au bord de la voie basse, S0 au bord sud, sans S1)
    const S0DY = SLOTS[MOD].s0dy != null ? SLOTS[MOD].s0dy : 2900, WITH_S1 = S0DY > 1000;
    const P = COMPACT ? {
      S0: { x: dx(60000), y: YS + S0DY, z: Z1 }, ...(WITH_S1 ? { S1: { x: dx(60000), y: YS + 200, z: Z1 } } : {}),
      L1w: { x: dx(60000), y: YS - 5600, z: Z1 }, L1e: { x: dx(67000), y: YS - 5600, z: Z1 }, L1r: { x: dx(59800), y: YS - 5600, z: Z0 },
      Hw: { x: dx(61500), y: YS - 5600, z: Z0 }, He: { x: dx(69000), y: YS - 5600, z: Z0 },
      L3w: { x: dx(58500), y: YS - 9700, z: Z1 }, L3m: { x: dx(64000), y: YS - 9700, z: Z1 }, L3e: { x: dx(70000), y: YS - 9700, z: Z1 },
    } : {
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
    const SOURCE = PREFIX + SLOTS[MOD].source;   // circuit principal
    const plan = COMPACT
      ? [['S0', SOURCE], ...(WITH_S1 ? [['S1', p('S0')], ['L1w', p('S1')]] : [['L1w', p('S0')]]), ['L1e', p('L1w')], ['L1r', p('L1w')],
        ['L3w', p('L1w')], ['L3e', p('L1e')], ['L3m', p('L3w')], ['He', p('L1e')], ['Hw', p('L1r')]]
      : [['S0', SOURCE], ['L1w', p('S0')], ['L1e', p('L1w')], ['L1r', p('L1w')], ['L2w', p('L1w')], ['L2e', p('L1e')],
        ['M', p('L2w')], ['L3m', p('M')], ['L3e', p('L3m')], ['L3w', p('L3m')]];
    // poteaux de chaque groupe de machines : [H est, H ouest, H bout ouest, extracteurs, D, broyeur]
    const [PH1, PH2, PH3, PX, PD, PB] = COMPACT ? ['He', 'Hw', 'Hw', 'L1w', 'L1e', 'L1e'] : ['L1e', 'L1w', 'S0', 'L2w', 'L2e', 'L1r'];
    KH.forEach((k) => plan.push([k < 8 ? PH1 : k < 14 ? PH2 : PH3, h(k)]));
    KR.forEach((k) => plan.push(['L1r', r0(k)]));
    plan.push([PB, A('broyeur')]);
    [...Array(5).keys()].forEach((i) => plan.push([PX, A('extracteur ' + i)]));
    plan.push([PX, A('pompe eau')]);
    [...Array(4).keys()].forEach((j) => plan.push([PD, d1(j)]));
    KT.forEach((k) => plan.push([k < 4 ? 'L3e' : k < 7 ? 'L3m' : 'L3w', t2(k)]));
    K3.forEach((k) => plan.push([k < 4 ? 'L3e' : k < 7 ? 'L3m' : 'L3w', b3(k)]));
    // compact : L3e est plein (10) ; la pompe de la colonne basse va sur le poteau des generateurs au-dessus d'elle
    plan.push([COMPACT ? 'G bas 2 0' : 'L3e', A('pompe bas 0')], ['L3w', A('pompe haut 0')], ['L3w', A('pompe haut 1')]);
    for (const niv of ['bas', 'haut']) {
      for (const [pi] of YM.entries()) {
        for (let q = 1; q < 4; q++) plan.push(['G ' + niv + ' ' + pi + ' ' + q, p('G ' + niv + ' ' + pi + ' ' + (q - 1))]);
        for (const [q] of XQ.entries()) for (const c of [2 * q, 2 * q + 1]) for (const r of ['N', 'S']) plan.push(['G ' + niv + ' ' + pi + ' ' + q, A('G ' + niv + ' ' + pi + ' ' + r + ' ' + c)]);
      }
      for (const i of [0, 1]) plan.push(['GR ' + niv + ' ' + i, p('G ' + niv + ' ' + i + ' 2')], ['GR ' + niv + ' ' + i, p('G ' + niv + ' ' + (i + 1) + ' 2')]);
      plan.push(['GR haut 0', p('GR bas 0')]);
    }
    plan.push(['GR bas 1', p(COMPACT ? 'L3m' : 'M')]);
    const count = {};
    for (const [a, b] of plan) {
      count[a] = (count[a] || 0) + 1;
      const kb = isPlan(b) ? (b.slice(5).startsWith('poteau ') ? b.slice(5) : null) : Object.keys(st.actors).find((k) => k.startsWith('poteau ') && st.actors[k] === b);
      if (kb) count[kb.slice(7)] = (count[kb.slice(7)] || 0) + 1;
    }
    const over = Object.entries(count).filter(([, n]) => n > 10);
    if (over.length) throw new Error('poteaux trop charges : ' + JSON.stringify(over));
    for (const [a, b] of plan) {
      const key = a + ' > ' + (b ? short(b) : '?');
      if (st.wires[key]) continue;
      if (!p(a) || !b) { console.log(('cable ' + key).padEnd(40), 'saute (bout absent)'); continue; }
      if (DRY && (isPlan(p(a)) || isPlan(b))) { PLAN_WIRES.push({ key, from: p(a), to: b }); continue; }
      const r = await call('wire', p(a), b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
  },

  // Raccords des arrivees du module 1 compact (utilisateur, 27/10/2026 : « oui refais le module 1 en compact ») : les
  // lignes de gares-carburant.js finissaient sur les tetes du module 1 etale ; on garde chacune jusqu'a sa derniere piece
  // utile (la suite est demontee avec l'ancien module) et on repose la fin jusqu'aux tetes compactes :
  //  - petrole : bout libre de l'oleoduc (73 200 ; -269 500 ; -12 m) -> relais a 10 m (pente 1,4 : pompe Mk1, H monte a
  //    0 m) -> relais -> tete est de la ligne de petrole (+5 m) ;
  //  - soufre : relais r-273367 (x 76 600, -8 m) -> repartiteurs vers T et vers N (x 76 600, -16 m) -> tetes des T et N ;
  //  - charbon : relais n1 (couloir ouest, +4,5 m) -> au nord du module (y YS - 139 m, sous les generateurs) vers l'est ->
  //    x 76 000 vers le sud -> arrivee (-4 m) -> tete des N par l'est ;
  //  - azote : relais n2 (couloir ouest, +9 m) -> au nord (YS - 145 m) vers l'est -> x 77 000 vers le sud et -12 m -> tete
  //    des N par l'est ;
  //  - acide nitrique : relais n1 (x 52 150, +13 m) -> descente a -8 m au nord (YS - 130 m) -> tete des K par l'ouest.
  // A blanc, les liaisons gardees de ces lignes entrent aussi dans le controle des croisements.
  async raccords() {
    if (MOD !== 1 || !COMPACT) throw new Error('raccords : module 1 compact seulement');
    const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'gares-carburant-state.json'), 'utf8'));
    const ga = (k) => { const a = G.actors[k]; if (!a) throw new Error('gares-carburant : ' + k + ' absent'); return a; };
    if (DRY) {
      for (const k of ['nitrique 1 > n0', 'nitrique n0 > n1', 'azote 1 > n0', 'azote n0 > n1', 'azote n1 > n2', 'charbon 2 > n0', 'charbon n0 > n1',
        'soufre r-264734 > r-269050', 'soufre r-269050 > r-273367']) {
        const l = G.links[k], pipe = /Pipeline/.test(l);
        PLAN_LINKS.push({ key: 'existant ' + k, recipe: pipe ? REC.pipe : REC.belt, from: l, fromName: pipe ? 'PipelineConnection0' : 'ConveyorAny0', to: l, toName: pipe ? 'PipelineConnection1' : 'ConveyorAny1' });
      }
    }
    // petrole
    const OLEODUC = PREFIX + 'Build_PipelineMK2_C_2146493157';
    await build('raccord petrole 0', REC.junction, { x: dx(73200), y: -270500, z: 200 }, 0);
    await build('raccord petrole', REC.junction, { x: dx(73200), y: Math.round((-270500 + YHS) / 2), z: 400 }, 0);
    await link('petrole oleoduc > raccord', REC.pipe, OLEODUC, 'PipelineConnection1', A('raccord petrole 0'), 'Connection2');
    await link('petrole raccord 0 > 1', REC.pipe, A('raccord petrole 0'), 'Connection3', A('raccord petrole'), 'Connection2');
    await link('petrole raccord > tete', REC.pipe, A('raccord petrole'), 'Connection3', A('petrole ' + dx(73200)), 'Connection2');
    await pompe('pompe petrole', REC.pump1, st.links['petrole oleoduc > raccord'], -900, 0);
    // courant de la pompe : poteau des generateurs au-dessus d'elle (~41 m)
    if (!DRY && A('pompe petrole') && !st.wires['G bas 0 0 > pompe petrole']) {
      const r = await call('wire', A('poteau G bas 0 0'), A('pompe petrole'), {});
      report('cable G bas 0 0 > pompe petrole', r);
      if (r.built) { st.wires['G bas 0 0 > pompe petrole'] = r.actor || true; save(); }
    }
    // soufre
    const VT = await build('soufre vers T', REC.splitter, { x: dx(76600), y: YB2S, z: ZB }, -90);
    await link('soufre r-273367 > vers T', REC.belt, ga('soufre r-273367'), 'Output1', VT, 'Input1');
    await link('soufre > tete T', REC.belt, VT, 'Output' + side(-90, 'W'), A('soufre T 0'), 'Input1');
    const VN = await build('soufre vers N', REC.splitter, { x: dx(76600), y: YB3S, z: ZB }, -90);
    await link('soufre vers T > vers N', REC.belt, VT, 'Output1', VN, 'Input1');
    await link('soufre > tete N', REC.belt, VN, 'Output' + side(-90, 'W'), A('soufre N 0'), 'Input1');
    // charbon
    const yc = YS - 13900, xc = [dx(52700), dx(57700), dx(62700), dx(67700), dx(72700)];
    await build('charbon coin no', REC.merger, { x: xc[0], y: yc, z: 450 }, 0);
    await link('charbon n1 > coin no', REC.belt, ga('charbon n1'), 'Output1', A('charbon coin no'), 'Input' + side(0, 'S'));
    let prev = 'charbon coin no';
    for (let i = 1; i < xc.length; i++) {
      await build('charbon e' + (i - 1), REC.merger, { x: xc[i], y: yc, z: 450 }, 0);
      await link(prev + ' > e' + (i - 1), REC.belt, A(prev), 'Output1', A('charbon e' + (i - 1)), 'Input1');
      prev = 'charbon e' + (i - 1);
    }
    await build('charbon coin ne', REC.merger, { x: dx(76000), y: yc, z: 450 }, 90);
    await link(prev + ' > coin ne', REC.belt, A(prev), 'Output1', A('charbon coin ne'), 'Input' + side(90, 'W'));
    await build('charbon arrivee', REC.merger, { x: dx(76000), y: YB3S, z: ZS2 }, 180);
    await link('charbon coin ne > arrivee', REC.belt, A('charbon coin ne'), 'Output1', A('charbon arrivee'), 'Input' + side(180, 'N'));
    await link('charbon > tete', REC.belt, A('charbon arrivee'), 'Output1', A('charbon N 0'), 'Input1');
    // azote
    const ya = YS - 14500, xa = [dx(52450), dx(57450), dx(62450), dx(67450), dx(72450), dx(77000)];
    const AZ = await junctionLine('azote nord', xa, ya, 900);
    await link('azote n2 > nord', REC.pipe, ga('azote n2'), 'Connection3', AZ(xa[0]), 'Connection2');
    await build('azote arrivee', REC.junction, { x: dx(77000), y: YB3S, z: ZF }, 0);
    await link('azote nord > arrivee', REC.pipe, AZ(xa[xa.length - 1]), 'Connection2', A('azote arrivee'), 'Connection3');
    await link('azote > tete', REC.pipe, A('azote arrivee'), 'Connection0', A('azote N ' + XEST), 'Connection1');
    // acide nitrique
    await build('nitrique bas', REC.junction, { x: dx(52150), y: YS - 13000, z: ZF2 }, 0);
    await link('nitrique n1 > bas', REC.pipe, ga('nitrique n1'), 'Connection3', A('nitrique bas'), 'Connection2');
    await link('nitrique > tete', REC.pipe, A('nitrique bas'), 'Connection1', A('nitrique K ' + XC.residu), 'Connection0');
  },

  // Toutes les phases dans l'ordre de construction, zone chargee par une source de streaming ; a blanc (--dry), puis
  // controle du plan releve
  async tout() {
    const ORDRE = ['raffineries', 'recettesH', 'paires', 'petrole', 'coke', 'resine', 'residu', 'raffineriesR', 'extracteurs',
      'melangeursD', 'recettesB1', 'eau', 'residuB1', 'carburantB1', 'resineR', 'caoutchouc', 'melangeursT', 'recettesT',
      'soufreT', 'fluidesT', 'cokeT', 'turbo', 'melangeursB3', 'recettesB3', 'fluidesK', 'fluidesN', 'solidesN', 'sortiesB3',
      'generateurs', 'eclats', 'collecteurs', 'colonnes', 'courant'].concat(MOD === 1 && COMPACT ? ['raccords'] : []);
    const T = require('./tracer');
    const src = await T.loadArea({ x0: dx(50000), y0: YS - (COMPACT ? 16000 : 27000), x1: dx(77000), y1: YS + 3500 });
    try {
      for (const ph of ORDRE) { console.log('--- ' + ph); await PHASES[ph](); }
    } finally { await call('streamingSourceRemove', src); }
    if (DRY) {
      fs.writeFileSync(PLAN_FILE, JSON.stringify({ PLAN, PLAN_LINKS, PLAN_WIRES }) + '\n');
      await PHASES.controle();
    }
  },

  // Controle du plan releve a blanc (dans le meme lancement que les phases : node carburant-fusee.js tout --dry) :
  //  - refus du jeu, piece par piece, contre l'existant ;
  //  - chevauchements entre pieces neuves (boites de clearance du jeu, data/clearanceData.json, sans les aides au
  //    raccord excludeForSnapping ; boites rendues en AABB monde, exactes aux caps multiples de 90 deg) ;
  //  - liaisons, d'un connecteur a l'autre (decalages des connecteurs lus en jeu sur les batiments du module 1) :
  //    convoyeurs et tuyaux de 56 m au plus, pente des tuyaux, ascenseurs de 4 a 48 m a la verticale ;
  //  - cables de 70 m au plus.
  async controle() {
    if (!DRY) throw new Error('controle : seulement a blanc (node carburant-fusee.js tout --dry, ou controle --dry sur le dernier plan releve)');
    if (!Object.keys(PLAN).length) {
      if (!fs.existsSync(PLAN_FILE)) throw new Error('pas de plan releve : node carburant-fusee.js tout --module=' + MOD + ' --dry');
      const f = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
      Object.assign(PLAN, f.PLAN); PLAN_LINKS.push(...f.PLAN_LINKS); PLAN_WIRES.push(...f.PLAN_WIRES);
    }
    const CLEAR = require(path.join(__dirname, '..', '..', '..', '..', 'data', 'clearanceData.json'));
    const cls = (recipe) => recipe.replace(/^Recipe_/, 'Build_');
    const rot = (v, yaw) => { const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }; };
    const m = (n) => (n / 100).toFixed(1);
    // refus du jeu
    const refus = Object.entries(PLAN).filter(([, p]) => p.blocking.length);
    console.log('\n=== CONTROLE ' + LAYOUT + ' : ' + Object.keys(PLAN).length + ' pieces, ' + PLAN_LINKS.length + ' liaisons, ' + PLAN_WIRES.length + ' cables');
    console.log('refus du jeu (contre l\'existant) :', refus.length ? '' : 'aucun');
    for (const [k, p] of refus) console.log('   ', k, p.blocking.join(','));
    // boites
    const boxes = [];
    for (const [key, p] of Object.entries(PLAN)) {
      const c = CLEAR[cls(p.recipe)];
      if (!c) { console.log('   pas de boite pour', cls(p.recipe)); continue; }
      for (const b of c.boxes.filter((q) => !q.excludeForSnapping)) {
        const rt = b.relativeTransform || {}, t = rt.translation || { x: 0, y: 0, z: 0 };
        const ryaw = rt.rotation ? (2 * Math.atan2(rt.rotation.z, rt.rotation.w) * 180) / Math.PI : 0;
        const pts = [];
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const l = rot({ x, y, z }, ryaw), w = rot({ x: l.x + t.x, y: l.y + t.y, z: l.z + t.z }, p.yaw);
          pts.push({ x: p.at.x + w.x, y: p.at.y + w.y, z: p.at.z + w.z });
        }
        const mn = {}, mx = {};
        for (const a of ['x', 'y', 'z']) { mn[a] = Math.min(...pts.map((q) => q[a])); mx[a] = Math.max(...pts.map((q) => q[a])); }
        boxes.push({ key, soft: b.type === 'CT_Soft', mn, mx });
      }
    }
    const pairs = new Map();
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.key === b.key) continue;
      const d = ['x', 'y', 'z'].map((q) => Math.min(a.mx[q], b.mx[q]) - Math.max(a.mn[q], b.mn[q]));
      if (d.some((v) => v <= 1)) continue;
      const k = a.key < b.key ? a.key + ' | ' + b.key : b.key + ' | ' + a.key;
      const depth = Math.min(...d), e = pairs.get(k);
      if (!e || depth > e.depth) pairs.set(k, { depth, soft: a.soft || b.soft });
    }
    const hard = [...pairs].filter(([, e]) => !e.soft), soft = [...pairs].filter(([, e]) => e.soft);
    console.log('chevauchements entre pieces neuves : ' + hard.length + ' entre boites dures, ' + soft.length + ' avec une boite souple');
    for (const [k, e] of hard.concat(soft).sort((a, b) => b[1].depth - a[1].depth).slice(0, 40)) console.log('   ', (e.soft ? 'souple ' : 'DURE   ') + m(e.depth) + ' m', k);
    // emprise
    const ext = { x0: Math.min(...boxes.map((b) => b.mn.x)), x1: Math.max(...boxes.map((b) => b.mx.x)), y0: Math.min(...boxes.map((b) => b.mn.y)), y1: Math.max(...boxes.map((b) => b.mx.y)) };
    console.log('emprise : x ' + Math.round(ext.x0) + ' .. ' + Math.round(ext.x1) + ' (' + m(ext.x1 - ext.x0) + ' m), y ' + Math.round(ext.y0) + ' .. ' + Math.round(ext.y1) + ' (' + m(ext.y1 - ext.y0) + ' m)');
    // decalages des connecteurs, lus en jeu sur un batiment de chaque classe (le premier trouve), gardes dans
    // plans/cache/connecteurs.json (valables tant que la version du jeu ne change pas)
    const CACHE = path.join(__dirname, 'cache', 'connecteurs.json');
    const OFF = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
    const offsets = async (c) => {
      if (OFF[c] !== undefined) return OFF[c];
      const it = ((await call('scan', c, null, 0, 1, {})).items || [])[0];
      if (!it) return (OFF[c] = null);
      const pose = await call('pose', it.path), cs = await call('connections', it.path);
      OFF[c] = {};
      for (const k of cs) OFF[c][k.name] = rot({ x: k.location.x - pose.location.x, y: k.location.y - pose.location.y, z: k.location.z - pose.location.z }, -(pose.rotation.yaw || 0));
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, JSON.stringify(OFF, null, 1) + '\n');
      return OFF[c];
    };
    const at = async (ref, name) => {
      if (isPlan(ref)) {
        const p = PLAN[ref.slice(5)], o = await offsets(cls(p.recipe));
        if (!o || !o[name]) return { pos: p.at, approx: true };
        const w = rot(o[name], p.yaw);
        return { pos: { x: p.at.x + w.x, y: p.at.y + w.y, z: p.at.z + w.z } };
      }
      const c = (await call('connections', ref)).find((k) => k.name === name);
      return c ? { pos: c.location } : { pos: (await call('pose', ref)).location, approx: true };
    };
    const bad = [], segs = [];
    let maxSlope = { v: 0 }, approx = 0;
    for (const l of PLAN_LINKS) {
      const a = await at(l.from, l.fromName), b = await at(l.to, l.toName);
      if (a.approx || b.approx) approx++;
      segs.push({ key: l.key, kind: /Lift/.test(l.recipe) ? 'lift' : /Pipeline/.test(l.recipe) ? 'pipe' : 'belt', a: a.pos, b: b.pos, ends: [l.from, l.to] });
      const dh = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y), dz = Math.abs(b.pos.z - a.pos.z), L = Math.hypot(dh, dz);
      if (/Lift/.test(l.recipe)) { if (dz < 400 || dz > 4800 || dh > 300) bad.push(l.key + ' : ascenseur de ' + m(dz) + ' m, decale de ' + m(dh) + ' m'); continue; }
      if (L > 5600) bad.push(l.key + ' : ' + m(L) + ' m (56 au plus)');
      if (L < 50) bad.push(l.key + ' : ' + m(L) + ' m (trop court)');
      if (/Pipeline/.test(l.recipe) && dh > 0 && dz / dh > maxSlope.v) maxSlope = { v: dz / dh, key: l.key };
    }
    // Croisements entre liaisons, en segments droits d'un connecteur a l'autre (les vraies courbes s'en ecartent pres des
    // connecteurs), sauf entre liaisons d'une meme piece : convoyeurs / ascenseurs a moins de 1,2 m ; tuyaux a moins de
    // 1 m ; tuyau au-dessus d'un convoyeur a moins de 2 m (moins de 2 m en plan ; le module 1 construit en a 218 a 3,5 -
    // 4 m, acceptes par le jeu) ; liaison a travers la boite dure d'une piece qui n'est pas l'un de ses bouts
    const pts = (s) => { const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z), n = Math.max(1, Math.ceil(L / 100)); return [...Array(n + 1).keys()].map((i) => ({ x: s.a.x + ((s.b.x - s.a.x) * i) / n, y: s.a.y + ((s.b.y - s.a.y) * i) / n, z: s.a.z + ((s.b.z - s.a.z) * i) / n })); };
    for (const s of segs) {
      s.p = pts(s);
      s.mn = { x: Math.min(s.a.x, s.b.x), y: Math.min(s.a.y, s.b.y), z: Math.min(s.a.z, s.b.z) };
      s.mx = { x: Math.max(s.a.x, s.b.x), y: Math.max(s.a.y, s.b.y), z: Math.max(s.a.z, s.b.z) };
    }
    const cross = [];
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      if (s.ends.some((e) => t.ends.includes(e))) continue;
      const M = 900;
      if (s.mn.x > t.mx.x + 300 || t.mn.x > s.mx.x + 300 || s.mn.y > t.mx.y + 300 || t.mn.y > s.mx.y + 300 || s.mn.z > t.mx.z + M || t.mn.z > s.mx.z + M) continue;
      const pipeBelt = (s.kind === 'pipe') !== (t.kind === 'pipe');
      let worst = null;
      for (const p of s.p) for (const q of t.p) {
        const dh = Math.hypot(p.x - q.x, p.y - q.y), d = Math.hypot(dh, p.z - q.z);
        if (pipeBelt) {
          const pipe = s.kind === 'pipe' ? p : q, belt = s.kind === 'pipe' ? q : p, up = pipe.z - belt.z;
          if (dh < 200 && up >= 0 && up < 200 && (!worst || up < worst.v)) worst = { v: up, what: 'tuyau ' + m(up) + ' m au-dessus d\'un convoyeur' };
        } else {
          const lim = s.kind === 'pipe' ? 100 : 120;
          if (d < lim && (!worst || d < worst.v)) worst = { v: d, what: (s.kind === 'pipe' ? 'tuyaux' : 'convoyeurs') + ' a ' + m(d) + ' m' };
        }
      }
      if (worst) cross.push(s.key + ' / ' + t.key + ' : ' + worst.what);
    }
    const hardBoxes = boxes.filter((b) => !b.soft);
    for (const s of segs) {
      const own = new Set(s.ends.filter(isPlan).map((e) => e.slice(5)));
      const inner = s.p.filter((p) => Math.hypot(p.x - s.a.x, p.y - s.a.y, p.z - s.a.z) > 200 && Math.hypot(p.x - s.b.x, p.y - s.b.y, p.z - s.b.z) > 200);
      const hit = hardBoxes.find((b) => !own.has(b.key) && inner.some((p) => p.x > b.mn.x && p.x < b.mx.x && p.y > b.mn.y && p.y < b.mx.y && p.z > b.mn.z && p.z < b.mx.z));
      if (hit) cross.push(s.key + ' : traverse ' + hit.key);
    }
    console.log('croisements entre liaisons et traversees de batiments :', cross.length ? cross.length : 'aucun');
    for (const s of cross.slice(0, 60)) console.log('   ', s);
    console.log('liaisons a controler :', bad.length ? '' : 'aucune', approx ? '(' + approx + ' bouts au centre du batiment, connecteur non lu)' : '');
    for (const s of bad) console.log('   ', s);
    if (maxSlope.key) console.log('pente de tuyau la plus forte :', maxSlope.v.toFixed(2), '(' + maxSlope.key + ')');
    const longs = [];
    for (const w of PLAN_WIRES) {
      const a = isPlan(w.from) ? PLAN[w.from.slice(5)].at : (await call('pose', w.from)).location;
      const b = isPlan(w.to) ? PLAN[w.to.slice(5)].at : (await call('pose', w.to)).location;
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (L > 7000) longs.push(w.key + ' : ' + m(L) + ' m');
    }
    console.log('cables de plus de 70 m :', longs.length ? '' : 'aucun');
    for (const s of longs) console.log('   ', s);
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
