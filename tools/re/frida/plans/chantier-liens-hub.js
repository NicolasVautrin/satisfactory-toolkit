// Bouts d'anneau du hub a l'ecart standard (utilisateur, 26/10/2026 : « on passe le standard a 7m » ; « on fait les
// ajustement sur le hub ») : quarts de cercle des liens entre anneaux (So / Ni / No / Si), droites MS / MN, virages du
// canyon (etage du bas), lignes externes sud (Xo / Xi / Xos / Xis) et est (Yo / Yi / Yod / Yid), d'apres layouts/hub.js
// (constantes LIENS et EXT_R). Par etage : signaux de ces rails puis rails retires (railplan remove ; anciens virages du
// canyon, rails gardes hors plan, demontes a part), reposes (build --rails --signaux), puis controles : bouts raccordes,
// aiguillages a 2 branches, signaux valides.
//
// node chantier-liens-hub.js --etages 0,1,2 [--essai]      (--essai : liste seulement ce qui serait retire et repose)
// node chantier-liens-hub.js --etages 0,1,2 --ecarts        rails poses dont un bout a quitte son joint (changement de plan)
// Piege (helices ecartees, 26/10/2026) : a un point de CONVERGENCE (DMG, convergence de D en bas), la pose s'arrete
// (« aucun connecteur de normale attendue ») si le rail qui en repart (nC) n'est pas pose avant ceux qui y arrivent : le
// poser d'abord (railplan build --rails nC), puis relancer la pose et refaire les raccords hors du lot ; controler ensuite
// avec verif-plan.js (raccords RAnC <-> Ein1 et nB1 <-> nA2 refaits par railLink ce jour-la).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call } = require('./client');
const hub = require('./layouts/hub.js');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const FLOORS = String(opt('etages', '0,1,2')).split(',').map(Number);
const ESSAI = argv.includes('--essai');
const HUB = ['--origin', '141339,-261512,349', '--axis', '180'];
const IDS = /^(virage[SN]|R[0AZ](So|Ni|No|Si)|M[SN]\d|R[0AZ]X(o|i|os|is)|R0Y(o1|o2|od|i1|i2|id))$/;
const st = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'hub' + f + '-state.json'), 'utf8'));
const node = (...a) => {
  try {
    const out = execFileSync('node', a, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out;
  } catch (e) {
    console.log(((e.stdout || '') + (e.stderr || '')).trim());
    throw new Error('echec de : node ' + a.slice(0, 3).join(' '));
  }
};

// --ecarts : au lieu de la liste IDS, les rails poses par le plan dont un bout n'est plus sur son joint (plus de 10 cm),
// apres un changement de geometrie (helices ecartees a 7 m, hub-helices.js GAP)
const H = { x: 141339, y: -261512, z: 349 };
const world = (j) => ({ x: H.x - 100 * j[0], y: H.y - 100 * j[1], z: H.z + 100 * (j[2] || 0) });
async function moved(plan, s) {
  const out = [];
  for (const r of plan.rails) {
    if (r.existing || !s.rails[r.id]) continue;
    const ends = (await call('rails', s.rails[r.id])).connections.map((c) => c.location);
    const off = (j) => Math.min(...ends.map((e) => Math.hypot(e.x - j.x, e.y - j.y, e.z - j.z)));
    if (off(world(plan.joints[r.from])) > 10 || off(world(plan.joints[r.to])) > 10) out.push(r.id);
  }
  return out;
}

(async () => {
  // releve de tous les etages, puis retrait du haut vers le bas, puis pose du bas vers le haut : les helices (plan de
  // l'etage du bas) portent les bretelles des etages ; un raccord releve vers un rail retire entre-temps est ignore
  const lots = [];
  for (const f of FLOORS) {
    const s = st(f);
    // ecarts d'entree des gares avancees (rails Eing<k> / Wing<k> poses : --ent <cle>=12, chantier-gare-hub.js)
    const ent = [1, 2].flatMap((k) => [s.rails['Eing' + k] ? 'E' + k + '=12' : null, s.rails['Wing' + k] ? 'W' + k + '=12' : null]).filter(Boolean).join(',');
    const plan = hub({ etage: f, ebauche: true, ent });
    const ENTO = ent ? ['--ent', ent] : [];
    const rails = argv.includes('--ecarts') ? await moved(plan, s) : plan.rails.filter((r) => IDS.test(r.id) && !r.existing).map((r) => r.id);
    const sigs = plan.signals.filter((x) => rails.includes(x.rail)).map((x) => x.id);
    const left = sigs.filter((id) => s.signals[id]).concat(rails.filter((id) => s.rails[id]));
    // anciens virages du canyon : rails gardes (helices-state.json), hors de l'etat du hub tant que ce plan ne les a pas poses
    const oldHel = JSON.parse(fs.readFileSync(path.join(__dirname, 'helices-state.json'), 'utf8')).rails;
    const oldVirages = f === 0 && rails.some((id) => /^virage/.test(id)) ? ['virageS', 'virageN'].filter((id) => !s.rails[id]).map((id) => oldHel[id]) : [];
    console.log('etage ' + f + ' : ' + rails.length + ' rails, ' + sigs.length + ' signaux ; a retirer : ' + left.length + (oldVirages.length ? ' + anciens virages ' + oldVirages.map((p) => p.split('_C_').pop()).join(', ') : ''));
    // raccords vers des rails hors du lot (ligne des mines sur RAXos / RAXis a l'etage 2...) : releves avant, refaits apres
    const lot = new Set(rails.map((id) => s.rails[id]).filter(Boolean).concat(oldVirages));
    const outside = [];
    for (const id of rails) {
      if (!s.rails[id]) continue;
      for (const c of (await call('rails', s.rails[id])).connections) {
        for (const x of c.connections) if (!lot.has(x.track)) outside.push({ id, at: c.location, other: x.track, otherName: x.name });
      }
    }
    console.log('  raccords hors du lot : ' + outside.map((o) => o.id + ' -> ' + o.other.split('_C_').pop()).join(', '));
    if (ESSAI) console.log('  rails : ' + rails.join(' ') + '\n  signaux : ' + sigs.join(' '));
    lots.push({ f, ENTO, rails, sigs, left, oldVirages, outside });
  }
  if (ESSAI) return;
  for (const L of lots.slice().reverse()) {
    if (L.left.length) node('railplan.js', 'layouts/hub.js', 'remove', ...L.left, ...HUB, '--nom', 'hub' + L.f, '--etage', String(L.f), ...L.ENTO);
    for (const p of L.oldVirages) {
      try { await call('dismantle', p, true); console.log('  ancien virage demonte ' + p.split('_C_').pop()); } catch (e) { console.log('  ancien virage absent ' + p.split('_C_').pop()); }
    }
    console.log('etage ' + L.f + ' : ' + L.left.length + ' elements retires');
  }
  const exists = async (p) => { try { await call('dump', p, 1, 1, ['bHidden']); return true; } catch (e) { return false; } };
  for (const L of lots) {
    const { f, rails, sigs, outside } = L;
    if (!rails.length) continue;
    const out = node('railplan.js', 'layouts/hub.js', 'build', ...HUB, '--nom', 'hub' + f, '--etage', String(f), ...L.ENTO, '--rails', rails.join('|'), '--signaux', sigs.join('|'));
    const bad = out.split('\n').filter((l) => /NON RACCORDE|refuse|ECHEC/i.test(l));
    console.log('etage ' + f + ' pose : ' + (out.match(/^rail /gm) || []).length + ' rails, ' + (out.match(/^signal /gm) || []).length + ' signaux' + (bad.length ? ' | ' + bad.join(' | ') : ''));
    const s2 = st(f);
    if (outside.length) {
      const sub = (await call('scan', 'FGRailroadSubsystem', null, 0, 1, {})).items[0].path;
      for (const o of outside) {
        if (!(await exists(o.other))) { console.log('  raccord ' + o.id + ' -> ' + o.other.split('_C_').pop() + ' : rail retire (refait avec son lot)'); continue; }
        const r = await call('rails', s2.rails[o.id]);
        const c = r.connections.reduce((a, b) => (Math.hypot(b.location.x - o.at.x, b.location.y - o.at.y) < Math.hypot(a.location.x - o.at.x, a.location.y - o.at.y) ? b : a));
        if (c.connections.some((x) => x.track === o.other)) { console.log('  raccord ' + o.id + ' -> ' + o.other.split('_C_').pop() + ' : fait par la pose'); continue; }
        await call('railLink', sub, s2.rails[o.id], c.name, o.other, o.otherName);
        const ok = (await call('rails', s2.rails[o.id])).connections.find((x) => x.name === c.name).connections.some((x) => x.track === o.other);
        console.log('  raccord ' + o.id + ' -> ' + o.other.split('_C_').pop() + ' : railLink ' + (ok ? 'fait' : 'ECHEC'));
      }
    }
    // controles : bouts libres inattendus, signaux
    const free = [];
    for (const id of rails) {
      const r = await call('rails', s2.rails[id]);
      for (const c of r.connections) if (!c.connections.length) free.push(id + '.' + c.name.slice(-1));
    }
    const sv = [];
    for (const id of sigs) { const d = await call('dump', s2.signals[id], 1, 1, ['mBlockValidation']); if (d.mBlockValidation !== 1) sv.push(id + '=' + d.mBlockValidation); }
    console.log('  bouts libres : ' + (free.join(' ') || 'aucun') + ' | signaux non valides : ' + (sv.join(' ') || 'aucun'));
  }
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
