#!/usr/bin/env node
'use strict';

/**
 * optimizeCopperStations.js
 *
 * Optimise simultanément :
 *   - le nombre de gares (k)
 *   - leur position (waypoints de la boucle ferroviaire)
 *   - l'ordre du parcours (TSP sur les gares)
 *
 * Coût = longueur(boucle entre gares) + DIST_WEIGHT × Σ dist(node, gare la plus proche)
 *
 * Usage: node optimizeCopperStations.js [distWeight] [stationCost]
 *   distWeight  : poids des distances convoyeurs vs rail (défaut: 3)
 *   stationCost : coût fixe par gare en UU-équivalent (défaut: 50000)
 */

const fs   = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────
const MAP_DATA_PATH = path.join(__dirname, '..', 'data', 'mapObjects.json');
const TOPO_SVG_PATH = path.join(__dirname, '..', 'data', 'map_topo.svg');
const OUTPUT_SVG    = path.join(__dirname, '..', 'data', 'copperStations.svg');

const DIST_WEIGHT  = parseFloat(process.argv[2]) || 3;
const STATION_COST = parseFloat(process.argv[3]) || 50000;

const MAP_SIZE = 5000;

// Calibration SCIM (SC-InteractiveMap) — axe X décalé de ~503m
const GAME_X_MIN = -324698.832031;
const GAME_X_MAX =  425301.832031;
const GAME_Y_MIN = -375000;
const GAME_Y_MAX =  375000;

// Gares fixes (obligatoires sur la boucle, non déplaçables)
// Format: { x, y, label }
const FIXED_STATIONS = [
  { x: 335302, y: 60000, label: 'Usine Cu' },
];

const THROUGHPUT = {
  RP_Inpure: 300,
  RP_Normal: 600,
  RP_Pure:   780,
};

function gameToPixel(gx, gy) {
  return {
    px: (gx - GAME_X_MIN) / (GAME_X_MAX - GAME_X_MIN) * MAP_SIZE,
    py: (gy - GAME_Y_MIN) / (GAME_Y_MAX - GAME_Y_MIN) * MAP_SIZE,
  };
}

function pixelToGame(px, py) {
  return {
    gx: px / MAP_SIZE * (GAME_X_MAX - GAME_X_MIN) + GAME_X_MIN,
    gy: py / MAP_SIZE * (GAME_Y_MAX - GAME_Y_MIN) + GAME_Y_MIN,
  };
}

// ─── Chargement ─────────────────────────────────────────────────────────────
function loadCopperNodes() {
  const data     = JSON.parse(fs.readFileSync(MAP_DATA_PATH, 'utf8'));
  const resNodes = data.options.find(o => o.tabId === 'resource_nodes');
  const copper   = resNodes.options.find(o => o.type === 'Desc_OreCopper_C');
  const nodes    = [];
  for (const purityGroup of copper.options) {
    for (const m of purityGroup.markers) {
      nodes.push({
        x:          m.x,
        y:          m.y,
        z:          m.z,
        purity:     m.purity,
        name:       m.pathName.split('.').pop(),
        throughput: THROUGHPUT[m.purity] || 0,
      });
    }
  }
  return nodes;
}

// ─── Géométrie ──────────────────────────────────────────────────────────────
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Longueur de la boucle fermée passant par les stations dans l'ordre */
function loopLength(stations) {
  if (stations.length <= 1) return 0;
  let len = 0;
  for (let i = 0; i < stations.length; i++) {
    len += dist(stations[i], stations[(i + 1) % stations.length]);
  }
  return len;
}

/** Somme des distances de chaque node à la gare la plus proche */
function totalConveyorDist(nodes, stations) {
  let total = 0;
  for (const n of nodes) {
    let minD = Infinity;
    for (const s of stations) {
      const d = dist(n, s);
      if (d < minD) minD = d;
    }
    total += minD;
  }
  return total;
}

/** Coût total */
function totalCost(stations, nodes) {
  return loopLength(stations)
    + DIST_WEIGHT * totalConveyorDist(nodes, stations)
    + STATION_COST * stations.length;
}

