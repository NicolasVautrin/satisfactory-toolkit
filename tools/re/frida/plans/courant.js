// Courant d'un groupe de batiments, pose APRES les convoyeurs (utilisateur, 23/10/2026 : outils pour etre plus efficace ;
// gare des mines : poteaux poses avant les convoyeurs, cables a travers la falaise et l'arche, cables au ras du sol qui
// fermaient le passage au traceur). Arbre de cables depuis une source alimentee :
//  - cibles reliees une a une, la plus proche du reseau d'abord, au noeud le plus proche (source, poteau deja prevu) ;
//    une gare (un seul cable) passe par un premier poteau ; poteaux intermediaires tous les --portee m au plus (70) ;
//  - poteau Mk2 au sol, hors des batiments, convoyeurs et ascenseurs poses (decale en spirale jusqu'a 9 m) ;
//  - chaque cable degage du relief (1 m au moins, surplombs compris) : sinon poteau ajoute au point le plus haut sous le
//    cable, puis nouvel essai sur chaque moitie (3 fois au plus) ;
//  - pose des poteaux puis des cables ; controle du courant de chaque cible.
// node courant.js --source <acteur> --cibles <acteur,acteur,...> --nom <etat> [--portee 70] [--cable-max 90] [--dry]
//   --cable-max : longueur reelle d'un cable au plus (m, dans l'espace ; la portee est horizontale)
//   --suivre <ligne.json,...> : chaine de poteaux le long de ces lignes de convoyeurs d'abord (chantier lointain)
//   etat : plans/courant-<nom>-state.json (poteaux et cables poses, reprise possible)
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');
const T = require('./tracer');

const PRE = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const DRY = argv.includes('--dry');
const NOM = opt('nom');
const SPAN = 100 * Number(opt('portee', 70));
// longueur reelle d'un cable (dans l'espace) : la portee ne bornait que l'horizontale ; a blanc, foreuses de bauxite de
// S13 E101 (24/10/2026), cables de 128 a 163 m entre le fond de la vallee et des poteaux sur le massif (le jeu refuse
// au-dela d'environ 100 m)
const CABLE = 100 * Number(opt('cable-max', 90));
const len3 = (A, B) => Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
const POLE_TOP = 760; // point d'attache d'un poteau Mk2 au-dessus du sol (releve sur les cables de la gare des mines)
// point d'attache au-dessus de l'origine de l'acteur, par classe (releve sur les cables poses le 23/10/2026)
const ATTACH = [[/MinerMk3/, 1800], [/TrainStation/, 1880], [/PowerPole/, 760]];
const full = (a) => (a.includes('/') ? a : PRE + a);

