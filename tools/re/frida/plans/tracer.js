// Planificateur de trace de voie ferree (v1) : le plus court trace posable entre deux poses, calcule de facon
// deterministe en se faufilant entre le relief, les rochers et les batiments (utilisateur, 22/10/2026 : « un outil plus
// deterministe qui est capable de se faufiler a travers des mesh » ; « pour la pente on est pas dogmatique »).
//
// - Relief et rochers : grille relevee en jeu (RPC relief : premier relief ou rocher sous chaque maille, en traversant
//   batiments et vegetation), mise en cache dans plans/cache/. Le relief se charge loin du joueur (600 m et plus).
//   Surplombs (arche de roche) : sondes par un rayon montant depuis le relief sous les mailles plus hautes de 8 m que
//   leurs voisines ; la maille prend l'altitude du relief et la roche reste un obstacle a sa hauteur seulement (avant :
//   mur plein jusqu'a son sommet, arche de la ligne des mines contournee par un S, 23/10/2026).
// - Batiments : boites d'encombrement (data/clearanceData.json) a leur position, connues a toute distance ; cables
//   et poteaux electriques ignores (choix de l'utilisateur) ; rails, convoyeurs et tuyaux (courbes echantillonnees) ;
//   pieces legeres (boite centree, cote le plus long dans les deux sens : leur rotation n'est pas lue).
// - Recherche : A* hybride en plan (x, y, cap par pas de 10 deg comme le jeu) ; pas de 16 m, virages de 10, 20 ou 30
//   deg par pas (rayons 92, 46, 31 m) ; cout = longueur, majoree de 3 % par tranche de 10 deg de virage. L'altitude suit
//   un profil en long impose : depart a plat, raccord parabolique de 64 m, pente reguliere g, puis a plat a l'altitude
//   d'arrivee. g = pente visee (10 %), sinon la plus douce qui passe, par dichotomie au demi-point jusqu'a la pente
//   maximale (un premier essai qui recherchait aussi altitude et pente explorait trop : abandonne apres 5 min). Raccord
//   final par un rail du jeu (courbe d'Hermite) vers la pose d'arrivee exacte. Memes entrees, meme trace.
// - Gabarit : largeur (6 m une voie, 12,5 m deux voies a 6,5 m), de 0,5 m sous le rail a la hauteur libre au-dessus.
// - Sortie : plans/traces/<nom>.json (axe, troncons de 90 m au plus, deux voies decalees de 3,25 m si --double) ; plan
//   railplan.js : layouts/trace.js. Validation par la collision reelle du jeu : node tracer.js valider <nom>.
//
// node tracer.js rail --de x,y,z@cap --a x,y,z@cap --nom <nom> [--double] [--largeur m] [--hauteur m] [--marge m]
//   [--pente %] [--pente-max %] [--ignore acteur,acteur] [--aller-de <rail>.<connecteur>] [--retour-a <rail>.<connecteur>]
//   [--arrivee-a <rail>.<connecteur>] (voie simple : le dernier rail s'y accroche, ex. aiguillage sur une ligne existante)
// node tracer.js valider <nom>    balayage du gabarit le long du trace (pres du joueur seulement pour les batiments)
// node tracer.js controler <nom>  trace dessine a la main : relief, obstacles et rayon avec le modele de la recherche
// node tracer.js convoyeur --de <acteur>.<connecteur> --a <acteur>.<connecteur> --nom <nom> [--poteau m] [--marge m] [--releve m]
//   [--releve-grossier m] (releve plus fin que 4 m : a deux finesses, grossier a 4 m par defaut, fin dans les mailles accidentees)
//   ligne de convoyeur au sol (utilisateur, 23/10/2026 : « etends le traceur aux convoyeurs ») : sur poteaux de --poteau m
//   (2 par defaut) qui suivent le relief ; A* sur une grille de 4 m (8 directions, virages penalises), puis raccourcis en
//   lignes droites de cap quelconque (« grandes lignes droites sans escaliers, mais en suivant les vallees ») ; poteaux
//   tous les 40 m au plus, pente de 30 deg au plus entre deux poteaux, convoyeur degage du relief entre eux ; jamais sous
//   l'eau. Sortie : plans/traces/<nom>-ligne.json, fichier de ligne de beltline.js (node beltline.js <fichier> build).
// node tracer.js carte --centre x,y|<acteur> [--rayon m] [--pas m] [--bande m] [--points "F:x,y;A:x,y"] [--acteurs a,b]
//   carte du relief « en fil de fer » (utilisateur, 23/10/2026 : « juste que tu puisses te faire une carte mentale du
//   relief ») : une case par maille de --pas m (8), chiffre ou lettre = tranche d'altitude de --bande m (5) depuis le
//   point le plus bas (0-9 puis a-z) ; ^ surplomb (sol pris dessous), ~ mer, o batiment au ras du sol, lettres en
//   majuscule = points nommes et acteurs. A lancer au debut d'un chantier, avant de placer quoi que ce soit.
//   --niveau <m> : o = batiment a cette altitude (site en l'air ou sur la mer, ou le relief n'apprend rien) ; --frais
//   pour relire les batiments (cache d'une heure).
// Positions en uu (monde), z = niveau du rail, cap = sens de marche en degres (0 = +x, 90 = +y). --double : l'axe est
// entre les deux voies, voie aller a gauche du sens de marche (circulation a gauche), voie retour a droite ; --aller-de /
// --retour-a : connecteurs existants auxquels les deux voies s'accrochent au depart.
'use strict';
const fs = require('fs');
const path = require('path');
const { call } = require('./client');
const clearance = require('../../../../data/clearanceData.json');

const CACHE = path.join(__dirname, 'cache');
const TRACES = path.join(__dirname, 'traces');
const STEP = 1600; // pas de la recherche (uu)
const TURNS = [0, 10, -10, 20, -20, 30, -30]; // virage par pas (deg)
const MAX_RAIL = 9000; // troncon le plus long (sous les 100 m du jeu)
// Virage le plus fort d'un troncon : au-dela, les courbes d'Hermite des deux voies d'une double voie s'ecartent de leur
// arc et se rapprochent (5,9 m au milieu d'un troncon de 79 m tournant de 30 deg, vu a blanc le 22/10/2026)
const MAX_TURN = 20;
const SPACING = 650; // double voie : 6,5 m d'axe en axe
const rad = (d) => (d * Math.PI) / 180;
const norm360 = (a) => ((a % 360) + 360) % 360;
const angDiff = (a, b) => { const d = norm360(a - b); return d > 180 ? d - 360 : d; };

// --- arguments -------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const flag = (name) => argv.includes('--' + name);
function pose(s) {
  const m = /^(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)@(-?[\d.]+)$/.exec(s || '');
  if (!m) throw new Error('pose attendue x,y,z@cap (uu, degres) : ' + s);
  return { x: +m[1], y: +m[2], z: +m[3], cap: +m[4] };
}

