// Atelier de silice commun du nucleaire au-dessus de l'usine de beton (utilisateur, 27/10/2026 : « ok prends le 113 et pose
// l'atelier de silice » ; « on peut tres bien l'envoyer ailleurs, j'impose rien ») : 1 680 silice/min (2 520 pour les 3,5
// modules, dont 840 deja par N279). Recette lue en jeu : Cheap Silica (Recipe_Alternate_Silica_C), 22,5 quartz + 37,5
// calcaire -> 52,5 silice par assembleuse ; 32 assembleuses, 720 quartz + 1 200 calcaire par minute.
// Place au-dessus de l'usine de beton (etage 2, +64 m : rien n'y depasse 62 m) : la silice et le beton iront ensemble vers
// la zone nucleaire (meme couloir, convoyeurs en pile) ; la ligne de quartz de l'utilisateur y arrive deja.
//  - piles (pile.js) : 8 piles de 4 etages, axe y -150 000, x -84 600 .. -73 400, dos au sud ; arrivees a 26 m au sud de
//    l'axe, quartz (Input0) a +67 m, calcaire (Input1) a +71 m, vers l'est ; collecteur 17 m au nord, sortie a l'ouest ;
//    courant depuis le poteau Ph0 de l'usine de beton (etage haut) ;
//  - colonnes sur la plage ouest (rien de construit), a cote de la fin de la ligne de quartz de l'utilisateur : fusionneur
//    U au pied (-14,7 m), V (+26 m) et W (sommet) a la meme verticale, deux ascenseurs (le premier d'un cote, le second a
//    l'ouest, montage de la colonne de l'atelier de dissipateurs) ; quartz au sud (y -146 700), calcaire au nord
//    (y -147 500) ;
//  - lignes hautes de W aux tetes des arrivees, a +67 / +71 m, relais en l'air tous les 40 m au plus ;
//  - quartz : fin de la ligne de l'utilisateur (Build_ConveyorBeltMk6_C_2144884916) -> U ;
//  - calcaire : foreuse du gisement 113 (pur, 1 200/min a 250 %) orientee par le chemin (foreuses.js --ligne-vers
//    <U du calcaire>.Input3), ligne posee par beltline.js.
// usage : node atelier-silice.js piles [etapes pile.js] | colonnes | foreuse | ligne | verifie [--dry]
// Etat : atelier-silice-state.json ; piles : atelier-silice-pile-state.json (non versionnes).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = { merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C' };
const QUARTZ_END = PREFIX + 'Build_ConveyorBeltMk6_C_2144884916'; // fin de la ligne de quartz de l'utilisateur (ConveyorAny1 libre)
const TOP = 6400;
// colonnes : pied, relais du milieu, sommet (hauteur de l'arrivee) ; side : cote du premier ascenseur
const COLS = {
  quartz: { x: -93900, y: -146700, top: TOP + 300, arrivee: 0, side: 'sud' },
  calcaire: { x: -93900, y: -147500, top: TOP + 700, arrivee: 1, side: 'nord' },
};
const FOOT = -1470;
const SPAN = 4000; // relais des lignes hautes : 40 m au plus

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'atelier-silice-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
const PILE = path.join(__dirname, 'atelier-silice-pile-state.json');

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
  if (!from || !to) { if (!DRY) console.log(key.padEnd(36), 'saute (bout absent)'); return null; }
  const r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
// Tete d'une ligne d'arrivee de pile.js (flux vers l'est) : son repartiteur le plus a l'ouest
async function head(i) {
  const parts = JSON.parse(fs.readFileSync(PILE, 'utf8')).parts;
  let best = null;
  for (const [k, a] of Object.entries(parts)) {
    if (!new RegExp('^arrivee ' + i + ' pile ').test(k)) continue;
    const p = (await call('pose', a)).location;
    if (!best || p.x < best.p.x) best = { a, p };
  }
  if (!best) throw new Error('arrivee ' + i + ' : aucun repartiteur dans ' + path.basename(PILE));
  return best;
}

