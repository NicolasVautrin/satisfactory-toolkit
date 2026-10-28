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
//   [--remplace <acteur>.<connecteur> [--sortie <connecteur>]] (ligne existante suivie depuis ce connecteur, ignoree)
//   [--par x,y;x,y] (points de passage, dans l'ordre) [--eviter x0,y0,x1,y1;...] (rectangles interdits)
//   ligne de convoyeur au sol (utilisateur, 23/10/2026 : « etends le traceur aux convoyeurs ») : sur poteaux qui suivent
//   le relief, convoyeur de 1 a 6 m au-dessus du sol (--poteau m de preference, 2 par defaut) ; A* sur une grille de 4 m
//   (8 directions, virages penalises), chaque noeud gardant les hauteurs encore possibles ; ascenseurs aux falaises de 8 m
//   et plus (relais en l'air du cote haut, jusqu'a 3 colonnes de 47 m) ; puis raccourcis en lignes droites de cap
//   quelconque (« grandes lignes droites sans escaliers, mais en suivant les vallees ») ; poteaux tous les 40 m au plus,
//   pente de 30 deg au plus entre deux poteaux, convoyeur degage du relief entre eux ; jamais sous l'eau. Sortie :
//   plans/traces/<nom>-ligne.json, fichier de ligne de beltline.js (node beltline.js <fichier> build).
// node tracer.js diag-convoyeur --de <acteur>.<connecteur> [--poteau m] [--marge m] [--releve m] [--sortie <connecteur>]
//   ligne deja posee, suivie depuis --de et rejouee dans le modele de la recherche : ou et pourquoi la grille la refuse
// node tracer.js coupe --de x,y|<acteur> --a x,y|<acteur> [--pas m] [--dz m] | coupe --ligne traces/<nom>-ligne.json
//   coupe verticale du relief, des surplombs et des batiments ; profil en long d'une ligne tracee (convoyeur, poteaux,
//   ascenseurs) ; --ligne avec --de et --a : segment coupe dans le releve de la ligne
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
const SPACING = 750; // double voie : 7,5 m d'axe en axe (standard de l'utilisateur, 28/10/2026)
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
  // relief8 : maille rejetee resondee depuis une voisine d'un autre niveau ; relief7 : voisines d'un surplomb atteintes a 2,
  // 6 ou 12 m (relief6 : a 2 m) ; relief6 : voisines d'un surplomb fermees
  // d'un cote sondees depuis les autres ; relief5 : surplombs au-dessus d'un sol
  // rocheux (relief4 : sous le seul relief nu, Landscape) ; relief4 : zone chargee par des sources de streaming (relief3 et
  // avant : rochers seulement pres du joueur ; relief3 : surplombs etendus sous les arches larges ; relief2 : leurs bords
  // seulement ; relief_ : aucun surplomb)
  const file = path.join(CACHE, `relief8_${x0}_${y0}_${nx}_${ny}_${step}.json`);
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
  const file = path.join(CACHE, `relief8m_${x0}_${y0}_${cx}_${cy}_${coarse}_${fine}.json`);
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
    let lo = null; // voisine la plus basse
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (!(di || dj) || a < 0 || b < 0 || a >= R.nx || b >= R.ny) continue;
      const w = R.z[b * R.nx + a];
      if (w !== null && (!lo || w < lo.z)) lo = { x: R.x0 + a * R.step, y: R.y0 + b * R.step, z: w };
    }
    if (lo && v - lo.z > 800) cand.push({ k: j * R.nx + i, x: R.x0 + i * R.step, y: R.y0 + j * R.step, top: v, lo });
  }
  const over = {};
  let found = await probeOverhangs(R, cand, over, false);
  // une maille rejetee au premier sondage reste a sonder de proche en proche (coeur de la cime de l'arbre geant de S13
  // E101 : sa voisine la plus basse etait encore dans la cime, pas au sol)
  // Une voisine fermee depuis un surplomb (rocher entre les deux, pente qui monte) reste a sonder depuis les autres : elle
  // n'est marquee testee qu'une fois trouvee (avant : des le premier balayage, ferme ou non ; ilot de mailles a 193 m sous
  // l'arche CliffPillar_320 de la ligne de calcaire 110, en travers de la ligne posee a la main, 27/10/2026)
  const tested = new Set(found);
  for (let pass = 0; found.length && pass < 400; pass++) {
    const next = [];
    for (const k of found) {
      const i = k % R.nx, j = Math.floor(k / R.nx), g = R.z[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj, kk = b * R.nx + a;
        if (a < 0 || b < 0 || a >= R.nx || b >= R.ny || tested.has(kk) || R.z[kk] === null) continue;
        if (R.z[kk] - g <= 800) continue; // voisine au niveau du sol : rien a chercher dessous
        next.push({ k: kk, x: R.x0 + a * R.step, y: R.y0 + b * R.step, top: R.z[kk], g, from: { x: R.x0 + i * R.step, y: R.y0 + j * R.step, z: g + 200 } });
      }
    }
    // de l'air entre le surplomb et sa voisine, a 2, 6 ou 12 m au-dessus de son sol (batiments ignores : convoyeurs,
    // poteaux) : a 2 m seulement, un bloc au sol fermait le passage du caterium de la cote (ligne posee a 80 m sur un sol a
    // 70 m, mailles restees au toit, a 278 m, 27/10/2026). Le sondage decide ensuite : un pilier plein ne donne pas de
    // dessous. Une voisine atteinte par plusieurs surplombs est sondee une fois, depuis le premier qui la voit a l'air libre
    const LIFTS = [200, 600, 1200];
    const reach = await sweepBatch(next.flatMap((c) => LIFTS.map((dz) => ({ from: { x: c.from.x, y: c.from.y, z: c.g + dz }, to: { x: c.x, y: c.y, z: c.g + dz }, half: OVER_H }))));
    const free = (n) => LIFTS.some((dz, m) => { const h = reach[n * LIFTS.length + m]; return !(h && h.hit && !builtHit(h)); });
    // une maille rejetee reste a sonder depuis une voisine d'un autre niveau : le sondage cherche le sol a 6 m pres de celui
    // de la voisine, et une premiere voisine plus basse de 7 m la rejetait pour de bon (passage du caterium, 27/10/2026)
    const seen = new Set();
    const open = next.filter((c, n) => {
      const id = c.k + ':' + Math.round(c.g / 600);
      if (!free(n) || tested.has(c.k) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    found = open.length ? [...new Set(await probeOverhangs(R, open, over, true))] : [];
    for (const k of found) tested.add(k);
  }
  return over;
}
// Sondage d'une liste de mailles candidates : rayon descendant jusqu'au relief, rayon montant jusqu'au dessous de la
// roche ; ecrit les surplombs trouves dans over (et le relief de la maille dans R.z), rend leurs indices. rocks : le
// rayon descendant traverse aussi les rochers (maille deja reconnue a l'air libre, sol attendu proche de c.g, a 6 m pres)
// Sol rocheux (plateau de cuivre de S13 E101, 25/10/2026 : cime d'un arbre geant TitanTree de 227 a 242 m au-dessus d'un
// sol de falaise CliffMesh a 162 m, colonne vide entre les deux, vue comme un massif plein ; le courant des foreuses
// faisait un detour par la cuvette) : un contact qui n'est pas le relief nu est pris pour le sol s'il est au niveau du sol
// voisin (6 m pres) et que de l'air l'y relie, balayage horizontal a 2 m au-dessus depuis la voisine (premier sondage) ou
// depuis le surplomb voisin (sondage de proche en proche, deja fait avant l'appel)
async function probeOverhangs(R, cand, over, rocks) {
  const H = OVER_H, batch = sweepBatch, built = builtHit;
  const land = (h) => /Landscape/.test((h.component || {}).cls || '');
  const nearG = (c) => (c.from ? c.g : c.lo.z); // sol de la voisine
  const rocky = (c, h) => h && h.hit && !built(h) && !land(h) && Math.abs(h.location.z - nearG(c)) <= 600;
  // les batiments sous la roche (rails et quais d'une gare passee sous l'arche) sont traverses, en repartant 20 cm
  // apres chaque contact (6 fois au plus ; 12, rochers compris, pour une maille reconnue a l'air libre ; un sol rocheux
  // au niveau de la voisine arrete le rayon)
  // relances groupees : un appel par etape pour tous les rayons a relancer (un appel par rayon attendait chaque fois un
  // tour de jeu : des milliers d'appels sous l'arche et dans les arbres de la cuvette de S13 E101, 24/10/2026)
  const through = async (hits, items, dir, pass, stop) => {
    for (let t = 0; t < (pass ? 12 : 6); t++) {
      const redo = [];
      hits.forEach((h, n) => { if (h && h.hit && (built(h) || (pass && !land(h) && !(stop && stop(n, h))))) redo.push(n); });
      if (!redo.length) break;
      const again = await batch(redo.map((n) => ({ from: Object.assign({}, items[n].from, { z: hits[n].location.z + 20 * dir }), to: items[n].to, half: H })));
      redo.forEach((n, m) => { hits[n] = again[m]; });
    }
    return hits;
  };
  const downItems = cand.map((c) => ({ from: { x: c.x, y: c.y, z: c.top - 50 }, to: { x: c.x, y: c.y, z: -10000 }, half: H }));
  const down = await through(await batch(downItems), downItems, -1, rocks, (n, h) => rocky(cand[n], h));
  const under0 = cand.filter((c, n) => {
    const h = down[n];
    if (!h || !h.hit || c.top - h.location.z <= 800) return false;
    if (!land(h) && !rocky(c, h)) return false;
    if (rocks && Math.abs(h.location.z - c.g) > 600) return false;
    c.ground = h.location.z;
    c.rocky = !land(h);
    return true;
  });
  // sol rocheux du premier sondage : de l'air depuis la voisine, sinon c'est l'interieur d'un rocher
  const soft = under0.filter((c) => c.rocky && !c.from);
  const air = soft.length ? await batch(soft.map((c) => {
    const z = Math.max(c.lo.z, c.ground) + 200;
    return { from: { x: c.lo.x, y: c.lo.y, z }, to: { x: c.x, y: c.y, z }, half: H };
  })) : [];
  const shut = new Set(soft.filter((c, n) => air[n] && air[n].hit && !built(air[n])));
  const under = under0.filter((c) => !shut.has(c));
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

// Altitude du relief en (x, y) : plus basse des 4 mailles voisines (pied d'un poteau au bord d'une marche)
function hMin(R, x, y) {
  const fi = (x - R.x0) / R.step, fj = (y - R.y0) / R.step;
  let best = Infinity;
  for (const i of [Math.floor(fi), Math.ceil(fi)]) for (const j of [Math.floor(fj), Math.ceil(fj)]) {
    if (i < 0 || j < 0 || i >= R.nx || j >= R.ny) continue;
    const v = R.z[j * R.nx + i];
    if (v !== null && v < best) best = v;
  }
  return best === Infinity ? -Infinity : best;
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
  // Hauteurs du convoyeur au-dessus du sol essayees par la grille et les lignes droites (uu), de 1 a 6 m : le jeu donne un
  // poteau 1 m plus court que demande et 7 m au plus. Avant le 27/10/2026, poteaux de --poteau m partout : la grille
  // refusait un creux de 4 m ou un talus de 6 m que la ligne posee a la main enjambait sur des poteaux plus hauts (lignes de
  // calcaire 110 et 54 de l'usine de beton, diag-convoyeur)
  HS: [100, 200, 300, 400, 500, 600],
  POLE_COST: 500, // cout par maille et par metre de la plus basse hauteur possible au-dessus de --poteau (6 m : 2 000)
};
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// Gabarit du convoyeur en (x, y) entre les altitudes zlo et zhi (cap de la ligne en radians) : obstacle touche, ou null.
// Tranches de 6 m au plus : hitColumn ne teste un convoyeur ou un tuyau qu'en bas, au milieu et en haut de sa colonne
// Zones a eviter (--eviter, W.avoid : rectangles) : obstacle a toute hauteur
function beltHitSpan(W, x, y, zlo, zhi, a) {
  const nx = -Math.sin(a), ny = Math.cos(a), tall = zhi - zlo + 160, n = Math.max(1, Math.ceil(tall / 600));
  for (const o of [-BELT.HALF, 0, BELT.HALF]) {
    const px = x + o * nx, py = y + o * ny;
    if (W.avoid && W.avoid.some((r) => px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1)) return 'zone evitee';
    for (let k = 0; k < n; k++) {
      const h = hitColumn(W, x + o * nx, y + o * ny, zlo - 60 + (k * tall) / n, zlo - 60 + ((k + 1) * tall) / n, Infinity);
      if (h) return h;
    }
  }
  return null;
}
// Gabarit du convoyeur a l'altitude z
const beltHitAt = (W, x, y, z, a) => beltHitSpan(W, x, y, z, z, a);

// Le jeu pose les bouts d'un convoyeur a l'horizontale sur chaque poteau : entre deux poteaux, la courbe passe sous la corde
// du cote bas (mesure le 27/10/2026 sur 10 troncons poses de la ligne 110 : jusqu'a 4,4 % du denivele de la portee, 0,35 m
// pour 8 m sur 32 m). Degagement sous la corde : BELT.CLEAR plus BELT.SAG fois le denivele de la portee
BELT.SAG = 0.05;
// Ecart en plan le plus grand entre une ligne droite et les points de la recherche qu'elle saute : une maille (les marches
// d'escalier de la grille a 8 directions restent en dessous) ; au-dela, poteau au coude
BELT.BEND = 400;

// Ligne droite en plan de a a b sur poteaux qui suivent le relief, convoyeur de BELT.HS[0] a BELT.HS[dernier] au-dessus du
// sol, au plus pres de T. Poteaux sur les cretes du relief (utilisateur, 27/10/2026 : « quand le terrain ondule, il faut
// placer des poteaux sur les maximums locaux, sinon le belt risque de traverser le terrain ») : tant qu'une portee depasse
// SPAN, un poteau au plus haut du relief de son tiers central ; tant que le relief passe trop pres sous une portee, un poteau
// au plus haut du relief de cette portee. A defaut (portees trop courtes, poteau sur un obstacle), poteaux regulierement
// espaces, de plus en plus serres. Pente, degagement sous le convoyeur, obstacles, mer. Bouts : altitude a.z / b.z si elle
// est donnee (sinon sol + T) ; un bout anchor est un connecteur (relais, pied d'ascenseur), sans poteau. { poles } ou { why }
function beltRun(W, a, b, T) {
  const L = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
  const lo = BELT.HS[0], hi = BELT.HS[BELT.HS.length - 1];
  if (L < 50) return { why: 'trop court' };
  const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  // relief tous les 2 m le long de la ligne
  const M = Math.max(2, Math.ceil(L / 200)), prof = [];
  for (let s = 0; s <= M; s++) { const p = at(s / M); prof.push(hAt(W.relief, p.x, p.y)); }
  const clear = (p, q) => BELT.CLEAR + BELT.SAG * Math.abs(q.z - p.z);
  // poteaux aux fractions ts de a a b (bouts compris)
  const build = (ts) => {
    const poles = ts.map((t, k) => {
      const { x, y } = at(t), g = hAt(W.relief, x, y);
      const end = k === 0 ? a : k === ts.length - 1 ? b : null, fixed = end ? (end.z != null ? end.z : g + T) : null;
      // poteau entre deux mailles : 1 m au-dessus de la plus haute, 6 m au plus au-dessus de la plus basse (au bord d'une
      // marche, beltline trouvait le sol 8,5 m sous la plus haute : poteau de 10 m, ligne 110, 27/10/2026)
      return { t, x, y, g, lo: fixed != null ? fixed : g + lo, hi: fixed != null ? fixed : hMin(W.relief, x, y) + hi, tz: fixed != null ? fixed : g + T, anchor: !!(end && end.anchor), fixed: fixed != null };
    });
    const sl = (k) => BELT.SLOPE * (poles[k + 1].t - poles[k].t) * L; // denivele permis sur la portee k -> k + 1
    // altitudes : intervalles permis resserres par la pente dans les deux sens, puis la plus proche de sol + T, de proche
    // en proche (chaque valeur d'un intervalle a une suivante compatible apres le passage retour)
    const settle = () => {
      for (let k = 1; k < poles.length; k++) { poles[k].lo = Math.max(poles[k].lo, poles[k - 1].lo - sl(k - 1)); poles[k].hi = Math.min(poles[k].hi, poles[k - 1].hi + sl(k - 1)); }
      for (let k = poles.length - 2; k >= 0; k--) { poles[k].lo = Math.max(poles[k].lo, poles[k + 1].lo - sl(k)); poles[k].hi = Math.min(poles[k].hi, poles[k + 1].hi + sl(k)); }
      if (poles.some((p) => p.lo > p.hi + 1)) return false;
      poles.forEach((p, k) => {
        const l2 = k ? Math.max(p.lo, poles[k - 1].z - sl(k - 1)) : p.lo, h2 = k ? Math.min(p.hi, poles[k - 1].z + sl(k - 1)) : p.hi;
        p.z = Math.max(l2, Math.min(h2, p.tz));
      });
      return true;
    };
    return { poles, settle };
  };
  // plus fort manque de degagement sous la portee p -> q (points du profil entre les deux) : { d, s (rang dans le profil) }
  const deficit = (p, q) => {
    let w = { d: 0, s: -1 };
    for (let s = Math.floor(p.t * M + 1e-9) + 1; s < q.t * M - 1e-9; s++) {
      const t = (s / M - p.t) / (q.t - p.t), d = prof[s] + clear(p, q) - (p.z + (q.z - p.z) * t);
      if (d > w.d) w = { d, s };
    }
    return w;
  };
  // poteaux aux fractions ts : altitudes, poteaux remontes (convoyeur jusqu'a 6 m du sol) la ou le relief passe encore trop
  // pres (utilisateur, 27/10/2026 : « regle la densite des poteaux » ; le plus fort manque d'une portee remonte ses deux
  // poteaux, ou l'autre seul d'autant plus que le point est pres du bout fixe ; 8 passes au plus), puis controles
  const lift = (ts) => {
    const { poles, settle } = build(ts);
    if (!settle()) return { why: 'pente' };
    let low = true;
    for (let it = 0; it < 8 && low; it++) {
      low = false;
      for (let k = 0; k + 1 < poles.length; k++) {
        const p = poles[k], q = poles[k + 1], w = deficit(p, q);
        if (w.d <= 0) continue;
        low = true;
        if (p.fixed && q.fixed) break;
        const tw = (w.s / M - p.t) / (q.t - p.t);
        if (p.fixed) q.lo = Math.max(q.lo, q.z + w.d / Math.max(tw, 0.1) + 1);
        else if (q.fixed) p.lo = Math.max(p.lo, p.z + w.d / Math.max(1 - tw, 0.1) + 1);
        else { p.lo = Math.max(p.lo, p.z + w.d + 1); q.lo = Math.max(q.lo, q.z + w.d + 1); }
      }
      if (low && !settle()) break;
    }
    return low ? { why: 'relief' } : { poles };
  };
  const checks = (poles) => {
    for (let k = 0; k + 1 < poles.length; k++) {
      const p = poles[k], q = poles[k + 1], span = (q.t - p.t) * L;
      if ((!p.anchor && p.g === -Infinity) || (!q.anchor && q.g === -Infinity) || Math.min(p.z, q.z) < BELT.SEA + 100) return { why: 'mer' };
      if (Math.abs(q.z - p.z) / span > BELT.SLOPE + 1e-3) return { why: 'pente' };
      const m = Math.max(2, Math.ceil(span / 200));
      for (let s = 0; s <= m; s++) {
        const t = s / m, x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t, z = p.z + (q.z - p.z) * t;
        if (s > 0 && s < m && hAt(W.relief, x, y) > z - clear(p, q)) return { why: 'relief' };
        const h = beltHitAt(W, x, y, z, ang);
        if (h) return { why: h };
      }
      // poteau : colonne du sol au convoyeur (sauf aux deux bouts de la ligne, accroches a des batiments)
      if (k + 2 < poles.length) { const h = hitColumn(W, q.x, q.y, q.g, q.z, Infinity); if (h) return { why: 'poteau sur ' + h }; }
    }
    return { poles: poles.map(({ x, y, g, z, anchor }) => ({ x, y, g, z, anchor })) };
  };
  const placed = (ts) => { const r = lift(ts); return r.poles ? checks(r.poles) : r; };
  // poteaux imposes sur les cretes (utilisateur, 27/10/2026 : « le jeu ne detecte pas quand un belt traverse le decor, il
  // faut que tu imposes certains poteaux, les maximums locaux ») : une portee plus longue que SPAN est coupee a sa crete ;
  // une portee dont le relief passe trop pres sous le convoyeur recoit un poteau a sa crete (la portee au plus fort manque
  // d'abord) ; poteaux remontes seulement quand une portee trop courte ne peut plus etre coupee. Crete d'une portee : point
  // du relief le plus haut au-dessus de la corde entre ses deux poteaux (sur une pente, le plus haut point tout court est le
  // bout haut : 38 poteaux au lieu de 34 sur la ligne 110 avec lui). { poles }, { why } ou null (portees trop courtes)
  const crest = () => {
    const ts = [0, 1], minS = Math.max(1, Math.ceil(Math.min(BELT.MIN_SPAN, L) / (L / M)));
    const top = (p, q, u0, u1) => {
      let best = -1, bv = -Infinity;
      for (let s = u0; s <= u1; s++) { const v = prof[s] - (p.z + ((q.z - p.z) * (s / M - p.t)) / (q.t - p.t)); if (v > bv) { bv = v; best = s; } }
      return best;
    };
    for (let it = 0; it < 60; it++) {
      const { poles, settle } = build(ts);
      if (!settle()) return { why: 'pente' };
      let add = null, worst = 0;
      for (let k = 0; k + 1 < poles.length && add === null; k++) {
        const p = poles[k], q = poles[k + 1], s0 = Math.round(p.t * M), s1 = Math.round(q.t * M);
        if ((q.t - p.t) * L > BELT.SPAN) { const c = Math.max(minS, Math.ceil((s1 - s0) / 3)); add = top(p, q, s0 + c, s1 - c); }
      }
      if (add === null) {
        for (let k = 0; k + 1 < poles.length; k++) {
          const p = poles[k], q = poles[k + 1], w = deficit(p, q);
          if (w.d > worst) { worst = w.d; add = top(p, q, Math.round(p.t * M) + minS, Math.round(q.t * M) - minS); }
        }
      }
      if (add === null || (add < 0 && worst > 0)) {
        // plus de crete a couper (ou portee trop courte pour l'etre) : poteaux remontes, puis controles
        const r = lift(ts);
        return r.poles ? checks(r.poles) : r;
      }
      if (add < 0) return null;
      ts.push(add / M);
      ts.sort((u, v) => u - v);
    }
    return null;
  };
  const c = crest();
  if (c && c.poles) return c;
  // poteaux regulierement espaces, de plus en plus serres : un poteau qui tombe sur un obstacle (convoyeur franchi
  // par-dessus) se decale au nombre de portees suivant
  let why = 'vide';
  for (let n = Math.max(1, Math.ceil(L / BELT.SPAN)); L / n >= Math.min(BELT.MIN_SPAN, L); n++) {
    const r = placed(Array.from({ length: n + 1 }, (_, k) => k / n));
    if (r.poles) return r;
    why = r.why;
    if (why !== 'relief' && why !== 'pente' && !/^poteau sur/.test(why)) break; // obstacle ou mer : des portees plus courtes n'y changent rien
  }
  return { why };
}

// Franchissement d'un convoyeur existant : par-dessus, sur poteaux plus hauts (BELT.OVER de plus)
const isBelt = (why) => /ConveyorBelt|ConveyorLift|poteau sur Build_ConveyorBelt/.test(String(why));
BELT.OVER = 400; // 4 m au-dessus de la ligne normale (convoyeur franchi a 2 m : 3,4 m d'ecart)
BELT.POLE_BIAS = 100; // le jeu donne un poteau 1 m plus court que demande

// Ascenseurs aux falaises (utilisateur, 27/10/2026 : « fais les deux » ; « grandes hauteurs : lignes a plat + ascenseurs ») :
// relais en l'air (fusionneur) du cote haut, puis colonnes de 47 m au plus (scripts de chantier), chacune 4 m plus loin que
// la precedente. Mesure en jeu le 27/10/2026 (descente de la 634 de S13 E101, ligne 54 de l'usine de beton) : connecteurs
// d'un ascenseur sur l'axe de sa colonne, colonne a 3 m du connecteur du relais (4 m de son centre), 4 m entre deux colonnes
BELT.LIFT = {
  MIN: 400, // hauteur la plus faible d'un ascenseur (jeu : 4 m)
  MAX: 4700, // hauteur la plus forte d'un ascenseur (jeu : 48 m ; 47 dans les scripts de chantier)
  GAP: 400, // centre du relais -> premiere colonne ; colonne -> colonne suivante
  MAXN: 3, // ascenseurs bout a bout au plus
  REACH: 4000, // convoyeur a plat du dernier poteau du haut a la colonne : 40 m au plus (aucun poteau en l'air)
  CLIFF: 800, // denivele le plus faible franchi par un ascenseur (en dessous, poteaux et pentes suffisent)
  COST: 3000, // cout d'un ascenseur (uu)
};

// Hauteurs libres d'une maille (masque de bits sur BELT.HS) : convoyeur au-dessus de la mer, gabarit libre selon chacun
// des caps angs ; obstacle touche a la hauteur la plus proche de H compte dans stats.hits
function beltMask(W, x, y, angs, H, stats) {
  const g = hAt(W.relief, x, y), HS = BELT.HS;
  let m = 0;
  HS.forEach((h, b) => { if (g + h > BELT.SEA + 100) m |= 1 << b; });
  // une colonne du plus bas au plus haut gabarit : libre (cas courant), toutes les hauteurs le sont
  if (!m || !angs.some((an) => beltHitSpan(W, x, y, g + HS[0], g + HS[HS.length - 1], an))) return m;
  const bH = HS.reduce((u, h, b) => (Math.abs(h - H) < Math.abs(HS[u] - H) ? b : u), 0);
  HS.forEach((h, b) => {
    if (!(m & (1 << b))) return;
    const hit = angs.map((an) => beltHitAt(W, x, y, g + h, an)).find(Boolean);
    if (!hit) return;
    m &= ~(1 << b);
    if (b === bH && stats) stats.hits[hit] = (stats.hits[hit] || 0) + 1;
  });
  return m;
}

// Regles d'un pas de la grille de a a b ({ x, y, g }), celles de beltRun : fonction (za, zb) -> vrai si le convoyeur passe
// de l'altitude za a zb (pente, relief 30 cm dessous au tiers d'un pas en diagonale, gabarit au milieu du pas, oriente le
// long du pas : un convoyeur fin passait entre deux centres de mailles, ligne fe3 a travers fe1, 23/10/2026)
function beltPair(W, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x), lim = BELT.SLOPE * len;
  const ns = Math.max(2, Math.ceil(len / 200)), r = [];
  for (let q = 1; q < ns; q++) r.push([q / ns, hAt(W.relief, a.x + ((b.x - a.x) * q) / ns, a.y + ((b.y - a.y) * q) / ns)]);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, HS = BELT.HS;
  let midFree;
  return (za, zb) => {
    if (Math.abs(zb - za) > lim) return false;
    for (const [t, h] of r) if (h > za + (zb - za) * t - BELT.CLEAR - BELT.SAG * Math.abs(zb - za)) return false;
    if (midFree === undefined) midFree = !beltHitSpan(W, mx, my, Math.min(a.g, b.g) + HS[0], Math.max(a.g, b.g) + HS[HS.length - 1], ang);
    return midFree || !beltHitAt(W, mx, my, (za + zb) / 2, ang);
  };
}

// Hauteurs de b (parmi le masque mb) atteignables depuis une hauteur de a (masque ma)
function beltStep(W, a, ma, b, mb) {
  const ok = beltPair(W, a, b), HS = BELT.HS;
  let out = 0;
  for (let jb = 0; jb < HS.length; jb++) {
    if (!(mb & (1 << jb))) continue;
    for (let ja = 0; ja < HS.length; ja++) if ((ma & (1 << ja)) && ok(a.g + HS[ja], b.g + HS[jb])) { out |= 1 << jb; break; }
  }
  return out;
}

// Convoyeur a plat a l'altitude z de p a q (du dernier poteau du haut a une colonne d'ascenseur, relais compris) : relief
// 30 cm dessous, gabarit libre. 'relief', obstacle touche, ou null
function flatRun(W, p, q, z) {
  const L = Math.hypot(q.x - p.x, q.y - p.y), ang = Math.atan2(q.y - p.y, q.x - p.x), m = Math.max(1, Math.ceil(L / 200));
  for (let k = 0; k <= m; k++) {
    const x = p.x + ((q.x - p.x) * k) / m, y = p.y + ((q.y - p.y) * k) / m;
    if (hAt(W.relief, x, y) > z - BELT.CLEAR) return 'relief';
    const h = beltHitAt(W, x, y, z, ang);
    if (h) return h;
  }
  return null;
}

// Colonnes d'ascenseurs de zTop au pied, en s'eloignant du relais dans le sens w (unitaire) : premiere colonne en anchor
// (descente), ou derniere colonne, celle du pied, en anchor (montee : fixedFoot). Pied 1 m au-dessus du plus haut sol sous
// la colonne du pied (a 1,5 m pres) et 5 m au-dela (point d'approche), comme dans les scripts de chantier ; colonnes libres
// de relief, de surplombs et de batiments. { cols: [{ x, y, zb, zt }] du haut vers le pied, foot, relay } ou null
function liftCols(W, anchor, w, zTop, fixedFoot) {
  const LI = BELT.LIFT, ang = Math.atan2(w.y, w.x);
  const around = (c) => Math.max(...[[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150]].map(([dx, dy]) => hAt(W.relief, c.x + dx, c.y + dy)));
  for (let n = 1; n <= LI.MAXN; n++) {
    const c0 = fixedFoot ? { x: anchor.x - (n - 1) * LI.GAP * w.x, y: anchor.y - (n - 1) * LI.GAP * w.y } : anchor;
    const col = (k) => ({ x: c0.x + k * LI.GAP * w.x, y: c0.y + k * LI.GAP * w.y });
    const F = col(n - 1), ground = Math.max(around(F), hAt(W.relief, F.x + 500 * w.x, F.y + 500 * w.y));
    if (!(ground > BELT.SEA)) return null;
    const foot = ground + 100, height = zTop - foot;
    if (height < LI.MIN) return null;
    if (height > n * LI.MAX) continue;
    const cols = [];
    for (let k = 0; k < n; k++) {
      const c = col(k), zt = zTop - (k * height) / n, zb = zTop - ((k + 1) * height) / n;
      if (k < n - 1 && around(c) > zb - 50) return null;
      if (beltHitSpan(W, c.x, c.y, zb, zt, ang)) return null;
      cols.push({ x: Math.round(c.x), y: Math.round(c.y), zb: Math.round(zb), zt: Math.round(zt) });
    }
    return { cols, foot: Math.round(foot), relay: { x: Math.round(c0.x - LI.GAP * w.x), y: Math.round(c0.y - LI.GAP * w.y) } };
  }
  return null;
}

// A* en grille (8 directions, virages penalises, demi-tours interdits) de l'un des departs srcs ([{ s, dir, start }]) a g
// ({x, y}), tous a cout nul : une seule recherche, le depart decoule du chemin (foreuse orientee apres coup). Chaque
// noeud porte les hauteurs de convoyeur encore possibles (masque sur BELT.HS : la grille enjambe un creux sur des poteaux
// plus hauts) ; ascenseurs aux falaises : descente (convoyeur a plat jusqu'au relais, colonnes jusqu'au pied, la ligne
// repart du pied tout droit) ou montee (la ligne arrive au pied, colonnes jusqu'au relais, convoyeur a plat jusqu'au haut).
// Puis hauteurs choisies de l'arrivee vers le depart (au plus pres de H) et raccourcis en lignes droites : de chaque point,
// le plus loin atteignable par beltRun. start : { z, d } (connecteur de depart, a d de s, sens dir) ; sortie au-dessus du vide (foreuse
// au sommet d'une aiguille) : depart en l'air, seule une descente en part. via : points de passage ({x, y}, --par) a
// atteindre dans l'ordre (le noeud porte le nombre de points deja atteints ; les lignes droites ne les sautent pas).
// { poles (poteaux { x, y, g, z, h } et ascenseurs { lift }), cost (uu de la recherche), src (rang du depart) }, { fail } ou null
function beltSearch(W, srcs, g, H, stats, via = []) {
  const C = BELT.CELL, x0 = W.box.x0, y0 = W.box.y0, HS = BELT.HS, LI = BELT.LIFT;
  const nx = Math.floor((W.box.x1 - x0) / C) + 1, ny = Math.floor((W.box.y1 - y0) / C) + 1;
  const cell = (p) => [Math.round((p.x - x0) / C), Math.round((p.y - y0) / C)];
  const pt = (i, j) => ({ x: x0 + i * C, y: y0 + j * C });
  const inside = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny;
  const gc = new Map(), fc = new Map(), memo = new Map();
  const G = (i, j) => { const k = i * ny + j; if (!gc.has(k)) { const p = pt(i, j); gc.set(k, hAt(W.relief, p.x, p.y)); } return gc.get(k); };
  const at = (i, j) => Object.assign(pt(i, j), { g: G(i, j) });
  const isFree = (i, j) => { const k = i * ny + j; if (!fc.has(k)) { const p = pt(i, j); fc.set(k, beltMask(W, p.x, p.y, [0, Math.PI / 2], H, stats)); } return fc.get(k); };
  const cached = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
  const bits = (m) => HS.map((h, b) => b).filter((b) => m & (1 << b));
  const nearest = (m, dz) => bits(m).reduce((u, b) => (u < 0 || Math.abs(HS[b] - dz) < Math.abs(HS[u] - dz) ? b : u), -1);
  const pen = (m) => (Math.max(0, HS[bits(m)[0]] - H) / 100) * BELT.POLE_COST;
  const [gi, gj] = cell(g);
  // departs : premier poteau a 0,25 de pente pres du connecteur (fit l'ajuste ensuite)
  const roots = srcs.map(({ s, dir, start }, src) => {
    const [si, sj] = cell(s), d0 = Math.round(((Math.atan2(dir.y, dir.x) / (Math.PI / 4)) % 8 + 8) % 8) % 8;
    const g0 = G(si, sj), tol = 0.25 * start.d + 50;
    let m0 = 0;
    HS.forEach((h, b) => { if (Math.abs(g0 + h - start.z) <= tol) m0 |= 1 << b; });
    const air = !m0 && start.z - g0 - HS[HS.length - 1] > tol ? start.z : null;
    if (!m0 && air === null) m0 = 1 << nearest((1 << HS.length) - 1, start.z - g0);
    return { i: si, j: sj, d: d0, m: m0, air, straight: false, c: 0, parent: null, src };
  });
  // points de passage : etape du noeud = points deja atteints ; estimation = distance au prochain, puis de point en point
  const wp = via.map(cell), NW = wp.length, legs = [...wp, [gi, gj]];
  const rest = legs.map((c, k) => { let r = 0; for (let m = k + 1; m < legs.length; m++) r += C * Math.hypot(legs[m][0] - legs[m - 1][0], legs[m][1] - legs[m - 1][1]); return r; });
  const advance = (i, j, st) => { while (st < NW && wp[st][0] === i && wp[st][1] === j) st++; return st; };
  const key = (n) => ((((n.i * ny + n.j) * 8 + n.d) * 2) + (n.straight ? 1 : 0)) * (NW + 1) + n.stage;
  const h = (n) => C * Math.hypot(legs[n.stage][0] - n.i, legs[n.stage][1] - n.j) + rest[n.stage];
  const open = new Heap(), labels = new Map();
  let seq = 0;
  // un noeud est ecarte si un autre, a la meme maille, dans le meme sens et a la meme etape, coute moins et permet au
  // moins ses hauteurs
  const push = (n) => {
    n.stage = advance(n.i, n.j, n.parent ? n.parent.stage : 0);
    n.wp = n.stage > (n.parent ? n.parent.stage : 0);
    const k = key(n), L = labels.get(k) || [];
    if (L.some((o) => o.c <= n.c && (o.m | n.m) === o.m)) return;
    for (const o of L) if (o.c >= n.c && (o.m | n.m) === n.m) o.dead = true;
    labels.set(k, L.filter((o) => !o.dead).concat([n]));
    n.f = n.c + h(n); n.seq = seq++;
    open.push(n);
  };
  wp.forEach(([i, j], k) => { if (!inside(i, j) || !isFree(i, j)) console.log('ATTENTION : point de passage', k + 1, 'hors de la zone ou ferme a toutes les hauteurs'); });
  // ascenseurs depuis le noeud n (en a) : colonne a k mailles dans le sens d, pas depuis un pied ou un haut d'ascenseur
  const liftEdges = (n, a) => {
    if (n.lift) return;
    const top = n.air !== null ? [null] : bits(n.m);
    const zMax = n.air !== null ? n.air : a.g + HS[top[top.length - 1]];
    for (const dd of n.straight ? [0] : [-1, 0, 1]) {
      const d = (n.d + dd + 8) % 8, [di, dj] = DIRS[d], l1 = C * Math.hypot(di, dj), u = { x: (di * C) / l1, y: (dj * C) / l1 };
      for (let k = n.air !== null ? 1 : 2; k * l1 <= LI.REACH; k++) {
        const i = n.i + k * di, j = n.j + k * dj;
        if (!inside(i, j)) break;
        const Y = at(i, j), dist = k * l1, cliff = Math.max(LI.CLIFF, BELT.SLOPE * dist);
        if (!(Y.g > -Infinity)) continue;
        // descente : convoyeur a plat de a a la colonne (relais 4 m avant elle), puis colonnes jusqu'au pied
        if (zMax - Y.g - 100 >= cliff) {
          for (const b of top) {
            const zTop = b === null ? n.air : a.g + HS[b];
            if (zTop - Y.g - 100 < cliff) continue;
            if (cached('f' + a.x + ',' + a.y + ',' + i + ',' + j + ',' + zTop, () => flatRun(W, a, Y, zTop))) continue;
            const lc = cached('d' + i + ',' + j + ',' + d + ',' + zTop, () => liftCols(W, Y, u, zTop, false));
            if (!lc) continue;
            const F = lc.cols[lc.cols.length - 1], [fi, fj] = cell(F);
            if (!inside(fi, fj) || Math.hypot(fi - gi, fj - gj) < 3) break;
            const mf = isFree(fi, fj), hb = nearest(mf, lc.foot - G(fi, fj));
            if (hb < 0 || Math.abs(G(fi, fj) + HS[hb] - lc.foot) > 150) break;
            push({ i: fi, j: fj, d, m: 1 << hb, straight: true, air: null, parent: n,
              c: n.c + dist + LI.GAP * (lc.cols.length - 1) + LI.COST * lc.cols.length + BELT.TURN * Math.abs(dd),
              lift: { kind: 'descente', hFrom: b, top: zTop, foot: lc.foot, cols: lc.cols, u, relay: lc.relay } });
            break;
          }
        }
        // montee : la ligne arrive au pied, en a ; colonnes vers Y, relais, convoyeur a plat jusqu'a Y
        if (n.air === null && n.parent && Y.g - a.g >= cliff) {
          for (const b of bits(isFree(i, j))) {
            const zTop = Y.g + HS[b];
            const lc = cached('m' + a.x + ',' + a.y + ',' + d + ',' + zTop, () => liftCols(W, a, { x: -u.x, y: -u.y }, zTop, true));
            if (!lc) continue;
            const c0 = lc.cols[0];
            if (Math.hypot(Y.x - c0.x, Y.y - c0.y) < LI.GAP + 300) continue; // relais, puis 2 m de convoyeur au moins
            if (cached('f' + c0.x + ',' + c0.y + ',' + i + ',' + j + ',' + zTop, () => flatRun(W, c0, Y, zTop))) continue;
            const hf = nearest(n.m, lc.foot - a.g);
            if (hf < 0 || Math.abs(a.g + HS[hf] - lc.foot) > 150) break;
            push({ i, j, d, m: 1 << b, straight: false, air: null, parent: n,
              c: n.c + dist + LI.COST * lc.cols.length + BELT.TURN * Math.abs(dd) + pen(1 << b),
              lift: { kind: 'montee', hFrom: hf, top: zTop, foot: lc.foot, cols: lc.cols, u, relay: lc.relay } });
            break;
          }
        }
      }
    }
  };
  for (const r of roots) push(r);
  let found = null, expanded = 0;
  while (open.size) {
    const n = open.pop();
    if (n.dead) continue;
    if (n.i === gi && n.j === gj && n.air === null && n.stage === NW) { found = n; break; }
    if (++expanded > 400000) { stats.abandon = true; break; }
    const a = at(n.i, n.j);
    if (n.air === null) {
      for (const dd of n.straight ? [0] : [-2, -1, 0, 1, 2]) {
        const d = (n.d + dd + 8) % 8, [di, dj] = DIRS[d], i = n.i + di, j = n.j + dj;
        if (!inside(i, j)) continue;
        const mb = isFree(i, j);
        if (!mb) continue;
        const m = beltStep(W, a, n.m, at(i, j), mb);
        if (!m) continue;
        push({ i, j, d, m, air: null, straight: false, parent: n, c: n.c + C * Math.hypot(di, dj) + BELT.TURN * Math.abs(dd) + pen(m) });
      }
    }
    liftEdges(n, a);
  }
  stats.expanded += expanded;
  if (!found) return null;
  const nodes = [];
  for (let n = found; n; n = n.parent) nodes.unshift(n);
  const s = srcs[nodes[0].src].s;
  // hauteurs, de l'arrivee vers le depart : au plus pres de H parmi celles qui passent vers le noeud suivant (toute hauteur
  // d'un masque en a une : le masque est fait des hauteurs atteintes) ; avant un ascenseur, celle de son haut ou de son pied
  for (let q = nodes.length - 1; q >= 0; q--) {
    const n = nodes[q], nn = nodes[q + 1];
    Object.assign(n, at(n.i, n.j));
    if (n.air !== null) { n.z = n.air; continue; }
    let b = -1;
    if (nn && nn.lift) b = nn.lift.hFrom;
    else {
      const ok = nn ? beltPair(W, n, nn) : null;
      b = bits(n.m).sort((u, v) => Math.abs(HS[u] - H) - Math.abs(HS[v] - H)).find((c) => !ok || ok(n.g + HS[c], nn.z));
    }
    if (b == null || b < 0) throw new Error('hauteurs incoherentes en ' + n.x + ',' + n.y);
    n.z = n.g + HS[b];
  }
  // troncons entre ascenseurs : poteaux de la grille, bouts accroches aux connecteurs (anchor ; exit : la ligne en part)
  const pieces = [[]], lifts = [];
  nodes.forEach((n, q) => {
    const p = { x: q === 0 ? s.x : q === nodes.length - 1 ? g.x : n.x, y: q === 0 ? s.y : q === nodes.length - 1 ? g.y : n.y, z: n.z, keep: n.wp };
    const L = n.lift;
    if (!L) { if (n.air === null) pieces[pieces.length - 1].push(p); return; }
    const u = L.u, F = L.cols[L.cols.length - 1], cur = pieces[pieces.length - 1];
    if (L.kind === 'descente') {
      cur.push({ x: L.relay.x - 100 * u.x, y: L.relay.y - 100 * u.y, z: L.top, anchor: true, u });
      pieces.push([{ x: F.x, y: F.y, z: L.foot, anchor: true, exit: true, u }]);
    } else {
      cur.pop(); // maille du pied : la ligne y arrive par le connecteur du pied
      cur.push({ x: F.x, y: F.y, z: L.foot, anchor: true, u });
      pieces.push([{ x: L.relay.x + 100 * u.x, y: L.relay.y + 100 * u.y, z: L.top, anchor: true, exit: true, u }, p]);
    }
    lifts.push(L);
  });
  // raccourcis : de Q[i], le point Q[j] le plus loin joignable en ligne droite, a la hauteur normale, sinon par-dessus un
  // convoyeur ; a 45 deg au plus du sens d'un connecteur d'ascenseur ou de relais
  const out = [];
  for (let pi = 0; pi < pieces.length; pi++) {
    if (pi) out.push({ lift: lifts[pi - 1] });
    const Q = pieces[pi];
    if (Q.length && !Q[0].anchor) out.push({ x: Q[0].x, y: Q[0].y, g: hAt(W.relief, Q[0].x, Q[0].y), z: Q[0].z });
    let i = 0;
    while (i < Q.length - 1) {
      const stop = Q.findIndex((q, k) => k > i && q.keep); // point de passage : jamais saute
      let j = stop > 0 ? stop : Q.length - 1, run = null;
      for (; j > i; j--) {
        const dx = Q[j].x - Q[i].x, dy = Q[j].y - Q[i].y, dl = Math.hypot(dx, dy) || 1;
        const along = (u) => (dx * u.x + dy * u.y) / dl >= 0.7;
        if ((Q[i].exit && !along(Q[i].u)) || (Q[j].anchor && !Q[j].exit && !along(Q[j].u))) continue;
        // coudes du chemin : la ligne droite ne s'ecarte pas de plus de BELT.BEND des points de la recherche qu'elle saute
        // (poteau impose au coude, le maximum local en plan ; utilisateur, 27/10/2026 : « le jeu ne detecte pas quand un
        // belt traverse le decor, il faut que tu imposes certains poteaux, les maximums locaux sur le plan horizontal ou
        // vertical »)
        let bend = 0;
        for (let k = i + 1; k < j; k++) bend = Math.max(bend, Math.abs((Q[k].x - Q[i].x) * dy - (Q[k].y - Q[i].y) * dx) / dl);
        if (bend > BELT.BEND) continue;
        run = beltRun(W, Q[i], Q[j], H);
        if (!run.poles && isBelt(run.why)) run = beltRun(W, Q[i], Q[j], H + BELT.OVER);
        if (run.poles) break;
      }
      if (!run || !run.poles) return { fail: 'troncon impossible depuis ' + Math.round(Q[i].x) + ',' + Math.round(Q[i].y) + ' (' + (run ? run.why : 'sens du connecteur') + ')' };
      out.push(...run.poles.slice(1).filter((p) => !p.anchor));
      i = j;
    }
  }
  for (const p of out) if (!p.lift) p.h = p.z - p.g;
  return { poles: out, cost: found.c, src: nodes[0].src };
}

// Connecteur de convoyeur <acteur>.<connecteur> : { path, name, at, n (normale en plan, unitaire) }
async function beltEnd(ref) {
  const i = ref.lastIndexOf('.');
  const actor = ref.slice(0, i), name = ref.slice(i + 1);
  const full = actor.includes('/') ? actor : '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.' + actor;
  const c = (await call('connections', full)).find((cc) => cc.name === name);
  if (!c) throw new Error('connecteur introuvable : ' + ref);
  const hn = Math.hypot(c.normal.x, c.normal.y) || 1;
  return { path: full, name, at: c.location, n: { x: c.normal.x / hn, y: c.normal.y / hn } };
}

// Ligne de convoyeur de moindre cout de l'un des departs Ds au connecteur A : une seule recherche partie de tous les departs
// a la fois, le depart retenu decoule du chemin (foreuses.js : les sorties des 8 caps d'une foreuse pas encore posee, path
// null ; utilisateur, 27/10/2026 : « on trouve le path et seulement ensuite on oriente la foreuse, le path ne doit pas
// dependre de l'orientation de celle-ci »). D.extra : obstacles lies a ce depart (emprise de la foreuse a ce cap), tous
// comptes. o : { nom, H, via, avoid, RS, RC, marge, box0 (zone du releve imposee), remplace, recette, write (false : aucun
// fichier) }. Ecrit traces/<nom>-ligne.json. { best: { D, line, file, cost, lifts }, tries: [{ D, fail }], box0 } ; best null
// sans ligne
async function traceBelt(Ds, A, o) {
  const H = o.H, via = o.via || [], avoid = o.avoid || [];
  // point d'approche : 4 m devant la sortie de depart ; a l'arrivee, deux poteaux dans l'axe de l'entree, a 12 et 6 m
  // (la recherche vise celui de 12 m) : les deux derniers troncons sont droits et alignes sur le connecteur. Un dernier
  // troncon court qui tournait de 69 deg en montant de 2 m etait refuse (FGCDConveyorTooSteep, cuivre, 23/10/2026)
  const g6 = { x: A.at.x + 600 * A.n.x, y: A.at.y + 600 * A.n.y };
  // un seul releve pour toute la zone : bornes des connecteurs, elargies de la marge et des 20 m ou peuvent tomber les
  // points de depart et d'arrivee
  const marge0 = o.marge + 2000;
  const ex = [...Ds.map((D) => D.at.x), A.at.x, ...via.map((p) => p.x)], ey = [...Ds.map((D) => D.at.y), A.at.y, ...via.map((p) => p.y)];
  const box0 = o.box0 || { x0: Math.min(...ex) - marge0, x1: Math.max(...ex) + marge0, y0: Math.min(...ey) - marge0, y1: Math.max(...ey) + marge0 };
  // --releve <m> : pas du releve du relief (4 m par defaut) ; 2 m pour se faufiler entre des blocs (passage sous l'arche
  // de la cuvette de bauxite de S13 E101, 24/10/2026 : couloir de 4 a 6 m entre deux rochers, ferme a 4 m). Plus fin que
  // 4 m : releve a deux finesses, grossier a --releve-grossier m (4 par defaut : compare le 24/10/2026 sur 200 m de la cuvette de
  // bauxite, 2 m partout en reference : grossier 10 m, 7 657 points, 71 % de mailles fines, 1 rocher manque ; 6 m, 6 555 ; 4 m,
  // 6 050 points, 38 %, aucun manque. Sur terrain accidente, les grandes mailles sont presque toutes relevees finement)
  const RS = o.RS, RC = o.RC;
  const R0 = RS < 400 ? await reliefMulti(box0, RC, RS) : await relief(box0, RS);
  // poteaux sur le sol raide refuses par le jeu (beltline les decale alors de 3 a 6 m, hors de l'axe : premier poteau du
  // caterium, foreuse a flanc de colline, contre un poteau electrique, 23/10/2026) : premier point de l'axe sur un sol
  // praticable, a 4, 8, 12 ou 16 m du connecteur
  const steep = (p) => Math.max(...[[200, 0], [-200, 0], [0, 200], [0, -200]].map(([dx, dy]) => Math.abs(hBil(R0, p.x + dx, p.y + dy) - hBil(R0, p.x, p.y)) / 200)) > 0.35;
  const onAxis = (E, ds, ok = () => true) => { for (const d of ds) { const p = { x: E.at.x + d * E.n.x, y: E.at.y + d * E.n.y, d }; if (!steep(p) && ok(p)) return p; } return null; };
  const first = (E, ds) => ({ x: E.at.x + ds[0] * E.n.x, y: E.at.y + ds[0] * E.n.y, d: ds[0] });
  // depart : de preference un point ou le premier troncon reste doux (poteau de 1 m au moins, pente de bout 0,2) ; sortie
  // d'un fusionneur pose au sol, sol 1,4 m plus haut a 4 m (S13 E101, 24/10/2026 : « troncon de bout trop raide »)
  const starts = Ds.map((D) => {
    const softStart = (p) => hBil(R0, p.x, p.y) + 100 <= D.at.z + 0.2 * p.d + 25;
    return onAxis(D, [400, 800, 1200, 1600], softStart) || onAxis(D, [400, 800, 1200, 1600]) || first(D, [400]);
  });
  const g = onAxis(A, [1200, 1600, 2000]) || first(A, [1200]);
  const marge = o.marge;
  const sx = [...starts.map((s) => s.x), g.x, ...via.map((p) => p.x)], sy = [...starts.map((s) => s.y), g.y, ...via.map((p) => p.y)];
  const box = { x0: Math.min(...sx) - marge, x1: Math.max(...sx) + marge, y0: Math.min(...sy) - marge, y1: Math.max(...sy) + marge };
  const W0 = { box, width: 2 * BELT.HALF, height: 160, avoid };
  W0.relief = R0; // la zone du releve couvre celle de la recherche
  if (via.length || avoid.length) console.log('points de passage :', via.length, '; zones evitees :', avoid.length);
  // la foreuse de depart reste un obstacle (le point d'approche est devant sa sortie) ; l'ascenseur d'arrivee est ignore.
  // --remplace <acteur>.<connecteur> : ligne existante suivie depuis ce connecteur (comme diag-convoyeur), ignoree avec ses
  // poteaux et les convoyeurs branches aux autres sorties de ses repartiteurs : trace de remplacement, ou essai du traceur
  // sur une ligne posee a la main (lignes de calcaire 110 et 54 de l'usine de beton, 27/10/2026)
  const ignore = new Set([A.path.split('.').pop()]);
  let keep = () => true;
  if (o.remplace) {
    const old = await followLine(o.remplace, A.path);
    for (const p of old.parts.concat(old.side)) ignore.add(p.path.split('.').pop());
    keep = (ob) => !(ob.kind === 'box' && /ConveyorPole|ConveyorCeiling|ConveyorWall/.test(ob.what) && old.line.some((p) => Math.hypot(p.x - ob.c.x, p.y - ob.c.y) < 150));
    console.log('ligne remplacee :', old.parts.length, 'pieces ignorees (et', old.side.length, 'branchees a cote), fin :', old.end ? old.end.what : '?');
  }
  W0.near = index((await obstacles(box, ignore)).filter(keep));
  const t0 = Date.now();
  // obstacles propres aux departs (emprise de la foreuse a poser, a chacun de ses caps) : tous a la fois, le chemin ne
  // depend pas de l'orientation de la foreuse (utilisateur, 27/10/2026 : « on trouve le path et seulement ensuite on oriente
  // la foreuse »)
  const extra = Ds.flatMap((D) => D.extra || []);
  const W = extra.length ? Object.assign({}, W0, { near: (x, y) => W0.near(x, y).concat(extra) }) : W0;
  Ds.forEach((D, k) => {
    const s = starts[k];
    // depart : la recherche part de la maille la plus proche du point d'approche, ramenee jusqu'a 2,8 m vers la foreuse
    // quand sa sortie n'est pas dans l'axe de la grille (caterium, cap 160, 23/10/2026 : « grille fermee », foreuse touchee
    // tout autour). Point d'approche recule le long de l'axe (jusqu'a 20 m) tant que lui ou sa maille touche un obstacle.
    const ang0 = Math.atan2(D.n.y, D.n.x);
    const blocked = (p) => [p, { x: box.x0 + Math.round((p.x - box.x0) / BELT.CELL) * BELT.CELL, y: box.y0 + Math.round((p.y - box.y0) / BELT.CELL) * BELT.CELL }]
      .some((q) => beltHitAt(W, q.x, q.y, hAt(W.relief, q.x, q.y) + H, ang0));
    if (blocked(s)) {
      for (let d = s.d + 400; d <= 2000; d += 400) {
        const p = { x: D.at.x + d * D.n.x, y: D.at.y + d * D.n.y, d };
        if (!steep(p) && !blocked(p)) { Object.assign(s, p); if (Ds.length === 1) console.log('depart recule a', d / 100, 'm de la sortie (obstacle au plus pres)'); break; }
      }
    }
  });
  // une seule recherche depuis tous les departs, a cout nul : le depart retenu decoule du chemin
  const stats = { expanded: 0, hits: {} };
  const res = beltSearch(W, Ds.map((D, k) => ({ s: starts[k], dir: D.n, start: { z: D.at.z, d: starts[k].d } })), g, H, stats, via);
  // abandon : la limite de noeuds atteinte ne dit pas que la grille est fermee (les deux etaient confondus avant le
  // diagnostic des lignes de calcaire de l'usine de beton, 27/10/2026)
  const fail = !res || res.fail ? (res ? res.fail : stats.abandon ? 'recherche abandonnee apres ' + stats.expanded + ' noeuds' : 'grille fermee') + ' (obstacles les plus frequents : ' + JSON.stringify(topHits(stats.hits)) + ')' : null;
  const k0 = fail ? 0 : res.src;
  const tries = [{ D: Ds[k0], s: starts[k0], W, res, stats, fail, cost: fail ? null : res.cost, lifts: fail ? 0 : res.poles.filter((p) => p.lift).length }];
  // troncons de bout, droits, a pente moyenne de END_SLOPE au plus : un troncon court a bouts horizontaux est une
  // courbe d'Hermite dont la pente au milieu vaut 1,5 fois la moyenne (0,55 de moyenne sur 5 m : refuse). Sol reel sous
  // les poteaux (interpole) ; poteaux de 1 a 7 m. Du connecteur d'arrivee vers l'amont : poteau a 6 m, puis a 12 m.
  // sauf si le sol y est raide (bord de colline : le jeu refuse le poteau et beltline le decale de 6 m, hors de l'axe ;
  // cuivre 2, 23/10/2026) : alors le poteau de l'axe plus loin, sur le plat, va droit au connecteur
  // 0,2 : 0,3 sur les 6 derniers metres etait encore refuse (FGCDConveyorTooSteep) au bout d'une ligne sur poteaux de
  // 6 m (cuivre des mines, 23/10/2026)
  const END_SLOPE = 0.2;
  const finish = (t) => {
    const { D, s, W, res } = t, poles = res.poles.map((p) => Object.assign({}, p));
    const skip6 = steep(g6) || g.d > 1200;
    if (!skip6) poles.push(Object.assign({}, g6, { g: hBil(W.relief, g6.x, g6.y) }));
    const fit = (p, c, d) => {
      if (p.lift) return; // ascenseur au bout : son relais ou son pied est un connecteur, pas un poteau
      p.g = hBil(W.relief, p.x, p.y);
      const want = Math.max(c.z - END_SLOPE * d, Math.min(c.z + END_SLOPE * d, p.g + (p.h || H)));
      p.h = Math.max(100, Math.min(700, want - p.g)); p.z = p.g + p.h;
      if (Math.abs(p.z - c.z) / Math.max(d, 1) > END_SLOPE + 0.05) throw new Error('troncon de bout trop raide en ' + Math.round(p.x) + ',' + Math.round(p.y) + ' : ' + ((p.z - c.z) / 100).toFixed(1) + ' m sur ' + (d / 100).toFixed(1) + ' m (connecteur a tourner vers un sol au meme niveau)');
    };
    const nP = poles.length;
    if (skip6) fit(poles[nP - 1], A.at, g.d);
    else { fit(poles[nP - 1], A.at, 600); fit(poles[nP - 2], poles[nP - 1], 600); }
    fit(poles[0], D.at, s.d);
    return poles;
  };
  let best = null;
  if (!fail) { try { best = Object.assign(tries[0], { poles: finish(tries[0]) }); } catch (e) { tries[0].fail = e.message; } }
  if (!best) return { best: null, tries, box0 };
  const { D, poles } = best;
  // fichier de ligne de beltline : depart (connecteur), poteaux (z = sol), point d'approche, raccord final
  // poteaux d'un franchissement ou de bout : hauteur propre au sommet (beltline : poleHeight du sommet, en m). Le jeu
  // donne un poteau 1 m plus court que demande (references/convoyeurs.md) : on demande 1 m de plus (sans cela, dernier
  // troncon refuse FGCDConveyorTooSteep aux deux lignes du cuivre, 23/10/2026)
  const ask = (h) => Math.round((h + BELT.POLE_BIAS) / 10) / 10;
  // ascenseur : relais en (x, y) a l'altitude top, colonnes du haut vers le pied ; entry : connecteur ou la ligne arrive
  // (entree du relais en descente, pied en montee), exit : connecteur d'ou elle repart (pied en descente, sortie du relais)
  const r3 = (p) => ({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
  const liftPoint = (L) => {
    const u = L.u, F = L.cols[L.cols.length - 1], foot = { x: F.x, y: F.y, z: L.foot };
    const rIn = { x: L.relay.x - 100 * u.x, y: L.relay.y - 100 * u.y, z: L.top }, rOut = { x: L.relay.x + 100 * u.x, y: L.relay.y + 100 * u.y, z: L.top };
    return { lift: L.kind, x: L.relay.x, y: L.relay.y, z: Math.round(L.top), top: Math.round(L.top), foot: L.foot, u: { x: Math.round(u.x * 1e4) / 1e4, y: Math.round(u.y * 1e4) / 1e4 }, cols: L.cols, entry: r3(L.kind === 'descente' ? rIn : foot), exit: r3(L.kind === 'descente' ? foot : rOut) };
  };
  // top : altitude du convoyeur au poteau ; beltline regle la hauteur du poteau sur le sol qu'il trouve (le releve prend la
  // plus haute des mailles voisines : 8,5 m d'ecart au pied d'une marche sur la ligne 110 de l'usine de beton, 27/10/2026)
  const pts = poles.map((p) => (p.lift ? liftPoint(p.lift) : Object.assign({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.g), top: Math.round(p.z) }, p.h && Math.abs(p.h - H) > 5 ? { poleHeight: ask(p.h) } : {})));
  const recipe = o.recette || 'Recipe_ConveyorBeltMk6_C';
  const line = {
    recipe,
    liftRecipe: recipe.replace('ConveyorBelt', 'ConveyorLift'),
    start: { path: D.path, name: D.name },
    points: [{ x: Math.round(D.at.x), y: Math.round(D.at.y), z: Math.round(D.at.z) }, ...pts, { x: Math.round(A.at.x), y: Math.round(A.at.y), z: Math.round(A.at.z) }],
    poleHeight: ask(H),
    groundAbove: 15,
    // releve du relief de la recherche (coupe --ligne le relit : les surplombs trouves dependent de la zone relevee)
    releve: { box: box0, step: RS, coarse: RC },
    end: { path: A.path, name: A.name },
  };
  let len = 0;
  for (let k = 1; k < line.points.length; k++) len += Math.hypot(line.points[k].x - line.points[k - 1].x, line.points[k].y - line.points[k - 1].y);
  best.len = len;
  const lifts = pts.filter((p) => p.lift), ground = pts.filter((p) => !p.lift);
  let file = null;
  if (o.write !== false) {
    fs.mkdirSync(TRACES, { recursive: true });
    file = path.join(TRACES, o.nom + '-ligne.json');
    fs.writeFileSync(file, JSON.stringify(line, null, 1));
  }
  console.log('ligne', o.nom, ':', Math.round(len / 100), 'm,', ground.length, 'poteaux,', lifts.length ? lifts.length + ' ascenseurs (' + lifts.reduce((n, p) => n + p.cols.length, 0) + ' colonnes), ' : '', stats.expanded, 'noeuds en', Math.round((Date.now() - t0) / 1000), 's' + (file ? ' -> ' + path.relative(__dirname, file) : ''));
  // sol exact au pied de chaque poteau, cherche comme beltline (a la verticale, de 15 m au-dessus a 30 m sous le sol prevu :
  // depuis 400 m, le rayon touchait le dessus de l'arche CliffPillar_320 de la ligne 110, 27/10/2026) : le releve en mailles
  // le lisse au bord d'une marche. beltline regle la hauteur du poteau sur ce sol (top) ; alerte si elle sort de 1 a 7 m.
  // Caterium 169 de S13 E101 (25/10/2026, avant top) : poteau prevu a 126 m, pose a 115 m au pied d'une marche de 11 m,
  // troncon suivant refuse (FGCDInvalidPlacement) ; deplace de 6 m sur le haut de la marche
  if (o.write !== false) {
    for (const p of pts) {
      if (p.lift) {
        console.log('   ' + p.lift, 'relais', p.x, p.y, 'a', (p.top / 100).toFixed(1), 'm, pied a', (p.foot / 100).toFixed(1), 'm,', p.cols.length, 'colonne(s) :', p.cols.map((c) => c.x + ',' + c.y).join(' '));
        continue;
      }
      let e = (await call('reliefPoints', [{ x: p.x, y: p.y }], p.z + 100 * line.groundAbove, p.z - 3000)).z[0], on = '';
      // pas de sol naturel dans la fenetre : beltline cherche le sol sans ignorer les batiments (ligne 110, 27/10/2026 :
      // fondation a 76 m au-dessus d'un trou, sol naturel a 11 m)
      if (e == null) { const gb = (await call('ground', p.x, p.y, p.z + 100 * line.groundAbove, p.z - 3000)).z; if (gb != null) { e = gb; on = ' sur un batiment'; } }
      const ph = e == null ? null : p.top - e;
      const note = e == null ? ' ATTENTION : pas de sol de ' + ((p.z / 100) + line.groundAbove).toFixed(0) + ' a ' + ((p.z - 3000) / 100).toFixed(0) + ' m'
        : on ? ' (' + on.trim() + ' a ' + (e / 100).toFixed(1) + ' m : poteau de ' + (ph / 100).toFixed(1) + ' m)'
        : ph < 100 || ph > 700 ? ' ATTENTION : sol exact ' + (e / 100).toFixed(1) + ' m, poteau de ' + (ph / 100).toFixed(1) + ' m (hors de 1 a 7 m : deplacer ce poteau avant la pose)'
          : Math.abs(e - p.z) > 150 ? ' (sol exact ' + (e / 100).toFixed(1) + ' m : poteau de ' + (ph / 100).toFixed(1) + ' m)' : '';
      console.log('  ', p.x, p.y, 'sol', (p.z / 100).toFixed(1) + ' m, convoyeur', (p.top / 100).toFixed(1) + ' m' + note);
    }
  }
  Object.assign(best, { line, file });
  return { best, tries, box0 };
}

async function planBelt() {
  const nom = opt('nom');
  if (!nom) throw new Error('--nom requis');
  // --par x,y;x,y : points de passage, dans l'ordre (utilisateur, 27/10/2026 : « tu imposes pas des points de passage au
  // tracer pour le piloter un minimum ? » : passage connu, couloir) ; --eviter x0,y0,x1,y1;... : rectangles interdits
  // (zone d'extension future, abords d'un batiment). Positions en uu
  const nums = (s) => s.split(',').map(Number);
  const via = String(opt('par', '')).split(';').filter(Boolean).map((s) => { const [x, y] = nums(s); return { x, y }; });
  const avoid = String(opt('eviter', '')).split(';').filter(Boolean).map((s) => { const [a, b, c, d] = nums(s); return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) }; });
  if ([...via.flatMap((p) => [p.x, p.y]), ...avoid.flatMap((r) => [r.x0, r.y0, r.x1, r.y1])].some((v) => !Number.isFinite(v))) throw new Error('--par x,y;x,y ou --eviter x0,y0,x1,y1;... : nombres en uu');
  const D = await beltEnd(opt('de')), A = await beltEnd(opt('a'));
  const r = await traceBelt([D], A, beltOpts({ nom, via, avoid, remplace: opt('remplace') }));
  if (!r.best) throw new Error('aucune ligne : ' + r.tries[0].fail);
}

// Options de traceBelt lues sur la ligne de commande (--poteau, --marge, --releve, --releve-grossier, --recette)
function beltOpts(o) {
  return Object.assign({ H: 100 * Number(opt('poteau', 2)), marge: 100 * Number(opt('marge', 60)), RS: Math.round(100 * Number(opt('releve', 4))), RC: Math.round(100 * Number(opt('releve-grossier', 4))), recette: opt('recette', 'Recipe_ConveyorBeltMk6_C') }, o);
}

// Ligne posee, suivie vers l'aval depuis le connecteur ref (convoyeurs, ascenseurs, repartiteurs a une seule sortie
// branchee, sinon --sortie) jusqu'au premier fusionneur ou batiment (la ligne y rejoint une autre, ou arrive).
// { c0 (connecteur de depart), parts [{ kind, path, pts }], end { what, path? }, line (points dans le sens du flux),
// side [{ path }] (acteurs branches aux autres sorties des repartiteurs : convoyeur en cul-de-sac) }
async function followLine(ref, stopAt) {
  const PRE = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
  const short = (p) => p.split('.').pop();
  const kind = (p) => short(p).replace(/_\d+$/, '');
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  let conn = ref.includes('/') ? ref : PRE + ref;
  const c0 = (await call('connections', conn.slice(0, conn.lastIndexOf('.')))).find((c) => c.name === short(conn));
  if (!c0) throw new Error('connecteur introuvable : ' + ref);
  const parts = [], side = [];
  let end = null;
  for (let n = 0; n < 400 && !end; n++) {
    const next = (await call('dump', conn, 1, 1, ['mConnectedComponent'])).mConnectedComponent;
    if (!next) { end = { what: 'connecteur libre ' + conn.split('.').slice(-2).join('.') }; break; }
    const owner = next.slice(0, next.lastIndexOf('.')), entered = short(next), cls = kind(owner);
    if (stopAt && short(owner) === short(stopAt)) { end = { what: cls, path: owner }; break; } // batiment d'arrivee
    const outs = (await call('connections', owner)).filter((p) => p.name !== entered && p.direction !== 'input');
    const pose = await call('pose', owner);
    let pts;
    if (/ConveyorBelt/.test(cls)) pts = sampleSpline((await call('dump', owner, 3, 50, ['mSplineData'])).mSplineData || [], pose.location, pose.rotation.yaw);
    else if (/ConveyorLift/.test(cls)) {
      const d = await call('dump', owner, 3, 50, ['mTopTransform']);
      const t = (d.mTopTransform && (d.mTopTransform.Translation || d.mTopTransform.translation)) || { X: 0, Y: 0, Z: 0 };
      const a = rad(pose.rotation.yaw || 0), b = pose.location;
      pts = [b, { x: b.x + t.X * Math.cos(a) - t.Y * Math.sin(a), y: b.y + t.X * Math.sin(a) + t.Y * Math.cos(a), z: b.z + t.Z }];
    } else if (/Splitter/.test(cls)) {
      const live = outs.filter((p) => p.connected), pick = live.find((p) => p.name === opt('sortie')) || (live.length === 1 ? live[0] : null);
      if (!pick) { end = { what: cls + ' (sorties branchees : ' + live.map((p) => p.name).join(', ') + ' ; --sortie pour choisir)', path: owner }; break; }
      for (const o of live.filter((p) => p !== pick)) {
        const other = (await call('dump', owner + '.' + o.name, 1, 1, ['mConnectedComponent'])).mConnectedComponent;
        if (other) side.push({ path: other.slice(0, other.lastIndexOf('.')) });
      }
      pts = [pose.location];
      outs.splice(0, outs.length, pick);
    } else if (/Merger/.test(cls) && !(await call('connections', owner)).some((p) => p.direction === 'input' && p.name !== entered && p.connected)) {
      pts = [pose.location]; // relais : fusionneur ou n'arrive que cette ligne (ligne du caterium de la cote, 26/10/2026)
    } else { end = { what: cls, path: owner }; break; }
    parts.push({ kind: /Lift/.test(cls) ? 'ascenseur' : /Belt/.test(cls) ? 'convoyeur' : 'raccord', path: owner, pts });
    if (outs.length !== 1) { end = { what: cls + ' sans sortie unique' }; break; }
    conn = owner + '.' + outs[0].name;
  }
  // points de la ligne dans le sens du flux (chaque piece retournee si besoin)
  const line = [Object.assign({}, c0.location)];
  for (const p of parts) {
    const last = line[line.length - 1];
    if (dist(p.pts[0], last) > dist(p.pts[p.pts.length - 1], last)) p.pts.reverse();
    line.push(...p.pts);
  }
  return { c0, parts, end, line, side };
}

// Diagnostic d'une ligne posee (utilisateur, 27/10/2026 : « diag tracer » ; lignes de calcaire des gisements 110 et 54_833
// de l'usine de beton, « grille fermee » au traceur, posees ensuite a la main) : la ligne reelle (followLine), rejouee tous
// les 4 m dans le modele de la recherche (releve et obstacles comme pour convoyeur, la ligne et ses poteaux ignores) : ce
// que la grille aurait refuse et pourquoi (mer, maille fermee par un obstacle a toutes les hauteurs de poteau, aucune
// hauteur de poteau qui passe depuis l'echantillon precedent : falaise, la ou le traceur pose un ascenseur), hauteur reelle
// du convoyeur au-dessus du sol du modele, ascenseurs de la ligne.
async function diagBelt() {
  const H = 100 * Number(opt('poteau', 2));
  const ref = opt('de');
  if (!ref) throw new Error('--de <acteur>.<connecteur> requis');
  const short = (p) => p.split('.').pop();
  const kind = (p) => short(p).replace(/_\d+$/, '');
  // 1. la ligne, de connecteur en connecteur
  const { parts, end, line } = await followLine(ref);
  // echantillons tous les 4 m en plan (abscisse s, cap de la ligne)
  const S = [];
  let acc = 0, nextS = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], d = Math.hypot(b.x - a.x, b.y - a.y);
    for (; nextS <= acc + d && d > 0; nextS += BELT.CELL) {
      const t = (nextS - acc) / d;
      S.push({ s: nextS, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) });
    }
    acc += d;
  }
  const count = (k) => parts.filter((p) => p.kind === k).length;
  console.log('ligne :', count('convoyeur'), 'convoyeurs,', count('ascenseur'), 'ascenseurs,', count('raccord'), 'raccords,', Math.round(acc / 100), 'm en plan ; fin :', end ? end.what : '?');
  // 2. modele : releve (sources de streaming comprises) et obstacles, la ligne ignoree
  // marge de convoyeur (60 m + 20) : un surplomb n'est trouve que par contraste avec des mailles hors de la roche
  const marge = 100 * Number(opt('marge', 60)) + 2000;
  const xs = line.map((p) => p.x), ys = line.map((p) => p.y);
  const box = { x0: Math.min(...xs) - marge, x1: Math.max(...xs) + marge, y0: Math.min(...ys) - marge, y1: Math.max(...ys) + marge };
  const RS = Math.round(100 * Number(opt('releve', 4))), RC = Math.round(100 * Number(opt('releve-grossier', 4)));
  const W = { box, width: 2 * BELT.HALF, height: 160 };
  W.relief = RS < 400 ? await reliefMulti(box, RC, RS) : await relief(box, RS);
  const ignore = new Set(parts.map((p) => short(p.path)).concat(end && end.path ? [short(end.path)] : []));
  const nearLine = (c) => line.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 150);
  const obs = (await obstacles(box, ignore)).filter((o) => !(o.kind === 'box' && /ConveyorPole|ConveyorCeiling|ConveyorWall/.test(o.what) && nearLine(o.c)));
  W.near = index(obs);
  // 3. chaque echantillon : refus de la grille (hauteurs de poteau de BELT.HS, propagees d'echantillon en echantillon) et
  // ecarts avec la ligne reelle
  const label = (h) => kind(h).replace(/^Build_/, '');
  const hs = BELT.HS.map((h) => h / 100).join('-');
  let reach = null;
  for (let k = 0; k < S.length; k++) {
    const p = S[k], why = [], st = { hits: {} };
    p.g = hAt(W.relief, p.x, p.y);
    p.bout = p.s < 400 || p.s > acc - 1200; // hors recherche : point d'approche du depart, deux poteaux d'arrivee
    const cm = beltMask(W, p.x, p.y, [0, Math.PI / 2], H, st);
    let m = cm;
    if (!(p.g > BELT.SEA + 100 - BELT.HS[BELT.HS.length - 1])) why.push('mer');
    else if (!cm) why.push('maille fermee' + (Object.keys(st.hits)[0] ? ' par ' + label(Object.keys(st.hits)[0]) : ''));
    else if (k > 0 && reach) {
      const q = S[k - 1];
      m = beltStep(W, q, reach, p, cm);
      if (!m) {
        const dz = p.g - q.g;
        why.push('aucune hauteur de ' + hs + ' m ne passe (sol ' + (dz / 100).toFixed(1) + ' m en ' + (Math.hypot(p.x - q.x, p.y - q.y) / 100).toFixed(1) + ' m' + (Math.abs(dz) >= BELT.LIFT.CLIFF ? ' : falaise -> ascenseur du traceur' : '') + ')');
        m = cm;
      }
    }
    reach = cm ? m : null;
    p.why = why.join(', ');
    // ligne reelle dans le modele : relief du modele au-dessus d'elle, obstacle a sa hauteur
    const real = [];
    if (p.g > p.z - BELT.CLEAR) real.push('sol du modele ' + ((p.g - p.z) / 100).toFixed(1) + ' m au-dessus');
    const h = beltHitAt(W, p.x, p.y, p.z, p.ang);
    if (h) real.push(label(h));
    p.real = real.join(', ');
  }
  // 4. troncons de meme verdict
  const m1 = (v) => (v / 100).toFixed(0);
  const runs = [];
  for (const p of S) {
    const r = runs[runs.length - 1];
    if (r && r.why === p.why && r.real === p.real && r.bout === p.bout) { r.b = p; continue; }
    runs.push({ a: p, b: p, why: p.why, real: p.real, bout: p.bout });
  }
  console.log('\n  s (m)       sol modele   convoyeur reel   refus de la grille (poteaux de ' + hs + ' m)   | ligne reelle dans le modele');
  for (const r of runs) {
    console.log('  ' + (m1(r.a.s) + '-' + m1(r.b.s)).padEnd(11) + (m1(r.a.g) + '->' + m1(r.b.g) + ' m').padEnd(13) + (m1(r.a.z) + '->' + m1(r.b.z) + ' m').padEnd(17)
      + (r.bout ? '(bout) ' : '') + (r.why || 'libre') + (r.real ? '   | ' + r.real : ''));
  }
  for (const p of parts.filter((q) => q.kind === 'ascenseur')) {
    const [a, b] = p.pts, at = S.reduce((u, q) => (Math.hypot(q.x - a.x, q.y - a.y) < Math.hypot(u.x - a.x, u.y - a.y) ? q : u), S[0]);
    console.log('ascenseur', short(p.path), 'a', m1(at.s), 'm :', m1(a.z), '->', m1(b.z), 'm en', Math.round(a.x) + ',' + Math.round(a.y));
  }
  const tally = {};
  for (const p of S) if (!p.bout && p.why) for (const w of p.why.split(', ')) { const k = w.replace(/ \(.*\)$/, ''); tally[k] = (tally[k] || 0) + 1; }
  const first = S.find((p) => !p.bout && p.why);
  console.log('\nrefus (echantillons de 4 m, bouts exclus) :', JSON.stringify(Object.entries(tally).sort((a, b) => b[1] - a[1])));
  console.log(first ? 'premier refus a ' + m1(first.s) + ' m (' + Math.round(first.x) + ',' + Math.round(first.y) + ') : ' + first.why : 'la grille accepte toute la ligne reelle : l\'echec vient d\'ailleurs (limite de noeuds, depart ou arrivee)');
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

