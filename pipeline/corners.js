// Corner geometry from the centreline, with the fit window scaled to each
// corner instead of a fixed +/-30 m.
//
// A fixed window biases tight corners low: +/-30 m on a 21 m radius corner
// spans ~164 deg of arc, so the fit is dragged onto the entry and exit
// straights. Here the window is iterated until it spans a fixed ARC ANGLE,
// which makes every corner comparable regardless of radius.
const fs = require('fs');
const path = require('path');

const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'course_profile.json'), 'utf8'));

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

// Signed curvature at station i over a +/-h baseline. Positive = left turn.
// Well defined everywhere, including inflections, unlike radius.
function kappaAt(i, h) {
  const a = profile[i - h], b = profile[i], c = profile[i + h];
  if (!a || !c) return 0;
  const cross = (b.E - a.E) * (c.N - a.N) - (b.N - a.N) * (c.E - a.E);
  const la = Math.hypot(b.E - a.E, b.N - a.N);
  const lb = Math.hypot(c.E - b.E, c.N - b.N);
  const lc = Math.hypot(c.E - a.E, c.N - a.N);
  if (la * lb * lc === 0) return 0;
  return 2 * cross / (la * lb * lc);
}

// Iterate the half-window until it spans ARC_DEG of arc: halfWin = R*theta/2.
const ARC_DEG = 70;
function fitScaled(i) {
  let half = 30;
  let R = Infinity;
  for (let it = 0; it < 25; it++) {
    const lo = Math.max(0, i - Math.round(half)), hi = Math.min(profile.length - 1, i + Math.round(half));
    if (hi - lo < 10) break;
    const Rn = fitCircle(profile.slice(lo, hi + 1));
    if (!isFinite(Rn)) break;
    const target = Math.max(8, Math.min(120, Rn * (ARC_DEG * Math.PI / 180) / 2));
    if (Math.abs(target - half) < 0.5) { R = Rn; half = target; break; }
    half = half + 0.6 * (target - half);      // damped, or it oscillates
    R = Rn;
  }
  return { R, half };
}

// Corner apexes: local maxima of |kappa| with prominence, so a gentle bend on a
// straight is not promoted to a named corner.
const KAPPA = profile.map((_, i) => kappaAt(i, 12));
const absK = KAPPA.map(Math.abs);
const MIN_K = 1 / 60;          // tighter than R=60 m counts as corner-like
const apexes = [];
for (let i = 20; i < profile.length - 20; i++) {   // start at 20: Quarry apex sits near d=29
  if (absK[i] < MIN_K) continue;
  let isMax = true;
  for (let j = Math.max(0, i - 30); j <= Math.min(absK.length - 1, i + 30); j++) {
    if (absK[j] > absK[i]) { isMax = false; break; }
  }
  if (!isMax) continue;
  let lo = 1e9, hi = 1e9;
  for (let j = Math.max(0, i - 80); j < i; j++) lo = Math.min(lo, absK[j]);
  for (let j = i + 1; j <= Math.min(absK.length - 1, i + 80); j++) hi = Math.min(hi, absK[j]);
  if (Math.max(lo, hi) > absK[i] / 2) continue;         // needs to fall away
  if (apexes.length && i - apexes[apexes.length - 1] < 60) continue;
  apexes.push(i);
}

const NAMES = ['Quarry', 'Farmhouse/Croisdale', 'Orchard', 'Willow', 'Country', "Chippy's"];
const OLD = { Quarry: 35.6, 'Farmhouse/Croisdale': 31.5, Orchard: 23.3, Willow: 37.5, Country: 32.5, "Chippy's": 32.1 };

console.log(`apexes found: ${apexes.length}\n`);
console.log('  corner                  d(m)   R fixed+/-30   R arc-scaled   window   dir     old sim');
const corners = apexes.map((i, k) => {
  const fixed = fitCircle(profile.slice(i - 30, i + 31));
  const { R, half } = fitScaled(i);
  const name = NAMES[k] || `corner ${k + 1}`;
  const dir = KAPPA[i] > 0 ? 'left' : 'right';
  console.log(`  ${name.padEnd(22)} ${String(i).padStart(5)} ${fixed.toFixed(1).padStart(13)} ` +
    `${R.toFixed(1).padStart(14)} ${('+/-' + half.toFixed(0) + 'm').padStart(8)}  ${dir.padEnd(6)} ` +
    `${(OLD[name] ?? 0).toFixed(1).padStart(8)}`);
  return { name, d: i, R: +R.toFixed(2), kappa: +KAPPA[i].toFixed(6), dir,
           fitHalfWindow_m: Math.round(half), ele: profile[i].ele };
});

// per-corner extent: where |kappa| falls below half the apex value
for (const c of corners) {
  let a = c.d, b = c.d;
  const th = Math.abs(KAPPA[c.d]) / 2;
  while (a > 0 && Math.abs(KAPPA[a]) > th) a--;
  while (b < profile.length - 1 && Math.abs(KAPPA[b]) > th) b++;
  c.d0 = a; c.d1 = b;
}
console.log('\n  corner extents (|kappa| above half its apex value):');
corners.forEach(c => console.log(`    ${c.name.padEnd(22)} ${c.d0}-${c.d1} m  (${c.d1 - c.d0} m long)`));

fs.writeFileSync(path.join(__dirname, 'corners.json'), JSON.stringify(corners, null, 1));
fs.writeFileSync(path.join(__dirname, 'curvature.json'), JSON.stringify(KAPPA.map(k => +k.toFixed(6))));
console.log('\nwrote corners.json, curvature.json');