const PHASES = {
  // Piles (pile.js), zone chargee par une source de streaming le temps de la pose
  async piles() {
    const steps = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'machines,raccords,branches,ascenseurs,arrivees,collecteur,recettes,courant').split(',');
    const file = path.join(__dirname, 'atelier-silice-config-state.json');
    const T = require('./tracer');
    const src = await T.loadArea({ x0: -87000, y0: -153000, x1: -71000, y1: -146000 });
    try {
      for (const s of steps) {
        const out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
        const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
        console.log(s.padEnd(36), bad.length ? bad.slice(0, 3).join(' / ') : 'ok');
      }
    } finally { await call('streamingSourceRemove', src); }
  },

  // Colonnes de la plage et lignes hautes jusqu'aux tetes des arrivees ; quartz de l'utilisateur jusqu'a son pied
  async colonnes() {
    const T = require('./tracer');
    const src = await T.loadArea({ x0: -96000, y0: -149000, x1: -84000, y1: -145000 });
    try {
      for (const [n, c] of Object.entries(COLS)) {
        const sud = c.side === 'sud', mid = Math.round((FOOT + c.top) / 2);
        // U : sortie (Output1) du cote du premier ascenseur, entree de cote a l'ouest (Input2 au cap 90, Input3 au cap -90)
        const U = await build(n + ' pied', REC.merger, { x: c.x, y: c.y, z: FOOT }, sud ? 90 : -90);
        // V (cap 180) : entree du cote du premier ascenseur (Input3 au sud, Input2 au nord), sortie a l'ouest
        const V = await build(n + ' milieu', REC.merger, { x: c.x, y: c.y, z: mid }, 180);
        // W (cap 0) : entree a l'ouest (Input1), sortie a l'est
        const W = await build(n + ' sommet', REC.merger, { x: c.x, y: c.y, z: c.top }, 0);
        await link(n + ' montee 1', REC.lift, U, 'Output1', V, sud ? 'Input3' : 'Input2', { snapTolerance: 400 });
        await link(n + ' montee 2', REC.lift, V, 'Output1', W, 'Input1', { snapTolerance: 400 });
        // ligne haute : relais (cap 0) regulierement espaces de W a la tete de l'arrivee
        const H = await head(c.arrivee), a = { x: c.x, y: c.y }, b = H.p;
        const L = Math.hypot(b.x - a.x, b.y - a.y), k = Math.ceil(L / SPAN);
        let prev = W;
        for (let i = 1; i < k; i++) {
          const R = await build(n + ' relais ' + i, REC.merger, { x: Math.round(a.x + ((b.x - a.x) * i) / k), y: Math.round(a.y + ((b.y - a.y) * i) / k), z: c.top }, 0);
          await link(n + ' haut ' + (i - 1) + ' > ' + i, REC.belt, prev, 'Output1', R, 'Input1');
          prev = R;
        }
        await link(n + ' haut > tete', REC.belt, prev, 'Output1', H.a, 'Input1');
      }
      // fin de la ligne de quartz de l'utilisateur -> pied du quartz (entree ouest)
      await link('quartz utilisateur > pied', REC.belt, QUARTZ_END, 'ConveyorAny1', st.actors['quartz pied'], 'Input2');
    } finally { await call('streamingSourceRemove', src); }
  },

  // Foreuse du gisement 113, orientee par le chemin de sa ligne jusqu'au pied du calcaire (foreuses.js)
  async foreuse() {
    const U = st.actors['calcaire pied'];
    if (!U) throw new Error('pas de pied du calcaire (phase colonnes)');
    const out = execFileSync(process.execPath, [path.join(__dirname, 'foreuses.js'), '113', '--ligne-vers', short(U) + '.Input3', '--ligne-nom', 'silice-113', '--nom', 'calcaire-silice'].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
    console.log(out.split('\n').filter((l) => !/^relief \d|^$/.test(l)).join('\n'));
  },

  // Ligne du 113 (beltline.js)
  async ligne() {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'beltline.js'), 'traces/silice-113-ligne.json', DRY ? 'check' : 'build', '--nom', 'silice-113-sol'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    console.log(out.trim().split('\n').slice(-6).join('\n'));
  },

  async verifie() {
    const p = fs.existsSync(PILE) ? JSON.parse(fs.readFileSync(PILE, 'utf8')) : { machines: {} };
    console.log('piles :', Object.keys(p.machines || {}).length, 'machines,', Object.keys(p.poles || {}).length, 'poteaux');
    for (const [key, a] of Object.entries(st.actors)) {
      const free = (await call('connections', a)).filter((k) => !k.connected).map((k) => k.name);
      if (free.length) console.log(key.padEnd(36), 'libres :', free.join(' '));
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node atelier-silice.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
