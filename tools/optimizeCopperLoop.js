#!/usr/bin/env node
'use strict';

/**
 * optimizeCopperLoop.js
 *
 * Trouve le tracé optimal d'une boucle ferroviaire fermée passant au plus près
 * de tous les nodes de cuivre de la map Satisfactory.
 *
 * Coût = longueur(boucle) + Σ distance(node_cuivre_i, boucle)
 *
 * Sortie : SVG superposé sur la carte topo + waypoints en console.
 */

const fs   = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────
const MAP_DATA_PATH = path.join(__dirname, '..', 'data', 'mapObjects.json');
const TOPO_SVG_PATH = path.join(__dirname, '..', 'map_topo.svg');
const OUTPUT_SVG    = path.join(__dirname, '..', 'copperLoop.svg');
const OUTPUT_HTML   = path.join(__dirname, '..', 'copperLoop.html');

// Poids relatif distance aux nodes vs longueur de la boucle
// > 1 : la boucle se rapproche davantage des nodes (quitte à être plus longue)
// < 1 : la boucle privilégie un tracé court (quitte à s'éloigner de certains nodes)
const DISTANCE_WEIGHT = parseFloat(process.argv[2]) || 3;

// Calibration SCIM (SC-InteractiveMap) — axe X décalé de ~503m
const MAP_SIZE   = 5000;
const GAME_X_MIN = -324698.832031;
const GAME_X_MAX =  425301.832031;
const GAME_Y_MIN = -375000;
const GAME_Y_MAX =  375000;

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

// ─── Chargement des nodes de cuivre ─────────────────────────────────────────
function loadCopperNodes() {
  const data     = JSON.parse(fs.readFileSync(MAP_DATA_PATH, 'utf8'));
  const resNodes = data.options.find(o => o.tabId === 'resource_nodes');
  const copper   = resNodes.options.find(o => o.type === 'Desc_OreCopper_C');
  const nodes    = [];
  for (const purityGroup of copper.options) {
    for (const m of purityGroup.markers) {
      nodes.push({
        x:      m.x,
        y:      m.y,
        z:      m.z,
        purity: m.purity,
        name:   m.pathName,
      });
    }
  }
  console.log(`Chargé ${nodes.length} nodes de cuivre`);
  return nodes;
}

// ─── Géométrie utilitaire ───────────────────────────────────────────────────
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance d'un point P au segment [A, B] */
function distPointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Distance d'un point à la boucle (minimum sur tous les segments) */
function distPointToLoop(p, loop) {
  let minD = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    const d = distPointToSegment(p, loop[i], loop[j]);
    if (d < minD) minD = d;
  }
  return minD;
}

/** Longueur totale de la boucle */
function loopLength(loop) {
  let len = 0;
  for (let i = 0; i < loop.length; i++) {
    len += dist(loop[i], loop[(i + 1) % loop.length]);
  }
  return len;
}

/** Coût total = longueur(boucle) + DISTANCE_WEIGHT × Σ dist(node, boucle) */
function totalCost(loop, nodes) {
  let cost = loopLength(loop);
  for (const n of nodes) {
    cost += DISTANCE_WEIGHT * distPointToLoop(n, loop);
  }
  return cost;
}

// ─── TSP : Nearest Neighbor ────────────────────────────────────────────────
function nearestNeighborTSP(points) {
  const n       = points.length;
  const visited = new Set();
  const tour    = [0];
  visited.add(0);

  for (let step = 1; step < n; step++) {
    const last = tour[tour.length - 1];
    let bestD  = Infinity;
    let bestJ  = -1;
    for (let j = 0; j < n; j++) {
      if (visited.has(j)) continue;
      const d = dist(points[last], points[j]);
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    tour.push(bestJ);
    visited.add(bestJ);
  }
  return tour.map(i => ({ ...points[i] }));
}

// ─── 2-opt ─────────────────────────────────────────────────────────────────
function twoOpt(loop, nodes, maxIter = 5000) {
  const n = loop.length;
  let improved = true;
  let iter = 0;

  while (improved && iter < maxIter) {
    improved = false;
    iter++;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // pas de swap trivial
        // Tester le gain du 2-opt swap
        const a = loop[i], b = loop[i + 1];
        const c = loop[j], d = loop[(j + 1) % n];
        const before = dist(a, b) + dist(c, d);
        const after  = dist(a, c) + dist(b, d);
        if (after < before - 1e-6) {
          // Reverser le sous-chemin [i+1 .. j]
          let left = i + 1, right = j;
          while (left < right) {
            [loop[left], loop[right]] = [loop[right], loop[left]];
            left++;
            right--;
          }
          improved = true;
        }
      }
    }
  }
  console.log(`2-opt: ${iter} itérations`);
  return loop;
}

