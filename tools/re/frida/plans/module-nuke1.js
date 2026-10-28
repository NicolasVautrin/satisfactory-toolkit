// Module nucleaire 1 (utilisateur, 28/10/2026 : « je commencerais bien le 1er module apres la bande 4 », « le plan comme
// il est me va bien », « garde ton layout ») : plan scratchpad plan-module1.html. Au nord de la bande 4, en mer, sans
// fondations. Champ de 29 centrales (recette de l'optimiseur, 248,3 %) en 4 rangees E-O de 8, 8, 8 et 5 :
//  - R1 (cap 180, connecteurs au nord) et R2 (cap 0, au sud) face a face sur le couloir C12 ; R3 (cap 180) dos a R2
//    (6 m) et R4 (cap 0, 5 centrales a l'est) sur le couloir C34 ; couloirs de 30 m ; pas de 40 m en x ; rien au-dessus.
//  - Connecteurs d'une centrale (lus en jeu) : sur le petit cote de 36 m, a 20 m du centre ; barres (Input0) et dechets
//    (Output0) a +1 m, 4 m l'un de l'autre ; eau a +5,75 m entre les deux.
//  - Eau, un reseau par centrale (600 m3/min pour 596) : 4 extracteurs dessous en 2 x 2 (colonne ouest cap 90, est cap
//    -90 : sorties face a face de part et d'autre de l'axe, a -15 m) ; jonctions sur l'axe sous la centrale (arriere
//    puis avant). Devant la face, montage de l'utilisateur (cellule R1 7 refaite a la main le 28/10/2026 : « regarde ce
//    que j'ai fait, c'est pas mieux comme ca ? ») : 5e extracteur colle devant la centrale, dans l'alignement de la
//    colonne ouest (R1 / R3) ou est (R2 / R4) et tourne comme elle ; jonction DEBOUT (cap -90, roulis -90 : Connection0
//    au sud, 1 au nord, 2 vers le haut) 5 m devant la face, qui recoit la jonction avant et le 5e ; montee verticale
//    (pompe Mk2 basse) jusqu'a l'entree d'eau, de face.
// usage : node module-nuke1.js <phase> [--dry]
//   champ : essai (cellule R1 7) | cellule <rangee> <k> | champ [R1,R2,...]
//   bloc : bloc | courantBloc | eauMelangeurs (tampon sureleve) | tamponSudDemonte | melangeur16
//   piles : pilesU [etapes] | pilesPu [etapes] | reglagesPu
//   arbres equilibres : dechets [collecte] | dechetsArbre [pieces,liens] | dechetsCellules [A0,..,B3] | uranium |
//     arriveeUranium | granules | cellulesPu | broyeur | nonFissile | barres
//   apres un incident : regule-cellules.js (rapport 4 pour 1 des accelerateurs) ; veille : veille-dechets.js
//   arrivees : chainage | filactif | oscillateurs | barresEM | barresEMPu | soufre | silice | siliceMelangeurs | poutres |
//     dissipateurs | beton | nitrique | sulfurique | rotors
// Etat : module1-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const SOFT = 'FGCDEncroachingSoftClearance';
const REC = {
  plant: 'Recipe_GeneratorNuclear_C', extractor: 'Recipe_WaterPump_C', junction: 'Recipe_PipelineJunction_Cross_C',
  pipe: 'Recipe_PipelineMK2_C', pump2: 'Recipe_PipelinePumpMk2_C', tank: 'Recipe_IndustrialTank_C',
  valve: 'Recipe_Valve_C',
};
const WATER = (x) => PREFIX + (x < -110000 ? 'FGWaterVolume105' : 'FGWaterVolume_7');
const ZJ = -1490; // jonctions basses, a la hauteur des sorties des extracteurs
// rangees : axe y, cap, sens de la face (f = -1 : nord, +1 : sud), colonnes, moitie du couloir pour le 5e extracteur
// pas de 44,5 m : deux extracteurs DOS A DOS (colonne est d'une cellule, colonne ouest de la voisine) demandent 8 m entre
// leurs boites (encombrement sur le dos, absent de clearanceData.json : 7,5 m refuse, 8 m accepte a blanc le 28/10/2026) ;
// face a face (sorties vers l'axe, dans une cellule), ils se touchent. Colonne k = 7 a x -98 000 (cellules R1 7 / R2 7).
const PAS = 4450;
const XK = (k) => -98000 - PAS * (7 - k);
// compacte nord-sud (utilisateur : « tu pourrais compacter dans l'axe nord sud », « essaie de coller la pompe que j'ai
// selectionnee aux pompes de la centrale d'en face ») : couloirs de 18,15 m (le 5e extracteur d'une rangee s'avance de
// 19,08 m, 5 cm avant les extracteurs avant d'en face, qui sont 1 m sous leur centrale), R2 / R3 dos a dos a 2 m
const ROWS = {
  R1: { y: -246500, yaw: 180, f: -1, ks: [0, 1, 2, 3, 4, 5, 6, 7], s: -1 },
  R2: { y: -252515, yaw: 0, f: 1, ks: [0, 1, 2, 3, 4, 5, 6, 7], s: 1 },
  R3: { y: -256915, yaw: 180, f: -1, ks: [0, 1, 2, 3, 4, 5, 6, 7], s: -1 },
  R4: { y: -262930, yaw: 0, f: 1, ks: [3, 4, 5, 6, 7], s: 1 },
};

