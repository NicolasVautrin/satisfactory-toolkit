// Inventaire d'une zone RECTANGULAIRE pour une demolition (lecture seule), au format de bulle.js : une sphere qui
// englobe le rectangle (RPC bubble), puis tri par x, y et z. Le fichier produit s'utilise avec « bulle.js surligner »
// et « bulle.js demolir ». Utile quand la zone deborde des spheres (complexe en longueur, piles en hauteur).
// usage : node zone.js <x0,y0,z0> <x1,y1,z1> [--sans <regex>] [--out <fichier>]   (coordonnees en uu)
'use strict';
const fs = require('fs');
const path = require('path');
const { call } = require('./client');
const clearance = require('../../../../data/clearanceData.json');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const sans = opt('sans', null), out = path.resolve(__dirname, opt('out', 'zone.json'));
const [a, b] = argv.slice(0, 2).map((s) => s.split(',').map(Number));
const lo = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), z: Math.min(a[2], b[2]) };
const hi = { x: Math.max(a[0], b[0]), y: Math.max(a[1], b[1]), z: Math.max(a[2], b[2]) };
const LW_CLASSES = Object.keys(clearance).filter((n) => /Foundation|Wall|Pillar|Beam|Ramp|Frame|Catwalk|Walkway|Stair|Fence|Roof|Quarter|Corner|Barrier|Railing|Ladder/i.test(n)
  && !/PowerPole|Conveyor|Pipe/i.test(n));
(async () => {
  const center = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  const radius = Math.hypot(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) / 2 + 100;
  const r = await call('bubble', center, radius, LW_CLASSES);
  const inBox = (l) => l.x >= lo.x && l.x <= hi.x && l.y >= lo.y && l.y <= hi.y && l.z >= lo.z && l.z <= hi.z;
  const re = sans ? new RegExp(sans) : null;
  const actors = r.actors.filter((x) => inBox(x.location) && !(re && re.test(x.class)));
  const lightweight = (r.lightweight || []).filter((x) => inBox(x.location) && !(re && re.test(x.class)));
  fs.writeFileSync(out, JSON.stringify({ center, radius, box: { lo, hi }, sans, date: new Date().toISOString(), actors, lightweight }, null, 1));
  const par = (l) => Object.entries(l.reduce((m, x) => { const c = x.class.replace(/^Build_|_C$/g, ''); m[c] = (m[c] || 0) + 1; return m; }, {})).sort((p, q) => q[1] - p[1]);
  console.log(JSON.stringify({ fichier: out, batiments: actors.length, pieces_legeres: lightweight.length, par_classe: Object.fromEntries(par(actors)), pieces_legeres_par_classe: Object.fromEntries(par(lightweight)) }, null, 1));
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
