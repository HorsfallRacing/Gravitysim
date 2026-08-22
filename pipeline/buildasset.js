// Emit the frozen course asset: a single track-agnostic COURSE object.
// No run traces. Topology only, with provenance.
const fs = require('fs');
const path = require('path');
const { osgb36ToWgs84, wgs84ToOsgb36 } = require('./osgb');

const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'course_profile.json'), 'utf8'));
const src = fs.readFileSync(path.join(__dirname, '..', 'GpxBenchmark.html'), 'utf8');
const grab = n => JSON.parse(new RegExp(`const ${n} = (\\[.*?\\]);`, 's').exec(src)[1]);

const KAPPA_H = 6;
function kappaAt(i, h) {
  const a = profile[i - h], b = profile[i], c = profile[i + h];
  if (!a || !c) return 0;
  const cross = (b.E - a.E) * (c.N - a.N) - (b.N - a.N) * (c.E - a.E);
  const la = Math.hypot(b.E - a.E, b.N - a.N);
  const lb = Math.hypot(c.E - b.E, c.N - b.N);
  const lc = Math.hypot(c.E - a.E, c.N - a.N);
  return la * lb * lc === 0 ? 0 : 2 * cross / (la * lb * lc);
}
const kappa = profile.map((_, i) => kappaAt(i, KAPPA_H));

// ---- finish line -------------------------------------------------------
// Set by the rider from track knowledge: the finish is at the END OF THE KERB.
// Confirmed independently by detecting the white kerb paint in aerial imagery
// (bright, near-neutral pixels along the road edge), which runs d=1068..1089.
//
// This supersedes the earlier provisional value, which was the old sim's
// FINISH_DISTANCE=1078 remapped geographically. That put the finish 23 m early
// -- it was never checked against anything physical, only carried forward.
const FINISH_OVERRIDE = 1089;

// Legacy remap kept for comparison only.
const run1 = grab('routePoints');
let finishLL = null;
for (let i = 1; i < run1.length; i++) {
  if (run1[i].d >= 1078) {
    const t = (1078 - run1[i - 1].d) / (run1[i].d - run1[i - 1].d);
    finishLL = { lat: run1[i - 1].lat + t * (run1[i].lat - run1[i - 1].lat),
                 lon: run1[i - 1].lon + t * (run1[i].lon - run1[i - 1].lon) };
    break;
  }
}
const finishEN = wgs84ToOsgb36(finishLL.lat, finishLL.lon);
let finishD = 0, bd = Infinity;   // legacy remap, overridden below
profile.forEach((p, i) => {
  const d = Math.hypot(p.E - finishEN.E, p.N - finishEN.N);
  if (d < bd) { bd = d; finishD = i; }
});
console.log(`legacy finish (d=1078 on run 1) would remap to d=${finishD} m` +
            ` (${bd.toFixed(2)} m off the line)`);
if (FINISH_OVERRIDE != null) {
  console.log(`finish set to d=${FINISH_OVERRIDE} m — end of the kerb` +
              ` (${FINISH_OVERRIDE - finishD >= 0 ? '+' : ''}${FINISH_OVERRIDE - finishD} m vs legacy)`);
  finishD = FINISH_OVERRIDE;
}

// ---- corners -----------------------------------------------------------
const NAMES = ['Quarry', 'Farmhouse/Croisdale', 'Orchard', 'Willow', 'Country', "Chippy's"];
const absK = kappa.map(Math.abs);
const apexes = [];
for (let i = 20; i < profile.length - 20; i++) {
  if (absK[i] < 1 / 60) continue;
  let isMax = true;
  for (let j = Math.max(0, i - 30); j <= Math.min(absK.length - 1, i + 30); j++)
    if (absK[j] > absK[i]) { isMax = false; break; }
  if (!isMax) continue;
  let lo = 1e9, hi = 1e9;
  for (let j = Math.max(0, i - 80); j < i; j++) lo = Math.min(lo, absK[j]);
  for (let j = i + 1; j <= Math.min(absK.length - 1, i + 80); j++) hi = Math.min(hi, absK[j]);
  if (Math.max(lo, hi) > absK[i] / 2) continue;
  if (apexes.length && i - apexes[apexes.length - 1] < 60) continue;
  apexes.push(i);
}
const corners = apexes.map((i, k) => {
  const th = absK[i] / 2;
  let a = i, b = i;
  while (a > 0 && absK[a] > th) a--;
  while (b < absK.length - 1 && absK[b] > th) b++;
  return {
    name: NAMES[k] || `corner ${k + 1}`,
    apex_m: i, d0_m: a, d1_m: b,
    radius_m: +(1 / absK[i]).toFixed(1),
    direction: kappa[i] > 0 ? 'left' : 'right',
    ele_m: profile[i].ele,
    beyondFinish: i > finishD,
  };
});