/** Assigne chaque node à la gare la plus proche */
function assignNodes(nodes, stations) {
  return nodes.map(n => {
    let bestC = 0, bestD = Infinity;
    for (let c = 0; c < stations.length; c++) {
      const d = dist(n, stations[c]);
      if (d < bestD) { bestD = d; bestC = c; }
    }
    return bestC;
  });
}

// ─── K-means++ ──────────────────────────────────────────────────────────────
function kmeansInit(points, k) {
  const n = points.length;
  const centers = [{ x: points[Math.floor(Math.random() * n)].x, y: points[Math.floor(Math.random() * n)].y }];
  for (let c = 1; c < k; c++) {
    const dists = points.map(p => {
      let minD = Infinity;
      for (const ctr of centers) minD = Math.min(minD, dist(p, ctr));
      return minD * minD;
    });
    const total = dists.reduce((s, d) => s + d, 0);
    let r = Math.random() * total;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { centers.push({ x: points[i].x, y: points[i].y }); break; }
    }
    if (centers.length <= c) centers.push({ x: points[Math.floor(Math.random() * n)].x, y: points[Math.floor(Math.random() * n)].y });
  }
  return centers;
}

function kmeans(points, k, maxIter = 200) {
  const n = points.length;
  if (k >= n) return points.map(p => ({ x: p.x, y: p.y }));
  const centers = kmeansInit(points, k);
  for (let iter = 0; iter < maxIter; iter++) {
    const assignments = assignNodes(points, centers);
    let changed = false;
    for (let c = 0; c < k; c++) {
      let sx = 0, sy = 0, count = 0;
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) { sx += points[i].x; sy += points[i].y; count++; }
      }
      if (count > 0) {
        const nx = sx / count, ny = sy / count;
        if (Math.abs(centers[c].x - nx) > 1 || Math.abs(centers[c].y - ny) > 1) changed = true;
        centers[c].x = nx;
        centers[c].y = ny;
      }
    }
    if (!changed) break;
  }
  return centers;
}

// ─── TSP nearest-neighbor sur les stations ──────────────────────────────────
function tspOrder(stations) {
  const n = stations.length;
  if (n <= 2) return stations.map(s => ({ ...s }));
  const visited = new Set([0]);
  const tour = [0];
  for (let step = 1; step < n; step++) {
    const last = tour[tour.length - 1];
    let bestD = Infinity, bestJ = -1;
    for (let j = 0; j < n; j++) {
      if (visited.has(j)) continue;
      const d = dist(stations[last], stations[j]);
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    tour.push(bestJ);
    visited.add(bestJ);
  }
  return tour.map(i => ({ ...stations[i] }));
}

// ─── 2-opt sur la boucle de stations ────────────────────────────────────────
function twoOpt(stations) {
  const n = stations.length;
  if (n < 4) return stations;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const a = stations[i], b = stations[i + 1];
        const c = stations[j], d = stations[(j + 1) % n];
        if (dist(a, b) + dist(c, d) > dist(a, c) + dist(b, d) + 1e-6) {
          let left = i + 1, right = j;
          while (left < right) {
            [stations[left], stations[right]] = [stations[right], stations[left]];
            left++; right--;
          }
          improved = true;
        }
      }
    }
  }
  return stations;
}

/** Vérifie si une station est fixe (ne doit pas être déplacée/supprimée) */
function isFixed(station) {
  return !!station.fixed;
}

/** Nombre de gares non-fixes */
function countMovable(stations) {
  return stations.filter(s => !isFixed(s)).length;
}

/** Indices des gares non-fixes */
function movableIndices(stations) {
  return stations.map((s, i) => isFixed(s) ? -1 : i).filter(i => i >= 0);
}

