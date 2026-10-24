// Unites de rotors de la metallurgie (mer du nord), 56,25 rotors / min chacune, sans fondations (accord utilisateur
// 22/10/2026) : emplacement 1 = unite A (etage 1, base 0 m) + unite B (etage 1 bis, +32 m), emplacement 2 = unite C
// (etage 1), 60 m plus au nord. Une unite = une rangee de 12 raffineries (pas de 12 m), d'ouest en est :
//  - 4 lingots de fer purs (k 0-3, 94 %) et 3 lingots de cuivre purs (k 4-6) : entrees au sud (minerai 5 m devant,
//    eau 10 m devant et 5 m plus haut), sorties au nord ;
//  - 5 toles vapeur (k 7-11), RETOURNEES : entrees au nord, ou le collecteur du cuivre (k 4-6, vers l'est) devient
//    leur ligne d'entree ; eau au nord ; sorties au sud (collecteur des toles vers l'est) ;
//  - collecteur du fer (k 0-3) vers l'ouest ;
//  - etage 0 : un extracteur a 100 % par ligne d'eau (sud a l'ouest, nord a l'est) ; pompe Mk1 (etage 1) ou Mk2 (1 bis) ;
//  - piles (pile.js) : 4 piles de 6 constructeurs de vis (81,25 %) et 1 pile de 6 assembleuses de rotors (83,3 %),
//    a +64 m pour les unites A et C, a +124 m pour l'unite B (au-dessus de celles de A).
// Le fer monte par l'ouest (relais x 69 600 pour A et C, 71 000 pour B), les toles par l'est (87 400 / 86 200).
// usage : node module-rotors.js <phase> [--emplacement 1|2] [--dry]
//   phases : extracteurs | raffineries | eau | colonnes | pompes | minerai | cuivre | collecteurs | montees | courant
//            | piles | liaisons | reglages | sortie | verifie
// Etat : rotors<e>-state.json a cote de ce fichier (non versionne) ; piles : rotors<e>-<unite>-<V|R>-pile-state.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const argOf = (name) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const EMP = Number(argOf('emplacement') || 1);
const NAME = 'rotors' + EMP;
const DY = -6000 * (EMP - 1);
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const WATER_VOLUME = PREFIX + 'FGWaterVolume_7';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  refinery: 'Recipe_OilRefinery_C', extractor: 'Recipe_WaterPump_C', junction: 'Recipe_PipelineJunction_Cross_C',
  pipe: 'Recipe_PipelineMK2_C', pump1: 'Recipe_PipelinePump_C', pump2: 'Recipe_PipelinePumpMK2_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C', pole: 'Recipe_PowerPoleMk3_C',
  iron: 'Recipe_Alternate_PureIronIngot_C', copper: 'Recipe_Alternate_PureCopperIngot_C', sheet: 'Recipe_Alternate_SteamedCopperSheet_C',
};

// --- Geometrie ---------------------------------------------------------------------------------------
// Rotors deplaces de 84 m vers l'est pour rejoindre les stators, juste au nord de hub0-est2 (accord utilisateur
// 22/10/2026 : « ok deplace les rotors vers l'est ») ; toutes les abscisses ci-dessous sont decalees de DX.
const DX = 8400;
const X = (k) => 72200 + DX + 1200 * k;        // raffinerie k (0 = ouest)
const K = [...Array(12).keys()];
const TYPE = (k) => (k <= 3 ? 'fer' : k <= 6 ? 'cuivre' : 'toles');
const YC = -271500 + DY;                        // centre des raffineries
const Y_S = YC + 1400, Y_SW = YC + 1900;        // sud : minerai / collecteur des toles ; eau (fer + cuivre)
const Y_N = YC - 1400, Y_NW = YC - 1900;        // nord : collecteur du fer, cuivre -> toles ; eau (toles)
const Y_W = YC - 500;                           // rangee des piles de vis (repere de pile.js)
const UNITS = EMP === 1
  // vis / toles : hauteurs (m) des deux arrivees des assembleuses ; B inverse pour que la colonne des toles tienne en
  // deux ascenseurs de 47 m (+33 -> +80 -> +127)
  ? { A: { lv: '1', zb: 0, zp: 6400, vis: 3, toles: 7 }, B: { lv: '1b', zb: 3200, zp: 12400, vis: 7, toles: 3 } }
  : { C: { lv: '1', zb: 0, zp: 6400, vis: 3, toles: 7 } };
