'use strict';
/**
 * optimizeStations.js
 *
 * Optimise le placement de gares ferroviaires pour plusieurs ressources.
 * Génère un SVG multi-layers compatible Inkscape (affichage/masquage par layer).
 *
 * Usage: node optimizeStations.js [distWeight] [stationCost]
 *   distWeight  : poids des distances convoyeurs vs rail (défaut: 3)
 *   stationCost : coût fixe par gare en UU-équivalent (défaut: 500000)
 */

const fs   = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────
const MAP_DATA_PATH = path.join(__dirname, '..', 'data', 'mapObjects.json');
const TOPO_SVG_PATH = path.join(__dirname, '..', 'data', 'map_topo.svg');
const OUTPUT_SVG    = path.join(__dirname, '..', 'data', 'stations.svg');

const DIST_WEIGHT   = parseFloat(process.argv[2]) || 3;
const STATION_COST  = parseFloat(process.argv[3]) || 500000;
const MAX_THROUGHPUT = 7700; // items/min max par gare
const MIN_THROUGHPUT = 7000; // items/min min par gare (soft)

const MAP_SIZE = 5000;
const GAME_X_MIN = -324698.832031;
const GAME_X_MAX =  425301.832031;
const GAME_Y_MIN = -375000;
const GAME_Y_MAX =  375000;

const THROUGHPUT = {
  RP_Inpure: 300,
  RP_Normal: 600,
  RP_Pure:   1200,
};

const PURITY_COLORS = {
  RP_Inpure: '#ffffff', // blanc
  RP_Normal: '#ee8822', // orange
  RP_Pure:   '#dd2222', // rouge vif
};

// ─── Définition des ressources à optimiser ──────────────────────────────────
const RESOURCES = [
  {
    id:            'copper',
    label:         'Cuivre',
    type:          'Desc_OreCopper_C',
    railColor:     '#00ccff',
    fixedStations: [
      { x: 335302, y: 60000, label: 'Usine Cu' },
    ],
  },
  {
    id:            'iron',
    label:         'Fer',
    type:          'Desc_OreIron_C',
    railColor:     '#ff6b6b',
    fixedStations: [
      { x: 335302, y: 30000, label: 'Usine Fe' },
    ],
  },
  {
    id:            'bauxite',
    label:         'Bauxite',
    type:          'Desc_OreBauxite_C',
    railColor:     '#cc5de8',
    fixedStations: [],
  },
];

// ─── Coordonnées ────────────────────────────────────────────────────────────
function gameToPixel(gx, gy) {
  return {
    px: (gx - GAME_X_MIN) / (GAME_X_MAX - GAME_X_MIN) * MAP_SIZE,
    py: (gy - GAME_Y_MIN) / (GAME_Y_MAX - GAME_Y_MIN) * MAP_SIZE,
  };
}