const FILE = path.join(__dirname, 'module1-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
// cles de la cellule d'essai, posee avant ce script (points cardinaux -> avant / arriere)
for (const [a, b] of [['e NO', 'e avant O'], ['e NE', 'e avant E'], ['e SO', 'e arriere O'], ['e SE', 'e arriere E']]) {
  if (st.actors['R1 7 ' + a] && !st.actors['R1 7 ' + b]) { st.actors['R1 7 ' + b] = st.actors['R1 7 ' + a]; delete st.actors['R1 7 ' + a]; }
}
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(34), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw, opts) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, opts || AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function extracteur(key, x, y, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('buildAim', REC.extractor, { x, y, z: 1000 }, { x, y, z: -1815 }, { dryRun: DRY, onActor: WATER(x), scrollRotation: yaw });
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(34), 'a construire'); return null; }
  let r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  if (!r.built && r.blocking && r.blocking.length === 1 && r.blocking[0] === SOFT) {
    const o = Object.assign({}, opts || {}, { ignore: [SOFT] });
    const t = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({}, o, { dryRun: true }));
    if (!(t.blocking && t.blocking.length)) { console.log(key.padEnd(34), 'degagement souple seul en cause, accepte'); r = DRY ? t : await call('belt', recipe, from, fromName, { path: to, name: toName }, o); }
  }
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
// pompe Mk2 (ou autre piece de tuyau : vanne) sur un tuyau, au premier point accepte entre zmin et zmax (barres-em.js)
async function pompe(key, pipe, zmin, zmax, recipe = REC.pump2) {
  if (st.actors[key]) return;
  if (!pipe) { console.log(key.padEnd(34), 'a construire'); return; }
  const pose = await call('pose', pipe);
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData;
  const yaw = pose.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = pose.location;
  const w = pts.map((p) => ({ x: o.x + p.Location.X * c - p.Location.Y * s, y: o.y + p.Location.X * s + p.Location.Y * c, z: o.z + p.Location.Z }));
  const cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax)) {
    const aim = [{ x: p.x, y: p.y + 300, z: p.z + 300 }, p];
    const t = await call('buildAim', recipe, aim[0], aim[1], { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    const r = DRY ? t : await call('buildAim', recipe, aim[0], aim[1], { onActor: pipe });
    console.log(key.padEnd(34), 'a', (p.z / 100).toFixed(1), 'm');
    report(key, r);
    if (r.built) { st.actors[key] = r.actor; save(); }
    return;
  }
  throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
}

// Cellule d'une centrale : extracteurs, centrale, jonctions, tuyaux, pompe
async function cellule(r, k) {
  const R = ROWS[r], x = XK(k), y = R.y, f = R.f, s = R.s, p = r + ' ' + k + ' ';
  await extracteur(p + 'e avant O', x - 900, y + 1000 * f, 90);
  await extracteur(p + 'e arriere O', x - 900, y - 1000 * f, 90);
  await extracteur(p + 'e avant E', x + 900, y + 1000 * f, -90);
  await extracteur(p + 'e arriere E', x + 900, y - 1000 * f, -90);
  // 5e de R2 / R4 a 9,30 m de l'axe : celui de la cellule R1 7 (pose a la main) est a 8,76 m, 6 cm d'ecart
  await extracteur(p + 'e couloir', x + (s < 0 ? -900 : 930), y + 3000 * f, s < 0 ? 90 : -90);
  const C = await build(p + 'centrale', REC.plant, { x, y, z: 0 }, R.yaw);
  // jonctions a la hauteur reelle des sorties : la surface du volume d'eau de l'ouest (x < -110 000) est a -18,15 m,
  // celle de l'est a -17,30 m (cellule R1 4 : tuyau refuse, FGCDPipeInvalidShape, avec 85 cm d'ecart)
  const ea = st.actors[p + 'e arriere O'];
  const zj = ea ? Math.round((await call('connections', ea))[0].location.z) : ZJ;
  const JA = await build(p + 'j arriere', REC.junction, { x, y: y - 1000 * f, z: zj }, 0);
  const JV = await build(p + 'j avant', REC.junction, { x, y: y + 1000 * f, z: zj }, 0);
  const JC = await build(p + 'j couloir', REC.junction, { x: x + 186 * s, y: y + 2678 * f, z: zj }, -90, Object.assign({ roll: -90 }, AIR));
  // ports des jonctions a plat (cap 0) : Connection0 ouest, 1 est, 2 sud (+y), 3 nord (-y) ; jonction debout (cap -90,
  // roulis -90) : 0 sud, 1 nord, 2 haut
  const VERS_AVANT = f < 0 ? 'Connection3' : 'Connection2', VERS_ARRIERE = f < 0 ? 'Connection2' : 'Connection3';
  const DEBOUT_ARRIERE = f < 0 ? 'Connection0' : 'Connection1', DEBOUT_AVANT = f < 0 ? 'Connection1' : 'Connection0';
  const E = (n) => st.actors[p + 'e ' + n];
  await link(p + 'arriere O > J', REC.pipe, E('arriere O'), 'FGPipeConnectionFactory', JA, 'Connection0');
  await link(p + 'arriere E > J', REC.pipe, E('arriere E'), 'FGPipeConnectionFactory', JA, 'Connection1');
  await link(p + 'avant O > J', REC.pipe, E('avant O'), 'FGPipeConnectionFactory', JV, 'Connection0');
  await link(p + 'avant E > J', REC.pipe, E('avant E'), 'FGPipeConnectionFactory', JV, 'Connection1');
  await link(p + 'J arriere > J avant', REC.pipe, JA, VERS_AVANT, JV, VERS_ARRIERE);
  await link(p + 'J avant > J couloir', REC.pipe, JV, VERS_AVANT, JC, DEBOUT_ARRIERE);
  await link(p + 'couloir > J couloir', REC.pipe, E('couloir'), 'FGPipeConnectionFactory', JC, DEBOUT_AVANT);
  await link(p + 'montee', REC.pipe, JC, 'Connection2', C, 'FGPipeConnectionFactory');
  await pompe(p + 'pompe', st.links[p + 'montee'], -1600, -900);
}

// Courant d'une cellule : poteau Mk3 au milieu de l'intervalle a l'est de la centrale (8,5 m ; 4 m pour la colonne 7) (rien au-dessus d'elle), cables
// vers la centrale (qui livre sa production), les 5 extracteurs et la pompe ; raccord au poteau de cellule le plus proche
// (100 m au plus), sinon au poteau alimente du reseau le plus proche qui a une place
async function courant(r, k) {
  const R = ROWS[r], p = r + ' ' + k + ' ';
  const P = await build(p + 'poteau', 'Recipe_PowerPoleMk3_C', { x: XK(k) + (k === 7 ? 2000 : PAS / 2), y: R.y, z: 0 }, 0);
  if (DRY || !P) return;
  for (const n of ['centrale', 'e avant O', 'e avant E', 'e arriere O', 'e arriere E', 'e couloir', 'pompe']) {
    if (st.wires[p + n] || !st.actors[p + n]) continue;
    // deja cablee (piece posee ou recablee a la main, cellule R1 7) : rien a faire
    if ((await call('power', st.actors[p + n])).wires > 0) { st.wires[p + n] = true; save(); continue; }
    const w = await call('wire', P, st.actors[p + n], {});
    if (!w.built) throw new Error(p + n + ' : cable refuse ' + JSON.stringify(w.blocking));
    st.wires[p + n] = w.actor || true; save();
  }
  if (st.wires[p + 'reseau']) return;
  const at = (await call('pose', P)).location;
  const own = [];
  for (const [key, a] of Object.entries(st.actors)) {
    if (!/ poteau$/.test(key) || a === P || !st.wires[key.replace(/poteau$/, 'reseau')]) continue;
    const l = (await call('pose', a)).location;
    own.push([a, Math.hypot(l.x - at.x, l.y - at.y, l.z - at.z)]);
  }
  for (const [a, d] of own.sort((u, v) => u[1] - v[1])) {
    if (d > 9500) break;
    const pw = await call('power', a);
    if (pw.wires >= pw.maxWires) continue;
    const w = await call('wire', a, P, {});
    if (w.built) { st.wires[p + 'reseau'] = w.actor || true; save(); console.log((p + 'reseau').padEnd(34), 'poteau de cellule a', Math.round(d / 100), 'm'); return; }
  }
  for (const it of (await call('scan', 'FGBuildablePowerPole', at, 10000, 40, {})).items) {
    if (it.path === P) continue;
    const pw = await call('power', it.path);
    if (pw.wires >= pw.maxWires || pw.circuitId < 0) continue;
    const w = await call('wire', it.path, P, {});
    if (w.built) { st.wires[p + 'reseau'] = w.actor || true; save(); console.log((p + 'reseau').padEnd(34), short(it.path), Math.round(it.distance / 100), 'm'); return; }
  }
  throw new Error(p + 'poteau : aucun poteau libre a 100 m');
}

// Bloc des filieres (utilisateur : « ok go pour les deux ») : 8 accelerateurs a 0 m (cap 0 : entrees au nord a +12 / +16 m
// du centre, sortie au sud a +14 m), 2 colonnes de 4 au pas de 34 m ; sous chacun, 2 melangeurs a -17 m (cap 0, centres a
// +-10 m ; entrees au nord, sorties au sud). Cellule A0 posee en essai.
// Meme regime pour les melangeurs et les accelerateurs (utilisateur, 28/10/2026 : « il faut que les melangeurs et
// l'accelerateur aient le meme facteur de charge ») : 16 melangeurs (B3 E ajoute, phase melangeur16) et 8 accelerateurs a
// 90 % ; 16 x 33,75 + 8 x 22,5 = 720 dechets, 16 x 45 = 720 non fissile = 8 x 90 ; silice, acides et eau inchanges
// (16 x 22,5 = 15 x 24).
// Puis 100 % (utilisateur, 28/10/2026 : « oui passe a 100 % ») : 800 dechets/min pour 720 produits, 80/min de marge pour
// resorber un retard (2 900 dechets en sortie des centrales apres le blocage des melangeurs par leur eau) ; 16 x 50 = 800
// non fissile = 8 x 100 ; 240 m3/min de chaque acide, 400 silice/min, 240 m3/min d'eau rendue.
// Puis 250 % (utilisateur, 28/10/2026 : « passe les cellules de traitement a 250% », 3 eclats chacune) : les cellules
// peuvent traiter 2 000 dechets/min, elles ne sont plus jamais le goulet ; leur debit reel suit les dechets recus.
const ACC = { A: -91400, B: -84400 }, ACC_Y = [-247000, -250400, -253800, -257200];
const CELLS_A = Object.keys(ACC).flatMap((c) => ACC_Y.map((y, i) => ({ id: c + i, x: ACC[c], y })));
const RECETTES = { acc: ['Recipe_Plutonium_C', 2.5], mel: ['Recipe_NonFissileUranium_C', 2.5] };
async function regle(key, recipe, clock) {
  const a = st.actors[key];
  if (!a || DRY || st.links['recette ' + key]) return;
  const r = await call('setRecipe', a, recipe);
  if (clock > 1) await call('addShards', a, Math.ceil((clock - 1) / 0.5));
  const m = await call('setClock', a, clock);
  st.links['recette ' + key] = r.recipe || true; save();
  console.log(('recette ' + key).padEnd(34), r.recipe, Math.round(m.pendingPotential * 1000) / 10 + ' %');
}
async function celluleAcc(c) {
  const mel = ['O', 'E'];
  for (const s of mel) await build(c.id + ' melangeur ' + s, 'Recipe_Blender_C', { x: c.x + (s === 'O' ? -1000 : 1000), y: c.y, z: -1700 }, 0);
  await build(c.id + ' accelerateur', 'Recipe_HadronCollider_C', { x: c.x, y: c.y, z: 0 }, 0);
  for (const s of mel) await regle(c.id + ' melangeur ' + s, ...RECETTES.mel);
  await regle(c.id + ' accelerateur', ...RECETTES.acc);
}

// Eau rendue par les melangeurs (utilisateur : « ok go pour les deux ») versee dans le reseau d'une centrale du champ.
// Cote melangeurs : sorties (sud, a x -6 m du centre, +1,75 m) -> jonctions 7,6 m au sud -> ligne de chaque rangee vers
// l'ouest -> collecteur x -95 000 -> tampon sureleve (voir plus bas) -> reseau de R4 7.
const XCOL = -95000;
async function eauMelangeurs() {
  // 5e extracteurs de R1 7 et R2 7 : retires d'abord (jonctions de couloir reliees, 8 x 120 + 216 pour 1 192), remis
  // ensuite a leur place d'origine (utilisateur, 28/10/2026 : « installer une 5eme pompe a eau sur les centrales a qui on en
  // a enleve pour voir ce que ca donne avec le tampon ») : liaison des jonctions de couloir demontee, chaque reseau a ses 5
  // extracteurs, l'eau des melangeurs ne va plus qu'a R1 7 (5 x 120 + 240 = 840 pour 596 : le tampon sureleve doit passer
  // devant les extracteurs). Une jonction au milieu de la liaison n'a pas sa place (1,3 m entre ses ports et ceux des
  // jonctions de couloir, FGCDPipeInvalidShape) ; inseree sur le tuyau en S : FGCDPipeAttachmentTooSharpTurn.
  if (st.links['R1 7 J couloir > R2 7 J couloir'] && !DRY) {
    await call('dismantle', st.links['R1 7 J couloir > R2 7 J couloir'], true);
    console.log('R1 7 J couloir > R2 7 J couloir'.padEnd(34), 'demonte'); delete st.links['R1 7 J couloir > R2 7 J couloir']; save();
  }
  for (const r of ['R1', 'R2']) {
    const R = ROWS[r], p = r + ' 7 ';
    await extracteur(p + 'e couloir', XK(7) + (R.s < 0 ? -900 : 930), R.y + 3000 * R.f, R.s < 0 ? 90 : -90);
    // port de couloir de la jonction debout, comme dans « cellule »
    await link(p + 'couloir > J couloir', REC.pipe, st.actors[p + 'e couloir'], 'FGPipeConnectionFactory', st.actors[p + 'j couloir'], R.f < 0 ? 'Connection1' : 'Connection0');
    // le poteau de la cellule R1 7 est plein (la pompe du tampon y a pris une place) : poteau libre le plus proche
    await pompeCourant(p + 'e couloir');
  }
  // lignes des rangees : une jonction 7,6 m au sud de chaque sortie, puis vers l'ouest jusqu'au collecteur
  const zw = DRY ? -1525 : Math.round((await call('connections', st.actors['A0 melangeur O'])).find((c) => c.name === 'PipeOutputFactory').location.z);
  const col = [];
  for (const [i, y] of ACC_Y.entries()) {
    const yl = y + 1500, xs = [];
    // B3 E (16e melangeur) est raccorde par la phase melangeur16, en tete de la ligne de la rangee 3
    for (const c of ['B', 'A']) for (const s of ['E', 'O']) if (st.actors[c + i + ' melangeur ' + s] && c + i + s !== 'B3E') xs.push([c + i + ' melangeur ' + s, ACC[c] + (s === 'O' ? -1000 : 1000) - 600]);
    const J = [];
    for (const [m, x] of xs) J.push([m, await build('eau rangee ' + i + ' ' + x, REC.junction, { x, y: yl, z: zw }, 0)]);
    const Jc = await build('eau collecteur ' + i, REC.junction, { x: XCOL, y: yl, z: zw }, 0);
    col.push(Jc);
    for (const [m, j] of J) await link('eau ' + m + ' > ligne', REC.pipe, st.actors[m], 'PipeOutputFactory', j, 'Connection3');
    const chain = J.map((q) => q[1]).concat([Jc]);
    for (let n = 1; n < chain.length; n++) await link('eau rangee ' + i + ' ' + n, REC.pipe, chain[n - 1], 'Connection0', chain[n], 'Connection1');
  }
  // collecteur du sud (rangee 0) au nord (rangee 3)
  for (let i = col.length - 1; i > 0; i--) await link('eau collecteur ' + i + ' > ' + (i - 1), REC.pipe, col[i], 'Connection2', col[i - 1], 'Connection3');
  // Tampon industriel sureleve (utilisateur, 28/10/2026 : « installe un buffer industriel sous moi », « il faut le
  // surelever et installer une pompe avec vanne anti reflu cote melangeurs » ; les melangeurs se bloquaient, sortie d'eau
  // pleine, face aux extracteurs), cote arrivee des dechets (« le tampon est super mal place », « je verrais plutot cote
  // arrivee waste, y'a bcp plus de place ») : bout nord du collecteur -> relais J1 -> pompe Mk2 -> tampon (cap
  // 0 : connecteurs sud et nord, rien au-dessus des centrales : 5 m a l'est de R4 7) -> jonction d'axe de R4 7, sur le
  // tuyau entre ses jonctions arriere et avant, par son port est (utilisateur : « branche toi sur le raccord que je viens
  // de positionner » ; elle regarde l'intervalle de 10 m entre les deux extracteurs est). Base a +5 m : connecteurs a
  // +6,75 m, au-dessus de l'entree d'eau des centrales (+5,75 m) ; son niveau monte jusqu'a passer devant les extracteurs
  // (5 x 120 + 240 pour 596 : essai sur R1 7, stable vers 300 m3). Le premier montage (T au sud du collecteur, tampon 34 m
  // au sud de R1, U -> R1 7) se demonte par la phase tamponSudDemonte.
  const zj = DRY ? -1490 : Math.round((await call('pose', st.actors['R4 7 j arriere'])).location.z);
  if (!st.actors['R4 7 j axe'] && !DRY) {
    const at = { x: XK(7), y: ROWS.R4.y, z: zj }, pipe = st.links['R4 7 J arriere > J avant'];
    const r = await call('buildAim', REC.junction, { x: at.x, y: at.y + 300, z: at.z + 300 }, at, { onActor: pipe });
    report('R4 7 j axe', r);
    if (r.built) { st.actors['R4 7 j axe'] = r.actor; save(); }
  }
  const N1 = await build('eau nord J1', REC.junction, { x: XCOL, y: -258800, z: zw }, 0);
  const B = await build('eau tampon nord', REC.tank, { x: XCOL, y: -261500, z: 500 }, 0);
  await link('eau collecteur 3 > J1', REC.pipe, col[col.length - 1], 'Connection3', N1, 'Connection2');
  // connecteurs du tampon : sud (vers les melangeurs) puis nord (vers R4 7)
  const tb = DRY || !B ? [] : (await call('connections', B)).sort((a, b) => b.location.y - a.location.y).map((c) => c.name);
  await link('eau J1 > tampon nord', REC.pipe, N1, 'Connection3', B, tb[0]);
  // pompe seule : la vanne a ete retiree (utilisateur : « j'ai enleve la valve aussi, inutile » ; la pompe ne laisse
  // deja rien refluer, voir l'analyse du reseau de fluides)
  await pompe('eau pompe tampon nord', st.links['eau J1 > tampon nord'], zw - 100, zw + 100);
  // port est de la jonction d'axe (a plat, cap 90 : Connection3 a l'est)
  await link('eau tampon nord > R4 7', REC.pipe, B, tb[1], st.actors['R4 7 j axe'], 'Connection3');
  await pompeCourant('eau pompe tampon nord');
}
// Premier montage du tampon (sud), demonte sur demande seulement (utilisateur : « tu peux me montrer sans debrancher au
// sud ») : phase tamponSudDemonte. Tuyaux autour de la pompe et de la vanne (coupes a leur pose), puis tuyaux et pieces
async function demonterTamponSud() {
  const morceaux = [];
  for (const k of ['eau pompe tampon', 'eau vanne tampon']) if (st.actors[k]) for (const c of ['Connection0', 'Connection1']) {
    const p = String((await call('dump', st.actors[k] + '.' + c, 1, 5, ['mConnectedComponent'])).mConnectedComponent || '').replace(/\.[^.]+$/, '');
    if (/Pipeline/.test(p) && !morceaux.includes(p)) morceaux.push(p);
  }
  for (const p of morceaux) { try { await call('dismantle', p, true); } catch (e) { /* deja demonte */ } }
  for (const k of ['eau collecteur 0 > T', 'eau T > pied tampon', 'eau pied tampon > tampon', 'eau tampon > U', 'eau U > R1 7']) {
    if (!st.links[k]) continue;
    try { await call('dismantle', st.links[k], true); } catch (e) { /* deja demonte */ }
    console.log(k.padEnd(34), 'demonte'); delete st.links[k]; save();
  }
  for (const k of ['eau pompe tampon', 'eau vanne tampon', 'eau pied tampon', 'eau tampon', 'eau T', 'eau U']) {
    if (!st.actors[k]) continue;
    try { await call('dismantle', st.actors[k], true); } catch (e) { /* deja demonte */ }
    console.log(k.padEnd(34), 'demonte'); delete st.actors[k]; delete st.wires[k]; save();
  }
}
// tuyau raccorde a la sortie (Connection1) d'une pompe ou d'une vanne
async function aval(piece) {
  const d = await call('dump', piece + '.Connection1', 1, 5, ['mConnectedComponent']);
  return String(d.mConnectedComponent || '').replace(/\.[^.]+$/, '') || null;
}

// Courant du bloc (utilisateur : « t'as pas alimente les accelerateurs ») : un poteau Mk3 par cellule d'accelerateur, a
// 0 m dans l'intervalle a l'ouest de l'accelerateur (colonne A : x -94 500, entre le bloc et le collecteur d'eau ;
// colonne B : x -87 900, entre les deux colonnes), cables vers l'accelerateur et ses melangeurs ; chaque poteau se
// raccorde au poteau deja raccorde le plus proche du module (cellules du champ comprises), 95 m au plus
const XPOT = { A: -94500, B: -87900 };
async function courantBloc() {
  for (const c of CELLS_A) {
    const key = c.id + ' poteau';
    const P = await build(key, 'Recipe_PowerPoleMk3_C', { x: XPOT[c.id[0]], y: c.y, z: 0 }, 0);
    if (DRY || !P) continue;
    for (const n of ['accelerateur', 'melangeur O', 'melangeur E']) {
      const a = st.actors[c.id + ' ' + n];
      if (!a || st.wires[c.id + ' ' + n]) continue;
      if ((await call('power', a)).wires > 0) { st.wires[c.id + ' ' + n] = true; save(); continue; }
      const w = await call('wire', P, a, {});
      if (!w.built) throw new Error(c.id + ' ' + n + ' : cable refuse ' + JSON.stringify(w.blocking));
      st.wires[c.id + ' ' + n] = w.actor || true; save();
    }
    if (st.wires[c.id + ' reseau']) continue;
    const at = (await call('pose', P)).location, cands = [];
    for (const [k, a] of Object.entries(st.actors)) {
      if (!/ poteau$/.test(k) || a === P || !st.wires[k.replace(/poteau$/, 'reseau')]) continue;
      const l = (await call('pose', a)).location;
      cands.push([k, a, Math.hypot(l.x - at.x, l.y - at.y, l.z - at.z)]);
    }
    let ok = false;
    for (const [k, a, d] of cands.sort((u, v) => u[2] - v[2])) {
      if (d > 9500) break;
      const pw = await call('power', a);
      if (pw.wires >= pw.maxWires) continue;
      const w = await call('wire', a, P, {});
      if (w.built) { st.wires[c.id + ' reseau'] = w.actor || true; save(); console.log((c.id + ' reseau').padEnd(34), k, Math.round(d / 100), 'm'); ok = true; break; }
    }
    if (!ok) throw new Error(key + ' : aucun poteau du module libre a 95 m');
  }
}

// 16e melangeur (B3 E) : machine, eau (jonction en tete de la ligne de la rangee 3, reliee a celle de B3 O), recette ;
// puis les 16 melangeurs et les 8 accelerateurs a 90 %, et le courant (courantBloc cable B3 E)
async function melangeur16() {
  await build('B3 melangeur E', 'Recipe_Blender_C', { x: ACC.B + 1000, y: ACC_Y[3], z: -1700 }, 0);
  const zw = DRY ? -1525 : Math.round((await call('connections', st.actors['A0 melangeur O'])).find((c) => c.name === 'PipeOutputFactory').location.z);
  const J = await build('eau rangee 3 ' + (ACC.B + 1000 - 600), REC.junction, { x: ACC.B + 1000 - 600, y: ACC_Y[3] + 1500, z: zw }, 0);
  await link('eau B3 melangeur E > ligne', REC.pipe, st.actors['B3 melangeur E'], 'PipeOutputFactory', J, 'Connection3');
  await link('eau rangee 3 B3 E > B3 O', REC.pipe, J, 'Connection0', st.actors['eau rangee 3 ' + (ACC.B - 1000 - 600)], 'Connection1');
  if (DRY) return;
  for (const c of CELLS_A) {
    for (const s of ['O', 'E']) {
      const k = c.id + ' melangeur ' + s;
      if (!st.links['recette ' + k]) { await regle(k, ...RECETTES.mel); continue; }
      const m = await call('setClock', st.actors[k], RECETTES.mel[1]);
      console.log(('regime ' + k).padEnd(34), Math.round(m.pendingPotential * 1000) / 10 + ' %');
    }
    const m = await call('setClock', st.actors[c.id + ' accelerateur'], RECETTES.acc[1]);
    console.log(('regime ' + c.id + ' accelerateur').padEnd(34), Math.round(m.pendingPotential * 1000) / 10 + ' %');
  }
  await courantBloc();
}

// Dechets (utilisateur : « il faut prevoir des repartiteurs equilibres pour l'uranium, les barres d'uranium et les dechets
// uranium ») : 720/min = 16 melangeurs x 33,75 + 8 accelerateurs x 22,5 (meme regime, 90 %).
//  - Collecte a +1 m : un fusionneur 3,5 m devant la sortie de chaque centrale (en deca de la montee d'eau, a 6,75 m),
//    une ligne par rangee vers l'est, collecteur nord-sud a x -95 600 entre le champ et le bloc, tronc vers l'est au nord
//    de tout (y -265 000).
//  - Racine a +1 m au nord du bloc : 1 -> 2 -> 4 (S0, S1 ouest, S1 est) ; trois branches (540) reunies (MB1, MB2) et
//    descendues par un ascenseur a -10 m vers l'arbre des melangeurs, la quatrieme (180) vers l'est pour les accelerateurs.
//  - Melangeurs : T0 (-10 m) -> 2 voies dans l'intervalle entre les colonnes A et B (x -88 500 et -86 900, au-dessus des
//    lignes d'eau a -15 m) -> un relais par rangee (x -87 700), ascenseur jusqu'a T2 a -16 m, 5 m devant les entrees ->
//    paires A et B -> chaque melangeur (Input0, x +2 m). 1 -> 2 -> 4 -> 8 -> 16, sans boucle.
//  - Accelerateurs : a +1 m, voies a l'est du bloc (x -81 500 pour les rangees 3 et 2, -80 500 pour 1 et 0 : aucune branche
//    ne croise l'autre voie) -> par rangee un repartiteur devant B (Input1, x +12 m), l'autre sortie vers A. 1 -> 2 -> 4 -> 8.
//  Chaque repartiteur a exactement deux sorties raccordees ; les fusionneurs ne servent qu'a reunir ou a relayer.
const K = require('./knowledge');
const ZA = 100, ZL = -1000, ZM = -1600;
const XG = -87700, XGO = -88500, XGE = -86900, XAO = -81500, XAE = -80500, XC = -95600, YK = -265000;
const LIGNE = { R1: -248838, R2: -250177, R3: -259253, R4: -260592 };
const DIR = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, O: { x: -1, y: 0 } };
let BEST = null;
// connecteur libre dont la normale est la plus proche du point cardinal (ou du vecteur) voulu (pile.js), ou connecteur nomme
async function port(actor, direction, d) {
  const v = typeof d === 'object' ? d : DIR[d];
  if (!v) return d;
  const list = (await call('connections', actor)).filter((c) => c.direction === direction && !c.connected);
  const score = (c) => c.normal.x * v.x + c.normal.y * v.y;
  list.sort((a, b) => score(b) - score(a));
  if (!list.length || score(list[0]) < 0.7) throw new Error('aucun connecteur ' + direction + ' libre vers ' + JSON.stringify(d) + ' sur ' + short(actor));
  return list[0].name;
}
async function lien(key, from, fromDir, to, toDir, lift) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(34), 'a construire'); return null; }
  if (!BEST) BEST = (await K.belts()).slice(-1)[0];
  const a = await port(from, 'output', fromDir), b = await port(to, 'input', toDir);
  return link(key, lift ? BEST.lift : BEST.belt, from, a, to, b, lift ? { snapTolerance: 400 } : undefined);
}
// fusionneurs devant les centrales : degagement souple seul touche a blanc (k 6 et 7, de 2,5 a 6 m devant la face ;
// plus de 100 m du joueur, le jeu ne le voit pas), ignore comme dans les piles
const piece = (key, kind, x, y, z, yaw, souple) => build('dechets ' + key, kind === 'r' ? 'Recipe_ConveyorAttachmentSplitter_C' : 'Recipe_ConveyorAttachmentMerger_C', { x, y, z }, yaw, souple ? { ignore: ['FGCDInvalidFloor', SOFT] } : AIR);
const D = (k) => st.actors['dechets ' + k];

