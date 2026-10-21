// Ligne de convoyeur posee comme au pistolet le long d'une liste de points : chaque troncon part du bout libre du
// precedent et finit sur un poteau que le jeu ajoute lui-meme ; le dernier peut finir sur un connecteur.
//
// Usage :
//   node beltline.js <ligne.json> check|build [--nom <nom>] [--pas <m>] [--jusqua <n>] [--suivre]
//
// <ligne.json> :
//   { "recipe": "Recipe_ConveyorBeltMk6_C",
//     "start": { "path": "<acteur>", "name": "<connecteur>" },      // depart (ignore si l'etat a deja des troncons)
//     "points": [ { "x": .., "y": .., "z": .., "poleHeight": 2 }, ... ], // trace en uu ; z = altitude approchee du sol ;
//                                                                     //   poleHeight (m, facultatif) : poteau de ce sommet
//     "poleHeight": 7,                                               // facultatif : poteaux des autres bouts (m ; jeu : 7)
//     "end": { "path": "<acteur>", "name": "<connecteur>" },       // facultatif : raccord final
//     "groundAbove": 15 }                                            // m au-dessus du z du point ou commence la recherche
//                                                                     //   du sol (en grotte : sous le plafond ; dehors : 100)
//
// La ligne est decoupee en troncons d'au plus --pas metres (defaut 40, le jeu refuse au-dela de 56). Pour chaque
// troncon : le sol est cherche sous le bout (fenetre de +15 / -30 m autour du z du point ; le terrain est charge loin
// autour du joueur), le troncon est verifie a blanc puis pose ; le jeu le raccorde au precedent a la construction, a
// toute distance. Les batiments n'ont de collision qu'a ~100 m du joueur :
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
const GROUND_ABOVE = (line.groundAbove || 15) * 100; // uu : fenetre de recherche du sol autour du z du point
const MAX_SLOPE = 0.6;        // pente maximale acceptee pour un bout voisin (~30 deg)
const GROUND_BELOW = 3000;

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { segments: [] };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Hauteur du poteau d'un bout (uu) : celle du sommet, sinon celle de la ligne, sinon celle du jeu
function poleOpts(t) {
  const h = t.poleHeight != null ? t.poleHeight : line.poleHeight;
  return h != null ? { poleHeight: h * 100 } : {};
}

// Points de pose : la ligne redecoupee en pas reguliers d'au plus STEP
function targets(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(dist2(a, b) / STEP));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n, poleHeight: k === n ? b.poleHeight : undefined });
  }
  return out;
}

// Bout prevu, puis voisins quand le jeu le refuse (sol en pente, vegetation...) : de cote a 3 et 6 m, puis 5 m en arriere
function variants(a, t) {
  const d = Math.hypot(t.x - a.x, t.y - a.y) || 1, ux = (t.x - a.x) / d, uy = (t.y - a.y) / d;
  const out = [t];
  for (const s of [300, -300, 600, -600]) out.push({ x: t.x - uy * s, y: t.y + ux * s, z: t.z });
  out.push({ x: t.x - ux * 500, y: t.y - uy * 500, z: t.z });
  return out;
}

async function bringPlayer(p) {
  const me = (await call('player')).eyes.location;
  if (dist2(me, p) < TELEPORT_IF && Math.abs(me.z - p.z) < 3000) return;
  await call('teleport', { x: p.x, y: p.y, z: p.z + 300 }, null);
  await new Promise((r) => setTimeout(r, 2500)); // laisse le jeu charger les collisions autour du joueur
}

// Reste du trace apres le dernier bout pose : on repart de ce bout et du sommet suivant le plus proche (le decoupage
// peut donc changer de pas d'un lancement a l'autre)
function remaining(points, here) {
  let best = 1, bd = Infinity;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((here.x - a.x) * (b.x - a.x) + (here.y - a.y) * (b.y - a.y)) / L2));
    const d = Math.hypot(a.x + (b.x - a.x) * t - here.x, a.y + (b.y - a.y) * t - here.y);
    if (d < bd) { bd = d; best = Math.hypot(b.x - here.x, b.y - here.y) < 100 ? k + 1 : k; }
  }
  return [here, ...points.slice(best)];
}

