// Re-extract recorded apex speeds at the CURRENT corner apex positions.
//
// Why: the apex speeds used to fit mu were tied to the OLD corner locations,
// which have moved substantially (Chippy's old apex was d=1092.6 on the old
// inflated axis; the new apex is d=1039 — a different physical point, on a
// stretch where the car is decelerating). Dividing a speed measured at one
// place by a radius measured at another is not a measurement of anything.
//
// Method: match GEOGRAPHICALLY, never by distance-along, because the old and
// new distance bases disagree. For each corner apex we project its position
// onto each run's own polyline, then interpolate that run's speed at the
// projected point.
const fs = require('fs');
const path = require('path');
const { wgs84ToOsgb36 } = require('./osgb');

const src = fs.readFileSync(path.join(__dirname, '..', 'GpxBenchmark.html'), 'utf8');
const grab = n => JSON.parse(new RegExp(`const ${n} = (\\[.*?\\]);`, 's').exec(src)[1]);
const course = JSON.parse(fs.readFileSync(path.join(__dirname, 'course.harewood.json'), 'utf8'));

const RUNS = [
  ['13:31', 'routePoints', 'originalRunSpeed'],
  ['09:31', 'run2Points', 'run2Speed'],
  ['11:37', 'run3Points', 'run3Speed'],
  ['12:17', 'run4Points', 'run4Speed'],     // excluded from geometry fitting
  ['12:49', 'run5Points', 'run5Speed'],
];
const EXCLUDED = '12:17';

// Each run: positions in OSGB plus that run's reconstructed speed, index-aligned.
const runs = RUNS.map(([label, ptsName, spdName]) => {
  const pts = grab(ptsName), spd = grab(spdName);
  const n = Math.min(pts.length, spd.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const { E, N } = wgs84ToOsgb36(pts[i].lat, pts[i].lon);
    out.push({ E, N, v: spd[i].v });
  }
  return { label, pts: out };
});

// Project a point onto a polyline; return the interpolated speed and the
// perpendicular miss distance (a sanity check that we matched the right place).
function speedAtPosition(run, E, N) {
  let best = { dist: Infinity, v: null, seg: -1 };
  for (let i = 1; i < run.pts.length; i++) {
    const a = run.pts[i - 1], b = run.pts[i];
    const dx = b.E - a.E, dy = b.N - a.N;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((E - a.E) * dx + (N - a.N) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.E + t * dx, py = a.N + t * dy;
    const d = Math.hypot(E - px, N - py);
    if (d < best.dist) best = { dist: d, v: a.v + t * (b.v - a.v), seg: i, t };
  }
  return best;
}

const G = 9.81;
// Apex speeds previously used to fit mu, tied to the OLD corner positions.
const OLD_APEX = { Quarry: 18.96, 'Farmhouse/Croisdale': 47.48, Orchard: 37.03,
                   Willow: 53.94, Country: 38.05, "Chippy's": 29.94 };

console.log('Recorded speed at the CURRENT apex position, per run (km/h)\n');
console.log('  corner                 ' + runs.map(r => r.label.padStart(7)).join('') +
            '   median   miss(m)   old');
const results = [];
for (const c of course.corners) {
  const E = null;
  // apex position from the asset's lat/lon
  const lat = course.stations.lat[c.apex_m], lon = course.stations.lon[c.apex_m];
  const p = wgs84ToOsgb36(lat, lon);
  const per = runs.map(r => speedAtPosition(r, p.E, p.N));
  const usable = per.filter((x, i) => runs[i].label !== EXCLUDED && x.v !== null);
  const vs = usable.map(x => x.v).sort((a, b) => a - b);
  const median = vs.length % 2 ? vs[vs.length >> 1] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
  const maxMiss = Math.max(...usable.map(x => x.dist));
  console.log('  ' + c.name.padEnd(22) +
    per.map(x => (x.v === null ? '   -  ' : x.v.toFixed(1)).padStart(7)).join('') +
    median.toFixed(1).padStart(9) + maxMiss.toFixed(1).padStart(10) +
    OLD_APEX[c.name].toFixed(1).padStart(7));
  results.push({ name: c.name, apex_m: c.apex_m, radius_m: c.radius_m,
                 vs, median, maxMiss, old: OLD_APEX[c.name] });
}

console.log('\nImplied mu = v^2 / (g*R), using the re-extracted speeds\n');
console.log('  corner                 R(m)   v_new   mu_new   v_old   mu_old    change');
for (const r of results) {
  const muNew = Math.pow(r.median / 3.6, 2) / (G * r.radius_m);
  const muOld = Math.pow(r.old / 3.6, 2) / (G * r.radius_m);
  console.log('  ' + r.name.padEnd(22) + r.radius_m.toFixed(1).padStart(5) +
    r.median.toFixed(1).padStart(8) + muNew.toFixed(3).padStart(9) +
    r.old.toFixed(1).padStart(8) + muOld.toFixed(3).padStart(9) +
    ((muNew - muOld >= 0 ? '+' : '') + (muNew - muOld).toFixed(3)).padStart(10));
  r.muNew = muNew; r.muOld = muOld;
}

// Quarry is acceleration-limited from the standing start, not grip-limited.
const grip = results.filter(r => r.name !== 'Quarry');
const mus = grip.map(r => r.muNew);
const mean = mus.reduce((a, b) => a + b, 0) / mus.length;
const sd = Math.sqrt(mus.reduce((a, b) => a + (b - mean) ** 2, 0) / mus.length);
console.log(`\n  excluding Quarry: mean ${mean.toFixed(3)}  sd ${sd.toFixed(3)}` +
            `  range ${Math.min(...mus).toFixed(3)}-${Math.max(...mus).toFixed(3)}`);
console.log(`  highest observed (the binding lower bound on mu): ${Math.max(...mus).toFixed(3)}` +
            ` at ${grip.find(r => r.muNew === Math.max(...mus)).name}`);

// Per-run spread at each corner tells us how much of the scatter is measurement
console.log('\n  per-corner run-to-run spread in recorded apex speed:');
for (const r of results) {
  console.log(`    ${r.name.padEnd(22)} ${r.vs.map(v => v.toFixed(1)).join(', ')}` +
              `   (spread ${(Math.max(...r.vs) - Math.min(...r.vs)).toFixed(1)} km/h)`);
}
fs.writeFileSync(path.join(__dirname, 'apexspeeds.json'), JSON.stringify(results, null, 1));
console.log('\nwrote apexspeeds.json');
