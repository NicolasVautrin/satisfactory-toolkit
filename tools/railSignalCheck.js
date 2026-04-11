#!/usr/bin/env node
/**
 * railSignalCheck.js — Decompose rail network into blocks and report issues.
 *
 * A block = set of connected ports not separated by a signal boundary.
 * A signal boundary = guarded port on one side, observed port on the other.
 * A valid block has at most 1 critical point (switch or station).
 *
 * Usage:
 *   node tools/railSignalCheck.js --near "-72000,237000,0" --radius 15000
 *   node tools/railSignalCheck.js --all [--verbose]
 *
 * Requires server running with save loaded (http://localhost:3000).
 */
const {
  fetchEntities, classifyEntities, buildGraph,
  buildPortInfo, deduceSignalConnections,
} = require('./lib/railNetwork');

const args = process.argv.slice(2);
let nearPos = null, nearRadius = 15000, showAll = false, verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--near' && args[i + 1]) {
    const [x, y, z] = args[++i].split(',').map(Number);
    nearPos = { x, y, z };
  }
  if (args[i] === '--radius' && args[i + 1]) nearRadius = parseInt(args[++i]);
  if (args[i] === '--all') showAll = true;
  if (args[i] === '--verbose') verbose = true;
}

if (!nearPos && !showAll) {
  console.error('Usage: --near "x,y,z" [--radius N] | --all [--verbose]');
  process.exit(1);
}

(async () => {
  const { classNames, entities } = await fetchEntities();
  const classify = classifyEntities(classNames);
  const graph = buildGraph(entities, classify);
  const portInfo = buildPortInfo(entities, classify, graph);
  const signalConns = deduceSignalConnections(entities, classify, portInfo);

  // Build boundary set: pairs of ports that a signal separates
  // Key: "portA|portB" (both directions) → signal crosses this edge
  const boundaries = new Set();
  for (const [, sc] of signalConns) {
    for (const g of sc.guarded) {
      for (const o of sc.observed) {
        boundaries.add(`${g}|${o}`);
        boundaries.add(`${o}|${g}`);
      }
    }
  }

  // Flood-fill blocks — BFS on ports, stop at signal boundaries
  // A "port node" = "index:port" string
  const visited = new Set();
  const blocks = []; // each block = Set of "index:port" strings

  for (const [idx, node] of graph) {
    for (const port of ['TC0', 'TC1']) {
      const portKey = `${idx}:${port}`;
      if (visited.has(portKey)) continue;

      // Scope filter (check entity position)
      if (nearPos) {
        const e = entities[idx];
        if (e) {
          const dx = e.tx - nearPos.x, dy = e.ty - nearPos.y, dz = e.tz - nearPos.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) > nearRadius) continue;
        }
      }

      const block = new Set();
      const queue = [portKey];
      visited.add(portKey);

      while (queue.length > 0) {
        const cur = queue.shift();
        block.add(cur);

        const [curIdxStr, curPort] = cur.split(':');
        const curIdx = parseInt(curIdxStr);
        const curNode = graph.get(curIdx);
        if (!curNode) continue;

        // 1. Traverse to the OTHER port of the same track (internal traversal)
        const otherPort = curPort === 'TC0' ? 'TC1' : 'TC0';
        const otherKey = `${curIdx}:${otherPort}`;
        if (!visited.has(otherKey)) {
          visited.add(otherKey);
          queue.push(otherKey);
        }

        // 2. Traverse connections to other tracks (external traversal)
        for (const conn of curNode[curPort]) {
          const connKey = `${conn.index}:${conn.port}`;
          if (visited.has(connKey)) continue;

          // Check signal boundary
          if (boundaries.has(`${cur}|${connKey}`)) continue;

          visited.add(connKey);
          queue.push(connKey);
        }
      }

      if (block.size > 0) blocks.push(block);
    }
  }

  // Analyze blocks
  let problemCount = 0;

  for (const block of blocks) {
    // Collect unique entity indices in this block
    const entityIndices = new Set();
    for (const pk of block) {
      entityIndices.add(parseInt(pk.split(':')[0]));
    }

    // Identify switches: group ports by position, 3+ ports = switch
    const portsByPos = new Map();
    for (const pk of block) {
      const pi = portInfo.get(pk);
      if (!pi) continue;
      const posKey = `${Math.round(pi.pos.x)},${Math.round(pi.pos.y)},${Math.round(pi.pos.z)}`;
      if (!portsByPos.has(posKey)) portsByPos.set(posKey, []);
      portsByPos.get(posKey).push(pk);
    }

    const switchList = [];
    for (const [posKey, ports] of portsByPos) {
      if (ports.length >= 3) {
        switchList.push({ posKey, ports });
      }
    }

    // Detect station/dock presence
    let hasStation = false;
    let stationName = null;
    for (const idx of entityIndices) {
      const e = entities[idx];
      if (!e) continue;
      if (classify.isStation(e) || classify.isDock(e)) {
        hasStation = true;
        if (classify.isStation(e)) stationName = e.lb || `#${idx}`;
      }
      // Also detect unresolved station connections (?.TCx in cn)
      if (e.cn) {
        for (const ref of e.cn) {
          if (ref && typeof ref === 'string' && ref.startsWith('?.')) hasStation = true;
        }
      }
    }

    const criticalCount = switchList.length + (hasStation ? 1 : 0);
    const trackCount = [...entityIndices].filter(i => classify.isTrack(entities[i])).length;

    // Compute total spline length
    let totalLength = 0;
    for (const idx of entityIndices) {
      const e = entities[idx];
      if (e && classify.isTrack(e) && e.sp) {
        for (let j = 1; j < e.sp.length; j++) {
          const dx = e.sp[j][0] - e.sp[j - 1][0];
          const dy = e.sp[j][1] - e.sp[j - 1][1];
          const dz = e.sp[j][2] - e.sp[j - 1][2];
          totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      }
    }

    const desc = `${trackCount} tracks, ${Math.round(totalLength)} UU, ${switchList.length} sw${hasStation ? ' + station' : ''}`;

    if (criticalCount >= 2) {
      problemCount++;
      console.log(`\n✗ Block (${desc}) — ${criticalCount} critical points`);
      for (const sw of switchList) {
        const portLabels = sw.ports.map(pk => {
          const [idxStr, port] = pk.split(':');
          const e = entities[parseInt(idxStr)];
          return `${e?.lb || '#' + idxStr}:${port}`;
        }).join(', ');
        console.log(`  switch @ (${sw.posKey}): ${portLabels}`);
      }
      if (hasStation) {
        console.log(`  station: ${stationName || '(detected)'}`);
      }
    } else if (verbose) {
      console.log(`✓ Block (${desc})`);
    }
  }

  if (problemCount === 0) {
    console.log('\n✓ All blocks valid — no missing signals');
  } else {
    console.log(`\n${problemCount} block(s) with missing signals`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