async function main() {
  const done = state.segments.length;
  const lastEnd = done ? state.segments[done - 1].to : null;
  const all = done && lastEnd.x !== undefined ? targets(remaining(line.points, lastEnd)) : targets(line.points);
  let from = done ? { path: state.segments[done - 1].belt, name: 'ConveyorAny1' } : line.start;
  console.log(name + ' : ' + done + ' troncons deja poses, ' + all.length + ' restants' + (line.end ? ', raccord final sur ' + short(line.end.path) + '.' + line.end.name : ''));
  for (let i = 0; i < all.length && i < UNTIL; i++) {
    const t = all[i];
    const last = i === all.length - 1 && line.end;
    if (i >= UNTIL) break;
    if (FOLLOW) await bringPlayer(t);
    let to = null, label = '', lastError = '';
    const prevPt = i ? all[i - 1] : (lastEnd && lastEnd.x !== undefined ? lastEnd : line.points[0]);
    for (const c of last ? [null] : variants(prevPt, t)) {
      let cand;
      if (last) cand = line.end;
      else {
        const g = await call('ground', c.x, c.y, t.z + GROUND_ABOVE, t.z - GROUND_BELOW);
        if (g.z === null) { lastError = 'pas de sol sous (' + Math.round(c.x) + ', ' + Math.round(c.y) + ')'; continue; }
        cand = { x: c.x, y: c.y, z: g.z };
        const here = state.segments.length ? state.segments[state.segments.length - 1].to : line.points[0];
        if (here.x !== undefined && Math.abs(cand.z - here.z) / (Math.hypot(cand.x - here.x, cand.y - here.y) || 1) > MAX_SLOPE) { lastError = 'pente trop forte vers (' + Math.round(c.x) + ', ' + Math.round(c.y) + ') sol ' + Math.round(cand.z / 100) + ' m'; continue; }
      }
      label = 'troncon ' + (state.segments.length + 1) + ' -> ' + (last ? short(cand.path) + '.' + cand.name : '(' + Math.round(cand.x / 100) + ', ' + Math.round(cand.y / 100) + ') sol ' + Math.round(cand.z / 100) + ' m' + (poleOpts(t).poleHeight != null ? ', poteau ' + poleOpts(t).poleHeight / 100 + ' m' : ''));
      try {
        const dry = await call('belt', line.recipe, from.path, from.name, cand, Object.assign({ dryRun: true }, last ? {} : poleOpts(t)));
        if (dry.disqualifiers && dry.disqualifiers.length) { lastError = dry.disqualifiers.join(', '); continue; }
      } catch (e) { lastError = e.message.split('disqualificateurs : ').pop(); continue; }
      to = cand;
      break;
    }
    if (to === null) throw new Error('troncon ' + (state.segments.length + 1) + ' refuse a blanc, voisins compris : ' + lastError);
    if (mode === 'check') { console.log(label + ' : accepte a blanc'); return; }
    const r = await call('belt', line.recipe, from.path, from.name, to, last ? {} : poleOpts(t));
    if (!r.built || !r.actor) throw new Error(label + ' : non construit ' + JSON.stringify(r).slice(0, 300));
    // Garde-fou : le joint doit avoir ete raccorde par le jeu a la construction. Ne PAS raccorder apres coup
    // (connect / SetConnection) : les chaines de convoyeurs deviennent incoherentes et le jeu plante
    // (AFGConveyorChainActor::GetItemsForSegment). Un joint ouvert se repare en reposant le troncon.
    const prev = (await call('connections', from.path)).find((c) => c.name === from.name);
    if (prev && !prev.connected) throw new Error(label + ' : pose mais NON raccorde au precedent (accroche retenue : ' + JSON.stringify(r.snapped) + ') ; demonter ' + short(r.actor) + ' et le reposer');
    state.segments.push({ belt: r.actor, poles: r.children || [], to: last ? { path: to.path, name: to.name } : { x: Math.round(to.x), y: Math.round(to.y), z: Math.round(to.z) } });
    save();
    console.log(label + ' : pose (' + short(r.actor) + (r.children && r.children.length ? ' + ' + r.children.map(short).join(', ') : '') + ')');
    from = { path: r.actor, name: 'ConveyorAny1' };
  }
  console.log(state.segments.length + ' troncons poses');
}

main().catch((e) => { console.error('ECHEC : ' + e.message); process.exit(1); });