// ---- assemble ----------------------------------------------------------
const ll = profile.map(p => osgb36ToWgs84(p.E, p.N));
const COURSE = {
  schema: 1,
  id: 'harewood-reverse',
  name: 'Harewood Speed Hillclimb',
  variant: 'reverse (top-to-bottom), short of Esses/Clark\'s',
  crs_source: 'EPSG:27700 (OSGB36 British National Grid)',
  length_m: profile.length - 1,
  finish_m: finishD,
  finish_provisional: false,
  start: { lat: +ll[0].lat.toFixed(7), lon: +ll[0].lon.toFixed(7), ele_m: profile[0].ele },
  elevation_drop_to_finish_m: +(profile[0].ele - profile[finishD].ele).toFixed(2),
  station_spacing_m: 1,
  curvature_baseline_m: KAPPA_H,
  stations: {
    lat: ll.map(p => +p.lat.toFixed(7)),
    lon: ll.map(p => +p.lon.toFixed(7)),
    ele: profile.map(p => +p.ele.toFixed(2)),
    kappa: kappa.map(k => +k.toFixed(6)),
  },
  corners,
  provenance: {
    elevation: {
      source: 'Environment Agency LIDAR Composite DTM 1 m',
      licence: 'Open Government Licence',
      accuracy: '+/-15 cm RMSE vertical',
      coverage: '100% of the course box, zero nodata',
      fetched: 'WCS GetCoverage, EPSG:27700, E(433350,433900) N(445350,445950)',
      note: 'Replaces barometric GPX elevation, which was up to 8.8 m in error mid-course.',
    },
    centreline: {
      source: 'mean of 4 GPX runs (13:31, 09:31, 11:37, 12:49); 12:17 excluded — leaves the road between Willow and Country',
      smoothing: 'Savitzky-Golay, half-window 40 stations, order 3',
      why: 'A moving average displaced the line 2.06 m onto the inside kerb at Country and shortened the course by 24 m (~1.9 s).',
      residual_bias: '~0.9 m inward at the tightest corners',
      note: 'This is a driven line averaged over four runs, not a surveyed road centreline.',
    },
    curvature: {
      method: `signed, three-point, +/-${KAPPA_H} m baseline`,
      noise_floor: 'equivalent radius ~530 m on straights',
      note: 'Signed curvature is stored rather than radius: radius diverges and changes sign at inflections, where circle fitting is ill-posed.',
    },
    finish: {
      status: 'set from track knowledge: the finish is at the end of the kerb',
      method: 'rider-specified (end of kerb), corroborated by detecting white kerb paint in aerial imagery at d=1068-1089',
      note: 'Supersedes the earlier provisional value of ~1066 m, which was the old FINISH_DISTANCE remapped and had never been checked against anything physical. It was 23 m early.',
    },
    known_limits: [
      'Corner radii are of the driven line, not the road; both concepts share them, so they largely cancel in a delta.',
      'Tarmac edges are not resolvable from a 1 m DTM; no racing-line model is implied.',
      'Elevation is bare-earth DTM: no camber or crown.',
    ],
  },
};

const out = path.join(__dirname, 'course.harewood.json');
fs.writeFileSync(out, JSON.stringify(COURSE));
console.log(`\nwrote ${path.basename(out)}  ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
console.log(`  length ${COURSE.length_m} m, finish ${COURSE.finish_m} m, drop ${COURSE.elevation_drop_to_finish_m} m`);
console.log('\n  corner              apex   R(m)   dir     extent      past finish?');
corners.forEach(c => console.log(`  ${c.name.padEnd(20)} ${String(c.apex_m).padStart(4)} ` +
  `${c.radius_m.toFixed(1).padStart(6)}  ${c.direction.padEnd(6)} ${(c.d0_m + '-' + c.d1_m).padStart(10)}` +
  `   ${c.beyondFinish ? 'YES' : 'no'}`));
