// Piles verticales de machines a deux entrees (assembleuses, fonderies...) sur une plateforme de fondations, montees
// comme les piles d'assembleuses de l'utilisateur (observees en (-35 950 ; -143 688) le 20/10/2026) :
//  - machines superposees tous les `espacement` m, la premiere posee sur la plateforme ;
//  - un repartiteur par entree, 5 m derriere elle ; tourne d'un quart de tour a chaque etage : l'ascenseur vers l'etage
//    du dessus part du cote exterieur depuis un etage pair, de l'arriere depuis un etage impair ;
//  - un fusionneur 6 m devant la sortie, tourne de meme : la silice (le produit) descend par le cote +x vers un etage
//    pair, par l'avant vers un etage impair ; sortie au pied vers l'avant ;
//  - arrivees : une ligne par entree le long de l'arriere des piles, 15 m derriere les repartiteurs du pied, chacune a sa
//    hauteur, avec un repartiteur par pile et une branche droite jusqu'au repartiteur du pied ;
//  - collecteur : une ligne de fusionneurs 6 m devant les fusionneurs du pied ; sa derniere sortie est celle de l'atelier.
// La disposition des connecteurs de la machine est lue dans le jeu (knowledge.js), la plateforme retrouvee par ses
// fondations. Les distances ci-dessus (DESIGN) sont celles des piles de l'utilisateur.
//
// Machines a 3 ou 4 entrees (fabricants, 25/10/2026, montage de la pile de cellules de l'utilisateur relevee en
// (-235 361 ; -190 447)) : colonnes des entrees exterieures 4,3 m derriere elles, des interieures 11,3 m ; arrivees de
// preference en mode ascenseur (une ligne sous la plateforme et une au-dessus par rang) ; « directes » : une entree
// alimentee etage par etage par la sortie de la machine correspondante d'une autre pile (« sortie »: "directe" sur
// celle-ci : ni fusionneurs, ni collecteur).
//
// Usage : node pile.js <phase> --config <fichier.json> [--dry]
//   phases : plan | machines | raccords | branches | directes | ascenseurs | arrivees | collecteur | courant | recettes
//            | verifie | tout | demonte
// Configuration (JSON) :
//   { "nom": "silice", "recette": "Recipe_Alternate_Silica_C",
//     "plateforme": { "pres": { "x": .., "y": .., "z": .. } }        // fondations retrouvees autour du point
//               ou { "origine": {x,y}, "cap": -20, "dessus": 1490 },  // repere de la plateforme donne
//     "dos": "-x",                    // axe de la plateforme vers lequel regarde l'arriere des piles : x | -x | y | -y
//     "centre": [4, 0],               // centre de la rangee de piles (centre des machines), repere plateforme, m
//     "piles": 2, "etages": 8,        // nombre de piles (cote a cote le long de lx) et d'etages
//     "pas": 16, "espacement": 10,    // m entre piles, m entre etages
//     "arrivees": [ { "entree": "Input1", "hauteur": 2, "sens": "+lx" }, ... ],   // hauteur : m au-dessus de la
//                                     // plateforme ; sens : sens du flux le long de la rangee (+lx / -lx) ;
//                                     // "mode": "ascenseur" : ligne 4 m derriere le pied, hauteur -6 ou +6
//     "directes": [ { "entree": "Input2", "depuis": "<nom d'une autre pile>", "sortie": "Output0" } ],
//     "sortie": "directe",            // facultatif : sortie reprise par une autre pile (pas de collecteur)
//     "collecteur": { "sens": "-lx" },
//     "poteaux": [ [lx, ly], ... ],   // facultatif (repere de la rangee, m) ; defaut : un par pile devant le collecteur
//     "reseau": "<poteau du reseau>",
//     "enLAir": true }              // sans fondations : pied des piles et poteaux poses en l air (complexes sur l eau)
// Reperes : plateforme = origine au centre des fondations, x le long de la grille (cap), y a +90 ; rangee = origine au
// centre de la rangee, ly vers l'avant des machines, lx a -90 de ly (+x local de la machine).
// Etat : <nom>-pile-state.json a cote de ce fichier (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');
const R = require('./rules');
const K = require('./knowledge');

