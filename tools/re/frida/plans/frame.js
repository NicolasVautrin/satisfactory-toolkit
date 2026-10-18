// Repere local d'une gare, lu dans le jeu : origine = sortie de la gare (TrackConnection1 de sa voie integree), u le long
// des quais (de la gare vers le dernier quai), v = cap de u + 90 deg, z vertical ; en metres.
'use strict';

const { call } = require('./client');

const rad = (deg) => (deg * Math.PI) / 180;

function makeFrame(origin, axis) {
  const U = { x: Math.cos(rad(axis)), y: Math.sin(rad(axis)) };
  const V = { x: Math.cos(rad(axis + 90)), y: Math.sin(rad(axis + 90)) };
  return {
    origin,
    axis,
    world: ([u, v, z]) => ({ x: origin.x + 100 * (u * U.x + v * V.x), y: origin.y + 100 * (u * U.y + v * V.y), z: origin.z + 100 * z }),
    local: (p) => {
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      return [(dx * U.x + dy * U.y) / 100, (dx * V.x + dy * V.y) / 100, (p.z - origin.z) / 100];
    },
    dir: (cap) => ({ x: Math.cos(rad(axis + cap)), y: Math.sin(rad(axis + cap)) }),
  };
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

// Repere d'une gare existante, decale de `offset` metres le long de v (meme orientation, meme altitude)
async function stationFrame(nameOrPath, offset) {
  const station = await findStation(nameOrPath);
  const { mRailroadTrack: track } = await call('dump', station, 1, 1, ['mRailroadTrack']);
  const tc1 = (await call('rails', track)).connections.find((c) => c.name === 'TrackConnection1');
  // u va de la sortie de la gare vers ses quais : a l'oppose de la normale (sortante) de TrackConnection1
  const axis = Math.round(Math.atan2(-tc1.normal.y, -tc1.normal.x) * 180 / Math.PI);
  const base = makeFrame(tc1.location, axis);
  return makeFrame(base.world([0, offset || 0, 0]), axis);
}

module.exports = { makeFrame, findStation, stationFrame, rad };
