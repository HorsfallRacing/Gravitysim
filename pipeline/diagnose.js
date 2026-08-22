// Is the LIDAR-vs-GPX elevation gap a barometer problem or a horizontal
// position problem? If horizontal, the GPX elevation should be findable
// nearby, and the gap should track local terrain steepness.
const fs = require('fs');
const { readTiff, sample } = require('./readtif');

const rows = JSON.parse(fs.readFileSync('centreline_compare.json', 'utf8'));
const r = readTiff('harewood_dtm.tif');

// Local terrain slope (magnitude) from the DTM, central difference over 5m
function slopeAt(E, N) {
  const h = 5;
  const e1 = sample(r, E + h, N), e2 = sample(r, E - h, N);
  const n1 = sample(r, E, N + h), n2 = sample(r, E, N - h);
  if ([e1, e2, n1, n2].some(v => v === null)) return null;
  return Math.hypot((e1 - e2) / (2 * h), (n1 - n2) / (2 * h));
}

// Elevation range within a radius, and the closest offset that would reproduce
// the recorded barometric elevation.
function neighbourhood(E, N, target, radius) {
  let min = Infinity, max = -Infinity, bestD = Infinity, bestOff = null;
  for (let dE = -radius; dE <= radius; dE++) {
    for (let dN = -radius; dN <= radius; dN++) {
      const dist = Math.hypot(dE, dN);
      if (dist > radius) continue;
      const v = sample(r, E + dE, N + dN);
      if (v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      if (Math.abs(v - target) < 0.25 && dist < bestD) { bestD = dist; bestOff = [dE, dN]; }
    }
  }
  return { min, max, bestD: bestD === Infinity ? null : bestD, bestOff };
}

console.log('  d(m)   GPX    LIDAR    diff   slope   ele range within 20m   dist to match');
console.log('  ----------------------------------------------------------------------------');
let nMatched = 0, distances = [];
for (const x of rows) {
  if (x.lidar === null) continue;
  const sl = slopeAt(x.E, x.N);
  const nb = neighbourhood(x.E, x.N, x.gpx, 20);
  if (nb.bestD !== null) { nMatched++; distances.push(nb.bestD); }
  if (x.d < 60 || (x.d > 280 && x.d < 420) || x.d > 1000) {
    console.log(
      `  ${x.d.toFixed(0).padStart(5)} ${x.gpx.toFixed(1).padStart(6)} ` +
      `${x.lidar.toFixed(1).padStart(7)} ${(x.lidar - x.gpx).toFixed(1).padStart(7)} ` +
      `${sl === null ? '   -  ' : (sl * 100).toFixed(1).padStart(5) + '%'} ` +
      `${('  ' + nb.min.toFixed(1) + ' - ' + nb.max.toFixed(1)).padStart(20)} ` +
      `${nb.bestD === null ? '      none' : (nb.bestD.toFixed(1) + ' m').padStart(10)}`);
  }
}

const n = rows.filter(x => x.lidar !== null).length;
console.log(`\n  ${nMatched}/${n} points have a LIDAR cell matching the recorded`);
console.log(`  barometric elevation (+/-0.25 m) within 20 m horizontally.`);
if (distances.length) {
  distances.sort((a, b) => a - b);
  const med = distances[Math.floor(distances.length / 2)];
  console.log(`  median horizontal distance to that match: ${med.toFixed(1)} m`);
}

// Correlation between |diff| and local slope
const pts = rows.filter(x => x.lidar !== null)
  .map(x => ({ diff: Math.abs(x.lidar - x.gpx), slope: slopeAt(x.E, x.N) }))
  .filter(x => x.slope !== null);
const mx = pts.reduce((a, p) => a + p.slope, 0) / pts.length;
const my = pts.reduce((a, p) => a + p.diff, 0) / pts.length;
const cov = pts.reduce((a, p) => a + (p.slope - mx) * (p.diff - my), 0);
const vx = Math.sqrt(pts.reduce((a, p) => a + (p.slope - mx) ** 2, 0));
const vy = Math.sqrt(pts.reduce((a, p) => a + (p.diff - my) ** 2, 0));
console.log(`\n  correlation |elevation gap| vs local terrain slope: r = ${(cov / (vx * vy)).toFixed(3)}`);
console.log(`  mean local slope along track: ${(mx * 100).toFixed(1)}%`);