const DESIGN = {
  SPLITTER_BACK: 500,  // repartiteur derriere l'entree de la machine (uu)
  MERGER_FRONT: 600,   // fusionneur devant la sortie
  FEED_BACK: 1500,     // ligne d'arrivee derriere les repartiteurs du pied
  COLLECTOR_FRONT: 600, // collecteur devant les fusionneurs du pied
  POLE_FRONT: 300,     // poteau par defaut devant le collecteur
  // machines a 3 ou 4 entrees (fabricants), comme la pile de cellules de l'utilisateur relevee en (-235 361 ; -190 447)
  // le 25/10/2026 : repartiteurs des entrees exterieures 4,3 m derriere elles, des entrees interieures 11,3 m
  SPLITTER_BACK_EXT: 430,
  SPLITTER_BACK_INT: 1130,
  FEED_LIFT_BACK: 400, // arrivee par ascenseur : ligne 4 m derriere le repartiteur du pied
};
const RECIPES = {
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  poles: ['Recipe_PowerPoleMk3_C', 'Recipe_PowerPoleMk2_C', 'Recipe_PowerPoleMk1_C'],
};
const FOUNDATIONS = [ // classe, epaisseur (uu)
  ['/Game/FactoryGame/Buildable/Building/Foundation/Build_Foundation_8x1_01.Build_Foundation_8x1_01_C', 100],
  ['/Game/FactoryGame/Buildable/Building/Foundation/Build_Foundation_8x2_01.Build_Foundation_8x2_01_C', 200],
  ['/Game/FactoryGame/Buildable/Building/Foundation/Build_Foundation_8x4_01.Build_Foundation_8x4_01_C', 400],
];
const AIR = { ignore: R.IN_AIR };
// Machines des etages : la cheminee d'une assembleuse (boite d'encombrement douce jusqu'a 10,75 m) depasse dans la
// machine du dessus a 10 m ; les piles de l'utilisateur ont ce meme chevauchement (constate le 20/10/2026)
const STACKED = { ignore: R.IN_AIR.concat(['FGCDEncroachingSoftClearance']) };

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry');
const RAD = Math.PI / 180;
const vec = (deg) => ({ x: Math.cos(deg * RAD), y: Math.sin(deg * RAD) });
const odd = (i) => i % 2 === 1;

// --- Plateforme --------------------------------------------------------------------------------------

// Fondations au meme niveau autour du point : centre, cap de la grille (ramene dans ]-45, 45]), dessus
async function findPlatform(near) {
  let best = null;
  for (const [cls, thick] of FOUNDATIONS) {
    let r;
    try { r = await call('lightweight', cls, near, 6000); } catch (e) { continue; }
    if (!r.items.length) continue;
    const z0 = r.items.reduce((a, b) => (Math.abs(b.location.z - near.z) < Math.abs(a.location.z - near.z) ? b : a)).location.z;
    const items = r.items.filter((i) => Math.abs(i.location.z - z0) < 20);
    if (!best || items.length > best.items.length) best = { items, thick };
  }
  if (!best || best.items.length < 1) throw new Error('aucune fondation pres de ' + JSON.stringify(near));
  const { items, thick } = best;
  let cap = 0;
  if (items.length > 1) {
    const a = items[0].location;
    const nb = items.slice(1).reduce((m, b) => (Math.hypot(b.location.x - a.x, b.location.y - a.y) < Math.hypot(m.location.x - a.x, m.location.y - a.y) ? b : m));
    cap = Math.atan2(nb.location.y - a.y, nb.location.x - a.x) / RAD;
    cap = ((cap % 90) + 135) % 90 - 45;
  }
  const e1 = vec(cap), e2 = vec(cap + 90), o = items[0].location;
  const p = items.map((i) => ({ x: (i.location.x - o.x) * e1.x + (i.location.y - o.y) * e1.y, y: (i.location.x - o.x) * e2.x + (i.location.y - o.y) * e2.y }));
  const [x0, x1, y0, y1] = [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.y))];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return {
    origine: { x: o.x + e1.x * cx + e2.x * cy, y: o.y + e1.y * cx + e2.y * cy },
    cap, dessus: items[0].location.z + thick / 2, fondations: items.length,
    taille: [(x1 - x0) / 100 + 8, (y1 - y0) / 100 + 8],
  };
}

