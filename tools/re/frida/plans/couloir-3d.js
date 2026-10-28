// Releve d'un trace en l'air (lecture seule) : recherches centrees SUR le trace (points tous les 15 m, a leur hauteur,
// rayon 3D de 40 m), geometrie de chaque batiment (boites d'encombrement dures, convoyeurs et tuyaux en courbe,
// ascenseurs en colonne), distance au trace. Le releve du traceur (obstacles) cherche dans une sphere centree au sol :
// il ne voit pas ce qui est a plus de ~100 m de haut.
// (28/10/2026 : le releve du traceur ne voyait pas une pile d'assembleuses de 124 a 154 m sur l'arrivee de l'uranium.)
// usage : node couloir-3d.js '<trace [[x,y,z],...]>' [distance_m]
const { call, short } = require('./client');
const clearance = require('../../../../data/clearanceData.json');
const pts = JSON.parse(process.argv[2]).map(([x, y, z]) => ({ x, y, z }));
const D = Number(process.argv[3] || 8) * 100;
const rad = (d) => d * Math.PI / 180;
const dSeg = (p, a, b) => {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, L2 = d.x * d.x + d.y * d.y + d.z * d.z;
  let t = L2 ? ((p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - a.x - t * d.x, p.y - a.y - t * d.y, p.z - a.z - t * d.z);
};
const dPath = (p) => { let m = 1e12; for (let i = 1; i < pts.length; i++) m = Math.min(m, dSeg(p, pts[i - 1], pts[i])); return m; };
(async () => {
  const seen = new Map();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / 1500));
    for (let j = 0; j <= n; j++) {
      const p = { x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n, z: a.z + (b.z - a.z) * j / n };
      const r = await call('scan', 'FGBuildable', p, 4000, 600, {});
      for (const it of r.items) if (!seen.has(it.path)) seen.set(it.path, it);
    }
  }
  const hits = [];
  for (const it of seen.values()) {
    if (/PowerLine|FlowIndicator/.test(it.class)) continue;
    let samples = [];
    if (/ConveyorLift/.test(it.class)) {
      const t = (await call('dump', it.path, 3, 50, ['mTopTransform'])).mTopTransform.Translation;
      const a = rad(it.yaw || 0), top = { x: it.location.x + t.X * Math.cos(a) - t.Y * Math.sin(a), y: it.location.y + t.X * Math.sin(a) + t.Y * Math.cos(a), z: it.location.z + t.Z };
      for (let s = 0; s <= 1.0001; s += 0.05) samples.push({ x: it.location.x + (top.x - it.location.x) * s, y: it.location.y + (top.y - it.location.y) * s, z: it.location.z + (top.z - it.location.z) * s, r: 150 });
    } else if (/ConveyorBelt|Pipeline(?!Support|Pump|Junction)|RailroadTrack/.test(it.class)) {
      const pose = await call('pose', it.path), q = Array.isArray(pose) ? pose[0] : pose;
      const s = (await call('dump', it.path, 3, 50, ['mSplineData'])).mSplineData || [];
      const a = rad(q.rotation.yaw), c = Math.cos(a), sn = Math.sin(a), o = q.location;
      for (let k = 1; k < s.length; k++) {
        const A = s[k - 1], B = s[k];
        for (let t = 0; t <= 1.0001; t += 0.1) {
          const h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
          const v = ['X', 'Y', 'Z'].map((k2) => h00 * A.Location[k2] + h10 * A.LeaveTangent[k2] + h01 * B.Location[k2] + h11 * B.ArriveTangent[k2]);
          samples.push({ x: o.x + v[0] * c - v[1] * sn, y: o.y + v[0] * sn + v[1] * c, z: o.z + v[2], r: 100 });
        }
      }
    } else {
      const cl = clearance[it.class];
      const boxes = cl ? cl.boxes.filter((b) => b.type !== 'CT_Soft') : [];
      // pieces sans boite dure (fusionneurs, repartiteurs) : boule de 1,5 m
      if (!boxes.length) samples.push({ x: it.location.x, y: it.location.y, z: it.location.z + 50, r: 150 });
      for (const b of boxes) {
        const t = (b.relativeTransform && b.relativeTransform.translation) || { x: 0, y: 0, z: 0 };
        const lc = { x: (b.min.x + b.max.x) / 2 + t.x, y: (b.min.y + b.max.y) / 2 + t.y, z: (b.min.z + b.max.z) / 2 + t.z };
        const a = rad(it.yaw || 0);
        samples.push({ x: it.location.x + lc.x * Math.cos(a) - lc.y * Math.sin(a), y: it.location.y + lc.x * Math.sin(a) + lc.y * Math.cos(a), z: it.location.z + lc.z, r: Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2 });
      }
    }
    let best = null;
    for (const s of samples) { const d = dPath(s) - s.r; if (!best || d < best.d) best = { d, s }; }
    if (best && best.d < D) hits.push({ what: short(it.path), d: Math.round(best.d / 10) / 10, x: Math.round(best.s.x), y: Math.round(best.s.y), z: Math.round(best.s.z / 10) / 10 });
  }
  hits.sort((a, b) => a.y - b.y);
  for (const h of hits) console.log(h.what.padEnd(48), 'd', String(h.d).padStart(6), 'm  a', h.x, h.y, h.z + ' m');
  console.log(hits.length, 'obstacles a moins de', D / 100, 'm du trace (', seen.size, 'batiments releves )');
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
