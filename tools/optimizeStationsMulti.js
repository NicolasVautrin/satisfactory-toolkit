'use strict';
/**
 * optimizeStationsMulti.js
 *
 * Optimise le placement de gares ferroviaires PARTAGÉES entre ressources.
 * Chaque gare a 4 docks, ressources mélangées (smart splitters au déchargement).
 * Réseau en arbre (MST), capacité dynamique selon le round-trip time.
 *
 * Usage: node optimizeStationsMulti.js [key=value ...]
 *   dw=3        : poids des distances convoyeurs vs rail
 *   minK=auto   : k min du scan (auto = ceil(demande/capMax))
 *   maxK=auto   : k max du scan (auto = ceil(demande/capPlancher)+5)
 *   sa=200000   : itérations SA
 *   topK=1      : nombre de meilleurs k à affiner en SA
 */

const fs   = require('fs');
const path = require('path');

// ─── Parsing arguments key=value ────────────────────────────────────────────
const ARGS = {};
for (const arg of process.argv.slice(2)) {
  const [k, v] = arg.split('=');
  ARGS[k] = v !== undefined ? v : 'true';
}

// ─── Configuration ──────────────────────────────────────────────────────────
const MAP_DATA_PATH = path.join(__dirname, '..', 'data', 'mapObjects.json');
const TOPO_SVG_PATH = path.join(__dirname, '..', 'map_topo.svg');
const OUTPUT_SVG    = path.join(__dirname, '..', 'stations_multi.svg');

const DIST_WEIGHT       = parseFloat(ARGS.dw) || 3;
const SA_ITERATIONS     = parseInt(ARGS.sa)   || 200000;
const SA_TOP_K          = parseInt(ARGS.topK) || 1;
const DOCKS_PER_STATION = 4;
const DOCK_CAPACITY     = 9600;  // items par dock par voyage (48 stacks × 200)
const LOAD_UNLOAD_TIME = 1;     // min (2 × 30s)
const FILL_TIME         = 4;     // min pour remplir un dock (9600 / 2×1200)
const TRAIN_SPEED = 200000; // 120 km/h en UU/min

const MAP_SIZE   = 5000;
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
  RP_Inpure: '#ffffff',
  RP_Normal: '#ee8822',
  RP_Pure:   '#dd2222',
};

// ─── Ressources ─────────────────────────────────────────────────────────────
const RESOURCES = [
  { id: 'copper',  label: 'Cuivre',  abbr: 'Cu', type: 'Desc_OreCopper_C', color: '#00ccff' },
  { id: 'iron',    label: 'Fer',     abbr: 'Fe', type: 'Desc_OreIron_C',   color: '#ff6b6b' },
  { id: 'bauxite', label: 'Bauxite', abbr: 'Bx', type: 'Desc_OreBauxite_C', color: '#cc5de8' },
];

const RES_IDS   = RESOURCES.map(r => r.id);
const RES_ABBR  = Object.fromEntries(RESOURCES.map(r => [r.id, r.abbr]));
const RES_COLOR = Object.fromEntries(RESOURCES.map(r => [r.id, r.color]));

// Gares fixes (positions imposées, non déplaçables par le SA)
const FIXED_STATIONS = [
  { x: 335302, y: 45000, label: 'Usine' },
];

// ─── Coordonnées ────────────────────────────────────────────────────────────
function gameToPixel(gx, gy) {
  return {
    px: (gx - GAME_X_MIN) / (GAME_X_MAX - GAME_X_MIN) * MAP_SIZE,
    py: (gy - GAME_Y_MIN) / (GAME_Y_MAX - GAME_Y_MIN) * MAP_SIZE,
  };
}

// ─── Chargement de tous les nodes ───────────────────────────────────────────
function loadAllNodes() {
  const data     = JSON.parse(fs.readFileSync(MAP_DATA_PATH, 'utf8'));
  const resNodes = data.options.find(o => o.tabId === 'resource_nodes');
  const allNodes = [];
  for (const resDef of RESOURCES) {
    const res = resNodes.options.find(o => o.type === resDef.type);
    if (!res) continue;
    for (const pg of res.options) {
      for (const m of pg.markers) {
        allNodes.push({
          x:          m.x,
          y:          m.y,
          purity:     m.purity,
          throughput: THROUGHPUT[m.purity] || 0,
          resource:   resDef.id,
        });
      }
    }
  }
  return allNodes;
}

