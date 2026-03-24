// ── Hermite spline sampling ────────────────────────────────────────
function sampleHermiteSpline(points, samplesPerSpan = 6) {
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    for (let s = 0; s <= samplesPerSpan; s++) {
      if (s === 0 && i > 0) continue; // avoid duplicate at join
      const t = s / samplesPerSpan;
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      result.push({
        x: h00 * p0.x + h10 * p0.lx + h01 * p1.x + h11 * p1.ax,
        y: h00 * p0.y + h10 * p0.ly + h01 * p1.y + h11 * p1.ay,
        z: h00 * p0.z + h10 * p0.lz + h01 * p1.z + h11 * p1.az,
      });
    }
  }
  return result;
}

// ── Quaternion rotate helper ───────────────────────────────────────
function quatRotate(r, vx, vy, vz) {
  const cx = r.y * vz - r.z * vy;
  const cy = r.z * vx - r.x * vz;
  const cz = r.x * vy - r.y * vx;
  const cx2 = r.y * cz - r.z * cy;
  const cy2 = r.z * cx - r.x * cz;
  const cz2 = r.x * cy - r.y * cx;
  return {
    x: vx + 2 * (r.w * cx + cx2),
    y: vy + 2 * (r.w * cy + cy2),
    z: vz + 2 * (r.w * cz + cz2),
  };
}

// ── Shared: sample spline + transform to world space ───────────────
function splineToWorldSegments(points, transform) {
  const sampled = sampleHermiteSpline(points, 3);
  const t = transform.translation;
  const r = transform.rotation;

  const worldPts = sampled.map(p => {
    const rotated = quatRotate(r, p.x, p.y, p.z);
    return { x: rotated.x + t.x, y: rotated.y + t.y, z: rotated.z + t.z };
  });

  const segments = [];
  for (let i = 0; i < worldPts.length - 1; i++) {
    segments.push(worldPts[i], worldPts[i + 1]);
  }
  return segments;
}

// ── Extract spline from save entity (parser format) ────────────────
function extractSplineSegments(entity) {
  const splineData = entity.properties?.mSplineData;
  if (!splineData) return null;

  const values = splineData.values;
  if (!values || values.length < 2) return null;

  const points = [];
  for (const pt of values) {
    const props = pt.value?.properties || pt.properties;
    if (!props) continue;
    const loc = props.Location?.value || props.Location;
    const arrive = props.ArriveTangent?.value || props.ArriveTangent;
    const leave = props.LeaveTangent?.value || props.LeaveTangent;
    if (!loc) continue;
    points.push({
      x: loc.x, y: loc.y, z: loc.z,
      ax: arrive?.x || 0, ay: arrive?.y || 0, az: arrive?.z || 0,
      lx: leave?.x || 0, ly: leave?.y || 0, lz: leave?.z || 0,
    });
  }

  if (points.length < 2) return null;
  return splineToWorldSegments(points, entity.transform);
}

// ── Extract spline from CBP entity (SCIM format) ──────────────────
function extractCbpSplineSegments(propsArray, transform) {
  const splineProp = propsArray.find(p => p.name === 'mSplineData');
  if (!splineProp) return null;

  const values = splineProp.value?.values;
  if (!values || values.length < 2) return null;

  const points = [];
  for (const ptArray of values) {
    const locProp = ptArray.find(p => p.name === 'Location');
    const arriveProp = ptArray.find(p => p.name === 'ArriveTangent');
    const leaveProp = ptArray.find(p => p.name === 'LeaveTangent');
    const loc = locProp?.value?.values;
    const arrive = arriveProp?.value?.values;
    const leave = leaveProp?.value?.values;
    if (!loc) continue;
    points.push({
      x: loc.x, y: loc.y, z: loc.z,
      ax: arrive?.x || 0, ay: arrive?.y || 0, az: arrive?.z || 0,
      lx: leave?.x || 0, ly: leave?.y || 0, lz: leave?.z || 0,
    });
  }

  if (points.length < 2) return null;
  return splineToWorldSegments(points, transform);
}

// ── Deduplicate spline segments → point array ──────────────────────
function segmentsToPoints(segments) {
  const pts = [];
  for (let s = 0; s < segments.length; s += 2) {
    if (s === 0) pts.push(segments[s]);
    pts.push(segments[s + 1]);
  }
  return pts.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10]);
}

module.exports = { quatRotate, extractSplineSegments, extractCbpSplineSegments, segmentsToPoints };