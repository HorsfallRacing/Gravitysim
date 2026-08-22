// Savitzky-Golay smoothing for a 2D polyline. Local polynomial fit preserves
// curvature, unlike a moving average which pulls curves inward by ~L^2/(6R).
function solve(A, b) {
  const n = b.length, m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    if (Math.abs(m[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}
function savGol(pts, win, order) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(pts.length - 1, i + win);
    const xs = [], ysE = [], ysN = [];
    let mE = 0, mN = 0, n = 0;
    for (let j = lo; j <= hi; j++) { mE += pts[j].E; mN += pts[j].N; n++; }
    mE /= n; mN /= n;
    for (let j = lo; j <= hi; j++) {
      xs.push((j - i) / win);
      ysE.push(pts[j].E - mE); ysN.push(pts[j].N - mN);
    }
    const A = [], bE = [], bN = [];
    for (let r = 0; r <= order; r++) {
      A.push(Array.from({ length: order + 1 }, (_, c) => xs.reduce((a, x) => a + Math.pow(x, r + c), 0)));
      bE.push(xs.reduce((a, x, k) => a + Math.pow(x, r) * ysE[k], 0));
      bN.push(xs.reduce((a, x, k) => a + Math.pow(x, r) * ysN[k], 0));
    }
    const cE = solve(A, bE), cN = solve(A, bN);
    out.push(cE && cN ? { E: cE[0] + mE, N: cN[0] + mN } : { E: pts[i].E, N: pts[i].N });
  }
  return out;
}
module.exports = { savGol, solve };
