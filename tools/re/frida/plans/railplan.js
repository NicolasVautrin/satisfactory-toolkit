// Trace de voies decrit dans le repere d'une gare, verifie sur les courbes du jeu, puis construit comme au pistolet
// (gare, quais, rails, signaux : chaque joint est fait par le jeu).
//
// Repere du plan : origine = sortie de la gare (TrackConnection1 de sa voie integree), u le long des quais (de la gare
// vers le dernier quai), v = cap de u + 90 deg, z vertical ; en metres. Caps en degres dans ce repere (0 = +u, 90 = +v).
//
// Usage :
//   node railplan.js <plan.js> check    --beside <gare> --offset <v en m> | --origin x,y,z --axis <cap monde de +u>
//   node railplan.js <plan.js> build    (memes options)   -> etat dans <nom>-state.json
//   node railplan.js <plan.js> teardown                   -> demonte tout ce que build a construit
//   node railplan.js <plan.js> remove <id...>             -> demonte des rails / signaux (id du plan) ou 'quais' ;
//                                                            le build suivant les reconstruit
// Options communes : --nom <gare construite> (nom de l'etat ; defaut : nom du fichier de plan) ; un plan modele
// (fonction) recoit toutes les options (ex. layouts/gare-contournement.js : --quais 4 --chargement oui).
//
// check : chaque rail est pose a blanc (points libres, aucun joint) ; le jeu donne sa courbe et ses refus (longueur,
// rayon, pente). Puis decoupage en blocs d'apres les signaux du plan, regles du wiki (Train_Signals) et ecarts entre
// voies mesures sur les courbes du jeu.
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');
const { makeFrame, stationFrame, rad } = require('./frame');

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};

// Criteres de degagement entre deux voies (choix de conception, pas des regles lues dans le jeu) : a moins de H_MIN
// a l'horizontale, il faut V_MIN de hauteur libre. Pres d'un joint commun (FOUL), les voies se rejoignent : ignore.
// Le wiki : des rails qui se touchent ou se traversent sont dans le meme bloc ("Always leave at least one block of space")
const H_MIN = 6;
const V_MIN = 7;
const FOUL = 15;
const SAMPLE_STEP = 100; // uu entre deux points de courbe echantillonnes

const RECIPES = {
  rail: 'Recipe_RailroadTrack_C',
  block: 'Recipe_RailroadBlockSignal_C',
  path: 'Recipe_RailroadPathSignal_C',
  station: 'Recipe_TrainStation_C',
  freight: 'Recipe_TrainDockingStation_C',
};

const dot2 = (a, b) => a.x * b.x + a.y * b.y;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const fmt = (p) => '(' + p.map((x) => Math.round(x * 10) / 10).join(', ') + ')';

// Repere : --origin/--axis, ou --beside <gare> --offset <m> (meme orientation et meme altitude qu'une gare existante,
// decale de <m> le long de v)
async function resolveFrame() {
  if (arg('origin')) {
    const [x, y, z] = arg('origin').split(',').map(Number);
    return makeFrame({ x, y, z }, Number(arg('axis', '0')));
  }
  const beside = arg('beside');
  if (!beside) throw new Error('repere manquant : --beside <gare> --offset <m> ou --origin x,y,z --axis <cap>');
  return stationFrame(beside, Number(arg('offset', '0')));
}

// --- Plan : joints, rails, blocs ---------------------------------------------------------------

// Bouts de rail : cap de sortie (normale du connecteur, vers l'exterieur du rail) en degres du repere
function railEnds(plan) {
  const ends = [];
  for (const r of plan.rails) {
    ends.push({ rail: r.id, end: 'from', joint: r.from, out: r.fromCap + 180 });
    ends.push({ rail: r.id, end: 'to', joint: r.to, out: r.toCap });
  }
  for (const e of ends) e.out = ((e.out % 360) + 360) % 360;
  return ends;
}

