'use strict';
/**
 * garesImposees.js
 *
 * Gares imposées à optimizeStationsMulti.js, lues dans les balises de la carte de la partie en cours (agent Frida,
 * tools/re/frida/host.py). Une balise par gare, nommée « gare » suivi de ses minerais et, facultatif, d'un rayon :
 *   « gare Bx »          bauxite seulement
 *   « gare Fe+Cu »       fer et cuivre
 *   « gare Fe+Cu 600 »   idem, et tous les gisements de fer et de cuivre à moins de 600 m lui sont affectés d'office
 *   « gare »             tous les minerais
 * (Bx / bauxite, Fe / fer, Cu / cuivre). Sans rayon, l'optimiseur affecte lui-même les gisements les plus proches.
 *
 * Usage: node garesImposees.js [--motif "^gare"]
 * Sortie: data/gares_imposees.json, à passer à l'optimiseur : fixeJson=data/gares_imposees.json
 */

const fs = require('fs');
const path = require('path');
const { call } = require('../re/frida/plans/client.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const MOTIF = new RegExp(arg('motif', '^gare\\b'), 'i');
const DATA = path.join(__dirname, '..', '..', 'data');
const OUTPUT = path.join(DATA, 'gares_imposees.json');
const TYPES = { Desc_OreCopper_C: 'copper', Desc_OreIron_C: 'iron', Desc_OreBauxite_C: 'bauxite' };
const TOKENS = { bx: 'bauxite', bauxite: 'bauxite', fe: 'iron', fer: 'iron', iron: 'iron', cu: 'copper', cuivre: 'copper', copper: 'copper' };
const ALL = ['copper', 'iron', 'bauxite'];

// Gisements de la carte (fer, cuivre, bauxite)
function mapNodes() {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'mapObjects.json'), 'utf8'));
  const tab = data.options.find((o) => o.tabId === 'resource_nodes');
  const nodes = [];
  for (const res of tab.options) {
    if (!TYPES[res.type]) continue;
    for (const pg of res.options) for (const m of pg.markers) nodes.push({ x: Math.round(m.x), y: Math.round(m.y), res: TYPES[res.type], purity: m.purity });
  }
  return nodes;
}

(async () => {
  const nodes = mapNodes();
  const manager = (await call('scan', 'FGMapManager', null, 0, 1, {})).items[0];
  const markers = ((await call('dump', manager.path, 3, 100000, ['mMapMarkers'])).mMapMarkers || []).filter((m) => MOTIF.test(m.Name));
  if (!markers.length) throw new Error('aucune balise dont le nom correspond a ' + MOTIF);
  const out = markers.map((m) => {
    const words = m.Name.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(Boolean);
    const named = [...new Set(words.map((w) => TOKENS[w]).filter(Boolean))];
    const allow = named.length ? named : ALL;
    const rayon = Number(words.find((w) => /^\d+$/.test(w)) || 0); // m
    const g = { label: m.Name, x: Math.round(m.Location.X), y: Math.round(m.Location.Y), allow, rayon, deposits: [] };
    if (rayon) g.deposits = nodes.filter((n) => allow.includes(n.res) && Math.hypot(n.x - g.x, n.y - g.y) <= rayon * 100);
    console.log(`${g.label} : (${g.x} ; ${g.y}), minerais ${allow.join('+')}`
      + (rayon ? `, ${g.deposits.length} gisements d'office a moins de ${rayon} m` : ''));
    return g;
  });
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 1), 'utf8');
  console.log(OUTPUT);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
