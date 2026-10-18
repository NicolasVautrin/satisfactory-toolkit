// Ligne de convoyeur posee comme au pistolet le long d'une liste de points : chaque troncon part du bout libre du
// precedent et finit sur un poteau que le jeu ajoute lui-meme ; le dernier peut finir sur un connecteur.
//
// Usage :
//   node beltline.js <ligne.json> check|build [--nom <nom>] [--pas <m>] [--jusqua <n>] [--suivre]
//
// <ligne.json> :
//   { "recipe": "Recipe_ConveyorBeltMk6_C",
//     "start": { "path": "<acteur>", "name": "<connecteur>" },      // depart (ignore si l'etat a deja des troncons)
//     "points": [ { "x": .., "y": .., "z": .. }, ... ],              // trace en uu ; z = altitude approchee du sol
//     "end": { "path": "<acteur>", "name": "<connecteur>" } }        // facultatif : raccord final
//
// La ligne est decoupee en troncons d'au plus --pas metres (defaut 40, le jeu refuse au-dela de 56). Pour chaque
// troncon : le sol est cherche sous le bout (fenetre de +15 / -30 m autour du z du point ; le terrain est charge loin
// autour du joueur), le troncon est verifie a blanc puis pose. Les batiments n'ont de collision qu'a ~100 m du joueur :
// loin de lui, l'accroche au troncon precedent passe par un point touche fabrique, et le jeu ne voit pas les batiments
// existants (aucun controle d'empietement). --suivre teleporte le joueur pres de chaque bout pour garder ce controle.
// check : verifie a blanc le prochain troncon seulement (les suivants partent d'un bout qui n'existe pas encore).
// Etat : <nom>-state.json (troncons et poteaux poses) ; build reprend ou il s'est arrete.
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [, , lineFile, mode] = process.argv;
if (!lineFile || !['check', 'build'].includes(mode)) {
  console.error('usage : node beltline.js <ligne.json> check|build [--nom <nom>] [--pas <m>] [--jusqua <n>] [--suivre]');
  process.exit(1);
}
const line = JSON.parse(fs.readFileSync(lineFile, 'utf8'));
const name = arg('nom', path.basename(lineFile, '.json'));
const statePath = path.join(__dirname, name + '-state.json');
const STEP = Number(arg('pas', '40')) * 100;
const UNTIL = Number(arg('jusqua', '1e9'));
const FOLLOW = process.argv.includes('--suivre');
const TELEPORT_IF = 4000;     // uu : on rapproche le joueur si le bout est plus loin
const GROUND_ABOVE = 1500;    // uu : fenetre de recherche du sol autour du z du point
const GROUND_BELOW = 3000;

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { segments: [] };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Points de pose : la ligne redecoupee en pas reguliers d'au plus STEP
function targets(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(dist2(a, b) / STEP));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}

async function bringPlayer(p) {
  const me = (await call('player')).eyes.location;
  if (dist2(me, p) < TELEPORT_IF && Math.abs(me.z - p.z) < 3000) return;
  await call('teleport', { x: p.x, y: p.y, z: p.z + 300 }, null);
  await new Promise((r) => setTimeout(r, 2500)); // laisse le jeu charger les collisions autour du joueur
}

async function main() {
  const all = targets(line.points);
  const done = state.segments.length;
  let from = done ? { path: state.segments[done - 1].belt, name: 'ConveyorAny1' } : line.start;
  console.log(name + ' : ' + all.length + ' troncons prevus, ' + done + ' deja poses' + (line.end ? ', raccord final sur ' + short(line.end.path) + '.' + line.end.name : ''));
  for (let i = done; i < all.length && i < UNTIL; i++) {
    const t = all[i];
    const last = i === all.length - 1 && line.end;
    if (FOLLOW) await bringPlayer(t);
    let to;
    if (last) to = line.end;
    else {
      const g = await call('ground', t.x, t.y, t.z + GROUND_ABOVE, t.z - GROUND_BELOW);
      if (g.z === null) throw new Error('troncon ' + (i + 1) + ' : pas de sol sous (' + Math.round(t.x) + ', ' + Math.round(t.y) + ') entre ' + Math.round((t.z - GROUND_BELOW) / 100) + ' et ' + Math.round((t.z + GROUND_ABOVE) / 100) + ' m');
      to = { x: t.x, y: t.y, z: g.z };
    }
    const label = 'troncon ' + (i + 1) + '/' + all.length + ' -> ' + (last ? short(to.path) + '.' + to.name : '(' + Math.round(to.x / 100) + ', ' + Math.round(to.y / 100) + ') sol ' + Math.round(to.z / 100) + ' m');
    const dry = await call('belt', line.recipe, from.path, from.name, to, { dryRun: true });
    if (dry.disqualifiers && dry.disqualifiers.length) throw new Error(label + ' refuse a blanc : ' + dry.disqualifiers.join(', '));
    if (mode === 'check') { console.log(label + ' : accepte a blanc'); return; }
    const r = await call('belt', line.recipe, from.path, from.name, to, {});
    if (!r.built || !r.actor) throw new Error(label + ' : non construit ' + JSON.stringify(r).slice(0, 300));
    state.segments.push({ belt: r.actor, poles: r.children || [], to: last ? { path: to.path, name: to.name } : { x: Math.round(to.x), y: Math.round(to.y), z: Math.round(to.z) } });
    save();
    console.log(label + ' : pose (' + short(r.actor) + (r.children && r.children.length ? ' + ' + r.children.map(short).join(', ') : '') + ')');
    from = { path: r.actor, name: 'ConveyorAny1' };
  }
  console.log(state.segments.length + '/' + all.length + ' troncons poses');
}

main().catch((e) => { console.error('ECHEC : ' + e.message); process.exit(1); });
