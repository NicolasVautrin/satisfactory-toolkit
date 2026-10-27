// Banc d'essai de croisement aux bouts d'anneau (plan : layouts/banc-croisement.js). Pilote : reperes des quatre gares,
// verification a blanc et pose dans l'ordre (gares d'arrivee S2 / N2, puis S1 / N1 avec leurs rails), demontage de la
// voie N pour changer l'ecart.
//
// node banc-croisement.js cadre  [--j x,y,z] [--ecart m]        reperes des gares et points du banc en coordonnees monde
// node banc-croisement.js check  [--j ...] [--ecart m]          rails poses a blanc (morceaux S1 et N1)
// node banc-croisement.js pose   [--j ...] [--ecart m] [--voie S|N]   pose (gares d'arrivee d'abord)
// node banc-croisement.js demonte --voie S|N                    demonte une voie (rails et gares)
// node banc-croisement.js trains [--voie S|N] [--ecart m]        pose ESSAI1 (voie S) / ESSAI2 (voie N) a leur gare 1
// node banc-croisement.js reset  [--voie S|N] [--ecart m]        demonte les trains d'essai et les repose (apres deraillement)
// node banc-croisement.js essai  [--minutes 3] [--ecart m]       navettes, enregistrement, bilan par croisement
// Changer l'ecart : demonte --voie N, pose --voie N --ecart m, recabler la gare N1 (poteau Mk3 2145527828), reset.
// Defaut : J au-dessus de l'oleoduc de petrole (utilisateur : « juste au dessus du pipe de petrole » ; oleoduc a -12 m le
// long de y -236 000, branches du banc dans son axe a -7 m), double voie vers le nord, ecart 7 m.
'use strict';
const { execFileSync } = require('child_process');
const banc = require('./layouts/banc-croisement.js');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const O = { j: opt('j', '67500,-237800,-700'), ecart: opt('ecart', '7'), axe: opt('axe', '270') };
const NOM = (p) => 'banc-' + p;
const run = (...a) => {
  try {
    const out = execFileSync('node', a, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(out.trim());
  } catch (e) {
    console.log(((e.stdout || '') + (e.stderr || '')).trim());
    throw new Error('echec de : node ' + a.join(' '));
  }
};
const rp = (action, piece, ...extra) => {
  const f = banc.frames(O)[piece];
  run('railplan.js', 'layouts/banc-croisement.js', action, '--origin', [f.origin.x, f.origin.y, f.origin.z].map((v) => v.toFixed(1)).join(','),
    '--axis', String(f.axis), '--nom', NOM(piece), '--piece', piece, '--j', O.j, '--ecart', O.ecart, '--axe', O.axe, ...extra);
};
const voies = () => (opt('voie') ? [opt('voie')] : ['S', 'N']);

const COMMANDS = {
  cadre() {
    const b = banc.rig(O);
    console.log('banc : J', O.j, '| ecart', b.ecart, 'm | cap de u', b.axe, '|', JSON.stringify(banc.LENGTHS, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
    for (const [k, p] of Object.entries(b.P)) { const w = b.world(p); console.log('  ' + k.padEnd(5), JSON.stringify(p.map((x) => Math.round(x * 100) / 100)), '->', Math.round(w.x), Math.round(w.y), Math.round(w.z)); }
    for (const [k, s] of Object.entries(b.stations)) console.log('  gare ' + k, 'sortie', Math.round(s.origin.x), Math.round(s.origin.y), 'cap', s.axis);
  },
  check() {
    for (const v of voies()) rp('check', v + '1', '--ebauche', 'oui');
  },
  pose() {
    for (const v of voies()) { rp('build', v + '2'); rp('build', v + '1'); }
  },
  demonte() {
    for (const v of voies()) { rp('teardown', v + '1'); rp('teardown', v + '2'); }
  },
  // Pose ESSAI1 (voie S, a S1) et ESSAI2 (voie N, a N1) : locomotive au bout mort tournee vers lui, 6 wagons, locomotive
  // tournee vers le croisement ; noms des gares et des trains, horaires (charger / decharger une fois, 0 s), en manuel
  async trains() {
    const b = banc.rig(O), L = banc.LENGTHS;
    const VEH = 16; // pas entre centres de vehicules attelés (lu en jeu ; la caisse d'un wagon fait 16,29 m)
    // point a la distance d du bout mort, le long de la voie (repere du banc) et rail qui le porte
    const along = {
      S: (d) => ({ p: [-L.R, b.P.S1x[1] + d], rail: d < L.GARE ? 'integrated' : d < L.GARE + L.LA_S / 2 ? 'Sa1' : 'Sa2' }),
      N: (d) => {
        // voie integree droite, puis S : premier arc (cap 180 -> 210), second arc (210 -> 180)
        if (d <= L.GARE) return { p: [b.P.N1x[0] - d, b.P.N1x[1]], rail: 'integrated' };
        let u = b.P.N1in[0], v = b.P.N1in[1];
        const half = L.SB_ARC / 2, s = d - L.GARE, n = Math.ceil(s / 0.5);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) * (s / n), cap = Math.PI + (t <= half ? t : 2 * half - t) / L.SB_R;
          u += Math.cos(cap) * (s / n); v += Math.sin(cap) * (s / n);
        }
        return { p: [u, v], rail: s < half ? 'Ns1' : 'Ns2' };
      },
    };
    const trains = [['S', 'ESSAI1'], ['N', 'ESSAI2']].filter(([v]) => !opt('voie') || v === opt('voie'));
    for (const [voie, nom] of trains) {
      const s1 = state(voie + '1');
      const rails = Object.assign({ integrated: s1.integrated[0] }, s1.rails);
      let first = null;
      for (let k = 0; k < 8; k++) {
        const recipe = k === 0 || k === 7 ? 'Recipe_Locomotive_C' : 'Recipe_FreightWagon_C';
        const { p, rail } = along[voie](VEH / 2 + 0.5 + k * VEH);
        const w = b.world(p);
        // locomotive de tete (k = 0) tournee vers le bout mort, celle de queue (k = 7) vers le croisement
        const want = (() => { const q = along[voie](VEH / 2 + 0.5 + k * VEH + (k === 7 ? 2 : -2)).p; const ww = b.world(q); return Math.atan2(ww.y - w.y, ww.x - w.x) * 180 / Math.PI; })();
        let opts = { onActor: rails[rail] };
        if (recipe === 'Recipe_Locomotive_C') {
          const dry = await call('buildAim', recipe, { x: w.x, y: w.y, z: w.z + 2000 }, w, Object.assign({ dryRun: true }, opts));
          if (Math.cos((dry.hologram.rotation.yaw - want) * Math.PI / 180) < 0) opts = Object.assign({ vehicleScroll: [1, 1] }, opts);
        }
        const r = await call('buildAim', recipe, { x: w.x, y: w.y, z: w.z + 2000 }, w, opts);
        if (!r.built) throw new Error(nom + ' vehicule ' + k + ' non pose : ' + JSON.stringify(r.blocking));
        const pose = await call('pose', r.actor);
        console.log(nom, k, recipe.replace(/Recipe_|_C/g, ''), short(r.actor), 'cap', Math.round(pose.rotation.yaw), recipe === 'Recipe_Locomotive_C' ? '(voulu ' + Math.round(want) + ')' : '');
        if (!first) first = r.actor;
      }
      const t = (await call('trains', { path: first }))[0];
      if (t.vehicles.length !== 8) throw new Error(nom + ' : ' + t.vehicles.length + ' vehicules attelés au lieu de 8');
      await call('trainName', t.path, nom);
      await call('renameStation', state(voie + '1').station, 'ESSAI ' + voie + '1');
      await call('renameStation', state(voie + '2').station, 'ESSAI ' + voie + '2');
      const stops = [voie + '1', voie + '2'].map((p) => ({ station: state(p).station, definition: 'LoadUnloadOnce', duration: 0 }));
      await call('trainTimetable', t.path, stops, { current: 1, selfDriving: false });
      console.log(nom, short(t.path), '8 vehicules, horaire', 'ESSAI ' + voie + '1 | ESSAI ' + voie + '2', '(manuel)');
    }
  },
};

// Essai : enregistreur sur ESSAI1 et ESSAI2 (vehicules toutes les 100 ms), depart ensemble en conduite automatique, navettes
// pendant --minutes (3 par defaut) ou jusqu'au premier deraillement ; puis, pour chaque croisement releve (vehicules des
// deux trains a moins de 20 m de J dans le meme releve) : sens, vitesses, vehicules les plus proches (L : locomotive, W :
// wagon) et jeu calcule entre caisses (16,29 x 6,04 m, centrees sur l'acteur, dans son cap ; le deraillement a 6,5 m a
// montre que ce n'est pas la forme de collision du jeu : indicatif). Trains remis en manuel a la fin.
COMMANDS.essai = async () => {
  const minutes = Number(opt('minutes', 3));
  const tr = {}, kinds = {};
  for (const n of ['ESSAI1', 'ESSAI2']) {
    const t = (await call('trains', {})).find((x) => x.name === n);
    if (!t) throw new Error('train ' + n + ' introuvable (node banc-croisement.js trains)');
    tr[n] = t.path;
    kinds[n] = t.vehicles.map((v) => (/Locomotive/.test(v.class) ? 'L' : 'W'));
  }
  const J = banc.rig(O).world([0, 0]);
  await call('trainRecorder', [tr.ESSAI1, tr.ESSAI2], { periodMs: 100, keepMs: (minutes * 60 + 30) * 1000, afterMs: 3000 });
  await call('trainSelfDriving', tr.ESSAI1, true);
  await call('trainSelfDriving', tr.ESSAI2, true);
  console.log('depart', new Date().toTimeString().slice(0, 8), '| ecart', O.ecart, 'm |', minutes, 'min');
  let derail = null;
  for (let i = 0; i < minutes * 60 && !derail; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const ts = await Promise.all(Object.values(tr).map(async (p) => (await call('trains', { path: p }))[0]));
    const d = ts.filter((t) => /Derailed/.test(t.status));
    if (d.length) derail = d.map((t) => t.name).join(', ');
  }
  if (!derail) for (const p of Object.values(tr)) await call('trainSelfDriving', p, false);
  const rec = await call('trainRecorderGet', {});
  const events = crossings(rec.samples, J, kinds);
  events.forEach((e, k) => console.log('croisement ' + (k + 1) + ' a ' + (e.t / 1000).toFixed(1) + ' s : ' + e.text));
  console.log(events.length + ' croisements | ' + (derail ? 'DERAILLEMENT ' + derail + ' a ' + (rec.frozenAt / 1000).toFixed(1) + ' s' : 'aucun deraillement') + ' | ecart ' + O.ecart + ' m');
  if (!derail) console.log('trains en manuel');
};

// Croisements releves : groupes de releves ou un vehicule de chaque train est a moins de 20 m de J (5 s entre deux groupes)
function crossings(samples, J, kinds) {
  const near = (v) => Math.hypot(v[0] - J.x, v[1] - J.y) < 2000;
  const out = [];
  let cur = null;
  for (const s of samples) {
    const [a, b] = ['ESSAI1', 'ESSAI2'].map((n) => s.trains.find((t) => t.n === n));
    if (!a || !b || !a.veh.some(near) || !b.veh.some(near)) continue;
    if (!cur || s.t - cur.last > 5000) { cur = { t: s.t, last: s.t, samples: [] }; out.push(cur); }
    cur.last = s.t; cur.samples.push(s);
  }
  return out.map((e) => ({ t: e.t, text: analyse(e.samples, J, kinds) }));
}

// Jeu minimal entre une caisse d'ESSAI1 et une d'ESSAI2 sur les releves (negatif : chevauchement, en m), ou et quand
function analyse(samples, J, kinds) {
  const L = 16.29, W = 6.04;
  const box = ([x, y, , yaw]) => {
    const a = (yaw * Math.PI) / 180, t = [Math.cos(a), Math.sin(a)], n = [-t[1], t[0]];
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [x / 100 + (i * L / 2) * t[0] + (j * W / 2) * n[0], y / 100 + (i * L / 2) * t[1] + (j * W / 2) * n[1]]);
  };
  const sep = (A, B) => { // distance de separation sur les axes des deux boites (> 0 : jeu ; < 0 : chevauchement mini)
    let best = -Infinity;
    for (const P of [A, B]) for (let i = 0; i < 4; i++) {
      const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4], m = Math.hypot(x2 - x1, y2 - y1), ax = -(y2 - y1) / m, ay = (x2 - x1) / m;
      const pa = A.map(([x, y]) => x * ax + y * ay), pb = B.map(([x, y]) => x * ax + y * ay);
      best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
    return best;
  };
  let w = { d: Infinity }, vmax = {};
  for (const s of samples) {
    const [a, b] = ['ESSAI1', 'ESSAI2'].map((n) => s.trains.find((t) => t.n === n));
    if (!a || !b) continue;
    for (const t of [a, b]) vmax[t.n] = Math.max(vmax[t.n] || 0, Math.abs(t.v));
    a.veh.forEach((va, i) => b.veh.forEach((vb, k) => {
      if (Math.hypot(va[0] - J.x, va[1] - J.y) > 6000 || Math.hypot(vb[0] - J.x, vb[1] - J.y) > 6000) return;
      const d = sep(box(va), box(vb));
      if (d < w.d) w = { d, t: s.t, i, k, va, vb, v: [a.v, b.v] };
    }));
  }
  if (w.d === Infinity) return 'aucun croisement releve pres de J (' + samples.length + ' releves)';
  const kind = (n, i) => (kinds && kinds[n] ? kinds[n][i] : '?') + i;
  return 'jeu calcule ' + w.d.toFixed(2) + ' m (E1 ' + kind('ESSAI1', w.i) + ' / E2 ' + kind('ESSAI2', w.k) + ', a ' + (Math.hypot(w.va[0] - J.x, w.va[1] - J.y) / 100).toFixed(1)
    + ' et ' + (Math.hypot(w.vb[0] - J.x, w.vb[1] - J.y) / 100).toFixed(1) + ' m de J, caps ' + w.va[3] + ' / ' + w.vb[3] + ', ' + w.v.join(' / ') + ' km/h) ; vitesses max '
    + JSON.stringify(vmax);
}

// Remise a zero apres un deraillement : vehicules d'ESSAI1 / ESSAI2 demontes, trains reposes a S1 / N1 (commande trains)
COMMANDS.reset = async () => {
  const all = await call('trains', {});
  for (const n of ['ESSAI1', 'ESSAI2'].filter((x) => !opt('voie') || x === (opt('voie') === 'S' ? 'ESSAI1' : 'ESSAI2'))) {
    const t = all.find((x) => x.name === n);
    if (t) { for (const v of t.vehicles) await call('dismantle', v.path, true); console.log(n, ':', t.vehicles.length, 'vehicules demontes'); }
  }
  await COMMANDS.trains();
};

const fs = require('fs');
const { call } = require('./client');
const state = (piece) => JSON.parse(fs.readFileSync(require('path').join(__dirname, NOM(piece) + '-state.json'), 'utf8'));
const short = (p) => (p ? p.split('.').pop() : p);

const cmd = argv[0];
if (!COMMANDS[cmd]) { console.log('commandes : ' + Object.keys(COMMANDS).join(', ')); process.exit(1); }
(async () => COMMANDS[cmd]())().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
