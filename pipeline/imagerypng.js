// PNG AERIAL IMAGERY IN NODE — feasibility probe / decoder foundation.
//
// Finding (2026-08-23): the Esri World Imagery *tile* endpoint
//   .../World_Imagery/MapServer/tile/{z}/{y}/{x}
// always returns image/jpeg, which Node cannot decode without a dependency.
// BUT the same MapServer exposes an `export` operation which honours a
// `format` parameter and will return image/png:
//   .../World_Imagery/MapServer/export?bbox=..&bboxSR=3857&size=W,H
//        &imageSR=3857&format=png32&f=image
// PNG is deflate + per-scanline filters, both of which Node can do with the
// built-in zlib module and ~60 lines of un-filtering. So a headless port of
// roadsnap.js is feasible with NO npm dependencies.
//
// Bonus: export takes an arbitrary bbox and output size, so the whole course
// comes back as ONE image on a pixel grid we choose -- no tile stitching, no
// tile-boundary bookkeeping, and the ground sample distance is an explicit
// input rather than a consequence of the zoom level.
//
// Run: node imagerypng.js     (prints a decode report; writes nothing)

const zlib = require('zlib');

// ---- Web Mercator helpers (EPSG:3857) ----
const R = 6378137;
const lon2mx = lo => lo * Math.PI/180 * R;
const lat2my = la => Math.log(Math.tan(Math.PI/4 + la*Math.PI/360)) * R;
const mx2lon = x => x/R * 180/Math.PI;
const my2lat = y => (2*Math.atan(Math.exp(y/R)) - Math.PI/2) * 180/Math.PI;

// ---- minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced ----
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG (bad signature)');
  let p = 8, ihdr = null, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p+4, p+8);
    const data = buf.subarray(p+8, p+8+len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4),
      depth: data[8], colorType: data[9], compression: data[10], filter: data[11], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.depth !== 8) throw new Error('unsupported bit depth ' + ihdr.depth);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported');
  const CH = { 0:1, 2:3, 4:2, 6:4 }[ihdr.colorType];
  if (!CH) throw new Error('unsupported colour type ' + ihdr.colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: W, height: H } = ihdr, stride = W*CH;
  const out = Buffer.alloc(stride*H);
  let q = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[q++], line = raw.subarray(q, q+stride); q += stride;
    const cur = out.subarray(y*stride, (y+1)*stride), prev = y ? out.subarray((y-1)*stride, y*stride) : null;
    for (let i = 0; i < stride; i++) {
      const x = line[i], a = i >= CH ? cur[i-CH] : 0, b = prev ? prev[i] : 0, c = (prev && i >= CH) ? prev[i-CH] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pa = Math.abs(b-c), pb = Math.abs(a-c), pc = Math.abs(a+b-2*c);
                  v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('bad filter type ' + ft + ' on row ' + y);
      }
      cur[i] = v & 255;
    }
  }
  return { width: W, height: H, channels: CH, data: out, ihdr };
}

// ---- fetch one export image covering a lat/lon box at a chosen metres/pixel ----
async function fetchImagery({ north, south, west, east, mpp = 0.25 }) {
  const x0 = lon2mx(west), x1 = lon2mx(east), y0 = lat2my(south), y1 = lat2my(north);
  // Web Mercator metres are inflated by 1/cos(lat); correct so mpp is true ground metres.
  const k = 1 / Math.cos((north+south)/2 * Math.PI/180);
  const W = Math.round((x1-x0) / (mpp*k)), H = Math.round((y1-y0) / (mpp*k));
  const url = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export'
    + `?bbox=${x0},${y0},${x1},${y1}&bboxSR=3857&imageSR=3857&size=${W},${H}&format=png32&f=image`;
  const res = await fetch(url);
  const ct = res.headers.get('content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  return { url, ct, buf, W, H, mercBox: { x0, x1, y0, y1 } };
}

if (require.main === module) (async () => {
  const c = require('./course.harewood.json'), S = c.stations, PAD = 0.0006;
  const north = Math.max(...S.lat)+PAD, south = Math.min(...S.lat)-PAD;
  const west  = Math.min(...S.lon)-PAD, east  = Math.max(...S.lon)+PAD;

  console.log('--- control: what does the TILE endpoint serve? ---');
  const t = await fetch('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/42350/64970');
  console.log('  tile content-type :', t.headers.get('content-type'));

  console.log('--- export endpoint, whole course in one request ---');
  const r = await fetchImagery({ north, south, west, east, mpp: 0.25 });
  console.log('  requested size    :', r.W + ' x ' + r.H + ' px @ 0.25 m/px');
  console.log('  content-type      :', r.ct);
  console.log('  bytes             :', r.buf.length);
  const t0 = Date.now();
  const im = decodePNG(r.buf);
  console.log('  decoded           :', im.width + ' x ' + im.height,
              'colourType=' + im.ihdr.colorType, 'depth=' + im.ihdr.depth,
              'ch=' + im.channels, 'in ' + (Date.now()-t0) + ' ms');

  // sanity: is it real imagery, or a blank/error placeholder?
  const d = im.data, CH = im.channels;
  let sum = 0, sq = 0, n = 0;
  for (let i = 0; i < d.length; i += CH*97) { const v = (d[i]+d[i+1]+d[i+2])/3; sum += v; sq += v*v; n++; }
  const mean = sum/n, sd = Math.sqrt(sq/n - mean*mean);
  console.log('  pixel mean/stdev  :', mean.toFixed(1), '/', sd.toFixed(1),
              sd > 8 ? '(real imagery, not a blank tile)' : '(SUSPICIOUS: looks flat)');

  // sample the colour at the start line, which is known to be on tarmac
  const k = 1/Math.cos((north+south)/2*Math.PI/180);
  const px = (la,lo) => [ (lon2mx(lo)-r.mercBox.x0)/((r.mercBox.x1-r.mercBox.x0)/im.width),
                          (r.mercBox.y1-lat2my(la))/((r.mercBox.y1-r.mercBox.y0)/im.height) ];
  const at = (la,lo) => { const [x,y] = px(la,lo); const i = ((y|0)*im.width + (x|0))*CH; return [d[i],d[i+1],d[i+2]]; };
  console.log('  RGB at start line :', at(S.lat[0], S.lon[0]));
  console.log('  RGB at d=500      :', at(S.lat[500], S.lon[500]));
  console.log('  ground metres/px  :', (((r.mercBox.x1-r.mercBox.x0)/k)/im.width).toFixed(4));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

module.exports = { decodePNG, fetchImagery, lon2mx, lat2my, mx2lon, my2lat };
