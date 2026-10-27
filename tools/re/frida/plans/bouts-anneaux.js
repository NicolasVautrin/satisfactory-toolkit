// Bouts des anneaux de la voie basse a l'ecart standard (utilisateur, 26/10/2026 : « on passe le standard a 7m » ; « on
// passe a la voie basse ») : anneaux poses par layouts/anneau-voie-basse.js (vbd1..vbd6, vb..vb4, Lund, Tilburg,
// Novosibirsk). A chaque bout, les deux voies partent du meme point en quarts de cercle opposes ; a 6,5 m d'axe en axe, les
// tetes des trains qui s'y croisent peuvent se toucher (seuil 6,64 m, references/rails.md « Collisions entre trains »).
//
// Un bout = deux quarts de cercle et les deux rails qui les prolongent : cote ouest (So / Ni), cote est (No / Si), ligne
// externe (Xo / Xi). L'outil part du jeu (les liens entre anneaux appartiennent a plusieurs plans) : il releve les quarts
// (etat de l'anneau), le rail qui prolonge chacun, leurs raccords et leurs signaux (cote, sens), puis pose avec railplan
// (layouts/bout-anneau.js, etat bout-<anneau>-<cote>) : quarts de rayon R - (ECART - 6,5) / 2 (17,75 m) jusqu'aux points
// de raccord ecartes, rails suivants en S jusqu'a leur autre bout inchange ; raccords hors du lot refaits par railLink,
// signaux reposes au meme bout, chemins remplaces dans les etats (plans/*-state.json).
//
// node bouts-anneaux.js liste                          bouts des anneaux, ecart actuel, trains proches
// node bouts-anneaux.js essai <anneau> <W|E|X>         releve et plan, pose a blanc (railplan check)
// node bouts-anneaux.js pose <anneau> <W|E|X>          demonte et repose (sauvegarder avant)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call } = require('./client');
const { makeFrame } = require('./frame');
const { HALF } = require('./layouts/anneau-voie-basse.js');

const ECART = 7;
const R = 18, VN = 6.5, D = (ECART - VN) / 2, RQ = R - D;
const RINGS = ['vbd1', 'vbd2', 'vbd3', 'vbd4', 'vbd5', 'vbd6', 'vb', 'vb2', 'vb3', 'vb4', 'lund', 'tilburg', 'novosibirsk'];
const argv = process.argv.slice(2);
const short = (p) => (p ? p.split('_C_').pop() : p);
const stateFile = (n) => path.join(__dirname, n + '-state.json');
const readState = (n) => JSON.parse(fs.readFileSync(stateFile(n), 'utf8'));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const capOf = (frame, n) => (Math.round((Math.atan2(n.y, n.x) * 180) / Math.PI - frame.axis) % 360 + 360) % 360;

// Geometrie d'un bout dans le repere de l'anneau : quarts (id de l'etat, point de l'anneau et cap en partant de lui,
// point de raccord et cap d'arrivee, ancien point de raccord), cap des rails suivants en s'eloignant
function sideDef(side) {
  const ue = -HALF, uw = HALF, xo = -R - VN / 2, xi = xo + 2 * R + VN;
  if (side === 'W') return { away: 0, q: [
    { id: 'So', ring: [uw, -R], ringCap: 90, j: [uw + RQ, -D], jCap: 0, old: [uw + R, 0] },
    { id: 'Ni', ring: [uw, VN + R], ringCap: 270, j: [uw + RQ, VN + D], jCap: 0, old: [uw + R, VN] }] };
  if (side === 'E') return { away: 180, q: [
    { id: 'No', ring: [ue, VN + R], ringCap: 270, j: [ue - RQ, VN + D], jCap: 180, old: [ue - R, VN] },
    { id: 'Si', ring: [ue, -R], ringCap: 90, j: [ue - RQ, -D], jCap: 180, old: [ue - R, 0] }] };
  if (side === 'X') return { away: 270, q: [
    { id: 'Xo', ring: [xo, -2 * R], ringCap: 0, j: [xo + RQ, -2 * R - RQ], jCap: 270, old: [xo + R, -3 * R] },
    { id: 'Xi', ring: [xi, -2 * R], ringCap: 180, j: [xi - RQ, -2 * R - RQ], jCap: 270, old: [xi - R, -3 * R] }] };
  throw new Error('cote W, E ou X');
}

