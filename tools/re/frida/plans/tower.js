// Pile de machines alimentee par une foreuse, sur le modele des tours du joueur (ex. tour de beton du gisement 557).
// Plan generique : recettes, cadences, debits, encombrement et dispositions des connecteurs sont LUS dans le jeu
// (rules.js, knowledge.js). Seules les distances DESIGN ci-dessous sont des choix, repris de la tour du 17/10/2026.
//
// Usage : node tower.js <phase> --name <nom> [options] [--dry]
//   phases  : plan | miner | structure | belts | lifts | power | output | recipes | verify | all | teardown
//   options (memorisees dans l'etat au premier appel) :
//     --recipe Recipe_Concrete_C   recette de production (un seul ingredient, celui que la foreuse extrait)
//     --node <chemin>              gisement ; sinon le plus proche du joueur, libre, de la bonne ressource
//     --tier 3 --shards 3          foreuse Mk3 et eclats de puissance (vitesse reglee au maximum permis)
//     --floors N                   nombre d'etages ; sinon autant que la foreuse peut en alimenter
//     --side left|right            cote des machines, vu de la foreuse vers la tour
//     --grid <chemin>              poteau du reseau ; sinon le plus proche ayant un cable libre
//     --keep-miner                 (teardown) ne pas demonter la foreuse
// Etat (parametres + chemins des acteurs construits) : <nom>-state.json a cote de ce fichier (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');
const R = require('./rules');
const K = require('./knowledge');

// --- Choix de conception (distances entre connecteurs, en uu) ---------------------------------------
const DESIGN = {
  FEED_RUN: 1100, // sortie de la foreuse -> entree du diviseur du rez-de-chaussee
  FEED_GAP: 0, // connecteur lateral du diviseur / fusionneur <-> connecteur de la machine (calcule : voir plan)
  OUTPUT_RUN: 1800, // sortie du fusionneur du rez-de-chaussee -> entree de l'uploader
  POLE_CANDIDATES: [[-500, -300], [-600, 0], [-500, 300], [-800, -300]], // poteau : (X, Y) depuis la machine du bas
};

const RECIPES = {
  splitter: 'Recipe_ConveyorAttachmentSplitter_C',
  merger: 'Recipe_ConveyorAttachmentMerger_C',
  uploader: 'Recipe_CentralStorage_C',
  poles: ['Recipe_PowerPoleMk3_C', 'Recipe_PowerPoleMk2_C', 'Recipe_PowerPoleMk1_C'],
};

// --- Etat --------------------------------------------------------------------------------------------

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes('--' + name);
const stateFile = (name) => path.join(__dirname, name + '-state.json');

function loadState(name) {
  const f = stateFile(name);
  const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { floors: [] };
  // Etat de la premiere tour (17/10/2026) : la machine s'appelait ctor
  for (const fl of s.floors) if (fl.ctor && !fl.machine) { fl.machine = fl.ctor; delete fl.ctor; }
  const p = s.params || {};
  s.params = {
    recipe: arg('recipe', p.recipe || 'Recipe_Concrete_C'),
    node: arg('node', p.node || null),
    tier: Number(arg('tier', p.tier || 3)),
    shards: Number(arg('shards', p.shards == null ? 3 : p.shards)),
    floors: arg('floors', p.floors) ? Number(arg('floors', p.floors)) : null,
    side: arg('side', p.side || 'left'),
    grid: arg('grid', p.grid || null),
  };
  s.save = () => {
    const { save, ...data } = s;
    fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
  };
  return s;
}

function report(label, r) {
  const what = r.built ? 'construit ' + short(r.actor) : r.dryRun ? 'valide (essai)' : 'NON construit';
  console.log(label.padEnd(26), what, 'disq=' + JSON.stringify(r.disqualifiers), r.blocking && r.blocking.length ? 'BLOQUANT=' + JSON.stringify(r.blocking) : '');
}

// Construit (ou valide en essai) ; en mode `all`, un echec arrete tout
async function build(label, fn, strict) {
  const r = await fn();
  report(label, r);
  if (!r.built && !r.dryRun && strict) throw new Error(label + ' : non construit');
  return r;
}

// --- Plan : debits et geometrie ---------------------------------------------------------------------

const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l, z: 0 };
};
const dot2 = (a, b) => a.x * b.x + a.y * b.y;
const neg = (v) => K.scale(v, -1);
const up = (dz) => ({ x: 0, y: 0, z: dz });

