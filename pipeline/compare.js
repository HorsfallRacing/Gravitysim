// Sample the LIDAR DTM along the GPX centreline and compare with the
// barometric elevation profile the sim currently uses.
const fs = require('fs');
const { wgs84ToOsgb36 } = require('./osgb');
const { readTiff, sample } = require('./readtif');

const HTML = require('path').join(__dirname,'..','GpxBenchmark.html');
const src = fs.readFileSync(HTML, 'utf8');

function grabArray(name) {
  const m = new RegExp(`const ${name} = (\\[.*?\\]);`, 's').exec(src);
  if (!m) throw new Error('could not find ' + name);
  return JSON.parse(m[1]);
}

const routePoints = grabArray('routePoints');
const elevationProfile = grabArray('elevationProfile');
const r = readTiff('harewood_dtm.tif');

console.log(`route points: ${routePoints.length}   elevation profile: ${elevationProfile.length}`);

// GPX elevation at a given distance (linear interp, same basis as the sim)
function gpxEle(d) {
  const p = elevationProfile;
  if (d <= p[0].d) return p[0].ele;
  if (d >= p[p.length - 1].d) return p[p.length - 1].ele;
  for (let i = 1; i < p.length; i++) {
    if (p[i].d >= d) {
      const t = (d - p[i - 1].d) / (p[i].d - p[i - 1].d);
      return p[i - 1].ele + t * (p[i].ele - p[i - 1].ele);
    }
  }
}

const rows = [];
for (const pt of routePoints) {
  const { E, N } = wgs84ToOsgb36(pt.lat, pt.lon);
  const lidar = sample(r, E, N);
  rows.push({ d: pt.d, E, N, lidar, gpx: gpxEle(pt.d) });
}

const ok = rows.filter(x => x.lidar !== null);
console.log(`sampled ${ok.length}/${rows.length} points inside raster\n`);

// --- The headline test -------------------------------------------------
const s = rows[0];
console.log('=== START LINE ===');
console.log(`  OSGB      : E ${s.E.toFixed(1)}  N ${s.N.toFixed(1)}`);
console.log(`  GPX (baro): ${s.gpx.toFixed(2)} m`);
console.log(`  LIDAR     : ${s.lidar.toFixed(2)} m`);
console.log(`  difference: ${(s.lidar - s.gpx).toFixed(2)} m  (LIDAR minus GPX)`);
console.log(`  PROJECT_SUMMARY predicted the settling correction invents +2.31 m,`);
console.log(`  nearly all of it in the first 200 m. Predicted true start ~99.1 m.\n`);

// --- Whole-profile comparison -----------------------------------------
const diffs = ok.map(x => x.lidar - x.gpx);
const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
console.log('=== PROFILE OFFSET (LIDAR - GPX) ===');
console.log(`  mean ${mean.toFixed(2)} m   sd ${sd.toFixed(2)} m` +
            `   min ${Math.min(...diffs).toFixed(2)}   max ${Math.max(...diffs).toFixed(2)}`);

console.log('\n  by 100 m bin:');
console.log('   d(m)   n   GPX ele  LIDAR ele   diff');
for (let b = 0; b < 1200; b += 100) {
  const inBin = ok.filter(x => x.d >= b && x.d < b + 100);
  if (!inBin.length) continue;
  const mg = inBin.reduce((a, x) => a + x.gpx, 0) / inBin.length;
  const ml = inBin.reduce((a, x) => a + x.lidar, 0) / inBin.length;
  console.log(`  ${String(b).padStart(5)} ${String(inBin.length).padStart(3)}` +
    `   ${mg.toFixed(2).padStart(7)}   ${ml.toFixed(2).padStart(8)}   ${(ml - mg).toFixed(2).padStart(6)}`);
}

// --- Total drop and integrated gradient over the raced section --------
const FINISH = 1078;
function eleAt(rows_, d, key) {
  const a = rows_.filter(x => x[key] !== null);
  if (d <= a[0].d) return a[0][key];
  for (let i = 1; i < a.length; i++) {
    if (a[i].d >= d) {
      const t = (d - a[i - 1].d) / (a[i].d - a[i - 1].d);
      return a[i - 1][key] + t * (a[i][key] - a[i - 1][key]);
    }
  }
  return a[a.length - 1][key];
}
console.log('\n=== DROP OVER THE RACED SECTION (d = 0 to 1078 m) ===');
for (const key of ['gpx', 'lidar']) {
  const drop = eleAt(rows, 0, key) - eleAt(rows, FINISH, key);
  console.log(`  ${key.padEnd(6)}: ${eleAt(rows, 0, key).toFixed(2)} -> ` +
              `${eleAt(rows, FINISH, key).toFixed(2)}  =  ${drop.toFixed(2)} m`);
}
console.log('  (PROJECT_SUMMARY: raw GPX profile drop 66.76 m;');
console.log('   settling-corrected integrated gradient 69.21 m)');

fs.writeFileSync('centreline_compare.json', JSON.stringify(rows, null, 1));
console.log('\nwrote centreline_compare.json');