async function plan(src, targets, W, follow = []) {
  const top = (p) => ({ x: p.x, y: p.y, z: T.hAt(W.relief, p.x, p.y) + POLE_TOP });
  const nodes = [{ id: 'source', at: src.at, actor: src.path, wires: 0, max: src.max }];
  const poles = [], wires = [];
  // zRef : sol attendu (poteau le long d'une ligne de convoyeur : le sol de la ligne, a 4 m pres ; a cote des pieds
  // d'ascenseur de S13 E101, le premier emplacement libre etait sur un rocher a 189 m, la ligne a 143 m)
  const placeAt = (p, zRef) => {
    for (const r of [0, 300, 600, 900]) for (let a = 0; a < (r ? 8 : 1); a++) {
      const q = { x: p.x + r * Math.cos((a * Math.PI) / 4), y: p.y + r * Math.sin((a * Math.PI) / 4) };
      const g = T.hAt(W.relief, q.x, q.y);
      if (!(g > -1e6)) continue;
      if (zRef != null && Math.abs(g - zRef) > 400) continue;
      if (poles.some((n) => Math.hypot(n.at.x - q.x, n.at.y - q.y) < 300)) continue; // deux poteaux a 3 m au moins
      if (!T.hitColumn(W, q.x, q.y, g, g + 900, Infinity)) return Object.assign(q, { g });
    }
    return null;
  };
  const addPole = (p, why, zRef) => {
    const q = placeAt(p, zRef);
    if (!q) throw new Error('pas de place pour un poteau pres de ' + Math.round(p.x) + ' ; ' + Math.round(p.y) + ' (' + why + ')');
    const n = { id: 'P' + (poles.length + 1), at: top(q), ground: q.g, wires: 0, max: 7, why };
    poles.push(n); nodes.push(n);
    return n;
  };
  // point le plus pres du relief sous un cable (moins d'1 m, ou dans un surplomb), ou null
  const worstUnder = (A, B) => {
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    let worst = null;
    for (let s = 200; s < L - 200; s += 200) {
      const t = s / L, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t, z = A.z + (B.z - A.z) * t;
      const g = T.hAt(W.relief, x, y), over = T.overAt(W.relief, x, y).some(([ob, ot]) => z >= ob - 100 && z <= ot + 100);
      const room = over ? -1 : z - g;
      if (room < 100 && (!worst || room < worst.room)) worst = { x, y, room };
    }
    return worst;
  };
  // cable a degager du relief : poteau ajoute pres du point le pire, dans l'axe ou de cote (jusqu'a 24 m), la ou les
  // deux nouveaux cables passent (sinon la ou ils passent le mieux), puis chaque moitie
  // sol sous un noeud (poteau : son sol ; source, cible : le relief)
  const groundOf = (n) => (n.ground != null ? n.ground : T.hAt(W.relief, n.at.x, n.at.y));
  const link = (a, b, depth = 0) => {
    const worst = worstUnder(a.at, b.at);
    const tooLong = len3(a.at, b.at) > CABLE;
    if ((worst || tooLong) && depth < 4) {
      const at = worst || { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2, room: 1e9 };
      const L = Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y) || 1, nx = -(b.at.y - a.at.y) / L, ny = (b.at.x - a.at.x) / L;
      // poteau insere au plus 12 m au-dessus du plus haut des deux sols : pas de poteau sur un rocher qui domine la ligne
      // (a blanc, foreuses de bauxite de S13 E101 : poteaux a 222 m au-dessus d'une vallee a 100 m, cables de 117 m)
      const gMax = Math.max(groundOf(a), groundOf(b)) + 1200;
      let best = null;
      for (const o of [0, 800, -800, 1600, -1600, 2400, -2400]) {
        const q = placeAt({ x: at.x + o * nx, y: at.y + o * ny });
        // pas a moins de 3 m d'un bout du cable (a blanc : deux poteaux a 1 m l'un de l'autre)
        if (!q || q.g > gMax || Math.hypot(q.x - a.at.x, q.y - a.at.y) < 300 || Math.hypot(q.x - b.at.x, q.y - b.at.y) < 300) continue;
        const qt = top(q), w1 = worstUnder(a.at, qt), w2 = worstUnder(qt, b.at);
        const long = Math.max(len3(a.at, qt), len3(qt, b.at)) > CABLE;
        const score = Math.min(w1 ? w1.room : 1e9, w2 ? w2.room : 1e9) - (long ? 1e6 : 0);
        if (!best || score > best.score) best = { q, score };
        if (score === 1e9) break;
      }
      if (!best) throw new Error('pas de place pour un poteau sous le cable ' + a.id + '-' + b.id);
      const m = addPole(best.q, 'cable ' + a.id + '-' + b.id + (worst ? ' a ' + (worst.room / 100).toFixed(1) + ' m du relief' : ' trop long (' + Math.round(len3(a.at, b.at) / 100) + ' m)'));
      link(a, m, depth + 1); link(m, b, depth + 1);
      return;
    }
    if (worst) console.log('ATTENTION : cable', a.id, '-', b.id, 'a', (worst.room / 100).toFixed(1), 'm du relief en', Math.round(worst.x), Math.round(worst.y));
    if (tooLong) console.log('ATTENTION : cable', a.id, '-', b.id, 'de', Math.round(len3(a.at, b.at) / 100), 'm');
    a.wires++; b.wires++;
    wires.push({ a: a.id, b: b.id, m: Math.round(Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y, b.at.z - a.at.z) / 100) });
  };
  // une gare ne prend qu'un cable : premier poteau a 10 m d'elle, vers les cibles
  if (src.max === 1) {
    const c = targets.reduce((s, t) => ({ x: s.x + t.at.x / targets.length, y: s.y + t.at.y / targets.length }), { x: 0, y: 0 });
    const d = Math.hypot(c.x - src.at.x, c.y - src.at.y) || 1;
    const hub = addPole({ x: src.at.x + ((c.x - src.at.x) / d) * 1000, y: src.at.y + ((c.y - src.at.y) / d) * 1000 }, 'premier poteau de la source');
    link(nodes[0], hub);
  }
  // chemin de poteaux d'un noeud du reseau a une cible : A* sur les positions de poteaux, portees de 30 a 70 m dans 18
  // directions, chaque cable degage du relief ; cout = nombre de portees (puis longueur) ; depart de tous les noeuds qui
  // ont encore un cable libre
  const free = (n) => n.wires < n.max && !(n.id === 'source' && src.max === 1 && n.wires >= 1) && n.max !== 1 || (n.id === 'source' && n.wires < n.max);
  const route = (tn) => {
    const starts = nodes.filter((n) => n !== tn && n.max > 1 && n.wires < n.max || (n.id === 'source' && n.wires < n.max));
    const key = (p) => Math.round(p.x / 400) + ',' + Math.round(p.y / 400);
    const open = [], seen = new Map();
    const h = (p) => Math.hypot(tn.at.x - p.x, tn.at.y - p.y) / SPAN;
    for (const s of starts) { const n = { at: s.at, c: 0, from: null, node: s }; n.f = h(s.at); open.push(n); }
    let goal = null, it = 0;
    while (open.length && it++ < 4000) {
      open.sort((a, b) => a.f - b.f);
      const n = open.shift();
      if (Math.hypot(tn.at.x - n.at.x, tn.at.y - n.at.y) <= SPAN && len3(n.at, tn.at) <= CABLE && !worstUnder(n.at, tn.at)) { goal = n; break; }
      for (let a = 0; a < 360; a += 20) for (const d of [SPAN, SPAN * 0.7, SPAN * 0.45]) {
        const q = placeAt({ x: n.at.x + d * Math.cos((a * Math.PI) / 180), y: n.at.y + d * Math.sin((a * Math.PI) / 180) });
        if (!q) continue;
        const qt = top(q);
        if (len3(n.at, qt) > CABLE || worstUnder(n.at, qt)) continue;
        const c = n.c + 1 + Math.hypot(qt.x - n.at.x, qt.y - n.at.y) / SPAN * 0.01, k = key(qt);
        if (seen.has(k) && seen.get(k) <= c) continue;
        seen.set(k, c);
        open.push({ at: qt, q, c, f: c + h(qt), from: n });
      }
    }
    if (!goal) return null;
    const chain = [];
    for (let n = goal; n; n = n.from) chain.unshift(n);
    return chain;
  };
  // raccord d'un noeud (cible ou premier poteau d'une chaine) au reseau : chemin de poteaux trouve par route(), sinon cable
  // direct depuis le noeud le plus proche
  const connect = (tn) => {
    const chain = route(tn);
    if (!chain) console.log('ATTENTION : aucun chemin de cables degage vers', tn.id, ': cable direct depuis le noeud le plus proche');
    let from = chain ? chain[0].node : nodes.filter((n) => n !== tn && n.max > 1).sort((a, b) => Math.hypot(a.at.x - tn.at.x, a.at.y - tn.at.y) - Math.hypot(b.at.x - tn.at.x, b.at.y - tn.at.y))[0];
    for (const step of (chain || []).slice(1)) {
      const p = addPole(step.q, 'vers ' + tn.id);
      link(from, p); from = p;
    }
    link(from, tn);
  };
  // --suivre : chaine de poteaux le long de lignes de convoyeurs (fichiers de ligne de beltline, tracees par les vallees),
  // de leur bout le plus proche du reseau vers l'autre. Le reseau gagne ainsi les chantiers lointains par la route des
  // convoyeurs (foreuses de bauxite de S13 E101, 24/10/2026 : a vol d'oiseau, des falaises de 100 m entre la gare et la
  // cuvette). De chaque poteau, le point de la ligne le plus loin joignable par un cable degage (portee, longueur reelle,
  // relief), poteau a 5 m de cote et au niveau de la ligne (a pas fixe, les cables coupaient les virages a travers la roche)
  const sideOf = (seq, j) => {
    const a = seq[Math.max(0, j - 1)], b = seq[Math.min(seq.length - 1, j + (j === 0 ? 1 : 0))];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: seq[j].x - ((b.y - a.y) / d) * 500, y: seq[j].y + ((b.x - a.x) / d) * 500 };
  };
  for (const pts of follow) {
    const dist = (p) => Math.min(...nodes.filter((n) => n.max > 1 && n.wires < n.max).map((n) => Math.hypot(n.at.x - p.x, n.at.y - p.y)));
    const seq = dist(pts[0]) <= dist(pts[pts.length - 1]) ? pts : pts.slice().reverse();
    // premier poteau de la chaine raccorde au reseau par la recherche de chemin (relief, longueur reelle) : un cable tire
    // droit depuis le poteau le plus proche passait entre des rochers (source sur une butte a la gare S13 E101)
    let prev = addPole(sideOf(seq, 0), 'debut de ligne', seq[0].z); // a 5 m de cote : sur la ligne, le poteau tombait sur le convoyeur
    connect(prev);
    let i = 0;
    while (i < seq.length - 1) {
      let best = null;
      for (let j = i + 1; j < seq.length; j++) {
        const q = placeAt(sideOf(seq, j), seq[j].z);
        if (!q) continue;
        const qt = top(q);
        if (Math.hypot(qt.x - prev.at.x, qt.y - prev.at.y) > SPAN) break;
        if (len3(prev.at, qt) <= CABLE && !worstUnder(prev.at, qt)) best = { j, q };
      }
      const j = best ? best.j : i + 1;
      const p = best ? addPole(best.q, 'le long de la ligne') : addPole(sideOf(seq, j), 'le long de la ligne', seq[j].z);
      link(prev, p); prev = p; i = j;
    }
  }
  const left = targets.slice();
  while (left.length) {
    // cible la plus proche du reseau d'abord
    left.sort((t, u) => Math.min(...nodes.map((n) => Math.hypot(t.at.x - n.at.x, t.at.y - n.at.y))) - Math.min(...nodes.map((n) => Math.hypot(u.at.x - n.at.x, u.at.y - n.at.y))));
    const t = left.shift();
    const tn = { id: short(t.path), at: t.at, actor: t.path, wires: 0, max: 1 };
    connect(tn);
    nodes.push(tn);
  }
  return { poles, wires, nodes };
}

