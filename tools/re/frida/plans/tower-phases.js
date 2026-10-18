// Phases de construction de la tour (cf. tower.js). L'etat (chemins des acteurs construits) est garde dans
// tower-state.json pour que chaque phase retrouve ce que les precedentes ont pose.
'use strict';

const fs = require('fs');
const path = require('path');
const T = require('./tower');

const STATE_FILE = path.join(__dirname, 'tower-state.json');
const loadState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { floors: [] });
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

const OLD = {
  belt: T.LEVEL + 'Build_ConveyorBeltMk1_C_2147422044',
  beltPole: T.LEVEL + 'Build_ConveyorPole_C_2147422043',
  miner: T.LEVEL + 'Build_MinerMk1_C_2147429734',
};

// Elements en l'air, comme la tour du joueur : le sol invalide est accepte
const AIR = { ignore: ['FGCDInvalidFloor'] };

function report(label, r) {
  const what = r.built ? 'construit ' + T.short(r.actor) : 'NON construit';
  console.log(label.padEnd(22), what, 'disq=' + JSON.stringify(r.disqualifiers), r.blocking && r.blocking.length ? 'BLOQUANT=' + JSON.stringify(r.blocking) : '');
}

const dot = (a, b) => a.x * b.x + a.y * b.y;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };

// Connecteur libre de `direction` dont la normale pointe vers `towards` (position) ou le long de `axis`
async function pickConnector(actorPath, direction, { towards, axis }) {
  const conns = (await T.call('connections', actorPath)).filter((c) => c.direction === direction && !c.connected);
  const score = (c) => (towards ? dot(c.normal, norm(sub(towards, c.location))) : Math.abs(dot(c.normal, axis)));
  conns.sort((a, b) => score(b) - score(a));
  if (conns.length === 0 || score(conns[0]) < 0.7) {
    throw new Error('aucun connecteur ' + direction + ' adequat sur ' + T.short(actorPath));
  }
  return conns[0].name;
}

const AXIS_X = { x: 0, y: 1 }; // X local de la tour (nord)