// ─── Chargement des nodes ───────────────────────────────────────────────────
function loadNodes(resourceType) {
  const data     = JSON.parse(fs.readFileSync(MAP_DATA_PATH, 'utf8'));
  const resNodes = data.options.find(o => o.tabId === 'resource_nodes');
  const res      = resNodes.options.find(o => o.type === resourceType);
  if (!res) return [];
  const nodes = [];
  for (const pg of res.options) {
    for (const m of pg.markers) {
      nodes.push({
        x:          m.x,
        y:          m.y,
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

function loopLength(stations) {
  if (stations.length <= 1) return 0;
  let len = 0;
  for (let i = 0; i < stations.length; i++) {
    len += dist(stations[i], stations[(i + 1) % stations.length]);
  }
  return len;
}

function totalConveyorDist(nodes, stations, assignments) {
  let total = 0;
  if (assignments) {
    for (let i = 0; i < nodes.length; i++) {
      total += dist(nodes[i], stations[assignments[i]]);
    }
  } else {
    for (const n of nodes) {
      let minD = Infinity;
      for (const s of stations) minD = Math.min(minD, dist(n, s));
      total += minD;
    }
  }
  return total;
}

function totalCost(stations, nodes) {
  const asg = assignNodes(nodes, stations);
  return loopLength(stations)
    + DIST_WEIGHT * totalConveyorDist(nodes, stations, asg)
    + STATION_COST * stations.length
    + capacityPenalty(nodes, stations, asg);
}

/** Affecte chaque node à la gare la plus proche en respectant le cap throughput */
function assignNodes(nodes, stations) {
  // Trier les nodes par distance à leur gare la plus proche (les plus proches d'abord)
  const indexed = nodes.map((n, i) => {
    let bestD = Infinity, bestC = 0;
    for (let c = 0; c < stations.length; c++) {
      const d = dist(n, stations[c]);
      if (d < bestD) { bestD = d; bestC = c; }
    }
    return { idx: i, bestC, bestD };
  });
  indexed.sort((a, b) => a.bestD - b.bestD);

  const assignments = new Array(nodes.length).fill(-1);
  const stationLoad = new Array(stations.length).fill(0);

  // Passe 1 : affecter au plus proche si le cap le permet
  for (const { idx, bestC } of indexed) {
    if (stationLoad[bestC] + nodes[idx].throughput <= MAX_THROUGHPUT) {
      assignments[idx] = bestC;
      stationLoad[bestC] += nodes[idx].throughput;
    }
  }

  // Passe 2 : nodes non affectés → gare la plus proche avec de la capacité
  for (let i = 0; i < nodes.length; i++) {
    if (assignments[i] >= 0) continue;
    let bestC = -1, bestD = Infinity;
    for (let c = 0; c < stations.length; c++) {
      if (stationLoad[c] + nodes[i].throughput > MAX_THROUGHPUT) continue;
      const d = dist(nodes[i], stations[c]);
      if (d < bestD) { bestD = d; bestC = c; }
    }
    if (bestC >= 0) {
      assignments[i] = bestC;
      stationLoad[bestC] += nodes[i].throughput;
    } else {
      // Overflow : affecter au plus proche quand même (sera pénalisé)
      let bC = 0, bD = Infinity;
      for (let c = 0; c < stations.length; c++) {
        const d = dist(nodes[i], stations[c]);
        if (d < bD) { bD = d; bC = c; }
      }
      assignments[i] = bC;
      stationLoad[bC] += nodes[i].throughput;
    }
  }

  return assignments;
}

/** Pénalité pour dépassement du cap throughput */
function capacityPenalty(nodes, stations, assignments) {
  const loads = new Array(stations.length).fill(0);
  for (let i = 0; i < nodes.length; i++) {
    loads[assignments[i]] += nodes[i].throughput;
  }
  let penalty = 0;
  for (let c = 0; c < stations.length; c++) {
    if (loads[c] > MAX_THROUGHPUT) {
      penalty += (loads[c] - MAX_THROUGHPUT) * 1000;
    }
    if (loads[c] > 0 && loads[c] < MIN_THROUGHPUT && !stations[c].fixed) {
      penalty += (MIN_THROUGHPUT - loads[c]) * 500;
    }
  }
  return penalty;
}

// ─── K-means++ ──────────────────────────────────────────────────────────────
function kmeans(points, k, maxIter = 200) {
  const n = points.length;
  if (k >= n) return points.map(p => ({ x: p.x, y: p.y }));
  // Init++
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
  // Iterate
  for (let iter = 0; iter < maxIter; iter++) {
    const asg = assignNodes(points, centers);
    let changed = false;
    for (let c = 0; c < k; c++) {
      let sx = 0, sy = 0, cnt = 0;
      for (let i = 0; i < n; i++) { if (asg[i] === c) { sx += points[i].x; sy += points[i].y; cnt++; } }
      if (cnt > 0) {
        const nx = sx / cnt, ny = sy / cnt;
        if (Math.abs(centers[c].x - nx) > 1 || Math.abs(centers[c].y - ny) > 1) changed = true;
        centers[c].x = nx; centers[c].y = ny;
      }
    }
    if (!changed) break;
  }
  return centers;
}

// ─── TSP + 2-opt ────────────────────────────────────────────────────────────
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

function twoOpt(stations) {
  const n = stations.length;
  if (n < 4) return stations;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (dist(stations[i], stations[i + 1]) + dist(stations[j], stations[(j + 1) % n])
          > dist(stations[i], stations[j]) + dist(stations[i + 1], stations[(j + 1) % n]) + 1e-6) {
          let l = i + 1, r = j;
          while (l < r) { [stations[l], stations[r]] = [stations[r], stations[l]]; l++; r--; }
          improved = true;
        }
      }
    }
  }
  return stations;
}

// ─── Simulated Annealing ────────────────────────────────────────────────────
function movableIndices(stations) {
  return stations.map((s, i) => s.fixed ? -1 : i).filter(i => i >= 0);
}

function optimizeStations(initStations, nodes, maxIter = 150000) {
  let cur = initStations.map(s => ({ ...s }));
  let curCost = totalCost(cur, nodes);
  let best = cur.map(s => ({ ...s }));
  let bestCost = curCost;
  const coolRate = Math.pow(50 / 80000, 1 / maxIter);
  let temp = 80000;

  for (let i = 0; i < maxIter; i++) {
    temp *= coolRate;
    const cand = cur.map(s => ({ ...s }));
    const r = Math.random();
    const movable = movableIndices(cand);

    if (r < 0.5 && movable.length > 0) {
      const idx = movable[Math.floor(Math.random() * movable.length)];
      cand[idx].x += (Math.random() - 0.5) * 60000 * (temp / 80000);
      cand[idx].y += (Math.random() - 0.5) * 60000 * (temp / 80000);
    } else if (r < 0.7 && cand.length >= 4) {
      let a = Math.floor(Math.random() * cand.length);
      let b = Math.floor(Math.random() * cand.length);
      if (a > b) [a, b] = [b, a];
      if (b - a > 1 && !(a === 0 && b === cand.length - 1)) {
        let l = a + 1, ri = b;
        while (l < ri) { [cand[l], cand[ri]] = [cand[ri], cand[l]]; l++; ri--; }
      }
    } else if (r < 0.85 && movable.length > 2) {
      cand.splice(movable[Math.floor(Math.random() * movable.length)], 1);
    } else {
      let worstNode = null, worstDist = 0;
      for (const n of nodes) {
        let minD = Infinity;
        for (const s of cand) minD = Math.min(minD, dist(n, s));
        if (minD > worstDist) { worstDist = minD; worstNode = n; }
      }
      if (worstNode) {
        let bestIdx = 0, bestIC = Infinity;
        for (let j = 0; j < cand.length; j++) {
          const next = (j + 1) % cand.length;
          const ic = dist(cand[j], worstNode) + dist(worstNode, cand[next]) - dist(cand[j], cand[next]);
          if (ic < bestIC) { bestIC = ic; bestIdx = j + 1; }
        }
        cand.splice(bestIdx, 0, { x: worstNode.x, y: worstNode.y });
      }
    }

    const candCost = totalCost(cand, nodes);
    if (candCost < curCost || Math.random() < Math.exp(-(candCost - curCost) / temp)) {
      cur = cand; curCost = candCost;
      if (curCost < bestCost) { best = cur.map(s => ({ ...s })); bestCost = curCost; }
    }
    if (i % 50000 === 0) {
      console.log(`    SA ${i}/${maxIter} temp=${temp.toFixed(0)} cost=${curCost.toFixed(0)} best=${bestCost.toFixed(0)} n=${cur.length}`);
    }
  }
  console.log(`    SA done: ${bestCost.toFixed(0)}, ${best.length} stations`);
  return best;
}

// ─── Optimise une ressource ─────────────────────────────────────────────────
function optimizeResource(resDef) {
  const nodes = loadNodes(resDef.type);
  if (nodes.length === 0) { console.log(`  ${resDef.label}: aucun node trouvé`); return null; }

  console.log(`\n── ${resDef.label} (${nodes.length} nodes) ──`);
  const nFixed = resDef.fixedStations.length;

  // Scan k = max(2, nFixed+1) .. 15
  let bestResult = null, bestCostAll = Infinity;
  const minK = Math.max(2, nFixed + 1);

  for (let k = minK; k <= Math.min(15, nodes.length); k++) {
    let bestStations = null, bestCost = Infinity;
    for (let run = 0; run < 20; run++) {
      let free = kmeans(nodes, k - nFixed);
      let stations = [
        ...resDef.fixedStations.map(s => ({ x: s.x, y: s.y, fixed: true, label: s.label })),
        ...free,
      ];
      stations = tspOrder(stations);
      stations = twoOpt(stations);
      const cost = totalCost(stations, nodes);
      if (cost < bestCost) { bestCost = cost; bestStations = stations; }
    }
    const rl = loopLength(bestStations);
    const asg = assignNodes(nodes, bestStations);
    const ct = totalConveyorDist(nodes, bestStations, asg);
    console.log(`  k=${String(k).padStart(2)} rail=${(rl/100).toFixed(0).padStart(6)}m conv=${(ct/100).toFixed(0).padStart(6)}m cost=${bestCost.toFixed(0)}`);
    if (bestCost < bestCostAll) { bestCostAll = bestCost; bestResult = { k, stations: bestStations }; }
  }

  // Affiner avec SA
  console.log(`  Affinage SA (k=${bestResult.k})...`);
  let refined = optimizeStations(bestResult.stations, nodes);
  refined = twoOpt(refined);
  const rCost = totalCost(refined, nodes);
  if (rCost < bestCostAll) {
    console.log(`  Amélioré: ${bestCostAll.toFixed(0)} → ${rCost.toFixed(0)}`);
    bestResult.stations = refined;
    bestResult.k = refined.length;
  }

  const stations    = bestResult.stations;
  const assignments = assignNodes(nodes, stations);

  // Log détail
  for (let c = 0; c < stations.length; c++) {
    const sn = nodes.filter((_, i) => assignments[i] === c);
    const tp = sn.reduce((s, n) => s + n.throughput, 0);
    const mx = sn.reduce((m, n) => Math.max(m, dist(n, stations[c])), 0);
    const fl = stations[c].fixed ? ` [${stations[c].label}]` : '';
    const warn = tp > MAX_THROUGHPUT ? ` !! OVER ${MAX_THROUGHPUT}`
      : (tp < MIN_THROUGHPUT && !stations[c].fixed) ? ` !! UNDER ${MIN_THROUGHPUT}`
      : '';
    console.log(`  G${c + 1}${fl} (${stations[c].x.toFixed(0)}, ${stations[c].y.toFixed(0)}) ${sn.length}n ${tp}/m conv_max=${(mx/100).toFixed(0)}m${warn}`);
  }

  return { nodes, stations, assignments, resDef };
}

// ─── Génération SVG multi-layers ────────────────────────────────────────────
function generateSVG(resourceResults) {
  const topoSvg   = fs.readFileSync(TOPO_SVG_PATH, 'utf8');
  const topoInner = topoSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];

  const clusterColors = [
    '#00ccff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8',
    '#ff922b', '#20c997', '#f06595', '#748ffc', '#a9e34b',
    '#e599f7', '#63e6be', '#ffa8a8', '#91a7ff', '#c0eb75',
  ];

  // Construire les layers par ressource
  const resourceLayers = resourceResults.filter(Boolean).map(res => {
    const { nodes, stations, assignments, resDef } = res;
    const rc = resDef.railColor;

    // Rail loop
    const stPx = stations.map(s => gameToPixel(s.x, s.y));
    let railPath = `M ${stPx[0].px.toFixed(1)} ${stPx[0].py.toFixed(1)}`;
    for (let i = 1; i < stPx.length; i++) {
      railPath += ` L ${stPx[i].px.toFixed(1)} ${stPx[i].py.toFixed(1)}`;
    }
    railPath += ' Z';

    // Convoyeurs
    const convLines = nodes.map((n, i) => {
      const c  = assignments[i];
      const np = gameToPixel(n.x, n.y);
      const sp = gameToPixel(stations[c].x, stations[c].y);
      return `    <line x1="${np.px.toFixed(1)}" y1="${np.py.toFixed(1)}" x2="${sp.px.toFixed(1)}" y2="${sp.py.toFixed(1)}" stroke="${rc}" stroke-width="1" stroke-dasharray="6,3" opacity="0.5"/>`;
    }).join('\n');

    // Nodes
    const nodeCircles = nodes.map((n, i) => {
      const { px, py } = gameToPixel(n.x, n.y);
      const color = PURITY_COLORS[n.purity] || '#fff';
      const r = 10;
      return `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="${color}" stroke="${rc}" stroke-width="2" opacity="0.9"/>`;
    }).join('\n');

    // Gares
    const stMarkers = stations.map((s, i) => {
      const { px, py } = gameToPixel(s.x, s.y);
      const label = s.fixed ? s.label : `${resDef.id[0].toUpperCase()}${i + 1}`;
      const size  = s.fixed ? 16 : 12;
      const sk    = s.fixed ? '#ff0' : '#000';
      const sw    = s.fixed ? 3 : 2;
      const cn    = nodes.filter((_, ni) => assignments[ni] === i);
      const tp    = cn.reduce((sum, n) => sum + n.throughput, 0);
      return [
        `    <rect x="${(px-size).toFixed(1)}" y="${(py-size).toFixed(1)}" width="${size*2}" height="${size*2}" rx="3" fill="${rc}" stroke="${sk}" stroke-width="${sw}" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`,
        `    <text x="${(px+size+8).toFixed(1)}" y="${(py-14).toFixed(1)}" fill="#fff" font-size="${s.fixed?16:14}" font-weight="bold" font-family="sans-serif" stroke="#000" stroke-width="3" paint-order="stroke">${label}</text>`,
        `    <text x="${(px+size+8).toFixed(1)}" y="${(py+4).toFixed(1)}" fill="#ccc" font-size="11" font-family="sans-serif" stroke="#000" stroke-width="2" paint-order="stroke">${cn.length}n ${tp}/m</text>`,
      ].join('\n');
    }).join('\n');

    return `  <g inkscape:groupmode="layer" inkscape:label="${resDef.label} (${stations.length} gares)" id="layer-${resDef.id}" style="display:inline">
    <path d="${railPath}" fill="none" stroke="${rc}" stroke-width="3.5" stroke-linejoin="round" opacity="0.85"/>
${convLines}
${nodeCircles}
${stMarkers}
  </g>`;
  }).join('\n\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" width="${MAP_SIZE}" height="${MAP_SIZE}">

  <g inkscape:groupmode="layer" inkscape:label="Carte topo" id="layer-topo" style="display:inline">
${topoInner}
  </g>

${resourceLayers}

</svg>`;

  fs.writeFileSync(OUTPUT_SVG, svg, 'utf8');
  console.log(`\nSVG: ${OUTPUT_SVG}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
function main() {
  console.log(`=== Optimisation multi-ressources ===`);
  console.log(`distWeight=${DIST_WEIGHT}, stationCost=${STATION_COST}\n`);

  const results = RESOURCES.map(r => optimizeResource(r));

  console.log('\n── Génération SVG multi-layers ──');
  generateSVG(results);
  console.log('\nTerminé!');
}

main();
