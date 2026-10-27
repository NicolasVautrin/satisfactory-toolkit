// Pile de convoyeurs sur poteaux empilables le long d'un axe (utilisateur, 24/10/2026 : « il faut vraiment que tu
// apprennes a utiliser les stack de convoyeur », puis 25/10 : « ecris l'outil et mets les trois en pile ») : plusieurs
// lignes sur les memes colonnes, une par etage. Une ligne entre dans la pile a une colonne (depuis un connecteur) et en
// sort a une autre (vers un connecteur) ; chaque ligne garde son etage : aucun croisement a gerer.
// Faits du jeu (essai du 25/10/2026 au pied de la falaise de S13 E101, pile existante en (-100 745 ; 46 636)) :
//  - poteau empilable : 2 m par etage, point d'accroche (SnapOnly0) 3 m au-dessus de sa base, tourne dans le sens de
//    marche ; deux convoyeurs se raccordent l'un a l'autre a l'accroche, le poteau ne fait que porter ;
//  - empiler : point touche fabrique sur le poteau du dessous (AFGStackablePoleHologram::TrySnapToActor : le nouveau a sa
//    position + 2 m, meme rotation) ; un rayon reel ne le touche pas loin du joueur (pas de collision) : le poteau se
//    posait debout sur le sommet du premier, au cap 0 ;
//  - accrocher un convoyeur a un etage : point touche fabrique sur le poteau de l'etage, 30 cm avant l'accroche du cote
//    d'arrivee ;
//  - degagement souple des poteaux de la pile (FGCDEncroachingSoftClearance) : le convoyeur ne fait ignorer que les
//    batiments de ses deux accroches (AFGConveyorBeltHologram::GetIgnoredClearanceActors), ni le poteau d'ou il part
//    (accroche au bout du troncon precedent), ni l'etage au-dessus de son arrivee. Accepte seul, apres verification a
//    blanc qu'aucun autre refus ne s'y ajoute.
//
// Plan (JSON) : { "nom", "colonnes": [{ "x", "y", "socle"? }], "lignes": [{ "id", "etage", "de": "<acteur>.<connecteur>",
//   "entree": <colonne>, "sortie": <colonne>, "a": "<acteur>.<connecteur>" }] }
//   colonnes dans le sens de marche (accroches tournees de la precedente vers la suivante) ; socle : poteaux vides sous
//   l'etage 1, pour passer au-dessus d'une ligne existante.
// node pile-convoyeurs.js <plan.json> axe|colonnes|convoyeurs|verifie [--dry] [--ligne <id>] [--recette <convoyeur>]
//   axe        : controle hors du jeu, sur le relief et les batiments releves par tracer.js : pente entre colonnes,
//                etage le plus bas degage du relief, colonnes et convoyeurs de tous les etages libres de batiments et de
//                surplombs ;
//   colonnes   : poteaux de chaque colonne, du sol a son etage le plus haut ;
//   convoyeurs : troncons de chaque ligne, du connecteur de depart a celui d'arrivee ;
//   verifie    : raccords de chaque ligne, bout a bout.
// Etat : plans/pile-<nom>-state.json (poteaux par colonne, troncons par ligne) ; chaque phase reprend ou elle s'est arretee.
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');
const T = require('./tracer');

const PRE = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const DRY = argv.includes('--dry');
const [planFile, phase] = argv;
const POLE = 'Recipe_ConveyorPoleStackable_C';
const BELT = opt('recette', 'Recipe_ConveyorBeltMk6_C');
const LEVEL = 200, SNAP = 300; // etage de 2 m ; accroche 3 m au-dessus de la base du poteau
const SOFT = 'FGCDEncroachingSoftClearance';
const SLOPE = 0.55, CLEAR = 30; // memes regles que tracer.js (BELT.SLOPE, BELT.CLEAR)
const full = (a) => (a.includes('/') ? a : PRE + a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r0 = (p) => `(${Math.round(p.x)} ; ${Math.round(p.y)} ; ${(p.z / 100).toFixed(1)} m)`;
const conn = (ref) => { const i = ref.lastIndexOf('.'); return { path: full(ref.slice(0, i)), name: ref.slice(i + 1) }; };

if (!planFile || !phase) throw new Error('usage : node pile-convoyeurs.js <plan.json> axe|colonnes|convoyeurs|verifie [--dry] [--ligne <id>]');
const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, planFile), 'utf8'));
const C = plan.colonnes, L = plan.lignes;
for (const l of L) if (!(l.entree >= 0 && l.sortie < C.length && l.entree <= l.sortie && l.etage >= 1)) throw new Error('ligne ' + l.id + ' : entree, sortie ou etage hors de la pile');
const SF = path.join(__dirname, 'pile-' + plan.nom + '-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : { colonnes: [], lignes: {} };
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };

