// Trieur generique en sortie de quai de dechargement (utilisateur, 28/10/2026 : « il faut un layout generique, donc
// possiblement plus de 2 composants a trier », « le tampon a la sortie du quai ne sert a rien quand il y a un trieur
// derriere ») : tout le montage au sol tient dans la voie du quai (16 m), en modules de 25 m vers l'avant, un par objet.
//  - file a la hauteur de la sortie basse du quai, sur son axe : S1 4,3 m apres la sortie, puis par objet k :
//    S(k) (objet k -> a droite, le reste tout droit), M(k) 5 m plus loin (reunit la file et le trop-plein de BR(k)) ;
//  - colonne 5 m a droite de la file : BR(k) (tout au centre, trop-plein -> M(k)), conteneur C(k) dans l'axe de la
//    colonne (11 m de long, 5 m de large ; c'est lui le tampon), sortie haute (+8,5 m) -> R(k) -> ascenseur -> T(k) a la
//    hauteur de transit de l'objet (14 m au moins : au-dessus des conteneurs des voies voisines, 11,5 m ; une hauteur par
//    objet pour que les lignes ne se croisent jamais au meme niveau). T(k) est la tete libre de la ligne de l'objet ;
//  - broyeur au bout de la file : objets non prevus et trop-pleins.
// Ecarts du trieur valide de N211 O143 q3 (27/10/2026) : 5 m entre pieces, boites separees d'au moins 50 cm.
// Regles des repartiteurs intelligents (sorties : 0 = centre, 1 = Output2, 2 = Output3) : S(k) [non defini -> centre,
// objet -> Output2 (droite)] ; BR(k) [tout -> centre, trop-plein -> Output3 (gauche, vers la file)].
// Sortie de T(k) : vers l'avant par defaut, ou vers un point cardinal (N, S, E, O) pour partir droit vers le consommateur
// (utilisateur, 28/10/2026 : « c'est un peu le bordel dans l'approche acier et caoutchouc, simplifie ca ») ; prendre la
// hauteur de transit a la hauteur ou la ligne entre chez le consommateur, plutot que redescendre puis remonter.
// Variante compacte (--compact ; utilisateur, 28/10/2026 : « orienter les conteneurs a 90° quitte a placer les splitters
// au-dessus, ca devrait tenir dans une lane de quai ») : 5,5 m par objet. La sortie basse du quai monte a +13,5 m (R0, R1),
// file de repartiteurs programmables P(k) au-dessus des conteneurs couches en travers de la voie (11 m sur 16, entrees a
// gauche, sorties a droite). P(k) : objet k a gauche, le reste et le trop-plein tout droit (un repartiteur programmable
// accepte plusieurs regles par sortie : plus de BR ni de M). Ascenseur de la sortie gauche de P(k) dans l'entree haute de
// C(k) (meme aplomb, meme cote) ; ascenseur de la sortie haute de C(k) dans l'entree droite de T(k), tete de ligne vers
// l'avant a sa hauteur (24 m au moins, au-dessus de la tour du broyeur ; la plus haute pour le 1er objet, pour que les
// lignes ne croisent aucune colonne). Broyeur au bout, sous la file (F, ascenseur). T(k) peut aussi sortir vers la gauche
// ou vers le quai (sens), jamais vers la droite : l'ascenseur du conteneur arrive par ce cote.
// Deux sorties (--compact --deux-sorties ; utilisateur, 28/10/2026 : « on pourrait avoir des repartiteurs au-dessus et sous
// les conteneurs ») : conteneurs releves de 5 m, la sortie basse du quai file tout droit dessous (Pb(k), a sa hauteur), la
// sortie haute monte dessus (R0, R1, P(k), 5 m plus haut). Ascenseur de la sortie gauche de Pb(k) dans l'entree basse de
// C(k) : meme colonne que celui de P(k) dans l'entree haute, sans chevauchement. Restes : FH (en haut, tourne vers la
// gauche) descend par ascenseur dans l'entree gauche de FB (en bas), FB -> broyeur, avance d'1 m.
// usage : node trieur.js <quai> <objet:hauteur_m[:sens]>[,...] [--dry]
//         node trieur.js <quai> <objet[:hauteur_m[:sens]]>[,...] --compact [--deux-sorties] [--dry]
//   quai : acteur (Build_TrainDockingStation_C_...) ; objet : motif cherche dans l'inventaire du quai (Rotor, SteelIngot)
//   ou chemin de classe complet ; sens : N, S, E ou O (pas vers le quai). ex. node trieur.js <quai> SteelIngot:40:O,Rubber:52.5:E
// Etat : trieur-<quai>-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const SOFT = 'FGCDEncroachingSoftClearance';
const REC = {
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  smart: 'Recipe_ConveyorAttachmentSplitterSmart_C', box: 'Recipe_StorageContainerMk2_C', sink: 'Recipe_ResourceSink_C',
  prog: 'Recipe_ConveyorAttachmentSplitterProgrammable_C',
};
// geometrie d'un module, en cm, le long de l'avant (a) et vers la droite (b) depuis la sortie basse du quai
const G = { s1: 430, pas: 2500, m: 500, b: 500, c: 1300, r: 2200, t: 2600, broyeur: 3550, bBroyeur: 100 };
// variante compacte : R0 / R1 (montee), P(k) tous les 5,5 m sur l'axe a +13,5 m, conteneur centre au milieu de la voie
// (b +3 m : entrees a b -1 m, sorties a b +7 m), T(k) a b +6 m, F au-dessus de l'entree du broyeur (b +1 m)
// (deux sorties : conteneurs et file du haut releves de dz, broyeur a broyeur2 de FB pour 1 m entre les boites)
const GC = { r0: 500, r1: 900, p1: 1450, pas: 550, zf: 1350, bc: 300, bt: 600, f: 550, broyeur: 900, bBroyeur: 100, zt: 2400, dzt: 400, dz: 500, broyeur2: 1000 };
const COMPACT = process.argv.includes('--compact');
const DEUX = process.argv.includes('--deux-sorties');