// --- relief ----------------------------------------------------------------------------------------------------------
async function relief(box, step) {
  const x0 = Math.floor(box.x0 / step) * step, y0 = Math.floor(box.y0 / step) * step;
  const nx = Math.ceil((box.x1 - x0) / step) + 1, ny = Math.ceil((box.y1 - y0) / step) + 1;
  fs.mkdirSync(CACHE, { recursive: true });
  // relief4 : zone chargee par des sources de streaming (relief3 et avant : rochers seulement pres du joueur ; relief3 :
  // surplombs etendus sous les arches larges ; relief2 : leurs bords seulement ; relief_ : aucun surplomb)
  const file = path.join(CACHE, `relief4_${x0}_${y0}_${nx}_${ny}_${step}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const sources = await loadArea({ x0, y0, x1: x0 + (nx - 1) * step, y1: y0 + (ny - 1) * step });
  try {
    const z = [], skipped = {};
    const rows = Math.max(1, Math.floor(3000 / nx));
    for (let j = 0; j < ny; j += rows) {
      const r = await call('relief', x0, y0 + j * step, nx, Math.min(rows, ny - j), step, 40000, -10000);
      z.push(...r.z);
      for (const [k, v] of Object.entries(r.skipped)) skipped[k] = (skipped[k] || 0) + v;
      process.stdout.write('\rrelief ' + Math.min(ny, j + rows) + '/' + ny + ' rangees');
    }
    process.stdout.write('\n');
    const R = { x0, y0, nx, ny, step, z, skipped };
    R.over = await overhangs(R);
    if (Object.keys(R.over).length) console.log('surplombs :', Object.keys(R.over).length, 'mailles (sol pris dessous)');
    fs.writeFileSync(file, JSON.stringify(R));
    return R;
  } finally {
    if (sources.length) await call('streamingSourceRemove', sources);
  }
}

// Releve a deux finesses (utilisateur, 24/10/2026 : « fais la version a deux finesses » ; le releve a 2 m de toute la zone
// d'une ligne de 500 m, 85 000 points, durait trop) : grille grossiere (coarse) partout, puis points fins (fine) dans
// les seules mailles accidentees (coins ecartes de plus de 1,5 m, ou sans sol). Grille rendue au pas fin : un point fin
// non releve prend le plus haut des coins de sa maille grossiere (prudent, comme hAt). Surplombs sondes ensuite sur la
// grille fine. Meme forme que relief() : { x0, y0, nx, ny, step, z, skipped, over }.
async function reliefMulti(box, coarse, fine) {
  const k = Math.round(coarse / fine);
  if (k < 2 || k * fine !== coarse) return relief(box, fine);
  const x0 = Math.floor(box.x0 / coarse) * coarse, y0 = Math.floor(box.y0 / coarse) * coarse;
  const cx = Math.ceil((box.x1 - x0) / coarse) + 1, cy = Math.ceil((box.y1 - y0) / coarse) + 1;
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `relief4m_${x0}_${y0}_${cx}_${cy}_${coarse}_${fine}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const sources = await loadArea({ x0, y0, x1: x0 + (cx - 1) * coarse, y1: y0 + (cy - 1) * coarse });
  try {
    const t0 = Date.now();
    const C = [], skipped = {};
    const rows = Math.max(1, Math.floor(3000 / cx));
    for (let j = 0; j < cy; j += rows) {
      const r = await call('relief', x0, y0 + j * coarse, cx, Math.min(rows, cy - j), coarse, 40000, -10000);
      C.push(...r.z);
      for (const [kk, v] of Object.entries(r.skipped)) skipped[kk] = (skipped[kk] || 0) + v;
      process.stdout.write('\rrelief grossier ' + Math.min(cy, j + rows) + '/' + cy + ' rangees');
    }
    process.stdout.write('\n');
    const nx = (cx - 1) * k + 1, ny = (cy - 1) * k + 1;
    const z = new Array(nx * ny).fill(undefined);
    for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) z[j * k * nx + i * k] = C[j * cx + i];
    // mailles grossieres accidentees : leurs points fins sont releves
    const want = new Set();
    let rough = 0;
    for (let j = 0; j < cy - 1; j++) for (let i = 0; i < cx - 1; i++) {
      const q = [C[j * cx + i], C[j * cx + i + 1], C[(j + 1) * cx + i], C[(j + 1) * cx + i + 1]];
      const ok = q.filter((v) => v !== null);
      if (ok.length === 4 && Math.max(...ok) - Math.min(...ok) <= 150) continue;
      rough++;
      for (let b = 0; b <= k; b++) for (let a = 0; a <= k; a++) {
        if ((a === 0 || a === k) && (b === 0 || b === k)) continue; // coins : deja releves
        want.add((j * k + b) * nx + (i * k + a));
      }
    }
    const idx = [...want];
    for (let n = 0; n < idx.length; n += 3000) {
      const part = idx.slice(n, n + 3000);
      const r = await call('reliefPoints', part.map((q) => ({ x: x0 + (q % nx) * fine, y: y0 + Math.floor(q / nx) * fine })), 40000, -10000);
      part.forEach((q, m) => { z[q] = r.z[m]; });
      for (const [kk, v] of Object.entries(r.skipped)) skipped[kk] = (skipped[kk] || 0) + v;
      process.stdout.write('\rrelief fin ' + Math.min(idx.length, n + 3000) + '/' + idx.length + ' points');
    }
    process.stdout.write('\n');
    // points fins non releves : le plus haut des coins de leur maille grossiere
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const q = j * nx + i;
      if (z[q] !== undefined) continue;
      const ci = Math.min(cx - 2, Math.floor(i / k)), cj = Math.min(cy - 2, Math.floor(j / k));
      const c = [C[cj * cx + ci], C[cj * cx + ci + 1], C[(cj + 1) * cx + ci], C[(cj + 1) * cx + ci + 1]].filter((v) => v !== null);
      z[q] = c.length ? Math.max(...c) : null;
    }
    console.log('releve a deux finesses :', cx * cy, 'points a', coarse / 100, 'm,', idx.length, 'a', fine / 100, 'm (' + rough + ' mailles accidentees sur ' + (cx - 1) * (cy - 1) + '),', Math.round((Date.now() - t0) / 1000), 's');
    const R = { x0, y0, nx, ny, step: fine, z, skipped };
    R.over = await overhangs(R);
    if (Object.keys(R.over).length) console.log('surplombs :', Object.keys(R.over).length, 'mailles (sol pris dessous)');
    fs.writeFileSync(file, JSON.stringify(R));
    return R;
  } finally {
    if (sources.length) await call('streamingSourceRemove', sources);
  }
}

// Zone chargee comme pres du joueur (utilisateur, 24/10/2026 : « retrouve comment le jeu les charge ») : la carte est en
// World Partition, les rochers et leurs collisions ne sont charges qu'a 256 m d'une source de streaming (MainGrid, cellules
// de 128 m ; le releve fait de loin ne voyait que le relief nu). Sources de streaming de l'agent posees sur une grille
// de 300 m au plus (tout point a moins de 212 m d'une source), attente de la fin du chargement, puis 3 s pour les
// collisions. Rend les chemins des sources, a retirer apres le releve.
async function loadArea(box) {
  const SP = 30000;
  const nx = Math.max(1, Math.ceil((box.x1 - box.x0) / SP)), ny = Math.max(1, Math.ceil((box.y1 - box.y0) / SP));
  const pts = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    pts.push({ x: box.x0 + ((i + 0.5) * (box.x1 - box.x0)) / nx, y: box.y0 + ((j + 0.5) * (box.y1 - box.y0)) / ny, z: 15000 });
  }
  const paths = await call('streamingSourceAdd', pts);
  const t0 = Date.now();
  for (;;) {
    const st = (await call('streamingSources')).filter((s) => paths.includes(s.path));
    if (st.length && st.every((s) => s.completed)) break;
    if (Date.now() - t0 > 120000) { console.log('ATTENTION : chargement de la zone pas fini apres 2 min'); break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 3000));
  console.log('zone chargee :', paths.length, 'sources de streaming,', Math.round((Date.now() - t0) / 1000), 's');
  return paths;
}

// Surplombs (arche de roche : 23/10/2026, ligne et convoyeurs des mines, vue comme un mur plein jusqu'a son sommet) :
// maille plus haute de 8 m que la plus basse de ses 8 voisines ; rayon descendant parti 50 cm sous son dessus (il
// traverse la roche : faces internes non touchees) jusqu'au relief (Landscape), puis rayon montant parti 50 cm au-dessus
// de ce relief : s'il touche le dessous de la roche a plus de 4 m du relief et sous le dessus, la maille prend l'altitude
// du relief et garde le surplomb [dessous, dessus], obstacle pour ce qui passe a sa hauteur (hitColumn). Une falaise
// pleine ne donne pas de dessous : le rayon montant part de l'interieur de la roche.
// Arche large (passage ouest de la cuvette de bauxite de S13 E101, 24/10/2026 : sol a 98-103 m, dessous de la roche 80 a
// 100 m plus haut, vue comme un massif plein) : sous elle, les mailles voisines ont toutes le meme dessus et seules celles
// du bord etaient sondees. Les voisines d'un surplomb trouve, plus hautes de 8 m que son sol, sont sondees a leur tour,
// de proche en proche, si un balayage horizontal a 2 m au-dessus du sol du surplomb les atteint sans toucher de roche
// (de l'air, pas une falaise) ; leur rayon descendant traverse alors les rochers jusqu'au relief (une arche est faite de
// plusieurs rochers : le rayon parti de l'interieur de l'un touchait le dessus d'un autre, et la maille etait rejetee).
const OVER_H = { x: 5, y: 5, z: 5 };
const sweepBatch = async (items) => { const out = []; for (let k = 0; k < items.length; k += 200) out.push(...await call('sweeps', items.slice(k, k + 200))); return out; };
const builtHit = (h) => /\.Build_|Foliage|Lightweight/i.test(String((h.component || {}).path || ''));
async function overhangs(R) {
  const cand = [];
  for (let j = 0; j < R.ny; j++) for (let i = 0; i < R.nx; i++) {
    const v = R.z[j * R.nx + i];
    if (v === null) continue;
    let lo = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if ((di || dj) && a >= 0 && b >= 0 && a < R.nx && b < R.ny && R.z[b * R.nx + a] !== null) lo = Math.min(lo, R.z[b * R.nx + a]);
    }
    if (v - lo > 800) cand.push({ k: j * R.nx + i, x: R.x0 + i * R.step, y: R.y0 + j * R.step, top: v });
  }
  const over = {}, tested = new Set();
  for (const c of cand) tested.add(c.k);
  let found = await probeOverhangs(R, cand, over, false);
  for (let pass = 0; found.length && pass < 400; pass++) {
    const next = [];
    for (const k of found) {
      const i = k % R.nx, j = Math.floor(k / R.nx), g = R.z[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj, kk = b * R.nx + a;
        if (a < 0 || b < 0 || a >= R.nx || b >= R.ny || tested.has(kk) || R.z[kk] === null) continue;
        if (R.z[kk] - g <= 800) continue; // voisine au niveau du sol : rien a chercher dessous
        tested.add(kk);
        next.push({ k: kk, x: R.x0 + a * R.step, y: R.y0 + b * R.step, top: R.z[kk], g, from: { x: R.x0 + i * R.step, y: R.y0 + j * R.step, z: g + 200 } });
      }
    }
    // de l'air entre le surplomb et sa voisine, a 2 m au-dessus de son sol (batiments ignores : convoyeurs, poteaux)
    const reach = await sweepBatch(next.map((c) => ({ from: c.from, to: { x: c.x, y: c.y, z: c.from.z }, half: OVER_H })));
    const open = next.filter((c, n) => !(reach[n] && reach[n].hit && !builtHit(reach[n])));
    found = open.length ? await probeOverhangs(R, open, over, true) : [];
  }
  return over;
}
// Sondage d'une liste de mailles candidates : rayon descendant jusqu'au relief, rayon montant jusqu'au dessous de la
// roche ; ecrit les surplombs trouves dans over (et le relief de la maille dans R.z), rend leurs indices. rocks : le
// rayon descendant traverse aussi les rochers (maille deja reconnue a l'air libre, sol attendu proche de c.g, a 6 m pres)
async function probeOverhangs(R, cand, over, rocks) {
  const H = OVER_H, batch = sweepBatch, built = builtHit;
  const land = (h) => /Landscape/.test((h.component || {}).cls || '');
  // les batiments sous la roche (rails et quais d'une gare passee sous l'arche) sont traverses, en repartant 20 cm
  // apres chaque contact (6 fois au plus ; 12, rochers compris, pour une maille reconnue a l'air libre)
  // relances groupees : un appel par etape pour tous les rayons a relancer (un appel par rayon attendait chaque fois un
  // tour de jeu : des milliers d'appels sous l'arche et dans les arbres de la cuvette de S13 E101, 24/10/2026)
  const through = async (hits, items, dir, pass) => {
    for (let t = 0; t < (pass ? 12 : 6); t++) {
      const redo = [];
      hits.forEach((h, n) => { if (h && h.hit && (built(h) || (pass && !land(h)))) redo.push(n); });
      if (!redo.length) break;
      const again = await batch(redo.map((n) => ({ from: Object.assign({}, items[n].from, { z: hits[n].location.z + 20 * dir }), to: items[n].to, half: H })));
      redo.forEach((n, m) => { hits[n] = again[m]; });
    }
    return hits;
  };
  const downItems = cand.map((c) => ({ from: { x: c.x, y: c.y, z: c.top - 50 }, to: { x: c.x, y: c.y, z: -10000 }, half: H }));
  const down = await through(await batch(downItems), downItems, -1, rocks);
  const under = cand.filter((c, n) => {
    const h = down[n];
    if (!h || !h.hit || !land(h) || c.top - h.location.z <= 800) return false;
    if (rocks && Math.abs(h.location.z - c.g) > 600) return false;
    c.ground = h.location.z;
    return true;
  });
  const upItems = under.map((c) => ({ from: { x: c.x, y: c.y, z: c.ground + 50 }, to: { x: c.x, y: c.y, z: c.top + 100 }, half: H }));
  const up = await through(await batch(upItems), upItems, 1, false);
  const found = [];
  under.forEach((c, n) => {
    const h = up[n];
    if (h && h.hit && h.location.z - c.ground > 400 && h.location.z < c.top - 100) { over[c.k] = [Math.round(h.location.z), Math.round(c.top)]; R.z[c.k] = c.ground; found.push(c.k); }
  });
  return found;
}
// Surplombs touches en (x, y) (4 mailles voisines, comme hAt) : liste de [dessous, dessus]
function overAt(R, x, y) {
  if (!R.over) return [];
  const fi = (x - R.x0) / R.step, fj = (y - R.y0) / R.step, out = [];
  for (const i of [Math.floor(fi), Math.ceil(fi)]) for (const j of [Math.floor(fj), Math.ceil(fj)]) {
    const o = i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.over[j * R.nx + i];
    if (o) out.push(o);
  }
  return out;
}
// Altitude du relief en (x, y) : plus haute des 4 mailles voisines (prudent) ; -Infinity sans sol (mer profonde)
function hAt(R, x, y) {
  const fi = (x - R.x0) / R.step, fj = (y - R.y0) / R.step;
  let best = -Infinity;
  for (const i of [Math.floor(fi), Math.ceil(fi)]) for (const j of [Math.floor(fj), Math.ceil(fj)]) {
    if (i < 0 || j < 0 || i >= R.nx || j >= R.ny) continue;
    const v = R.z[j * R.nx + i];
    if (v !== null && v > best) best = v;
  }
  return best;
}

