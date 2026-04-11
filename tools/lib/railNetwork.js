/**
 * railNetwork.js — Shared rail network analysis (graph, travel deduction, signal detection).
 * Used by railNetworkTravel.js and railSignalCheck.js.
 */
const http = require('http');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchEntities(baseUrl = 'http://localhost:3000') {
  const resp = await fetchJSON(`${baseUrl}/api/game/entities`);
  return resp.save;
}

function classifyEntities(classNames) {
  const STATION = new Set(), DOCK = new Set(), TRACK = new Set(), SIGNAL = new Set();
  for (let ci = 0; ci < classNames.length; ci++) {
    const name = classNames[ci];
    if (name === 'Build_TrainStation_C') STATION.add(ci);
    if (/TrainDockingStation|TrainPlatformEmpty/.test(name)) DOCK.add(ci);
    if (/RailroadTrack_C$|RailroadTrackIntegrated_C$/.test(name)) TRACK.add(ci);
    if (/RailroadBlockSignal_C|RailroadPathSignal_C/.test(name)) SIGNAL.add(ci);
  }
  return {
    isStation: e => e && STATION.has(e.c),
    isDock: e => e && DOCK.has(e.c),
    isTrack: e => e && TRACK.has(e.c),
    isSignal: e => e && SIGNAL.has(e.c),
    isRailway: e => e && (STATION.has(e.c) || DOCK.has(e.c) || TRACK.has(e.c)),
  };
}

function resolveRef(ref, labelIndex) {
  if (!ref || ref === 0) return null;
  const dot = ref.lastIndexOf('.');
  const label = ref.substring(0, dot);
  const port = ref.substring(dot + 1);
  let index;
  if (label.startsWith('#')) {
    index = parseInt(label.substring(1));
  } else if (labelIndex) {
    index = labelIndex.get(label);
  }
  return index != null ? { index, port, label } : null;
}

function buildLabelIndex(entities) {
  const map = new Map();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e && e.lb) map.set(e.lb, i);
  }
  return map;
}

function buildGraph(entities, classify) {
  const graph = new Map();
  const labelIdx = buildLabelIndex(entities);

  function parseTCPorts(entity) {
    if (!entity.cn) return null;
    const cn = entity.cn;
    let tc0Ref, tc1Ref;
    if (classify.isStation(entity)) {
      tc0Ref = cn[0]; tc1Ref = cn[1];
    } else if (classify.isDock(entity)) {
      tc0Ref = cn[cn.length - 2]; tc1Ref = cn[cn.length - 1];
    } else if (classify.isTrack(entity)) {
      tc0Ref = cn[0]; tc1Ref = cn[1];
    }
    return { TC0: tc0Ref || 0, TC1: tc1Ref || 0 };
  }

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!classify.isRailway(e)) continue;
    const ports = parseTCPorts(e);
    if (!ports) continue;

    const node = { TC0: [], TC1: [] };
    for (const [myPort, ref] of [['TC0', ports.TC0], ['TC1', ports.TC1]]) {
      if (!ref || ref === 0) continue;
      for (const r of String(ref).split(', ')) {
        const resolved = resolveRef(r.trim(), labelIdx);
        if (resolved) node[myPort].push(resolved);
      }
    }
    graph.set(i, node);
  }
  return graph;
}

function deduceTravel(entities, classify, graph) {
  // Find station exit/entry seeds
  const seeds = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!classify.isStation(e)) continue;
    const node = graph.get(i);
    if (!node) continue;

    const stationLabel = e.lb || `#${i}`;

    if (node.TC1.length > 0) {
      seeds.push({ index: i, port: 'TC1', direction: 'out', stationName: stationLabel });
    }

    // Walk dock chain to find last dock
    let current = i, currentPort = 'TC0';
    while (true) {
      const n = graph.get(current);
      if (!n) break;
      const dockConn = n[currentPort].find(c => classify.isDock(entities[c.index]));
      if (!dockConn) {
        if (current !== i) {
          const otherPort = currentPort === 'TC0' ? 'TC1' : 'TC0';
          if (n[otherPort].length > 0) {
            seeds.push({ index: current, port: currentPort, direction: 'in', stationName: stationLabel });
          }
        }
        break;
      }
      current = dockConn.index;
      currentPort = dockConn.port === 'TC0' ? 'TC1' : 'TC0';
    }
  }

  // Pre-seed from mTravel annotations (editor-placed tracks)
  const travel = new Map();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e && e.travel && classify.isTrack(e)) {
      travel.set(i, { travel: e.travel, station: '(annotated)', hops: 0 });
    }
  }

  // BFS from stations
  for (const seed of seeds) {
    const queue = [];
    const seedNode = graph.get(seed.index);
    if (!seedNode) continue;

    for (const conn of seedNode[seed.port]) {
      if (!classify.isTrack(entities[conn.index])) continue;
      queue.push({ index: conn.index, entryPort: conn.port, hops: 1 });
    }

    while (queue.length > 0) {
      const { index, entryPort, hops } = queue.shift();
      if (!classify.isTrack(entities[index])) continue;

      const exitPort = entryPort === 'TC0' ? 'TC1' : 'TC0';
      const dir = seed.direction === 'out'
        ? `${entryPort}-${exitPort}`
        : `${exitPort}-${entryPort}`;

      const existing = travel.get(index);
      if (existing) {
        if (existing.travel !== dir) travel.set(index, { travel: undefined, station: existing.station, hops: existing.hops });
        continue;
      }
      travel.set(index, { travel: dir, station: seed.stationName, hops });

      const node = graph.get(index);
      if (!node) continue;
      const propagatePort = seed.direction === 'out' ? exitPort : entryPort;
      for (const conn of node[propagatePort]) {
        if (!travel.has(conn.index)) {
          queue.push({ index: conn.index, entryPort: conn.port, hops: hops + 1 });
        }
      }
    }
  }
  return travel;
}

