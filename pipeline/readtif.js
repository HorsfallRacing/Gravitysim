// Minimal reader for the uncompressed, single-strip, float32 GeoTIFF that the
// EA WCS returns. Not a general TIFF library — it asserts everything it assumes.
const fs = require('fs');

const TAG = {
  256: 'ImageWidth', 257: 'ImageLength', 258: 'BitsPerSample', 259: 'Compression',
  262: 'Photometric', 273: 'StripOffsets', 277: 'SamplesPerPixel',
  278: 'RowsPerStrip', 279: 'StripByteCounts', 339: 'SampleFormat',
  322: 'TileWidth', 323: 'TileLength', 324: 'TileOffsets', 325: 'TileByteCounts',
  33550: 'ModelPixelScale', 33922: 'ModelTiepoint', 34264: 'ModelTransformation',
  34735: 'GeoKeyDirectory', 42113: 'GDAL_NODATA',
};
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };

function readTiff(path) {
  const buf = fs.readFileSync(path);
  const bom = buf.toString('ascii', 0, 2);
  if (bom !== 'MM' && bom !== 'II') throw new Error('not a TIFF: ' + bom);
  const be = bom === 'MM';
  const u16 = o => be ? buf.readUInt16BE(o) : buf.readUInt16LE(o);
  const u32 = o => be ? buf.readUInt32BE(o) : buf.readUInt32LE(o);
  const f64 = o => be ? buf.readDoubleBE(o) : buf.readDoubleLE(o);
  const f32 = o => be ? buf.readFloatBE(o) : buf.readFloatLE(o);

  if (u16(2) !== 42) throw new Error('not a classic TIFF');
  const ifd = u32(4);
  const n = u16(ifd);
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * count;
    const off = size <= 4 ? e + 8 : u32(e + 8);
    let val;
    if (type === 2) val = buf.toString('ascii', off, off + count).replace(/\0+$/, '');
    else {
      val = [];
      for (let k = 0; k < count; k++) {
        const o = off + k * TYPE_SIZE[type];
        val.push(type === 3 ? u16(o) : type === 4 ? u32(o)
               : type === 12 ? f64(o) : type === 11 ? f32(o) : buf[o]);
      }
      if (count === 1) val = val[0];
    }
    tags[TAG[tag] || tag] = val;
  }

  const width = tags.ImageWidth, height = tags.ImageLength;
  if (tags.Compression !== 1) throw new Error('compressed TIFF unsupported');
  const bps = Array.isArray(tags.BitsPerSample) ? tags.BitsPerSample[0] : tags.BitsPerSample;
  const sf = Array.isArray(tags.SampleFormat) ? tags.SampleFormat[0] : tags.SampleFormat;
  if (bps !== 32 || sf !== 3) throw new Error(`expected float32, got bps=${bps} sampleFormat=${sf}`);

  // Georeferencing. EA's WCS emits ModelTransformation (34264); handle the
  // pixel-scale + tiepoint form too, since other sources use it.
  let sx, sy, originE, originN;
  if (tags.ModelTransformation) {
    const m = tags.ModelTransformation;    // row-major 4x4
    if (m[1] !== 0 || m[4] !== 0) throw new Error('rotated raster unsupported');
    sx = m[0]; sy = -m[5]; originE = m[3]; originN = m[7];
  } else {
    [sx, sy] = tags.ModelPixelScale;
    const tp = tags.ModelTiepoint;         // [i,j,k, E,N,h]
    originE = tp[3] - tp[0] * sx;
    originN = tp[4] + tp[1] * sy;
  }
  const nodata = tags.GDAL_NODATA !== undefined ? parseFloat(tags.GDAL_NODATA) : -9999;

  const data = new Float32Array(width * height);
  if (tags.TileOffsets !== undefined) {
    // Tiled: tiles laid out left-to-right, top-to-bottom, edge tiles padded.
    const tw = tags.TileWidth, th = tags.TileLength;
    const offs = Array.isArray(tags.TileOffsets) ? tags.TileOffsets : [tags.TileOffsets];
    const across = Math.ceil(width / tw);
    for (let t = 0; t < offs.length; t++) {
      const tx0 = (t % across) * tw, ty0 = Math.floor(t / across) * th;
      for (let j = 0; j < th; j++) {
        const y = ty0 + j;
        if (y >= height) break;
        for (let i = 0; i < tw; i++) {
          const x = tx0 + i;
          if (x >= width) continue;
          data[y * width + x] = f32(offs[t] + (j * tw + i) * 4);
        }
      }
    }
  } else {
    const offs = Array.isArray(tags.StripOffsets) ? tags.StripOffsets : [tags.StripOffsets];
    const counts = Array.isArray(tags.StripByteCounts) ? tags.StripByteCounts : [tags.StripByteCounts];
    let p = 0;
    for (let s = 0; s < offs.length; s++) {
      for (let b = 0; b < counts[s]; b += 4) data[p++] = f32(offs[s] + b);
    }
    if (p !== width * height) throw new Error(`pixel count ${p} != ${width * height}`);
  }

  return { width, height, originE, originN, sx, sy, nodata, data, tags };
}

// Bilinear sample at OSGB36 easting/northing. Returns null if any contributing
// cell is nodata or the point falls outside the raster.
function sample(r, E, N) {
  const fx = (E - r.originE) / r.sx - 0.5;      // -0.5 => pixel centres
  const fy = (r.originN - N) / r.sy - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  if (x0 < 0 || y0 < 0 || x0 + 1 >= r.width || y0 + 1 >= r.height) return null;
  const at = (x, y) => {
    const v = r.data[y * r.width + x];
    return (v === r.nodata || !isFinite(v) || v < -1000) ? null : v;
  };
  const v00 = at(x0, y0), v10 = at(x0 + 1, y0), v01 = at(x0, y0 + 1), v11 = at(x0 + 1, y0 + 1);
  if (v00 === null || v10 === null || v01 === null || v11 === null) return null;
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty)
       + v01 * (1 - tx) * ty + v11 * tx * ty;
}

module.exports = { readTiff, sample };

if (require.main === module) {
  const r = readTiff(process.argv[2] || 'harewood_dtm.tif');
  console.log('raster :', r.width, 'x', r.height, ' pixel', r.sx, 'x', r.sy, 'm');
  console.log('origin : E', r.originE, ' N', r.originN, '(top-left corner)');
  console.log('extent : E', r.originE, '-', r.originE + r.width * r.sx,
              ' N', r.originN - r.height * r.sy, '-', r.originN);
  console.log('nodata :', r.nodata);
  let min = Infinity, max = -Infinity, bad = 0;
  for (const v of r.data) {
    if (v === r.nodata || !isFinite(v) || v < -1000) { bad++; continue; }
    if (v < min) min = v; if (v > max) max = v;
  }
  console.log(`values : min ${min.toFixed(2)}m  max ${max.toFixed(2)}m  ` +
              `nodata ${bad}/${r.data.length} (${(100 * bad / r.data.length).toFixed(2)}%)`);
}