// Altitude du relief interpolee entre les 4 mailles voisines (sol reel sous un poteau, la ou hAt majore sur une pente)
function hBil(R, x, y) {
  const fi = (x - R.x0) / R.step, fj = (y - R.y0) / R.step, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const at = (a, b) => { const z = a >= 0 && b >= 0 && a < R.nx && b < R.ny ? R.z[b * R.nx + a] : null; return z === null ? null : z; };
  const q = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
  if (q.some((z) => z === null)) return hAt(R, x, y);
  return (q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v;
}

// --- obstacles construits -----------------------------------------------------------------------------------------------
const SPLINE = [[/RailroadTrack/, 300, 150], [/ConveyorBelt/, 100, 100], [/Pipeline(?!Support|Pump|Junction)/, 100, 100]];
// Obstacles construits de la zone, mis en cache une heure (plans/cache/obstacles_*.json ; --frais pour relire le jeu)
async function obstacles(box, ignore) {
  const file = path.join(CACHE, `obstacles_${Math.round(box.x0)}_${Math.round(box.y0)}_${Math.round(box.x1)}_${Math.round(box.y1)}.json`);
  let all;
  if (!flag('frais') && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 3600e3) all = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    all = await readObstacles(box);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all));
  }
  return all.filter((o) => !ignore.has(o.what));
}

async function readObstacles(box) {
  const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, z: 0 };
  const radius = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 + 3000;
  const inBox = (p, m = 3000) => p.x > box.x0 - m && p.x < box.x1 + m && p.y > box.y0 - m && p.y < box.y1 + m;
  const out = [];
  const items = (await call('scan', 'FGBuildable', { x: c.x, y: c.y, z: 0 }, radius, 20000, {})).items;
  for (const it of items) {
    const short = it.path.split('.').pop();
    if (!inBox(it.location)) continue;
    const cls = it.class;
    // cables electriques : transparents, comme la vegetation (utilisateur, 23/10/2026 : « c'est pas normal que le reseau
    // electrique te bloque, il devrait etre transparent comme la vegetation » ; ils n'ont pas de collision en jeu). Ils
    // fermaient le plateau du caterium a la gare des mines. Poteaux electriques aussi (« meme les poteaux devraient etre
    // transparents ») : si le jeu refuse un convoyeur contre un poteau, beltline le dira au troncon concerne.
    if (/PowerLine|PowerPole/.test(cls)) continue;
    // ascenseur (sans boite d'encombrement) : colonne de son pied a son sommet (mTopTransform, relatif a l'acteur)
    if (/ConveyorLift/.test(cls)) {
      const d = await call('dump', it.path, 3, 50, ['mTopTransform']);
      const t = (d.mTopTransform && (d.mTopTransform.Translation || d.mTopTransform.translation)) || { X: 0, Y: 0, Z: 2000 };
      const a = rad(it.yaw || 0);
      const top = { x: it.location.x + t.X * Math.cos(a) - t.Y * Math.sin(a), y: it.location.y + t.X * Math.sin(a) + t.Y * Math.cos(a), z: it.location.z + t.Z };
      out.push({ kind: 'seg', a: it.location, b: top, r: 150, what: short });
      continue;
    }
    const sp = SPLINE.find(([re]) => re.test(cls));
    if (sp) {
      const pose = await call('pose', it.path);
      const { mSplineData: s } = await call('dump', it.path, 3, 50, ['mSplineData']);
      const pts = sampleSpline(s || [], pose.location, pose.rotation.yaw);
      for (let i = 1; i < pts.length; i++) out.push({ kind: 'seg', a: pts[i - 1], b: pts[i], r: sp[1], up: sp[2], what: short });
      continue;
    }
    const cl = clearance[cls];
    if (!cl) continue;
    for (const b of cl.boxes) {
      if (b.type === 'CT_Soft') continue;
      const t = (b.relativeTransform && b.relativeTransform.translation) || { x: 0, y: 0, z: 0 };
      const lc = { x: (b.min.x + b.max.x) / 2 + t.x, y: (b.min.y + b.max.y) / 2 + t.y, z: (b.min.z + b.max.z) / 2 + t.z };
      const a = rad(it.yaw || 0);
      out.push({
        kind: 'box', what: short, yaw: it.yaw || 0,
        c: { x: it.location.x + lc.x * Math.cos(a) - lc.y * Math.sin(a), y: it.location.y + lc.x * Math.sin(a) + lc.y * Math.cos(a), z: it.location.z + lc.z },
        h: { x: (b.max.x - b.min.x) / 2, y: (b.max.y - b.min.y) / 2, z: (b.max.z - b.min.z) / 2 },
      });
    }
  }
  // pieces legeres : boite centree, cote le plus long dans les deux sens
  const lwClasses = Object.keys(clearance).filter((n) => /Foundation|Wall|Pillar|Beam|Ramp|Frame|Catwalk|Walkway|Stair|Fence|Roof|Quarter|Corner/i.test(n) && !/PowerPole|Conveyor|Pipe/i.test(n));
  for (const cls of lwClasses) {
    let r;
    try { r = await call('lightweight', cls, { x: c.x, y: c.y, z: 0 }, radius * 2); } catch (e) { continue; }
    const b = clearance[cls].boxes[0];
    const hh = Math.max(b.max.x - b.min.x, b.max.y - b.min.y) / 2;
    for (const it of r.items || []) {
      if (!inBox(it.location)) continue;
      out.push({ kind: 'box', what: cls, yaw: 0, c: { x: it.location.x, y: it.location.y, z: it.location.z + (b.min.z + b.max.z) / 2 }, h: { x: hh, y: hh, z: (b.max.z - b.min.z) / 2 } });
    }
  }
  return out;
}

// Courbe d'un rail / convoyeur / tuyau (mSplineData : points relatifs a l'acteur, tangentes d'Hermite), tous les ~2 m
function sampleSpline(spline, base, yaw) {
  const a = rad(yaw || 0), rot = (v) => ({ x: v.X * Math.cos(a) - v.Y * Math.sin(a), y: v.X * Math.sin(a) + v.Y * Math.cos(a), z: v.Z });
  const out = [];
  for (let i = 1; i < spline.length; i++) {
    const p0 = rot(spline[i - 1].Location), p1 = rot(spline[i].Location), t0 = rot(spline[i - 1].LeaveTangent), t1 = rot(spline[i].ArriveTangent);
    const n = Math.max(2, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) / 200));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
      const f = (q) => h00 * p0[q] + h10 * t0[q] + h01 * p1[q] + h11 * t1[q];
      out.push({ x: base.x + f('x'), y: base.y + f('y'), z: base.z + f('z') });
    }
  }
  return out;
}

