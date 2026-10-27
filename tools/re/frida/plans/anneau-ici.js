// Anneau sur la voie basse (partie est-ouest, voies y -207 220 / -207 870) centre sur la position ACTUELLE du joueur, lue
// au lancement (utilisateur, 22/10/2026 : « je t'avais demande centre sur moi » ; un premier anneau avait ete pose sur une
// ancienne position). Plan : layouts/anneau-voie-basse.js.
//
// node anneau-ici.js plan [--x <abscisse>]   lecture seule : centre, rails a retirer, rails gardes de part et d'autre
// node anneau-ici.js pose [--x <abscisse>]   sauvegarde, retrait des rails, verification a blanc, pose, controle des joints
// --x : centre impose au lieu de la position du joueur ; --est <x> : l'anneau commence a ce joint de la voie basse (son
// raccord est s'y accroche directement, ex. sortie du virage x -78 469). --nom : nom de l'etat (defaut anneau-vb).
// --gare <etat> : gare deja posee au nord, dans l'alignement du cote nord, a l'est de l'anneau (ex. anneau-vb-est1, layouts/
// anneau-gare-nord.js) ; sans --x ni --est, l'anneau se place a 6 m de son entree, comme a la gare de triage, et son coin NE
// raccorde l'entree.
// --voie <y sud>,<y nord> : autre partie est-ouest de la voie basse (defaut -207220,-207870 ; ligne droite entre la gare
// de triage et le coude, 25/10/2026 : -261512,-262161), meme sens de circulation (voie sud vers l'ouest).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { call } = require('./client');
const { SPAN, HALF, ENT } = require('./layouts/anneau-voie-basse.js');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const [YS, YN] = String(opt('voie', '-207220,-207870')).split(',').map(Number);
const LINES = { S: YS, N: YN };
const YC = Math.round((YS + YN) / 2); // axe de la double voie
const MIN_STRAIGHT = 12; // m : droite la plus courte entre un raccord de l'anneau et un rail garde
const short = (p) => p.split('.').pop();
const node = (args) => execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 26 });

async function survey(cx) {
  const near = (await call('scan', 'FGBuildableRailroadTrack', { x: cx, y: YC, z: 349 }, 40000, 300, {})).items;
  const out = {};
  for (const [k, y] of Object.entries(LINES)) {
    const joints = new Map(); // x arrondi -> rails qui y aboutissent
    const rails = [];
    for (const r of near) {
      const info = await call('rails', r.path);
      const ends = info.connections.map((c) => c.location);
      const onLine = ends.map((e) => Math.abs(e.y - y) < 50 && Math.abs(e.z - 349) < 100);
      if (!onLine.some(Boolean)) continue;
      const item = { path: r.path, ends, onLine, info };
      rails.push(item);
      ends.forEach((e, i) => { if (onLine[i]) { const key = Math.round(e.x); if (!joints.has(key)) joints.set(key, []); joints.get(key).push(item); } });
    }
    const xs = [...joints.keys()].sort((a, b) => a - b);
    // joint garde : au point de raccord meme (rail garde accroche directement), ou a une droite d'au moins 12 m
    const eastX = xs.find((x) => Math.abs(x - (cx + 100 * SPAN)) < 50 || x >= cx + 100 * (SPAN + MIN_STRAIGHT));
    const westX = [...xs].reverse().find((x) => Math.abs(x - (cx - 100 * SPAN)) < 50 || x <= cx - 100 * (SPAN + MIN_STRAIGHT));
    if (eastX === undefined || westX === undefined) throw new Error('voie ' + k + ' : pas de joint a garder de part et d\'autre (trop pres d\'un bout ?)');
    const otherEnd = (item, x) => item.ends.find((e) => Math.round(e.x) !== x || !item.onLine[item.ends.indexOf(e)]);
    // rail garde : celui qui part du joint vers l'exterieur ; rails retires : tout ce qui est entre les deux joints gardes
    const keepE = joints.get(eastX).find((it) => { const o = otherEnd(it, eastX); return o && o.x > eastX - 50; });
    const keepW = joints.get(westX).find((it) => { const o = otherEnd(it, westX); return o && o.x < westX + 50; });
    const removed = rails.filter((it) => it.ends.every((e, i) => it.onLine[i] && e.x > westX - 50 && e.x < eastX + 50) && it !== keepE && it !== keepW);
    for (const it of removed) {
      if (it.info.connections.some((c) => c.connections.length > 1 || c.facingSignal || c.trailingSignal || c.station)) throw new Error('voie ' + k + ' : aiguillage, signal ou gare sur ' + short(it.path) + ' : je ne coupe pas');
    }
    const ref = (it, x) => ({ path: short(it.path), near: it.ends.find((e) => Math.round(e.x) === x), far: otherEnd(it, x) });
    const e = ref(keepE, eastX);
    // rail garde courbe (sortie de virage) : le rail suivant du virage, pour y reporter les signaux (voir le plan)
    let e2 = null;
    if (Math.abs(e.far.y - y) > 50) {
      for (const r of near) {
        if (r.path === keepE.path) continue;
        const c = (await call('rails', r.path)).connections.map((cc) => cc.location);
        const i = c.findIndex((p) => Math.hypot(p.x - e.far.x, p.y - e.far.y) < 100);
        if (i >= 0) { e2 = { path: short(r.path), near: { x: c[i].x, y: c[i].y }, far: { x: c[1 - i].x, y: c[1 - i].y } }; break; }
      }
    }
    out[k] = { eastX, westX, keepE: e, keepE2: e2, keepW: ref(keepW, westX), removed: removed.map((it) => it.path) };
  }
  return out;
}