function onlyConnector(lay, direction) {
  const list = lay.connectors.filter((c) => c.direction === direction);
  if (list.length !== 1) throw new Error(lay.buildClass + ' : ' + list.length + ' connecteurs ' + direction + ' (une seule entree et une seule sortie sont gerees)');
  return list[0];
}

// Connecteur (monde) d'un batiment pose, de `direction`, dont la normale est la plus proche de `along`
function worldFacing(lay, pose, direction, along) {
  const list = K.worldConnectors(lay, pose).filter((c) => c.direction === direction);
  list.sort((a, b) => dot2(b.normal, along) - dot2(a.normal, along));
  if (!list.length || dot2(list[0].normal, along) < 0.7) throw new Error(lay.buildClass + ' : aucun connecteur ' + direction + ' dans la direction voulue');
  return list[0];
}

async function rates(s) {
  const p = s.params;
  const rec = await R.recipe(p.recipe);
  if (rec.inputs.length !== 1 || rec.outputs.length !== 1) throw new Error(p.recipe + ' : un seul ingredient et un seul produit sont geres');
  if (!rec.producer) throw new Error(p.recipe + ' : aucun batiment producteur');
  const potential = 1 + 0.5 * p.shards; // un eclat = +50 % (verifie apres pose par la vitesse max lue sur la foreuse)
  const purity = s.purity || (await nodeInfo(s)).purity;
  const minerRate = await R.minerRate(p.tier, purity, potential);
  const floors = p.floors || Math.floor(minerRate / rec.inputs[0].perMinute + 1e-9);
  return { rec, potential, purity, minerRate, floors, inPerMin: rec.inputs[0].perMinute, outPerMin: rec.outputs[0].perMinute };
}

async function nodeInfo(s) {
  const p = s.params;
  if (!p.node) throw new Error('gisement non choisi : --node <chemin>');
  const scan = await call('scan', 'resourceNode', null, 0, 1000);
  const node = scan.items.find((n) => n.path === p.node);
  if (!node) throw new Error('gisement introuvable : ' + p.node);
  s.purity = node.purity;
  return node;
}

// Geometrie complete, deduite de la sortie de la foreuse (position + normale) et des dispositions apprises
async function geometry(s, r) {
  const p = s.params;
  const out = (await call('connections', s.miner)).find((c) => c.direction === 'output');
  const X = unit(out.normal);
  const Y = K.rotZ(X, p.side === 'right' ? -90 : 90);
  const L = {
    splitter: await K.layout(RECIPES.splitter),
    merger: await K.layout(RECIPES.merger),
    machine: await K.layout(R.buildingRecipeOf(r.rec.producer)),
  };
  if (L.machine.buildClass !== r.rec.producer) throw new Error('recette de batiment ' + R.buildingRecipeOf(r.rec.producer) + ' -> ' + L.machine.buildClass);
  const spacing = await K.stackSpacing(R.buildingRecipeOf(r.rec.producer));

  // Rez-de-chaussee : diviseur dans l'axe de la foreuse, machine sur le cote Y, fusionneur au-dela
  const splIn = onlyConnector(L.splitter, 'input');
  const spl0 = K.poseFor(L.splitter, splIn.name, K.add(out.location, K.scale(X, DESIGN.FEED_RUN)), neg(X));
  const splSide = worldFacing(L.splitter, spl0, 'output', Y);
  const gap = DESIGN.FEED_GAP || (await feedGap(L));
  const mIn = onlyConnector(L.machine, 'input');
  const machine0 = K.poseFor(L.machine, mIn.name, K.add(splSide.location, K.scale(Y, gap)), neg(Y));
  const mOut = worldFacing(L.machine, machine0, 'output', Y);
  const mrgOut = onlyConnector(L.merger, 'output');
  const mrgYaw = K.normYaw(K.yawOf(X) - K.yawOf(mrgOut.normal));
  const mrgSide = worldFacing(L.merger, { pos: { x: 0, y: 0, z: 0 }, yaw: mrgYaw }, 'input', neg(Y));
  const mrg0 = { pos: K.sub(K.add(mOut.location, K.scale(Y, gap)), mrgSide.location), yaw: mrgYaw };

  // Etages : machines tous les `spacing` ; diviseurs et fusionneurs arrondis au palier des ascenseurs, et retournes
  // un etage sur deux pour que la sortie avant de l'un soit a l'aplomb de l'entree arriere du suivant
  const floors = [];
  for (let i = 0; i < r.floors; i++) {
    const dz = i * spacing;
    const dzA = Math.round(dz / R.LIFT_STEP) * R.LIFT_STEP;
    const flip = i % 2 === 1 ? 180 : 0;
    floors.push({
      i,
      machine: { pos: K.add(machine0.pos, up(dz)), yaw: machine0.yaw },
      splitter: { pos: K.add(spl0.pos, up(dzA)), yaw: K.normYaw(spl0.yaw + flip) },
      merger: { pos: K.add(mrg0.pos, up(dzA)), yaw: K.normYaw(mrg0.yaw + flip) },
    });
  }
  return { X, Y, out, L, spacing, gap, floors, mergerOut0: worldFacing(L.merger, mrg0, 'output', X) };
}