// Grille d'acces aux obstacles (mailles de 20 m)
function index(obs) {
  const G = 2000, map = new Map();
  const add = (o, x0, y0, x1, y1) => {
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(y0 / G); j <= Math.floor(y1 / G); j++) {
      const k = i + ',' + j; if (!map.has(k)) map.set(k, []); map.get(k).push(o);
    }
  };
  for (const o of obs) {
    if (o.kind === 'box') { const r = Math.hypot(o.h.x, o.h.y); add(o, o.c.x - r, o.c.y - r, o.c.x + r, o.c.y + r); }
    else add(o, Math.min(o.a.x, o.b.x) - o.r, Math.min(o.a.y, o.b.y) - o.r, Math.max(o.a.x, o.b.x) + o.r, Math.max(o.a.y, o.b.y) + o.r);
  }
  return (x, y) => map.get(Math.floor(x / G) + ',' + Math.floor(y / G)) || [];
}

// Colonne du gabarit en (x, y), de zb a zt : premier obstacle touche (nom), ou null
function hitColumn(W, x, y, zb, zt, zRail) {
  if (hAt(W.relief, x, y) > zRail + 30) return 'relief';
  for (const [ob, ot] of overAt(W.relief, x, y)) if (zt >= ob && zb <= ot) return 'surplomb';
  for (const o of W.near(x, y)) {
    if (o.kind === 'box') {
      const a = rad(-o.yaw), dx = x - o.c.x, dy = y - o.c.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= o.h.x + 50 && Math.abs(ly) <= o.h.y + 50 && zt >= o.c.z - o.h.z && zb <= o.c.z + o.h.z) return o.what;
    } else {
      for (const z of [zb, (zb + zt) / 2, zt]) {
        const ab = { x: o.b.x - o.a.x, y: o.b.y - o.a.y, z: o.b.z - o.a.z };
        const L2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z || 1;
        const t = Math.max(0, Math.min(1, ((x - o.a.x) * ab.x + (y - o.a.y) * ab.y + (z - o.a.z) * ab.z) / L2));
        const px = o.a.x + ab.x * t, py = o.a.y + ab.y * t, pz = o.a.z + ab.z * t;
        if (Math.hypot(x - px, y - py) <= o.r + 50 && Math.abs(z - pz) <= (o.up || o.r) + 50) return o.what;
      }
    }
  }
  return null;
}

// Point de l'axe (x, y, z, cap) : premier obstacle sous le gabarit (colonnes tous les ~2 m en travers), ou null
function hitAt(W, p) {
  const a = rad(p.cap + 90), n = Math.max(2, Math.ceil(W.width / 200));
  for (let k = 0; k <= n; k++) {
    const o = -W.width / 2 + (W.width * k) / n;
    const h = hitColumn(W, p.x + o * Math.cos(a), p.y + o * Math.sin(a), p.z - 50, p.z + W.height, p.z);
    if (h) return h;
  }
  return null;
}

// --- primitives --------------------------------------------------------------------------------------------------------
// Pas de longueur STEP depuis n (cap n.cap, abscisse n.s), virage dth : points tous les 4 m, altitude donnee par le
// profil en long prof(s) -> { z, grade }
function step(n, dth, prof) {
  const pts = [];
  const N = 4;
  let x = n.x, y = n.y, cap = n.cap;
  const k = rad(dth) / STEP; // courbure (rad/uu)
  for (let i = 1; i <= N; i++) {
    const s = (STEP * i) / N;
    if (dth === 0) { x = n.x + s * Math.cos(rad(n.cap)); y = n.y + s * Math.sin(rad(n.cap)); }
    else {
      const R = 1 / k, a0 = rad(n.cap), a1 = a0 + k * s;
      x = n.x + R * (Math.sin(a1) - Math.sin(a0)); y = n.y - R * (Math.cos(a1) - Math.cos(a0));
    }
    cap = n.cap + (dth * i) / N;
    const p = prof(n.s + s);
    pts.push({ x, y, z: p.z, grade: p.grade, cap, s: n.s + s });
  }
  return pts;
}

// Profil en long a pente g : depart a plat, la pente s'installe sur T (raccord parabolique), puis montee (ou descente)
// reguliere jusqu'a l'altitude d'arrivee, ensuite a plat
function profile(from, to, g) {
  const T = 6400, sg = Math.sign(to.z - from.z), D = Math.abs(to.z - from.z);
  const climb = (s) => (s < T ? (g * s * s) / (2 * T) : g * (s - T / 2));
  return (s) => {
    const c = climb(s);
    if (c >= D) return { z: to.z, grade: 0 };
    return { z: from.z + sg * c, grade: sg * (s < T ? (g * s) / T : g) };
  };
}

// Rail du jeu de a vers b (caps, pentes) : courbe d'Hermite (tangentes de longueur = corde), points tous les ~2 m,
// rayon minimal en plan et pente maximale
function hermite(a, b) {
  const D = Math.hypot(b.x - a.x, b.y - a.y);
  const t0 = { x: D * Math.cos(rad(a.cap)), y: D * Math.sin(rad(a.cap)) }, t1 = { x: D * Math.cos(rad(b.cap)), y: D * Math.sin(rad(b.cap)) };
  const n = Math.max(8, Math.ceil(D / 200)), pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    const d00 = 6 * t * t - 6 * t, d10 = 3 * t * t - 4 * t + 1, d01 = -6 * t * t + 6 * t, d11 = 3 * t * t - 2 * t;
    const x = h00 * a.x + h10 * t0.x + h01 * b.x + h11 * t1.x, y = h00 * a.y + h10 * t0.y + h01 * b.y + h11 * t1.y;
    const dx = d00 * a.x + d10 * t0.x + d01 * b.x + d11 * t1.x, dy = d00 * a.y + d10 * t0.y + d01 * b.y + d11 * t1.y;
    // altitude : Hermite en abscisse curviligne approchee par t * D, pentes aux bouts
    const z = h00 * a.z + h10 * a.grade * D + h01 * b.z + h11 * b.grade * D;
    pts.push({ x, y, z, cap: (Math.atan2(dy, dx) * 180) / Math.PI });
  }
  let rmin = Infinity, gmax = 0, len = 0;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    len += d;
    gmax = Math.max(gmax, Math.abs(pts[k].z - pts[k - 1].z) / (d || 1));
    if (k > 1) { const dc = Math.abs(rad(angDiff(pts[k].cap, pts[k - 1].cap))); if (dc > 1e-9) rmin = Math.min(rmin, d / dc); }
  }
  return { pts, rmin, gmax, len };
}

// --- recherche ---------------------------------------------------------------------------------------------------------
class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(a[p], a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && less(a[l], a[m])) m = l; if (r < a.length && less(a[r], a[m])) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
const less = (p, q) => p.f < q.f || (p.f === q.f && p.seq < q.seq);

// A* en plan (x, y, cap) pour un profil en long de pente g : le plus court trace libre dont l'altitude suit le profil ;
// arrivee par un rail du jeu (Hermite) vers la pose exacte, de pente au plus g + 1 point. null si aucun.
function astar(W, from, to, o, g, stats) {
  const prof = profile(from, to, g);
  const cost = (len, dth) => len * (1 + (0.03 * Math.abs(dth)) / 10);
  const h = (n) => 1.3 * Math.hypot(to.x - n.x, to.y - n.y);
  const key = (n) => Math.round(n.x / 400) + ',' + Math.round(n.y / 400) + ',' + Math.round(norm360(n.cap));
  let seq = 0;
  const start = { x: from.x, y: from.y, z: from.z, cap: from.cap, grade: 0, s: 0, c: 0, parent: null, seq: seq++ };
  start.f = h(start);
  const open = new Heap(); open.push(start);
  const best = new Map([[key(start), 0]]);
  let expanded = 0;
  while (open.size) {
    const n = open.pop();
    if (best.get(key(n)) < n.c) continue;
    if (++expanded > o.maxExpand) { stats.abandon = true; break; }
    // raccord final : un rail du jeu jusqu'a la pose d'arrivee exacte
    const D = Math.hypot(to.x - n.x, to.y - n.y);
    if (D >= 1200 && D <= MAX_RAIL && Math.abs(angDiff(n.cap, to.cap)) <= 50) {
      const H = hermite(n, Object.assign({ grade: 0 }, to));
      if (H.rmin >= o.rmin && H.gmax <= g + 0.01 && H.len <= MAX_RAIL * 1.05 && H.pts.every((p) => !hitAt(W, p))) {
        stats.expanded += expanded;
        return { node: n, final: H, grade: g };
      }
    }
    for (const dth of TURNS) {
      const pts = step(n, dth, prof);
      const e = pts[pts.length - 1];
      if (e.x < W.box.x0 || e.x > W.box.x1 || e.y < W.box.y0 || e.y > W.box.y1) continue;
      let hit = null;
      for (const p of pts) { hit = hitAt(W, p); if (hit) break; }
      if (hit) { stats.hits[hit] = (stats.hits[hit] || 0) + 1; continue; }
      const c = { x: e.x, y: e.y, z: e.z, cap: norm360(Math.round(e.cap)), grade: e.grade, s: e.s, c: n.c + cost(STEP, dth), parent: n, dth, seq: seq++ };
      const k = key(c);
      if (best.has(k) && best.get(k) <= c.c) continue;
      best.set(k, c.c);
      c.f = c.c + h(c);
      open.push(c);
    }
  }
  stats.expanded += expanded;
  return null;
}

