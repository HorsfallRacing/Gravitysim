// Fetch the LIDAR DTM tile for the course from the Environment Agency WCS.
// The .tif is gitignored (4 MB binary) — this fetches it in about a second.
//   node pipeline/fetchdtm.js
const fs = require('fs'), path = require('path'), https = require('https');
const OUT = path.join(__dirname, 'harewood_dtm.tif');
const URL = 'https://environment.data.gov.uk/spatialdata/' +
  'lidar-composite-digital-terrain-model-dtm-1m/wcs' +
  '?service=WCS&version=2.0.1&request=GetCoverage' +
  '&coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m' +
  '&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/27700' +
  '&subset=E(433350,433900)&subset=N(445350,445950)' +
  '&format=image/tiff';
if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
  console.log('already present:', OUT, '(--force to refetch)');
  process.exit(0);
}
console.log('fetching 1 m DTM, E(433350,433900) N(445350,445950) ...');
https.get(URL, r => {
  if (r.statusCode !== 200) { console.error('HTTP ' + r.statusCode); process.exit(1); }
  const chunks = [];
  r.on('data', c => chunks.push(c));
  r.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (buf.slice(0, 2).toString('ascii') !== 'MM' && buf.slice(0, 2).toString('ascii') !== 'II') {
      console.error('not a TIFF — server said:\n' + buf.slice(0, 400).toString('utf8'));
      process.exit(1);
    }
    fs.writeFileSync(OUT, buf);
    console.log(`wrote ${path.basename(OUT)} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
  });
}).on('error', e => { console.error(e.message); process.exit(1); });
