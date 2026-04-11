#!/usr/bin/env node
/**
 * railNetworkTravel.js — Deduce travel direction for tracks by BFS from stations.
 *
 * Usage:
 *   node tools/railNetworkTravel.js --index 15490
 *   node tools/railNetworkTravel.js --near "-72000,237000,0" --radius 5000
 *
 * Requires server running with save loaded (http://localhost:3000).
 */
const { fetchEntities, classifyEntities, buildGraph, deduceTravel } = require('./lib/railNetwork');

const args = process.argv.slice(2);
let targetIndex = null, nearPos = null, nearRadius = 5000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--index' && args[i + 1]) targetIndex = parseInt(args[++i]);
  if (args[i] === '--near' && args[i + 1]) {
    const [x, y, z] = args[++i].split(',').map(Number);
    nearPos = { x, y, z };
  }
  if (args[i] === '--radius' && args[i + 1]) nearRadius = parseInt(args[++i]);
}

if (targetIndex === null && !nearPos) {
  console.error('Usage: --index <N> or --near "x,y,z" [--radius N]');
  process.exit(1);
}

(async () => {
  const { classNames, entities } = await fetchEntities();
  const classify = classifyEntities(classNames);
  const graph = buildGraph(entities, classify);
  const travel = deduceTravel(entities, classify, graph);

  let results;
  if (targetIndex !== null) {
    const t = travel.get(targetIndex);
    if (t) {
      results = [{ index: targetIndex, ...t }];
    } else {
      console.log(`#${targetIndex}`.padEnd(20) + ' undefined');
      return;
    }
  } else {
    results = [];
    for (const [idx, t] of travel) {
      const e = entities[idx];
      const dx = e.tx - nearPos.x, dy = e.ty - nearPos.y, dz = e.tz - nearPos.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= nearRadius) {
        results.push({ index: idx, ...t });
      }
    }
    results.sort((a, b) => a.hops - b.hops);
  }

  if (results.length === 0) {
    console.log('No tracks found in the specified area');
    return;
  }

  for (const r of results) {
    const e = entities[r.index];
    const label = e.lb ? `${e.lb}` : `#${r.index}`;
    const travelStr = r.travel || 'undefined';
    console.log(`${label.padEnd(20)} ${travelStr.padEnd(10)}  (${r.station}, ${r.hops} hops)`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