// Pente la plus douce qui passe : la pente visee, sinon recherche par dichotomie (au demi-point) jusqu'a la pente
// maximale (« pour la pente on est pas dogmatique » : la pente visee n'est pas une limite)
function search(W, from, to, o) {
  const stats = { expanded: 0, hits: {}, essais: [] };
  const run = (g) => { const r = astar(W, from, to, o, g, stats); stats.essais.push((g * 100).toFixed(1) + ' % : ' + (r ? 'passe' : 'non')); console.log('  pente', (g * 100).toFixed(1), '% :', r ? 'passe' : 'non'); return r; };
  // pente la plus douce possible en ligne droite (denivele sur distance, raccord de depart compris) : les essais en
  // dessous echoueraient a coup sur, et un essai qui echoue explore tout (plusieurs minutes)
  const floor = Math.abs(to.z - from.z) / (Math.hypot(to.x - from.x, to.y - from.y) + 3200);
  const g0 = Math.max(o.pente, Math.ceil(floor * 200) / 200);
  let res = run(g0);
  if (!res) {
    let hi = run(o.penteMax);
    if (!hi) throw new Error('aucun trace jusqu\'a ' + o.penteMax * 100 + ' % (obstacles les plus frequents : ' + JSON.stringify(topHits(stats.hits)) + ')');
    let lo = g0, hiG = o.penteMax;
    while (hiG - lo > 0.005 + 1e-9) {
      const mid = Math.round(((lo + hiG) / 2) * 200) / 200;
      if (mid <= lo || mid >= hiG) break;
      const r = run(mid);
      if (r) { hi = r; hiG = mid; } else lo = mid;
    }
    res = hi;
  }
  res.expanded = stats.expanded;
  res.essais = stats.essais;
  return res;
}
const topHits = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);

// Noeuds du trace -> troncons de 90 m au plus, virage de MAX_TURN au plus par troncon, sans changer de sens de virage
function toRails(res, from, to) {
  const nodes = [];
  for (let n = res.node; n; n = n.parent) nodes.unshift(n);
  const pts = [{ x: from.x, y: from.y, z: from.z, cap: from.cap, grade: 0, s: 0, dth: 0 }];
  for (let i = 1; i < nodes.length; i++) pts.push({ x: nodes[i].x, y: nodes[i].y, z: nodes[i].z, cap: nodes[i].cap, grade: nodes[i].grade, dth: nodes[i].dth, len: STEP });
  pts.push({ x: to.x, y: to.y, z: to.z, cap: to.cap, grade: 0, dth: angDiff(to.cap, nodes[nodes.length - 1].cap), len: res.final.len, final: true });
  const joints = [pts[0]];
  let acc = 0, turn = 0, sign = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], s = Math.sign(p.dth);
    const brk = acc + p.len > MAX_RAIL || Math.abs(turn + p.dth) > MAX_TURN || (s && sign && s !== sign);
    if (brk && acc > 0) { joints.push(pts[i - 1]); acc = 0; turn = 0; sign = 0; }
    acc += p.len; turn += p.dth; if (s) sign = s;
  }
  joints.push(pts[pts.length - 1]);
  return joints.map((j) => ({ x: Math.round(j.x), y: Math.round(j.y), z: Math.round(j.z), cap: Math.round(j.cap * 100) / 100, grade: Math.round(j.grade * 1000) / 1000 }));
}

// Rectitude d'un trace (utilisateur, 23/10/2026 : « t'as moyen de mesurer a quel point un troncon est rectiligne ? ») :
// sinuosite = longueur / corde (1 = droit) ; virage en trop = somme des |virages| moins le virage utile (ecart des caps
// de depart et d'arrivee) : un S ou un detour en ajoute ; changements de sens de virage ; ecart maximal a la corde
function rectitude(joints) {
  const a = joints[0], b = joints[joints.length - 1];
  const cx = b.x - a.x, cy = b.y - a.y, corde = Math.hypot(cx, cy) || 1;
  let len = 0, tot = 0, rev = 0, sign = 0, dev = 0;
  for (let i = 1; i < joints.length; i++) {
    len += Math.hypot(joints[i].x - joints[i - 1].x, joints[i].y - joints[i - 1].y);
    const dc = angDiff(joints[i].cap, joints[i - 1].cap), s = Math.sign(Math.round(dc));
    tot += Math.abs(dc);
    if (s && sign && s !== sign) rev++;
    if (s) sign = s;
    dev = Math.max(dev, Math.abs(((joints[i].x - a.x) * cy - (joints[i].y - a.y) * cx) / corde));
  }
  const utile = Math.abs(angDiff(b.cap, a.cap));
  return { sinuosite: Math.round((len / corde) * 100) / 100, virage_total: Math.round(tot), virage_utile: Math.round(utile), virage_en_trop: Math.round(tot - utile), changements_de_sens: rev, ecart_corde_m: Math.round(dev / 100) };
}

// --- convoyeurs --------------------------------------------------------------------------------------------------------
const BELT = {
  CELL: 400, // grille de la recherche (uu)
  SPAN: 4000, // poteaux tous les 40 m au plus (beltline, le jeu refuse au-dela de 56 m)
  MIN_SPAN: 800, // portee la plus courte essayee entre deux poteaux
  SLOPE: 0.55, // pente du convoyeur entre deux poteaux (30 deg = 0,577 ; beltline accepte 0,6)
  HALF: 120, // demi-largeur du gabarit (convoyeur de 1,2 m + marge)
  CLEAR: 30, // relief au moins 30 cm sous le convoyeur entre deux poteaux
  SEA: -1730, // surface de la mer : jamais de convoyeur dessous
  TURN: 600, // cout d'un virage de 45 deg (uu) : peu de virages, de grandes lignes droites
};
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// Gabarit du convoyeur en (x, y) a l'altitude z (cap de la ligne en radians) : obstacle touche, ou null
function beltHitAt(W, x, y, z, a) {
  const nx = -Math.sin(a), ny = Math.cos(a);
  for (const o of [-BELT.HALF, 0, BELT.HALF]) {
    const h = hitColumn(W, x + o * nx, y + o * ny, z - 60, z + 100, Infinity);
    if (h) return h;
  }
  return null;
}

// Ligne droite en plan de a a b sur poteaux de hauteur H qui suivent le relief : poteaux tous les SPAN au plus (portee
// raccourcie si le relief l'impose), pente, degagement sous le convoyeur, obstacles, mer. { poles } ou { why }
function beltRun(W, a, b, H) {
  const L = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
  let why = 'vide';
  // portees de plus en plus courtes, une a une : un poteau qui tombe sur un obstacle (convoyeur franchi par-dessus)
  // se decale au nombre de portees suivant
  for (let n = Math.max(1, Math.ceil(L / BELT.SPAN)); L / n >= Math.min(BELT.MIN_SPAN, L); n++) {
    const poles = [];
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      const g = hAt(W.relief, x, y);
      poles.push({ x, y, g, z: (k === 0 && a.z != null ? a.z : k === n && b.z != null ? b.z : g + H) });
    }
    why = null;
    for (let k = 0; k < n && !why; k++) {
      const p = poles[k], q = poles[k + 1], span = L / n;
      if (p.g === -Infinity || q.g === -Infinity || Math.min(p.z, q.z) < BELT.SEA + 100) { why = 'mer'; break; }
      if (Math.abs(q.z - p.z) / span > BELT.SLOPE) { why = 'pente'; break; }
      const m = Math.max(2, Math.ceil(span / 200));
      for (let s = 0; s <= m; s++) {
        const t = s / m, x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t, z = p.z + (q.z - p.z) * t;
        if (s > 0 && s < m && hAt(W.relief, x, y) > z - BELT.CLEAR) { why = 'relief'; break; }
        const h = beltHitAt(W, x, y, z, ang);
        if (h) { why = h; break; }
      }
      // poteau : colonne du sol au convoyeur (sauf aux deux bouts de la ligne, accroches a des batiments)
      if (!why && k + 1 < n) { const h = hitColumn(W, q.x, q.y, q.g, q.z, Infinity); if (h) why = 'poteau sur ' + h; }
    }
    if (!why) return { poles };
    if (why !== 'relief' && why !== 'pente' && !/^poteau sur/.test(why)) break; // obstacle ou mer : des portees plus courtes n'y changent rien
  }
  return { why };
}

// Franchissement d'un convoyeur existant : par-dessus, sur poteaux plus hauts (BELT.OVER de plus)
const isBelt = (why) => /ConveyorBelt|ConveyorLift|poteau sur Build_ConveyorBelt/.test(String(why));
BELT.OVER = 400; // 4 m au-dessus de la ligne normale (convoyeur franchi a 2 m : 3,4 m d'ecart)
BELT.OVER_COST = 2000; // cout d'une maille franchie en hauteur (uu) : franchir seulement s'il le faut
BELT.POLE_BIAS = 100; // le jeu donne un poteau 1 m plus court que demande

