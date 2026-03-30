/**
 * Hermite spline sampling — shared between lib/ Builders and viewer/lib/spline.js.
 */

/**
 * Sample a Hermite spline from control points with tangents.
 * @param {Array<{x,y,z, ax,ay,az, lx,ly,lz}>} points  Control points with arrive/leave tangents
 * @param {number} [samplesPerSpan=6]  Number of samples per span
 * @returns {Array<{x,y,z}>}  Sampled points
 */
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

module.exports = { sampleHermiteSpline };