// ─── Simulated Annealing (optimise position + ordre des stations) ───────────
function optimizeStations(initStations, nodes, {
  maxIter   = 150000,
  tempStart = 80000,
  tempEnd   = 50,
  moveRadius = 30000,
} = {}) {
  let cur     = initStations.map(s => ({ ...s }));
  let curCost = totalCost(cur, nodes);
  let best    = cur.map(s => ({ ...s }));
  let bestCost = curCost;

  const coolRate = Math.pow(tempEnd / tempStart, 1 / maxIter);
  let temp = tempStart;

  for (let i = 0; i < maxIter; i++) {
    temp *= coolRate;
    const candidate = cur.map(s => ({ ...s }));
    const r = Math.random();
    const tempRatio = temp / tempStart;
    const movable = movableIndices(candidate);

    if (r < 0.5 && movable.length > 0) {
      // Déplacer une gare (non-fixe uniquement)
      const idx = movable[Math.floor(Math.random() * movable.length)];
      candidate[idx].x += (Math.random() - 0.5) * 2 * moveRadius * tempRatio;
      candidate[idx].y += (Math.random() - 0.5) * 2 * moveRadius * tempRatio;
    } else if (r < 0.7 && candidate.length >= 4) {
      // 2-opt swap
      const n = candidate.length;
      let a = Math.floor(Math.random() * n);
      let b = Math.floor(Math.random() * n);
      if (a > b) [a, b] = [b, a];
      if (b - a > 1 && !(a === 0 && b === n - 1)) {
        let left = a + 1, right = b;
        while (left < right) {
          [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
          left++; right--;
        }
      }
    } else if (r < 0.85 && movable.length > 2) {
      // Supprimer une gare (non-fixe uniquement)
      const idx = movable[Math.floor(Math.random() * movable.length)];
      candidate.splice(idx, 1);
    } else {
      // Ajouter une gare (près du node le plus éloigné de toute gare)
      let worstNode = null, worstDist = 0;
      for (const n of nodes) {
        let minD = Infinity;
        for (const s of candidate) minD = Math.min(minD, dist(n, s));
        if (minD > worstDist) { worstDist = minD; worstNode = n; }
      }
      if (worstNode) {
        let bestIdx = 0, bestInsertCost = Infinity;
        for (let j = 0; j < candidate.length; j++) {
          const next = (j + 1) % candidate.length;
          const insertCost = dist(candidate[j], worstNode) + dist(worstNode, candidate[next]) - dist(candidate[j], candidate[next]);
          if (insertCost < bestInsertCost) { bestInsertCost = insertCost; bestIdx = j + 1; }
        }
        candidate.splice(bestIdx, 0, { x: worstNode.x, y: worstNode.y });
      }
    }

    const candCost = totalCost(candidate, nodes);
    const delta = candCost - curCost;

    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      cur     = candidate;
      curCost = candCost;
      if (curCost < bestCost) {
        best     = cur.map(s => ({ ...s }));
        bestCost = curCost;
      }
    }

    if (i % 50000 === 0) {
      console.log(`  SA iter ${i}/${maxIter}, temp=${temp.toFixed(0)}, cost=${curCost.toFixed(0)}, best=${bestCost.toFixed(0)}, stations=${cur.length}`);
    }
  }

  console.log(`  SA terminé. Best cost: ${bestCost.toFixed(0)}, stations: ${best.length}`);
  return best;
}