// ─── Géométrie ──────────────────────────────────────────────────────────────
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** MST via Prim — retourne { length, edges: [[i,j], ...] } */
function computeMST(stations) {
  const n = stations.length;
  if (n <= 1) return { length: 0, edges: [] };
  const inMST   = new Array(n).fill(false);
  const minEdge = new Array(n).fill(Infinity);
  const parent  = new Array(n).fill(-1);
  minEdge[0] = 0;
  let totalLen = 0;
  const edges  = [];

  for (let step = 0; step < n; step++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || minEdge[i] < minEdge[u])) u = i;
    }
    inMST[u] = true;
    totalLen += minEdge[u];
    if (parent[u] >= 0) edges.push([parent[u], u]);

    for (let v = 0; v < n; v++) {
      if (inMST[v]) continue;
      const d = dist(stations[u], stations[v]);
      if (d < minEdge[v]) { minEdge[v] = d; parent[v] = u; }
    }
  }
  return { length: totalLen, edges };
}

/** Distance de chaque gare à la racine (index 0 = Usine) via le MST */
function computeDistToRoot(stations) {
  const mst = computeMST(stations);
  const n   = stations.length;
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of mst.edges) {
    const d = dist(stations[a], stations[b]);
    adj[a].push({ to: b, d });
    adj[b].push({ to: a, d });
  }
  const distToRoot = new Array(n).fill(-1);
  distToRoot[0] = 0;
  const queue = [0];
  while (queue.length > 0) {
    const u = queue.shift();
    for (const { to, d } of adj[u]) {
      if (distToRoot[to] < 0) {
        distToRoot[to] = distToRoot[u] + d;
        queue.push(to);
      }
    }
  }
  return { distToRoot, mst };
}

/** Coût train = Σ aller-retour de chaque gare vers la racine */
function totalTrainDist(stations) {
  const { distToRoot } = computeDistToRoot(stations);
  let total = 0;
  for (let s = 1; s < stations.length; s++) {
    total += 2 * distToRoot[s];
  }
  return total;
}

// ─── Capacité dynamique ─────────────────────────────────────────────────────
/**
 * Max throughput par gare en fonction du round-trip time (min).
 * - perDock = max(9600/(rt+1), 9600/5) → plus de trips si le train revient vite
 * - cappé à 2×1200 = 2400/min par dock (limite physique des belts Mk6)
 * × 4 docks par gare
 */
const BELT_CAP_PER_DOCK = 2400; // 2 × Mk6 (1200/min)

function stationMaxThroughput(rtMin) {
  const perDock = Math.min(
    BELT_CAP_PER_DOCK,
    Math.max(DOCK_CAPACITY / (rtMin + LOAD_UNLOAD_TIME), DOCK_CAPACITY / (FILL_TIME + LOAD_UNLOAD_TIME)),
  );
  return perDock * DOCKS_PER_STATION;
}

// ─── Helpers station ────────────────────────────────────────────────────────
function cloneStation(s) {
  const c = { x: s.x, y: s.y };
  if (s.fixed) c.fixed = true;
  if (s.label) c.label = s.label;
  return c;
}

function cloneStations(stations) {
  return stations.map(cloneStation);
}

