'use strict';
/**
 * stationsViewer.js
 *
 * Page HTML locale pour explorer les réseaux de gares calculés par optimizeStationsMulti.js (sorties out=<nom> :
 * data/stations_multi_<nom>.json) : carte, voies, gares, gisements et convoyeurs, avec un sélecteur de résultat.
 * L'affectation des gisements aux gares est recalculée comme dans l'optimiseur (gare la plus proche ayant de la
 * capacité), à partir des gares et capacités du JSON.
 *
 * Usage: node stationsViewer.js [nom ...]   (défaut : tous les data/stations_multi_*.json)
 * Sortie: data/stations_viewer.html (le fond de carte data/map.jpg est lu à côté)
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const OUTPUT = path.join(DATA, 'stations_viewer.html');
// Mêmes constantes que optimizeStationsMulti.js (carte 5000 px, débits des foreuses Mk3 à 250 %)
const GAME_X_MIN = -324698.832031, GAME_X_MAX = 425301.832031, GAME_Y_MIN = -375000, GAME_Y_MAX = 375000, MAP_SIZE = 5000;
const THROUGHPUT = { RP_Inpure: 300, RP_Normal: 600, RP_Pure: 1200 };
const RES_TYPES = { copper: 'Desc_OreCopper_C', iron: 'Desc_OreIron_C', bauxite: 'Desc_OreBauxite_C' };
const RES_ORDER = ['copper', 'iron', 'bauxite']; // ordre de l'optimiseur (ALL_RESOURCES)

const px = (x) => +((x - GAME_X_MIN) / (GAME_X_MAX - GAME_X_MIN) * MAP_SIZE).toFixed(1);
const py = (y) => +((y - GAME_Y_MIN) / (GAME_Y_MAX - GAME_Y_MIN) * MAP_SIZE).toFixed(1);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function loadNodes(resources) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'mapObjects.json'), 'utf8'));
  const tab = data.options.find((o) => o.tabId === 'resource_nodes');
  const nodes = [];
  for (const id of RES_ORDER.filter((r) => resources.includes(r))) {
    const res = tab.options.find((o) => o.type === RES_TYPES[id]);
    if (!res) continue;
    for (const pg of res.options) {
      for (const m of pg.markers) nodes.push({ x: m.x, y: m.y, purity: m.purity, tp: THROUGHPUT[m.purity] || 0, res: id });
    }
  }
  return nodes;
}

// Copie de assignNodes (optimizeStationsMulti.js) : plus proche avec capacité, puis débordement au plus proche
function assign(nodes, stations) {
  const asg = new Array(nodes.length).fill(-1), loads = new Array(stations.length).fill(0);
  const idx = nodes.map((n, i) => ({ i, d: Math.min(...stations.map((s) => dist(n, s))) })).sort((a, b) => a.d - b.d);
  for (const { i } of idx) {
    let best = -1, bd = Infinity;
    stations.forEach((s, k) => {
      if (s.allow && !s.allow.includes(nodes[i].res)) return;
      if (loads[k] + nodes[i].tp > s.cap) return;
      const d = dist(nodes[i], s);
      if (d < bd) { bd = d; best = k; }
    });
    if (best >= 0) { asg[i] = best; loads[best] += nodes[i].tp; }
  }
  nodes.forEach((n, i) => {
    if (asg[i] >= 0) return;
    let best = 0, bd = Infinity;
    stations.forEach((s, k) => { if (s.allow && !s.allow.includes(n.res)) return; const d = dist(n, s); if (d < bd) { bd = d; best = k; } });
    asg[i] = best;
  });
  return asg;
}

function loadResult(name) {
  const r = JSON.parse(fs.readFileSync(path.join(DATA, `stations_multi_${name}.json`), 'utf8'));
  // affectation enregistree par l'optimiseur (gisements affectes d'office compris), sinon recalculee
  const nodes = r.nodes ? r.nodes.map((n) => ({ x: n.x, y: n.y, purity: n.purity, tp: n.tp, res: n.res, forced: n.forced })) : loadNodes(r.resources);
  const asg = r.nodes ? r.nodes.map((n) => n.st) : assign(nodes, r.stations);
  const index = Object.fromEntries(r.stations.map((s, k) => [s.label, k]));
  const dests = r.dests || [{ label: r.stations.find((s) => s.fixed).label, res: r.resources }];
  return {
    name, date: r.date, args: r.args, resources: r.resources, dests: dests.map((d) => ({ label: d.label, res: d.res })),
    trainKm: +r.trainKm.toFixed(1), beltKm: +r.beltKm.toFixed(1),
    railKm: +(r.edges.reduce((s, e) => s + e[2], 0) / 1000).toFixed(1),
    stations: r.stations.map((s) => ({
      label: s.label, x: s.x, y: s.y, px: px(s.x), py: py(s.y), fixed: s.fixed && !s.imposed, imposed: !!s.imposed, allow: s.allow || null,
      load: s.load, cap: s.cap,
      rt: typeof s.rtMin === 'object' ? s.rtMin : { [dests[0].label]: s.rtMin },
    })),
    edges: r.edges.map(([a, b, len]) => [index[a], index[b], len]),
    nodes: nodes.map((n, i) => ({ px: px(n.x), py: py(n.y), x: Math.round(n.x), y: Math.round(n.y), res: n.res, purity: n.purity, tp: n.tp, st: asg[i], forced: !!n.forced,
      d: Math.round(dist(n, r.stations[asg[i]]) / 100) })),
  };
}

function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(DATA).filter((f) => /^stations_multi_.+\.json$/.test(f)).map((f) => f.slice(15, -5)).sort();
  if (!names.length) throw new Error('aucun data/stations_multi_<nom>.json (optimizeStationsMulti.js out=<nom>)');
  const results = names.map(loadResult);
  const template = fs.readFileSync(path.join(__dirname, 'stationsViewer.html'), 'utf8');
  fs.writeFileSync(OUTPUT, template.replace('__DATA__', JSON.stringify(results)), 'utf8');
  console.log(`${results.length} résultat(s) : ${names.join(', ')}\n${OUTPUT}`);
}

main();
