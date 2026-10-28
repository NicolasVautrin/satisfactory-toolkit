// Double voie remise a 7 m d'axe en axe (standard du 26/10/2026), generalisation de canyon-7m.js : une voie de
// reference reste en place (celle qui porte les aiguillages), l'autre est reposee a 7 m d'elle, chaque joint place a 7 m du
// point le plus proche de la reference (courbes echantillonnees), du meme cote, caps et pentes inchanges. Les deux rails
// gardes aux bouts ne bougent pas : le premier rail neuf part du bout garde de depart, le dernier arrive sur celui
// d'arrivee. Les signaux de la voie reposee sont reposes sur les joints neufs, du meme cote et dans le meme sens.
// Ecart : le standard, 7,5 m (utilisateur, 28/10/2026 : « on passe le standard d'ecartement a 7.5 »), ou `gap` (cm) par
// chantier (n85 : 7 m, standard de l'epoque).
// Chantiers (CHANTIERS) :
//  - o76 : ligne de la jonction des quarts de cercle (-78 494 ; -207 895) au nord par x -75 800, puis a l'est par
//    y -262 000 jusqu'a (-61 754 ; -262 187), double voie a 6,5 m ou deux trains ont deraille (utilisateur, 28/10/2026 :
//    « refais la toute voie à 7m », puis « on va plutot passer a 7.5 en ecartement ») : 7,5 m. Reference : la voie
//    sud / est (sens sud), interieure au virage vers l'est (rayon 18 m : la rapprocher le passerait sous 17 m) ;
//    reposee : la voie nord / ouest (sens nord), rails gardes aux deux bouts = les quarts de cercle d'ecartement.
//  - n85 : ligne N85 E78 <-> gare de triage (utilisateur, 27/10/2026 : « 2, refais la ligne a 7m »), double voie a 6,5 m
//    de (76 575 ; -94 892 ; 138 m) a (111 706 ; -252 112 ; 53 m). Reference : la voie de retour (aiguillage du joint K,
//    ligne de S13 E101) ; reposee : la voie d'aller, rails 11 a 37 de l'itineraire N85 E78 -> N266 E102 h0, sans
//    aiguillage. Les deux rails gardes sont a 6,5 m a leur joint (S de 0,5 m sur le premier et le dernier rail) ; le rail
//    38 garde porte le signal de chemin de l'entree de la gare de triage.
// Tout se pose a distance, sans deplacer le joueur (jusqu'a ~1 km ; references/rails.md, « Raccords et distance du
// joueur ») : le premier rail part en point libre sur le bout garde de depart (bout libere par le demontage, raccord du jeu
// a moins de 140 m seulement), puis railLink le relie (ce joint ne doit pas porter de signal : un signal sur un joint fait
// par railLink ne coupe pas les blocs) ; chaque rail suivant part du bout du rail neuf precedent ; le dernier arrive sur
// le bout garde d'arrivee par l'arrivee forcee (connecteur a plat et au pas de 10 deg), ou railLink sinon.
//
// node voie-7m.js <chantier> plan            releve la voie (avant le demontage) ; etat voie-7m-<chantier>-state.json
// node voie-7m.js <chantier> essai           pose chaque rail a blanc, de point libre a point libre
// node voie-7m.js <chantier> demonte         signaux puis rails de la voie reposee (sauvegarder avant)
// node voie-7m.js <chantier> pose [--jusqua n]   rails 0..n-1 (tous par defaut), reprise apres le dernier pose
// node voie-7m.js <chantier> signaux         signaux reposes, coupure des blocs controlee
// node voie-7m.js <chantier> etats           anciens chemins remplaces dans les etats (plans/*-state.json)
// node voie-7m.js <chantier> verifie         ecart a la reference le long de la voie neuve, raccords
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const LV = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const T = (id) => LV + 'Build_RailroadTrack_C_' + id;
const CHANTIERS = {
  n85: {
    gap: 700,
    keepStart: T('2147207704'), // aller 10 : rail garde de depart (sortie vers la voie reposee)
    first: T('2147230561'), last: T('2147271598'), // aller 11 .. 37
    keepEnd: T('2145487473'),   // aller 38 : rail garde d'arrivee (6,5 -> 7 m, signal de chemin a sa sortie)
    // reference : retour 32 .. 61 (de la gare de triage aux abords de N85 E78)
    ref: ['2145487600', '2145487519', '2147272655', '2147272604', '2147272564', '2147272522', '2147272462', '2147272417',
      '2147272366', '2147272313', '2147272268', '2147272221', '2147272159', '2147272114', '2147272075', '2147272025',
      '2147271982', '2147271933', '2147271890', '2147271845', '2147271791', '2147271751', '2147271707', '2147271670',
      '2147271636', '2147230847', '2147230796', '2147230761', '2147230721', '2145613690'].map(T),
  },
  // canyon75 : voie sud du canyon (hub0 -> gare des mines), deja reposee a 7 m le 27/10/2026 (canyon-7m.js), remise a
  // 7,5 m (utilisateur, 28/10/2026 : « ok passe la voie du canyon a un ecartement de 7.5 », apres un deraillement a la
  // jonction de hub0 juste a l'ouest). Meme lot (les 19 rails poses par canyon-7m), memes bouts gardes, meme reference
  // (la voie nord, qui porte l'aiguillage d'entree de la gare des mines).
  canyon75: {
    keepStart: T('2145496093'), first: T('2144816908'), last: T('2144815858'), keepEnd: T('2145313496'),
    ref: ['2145119604', '2145119650', '2145117332', '2145617276', '2145617323', '2145617372', '2145617424', '2145617474',
      '2145617519', '2145617556', '2145617599', '2145617642', '2145841864', '2145840958', '2145836802', '2145591072',
      '2145591030', '2145590995', '2145590947'].map(T),
  },
  // hub0sud : jonction de hub0 a l'ouest du canyon (deraillement du 28/10/2026 : N279 #3 sur la voie sud, N248 #2 sortant
  // par le quart nord, voies a 6,5 - 7 m) : quart de cercle sud depuis l'aiguillage (142 011 ; -259 712), rail de 32 m et
  // premier rail du canyon (transition), a 7,5 m de la voie nord (quart nord, rail nord, premier rail nord du canyon)
  // (utilisateur : « oui fais les trois »). Bout garde de depart : le rail au sud de l'aiguillage.
  hub0sud: {
    keepStart: T('2144924056'), first: T('2145497293'), last: T('2142512079'), keepEnd: T('2142512022'),
    ref: ['2145497373', '2145496011', '2145119604', '2145119650'].map(T),
  },
  o76: {
    gap: 750,
    keepStart: T('2145470905'), // quart de cercle d'arrivee par le sud-ouest (28 -> 7 m), garde
    first: T('2145470865'), last: T('2145425366'), // voie nord : 15 rails, de la jonction au debut de l'ecartement est
    keepEnd: T('2145425417'),   // quart de cercle de l'ecartement est (7 -> 28 m), garde (signal a son entree)
    // reference : voie sud, de la jonction au debut de l'ecartement est
    ref: ['2145470698', '2144630059', '2144728801', '2144728889', '2144728985', '2144729070', '2144729143', '2144729215',
      '2144729300', '2144729374', '2144729438', '2144729502', '2144730447', '2144362523', '2145425467'].map(T),
  },
};
const NAME = argv[0], C = CHANTIERS[NAME];
const GAP = (C && C.gap) || 750;
const RECIPE = 'Recipe_RailroadTrack_C';
const FILE = path.join(__dirname, 'voie-7m-' + NAME + '-state.json');
const st = C && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['demontes', 'poses']) st[k] = st[k] || [];
st.signaux = st.signaux || {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yawOf = (n) => (Math.atan2(n.y, n.x) * 180) / Math.PI;
const gradeOf = (n) => n.z / Math.hypot(n.x, n.y);
const neg = (n) => ({ x: -n.x, y: -n.y, z: -n.z });
const trackOf = (conn) => String(conn).split('.').slice(0, -1).join('.');
const needPlan = () => { if (!st.plan) throw new Error('pas de plan : node voie-7m.js ' + NAME + ' plan'); return st.plan; };
const connOf = async (c) => (await call('rails', c.path)).connections.find((x) => x.name === c.name);
// Arrivee en point libre : cap impose s'il tombe sur le pas de 10 deg du jeu, sinon direction libre (auto). Ligne de N85
// (27/10/2026) : en auto, les S pres de la crete deviaient de 8 a 20 deg a chaque rail (ecart 5,3 .. 9,3 m)
const onStep = (yaw) => Math.abs(yaw / 10 - Math.round(yaw / 10)) < 0.005;
const freeTo = (s, k) => ({ x: s.to.x, y: s.to.y, z: s.to.z, auto: k > 0 && !onStep(s.yaw), yaw: s.yaw, grade: Math.abs(s.grade) > 0.002 ? s.grade : 0 });

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

// Voie suivie depuis `first`, entree par le connecteur raccorde a `from`, jusqu'a `last`
async function walk(first, from, last) {
  const out = [];
  let cur = first, inName = null;
  for (let n = 0; n < 200; n++) {
    const r = await call('rails', cur);
    const entry = inName ? r.connections.find((c) => c.name === inName) : r.connections.find((c) => c.connections.some((x) => x.track === from));
    if (!entry) throw new Error(short(cur) + ' : pas de connecteur raccorde a ' + short(from));
    const exit = r.connections.find((c) => c !== entry);
    out.push({ path: cur, length: r.length, entry, exit });
    if (cur === last) return out;
    if (exit.connections.length !== 1) throw new Error(short(cur) + ' : ' + exit.connections.length + ' raccord(s) en sortie (aiguillage ou bout libre inattendu)');
    cur = exit.connections[0].track;
    inName = exit.connections[0].name;
  }
  throw new Error('voie de plus de 200 rails depuis ' + short(first));
}

async function refPts() {
  const pts = [];
  for (const p of C.ref) pts.push(...(await splinePts(p)));
  return pts;
}

const PH = {
  async plan() {
    if (st.demontes.length) throw new Error('voie deja demontee : le plan de ' + FILE + ' fait foi');
    const S = await walk(C.first, C.keepStart, C.last);
    const npts = await refPts();
    if (S[0].entry.connections.length !== 1) throw new Error('bout de depart : ' + S[0].entry.connections.length + ' raccords');
    const w = S[0].entry.connections[0], e = S[S.length - 1].exit.connections.find((c) => c.track === C.keepEnd);
    if (!e) throw new Error('le dernier rail n\'arrive pas sur ' + short(C.keepEnd));
    const rails = S.map((r, k) => {
      if (k === S.length - 1) return { old: r.path, length: r.length, to: null, yaw: yawOf(r.exit.normal), grade: gradeOf(r.exit.normal), ecart: null };
      const p = r.exit.location, b = nearest(p, npts);
      const u = { x: (p.x - b.q.x) / b.d, y: (p.y - b.q.y) / b.d };
      const to = { x: Math.round((b.q.x + u.x * GAP) * 10) / 10, y: Math.round((b.q.y + u.y * GAP) * 10) / 10, z: p.z };
      return { old: r.path, length: r.length, to, yaw: yawOf(r.exit.normal), grade: gradeOf(r.exit.normal), ecart: b.d, shift: Math.hypot(to.x - p.x, to.y - p.y) };
    });
    // Signaux poses sur un joint de la voie reposee : connecteur garde (rail du lot -> bout du rail neuf, sinon inchange)
    const signals = [], seen = new Set();
    for (const r of S) for (const c of [r.entry, r.exit]) for (const f of ['facingSignal', 'trailingSignal']) {
      const sp = c[f];
      if (!sp || seen.has(sp)) continue;
      seen.add(sp);
      const d = await call('dump', sp, 1, 1, ['mGuardedConnections', 'mIsLeftHanded']);
      const g = d.mGuardedConnections[0], gTrack = trackOf(g), gName = short(g), m = S.findIndex((x) => x.path === gTrack);
      // rail neuf pose dans le sens de la marche : TC0 = entree de l'ancien rail, TC1 = sortie
      const guard = m >= 0 ? { rail: m, end: S[m].entry.name === gName ? 'TrackConnection0' : 'TrackConnection1' } : { path: gTrack, name: gName };
      signals.push({ old: sp, recipe: /PathSignal/.test(sp) ? 'Recipe_RailroadPathSignal_C' : 'Recipe_RailroadBlockSignal_C', left: !!d.mIsLeftHanded, guard, at: c.location });
    }
    st.plan = { start: { path: w.track, name: w.name }, end: { path: C.keepEnd, name: e.name }, ref: C.ref, rails, signals };
    save();
    console.log('voie reposee :', rails.length, 'rails,', Math.round(rails.reduce((s, r) => s + r.length, 0) / 100), 'm ; reference :', C.ref.length, 'rails');
    console.log('bout de depart garde', short(w.track) + '.' + w.name, '| bout d\'arrivee garde', short(C.keepEnd) + '.' + e.name);
    rails.forEach((r, k) => console.log(String(k).padStart(2), short(r.old).padEnd(32), (r.length / 100).toFixed(1).padStart(5) + ' m',
      r.to ? 'ecart ' + (r.ecart / 100).toFixed(2) + ' -> ' + (GAP / 100).toFixed(2) + ' m, joint deplace de ' + (r.shift / 100).toFixed(2) + ' m' : 'arrivee sur le rail garde',
      'cap ' + r.yaw.toFixed(1), 'pente ' + (r.grade * 100).toFixed(2) + ' %'));
    for (const s of signals) console.log('signal', short(s.old), s.left ? 'gauche' : 'droite', 'garde', s.guard.rail != null ? 'rail ' + s.guard.rail + ' ' + s.guard.end : short(s.guard.path) + '.' + s.guard.name);
  },

  async essai() {
    const { rails, start, end } = needPlan();
    const wc = await connOf(start), ec = await connOf(end);
    let from = { x: wc.location.x, y: wc.location.y, z: wc.location.z, yaw: yawOf(wc.normal), grade: gradeOf(wc.normal) };
    let bad = 0;
    for (const [k, s] of rails.entries()) {
      const lastRail = k === rails.length - 1, a = neg(ec.normal);
      const to = lastRail ? { x: ec.location.x, y: ec.location.y, z: ec.location.z, yaw: yawOf(a), grade: gradeOf(a) } : freeTo(s, k);
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
    const { rails, start, end } = needPlan();
    if (!rails.every((r) => st.demontes.includes(r.old))) throw new Error('voie pas entierement demontee');
    const upto = Math.min(Number(opt('jusqua', rails.length)), rails.length);
    const sub = (await call('scan', 'FGRailroadSubsystem', null, 0, 1, {})).items[0].path;
    const sc = await connOf(start), ec = await connOf(end), a = neg(ec.normal);
    for (let k = st.poses.length; k < upto; k++) {
      const s = rails[k], lastRail = k === rails.length - 1;
      // premier rail : depart en point libre sur le connecteur garde ; dernier : arrivee en point libre sur l'autre
      const from = k ? { path: st.poses[k - 1], name: 'TrackConnection1' }
        : { x: sc.location.x, y: sc.location.y, z: sc.location.z, yaw: yawOf(sc.normal), grade: gradeOf(sc.normal) };
      const to = lastRail ? { x: ec.location.x, y: ec.location.y, z: ec.location.z, yaw: yawOf(a), grade: gradeOf(a) } : freeTo(s, k);
      const res = await call('rail', RECIPE, from, to, {});
      if (!res.built) throw new Error('rail ' + k + ' refuse : ' + JSON.stringify(res.blocking));
      const linked = (info, name, want) => info.connections.find((c) => c.name === name).connections.some((c) => c.track === want.path && c.name === want.name);
      let info = await call('rails', res.actor);
      if (k === 0 && !linked(info, 'TrackConnection0', start)) await call('railLink', sub, res.actor, 'TrackConnection0', start.path, start.name);
      if (lastRail && !linked(info, 'TrackConnection1', end)) await call('railLink', sub, res.actor, 'TrackConnection1', end.path, end.name);
      info = await call('rails', res.actor);
      const okStart = linked(info, 'TrackConnection0', k ? from : start);
      const okEnd = !lastRail || linked(info, 'TrackConnection1', end);
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
    const { rails } = needPlan();
    const npts = await refPts();
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
    console.log('rails interieurs : ecart ' + (lo / 100).toFixed(2) + ' .. ' + (hi / 100).toFixed(2) + ' m');
  },
};

const phase = argv[1];
if (!C || !PH[phase]) { console.error('usage : node voie-7m.js <' + Object.keys(CHANTIERS).join('|') + '> <' + Object.keys(PH).join('|') + '> [--jusqua n]'); process.exit(2); }
PH[phase]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