// Extracteurs : emprise optimisee (regle utilisateur du 22/10/2026) : un extracteur par ligne d'eau, SOUS la bande de
// la ligne, juste sous une jonction de colonne ajoutee dans la ligne (entre les jonctions `after` et `after + 1`) ;
// sortie 4,6 m devant son centre, tournee vers la jonction, a ~3 m d'elle a l'horizontale (« une pompe a eau devrait
// presque extraire a sa verticale ») ; pompe Mk1 (etage 1) ou Mk2 (etage 1 bis, 52 m de montee).
const COMPACT = true;
const EXTRACTORS = {
  S: { lv: '1', x: X(2) + 400, scroll: 0, y: Y_SW + 860, side: 'sud', riser: { after: 2, port: 'Connection2' } },
  N: { lv: '1', x: X(9) + 800, scroll: 180, y: Y_NW - 860, side: 'nord', riser: { after: 9, port: 'Connection3' } },
  Sb: { lv: '1b', x: X(4) + 400, scroll: 0, y: Y_SW + 860, side: 'sud', riser: { after: 4, port: 'Connection2' } },
  Nb: { lv: '1b', x: X(7) + 800, scroll: 180, y: Y_NW - 860, side: 'nord', riser: { after: 7, port: 'Connection3' } },
};
const POLE_Y = YC - 2300;
const POLES_X = [70400 + DX, 78200 + DX, 86000 + DX];
const GRID_POLE = PREFIX + 'Build_PowerPoleMk1_C_2144801248'; // poteau du reseau pres de hub0-est2 (91 198 ; -262 795)

// --- Etat ---------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, NAME + '-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(34), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
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
  if (!from || !to) { console.log(key.padEnd(34), 'saute (bout absent)'); return null; }
  const r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
const LIFT = { snapTolerance: 400 };
const A = (key) => st.actors[key];
const ref = (lv, k) => A('raffinerie ' + lv + '-' + k);
const unitsOf = () => Object.entries(UNITS);
const lvs = () => unitsOf().map(([, u]) => u.lv);
const zbOf = (lv) => unitsOf().find(([, u]) => u.lv === lv)[1].zb;
const pileState = (u, g) => JSON.parse(fs.readFileSync(path.join(__dirname, NAME + '-' + u + '-' + g + '-pile-state.json'), 'utf8'));

// Acteur relie au connecteur `name` (mConnectedComponent lu par reflexion), ou null
async function partner(actor, name) {
  const d = await call('dump', actor + '.' + name, 1, 5, ['mConnectedComponent']);
  const c = d.mConnectedComponent;
  return c && typeof c === 'string' ? c.slice(0, c.lastIndexOf('.')) : null;
}
// Point du tuyau a l'altitude z (points de courbe en repere monde, interpolation entre les deux qui l'encadrent)
async function pointAtZ(pipe, z) {
  const pose = await call('pose', pipe);
  const p = pose[0] || pose;
  const yaw = p.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = p.location;
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData.map((q) => ({ x: o.x + q.Location.X * c - q.Location.Y * s, y: o.y + q.Location.X * s + q.Location.Y * c, z: o.z + q.Location.Z }));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.z - z) * (b.z - z) <= 0 && a.z !== b.z) { const t = (z - a.z) / (b.z - a.z); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z }; }
  }
  throw new Error(short(pipe) + ' : aucun point a z ' + z);
}

async function pointOnPipe(pipe, f) {
  const c = await call('connections', pipe);
  const a = c.find((q) => q.name === 'PipelineConnection0').location, b = c.find((q) => q.name === 'PipelineConnection1').location;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
}