// A* en grille (8 directions, virages penalises, demi-tours interdits) de s a g ({x, y} et direction de depart dir),
// puis raccourcis en lignes droites : de chaque point, le plus loin atteignable par beltRun
function beltSearch(W, s, g, dir, H, stats) {
  const C = BELT.CELL, x0 = W.box.x0, y0 = W.box.y0;
  const nx = Math.floor((W.box.x1 - x0) / C) + 1, ny = Math.floor((W.box.y1 - y0) / C) + 1;
  const cell = (p) => [Math.round((p.x - x0) / C), Math.round((p.y - y0) / C)];
  const pt = (i, j) => ({ x: x0 + i * C, y: y0 + j * C });
  // maille : 0 fermee, 1 libre a la hauteur normale, 2 libre seulement par-dessus un convoyeur (H + OVER)
  const free = new Map();
  const level = (x, y, ang2) => {
    const gr = hAt(W.relief, x, y);
    if (!(gr > BELT.SEA + 100 - H)) return 0;
    const hit = (hh) => ang2.map((an) => beltHitAt(W, x, y, gr + hh, an)).find(Boolean) || null;
    const h1 = hit(H);
    if (!h1) return 1;
    stats.hits[h1] = (stats.hits[h1] || 0) + 1;
    return isBelt(h1) && !hit(H + BELT.OVER) ? 2 : 0;
  };
  const isFree = (i, j) => {
    const k = i * ny + j;
    if (!free.has(k)) { const p = pt(i, j); free.set(k, level(p.x, p.y, [0, Math.PI / 2])); }
    return free.get(k);
  };
  const [si, sj] = cell(s), [gi, gj] = cell(g);
  const d0 = Math.round(((Math.atan2(dir.y, dir.x) / (Math.PI / 4)) % 8 + 8) % 8) % 8;
  const key = (i, j, d) => (i * ny + j) * 8 + d;
  const h = (i, j) => C * Math.hypot(gi - i, gj - j);
  const open = new Heap();
  let seq = 0;
  const best = new Map();
  const start = { i: si, j: sj, d: d0, c: 0, f: h(si, sj), seq: seq++, parent: null };
  open.push(start); best.set(key(si, sj, d0), 0);
  let found = null, expanded = 0;
  while (open.size) {
    const n = open.pop();
    if (best.get(key(n.i, n.j, n.d)) < n.c) continue;
    if (n.i === gi && n.j === gj) { found = n; break; }
    if (++expanded > 400000) break;
    for (let dd = -2; dd <= 2; dd++) {
      const d = (n.d + dd + 8) % 8, [di, dj] = DIRS[d], i = n.i + di, j = n.j + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny || !isFree(i, j)) continue;
      const a = pt(n.i, n.j), b = pt(i, j);
      // memes regles que beltRun (pente du convoyeur, relief 30 cm dessous au milieu du pas) : plus souple, la grille
      // passait sur une bosse que les lignes droites refusaient ensuite (ligne cu1, colline est, 23/10/2026)
      const ga = hAt(W.relief, a.x, a.y), gb = hAt(W.relief, b.x, b.y), step = C * Math.hypot(di, dj);
      if (Math.abs(gb - ga) / step > BELT.SLOPE) continue;
      // relief sous le convoyeur aux memes points que beltRun (tiers d'un pas en diagonale) : la grille ne testait que le
      // milieu, et acceptait un pas que les lignes droites refusaient ensuite (« troncon impossible », ligne de la 634)
      const ns = Math.max(2, Math.ceil(step / 200));
      let bump = false;
      for (let q = 1; q < ns && !bump; q++) { const t = q / ns; bump = hAt(W.relief, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) > ga + (gb - ga) * t + H - BELT.CLEAR; }
      if (bump) continue;
      // milieu du pas, gabarit oriente le long du pas : un convoyeur fin passait entre deux centres de mailles (ligne
      // fe3 a travers la ligne fe1 posee juste avant, 23/10/2026)
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const lm = level(m.x, m.y, [Math.atan2(dj, di)]);
      if (!lm) continue;
      const over = (isFree(i, j) === 2 ? 1 : 0) + (lm === 2 ? 1 : 0);
      const c = n.c + C * Math.hypot(di, dj) + BELT.TURN * Math.abs(dd) + BELT.OVER_COST * over;
      const k = key(i, j, d);
      if (best.has(k) && best.get(k) <= c) continue;
      best.set(k, c);
      open.push({ i, j, d, c, f: c + h(i, j), seq: seq++, parent: n });
    }
  }
  stats.expanded += expanded;
  if (!found) return null;
  const cells = [];
  for (let n = found; n; n = n.parent) cells.unshift(pt(n.i, n.j));
  const P = [s, ...cells.slice(1, -1), g];
  // raccourcis : de P[i], le point P[j] le plus loin joignable en ligne droite, a la hauteur normale, sinon par-dessus
  // un convoyeur (poteaux de ce troncon plus hauts : champ h)
  const poles = [Object.assign({}, s, { g: hAt(W.relief, s.x, s.y), h: H })];
  let i = 0;
  while (i < P.length - 1) {
    let j = P.length - 1, run = null, hRun = H;
    for (; j > i; j--) {
      const a = Object.assign({}, P[i], { z: poles[poles.length - 1].z });
      run = beltRun(W, a, P[j], H); hRun = H;
      if (!run.poles && isBelt(run.why)) { run = beltRun(W, a, P[j], H + BELT.OVER); hRun = H + BELT.OVER; }
      if (run.poles) break;
    }
    if (!run || !run.poles) return { fail: 'troncon impossible depuis ' + Math.round(P[i].x) + ',' + Math.round(P[i].y) + ' (' + (run ? run.why : '?') + ')' };
    poles.push(...run.poles.slice(1).map((p) => Object.assign(p, { h: hRun })));
    i = j;
  }
  // le point d'approche reste a la hauteur normale (convoyeur d'arrivee vers le connecteur)
  return { poles };
}