async function dechetsCollecte() {
  const CR = {};
  for (const r of Object.keys(ROWS)) CR[r] = await piece('collecteur ' + r, 'f', XC, LIGNE[r], ZA, -90);
  const CRm = await piece('collecteur relais', 'f', XC, -254700, ZA, -90);
  for (const r of Object.keys(ROWS)) {
    const R = ROWS[r], sx = R.yaw === 180 ? -200 : 200, cote = R.f < 0 ? 'S' : 'N';
    let prev = null;
    for (const k of R.ks) {
      const M = await piece(r + ' ' + k, 'f', XK(k) + sx, LIGNE[r], ZA, 0, true);
      await lien('dechets ' + r + ' ' + k + ' sortie', st.actors[r + ' ' + k + ' centrale'], 'Output0', M, cote);
      if (prev) await lien('dechets ' + r + ' ' + prev.k + '>' + k, prev.M, 'E', M, 'O');
      prev = { k, M };
    }
    await lien('dechets ' + r + ' > collecteur', prev.M, 'E', CR[r], 'O');
  }
  const chain = [CR.R1, CR.R2, CRm, CR.R3, CR.R4];
  for (let i = 1; i < chain.length; i++) await lien('dechets collecteur ' + i, chain[i - 1], 'N', chain[i], 'S');
  // le tronc part du bout nord du collecteur (CR.R4) vers l'arbre : phase dechetsArbre
}
async function dechetsRacine() {
  const S0 = await piece('S0', 'r', XG, -264000, ZA, 90);
  const S1O = await piece('S1 ouest', 'r', -90200, -262500, ZA, 90), S1E = await piece('S1 est', 'r', -85200, -262500, ZA, 90);
  const MB1 = await piece('MB1', 'f', XG, -262500, ZA, 90), MB2 = await piece('MB2', 'f', XG, -261500, ZA, 90);
  await lien('dechets tronc > S0', D('tronc relais'), 'E', S0, 'N');
  await lien('dechets S0 > S1 ouest', S0, 'O', S1O, 'N');
  await lien('dechets S0 > S1 est', S0, 'E', S1E, 'N');
  await lien('dechets S1 ouest > MB1', S1O, 'E', MB1, 'O');
  await lien('dechets S1 est > MB1', S1E, 'O', MB1, 'E');
  await lien('dechets MB1 > MB2', MB1, 'S', MB2, 'N');
  await lien('dechets S1 ouest > MB2', S1O, 'S', MB2, 'O');
}
async function dechetsMelangeurs() {
  const T0 = await piece('T0', 'r', XG, -261100, ZL, 90);
  const T1N = await piece('T1 nord', 'r', XGO, ACC_Y[3] - 1550, ZL, 90);
  const L2 = await piece('voie ouest 2', 'f', XGO, ACC_Y[2] - 1550, ZL, 0);
  const LE = await piece('voie est relais', 'f', XGE, -256300, ZL, 90);
  const T1S = await piece('T1 sud', 'r', XGE, ACC_Y[1] - 1550, ZL, 90);
  const L0 = await piece('voie est 0', 'f', XGE, ACC_Y[0] - 1550, ZL, 180);
  const E = [];
  for (const [i, y] of ACC_Y.entries()) E.push(await piece('rangee ' + i, 'f', XG, y - 1550, ZL, 90));
  await lien('dechets MB2 > T0', D('MB2'), 'S', T0, 'N', true);
  await lien('dechets T0 > T1 nord', T0, 'O', T1N, 'N');
  await lien('dechets T0 > voie est', T0, 'E', LE, 'N');
  await lien('dechets T1 nord > rangee 3', T1N, 'E', E[3], 'O');
  await lien('dechets T1 nord > voie ouest 2', T1N, 'S', L2, 'N');
  await lien('dechets voie ouest 2 > rangee 2', L2, 'E', E[2], 'O');
  await lien('dechets voie est > T1 sud', LE, 'S', T1S, 'N');
  await lien('dechets T1 sud > rangee 1', T1S, 'O', E[1], 'E');
  await lien('dechets T1 sud > voie est 0', T1S, 'S', L0, 'N');
  await lien('dechets voie est 0 > rangee 0', L0, 'O', E[0], 'E');
  for (const [i, c] of ACC_Y.entries()) {
    const y = c - 1150;
    const T2 = await piece('T2 ' + i, 'r', XG, y, ZM, 90);
    const T3A = await piece('T3 A' + i, 'r', -90200, y, ZM, 180), MAO = await piece('A' + i + ' O', 'f', -92200, y, ZM, 90);
    const T3B = await piece('T3 B' + i, 'r', -85200, y, ZM, 0), MBE = await piece('B' + i + ' E', 'f', -83200, y, ZM, 90);
    await lien('dechets rangee ' + i + ' > T2', E[i], 'S', T2, 'N', true);
    await lien('dechets T2 ' + i + ' > A', T2, 'O', T3A, 'E');
    await lien('dechets T2 ' + i + ' > B', T2, 'E', T3B, 'O');
    await lien('dechets A' + i + ' E', T3A, 'S', st.actors['A' + i + ' melangeur E'], 'Input0');
    await lien('dechets T3 A' + i + ' > A' + i + ' O', T3A, 'O', MAO, 'E');
    await lien('dechets A' + i + ' O', MAO, 'S', st.actors['A' + i + ' melangeur O'], 'Input0');
    await lien('dechets B' + i + ' O', T3B, 'S', st.actors['B' + i + ' melangeur O'], 'Input0');
    await lien('dechets T3 B' + i + ' > B' + i + ' E', T3B, 'E', MBE, 'O');
    await lien('dechets B' + i + ' E', MBE, 'S', st.actors['B' + i + ' melangeur E'], 'Input0');
  }
}
async function dechetsAccelerateurs() {
  const U0 = await piece('U0', 'r', XAO, -262500, ZA, 0);
  const U1N = await piece('U1 nord', 'r', XAO, ACC_Y[3] - 1600, ZA, 90);
  const LA2 = await piece('voie acc ouest 2', 'f', XAO, ACC_Y[2] - 1600, ZA, 180);
  const LAE1 = await piece('voie acc est 1', 'f', XAE, -259000, ZA, 90), LAE2 = await piece('voie acc est 2', 'f', XAE, -255500, ZA, 90);
  const U1S = await piece('U1 sud', 'r', XAE, ACC_Y[1] - 1600, ZA, 90);
  const LA0 = await piece('voie acc est 0', 'f', XAE, ACC_Y[0] - 1600, ZA, 180);
  await lien('dechets S1 est > U0', D('S1 est'), 'E', U0, 'O');
  await lien('dechets U0 > U1 nord', U0, 'S', U1N, 'N');
  await lien('dechets U0 > voie acc est', U0, 'E', LAE1, 'N');
  await lien('dechets voie acc est 1 > 2', LAE1, 'S', LAE2, 'N');
  await lien('dechets voie acc est > U1 sud', LAE2, 'S', U1S, 'N');
  await lien('dechets U1 nord > voie acc ouest 2', U1N, 'S', LA2, 'N');
  await lien('dechets U1 sud > voie acc est 0', U1S, 'S', LA0, 'N');
  // ligne 5 m devant les entrees (4 m : degagement souple de l'accelerateur touche a blanc)
  for (const [i, c] of ACC_Y.entries()) {
    const y = c - 1600;
    const SB = await piece('SB ' + i, 'r', -83200, y, ZA, 180);
    const RM = await piece('acc relais ' + i, 'f', XG, y, ZA, 180), MA = await piece('acc A' + i, 'f', -90200, y, ZA, 90);
    const from = [LA0, U1S, LA2, U1N][i];
    await lien('dechets voie acc > SB ' + i, from, 'O', SB, 'E');
    await lien('dechets acc B' + i, SB, 'S', st.actors['B' + i + ' accelerateur'], 'Input1');
    await lien('dechets SB ' + i + ' > relais', SB, 'O', RM, 'E');
    await lien('dechets acc relais ' + i + ' > A', RM, 'O', MA, 'E');
    await lien('dechets acc A' + i, MA, 'S', st.actors['A' + i + ' accelerateur'], 'Input1');
  }
}

// Arbre etage par etage d'une pile dont l'entree radioactive est laissee libre par pile.js (pas de colonne : une colonne
// de repartiteurs n'est pas equilibree). Repere de la machine du pied (x local, avant Fm) :
//  - relais R par etage, d1 derriere la machine dans l'axe de l'entree, convoyeur droit jusqu'a elle (il passe a 1,4 m
//    des colonnes de pile.js) ;
//  - niveau 1 : un repartiteur entre deux etages, sur la verticale des relais ; ascenseurs vers les entrees laterales des
//    relais (cote +x vers l'etage du bas, -x vers celui du haut), comme les colonnes de pile.js ;
//  - niveaux superieurs 8 m plus loin : relais Q a la hauteur de chaque enfant (ascenseurs depuis le noeud, meme regle des
//    cotes), convoyeur droit jusqu'a l'entree arriere de l'enfant ; noeud 1 -> 3 : sortie avant droit vers l'enfant du
//    milieu, a sa hauteur.
// 4 etages : 1 -> 2 -> 2 ; 6 : 1 -> 3 -> 2 ; 8 : 1 -> 2 -> 2 -> 2. Rend la tete de chaque pile (entree arriere libre).
const FACT = { 4: [2, 2], 6: [2, 3], 8: [2, 2, 2] };
async function arbreEtages(tag, nomPile, entree, d1) {
  const ps = JSON.parse(fs.readFileSync(path.join(__dirname, nomPile + '-pile-state.json'), 'utf8'));
  const piles = [...new Set(Object.keys(ps.machines).map((k) => Number(k.split(' ')[1])))].sort((a, b) => a - b);
  const tetes = [];
  for (const s of piles) {
    const etages = Object.keys(ps.machines).filter((k) => k.startsWith('pile ' + s + ' ')).length;
    if (!FACT[etages]) throw new Error(nomPile + ' : ' + etages + ' etages non geres');
    const m0 = ps.machines['pile ' + s + ' machine 0'];
    const pose = await call('pose', m0), o = pose.location, t = pose.rotation.yaw * Math.PI / 180;
    const X = { x: Math.cos(t), y: Math.sin(t) }, Fm = { x: -Math.sin(t), y: Math.cos(t) };
    const back = { x: -Fm.x, y: -Fm.y }, px = X, mx = { x: -X.x, y: -X.y };
    const inp = (await call('connections', m0)).find((c) => c.name === entree);
    const ix = (inp.location.x - o.x) * X.x + (inp.location.y - o.y) * X.y, iz = inp.location.z - o.z;
    const W = (ly, z) => ({ x: Math.round(o.x + X.x * ix + Fm.x * ly), y: Math.round(o.y + X.y * ix + Fm.y * ly), z: Math.round(z) });
    const yawN = Math.round(pose.rotation.yaw + 90);
    const key = (n) => tag + ' p' + s + ' ' + n;
    const P = (n, kind, ly, z) => build(key(n), kind === 'r' ? 'Recipe_ConveyorAttachmentSplitter_C' : 'Recipe_ConveyorAttachmentMerger_C', W(ly, z), yawN);
    const R = [];
    for (let i = 0; i < etages; i++) {
      const m = ps.machines['pile ' + s + ' machine ' + i];
      const h = (await call('pose', m)).location.z + iz;
      const a = await P('R' + i, 'f', -d1, h);
      await lien(key('R' + i + ' > machine'), a, Fm, m, entree);
      R.push({ a, h });
    }
    let level = [];
    for (let k = 0; k < etages / 2; k++) {
      const h = (R[2 * k].h + R[2 * k + 1].h) / 2;
      const b = await P('B' + k, 'r', -d1, h);
      await lien(key('B' + k + ' > R' + 2 * k), b, px, R[2 * k].a, px, true);
      await lien(key('B' + k + ' > R' + (2 * k + 1)), b, mx, R[2 * k + 1].a, mx, true);
      level.push({ a: b, h });
    }
    let d = d1;
    for (const [L, g] of FACT[etages].slice(1).entries()) {
      d += 800;
      const next = [];
      for (let j = 0; j < level.length / g; j++) {
        const kids = level.slice(j * g, j * g + g), name = 'N' + (L + 2) + '.' + j;
        const h = g === 3 ? kids[1].h : (kids[0].h + kids[1].h) / 2;
        const n = await P(name, 'r', -d, h);
        const lo = kids[0], hi = kids[g - 1];
        const q0 = await P(name + ' Q0', 'f', -d, lo.h), q1 = await P(name + ' Q' + (g - 1), 'f', -d, hi.h);
        await lien(key(name + ' > Q0'), n, px, q0, px, true);
        await lien(key(name + ' > Q' + (g - 1)), n, mx, q1, mx, true);
        await lien(key(name + ' Q0 > 0'), q0, Fm, lo.a, back);
        await lien(key(name + ' Q' + (g - 1) + ' > ' + (g - 1)), q1, Fm, hi.a, back);
        if (g === 3) await lien(key(name + ' > 1'), n, Fm, kids[1].a, back);
        next.push({ a: n, h });
      }
      level = next;
    }
    tetes.push({ pile: s, a: level[0].a, h: level[0].h, pos: W(-d, level[0].h), d, W, Fm, X, back, yawN });
  }
  return tetes;
}

