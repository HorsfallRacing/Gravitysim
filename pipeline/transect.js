// How wide is the road, and can a 1 m DTM even resolve its edges?
// Take perpendicular transects across the driven centreline and look for the
// flat bench: roads are locally planar, verges/banks break slope.
const fs = require('fs');
const { readTiff, sample } = require('./readtif');

const r = readTiff('harewood_dtm.tif');
const profile = JSON.parse(fs.readFileSync('course_profile.json', 'utf8'));

const HALF = 14;        // metres either side
const STEP = 0.25;      // transect sampling

function transect(i) {
  // perpendicular from local heading
  const a = profile[Math.max(0, i - 5)], b = profile[Math.min(profile.length - 1, i + 5)];
  const dx = b.E - a.E, dy = b.N - a.N;
  const L = Math.hypot(dx, dy) || 1;
  const pE = -dy / L, pN = dx / L;      // unit perpendicular
  const c = profile[i];
  const out = [];
  for (let u = -HALF; u <= HALF; u += STEP) {
    out.push({ u, z: sample(r, c.E + pE * u, c.N + pN * u) });
  }
  return out;
}

// Road edge = where the cross-section departs from the plane fitted to the
// central few metres. Walk outward until residual exceeds a threshold.
const THRESH = 0.20;    // m departure from the central plane
function edges(t) {
  const mid = t.filter(p => Math.abs(p.u) <= 1.5 && p.z !== null);
  if (mid.length < 4) return null;
  const n = mid.length;
  const su = mid.reduce((a, p) => a + p.u, 0), sz = mid.reduce((a, p) => a + p.z, 0);
  const suu = mid.reduce((a, p) => a + p.u * p.u, 0), suz = mid.reduce((a, p) => a + p.u * p.z, 0);
  const slope = (n * suz - su * sz) / (n * suu - su * su);
  const inter = (sz - slope * su) / n;
  const pred = u => inter + slope * u;

  let L = null, R = null;
  for (const p of t) {
    if (p.u < 0 || p.z === null) continue;
    if (Math.abs(p.z - pred(p.u)) > THRESH) { R = p.u; break; }
  }
  for (let k = t.length - 1; k >= 0; k--) {
    const p = t[k];
    if (p.u > 0 || p.z === null) continue;
    if (Math.abs(p.z - pred(p.u)) > THRESH) { L = p.u; break; }
  }
  return { left: L, right: R, crossSlope: slope,
           width: (L !== null && R !== null) ? R - L : null };
}

const widths = [];
console.log('  d(m)   left    right   width   cross-slope   what the transect looks like');
for (let i = 0; i < profile.length; i += 1) {
  const e = edges(transect(i));
  if (e && e.width !== null) widths.push({ d: profile[i].d, ...e });
  if (i % 100 === 0 && e) {
    const t = transect(i);
    // crude ascii of the cross-section, relative to centre
    const z0 = t.find(p => p.u === 0)?.z ?? 0;
    let bar = '';
    for (let u = -10; u <= 10; u += 1) {
      const p = t.find(q => Math.abs(q.u - u) < 0.13);
      const dz = p && p.z !== null ? p.z - z0 : null;
      bar += dz === null ? ' ' : Math.abs(dz) < 0.15 ? '_' : dz > 0 ? '/' : '\\';
    }
    console.log(`  ${String(profile[i].d).padStart(5)} ` +
      `${(e.left ?? NaN).toFixed(1).padStart(6)} ${(e.right ?? NaN).toFixed(1).padStart(7)} ` +
      `${(e.width ?? NaN).toFixed(1).padStart(7)} ${(e.crossSlope * 100).toFixed(1).padStart(9)}%   ${bar}`);
  }
}

const w = widths.map(x => x.width).sort((a, b) => a - b);
console.log(`\n  detected road width on ${widths.length}/${profile.length} stations`);
console.log(`  median ${w[Math.floor(w.length / 2)].toFixed(1)} m` +
  `   10th pct ${w[Math.floor(w.length * 0.1)].toFixed(1)} m` +
  `   90th pct ${w[Math.floor(w.length * 0.9)].toFixed(1)} m`);
console.log(`  min ${w[0].toFixed(1)} m   max ${w[w.length - 1].toFixed(1)} m`);

// Where does the driven line sit within the detected corridor?
const off = widths.map(x => (x.left + x.right) / 2);
const mo = off.reduce((a, b) => a + b, 0) / off.length;
console.log(`\n  driven line offset from corridor centre: mean ${mo.toFixed(2)} m,` +
  ` sd ${Math.sqrt(off.reduce((a, b) => a + (b - mo) ** 2, 0) / off.length).toFixed(2)} m`);
console.log(`  (0 = driven line runs down the middle of the detected corridor)`);