const args = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const QUAI = args[0] && (args[0].startsWith('/') ? args[0] : PREFIX + args[0]);
const OBJETS = (args[1] || '').split(',').filter(Boolean).map((s) => { const [motif, h, sens] = s.split(':'); return { motif, z: Math.round(Number(h) * 100), sens }; });
const CAP = { E: 0, S: 90, O: 180, N: -90 }, DIR = { E: [1, 0], S: [0, 1], O: [-1, 0], N: [0, -1] };
// entree libre d'une piece tournee vers (vx, vy)
async function entree(actor, vx, vy) {
  const l = (await call('connections', actor)).filter((c) => c.direction === 'input' && !c.connected).sort((a, b) => (b.normal.x * vx + b.normal.y * vy) - (a.normal.x * vx + a.normal.y * vy));
  if (!l.length || l[0].normal.x * vx + l[0].normal.y * vy < 0.7) throw new Error('aucune entree libre tournee vers ' + vx + ',' + vy + ' sur ' + short(actor));
  return l[0].name;
}

const FILE = QUAI && path.join(__dirname, 'trieur-' + short(QUAI).replace(/^Build_TrainDockingStation_C_/, 'quai-') + '-state.json');
const st = FILE && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'rules']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(30), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { console.log(key.padEnd(30), 'a construire'); return null; }
  let r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  if (!r.built && r.blocking && r.blocking.length === 1 && r.blocking[0] === SOFT) {
    const o = Object.assign({}, opts || {}, { ignore: [SOFT] });
    const t = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({}, o, { dryRun: true }));
    if (!(t.blocking && t.blocking.length)) { console.log(key.padEnd(30), 'degagement souple seul en cause, accepte'); r = DRY ? t : await call('belt', recipe, from, fromName, { path: to, name: toName }, o); }
  }
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
async function rules(key, actor, list) {
  if (st.rules[key] || DRY || !actor) return;
  const r = await call('smartRules', actor, list);
  st.rules[key] = true; save();
  console.log(('regles ' + key).padEnd(30), JSON.stringify(r.rules).replace(/\/Game\/FactoryGame\/[^"]*\./g, ''));
}
// classe d'objet : chemin complet, ou motif cherche dans l'inventaire du quai
async function classe(motif) {
  if (motif.startsWith('/Game/')) return motif;
  const inv = (await call('dump', QUAI, 1, 1, ['mInventory'])).mInventory;
  const s = await call('dump', inv, 4, 60, ['mInventoryStacks']);
  const it = (s.mInventoryStacks || []).find((x) => x.NumItems && new RegExp(motif).test(String(x.Item.ItemClass)));
  if (!it) throw new Error('objet ' + motif + ' absent du quai : donner le chemin de classe complet');
  return String(it.Item.ItemClass);
}
// courant du broyeur : poteau alimente le plus proche qui a une place (100 m au plus)
async function courant(sink) {
  if (DRY || !sink || st.links['cable broyeur']) return;
  if ((await call('power', sink)).wires > 0) { st.links['cable broyeur'] = true; save(); return; }
  const at = (await call('pose', sink)).location;
  const poles = (await call('scan', 'FGBuildablePowerPole', at, 10000, 30, {})).items.sort((a, b) => a.distance - b.distance);
  for (const it of poles) {
    const pw = await call('power', it.path);
    if (!pw.wires || pw.wires >= pw.maxWires) continue;
    const w = await call('wire', it.path, sink, {});
    if (w.built) { st.links['cable broyeur'] = w.actor || true; save(); console.log('cable broyeur'.padEnd(30), short(it.path), Math.round(it.distance / 100), 'm'); return; }
  }
  throw new Error('broyeur : aucun poteau alimente libre a 100 m');
}

// Variante compacte (voir l'en-tete) ; P(a, b, z) : repere du quai, cap : cap de l'avant, Z / Z1 : hauteur des sorties
// basse / haute du quai, d : vecteur vers la droite
async function compact(P, cap, Z, Z1, d) {
  const dz = DEUX ? GC.dz : 0, ZC = Z - 100 + dz, ZP = GC.zf + dz, n = OBJETS.length;
  const R0 = await build('R0', REC.merger, P(GC.r0, 0, DEUX ? Z1 : Z), cap);
  const R1 = await build('R1', REC.merger, P(GC.r1, 0, ZP), cap);
  await link('quai > R0', REC.belt, QUAI, DEUX ? 'Output1' : 'Output0', R0, 'Input1');
  await link('R0 > R1', REC.lift, R0, 'Output1', R1, 'Input1', { snapTolerance: 400 });
  let prev = R1, prevB = QUAI, prevBOut = 'Output0';
  const regles = (item) => [{ item: 'undefined', output: 0 }, { item: 'overflow', output: 0 }, { item, output: 2 }];
  for (const [k, o] of OBJETS.entries()) {
    const a = GC.p1 + GC.pas * k, i = k + 1;
    const item = st.rules['P' + i] && (!DEUX || st.rules['Pb' + i]) ? null : await classe(o.motif);
    const Pk = await build('P' + i, REC.prog, P(a, 0, ZP), cap);
    const C = await build('C' + i, REC.box, P(a, GC.bc, ZC), cap);
    const T = await build('T' + i, REC.merger, P(a, GC.bt, o.z), o.sens ? CAP[o.sens] : cap);
    await link((i === 1 ? 'R1' : 'P' + k) + ' > P' + i, REC.belt, prev, 'Output1', Pk, 'Input1');
    // sortie gauche de P(k) a l'aplomb de l'entree haute de C(k), meme cote ; sortie haute de C(k) a l'aplomb de
    // l'entree de T(k) tournee vers la droite (droite si T sort vers l'avant, arriere vers la gauche, gauche vers le quai)
    await link('P' + i + ' > C' + i, REC.lift, Pk, 'Output3', C, 'Input1', { snapTolerance: 400 });
    await link('C' + i + ' > T' + i, REC.lift, C, 'Output2', T, T && !DRY ? await entree(T, d.x, d.y) : 'Input2', { snapTolerance: 400 });
    await rules('P' + i, Pk, regles(item));
    prev = Pk;
    if (!DEUX) continue;
    // file du bas : sortie gauche de Pb(k) a l'aplomb de l'entree basse de C(k)
    const B = await build('Pb' + i, REC.prog, P(a, 0, Z), cap);
    await link((i === 1 ? 'quai' : 'Pb' + k) + ' > Pb' + i, REC.belt, prevB, prevBOut, B, 'Input1');
    await link('Pb' + i + ' > C' + i, REC.lift, B, 'Output3', C, 'Input0', { snapTolerance: 400 });
    await rules('Pb' + i, B, regles(item));
    prevB = B; prevBOut = 'Output1';
  }
  const aF = GC.p1 + GC.pas * (n - 1) + GC.f;
  let K;
  if (!DEUX) {
    const F = await build('F', REC.merger, P(aF, GC.bBroyeur, GC.zf), cap);
    K = await build('broyeur', REC.sink, P(aF + GC.broyeur, GC.bBroyeur, ZC), cap + 90);
    await link('P' + n + ' > F', REC.belt, prev, 'Output1', F, 'Input1');
    await link('F > broyeur', REC.lift, F, 'Output1', K, 'Input0', { snapTolerance: 400 });
  } else {
    // FH tourne vers la gauche : la file du haut entre par son cote (entree gauche, tournee vers le quai) et sa sortie
    // est a l'aplomb de l'entree gauche de FB
    const FH = await build('FH', REC.merger, P(aF, GC.bBroyeur, ZP), cap - 90);
    const FB = await build('FB', REC.merger, P(aF, GC.bBroyeur, Z), cap);
    K = await build('broyeur', REC.sink, P(aF + GC.broyeur2, GC.bBroyeur, Z - 100), cap + 90);
    await link('P' + n + ' > FH', REC.belt, prev, 'Output1', FH, 'Input3');
    await link('Pb' + n + ' > FB', REC.belt, prevB, prevBOut, FB, 'Input1');
    await link('FH > FB', REC.lift, FH, 'Output1', FB, 'Input3', { snapTolerance: 400 });
    await link('FB > broyeur', REC.belt, FB, 'Output1', K, 'Input0');
  }
  await courant(K);
}

(async () => {
  if (!QUAI || !OBJETS.length) throw new Error('usage : node trieur.js <quai> <objet:hauteur_m>[,...] [--compact] [--dry]');
  if (COMPACT) {
    // hauteurs par defaut : la plus basse (24 m) pour le dernier objet, 4 m de plus par objet en remontant la file
    OBJETS.forEach((o, k) => { if (!(o.z > 0)) o.z = GC.zt + GC.dzt * (OBJETS.length - 1 - k); });
    if (OBJETS.some((o) => o.z < GC.zt)) throw new Error('variante compacte : hauteur de transit sous 24 m (tour du broyeur)');
  }
  if (DEUX && !COMPACT) throw new Error('--deux-sorties : variante compacte seulement');
  if (OBJETS.some((o) => !(o.z >= 1400))) throw new Error('hauteur de transit manquante ou sous 14 m');
  if (OBJETS.some((o) => o.sens && !CAP.hasOwnProperty(o.sens))) throw new Error('sens de sortie : N, S, E ou O');
  const outs = await call('connections', QUAI);
  const out = outs.find((c) => c.name === 'Output0'), out1 = outs.find((c) => c.name === 'Output1');
  if (out.connected && !st.links['quai > S1'] && !st.links[DEUX ? 'quai > Pb1' : 'quai > R0']) throw new Error('sortie basse du quai deja raccordee : demonter son montage avant');
  if (DEUX && out1.connected && !st.links['quai > R0']) throw new Error('sortie haute du quai deja raccordee : demonter son montage avant');
  // repere : origine a la sortie basse, a vers l'avant (normale de la sortie), b vers la droite
  const O = out.location, f = { x: Math.round(out.normal.x), y: Math.round(out.normal.y) }, d = { x: -f.y, y: f.x };
  const cap = Math.round(Math.atan2(f.y, f.x) * 180 / Math.PI);
  const P = (a, b, z) => ({ x: O.x + f.x * a + d.x * b, y: O.y + f.y * a + d.y * b, z });
  const Z = Math.round(O.z), ZC = Z - 100, ZR = Z + 400;
  st.quai = QUAI; st.objets = OBJETS; save();
  if (COMPACT && OBJETS.some((o) => o.sens && DIR[o.sens][0] === d.x && DIR[o.sens][1] === d.y)) throw new Error('variante compacte : pas de sortie vers la droite (l\'ascenseur du conteneur y arrive)');
  if (COMPACT) return compact(P, cap, Z, Math.round(out1.location.z), d);
  let prev = QUAI, prevOut = 'Output0';
  for (const [k, o] of OBJETS.entries()) {
    const a0 = G.s1 + G.pas * k, n = k + 1;
    const item = st.rules['S' + n] ? null : await classe(o.motif); // regles deja posees : classe inutile
    const S = await build('S' + n, REC.smart, P(a0, 0, Z), cap);
    const M = await build('M' + n, REC.merger, P(a0 + G.m, 0, Z), cap);
    const BR = await build('BR' + n, REC.smart, P(a0 + G.m, G.b, Z), cap);
    const C = await build('C' + n, REC.box, P(a0 + G.c, G.b, ZC), cap - 90);
    const R = await build('R' + n, REC.merger, P(a0 + G.r, G.b, ZR), cap);
    if (o.sens && DIR[o.sens][0] === -f.x && DIR[o.sens][1] === -f.y) throw new Error(o.motif + ' : la sortie ne peut pas revenir vers le quai');
    const T = await build('T' + n, REC.merger, P(a0 + G.t, G.b, o.z), o.sens ? CAP[o.sens] : cap);
    await link((n === 1 ? 'quai' : 'M' + k) + ' > S' + n, REC.belt, prev, prevOut, S, 'Input1');
    await link('S' + n + ' > M' + n, REC.belt, S, 'Output1', M, 'Input1');
    await link('S' + n + ' > BR' + n, REC.belt, S, 'Output2', BR, 'Input1');
    await link('BR' + n + ' > C' + n, REC.belt, BR, 'Output1', C, 'Input0');
    await link('BR' + n + ' trop-plein > M' + n, REC.belt, BR, 'Output3', M, 'Input2');
    await link('C' + n + ' > R' + n, REC.belt, C, 'Output2', R, 'Input1');
    // l'ascenseur arrive par l'entree de T tournee vers le quai (l'entree arriere si T sort vers l'avant, sinon un cote)
    await link('R' + n + ' > T' + n, REC.lift, R, 'Output1', T, T && !DRY ? await entree(T, -f.x, -f.y) : 'Input1', { snapTolerance: 400 });
    await rules('S' + n, S, [{ item: 'undefined', output: 0 }, { item, output: 1 }]);
    await rules('BR' + n, BR, [{ item: 'any', output: 0 }, { item: 'overflow', output: 2 }]);
    prev = M; prevOut = 'Output1';
  }
  const aLast = G.s1 + G.pas * (OBJETS.length - 1);
  const K = await build('broyeur', REC.sink, P(aLast + G.broyeur, G.bBroyeur, ZC), cap + 90);
  await link('M' + OBJETS.length + ' > broyeur', REC.belt, prev, prevOut, K, 'Input0');
  await courant(K);
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
