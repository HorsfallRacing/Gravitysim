// Continuous radius profile along the smoothed centreline, so corners are
// found from the geometry rather than from apex distances carried over from
// the old (inflated) distance axis.
const fs = require('fs');
const profile = JSON.parse(fs.readFileSync('course_profile.json', 'utf8'));

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
  const b0 = (Suuu + Suvv) / 2, b1 = (Svvv + Svuu) / 2;
  const uc = (b0 * Svv - Suv * b1) / det, vc = (Suu * b1 - b0 * Suv) / det;
  return Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
}
// signed turn direction over the window (+ left, - right)
function turnSign(pts) {
  const a = pts[0], m = pts[Math.floor(pts.length / 2)], b = pts[pts.length - 1];
  return Math.sign((m.E - a.E) * (b.N - a.N) - (m.N - a.N) * (b.E - a.E));
}

const WINDOWS = [20, 30, 45];
const rad = {};
for (const W of WINDOWS) {
  rad[W] = profile.map((_, i) => {
    if (i < W || i >= profile.length - W) return Infinity;
    return fitCircle(profile.slice(i - W, i + W + 1));
  });
}

console.log('Radius profile along the smoothed centreline (m), by fit half-window\n');
console.log('   d(m)    +/-20m   +/-30m   +/-45m   turn');
for (let d = 0; d < profile.length; d += 20) {
  const r20 = rad[20][d], r30 = rad[30][d], r45 = rad[45][d];
  if (r30 > 300) continue;                       // only show curved sections
  const w = profile.slice(Math.max(0, d - 30), Math.min(profile.length, d + 31));
  const t = turnSign(w) > 0 ? 'left' : 'right';
  const f = v => (v > 999 ? '  >999' : v.toFixed(1)).padStart(8);
  console.log(`  ${String(d).padStart(5)} ${f(r20)} ${f(r30)} ${f(r45)}   ${t}`);
}

// Corner apexes = local minima of radius with real prominence, so a gentle
// bend on a straight does not get promoted to a named corner.
console.log('\nDetected corners (local radius minima, +/-30 m fit, prominence >= 2x):');
const r = rad[30].map(v => (isFinite(v) ? v : 1e6));
const R_MAX = 60;          // above this it is not a corner on this course
const PROMINENCE = 2.0;    // surrounding radius must be >= 2x the apex radius
const mins = [];
for (let i = 30; i < r.length - 30; i++) {
  if (r[i] > R_MAX) continue;
  let isMin = true;
  for (let j = Math.max(0, i - 30); j <= Math.min(r.length - 1, i + 30); j++) {
    if (r[j] < r[i]) { isMin = false; break; }
  }
  if (!isMin) continue;
  // prominence: look out to +/-80 m for the surrounding maximum
  let lo = 0, hi = 0;
  for (let j = Math.max(0, i - 80); j < i; j++) lo = Math.max(lo, r[j]);
  for (let j = i + 1; j <= Math.min(r.length - 1, i + 80); j++) hi = Math.max(hi, r[j]);
  if (Math.min(lo, hi) < PROMINENCE * r[i]) continue;
  if (mins.length && i - mins[mins.length - 1].d < 60) continue;
  const w = profile.slice(Math.max(0, i - 30), Math.min(profile.length, i + 31));
  mins.push({ d: i, R: r[i], dir: turnSign(w) > 0 ? 'left' : 'right' });
}
const NAMES = ['Quarry', 'Farmhouse/Croisdale', 'Orchard', 'Willow', 'Country', "Chippy's"];
const SIM = { Quarry: [35.6, 'left'], 'Farmhouse/Croisdale': [31.5, 'right'], Orchard: [23.3, 'left'],
              Willow: [37.5, 'left'], Country: [32.5, 'right'], "Chippy's": [32.1, 'left'] };
console.log('  corner                  d(m)   R(m)   dir     sim R   sim dir   handedness');
mins.forEach((m, i) => {
  const nm = NAMES[i] || '?';
  const s = SIM[nm];
  console.log(`  ${nm.padEnd(22)} ${String(m.d).padStart(5)} ${m.R.toFixed(1).padStart(6)}   ` +
    `${m.dir.padEnd(6)} ${s ? s[0].toFixed(1).padStart(6) : '     -'}   ${s ? s[1].padEnd(7) : '   -   '}` +
    `   ${s ? (s[1] === m.dir ? 'MATCH' : 'MISMATCH') : ''}`);
});
console.log(`\n  ${mins.length} corners found; centreline length ${profile.length - 1} m`);