const PHASES = {
  async extracteurs() {
    for (const [n, e] of Object.entries(EXTRACTORS)) {
      if (!lvs().includes(e.lv)) continue;
      const key = 'extracteur ' + n;
      if (A(key)) continue;
      const r = await call('buildAim', REC.extractor, { x: e.x, y: e.y, z: 1000 }, { x: e.x, y: e.y, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: e.scroll });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // fer et cuivre au cap 0 (entrees au sud), toles retournees (cap 180, entrees au nord)
  async raffineries() {
    for (const lv of lvs()) for (const k of K) await build('raffinerie ' + lv + '-' + k, REC.refinery, { x: X(k), y: YC, z: zbOf(lv) }, TYPE(k) === 'toles' ? 180 : 0);
  },

  // Lignes d'eau : sud (k 0-6) jonctions a x - 2 m, branche Connection3 (nord) ; nord (k 7-11) a x + 2 m, branche
  // Connection2 (sud) ; jonctions chainees d'ouest en est
  async eau() {
    for (const lv of lvs()) {
      const zb = zbOf(lv);
      for (const k of K) {
        const sud = TYPE(k) !== 'toles';
        await build('jonction ' + lv + '-' + k, REC.junction, { x: X(k) + (sud ? -200 : 200), y: sud ? Y_SW : Y_NW, z: zb + 500 }, 0);
      }
      // jonctions des colonnes (emprise optimisee) : inserees dans la ligne, sous le niveau des extracteurs
      const risers = {};
      for (const [n, e] of Object.entries(EXTRACTORS)) {
        if (e.lv !== lv || !e.riser) continue;
        risers[e.riser.after] = await build('jonction colonne ' + n, REC.junction, { x: e.x, y: e.side === 'sud' ? Y_SW : Y_NW, z: zb + 500 }, 0);
      }
      for (const k of K.slice(1)) {
        if ((TYPE(k) === 'toles') !== (TYPE(k - 1) === 'toles')) continue; // deux lignes separees
        const a = A('jonction ' + lv + '-' + (k - 1)), b = A('jonction ' + lv + '-' + k), r = risers[k - 1];
        if (r) {
          await link('eau ' + lv + ' ' + (k - 1) + '>colonne', REC.pipe, a, 'Connection1', r, 'Connection0');
          await link('eau ' + lv + ' colonne>' + k, REC.pipe, r, 'Connection1', b, 'Connection0');
        } else await link('eau ' + lv + ' ' + (k - 1) + '>' + k, REC.pipe, a, 'Connection1', b, 'Connection0');
      }
      for (const k of K) await link('eau ' + lv + ' >raffinerie ' + k, REC.pipe, A('jonction ' + lv + '-' + k), TYPE(k) === 'toles' ? 'Connection2' : 'Connection3', ref(lv, k), 'PipeInputFactory');
    }
  },

  async colonnes() {
    for (const [n, e] of Object.entries(EXTRACTORS)) {
      if (!lvs().includes(e.lv)) continue;
      const ex = A('extracteur ' + n);
      if (e.riser) { await link('colonne ' + n, REC.pipe, ex, 'FGPipeConnectionFactory', A('jonction colonne ' + n), e.riser.port); continue; }
      const head = e.side === 'sud' ? { j: A('jonction ' + e.lv + '-0'), port: 'Connection0' } : { j: A('jonction ' + e.lv + '-11'), port: 'Connection1' };
      if (!e.mid) { await link('colonne ' + n, REC.pipe, ex, 'FGPipeConnectionFactory', head.j, head.port); continue; }
      const mid = await build('appui ' + n, REC.junction, { x: e.mid, y: e.y, z: 1500 }, 0);
      const [inP, outP] = e.side === 'sud' ? ['Connection0', 'Connection1'] : ['Connection1', 'Connection0'];
      await link('colonne ' + n + ' bas', REC.pipe, ex, 'FGPipeConnectionFactory', mid, inP);
      await link('colonne ' + n + ' haut', REC.pipe, mid, outP, head.j, head.port);
    }
  },

  // Pompes des colonnes verticales, posees a une ALTITUDE (pas a une fraction du tuyau) : l'extracteur ne pousse l'eau
  // qu'a 10 m au-dessus de sa sortie (-14,9 m -> -4,9 m), la premiere pompe doit etre plus bas (verifie le 22/10/2026 :
  // Mk2 a -1,9 m = etage 1 bis sans eau). Etage 1 : Mk1 a -10 m (-> +10 m). Etage 1 bis : Mk2 a -12,5 m (-> +37,5 m)
  // puis Mk1 a +20 m sur le tuyau du haut (-> +40 m ; ligne d'eau a +37 m). Correction des colonnes deja posees :
  // pompes-colonnes.js.
  async pompes() {
    for (const [n, e] of Object.entries(EXTRACTORS)) {
      if (!lvs().includes(e.lv)) continue;
      const steps = e.lv === '1b' ? [['pompe ' + n, REC.pump2, -1250], ['pompe haute ' + n, REC.pump1, 2000]] : [['pompe ' + n, REC.pump1, -1000]];
      let pipe = st.links['colonne ' + n];
      for (const [key, recipe, z] of steps) {
        if (A(key)) { pipe = await partner(A(key), 'Connection1'); continue; }
        if (!pipe) { console.log(key.padEnd(34), 'saute (colonne absente)'); break; }
        const p = await pointAtZ(pipe, z);
        const r = await call('buildAim', recipe, { x: p.x, y: p.y, z: p.z + 1000 }, p, { dryRun: DRY, onActor: pipe });
        report(key, r);
        if (!r.built) break;
        st.actors[key] = r.actor; save();
        await new Promise((res) => setTimeout(res, 2500)); // le jeu coupe le tuyau aux images suivantes
        pipe = await partner(r.actor, 'Connection1');
      }
    }
  },

  // Minerai (sud, vers l'est) : fer k 0-3, cuivre k 4-6, repartiteur devant chaque entree (sortie Output3 au nord).
  // Tetes : fer (70 800 ; Y_S) partage avec l'etage 1 bis par ascenseur au nord ; cuivre (76 500 ; Y_S + 12 m) par
  // ascenseur au sud. A l'emplacement 2 (une seule unite), les memes tetes sans etage 1 bis.
  async minerai() {
    const two = lvs().length === 2;
    const fe = await build('tete fer bas', REC.splitter, { x: 70800 + DX, y: Y_S, z: 100 }, 0);
    const cu = await build('tete cuivre bas', REC.splitter, { x: 76500 + DX, y: Y_S + 1200, z: 100 }, 180);
    let feb = null, cub = null;
    if (two) {
      feb = await build('tete fer haut', REC.splitter, { x: 70800 + DX, y: Y_S, z: 3300 }, 90);
      cub = await build('tete cuivre haut', REC.splitter, { x: 76500 + DX, y: Y_S + 1200, z: 3300 }, -90);
      await link('fer tete > etage 1 bis', REC.lift, fe, 'Output3', feb, 'Input1', LIFT);
      await link('cuivre tete > etage 1 bis', REC.lift, cu, 'Output3', cub, 'Input1', LIFT);
    }
    for (const lv of lvs()) {
      const zb = zbOf(lv);
      for (const k of K) if (TYPE(k) !== 'toles') await build('repartiteur ' + lv + '-' + k, REC.splitter, { x: X(k) + 200, y: Y_S, z: zb + 100 }, 0);
      const s = (k) => A('repartiteur ' + lv + '-' + k);
      const low = lv === '1';
      await link('fer ' + lv + ' tete', REC.belt, low ? fe : feb, low ? 'Output1' : 'Output3', s(0), 'Input1');
      await link('cuivre ' + lv + ' tete', REC.belt, low ? cu : cub, low ? 'Output2' : 'Output1', s(4), 'Input1');
      for (const k of [1, 2, 3, 5, 6]) await link('minerai ' + lv + ' ' + (k - 1) + '>' + k, REC.belt, s(k - 1), 'Output1', s(k), 'Input1');
      for (const k of K) if (TYPE(k) !== 'toles') await link('minerai ' + lv + ' >raffinerie ' + k, REC.belt, s(k), 'Output3', ref(lv, k), 'Input0');
    }
  },

  // Cuivre -> toles (nord, vers l'est) : fusionneurs devant les sorties du cuivre, puis repartiteurs devant les
  // entrees des toles (sortie Output2 au sud)
  async cuivre() {
    for (const lv of lvs()) {
      const zb = zbOf(lv);
      for (const k of [4, 5, 6]) {
        await build('fusion cuivre ' + lv + '-' + k, REC.merger, { x: X(k) + 200, y: Y_N, z: zb + 100 }, 0);
        await link('cuivre ' + lv + ' raffinerie ' + k, REC.belt, ref(lv, k), 'Output1', A('fusion cuivre ' + lv + '-' + k), 'Input2');
      }
      for (const k of [7, 8, 9, 10, 11]) await build('repartiteur toles ' + lv + '-' + k, REC.splitter, { x: X(k) - 200, y: Y_N, z: zb + 100 }, 0);
      const node = (k) => (k <= 6 ? A('fusion cuivre ' + lv + '-' + k) : A('repartiteur toles ' + lv + '-' + k));
      for (const k of [5, 6, 7, 8, 9, 10, 11]) await link('cuivre ' + lv + ' ' + (k - 1) + '>' + k, REC.belt, node(k - 1), 'Output1', node(k), 'Input1');
      for (const k of [7, 8, 9, 10, 11]) await link('toles ' + lv + ' >raffinerie ' + k, REC.belt, node(k), 'Output2', ref(lv, k), 'Input0');
    }
  },

  // Collecteurs : fer (nord, vers l'ouest, entree Input3 au sud) ; toles (sud, vers l'est, entree Input3 au nord)
  async collecteurs() {
    for (const lv of lvs()) {
      const zb = zbOf(lv);
      for (const k of [0, 1, 2, 3]) {
        await build('fusion fer ' + lv + '-' + k, REC.merger, { x: X(k) + 200, y: Y_N, z: zb + 100 }, 180);
        await link('fer ' + lv + ' raffinerie ' + k, REC.belt, ref(lv, k), 'Output1', A('fusion fer ' + lv + '-' + k), 'Input3');
      }
      for (const k of [3, 2, 1]) await link('fer ' + lv + ' ' + k + '>' + (k - 1), REC.belt, A('fusion fer ' + lv + '-' + k), 'Output1', A('fusion fer ' + lv + '-' + (k - 1)), 'Input1');
      for (const k of [7, 8, 9, 10, 11]) {
        await build('fusion toles ' + lv + '-' + k, REC.merger, { x: X(k) - 200, y: Y_S, z: zb + 100 }, 0);
        await link('toles ' + lv + ' raffinerie ' + k, REC.belt, ref(lv, k), 'Output1', A('fusion toles ' + lv + '-' + k), 'Input3');
      }
      for (const k of [8, 9, 10, 11]) await link('toles ' + lv + ' ' + (k - 1) + '>' + k, REC.belt, A('fusion toles ' + lv + '-' + (k - 1)), 'Output1', A('fusion toles ' + lv + '-' + k), 'Input1');
    }
  },

  // Colonnes de montee (relais = fusionneurs, ascenseurs de 48 m au plus, multiples de 1 m) :
  //  fer  A/C : 0 -> +32 -> +66 (arrivee des vis a 3 m) ; B : +32 -> +79 -> +126 (arrivee a 3 m de +124) ;
  //  toles A/C : 0 -> +32 -> +70 (arrivee a 7 m) ; B : +32 -> +79 -> +126 (arrivee a 3 m)
  async montees() {
    for (const [u, un] of unitsOf()) {
      const zb = un.zb, zp = un.zp;
      // B a l'interieur des colonnes de A (ses convoyeurs a +33 m ne croisent pas les relais de A)
      const feX = (u === 'B' ? 71000 : 69600) + DX, toX = (u === 'B' ? 86200 : 87400) + DX;
      const feTop = zp + 300, toTop = zp + un.toles * 100;  // arrivee des vis toujours a 3 m
      const feMid = u === 'B' ? zb + 100 + 4700 : zb + 100 + 3200, toMid = u === 'B' ? zb + 100 + 4700 : zb + 100 + 3200;
      // fer : collecteur (vers l'ouest) -> R1 (cap 180, sortie ouest) -> ascenseur -> R2 (cap 0, entree Input1 a
      // l'ouest, sortie est) -> ascenseur -> R3 (cap 90 : entree Input3 a l'est, sortie au sud vers l'arrivee des vis)
      const f1 = await build(u + ' fer R1', REC.merger, { x: feX, y: Y_N, z: zb + 100 }, 180);
      const f2 = await build(u + ' fer R2', REC.merger, { x: feX, y: Y_N, z: feMid }, 0);
      const f3 = await build(u + ' fer R3', REC.merger, { x: feX, y: Y_N, z: feTop }, 90);
      await link(u + ' fer > R1', REC.belt, A('fusion fer ' + un.lv + '-0'), 'Output1', f1, 'Input1');
      await link(u + ' fer R1 > R2', REC.lift, f1, 'Output1', f2, 'Input1', LIFT);
      await link(u + ' fer R2 > R3', REC.lift, f2, 'Output1', f3, 'Input3', LIFT);
      // toles : collecteur (vers l'est) -> T1 (cap 0, sortie est) -> ascenseur -> T2 (cap 180 : entree Input1 a l'est,
      // sortie ouest) -> ascenseur -> T3 (cap -90 : entree Input3 a l'ouest, sortie au nord vers les assembleuses)
      const t1 = await build(u + ' toles T1', REC.merger, { x: toX, y: Y_S, z: zb + 100 }, 0);
      const t2 = await build(u + ' toles T2', REC.merger, { x: toX, y: Y_S, z: toMid }, 180);
      const t3 = await build(u + ' toles T3', REC.merger, { x: toX, y: Y_S, z: toTop }, -90);
      await link(u + ' toles > T1', REC.belt, A('fusion toles ' + un.lv + '-11'), 'Output1', t1, 'Input1');
      await link(u + ' toles T1 > T2', REC.lift, t1, 'Output1', t2, 'Input1', LIFT);
      await link(u + ' toles T2 > T3', REC.lift, t2, 'Output1', t3, 'Input3', LIFT);
    }
  },

  async courant() {
    const p = (n) => A('poteau ' + n);
    const plan = [];
    for (const lv of lvs()) {
      const zb = zbOf(lv);
      for (const [i, x] of POLES_X.entries()) await build('poteau ' + lv + '-' + i, REC.pole, { x, y: POLE_Y, z: zb }, 0);
      plan.push([lv + '-1', lv + '-0'], [lv + '-1', lv + '-2']);
      for (const k of K) plan.push([lv + '-' + Math.floor(k / 4), 'raffinerie ' + lv + '-' + k]);
    }
    if (lvs().length === 2) plan.push(['1-1', '1b-1']);
    if (EMP === 1) {
      await build('poteau reseau', REC.pole, { x: 93000, y: -268200, z: 0 }, 0);
      plan.push(['reseau', GRID_POLE], ['reseau', '1-2']);
    } else {
      plan.push(['1-1', JSON.parse(fs.readFileSync(path.join(__dirname, 'rotors' + (EMP - 1) + '-state.json'), 'utf8')).actors['poteau 1-1']]);
    }
    for (const [n, e] of Object.entries(EXTRACTORS)) {
      if (!lvs().includes(e.lv)) continue;
      const pole = e.side === 'sud' ? '1-0' : '1-2';
      plan.push([pole, 'extracteur ' + n], [pole, 'pompe ' + n]);
    }
    for (const [a, b] of plan) {
      const key = a + '>' + b;
      if (st.wires[key]) continue;
      const from = p(a), to = b.startsWith('/Game') ? b : (p(b) || A(b));
      if (!from || !to) { console.log(('cable ' + key).padEnd(34), 'saute (bout absent)'); continue; }
      const r = await call('wire', from, to, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor; save(); }
    }
  },

  // Piles par pile.js : vis (V) et rotors (R) de chaque unite
  async piles() {
    const phase = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'tout';
    for (const [u, un] of unitsOf()) {
      const cfgs = {
        // vis : piles de x 72 400 a 77 200 (centre 74 800) ; rotors : x 82 000 (convoyeur vis -> rotors de 44 m)
        V: { recette: 'Recipe_Alternate_Screw_C', centre: [26, 0], piles: 4, dos: 'y', arrivees: [{ entree: 'Input0', hauteur: 3, sens: '-lx' }], collecteur: { sens: '-lx' } },
        R: { recette: 'Recipe_Alternate_CopperRotor_C', centre: [98, 11], piles: 1, dos: '-y', arrivees: [{ entree: 'Input1', hauteur: un.vis, sens: '+lx' }, { entree: 'Input0', hauteur: un.toles, sens: '-lx' }], collecteur: { sens: '+lx' } },
      };
      for (const [g, c] of Object.entries(cfgs)) {
        if (process.env.GROUPE && process.env.GROUPE !== u + g) continue;
        // reseau : poteau du milieu de l'etage des raffineries de l'unite (A, C) ; B : premier poteau des vis de A
        const reseau = u === 'B' ? pileState('A', 'V').poles['poteau 0'] : A('poteau ' + un.lv + '-1');
        const cfg = Object.assign({ nom: NAME + '-' + u + '-' + g, plateforme: { origine: { x: 72200 + DX, y: Y_W }, cap: 0, dessus: un.zp }, etages: 6, pas: 16, espacement: 10, reseau, enLAir: true }, c);
        const file = path.join(__dirname, NAME + '-' + u + '-' + g + '-config-state.json'); // genere : ignore comme les etats
        fs.writeFileSync(file, JSON.stringify(cfg, null, 1) + '\n');
        console.log('=== piles ' + u + g + ' : ' + phase);
        const args = [path.join(__dirname, 'pile.js'), phase, '--config', file].concat(DRY ? ['--dry'] : []);
        process.stdout.write(execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
      }
    }
  },

  // Raccords : fer -> arrivee des vis ; vis -> assembleuses ; toles -> assembleuses
  async liaisons() {
    for (const [u] of unitsOf()) {
      const V = pileState(u, 'V'), R = pileState(u, 'R');
      await link(u + ' fer R3 > vis', REC.belt, A(u + ' fer R3'), 'Output1', V.parts['arrivee 0 pile 3'], 'Input1');
      await link(u + ' vis > rotors', REC.belt, V.parts['collecteur pile 0'], 'Output1', R.parts['arrivee 0 pile 0'], 'Input1');
      // toles : colonne (x 87 400 / 86 200) -> relais a mi-chemin (convoyeurs de 56 m au plus) -> arrivee des assembleuses
      const head = R.parts['arrivee 1 pile 0'];
      const a = (await call('connections', A(u + ' toles T3'))).find((q) => q.name === 'Output1').location;
      const b = (await call('connections', head)).find((q) => q.name === 'Input1').location;
      const mid = await build(u + ' toles relais', REC.merger, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), z: Math.round(b.z) }, 180);
      await link(u + ' toles T3 > relais', REC.belt, A(u + ' toles T3'), 'Output1', mid, 'Input1');
      await link(u + ' toles relais > rotors', REC.belt, mid, 'Output1', head, 'Input1');
    }
  },

  async reglages() {
    const rec = { fer: REC.iron, cuivre: REC.copper, toles: REC.sheet };
    for (const lv of lvs()) for (const k of K) {
      const r = await call('setRecipe', ref(lv, k), rec[TYPE(k)]);
      if (TYPE(k) === 'fer') await call('setClock', ref(lv, k), 0.9375);
      console.log(('raffinerie ' + lv + '-' + k).padEnd(34), r.recipe, 'courant', r.power && r.power.hasPower);
    }
    for (const [u] of unitsOf()) for (const [g, clock] of [['V', 0.8125], ['R', 56.25 / 67.5]]) {
      for (const m of Object.values(pileState(u, g).machines)) await call('setClock', m, clock);
      console.log(u + g, 'cadence', clock);
    }
  },

  async verifie() {
    const problems = [];
    let n = 0;
    for (const [key, a] of [...Object.entries(st.actors), ...Object.entries(st.links)]) {
      let c;
      try { c = await call('connections', a); } catch (e) { if (/introuvable/.test(e.message)) continue; throw e; }
      n++;
      const free = c.filter((q) => !q.connected).map((q) => q.name);
      if (/^raffinerie/.test(key)) { if (free.some((f) => f !== 'PipeOutputFactory')) problems.push(key + ' : libres ' + free.join(' ')); continue; }
      if (/^(extracteur|pompe)/.test(key) || st.links[key]) { if (free.length) problems.push(key + ' : libres ' + free.join(' ')); }
    }
    console.log(n + ' pieces controlees');
    console.log(problems.length ? 'PROBLEMES :\n  ' + problems.join('\n  ') : 'aucun probleme');
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node module-rotors.js <' + Object.keys(PHASES).join('|') + '> [--emplacement 1|2] [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
