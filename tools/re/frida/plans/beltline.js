// Ligne de convoyeur posee comme au pistolet le long d'une liste de points : chaque troncon part du bout libre du
// precedent et finit sur un poteau que le jeu ajoute lui-meme ; le dernier peut finir sur un connecteur.
//
// Usage :
//   node beltline.js <ligne.json> check|build [--nom <nom>] [--pas <m>] [--jusqua <n>] [--suivre]
//
// <ligne.json> :
//   { "recipe": "Recipe_ConveyorBeltMk6_C",
//     "liftRecipe": "Recipe_ConveyorLiftMk6_C",                     // facultatif : ascenseurs (defaut : celui du convoyeur)
//     "start": { "path": "<acteur>", "name": "<connecteur>" },      // depart (ignore si l'etat a deja des troncons)
//     "points": [ { "x": .., "y": .., "z": .., "poleHeight": 2 }, ... ], // trace en uu ; z = altitude approchee du sol ;
//                                                                     //   poleHeight (m, facultatif) : poteau de ce sommet ;
//                                                                     //   top (uu, facultatif) : altitude du convoyeur, le
//                                                                     //   poteau est regle sur le sol trouve (1 a 7 m)
//     "poleHeight": 7,                                               // facultatif : poteaux des autres bouts (m ; jeu : 7)
//     "end": { "path": "<acteur>", "name": "<connecteur>" },       // facultatif : raccord final
//     "groundAbove": 15 }                                            // m au-dessus du z du point ou commence la recherche
//                                                                     //   du sol (en grotte : sous le plafond ; dehors : 100)
//   Point d'ascenseur (tracer.js convoyeur, 27/10/2026) : { "lift": "descente"|"montee", "x", "y" (relais), "top",
//   "foot", "u" (sens de la ligne), "cols": [{ x, y, zb, zt }] du haut vers le pied, "entry", "exit" } : relais en l'air
//   (fusionneur, sortie dans le sens u) du cote haut, ascenseurs poses depuis le haut (un ascenseur montant accroche au bout
//   d'un convoyeur se pose a l'envers : references/convoyeurs.md), pied de chacun tourne vers la colonne suivante (essais
//   des molettes 180, 0, 90, 270, ascenseur demonte et repose si le pied est mal tourne). Descente : convoyeur jusqu'a
//   l'entree du relais, ascenseurs, la ligne repart du pied ; montee : ascenseurs, convoyeur jusqu'au pied, la ligne repart
//   de la sortie du relais.
//
// La ligne est decoupee en troncons d'au plus --pas metres (defaut 40, le jeu refuse au-dela de 56). Pour chaque
// troncon : le sol est cherche sous le bout (fenetre de +15 / -30 m autour du z du point ; le terrain est charge loin
// autour du joueur), le troncon est verifie a blanc puis pose ; le jeu le raccorde au precedent a la construction, a
// toute distance. Les batiments n'ont de collision qu'a ~100 m du joueur :
// loin de lui, l'accroche au troncon precedent passe par un point touche fabrique, et le jeu ne voit pas les batiments
// existants (aucun controle d'empietement). --suivre teleporte le joueur pres de chaque bout pour garder ce controle.
// check : verifie a blanc le prochain troncon seulement (les suivants partent d'un bout qui n'existe pas encore) ; pour
// un ascenseur, son relais seulement.
// Etat : <nom>-state.json (troncons, poteaux et ascenseurs poses) ; build reprend ou il s'est arrete.
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
const MERGER = 'Recipe_ConveyorAttachmentMerger_C';
const LIFT = line.liftRecipe || line.recipe.replace('ConveyorBelt', 'ConveyorLift');

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { segments: [] };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hauteur du poteau d'un bout (uu) : celle du sommet, sinon celle de la ligne, sinon celle du jeu
function poleOpts(t) {
  const h = t.poleHeight != null ? t.poleHeight : line.poleHeight;
  return h != null ? { poleHeight: h * 100 } : {};
}
// Sommet du poteau pose en p pour le bout t (le jeu donne un poteau 1 m plus court que demande)
const poleTop = (p, t) => p.z + Math.max(0, (poleOpts(t).poleHeight != null ? poleOpts(t).poleHeight : 700) - 100);