// Arbre des dechets (720/min -> 8 x 90 vers les repartiteurs P des cellules, entree au nord), compacte (utilisateur,
// 28/10/2026 : « t'as moyen de compacter ca », « je pense que tu peux faire bcp plus court », « commence par poser les
// splitter et apres tu pose les belt ») : une seule ligne dans l'axe de l'allee (x -87 450), deux niveaux.
//  - +1 m : par rangee, un repartiteur T au milieu des deux P, 6 m au nord d'eux (une sortie laterale vers chaque P, qui
//    entre par le nord) ; entre deux rangees, un repartiteur S dont les sorties nord et sud vont aux deux T (T tourne
//    vers son S). Les crochets T -> P barrent l'allee a chaque rangee : rien ne la remonte a +1 m.
//  - +5 m, au-dessus des crochets : la tete K2 relais au nord de la rangee 3, la racine R0 au-dessus de S32 (ascenseur
//    droit vers lui), la branche des rangees 1 et 0 jusqu'a K4, au-dessus de S10 (ascenseur droit).
//  - tronc direct (utilisateur, sur le detour par le nord : « la partie que j'ai selectionne est superflu, tu peux etre
//    bcp plus direct ») : du bout nord du collecteur (CR.R4, x -95 600, sortie au nord) vers l'est, en montant de 4 m
//    jusqu'au relais du tronc (+5 m, a mi-chemin), puis tout droit dans le cote ouest de la tete.
// 1 -> 2 -> 4 -> 8, chaque repartiteur a exactement deux sorties raccordees. usage : dechetsArbre [pieces,liens]
const XD = -87450;
async function dechetsArbre(etapes) {
  const ZH = 500, mid = (a, b) => Math.round((a + b) / 2), yT = (k) => ACC_Y[k] - 2600;
  const P = (c) => st.actors['dechets cellule ' + c + ' P'];
  const souple = { ignore: ['FGCDInvalidFloor', SOFT] };
  const piece = (key, kind, y, z, cap) => build('dechets arbre ' + key, kind, { x: XD, y, z }, cap, souple);
  const yH = -261550, yS32 = mid(yT(3), yT(2)), yS10 = mid(yT(1), yT(0));
  // repartiteurs puis relais
  const R0 = await piece('R0', SPL, yS32, ZH, CAP.S);
  const S32 = await piece('S32', SPL, yS32, ZA, CAP.E), S10 = await piece('S10', SPL, yS10, ZA, CAP.E);
  const T = {};
  for (const k of [3, 2, 1, 0]) T[k] = await piece('T' + k, SPL, yT(k), ZA, k % 2 ? CAP.N : CAP.S);
  const KT = await build('dechets tronc relais', MRG, { x: mid(XC, XD), y: yH, z: ZH }, CAP.E, souple);
  const K21 = await piece('K2 relais', MRG, yH, ZH, CAP.S);
  const R01 = await piece('R0 relais', MRG, mid(yS32, yS10), ZH, CAP.S);
  const K4 = await piece('K4', MRG, yS10, ZH, CAP.O);
  if (!etapes.includes('liens')) return;
  const L = (key, a, da, b, db, lift) => lien('dechets arbre ' + key, a, da, b, db, lift);
  await lien('dechets collecteur > tronc', st.actors['dechets collecteur R4'], 'N', KT, 'O');
  await L('tronc > K2 relais', KT, 'E', K21, 'O');
  await L('K2 relais > R0', K21, 'S', R0, 'N');
  await L('R0 > S32', R0, 'O', S32, 'O', true);
  await L('R0 > relais', R0, 'S', R01, 'N');
  await L('R0 relais > K4', R01, 'S', K4, 'N');
  await L('K4 > S10', K4, 'O', S10, 'O', true);
  for (const [S, a, b] of [[S32, 3, 2], [S10, 1, 0]]) {
    await L('S' + a + b + ' > T' + a, S, 'N', T[a], 'S');
    await L('S' + a + b + ' > T' + b, S, 'S', T[b], 'N');
  }
  for (const k of [3, 2, 1, 0]) {
    await L('T' + k + ' > A' + k, T[k], 'O', P('A' + k), 'N');
    await L('T' + k + ' > B' + k, T[k], 'E', P('B' + k), 'N');
  }
}

// Partage des dechets devant chaque cellule du bloc (utilisateur, 28/10/2026 : « on fait une equi-repartition en 8 »,
// « c'est devant chaque cellule qu'on fait le partage de facon compact », « il te manque un lift qui redirige la moitie
// du flux de l'accelerateur vers les melangeurs », « il faudrait inverser la position des 2 splitters » ; montage valide
// sur B3), avec des repartiteurs intelligents (« remplace tous les splitter du repartiteur waste sur les cellules par un
// smart »). L'accelerateur recoit le quart des dechets de sa cellule, les melangeurs les trois quarts : le rapport de la
// recette (25 dechets pour 100 non fissile ; 15 dechets -> 20 non fissile). A +1 m, dans l'allee entre les colonnes
// (A : 17 m a l'est du melangeur est ; B : 12 m a l'ouest du melangeur ouest) :
//   P (entree nord : feuille de l'arbre 1 -> 8) -> 1/2 tout droit au sud -> F (fusionneur en tete de l'ascenseur) ;
//   P -> 1/2 -> SA (8 m cote cellule) -> 1/4 -> MA (relais 5 m devant l'entree des dechets de l'accelerateur) ; SA -> 1/4 -> F.
// Ascenseur de 17 m a la verticale de F (bande libre 6 m devant les faces, entre la silice a -12 m et l'uranium non
// fissile a -6 m) -> M (-16 m) -> S (-16 m, devant le melangeur cote allee) : tout droit vers lui, courbe vers l'autre.
// Regles de P et SA : « tout » sur leurs deux sorties raccordees (jamais de debordement : utilisateur, « si on atteint
// l'overflow c'est vraiment la catastrophe ») ; apres un incident, regule-cellules.js retablit le rapport 4 pour 1 dans
// les accelerateurs en basculant les SA. usage : dechetsCellules [A0,..,B3] (toutes par defaut)
const SPLS = 'Recipe_ConveyorAttachmentSplitterSmart_C', BELT6 = 'Recipe_ConveyorBeltMk6_C', LIFT6 = 'Recipe_ConveyorLiftMk6_C';
async function regles(key, outputs) {
  if (DRY || !st.actors[key] || st.links['regles ' + key]) return;
  await call('smartRules', st.actors[key], outputs.map((o) => ({ item: 'any', output: o })));
  st.links['regles ' + key] = outputs; save();
}
async function dechetsCellule(C) {
  const B = C[0] === 'B', k = (n) => 'dechets cellule ' + C + ' ' + n;
  const souple = { ignore: ['FGCDInvalidFloor', SOFT] };
  const inp = async (m) => (await call('connections', st.actors[C + ' melangeur ' + m])).find((c) => c.name === 'Input0').location;
  const e = await inp('E'), o = await inp('O');
  const XE = Math.round(e.x), YF = Math.round(e.y), XO = Math.round(o.x), XP = B ? XO - 1200 : XE + 1700, YL = YF - 600;
  const s = B ? -1 : 1; // sens de l'allee vers la cellule : A vers l'ouest (-x), B vers l'est (+x)
  // relais de l'accelerateur 5 m devant son entree (degagement souple du fusionneur voisin de l'uranium non fissile, +1 m)
  const MA = await build(k('MA'), MRG, { x: XE, y: YF - 900, z: 100 }, 90, souple);
  const M = await build(k('M'), MRG, { x: XP, y: YL, z: -1600 }, B ? 0 : 180);
  const S = await build(k('S'), SPL, { x: B ? XO : XE, y: YL, z: -1600 }, B ? 0 : 180);
  // haut : F a la verticale de M, P 7 m au nord de F, SA 8 m cote cellule
  const F = await build(k('F'), MRG, { x: XP, y: YL, z: 100 }, B ? 180 : 0);
  const P = await build(k('P'), SPLS, { x: XP, y: YL - 700, z: 100 }, 90);
  const SA = await build(k('SA'), SPLS, { x: XP - s * 800, y: YL - 700, z: 100 }, B ? 0 : 180);
  // connecteurs : P vers le sud (ouest = Output2, est = Output3) ; F vers l'est (A : nord = Input3) ou l'ouest (B : nord =
  // Input2) ; SA vers l'ouest (A : sud = Output3) ou l'est (B : sud = Output2) ; MA vers le sud (est = Input3, ouest =
  // Input2) ; S vers l'ouest (A : sud = Output3) ou l'est (B : sud = Output2)
  await link(k('MA > accelerateur'), BELT6, MA, 'Output1', st.actors[C + ' accelerateur'], 'Input1');
  await link(k('F > M'), LIFT6, F, 'Output1', M, 'Input1', { snapTolerance: 400 });
  await link(k('P > F'), BELT6, P, 'Output1', F, B ? 'Input2' : 'Input3');
  await link(k('P > SA'), BELT6, P, B ? 'Output3' : 'Output2', SA, 'Input1');
  await link(k('SA > MA'), BELT6, SA, 'Output1', MA, B ? 'Input2' : 'Input3');
  await link(k('SA > F'), BELT6, SA, B ? 'Output2' : 'Output3', F, 'Input1');
  await link(k('M > S'), BELT6, M, 'Output1', S, 'Input1');
  const near = B ? 'O' : 'E', far = B ? 'E' : 'O';
  await link(k('S > melangeur ' + near), BELT6, S, B ? 'Output2' : 'Output3', st.actors[C + ' melangeur ' + near], 'Input0');
  await link(k('S > melangeur ' + far), BELT6, S, 'Output1', st.actors[C + ' melangeur ' + far], 'Input0');
  // regles des intelligents (sorties 0 = Output1, 1 = Output2, 2 = Output3)
  await regles(k('P'), [0, B ? 2 : 1]);
  await regles(k('SA'), [0, B ? 1 : 2]);
}

// Arrivee de l'uranium (600/min ; posee en dernier, rien de radioactif ne circule avant ; utilisateur, 28/10/2026 :
// « branche l'uranium », « plus direct en traversant a travers les pompes a eau », « vise au dessus de ma selection » (la
// jonction ouest de l'acide nitrique, -93 900 ; -241 400 ; -8 m)) : bout libre de la ligne de la mine (convoyeur 2147302613,
// -89 206 ; -198 564 ; -13,5 m, vers le nord-nord-ouest) -> nord a -13,5 m le long de x -89 300, entre les extracteurs des
// bandes (rien entre x -91 600 et -88 800) -> ascenseur droit jusqu'a -5 m (a -13,5 m, le passage vers l'ouest frole le
// tuyau d'acide sulfurique a -14,5 m le long de x -90 200) -> ouest -> nord le long de x -93 900, 2,5 m au-dessus du tronc
// d'acide nitrique, a l'exterieur des cellules A -> est le long de y -261 000, au nord des cellules -> sous la racine
// (entree Input1 au nord, +100 m) : 3 ascenseurs droits de 35 m, fusionneurs empiles tournes nord / sud en alternance.
// Releve couloir-3d.js (recherches centrees sur le trace) : rien a moins de 1 m.
async function arriveeUranium() {
  const src = PREFIX + 'Build_ConveyorBeltMk6_C_2147302613', RU = st.actors['uranium racine'];
  const ZB = -1350, ZH = -500, XS = -89300, XN = -93900, YS = -199600, YC = -240800, YN = -261000;
  const ru = (await call('connections', RU)).find((c) => c.name === 'Input1');
  const XR = Math.round(ru.location.x), YR = Math.round(ru.location.y - ru.normal.y * 100);
  const B = (key, x, y, z, cap) => build('uranium arrivee ' + key, MRG, { x, y, z }, cap, AIR);
  // ligne droite (le long de x ou de y) entre deux pieces, relais tous les 46 m au plus, tournes dans le sens du flux
  const relais = [];
  async function ligne(key, a, pa, b, pb, z) {
    const dir = Math.abs(pb.x - pa.x) > Math.abs(pb.y - pa.y) ? (pb.x < pa.x ? 'O' : 'E') : (pb.y < pa.y ? 'N' : 'S');
    const n = Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y) / 4600) - 1, R = [a];
    for (let j = 1; j <= n; j++) R.push(await B(key + ' relais ' + j, Math.round(pa.x + (pb.x - pa.x) * j / (n + 1)), Math.round(pa.y + (pb.y - pa.y) * j / (n + 1)), z, CAP[dir]));
    R.push(b);
    relais.push({ key, R, dir });
  }
  const U0 = await B('U0', XS, YS, ZB, CAP.N);
  const C1 = await B('C1', XS, YC, ZB, CAP.N), C2 = await B('C2', XS, YC, ZH, CAP.O);
  const C3 = await B('C3', XN, YC, ZH, CAP.N), C4 = await B('C4', XN, YN, ZH, CAP.E);
  const col = [await B('U1', XR, YR, ZH, CAP.N), await B('U2', XR, YR, 3000, CAP.S), await B('U3', XR, YR, 6500, CAP.N)];
  await ligne('sud', U0, { x: XS, y: YS }, C1, { x: XS, y: YC }, ZB);
  await ligne('ouest', C2, { x: XS, y: YC }, C3, { x: XN, y: YC }, ZH);
  await ligne('nord', C3, { x: XN, y: YC }, C4, { x: XN, y: YN }, ZH);
  await ligne('est', C4, { x: XN, y: YN }, col[0], { x: XR, y: YN }, ZH);
  // convoyeurs, la source en dernier : l'uranium n'entre qu'une fois la ligne raccordee a la racine
  const OPP_ = { N: 'S', S: 'N', E: 'O', O: 'E' };
  for (const { key, R, dir } of relais) for (let j = 1; j < R.length; j++) await lien('uranium arrivee ' + key + ' ' + j, R[j - 1], dir, R[j], OPP_[dir]);
  await lien('uranium arrivee montee ouest', C1, 'N', C2, 'N', true);
  const sorties = ['N', 'S', 'N'];
  for (let i = 1; i < col.length; i++) await lien('uranium arrivee colonne ' + i, col[i - 1], sorties[i - 1], col[i], sorties[i - 1], true);
  await lien('uranium arrivee > racine', col[col.length - 1], 'N', RU, 'N', true);
  await lien('uranium arrivee source', src, 'ConveyorAny1', U0, 'S');
}

// Uranium (600/min, 25 par fabricant de cellules) : racine 1 -> 2 (groupes U1, U2) -> 1 -> 2 (piles) -> arbre de la pile.
// Repartiteur de groupe 12 m derriere les tetes, entre les deux piles ; racine 12 m plus loin, entre les groupes. La
// racine attend l'arrivee de l'uranium (posee en dernier : rien de radioactif ne circule avant).
async function uranium() {
  const G = [];
  for (const g of Object.keys(GROUPES_U)) {
    const t = await arbreEtages('uranium ' + g, 'module1-' + g + 'c', 'Input1', 2800);
    const [a, b] = t, mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
    const at = { x: Math.round(mid.x + a.back.x * 1200), y: Math.round(mid.y + a.back.y * 1200), z: a.h };
    const S = await build('uranium groupe ' + g, 'Recipe_ConveyorAttachmentSplitter_C', at, a.yawN, AIR);
    for (const tt of t) {
      const side = (tt.pos.x - mid.x) * a.X.x + (tt.pos.y - mid.y) * a.X.y > 0 ? a.X : { x: -a.X.x, y: -a.X.y };
      await lien('uranium groupe ' + g + ' > pile ' + tt.pile, S, side, tt.a, tt.back);
    }
    G.push({ g, S, at, t: a });
  }
  const t = G[0].t, mid = { x: (G[0].at.x + G[1].at.x) / 2, y: (G[0].at.y + G[1].at.y) / 2 };
  const at = { x: Math.round(mid.x + t.back.x * 1200), y: Math.round(mid.y + t.back.y * 1200), z: t.h };
  // racine en repartiteur intelligent, sorties laterales sur « tout » (utilisateur, 28/10/2026 : « remplacer le
  // repartiteur racine par un smart histoire de pouvoir couper l'appro ») : les mettre sur « rien » coupe l'uranium
  const RU = await build('uranium racine', 'Recipe_ConveyorAttachmentSplitterSmart_C', at, t.yawN, AIR);
  if (RU && !DRY && !st.links['regles uranium racine']) {
    await call('smartRules', RU, [{ item: 'any', output: 1 }, { item: 'any', output: 2 }]);
    st.links['regles uranium racine'] = true; save();
  }
  for (const g of G) {
    const side = (g.at.x - mid.x) * t.X.x + (g.at.y - mid.y) * t.X.y > 0 ? t.X : { x: -t.X.x, y: -t.X.y };
    await lien('uranium racine > ' + g.g, RU, side, g.S, t.back);
  }
}

