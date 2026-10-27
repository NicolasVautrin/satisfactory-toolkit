// Atelier de dissipateurs au-dessus du module 1 (utilisateur, 25/10/2026 : « on dedie le module 1 aux dissipateurs »,
// « go pour le plan de l'atelier », plan valide par « go ») : 480 dissipateurs/min (plan global : 469).
// Une unite par groupe c du module 1 (centre x_c = -41 000 - 8 400 c), a +64 m, au nord de ses piles de fonderies :
//  - A : toles d'aluminium plaque, 2 piles de 10 assembleuses (axe y -279 000) : 600 lingots d'alu (sortie du collecteur
//    des fonderies, 20 m au sud) + 200 lingots de cuivre -> 600 toles ;
//  - H : dissipateurs, 2 piles de 8 assembleuses (axe y -285 000) : 600 toles plaquees + 360 toles de cuivre -> 120.
//  Piles a x_c + 24 m et x_c + 40 m ; entrees au sud, sorties au nord (pile.js, dos y : +lx = ouest).
//  Arrivees (15 m derriere les pieds) : A, alu a +67 m vers l'est, cuivre a +71 m vers l'ouest ; H, toles plaquees a +67 m
//  et toles de cuivre a +71 m, vers l'ouest. Collecteurs vers l'est ; celui de A rejoint l'arrivee de H par un relais.
// Cuivre du bloc cuivre 1 (sorties au bout ouest de ses rangees, x -33 100) : chaque paire de sorties superposees (+1 et
// +33 m) est reunie par deux ascenseurs (montage U / V / W du module 1) puis montee a +71 m :
//  - lingots (810/min) : colonnes sur les lignes nord des bandes (x -33 600), jonction J, une ligne qui passe par les
//    arrivees de cuivre des 4 unites A (relais entre unites) ;
//  - toles (1 440/min, deux convoyeurs) : colonnes a x -35 000 (a l'ouest des tetes de minerai) ; bande 2 -> H0 et H1 a
//    +71 m ; bande 1 -> H2 et H3 par une ligne a +75 m, au-dessus des arrivees de H0 et H1.
// Dissipateurs : collecteurs de H relies d'ouest en est ; sortie a l'est de H0, libre pour la future gare de chargement.
// usage : node atelier-dissipateurs.js piles [etapes pile.js] | liaisons | cuivre | verifie [--dry]
// Etat : atelier-dissipateurs-state.json ; piles : atelier-dissip-A<c> / -H<c>-pile-state.json (non versionnes).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C',
};
const C = [0, 1, 2, 3];
const XC = (c) => -41000 - 8400 * c;
const TOP = 6400;
const YA = -279000, YH = -285000;
const Y_ARR_A = -276400, Y_ARR_H = -282400, Y_COLL_H = -286700; // arrivees de A / H, collecteur de H (pile.js)
const Z_LOW = TOP + 300, Z_HIGH = TOP + 700, Z_OVER = TOP + 1100, Z_COLL = TOP + 100;
const MODULE = (c) => path.join(__dirname, 'module-alu1-G' + c + '-pile-state.json');
const CUIVRE = path.join(__dirname, 'module-cuivre1-state.json');
const BANDES = { 1: -273000, 2: -279400 };

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'atelier-dissipateurs-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
const pileState = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'atelier-dissip-' + n + '-pile-state.json'), 'utf8'));

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '') + (r.snapped ? ' accroches=' + JSON.stringify(r.snapped) : '');
  console.log(key.padEnd(36), what + extra);
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
// Connecteur libre de `actor` (input / output) dont la normale est la plus proche de `dir` ({x, y}), ou nom donne
async function conn(actor, direction, dir) {
  if (typeof dir === 'string') return dir;
  const list = (await call('connections', actor)).filter((c) => c.direction === direction && !c.connected);
  const score = (c) => c.normal.x * dir.x + c.normal.y * dir.y;
  list.sort((a, b) => score(b) - score(a));
  if (!list.length || score(list[0]) < 0.7) throw new Error('aucun connecteur ' + direction + ' libre vers ' + JSON.stringify(dir) + ' sur ' + short(actor));
  return list[0].name;
}
const SOFT = ['FGCDEncroachingSoftClearance'];
async function link(key, recipe, from, fromDir, to, toDir, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { if (!DRY) console.log(key.padEnd(36), 'saute (bout absent)'); return null; }
  const a = await conn(from, 'output', fromDir), b = await conn(to, 'input', toDir);
  let r = await call('belt', recipe, from, a, { path: to, name: b }, Object.assign({ dryRun: DRY }, opts || {}));
  // degagement souple seul en cause (colonne des toles de la bande 1 : relais H1 / H2 de la bauxite du module 1 a 5 m) :
  // accepte apres un essai a blanc sans lui (references/convoyeurs.md)
  if (!r.built && r.blocking && r.blocking.length === 1 && r.blocking[0] === SOFT[0]) {
    const t = await call('belt', recipe, from, a, { path: to, name: b }, Object.assign({}, opts || {}, { dryRun: true, ignore: SOFT }));
    if (!(t.blocking && t.blocking.length)) {
      console.log(key.padEnd(36), 'degagement souple seul en cause, accepte');
      r = DRY ? t : await call('belt', recipe, from, a, { path: to, name: b }, Object.assign({}, opts || {}, { ignore: SOFT }));
    }
  }
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
const E = { x: 1, y: 0 }, W = { x: -1, y: 0 }, N = { x: 0, y: -1 }, S = { x: 0, y: 1 };

// Colonne de deux sorties superposees (montage U / V / W du module 1) : bas (cap 180, entree a l'est) -> ascenseur ->
// haut (cap -90 : entree a l'ouest depuis le bas, a l'est depuis la sortie du haut ; sortie au nord) -> ascenseur ->
// sommet (cap 180 : entree au nord, sortie a l'ouest)
async function colonne(nom, x, y, zTop, basOut, hautOut) {
  const U = await build(nom + ' bas', REC.merger, { x, y, z: 100 }, 180);
  const V = await build(nom + ' haut', REC.merger, { x, y, z: 3300 }, -90);
  const Wt = await build(nom + ' sommet', REC.merger, { x, y, z: zTop }, 180);
  await link(nom + ' sortie bas', REC.belt, basOut, W, U, E);
  await link(nom + ' sortie haut', REC.belt, hautOut, W, V, E);
  await link(nom + ' montee 1', REC.lift, U, W, V, W, { snapTolerance: 400 });
  await link(nom + ' montee 2', REC.lift, V, N, Wt, N, { snapTolerance: 400 });
  return Wt;
}

const PHASES = {
  // Piles A puis H de chaque unite (pile.js) ; reseau : poteau 2 de la pile de fonderies du groupe, puis poteau 3 de A
  async piles() {
    const { execFileSync } = require('child_process');
    const steps = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'machines,raccords,branches,ascenseurs,arrivees,collecteur,recettes,courant').split(',');
    for (const c of C) for (const t of ['A', 'H']) {
      const nom = 'atelier-dissip-' + t + c, file = path.join(__dirname, nom + '-config-state.json');
      const reseau = t === 'A' ? JSON.parse(fs.readFileSync(MODULE(c), 'utf8')).poles['poteau 2']
        : (fs.existsSync(path.join(__dirname, 'atelier-dissip-A' + c + '-pile-state.json')) ? pileState('A' + c).poles['poteau 3'] : undefined);
      const cfg = t === 'A' ? {
        nom, recette: 'Recipe_AluminumSheet_C', plateforme: { origine: { x: XC(c) + 3200, y: YA }, cap: 0, dessus: TOP },
        dos: 'y', centre: [0, 0], piles: 2, etages: 10, pas: 16, espacement: 10, enLAir: true,
        arrivees: [{ entree: 'Input0', hauteur: 3, sens: '-lx' }, { entree: 'Input1', hauteur: 7, sens: '+lx' }],
        collecteur: { sens: '-lx' }, reseau,
        // poteaux a l'ouest de la sortie du collecteur (le relais des toles plaquees passe a l'est)
        poteaux: [[12, 20], [4, 20], [-4, 20], [4, 24]],
      } : {
        nom, recette: 'Recipe_HeatSink_C', plateforme: { origine: { x: XC(c) + 3200, y: YH }, cap: 0, dessus: TOP },
        dos: 'y', centre: [0, 0], piles: 2, etages: 8, pas: 16, espacement: 10, enLAir: true,
        arrivees: [{ entree: 'Input0', hauteur: 3, sens: '+lx' }, { entree: 'Input1', hauteur: 7, sens: '+lx' }],
        collecteur: { sens: '-lx' }, reseau,
        poteaux: [[-8, 20], [8, 20], [-8, 24], [8, 24]],
      };
      fs.writeFileSync(file, JSON.stringify(cfg, null, 1));
      for (const s of steps) {
        const out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
        const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
        console.log((t + c + ' ' + s).padEnd(36), bad.length ? bad.slice(0, 3).join(' / ') : 'ok');
      }
    }
  },

  // Liaisons entre unites et avec les fonderies
  async liaisons() {
    for (const c of C) {
      const A = pileState('A' + c).parts, H = pileState('H' + c).parts, G = JSON.parse(fs.readFileSync(MODULE(c), 'utf8')).parts;
      // alu : sortie du collecteur des fonderies (a l'est) -> tete de l'arrivee d'alu de A (pile ouest, flux vers l'est)
      await link('alu ' + c, REC.belt, G['collecteur pile 0'], E, A['arrivee 0 pile 1'], W);
      // toles plaquees : sortie du collecteur de A (a l'est) -> relais -> tete de l'arrivee de H (pile est, flux vers l'ouest)
      const R = await build('relais toles plaquees ' + c, REC.merger, { x: XC(c) + 4800, y: -281550, z: Z_COLL }, -90);
      await link('toles plaquees ' + c + ' a', REC.belt, A['collecteur pile 0'], E, R, W);
      await link('toles plaquees ' + c + ' b', REC.belt, R, N, H['arrivee 0 pile 0'], E);
    }
    for (const c of C.slice(0, 3)) {
      const A = pileState('A' + c).parts, A2 = pileState('A' + (c + 1)).parts;
      const H = pileState('H' + c).parts, H2 = pileState('H' + (c + 1)).parts;
      // lingots de cuivre : queue de l'arrivee de A c -> relais -> tete de A c+1
      const Rc = await build('relais lingots ' + c, REC.merger, { x: XC(c) - 800, y: Y_ARR_A, z: Z_HIGH }, 180);
      await link('lingots ' + c + ' > relais', REC.belt, A['arrivee 1 pile 1'], W, Rc, E);
      await link('lingots relais > ' + (c + 1), REC.belt, Rc, W, A2['arrivee 1 pile 0'], E);
      // dissipateurs : sortie du collecteur de H c+1 -> relais -> tete du collecteur de H c (vers l'est)
      const Rh = await build('relais dissipateurs ' + c, REC.merger, { x: XC(c) - 1000, y: Y_COLL_H, z: Z_COLL }, 0);
      await link('dissipateurs ' + (c + 1) + ' > relais', REC.belt, H2['collecteur pile 0'], E, Rh, W);
      await link('dissipateurs relais > ' + c, REC.belt, Rh, E, H['collecteur pile 1'], W);
      // toles de cuivre : H0 -> H1 et H2 -> H3 (queue -> relais -> tete)
      if (c === 0 || c === 2) {
        const Rt = await build('relais toles ' + c, REC.merger, { x: XC(c) - 800, y: Y_ARR_H, z: Z_HIGH }, 180);
        await link('toles ' + c + ' > relais', REC.belt, H['arrivee 1 pile 1'], W, Rt, E);
        await link('toles relais > ' + (c + 1), REC.belt, Rt, W, H2['arrivee 1 pile 0'], E);
      }
    }
  },

  // Cuivre : colonnes aux sorties du bloc cuivre, lignes jusqu'aux unites
  async cuivre() {
    const cu = JSON.parse(fs.readFileSync(CUIVRE, 'utf8')).actors;
    const A0 = pileState('A0').parts, H0 = pileState('H0').parts, H2 = pileState('H2').parts;
    // lingots : colonnes sur les lignes nord (x -33 600), jonction J, tete de l'arrivee de cuivre de A0
    const L1 = await colonne('lingots b1', -33600, BANDES[1] - 1400, Z_HIGH, cu['b1 bas lingots 0'], cu['b1 haut lingots 0']);
    const L2 = await colonne('lingots b2', -33600, BANDES[2] - 1400, Z_HIGH, cu['b2 bas lingots 0'], cu['b2 haut lingots 0']);
    const J = await build('jonction lingots', REC.merger, { x: -35000, y: Y_ARR_A, z: Z_HIGH }, 180);
    await link('lingots b1 > J', REC.belt, L1, W, J, S);
    await link('lingots b2 > J', REC.belt, L2, W, J, N);
    await link('J > A0', REC.belt, J, W, A0['arrivee 1 pile 0'], E);
    // toles : colonnes a x -35 000 sur les lignes sud ; bande 2 -> H0 (+71 m) ; bande 1 -> H2 par une ligne a +75 m
    const T2 = await colonne('toles b2', -35000, BANDES[2] + 1400, Z_HIGH, cu['b2 bas toles 0'], cu['b2 haut toles 0']);
    await link('toles b2 > H0', REC.belt, T2, W, H0['arrivee 1 pile 0'], E);
    const T1 = await colonne('toles b1', -35000, BANDES[1] + 1400, Z_OVER, cu['b1 bas toles 0'], cu['b1 haut toles 0']);
    const relais = [['Sb1', -36000, -273000, -90], ['Sb2', -36000, -277500, -90], ['Sb3', -36000, Y_ARR_H, 180],
      ['Sb4', -40800, Y_ARR_H, 180], ['Sb5', -45600, Y_ARR_H, 180], ['Sb6', -50400, Y_ARR_H, 180]];
    const Rb = [];
    for (const [n, x, y, yaw] of relais) Rb.push(await build('toles b1 ' + n, REC.merger, { x, y, z: Z_OVER }, yaw));
    await link('toles b1 > Sb1', REC.belt, T1, W, Rb[0], E);
    await link('Sb1 > Sb2', REC.belt, Rb[0], N, Rb[1], S);
    await link('Sb2 > Sb3', REC.belt, Rb[1], N, Rb[2], S);
    for (let i = 3; i < Rb.length; i++) await link('Sb' + i + ' > Sb' + (i + 1), REC.belt, Rb[i - 1], W, Rb[i], E);
    await link('Sb6 > H2', REC.belt, Rb[Rb.length - 1], W, H2['arrivee 1 pile 0'], E);
  },

  async verifie() {
    for (const c of C) for (const t of ['A', 'H']) {
      const p = pileState(t + c);
      console.log(t + c, Object.keys(p.machines).length, 'machines,', Object.keys(p.poles || {}).length, 'poteaux');
    }
    for (const [key, a] of Object.entries(st.actors)) {
      const free = (await call('connections', a)).filter((k) => !k.connected).map((k) => k.name);
      if (free.length) console.log(key.padEnd(36), 'libres :', free.join(' '));
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node atelier-dissipateurs.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
