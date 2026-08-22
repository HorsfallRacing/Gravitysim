// Centripetal Catmull-Rom interpolation for a sparse polyline.
//
// Why this exists: the source GPX points are ~15 m apart. Joining them with
// straight lines chords across every corner -- on an 18 m radius corner a 15 m
// chord cuts 1.64 m inside the true arc (R - sqrt(R^2 - (c/2)^2)). Averaging
// several such polylines and smoothing does not recover the arc; it bakes the
// chording in. Centripetal (alpha=0.5) avoids the cusps and self-intersections
// that uniform Catmull-Rom produces on unevenly spaced points.
function catmullRomPoint(p0, p1, p2, p3, t, alpha = 0.5) {
  const d = (a, b) => Math.pow(Math.hypot(b.E - a.E, b.N - a.N), alpha);
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  if (t1 === t0 || t2 === t1 || t3 === t2) {          // duplicate points
    return { E: p1.E + t * (p2.E - p1.E), N: p1.N + t * (p2.N - p1.N) };
  }
  const tt = t1 + t * (t2 - t1);
  const mix = (a, b, ta, tb, u) => ({
    E: ((tb - u) * a.E + (u - ta) * b.E) / (tb - ta),
    N: ((tb - u) * a.N + (u - ta) * b.N) / (tb - ta),
  });
  const A1 = mix(p0, p1, t0, t1, tt), A2 = mix(p1, p2, t1, t2, tt), A3 = mix(p2, p3, t2, t3, tt);
  const B1 = mix(A1, A2, t0, t2, tt), B2 = mix(A2, A3, t1, t3, tt);
  return mix(B1, B2, t1, t2, tt);
}

// Densify a polyline: returns points along the Catmull-Rom curve through pts,
// `per` samples per original segment.
function densify(pts, per = 24) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) out.push(catmullRomPoint(p0, p1, p2, p3, k / per));
  }
  out.push(pts[pts.length - 1]);
  return out;
}
module.exports = { catmullRomPoint, densify };