// Ecart connecteur lateral <-> machine : celui de la tour de reference (diviseur a 8 m de l'axe du constructeur,
// connecteurs lateraux a 1 m du centre), recalcule pour la machine utilisee afin de garder le meme recul
async function feedGap(L) {
  const ctor = await K.layout('Recipe_ConstructorMk1_C');
  const splSideOffset = Math.max(...L.splitter.connectors.map((c) => Math.abs(c.offset.y)));
  const ctorIn = onlyConnector(ctor, 'input');
  return 800 - splSideOffset - Math.abs(ctorIn.offset.y);
}

// --- Phases ------------------------------------------------------------------------------------------

const AIR = { ignore: R.IN_AIR };

// Choix du connecteur reel (jeu) : libre, de `direction`, dont la normale pointe vers `towards` ou le long de `axis`
async function pickConnector(actorPath, direction, { towards, axis }) {
  const conns = (await call('connections', actorPath)).filter((c) => c.direction === direction && !c.connected);
  const score = (c) => (towards ? dot2(c.normal, unit(K.sub(towards, c.location))) : Math.abs(dot2(c.normal, axis)));
  conns.sort((a, b) => score(b) - score(a));
  if (conns.length === 0 || score(conns[0]) < 0.7) throw new Error('aucun connecteur ' + direction + ' adequat sur ' + short(actorPath));
  return conns[0].name;
}

