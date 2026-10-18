// Plan des voies autour d'une gare, lu dans le jeu : quais, puis depuis chaque sortie du complexe les rails
// parcourus de proche en proche, avec aiguillages (divergence / convergence), signaux, impasses et rebouclages.
// Usage : node railmap.js --station <nom|chemin> [--radius 500] (metres parcourus depuis la gare, par branche)
'use strict';

const { call, short } = require('./client');

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const id = (p) => (p ? short(p).replace(/^Build_RailroadTrack(Integrated)?_C_/, (m, integ) => (integ ? 'int_' : 'r_')) : p);
const fmt = (l) => '(' + Math.round(l.x) + ', ' + Math.round(l.y) + ', ' + Math.round(l.z) + ')';
const PLATFORM_KINDS = ['Build_TrainStation_C', 'Build_TrainDockingStation_C', 'Build_TrainDockingStationLiquid_C', 'Build_TrainPlatformEmpty_C', 'Build_TrainPlatformEmpty_02_C'];

const railCache = new Map();
async function rails(path) {
  if (!railCache.has(path)) railCache.set(path, await call('rails', path));
  return railCache.get(path);
}

const signalCache = new Map();
async function signalLabel(path) {
  if (!path) return null;
  if (!signalCache.has(path)) {
    const cls = short(path).replace(/_\d+$/, '');
    signalCache.set(path, (/Path/.test(cls) ? 'signal de chemin ' : /Block/.test(cls) ? 'signal de bloc ' : cls + ' ') + short(path).split('_').pop());
  }
  return signalCache.get(path);
}

async function signalsAt(conn) {
  const out = [];
  if (conn.facingSignal) out.push('face : ' + (await signalLabel(conn.facingSignal)));
  if (conn.trailingSignal) out.push('dos : ' + (await signalLabel(conn.trailingSignal)));
  return out.length ? ' [' + out.join(', ') + ']' : '';
}

// Gare par chemin, ou par nom (mStationName)
async function findStation(nameOrPath) {
  if (nameOrPath.indexOf('/') >= 0) return nameOrPath;
  const all = await call('scan', 'Build_TrainStation_C', null, 0, 500);
  for (const it of all.items) {
    const d = await call('dump', it.path, 1, 1, ['mStationName']);
    if (d.mStationName === nameOrPath) return it.path;
  }
  throw new Error('gare introuvable : ' + nameOrPath);
}

// Batiment (gare / quai) qui porte chaque voie integree du secteur
async function platformOwners(center) {
  const owners = new Map();
  for (const kind of PLATFORM_KINDS) {
    const r = await call('scan', kind, center, 30000, 200);
    for (const it of r.items) {
      const d = await call('dump', it.path, 1, 1, ['mRailroadTrack', 'mIsInLoadMode', 'mStationName']);
      owners.set(d.mRailroadTrack, { kind, path: it.path, load: d.mIsInLoadMode, name: d.mStationName });
    }
  }
  return owners;
}