// Points de pose : la ligne redecoupee en pas reguliers d'au plus STEP ; un ascenseur est une etape a lui seul (la ligne
// arrive a son connecteur entry et repart de exit). from : point d'ou part le troncon ; ti : rang dans la ligne ; top :
// altitude du convoyeur au bout (tracer.js), interpolee entre deux points qui la donnent
function targets(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a0 = points[i - 1], b = points[i], a = a0.lift ? a0.exit : a0, e = b.lift ? b.entry : b;
    const n = a0.lift || b.lift ? 1 : Math.max(1, Math.ceil(dist2(a, e) / STEP));
    const az = a0.lift ? a0.exit.z : i === 1 ? a0.z : a0.top; // depart : altitude du connecteur
    let prev = a;
    for (let k = 1; k <= n; k++) {
      const t = k === n && b.lift ? Object.assign({}, b) : { x: a.x + (e.x - a.x) * k / n, y: a.y + (e.y - a.y) * k / n, z: a.z + (e.z - a.z) * k / n, poleHeight: k === n ? b.poleHeight : undefined,
        top: k === n ? b.top : az != null && b.top != null ? az + (b.top - az) * k / n : undefined };
      t.from = { x: prev.x, y: prev.y };
      out.push(t);
      prev = t.lift ? t.exit : t;
    }
  }
  out.forEach((t, k) => { t.ti = k; });
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

// Etat d'avant les rangs (ti) : reste du trace apres le dernier bout pose, depuis ce bout et le sommet suivant le plus
// proche (le decoupage peut donc changer de pas d'un lancement a l'autre)
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

// Convoyeur de from jusqu'a un connecteur (entree du relais, pied d'ascenseur), raccorde aux deux bouts
async function beltTo(from, to, label) {
  const r = await call('belt', line.recipe, from.path, from.name, to, {});
  if (!r.built || !r.actor) throw new Error(label + ' : non construit ' + JSON.stringify(r).slice(0, 300));
  if (!r.snapped || r.snapped.some((q) => q === null)) throw new Error(label + ' : bout non accroche ' + JSON.stringify(r.snapped) + ' ; demonter ' + short(r.actor) + ' et le reposer');
  console.log(label + ' : pose (' + short(r.actor) + ')');
  return r.actor;
}

// Connecteur libre le plus bas d'un ascenseur (son pied quand il est accroche par le haut)
const freeEnd = async (a) => (await call('connections', a)).filter((c) => !c.connected && /ConveyorAny/.test(c.name)).reduce((x, y) => (x && x.location.z < y.location.z ? x : y), null);

