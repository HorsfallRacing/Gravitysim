// Recorded top speed per run. Drag scales with v^2 and so bites hardest at the
// top end, while rolling resistance is a constant force — so the recorded top
// speed discriminates between "CdA is too low" and "Crr is too low" as the
// explanation for the model being ~5 s too fast at mu=0.795.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'GpxBenchmark.html'), 'utf8');

function grab(name) {
  const key = 'const ' + name + ' = [';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('not found: ' + name);
  const start = i + key.length - 1;
  const end = src.indexOf('];', start);
  return JSON.parse(src.slice(start, end + 1));
}

const runs = [['13:31', 'originalRunSpeed'], ['09:31', 'run2Speed'], ['11:37', 'run3Speed'],
              ['12:17', 'run4Speed'], ['12:49', 'run5Speed']];
console.log('Recorded top speed per run (km/h), from the GPX speed traces:');
const maxes = [];
for (const [label, name] of runs) {
  const pts = grab(name).filter(p => isFinite(p.v));
  const mx = Math.max(...pts.map(p => p.v));
  const at = pts.find(p => p.v === mx);
  maxes.push({ label, mx });
  console.log('  ' + label + '  ' + mx.toFixed(1).padStart(5) + '  at d=' + at.d.toFixed(0) + ' m' +
              (label === '12:17' ? '   (run excluded from geometry)' : ''));
}
const excl = maxes.filter(m => m.label !== '12:17').map(m => m.mx).sort((a, b) => a - b);
const med = excl[excl.length >> 1];
console.log('\n  excluding 12:17 -> range ' + excl[0].toFixed(1) + '-' + excl[excl.length - 1].toFixed(1) +
            ', median ' + med.toFixed(1) + ' km/h');

const cands = [
  ['CdA 0.1125, Crr 0.0048  (unchanged)', 75.6, 79.98],
  ['CdA 0.345   (3.07x)', 65.4, 85.25],
  ['Crr 0.0202  (4.21x)', 69.3, 85.38],
];
console.log('\nModel top speed at mu=0.795, vs recorded median ' + med.toFixed(1) + ':');
for (const [label, vmax, lap] of cands) {
  console.log('  ' + label.padEnd(38) + vmax.toFixed(1).padStart(5) + ' km/h   lap ' +
              lap.toFixed(2) + ' s   err ' + (vmax - med >= 0 ? '+' : '') + (vmax - med).toFixed(1));
}
console.log('\nNote: recorded speed is reconstructed by central difference on an');
console.log('inflated distance axis, so it reads a few percent HIGH if anything.');