// Coupe verticale (utilisateur, 27/10/2026 : « est-ce que tu fais des profils de coupe aussi dans une direction donnee ? ») le
// long d'un segment (--de x,y|<acteur> --a x,y|<acteur>) ou d'une ligne de tracer.js (--ligne traces/<nom>-ligne.json :
// profil en long, convoyeur, poteaux et ascenseurs dessines). Une colonne tous les --pas m (une ligne de 160 colonnes au
// plus par defaut), une rangee tous les --dz m (une quarantaine par defaut). # relief et roche (sous un surplomb : vide
// entre le sol et le dessous de la roche), ~ mer, o batiment, = convoyeur, | poteau, H ascenseur
async function coupe() {
  const PRE = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
  const where = async (s) => {
    const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(s || '');
    if (m) return { x: +m[1], y: +m[2] };
    if (!s) throw new Error('coupe : --de et --a (x,y ou acteur), ou --ligne traces/<nom>-ligne.json');
    return (await call('pose', s.includes('/') ? s : PRE + s)).location;
  };
  // sommets du trajet ; pour une ligne, altitude du convoyeur (z), colonnes d'ascenseur (col), poteaux (pole)
  const V = [];
  let L = null;
  // --ligne avec --de et --a : coupe sur ce segment, dans le releve de la ligne (meme modele que sa recherche)
  const seg = opt('de') && opt('a');
  if (opt('ligne')) L = JSON.parse(fs.readFileSync(path.resolve(__dirname, opt('ligne')), 'utf8'));
  if (L && !seg) {
    L.points.forEach((p, k) => {
      if (!p.lift) { V.push({ x: p.x, y: p.y, z: k === 0 || k === L.points.length - 1 ? p.z : p.top != null ? p.top : p.z + 100 * (p.poleHeight || L.poleHeight || 3) - 100, pole: k > 0 && k < L.points.length - 1 }); return; }
      const cols = p.lift === 'descente' ? p.cols : [...p.cols].reverse();
      V.push(Object.assign({}, p.entry));
      for (const c of cols) {
        const [z0, z1] = p.lift === 'descente' ? [c.zt, c.zb] : [c.zb, c.zt];
        V.push({ x: c.x, y: c.y, z: z0, col: [c.zb, c.zt] }, { x: c.x, y: c.y, z: z1 });
      }
      V.push(Object.assign({}, p.exit));
    });
  } else V.push(await where(opt('de')), await where(opt('a')));
  // abscisse le long du trajet
  V[0].s = 0;
  for (let k = 1; k < V.length; k++) V[k].s = V[k - 1].s + Math.hypot(V[k].x - V[k - 1].x, V[k].y - V[k - 1].y);
  const Ltot = V[V.length - 1].s;
  const P = 100 * Number(opt('pas', Math.max(4, Math.ceil(Ltot / 100 / 160))));
  // releve aussi large que celui de convoyeur : un surplomb n'est trouve que par contraste avec des mailles hors de la roche
  // (a 20 m de marge, la ligne du caterium de la cote, toute sous le toit, avait un sol a 275 m au lieu de 80 m)
  // et, pour une ligne, le releve meme de sa recherche (cache) : les surplombs trouves dependent de la zone relevee
  const xs = V.map((p) => p.x), ys = V.map((p) => p.y), m0 = 100 * Number(opt('marge', 60)) + 2000;
  const RL = L && L.releve;
  const box = RL ? RL.box : { x0: Math.min(...xs) - m0, x1: Math.max(...xs) + m0, y0: Math.min(...ys) - m0, y1: Math.max(...ys) + m0 };
  const RS = RL ? RL.step : Math.round(100 * Number(opt('releve', 4)));
  const rl = RS < 400 ? await reliefMulti(box, RL ? RL.coarse : 400, RS) : await relief(box, RS);
  const near = index(await obstacles(box, new Set()));
  const Wb = { relief: Object.assign({}, rl, { over: null }), near }; // batiments seuls
  // echantillons : position, sol, surplombs, convoyeur interpole (pas sur un segment vertical)
  const S = [];
  for (let s = 0; s <= Ltot + 1; s += P) {
    let k = 1;
    while (k < V.length - 1 && V[k].s < s) k++;
    const a = V[k - 1], b = V[k], t = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 1;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    S.push({ s, x, y, g: hAt(rl, x, y), over: overAt(rl, x, y), belt: L && !seg && a.z != null && b.z != null ? a.z + (b.z - a.z) * t : null });
  }
  const at = (p) => S.reduce((u, q, i) => (Math.abs(q.s - p.s) < Math.abs(S[u].s - p.s) ? i : u), 0);
  const poles = new Map(), cols = new Map();
  for (const p of V) { if (p.pole) poles.set(at(p), p.z); if (p.col) cols.set(at(p), p.col); }
  // rangees
  const zsAll = S.flatMap((q) => [q.g, q.belt, ...q.over.map((o) => o[1])]).filter((z) => z != null && z > -Infinity);
  const zmin = Math.max(Math.min(...S.map((q) => q.g).filter((z) => z > -Infinity)) - 300, BELT.SEA - 300), zmax = Math.max(...zsAll) + 300;
  const nice = [1, 2, 5, 10, 20, 50, 100];
  const DZ = 100 * Number(opt('dz', nice.find((n) => (zmax - zmin) / 100 / n <= 45) || 100));
  const lines = [];
  for (let zr = Math.floor(zmax / DZ) * DZ; zr >= zmin - DZ; zr -= DZ) {
    let l = ((zr / 100).toFixed(0) + ' m').padStart(7) + ' ';
    S.forEach((q, i) => {
      const lo = zr, hi = zr + DZ;
      const c = cols.get(i);
      if (c && hi > c[0] && lo <= c[1]) { l += 'H'; return; }
      if (q.belt != null && q.belt >= lo && q.belt < hi) { l += '='; return; }
      const pz = poles.get(i);
      if (pz != null && lo < pz && hi > q.g) { l += '|'; return; }
      if (hitColumn(Wb, q.x, q.y, lo, hi, Infinity)) { l += 'o'; return; }
      if (lo < q.g || q.over.some(([u, t]) => hi > u && lo < t)) { l += '#'; return; }
      if (q.g < BELT.SEA && lo < BELT.SEA) { l += '~'; return; }
      l += ' ';
    });
    lines.push(l);
  }
  let axis = ' '.repeat(8), lab = ' '.repeat(8);
  S.forEach((q, i) => { axis += i % 10 === 0 ? '|' : '-'; if (i % 10 === 0) lab += String(Math.round(q.s / 100)).padEnd(10); });
  console.log((L && !seg ? 'profil en long de ' + opt('ligne') : 'coupe de ' + Math.round(V[0].x) + ',' + Math.round(V[0].y) + ' a ' + Math.round(V[1].x) + ',' + Math.round(V[1].y) + ', cap ' + Math.round(norm360((Math.atan2(V[1].y - V[0].y, V[1].x - V[0].x) * 180) / Math.PI))) + ' : ' + Math.round(Ltot / 100) + ' m, une colonne tous les ' + P / 100 + ' m, une rangee tous les ' + DZ / 100 + ' m');
  console.log(lines.join('\n'));
  console.log(axis + '\n' + lab + ' (m)');
  console.log('# relief et roche, ~ mer, o batiment' + (L && !seg ? ', = convoyeur, | poteau, H ascenseur' : ''));
}

if (require.main === module) {
  (async () => {
    if (argv[0] === 'rail') await planRail();
    else if (argv[0] === 'valider') await valider();
    else if (argv[0] === 'controler') await controler();
    else if (argv[0] === 'convoyeur') await planBelt();
    else if (argv[0] === 'diag-convoyeur') await diagBelt();
    else if (argv[0] === 'carte') await carte();
    else if (argv[0] === 'coupe') await coupe();
    else throw new Error('usage : node tracer.js rail --de x,y,z@cap --a x,y,z@cap --nom <nom> [...] | valider <nom> | convoyeur --de <acteur>.<connecteur> --a <acteur>.<connecteur> --nom <nom> [--par x,y;x,y] [--eviter x0,y0,x1,y1;...] | diag-convoyeur --de <acteur>.<connecteur> | carte --centre x,y [--rayon m] | coupe --de x,y --a x,y | coupe --ligne traces/<nom>-ligne.json');
  })().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
}
module.exports = { relief, reliefMulti, obstacles, index, hitAt, hitColumn, hAt, overAt, hermite, step, profile, beltEnd, traceBelt, loadArea };
