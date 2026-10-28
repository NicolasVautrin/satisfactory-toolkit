// Double voie du canyon a 7 m d'axe en axe (utilisateur, 27/10/2026 : « passe l'ecartement des rails a 7m dans le
// canyon », puis « vasy refait la voie du canyon a 7m jusqu'a la prochaine gare »). De hub0 (bout des virages,
// (147 009 ; -260 948), 3,5 m) a la gare des mines (aiguillage d'entree de la voie nord en (244 680 ; -240 042), 41 m),
// la double voie etait a 6,50 m : gorge, rampe, remblai, montee vers la plaine.
// La voie nord reste en place : elle porte l'aiguillage d'entree de la gare. La voie sud (sens ouest) est reposee a 7 m de
// la voie nord : chaque joint sud est place a 7 m du point le plus proche de la voie nord (courbes echantillonnees), caps
// et pentes inchanges. Les deux bouts gardes restent a 6,5 m : le premier et le dernier rail font un S de 0,5 m.
// Pose d'ouest en est, chaque rail depuis le bout neuf du precedent, arrivee a direction libre (auto) avec la pente
// d'origine ; le premier rail arrive au cap impose (parallele a la voie), le dernier sur le rail garde de l'est. Les deux
// bouts gardes sont des bouts liberes par le demontage : le joueur doit etre a moins de 140 m de celui qu'on raccorde
// (references/rails.md, « Raccords et distance du joueur »). Signaux de la voie sud reposes sur les joints neufs, du meme
// cote et dans le meme sens.
//
// node canyon-7m.js plan                releve la voie (avant le demontage) ; etat canyon-7m-state.json
// node canyon-7m.js essai               pose chaque rail a blanc, de point libre a point libre (caps au pas du jeu)
// node canyon-7m.js demonte             signaux puis rails de la voie sud (sauvegarder avant)
// node canyon-7m.js pose [--jusqua n]   rails 0..n-1 (tous par defaut), reprise apres le dernier pose
// node canyon-7m.js signaux             signaux reposes, coupure des blocs controlee
// node canyon-7m.js etats               anciens chemins remplaces dans les etats (plans/*-state.json)
// node canyon-7m.js verifie             ecart a la voie nord le long de la voie neuve, raccords
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const LV = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const T = LV + 'Build_RailroadTrack_C_';
const SOUTH_FIRST = T + '2145119425'; // premier rail sud, raccorde aux virages de hub0
const EAST_KEEP = T + '2145313496'; // rail sud garde a l'est : son TC1 porte le signal de la gare des mines
const NORTH_FIRST = T + '2145119604';
const NORTH_LAST = T + '2145590947'; // dernier rail nord avant l'aiguillage d'entree de la gare des mines
const GAP = 700;
const HUB = { x: 141339, y: -261512 }; // centre de hub0 : le bout ouest de chaque voie est le plus proche
const RECIPE = 'Recipe_RailroadTrack_C';
const FILE = path.join(__dirname, 'canyon-7m-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['demontes', 'poses']) st[k] = st[k] || [];
st.signaux = st.signaux || {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yawOf = (n) => (Math.atan2(n.y, n.x) * 180) / Math.PI;
const gradeOf = (n) => n.z / Math.hypot(n.x, n.y);
const neg = (n) => ({ x: -n.x, y: -n.y, z: -n.z });
const trackOf = (conn) => String(conn).split('.').slice(0, -1).join('.');
const needPlan = () => { if (!st.plan) throw new Error('pas de plan : node canyon-7m.js plan'); return st.plan; };
const connOf = async (c) => (await call('rails', c.path)).connections.find((x) => x.name === c.name);

// Points de la courbe d'un rail tous les ~1 m (mSplineData en repere local, tourne du cap de l'acteur)
async function splinePts(track) {
  const pose = await call('pose', track);
  const s = (await call('dump', track, 3, 50, ['mSplineData'])).mSplineData;
  const a = ((pose.rotation.yaw || 0) * Math.PI) / 180;
  const rot = (v) => ({ x: v.X * Math.cos(a) - v.Y * Math.sin(a), y: v.X * Math.sin(a) + v.Y * Math.cos(a), z: v.Z });
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const p0 = rot(s[i - 1].Location), p1 = rot(s[i].Location), t0 = rot(s[i - 1].LeaveTangent), t1 = rot(s[i].ArriveTangent);
    const n = Math.max(2, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 100));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
      const f = (q) => h00 * p0[q] + h10 * t0[q] + h01 * p1[q] + h11 * t1[q];
      out.push({ x: pose.location.x + f('x'), y: pose.location.y + f('y'), z: pose.location.z + f('z') });
    }
  }
  return out;
}

