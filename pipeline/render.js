// Hillshade the DTM and overlay the GPX tracks, so we can see whether the
// recorded lines actually sit on the road. Pure Node: zlib for PNG deflate.
const fs = require('fs');
const zlib = require('zlib');
const { wgs84ToOsgb36 } = require('./osgb');
const { readTiff, sample } = require('./readtif');

const SCALE = 2;                       // output pixels per metre
const r = readTiff('harewood_dtm.tif');
const W = r.width * SCALE, H = r.height * SCALE;

// ---- hillshade -------------------------------------------------------
const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180, Z = 2.0;
const shade = new Float32Array(r.width * r.height);
for (let y = 1; y < r.height - 1; y++) {
  for (let x = 1; x < r.width - 1; x++) {
    const at = (xx, yy) => r.data[yy * r.width + xx];
    const dzdx = ((at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
                  (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) / 8;
    const dzdy = ((at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
                  (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))) / 8;
    const slope = Math.atan(Z * Math.hypot(dzdx, dzdy));
    const aspect = Math.atan2(dzdy, -dzdx);
    let v = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect);
    shade[y * r.width + x] = Math.max(0, Math.min(1, v));
  }
}

// ---- RGB canvas ------------------------------------------------------
const img = Buffer.alloc(W * H * 3);
let eMin = Infinity, eMax = -Infinity;
for (const v of r.data) { if (v > -1000) { if (v < eMin) eMin = v; if (v > eMax) eMax = v; } }
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = Math.min(r.width - 1, Math.floor(x / SCALE));
    const sy = Math.min(r.height - 1, Math.floor(y / SCALE));
    const h = shade[sy * r.width + sx];
    const e = (r.data[sy * r.width + sx] - eMin) / (eMax - eMin);
    // warm low ground -> cool high ground, modulated by hillshade
    const base = [40 + 200 * e, 70 + 150 * e, 60 + 120 * (1 - e)];
    const o = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) img[o + c] = Math.max(0, Math.min(255, base[c] * (0.35 + 0.75 * h)));
  }
}

// ---- overlay tracks --------------------------------------------------
const src = fs.readFileSync(require('path').join(__dirname,'..','GpxBenchmark.html'), 'utf8');
const grab = n => JSON.parse(new RegExp(`const ${n} = (\\[.*?\\]);`, 's').exec(src)[1]);
const TRACKS = [
  ['routePoints', [255, 60, 60]], ['run2Points', [255, 200, 0]],
  ['run3Points', [80, 255, 120]], ['run4Points', [120, 180, 255]],
  ['run5Points', [255, 120, 255]],
];
function px(E, N) {
  return [(E - r.originE) * SCALE, (r.originN - N) * SCALE];
}
function dot(cx, cy, col, rad) {
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (dx * dx + dy * dy > rad * rad) continue;
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) img[o + c] = col[c];
  }
}
for (const [name, col] of TRACKS) {
  const pts = grab(name).map(p => { const g = wgs84ToOsgb36(p.lat, p.lon); return px(g.E, g.N); });
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= steps; s++) {
      dot(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps, col, 1.2);
    }
  }
}
// start line marker (white)
{
  const p0 = grab('routePoints')[0];
  const g = wgs84ToOsgb36(p0.lat, p0.lon);
  const [x, y] = px(g.E, g.N);
  dot(x, y, [255, 255, 255], 5);
}

// ---- PNG -------------------------------------------------------------
function crc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, cr]);
}
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
fs.writeFileSync('harewood_terrain.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log(`wrote harewood_terrain.png  ${W}x${H}  (${SCALE} px/m)`);
console.log(`elevation range ${eMin.toFixed(1)} - ${eMax.toFixed(1)} m`);
console.log('tracks: red=13:31  yellow=09:31  green=11:37  blue=12:17  magenta=12:49');
