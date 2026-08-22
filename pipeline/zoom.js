// Zoom on a distance range, with a cross-section showing where the recorded
// barometric elevation would put the road versus where the terrain actually is.
const fs = require('fs');
const zlib = require('zlib');
const { wgs84ToOsgb36 } = require('./osgb');
const { readTiff, sample } = require('./readtif');

const D0 = parseFloat(process.argv[2] || 280);
const D1 = parseFloat(process.argv[3] || 430);
const OUT = process.argv[4] || 'zoom.png';
const SCALE = 6;

const r = readTiff('harewood_dtm.tif');
const src = fs.readFileSync(require('path').join(__dirname,'..','GpxBenchmark.html'), 'utf8');
const grab = n => JSON.parse(new RegExp(`const ${n} = (\\[.*?\\]);`, 's').exec(src)[1]);
const routePoints = grab('routePoints');
const prof = grab('elevationProfile');

const seg = routePoints.map((p, i) => ({ ...p, ele: prof[i].ele }))
  .filter(p => p.d >= D0 - 30 && p.d <= D1 + 30)
  .map(p => ({ ...p, ...wgs84ToOsgb36(p.lat, p.lon) }));

let Emin = Infinity, Emax = -Infinity, Nmin = Infinity, Nmax = -Infinity;
for (const p of seg) {
  Emin = Math.min(Emin, p.E); Emax = Math.max(Emax, p.E);
  Nmin = Math.min(Nmin, p.N); Nmax = Math.max(Nmax, p.N);
}
const PAD = 45;
Emin -= PAD; Emax += PAD; Nmin -= PAD; Nmax += PAD;
const W = Math.round((Emax - Emin) * SCALE), H = Math.round((Nmax - Nmin) * SCALE);
const px = (E, N) => [(E - Emin) * SCALE, (Nmax - N) * SCALE];

// hillshade, computed locally at full res
const img = Buffer.alloc(W * H * 3);
const az = 315 * Math.PI / 180, alt = 40 * Math.PI / 180, Z = 3.5;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const E = Emin + x / SCALE, N = Nmax - y / SCALE;
    const c = sample(r, E, N);
    const e1 = sample(r, E + 1.5, N), e2 = sample(r, E - 1.5, N);
    const n1 = sample(r, E, N + 1.5), n2 = sample(r, E, N - 1.5);
    let v = 0.6;
    if (e1 !== null && e2 !== null && n1 !== null && n2 !== null) {
      const dzdx = (e1 - e2) / 3, dzdy = (n1 - n2) / 3;
      const slope = Math.atan(Z * Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      v = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
    }
    const g = Math.max(0, Math.min(255, 255 * (0.25 + 0.85 * v)));
    const o = (y * W + x) * 3;
    img[o] = g; img[o + 1] = g; img[o + 2] = g * 0.97;
  }
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
// GPS track, red
for (let i = 1; i < seg.length; i++) {
  const [x0, y0] = px(seg[i - 1].E, seg[i - 1].N), [x1, y1] = px(seg[i].E, seg[i].N);
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) dot(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps, [255, 40, 40], 2);
}
// Where the recorded barometric elevation matches terrain: cyan contour dots
for (const p of seg) {
  for (let a = 0; a < 360; a += 3) {
    for (let d = 2; d <= 45; d += 1) {
      const E = p.E + d * Math.cos(a * Math.PI / 180), N = p.N + d * Math.sin(a * Math.PI / 180);
      const v = sample(r, E, N);
      if (v !== null && Math.abs(v - p.ele) < 0.15) { const [x, y] = px(E, N); dot(x, y, [0, 220, 255], 1); break; }
    }
  }
}
// PNG out
function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let crc = 0xFFFFFFFF; for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(OUT, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${OUT}  ${W}x${H}  d=${D0}-${D1}  (red = GPS track, cyan = where terrain matches the recorded barometric elevation)`);
