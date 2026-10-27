// Aiguillages sans levier (Railroad Switch Control) : un connecteur de rail relie a 2 rails ou plus dont mSwitchControl est
// vide. Le jeu ne fait alors jamais basculer l'aiguillage (UFGRailroadTrackConnectionComponent::SetSwitchPosition ne fait
// rien sans levier, lu avec Ghidra le 26/10/2026) : les trains suivent la position en cours, quel que soit leur itineraire
// (N279 #2 envoye au bout de la ligne externe de l'anneau 0). Le levier est pose par l'hologramme du rail qui cree la
// bifurcation (AFGRailroadTrackHologram::TryPlaceSwitchControl) ; un raccord fait par railLink n'en a pas.
// Rails examines : ceux des etats des plans (plans/*-state.json).
//
// node aiguillages-sans-levier.js [--motif <regex sur le nom de l'etat>]   -> aiguillages-sans-levier.json
'use strict';
const fs = require('fs');
const path = require('path');
const { call } = require('./client');

const argv = process.argv.slice(2);
const motif = argv.includes('--motif') ? new RegExp(argv[argv.indexOf('--motif') + 1]) : null;
(async () => {
  const rails = new Map();
  for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('-state.json') && (!motif || motif.test(x)))) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    for (const [id, p] of Object.entries(s.rails || {})) if (typeof p === 'string' && /RailroadTrack/.test(p) && !rails.has(p)) rails.set(p, f.replace('-state.json', '') + ':' + id);
  }
  const seen = new Set(), missing = [];
  let switches = 0, n = 0;
  for (const [p, label] of rails) {
    let info;
    try { info = await call('rails', p); } catch (e) { continue; }
    n++;
    for (const c of info.connections) {
      if (c.connections.length < 2) continue;
      const key = p + '.' + c.name;
      if (seen.has(key)) continue;
      seen.add(key);
      switches++;
      const d = await call('dump', key, 1, 1, ['mSwitchControl']);
      if (!d.mSwitchControl) missing.push({ rail: label, connector: key, at: { x: Math.round(c.location.x), y: Math.round(c.location.y), z: Math.round(c.location.z) }, branches: c.connections.map((x) => x.track.split('_C_').pop()) });
    }
  }
  fs.writeFileSync(path.join(__dirname, 'aiguillages-sans-levier.json'), JSON.stringify(missing, null, 1));
  console.log(n + ' rails lus, ' + switches + ' aiguillages, ' + missing.length + ' sans levier');
  for (const m of missing) console.log('  ' + m.rail.padEnd(28) + ' ' + JSON.stringify(m.at) + ' -> ' + m.branches.join(' + '));
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
