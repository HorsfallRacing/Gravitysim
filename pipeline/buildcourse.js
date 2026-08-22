// Build a course centreline from the recorded runs, then take elevation from
// LIDAR along it.
//   - elevation: barometric -> surveyed
//   - line     : mean of four runs, Savitzky-Golay smoothed. SavGol (local
//                polynomial) not a moving average (local constant): a moving
//                average pulls curves inward by ~L^2/(6R), which measured
//                2.06 m at Country and 2.04 m at Chippy's -- enough to put the
//                line on the inside kerb instead of the middle of the road.
const fs = require('fs');
const { wgs84ToOsgb36 } = require('./osgb');
const { readTiff, sample } = require('./readtif');
const { savGol } = require('./savgol');
const { densify } = require('./catmull');

const src = fs.readFileSync(require('path').join(__dirname,'..','GpxBenchmark.html'), 'utf8');
const grab = n => JSON.parse(new RegExp(`const ${n} = (\\[.*?\\]);`, 's').exec(src)[1]);
const r = readTiff('harewood_dtm.tif');

// run4 (12:17) took a visibly different line through the upper section and is
// already EXCLUDED_GEOMETRY_RUN_IDX in the sim. Leave it out of the centreline.
const RUNS = ['routePoints', 'run2Points', 'run3Points', 'run5Points'];

// Project each run to OSGB and re-parameterise by fraction of its own length,
// so runs of differing recorded length can be averaged without distance drift.
// Densify each run with centripetal Catmull-Rom BEFORE averaging. The source
// points are ~15 m apart; joining them with straight lines chords across every
// corner (1.54 m inside the arc at Chippy's R=18 m, measured). Averaging and
// smoothing cannot recover that -- it has to be fixed here, at the source.
const tracks = RUNS.map(name => {
  const sparse = grab(name).map(p => wgs84ToOsgb36(p.lat, p.lon));
  const pts = densify(sparse, 24);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].E - pts[i - 1].E, pts[i].N - pts[i - 1].N));
  const total = cum[cum.length - 1];
  const chord = sparse.reduce((a, p, i) => i ? a + Math.hypot(p.E - sparse[i - 1].E, p.N - sparse[i - 1].N) : 0, 0);
  return { pts, s: cum.map(c => c / total), total, sparseN: sparse.length, chord };
});
console.log('recorded path lengths (OSGB planimetric):');
tracks.forEach((t, i) => console.log(`  ${RUNS[i].padEnd(13)} chord ${t.chord.toFixed(1)} m -> spline ${t.total.toFixed(1)} m  (${t.sparseN} pts)`));
const spread = Math.max(...tracks.map(t => t.total)) - Math.min(...tracks.map(t => t.total));
console.log(`  spread ${spread.toFixed(1)} m\n`);

function atFrac(track, f) {
  const { pts, s } = track;
  if (f <= 0) return pts[0];
  if (f >= 1) return pts[pts.length - 1];
  for (let i = 1; i < s.length; i++) {
    if (s[i] >= f) {
      const t = (f - s[i - 1]) / (s[i] - s[i - 1]);
      return { E: pts[i - 1].E + t * (pts[i].E - pts[i - 1].E), N: pts[i - 1].N + t * (pts[i].N - pts[i - 1].N) };
    }
  }
  return pts[pts.length - 1];
}

// Mean line over 2000 fractional stations
const M = 2000;
let line = [];
for (let k = 0; k <= M; k++) {
  const f = k / M;
  const ps = tracks.map(t => atFrac(t, f));
  line.push({ E: ps.reduce((a, p) => a + p.E, 0) / ps.length, N: ps.reduce((a, p) => a + p.N, 0) / ps.length });
}

const rawLen = line.reduce((a,p,i)=> i ? a+Math.hypot(p.E-line[i-1].E,p.N-line[i-1].N) : 0, 0);
line = savGol(line, 40, 3);
const smLen = line.reduce((a,p,i)=> i ? a+Math.hypot(p.E-line[i-1].E,p.N-line[i-1].N) : 0, 0);
console.log(`centreline length: mean-of-runs ${rawLen.toFixed(1)} m -> SavGol(40,3) ${smLen.toFixed(1)} m`);

// Resample at exact 1 m stations and take elevation from LIDAR
const cum = [0];
for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].E - line[i - 1].E, line[i].N - line[i - 1].N));
const total = cum[cum.length - 1];
const profile = [];
for (let d = 0; d <= Math.floor(total); d++) {
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const E = line[i - 1].E + t * (line[i].E - line[i - 1].E);
  const N = line[i - 1].N + t * (line[i].N - line[i - 1].N);
  profile.push({ d, E, N, ele: sample(r, E, N) });
}
const missing = profile.filter(p => p.ele === null).length;
console.log(`profile: ${profile.length} stations at 1 m, ${missing} without LIDAR cover`);

// Light smoothing of elevation: +/-15cm noise on 1m samples would otherwise
// give a very noisy derivative. 7 m window keeps real gradient features.
const eleS = profile.map((p, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - 7); j <= Math.min(profile.length - 1, i + 7); j++) {
    if (profile[j].ele !== null) { s += profile[j].ele; n++; }
  }
  return n ? s / n : null;
});
profile.forEach((p, i) => p.eleSmooth = eleS[i]);

const FINISH = 1078;
const e0 = profile[0].eleSmooth, eF = profile[Math.min(FINISH, profile.length - 1)].eleSmooth;
console.log(`\nLIDAR drop 0 -> ${FINISH} m : ${e0.toFixed(2)} -> ${eF.toFixed(2)} = ${(e0 - eF).toFixed(2)} m`);
console.log(`(barometric profile gave 66.76 m)`);

// gradient
console.log('\n  d(m)   ele     gradient (LIDAR, 15 m baseline)');
for (let d = 0; d <= 1050; d += 50) {
  const a = profile[Math.max(0, d - 7)], b = profile[Math.min(profile.length - 1, d + 8)];
  const g = (a.eleSmooth - b.eleSmooth) / (b.d - a.d);
  console.log(`  ${String(d).padStart(5)} ${profile[d].eleSmooth.toFixed(2).padStart(7)}   ${(g * 100).toFixed(2).padStart(6)}%`);
}

fs.writeFileSync('course_profile.json', JSON.stringify(
  profile.map(p => ({ d: p.d, E: +p.E.toFixed(2), N: +p.N.toFixed(2), ele: p.eleSmooth === null ? null : +p.eleSmooth.toFixed(3) })), null, 0));
console.log('\nwrote course_profile.json');