// Complexe de la gare : voies integrees enchainees depuis celle de la gare
async function complexOf(stationPath, owners) {
  const { mRailroadTrack: first } = await call('dump', stationPath, 1, 1, ['mRailroadTrack']);
  const members = [first];
  const exits = [];
  const seen = new Set(members);
  for (let i = 0; i < members.length; i++) {
    for (const c of (await rails(members[i])).connections) {
      for (const x of c.connections) {
        if (seen.has(x.track)) continue;
        if (owners.has(x.track)) { seen.add(x.track); members.push(x.track); } else exits.push({ from: members[i], conn: c, to: x });
      }
      if (!c.connections.length) exits.push({ from: members[i], conn: c, to: null });
    }
  }
  return { members, exits };
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

// Connecteur `name` du rail `track`
async function connectorOf(track, name) {
  return (await rails(track)).connections.find((c) => c.name === name);
}

// A un point d'aiguillage, chaque connecteur liste TOUS les autres rails du point, branche soeur comprise. Un train
// ne passe que vers un connecteur de normale opposee (les normales pointent vers l'exterieur de chaque rail).
async function passable(conn) {
  const out = [];
  for (const x of conn.connections) {
    const other = await connectorOf(x.track, x.name);
    if (other && dot(other.normal, conn.normal) < -0.5) out.push(x);
  }
  return out;
}

// Rails qui arrivent comme nous sur le connecteur d'entree `entry` (convergence) : normale opposee a la sienne
async function feeders(entry, cameFrom) {
  return (await passable(entry)).filter((x) => x.track !== cameFrom);
}

// Parcours d'une branche : `track` entre par son connecteur `entryName`
async function walk(track, entryName, cameFrom, dist, radius, visited, indent, lines) {
  const info = await rails(track);
  const entry = info.connections.find((c) => c.name === entryName);
  const exit = info.connections.find((c) => c.name !== entryName);
  const pad = '  '.repeat(indent);
  // Convergence : d'autres rails arrivent sur l'entree de ce rail (nous sommes une des branches)
  const others = await feeders(entry, cameFrom);
  let label = pad + id(track) + ' ' + Math.round((info.length || 0) / 100) + ' m';
  if (others.length) label += ' — CONVERGENCE en ' + fmt(entry.location) + ' avec ' + others.map((x) => id(x.track)).join(', ');
  label += await signalsAt(entry);
  if (visited.has(track)) { lines.push(pad + '-> rejoint ' + id(track) + ' (deja parcouru)'); return; }
  visited.add(track);
  const total = dist + (info.length || 0);
  if (!exit) { lines.push(label + ' (rail sans second bout ?)'); return; }
  label += ' -> ' + fmt(exit.location) + ' cap ' + exit.yaw + (await signalsAt(exit));
  lines.push(label);
  const next = await passable(exit);
  if (!next.length) { lines.push(pad + '  IMPASSE'); return; }
  if (total / 100 > radius) { lines.push(pad + '  ... (' + Math.round(total / 100) + ' m, arret du parcours)'); return; }
  if (next.length > 1) lines.push(pad + '  DIVERGENCE en ' + fmt(exit.location) + ' : ' + next.length + ' branches');
  for (const x of next) {
    if (/Integrated/.test(x.track)) { lines.push(pad + '  -> quai / gare ' + id(x.track)); continue; }
    if (next.length > 1) lines.push(pad + '  branche ' + id(x.track) + ' :');
    await walk(x.track, x.name, track, total, radius, visited, indent + (next.length > 1 ? 2 : 0), lines);
  }
}

(async () => {
  const station = await findStation(arg('station', 'Breda'));
  const radius = Number(arg('radius', '500'));
  const pose = await call('pose', station);
  const owners = await platformOwners(pose.location);
  const complex = await complexOf(station, owners);
  console.log('Complexe de ' + short(station) + ' :');
  for (const m of complex.members) {
    const o = owners.get(m);
    console.log('  ' + id(m) + ' : ' + (o.name ? 'gare ' + o.name : short(o.path) + (o.load === true ? ' (chargement)' : o.load === false ? ' (dechargement)' : '')));
  }
  const visited = new Set(complex.members);
  for (const e of complex.exits) {
    const lines = [];
    console.log('\nSortie ' + id(e.from) + '.' + e.conn.name + ' en ' + fmt(e.conn.location) + ' cap ' + e.conn.yaw + (await signalsAt(e.conn)) + ' :');
    if (!e.to) { console.log('  IMPASSE'); continue; }
    const other = await connectorOf(e.to.track, e.to.name);
    if (dot(other.normal, e.conn.normal) >= -0.5) continue; // branche soeur listee au point de sortie : pas un passage
    await walk(e.to.track, e.to.name, e.from, 0, radius, visited, 1, lines);
    for (const l of lines) console.log(l);
  }
})().catch((e) => {
  console.error('ECHEC :', e.message);
  process.exitCode = 1;
});