// ─── Affectation ────────────────────────────────────────────────────────────
function assignNodes(allNodes, stations, maxTP) {
  const assignments = new Array(allNodes.length).fill(-1);
  const loads       = new Array(stations.length).fill(0);

  // Trier par distance au plus proche
  const indexed = allNodes.map((n, i) => {
    let bestD = Infinity;
    for (let s = 0; s < stations.length; s++) {
      bestD = Math.min(bestD, dist(n, stations[s]));
    }
    return { idx: i, bestD };
  });
  indexed.sort((a, b) => a.bestD - b.bestD);

  // Passe 1 : plus proche avec capacité
  for (const { idx } of indexed) {
    const n = allNodes[idx];
    let bestS = -1, bestD = Infinity;
    for (let s = 0; s < stations.length; s++) {
      if (loads[s] + n.throughput > maxTP[s]) continue;
      const d = dist(n, stations[s]);
      if (d < bestD) { bestD = d; bestS = s; }
    }
    if (bestS >= 0) {
      assignments[idx] = bestS;
      loads[bestS] += n.throughput;
    }
  }

  // Passe 2 : overflow → plus proche (sera pénalisé)
  for (let i = 0; i < allNodes.length; i++) {
    if (assignments[i] >= 0) continue;
    let bestS = 0, bestD = Infinity;
    for (let s = 0; s < stations.length; s++) {
      const d = dist(allNodes[i], stations[s]);
      if (d < bestD) { bestD = d; bestS = s; }
    }
    assignments[i] = bestS;
    loads[bestS] += allNodes[i].throughput;
  }

  return assignments;
}

// ─── Fonction de coût ───────────────────────────────────────────────────────
function totalConveyorDist(allNodes, stations, assignments) {
  let total = 0;
  for (let i = 0; i < allNodes.length; i++) {
    total += dist(allNodes[i], stations[assignments[i]]);
  }
  return total;
}

function capacityPenalty(allNodes, stations, assignments, maxTP) {
  const loads = new Array(stations.length).fill(0);
  for (let i = 0; i < allNodes.length; i++) {
    loads[assignments[i]] += allNodes[i].throughput;
  }
  let penalty = 0;
  for (let s = 0; s < stations.length; s++) {
    if (loads[s] > maxTP[s]) {
      penalty += (loads[s] - maxTP[s]) * 1000;
    }
    const minTP = maxTP[s] * 0.9;
    if (loads[s] > 0 && loads[s] < minTP && !stations[s].fixed) {
      penalty += (minTP - loads[s]) * 500;
    }
  }
  return penalty;
}

function totalCost(stations, allNodes) {
  const { distToRoot } = computeDistToRoot(stations);
  const maxTP = distToRoot.map(d => stationMaxThroughput(2 * d / TRAIN_SPEED));
  const asg   = assignNodes(allNodes, stations, maxTP);
  return totalTrainDist(stations)
    + DIST_WEIGHT * totalConveyorDist(allNodes, stations, asg)
    + capacityPenalty(allNodes, stations, asg, maxTP);
}

// ─── K-means++ (sur tous les nodes) ─────────────────────────────────────────
function kmeans(points, k, maxIter = 200) {
  const n = points.length;
  if (k >= n) return points.map(p => ({ x: p.x, y: p.y }));
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
    if (centers.length <= c) {
      centers.push({ x: points[Math.floor(Math.random() * n)].x, y: points[Math.floor(Math.random() * n)].y });
    }
  }
  for (let iter = 0; iter < maxIter; iter++) {
    const asg = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let bestD = Infinity, bestC = 0;
      for (let c = 0; c < centers.length; c++) {
        const d = dist(points[i], centers[c]);
        if (d < bestD) { bestD = d; bestC = c; }
      }
      asg[i] = bestC;
    }
    let changed = false;
    for (let c = 0; c < centers.length; c++) {
      let sx = 0, sy = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
        if (asg[i] === c) { sx += points[i].x; sy += points[i].y; cnt++; }
      }
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

// ─── Simulated Annealing ────────────────────────────────────────────────────
function movableIndices(stations) {
  return stations.map((s, i) => s.fixed ? -1 : i).filter(i => i >= 0);
}

