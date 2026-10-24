// Reprise des colonnes d'eau des modules deja construits (accord utilisateur 22/10/2026 : « oui reprends les modules
// existants ») : les extracteurs passent du bout des rangees a SOUS la ligne d'eau qu'ils alimentent, l'eau monte
// presque a la verticale (3 m d'ecart horizontal), regle « une pompe a eau devrait presque extraire a sa verticale ».
// Pour chaque ligne d'eau : demontage de l'ancienne colonne (extracteur, tuyaux suivis de proche en proche, pompe,
// jonction d'appui), insertion d'une jonction de colonne dans la ligne (le tuyau entre deux jonctions est remplace par
// deux), nouvel extracteur 8,6 m a cote de cette jonction, sortie tournee vers elle, colonne, pompe, cables.
// usage : node reprise-eau.js <site> [--dry]      sites : stators1..stators4 | rotors1
// Etat : reprise-eau-<site>-state.json (non versionne) ; les etats des modules sont mis a jour (anciennes cles retirees).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const SITE = process.argv[2];
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const WATER_VOLUME = PREFIX + 'FGWaterVolume_7';
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = { extractor: 'Recipe_WaterPump_C', junction: 'Recipe_PipelineJunction_Cross_C', pipe: 'Recipe_PipelineMK2_C', pump1: 'Recipe_PipelinePump_C', pump2: 'Recipe_PipelinePumpMK2_C' };

// Lignes d'eau a reprendre : anciens extracteur / pompe / appui, jonctions entre lesquelles inserer la colonne (a et b
// chainees de a.Connection(out) vers b.Connection(in)), cote de l'extracteur (sud : sous la bande, sortie au nord vers
// Connection2 ; nord : sortie au sud vers Connection3), poteau des cables
function plan(site) {
  if (/^stators[1-4]$/.test(site)) {
    const n = Number(site.slice(7)), DY = -6000 * (n - 1), yw = -269600 + DY;
    const X = (k) => 116600 - 1200 * k;
    // ligne de l'etage : jonctions k-1 -> k chainees d'est en ouest (Connection0 de k-1 -> Connection1 de k)
    const line = (lv, k, old, pump2, pole) => ({
      lv, old, pump2, pole, state: 'module' + n + '-stators-state.json',
      a: 'jonction ' + lv + '-' + (k - 1), aOut: 'Connection0', b: 'jonction ' + lv + '-' + k, bIn: 'Connection1',
      chain: 'eau ' + lv + ' ' + (k - 1) + '>' + k, x: (X(k - 1) + X(k)) / 2 - 200, y: yw, z: lv === '1' ? 500 : 3700, side: 'sud',
    });
    return [line('1', 3, 'E1', false, 'PE1'), line('1b', 5, 'E3', true, 'PX'), line('1', 9, 'E2', false, 'PW1'), line('1b', 11, 'E4', true, 'PW1')];
  }
  if (site === 'rotors1') {
    const X = (k) => 72200 + 1200 * k, YC = -271500;
    const line = (lv, k, old, pump2, side, pole) => {
      const sud = side === 'sud';
      return {
        lv, old, pump2, pole, state: 'rotors1-state.json',
        a: 'jonction ' + lv + '-' + (k - 1), aOut: 'Connection1', b: 'jonction ' + lv + '-' + k, bIn: 'Connection0',
        chain: 'eau ' + lv + ' ' + (k - 1) + '>' + k, x: (X(k - 1) + X(k)) / 2 + (sud ? -200 : 200), y: sud ? YC + 1900 : YC - 1900,
        z: lv === '1' ? 500 : 3700, side,
      };
    };
    return [line('1', 3, 'S', false, 'sud', '1-0'), line('1b', 5, 'Sb', true, 'sud', '1-0'), line('1', 10, 'N', false, 'nord', '1-2'), line('1b', 8, 'Nb', true, 'nord', '1-2')];
  }
  throw new Error('site inconnu : ' + SITE);
}