(async () => {
  if (!NOM || !opt('source') || !opt('cibles')) throw new Error('usage : node courant.js --source <acteur> --cibles <a,b,...> --nom <etat> [--portee 70] [--dry]');
  const SF = path.join(__dirname, 'courant-' + NOM + '-state.json');
  const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : { poles: {}, wires: {} };
  const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };
  const actorAt = async (a) => {
    const p = (await call('pose', full(a))).location, cls = short(full(a));
    const off = (ATTACH.find(([re]) => re.test(cls)) || [null, 500])[1];
    return { x: p.x, y: p.y, z: p.z + off };
  };
  const sp = full(opt('source')), sw = await call('power', sp);
  // un poteau ne « consomme » pas : hasPower reste faux, c'est son circuit qui compte
  if (!sw.hasPower && !(sw.circuitId >= 0)) throw new Error('la source n\'est sur aucun circuit : ' + short(sp));
  const src = { path: sp, at: await actorAt(sp), max: sw.maxWires - sw.wires };
  if (src.max < 1) throw new Error('la source n\'a plus de place pour un cable (' + sw.wires + '/' + sw.maxWires + ')');
  const targets = [];
  for (const a of opt('cibles').split(',')) {
    const pw = await call('power', full(a));
    // --essai : cibles deja alimentees gardees (plan a blanc seulement, pour essayer l'outil)
    if (pw.hasPower && !(DRY && argv.includes('--essai'))) { console.log(short(full(a)), ': deja alimentee'); continue; }
    targets.push({ path: full(a), at: await actorAt(a) });
  }
  if (!targets.length) { console.log('rien a alimenter'); return; }
  const follow = (opt('suivre') || '').split(',').filter(Boolean).map((f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')).points);
  const all = [src.at, ...targets.map((t) => t.at), ...follow.flat()];
  const box = { x0: Math.min(...all.map((p) => p.x)) - 3000, x1: Math.max(...all.map((p) => p.x)) + 3000, y0: Math.min(...all.map((p) => p.y)) - 3000, y1: Math.max(...all.map((p) => p.y)) + 3000 };
  // releve a deux finesses (4 m, 2 m dans les mailles accidentees), comme le traceur de convoyeurs : a 4 m seulement, le
  // surplomb du plateau de la 634 sous lequel passe sa ligne etait vu comme un rocher plein (cables a 68 m sous le relief)
  const W = { box, width: 0, height: 0, relief: await T.reliefMulti(box, 400, 200) };
  W.near = T.index(await T.obstacles(box, new Set()));
  const P = await plan(src, targets, W, follow);
  for (const p of P.poles) console.log('poteau', p.id.padEnd(4), '(' + Math.round(p.at.x) + ' ; ' + Math.round(p.at.y) + ' ; sol ' + (p.ground / 100).toFixed(1) + ' m)', p.why);
  for (const w of P.wires) console.log('cable', (w.a + ' - ' + w.b).padEnd(44), w.m + ' m');
  if (DRY) return;
  const actor = {};
  for (const n of P.nodes) if (n.actor) actor[n.id] = n.actor;
  for (const p of P.poles) {
    const key = Math.round(p.at.x) + ',' + Math.round(p.at.y);
    if (!st.poles[key]) {
      const r = await call('build', 'Recipe_PowerPoleMk2_C', { x: p.at.x, y: p.at.y, z: p.ground }, 0, {});
      if (!r.built) throw new Error('poteau ' + p.id + ' non pose : ' + JSON.stringify(r.blocking || r).slice(0, 200));
      st.poles[key] = r.actor; save();
    }
    actor[p.id] = st.poles[key];
  }
  for (const w of P.wires) {
    const key = short(actor[w.a]) + '-' + short(actor[w.b]);
    if (st.wires[key]) continue;
    const r = await call('wire', actor[w.a], actor[w.b], {});
    if (!r.built) throw new Error('cable ' + w.a + ' - ' + w.b + ' non pose : ' + JSON.stringify(r).slice(0, 200));
    st.wires[key] = r.actor || true; save();
  }
  for (const t of targets) console.log(short(t.path), 'courant :', (await call('power', t.path)).hasPower);
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