function optimizeSA(initStations, allNodes, maxIter = SA_ITERATIONS) {
  let cur      = cloneStations(initStations);
  let curCost  = totalCost(cur, allNodes);
  let best     = cloneStations(cur);
  let bestCost = curCost;
  const coolRate = Math.pow(50 / 80000, 1 / maxIter);
  let temp = 80000;

  for (let i = 0; i < maxIter; i++) {
    temp *= coolRate;
    const cand    = cloneStations(cur);
    const r       = Math.random();
    const movable = movableIndices(cand);

    if (r < 0.55 && movable.length > 0) {
      // Déplacer une gare
      const idx = movable[Math.floor(Math.random() * movable.length)];
      cand[idx].x += (Math.random() - 0.5) * 60000 * (temp / 80000);
      cand[idx].y += (Math.random() - 0.5) * 60000 * (temp / 80000);
    } else if (r < 0.75 && movable.length > 2) {
      // Supprimer une gare
      cand.splice(movable[Math.floor(Math.random() * movable.length)], 1);
    } else {
      // Ajouter une gare au node le plus éloigné
      let worstNode = null, worstDist = 0;
      for (const n of allNodes) {
        let minD = Infinity;
        for (const s of cand) minD = Math.min(minD, dist(n, s));
        if (minD > worstDist) { worstDist = minD; worstNode = n; }
      }
      if (worstNode) {
        cand.push({ x: worstNode.x, y: worstNode.y });
      }
    }

    const candCost = totalCost(cand, allNodes);
    if (candCost < curCost || Math.random() < Math.exp(-(candCost - curCost) / temp)) {
      cur = cand; curCost = candCost;
      if (curCost < bestCost) { best = cloneStations(cur); bestCost = curCost; }
    }
    if (i % 50000 === 0) {
      console.log(`    SA ${i}/${maxIter} temp=${temp.toFixed(0)} cost=${curCost.toFixed(0)} best=${bestCost.toFixed(0)} n=${cur.length}`);
    }
  }
  console.log(`    SA done: ${bestCost.toFixed(0)}, ${best.length} stations`);
  return best;
}