const PHASES = {
  async plan(s) {
    const r = await rates(s);
    console.log('recette', r.rec.name, ':', r.inPerMin, r.rec.inputs[0].item, '->', r.outPerMin, r.rec.outputs[0].item, '/ min par', r.rec.producer);
    console.log('foreuse Mk' + s.params.tier, 'gisement', r.purity, 'vitesse', r.potential * 100 + ' %', ':', r.minerRate, '/ min ->', r.floors, 'etages',
      '(consomme', r.floors * r.inPerMin, ', surplus', Math.round((r.minerRate - r.floors * r.inPerMin) * 100) / 100, ')');
    console.log('convoyeurs : foreuse', (await R.beltFor(r.minerRate)).tier, '| alimentation', (await R.beltFor(r.inPerMin)).tier,
      '| sortie machine', (await R.beltFor(r.outPerMin)).tier, '| uploader', (await R.beltFor(r.floors * r.outPerMin)).tier);
    if (!s.miner) return console.log('(geometrie calculee une fois la foreuse posee : phase miner)');
    const g = await geometry(s, r);
    console.log('axe X', JSON.stringify(g.X), 'cote Y', JSON.stringify(g.Y), 'ecart vertical', g.spacing, 'ecart lateral', g.gap);
    for (const f of g.floors) console.log('etage', f.i, JSON.stringify({ machine: f.machine, splitter: f.splitter, merger: f.merger }, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
  },

  async miner(s, dry, strict) {
    if (s.miner) return console.log('foreuse deja posee :', short(s.miner));
    const n = await nodeInfo(s);
    const at = n.location;
    const r = await build('foreuse Mk' + s.params.tier, () => call('buildAim', 'Recipe_MinerMk' + s.params.tier + '_C',
      { x: at.x, y: at.y, z: at.z + 1000 }, { x: at.x, y: at.y, z: at.z - 1000 }, { dryRun: dry }), strict);
    if (!r.built) return;
    s.miner = r.actor;
    s.save();
    if (s.params.shards > 0) await call('addShards', s.miner, s.params.shards);
    const m = await call('machine', s.miner);
    const clock = await call('setClock', s.miner, m.maxPotential);
    console.log('eclats', clock.powerShards, 'vitesse', clock.pendingPotential);
  },

  async structure(s, dry, strict) {
    const r = await rates(s);
    const g = await geometry(s, r);
    const recipes = { machine: R.buildingRecipeOf(r.rec.producer), splitter: RECIPES.splitter, merger: RECIPES.merger };
    for (const f of g.floors) {
      const st = s.floors[f.i] || (s.floors[f.i] = {});
      for (const kind of ['machine', 'splitter', 'merger']) {
        if (st[kind]) continue;
        const e = f[kind];
        const b = await build('etage ' + f.i + ' ' + kind, () => call('build', recipes[kind], e.pos, e.yaw, Object.assign({ dryRun: dry }, AIR)), strict);
        if (b.built) { st[kind] = b.actor; s.save(); }
      }
    }
  },

  async belts(s, dry, strict) {
    const r = await rates(s);
    const g = await geometry(s, r);
    const opts = { dryRun: dry };
    if (!s.minerBelt) {
      const out = await pickConnector(s.miner, 'output', { axis: g.X });
      const inp = await pickConnector(s.floors[0].splitter, 'input', { axis: g.X });
      const tier = await R.beltFor(r.minerRate);
      const b = await build('foreuse -> diviseur 0', () => call('belt', tier.belt, s.miner, out, { path: s.floors[0].splitter, name: inp }, opts), strict);
      if (b.built) { s.minerBelt = b.actor; s.save(); }
    }
    const feed = await R.beltFor(r.inPerMin);
    const outTier = await R.beltFor(r.outPerMin);
    for (let i = 0; i < s.floors.length; i++) {
      const f = s.floors[i];
      const m = await call('connections', f.machine);
      if (!f.feedBelt) {
        const min = m.find((c) => c.direction === 'input');
        const out = await pickConnector(f.splitter, 'output', { towards: min.location });
        const b = await build('diviseur ' + i + ' -> machine', () => call('belt', feed.belt, f.splitter, out, { path: f.machine, name: min.name }, opts), strict);
        if (b.built) { f.feedBelt = b.actor; s.save(); }
      }
      if (!f.outBelt) {
        const mout = m.find((c) => c.direction === 'output');
        const inp = await pickConnector(f.merger, 'input', { towards: mout.location });
        const b = await build('machine ' + i + ' -> fusionneur', () => call('belt', outTier.belt, f.machine, mout.name, { path: f.merger, name: inp }, opts), strict);
        if (b.built) { f.outBelt = b.actor; s.save(); }
      }
    }
  },

  // Ascenseurs entre etages : debit restant cote entree, debit cumule cote sortie
  async lifts(s, dry, strict) {
    const r = await rates(s);
    const g = await geometry(s, r);
    const opts = { dryRun: dry, snapTolerance: 400 };
    const n = s.floors.length;
    const liftFor = async (perMinute) => {
      const list = (await K.belts()).filter((b) => b.lift && b.perMinute >= perMinute);
      if (!list.length) throw new Error('aucun ascenseur debloque ne supporte ' + perMinute + ' / min');
      return list[0].lift;
    };
    for (let i = 0; i + 1 < n; i++) {
      const lo = s.floors[i];
      const hi = s.floors[i + 1];
      if (!lo.inputLift) {
        const out = await pickConnector(lo.splitter, 'output', { axis: g.X });
        const inp = await pickConnector(hi.splitter, 'input', { axis: g.X });
        const lift = await liftFor(r.minerRate - (i + 1) * r.inPerMin);
        const b = await build('ascenseur div. ' + i + '->' + (i + 1), () => call('belt', lift, lo.splitter, out, { path: hi.splitter, name: inp }, opts), strict);
        if (b.built) { lo.inputLift = b.actor; s.save(); }
      }
      if (!hi.outputLift) {
        const out = await pickConnector(hi.merger, 'output', { axis: g.X });
        const inp = await pickConnector(lo.merger, 'input', { axis: g.X });
        const lift = await liftFor((n - 1 - i) * r.outPerMin);
        const b = await build('ascenseur fus. ' + (i + 1) + '->' + i, () => call('belt', lift, hi.merger, out, { path: lo.merger, name: inp }, opts), strict);
        if (b.built) { hi.outputLift = b.actor; s.save(); }
      }
    }
  },

  // Un poteau au pied de la tour : reseau + foreuse + machines (une machine n'accepte qu'un cable)
  async power(s, dry, strict) {
    const r = await rates(s);
    const g = await geometry(s, r);
    if (!s.pole) {
      const available = await call('recipes', null);
      const recipe = RECIPES.poles.find((x) => available.indexOf(x) >= 0);
      if (!recipe) throw new Error('aucun poteau electrique debloque');
      const base = g.floors[0].machine.pos;
      let chosen = null;
      for (const [dx, dy] of DESIGN.POLE_CANDIDATES) {
        const pos = K.add(base, K.add(K.scale(g.X, dx), K.scale(g.Y, dy)));
        const t = await call('build', recipe, pos, K.yawOf(g.X), Object.assign({ dryRun: true }, AIR));
        if (!t.blocking || !t.blocking.length) { chosen = pos; break; }
      }
      if (!chosen) throw new Error('aucun emplacement libre pour le poteau (DESIGN.POLE_CANDIDATES)');
      const b = await build('poteau ' + recipe, () => call('build', recipe, chosen, K.yawOf(g.X), Object.assign({ dryRun: dry }, AIR)), strict);
      if (!b.built) return;
      s.pole = b.actor;
      s.save();
    }
    const grid = s.params.grid || (s.grid = s.grid || (await gridPole(s, g)));
    const targets = [grid, s.miner, ...s.floors.map((f) => f.machine)];
    const pole = await call('power', s.pole);
    if (targets.length > pole.maxWires) throw new Error(targets.length + ' cables pour un poteau de ' + pole.maxWires);
    s.wires = s.wires || {};
    for (const t of targets) {
      const key = short(s.pole) + '|' + short(t);
      if (s.wires[key]) continue;
      const b = await build('cable ' + short(t), () => call('wire', s.pole, t, { dryRun: dry }), strict);
      if (b.built) { s.wires[key] = b.actor; s.save(); }
    }
  },

  // Sortie : uploader de stockage central, entree face a la sortie du fusionneur du rez-de-chaussee
  async output(s, dry, strict) {
    const r = await rates(s);
    const g = await geometry(s, r);
    if (!s.uploader) {
      const lay = await K.layout(RECIPES.uploader);
      const inp = onlyConnector(lay, 'input');
      const pose = K.poseFor(lay, inp.name, K.add(g.mergerOut0.location, K.scale(g.X, DESIGN.OUTPUT_RUN)), neg(g.X));
      const b = await build('uploader', () => call('build', RECIPES.uploader, pose.pos, pose.yaw, Object.assign({ dryRun: dry }, AIR)), strict);
      if (!b.built) return;
      s.uploader = b.actor;
      s.save();
    }
    if (!s.outputBelt) {
      const m0 = s.floors[0].merger;
      const out = (await call('connections', m0)).find((c) => c.direction === 'output' && !c.connected);
      const inp = await pickConnector(s.uploader, 'input', { towards: out.location });
      const tier = await R.beltFor(s.floors.length * r.outPerMin);
      const b = await build('fusionneur 0 -> uploader', () => call('belt', tier.belt, m0, out.name, { path: s.uploader, name: inp }, { dryRun: dry }), strict);
      if (b.built) { s.outputBelt = b.actor; s.save(); }
    }
  },

  async recipes(s) {
    for (const f of s.floors) {
      const m = await call('setRecipe', f.machine, s.params.recipe);
      console.log(short(f.machine), m.recipe, 'courant', m.power.hasPower);
    }
  },

  // Verification stricte, etat reel du jeu : chaque convoyeur / ascenseur raccorde aux deux bouts, chaque machine
  // alimentee (convoyeurs + courant) et reglee sur la recette
  async verify(s) {
    const problems = [];
    const links = [['foreuse -> diviseur 0', s.minerBelt], ['fusionneur 0 -> uploader', s.outputBelt]];
    s.floors.forEach((f, i) => {
      links.push(['diviseur ' + i + ' -> machine', f.feedBelt], ['machine ' + i + ' -> fusionneur', f.outBelt]);
      if (i + 1 < s.floors.length) links.push(['ascenseur div. ' + i, f.inputLift]);
      if (i > 0) links.push(['ascenseur fus. ' + i, f.outputLift]);
    });
    for (const [label, p] of links) {
      if (!p) { problems.push(label + ' : absent'); continue; }
      const free = (await call('connections', p)).filter((c) => !c.connected).map((c) => c.name);
      if (free.length) problems.push(label + ' : extremite non raccordee ' + free.join(' '));
    }
    for (const [i, f] of s.floors.entries()) {
      const m = await call('machine', f.machine);
      const free = (await call('connections', f.machine)).filter((c) => !c.connected).map((c) => c.name);
      console.log('etage ' + i + ' : ' + m.recipe + ', courant ' + m.power.hasPower + (free.length ? ', libres ' + free.join(' ') : ''));
      if (m.recipe !== s.params.recipe) problems.push('etage ' + i + ' : recette ' + m.recipe);
      if (!m.power.hasPower) problems.push('etage ' + i + ' : sans courant');
      if (free.length) problems.push('etage ' + i + ' : machine non raccordee ' + free.join(' '));
    }
    const miner = await call('machine', s.miner);
    console.log('foreuse : vitesse ' + miner.pendingPotential + ', courant ' + miner.power.hasPower);
    if (!miner.power.hasPower) problems.push('foreuse sans courant');
    if (s.pole) console.log('poteau : ' + JSON.stringify(await call('power', s.pole)));
    console.log(problems.length ? 'PROBLEMES :\n  ' + problems.join('\n  ') : 'tout est raccorde');
    if (problems.length) process.exitCode = 1;
  },

  async all(s, dry) {
    for (const phase of ['miner', 'structure', 'belts', 'lifts', 'power', 'output']) {
      console.log('--- ' + phase);
      await PHASES[phase](s, dry, true);
    }
    if (dry) return;
    console.log('--- recipes');
    await PHASES.recipes(s);
    console.log('--- verify');
    await PHASES.verify(s);
  },

  // Demonte tout ce que l'etat reference (les cables partent avec leurs poteaux / machines)
  async teardown(s) {
    const order = [];
    const take = (label, obj, key) => { if (obj[key]) order.push([label, obj, key]); };
    take('convoyeur foreuse', s, 'minerBelt');
    take('convoyeur sortie', s, 'outputBelt');
    s.floors.forEach((f, i) => ['feedBelt', 'outBelt', 'inputLift', 'outputLift'].forEach((k) => take('etage ' + i + ' ' + k, f, k)));
    s.floors.forEach((f, i) => ['machine', 'splitter', 'merger'].forEach((k) => take('etage ' + i + ' ' + k, f, k)));
    take('poteau', s, 'pole');
    take('uploader', s, 'uploader');
    if (!flag('keep-miner')) take('foreuse', s, 'miner');
    for (const [label, obj, key] of order) {
      try {
        await call('dismantle', obj[key], true);
        delete obj[key];
        console.log('demonte', label);
      } catch (e) {
        console.log('ECHEC', label, e.message);
      }
      s.save();
    }
    s.wires = {};
    s.save();
  },
};

// Poteau du reseau le plus proche de la tour ayant un cable libre (a portee de cable)
async function gridPole(s, g) {
  const near = g.floors[0].machine.pos;
  const scan = await call('scan', 'buildable', near, R.WIRE_MAX_LENGTH, 500);
  for (const it of scan.items) {
    if (!/^Build_PowerPole/.test(it.class) || it.path === s.pole) continue;
    const p = await call('power', it.path);
    if (p.wires < p.maxWires && p.circuitId >= 0) return it.path;
  }
  throw new Error('aucun poteau du reseau avec un cable libre a moins de ' + R.WIRE_MAX_LENGTH / 100 + ' m : --grid <chemin>');
}

module.exports = { PHASES, DESIGN, RECIPES, loadState, geometry, rates };

if (require.main === module) {
  const phase = process.argv[2];
  const name = arg('name', null);
  if (!PHASES[phase] || !name) {
    console.error('usage : node tower.js <' + Object.keys(PHASES).join('|') + '> --name <nom> [options] [--dry]');
    process.exit(2);
  }
  const s = loadState(name);
  PHASES[phase](s, flag('dry'), false).catch((e) => {
    console.error('ECHEC :', e.message);
    process.exitCode = 1;
  });
}