async function planBelt() {
  const nom = opt('nom');
  if (!nom) throw new Error('--nom requis');
  const H = 100 * Number(opt('poteau', 2));
  const ends = {};
  for (const k of ['de', 'a']) {
    const ref = opt(k), i = ref.lastIndexOf('.');
    const actor = ref.slice(0, i), name = ref.slice(i + 1);
    const full = actor.includes('/') ? actor : '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.' + actor;
    const c = (await call('connections', full)).find((cc) => cc.name === name);
    if (!c) throw new Error('connecteur introuvable : ' + ref);
    const hn = Math.hypot(c.normal.x, c.normal.y) || 1;
    ends[k] = { path: full, name, at: c.location, n: { x: c.normal.x / hn, y: c.normal.y / hn } };
  }
  const D = ends.de, A = ends.a;
  // point d'approche : 4 m devant la sortie de depart ; a l'arrivee, deux poteaux dans l'axe de l'entree, a 12 et 6 m
  // (la recherche vise celui de 12 m) : les deux derniers troncons sont droits et alignes sur le connecteur. Un dernier
  // troncon court qui tournait de 69 deg en montant de 2 m etait refuse (FGCDConveyorTooSteep, cuivre, 23/10/2026)
  const g6 = { x: A.at.x + 600 * A.n.x, y: A.at.y + 600 * A.n.y };
  // un seul releve pour toute la zone : bornes des connecteurs, elargies de la marge et des 20 m ou peuvent tomber les
  // points de depart et d'arrivee
  const marge0 = 100 * Number(opt('marge', 60)) + 2000;
  const box0 = { x0: Math.min(D.at.x, A.at.x) - marge0, x1: Math.max(D.at.x, A.at.x) + marge0, y0: Math.min(D.at.y, A.at.y) - marge0, y1: Math.max(D.at.y, A.at.y) + marge0 };
  // --releve <m> : pas du releve du relief (4 m par defaut) ; 2 m pour se faufiler entre des blocs (passage sous l'arche
  // de la cuvette de bauxite de S13 E101, 24/10/2026 : couloir de 4 a 6 m entre deux rochers, ferme a 4 m). Plus fin que
  // 4 m : releve a deux finesses, grossier a --releve-grossier m (4 par defaut : compare le 24/10/2026 sur 200 m de la cuvette de
  // bauxite, 2 m partout en reference : grossier 10 m, 7 657 points, 71 % de mailles fines, 1 rocher manque ; 6 m, 6 555 ; 4 m,
  // 6 050 points, 38 %, aucun manque. Sur terrain accidente, les grandes mailles sont presque toutes relevees finement)
  const RS = Math.round(100 * Number(opt('releve', 4)));
  const RC = Math.round(100 * Number(opt('releve-grossier', 4)));
  const R0 = RS < 400 ? await reliefMulti(box0, RC, RS) : await relief(box0, RS);
  // poteaux sur le sol raide refuses par le jeu (beltline les decale alors de 3 a 6 m, hors de l'axe : premier poteau du
  // caterium, foreuse a flanc de colline, contre un poteau electrique, 23/10/2026) : premier point de l'axe sur un sol
  // praticable, a 4, 8, 12 ou 16 m du connecteur
  const steep = (p) => Math.max(...[[200, 0], [-200, 0], [0, 200], [0, -200]].map(([dx, dy]) => Math.abs(hBil(R0, p.x + dx, p.y + dy) - hBil(R0, p.x, p.y)) / 200)) > 0.35;
  const onAxis = (E, ds, ok = () => true) => { for (const d of ds) { const p = { x: E.at.x + d * E.n.x, y: E.at.y + d * E.n.y, d }; if (!steep(p) && ok(p)) return p; } return null; };
  const first = (E, ds) => ({ x: E.at.x + ds[0] * E.n.x, y: E.at.y + ds[0] * E.n.y, d: ds[0] });
  // depart : de preference un point ou le premier troncon reste doux (poteau de 1 m au moins, pente de bout 0,2) ; sortie
  // d'un fusionneur pose au sol, sol 1,4 m plus haut a 4 m (S13 E101, 24/10/2026 : « troncon de bout trop raide »)
  const softStart = (p) => hBil(R0, p.x, p.y) + 100 <= D.at.z + 0.2 * p.d + 25;
  const s = onAxis(D, [400, 800, 1200, 1600], softStart) || onAxis(D, [400, 800, 1200, 1600]) || first(D, [400]);
  const g = onAxis(A, [1200, 1600, 2000]) || first(A, [1200]);
  const marge = 100 * Number(opt('marge', 60));
  const box = { x0: Math.min(s.x, g.x) - marge, x1: Math.max(s.x, g.x) + marge, y0: Math.min(s.y, g.y) - marge, y1: Math.max(s.y, g.y) + marge };
  const W = { box, width: 2 * BELT.HALF, height: 160 };
  W.relief = R0; // la zone du releve couvre celle de la recherche
  // la foreuse de depart reste un obstacle (le point d'approche est devant sa sortie) ; l'ascenseur d'arrivee est ignore
  W.near = index(await obstacles(box, new Set([A.path.split('.').pop()])));
  // depart : la recherche part de la maille la plus proche du point d'approche, ramenee jusqu'a 2,8 m vers la foreuse
  // quand sa sortie n'est pas dans l'axe de la grille (caterium, cap 160, 23/10/2026 : « grille fermee », foreuse touchee
  // tout autour). Point d'approche recule le long de l'axe (jusqu'a 20 m) tant que lui ou sa maille touche un obstacle.
  const ang0 = Math.atan2(D.n.y, D.n.x);
  const blocked = (p) => [p, { x: box.x0 + Math.round((p.x - box.x0) / BELT.CELL) * BELT.CELL, y: box.y0 + Math.round((p.y - box.y0) / BELT.CELL) * BELT.CELL }]
    .some((q) => beltHitAt(W, q.x, q.y, hAt(W.relief, q.x, q.y) + H, ang0));
  if (blocked(s)) {
    for (let d = s.d + 400; d <= 2000; d += 400) {
      const p = { x: D.at.x + d * D.n.x, y: D.at.y + d * D.n.y, d };
      if (!steep(p) && !blocked(p)) { Object.assign(s, p); console.log('depart recule a', d / 100, 'm de la sortie (obstacle au plus pres)'); break; }
    }
  }
  const stats = { expanded: 0, hits: {} };
  const t0 = Date.now();
  const res = beltSearch(W, s, g, D.n, H, stats);
  if (!res || res.fail) throw new Error('aucune ligne : ' + (res ? res.fail : 'grille fermee') + ' (obstacles les plus frequents : ' + JSON.stringify(topHits(stats.hits)) + ')');
  // troncons de bout, droits, a pente moyenne de END_SLOPE au plus : un troncon court a bouts horizontaux est une
  // courbe d'Hermite dont la pente au milieu vaut 1,5 fois la moyenne (0,55 de moyenne sur 5 m : refuse). Sol reel sous
  // les poteaux (interpole) ; poteaux de 1 a 7 m. Du connecteur d'arrivee vers l'amont : poteau a 6 m, puis a 12 m.
  // sauf si le sol y est raide (bord de colline : le jeu refuse le poteau et beltline le decale de 6 m, hors de l'axe ;
  // cuivre 2, 23/10/2026) : alors le poteau de l'axe plus loin, sur le plat, va droit au connecteur
  const skip6 = steep(g6) || g.d > 1200;
  if (!skip6) res.poles.push(Object.assign({}, g6, { g: hBil(W.relief, g6.x, g6.y) }));
  // 0,2 : 0,3 sur les 6 derniers metres etait encore refuse (FGCDConveyorTooSteep) au bout d'une ligne sur poteaux de
  // 6 m (cuivre des mines, 23/10/2026)
  const END_SLOPE = 0.2;
  const fit = (p, c, d) => {
    p.g = hBil(W.relief, p.x, p.y);
    const want = Math.max(c.z - END_SLOPE * d, Math.min(c.z + END_SLOPE * d, p.g + (p.h || H)));
    p.h = Math.max(100, Math.min(700, want - p.g)); p.z = p.g + p.h;
    if (Math.abs(p.z - c.z) / Math.max(d, 1) > END_SLOPE + 0.05) throw new Error('troncon de bout trop raide en ' + Math.round(p.x) + ',' + Math.round(p.y) + ' : ' + ((p.z - c.z) / 100).toFixed(1) + ' m sur ' + (d / 100).toFixed(1) + ' m (connecteur a tourner vers un sol au meme niveau)');
  };
  const nP = res.poles.length;
  if (skip6) fit(res.poles[nP - 1], A.at, g.d);
  else { fit(res.poles[nP - 1], A.at, 600); fit(res.poles[nP - 2], res.poles[nP - 1], 600); }
  fit(res.poles[0], D.at, s.d);
  // fichier de ligne de beltline : depart (connecteur), poteaux (z = sol), point d'approche, raccord final
  // poteaux d'un franchissement ou de bout : hauteur propre au sommet (beltline : poleHeight du sommet, en m). Le jeu
  // donne un poteau 1 m plus court que demande (references/convoyeurs.md) : on demande 1 m de plus (sans cela, dernier
  // troncon refuse FGCDConveyorTooSteep aux deux lignes du cuivre, 23/10/2026)
  const ask = (h) => Math.round((h + BELT.POLE_BIAS) / 10) / 10;
  const pts = res.poles.map((p) => Object.assign({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.g) }, p.h && p.h !== H ? { poleHeight: ask(p.h) } : {}));
  const line = {
    recipe: opt('recette', 'Recipe_ConveyorBeltMk6_C'),
    start: { path: D.path, name: D.name },
    points: [{ x: Math.round(D.at.x), y: Math.round(D.at.y), z: Math.round(D.at.z) }, ...pts, { x: Math.round(A.at.x), y: Math.round(A.at.y), z: Math.round(A.at.z) }],
    poleHeight: ask(H),
    groundAbove: 15,
    end: { path: A.path, name: A.name },
  };
  fs.mkdirSync(TRACES, { recursive: true });
  const file = path.join(TRACES, nom + '-ligne.json');
  fs.writeFileSync(file, JSON.stringify(line, null, 1));
  let len = 0;
  for (let k = 1; k < line.points.length; k++) len += Math.hypot(line.points[k].x - line.points[k - 1].x, line.points[k].y - line.points[k - 1].y);
  console.log('ligne', nom, ':', Math.round(len / 100), 'm,', pts.length, 'poteaux,', stats.expanded, 'noeuds en', Math.round((Date.now() - t0) / 1000), 's ->', path.relative(__dirname, file));
  for (const p of pts) console.log('  ', p.x, p.y, (p.z / 100).toFixed(1) + ' m');
}

// --- commandes ---------------------------------------------------------------------------------------------------------
async function connector(ref) {
  const i = ref.lastIndexOf('.');
  const rail = ref.slice(0, i), name = ref.slice(i + 1);
  const full = rail.includes('/') ? rail : '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.' + rail;
  const all = (await call('rails', full)).connections;
  const c = all.find((cc) => cc.name === name);
  if (!c) throw new Error('connecteur introuvable : ' + ref);
  const far = all.find((cc) => cc.name !== name); // autre bout du rail : joint du plan pour le rail existant
  return { path: full.split('.').pop(), name, location: c.location, far: far.location };
}

async function planRail() {
  const from = pose(opt('de')), to = pose(opt('a'));
  const nom = opt('nom');
  if (!nom) throw new Error('--nom requis');
  const double = flag('double');
  const o = {
    width: 100 * Number(opt('largeur', double ? 12.5 : 6)),
    height: 100 * Number(opt('hauteur', 7.5)),
    pente: Number(opt('pente', 10)) / 100,
    penteMax: Number(opt('pente-max', 20)) / 100,
    rmin: 100 * Number(opt('rayon-min', double ? 21.25 : 18)),
    maxExpand: Number(opt('max', 300000)),
  };
  const marge = 100 * Number(opt('marge', 150));
  const box = { x0: Math.min(from.x, to.x) - marge, x1: Math.max(from.x, to.x) + marge, y0: Math.min(from.y, to.y) - marge, y1: Math.max(from.y, to.y) + marge };
  const ignore = new Set((opt('ignore', '') || '').split(',').filter(Boolean));
  const ends = {};
  // arrivee : voie simple seulement, connecteur existant ou aboutit le dernier rail (aiguillage sur une ligne existante)
  if (double && opt('arrivee-a')) throw new Error('--arrivee-a : voie simple seulement');
  for (const [k, ref] of [['aller', opt('aller-de')], ['retour', opt('retour-a')], ['arrivee', opt('arrivee-a')]]) if (ref) { ends[k] = await connector(ref); ignore.add(ends[k].path); }
  const t0 = Date.now();
  const W = { box, width: o.width, height: o.height };
  W.relief = await relief(box, 400);
  const obs = await obstacles(box, ignore);
  W.near = index(obs);
  console.log('releve : relief', W.relief.nx + ' x ' + W.relief.ny, 'mailles de 4 m (traverses :', JSON.stringify(W.relief.skipped) + ') ; obstacles construits', obs.length, '(' + Math.round((Date.now() - t0) / 1000) + ' s)');
  // depart et arrivee eux-memes libres ?
  for (const [k, p] of [['depart', from], ['arrivee', to]]) { const hh = hitAt(W, p); if (hh) console.log('ATTENTION : ' + k + ' deja dans un obstacle (' + hh + ')'); }
  const t1 = Date.now();
  const res = search(W, from, to, o);
  const joints = toRails(res, from, to);
  let len = 0, gm = 0;
  for (let i = 1; i < joints.length; i++) {
    const d = Math.hypot(joints[i].x - joints[i - 1].x, joints[i].y - joints[i - 1].y);
    len += d; gm = Math.max(gm, Math.abs(joints[i].z - joints[i - 1].z) / d);
  }
  const out = { nom, de: from, a: to, double, options: o, ends, joints, longueur_m: Math.round(len / 100), pente_moyenne_max: Math.round(gm * 1000) / 10, pente_profil: Math.round(res.grade * 1000) / 10, rectitude: rectitude(joints), essais: res.essais, noeuds: res.expanded };
  fs.mkdirSync(TRACES, { recursive: true });
  fs.writeFileSync(path.join(TRACES, nom + '.json'), JSON.stringify(out, null, 1));
  console.log('trace', nom, ':', joints.length - 1, 'troncons,', out.longueur_m, 'm, pente moyenne la plus forte d\'un troncon', out.pente_moyenne_max, '% ;', res.expanded, 'noeuds en', Math.round((Date.now() - t1) / 1000), 's');
  const r = out.rectitude;
  console.log('rectitude : sinuosite', r.sinuosite, '| virage', r.virage_total, 'deg dont', r.virage_en_trop, 'en trop | changements de sens de virage', r.changements_de_sens, '| ecart a la corde', r.ecart_corde_m, 'm');
  for (const j of joints) console.log('  ', j.x, j.y, (j.z / 100).toFixed(1) + ' m', 'cap ' + j.cap, 'pente ' + (j.grade * 100).toFixed(0) + ' %');
}