// ─── Simulated Annealing ───────────────────────────────────────────────────
function simulatedAnnealing(loop, nodes, {
  maxIter     = 200000,
  tempStart   = 50000,
  tempEnd     = 100,
  moveRadius  = 15000,
} = {}) {
  let bestLoop = loop.map(p => ({ ...p }));
  let bestCost = totalCost(bestLoop, nodes);
  let curLoop  = bestLoop.map(p => ({ ...p }));
  let curCost  = bestCost;

  const coolRate = Math.pow(tempEnd / tempStart, 1 / maxIter);
  let temp = tempStart;

  for (let i = 0; i < maxIter; i++) {
    temp *= coolRate;

    // Choisir une perturbation
    const r = Math.random();
    const candidate = curLoop.map(p => ({ ...p }));

    if (r < 0.4) {
      // Déplacer un waypoint
      const idx = Math.floor(Math.random() * candidate.length);
      candidate[idx].x += (Math.random() - 0.5) * 2 * moveRadius * (temp / tempStart);
      candidate[idx].y += (Math.random() - 0.5) * 2 * moveRadius * (temp / tempStart);
    } else if (r < 0.7) {
      // 2-opt swap aléatoire
      const n = candidate.length;
      if (n > 3) {
        let a = Math.floor(Math.random() * n);
        let b = Math.floor(Math.random() * n);
        if (a > b) [a, b] = [b, a];
        if (b - a > 1 && !(a === 0 && b === n - 1)) {
          let left = a + 1, right = b;
          while (left < right) {
            [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
            left++;
            right--;
          }
        }
      }
    } else if (r < 0.85 && candidate.length > 4) {
      // Supprimer un waypoint
      const idx = Math.floor(Math.random() * candidate.length);
      candidate.splice(idx, 1);
    } else {
      // Insérer un waypoint (au milieu d'un segment aléatoire, décalé vers un node proche)
      const idx  = Math.floor(Math.random() * candidate.length);
      const next = (idx + 1) % candidate.length;
      const mid  = {
        x: (candidate[idx].x + candidate[next].x) / 2,
        y: (candidate[idx].y + candidate[next].y) / 2,
      };
      // Décaler vers le node le plus éloigné de la boucle
      let worstNode = null, worstDist = 0;
      for (const n of nodes) {
        const d = distPointToLoop(n, candidate);
        if (d > worstDist) { worstDist = d; worstNode = n; }
      }
      if (worstNode) {
        mid.x = (mid.x + worstNode.x) / 2;
        mid.y = (mid.y + worstNode.y) / 2;
      }
      candidate.splice(idx + 1, 0, mid);
    }

    const candCost = totalCost(candidate, nodes);
    const delta    = candCost - curCost;

    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      curLoop = candidate;
      curCost = candCost;
      if (curCost < bestCost) {
        bestLoop = curLoop.map(p => ({ ...p }));
        bestCost = curCost;
      }
    }

    if (i % 50000 === 0) {
      console.log(`  SA iter ${i}/${maxIter}, temp=${temp.toFixed(0)}, cost=${curCost.toFixed(0)}, best=${bestCost.toFixed(0)}, waypoints=${curLoop.length}`);
    }
  }

  console.log(`Simulated Annealing terminé. Coût final: ${bestCost.toFixed(0)}`);
  return bestLoop;
}

