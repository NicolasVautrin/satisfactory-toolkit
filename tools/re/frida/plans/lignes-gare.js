// Plan groupe des lignes de convoyeurs d'une gare (utilisateur, 23/10/2026 : outils pour etre plus efficace ; gare des
// mines : lignes tracees une par une, la premiere barrait la route aux suivantes, deux demontages). Avant de tracer :
//  - affectation des departs (sorties de foreuses...) aux arrivees (pieds d'ascenseurs, entrees...) qui minimise les
//    croisements, puis la longueur ; chaque ligne approchee par sortie + 4 m -> point d'approche 12 m devant l'arrivee
//    -> arrivee ; contraintes de groupe (le cuivre ne va qu'aux arrivees du groupe cuivre...) ;
//  - croisements inevitables : une des deux lignes passe au-dessus, sur poteaux de 6 m (l'autre dessous a hauteur
//    normale, sans bosse). Lignes surelevees : un cote du graphe des croisements (le plus petit, composante par
//    composante) ; un cycle impair est signale (il faudrait un troisieme niveau) ;
//  - ordre : lignes surelevees d'abord (les autres les voient hautes), puis les autres.
// node lignes-gare.js <plan.json> [--trace] [--pose] [--dry]
//   plan.json : { "nom": "...", "departs": [{ "id", "acteur", "connecteur", "groupe" }],
//                 "arrivees": [{ "id", "acteur", "connecteur", "groupe" }] } (acteurs : nom court ou chemin complet)
//   --trace : tracer.js convoyeur de chaque ligne dans l'ordre (--frais) ; --pose : beltline.js build de chaque ligne
//   sortie : plans/lignes-<nom>.json (affectation, surelevees, ordre)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const PRE = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const full = (a) => (a.includes('/') ? a : PRE + a);
const node = (args) => execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 26 });

// intersection de deux segments en plan
const cross = (p, q, r, s) => {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0;
};
const polyCross = (A, B) => { for (let i = 0; i + 1 < A.length; i++) for (let j = 0; j + 1 < B.length; j++) if (cross(A[i], A[i + 1], B[j], B[j + 1])) return true; return false; };
const len = (A) => A.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - A[i].x, p.y - A[i].y), 0);

async function endPoint(e, ahead) {
  const c = (await call('connections', full(e.acteur))).find((k) => k.name === e.connecteur);
  if (!c) throw new Error('connecteur introuvable : ' + e.acteur + '.' + e.connecteur);
  const h = Math.hypot(c.normal.x, c.normal.y) || 1, n = { x: c.normal.x / h, y: c.normal.y / h };
  return { at: { x: c.location.x, y: c.location.y }, front: { x: c.location.x + ahead * n.x, y: c.location.y + ahead * n.y } };
}

(async () => {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('usage : node lignes-gare.js <plan.json> [--trace] [--pose] [--dry]');
  const P = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8'));
  for (const d of P.departs) Object.assign(d, await endPoint(d, 400));
  for (const a of P.arrivees) Object.assign(a, await endPoint(a, 1200));
  const line = (d, a) => [d.at, d.front, a.front, a.at];
  // affectation : recherche exhaustive avec elagage (croisements, puis longueur)
  let best = null;
  const used = new Set(), cur = [];
  const rec = (i, nc, L) => {
    if (best && (nc > best.nc || (nc === best.nc && L >= best.L))) return;
    if (i === P.departs.length) { best = { nc, L, pairs: cur.slice() }; return; }
    const d = P.departs[i];
    for (const a of P.arrivees) {
      if (used.has(a.id) || (a.groupe && d.groupe && a.groupe !== d.groupe)) continue;
      const pl = line(d, a);
      let add = 0;
      for (const [d2, a2] of cur) if (polyCross(pl, line(d2, a2))) add++;
      used.add(a.id); cur.push([d, a]);
      rec(i + 1, nc + add, L + len(pl));
      used.delete(a.id); cur.pop();
    }
  };
  rec(0, 0, 0);
  if (!best) throw new Error('aucune affectation possible (groupes ?)');
  const pairs = best.pairs.map(([d, a]) => ({ depart: d.id, arrivee: a.id, d, a, pl: line(d, a) }));
  // graphe des croisements, deux couleurs : la plus petite moitie de chaque composante est surelevee
  const adj = pairs.map(() => []);
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if (polyCross(pairs[i].pl, pairs[j].pl)) { adj[i].push(j); adj[j].push(i); }
  const color = pairs.map(() => -1), haut = new Set();
  let impair = false;
  for (let s = 0; s < pairs.length; s++) {
    if (color[s] >= 0 || !adj[s].length) continue;
    const comp = [s]; color[s] = 0;
    for (let k = 0; k < comp.length; k++) for (const v of adj[comp[k]]) {
      if (color[v] < 0) { color[v] = 1 - color[comp[k]]; comp.push(v); } else if (color[v] === color[comp[k]]) impair = true;
    }
    const c0 = comp.filter((v) => color[v] === 0), c1 = comp.filter((v) => color[v] === 1);
    for (const v of (c0.length <= c1.length ? c0 : c1)) haut.add(v);
  }
  const order = pairs.map((p, i) => i).sort((i, j) => (haut.has(j) ? 1 : 0) - (haut.has(i) ? 1 : 0));
  console.log('affectation :', best.nc, 'croisement(s),', Math.round(best.L / 100), 'm en tout');
  for (const i of order) {
    const p = pairs[i];
    console.log(' ', (p.depart + ' -> ' + p.arrivee).padEnd(36), Math.round(len(p.pl) / 100) + ' m', haut.has(i) ? 'SURELEVEE (poteaux de 6 m)' : '', adj[i].length ? 'croise ' + adj[i].map((j) => pairs[j].depart).join(', ') : '');
  }
  if (impair) console.log('ATTENTION : croisements en cycle impair, deux lignes surelevees se croisent : revoir l\'affectation ou un troisieme niveau');
  const out = { nom: P.nom, croisements: best.nc, lignes: order.map((i) => ({ depart: pairs[i].depart, arrivee: pairs[i].arrivee, de: full(pairs[i].d.acteur) + '.' + pairs[i].d.connecteur, a: full(pairs[i].a.acteur) + '.' + pairs[i].a.connecteur, poteau: haut.has(i) ? 6 : 2 })) };
  fs.writeFileSync(path.join(__dirname, 'lignes-' + P.nom + '.json'), JSON.stringify(out, null, 1));
  for (const l of out.lignes) {
    const nom = P.nom + '-' + l.depart;
    if (flag('trace')) {
      const r = node(['tracer.js', 'convoyeur', '--de', short(l.de.slice(0, l.de.lastIndexOf('.'))) + l.de.slice(l.de.lastIndexOf('.')), '--a', short(l.a.slice(0, l.a.lastIndexOf('.'))) + l.a.slice(l.a.lastIndexOf('.')), '--nom', nom, '--frais', '--poteau', String(l.poteau)]);
      console.log(r.split('\n').filter((x) => /ligne|ECHEC/.test(x)).join('\n'));
    }
    if (flag('pose')) {
      const r = node(['beltline.js', 'traces/' + nom + '-ligne.json', flag('dry') ? 'check' : 'build', '--nom', nom + '-sol']);
      console.log(r.trim().split('\n').slice(-2).join('\n'));
    }
  }
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