const SPL = 'Recipe_ConveyorAttachmentSplitter_C', MRG = 'Recipe_ConveyorAttachmentMerger_C';
const pileState = (nom) => JSON.parse(fs.readFileSync(path.join(__dirname, nom + '-pile-state.json'), 'utf8'));
// tete de pile la plus proche d'un cote : sortie laterale du repartiteur racine vers elle
const cote = (from, to, X) => ((to.x - from.x) * X.x + (to.y - from.y) * X.y > 0 ? X : { x: -X.x, y: -X.y });

// Regime des piles du plutonium : 90 % comme les melangeurs et les accelerateurs, puis 250 % (utilisateur, 28/10/2026 :
// « toute la filiere plutonium doit etre a 250% », 3 eclats chacune) ; l'etat garde le regime pose
const REGIME_PU = 2.5;
async function reglagesPu() {
  for (const nom of ['module1-PuC', 'module1-PuB']) {
    for (const [k, m] of Object.entries(pileState(nom).machines)) {
      if (DRY || st.links['regime ' + nom + ' ' + k] === REGIME_PU) continue;
      let r = await call('setClock', m, REGIME_PU);
      if (r.pendingPotential < REGIME_PU - 0.001) { await call('addShards', m, 3 - (r.powerShards || 0)); r = await call('setClock', m, REGIME_PU); }
      st.links['regime ' + nom + ' ' + k] = REGIME_PU; save();
      console.log(('regime ' + nom + ' ' + k).padEnd(40), Math.round(r.pendingPotential * 1000) / 10 + ' %', r.powerShards + ' eclats');
    }
  }
}

// Granules (216/min, 9 par assembleuse) : sortie de chaque accelerateur -> fusionneur 3 m au sud (+1 m) -> ascenseur
// jusqu'a +45 m (au-dessus des accelerateurs) -> une ligne nord-sud par colonne (A x -89 600, B x -82 600) sous les piles
// -> reunion a y -241 000 -> fusionneurs empiles sous la racine (+45 m, +60 m) -> ascenseur jusqu'a la racine (1 -> 3).
async function granules() {
  const t = await arbreEtages('granules', 'module1-PuC', 'Input1', 3200);
  // racine 8 m derriere la tete du milieu (y -239 400) : l'etage +32 m de la bande 4 commence vers y -238 800 (raffineries
  // a y -238 200, sommet sous 64 m ; fusionneur a +45 m en y -239 000 : degagement souple seul)
  const mid = t[1];
  const at = { x: Math.round(mid.pos.x + mid.back.x * 800), y: Math.round(mid.pos.y + mid.back.y * 800), z: mid.h };
  const RG = await build('granules racine', SPL, at, mid.yawN, AIR);
  await lien('granules racine > pile ' + mid.pile, RG, mid.Fm, mid.a, mid.back);
  for (const tt of [t[0], t[2]]) await lien('granules racine > pile ' + tt.pile, RG, cote(at, tt.pos, mid.X), tt.a, tt.back);
  // a +50 m : a +45 m, degagement souple de l'etage +32 m de la bande 4 touche (essai du 28/10/2026)
  const M45 = await build('granules M45', MRG, { x: at.x, y: at.y, z: 5000 }, 0, AIR);
  const M60 = await build('granules M60', MRG, { x: at.x, y: at.y, z: 6000 }, 90, AIR);
  await lien('granules M45 > M60', M45, 'E', M60, 'E', true);
  await lien('granules M60 > racine', M60, 'S', RG, 'S', true);
  const MP = await build('granules MP', MRG, { x: at.x, y: -241000, z: 4500 }, 90, AIR);
  await lien('granules MP > M45', MP, 'S', M45, 'N');
  for (const c of ['A', 'B']) {
    const xc = ACC[c] + 1800;
    const RC = await build('granules R' + c, MRG, { x: xc, y: -241000, z: 4500 }, c === 'A' ? 0 : 180, AIR);
    await lien('granules R' + c + ' > MP', RC, c === 'A' ? 'E' : 'O', MP, c === 'A' ? 'O' : 'E');
    let prev = null;
    for (let i = 3; i >= 0; i--) {
      const y = ACC_Y[i];
      // 3 m devant la sortie : degagement souple du connecteur de l'accelerateur seul touche (comme aux centrales)
      const PM = await build('granules PM ' + c + i, MRG, { x: ACC[c] + 1400, y: y + 1410, z: ZA }, 0, { ignore: ['FGCDInvalidFloor', SOFT] });
      const T = await build('granules T ' + c + i, MRG, { x: xc, y: y + 1410, z: 4500 }, 90, AIR);
      await lien('granules acc ' + c + i, st.actors[c + i + ' accelerateur'], 'Output0', PM, 'N');
      await lien('granules PM ' + c + i + ' > T', PM, 'E', T, 'O', true);
      if (prev) await lien('granules T ' + c + (i + 1) + ' > ' + i, prev, 'S', T, 'N');
      prev = T;
    }
    await lien('granules T ' + c + '0 > R' + c, prev, 'S', RC, 'N');
  }
}

// Cellules de plutonium (108/min, 6,75 par fabricant) : bout est du collecteur des assembleuses -> couloir x -84 800
// entre les deux rangees (+65 m) -> fusionneur sous la racine (+70 m) -> ascenseur jusqu'a la racine (1 -> 2)
async function cellulesPu() {
  const t = await arbreEtages('cellules Pu', 'module1-PuB', 'Input1', 2800);
  const [a, b] = t, mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
  const at = { x: Math.round(mid.x + a.back.x * 1200), y: Math.round(mid.y + a.back.y * 1200), z: a.h };
  const RC = await build('cellules Pu racine', SPL, at, a.yawN, AIR);
  for (const tt of t) await lien('cellules Pu racine > pile ' + tt.pile, RC, cote(at, tt.pos, a.X), tt.a, tt.back);
  const M70 = await build('cellules Pu M70', MRG, { x: at.x, y: at.y, z: 7000 }, 90, AIR);
  await lien('cellules Pu M70 > racine', M70, 'S', RC, 'S', true);
  const last = pileState('module1-PuC').parts['collecteur pile 0'];
  const lz = (await call('pose', last)).location;
  const CA = await build('cellules Pu CA', MRG, { x: -84800, y: Math.round(lz.y), z: Math.round(lz.z) }, 90, AIR);
  const CB = await build('cellules Pu CB', MRG, { x: -84800, y: Math.round((lz.y + at.y) / 2), z: Math.round(lz.z) }, 90, AIR);
  const CC = await build('cellules Pu CC', MRG, { x: -84800, y: at.y, z: Math.round(lz.z) }, 0, AIR);
  await lien('cellules Pu collecteur > CA', last, 'E', CA, 'O');
  await lien('cellules Pu CA > CB', CA, 'S', CB, 'N');
  await lien('cellules Pu CB > CC', CB, 'S', CC, 'N');
  await lien('cellules Pu CC > M70', CC, 'E', M70, 'O');
}

// Barres de plutonium (3,6/min) : bout est du collecteur des fabricants -> broyeur au nord-est, a +64 m, entree au sud,
// a 17 m de la double voie ; courant par le poteau 1 des fabricants (le poteau 0 a ses 10 connexions)
async function broyeur() {
  const ps = pileState('module1-PuB');
  const S = await build('broyeur', 'Recipe_ResourceSink_C', { x: -78600, y: -249000, z: 6400 }, 0, AIR);
  await lien('broyeur barres Pu', ps.parts['collecteur pile 0'], 'E', S, 'Input0');
  if (DRY || !S || st.wires.broyeur) return;
  if ((await call('power', S)).wires > 0) { st.wires.broyeur = true; save(); return; }
  const w = await call('wire', ps.poles['poteau 1'], S, {});
  if (!w.built) throw new Error('broyeur : cable refuse ' + JSON.stringify(w.blocking));
  st.wires.broyeur = w.actor || true; save();
}

// Non fissile (720/min, 45 par melangeur, 90 par accelerateur) : chaque cellule boucle sur elle-meme, ses deux melangeurs
// (2 x 45) alimentent son accelerateur (90), sans repartiteur (utilisateur, 28/10/2026 : « pourquoi tu boucles pas par la
// sortie des melangeurs directement sur l'entree de l'accelerateur de la cellule »). Montage de l'utilisateur sur B3
// (« voila regarde »), le meme dans les 8 cellules, tout dans la cellule :
//  - fusionneur NM 1 m devant chaque sortie des melangeurs (au sud, -16 m), ascenseur droit jusqu'a NL a sa verticale
//    (-6 m), NL tournes a l'est ; NL ouest -> NL est ;
//  - un seul convoyeur de NL est au cote est de la feuille F : il passe en diagonale au-dessus de la moitie est du
//    melangeur est, basse (le haut du melangeur ne monte a -6 m que sur sa moitie ouest), et ne depasse son bord que de 1 m ;
//  - F a -6 m sous Input0 (+16 m du centre de l'accelerateur, au nord), tournee au nord comme lui (sortie a sa verticale) :
//    ascenseur droit de -6 a +1 m. Un ascenseur est vertical : entre deux connecteurs face a face decales a l'horizontale,
//    le jeu raccorde par la tolerance d'accroche mais l'ascenseur reste a la verticale d'un bout, l'autre dans le vide
//    (utilisateur : « t'es sur que le lift non fissible uranium est bien positionne »). Sans F, un ascenseur pose depuis
//    Input0 avec le pied tourne vers la ligne (molette 90 / 270) a sa colonne 1 m derriere la face (essai sur B3).
// usage : nonFissile [cellules, ex. A3,B3 ; toutes par defaut]
async function nonFissile(cells) {
  const ZN = -600;
  for (const C of cells || CELLS_A.map((c) => c.id)) {
    const c = ACC_Y[Number(C[1])], x0 = ACC[C[0]];
    let prev = null;
    for (const s of ['O', 'E']) {
      const bx = x0 + (s === 'O' ? -1000 : 1000), id = C + ' ' + s;
      const NM = await build('nf NM ' + id, MRG, { x: bx - 200, y: c + 1050, z: -1600 }, 90, AIR);
      const NL = await build('nf NL2 ' + id, MRG, { x: bx - 200, y: c + 1050, z: ZN }, CAP.E, AIR);
      await lien('nf ' + id + ' sortie', st.actors[C + ' melangeur ' + s], 'Output1', NM, 'N');
      await lien('nf NM ' + id + ' > NL2', NM, 'S', NL, 'S', true);
      if (prev) await lien('nf NL2 ' + prev.id + ' > ' + id, prev.NL, 'E', NL, 'O');
      prev = { id, NL };
    }
    const F = await build('nf feuille ' + C, MRG, { x: x0 + 1600, y: c - 1000, z: ZN }, -90, AIR);
    await lien('nf NL2 ' + prev.id + ' > feuille', prev.NL, 'E', F, 'E');
    await lien('nf ' + C + ' accelerateur', F, 'N', st.actors[C + ' accelerateur'], 'Input0', true);
  }
}