async function exists(p) { try { await call('dump', p, 1, 1, ['bHidden']); return true; } catch (e) { return false; } }

// Releve d'un bout dans le jeu
async function survey(ring, side) {
  const st = readState('anneau-' + ring);
  const frame = makeFrame(st.frame.origin, st.frame.axis);
  const def = sideDef(side);
  const out = { ring, side, frame: st.frame, quarters: [], free: false };
  for (const q of def.q) {
    const path0 = st.rails[q.id];
    if (!path0 || !(await exists(path0))) return Object.assign(out, { skip: q.id + ' absent de l\'etat ou du jeu' });
    const info = await call('rails', path0);
    const ringW = frame.world([...q.ring, 0]);
    const [cr, cj] = dist(info.connections[0].location, ringW) < dist(info.connections[1].location, ringW) ? info.connections : info.connections.slice().reverse();
    const jl = frame.local(cj.location);
    const now = Math.hypot(jl[0] - q.old[0], jl[1] - q.old[1]) < 0.5 ? 'ancien' : Math.hypot(jl[0] - q.j[0], jl[1] - q.j[1]) < 0.1 ? 'fait' : 'autre';
    const e = { id: q.id, def: q, path: path0, ringConn: cr, junction: cj, state: now, next: null };
    if (cj.connections.length > 1) return Object.assign(out, { skip: q.id + ' : aiguillage au point de raccord' });
    if (cj.connections.length === 1) {
      const n = await call('rails', cj.connections[0].track);
      const far = n.connections.find((c) => c.name !== cj.connections[0].name);
      e.next = { path: n.path || cj.connections[0].track, length: n.length, far };
    }
    out.quarters.push(e);
  }
  // signaux poses sur un connecteur de ces rails (facingSignal) : type, cote, position
  const lot = new Set(out.quarters.flatMap((e) => [e.path, e.next && e.next.path].filter(Boolean)));
  out.signals = [];
  for (const e of out.quarters) {
    for (const [role, p] of [['q', e.path], ['a', e.next && e.next.path]]) {
      if (!p) continue;
      for (const c of (await call('rails', p)).connections) {
        if (!c.facingSignal) continue;
        const d = await call('dump', c.facingSignal, 1, 1, ['mIsLeftHanded']);
        out.signals.push({ path: c.facingSignal, type: /PathSignal/.test(c.facingSignal) ? 'path' : 'block', quarter: e.id, role, at: c.location, left: !!d.mIsLeftHanded });
      }
    }
  }
  // raccords hors du lot (cote anneau des quarts, autre bout des rails suivants)
  out.outside = [];
  for (const e of out.quarters) {
    for (const x of e.ringConn.connections) if (!lot.has(x.track)) out.outside.push({ quarter: e.id, role: 'q', at: e.ringConn.location, other: x.track, otherName: x.name });
    if (e.next) for (const x of e.next.far.connections) if (!lot.has(x.track)) out.outside.push({ quarter: e.id, role: 'a', at: e.next.far.location, other: x.track, otherName: x.name });
  }
  out.lot = [...lot];
  return out;
}

