// Demolition d'une zone en deux temps : inventaire d'une bulle (tout ce qui s'y trouve, fondations comprises), relu
// avant d'agir, puis demolition de l'inventaire par lots (un appel au jeu pour 150 batiments).
//
// Usage :
//   node bulle.js inventaire <centre> <rayon m> [--sans <regex>] [--tout] [--out <fichier>]
//   node bulle.js demolir <fichier> [--sans <regex>]
//   node bulle.js surligner <fichier> [--off] [--couleur OC_RED]   contour du pistolet de demontage sur les batiments
//                                                                   de l'inventaire, pour les voir en jeu avant d'agir
//   node bulle.js voir <centre> <rayon m>    sphere d'hologramme qui montre la bulle (decor non sauvegarde)
//   node bulle.js cacher                     retire la sphere
//
// <centre> : x,y,z (uu), nom d'acteur, "joueur", ou "balise:<nom>" (balise de la carte du jeu)
// --sans   : classes a laisser (ex. 'RailroadTrack') ; s'ajoute a l'inventaire ou a la demolition
// --tout   : ne laisse pas d'office les foreuses et le reseau electrique (laisses par defaut : SANS_DEFAUT)
// --out    : fichier d'inventaire (defaut bulle.json, a cote de ce script) ; c'est l'entree de "demolir"
//
// L'inventaire signale ce qui demande un accord explicite : rails (la ligne peut servir ailleurs), gares, trains,
// extracteurs, generateurs, poteaux et pylones (ils peuvent alimenter des batiments hors de la bulle). La bulle est une
// sphere (distance 3D) ; un convoyeur ou un rail compte s'il commence dedans (position de l'acteur).
// Ordre de demolition : vehicules, convoyeurs et tuyaux, raccords, signaux, batiments, rails, poteaux, pieces legeres.
'use strict';

const fs = require('fs');
const path = require('path');
const { call } = require('./client');
const clearance = require('../../../../data/clearanceData.json');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};

// Classes de pieces legeres candidates : les batiments de structure connus (une classe sans instance est ignoree)
const LW_CLASSES = Object.keys(clearance).filter((n) => /Foundation|Wall|Pillar|Beam|Ramp|Frame|Catwalk|Walkway|Stair|Fence|Roof|Quarter|Corner|Barrier|Railing|Ladder/i.test(n)
  && !/PowerPole|Conveyor|Pipe/i.test(n));
const SENSIBLE = [
  ['rails', /RailroadTrack(?!Integrated)/],
  ['gares et quais', /TrainStation|TrainDockingStation|TrainPlatform/],
  ['trains', /Locomotive|FreightWagon/],
  ['extracteurs', /Miner|WaterPump|OilPump|Fracking/],
  ['generateurs', /Generator/],
  ['poteaux et pylones', /PowerPole|PowerTower/],
];
const ORDER = [
  /Locomotive|FreightWagon/,
  /ConveyorBelt|ConveyorLift|Pipeline(?!Pump|Support|Junction)|PipeHyper/,
  /Attachment|Junction|PipelinePump|Valve/,
  /Signal/,
  /^(?!.*(RailroadTrack|PowerPole|PowerTower|PowerLine)).*$/,
  /RailroadTrack/,
  /PowerLine|PowerPole|PowerTower/,
];
const BATCH = 150;
// Toujours laisses (consigne de l'utilisateur, 22/10/2026) : foreuses (le minerai sera rachemine) et reseau electrique
// (pylones, poteaux, cables), sauf --tout
const SANS_DEFAUT = 'Miner|PowerPole|PowerTower|PowerLine';

const short = (s) => s.split('.').pop();
const cls = (s) => s.replace(/^Build_|_C$/g, '');
function count(items) {
  const o = {};
  for (const i of items) o[cls(i.class)] = (o[cls(i.class)] || 0) + 1;
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
}

async function center(arg) {
  if (/^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(arg)) {
    const [x, y, z] = arg.split(',').map(Number);
    return { x, y, z };
  }
  if (arg === 'joueur') return (await call('player')).eyes.location;
  if (arg.startsWith('balise:')) {
    const manager = (await call('scan', 'FGMapManager', null, 0, 1, {})).items[0];
    const list = (await call('dump', manager.path, 3, 100000, ['mMapMarkers'])).mMapMarkers || [];
    const m = list.find((x) => x.Name === arg.slice(7));
    if (!m) throw new Error('balise introuvable : ' + arg.slice(7));
    return { x: m.Location.X, y: m.Location.Y, z: m.Location.Z };
  }
  const pawn = (await call('player')).pawn.path;
  const full = arg.indexOf('/') >= 0 ? arg : pawn.slice(0, pawn.lastIndexOf('.') + 1) + arg;
  return (await call('pose', full)).location;
}

