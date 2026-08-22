// Moving average vs Savitzky-Golay on the centreline.
// A moving average is a local CONSTANT fit, so it pulls curves inward by
// ~L^2/(6R). Savitzky-Golay fits a local polynomial and preserves curvature.
const fs = require('fs');
const { wgs84ToOsgb36 } = require('./osgb');

const src = fs.readFileSync(require('path').join(__dirname,'..','GpxBenchmark.html'), 'utf8');
const grab = n => JSON.parse(new RegExp(`const ${n} = (\\[.*?\\]);`, 's').exec(src)[1]);
const RUNS = ['routePoints', 'run2Points', 'run3Points', 'run5Points'];

const tracks = RUNS.map(name => {
  const pts = grab(name).map(p => wgs84ToOsgb36(p.lat, p.lon));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].E - pts[i - 1].E, pts[i].N - pts[i - 1].N));
  const tot = cum[cum.length - 1];
  return { pts, s: cum.map(c => c / tot) };
});
const atFrac = (t, f) => {
  if (f <= 0) return t.pts[0];
  if (f >= 1) return t.pts[t.pts.length - 1];
  for (let i = 1; i < t.s.length; i++) if (t.s[i] >= f) {
    const u = (f - t.s[i - 1]) / (t.s[i] - t.s[i - 1]);
    return { E: t.pts[i - 1].E + u * (t.pts[i].E - t.pts[i - 1].E),
             N: t.pts[i - 1].N + u * (t.pts[i].N - t.pts[i - 1].N) };
  }
  return t.pts[t.pts.length - 1];
};
const M = 2000;
const raw = [];
for (let k = 0; k <= M; k++) {
  const ps = tracks.map(t => atFrac(t, k / M));
  raw.push({ E: ps.reduce((a, p) => a + p.E, 0) / ps.length, N: ps.reduce((a, p) => a + p.N, 0) / ps.length });
}

// ---- filters ----------------------------------------------------------
const movingAverage = (pts, win) => pts.map((_, i) => {
  let sE = 0, sN = 0, n = 0;
  for (let j = Math.max(0, i - win); j <= Math.min(pts.length - 1, i + win); j++) { sE += pts[j].E; sN += pts[j].N; n++; }
  return { E: sE / n, N: sN / n };
});

function solve(A, b) {                       // Gaussian elimination
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
// Savitzky-Golay: local polynomial of `order`, evaluated at the window centre.
// x is normalised to [-1,1] and the local mean removed, or the normal
// equations are hopelessly ill-conditioned at these coordinate magnitudes.
function savGol(pts, win, order) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(pts.length - 1, i + win);
    const xs = [], ysE = [], ysN = [];
    let mE = 0, mN = 0, n = 0;
    for (let j = lo; j <= hi; j++) { mE += pts[j].E; mN += pts[j].N; n++; }
    mE /= n; mN /= n;
    for (let j = lo; j <= hi; j++) {
      xs.push((j - i) / win);                 // normalised offset
      ysE.push(pts[j].E - mE); ysN.push(pts[j].N - mN);
    }
    const A = [], bE = [], bN = [];
    for (let r = 0; r <= order; r++) {
      A.push(Array.from({ length: order + 1 }, (_, c) => xs.reduce((a, x) => a + Math.pow(x, r + c), 0)));
      bE.push(xs.reduce((a, x, k) => a + Math.pow(x, r) * ysE[k], 0));
      bN.push(xs.reduce((a, x, k) => a + Math.pow(x, r) * ysN[k], 0));
    }
    const cE = solve(A, bE), cN = solve(A, bN);
    // value at the window centre = constant term (x=0), plus the mean back
    out.push(cE && cN ? { E: cE[0] + mE, N: cN[0] + mN } : pts[i]);
  }
  return out;
}

// ---- measure ----------------------------------------------------------
function fitCircle(pts) {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.E, 0) / n, my = pts.reduce((a, p) => a + p.N, 0) / n;
  let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const u = p.E - mx, v = p.N - my;
    Suu += u * u; Svv += v * v; Suv += u * v;
    Suuu += u ** 3; Svvv += v ** 3; Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-9) return Infinity;
  const uc = ((Suuu + Suvv) / 2 * Svv - Suv * (Svvv + Svuu) / 2) / det;
  const vc = (Suu * (Svvv + Svuu) / 2 - (Suuu + Suvv) / 2 * Suv) / det;
  return Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
}
const len = l => l.reduce((a, p, i) => i ? a + Math.hypot(p.E - l[i - 1].E, p.N - l[i - 1].N) : 0, 0);
// max inward displacement vs the raw line, at the tight corners
function maxShift(a, b, lo, hi) {
  let m = 0;
  for (let i = lo; i <= hi; i++) m = Math.max(m, Math.hypot(a[i].E - b[i].E, a[i].N - b[i].N));
  return m;
}

const variants = [
  ['raw (unsmoothed)', raw],
  ['moving avg +/-25', movingAverage(raw, 25)],
  ['SavGol +/-25 ord2', savGol(raw, 25, 2)],
  ['SavGol +/-40 ord3', savGol(raw, 40, 3)],
  ['SavGol +/-60 ord3', savGol(raw, 60, 3)],
];

// corner stations on the 2001-point raw line (fractions of length)
const CORNERS = { Quarry: 0.055, 'Farmhouse/Croisdale': 0.663 / 2, Orchard: 0.500, Willow: 0.699, Country: 0.797, "Chippy's": 0.948 };
const ST = Object.fromEntries(Object.entries(CORNERS).map(([k, f]) => [k, Math.round(f * M)]));
// use the detected apex stations instead (from the +/-30m analysis, scaled)
const APEX = { Quarry: 57, 'Farmhouse/Croisdale': 681, Orchard: 1002, Willow: 1398, Country: 1595, "Chippy's": 1897 };

console.log('Corner radius (m), circle fit over +/-55 stations (~30 m)\n');
console.log('  variant              ' + Object.keys(APEX).map(k => k.slice(0, 8).padStart(10)).join('') + '     length');
for (const [name, line] of variants) {
  const row = Object.values(APEX).map(st => {
    const R = fitCircle(line.slice(Math.max(0, st - 55), Math.min(line.length, st + 56)));
    return (R > 999 ? '>999' : R.toFixed(1)).padStart(10);
  });
  console.log('  ' + name.padEnd(20) + row.join('') + len(line).toFixed(1).padStart(11) + ' m');
}

console.log('\nMax displacement from the raw line through the two tight corners:');
for (const [name, line] of variants.slice(1)) {
  console.log(`  ${name.padEnd(20)} Country ${maxShift(raw, line, 1540, 1650).toFixed(2)} m` +
              `   Chippy's ${maxShift(raw, line, 1840, 1950).toFixed(2)} m`);
}