// sens de marche a une colonne : de la precedente a la suivante
function dirAt(j) {
  const a = C[Math.max(0, j - 1)], b = C[Math.min(C.length - 1, j + 1)];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
const yawAt = (j) => { const d = dirAt(j); return (Math.atan2(d.y, d.x) * 180) / Math.PI; };
const socle = (j) => C[j].socle || 0;
// lignes presentes a une colonne, et sur le troncon j -> j + 1
const linesAt = (j) => L.filter((l) => l.entree <= j && j <= l.sortie);
const linesOn = (j) => L.filter((l) => l.entree <= j && j + 1 <= l.sortie);
// poteaux d'une colonne : socle + etage le plus haut qui y passe
const height = (j) => socle(j) + Math.max(0, ...linesAt(j).map((l) => l.etage));
const groundAt = async (x, y) => (await call('relief', x, y, 1, 1, 100, 30000, -5000)).z[0];
const snapOf = async (pole) => (await call('connections', pole)).find((c) => c.name === 'SnapOnly0');
const freeEnd = async (belt) => (await call('connections', belt)).find((c) => /ConveyorAny1/.test(c.name));

// --- axe : controle hors du jeu ---------------------------------------------------------------------------------------
async function axe() {
  const xs = C.map((c) => c.x), ys = C.map((c) => c.y);
  const box = { x0: Math.min(...xs) - 3000, x1: Math.max(...xs) + 3000, y0: Math.min(...ys) - 3000, y1: Math.max(...ys) + 3000 };
  const R = await T.relief(box, 400);
  // la pile deja posee ne compte pas comme obstacle
  const own = new Set([].concat(...st.colonnes, ...Object.values(st.lignes)).filter(Boolean).map(short));
  const W = { box, relief: R };
  W.near = T.index(await T.obstacles(box, own));
  const g = C.map((c) => T.hAt(R, c.x, c.y));
  const z = (j, etage) => g[j] + SNAP + LEVEL * (socle(j) + etage - 1);
  let bad = 0;
  for (let j = 0; j < C.length; j++) {
    const top = g[j] + SNAP + LEVEL * (height(j) - 1) + 100;
    const h = T.hitColumn(W, C[j].x, C[j].y, g[j], top, Infinity);
    const on = linesOn(j);
    let why = null;
    if (j + 1 < C.length && on.length) {
      const lo = Math.min(...on.map((l) => l.etage)), hi = Math.max(...on.map((l) => l.etage));
      const a = C[j], b = C[j + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 5600) why = 'portee de ' + Math.round(len / 100) + ' m (56 au plus)';
      else if (Math.abs(z(j + 1, lo) - z(j, lo)) / len > SLOPE) why = 'pente ' + (Math.abs(z(j + 1, lo) - z(j, lo)) / len).toFixed(2);
      for (let s = 1; !why && s < Math.ceil(len / 200); s++) {
        const t = s / Math.ceil(len / 200), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const z1 = z(j, lo) + (z(j + 1, lo) - z(j, lo)) * t, z2 = z(j, hi) + (z(j + 1, hi) - z(j, hi)) * t;
        if (T.hAt(R, x, y) > z1 - CLEAR) why = 'relief en ' + Math.round(x) + ',' + Math.round(y);
        else { const o = T.hitColumn(W, x, y, z1 - 60, z2 + 100, Infinity); if (o) why = o + ' en ' + Math.round(x) + ',' + Math.round(y); }
      }
    }
    if (h || why) bad++;
    console.log(('c' + j).padEnd(4), String(Math.round(C[j].x)).padStart(7), String(Math.round(C[j].y)).padStart(7), 'sol', (g[j] / 100).toFixed(1).padStart(6), 'm',
      height(j), 'poteaux', socle(j) ? '(socle ' + socle(j) + ')' : '', '| etages', linesAt(j).map((l) => l.etage + ':' + l.id).join(' '),
      h ? '| COLONNE : ' + h : '', why ? '| VERS c' + (j + 1) + ' : ' + why : '');
  }
  // entrees et sorties de pile : un convoyeur entre le connecteur et l'accroche de la colonne, approche par une courbe
  // d'Hermite (tangentes de la longueur de la corde, dans le sens de marche aux deux bouts) ; les batiments des deux
  // bouts ne comptent pas
  const curve = (p0, d0, p1, d1, skip) => {
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    const Wc = { box, relief: R, near: (x, y) => W.near(x, y).filter((o) => !skip.has(o.what)) };
    let slope = 0, why = null, prev = null;
    const n = Math.max(4, Math.ceil(len / 100));
    for (let s = 0; s <= n && !why; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t, h = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
      const q = { x: h[0] * p0.x + h[1] * d0.x * len + h[2] * p1.x + h[3] * d1.x * len, y: h[0] * p0.y + h[1] * d0.y * len + h[2] * p1.y + h[3] * d1.y * len, z: h[0] * p0.z + h[2] * p1.z };
      if (prev) slope = Math.max(slope, Math.abs(q.z - prev.z) / (Math.hypot(q.x - prev.x, q.y - prev.y) || 1));
      prev = q;
      if (t * len < 100 || (1 - t) * len < 100) continue; // bras droits du jeu aux deux bouts
      if (T.hAt(R, q.x, q.y) > q.z - CLEAR) why = 'relief en ' + Math.round(q.x) + ',' + Math.round(q.y);
      else { const o = T.hitColumn(Wc, q.x, q.y, q.z - 60, q.z + 100, Infinity); if (o) why = o + ' en ' + Math.round(q.x) + ',' + Math.round(q.y); }
    }
    return { len, slope, why };
  };
  const snapPos = (j, etage) => ({ x: C[j].x, y: C[j].y, z: z(j, etage) });
  for (const l of L) {
    for (const [label, ref, j, out] of [['entree', l.de, l.entree, true], ['sortie', l.a, l.sortie, false]]) {
      const c = conn(ref), k = (await call('connections', c.path)).find((x) => x.name === c.name);
      if (!k) { bad++; console.log(l.id, label, ': connecteur introuvable', ref); continue; }
      const skip = new Set([short(c.path)]);
      // sortie d'un batiment : on part dans le sens de sa normale ; entree : on arrive a l'oppose
      const r = out ? curve(k.location, k.normal, snapPos(j, l.etage), dirAt(j), skip)
        : curve(snapPos(j, l.etage), dirAt(j), k.location, { x: -k.normal.x, y: -k.normal.y }, skip);
      const steep = r.slope > 0.6;
      if (r.why || steep || r.len > 5600) bad++;
      console.log(('ligne ' + l.id).padEnd(10), label.padEnd(7), 'c' + j, 'etage', l.etage, '|', (r.len / 100).toFixed(1), 'm, pente max', r.slope.toFixed(2),
        r.len > 5600 ? '| TROP LONG (56 m au plus)' : '', steep ? '| TROP RAIDE' : '', r.why ? '| ' + r.why : '');
    }
  }
  console.log(bad ? bad + ' probleme(s)' : 'axe libre');
}

// --- colonnes ---------------------------------------------------------------------------------------------------------
async function colonnes() {
  for (let j = 0; j < C.length; j++) {
    const col = (st.colonnes[j] = st.colonnes[j] || []);
    const n = height(j);
    for (let i = col.length; i < n; i++) {
      let r;
      if (i === 0) r = await call('build', POLE, { x: C[j].x, y: C[j].y, z: await groundAt(C[j].x, C[j].y) }, yawAt(j), { dryRun: DRY });
      else {
        const top = (await call('pose', col[i - 1])).location.z + SNAP;
        r = await call('buildAim', POLE, { x: C[j].x, y: C[j].y, z: top + 1000 }, { x: C[j].x, y: C[j].y, z: top }, { onActor: col[i - 1], dryRun: DRY });
      }
      const label = 'c' + j + ' poteau ' + (i + 1) + '/' + n;
      console.log(label.padEnd(18), r.built ? 'construit ' + short(r.actor) : DRY ? 'essai' : 'NON construit', r.blocking && r.blocking.length ? JSON.stringify(r.blocking) : '');
      if (!r.built) { if (DRY) break; throw new Error(label + ' : non construit'); }
      const p = await call('pose', r.actor);
      // un poteau qui ne s'est pas empile (cap ou hauteur) casserait toute la colonne
      if (i > 0) {
        const below = await call('pose', col[i - 1]);
        if (Math.abs(p.location.z - below.location.z - LEVEL) > 5 || Math.abs(p.rotation.yaw - below.rotation.yaw) > 0.5) throw new Error(label + ' : pas empile (base ' + r0(p.location) + ', cap ' + Math.round(p.rotation.yaw) + ')');
      }
      col.push(r.actor); save();
    }
  }
  console.log('colonnes posees :', st.colonnes.filter((c, j) => c && c.length === height(j)).length, '/', C.length);
}

// --- convoyeurs -------------------------------------------------------------------------------------------------------
async function convoyeurs() {
  for (const l of L.filter((x) => !opt('ligne') || x.id === opt('ligne'))) {
    const segs = (st.lignes[l.id] = st.lignes[l.id] || []);
    const total = l.sortie - l.entree + 2; // depart -> colonne d'entree, colonnes, colonne de sortie -> arrivee
    for (let k = segs.length; k < total; k++) {
      const from = k === 0 ? conn(l.de) : { path: segs[k - 1], name: (await freeEnd(segs[k - 1])).name };
      let to, o = {};
      if (k < total - 1) {
        const j = l.entree + k, pole = st.colonnes[j] && st.colonnes[j][socle(j) + l.etage - 1];
        if (!pole) throw new Error('ligne ' + l.id + ' : colonne c' + j + ' sans etage ' + l.etage + ' (phase colonnes)');
        const s = await snapOf(pole);
        to = { x: s.location.x - s.normal.x * 30, y: s.location.y - s.normal.y * 30, z: s.location.z };
        o = { endOnActor: pole };
      } else to = conn(l.a);
      const label = l.id + ' ' + (k === 0 ? 'depart' : 'c' + (l.entree + k - 1)) + ' > ' + (k < total - 1 ? 'c' + (l.entree + k) : 'arrivee');
      const pre = await call('belt', BELT, from.path, from.name, to, Object.assign({ dryRun: true }, o));
      const other = (pre.blocking || []).filter((d) => d !== SOFT);
      if (other.length) throw new Error(label + ' : refuse ' + JSON.stringify(other));
      if (DRY) { console.log(label.padEnd(24), 'essai', JSON.stringify(pre.blocking || [])); break; }
      const r = await call('belt', BELT, from.path, from.name, to, Object.assign({ ignore: [SOFT] }, o));
      console.log(label.padEnd(24), r.built ? 'construit ' + short(r.actor) : 'NON construit', JSON.stringify(pre.blocking || []));
      if (!r.built) throw new Error(label + ' : non construit');
      segs.push(r.actor); save();
      await sleep(300);
    }
  }
}

// --- verifie ----------------------------------------------------------------------------------------------------------
async function verifie() {
  let bad = 0;
  for (const l of L) {
    const segs = st.lignes[l.id] || [];
    const total = l.sortie - l.entree + 2;
    const pb = [];
    if (segs.length < total) pb.push((total - segs.length) + ' troncon(s) manquant(s)');
    for (const b of segs) {
      const cs = await call('connections', b);
      for (const c of cs) if (!c.connected && !(c.name === 'ConveyorAny1' && b === segs[segs.length - 1] && segs.length < total)) pb.push(short(b) + '.' + c.name + ' libre');
    }
    const d = conn(l.de), a = conn(l.a);
    if (!(await call('connections', d.path)).find((c) => c.name === d.name).connected) pb.push('depart ' + d.name + ' libre');
    if (segs.length === total && !(await call('connections', a.path)).find((c) => c.name === a.name).connected) pb.push('arrivee ' + a.name + ' libre');
    if (pb.length) bad++;
    console.log(('ligne ' + l.id).padEnd(12), 'etage', l.etage, '|', segs.length + '/' + total, 'troncons |', pb.length ? pb.join(', ') : 'raccordee de bout en bout');
  }
  console.log(bad ? bad + ' ligne(s) a reprendre' : 'toutes les lignes raccordees');
}

(async () => {
  const ph = { axe, colonnes, convoyeurs, verifie }[phase];
  if (!ph) throw new Error('phase : axe | colonnes | convoyeurs | verifie');
  await ph();
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