async function inventaire(where, radiusM) {
  if (!where || !radiusM) throw new Error('usage : inventaire <centre> <rayon m>');
  const tout = argv.indexOf('--tout') >= 0;
  const sans = [tout ? null : SANS_DEFAUT, opt('sans')].filter(Boolean).join('|') || null;
  const out = path.resolve(__dirname, opt('out', 'bulle.json'));
  const c = await center(where);
  const radius = Number(radiusM) * 100;
  const t0 = Date.now();
  const r = await call('bubble', c, radius, LW_CLASSES);
  const re = sans ? new RegExp(sans) : null;
  const actors = r.actors.filter((a) => !re || !re.test(a.class));
  const lightweight = r.lightweight.filter((a) => !re || !re.test(a.class));
  fs.writeFileSync(out, JSON.stringify({ center: c, radius, sans: sans || null, date: new Date().toISOString(), actors, lightweight }, null, 1));
  const alerts = {};
  for (const [label, rx] of SENSIBLE) {
    const n = actors.filter((a) => rx.test(a.class)).length;
    if (n) alerts[label] = n;
  }
  return {
    centre: c, rayon_m: Number(radiusM), duree_s: Math.round((Date.now() - t0) / 100) / 10, fichier: out,
    batiments: actors.length, pieces_legeres: lightweight.length,
    a_valider: alerts, laisses: re ? (r.actors.length - actors.length) + ' batiments, ' + (r.lightweight.length - lightweight.length) + ' pieces legeres' : undefined,
    par_classe: count(actors), pieces_legeres_par_classe: count(lightweight),
  };
}

async function demolir(file) {
  if (!file) throw new Error('usage : demolir <fichier>');
  const sans = opt('sans');
  const re = sans ? new RegExp(sans) : null;
  const inv = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8'));
  const actors = inv.actors.filter((a) => !re || !re.test(a.class));
  const left = new Set(actors.map((a) => a.path));
  const report = [];
  for (const rx of ORDER) {
    const phase = actors.filter((a) => left.has(a.path) && rx.test(a.class));
    if (!phase.length) continue;
    const res = { phase: String(rx), demontes: 0, deja_partis: 0, echecs: [] };
    for (let i = 0; i < phase.length; i += BATCH) {
      const lot = phase.slice(i, i + BATCH);
      const r = await call('dismantleMany', lot.map((a) => a.path), true);
      res.demontes += r.done;
      res.deja_partis += r.gone;
      res.echecs.push(...r.failed);
    }
    for (const a of phase) left.delete(a.path);
    report.push(res);
    // Laisse le jeu retirer les bouts (voies integrees, cables) avant la phase suivante
    await new Promise((r) => setTimeout(r, 1500));
  }
  const pieces = inv.lightweight.filter((a) => !re || !re.test(a.class));
  const byClass = {};
  for (const p of pieces) (byClass[p.class] = byClass[p.class] || []).push(p);
  const lw = { retirees: 0, echecs: [] };
  for (const [c, list] of Object.entries(byClass)) {
    // Du plus grand numero au plus petit, chaque piece verifiee a sa position (le numero ne la designe que si elle y est)
    list.sort((a, b) => b.index - a.index);
    for (let i = 0; i < list.length; i += BATCH) {
      const lot = list.slice(i, i + BATCH);
      const r = await call('lightweightRemove', c, lot.map((p) => p.index), lot.map((p) => p.location));
      for (const x of r) if (x.removed) lw.retirees++; else lw.echecs.push(c + '#' + x.index + ' : ' + x.reason);
    }
  }
  report.push({ phase: 'pieces legeres', ...lw });
  return report;
}

// Les pieces legeres (fondations) n'ont pas d'acteur : elles ne sont pas entourees
async function surligner(file) {
  if (!file) throw new Error('usage : surligner <fichier> [--off] [--couleur OC_RED]');
  const off = argv.indexOf('--off') >= 0;
  const color = opt('couleur', 'OC_RED');
  const inv = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8'));
  let done = 0;
  const failed = [];
  for (let i = 0; i < inv.actors.length; i += 300) {
    const r = await call('outline', inv.actors.slice(i, i + 300).map((a) => a.path), color, !off);
    done += r.done;
    failed.push(...r.failed);
  }
  return { [off ? 'contours_retires' : 'entoures']: done, introuvables: failed, pieces_legeres_non_entourees: inv.lightweight.length };
}

// Sphere de la derniere bulle montree (chemin de l'acteur), pour la retirer ensuite
const SPHERE_FILE = path.join(__dirname, 'bulle-sphere.json');

async function cacher() {
  if (!fs.existsSync(SPHERE_FILE)) return { removed: false, reason: 'aucune sphere posee' };
  const s = JSON.parse(fs.readFileSync(SPHERE_FILE, 'utf8'));
  const r = await call('sphereRemove', s.paths || s.path);
  fs.unlinkSync(SPHERE_FILE);
  return r;
}

async function voir(where, radiusM) {
  if (!where || !radiusM) throw new Error('usage : voir <centre> <rayon m>');
  if (fs.existsSync(SPHERE_FILE)) await cacher();
  const r = await call('sphere', await center(where), Number(radiusM) * 100, null);
  fs.writeFileSync(SPHERE_FILE, JSON.stringify(r, null, 1));
  return r;
}

const COMMANDS = { inventaire, demolir, surligner, voir, cacher };

(async () => {
  const [cmd, ...args] = argv;
  if (!COMMANDS[cmd]) {
    const head = [];
    for (const line of fs.readFileSync(__filename, 'utf8').split('\n')) {
      if (!line.startsWith('//')) break;
      head.push(line.replace(/^\/\/ ?/, ''));
    }
    console.log(head.join('\n'));
    return;
  }
  console.log(JSON.stringify(await COMMANDS[cmd](...args), null, 1));
})().catch((e) => {
  console.error('ECHEC :', e.message);
  process.exitCode = 1;
});
