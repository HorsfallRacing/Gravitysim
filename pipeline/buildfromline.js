// Rebuild course_profile.json from a road-constrained centreline.
//
// Stage order: buildcourse.js produces a line from the runs (spline-densified,
// SavGol-smoothed). roadsnap (run in the browser -- it needs to decode aerial
// imagery tiles, which Node cannot do without a JPEG decoder) then nudges that
// line so it sits inside the tarmac. This script takes the snapped lat/lon
// back, resamples to exact 1 m stations, and re-samples LIDAR elevation.
//
// Why a snap is needed at all: the line is a mean of four GPS traces. GPS
// error, imagery georeferencing and residual smoothing bias together leave it
// up to ~1.9 m off the road in places -- and the car physically cannot be off
// the road, so that is information the model should use.
const fs = require('fs');
const path = require('path');
const { wgs84ToOsgb36 } = require('./osgb');
const { readTiff, sample } = require('./readtif');
const { savGol } = require('./savgol');

const snapped = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapped_line.json'), 'utf8'));
const r = readTiff(path.join(__dirname, 'harewood_dtm.tif'));

let line = snapped.map(([lat, lon]) => wgs84ToOsgb36(lat, lon));
const lenOf = l => l.reduce((a, p, i) => i ? a + Math.hypot(p.E - l[i - 1].E, p.N - l[i - 1].N) : 0, 0);
console.log(`snapped line in: ${line.length} points, ${lenOf(line).toFixed(1)} m`);

// The snap is applied per station and tapered, but re-smooth lightly so the
// resulting curvature stays clean. A short window: the line is already smooth,
// this only removes any kink the snap introduced.
line = savGol(line, 12, 3);
console.log(`after re-smoothing (SavGol 12,3): ${lenOf(line).toFixed(1)} m`);

// resample to exact 1 m
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

const eleS = profile.map((p, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - 7); j <= Math.min(profile.length - 1, i + 7); j++) {
    if (profile[j].ele !== null) { s += profile[j].ele; n++; }
  }
  return n ? s / n : null;
});
profile.forEach((p, i) => p.eleSmooth = eleS[i]);

console.log(`start elevation ${profile[0].eleSmooth.toFixed(2)} m,` +
            ` end ${profile[profile.length - 1].eleSmooth.toFixed(2)} m`);

fs.writeFileSync(path.join(__dirname, 'course_profile.json'), JSON.stringify(
  profile.map(p => ({ d: p.d, E: +p.E.toFixed(2), N: +p.N.toFixed(2),
                      ele: p.eleSmooth === null ? null : +p.eleSmooth.toFixed(3) })), null, 0));
console.log('wrote course_profile.json');