// Plan de repose (repere de l'anneau) : quarts, rails suivants, rails d'accroche existants, signaux
async function specOf(s) {
  const frame = makeFrame(s.frame.origin, s.frame.axis);
  const def = sideDef(s.side);
  const joints = {}, rails = [], signals = [];
  const J = (name, p) => { joints[name] = p.length === 3 ? p : [p[0], p[1], 0]; return name; };
  let k = 0;
  const anchor = async (jointName, other) => { // rail existant accroche au joint : ses deux bouts
    const info = await call('rails', other);
    const at = frame.world(joints[jointName]);
    const fe = info.connections.reduce((a, b) => (dist(b.location, at) > dist(a.location, at) ? b : a));
    const id = 'k' + (++k);
    J(id + 'f', frame.local(fe.location));
    const [a, b] = [joints[id + 'f'], joints[jointName]];
    const cap = Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
    rails.push({ id, from: id + 'f', fromCap: cap, to: jointName, toCap: cap, existing: other });
  };
  for (const e of s.quarters) {
    const q = e.def;
    const rj = J(q.id + 'R', frame.local(e.ringConn.location));
    const jj = J(q.id + 'J', [...q.j, frame.local(e.junction.location)[2]]);
    for (const x of e.ringConn.connections.filter((y) => !s.lot.includes(y.track))) await anchor(rj, x.track);
    rails.push({ id: q.id, from: rj, fromCap: q.ringCap, to: jj, toCap: q.jCap });
    if (e.next) {
      const fj = J(q.id + 'F', frame.local(e.next.far.location));
      for (const x of e.next.far.connections.filter((y) => !s.lot.includes(y.track))) await anchor(fj, x.track);
      rails.push({ id: q.id + 'a', from: jj, fromCap: def.away, to: fj, toCap: capOf(frame, e.next.far.normal) });
    }
  }
  s.signals.forEach((g, i) => {
    const rid = g.role === 'q' ? g.quarter : g.quarter + 'a';
    const r = rails.find((x) => x.id === rid);
    const end = dist(frame.world(joints[r.from]), g.at) < dist(frame.world(joints[r.to]), g.at) ? 'from' : 'to';
    signals.push({ id: 's' + (i + 1), type: g.type, rail: rid, end, left: g.left });
  });
  return { joints, rails, signals };
}

const NOM = (s) => 'bout-' + s.ring + '-' + s.side;
const SPEC = (s) => path.join(__dirname, NOM(s) + '-spec.json');
function railplan(s, action, ...extra) {
  const o = s.frame.origin;
  return execFileSync('node', ['railplan.js', 'layouts/bout-anneau.js', action, '--origin', [o.x, o.y, o.z].join(','), '--axis', String(s.frame.axis),
    '--nom', NOM(s), '--spec', path.basename(SPEC(s)), ...extra], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function describe(s) {
  return s.ring + ' ' + s.side + ' : ' + (s.skip ? 'IGNORE (' + s.skip + ')' : s.quarters.map((e) => e.id + ' ' + e.state + (e.next ? ' + ' + short(e.next.path) + ' ' + Math.round(e.next.length / 100) + ' m' : ' (bout libre)')).join(', ')
    + ' | signaux ' + s.signals.map((g) => g.type + '@' + (g.role === 'q' ? g.quarter : g.quarter + 'a')).join(' ') + ' | raccords ' + s.outside.length);
}

// Chemins remplaces dans tous les etats (anneaux, hub, gares...) : ancien -> nouveau
function replacePaths(map) {
  const changed = [];
  for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('-state.json'))) {
    let txt = fs.readFileSync(path.join(__dirname, f), 'utf8');
    let n = 0;
    for (const [a, b] of Object.entries(map)) { const parts = txt.split('"' + a + '"'); if (parts.length > 1) { n += parts.length - 1; txt = parts.join('"' + b + '"'); } }
    if (n) { fs.writeFileSync(path.join(__dirname, f), txt); changed.push(f.replace('-state.json', '') + ' (' + n + ')'); }
  }
  return changed;
}