/**
 * Compute world-space position and outward direction for each port from spline data.
 * Returns Map<"index:port", {pos:{x,y,z}, dir:{x,y,z}}>
 */
function buildPortInfo(entities, classify, graph) {
  const info = new Map();

  for (const [idx] of graph) {
    const e = entities[idx];
    if (!e || !e.sp || e.sp.length < 2) continue;

    const sp = e.sp;
    // TC0 position = first spline point, outward = away from track (opposite of sp[0]→sp[1])
    const tc0Pos = { x: sp[0][0], y: sp[0][1], z: sp[0][2] };
    const dx0 = sp[0][0] - sp[1][0], dy0 = sp[0][1] - sp[1][1], dz0 = sp[0][2] - sp[1][2];
    const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0) || 1;
    const tc0Dir = { x: dx0 / len0, y: dy0 / len0, z: dz0 / len0 };

    // TC1 position = last spline point, outward = away from track (sp[n-2]→sp[n-1])
    const n = sp.length;
    const tc1Pos = { x: sp[n - 1][0], y: sp[n - 1][1], z: sp[n - 1][2] };
    const dx1 = sp[n - 1][0] - sp[n - 2][0], dy1 = sp[n - 1][1] - sp[n - 2][1], dz1 = sp[n - 1][2] - sp[n - 2][2];
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + dz1 * dz1) || 1;
    const tc1Dir = { x: dx1 / len1, y: dy1 / len1, z: dz1 / len1 };

    info.set(`${idx}:TC0`, { pos: tc0Pos, dir: tc0Dir });
    info.set(`${idx}:TC1`, { pos: tc1Pos, dir: tc1Dir });
  }

  return info;
}

/**
 * Deduce guarded/observed connections for each signal from its position/direction
 * and the co-located ports' directions (dot product).
 *
 * Returns Map<signalIndex, {guarded: ["idx:port",...], observed: ["idx:port",...]}>
 */
function deduceSignalConnections(entities, classify, portInfo) {
  // Group ports by position (rounded to 1 UU)
  const portsByPos = new Map();
  for (const [key, pi] of portInfo) {
    const posKey = `${Math.round(pi.pos.x)},${Math.round(pi.pos.y)},${Math.round(pi.pos.z)}`;
    if (!portsByPos.has(posKey)) portsByPos.set(posKey, []);
    portsByPos.get(posKey).push({ key, ...pi });
  }

  const signalConns = new Map();

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!classify.isSignal(e)) continue;

    // Signal direction from rotation quaternion
    const r = { x: e.rx, y: e.ry, z: e.rz, w: e.rw };
    const yaw = Math.atan2(r.z, r.w) * 2;
    const sigDir = { x: Math.cos(yaw), y: Math.sin(yaw) };

    // Signal position
    const posKey = `${Math.round(e.tx)},${Math.round(e.ty)},${Math.round(e.tz)}`;
    const colocated = portsByPos.get(posKey) || [];

    const guarded = [], observed = [];
    for (const p of colocated) {
      const dot = p.dir.x * sigDir.x + p.dir.y * sigDir.y;
      if (dot > 0) {
        guarded.push(p.key);
      } else {
        observed.push(p.key);
      }
    }

    signalConns.set(i, { guarded, observed });
  }

  return signalConns;
}

module.exports = {
  fetchEntities, classifyEntities, buildGraph, buildLabelIndex,
  deduceTravel, resolveRef, buildPortInfo, deduceSignalConnections,
};
