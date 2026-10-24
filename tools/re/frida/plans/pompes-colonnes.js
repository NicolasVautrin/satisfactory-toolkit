// Pompes des colonnes d'eau verticales de l'etage 1 bis (correction du 22/10/2026) : la pompe Mk2 posee au quart de la
// colonne (-1,9 m) etait hors de portee de l'extracteur (il pousse l'eau a 10 m au-dessus de sa sortie, -14,9 m -> -4,9 m).
// Pour chaque colonne : retrait de l'ancienne pompe (le jeu recolle le tuyau), Mk2 a -12,5 m (50 m -> +37,5 m), Mk1 a
// +20 m sur le tuyau du haut (marge jusqu'a +40 m ; ligne d'eau a +37 m), cables.
// usage : node pompes-colonnes.js [--dry]       Etat : pompes-colonnes-state.json (non versionne)
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const Z_MK2 = -1250, Z_MK1 = 2000;
const FILE = path.join(__dirname, 'pompes-colonnes-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');
const js = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

// Colonnes : etat ou lire l'extracteur et l'ancienne pompe, et poteau des nouvelles pompes (chemin)
function targets() {
  const t = [];
  for (const n of [1, 2, 3, 4]) {
    const r = js('reprise-eau-stators' + n + '-state.json'), m = js('module' + n + '-stators-state.json');
    t.push({ tag: 'stators' + n + ' 1b E3', ex: r.actors['1b E3 extracteur'], old: r.actors['1b E3 pompe'], pole: m.actors['poteau PX'] });
    t.push({ tag: 'stators' + n + ' 1b E4', ex: r.actors['1b E4 extracteur'], old: r.actors['1b E4 pompe'], pole: m.actors['poteau PW1'] });
  }
  const r1 = js('rotors1-state.json');
  t.push({ tag: 'rotors1 Sb', ex: r1.actors['extracteur Sb'], old: r1.actors['pompe Sb'], pole: r1.actors['poteau 1-0'] });
  t.push({ tag: 'rotors1 Nb', ex: r1.actors['extracteur Nb'], old: r1.actors['pompe Nb'], pole: r1.actors['poteau 1b-2'] });
  return t;
}

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
    if ((a.z - z) * (b.z - z) <= 0 && a.z !== b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z };
    }
  }
  throw new Error(short(pipe) + ' : aucun point a z ' + z);
}
async function pump(key, recipe, pipe, z) {
  if (st[key]) return st[key];
  const p = await pointAtZ(pipe, z);
  const r = await call('buildAim', recipe, { x: p.x, y: p.y, z: p.z + 1000 }, p, { dryRun: DRY, onActor: pipe });
  const hz = r.hologram ? Math.round(r.hologram.location.z / 10) / 10 : null;
  console.log(key.padEnd(30), (r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit') + ' a z ' + hz + ' m, cap ' + (r.hologram && Math.round(r.hologram.rotation.yaw)) + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construite');
  if (r.built) { st[key] = r.actor; save(); }
  return st[key];
}

(async () => {
  for (const T of targets()) {
    if (!st[T.tag + ' ancienne retiree']) {
      if (!DRY && T.old) { try { await call('dismantle', T.old, true); } catch (e) { if (!/introuvable/.test(e.message)) throw e; } await wait(2.5); }
      if (!DRY) { st[T.tag + ' ancienne retiree'] = true; save(); }
    }
    const pipe = await partner(T.ex, 'FGPipeConnectionFactory');
    if (!pipe) throw new Error(T.tag + ' : extracteur sans tuyau');
    const mk2 = await pump(T.tag + ' Mk2', 'Recipe_PipelinePumpMK2_C', pipe, Z_MK2);
    if (DRY) continue;
    await wait(2.5);
    const upper = await partner(mk2, 'Connection1');
    if (!upper) throw new Error(T.tag + ' : pas de tuyau au-dessus de la Mk2');
    const mk1 = await pump(T.tag + ' Mk1', 'Recipe_PipelinePump_C', upper, Z_MK1);
    for (const [k, a] of [['Mk2', mk2], ['Mk1', mk1]]) {
      const key = T.tag + ' cable ' + k;
      if (st[key]) continue;
      const r = await call('wire', T.pole, a, {});
      console.log(key.padEnd(30), r.built ? 'construit' : 'NON construit ' + JSON.stringify(r.blocking));
      if (!r.built) throw new Error(key + ' : cable refuse');
      st[key] = r.actor; save();
    }
  }
  console.log('fin');
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