module.exports = {
  async clear() {
    console.log('poteau reseau avant :', JSON.stringify(await T.call('power', T.GRID_POLE)));
    for (const [label, p] of Object.entries(OLD)) {
      try {
        await T.call('dismantle', p, true);
        console.log('demonte', label);
      } catch (e) {
        console.log('demontage', label, ':', e.message);
      }
    }
    console.log('poteau reseau apres :', JSON.stringify(await T.call('power', T.GRID_POLE)));
  },

  async miner(dry) {
    const s = loadState();
    const n = T.NODE;
    const r = await T.call('buildAim', T.RECIPES.miner, { x: n.x, y: n.y, z: n.z + 1000 }, { x: n.x, y: n.y, z: n.z - 1000 }, { dryRun: dry });
    report('foreuse Mk3', r);
    if (!r.built) return;
    s.miner = r.actor;
    saveState(s);
    const shards = await T.call('addShards', s.miner, 3);
    const clock = await T.call('setClock', s.miner, 2.5);
    console.log('eclats', shards.powerShards, 'vitesse max', clock.maxPotential, 'demandee', clock.pendingPotential);
    console.log('connecteurs :', JSON.stringify(await T.call('connections', s.miner)));
  },

  async structure(dry) {
    const s = loadState();
    for (const f of T.plan()) {
      const fs_ = s.floors[f.i] || (s.floors[f.i] = {});
      for (const kind of ['ctor', 'splitter', 'merger']) {
        if (fs_[kind]) continue;
        const e = f[kind];
        const r = await T.call('build', T.RECIPES[kind], e.pos, e.yaw, Object.assign({ dryRun: dry }, AIR));
        report('etage ' + f.i + ' ' + kind, r);
        if (r.built) {
          fs_[kind] = r.actor;
          saveState(s);
        }
      }
    }
  },

  async belts(dry) {
    const s = loadState();
    const opts = { dryRun: dry };
    if (!s.minerBelt) {
      const out = await pickConnector(s.miner, 'output', { axis: AXIS_X });
      const inp = await pickConnector(s.floors[0].splitter, 'input', { axis: AXIS_X });
      const r = await T.call('belt', T.RECIPES.belt4, s.miner, out, { path: s.floors[0].splitter, name: inp }, opts);
      report('foreuse -> diviseur 0', r);
      if (r.built) { s.minerBelt = r.actor; saveState(s); }
    }
    for (let i = 0; i < s.floors.length; i++) {
      const f = s.floors[i];
      const ctor = (await T.call('connections', f.ctor));
      if (!f.feedBelt) {
        const cin = ctor.find((c) => c.direction === 'input');
        const out = await pickConnector(f.splitter, 'output', { towards: cin.location });
        const r = await T.call('belt', T.RECIPES.belt3, f.splitter, out, { path: f.ctor, name: cin.name }, opts);
        report('diviseur ' + i + ' -> constr.', r);
        if (r.built) { f.feedBelt = r.actor; saveState(s); }
      }
      if (!f.outBelt) {
        const cout = ctor.find((c) => c.direction === 'output');
        const inp = await pickConnector(f.merger, 'input', { towards: cout.location });
        const r = await T.call('belt', T.RECIPES.belt3, f.ctor, cout.name, { path: f.merger, name: inp }, opts);
        report('constr. ' + i + ' -> fusion.', r);
        if (r.built) { f.outBelt = r.actor; saveState(s); }
      }
    }
  },

  async lifts(dry) {
    const s = loadState();
    const opts = { dryRun: dry, snapTolerance: 400 };
    for (let i = 0; i + 1 < s.floors.length; i++) {
      const lo = s.floors[i];
      const hi = s.floors[i + 1];
      if (!lo.inputLift) {
        const out = await pickConnector(lo.splitter, 'output', { axis: AXIS_X });
        const inp = await pickConnector(hi.splitter, 'input', { axis: AXIS_X });
        const r = await T.call('belt', T.RECIPES.lift4, lo.splitter, out, { path: hi.splitter, name: inp }, opts);
        report('ascenseur div. ' + i + '->' + (i + 1), r);
        if (r.built) { lo.inputLift = r.actor; saveState(s); }
      }
      if (!hi.outputLift) {
        const out = await pickConnector(hi.merger, 'output', { axis: AXIS_X });
        const inp = await pickConnector(lo.merger, 'input', { axis: AXIS_X });
        const r = await T.call('belt', T.RECIPES.lift3, hi.merger, out, { path: lo.merger, name: inp }, opts);
        report('ascenseur fus. ' + (i + 1) + '->' + i, r);
        if (r.built) { hi.outputLift = r.actor; saveState(s); }
      }
    }
  },

  // Demonte ce qui change avec l'espacement de 8,5 m et le poteau unique : ascenseurs, etages 1..5 (et leurs
  // convoyeurs), poteaux Mk1 (leurs cables partent avec eux). Le rez-de-chaussee, la foreuse et l'uploader restent.
  async compact() {
    const s = loadState();
    const targets = [];
    s.floors.forEach((f, i) => {
      for (const k of ['inputLift', 'outputLift']) if (f[k]) targets.push([i, k]);
    });
    s.floors.forEach((f, i) => {
      if (i > 0) for (const k of ['feedBelt', 'outBelt', 'ctor', 'splitter', 'merger']) if (f[k]) targets.push([i, k]);
    });
    s.floors.forEach((f, i) => { if (f.pole) targets.push([i, 'pole']); });
    for (const [i, k] of targets) {
      try {
        await T.call('dismantle', s.floors[i][k], true);
        delete s.floors[i][k];
        saveState(s);
        console.log('demonte etage', i, k);
      } catch (e) {
        console.log('ECHEC etage', i, k, e.message);
      }
    }
    s.wires = {};
    saveState(s);
  },

  async power(dry) {
    const s = loadState();
    if (!s.pole) {
      const r = await T.call('build', T.RECIPES.pole, T.POLE.pos, T.POLE.yaw, Object.assign({ dryRun: dry }, AIR));
      report('poteau Mk3', r);
      if (!r.built) return;
      s.pole = r.actor;
      saveState(s);
    }
    const wires = [[T.GRID_POLE, s.pole], [s.pole, s.miner]];
    s.floors.forEach((f) => wires.push([s.pole, f.ctor]));
    s.wires = s.wires || {};
    for (const [a, b] of wires) {
      const key = T.short(a) + '|' + T.short(b);
      if (s.wires[key]) continue;
      const r = await T.call('wire', a, b, { dryRun: dry });
      report('cable ' + key.slice(0, 40), r);
      if (r.built) { s.wires[key] = r.actor; saveState(s); }
    }
  },

  // Sortie du beton : fusionneur du rez-de-chaussee -> uploader de stockage central pose au sol au nord
  async output(dry) {
    const s = loadState();
    const m0 = s.floors[0].merger;
    const out = (await T.call('connections', m0)).find((c) => c.direction === 'output' && !c.connected);
    if (!s.uploader) {
      const x = out.location.x;
      const y = out.location.y + 1800;
      const g = await T.call('ground', x, y, out.location.z + 2000, out.location.z - 3000);
      const r = await T.call('build', T.RECIPES.uploader, { x, y, z: g.z }, T.YAW + 180, { dryRun: dry });
      report('uploader', r);
      if (!r.built) return;
      s.uploader = r.actor;
      saveState(s);
    }
    const conns = await T.call('connections', s.uploader);
    console.log('connecteurs uploader :', JSON.stringify(conns.map((c) => [c.name, c.direction, c.location, c.normal])));
    if (!s.outputBelt) {
      const inp = await pickConnector(s.uploader, 'input', { towards: out.location });
      const r = await T.call('belt', T.RECIPES.belt3, m0, out.name, { path: s.uploader, name: inp }, { dryRun: dry });
      report('fusion. 0 -> uploader', r);
      if (r.built) { s.outputBelt = r.actor; saveState(s); }
    }
  },

  async recipes() {
    const s = loadState();
    for (const f of s.floors) {
      const r = await T.call('setRecipe', f.ctor, 'Recipe_Concrete_C');
      console.log(T.short(f.ctor), r.recipe, 'courant', r.power.hasPower);
    }
  },

  async status() {
    const s = loadState();
    console.log(JSON.stringify(s, (k, v) => (typeof v === 'string' ? T.short(v) : v), 2));
  },
};