const sameSide = (a, b) => Math.cos(rad(a - b)) > 0.5;

// Joint d'un signal : bout `end` (from | to) du rail `rail` ; il garde ce bout (les trains qui sortent du rail par la)
function signalJoint(plan, s) {
  const r = plan.rails.find((x) => x.id === s.rail);
  if (!r) throw new Error('signal ' + s.id + ' : rail inconnu ' + s.rail);
  return s.end === 'from' ? r.from : r.to;
}

// Blocs du plan, comme le jeu : un joint sans signal relie tous ses rails ; un joint avec signal ne relie que les rails
// d'un meme cote (normales paralleles)
function planBlocks(plan) {
  const ids = plan.rails.map((r) => r.id).concat(plan.platformsRail ? [plan.platformsRail.id] : []);
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const union = (a, b) => parent.set(find(a), find(b));
  const ends = railEnds({ rails: plan.rails.concat(plan.platformsRail ? [plan.platformsRail] : []) });
  const byJoint = new Map();
  for (const e of ends) byJoint.set(e.joint, (byJoint.get(e.joint) || []).concat([e]));
  const signalAt = new Map(plan.signals.map((s) => [signalJoint(plan, s), s]));
  for (const [joint, list] of byJoint) {
    const sig = signalAt.get(joint);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!sig || sameSide(list[i].out, list[j].out)) union(list[i].rail, list[j].rail);
      }
    }
  }
  const blocks = new Map();
  for (const id of ids) {
    const b = find(id);
    if (!blocks.has(b)) blocks.set(b, { rails: [], entries: [], exits: [] });
    blocks.get(b).rails.push(id);
  }
  // Signal : le cote garde (les trains qui en sortent sont arretes) est la sortie d'un bloc, l'autre cote son entree
  for (const s of plan.signals) {
    const guardEnd = ends.find((e) => e.rail === s.rail && e.end === s.end);
    const others = (byJoint.get(guardEnd.joint) || []).filter((e) => !sameSide(e.out, guardEnd.out));
    blocks.get(find(s.rail)).exits.push(s);
    for (const o of others) {
      const b = blocks.get(find(o.rail));
      if (b.entries.indexOf(s) < 0) b.entries.push(s);
    }
  }
  return { blocks: [...blocks.values()], blockOf: (id) => blocks.get(find(id)) };
}

// --- Courbes ------------------------------------------------------------------------------------

// Points d'une courbe du jeu (mSplineData : points relatifs a l'hologramme, tangentes d'Hermite)
function sampleSpline(spline, base) {
  const out = [];
  for (let i = 0; i + 1 < spline.length; i++) {
    const p0 = spline[i].Location;
    const p1 = spline[i + 1].Location;
    const t0 = spline[i].LeaveTangent;
    const t1 = spline[i + 1].ArriveTangent;
    const n = Math.max(2, Math.ceil(Math.hypot(p1.X - p0.X, p1.Y - p0.Y, p1.Z - p0.Z) / SAMPLE_STEP));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      const c = (k0) => h00 * p0[k0] + h10 * t0[k0] + h01 * p1[k0] + h11 * t1[k0];
      out.push({ x: base.x + c('X'), y: base.y + c('Y'), z: base.z + c('Z') });
    }
  }
  return out;
}