const FILE = path.join(__dirname, 'reprise-eau-' + SITE + '-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { done: {}, actors: {}, links: {}, wires: {} };
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(36), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}

// Acteur relie au connecteur `name` de `actor` (mConnectedComponent lu par reflexion), ou null
async function partner(actor, name) {
  const d = await call('dump', actor + '.' + name, 1, 5, ['mConnectedComponent']);
  const c = d.mConnectedComponent;
  if (!c || typeof c !== 'string') return null;
  return { actor: c.slice(0, c.lastIndexOf('.')), name: c.slice(c.lastIndexOf('.') + 1) };
}

// Ancienne colonne : de l'extracteur jusqu'a la jonction de bout de ligne (tuyaux, pompe, appui eventuel)
async function oldRiser(ms, L) {
  const pieces = [];
  let cur = { actor: ms.actors['extracteur ' + L.old], name: 'FGPipeConnectionFactory' };
  if (!cur.actor) return pieces;
  pieces.push(cur.actor);
  const line = new Set(Object.entries(ms.actors).filter(([k]) => /^jonction (1|1b)-/.test(k)).map(([, a]) => a));
  for (let guard = 0; guard < 8; guard++) {
    const p = await partner(cur.actor, cur.name);
    if (!p || line.has(p.actor)) break;             // bout de ligne atteint
    pieces.push(p.actor);
    const conns = (await call('connections', p.actor)).map((q) => q.name).filter((n) => n !== p.name && !/Power/.test(n));
    if (/PipelineJunction/.test(p.actor)) {          // appui : sortie a l'oppose de l'entree
      const opp = { Connection0: 'Connection1', Connection1: 'Connection0', Connection2: 'Connection3', Connection3: 'Connection2' }[p.name];
      cur = { actor: p.actor, name: opp };
    } else cur = { actor: p.actor, name: conns.find((n) => /Connection/.test(n)) };
  }
  return pieces;
}