// ─── Génération SVG ─────────────────────────────────────────────────────────
function generateSVG(loop, nodes) {
  // Lire le SVG topo existant et extraire son contenu intérieur
  const topoSvg    = fs.readFileSync(TOPO_SVG_PATH, 'utf8');
  const innerMatch = topoSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  const topoInner  = innerMatch ? innerMatch[1] : '';

  // Couleurs par pureté
  const purityColors = {
    RP_Inpure: '#e74c3c', // rouge
    RP_Normal: '#f39c12', // orange
    RP_Pure:   '#f1c40f', // jaune/or
  };

  // Convertir les waypoints en coordonnées pixel
  const loopPx = loop.map(w => gameToPixel(w.x, w.y));

  // Construire le path de la boucle (polyline fermée)
  let pathD = `M ${loopPx[0].px.toFixed(1)} ${loopPx[0].py.toFixed(1)}`;
  for (let i = 1; i < loopPx.length; i++) {
    pathD += ` L ${loopPx[i].px.toFixed(1)} ${loopPx[i].py.toFixed(1)}`;
  }
  pathD += ' Z';

  // Nodes de cuivre
  const nodeCircles = nodes.map(n => {
    const { px, py } = gameToPixel(n.x, n.y);
    const color = purityColors[n.purity] || '#fff';
    const r = n.purity === 'RP_Pure' ? 12 : n.purity === 'RP_Normal' ? 10 : 8;
    return `  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="${color}" stroke="#000" stroke-width="1.5" opacity="0.9"/>`;
  }).join('\n');

  // Waypoints (petits diamants)
  const waypointMarkers = loopPx.map((w, i) => {
    return `  <circle cx="${w.px.toFixed(1)}" cy="${w.py.toFixed(1)}" r="4" fill="#00ff88" stroke="#000" stroke-width="1" opacity="0.7"/>`;
  }).join('\n');

  // Lignes de liaison node → boucle (pour visualiser la couverture)
  const coverageLines = nodes.map(n => {
    let minD = Infinity, closest = null;
    for (let i = 0; i < loop.length; i++) {
      const j = (i + 1) % loop.length;
      const a = loop[i], b = loop[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((n.x - a.x) * dx + (n.y - a.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const proj = { x: a.x + t * dx, y: a.y + t * dy };
      const d = dist(n, proj);
      if (d < minD) { minD = d; closest = proj; }
    }
    if (minD < 500) return ''; // pas de ligne si très proche
    const np = gameToPixel(n.x, n.y);
    const cp = gameToPixel(closest.x, closest.y);
    return `  <line x1="${np.px.toFixed(1)}" y1="${np.py.toFixed(1)}" x2="${cp.px.toFixed(1)}" y2="${cp.py.toFixed(1)}" stroke="#ffffff" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.3"/>`;
  }).filter(Boolean).join('\n');

  // Légende
  const legend = `
  <g transform="translate(50, 4850)">
    <rect x="0" y="0" width="280" height="120" rx="8" fill="#000" opacity="0.7"/>
    <text x="15" y="25" fill="#fff" font-size="16" font-weight="bold" font-family="sans-serif">Copper Loop</text>
    <circle cx="25" cy="48" r="8" fill="${purityColors.RP_Inpure}"/>
    <text x="40" y="53" fill="#fff" font-size="13" font-family="sans-serif">Impure (${nodes.filter(n => n.purity === 'RP_Inpure').length})</text>
    <circle cx="25" cy="72" r="8" fill="${purityColors.RP_Normal}"/>
    <text x="40" y="77" fill="#fff" font-size="13" font-family="sans-serif">Normal (${nodes.filter(n => n.purity === 'RP_Normal').length})</text>
    <circle cx="25" cy="96" r="8" fill="${purityColors.RP_Pure}"/>
    <text x="40" y="101" fill="#fff" font-size="13" font-family="sans-serif">Pure (${nodes.filter(n => n.purity === 'RP_Pure').length})</text>
    <line x1="150" y1="45" x2="180" y2="45" stroke="#00ccff" stroke-width="3"/>
    <text x="188" y="50" fill="#fff" font-size="13" font-family="sans-serif">Rail loop</text>
    <circle cx="165" cy="70" r="4" fill="#00ff88" stroke="#000" stroke-width="1"/>
    <text x="175" y="75" fill="#fff" font-size="13" font-family="sans-serif">Waypoints (${loop.length})</text>
    <text x="150" y="100" fill="#aaa" font-size="11" font-family="sans-serif">Cost: ${totalCost(loop, nodes).toFixed(0)}</text>
  </g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" width="${MAP_SIZE}" height="${MAP_SIZE}">
${topoInner}

<!-- Coverage lines -->
<g id="coverage">
${coverageLines}
</g>

<!-- Rail loop -->
<path d="${pathD}" fill="none" stroke="#00ccff" stroke-width="3" stroke-linejoin="round" opacity="0.85"/>

<!-- Waypoint markers -->
<g id="waypoints">
${waypointMarkers}
</g>

<!-- Copper nodes -->
<g id="copper-nodes">
${nodeCircles}
</g>

<!-- Legend -->
${legend}
</svg>`;

  fs.writeFileSync(OUTPUT_SVG, svg, 'utf8');
  console.log(`SVG généré: ${OUTPUT_SVG}`);

  // Générer le HTML viewer avec SVG embarqué
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Copper Loop</title>
<style>
  * { margin: 0; padding: 0; }
  body { overflow: hidden; background: #000; cursor: grab; }
  body.dragging { cursor: grabbing; }
  #container { transform-origin: 0 0; }
</style>
</head>
<body>
<div id="container">
${svg}
</div>
<script>
let ox = 0, oy = 0, scale = 1;
let dragging = false, lastX, lastY;
const container = document.getElementById('container');

function fit() {
  const vw = window.innerWidth, vh = window.innerHeight;
  scale = Math.min(vw, vh) / ${MAP_SIZE};
  ox = (vw - ${MAP_SIZE} * scale) / 2;
  oy = (vh - ${MAP_SIZE} * scale) / 2;
  update();
}
function update() {
  container.style.transform = 'translate('+ox+'px,'+oy+'px) scale('+scale+')';
}
fit();
window.addEventListener('resize', fit);
window.addEventListener('mousedown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  document.body.classList.add('dragging');
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  ox += e.clientX - lastX; oy += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  update();
});
window.addEventListener('mouseup', () => {
  dragging = false; document.body.classList.remove('dragging');
});
window.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.15 : 1/1.15;
  ox = e.clientX - (e.clientX - ox) * f;
  oy = e.clientY - (e.clientY - oy) * f;
  scale *= f;
  update();
}, { passive: false });
</script>
</body>
</html>`;

  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  console.log(`HTML viewer généré: ${OUTPUT_HTML}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
function main() {
  console.log('=== Optimisation de la boucle cuivre ===');
  console.log(`Distance weight: ${DISTANCE_WEIGHT} (usage: node script.js [weight])\n`);

  // 1. Charger les nodes
  const nodes = loadCopperNodes();
  console.log(`  Impure: ${nodes.filter(n => n.purity === 'RP_Inpure').length}`);
  console.log(`  Normal: ${nodes.filter(n => n.purity === 'RP_Normal').length}`);
  console.log(`  Pure:   ${nodes.filter(n => n.purity === 'RP_Pure').length}`);
  console.log();

  // 2. Solution initiale : TSP nearest-neighbor sur tous les nodes
  console.log('Étape 1: TSP nearest-neighbor...');
  let loop = nearestNeighborTSP(nodes);
  console.log(`  Coût initial: ${totalCost(loop, nodes).toFixed(0)}`);
  console.log();

  // 3. Améliorer avec 2-opt
  console.log('Étape 2: 2-opt...');
  loop = twoOpt(loop, nodes);
  console.log(`  Coût après 2-opt: ${totalCost(loop, nodes).toFixed(0)}`);
  console.log();

  // 4. Simulated annealing pour affiner
  console.log('Étape 3: Simulated annealing...');
  loop = simulatedAnnealing(loop, nodes);
  console.log();

  // 5. 2-opt final
  console.log('Étape 4: 2-opt final...');
  loop = twoOpt(loop, nodes);
  const finalCost = totalCost(loop, nodes);
  console.log(`  Coût final: ${finalCost.toFixed(0)}`);
  console.log(`  Longueur boucle: ${loopLength(loop).toFixed(0)} UU`);
  console.log(`  Waypoints: ${loop.length}`);
  console.log();

  // 6. Afficher les waypoints
  console.log('Waypoints (coordonnées jeu):');
  for (let i = 0; i < loop.length; i++) {
    console.log(`  ${String(i).padStart(2)}: (${loop[i].x.toFixed(0)}, ${loop[i].y.toFixed(0)})`);
  }
  console.log();

  // 7. Distances des nodes à la boucle
  console.log('Distance de chaque node à la boucle:');
  const distances = nodes.map(n => ({
    name:     n.name.split('.').pop(),
    purity:   n.purity.replace('RP_', ''),
    distance: distPointToLoop(n, loop),
  })).sort((a, b) => b.distance - a.distance);

  for (const d of distances) {
    const bar = '█'.repeat(Math.min(50, Math.round(d.distance / 1000)));
    console.log(`  ${d.name.padEnd(35)} ${d.purity.padEnd(8)} ${d.distance.toFixed(0).padStart(7)} UU  ${bar}`);
  }
  console.log();

  // 8. Générer le SVG
  console.log('Génération du SVG...');
  generateSVG(loop, nodes);
  console.log('\nTerminé!');
}

main();