// ─── Analyse multi-k ───────────────────────────────────────────────────────
function analyzeAllK(nodes) {
  console.log('=== Optimisation conjointe boucle + gares cuivre ===');
  console.log(`${nodes.length} nodes, distWeight=${DIST_WEIGHT}, stationCost=${STATION_COST}`);
  if (FIXED_STATIONS.length > 0) {
    console.log(`Gares fixes: ${FIXED_STATIONS.map(s => `${s.label} (${s.x}, ${s.y})`).join(', ')}`);
  }
  console.log();

  const nFixed = FIXED_STATIONS.length;
  const results = [];

  console.log(' k  │  Rail (km) │ Convoyeur tot │ Conv moy │ Conv max │ Coût total');
  console.log('────┼────────────┼───────────────┼──────────┼──────────┼───────────');

  const minK = Math.max(2, nFixed + 1);
  for (let k = minK; k <= 15; k++) {
    // k-means sur (k - nFixed) centres libres, puis ajouter les fixes
    let bestStations = null, bestCost = Infinity;
    for (let run = 0; run < 20; run++) {
      let free = kmeans(nodes, k - nFixed);
      let stations = [
        ...FIXED_STATIONS.map(s => ({ x: s.x, y: s.y, fixed: true, label: s.label })),
        ...free,
      ];
      stations = tspOrder(stations);
      stations = twoOpt(stations);
      const cost = totalCost(stations, nodes);
      if (cost < bestCost) { bestCost = cost; bestStations = stations; }
    }

    const railLen     = loopLength(bestStations);
    const convTotal   = totalConveyorDist(nodes, bestStations);
    const assignments = assignNodes(nodes, bestStations);
    let maxConv = 0;
    for (let i = 0; i < nodes.length; i++) {
      maxConv = Math.max(maxConv, dist(nodes[i], bestStations[assignments[i]]));
    }
    const avgConv = convTotal / nodes.length;

    results.push({
      k,
      stations:    bestStations,
      assignments,
      railLen,
      convTotal,
      avgConv,
      maxConv,
      cost:        bestCost,
    });

    console.log(
      ` ${String(k).padStart(2)} │ ${(railLen / 100).toFixed(1).padStart(7)} m │ ${(convTotal / 100).toFixed(0).padStart(10)} m │ ${(avgConv / 100).toFixed(0).padStart(5)} m │ ${(maxConv / 100).toFixed(0).padStart(5)} m │ ${bestCost.toFixed(0).padStart(11)}`
    );
  }

  // Trouver l'optimum
  let optIdx = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].cost < results[optIdx].cost) optIdx = i;
  }
  const optimal = results[optIdx];
  console.log(`\n>>> Optimal: ${optimal.k} gares\n`);

  // Affiner l'optimal avec SA
  console.log(`Affinage par Simulated Annealing (k=${optimal.k})...`);
  let refined = optimizeStations(optimal.stations, nodes);
  refined = twoOpt(refined);
  const refinedCost = totalCost(refined, nodes);

  if (refinedCost < optimal.cost) {
    console.log(`  Amélioré: ${optimal.cost.toFixed(0)} → ${refinedCost.toFixed(0)}\n`);
    optimal.stations    = refined;
    optimal.cost        = refinedCost;
    optimal.railLen     = loopLength(refined);
    optimal.convTotal   = totalConveyorDist(nodes, refined);
    optimal.assignments = assignNodes(nodes, refined);
  } else {
    console.log(`  Pas d'amélioration (SA: ${refinedCost.toFixed(0)} vs k-means: ${optimal.cost.toFixed(0)})\n`);
  }

  // Détail
  const assignments = optimal.assignments;
  const stations    = optimal.stations;
  console.log(`Rail: ${(optimal.railLen / 100).toFixed(0)} m | Convoyeurs: ${(optimal.convTotal / 100).toFixed(0)} m total\n`);

  for (let c = 0; c < stations.length; c++) {
    const stationNodes = [];
    for (let i = 0; i < nodes.length; i++) {
      if (assignments[i] === c) stationNodes.push(nodes[i]);
    }
    const throughput = stationNodes.reduce((s, n) => s + n.throughput, 0);
    const maxD = stationNodes.reduce((m, n) => Math.max(m, dist(n, stations[c])), 0);
    const fixLabel = stations[c].fixed ? ` [FIXE: ${stations[c].label}]` : '';
    console.log(`  Gare ${c + 1} @ (${stations[c].x.toFixed(0)}, ${stations[c].y.toFixed(0)})${fixLabel}  —  ${stationNodes.length} nodes, ${throughput}/min, conv max: ${(maxD / 100).toFixed(0)} m`);
    for (const n of stationNodes.sort((a, b) => dist(a, stations[c]) - dist(b, stations[c]))) {
      const d = dist(n, stations[c]);
      console.log(`      ${n.name.padEnd(40)} ${n.purity.replace('RP_', '').padEnd(8)} ${(d / 100).toFixed(0).padStart(6)} m  ${n.throughput}/min`);
    }
  }

  return { results, optimal };
}