// Plus courte distance en plan d'un point a une courbe (points a moins de 3 m en hauteur)
function nearest(p, pts) {
  let best = null;
  for (const q of pts) {
    if (Math.abs(q.z - p.z) > 300) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || d < best.d) best = { q, d };
  }
  return best;
}

// Voie suivie d'ouest en est depuis un rail, jusqu'a celui qui verifie last(chemin, bout est)
async function walk(first, last) {
  const out = [];
  let cur = first, inName = null;
  for (let n = 0; n < 60; n++) {
    const r = await call('rails', cur);
    const dHub = (c) => Math.hypot(c.location.x - HUB.x, c.location.y - HUB.y);
    const entry = inName ? r.connections.find((c) => c.name === inName) : r.connections.reduce((a, b) => (dHub(a) < dHub(b) ? a : b));
    const exit = r.connections.find((c) => c !== entry);
    out.push({ path: cur, length: r.length, entry, exit });
    if (last(cur, exit)) return out;
    if (exit.connections.length !== 1) throw new Error(short(cur) + ' : ' + exit.connections.length + ' raccord(s) au bout est (aiguillage ou bout libre inattendu)');
    cur = exit.connections[0].track;
    inName = exit.connections[0].name;
  }
  throw new Error('voie de plus de 60 rails depuis ' + short(first));
}

async function northPts(nord) {
  const pts = [];
  for (const p of nord) pts.push(...(await splinePts(p)));
  return pts;
}