// --- Geometrie ---------------------------------------------------------------------------------------

async function geometry(cfg, st) {
  if (!st.plateforme) st.plateforme = cfg.plateforme.pres ? await findPlatform(cfg.plateforme.pres) : cfg.plateforme;
  const pf = st.plateforme;
  const e1 = vec(pf.cap), e2 = vec(pf.cap + 90);
  const dos = { x: { x: 1, y: 0 }, '-x': { x: -1, y: 0 }, y: { x: 0, y: 1 }, '-y': { x: 0, y: -1 } }[cfg.dos];
  if (!dos) throw new Error('dos : x | -x | y | -y');
  const F = { x: -(e1.x * dos.x + e2.x * dos.y), y: -(e1.y * dos.x + e2.y * dos.y) }; // avant des machines (monde)
  const X = { x: F.y, y: -F.x };                                                      // +x local des machines
  const front = Math.atan2(F.y, F.x) / RAD;
  const machineYaw = front - 90;
  const c = cfg.centre || [0, 0];
  const center = { x: pf.origine.x + (e1.x * c[0] + e2.x * c[1]) * 100, y: pf.origine.y + (e1.y * c[0] + e2.y * c[1]) * 100 };
  const W = (lx, ly, z) => ({ x: center.x + X.x * lx + F.x * ly, y: center.y + X.y * lx + F.y * ly, z });
  const rec = await R.recipe(cfg.recette);
  if (!rec.producer) throw new Error(cfg.recette + ' : aucun batiment producteur');
  const lay = await K.layout(R.buildingRecipeOf(rec.producer));
  // la recette de construction deduite du nom peut viser un autre batiment (Recipe_SmelterMk1_C = fonderie a deux
  // entrees, rules.js BUILD_RECIPE)
  if (lay.buildClass && lay.buildClass !== rec.producer) throw new Error(R.buildingRecipeOf(rec.producer) + ' construit ' + lay.buildClass + ', pas ' + rec.producer + ' (rules.js BUILD_RECIPE)');
  const ins = lay.connectors.filter((k) => k.direction === 'input');
  const out = lay.connectors.filter((k) => k.direction === 'output');
  if (ins.length < 1 || ins.length > 4 || out.length !== 1) throw new Error(lay.buildClass + ' : ' + ins.length + ' entrees / ' + out.length + ' sorties (1 a 4 entrees et 1 sortie gerees)');
  // entrees alimentees directement par une autre pile (cfg.directes) : pas de colonne. A 3 ou 4 entrees, les colonnes
  // exterieures (|x| le plus grand) sont pres de la machine, les interieures plus loin : leurs ascenseurs de cote
  // tombent entre deux rangs et ne se croisent pas
  const direct = new Set((cfg.directes || []).map((d) => d.entree));
  const maxAbs = Math.max(...ins.map((k) => Math.abs(k.offset.x)));
  const columns = ins.filter((k) => !direct.has(k.name)).map((k) => {
    const ext = ins.length <= 2 || Math.abs(k.offset.x) > maxAbs - 100;
    const back = ins.length <= 2 ? DESIGN.SPLITTER_BACK : ext ? DESIGN.SPLITTER_BACK_EXT : DESIGN.SPLITTER_BACK_INT;
    return { input: k.name, x: k.offset.x, y: k.offset.y - back, z: k.offset.z, outer: k.offset.x > 0 ? 1 : -1, ext };
  });
  if (ins.length === 2 && columns.length === 2 && columns[0].outer === columns[1].outer) throw new Error('entrees du meme cote de la machine : disposition non geree');
  const merger = { x: out[0].offset.x, y: out[0].offset.y + DESIGN.MERGER_FRONT, z: out[0].offset.z };
  const n = cfg.piles || 1;
  const stacks = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * (cfg.pas || 16) * 100);
  const zf = (i) => pf.dessus + (cfg.espacement || 10) * 100 * i;
  const dirs = { back: { x: -F.x, y: -F.y }, front: F, '+x': X, '-x': { x: -X.x, y: -X.y } };
  return { pf, F, X, W, machineYaw, rec, lay, columns, merger, stacks, zf, dirs, floors: cfg.etages || 4 };
}