// Barres d'uranium (14,4/min, 0,4966 par centrale) : arbre de 32 feuilles, 3 rebouclees (29 centrales), a 45 m AU-DESSUS
// du champ (utilisateur, 28/10/2026 : « t'as moyen de faire un truc propre qui a le faire au dessus des centrales », « je
// leve la regle pour cet arbre » ; sommet des centrales a 38,5 m). Arrivee : collecteurs des piles -> MD (+65 m) -> MW,
// ligne a +65 m le long de R1 vers l'ouest -> MX (x -131 000, a l'ouest du champ) -> nord -> MF -> ascenseur -> FR (+45 m,
// reunit l'arrivee et les boucles) -> G0 (1 -> 2) : couloir C34 vers G1 C34 ; colonne W1 -> W2 a l'ouest, puis couloir
// C12 vers G1 C12 -> chaque G1 (1 -> 2, au milieu de son couloir, x -113 575) -> racine des deux rangees du couloir, entree
// par la face (les lignes de la rangee y ont un intervalle, entre les colonnes 3 et 4). Par rangee, un arbre a plat
// 1 -> 2 -> 4 -> 8, un niveau par ligne, de la face vers l'interieur : feuilles et repartiteurs L2 au-dessus des faces,
// relais et L1 6 m plus loin, relais et racine 12 m plus loin ; chaque repartiteur au milieu des centrales qu'il sert.
// Feuille 1 m en retrait de Input0, tournee comme lui (sortie a sa verticale) : ascenseur droit de 44 m. R4 (centrales
// des colonnes 3 a 7) : les places des colonnes 0 a 2 sont des feuilles fantomes, renvoyees a FR par la ligne L1 (paire
// 0-1) et la ligne des feuilles (colonne 2). Chaque repartiteur a exactement deux sorties raccordees.
const ZB = 4500, ZBF = 6500, XGB = -131000, XRB = Math.round((XK(3) + XK(4)) / 2);
async function barres() {
  const big = async (key, x, y, z, yaw) => build('barres ' + key, MRG, { x: Math.round(x), y: Math.round(y), z }, yaw, AIR);
  const spl = async (key, x, y, z, yaw) => build('barres ' + key, SPL, { x: Math.round(x), y: Math.round(y), z }, yaw, AIR);
  const L = (key, a, da, b, db, lift) => lien('barres ' + key, a, da, b, db, lift);
  const CAP = { E: 0, S: 90, O: 180, N: -90 }, OPP = { E: 'O', O: 'E', N: 'S', S: 'N' };
  // ligne droite de p0 a p1 (le long de x ou de y), relais tous les 46 m au plus, tournes dans le sens du flux
  async function ligne(key, from, fromDir, p0, p1, z, to, toDir) {
    const dir = Math.abs(p1.x - p0.x) > Math.abs(p1.y - p0.y) ? (p1.x < p0.x ? 'O' : 'E') : (p1.y < p0.y ? 'N' : 'S');
    const n = Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 4600) - 1;
    let prev = from, pd = fromDir;
    for (let j = 1; j <= n; j++) {
      const r = await big(key + ' relais ' + j, p0.x + (p1.x - p0.x) * j / (n + 1), p0.y + (p1.y - p0.y) * j / (n + 1), z, CAP[dir]);
      await L(key + ' ' + j, prev, pd, r, OPP[dir]);
      prev = r; pd = dir;
    }
    await L(key + ' fin', prev, pd, to, toDir);
  }
  const face = (r) => ROWS[r].y + 1988 * ROWS[r].f;
  const Y = (r, i) => face(r) - ROWS[r].f * (100 + 600 * i); // ligne i : 0 feuilles et L2, 1 L1, 2 racine
  const yC = { C12: (face('R1') + face('R2')) / 2, C34: (face('R3') + face('R4')) / 2 };
  const boucles = {};
  async function rangee(r) {
    const R = ROWS[r], OUT = R.f < 0 ? 'N' : 'S', IN = OPP[OUT];
    // places : Input0 lu en jeu ; fantomes (colonnes sans centrale) a leur place theorique
    const slots = [];
    for (let k = 0; k < 8; k++) {
      const C = st.actors[r + ' ' + k + ' centrale'];
      if (!R.ks.includes(k) || !C) { slots.push({ x: XK(k) + (R.yaw === 180 ? 200 : -200), fantome: true }); continue; }
      const c = (await call('connections', C)).find((q) => q.name === 'Input0');
      slots.push({ k, C, x: c.location.x - c.normal.x * 100, y: c.location.y - c.normal.y * 100 });
    }
    const xm = [0, 1, 2, 3].map((j) => (slots[2 * j].x + slots[2 * j + 1].x) / 2);
    const xh = [0, 1].map((h) => (xm[2 * h] + xm[2 * h + 1]) / 2);
    const relaisL1 = [];
    for (let j = 0; j < 4; j++) {
      const a = slots[2 * j], b = slots[2 * j + 1];
      if (a.fantome && b.fantome) { relaisL1.push(null); continue; }
      const S2 = await spl(r + ' L2.' + j, xm[j], Y(r, 0), ZB, CAP[OUT]);
      for (const [s, d] of [[a, 'O'], [b, 'E']]) {
        if (s.fantome) { boucles[r + ' ' + j] = { a: S2, dir: d, x: xm[j], y: Y(r, 0) }; continue; }
        const F = await big(r + ' feuille ' + s.k, s.x, s.y, ZB, CAP[OUT]);
        await L(r + ' L2.' + j + ' > ' + s.k, S2, d, F, OPP[d]);
        await L(r + ' ascenseur ' + s.k, F, OUT, s.C, 'Input0', true);
      }
      const M1 = await big(r + ' L1 relais ' + j, xm[j], Y(r, 1), ZB, CAP[OUT]);
      await L(r + ' L1 relais ' + j + ' > L2', M1, OUT, S2, IN);
      relaisL1.push(M1);
    }
    const relaisL0 = [];
    for (let h = 0; h < 2; h++) {
      const S1 = await spl(r + ' L1.' + h, xh[h], Y(r, 1), ZB, CAP[OUT]);
      for (const [j, d] of [[2 * h, 'O'], [2 * h + 1, 'E']]) {
        if (relaisL1[j]) await L(r + ' L1.' + h + ' > ' + j, S1, d, relaisL1[j], OPP[d]);
        else boucles[r + ' ' + j] = { a: S1, dir: d, x: xh[h], y: Y(r, 1) };
      }
      const M0 = await big(r + ' L0 relais ' + h, xh[h], Y(r, 2), ZB, CAP[OUT]);
      await L(r + ' L0 relais ' + h + ' > L1', M0, OUT, S1, IN);
      relaisL0.push(M0);
    }
    // racine tournee vers l'interieur : entree cote face, sorties le long de la ligne
    const RR = await spl(r + ' racine', XRB, Y(r, 2), ZB, CAP[IN]);
    await ligne(r + ' racine > 0', RR, 'O', { x: XRB, y: Y(r, 2) }, { x: xh[0], y: Y(r, 2) }, ZB, relaisL0[0], 'E');
    await ligne(r + ' racine > 1', RR, 'E', { x: XRB, y: Y(r, 2) }, { x: xh[1], y: Y(r, 2) }, ZB, relaisL0[1], 'O');
    return RR;
  }
  const RR = {};
  for (const r of Object.keys(ROWS)) RR[r] = await rangee(r);
  // FR et G0 a l'ouest de R4 ; boucles de R4 : paire 0-1 par la ligne L1 (relais LA), colonne 2 par la ligne des feuilles
  const FR = await big('FR', XGB, Y('R4', 0), ZB, CAP.S), LA = await big('boucle relais', XGB, Y('R4', 1), ZB, CAP.S);
  const b0 = boucles['R4 0'], b1 = boucles['R4 1'];
  await ligne('boucle 0', b0 && b0.a, b0 && b0.dir, b0 || {}, { x: XGB, y: Y('R4', 1) }, ZB, LA, 'E');
  await L('boucle relais > FR', LA, 'S', FR, 'N');
  await ligne('boucle 1', b1 && b1.a, b1 && b1.dir, b1 || {}, { x: XGB, y: Y('R4', 0) }, ZB, FR, 'E');
  const G0 = await spl('G0', XGB, yC.C34, ZB, CAP.S);
  await L('FR > G0', FR, 'S', G0, 'N');
  const G1 = { C12: await spl('G1 C12', XRB, yC.C12, ZB, CAP.E), C34: await spl('G1 C34', XRB, yC.C34, ZB, CAP.E) };
  await ligne('G0 > C34', G0, 'E', { x: XGB, y: yC.C34 }, { x: XRB, y: yC.C34 }, ZB, G1.C34, 'O');
  const W1 = await big('W1', XGB - 600, yC.C34, ZB, CAP.S), W2 = await big('W2', XGB - 600, yC.C12, ZB, CAP.E);
  await L('G0 > W1', G0, 'O', W1, 'E');
  await ligne('W1 > W2', W1, 'S', { x: XGB - 600, y: yC.C34 }, { x: XGB - 600, y: yC.C12 }, ZB, W2, 'N');
  await ligne('W2 > C12', W2, 'E', { x: XGB - 600, y: yC.C12 }, { x: XRB, y: yC.C12 }, ZB, G1.C12, 'O');
  for (const [c, rs] of [['C12', ['R1', 'R2']], ['C34', ['R3', 'R4']]]) {
    for (const r of rs) { const d = Y(r, 2) > yC[c] ? 'S' : 'N'; await L(c + ' > ' + r, G1[c], d, RR[r], OPP[d]); }
  }
  // arrivee a +65 m, au-dessus de tout l'arbre
  const u1 = pileState('module1-U1b'), u2 = pileState('module1-U2b');
  await L('U2 > U1', u2.parts['collecteur pile 0'], 'O', u1.parts['collecteur pile 1'], 'E');
  const MD = await big('MD', -93400, -249300, ZBF, 90);
  await L('U1 > MD', u1.parts['collecteur pile 0'], 'O', MD, 'E');
  const YA = -248700;
  const MW = await big('MW', -93400, YA, ZBF, CAP.O), MX = await big('MX', XGB, YA, ZBF, CAP.N);
  const MF = await big('MF', XGB, Y('R4', 0), ZBF, CAP.O);
  await L('MD > MW', MD, 'S', MW, 'N');
  await ligne('arrivee ouest', MW, 'O', { x: -93400, y: YA }, { x: XGB, y: YA }, ZBF, MX, 'E');
  await ligne('arrivee nord', MX, 'N', { x: XGB, y: YA }, { x: XGB, y: Y('R4', 0) }, ZBF, MF, 'S');
  await L('MF > FR', MF, 'O', FR, 'O', true);
}

// Arrivees des piles (produits non radioactifs : lignes a repartiteurs de pile.js) :
//  - cellules (U1c / U2c) : 0 = filactif (900 par groupe, une ligne chacun), 1 = silice, 2 = soufre ;
//  - barres d'uranium (U1b / U2b) : 0 = barres EM, 1 = oscillateurs, 2 = rotors ;
//  - barres de plutonium (PuB) : 0 = poutres, 1 = barres EM, 2 = dissipateurs ; cellules de plutonium (PuC) : 0 = beton.
// Chainage : queue de la ligne de U1 (sortie avant du repartiteur de la pile 1) -> tete de la meme ligne de U2 (entree
// arriere du repartiteur de la pile 0), 46 m en ligne droite ; une seule arrivee exterieure par produit.
const ARRIVEES = {
  'module1-U1c': ['filactif', 'silice', 'soufre'], 'module1-U2c': ['filactif', 'silice', 'soufre'],
  'module1-U1b': ['barres EM', 'oscillateurs', 'rotors'], 'module1-U2b': ['barres EM', 'oscillateurs', 'rotors'],
  'module1-PuB': ['poutres', 'barres EM', 'dissipateurs'], 'module1-PuC': ['beton'],
};
async function chainage() {
  for (const [u1, u2, lignes] of [['module1-U1c', 'module1-U2c', [1, 2]], ['module1-U1b', 'module1-U2b', [0, 1, 2]]]) {
    const a = pileState(u1), b = pileState(u2);
    for (const f of lignes) {
      await lien('arrivee ' + ARRIVEES[u1][f] + ' ' + u1 + ' > ' + u2, a.parts['arrivee ' + f + ' pile 1'], 'E', b.parts['arrivee ' + f + ' pile 0'], 'O');
    }
  }
}

// Trajet en l'air entre relais (fusionneurs) : chaque point est un relais tourne vers le point suivant ; meme z : convoyeur
// droit, relais intermediaires tous les 46 m au plus ; z different : ascenseur, le point suivant 4 m plus loin dans le
// sens de la marche (fusionneurs face a face, comme pile.js). Les points se suivent sur x ou sur y.
const CAP = { E: 0, S: 90, O: 180, N: -90 }, OPP = { E: 'O', O: 'E', N: 'S', S: 'N' };
const sens = (a, b) => (Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 'E' : 'O') : (b.y > a.y ? 'S' : 'N'));
// dir0 : sens de la marche en sortie de la source, quand fromDir est un nom de connecteur
async function trajet(key, from, fromDir, pts, to, toDir, dir0) {
  let prev = from, pd = fromDir;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[i + 1] || null;
    const out = q ? sens(p, q) : toDir ? OPP[toDir] : 'E';
    const dIn = i === 0 ? dir0 || fromDir : sens(pts[i - 1], p);
    const lift = i > 0 && pts[i - 1].z !== p.z;
    if (i > 0 && !lift) {
      // relais intermediaires entre pts[i - 1] et p
      const a = pts[i - 1], n = Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / 4600) - 1, d = sens(a, p);
      for (let j = 1; j <= n; j++) {
        const r = await build(key + ' ' + i + '.' + j, MRG, { x: Math.round(a.x + (p.x - a.x) * j / (n + 1)), y: Math.round(a.y + (p.y - a.y) * j / (n + 1)), z: p.z }, CAP[d], AIR);
        await lien(key + ' > ' + i + '.' + j, prev, pd, r, OPP[d]);
        prev = r; pd = d;
      }
    }
    const r = await build(key + ' ' + i, MRG, { x: p.x, y: p.y, z: p.z }, CAP[out], AIR);
    await lien(key + ' > ' + i, prev, pd, r, OPP[dIn], lift);
    prev = r; pd = out;
  }
  await lien(key + ' > fin', prev, pd, to, toDir);
}

// Filactif : deux piles de A3 (900/min chacune, sorties libres au pied, au sud, +65 m) -> tetes des arrivees 0 des
// cellules (58 m). Montee a +100 m (au-dessus des bandes, sous 64 m, et des arrivees des rangees A, 67 / 71 m) ;
// ligne A (pile 1 de A3 -> U1c) : ouest le long de y -229 100, nord le long de x -95 400 (entre le champ et le bloc) ;
// ligne B (pile 0 de A3 -> U2c) : ouest le long de y -229 600, nord le long de x -85 700 (entre les piles du plutonium,
// puis entre U1 et U2). Descente par ascenseur 4 m apres le dernier relais, puis tout droit vers la tete.
async function filactif() {
  const a3 = pileState('filactif-A3'), c1 = pileState('module1-U1c'), c2 = pileState('module1-U2c');
  const yh = -256705, yb = yh - 400;
  await trajet('filactif A', a3.parts['pile 1 sortie etage 0'], 'S', [
    { x: -81200, y: -229500, z: 6500 }, { x: -81200, y: -229100, z: 10000 }, { x: -95400, y: -229100, z: 10000 },
    { x: -95400, y: yh, z: 10000 }, { x: -95400, y: yb, z: 5800 },
  ], c1.parts['arrivee 0 pile 0'], 'O');
  await trajet('filactif B', a3.parts['pile 0 sortie etage 0'], 'S', [
    { x: -82800, y: -230000, z: 6500 }, { x: -82800, y: -229600, z: 10000 }, { x: -85700, y: -229600, z: 10000 },
    { x: -85700, y: yh, z: 10000 }, { x: -85700, y: yb, z: 5800 },
  ], c2.parts['arrivee 0 pile 0'], 'O');
}

// Oscillateurs (14,4/min) : sortie libre de l'atelier (fusionneur 2143726867, -110 400 ; -218 000 ; 65 m, vers l'ouest)
// -> relais 10 m a l'ouest (ascenseurs voisins entre 33 et 43 m) -> +110 m -> est le long de y -217 600 -> nord le long
// de x -95 000 (4 m a cote de la ligne A du filactif, 10 m plus haut) -> 70 m -> tete de l'arrivee 1 des barres de U1
// (chainee vers U2). Releve couloir.js : rien a moins de 10 m.
async function oscillateurs() {
  const src = PREFIX + 'Build_ConveyorAttachmentMerger_C_2143726867', b1 = pileState('module1-U1b');
  await trajet('oscillateurs', src, 'O', [
    { x: -111400, y: -218000, z: 6500 }, { x: -111400, y: -217600, z: 11000 }, { x: -95000, y: -217600, z: 11000 },
    { x: -95000, y: -253005, z: 11000 }, { x: -95000, y: -253405, z: 7000 },
  ], b1.parts['arrivee 1 pile 0'], 'O');
}

// Barres EM des barres d'uranium (48/min) : sortie libre du collecteur de E1 (fusionneur 2147070057, -127 700 ;
// -218 300 ; 65 m, vers l'ouest) -> +100 m -> est le long de y -217 000 (au sud du champ, 6 m au sud des oscillateurs)
// -> nord le long de x -95 800 (entre le champ, bord a -96 200, et la ligne A du filactif) -> 58 m -> tete de
// l'arrivee 0 des barres de U1 (chainee vers U2). Les barres EM des fabricants de plutonium (21,6) restent a faire.
async function barresEM() {
  const src = PREFIX + 'Build_ConveyorAttachmentMerger_C_2147070057', b1 = pileState('module1-U1b');
  await trajet('barres EM', src, 'O', [
    { x: -128600, y: -218300, z: 6500 }, { x: -128600, y: -217900, z: 10000 }, { x: -128600, y: -217000, z: 10000 },
    { x: -95800, y: -217000, z: 10000 }, { x: -95800, y: -253005, z: 10000 }, { x: -95800, y: -253405, z: 5800 },
  ], b1.parts['arrivee 0 pile 0'], 'O');
}

// Soufre des cellules (600/min) : sortie basse libre du tampon du quai q2 de N211 O119 (conteneur 2143664079, Output1,
// 4,5 m, vers le nord ; la sortie haute part deja vers l'acide sulfurique le long de x -122 279) -> relais 6 m au nord
// -> est a 4,5 m -> deux ascenseurs jusqu'a +95 m -> est le long de y -214 770 -> nord le long de x -94 200 -> 70 m ->
// tete de l'arrivee 2 des cellules de U1 (chainee vers U2). Releve couloir.js : rien sur le trace.
async function soufre() {
  const src = PREFIX + 'Build_StorageContainerMk2_C_2143664079', c1 = pileState('module1-U1c');
  await trajet('soufre', src, 'N', [
    { x: -122279, y: -214770, z: 449 }, { x: -119000, y: -214770, z: 449 }, { x: -118600, y: -214770, z: 5000 },
    { x: -118200, y: -214770, z: 9500 }, { x: -94200, y: -214770, z: 9500 }, { x: -94200, y: -257405, z: 9500 },
    { x: -94200, y: -257805, z: 7000 },
  ], c1.parts['arrivee 2 pile 0'], 'O');
}

// Silice (720/min) : quai « q3 silice 840/min » de N211 O96 (plateforme 2145698824, sorties libres) -> tampon au modele
// des autres quais (conteneur a quai.x - 300, y -213 770, cap 180 ; tampon a chaque quai de dechargement) ; sortie basse
// -> cellules (360) : relais 6 m au nord, deux ascenseurs jusqu'a +90 m, est le long de y -215 570, nord le long de
// x -93 800, 70 m, tete de l'arrivee 1 des cellules de U1 (chainee vers U2). Sortie haute : melangeurs (360).
async function silice() {
  const Q = PREFIX + 'Build_TrainDockingStation_C_2145698824', c1 = pileState('module1-U1c');
  const T = await build('silice tampon', 'Recipe_StorageContainerMk2_C', { x: -100424, y: -213770, z: 349 }, 180, AIR);
  await link('silice quai > tampon bas', 'Recipe_ConveyorBeltMk6_C', Q, 'Output0', T, 'Input0');
  await link('silice quai > tampon haut', 'Recipe_ConveyorBeltMk6_C', Q, 'Output1', T, 'Input1');
  // sorties du conteneur (releve sur le tampon du soufre) : Output1 a +1 m, Output2 a +5 m, vers le nord
  await trajet('silice cellules', T, 'Output1', [
    { x: -100424, y: -214770, z: 449 }, { x: -100424, y: -215170, z: 4900 }, { x: -100424, y: -215570, z: 9000 },
    { x: -93800, y: -215570, z: 9000 }, { x: -93800, y: -256705, z: 9000 }, { x: -93800, y: -257105, z: 7000 },
  ], c1.parts['arrivee 1 pile 0'], 'O', 'N');
}