function lengthOf(points) {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

// Ecart entre deux voies : pire couple de points (moins de H_MIN a l'horizontale et moins de V_MIN en hauteur),
// hors zone de raccordement autour des joints communs
function clearance(a, b, shared) {
  let worst = null;
  for (const p of a) {
    if (shared.some((j) => dist(p, j) < FOUL * 100)) continue;
    for (const q of b) {
      if (shared.some((j) => dist(q, j) < FOUL * 100)) continue;
      const h = Math.hypot(p.x - q.x, p.y - q.y) / 100;
      const v = Math.abs(p.z - q.z) / 100;
      if (h < H_MIN && v < V_MIN && (worst === null || h + v < worst.h + worst.v)) worst = { h, v, p, q };
    }
  }
  return worst;
}

// --- check --------------------------------------------------------------------------------------

async function check(plan, frame) {
  const curves = new Map();
  let refused = 0;
  console.log('Repere : origine ' + JSON.stringify(roundP(frame.origin)) + ', cap de u ' + frame.axis + '\n');
  console.log('Rails (poses a blanc, courbe et refus du jeu) :');
  for (const r of plan.rails) {
    const a = plan.joints[r.from];
    const b = plan.joints[r.to];
    const from = Object.assign(frame.world(a), { yaw: frame.axis + r.fromCap });
    const to = Object.assign(frame.world(b), { yaw: frame.axis + r.toCap });
    const res = await call('rail', RECIPES.rail, from, to, { dryRun: true });
    const pts = sampleSpline(res.spline, res.hologram.location);
    curves.set(r.id, pts);
    const zs = pts.map((p) => p.z);
    if (res.blocking.length) refused++;
    console.log('  ' + r.id.padEnd(10) + ' ' + (r.from + fmt(a)).padEnd(22) + ' -> ' + (r.to + fmt(b)).padEnd(22) + ' '
      + String(Math.round(lengthOf(pts) / 100)).padStart(3) + ' m'
      + (Math.max(...zs) - Math.min(...zs) > 50 ? '  denivele ' + Math.round((Math.max(...zs) - Math.min(...zs)) / 100) + ' m' : '')
      + (res.blocking.length ? '  REFUSE ' + res.blocking.join(',') : ''));
  }
  if (plan.platformsRail) {
    const r = plan.platformsRail;
    const pts = [];
    const a = plan.joints[r.from];
    const b = plan.joints[r.to];
    for (let k = 0; k <= 80; k++) pts.push(frame.world(a.map((x, i) => x + (b[i] - x) * (k / 80))));
    curves.set(r.id, pts);
  }

  const { blocks, blockOf } = planBlocks(plan);
  console.log('\nBlocs (d\'apres les signaux du plan) :');
  const problems = [];
  blocks.forEach((blk, i) => {
    const level = blk.rails.every((id) => { const zs = curves.get(id).map((p) => p.z); return Math.max(...zs) - Math.min(...zs) <= 100; })
      && new Set(blk.rails.map((id) => Math.round(curves.get(id)[0].z / 100))).size === 1;
    const station = plan.platformsRail && blk.rails.indexOf(plan.platformsRail.id) >= 0;
    const label = (s) => s.type + ' ' + s.id;
    console.log('  Bloc ' + (i + 1) + ' : ' + blk.rails.join(' ') + (station ? ' (GARE/QUAIS)' : '') + (level ? '' : ' (pas de niveau)'));
    console.log('     entrees : ' + (blk.entries.map(label).join(', ') || 'aucune') + ' | sorties : ' + (blk.exits.map(label).join(', ') || 'aucune'));
    const say = (m) => problems.push('Bloc ' + (i + 1) + ' : ' + m);
    if (new Set(blk.entries.map((s) => s.type)).size > 1) say('signaux d\'entree de types differents (erreur du jeu)');
    const pathBlock = blk.entries.some((s) => s.type === 'path');
    if (pathBlock && station) say('bloc de chemin contenant une gare (erreur du jeu)');
    if (pathBlock && !level) say('bloc de chemin pas de niveau (bug du jeu : collisions possibles)');
    if (!pathBlock && blk.entries.length > 1) say(blk.entries.length + ' signaux de bloc en entree (bug du jeu aux convergences : collisions possibles)');
    if (blk.entries.length && !blk.exits.length) say('aucun signal de sortie (normal pour un bout de voie en attente de raccordement)');
  });

  console.log('\nEcarts entre voies (moins de ' + H_MIN + ' m a l\'horizontale avec moins de ' + V_MIN + ' m de hauteur libre, hors '
    + FOUL + ' m autour des joints communs) :');
  const ids = [...curves.keys()];
  const all = plan.rails.concat(plan.platformsRail ? [plan.platformsRail] : []);
  const jointsOf = (id) => { const r = all.find((x) => x.id === id); return [r.from, r.to]; };
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const shared = jointsOf(ids[i]).filter((x) => jointsOf(ids[j]).indexOf(x) >= 0).map((x) => frame.world(plan.joints[x]));
      const w = clearance(curves.get(ids[i]), curves.get(ids[j]), shared);
      if (!w) continue;
      n++;
      const sameBlock = blockOf(ids[i]) === blockOf(ids[j]);
      const msg = ids[i] + ' / ' + ids[j] + ' : ' + w.h.toFixed(1) + ' m a l\'horizontale, ' + w.v.toFixed(1) + ' m en hauteur, en '
        + fmt(frame.local(w.p)) + (sameBlock ? ' (meme bloc : rails qui se traversent)' : ' (BLOCS DIFFERENTS : le jeu les fusionnera)');
      console.log('  ' + msg);
      if (!sameBlock) problems.push(msg);
    }
  }
  if (!n) console.log('  aucun');
  const us = Object.values(plan.joints).map((p) => p[0]);
  console.log('\nLongueur hors tout (le long des quais) : ' + Math.round(Math.max(...us) - Math.min(...us)) + ' m');
  console.log(refused ? '\n' + refused + ' rail(s) refuse(s) par le jeu' : '');
  console.log(problems.length ? problems.length + ' remarque(s) :\n  ' + problems.join('\n  ') : 'Aucune remarque');
  return { refused, problems };
}

