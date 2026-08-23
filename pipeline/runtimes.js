// Re-time the GPX runs against the CURRENT finish line.
//
// The 82.50-87.43 s figures everything has been compared against were measured
// over the OLD course definition, which ended 23 m early (finish 1066 -> 1089).
// A comparison baseline measured over a shorter course is not a fair target for
// a model that now runs the full one.
const fs = require('fs'), path = require('path');
const { wgs84ToOsgb36 } = require('./osgb');
const src = fs.readFileSync(path.join(__dirname, '..', 'GpxBenchmark.html'), 'utf8');
const course = JSON.parse(fs.readFileSync(path.join(__dirname, 'course.harewood.json'), 'utf8'));

function grab(name) {
  const key = 'const ' + name + ' = [';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('not found: ' + name);
  const start = i + key.length - 1;
  return JSON.parse(src.slice(start, src.indexOf('];', start) + 1));
}

const RUNS = [['13:31','routePoints','originalRunSpeed'], ['09:31','run2Points','run2Speed'],
              ['11:37','run3Points','run3Speed'], ['12:17','run4Points','run4Speed'],
              ['12:49','run5Points','run5Speed']];

// project a position onto a run's polyline -> fractional index
function projectIndex(pts, E, N) {
  let best = { d: Infinity, idx: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1], b = pts[i];
    const dx = b.E - a.E, dy = b.N - a.N, L2 = dx*dx + dy*dy;
    let t = L2 ? ((E - a.E)*dx + (N - a.N)*dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(E - (a.E + t*dx), N - (a.N + t*dy));
    if (d < best.d) best = { d, idx: i - 1 + t };
  }
  return best;
}

const S = course.stations;
const startEN = wgs84ToOsgb36(S.lat[0], S.lon[0]);
const finEN   = wgs84ToOsgb36(S.lat[course.finish_m], S.lon[course.finish_m]);
// the old finish, for comparison
const oldFin = 1066;
const oldEN  = wgs84ToOsgb36(S.lat[oldFin], S.lon[oldFin]);

console.log('Run times measured between positions on the CURRENT course\n');
console.log('  run     t@start   t@old(1066)   t@new(1089)   delta   miss(m)');
const rows = [];
for (const [label, ptsName, spdName] of RUNS) {
  const raw = grab(ptsName), spd = grab(spdName);
  const pts = raw.map(p => wgs84ToOsgb36(p.lat, p.lon));
  const tAt = (frac) => {
    const i = Math.floor(frac), f = frac - i;
    if (!spd[i] || !spd[i+1]) return null;
    return spd[i].t + f * (spd[i+1].t - spd[i].t);
  };
  const s = projectIndex(pts, startEN.E, startEN.N);
  const o = projectIndex(pts, oldEN.E, oldEN.N);
  const n = projectIndex(pts, finEN.E, finEN.N);
  const t0 = tAt(s.idx), tOld = tAt(o.idx), tNew = tAt(n.idx);
  if (t0 === null || tNew === null) { console.log('  ' + label + '  (timestamps unusable)'); continue; }
  const old = tOld - t0, nw = tNew - t0;
  rows.push({ label, old, nw });
  console.log('  ' + label + '  ' + t0.toFixed(1).padStart(7) + '   ' +
    old.toFixed(2).padStart(9) + '   ' + nw.toFixed(2).padStart(11) + '   ' +
    ('+' + (nw - old).toFixed(2)).padStart(6) + '   ' + n.d.toFixed(1).padStart(6));
}
const ok = rows.filter(r => r.label !== '12:17');
const nws = ok.map(r => r.nw).sort((a,b) => a-b);
console.log('\n  excluding 12:17, over the CURRENT course:');
console.log('    range ' + nws[0].toFixed(2) + ' - ' + nws[nws.length-1].toFixed(2) +
            ' s,  mean ' + (nws.reduce((a,b)=>a+b,0)/nws.length).toFixed(2) + ' s');
console.log('\n  previously quoted baseline (old course): 82.50 - 87.43, mean 85.25');
console.log('  model at mu=0.795, unchanged CdA/Crr:    79.98');
console.log('  rider best ever, official light gates:   ~80.x');