// Ascenseur(s) du point t (voir l'en-tete), depuis le bout libre from ; reprend un ascenseur commence (state.pending).
// Rend le connecteur d'ou la ligne repart, ou null (check)
async function liftStep(t, from, indexed) {
  const down = t.lift === 'descente', label = t.lift + ' ' + (t.ti + 1) + ' (' + (t.top / 100).toFixed(1) + ' -> ' + (t.foot / 100).toFixed(1) + ' m)';
  if (FOLLOW) await bringPlayer({ x: t.x, y: t.y, z: t.top });
  const p = state.pending && state.pending.ti === t.ti ? state.pending : { ti: t.ti, lifts: [] };
  const yaw = (Math.atan2(t.u.y, t.u.x) * 180) / Math.PI; // sortie du relais (Output1) dans le sens de la ligne
  if (!p.relay) {
    const r = await call('build', MERGER, { x: t.x, y: t.y, z: t.top }, yaw, { dryRun: mode === 'check', ignore: ['FGCDInvalidFloor'] });
    if (mode === 'check') {
      console.log(label + ' : relais ' + (r.blocking && r.blocking.length ? 'REFUSE a blanc ' + JSON.stringify(r.blocking) : 'accepte a blanc'));
      return null;
    }
    if (!r.built) throw new Error(label + ' : relais non construit ' + JSON.stringify(r.blocking || r).slice(0, 300));
    p.relay = r.actor; state.pending = p; save();
    console.log(label + ' : relais pose (' + short(r.actor) + ')');
  }
  if (down && !p.belt) { p.belt = await beltTo(from, { path: p.relay, name: 'Input1' }, label + ', convoyeur vers le relais'); save(); }
  // du haut vers le pied ; pied de chacun tourne vers la colonne suivante (descente : u ; montee : -u, vers l'arrivee)
  const want = down ? t.u : { x: -t.u.x, y: -t.u.y };
  for (let k = p.lifts.length; k < t.cols.length; k++) {
    const c = t.cols[k];
    const start = k ? { path: p.lifts[k - 1], name: (await freeEnd(p.lifts[k - 1])).name } : { path: p.relay, name: down ? 'Output1' : 'Input1' };
    let ok = null;
    const why = [];
    for (const scroll of [180, 0, 90, 270]) {
      let r;
      try {
        r = await call('belt', LIFT, start.path, start.name, { x: c.x, y: c.y, z: c.zb }, { endZ: c.zb, snapTolerance: k ? 1000 : 400, endScroll: scroll });
      } catch (e) { why.push(scroll + ' : ' + e.message.slice(0, 160)); continue; }
      if (!r.built) { why.push(scroll + ' : ' + JSON.stringify(r.blocking || r).slice(0, 160)); continue; }
      const f = await freeEnd(r.actor), at = (await call('pose', r.actor)).location;
      const dot = f.normal.x * want.x + f.normal.y * want.y, off = Math.hypot(at.x - c.x, at.y - c.y);
      if (dot >= 0.9 && off < 200) { ok = r.actor; break; }
      why.push(scroll + ' : pied tourne a ' + dot.toFixed(2) + ', colonne a ' + Math.round(off) + ' uu du plan');
      await call('dismantle', r.actor, true);
      await sleep(1500); // sans attendre, l'ascenseur suivant voit encore le precedent
    }
    if (!ok) throw new Error(label + ' : ascenseur ' + (k + 1) + ' non pose (' + why.join(' ; ') + ')');
    p.lifts.push(ok); save();
    console.log(label + ' : ascenseur ' + (k + 1) + '/' + t.cols.length + ' pose (' + short(ok) + ', ' + (c.zt / 100).toFixed(1) + ' -> ' + (c.zb / 100).toFixed(1) + ' m)');
  }
  const bottom = p.lifts[p.lifts.length - 1];
  if (!down && !p.belt) { p.belt = await beltTo(from, { path: bottom, name: (await freeEnd(bottom)).name }, label + ', convoyeur vers le pied'); save(); }
  const next = down ? { path: bottom, name: (await freeEnd(bottom)).name } : { path: p.relay, name: 'Output1' };
  state.segments.push({ ti: indexed ? t.ti : undefined, lift: t.lift, relay: p.relay, lifts: p.lifts, belt: p.belt, to: t.exit, top: t.exit.z, next });
  delete state.pending; save();
  return next;
}