const COMMANDS = {
  async liste() {
    const trains = (await call('trains', {})).filter((t) => t.vehicles.length);
    for (const ring of RINGS) {
      for (const side of ['W', 'E', 'X']) {
        const s = await survey(ring, side);
        const w = s.quarters.map((e) => e.junction.location);
        const ecart = w.length === 2 ? ' ecart ' + (Math.hypot(w[0].x - w[1].x, w[0].y - w[1].y) / 100).toFixed(2) + ' m' : '';
        const near = trains.filter((t) => t.vehicles.some((v) => w.some((p) => dist(v.location, p) < 25000))).map((t) => t.name);
        console.log(describe(s) + ecart + (near.length ? ' | TRAINS : ' + near.join(', ') : ''));
      }
    }
  },
  async essai(ring, side) {
    const s = await survey(ring, side);
    console.log(describe(s));
    if (s.skip) return;
    fs.writeFileSync(SPEC(s), JSON.stringify(await specOf(s), null, 1));
    const out = railplan(s, 'check');
    console.log(out.split('\n').filter((l) => /^\s+\S+\s+\S+\(.*->|REFUSE|ecart|Ecarts/i.test(l)).join('\n'));
  },
  async pose(ring, side) {
    const s = await survey(ring, side);
    console.log(describe(s));
    if (s.skip) return;
    if (s.quarters.every((e) => e.state === 'fait')) { console.log('deja a ' + ECART + ' m'); return; }
    const near = (await call('trains', {})).filter((t) => t.vehicles.some((v) => s.lot.length && s.quarters.some((e) => dist(v.location, e.junction.location) < 12000)));
    if (near.length) throw new Error('train pres du bout : ' + near.map((t) => t.name).join(', '));
    fs.writeFileSync(SPEC(s), JSON.stringify(await specOf(s), null, 1));
    // etat vide : railplan saute son controle de plan (blocs, ecarts entre voies), qui juge un bout isole hors de son
    // reseau (embranchements en Y de Lund, Tilburg, Novosibirsk : rapprochements existants refuses, 26/10/2026)
    fs.writeFileSync(stateFile(NOM(s)), JSON.stringify({ built: [], rails: {}, platforms: [], signals: {} }));
    for (const g of s.signals) await call('dismantle', g.path, true);
    for (const p of s.lot) await call('dismantle', p, true);
    let out;
    try { out = railplan(s, 'build'); } catch (e) { console.log(((e.stdout || '') + (e.stderr || '')).trim()); throw new Error('pose interrompue (etat ' + NOM(s) + ')'); }
    console.log(out.split('\n').filter((l) => /^(rail|signal) /.test(l)).join('\n'));
    const ns = readState(NOM(s));
    // raccords hors du lot
    const sub = (await call('scan', 'FGRailroadSubsystem', null, 0, 1, {})).items[0].path;
    for (const o of s.outside) {
      const id = o.role === 'q' ? o.quarter : o.quarter + 'a';
      const c = (await call('rails', ns.rails[id])).connections.reduce((a, b) => (dist(b.location, o.at) < dist(a.location, o.at) ? b : a));
      if (c.connections.some((x) => x.track === o.other)) continue;
      await call('railLink', sub, ns.rails[id], c.name, o.other, o.otherName);
      const ok = (await call('rails', ns.rails[id])).connections.find((x) => x.name === c.name).connections.some((x) => x.track === o.other);
      console.log('raccord ' + id + ' -> ' + short(o.other) + ' : railLink ' + (ok ? 'fait' : 'ECHEC'));
    }
    // chemins dans les etats : anciens rails et signaux -> nouveaux
    const map = {};
    for (const e of s.quarters) { map[e.path] = ns.rails[e.id]; if (e.next) map[e.next.path] = ns.rails[e.id + 'a']; }
    s.signals.forEach((g, i) => { map[g.path] = ns.signals['s' + (i + 1)]; });
    console.log('etats mis a jour : ' + (replacePaths(map).join(', ') || 'aucun'));
    // controles
    const j = s.quarters.map((e) => ns.rails[e.id]);
    const jl = [];
    for (const [i, e] of s.quarters.entries()) jl.push((await call('rails', j[i])).connections.reduce((a, b) => (dist(b.location, e.junction.location) < dist(a.location, e.junction.location) ? b : a)).location);
    const free = [];
    for (const id of Object.keys(ns.rails).filter((x) => !/^k\d/.test(x))) for (const c of (await call('rails', ns.rails[id])).connections) if (!c.connections.length) free.push(id + '.' + c.name.slice(-1));
    const sv = [];
    for (const [id, p] of Object.entries(ns.signals)) { const v = (await call('dump', p, 1, 1, ['mBlockValidation'])).mBlockValidation; if (v !== 1) sv.push(id + '=' + v); }
    console.log('ecart au raccord ' + (Math.hypot(jl[0].x - jl[1].x, jl[0].y - jl[1].y) / 100).toFixed(3) + ' m | bouts libres ' + (free.join(' ') || 'aucun') + ' | signaux non valides ' + (sv.join(' ') || 'aucun'));
  },
};

const [cmd, ...args] = argv.filter((a) => !a.startsWith('--'));
if (!COMMANDS[cmd]) { console.log('commandes : ' + Object.keys(COMMANDS).join(', ')); process.exit(1); }
COMMANDS[cmd](...args).catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