// Silice des melangeurs (360/min, 22,5 chacun, Input1 a x +6 m) : le relais 4.6 de la ligne des cellules (+90 m, au sud
// du bloc) devient un repartiteur ; sa branche ouest descend a -12 m (3 ascenseurs, x -94 600), longe le bloc vers le
// nord (un repartiteur par rangee), puis une ligne par rangee a -12 m, 4 m devant les melangeurs (au-dessus des
// dechets a -16 m), repartiteur devant chaque Input1, ascenseur de 4 m jusqu'a lui. Non radioactif : lignes a
// repartiteurs.
async function siliceMelangeurs() {
  const XS2 = -94600, ZS = -1200;
  if (!st.actors['silice melangeurs SS']) {
    const at = (await call('pose', st.actors['silice cellules 4.6'])).location;
    if (!DRY) {
      for (const k of ['silice cellules > 4.6', 'silice cellules > 4.7']) { if (st.links[k]) { await call('dismantle', st.links[k], true); delete st.links[k]; save(); } }
      await call('dismantle', st.actors['silice cellules 4.6'], true); delete st.actors['silice cellules 4.6']; save();
      await new Promise((res) => setTimeout(res, 3000));
    }
    st.siliceSS = { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) }; save();
  }
  const SS = await build('silice melangeurs SS', SPL, st.siliceSS, -90, AIR);
  await lien('silice cellules 4.5 > SS', st.actors['silice cellules 4.5'], 'N', SS, 'S');
  await lien('silice SS > cellules 4.7', SS, 'N', st.actors['silice cellules 4.7'], 'S');
  const RS = [];
  for (const [i, c] of ACC_Y.entries()) RS.push(await build('silice rangee ' + i, i < 3 ? SPL : MRG, { x: XS2, y: c - 1100, z: ZS }, i < 3 ? -90 : 0, AIR));
  const y0 = st.siliceSS.y;
  await trajet('silice melangeurs', SS, 'O', [
    { x: XS2, y: y0, z: 9000 }, { x: XS2, y: y0 - 400, z: 5000 }, { x: XS2, y: y0 - 800, z: 1000 }, { x: XS2, y: y0 - 1200, z: ZS },
  ], RS[0], 'S');
  for (let i = 1; i < 4; i++) await lien('silice epine ' + (i - 1) + ' > ' + i, RS[i - 1], 'N', RS[i], 'S');
  for (const [i, c] of ACC_Y.entries()) {
    const y = c - 1100, pts = [['A', 'O', SPL], ['A', 'E', SPL], ['B', 'O', SPL], ['B', 'E', MRG]];
    let prev = RS[i], pd = 'E';
    for (const [col, s, kind] of pts) {
      const bx = ACC[col] + (s === 'O' ? -1000 : 1000), id = col + i + ' ' + s;
      const P = await build('silice ' + id, kind, { x: bx + 600, y, z: ZS }, kind === SPL ? 0 : 90, AIR);
      await lien('silice > ' + id, prev, pd, P, 'O');
      await lien('silice ' + id + ' > melangeur', P, 'S', st.actors[col + i + ' melangeur ' + s], 'Input1', true);
      prev = P; pd = 'E';
    }
  }
}

// Poutres des barres de plutonium (64,8/min) : sortie libre de la pile de fonderies (fusionneur 2143988244, -154 400 ;
// -214 900 ; 65 m, vers le nord) -> +130 m (au-dessus de tout, sous les poteaux de 134 m des oscillateurs) -> est le long
// de y -216 300 jusqu'a x -90 000 -> y -215 000 (les colonnes de sortie des piles de filactif A1, en y -216 300, montent
// jusqu'a 154 m) -> x -77 300 (entre les piles et la double voie nord-sud) -> nord -> 58 m -> ouest jusqu'a la tete de
// l'arrivee 0 des fabricants de barres de plutonium. Releve couloir.js.
async function poutres() {
  const src = PREFIX + 'Build_ConveyorAttachmentMerger_C_2143988244', pb = pileState('module1-PuB');
  await trajet('poutres', src, 'N', [
    { x: -154400, y: -215500, z: 6500 }, { x: -154400, y: -215900, z: 11000 }, { x: -154400, y: -216300, z: 13000 },
    { x: -90000, y: -216300, z: 13000 }, { x: -90000, y: -215000, z: 13000 }, { x: -77300, y: -215000, z: 13000 },
    { x: -77300, y: -242495, z: 13000 }, { x: -77300, y: -242895, z: 9400 }, { x: -77300, y: -243295, z: 5800 },
  ], pb.parts['arrivee 0 pile 0'], 'E');
}

// Relais d'une ligne remplace par un repartiteur (meme place, cap donne) : demontage du relais et de ses deux
// convoyeurs, pose, raccords d'entree et de sortie ; rend le repartiteur
async function relaisEnRepartiteur(key, relais, avant, apres, cap, dIn, dOut) {
  const pos = key + ' position';
  if (!st.actors[key] && !st[pos]) {
    const at = (await call('pose', st.actors[relais])).location;
    if (!DRY) {
      for (const k of [avant, apres]) { if (st.links[k]) { await call('dismantle', st.links[k], true); delete st.links[k]; save(); } }
      await call('dismantle', st.actors[relais], true); delete st.actors[relais]; save();
      await new Promise((res) => setTimeout(res, 3000));
    }
    st[pos] = { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) }; save();
  }
  return { at: st[pos], S: await build(key, SPL, st[pos], cap, AIR) };
}

// Barres EM des barres de plutonium (21,6/min) : le relais 3.7 de la ligne EM (-99 900 ; -217 000 ; +100 m) devient un
// repartiteur ; branche au sud jusqu'a y -214 000, est jusqu'a x -78 000 (7 m a l'ouest des poutres, entre les piles de
// barres et la double voie), nord, 70 m, ouest jusqu'a la tete de l'arrivee 1 des fabricants de plutonium.
async function barresEMPu() {
  const { S } = await relaisEnRepartiteur('barres EM SE', 'barres EM 3.7', 'barres EM > 3.7', 'barres EM > 3', 0);
  await lien('barres EM 3.6 > SE', st.actors['barres EM 3.6'], 'E', S, 'O');
  await lien('barres EM SE > 3', S, 'E', st.actors['barres EM 3'], 'O');
  const pb = pileState('module1-PuB');
  await trajet('barres EM Pu', S, 'S', [
    { x: -99900, y: -214000, z: 10000 }, { x: -78000, y: -214000, z: 10000 }, { x: -78000, y: -242895, z: 10000 },
    { x: -78000, y: -243295, z: 7000 },
  ], pb.parts['arrivee 1 pile 0'], 'E');
}

// Dissipateurs des barres de plutonium (36/min) : sortie libre de l'atelier du complexe alu (fusionneur 2143915401,
// -36 900 ; -286 700 ; 65 m, vers l'est) -> relais 6 m a l'est -> +100 m -> ouest le long de y -287 100 (6 m au nord des
// colonnes de sortie des piles du module alu, y -286 500) -> sud le long de x -76 600 (7 m des poutres, au-dessus de la
// voie) -> 70 m -> ouest jusqu'a la tete de l'arrivee 2 des fabricants de plutonium. L'atelier des dissipateurs etait a
// l'arret (sorties pleines) : remise en marche a verifier.
async function dissipateurs() {
  const src = PREFIX + 'Build_ConveyorAttachmentMerger_C_2143915401', pb = pileState('module1-PuB');
  await trajet('dissipateurs', src, 'E', [
    { x: -36300, y: -286700, z: 6500 }, { x: -36300, y: -287100, z: 10000 }, { x: -76600, y: -287100, z: 10000 },
    { x: -76600, y: -242995, z: 10000 }, { x: -76600, y: -242595, z: 7000 },
  ], pb.parts['arrivee 2 pile 0'], 'E');
}

// Beton des cellules de plutonium (432/min) : sortie basse libre de l'usine de beton (« bas beton 0 », Output1, -85 500 ;
// -151 400 ; 1 m, vers l'ouest ; la haute sert les poutres) -> 12 m a l'ouest (colonne d'eau a x -86 200) -> 8 m au nord
// (ligne de l'etage haut a +33 m, y -151 400) -> trois ascenseurs jusqu'a +115 m -> est jusqu'a x -84 000 -> nord sur 890 m
// (entre les piles de filactif A1-A3 et A4, au-dessus de la branche EM a 100 m, sous les poutres a 130 m) -> 60 m -> ouest
// jusqu'a la tete de l'arrivee 0 des assembleuses de plutonium. Releve couloir.js : rien sur le trace.
async function beton() {
  const us = JSON.parse(fs.readFileSync(path.join(__dirname, 'usine-beton-state.json'), 'utf8')), pc = pileState('module1-PuC');
  await trajet('beton', us.actors['bas beton 0'], 'O', [
    { x: -86700, y: -151400, z: 100 }, { x: -86700, y: -152200, z: 100 }, { x: -86700, y: -152600, z: 4500 },
    { x: -86700, y: -153000, z: 9000 }, { x: -86700, y: -153400, z: 11500 }, { x: -84000, y: -153400, z: 11500 },
    { x: -84000, y: -241595, z: 11500 }, { x: -84000, y: -241995, z: 7300 }, { x: -84000, y: -242395, z: 6000 },
  ], pc.parts['arrivee 0 pile 0'], 'E');
}

// Acide nitrique des melangeurs (216 m3/min, 13,5 chacun ; utilisateur, 28/10/2026 : « branche l'acide nitrique ») :
// jonction Lb de la ligne de N211 O96 q1 (gares-carburant.js : -91 000 ; -215 800 ; +16 m, sortie nord libre) -> montee
// verticale (jonctions debout, pompe Mk2 basse) a +67 m (raffineries des bandes : sommet a 62 m) -> nord le long de
// x -91 000 (releve couloir.js : rien a 8 m) -> descente verticale a y -241 400 (entre la bande 4 et le bloc) jusqu'a
// -8 m -> repartition est-ouest -> deux troncs a -8 m le long du bloc (x -93 900 a l'ouest de A, x -81 800 a l'est de
// B) -> par rangee, jonctions a -13 m, 14 m devant les faces (entre les dechets a -16 m et la silice a -12 m, a 1,2 m
// de la ligne de silice) -> PipeInputFactory1 (x -6 m). PipeInputFactory (x -2 m) reste libre pour l'acide sulfurique,
// qui passera sous ces lignes. Fluide non radioactif : lignes a jonctions.
// Jonctions a plat (cap 0) : Connection0 ouest, 1 est, 2 sud, 3 nord ; debout (cap -90, roulis -90) : 0 sud, 1 nord,
// 2 haut, 3 bas ; debout cap 0 : 0 ouest, 1 est, 2 haut, 3 bas.
const NIT = { x: -91000, yMontee: -216400, yDescente: -241400, zHaut: 6700, zBas: -800, zJ: -1300, xO: -93900, xE: -81800 };
async function nitrique() {
  const N = (k) => st.actors['nitrique ' + k];
  const J = (k, at, yaw, roll) => build('nitrique ' + k, REC.junction, at, yaw, roll ? Object.assign({ roll }, AIR) : AIR);
  const P = (k, a, an, b, bn) => link('nitrique ' + k, REC.pipe, a, an, b, bn);
  const Lb = PREFIX + 'Build_PipelineJunction_Cross_C_2146606899';
  const { x, zHaut, zBas } = NIT;
  // montee
  await J('NA', { x, y: NIT.yMontee, z: 1600 }, -90, -90);
  await J('NB', { x, y: NIT.yMontee, z: zHaut }, -90, -90);
  await P('Lb > NA', Lb, 'Connection3', N('NA'), 'Connection0');
  await P('montee', N('NA'), 'Connection2', N('NB'), 'Connection3');
  await pompe('nitrique pompe', st.links['nitrique montee'], 1700, 2300);
  // ligne haute, relais tous les 50 m
  const H = [N('NB')];
  for (let y = NIT.yMontee - 5000; y > NIT.yDescente; y -= 5000) H.push(await J('H ' + y, { x, y, z: zHaut }, 0));
  await J('ND', { x, y: NIT.yDescente, z: zHaut }, -90, -90);
  for (let i = 1; i < H.length; i++) await P('haut ' + i, H[i - 1], i === 1 ? 'Connection1' : 'Connection3', H[i], 'Connection2');
  await P('haut > ND', H[H.length - 1], H.length === 1 ? 'Connection1' : 'Connection3', N('ND'), 'Connection0');
  // descente (37 + 38 m : un tuyau fait 56 m au plus)
  await J('NM', { x, y: NIT.yDescente, z: 3000 }, -90, -90);
  await J('NE', { x, y: NIT.yDescente, z: zBas }, 0, -90);
  await P('descente 1', N('ND'), 'Connection3', N('NM'), 'Connection2');
  await P('descente 2', N('NM'), 'Connection3', N('NE'), 'Connection2');
  // repartition et troncs
  await J('O', { x: NIT.xO, y: NIT.yDescente, z: zBas }, 0);
  await J('E relais', { x: -86400, y: NIT.yDescente, z: zBas }, 0);
  await J('E', { x: NIT.xE, y: NIT.yDescente, z: zBas }, 0);
  await P('NE > O', N('NE'), 'Connection0', N('O'), 'Connection1');
  await P('NE > E relais', N('NE'), 'Connection1', N('E relais'), 'Connection0');
  await P('E relais > E', N('E relais'), 'Connection1', N('E'), 'Connection0');
  for (const [cote, xt] of [['O', NIT.xO], ['E', NIT.xE]]) {
    let prev = N(cote);
    const ys = [-245600].concat(ACC_Y.map((c) => c - 1400));
    for (const [n, y] of ys.entries()) {
      const k = n === 0 ? cote + ' relais 2' : cote + (n - 1);
      await J(k, { x: xt, y, z: zBas }, 0);
      await P(k, prev, 'Connection3', N(k), 'Connection2');
      prev = N(k);
    }
  }
  // branches des rangees : A depuis l'ouest (A O puis A E), B depuis l'est (B E puis B O)
  for (const [i, c] of ACC_Y.entries()) {
    for (const [cote, col, ordre, dIn, dOut] of [['O', 'A', ['O', 'E'], 'Connection0', 'Connection1'], ['E', 'B', ['E', 'O'], 'Connection1', 'Connection0']]) {
      let prev = N(cote + i), pd = dOut;
      for (const s of ordre) {
        const id = col + i + ' ' + s, bx = ACC[col] + (s === 'O' ? -1000 : 1000);
        await J(id, { x: bx - 600, y: c - 1400, z: NIT.zJ }, 0);
        await P(id, prev, pd, N(id), dIn);
        await P(id + ' > melangeur', N(id), 'Connection2', st.actors[col + i + ' melangeur ' + s], 'PipeInputFactory1');
        prev = N(id); pd = dOut;
      }
    }
  }
}
// Acide sulfurique des melangeurs (216 m3/min ; utilisateur, 28/10/2026 : « branche l'acide sulfurique », « tu peux passer
// dessous aussi au niveau des pompes a eau, ca sera moins encombre ») : tout en contrebas de la source, sans pompe.
// Bout est du collecteur de l'usine (acide-sulfurique.js, jonction de k 33 : -94 600 ; -233 200 ; +5 m, sortie nord
// libre) -> chute verticale a -14,5 m entre les bandes 3 et 4 -> est le long de y -234 200 -> nord le long de x -90 200
// sous la bande 4 (pas d'extracteur entre x -91 600 et -88 800) -> est le long de y -242 200 -> tronc a l'est du bloc
// (x -81 000) -> par rangee, une ligne a -14,5 m, 16,5 m devant les faces (sous les lignes du nitrique a -13 m, entre
// elles et l'eau des melangeurs de la rangee suivante a -15,25 m), d'est en ouest -> PipeInputFactory (x -2 m).
const SUL = { z: -1450, xPassage: -90200, yCouloir: -234200, yBloc: -242200, xTronc: -81000 };
async function sulfurique() {
  const N = (k) => st.actors['sulfurique ' + k];
  const J = (k, at, yaw, roll) => build('sulfurique ' + k, REC.junction, at, yaw, roll ? Object.assign({ roll }, AIR) : AIR);
  const P = (k, a, an, b, bn) => link('sulfurique ' + k, REC.pipe, a, an, b, bn);
  const usine = JSON.parse(fs.readFileSync(path.join(__dirname, 'acide-sulfurique-state.json'), 'utf8')).actors['acide -94600'];
  const { z } = SUL;
  // chute et passage sous la bande 4
  await J('SA', { x: -94600, y: SUL.yCouloir, z: 500 }, -90, -90);
  await J('SB', { x: -94600, y: SUL.yCouloir, z }, 0, -90);
  await J('SC', { x: SUL.xPassage, y: SUL.yCouloir, z }, 0);
  await J('SD', { x: SUL.xPassage, y: -238200, z }, 0);
  await J('SE', { x: SUL.xPassage, y: SUL.yBloc, z }, 0);
  await J('SF', { x: -85600, y: SUL.yBloc, z }, 0);
  await J('SG', { x: SUL.xTronc, y: SUL.yBloc, z }, 0);
  await P('usine > SA', usine, 'Connection3', N('SA'), 'Connection0');
  await P('chute', N('SA'), 'Connection3', N('SB'), 'Connection2');
  await P('SB > SC', N('SB'), 'Connection1', N('SC'), 'Connection0');
  await P('SC > SD', N('SC'), 'Connection3', N('SD'), 'Connection2');
  await P('SD > SE', N('SD'), 'Connection3', N('SE'), 'Connection2');
  await P('SE > SF', N('SE'), 'Connection1', N('SF'), 'Connection0');
  await P('SF > SG', N('SF'), 'Connection1', N('SG'), 'Connection0');
  // tronc
  let prev = N('SG');
  for (const [n, y] of [-245400].concat(ACC_Y.map((c) => c - 1650)).entries()) {
    const k = n === 0 ? 'S relais' : 'S' + (n - 1);
    await J(k, { x: SUL.xTronc, y, z }, 0);
    await P(k, prev, 'Connection3', N(k), 'Connection2');
    prev = N(k);
  }
  // lignes des rangees, d'est en ouest : B E, B O, A E, A O
  for (const [i, c] of ACC_Y.entries()) {
    let prev = N('S' + i);
    for (const [col, s] of [['B', 'E'], ['B', 'O'], ['A', 'E'], ['A', 'O']]) {
      const id = col + i + ' ' + s, bx = ACC[col] + (s === 'O' ? -1000 : 1000);
      await J(id, { x: bx - 200, y: c - 1650, z }, 0);
      await P(id, prev, 'Connection0', N(id), 'Connection1');
      await P(id + ' > melangeur', N(id), 'Connection2', st.actors[col + i + ' melangeur ' + s], 'PipeInputFactory');
      prev = N(id);
    }
  }
}

