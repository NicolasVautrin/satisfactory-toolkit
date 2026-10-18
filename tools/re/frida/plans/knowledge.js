// Connaissances apprises dans le jeu et conservees entre les sessions (data/live/knowledge.json), pour ne pas
// re-explorer : disposition des connecteurs de chaque batiment (repere local), debits des convoyeurs, cadences des
// foreuses. Tout est lu dans le jeu en cours (aucune extraction), puis garde tant que la version du jeu ne change pas.
'use strict';

const fs = require('fs');
const path = require('path');
const { call } = require('./client');

const FILE = path.join(__dirname, '..', '..', '..', '..', 'data', 'live', 'knowledge.json');

let cache = null;

async function load() {
  if (cache !== null) return cache;
  const { build } = await call('status');
  const disk = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  // Une autre version du jeu peut avoir change dispositions et debits : on reapprend tout
  cache = disk && disk.build === build ? disk : { build, layouts: {}, belts: null, miners: {} };
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2) + '\n');
}

// --- Geometrie dans le plan horizontal -----------------------------------------------------------

const RAD = Math.PI / 180;
const rotZ = (v, deg) => {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
};
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const yawOf = (v) => Math.atan2(v.y, v.x) / RAD;
const normYaw = (deg) => ((deg % 360) + 540) % 360 - 180;
const roundVec = (v, step) => ({ x: Math.round(v.x / step) * step, y: Math.round(v.y / step) * step, z: Math.round(v.z / step) * step });

// --- Disposition des connecteurs -------------------------------------------------------------------

// Connecteurs du batiment d'une recette de construction, en repere local (yaw 0, origine = pivot de l'acteur).
// Relevee sur l'exemplaire le plus proche deja present dans la partie, ou sur `samplePath` (ex. un batiment que
// l'on vient de construire) si aucun n'existait.
async function layout(recipe, samplePath) {
  const k = await load();
  if (k.layouts[recipe]) return k.layouts[recipe];
  let s = await call('layout', recipe, null);
  if (!s.sample && samplePath) {
    const pose = await call('pose', samplePath);
    s = Object.assign(s, { sample: samplePath, location: pose.location, rotation: pose.rotation, connectors: await call('connections', samplePath) });
  }
  if (!s.sample) throw new Error(recipe + ' : aucun exemplaire dans la partie pour apprendre ses connecteurs (en construire un)');
  if (Math.abs(s.rotation.pitch) > 0.5 || Math.abs(s.rotation.roll) > 0.5) {
    throw new Error(recipe + ' : exemplaire incline (' + s.sample + '), disposition non apprise');
  }
  const yaw = s.rotation.yaw;
  k.layouts[recipe] = {
    buildClass: s.buildClass,
    connectors: s.connectors.map((c) => ({
      name: c.name,
      direction: c.direction,
      offset: roundVec(rotZ(sub(c.location, s.location), -yaw), 1),
      normal: roundVec(rotZ(c.normal, -yaw), 0.001),
    })),
    learnedFrom: s.sample,
  };
  save();
  return k.layouts[recipe];
}

function connector(lay, name) {
  const c = lay.connectors.find((x) => x.name === name);
  if (!c) throw new Error('connecteur ' + name + ' inconnu pour ' + lay.buildClass);
  return c;
}

// Pose { pos, yaw } du batiment qui amene son connecteur `name` en `target` avec la normale horizontale `normal`
function poseFor(lay, name, target, normal) {
  const c = connector(lay, name);
  const yaw = normYaw(yawOf(normal) - yawOf(c.normal));
  return { pos: sub(target, rotZ(c.offset, yaw)), yaw };
}

// Connecteurs en coordonnees monde pour une pose donnee
function worldConnectors(lay, pose) {
  return lay.connectors.map((c) => ({
    name: c.name,
    direction: c.direction,
    location: add(pose.pos, rotZ(c.offset, pose.yaw)),
    normal: rotZ(c.normal, pose.yaw),
  }));
}

// Premier connecteur de `direction` dont la normale locale est la plus proche de `localNormal`
function connectorFacing(lay, direction, localNormal) {
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const list = lay.connectors.filter((c) => c.direction === direction);
  list.sort((a, b) => dot(b.normal, localNormal) - dot(a.normal, localNormal));
  if (!list.length || dot(list[0].normal, localNormal) < 0.7) throw new Error('aucun connecteur ' + direction + ' dans cette direction sur ' + lay.buildClass);
  return list[0];
}

// --- Debits ----------------------------------------------------------------------------------------

// Convoyeurs debloques et leur debit (objets / min) : recettes disponibles + vitesse lue sur l'objet par defaut.
// Le jeu affiche un debit egal a mSpeed / 2 (Mk1 : mSpeed 120 -> 60 / min).
async function belts() {
  const k = await load();
  if (k.belts) return k.belts;
  const available = await call('recipes', null);
  const tiers = [];
  for (const r of available) {
    const m = /^Recipe_ConveyorBeltMk(\d+)_C$/.exec(r);
    if (!m) continue;
    const tier = Number(m[1]);
    const { mSpeed } = await call('props', 'Default__Build_ConveyorBeltMk' + tier + '_C', { mSpeed: 'float' });
    tiers.push({ tier, perMinute: mSpeed / 2, belt: r, lift: available.indexOf('Recipe_ConveyorLiftMk' + tier + '_C') >= 0 ? 'Recipe_ConveyorLiftMk' + tier + '_C' : null });
  }
  tiers.sort((a, b) => a.tier - b.tier);
  k.belts = tiers;
  save();
  return tiers;
}

// Plus petit convoyeur debloque qui supporte `perMinute`
async function beltFor(perMinute) {
  const t = (await belts()).find((b) => b.perMinute >= perMinute);
  if (!t) throw new Error('aucun convoyeur debloque ne supporte ' + perMinute + ' / min');
  return t;
}

// Cadence d'une foreuse a 100 % sur un gisement normal (objets / min), lue sur son objet par defaut
async function minerBaseRate(tier) {
  const k = await load();
  if (k.miners[tier] == null) {
    const p = await call('props', 'Default__Build_MinerMk' + tier + '_C', { mExtractCycleTime: 'float', mItemsPerCycle: 'int' });
    k.miners[tier] = (p.mItemsPerCycle / p.mExtractCycleTime) * 60;
    save();
  }
  return k.miners[tier];
}

module.exports = {
  FILE, load, layout, connector, poseFor, worldConnectors, connectorFacing, belts, beltFor, minerBaseRate,
  rotZ, add, sub, scale, yawOf, normYaw,
};