// ─── Génération HTML ────────────────────────────────────────────────────────
function generateHTML(nodes, analysis) {
  const topoSvg   = fs.readFileSync(TOPO_SVG_PATH, 'utf8');
  const topoInner = topoSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];

  const { optimal, results } = analysis;
  const { stations, assignments } = optimal;

  const purityColors = {
    RP_Inpure: '#e74c3c',
    RP_Normal: '#f39c12',
    RP_Pure:   '#f1c40f',
  };

  const clusterColors = [
    '#00ccff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8',
    '#ff922b', '#20c997', '#f06595', '#748ffc', '#a9e34b',
    '#e599f7', '#63e6be', '#ffa8a8', '#91a7ff', '#c0eb75',
  ];

  // Boucle ferroviaire
  const stPx = stations.map(s => gameToPixel(s.x, s.y));
  let railPath = `M ${stPx[0].px.toFixed(1)} ${stPx[0].py.toFixed(1)}`;
  for (let i = 1; i < stPx.length; i++) {
    railPath += ` L ${stPx[i].px.toFixed(1)} ${stPx[i].py.toFixed(1)}`;
  }
  railPath += ' Z';

  // Lignes convoyeur (node → gare)
  const conveyorLines = nodes.map((n, i) => {
    const c  = assignments[i];
    const np = gameToPixel(n.x, n.y);
    const sp = gameToPixel(stations[c].x, stations[c].y);
    return `  <line x1="${np.px.toFixed(1)}" y1="${np.py.toFixed(1)}" x2="${sp.px.toFixed(1)}" y2="${sp.py.toFixed(1)}" stroke="${clusterColors[c % clusterColors.length]}" stroke-width="1.2" stroke-dasharray="6,3" opacity="0.6"/>`;
  }).join('\n');

  // Nodes
  const nodeCircles = nodes.map((n, i) => {
    const { px, py } = gameToPixel(n.x, n.y);
    const color = purityColors[n.purity] || '#fff';
    const r = n.purity === 'RP_Pure' ? 12 : n.purity === 'RP_Normal' ? 10 : 8;
    return `  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="${color}" stroke="${clusterColors[assignments[i] % clusterColors.length]}" stroke-width="2.5" opacity="0.9"/>`;
  }).join('\n');

  // Gares
  const stationMarkers = stations.map((s, i) => {
    const { px, py } = gameToPixel(s.x, s.y);
    const color = clusterColors[i % clusterColors.length];
    const clusterNodes = nodes.filter((_, ni) => assignments[ni] === i);
    const throughput = clusterNodes.reduce((sum, n) => sum + n.throughput, 0);
    const label = s.fixed ? s.label : `G${i + 1}`;
    const size = s.fixed ? 16 : 12;  // gare fixe plus grosse
    const strokeColor = s.fixed ? '#ff0' : '#000';
    const strokeW = s.fixed ? 3 : 2;
    return [
      `  <rect x="${(px - size).toFixed(1)}" y="${(py - size).toFixed(1)}" width="${size * 2}" height="${size * 2}" rx="3" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeW}" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`,
      `  <text x="${(px + size + 8).toFixed(1)}" y="${(py - 14).toFixed(1)}" fill="#fff" font-size="${s.fixed ? 16 : 15}" font-weight="bold" font-family="sans-serif" stroke="#000" stroke-width="3" paint-order="stroke">${label}</text>`,
      `  <text x="${(px + size + 8).toFixed(1)}" y="${(py + 4).toFixed(1)}" fill="#ccc" font-size="11" font-family="sans-serif" stroke="#000" stroke-width="2" paint-order="stroke">${clusterNodes.length}n ${throughput}/m</text>`,
    ].join('\n');
  }).join('\n');

  // Graphe coût par k
  const graphW = 320, graphH = 190;
  const graphX = MAP_SIZE - graphW - 50, graphY = MAP_SIZE - graphH - 50;
  const maxCost = Math.max(...results.map(r => r.cost));
  const barW = (graphW - 40) / results.length;
  const elbowBars = results.map((r, idx) => {
    const bx = graphX + 20 + idx * barW + barW / 2;
    const bh = (r.cost / maxCost) * (graphH - 45);
    const by = graphY + graphH - 20 - bh;
    const fill = r.k === optimal.k ? '#00ff88' : '#555';
    return [
      `  <rect x="${(bx - barW * 0.35).toFixed(1)}" y="${by.toFixed(1)}" width="${(barW * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" fill="${fill}" rx="2"/>`,
      `  <text x="${bx.toFixed(1)}" y="${(graphY + graphH - 5).toFixed(1)}" fill="#aaa" font-size="9" text-anchor="middle" font-family="sans-serif">${r.k}</text>`,
    ].join('\n');
  }).join('\n');

  const elbowGraph = `
  <g id="elbow">
    <rect x="${graphX}" y="${graphY}" width="${graphW}" height="${graphH}" rx="8" fill="#000" opacity="0.85"/>
    <text x="${graphX + graphW / 2}" y="${graphY + 16}" fill="#fff" font-size="12" font-weight="bold" text-anchor="middle" font-family="sans-serif">Coût total (rail + conv × ${DIST_WEIGHT} + ${STATION_COST}/gare)</text>
    ${elbowBars}
  </g>`;

  // Légende
  const legend = `
  <g transform="translate(50, ${MAP_SIZE - 210})">
    <rect x="0" y="0" width="320" height="195" rx="8" fill="#000" opacity="0.85"/>
    <text x="15" y="25" fill="#fff" font-size="16" font-weight="bold" font-family="sans-serif">${optimal.k} gares — Rail ${(optimal.railLen / 100).toFixed(0)} m</text>
    <circle cx="25" cy="50" r="8" fill="${purityColors.RP_Inpure}"/>
    <text x="40" y="55" fill="#fff" font-size="12" font-family="sans-serif">Impure — 300/min</text>
    <circle cx="25" cy="74" r="8" fill="${purityColors.RP_Normal}"/>
    <text x="40" y="79" fill="#fff" font-size="12" font-family="sans-serif">Normal — 600/min</text>
    <circle cx="25" cy="98" r="8" fill="${purityColors.RP_Pure}"/>
    <text x="40" y="103" fill="#fff" font-size="12" font-family="sans-serif">Pure — 780/min</text>
    <line x1="155" y1="48" x2="185" y2="48" stroke="#00ccff" stroke-width="3"/>
    <text x="192" y="53" fill="#fff" font-size="12" font-family="sans-serif">Rail loop</text>
    <line x1="155" y1="70" x2="185" y2="70" stroke="#aaa" stroke-width="1" stroke-dasharray="6,3"/>
    <text x="192" y="75" fill="#fff" font-size="12" font-family="sans-serif">Convoyeurs</text>
    <rect x="161" y="87" width="16" height="16" rx="3" fill="#00ccff" stroke="#000" stroke-width="1.5" transform="rotate(45 169 95)"/>
    <text x="192" y="100" fill="#fff" font-size="12" font-family="sans-serif">Gare</text>
    <text x="15" y="135" fill="#aaa" font-size="11" font-family="sans-serif">Conv total: ${(optimal.convTotal / 100).toFixed(0)} m | Throughput: ${nodes.reduce((s, n) => s + n.throughput, 0)}/min</text>
    <text x="15" y="155" fill="#aaa" font-size="11" font-family="sans-serif">distWeight: ${DIST_WEIGHT} | stationCost: ${STATION_COST}</text>
    <text x="15" y="175" fill="#666" font-size="10" font-family="sans-serif">node optimizeCopperStations.js [distWeight] [stationCost]</text>
  </g>`;

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" width="${MAP_SIZE}" height="${MAP_SIZE}">
${topoInner}

<!-- Rail loop -->
<path d="${railPath}" fill="none" stroke="#00ccff" stroke-width="3.5" stroke-linejoin="round" opacity="0.85"/>

<!-- Conveyor links -->
<g id="conveyors">
${conveyorLines}
</g>

<!-- Copper nodes -->
<g id="copper-nodes">
${nodeCircles}
</g>

<!-- Stations -->
<g id="stations">
${stationMarkers}
</g>

<!-- Elbow graph -->
${elbowGraph}

<!-- Legend -->
${legend}
</svg>`;

  fs.writeFileSync(OUTPUT_SVG, svgContent, 'utf8');
  console.log(`\nSVG: ${OUTPUT_SVG}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
function main() {
  const nodes    = loadCopperNodes();
  const analysis = analyzeAllK(nodes);
  generateHTML(nodes, analysis);
  console.log('\nTerminé!');
}

main();