// Courant d'une pompe (acide nitrique, tampon d'eau des melangeurs) ou d'un extracteur ajoute apres coup : cable vers le
// poteau alimente le plus proche qui a une place (100 m au plus)
async function pompeCourant(key) {
  const pump = st.actors[key];
  if (!pump || DRY || st.wires[key]) return;
  const at = (await call('pose', pump)).location;
  const poles = (await call('scan', 'FGBuildablePowerPole', at, 10000, 30, {})).items.sort((a, b) => a.distance - b.distance);
  for (const it of poles) {
    const pw = await call('power', it.path);
    if (!pw.wires || pw.wires >= pw.maxWires) continue;
    const w = await call('wire', it.path, pump, {});
    if (w.built) { st.wires[key] = w.actor || true; save(); console.log((key + ' courant').padEnd(34), short(it.path), Math.round(it.distance / 100), 'm'); return; }
  }
  throw new Error(key + ' : aucun poteau alimente libre a 100 m');
}

// Rotors (169/min ; utilisateur, 28/10/2026 : « fais les rotors maintenant ») : quai q4 de N211 O143 (2145675841, un seul
// objet : tampon au modele, pas de trieur) -> sortie haute du tampon -> montee sur place a +118 m (3 ascenseurs) -> est le
// long de y -216 800 (au-dessus des arrivees a 90-110 m, sous les poutres a 130 m) -> nord le long de x -93 000 (8 m a
// l'ouest des piles U, a l'est du faisceau des arrivees) -> descente a +64 m (entre les lignes des oscillateurs a 70 m et
// des barres EM a 58 m, qui croisent x -93 000 vers y -253 200) -> +58 m -> tete de l'arrivee 2 des barres de U1, par
// l'ouest. Releve couloir.js : rien a 6 m.
async function rotors() {
  const Q = PREFIX + 'Build_TrainDockingStation_C_2145675841', b1 = pileState('module1-U1b');
  const T = await build('rotors tampon', 'Recipe_StorageContainerMk2_C', { x: -148934, y: -213770, z: 349 }, 180, AIR);
  await link('rotors quai > tampon bas', 'Recipe_ConveyorBeltMk6_C', Q, 'Output0', T, 'Input0');
  await link('rotors quai > tampon haut', 'Recipe_ConveyorBeltMk6_C', Q, 'Output1', T, 'Input1');
  await trajet('rotors', T, 'Output2', [
    { x: -148934, y: -214700, z: 849 }, { x: -148934, y: -215100, z: 5600 }, { x: -148934, y: -215500, z: 10300 },
    { x: -148934, y: -215900, z: 11800 }, { x: -148934, y: -216800, z: 11800 }, { x: -93000, y: -216800, z: 11800 },
    { x: -93000, y: -251505, z: 11800 }, { x: -93000, y: -251905, z: 7000 }, { x: -93000, y: -252305, z: 6400 },
    { x: -93000, y: -253305, z: 6400 }, { x: -93000, y: -253705, z: 5800 },
  ], b1.parts['arrivee 2 pile 0'], 'O', 'N');
}

// Piles de la filiere uranium (pile.js, montage des paires de l'utilisateur du 25/10/2026 : « j'enverrais directement la
// sortie d'un fabricant cellules vers un fabricant barre U ») : 2 groupes (filactif 1 800/min : 900 par groupe, une
// ligne Mk6 chacun) de 2 paires ; cellules (4 entrees, Input1 = uranium, libre : arbre par etage, pas de colonne) dos au
// nord a y -255 000, barres 37 m au sud (Input2 directe depuis les cellules ; collecteur vers l'ouest)
const TOP = 6400, YCEL = -255000;
const GROUPES_U = { U1: -90000, U2: -83000 };
function cfgPile(nom, extra) {
  return Object.assign({ nom, plateforme: { origine: { x: 0, y: YCEL }, cap: 0, dessus: TOP }, dos: '-y', piles: 2, etages: 6, pas: 24, espacement: 14, enLAir: true }, extra);
}
// Courant des piles : 2 poteaux par configuration (un par pile, 6 machines + chaine), a +84 m entre les deux piles ;
// cellules 12 m devant les machines (entre elles et les colonnes des barres), barres 26 m devant (au-dela du collecteur).
// U1 se raccorde au poteau du bloc sous elle (88 m), U2 au poteau 1 de U1 (62 m).
const CFG_U = Object.entries(GROUPES_U).flatMap(([g, x]) => [
  ['module1-' + g + 'c', { recette: 'Recipe_Alternate_UraniumCell_1_C', centre: [x / 100, 0], libres: ['Input1'], sortie: 'directe',
    arrivees: [{ entree: 'Input0', hauteur: -6, sens: '+lx', mode: 'ascenseur' }, { entree: 'Input3', hauteur: 6, sens: '+lx', mode: 'ascenseur' }, { entree: 'Input2', hauteur: 6, sens: '+lx', mode: 'ascenseur' }],
    poteaux: [[-4, 12, 20], [4, 12, 20]], reseauDe: g === 'U1' ? { cle: 'B2 poteau' } : { pile: 'module1-U1c', poteau: 'poteau 1' } }],
  ['module1-' + g + 'b', { recette: 'Recipe_Alternate_NuclearFuelRod_1_C', centre: [x / 100 + 2, 37], directes: [{ entree: 'Input2', depuis: 'module1-' + g + 'c', sortie: 'Output0' }],
    arrivees: [{ entree: 'Input0', hauteur: -6, sens: '+lx', mode: 'ascenseur' }, { entree: 'Input3', hauteur: 6, sens: '+lx', mode: 'ascenseur' }, { entree: 'Input1', hauteur: -6, sens: '+lx', mode: 'ascenseur' }],
    collecteur: { sens: '-lx' },
    poteaux: [[-4, 26, 20], [4, 26, 20]], reseauDe: g === 'U1' ? { cle: 'B1 poteau' } : { pile: 'module1-U1b', poteau: 'poteau 1' } }],
]);
// Piles du plutonium (meme regime de 90 % que les melangeurs et les accelerateurs : 216 granules = 24 x 9, 108 cellules =
// 16 x 6,75 ; arbres sans boucle) a +64 m au sud des piles de l'uranium, dos au sud (arbres et colonnes au sud, sorties et
// collecteurs au nord), entre le champ et la double voie (x -96 000 a -77 000, rien au-dessus des centrales) :
//  - cellules : 3 piles de 8 assembleuses (Input1 = granules, libre : arbre ; beton en colonne, arrivee a -4 m) ; le
//    collecteur part vers l'est, vers les barres ;
//  - barres : 2 piles de 8 fabricants (Input1 = cellules, libre : arbre ; poutres, barres EM, dissipateurs en colonnes) ;
//    collecteur vers l'est (broyeur).
const YPU = -245000;
const CFG_PU = [
  ['module1-PuC', { recette: 'Recipe_PlutoniumCell_C', centre: [-882, (YPU - YCEL) / 100], dos: 'y', piles: 3, etages: 8, pas: 16, espacement: 10,
    libres: ['Input1'], arrivees: [{ entree: 'Input0', hauteur: -4, sens: '+lx' }], collecteur: { sens: '-lx' },
    poteaux: [[-16, 20, 20], [0, 20, 20], [16, 20, 20]], reseauDe: { pile: 'module1-U1b', poteau: 'poteau 0' } }],
  ['module1-PuB', { recette: 'Recipe_PlutoniumFuelRod_C', centre: [-810, (YPU - YCEL) / 100], dos: 'y', piles: 2, etages: 8, pas: 24, espacement: 14,
    libres: ['Input1'], collecteur: { sens: '-lx' },
    arrivees: [{ entree: 'Input0', hauteur: -6, sens: '+lx', mode: 'ascenseur' }, { entree: 'Input3', hauteur: 6, sens: '+lx', mode: 'ascenseur' }, { entree: 'Input2', hauteur: 6, sens: '+lx', mode: 'ascenseur' }],
    poteaux: [[-12, 26, 20], [12, 26, 20]], reseauDe: { pile: 'module1-U2b', poteau: 'poteau 0' } }],
];
async function pilesPhase(list, steps) {
  const { execFileSync } = require('child_process');
  for (const [nom, extra0] of list) {
    const file = path.join(__dirname, nom + '-config-state.json');
    const { reseauDe, ...extra } = extra0;
    if (reseauDe && reseauDe.cle) extra.reseau = st.actors[reseauDe.cle];
    if (reseauDe && reseauDe.pile) {
      const f = path.join(__dirname, reseauDe.pile + '-pile-state.json');
      extra.reseau = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).poles[reseauDe.poteau] : undefined;
    }
    fs.writeFileSync(file, JSON.stringify(cfgPile(nom, extra), null, 1));
    for (const s of steps) {
      let out;
      try { out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 }); }
      catch (err) { out = String(err.stdout || '') + String(err.stderr || ''); console.log((nom + ' ' + s).padEnd(28), 'ECHEC', out.split('\n').filter((l) => l.trim()).slice(-3).join(' / ')); throw new Error(nom + ' ' + s); }
      const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
      console.log((nom + ' ' + s).padEnd(28), bad.length ? bad.slice(0, 3).join(' / ') : 'ok');
      if (process.argv.includes('--verbose')) console.log(out);
    }
  }
}

const PHASES = {
  async melangeur16() { await melangeur16(); },
  async uranium() { await uranium(); },
  async arriveeUranium() { await arriveeUranium(); },
  async reglagesPu() { await reglagesPu(); },
  async granules() { await granules(); },
  async cellulesPu() { await cellulesPu(); },
  async broyeur() { await broyeur(); },
  // node module-nuke1.js nonFissile [A3,B3] [--dry]
  async nonFissile() { const a = process.argv[3]; await nonFissile(a && !a.startsWith('--') ? a.split(',') : null); },
  async barres() { await barres(); },
  async chainage() { await chainage(); },
  async filactif() { await filactif(); },
  async oscillateurs() { await oscillateurs(); },
  async barresEM() { await barresEM(); },
  async soufre() { await soufre(); },
  async silice() { await silice(); },
  async siliceMelangeurs() { await siliceMelangeurs(); },
  async poutres() { await poutres(); },
  async barresEMPu() { await barresEMPu(); },
  async dissipateurs() { await dissipateurs(); },
  async beton() { await beton(); },
  async nitrique() { await nitrique(); await pompeCourant('nitrique pompe'); },
  async sulfurique() { await sulfurique(); },
  async rotors() { await rotors(); },
  // node module-nuke1.js pilesPu [etapes] [--dry]
  async pilesPu() {
    const a = process.argv.slice(3).filter((x) => !x.startsWith('--'));
    await pilesPhase(CFG_PU, (a[0] || 'machines,raccords,branches,ascenseurs,arrivees,collecteur,recettes,courant').split(','));
  },
  // node module-nuke1.js dechets [collecte,racine,melangeurs,accelerateurs] [--dry]
  // node module-nuke1.js dechetsArbre [pieces,liens] [--dry]
  async dechetsArbre() { const a = process.argv[3]; await dechetsArbre(a && !a.startsWith('--') ? a.split(',') : ['pieces', 'liens']); },
  // node module-nuke1.js dechetsCellules [A0,..,B3] [--dry]
  async dechetsCellules() {
    const a = process.argv[3];
    for (const c of a && !a.startsWith('--') ? a.split(',') : CELLS_A.map((x) => x.id)) await dechetsCellule(c);
  },
  async dechets() {
    const a = process.argv.slice(3).filter((x) => !x.startsWith('--'));
    const steps = { collecte: dechetsCollecte, racine: dechetsRacine, melangeurs: dechetsMelangeurs, accelerateurs: dechetsAccelerateurs };
    for (const s of (a[0] || Object.keys(steps).join(',')).split(',')) await steps[s]();
  },
  // node module-nuke1.js pilesU [etapes] [--dry] [--verbose]
  async pilesU() {
    const a = process.argv.slice(3).filter((x) => !x.startsWith('--'));
    await pilesPhase(CFG_U, (a[0] || 'machines,raccords,branches,directes,ascenseurs,arrivees,collecteur,recettes').split(','));
  },
  async bloc() { for (const c of CELLS_A) await celluleAcc(c); await courantBloc(); },
  async courantBloc() { await courantBloc(); },
  async eauMelangeurs() { await eauMelangeurs(); },
  async tamponSudDemonte() { if (!DRY) await demonterTamponSud(); },
  async essai() { await cellule('R1', 7); },
  // une cellule : node module-nuke1.js cellule R2 7
  async cellule() { const r = process.argv[3], k = Number(process.argv[4]); await cellule(r, k); await courant(r, k); },
  // d'est en ouest (le reseau arrive par l'est, chaque poteau se raccorde a son voisin)
  async champ() {
    const list = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3].split(',') : Object.keys(ROWS);
    for (const r of list) for (const k of [...ROWS[r].ks].reverse()) { await cellule(r, k); await courant(r, k); }
  },
};

(async () => {
  const phase = process.argv[2];
  if (!PHASES[phase]) throw new Error('phase inconnue : ' + phase + ' (' + Object.keys(PHASES).join(' | ') + ')');
  await PHASES[phase]();
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