// Caps (relatifs a la machine) et cotes des raccords de colonne, comme les piles de l'utilisateur
const splitterYaw = (col, i) => (odd(i) ? (col.outer > 0 ? 180 : 0) : 90);
const splitterOut = (col, i) => (odd(i) ? 'back' : col.outer > 0 ? '+x' : '-x'); // vers l'etage i + 1
const splitterIn = (col, i) => (odd(i) ? (col.outer > 0 ? '+x' : '-x') : 'back'); // depuis l'etage i - 1
const mergerYaw = (i) => (odd(i) ? 0 : 90);
const mergerOut = (i) => (odd(i) ? '+x' : 'front'); // vers l'etage i - 1 (pied : vers l'avant)
const mergerIn = (i) => (odd(i) ? 'front' : '+x');  // depuis l'etage i + 1

// --- Construction ------------------------------------------------------------------------------------

function report(label, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.disqualifiers && r.disqualifiers.length ? ' disq=' + JSON.stringify(r.disqualifiers) : '') + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '');
  console.log(label.padEnd(30), what + extra);
  if (!DRY && !r.built) throw new Error(label + ' : non construit');
}

// Connecteur libre de `actor` dont la normale (monde) est la plus proche de `dir`, ou connecteur nomme
async function conn(actor, direction, dir) {
  if (typeof dir === 'string') return dir;
  const list = (await call('connections', actor)).filter((c) => c.direction === direction && !c.connected);
  const score = (c) => c.normal.x * dir.x + c.normal.y * dir.y;
  list.sort((a, b) => score(b) - score(a));
  if (!list.length || score(list[0]) < 0.7) throw new Error('aucun connecteur ' + direction + ' libre dans la direction voulue sur ' + short(actor));
  return list[0].name;
}

function makeOps(g, st, save) {
  const d = (k) => (typeof k === 'string' && g.dirs[k] ? g.dirs[k] : k);
  const build = async (store, key, recipe, pos, yaw, opts) => {
    if (st[store][key]) return st[store][key];
    const r = await call('build', recipe, pos, yaw, Object.assign({ dryRun: DRY }, opts || {}));
    report(key, r);
    if (r.built) { st[store][key] = r.actor; save(); }
    return st[store][key];
  };
  const link = async (store, key, recipe, from, fromDir, to, toDir, opts) => {
    if (st[store][key] || !from || !to) return;
    const a = await conn(from, 'output', d(fromDir)), b = await conn(to, 'input', d(toDir));
    const r = await call('belt', recipe, from, a, { path: to, name: b }, Object.assign({ dryRun: DRY }, opts || {}));
    report(key, r);
    if (r.built) { st[store][key] = r.actor; save(); }
  };
  return { build, link };
}

async function belts(g) {
  // convoyeurs / ascenseurs les plus rapides debloques (debit d'une pile entiere au pied)
  const list = await K.belts();
  const best = list[list.length - 1];
  if (!best.lift) throw new Error('aucun ascenseur pour ' + best.belt);
  return best;
}

