// Does corner-cutting cost more than course length? Compare the moving-average
// line against Savitzky-Golay across the WHOLE course, not just at apexes:
// radius everywhere, and the grip-limited speed that radius implies.
const fs = require('fs');
const { wgs84ToOsgb36 } = require('./osgb');
const { savGol } = require('./savgol');

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
const M = 2000, raw = [];
for (let k = 0; k <= M; k++) {
  const ps = tracks.map(t => atFrac(t, k / M));
  raw.push({ E: ps.reduce((a, p) => a + p.E, 0) / ps.length, N: ps.reduce((a, p) => a + p.N, 0) / ps.length });
}
const movAvg = (pts, w) => pts.map((_, i) => {
  let sE = 0, sN = 0, n = 0;
  for (let j = Math.max(0, i - w); j <= Math.min(pts.length - 1, i + w); j++) { sE += pts[j].E; sN += pts[j].N; n++; }
  return { E: sE / n, N: sN / n };
});

// resample a line to 1 m stations
function resample(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].E - line[i - 1].E, line[i].N - line[i - 1].N));
  const total = cum[cum.length - 1], out = [];
  for (let d = 0; d <= Math.floor(total); d++) {
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    out.push({ d, E: line[i - 1].E + t * (line[i].E - line[i - 1].E), N: line[i - 1].N + t * (line[i].N - line[i - 1].N) });
  }
  return out;
}
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
const radProfile = prof => prof.map((_, i) =>
  (i < 25 || i >= prof.length - 25) ? Infinity : fitCircle(prof.slice(i - 25, i + 26)));

const MA = resample(movAvg(raw, 25));
const SG = resample(savGol(raw, 40, 3));
const rMA = radProfile(MA), rSG = radProfile(SG);

const MU = 0.4989, G = 9.81;
const vlim = R => Math.min(120, MU * Math.sqrt(G * R) * 3.6);   // km/h, capped

console.log(`line lengths: moving avg ${MA.length - 1} m   SavGol ${SG.length - 1} m` +
            `   (difference ${SG.length - MA.length} m)\n`);

// compare on a common fraction of length, since the two lines differ in length
console.log('  frac   d_SG   R (SavGol)   R (movAvg)    diff     vlim SG   vlim MA   dv');
let nBound = 0, sumdv = 0, cnt = 0, worst = { dv: 0 };
for (let f = 0.02; f <= 0.98; f += 0.01) {
  const iS = Math.round(f * (SG.length - 1)), iM = Math.round(f * (MA.length - 1));
  const RS = rSG[iS], RM = rMA[iM];
  if (!isFinite(RS) || !isFinite(RM)) continue;
  const vS = vlim(RS), vM = vlim(RM), dv = vM - vS;
  if (RS < 60 || RM < 60) {                       // corner-ish
    nBound++; sumdv += dv; cnt++;
    if (Math.abs(dv) > Math.abs(worst.dv)) worst = { dv, f, RS, RM, d: iS };
    if (Math.round(f * 100) % 4 === 0)
      console.log(`  ${f.toFixed(2)} ${String(iS).padStart(6)} ${RS.toFixed(1).padStart(11)} ` +
        `${RM.toFixed(1).padStart(11)} ${(RM - RS).toFixed(1).padStart(8)} ` +
        `${vS.toFixed(1).padStart(10)} ${vM.toFixed(1).padStart(9)} ${dv.toFixed(1).padStart(6)}`);
  }
}
console.log(`\n  over corner-like sections (R<60 m, n=${cnt}):`);
console.log(`    mean grip-limit difference  ${(sumdv / cnt).toFixed(2)} km/h  (movAvg minus SavGol)`);
console.log(`    largest single difference   ${worst.dv.toFixed(2)} km/h at d~${worst.d} m ` +
            `(R ${worst.RS.toFixed(1)} -> ${worst.RM.toFixed(1)} m)`);

// crude time consequence: extra distance + faster corner limits
const extraDist = (SG.length - 1) - (MA.length - 1);
console.log(`\n  course length understated by ${extraDist} m by the moving average.`);
console.log(`  At ~45 km/h mean that alone is ~${(extraDist / (45 / 3.6)).toFixed(2)} s of run time.`);

// ---- re-do the comparison aligned by GEOGRAPHY, not by fraction ----------
console.log('\n=== aligned by nearest point (removes length-mismatch artefact) ===');
function nearest(prof, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < prof.length; i++) {
    const d = (prof[i].E - p.E) ** 2 + (prof[i].N - p.N) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, dist: Math.sqrt(bd) };
}
let worst2 = { dv: 0 }, sum2 = 0, n2 = 0, maxOff = 0;
const rows = [];
for (let i = 30; i < SG.length - 30; i += 1) {
  const RS = rSG[i];
  if (!isFinite(RS) || RS > 60) continue;
  const m = nearest(MA, SG[i]);
  const RM = rMA[m.i];
  if (!isFinite(RM)) continue;
  maxOff = Math.max(maxOff, m.dist);
  const vS = Math.min(120, MU * Math.sqrt(G * RS) * 3.6);
  const vM = Math.min(120, MU * Math.sqrt(G * RM) * 3.6);
  const dv = vM - vS;
  sum2 += dv; n2++;
  if (Math.abs(dv) > Math.abs(worst2.dv)) worst2 = { dv, d: i, RS, RM, off: m.dist };
  rows.push({ d: i, RS, RM, dv });
}
console.log(`  corner stations compared: ${n2}   max line separation ${maxOff.toFixed(2)} m`);
console.log(`  mean grip-limit difference ${(sum2 / n2).toFixed(2)} km/h (movAvg minus SavGol)`);
console.log(`  largest ${worst2.dv.toFixed(2)} km/h at d=${worst2.d} m ` +
            `(R ${worst2.RS.toFixed(1)} -> ${worst2.RM.toFixed(1)} m, lines ${worst2.off.toFixed(2)} m apart)`);
const over = rows.filter(r => r.dv > 1);
console.log(`  stations where movAvg allows >1 km/h more corner speed: ${over.length} of ${n2}` +
            ` (${(100 * over.length / n2).toFixed(0)}%)`);
console.log('\n  worst 8 stations:');
rows.sort((a, b) => b.dv - a.dv).slice(0, 8).forEach(r =>
  console.log(`    d=${String(r.d).padStart(4)}  R ${r.RS.toFixed(1).padStart(5)} -> ${r.RM.toFixed(1).padStart(6)} m` +
              `   +${r.dv.toFixed(1)} km/h`));