// ─── Génération SVG multi-layers ────────────────────────────────────────────
function generateSVG(stations, allNodes, assignments, distToRoot) {
  const topoSvg   = fs.readFileSync(TOPO_SVG_PATH, 'utf8');
  const topoInner = topoSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];

  // Arêtes MST
  const stPx     = stations.map(s => gameToPixel(s.x, s.y));
  const mst      = computeMST(stations);
  const mstLines = mst.edges.map(([a, b]) => {
    const pa = stPx[a], pb = stPx[b];
    return `    <line x1="${pa.px.toFixed(1)}" y1="${pa.py.toFixed(1)}" x2="${pb.px.toFixed(1)}" y2="${pb.py.toFixed(1)}" stroke="#ffffff" stroke-width="3.5" opacity="0.7"/>`;
  }).join('\n');

  // Marqueurs gares
  const stMarkers = stations.map((s, i) => {
    const { px, py } = gameToPixel(s.x, s.y);
    const label = s.fixed ? s.label : `G${i + 1}`;
    const size  = s.fixed ? 16 : 12;
    const sk    = s.fixed ? '#ff0' : '#000';
    const sw    = s.fixed ? 3 : 2;

    // Couleur = ressource dominante
    const sn = allNodes.filter((_, ni) => assignments[ni] === i);
    const tpPerRes = {};
    for (const r of RES_IDS) tpPerRes[r] = 0;
    for (const n of sn) tpPerRes[n.resource] += n.throughput;
    const dominant = RES_IDS.reduce((best, r) => tpPerRes[r] > tpPerRes[best] ? r : best, RES_IDS[0]);
    const fill = RES_COLOR[dominant];

    const totalTp = sn.reduce((sum, n) => sum + n.throughput, 0);
    const rtMin   = (2 * distToRoot[i] / TRAIN_SPEED).toFixed(1);
    const maxTP   = Math.round(stationMaxThroughput(2 * distToRoot[i] / TRAIN_SPEED));

    return [
      `    <rect x="${(px-size).toFixed(1)}" y="${(py-size).toFixed(1)}" width="${size*2}" height="${size*2}" rx="3" fill="${fill}" stroke="${sk}" stroke-width="${sw}" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`,
      `    <text x="${(px+size+8).toFixed(1)}" y="${(py-14).toFixed(1)}" fill="#fff" font-size="${s.fixed?16:14}" font-weight="bold" font-family="sans-serif" stroke="#000" stroke-width="3" paint-order="stroke">${label}</text>`,
      `    <text x="${(px+size+8).toFixed(1)}" y="${(py+4).toFixed(1)}" fill="#ccc" font-size="11" font-family="sans-serif" stroke="#000" stroke-width="2" paint-order="stroke">${totalTp}/${maxTP} rt=${rtMin}m</text>`,
    ].join('\n');
  }).join('\n');

  // Layers par ressource (nodes + convoyeurs)
  const resLayers = RESOURCES.map(resDef => {
    const resNodes = allNodes
      .map((n, i) => ({ ...n, _i: i }))
      .filter(n => n.resource === resDef.id);

    const convLines = resNodes.map(n => {
      const np = gameToPixel(n.x, n.y);
      const sp = gameToPixel(stations[assignments[n._i]].x, stations[assignments[n._i]].y);
      return `    <line x1="${np.px.toFixed(1)}" y1="${np.py.toFixed(1)}" x2="${sp.px.toFixed(1)}" y2="${sp.py.toFixed(1)}" stroke="${resDef.color}" stroke-width="1" stroke-dasharray="6,3" opacity="0.5"/>`;
    }).join('\n');

    const nodeCircles = resNodes.map(n => {
      const { px, py } = gameToPixel(n.x, n.y);
      const color = PURITY_COLORS[n.purity] || '#fff';
      return `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="10" fill="${color}" stroke="${resDef.color}" stroke-width="2" opacity="0.9"/>`;
    }).join('\n');

    return `  <g inkscape:groupmode="layer" inkscape:label="${resDef.label} (${resNodes.length} nodes)" id="layer-${resDef.id}" style="display:inline">
${convLines}
${nodeCircles}
  </g>`;
  }).join('\n\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" width="${MAP_SIZE}" height="${MAP_SIZE}">

  <g inkscape:groupmode="layer" inkscape:label="Carte topo" id="layer-topo" style="display:inline">
${topoInner}
  </g>

  <g inkscape:groupmode="layer" inkscape:label="Réseau ferré (${stations.length} gares)" id="layer-rail" style="display:inline">
${mstLines}
${stMarkers}
  </g>

${resLayers}

</svg>`;

  fs.writeFileSync(OUTPUT_SVG, svg, 'utf8');
  console.log(`SVG: ${OUTPUT_SVG}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
function main() {
  console.log('=== Optimisation multi-ressources (gares partagées, capacité dynamique) ===');
  console.log(`dw=${DIST_WEIGHT}, ${DOCKS_PER_STATION} docks/gare, sa=${SA_ITERATIONS}, topK=${SA_TOP_K}`);
  console.log(`capacité/dock: ${DOCK_CAPACITY}/(rt+${LOAD_UNLOAD_TIME}) items/min, plancher à rt=${FILL_TIME}min\n`);

  const allNodes    = loadAllNodes();
  const totalDemand = allNodes.reduce((s, n) => s + n.throughput, 0);
  const baseCap     = stationMaxThroughput(FILL_TIME); // capacité plancher

  console.log(`Nodes: ${allNodes.length} (${RESOURCES.map(r => {
    const cnt = allNodes.filter(n => n.resource === r.id).length;
    return `${r.abbr}:${cnt}`;
  }).join(', ')})`);
  console.log(`Demande totale: ${totalDemand}/min, capacité plancher/gare: ${baseCap.toFixed(0)}/min`);
  console.log(`→ min théorique: ${Math.ceil(totalDemand / baseCap)} gares\n`);

  const nFixed        = FIXED_STATIONS.length;
  const theoreticalK  = Math.ceil(totalDemand / baseCap);
  const maxCapStation = stationMaxThroughput(0);
  const practicalMin  = Math.ceil(totalDemand / maxCapStation);
  const minK          = parseInt(ARGS.minK) || Math.max(nFixed + 1, practicalMin);
  const maxK          = parseInt(ARGS.maxK) || theoreticalK + 5;

  console.log(`Scan k=${minK}..${maxK}\n`);

  // ── Scan k ──
  const kResults = [];

  for (let k = minK; k <= maxK; k++) {
    let bestStations = null, bestCost = Infinity;
    for (let run = 0; run < 20; run++) {
      const free = kmeans(allNodes, k - nFixed);
      const stations = [
        ...FIXED_STATIONS.map(s => ({ x: s.x, y: s.y, fixed: true, label: s.label })),
        ...free.map(c => ({ x: c.x, y: c.y })),
      ];
      const cost = totalCost(stations, allNodes);
      if (cost < bestCost) { bestCost = cost; bestStations = cloneStations(stations); }
    }
    const trainD   = totalTrainDist(bestStations);
    const { distToRoot } = computeDistToRoot(bestStations);
    const maxTP    = distToRoot.map(d => stationMaxThroughput(2 * d / TRAIN_SPEED));
    const asg      = assignNodes(allNodes, bestStations, maxTP);
    const ct       = totalConveyorDist(allNodes, bestStations, asg);
    const trainMin = (trainD / TRAIN_SPEED).toFixed(1);
    console.log(`  k=${String(k).padStart(2)} train=${trainMin.padStart(6)}min conv=${(ct/100).toFixed(0).padStart(6)}m cost=${bestCost.toFixed(0)}`);
    kResults.push({ k, cost: bestCost, stations: bestStations });
  }

  // ── SA sur les topK meilleurs k ──
  kResults.sort((a, b) => a.cost - b.cost);
  const candidates = kResults.slice(0, SA_TOP_K);

  let bestResult = null, bestCostAll = Infinity;

  for (const cand of candidates) {
    console.log(`\nAffinage SA (k=${cand.k}, coût scan=${cand.cost.toFixed(0)})...`);
    const refined = optimizeSA(cand.stations, allNodes);
    const rCost   = totalCost(refined, allNodes);
    console.log(`  k=${cand.k} → ${refined.length} gares, coût=${rCost.toFixed(0)}`);
    if (rCost < bestCostAll) {
      bestCostAll = rCost;
      bestResult  = { k: refined.length, stations: refined };
    }
  }

  // Rapport
  const stations    = bestResult.stations;
  const { distToRoot } = computeDistToRoot(stations);
  const maxTP       = distToRoot.map(d => stationMaxThroughput(2 * d / TRAIN_SPEED));
  const assignments = assignNodes(allNodes, stations, maxTP);

  const trainD        = totalTrainDist(stations);
  const convD         = totalConveyorDist(allNodes, stations, assignments);
  const penalty       = capacityPenalty(allNodes, stations, assignments, maxTP);
  const totalTrainMin = (trainD / TRAIN_SPEED).toFixed(1);
  console.log(`\n── Résultat: ${stations.length} gares, temps train total: ${totalTrainMin} min ──`);
  console.log(`   coût: train=${(trainD/100).toFixed(0)}m  belt=${(convD/100).toFixed(0)}m (×${DIST_WEIGHT}=${(convD*DIST_WEIGHT/100).toFixed(0)}m)  penalty=${penalty.toFixed(0)}`);
  for (let c = 0; c < stations.length; c++) {
    const s  = stations[c];
    const sn = allNodes.filter((_, i) => assignments[i] === c);
    const mx = sn.reduce((m, n) => Math.max(m, dist(n, s)), 0);
    const fl = s.fixed ? ` [${s.label}]` : '';
    const rt = (2 * distToRoot[c] / TRAIN_SPEED).toFixed(1);

    // Throughput par ressource
    const tpPerRes = {};
    for (const r of RES_IDS) tpPerRes[r] = 0;
    let totalTp = 0;
    for (const n of sn) { tpPerRes[n.resource] += n.throughput; totalTp += n.throughput; }

    const resStr = RES_IDS
      .filter(r => tpPerRes[r] > 0)
      .map(r => `${RES_ABBR[r]}:${tpPerRes[r]}`)
      .join(' ');

    const cap  = Math.round(maxTP[c]);
    const pct  = cap > 0 ? Math.round(100 * totalTp / cap) : 0;
    const warn = totalTp > cap ? ' !! OVER'
      : (totalTp > 0 && pct < 90 && !s.fixed) ? ' ~ UNDER'
      : '';

    console.log(`  G${String(c+1).padStart(2)}${fl} (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) ${resStr} total=${totalTp}/${cap} (${pct}%) rt=${rt}min conv_max=${(mx/100).toFixed(0)}m${warn}`);
  }

  // SVG
  console.log('\n── Génération SVG ──');
  generateSVG(stations, allNodes, assignments, distToRoot);
  console.log('\nTerminé!');
}

main();