function roundP(p) {
  return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
}

// --- build --------------------------------------------------------------------------------------

// Etat d'une gare construite : <nom>-state.json (--nom, sinon le nom du fichier de plan)
function statePath(instance) {
  return path.join(__dirname, instance + '-state.json');
}

function loadState(instance) {
  const p = statePath(instance);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { built: [], rails: {}, platforms: [], signals: {} };
}

function saveState(instance, state) {
  fs.writeFileSync(statePath(instance), JSON.stringify(state, null, 2));
}

// Connecteurs de rails deja construits, par joint du plan
async function connectorsAt(state, frame, joint) {
  const at = frame.world(joint);
  const out = [];
  const tracks = Object.values(state.rails).concat(state.integrated || []);
  for (const t of tracks) {
    for (const c of (await call('rails', t)).connections) if (dist(c.location, at) < 20) out.push(Object.assign({ track: t }, c));
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Les rails n'arretent pas toujours les rayons : par moments (quelques secondes, tous les rails a la fois, constate le
// 18/10/2026) la visee d'un bout de voie ne touche rien. Le jeu n'a alors rien construit : on reessaie un peu plus tard
const AIM_RETRIES = 10;
async function callAiming(fn, ...args) {
  for (let i = 1; ; i++) {
    try {
      return await call(fn, ...args);
    } catch (e) {
      if (!/ne touche rien/.test(e.message) || i >= AIM_RETRIES) throw e;
      await sleep(2000);
    }
  }
}

// Bout de rail a poser : connecteur existant au joint (normale attendue), sinon point libre
async function endpoint(state, frame, plan, jointName, cap, wantOut) {
  const conns = await connectorsAt(state, frame, plan.joints[jointName]);
  if (!conns.length) return Object.assign(frame.world(plan.joints[jointName]), { yaw: frame.axis + cap });
  const want = frame.dir(wantOut);
  const match = conns.find((c) => dot2(c.normal, want) > 0.9);
  if (!match) throw new Error('joint ' + jointName + ' : aucun connecteur de normale attendue (' + conns.map((c) => short(c.track) + '.' + c.name).join(', ') + ')');
  return { path: match.track, name: match.name };
}

async function buildStation(plan, frame, state) {
  if (state.station) return;
  const s = plan.station;
  const res = await call('build', RECIPES.station, frame.world(s.at), frame.axis + s.cap, {});
  if (!res.built) throw new Error('gare refusee : ' + res.blocking.join(','));
  state.station = res.actor;
  state.built.push(res.actor);
  const { mRailroadTrack: track } = await call('dump', res.actor, 1, 1, ['mRailroadTrack']);
  state.integrated = [track];
  const info = await call('rails', track);
  const tc1 = info.connections.find((c) => c.name === 'TrackConnection1');
  const off = dist(tc1.location, frame.origin);
  console.log('gare ' + short(res.actor) + ' : voie integree de ' + Math.round(info.length / 100) + ' m, sortie a ' + Math.round(off) + ' uu de l\'origine du plan');
  if (off > 20 || info.length < 100) throw new Error('la sortie de la gare n\'est pas a l\'origine du plan : verifier station.at / station.cap');
}

// Quais : visee verticale sur le toit du batiment precedent, 4 m avant son bout libre (au bout meme, le rayon passe par
// l'ouverture du quai et touche la voie) ; le jeu accroche le quai au connecteur libre le plus proche du point touche
async function buildPlatforms(plan, frame, state) {
  for (let k = state.platforms.length; k < plan.platforms.count; k++) {
    const endU = plan.platforms.firstAt + k * plan.platforms.length;
    const at = frame.world([endU - 4, 0, 0]);
    const recipe = plan.platforms.recipe || RECIPES.freight;
    const ray = [{ x: at.x, y: at.y, z: at.z + 4000 }, { x: at.x, y: at.y, z: at.z - 1000 }];
    // A blanc d'abord : le quai doit s'etre accroche dans le prolongement (centre a mi-longueur du quai suivant)
    // Quai retourne (platforms.reversed) : le cote des entrees / sorties de convoyeur en depend. Le jeu tourne le quai
    // par rapport au batiment auquel il s'accroche (touche R du pistolet) : rotation = cap voulu - cap du precedent
    const wantYaw = frame.axis + (plan.platforms.reversed ? 180 : 0);
    const prevYaw = (await call('pose', k === 0 ? state.station : state.platforms[k - 1])).rotation.yaw;
    const aimOpts = { scrollRotation: Math.cos(rad(wantYaw - prevYaw)) < 0 ? 180 : 0 };
    const dry = await call('buildAim', recipe, ray[0], ray[1], Object.assign({ dryRun: true }, aimOpts));
    const want = frame.world([endU + plan.platforms.length / 2, 0, 0]);
    if (Math.hypot(dry.hologram.location.x - want.x, dry.hologram.location.y - want.y) > 100
      || Math.cos(rad(dry.hologram.rotation.yaw - wantYaw)) < 0.99) {
      throw new Error('quai ' + (k + 1) + ' : l\'hologramme ne s\'accroche pas au bout du batiment precedent (centre en '
        + fmt(frame.local(dry.hologram.location)) + ' cap ' + Math.round(dry.hologram.rotation.yaw) + ', attendu '
        + fmt(frame.local(want)) + ' cap ' + wantYaw + ')');
    }
    // En l'air (pas de dalle sous la gare) : le jeu refuse faute de sol, comme il refuserait la gare visee dans le vide
    const res = await call('buildAim', recipe, ray[0], ray[1], Object.assign({ ignore: plan.platforms.inAir ? ['FGCDInvalidFloor'] : [] }, aimOpts));
    if (!res.built) throw new Error('quai ' + (k + 1) + ' refuse : ' + res.blocking.join(','));
    state.platforms.push(res.actor);
    state.built.push(res.actor);
    const { mRailroadTrack: track } = await call('dump', res.actor, 1, 1, ['mRailroadTrack']);
    state.integrated.push(track);
    if (plan.platforms.load != null) await call('platformLoadMode', res.actor, plan.platforms.load);
    const conns = (await call('rails', track)).connections;
    const far = conns.find((c) => Math.abs(frame.local(c.location)[0] - (endU + plan.platforms.length)) < 0.2);
    const near = conns.find((c) => Math.abs(frame.local(c.location)[0] - endU) < 0.2);
    console.log('quai ' + (k + 1) + ' ' + short(res.actor) + ' : ' + (near && near.connections.length ? 'accroche' : 'NON ACCROCHE') + ', bout libre ' + (far ? fmt(frame.local(far.location)) : '?'));
    if (!near || !near.connections.length || !far) throw new Error('quai ' + (k + 1) + ' mal place');
  }
}

async function buildRails(plan, frame, state) {
  for (const r of plan.rails) {
    if (state.rails[r.id]) continue;
    const from = await endpoint(state, frame, plan, r.from, r.fromCap, r.fromCap); // connecteur partenaire : normale = cap de depart
    const to = await endpoint(state, frame, plan, r.to, r.toCap, r.toCap + 180); // a l'arrivee : normale opposee au cap
    const res = await callAiming('rail', RECIPES.rail, from, to, {});
    if (!res.built) throw new Error('rail ' + r.id + ' refuse : ' + res.blocking.join(','));
    state.rails[r.id] = res.actor;
    state.built.push(res.actor);
    saveState(plan.instance, state);
    // Controle des joints : chaque raccord doit relier des normales opposees (sinon joint anormal, cf. Breda B et D)
    const info = await call('rails', res.actor);
    const bad = [];
    for (const c of info.connections) {
      for (const x of c.connections) {
        const other = (await call('rails', x.track)).connections.find((o) => o.name === x.name);
        if (other.normal.x * c.normal.x + other.normal.y * c.normal.y + other.normal.z * c.normal.z > 0.5) bad.push(c.name + '~' + short(x.track));
      }
    }
    console.log('rail ' + r.id.padEnd(10) + short(res.actor) + ' ' + Math.round(info.length / 100) + ' m'
      + (typeof from.path === 'string' ? ' (depart accroche)' : '')
      + (typeof to.path === 'string' ? (res.endForced ? ' (arrivee raccordee hors de portee du joueur)' : ' (arrivee accrochee)') : '')
      + (bad.length ? '  JOINT ANORMAL ' + bad.join(' ') : ''));
    if (bad.length) throw new Error('joint anormal sur ' + r.id);
  }
}

async function buildSignals(plan, frame, state) {
  for (const s of plan.signals) {
    if (state.signals[s.id]) continue;
    const joint = signalJoint(plan, s);
    const at = frame.world(plan.joints[joint]);
    const conn = (await call('rails', state.rails[s.rail])).connections.find((c) => dist(c.location, at) < 20);
    const res = await callAiming('signal', RECIPES[s.type], { path: state.rails[s.rail], name: conn.name }, {});
    if (!res.built) throw new Error('signal ' + s.id + ' refuse : ' + res.blocking.join(','));
    state.signals[s.id] = res.actor;
    state.built.push(res.actor);
    saveState(plan.instance, state);
    console.log('signal ' + s.id.padEnd(5) + ' ' + s.type.padEnd(5) + ' ' + short(res.actor) + ' en ' + joint);
  }
}

async function build(plan, frame) {
  const state = loadState(plan.instance);
  state.frame = { origin: frame.origin, axis: frame.axis };
  try {
    await buildStation(plan, frame, state);
    saveState(plan.instance, state);
    await buildPlatforms(plan, frame, state);
    saveState(plan.instance, state);
    await buildRails(plan, frame, state);
    await buildSignals(plan, frame, state);
  } finally {
    saveState(plan.instance, state);
  }
  console.log('\nConstruit : ' + state.built.length + ' objets. Controle : node railsignals.js --station ' + state.station);
}

// Demonte des elements du plan (rails ou signaux par id, 'quais' pour tous les quais) et les retire de l'etat : le
// build suivant les reconstruit. Un quai ne s'accroche qu'a un bout de gare / quai libre de tout rail : retirer d'abord
// le rail raccorde au dernier quai.
async function remove(plan, ids) {
  const state = loadState(plan.instance);
  const forget = (p) => { state.built = state.built.filter((x) => x !== p); };
  try {
    for (const id of ids) {
      const group = state.signals[id] ? state.signals : state.rails[id] ? state.rails : null;
      if (group) {
        await call('dismantle', group[id], true);
        forget(group[id]);
        console.log('demonte ' + id + ' (' + short(group[id]) + ')');
        delete group[id];
      } else if (id === 'quais') {
        for (const p of state.platforms.slice().reverse()) {
          await call('dismantle', p, true);
          forget(p);
          console.log('demonte le quai ' + short(p));
        }
        // Voies integrees des quais : normalement parties avec eux (la premiere est celle de la gare)
        await sleep(3000);
        for (const t of state.integrated.slice(1)) {
          try {
            await call('dump', t, 1, 1, ['mLength']);
          } catch (e) {
            continue;
          }
          await call('dismantle', t, true);
          console.log('demonte la voie integree restee seule ' + short(t));
        }
        state.integrated = state.integrated.slice(0, 1);
        state.platforms = [];
      } else {
        throw new Error('element inconnu dans l\'etat : ' + id);
      }
    }
  } finally {
    saveState(plan.instance, state);
  }
}

async function teardown(plan) {
  const state = loadState(plan.instance);
  for (const p of state.built.slice().reverse()) {
    try {
      await call('dismantle', p, true);
      console.log('demonte ' + short(p));
    } catch (e) {
      console.log('ECHEC ' + short(p) + ' : ' + e.message);
    }
  }
  // Le demontage d'une gare peut laisser sa voie integree (constate le 18/10/2026 : voie orpheline de longueur nulle,
  // dont la collision faisait monter le joueur en continu a son approche)
  await sleep(3000);
  for (const p of state.integrated || []) {
    try {
      await call('dump', p, 1, 1, ['mLength']);
    } catch (e) {
      continue; // deja partie avec son quai
    }
    await call('dismantle', p, true);
    console.log('demonte la voie integree restee seule ' + short(p));
  }
  fs.unlinkSync(statePath(plan.instance));
}

(async () => {
  const planFile = path.resolve(process.argv[2]);
  // Plan : objet, ou modele (fonction) recevant les options de la ligne de commande (--quais 4 ...)
  const mod = require(planFile);
  const options = {};
  for (let i = 4; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) options[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  const plan = typeof mod === 'function' ? mod(options) : mod;
  plan.instance = arg('nom', path.basename(planFile, '.js'));
  const mode = process.argv[3];
  if (mode === 'teardown') return teardown(plan);
  if (mode === 'remove') return remove(plan, process.argv.slice(4).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--')));
  const frame = await resolveFrame();
  if (mode === 'check') return check(plan, frame);
  if (mode === 'build') {
    // Controle complet avant une construction neuve ; une reprise (etat deja present) continue la ou elle s'est arretee
    // (les rails a blanc toucheraient alors ce qui est deja construit)
    if (!fs.existsSync(statePath(plan.instance))) {
      const { refused, problems } = await check(plan, frame);
      if (refused) throw new Error('plan refuse par le jeu : construction annulee');
      if (problems.some((p) => /BLOCS DIFFERENTS|erreur du jeu|bug du jeu/.test(p))) throw new Error('plan non conforme : construction annulee');
    }
    return build(plan, frame);
  }
  throw new Error('mode inconnu : ' + mode + ' (check | build | teardown)');
})().catch((e) => {
  console.error('ECHEC :', e.message);
  process.exitCode = 1;
});