// Balayage du gabarit le long des troncons (courbes d'Hermite des joints) : collision reelle du jeu
async function valider() {
  const nom = argv[1];
  const T = JSON.parse(fs.readFileSync(path.join(TRACES, nom + '.json'), 'utf8'));
  const half = { x: 100, y: T.options.width / 2, z: (T.options.height + 50) / 2 };
  const items = [];
  for (let i = 1; i < T.joints.length; i++) {
    const H = hermite(T.joints[i - 1], T.joints[i]);
    for (let k = 1; k < H.pts.length; k++) {
      const a = H.pts[k - 1], b = H.pts[k], dz = half.z - 50;
      items.push({ from: { x: a.x, y: a.y, z: a.z + dz }, to: { x: b.x, y: b.y, z: b.z + dz }, half, rail: i });
    }
  }
  const hits = [];
  for (let k = 0; k < items.length; k += 200) {
    const r = await call('sweeps', items.slice(k, k + 200).map(({ from, to, half: hf }) => ({ from, to, half: hf })));
    r.forEach((h, i) => { if (h.hit) hits.push(Object.assign({ troncon: items[k + i].rail }, h)); });
  }
  const ignore = new Set(Object.values(T.ends || {}).map((e) => e.path));
  const real = hits.filter((h) => !(h.component && [...ignore].some((p) => h.component.path.includes(p))) && !(h.component && /Foliage/i.test(h.component.path)));
  console.log(items.length, 'balayages ;', real.length, 'contacts');
  for (const h of real.slice(0, 30)) console.log('  troncon', h.troncon, 'en', Math.round(h.impact.x), Math.round(h.impact.y), (h.impact.z / 100).toFixed(1) + ' m', h.component ? h.component.cls + ' ' + h.component.path.split('.').slice(-2).join('.') : '?');
}

// Controle d'un trace dessine a la main (plans/traces/<nom>.json, joints ecrits par un script) avec le modele de la
// recherche : relief, surplombs et obstacles construits sous le gabarit le long de l'axe, rayon minimal de chaque rail.
// Connu a toute distance (valider, lui, ne voit les batiments que pres du joueur).
async function controler() {
  const nom = argv[1];
  const T = JSON.parse(fs.readFileSync(path.join(TRACES, nom + '.json'), 'utf8'));
  const xs = T.joints.map((j) => j.x), ys = T.joints.map((j) => j.y), marge = 100 * Number(opt('marge', 150));
  const box = { x0: Math.min(...xs) - marge, x1: Math.max(...xs) + marge, y0: Math.min(...ys) - marge, y1: Math.max(...ys) + marge };
  const W = { box, width: T.options.width, height: T.options.height };
  W.relief = await relief(box, 400);
  W.near = index(await obstacles(box, new Set(Object.values(T.ends || {}).map((e) => e.path))));
  let bad = 0;
  for (let i = 1; i < T.joints.length; i++) {
    const H = hermite(T.joints[i - 1], T.joints[i]);
    const hits = [...new Set(H.pts.map((p) => hitAt(W, p)).filter(Boolean))];
    const note = (H.rmin < T.options.rmin ? ' RAYON TROP COURT' : '') + (hits.length ? ' OBSTACLE ' + hits.join(', ') : '');
    if (note) bad++;
    console.log('  troncon', i, Math.round(H.len / 100) + ' m, rayon min', (H.rmin === Infinity ? '-' : Math.round(H.rmin / 100) + ' m') + note);
  }
  console.log(bad ? bad + ' troncon(s) en defaut' : 'aucun defaut');
}

// Carte du relief en tranches d'altitude (fil de fer), surplombs, mer, batiments au ras du sol, points nommes
async function carte() {
  const PRE = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
  const where = async (s) => {
    const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(s || '');
    if (m) return { x: +m[1], y: +m[2] };
    return (await call('pose', s.includes('/') ? s : PRE + s)).location;
  };
  const c = await where(opt('centre'));
  const R = 100 * Number(opt('rayon', 150)), S = 100 * Number(opt('pas', 8)), B = 100 * Number(opt('bande', 5));
  const NIV = opt('niveau') != null ? 100 * Number(opt('niveau')) : null;
  const box = { x0: c.x - R, x1: c.x + R, y0: c.y - R, y1: c.y + R };
  const rl = await relief(box, 400);
  const W = { box, width: 0, height: 0, relief: rl };
  W.near = index(await obstacles(box, new Set()));
  const marks = {};
  const key = (p) => Math.round((p.x - box.x0) / S) + ',' + Math.round((p.y - box.y0) / S);
  for (const s of String(opt('points', '')).split(';').filter(Boolean)) { const [l, xy] = s.split(':'); marks[key(await where(xy))] = l.slice(0, 1).toUpperCase(); }
  let n = 0;
  for (const a of String(opt('acteurs', '')).split(',').filter(Boolean)) marks[key(await where(a))] = String.fromCharCode(65 + (n++ % 26));
  const zs = [];
  for (let y = box.y0; y <= box.y1; y += S) for (let x = box.x0; x <= box.x1; x += S) { const z = hAt(rl, x, y); if (z > -Infinity) zs.push(z); }
  const zmin = Math.max(Math.min(...zs), BELT.SEA - 100);
  const SYM = '0123456789abcdefghijklmnopqrstuvwxyz';
  const lines = [];
  let head = ' '.repeat(9);
  for (let x = box.x0, i = 0; x <= box.x1; x += S, i++) head += i % 5 === 0 ? '|' : ' ';
  lines.push(head + '   | tous les ' + 5 * S / 100 + ' m ; x de ' + Math.round(box.x0) + ' a ' + Math.round(box.x1) + ' (est a droite), y vers le bas (sud)');
  for (let y = box.y0; y <= box.y1; y += S) {
    let l = String(Math.round(y)).padStart(8) + ' ';
    for (let x = box.x0; x <= box.x1; x += S) {
      const k = key({ x, y });
      if (marks[k]) { l += marks[k]; continue; }
      const z = hAt(rl, x, y);
      // --niveau <m> : batiments a cette altitude (de 1 m dessous a 3 m dessus), pour un site en l'air ou sur la mer
      if (NIV != null) { if (hitColumn(W, x, y, NIV - 100, NIV + 300, Infinity)) { l += 'o'; continue; } if (!(z > BELT.SEA)) { l += '~'; continue; } }
      if (!(z > BELT.SEA)) { l += '~'; continue; }
      if (overAt(rl, x, y).length) { l += '^'; continue; }
      if (NIV == null && hitColumn(W, x, y, z + 50, z + 300, Infinity)) { l += 'o'; continue; }
      l += SYM[Math.min(SYM.length - 1, Math.floor((z - zmin) / B))];
    }
    lines.push(l);
  }
  console.log(lines.join('\n'));
  console.log('tranche k = altitude de', (zmin / 100).toFixed(0), '+ k x', B / 100, 'm (0 =', (zmin / 100).toFixed(0), 'm,', SYM[Math.min(35, Math.floor((Math.max(...zs) - zmin) / B))], '=', (Math.max(...zs) / 100).toFixed(0), 'm) ; ^ surplomb, ~ mer, o batiment au sol');
  if (n) console.log('acteurs :', String(opt('acteurs')).split(',').map((a, i) => String.fromCharCode(65 + (i % 26)) + ' ' + a).join(', '));
}

if (require.main === module) {
  (async () => {
    if (argv[0] === 'rail') await planRail();
    else if (argv[0] === 'valider') await valider();
    else if (argv[0] === 'controler') await controler();
    else if (argv[0] === 'convoyeur') await planBelt();
    else if (argv[0] === 'carte') await carte();
    else throw new Error('usage : node tracer.js rail --de x,y,z@cap --a x,y,z@cap --nom <nom> [...] | valider <nom> | convoyeur --de <acteur>.<connecteur> --a <acteur>.<connecteur> --nom <nom> | carte --centre x,y [--rayon m]');
  })().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
}
module.exports = { relief, reliefMulti, obstacles, index, hitAt, hitColumn, hAt, overAt, hermite, step, profile };