(async () => {
  const lines = plan(SITE);
  for (const L of lines) {
    const tag = L.lv + ' ' + L.old;
    const msFile = path.join(__dirname, L.state);
    const ms = JSON.parse(fs.readFileSync(msFile, 'utf8'));
    const saveMs = () => fs.writeFileSync(msFile, JSON.stringify(ms, null, 1) + '\n');
    // 1. demontage de l'ancienne colonne
    if (!st.done[tag + ' demonte']) {
      const pieces = await oldRiser(ms, L);
      console.log(('ancienne colonne ' + tag).padEnd(36), pieces.map(short).join(' > '));
      if (!DRY) {
        // force : les tuyaux d'une colonne coupee par sa pompe ont ete crees par le jeu, pas par l'agent ; ils sont
        // retrouves de proche en proche depuis notre extracteur
        for (const p of pieces) await call('dismantle', p, true);
        for (const k of Object.keys(ms.actors)) if (k === 'extracteur ' + L.old || k === 'pompe ' + L.old || k === 'appui ' + L.old) delete ms.actors[k];
        for (const k of Object.keys(ms.links)) if (k === 'colonne ' + L.old || k.startsWith('colonne ' + L.old + ' ')) delete ms.links[k];
        for (const k of Object.keys(ms.wires)) if (k.endsWith('>extracteur ' + L.old) || k.endsWith('>pompe ' + L.old)) delete ms.wires[k];
        saveMs();
        st.done[tag + ' demonte'] = true; save();
      }
    }
    // 2. jonction de colonne inseree dans la ligne
    const a = ms.actors[L.a], b = ms.actors[L.b];
    if (!st.actors[tag + ' jonction']) {
      if (!DRY && ms.links[L.chain]) {
        await call('dismantle', ms.links[L.chain], true);
        delete ms.links[L.chain]; saveMs();
        // le demontage n'est effectif qu'aux images suivantes : sans attente, la jonction parait encore branchee
        await new Promise((r) => setTimeout(r, 2000));
      }
      const r = await call('build', REC.junction, { x: L.x, y: L.y, z: L.z }, 0, Object.assign({ dryRun: DRY }, AIR));
      report('jonction de colonne ' + tag, r);
      if (r.built) { st.actors[tag + ' jonction'] = r.actor; save(); }
    }
    const j = st.actors[tag + ' jonction'];
    const pipe = async (key, from, fromName, to, toName) => {
      if (st.links[key] || !from || !to) return;
      const r = await call('belt', REC.pipe, from, fromName, { path: to, name: toName }, { dryRun: DRY });
      report(key, r);
      if (r.built) {
        if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche');
        st.links[key] = r.actor; save();
      }
    };
    const jIn = L.aOut === 'Connection0' ? 'Connection1' : 'Connection0', jOut = L.aOut;
    await pipe(tag + ' ligne a>colonne', a, L.aOut, j, jIn);
    await pipe(tag + ' ligne colonne>b', j, jOut, b, L.bIn);
    // 3. extracteur 8,6 m a cote de la jonction (sud : au sud, sortie au nord ; nord : au nord, sortie au sud)
    if (!st.actors[tag + ' extracteur']) {
      const sud = L.side === 'sud', ey = L.y + (sud ? 860 : -860);
      const r = await call('buildAim', REC.extractor, { x: L.x, y: ey, z: 1000 }, { x: L.x, y: ey, z: -1815 }, { dryRun: DRY, onActor: WATER_VOLUME, scrollRotation: sud ? 0 : 180 });
      report('extracteur ' + tag, r);
      if (r.built) { st.actors[tag + ' extracteur'] = r.actor; save(); }
    }
    await pipe(tag + ' colonne', st.actors[tag + ' extracteur'], 'FGPipeConnectionFactory', j, L.side === 'sud' ? 'Connection2' : 'Connection3');
    // 4. pompe en bas de la colonne, dans le sens du tuyau
    if (!st.actors[tag + ' pompe'] && st.links[tag + ' colonne']) {
      const c = await call('connections', st.links[tag + ' colonne']);
      const p0 = c.find((q) => q.name === 'PipelineConnection0').location, p1 = c.find((q) => q.name === 'PipelineConnection1').location;
      const p = { x: p0.x + (p1.x - p0.x) * 0.25, y: p0.y + (p1.y - p0.y) * 0.25, z: p0.z + (p1.z - p0.z) * 0.25 };
      const r = await call('buildAim', L.pump2 ? REC.pump2 : REC.pump1, { x: p.x, y: p.y, z: p.z + 1000 }, p, { dryRun: DRY, onActor: st.links[tag + ' colonne'] });
      report('pompe ' + tag, r);
      if (r.built) { st.actors[tag + ' pompe'] = r.actor; save(); }
    }
    // 5. cables vers le poteau du module. PX : poteau ajoute pres des extracteurs de l'est (le poteau central est
    // plein, le poteau est trop loin pour l'extracteur de l'etage 1 bis), relie au poteau est
    if (L.pole === 'PX' && !ms.actors['poteau PX']) {
      const r = await call('build', 'Recipe_PowerPoleMk3_C', { x: 114000, y: L.y + 1400, z: 0 }, 0, Object.assign({ dryRun: DRY }, AIR));
      report('poteau PX', r);
      if (r.built) {
        ms.actors['poteau PX'] = r.actor; saveMs();
        const w = await call('wire', r.actor, ms.actors['poteau PE1'], {});
        report('cable PX > PE1', w);
        ms.wires['PX>PE1'] = w.actor; saveMs();
      }
    }
    for (const what of ['extracteur', 'pompe']) {
      const key = tag + ' ' + what;
      if (st.wires[key] || !st.actors[key]) continue;
      const pole = ms.actors['poteau ' + L.pole];
      const r = await call('wire', pole, st.actors[key], { dryRun: DRY });
      report('cable ' + L.pole + ' > ' + key, r);
      if (r.built) { st.wires[key] = r.actor; save(); }
    }
  }
  console.log('fin ' + SITE);
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