// entree de la gare : bout libre de sa derniere voie integree (G5)
async function gareEntry(etat) {
  const tracks = JSON.parse(fs.readFileSync(path.join(__dirname, etat + '-state.json'), 'utf8')).integrated;
  const last = tracks[tracks.length - 1];
  const c = (await call('rails', last)).connections;
  const free = c.findIndex((cc) => !cc.connections.length);
  if (free < 0) throw new Error('gare ' + etat + ' : entree deja raccordee');
  const xy = (p) => ({ x: p.x, y: p.y });
  return { path: short(last), near: xy(c[free].location), far: xy(c[1 - free].location) };
}

(async () => {
  const mode = argv[0];
  if (!['plan', 'pose'].includes(mode)) throw new Error('usage : node anneau-ici.js plan|pose [--x <abscisse>] [--est <x>] [--gare <etat>] [--nom <etat>]');
  const nom = opt('nom', 'anneau-vb');
  const p = (await call('player')).eyes.location;
  const gare = opt('gare') ? await gareEntry(opt('gare')) : null;
  // --est <x> : l'anneau commence a ce joint (raccord est accroche dessus), par ex. la sortie du virage x -78 469
  const cx = opt('est') ? Math.round(Number(opt('est')) - 100 * SPAN)
    : opt('x') || !gare ? Math.round(Number(opt('x', p.x)))
      : Math.round(gare.near.x - 100 * (ENT + HALF));
  console.log('joueur', Math.round(p.x), Math.round(p.y), Math.round(p.z / 100) + ' m', '-> centre de l\'anneau x', cx);
  if (Math.abs(p.y - YC) > 15000 && !opt('x') && !opt('est') && !gare) console.log('ATTENTION : le joueur est a', Math.round(Math.abs(p.y - YC) / 100), 'm de la voie basse');
  // collisions des batiments chargees autour du joueur seulement (environ 100 m) : au-dela, la pose a blanc ne voit pas tout
  const far = Math.round(Math.hypot(p.x - cx, p.y - YC) / 100);
  if (far > 60) console.log('ATTENTION : le joueur est a', far, 'm du centre de l\'anneau');
  const s = await survey(cx);
  const keep = { ES: s.S.keepE, EN: s.N.keepE, WS: s.S.keepW, WN: s.N.keepW };
  if (s.S.keepE2 && s.N.keepE2) { keep.ES2 = s.S.keepE2; keep.EN2 = s.N.keepE2; }
  if (gare) { keep.GARE = gare; console.log('entree de la gare', gare.path, Math.round(gare.near.x), Math.round(gare.near.y)); }
  const removed = [...s.S.removed, ...s.N.removed];
  console.log('rails retires :', removed.length, '(x', s.S.westX, '..', s.S.eastX, ')');
  console.log('rails gardes :', Object.entries(keep).map(([k, g]) => k + ' ' + g.path).join(', '));
  const args = ['--origin', cx + ',' + YS + ',349', '--axis', '180', '--nom', nom, '--keep', JSON.stringify(keep)];
  // description des rails gardes : necessaire pour relancer le plan plus tard (check, remove, build, verif-plan)
  fs.writeFileSync(path.join(__dirname, nom + '-keep.json'), JSON.stringify(keep, null, 1));
  if (mode === 'plan') return;
  console.log(node(['fg.js', 'save', 'avant-' + nom]).match(/"name": "([^"]+)"/)[1]);
  const d = await call('dismantleMany', removed, true);
  console.log('retrait', JSON.stringify(d));
  await new Promise((r) => setTimeout(r, 2500));
  const check = node(['railplan.js', 'layouts/anneau-voie-basse.js', 'check', ...args]);
  const bad = check.split('\n').filter((l) => /REFUSE|ECHEC/.test(l));
  if (bad.length) { console.log('VERIFICATION REFUSEE, rien pose :\n' + bad.join('\n')); process.exitCode = 1; return; }
  console.log('verification a blanc : ok');
  const build = node(['railplan.js', 'layouts/anneau-voie-basse.js', 'build', ...args]);
  console.log(build.split('\n').filter((l) => /Construit|ECHEC|non raccorde|refus/i.test(l)).join('\n'));
  console.log(node(['verif-plan.js', '--plan', 'layouts/anneau-voie-basse', ...args]).trim().split('\n').pop());
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
