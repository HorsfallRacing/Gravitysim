// Hypothesis: the barometric elevation LAGS the true elevation, so the error
// is proportional to the rate of descent (speed x gradient), not to distance.
// Test: gap ~= tau * dEle/dt, with a single consistent tau.
const fs = require('fs');
const { wgs84ToOsgb36 } = require('./osgb');
const { readTiff, sample } = require('./readtif');

const src = fs.readFileSync(require('path').join(__dirname,'..','GpxBenchmark.html'), 'utf8');
const grab = name => JSON.parse(new RegExp(`const ${name} = (\\[.*?\\]);`, 's').exec(src)[1]);

const r = readTiff('harewood_dtm.tif');
const RUNS = [
  ['13:31', 'routePoints', 'originalRunSpeed'],
  ['09:31', 'run2Points', 'run2Speed'],
  ['11:37', 'run3Points', 'run3Speed'],
  ['12:17', 'run4Points', 'run4Speed'],
  ['12:49', 'run5Points', 'run5Speed'],
];

console.log('Fitting  gap = tau * dEle/dt  independently per run\n');
console.log('  run     n    tau (s)   r      gap sd before -> after');
console.log('  ------------------------------------------------------');

const allTau = [];
for (const [label, ptsName, spdName] of RUNS) {
  const pts = grab(ptsName), spd = grab(spdName);
  // barometric elevation isn't stored per run; only run 1 has elevationProfile.
  // Instead use each run's own GPS altitude proxy: reconstruct from the shared
  // profile is invalid, so restrict this test to run 1 where we have both.
  if (spdName !== 'originalRunSpeed') continue;

  const prof = grab('elevationProfile');
  const rows = pts.map((p, i) => {
    const { E, N } = wgs84ToOsgb36(p.lat, p.lon);
    return { d: p.d, t: spd[i] ? spd[i].t : null, lidar: sample(r, E, N), baro: prof[i].ele };
  }).filter(x => x.lidar !== null && x.t !== null);

  // dEle/dt from the LIDAR (true) profile, central difference in time
  const samples = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const dt = rows[i + 1].t - rows[i - 1].t;
    if (dt <= 0) continue;
    const dEdt = (rows[i + 1].lidar - rows[i - 1].lidar) / dt;   // negative going down
    samples.push({ d: rows[i].d, gap: rows[i].baro - rows[i].lidar, dEdt });
  }
  // least squares through origin: gap = -tau * dEdt
  const num = samples.reduce((a, s) => a + s.gap * (-s.dEdt), 0);
  const den = samples.reduce((a, s) => a + s.dEdt * s.dEdt, 0);
  const tau = num / den;
  const before = Math.sqrt(samples.reduce((a, s) => a + s.gap ** 2, 0) / samples.length);
  const after = Math.sqrt(samples.reduce((a, s) => a + (s.gap + tau * s.dEdt) ** 2, 0) / samples.length);
  const mg = samples.reduce((a, s) => a + s.gap, 0) / samples.length;
  const mx = samples.reduce((a, s) => a + (-s.dEdt), 0) / samples.length;
  const cov = samples.reduce((a, s) => a + (s.gap - mg) * ((-s.dEdt) - mx), 0);
  const sg = Math.sqrt(samples.reduce((a, s) => a + (s.gap - mg) ** 2, 0));
  const sx = Math.sqrt(samples.reduce((a, s) => a + ((-s.dEdt) - mx) ** 2, 0));
  console.log(`  ${label}  ${String(samples.length).padStart(3)}   ${tau.toFixed(2).padStart(6)}` +
    `   ${(cov / (sg * sx)).toFixed(3)}   ${before.toFixed(2)} -> ${after.toFixed(2)} m`);
  allTau.push(tau);

  console.log('\n   d(m)   speed  dEle/dt   gap    predicted   residual');
  for (const s of samples) {
    if (s.d > 100 && s.d < 280) continue;
    if (s.d > 450 && s.d < 950) continue;
    const pred = -tau * s.dEdt;
    console.log(`  ${s.d.toFixed(0).padStart(5)}  ${''.padStart(5)}  ` +
      `${s.dEdt.toFixed(2).padStart(6)}  ${s.gap.toFixed(2).padStart(6)}  ` +
      `${pred.toFixed(2).padStart(9)}  ${(s.gap - pred).toFixed(2).padStart(8)}`);
  }
}