const PH = {
  async plan() {
    if (st.demontes.length) throw new Error('voie deja demontee : le plan de ' + FILE + ' fait foi');
    const S = await walk(SOUTH_FIRST, (p, e) => e.connections.some((c) => c.track === EAST_KEEP));
    const N = await walk(NORTH_FIRST, (p) => p === NORTH_LAST);
    const npts = await northPts(N.map((r) => r.path));
    if (S[0].entry.connections.length !== 1) throw new Error('bout ouest de la voie sud : ' + S[0].entry.connections.length + ' raccords');
    const w = S[0].entry.connections[0], e = S[S.length - 1].exit.connections.find((c) => c.track === EAST_KEEP);
    const rails = S.map((r, k) => {
      if (k === S.length - 1) return { old: r.path, length: r.length, to: null, yaw: yawOf(r.exit.normal), grade: gradeOf(r.exit.normal), ecart: null };
      const p = r.exit.location, b = nearest(p, npts);
      const u = { x: (p.x - b.q.x) / b.d, y: (p.y - b.q.y) / b.d };
      const to = { x: Math.round((b.q.x + u.x * GAP) * 10) / 10, y: Math.round((b.q.y + u.y * GAP) * 10) / 10, z: p.z };
      return { old: r.path, length: r.length, to, yaw: yawOf(r.exit.normal), grade: gradeOf(r.exit.normal), ecart: b.d, shift: Math.hypot(to.x - p.x, to.y - p.y) };
    });
    // Signaux poses sur un joint de la voie sud : connecteur garde (rail du lot -> bout du rail neuf, sinon inchange)
    const signals = [], seen = new Set();
    for (const r of S) for (const c of [r.entry, r.exit]) for (const f of ['facingSignal', 'trailingSignal']) {
      const sp = c[f];
      if (!sp || seen.has(sp)) continue;
      seen.add(sp);
      const d = await call('dump', sp, 1, 1, ['mGuardedConnections', 'mIsLeftHanded']);
      const g = d.mGuardedConnections[0], gTrack = trackOf(g), gName = short(g), m = S.findIndex((x) => x.path === gTrack);
      // rail neuf pose d'ouest en est : TC0 = bout ouest (entree de l'ancien rail), TC1 = bout est (sortie)
      const guard = m >= 0 ? { rail: m, end: S[m].entry.name === gName ? 'TrackConnection0' : 'TrackConnection1' } : { path: gTrack, name: gName };
      signals.push({ old: sp, recipe: /PathSignal/.test(sp) ? 'Recipe_RailroadPathSignal_C' : 'Recipe_RailroadBlockSignal_C', left: !!d.mIsLeftHanded, guard, at: c.location });
    }
    st.plan = { west: { path: w.track, name: w.name }, east: { path: EAST_KEEP, name: e.name }, nord: N.map((r) => r.path), rails, signals };
    save();
    console.log('voie sud :', rails.length, 'rails,', Math.round(rails.reduce((s, r) => s + r.length, 0) / 100), 'm ; voie nord de reference :', N.length, 'rails');
    console.log('bout ouest garde', short(w.track) + '.' + w.name, '| bout est garde', short(EAST_KEEP) + '.' + e.name);
    rails.forEach((r, k) => console.log(String(k).padStart(2), short(r.old).padEnd(32), (r.length / 100).toFixed(1).padStart(5) + ' m',
      r.to ? 'ecart ' + (r.ecart / 100).toFixed(2) + ' -> 7,00 m, joint deplace de ' + (r.shift / 100).toFixed(2) + ' m' : 'arrivee sur le rail garde (6,5 m)',
      'cap ' + r.yaw.toFixed(1), 'pente ' + (r.grade * 100).toFixed(2) + ' %'));
    for (const s of signals) console.log('signal', short(s.old), s.left ? 'gauche' : 'droite', 'garde', s.guard.rail != null ? 'rail ' + s.guard.rail + ' ' + s.guard.end : short(s.guard.path) + '.' + s.guard.name);
  },

  async essai() {
    const { rails, west, east } = needPlan();
    const wc = await connOf(west), ec = await connOf(east);
    let from = { x: wc.location.x, y: wc.location.y, z: wc.location.z, yaw: yawOf(wc.normal), grade: gradeOf(wc.normal) };
    let bad = 0;
    for (const [k, s] of rails.entries()) {
      const lastRail = k === rails.length - 1, a = neg(ec.normal);
      const to = lastRail ? { x: ec.location.x, y: ec.location.y, z: ec.location.z, yaw: yawOf(a), grade: gradeOf(a) }
        : { x: s.to.x, y: s.to.y, z: s.to.z, auto: k > 0, yaw: s.yaw, grade: Math.abs(s.grade) > 0.002 ? s.grade : 0 };
      const res = await call('rail', RECIPE, from, to, { dryRun: true });
      if (res.blocking.length) bad++;
      console.log('rail', String(k).padStart(2), res.blocking.length ? 'REFUS ' + res.blocking.join(',') : 'ok', res.disqualifiers.length ? '(' + res.disqualifiers.join(',') + ')' : '');
      from = Object.assign({}, to, { auto: undefined, yaw: s.yaw, grade: to.grade });
    }
    console.log(bad ? bad + ' rail(s) refuses a blanc' : 'tous les rails passent a blanc');
  },

  async demonte() {
    const { rails, signals } = needPlan();
    for (const s of signals) {
      if (st.demontes.includes(s.old)) continue;
      await call('dismantle', s.old, true);
      st.demontes.push(s.old); save();
      console.log('signal demonte', short(s.old));
    }
    for (const r of rails) {
      if (st.demontes.includes(r.old)) continue;
      await call('dismantle', r.old, true);
      st.demontes.push(r.old); save();
      console.log('rail demonte', short(r.old));
    }
  },

  async pose() {
    const { rails, west, east } = needPlan();
    if (!rails.every((r) => st.demontes.includes(r.old))) throw new Error('voie sud pas entierement demontee');
    const upto = Math.min(Number(opt('jusqua', rails.length)), rails.length);
    for (let k = st.poses.length; k < upto; k++) {
      const s = rails[k], lastRail = k === rails.length - 1;
      const from = k ? { path: st.poses[k - 1], name: 'TrackConnection1' } : west;
      const to = lastRail ? east : { x: s.to.x, y: s.to.y, z: s.to.z, auto: k > 0, yaw: s.yaw, grade: Math.abs(s.grade) > 0.002 ? s.grade : 0 };
      const res = await call('rail', RECIPE, from, to, {});
      if (!res.built) throw new Error('rail ' + k + ' refuse : ' + JSON.stringify(res.blocking));
      const info = await call('rails', res.actor);
      const c0 = info.connections.find((c) => c.name === 'TrackConnection0'), c1 = info.connections.find((c) => c.name === 'TrackConnection1');
      const okStart = c0.connections.some((c) => c.track === from.path && c.name === from.name);
      const okEnd = !lastRail || c1.connections.some((c) => c.track === east.path && c.name === east.name);
      console.log('rail', String(k).padStart(2), short(res.actor), (info.length / 100).toFixed(1) + ' m', 'depart ' + (okStart ? 'raccorde' : 'LIBRE'),
        lastRail ? 'arrivee ' + (okEnd ? 'raccordee' : 'LIBRE') : '', 'remplace', short(s.old));
      if (!okStart || !okEnd) {
        // rail non raccorde : retire aussitot, pour reprendre au meme point une fois le joueur rapproche
        await call('dismantle', res.actor, true);
        throw new Error('rail ' + k + ' non raccorde, retire : rapprocher le joueur du joint (moins de 140 m) et relancer pose');
      }
      st.poses.push(res.actor); save();
    }
    console.log(st.poses.length, '/', rails.length, 'rails poses');
  },

  async signaux() {
    const { rails, signals } = needPlan();
    if (st.poses.length !== rails.length) throw new Error('voie incomplete : ' + st.poses.length + ' / ' + rails.length + ' rails');
    for (const s of signals) {
      if (st.signaux[s.old]) continue;
      const guard = s.guard.rail != null ? { path: st.poses[s.guard.rail], name: s.guard.end } : s.guard;
      const res = await call('signal', s.recipe, guard, { leftHanded: s.left });
      if (!res.built) throw new Error('signal ' + short(s.old) + ' refuse : ' + JSON.stringify(res.blocking));
      st.signaux[s.old] = res.actor; save();
      console.log('signal', short(res.actor), 'remplace', short(s.old), 'sur', short(guard.path) + '.' + guard.name);
    }
    await sleep(2000);
    for (const s of signals) {
      const sig = st.signaux[s.old];
      const guard = s.guard.rail != null ? { path: st.poses[s.guard.rail], name: s.guard.end } : s.guard;
      const other = (await connOf(guard)).connections[0];
      const v = (await call('dump', sig, 1, 1, ['mBlockValidation'])).mBlockValidation;
      const [b1, b2] = [(await call('dump', guard.path, 1, 1, ['mSignalBlockID'])).mSignalBlockID, (await call('dump', other.track, 1, 1, ['mSignalBlockID'])).mSignalBlockID];
      console.log(short(sig), 'validation', v, b1 !== b2 ? 'blocs coupes' : 'BLOCS NON COUPES (meme bloc des deux cotes)');
    }
  },

  // Anciens chemins (rails et signaux) remplaces par les neufs dans les etats des autres chantiers
  async etats() {
    const { rails } = needPlan();
    const map = {};
    rails.forEach((r, k) => { if (st.poses[k]) map[short(r.old)] = short(st.poses[k]); });
    for (const [o, n] of Object.entries(st.signaux)) map[short(o)] = short(n);
    for (const f of fs.readdirSync(__dirname).filter((x) => /-state\.json$/.test(x) && x !== path.basename(FILE))) {
      const file = path.join(__dirname, f);
      let txt = fs.readFileSync(file, 'utf8'), n = 0;
      for (const [o, nw] of Object.entries(map)) txt = txt.replace(new RegExp(o + '(?!\\d)', 'g'), () => { n++; return nw; });
      if (n) { fs.writeFileSync(file, txt); console.log(f, ':', n, 'chemin(s) remplace(s)'); }
    }
  },

  async verifie() {
    const { rails, nord } = needPlan();
    const npts = await northPts(nord);
    let lo = Infinity, hi = 0;
    for (const [k, a] of st.poses.entries()) {
      const pts = await splinePts(a);
      let mn = Infinity, mx = 0;
      for (const p of pts) { const b = nearest(p, npts); if (!b) continue; mn = Math.min(mn, b.d); mx = Math.max(mx, b.d); }
      if (k > 0 && k < rails.length - 1) { lo = Math.min(lo, mn); hi = Math.max(hi, mx); }
      const info = await call('rails', a);
      const links = info.connections.map((c) => c.name.slice(-1) + ':' + (c.connections.length ? c.connections.map((x) => short(x.track).split('_').pop()).join('+') : 'LIBRE'));
      console.log(String(k).padStart(2), short(a), (info.length / 100).toFixed(1).padStart(5) + ' m', 'ecart ' + (mn / 100).toFixed(2) + ' .. ' + (mx / 100).toFixed(2) + ' m', links.join('  '));
    }
    console.log('rails interieurs : ecart ' + (lo / 100).toFixed(2) + ' .. ' + (hi / 100).toFixed(2) + ' m (premier et dernier rail : S depuis les bouts gardes a 6,5 m)');
  },
};

const phase = argv[0];
if (!PH[phase]) { console.error('usage : node canyon-7m.js <' + Object.keys(PH).join('|') + '> [--jusqua n]'); process.exit(2); }
PH[phase]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