const PHASES = {
  async plan(cfg, g) {
    const pf = g.pf;
    console.log('plateforme', JSON.stringify({ origine: { x: Math.round(pf.origine.x), y: Math.round(pf.origine.y) }, cap: Math.round(pf.cap * 100) / 100, dessus: pf.dessus, taille: pf.taille, fondations: pf.fondations }));
    console.log('machine', g.lay.buildClass, 'cap', g.machineYaw.toFixed(1), '; recette', g.rec.name, g.rec.inputs.map((i) => i.perMinute + ' ' + i.item).join(' + '), '->', g.rec.outputs.map((o) => o.perMinute + ' ' + o.item).join(' + '));
    console.log('colonnes', JSON.stringify(g.columns), 'fusionneur', JSON.stringify(g.merger));
    console.log(cfg.piles, 'piles x', g.floors, 'etages =', cfg.piles * g.floors, 'machines ; sommet a', ((g.zf(g.floors - 1) + 1100) / 100).toFixed(1), 'm');
    for (const r of g.rec.inputs) console.log('  besoin', (r.perMinute * cfg.piles * g.floors).toFixed(1), r.item, '/ min');
    for (const r of g.rec.outputs) console.log('  production', (r.perMinute * cfg.piles * g.floors).toFixed(1), r.item, '/ min');
  },

  async machines(cfg, g, st, ops) {
    for (const [s, lx] of g.stacks.entries()) for (let i = 0; i < g.floors; i++) {
      await ops.build('machines', 'pile ' + s + ' machine ' + i, R.buildingRecipeOf(g.rec.producer), g.W(lx, 0, g.zf(i)), g.machineYaw, i || cfg.enLAir ? STACKED : {});
    }
  },

  async raccords(cfg, g, st, ops) {
    for (const [s, lx] of g.stacks.entries()) for (let i = 0; i < g.floors; i++) {
      for (const [c, col] of g.columns.entries()) {
        await ops.build('parts', 'pile ' + s + ' entree ' + c + ' etage ' + i, RECIPES.splitter, g.W(lx + col.x, col.y, g.zf(i) + col.z), g.machineYaw + splitterYaw(col, i), AIR);
      }
      if (cfg.sortie === 'directe') continue; // sortie reprise par une autre pile (sa phase directes)
      await ops.build('parts', 'pile ' + s + ' sortie etage ' + i, RECIPES.merger, g.W(lx + g.merger.x, g.merger.y, g.zf(i) + g.merger.z), g.machineYaw + mergerYaw(i), AIR);
    }
  },

  async branches(cfg, g, st, ops) {
    const b = (await belts(g)).belt;
    for (const s of g.stacks.keys()) for (let i = 0; i < g.floors; i++) {
      const m = st.machines['pile ' + s + ' machine ' + i];
      for (const [c, col] of g.columns.entries()) await ops.link('belts', 'pile ' + s + ' entree ' + c + ' etage ' + i + ' > machine', b, st.parts['pile ' + s + ' entree ' + c + ' etage ' + i], 'front', m, col.input);
      if (cfg.sortie !== 'directe') await ops.link('belts', 'pile ' + s + ' machine ' + i + ' > sortie', b, m, 'front', st.parts['pile ' + s + ' sortie etage ' + i], 'back');
    }
  },

  // Liaisons directes d'etage a etage : sortie de la machine de meme pile / meme etage d'une autre pile (cfg.directes :
  // [{ entree, depuis : nom de l'autre pile, sortie }]) -> entree de cette machine. Ex. fabricant de cellules infusees ->
  // fabricant de barres d'uranium (utilisateur, 25/10/2026 : « j'enverrais directement la sortie d'un fabricant
  // cellules vers un fabricant barre U »).
  async directes(cfg, g, st, ops) {
    const b = (await belts(g)).belt;
    for (const d of cfg.directes || []) {
      const src = JSON.parse(fs.readFileSync(path.join(__dirname, d.depuis + '-pile-state.json'), 'utf8'));
      for (const s of g.stacks.keys()) for (let i = 0; i < g.floors; i++) {
        await ops.link('belts', 'directe ' + d.entree + ' pile ' + s + ' etage ' + i, b, src.machines['pile ' + s + ' machine ' + i], d.sortie || 'Output0', st.machines['pile ' + s + ' machine ' + i], d.entree);
      }
    }
  },

  async ascenseurs(cfg, g, st, ops) {
    const lift = (await belts(g)).lift;
    const opts = { snapTolerance: 400 };
    for (const s of g.stacks.keys()) for (let i = 0; i + 1 < g.floors; i++) {
      for (const [c, col] of g.columns.entries()) {
        const p = (k) => st.parts['pile ' + s + ' entree ' + c + ' etage ' + k];
        await ops.link('lifts', 'pile ' + s + ' entree ' + c + ' ' + i + '>' + (i + 1), lift, p(i), splitterOut(col, i), p(i + 1), splitterIn(col, i + 1), opts);
      }
      if (cfg.sortie === 'directe') continue;
      const m = (k) => st.parts['pile ' + s + ' sortie etage ' + k];
      await ops.link('lifts', 'pile ' + s + ' sortie ' + (i + 1) + '>' + i, lift, m(i + 1), mergerOut(i + 1), m(i), mergerIn(i), opts);
    }
  },

  async arrivees(cfg, g, st, ops) {
    const b = (await belts(g)).belt;
    for (const [f, feed] of (cfg.arrivees || []).entries()) {
      const c = g.columns.findIndex((col) => col.input === feed.entree);
      if (c < 0) throw new Error('arrivee ' + f + ' : entree inconnue ' + feed.entree);
      const col = g.columns[c];
      const flow = feed.sens === '-lx' ? '-x' : '+x', up = flow === '+x' ? '-x' : '+x';
      const order = [...g.stacks.keys()]; if (flow === '-x') order.reverse();
      const yaw = g.machineYaw + (flow === '+x' ? 0 : 180); // entree (-X local) vers l'amont
      // mode ascenseur (machines a 3 ou 4 entrees) : ligne 4 m derriere le repartiteur du pied, sous la plateforme
      // (hauteur < 0) ou entre le pied et le premier etage (hauteur > 0) ; repartiteur de ligne -> ascenseur face a face
      // -> entree arriere du repartiteur du pied. Deux lignes au plus par rang (meme ly), l'une dessous, l'autre dessus :
      // aucun ascenseur ne croise l'autre ligne.
      const lift = feed.mode === 'ascenseur';
      const ly = col.y - (lift ? DESIGN.FEED_LIFT_BACK : DESIGN.FEED_BACK), z = g.pf.dessus + feed.hauteur * 100;
      const liftRecipe = lift ? (await belts(g)).lift : null;
      let prev = null;
      for (const s of order) {
        const sp = await ops.build('parts', 'arrivee ' + f + ' pile ' + s, RECIPES.splitter, g.W(g.stacks[s] + col.x, ly, z), yaw, AIR);
        if (lift) await ops.link('lifts', 'arrivee ' + f + ' pile ' + s + ' > pied', liftRecipe, sp, 'front', st.parts['pile ' + s + ' entree ' + c + ' etage 0'], 'back', { snapTolerance: 400 });
        else await ops.link('belts', 'arrivee ' + f + ' pile ' + s + ' > pied', b, sp, 'front', st.parts['pile ' + s + ' entree ' + c + ' etage 0'], 'back');
        if (prev) await ops.link('belts', 'arrivee ' + f + ' ' + prev.s + '>' + s, b, prev.sp, flow, sp, up);
        prev = { s, sp };
      }
    }
  },

  async collecteur(cfg, g, st, ops) {
    if (cfg.sortie === 'directe') return;
    const b = (await belts(g)).belt;
    const flow = (cfg.collecteur && cfg.collecteur.sens) === '-lx' ? '-x' : '+x', up = flow === '+x' ? '-x' : '+x';
    const order = [...g.stacks.keys()]; if (flow === '-x') order.reverse();
    const yaw = g.machineYaw + (flow === '+x' ? 0 : 180); // sortie (+X local) dans le sens du flux
    const ly = g.merger.y + DESIGN.COLLECTOR_FRONT;
    let prev = null;
    for (const s of order) {
      const mg = await ops.build('parts', 'collecteur pile ' + s, RECIPES.merger, g.W(g.stacks[s] + g.merger.x, ly, g.pf.dessus + g.merger.z), yaw, AIR);
      await ops.link('belts', 'pied ' + s + ' > collecteur', b, st.parts['pile ' + s + ' sortie etage 0'], 'front', mg, 'back');
      if (prev) await ops.link('belts', 'collecteur ' + prev.s + '>' + s, b, prev.mg, flow, mg, up);
      prev = { s, mg };
    }
  },

  async courant(cfg, g, st, ops, save) {
    const available = await call('recipes', null);
    const recipe = RECIPES.poles.find((x) => available.indexOf(x) >= 0);
    if (!recipe) throw new Error('aucun poteau electrique debloque');
    const spots = cfg.poteaux ? cfg.poteaux.map(([lx, ly]) => [lx * 100, ly * 100]) : g.stacks.map((lx) => [lx, g.merger.y + DESIGN.COLLECTOR_FRONT + DESIGN.POLE_FRONT]);
    const poles = [];
    for (const [k, [lx, ly]] of spots.entries()) poles.push(await ops.build('poles', 'poteau ' + k, recipe, g.W(lx, ly, g.pf.dessus), g.machineYaw, cfg.enLAir ? AIR : {}));
    if (poles.some((p) => !p)) return;
    // pile k sur le poteau k (modulo le nombre de poteaux) ; poteaux chaines, le premier relie au reseau. Au moins deux
    // poteaux par pile (pp) : les etages de la pile s se partagent les poteaux s, s + piles, s + 2 x piles... par tranches
    // (piles de 10 fonderies du module alu, 25/10/2026 : 10 machines + chaine + reseau depassaient les 10 connexions
    // d'un poteau Mk3)
    const plan = [];
    if (cfg.reseau) plan.push([poles[0], cfg.reseau]);
    for (let k = 1; k < poles.length; k++) plan.push([poles[k], poles[k - 1]]);
    const ns = g.stacks.length, pp = Math.floor(poles.length / ns);
    for (const s of g.stacks.keys()) {
      for (let i = 0; i < g.floors; i++) {
        const k = pp >= 2 ? s + ns * Math.floor((i * pp) / g.floors) : s % poles.length;
        plan.push([poles[k], st.machines['pile ' + s + ' machine ' + i]]);
      }
    }
    const counts = new Map();
    for (const [a, b] of plan) for (const p of [a, b]) if (poles.includes(p)) counts.set(p, (counts.get(p) || 0) + 1);
    for (const [p, n] of counts) {
      const info = await call('power', p);
      if (n > info.maxWires) throw new Error(short(p) + ' : ' + n + ' cables pour ' + info.maxWires + ' connexions (ajouter des poteaux)');
    }
    for (const [a, b] of plan) {
      const key = short(a) + '>' + short(b);
      if (st.wires[key]) continue;
      const r = await call('wire', a, b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor; save(); }
    }
  },

  async recettes(cfg, g, st) {
    for (const m of Object.values(st.machines)) { const r = await call('setRecipe', m, cfg.recette); console.log(short(m), r.recipe, 'courant', r.power && r.power.hasPower); }
  },

  async verifie(cfg, g, st) {
    const problems = [];
    for (const [key, b] of [...Object.entries(st.belts), ...Object.entries(st.lifts)]) {
      const free = (await call('connections', b)).filter((c) => !c.connected).map((c) => c.name);
      if (free.length) problems.push(key + ' : bout libre ' + free.join(' '));
    }
    for (const [key, m] of Object.entries(st.machines)) {
      const ms = await call('machine', m);
      const free = (await call('connections', m)).filter((c) => !c.connected).map((c) => c.name);
      if (ms.recipe !== cfg.recette) problems.push(key + ' : recette ' + ms.recipe);
      if (!ms.power.hasPower) problems.push(key + ' : sans courant');
      if (free.length) problems.push(key + ' : libres ' + free.join(' '));
    }
    console.log(Object.keys(st.machines).length + ' machines, ' + Object.keys(st.belts).length + ' convoyeurs, ' + Object.keys(st.lifts).length + ' ascenseurs');
    console.log(problems.length ? 'PROBLEMES :\n  ' + problems.join('\n  ') : 'tout est raccorde');
    // Raccords a faire par l'appelant : tete de chaque ligne d'arrivee, bout du collecteur
    for (const [f, feed] of (cfg.arrivees || []).entries()) {
      const order = [...g.stacks.keys()]; if (feed.sens === '-lx') order.reverse();
      const head = st.parts['arrivee ' + f + ' pile ' + order[0]];
      if (head) { const c = (await call('connections', head)).find((k) => k.name === 'Input1'); console.log('tete arrivee ' + f + ' (' + feed.entree + ') :', head + '.Input1', c && c.connected ? 'branchee' : 'libre'); }
    }
    const corder = [...g.stacks.keys()]; if (cfg.collecteur && cfg.collecteur.sens === '-lx') corder.reverse();
    const last = st.parts['collecteur pile ' + corder[corder.length - 1]];
    if (last) { const c = (await call('connections', last)).find((k) => k.name === 'Output1'); console.log('sortie de l\'atelier :', last + '.Output1', c && c.connected ? 'branchee' : 'libre'); }
  },

  async tout(cfg, g, st, ops, save) {
    for (const p of ['machines', 'raccords', 'branches', 'directes', 'ascenseurs', 'arrivees', 'collecteur', 'courant']) { console.log('--- ' + p); await PHASES[p](cfg, g, st, ops, save); }
    if (DRY) return;
    console.log('--- recettes'); await PHASES.recettes(cfg, g, st);
    console.log('--- verifie'); await PHASES.verifie(cfg, g, st);
  },

  // Demonte tout ce que l'etat reference (convoyeurs et ascenseurs d'abord ; les cables partent avec les poteaux)
  async demonte(cfg, g, st, ops, save) {
    for (const store of ['belts', 'lifts', 'parts', 'machines', 'poles']) {
      for (const [key, p] of Object.entries(st[store])) {
        try { await call('dismantle', p, false); } catch (e) { if (!/introuvable/.test(e.message)) { console.log('ECHEC', key, e.message.slice(0, 120)); continue; } }
        delete st[store][key];
      }
      save();
    }
    st.wires = {};
    save();
    console.log('demonte');
  },
};

module.exports = { findPlatform, geometry, PHASES, DESIGN };

if (require.main === module) {
  const phase = process.argv[2];
  const cfgFile = arg('config');
  if (!PHASES[phase] || !cfgFile) {
    console.error('usage : node pile.js <' + Object.keys(PHASES).join('|') + '> --config <fichier.json> [--dry]');
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const file = path.join(__dirname, cfg.nom + '-pile-state.json');
  const st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const k of ['machines', 'parts', 'belts', 'lifts', 'poles', 'wires']) st[k] = st[k] || {};
  const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 1) + '\n');
  (async () => {
    const g = await geometry(cfg, st);
    save();
    await PHASES[phase](cfg, g, st, makeOps(g, st, save), save);
    save();
  })().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
}