async function main() {
  const done = state.segments.length, lastSeg = done ? state.segments[done - 1] : null;
  // etats d'avant les rangs (ti) : reprise par le dernier bout pose
  const indexed = !done || lastSeg.ti != null;
  const all = indexed ? targets(line.points).filter((t) => !lastSeg || t.ti > lastSeg.ti)
    : lastSeg.to.x !== undefined ? targets(remaining(line.points, lastSeg.to)) : targets(line.points);
  let from = done ? lastSeg.next || { path: lastSeg.belt, name: 'ConveyorAny1' } : line.start;
  console.log(name + ' : ' + done + ' troncons deja poses, ' + all.length + ' restants' + (line.end ? ', raccord final sur ' + short(line.end.path) + '.' + line.end.name : ''));
  for (let i = 0; i < all.length && i < UNTIL; i++) {
    const t = all[i];
    if (t.lift) {
      from = await liftStep(t, from, indexed);
      if (!from) return;
      continue;
    }
    const last = i === all.length - 1 && line.end;
    if (FOLLOW) await bringPlayer(t);
    let to = null, label = '', lastError = '', topZ = null;
    const seg = state.segments[state.segments.length - 1];
    const here = seg ? seg.to : line.points[0];
    // sommet du bout precedent : enregistre (troncon ou ascenseur poses par cette version), sinon recalcule
    const hereTop = !seg ? here.z : seg.top != null ? seg.top : poleTop(here, i ? all[i - 1] : {});
    for (const c of last ? [null] : variants(t.from, t)) {
      let cand;
      if (last) cand = line.end;
      else {
        const g = await call('ground', c.x, c.y, t.z + GROUND_ABOVE, t.z - GROUND_BELOW);
        if (g.z === null) { lastError = 'pas de sol sous (' + Math.round(c.x) + ', ' + Math.round(c.y) + ')'; continue; }
        cand = { x: c.x, y: c.y, z: g.z };
        // altitude du convoyeur donnee (top, tracer.js) : poteau regle sur le sol trouve (demande 1 m de plus : le jeu
        // le donne 1 m plus court ; 1 a 7 m)
        if (t.top != null) {
          const ph = t.top - cand.z + 100;
          if (ph < 200 || ph > 800) { lastError = 'poteau de ' + ((ph - 100) / 100).toFixed(1) + ' m en (' + Math.round(c.x) + ', ' + Math.round(c.y) + ') sol ' + Math.round(cand.z / 100) + ' m (1 a 7 m)'; continue; }
          cand.poleOpts = { poleHeight: Math.round(ph) };
        } else cand.poleOpts = poleOpts(t);
        // pente du convoyeur, de sommet de poteau a sommet de poteau (le jeu donne un poteau 1 m plus court que
        // demande) ; au depart, le connecteur de depart. Comparer les sols seuls refusait un poteau haut sous une
        // sortie en surplomb (foreuse de caterium a flanc de colline : 4,6 m de sol sur 4 m, convoyeur 1,2 m, 23/10/2026)
        cand.top = t.top != null ? t.top : poleTop(cand, t);
        if (here.x !== undefined && Math.abs(cand.top - hereTop) / (Math.hypot(cand.x - here.x, cand.y - here.y) || 1) > MAX_SLOPE) { lastError = 'pente trop forte vers (' + Math.round(c.x) + ', ' + Math.round(c.y) + ') sol ' + Math.round(cand.z / 100) + ' m'; continue; }
      }
      label = 'troncon ' + (state.segments.length + 1) + ' -> ' + (last ? short(cand.path) + '.' + cand.name : '(' + Math.round(cand.x / 100) + ', ' + Math.round(cand.y / 100) + ') sol ' + Math.round(cand.z / 100) + ' m' + (cand.poleOpts.poleHeight != null ? ', poteau ' + cand.poleOpts.poleHeight / 100 + ' m' : ''));
      try {
        const dry = await call('belt', line.recipe, from.path, from.name, last ? cand : { x: cand.x, y: cand.y, z: cand.z }, Object.assign({ dryRun: true }, last ? {} : cand.poleOpts));
        if (dry.disqualifiers && dry.disqualifiers.length) { lastError = dry.disqualifiers.join(', '); continue; }
      } catch (e) { lastError = e.message.split('disqualificateurs : ').pop(); continue; }
      to = cand;
      topZ = last ? null : cand.top;
      break;
    }
    if (to === null) throw new Error('troncon ' + (state.segments.length + 1) + ' refuse a blanc, voisins compris : ' + lastError);
    if (mode === 'check') { console.log(label + ' : accepte a blanc'); return; }
    const r = await call('belt', line.recipe, from.path, from.name, last ? to : { x: to.x, y: to.y, z: to.z }, last ? {} : to.poleOpts);
    if (!r.built || !r.actor) throw new Error(label + ' : non construit ' + JSON.stringify(r).slice(0, 300));
    // Garde-fou : le joint doit avoir ete raccorde par le jeu a la construction. Ne PAS raccorder apres coup
    // (connect / SetConnection) : les chaines de convoyeurs deviennent incoherentes et le jeu plante
    // (AFGConveyorChainActor::GetItemsForSegment). Un joint ouvert se repare en reposant le troncon.
    const prev = (await call('connections', from.path)).find((c) => c.name === from.name);
    if (prev && !prev.connected) throw new Error(label + ' : pose mais NON raccorde au precedent (accroche retenue : ' + JSON.stringify(r.snapped) + ') ; demonter ' + short(r.actor) + ' et le reposer');
    from = { path: r.actor, name: 'ConveyorAny1' };
    state.segments.push({ ti: indexed ? t.ti : undefined, belt: r.actor, poles: r.children || [], to: last ? { path: to.path, name: to.name } : { x: Math.round(to.x), y: Math.round(to.y), z: Math.round(to.z) }, top: topZ == null ? undefined : Math.round(topZ), next: from });
    save();
    console.log(label + ' : pose (' + short(r.actor) + (r.children && r.children.length ? ' + ' + r.children.map(short).join(', ') : '') + ')');
  }
  console.log(state.segments.length + ' troncons poses');
}

main().catch((e) => { console.error('ECHEC : ' + e.message); process.exit(1); });
