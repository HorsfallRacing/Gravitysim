// WGS84 lat/lon -> OSGB36 National Grid easting/northing.
// Helmert 7-parameter (accurate to ~5m, ample for tile selection and for
// sampling a 1m DTM; OSTN15 would be needed only for sub-metre work).

const deg = Math.PI / 180;

// Datum shift only: WGS84 geodetic -> Airy 1830 (OSGB36) geodetic.
function wgs84ToAiry(lat, lon, h = 0) {
  // 1. WGS84 geodetic -> ECEF (GRS80 / WGS84 ellipsoid)
  const a1 = 6378137.0, f1 = 1 / 298.257223563;
  const e2_1 = 2 * f1 - f1 * f1;
  const phi = lat * deg, lam = lon * deg;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const sl = Math.sin(lam), cl = Math.cos(lam);
  const nu1 = a1 / Math.sqrt(1 - e2_1 * sp * sp);
  const x1 = (nu1 + h) * cp * cl;
  const y1 = (nu1 + h) * cp * sl;
  const z1 = ((1 - e2_1) * nu1 + h) * sp;

  // 2. Helmert WGS84 -> OSGB36
  const tx = -446.448, ty = 125.157, tz = -542.060;
  const s = 20.4894e-6;
  const rx = -0.1502 / 3600 * deg, ry = -0.2470 / 3600 * deg, rz = -0.8421 / 3600 * deg;
  const x2 = tx + x1 * (1 + s) - y1 * rz + z1 * ry;
  const y2 = ty + x1 * rz + y1 * (1 + s) - z1 * rx;
  const z2 = tz - x1 * ry + y1 * rx + z1 * (1 + s);

  // 3. ECEF -> Airy 1830 geodetic (iterative)
  const a2 = 6377563.396, f2 = 1 / 299.3249646;
  const e2_2 = 2 * f2 - f2 * f2;
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let phi2 = Math.atan2(z2, p * (1 - e2_2)), nu2;
  for (let i = 0; i < 10; i++) {
    nu2 = a2 / Math.sqrt(1 - e2_2 * Math.sin(phi2) ** 2);
    phi2 = Math.atan2(z2 + e2_2 * nu2 * Math.sin(phi2), p);
  }
  const lam2 = Math.atan2(y2, x2);
  return { lat: phi2 / deg, lon: lam2 / deg };
}

// Projection only: Airy 1830 (OSGB36) geodetic -> National Grid E/N.
function airyToGrid(latDeg, lonDeg) {
  const a2 = 6377563.396, f2 = 1 / 299.3249646;
  const e2_2 = 2 * f2 - f2 * f2;
  const phi2 = latDeg * deg, lam2 = lonDeg * deg;
  {
  // 4. Airy 1830 -> National Grid Transverse Mercator
  const F0 = 0.9996012717;
  const phi0 = 49 * deg, lam0 = -2 * deg;
  const N0 = -100000, E0 = 400000;
  const n = (a2 - 6356256.909) / (a2 + 6356256.909); // (a-b)/(a+b), b = a(1-f)
  const b2 = a2 * (1 - f2);
  const nn = (a2 - b2) / (a2 + b2);

  const sp2 = Math.sin(phi2), cp2 = Math.cos(phi2), tp2 = Math.tan(phi2);
  const nu = a2 * F0 / Math.sqrt(1 - e2_2 * sp2 * sp2);
  const rho = a2 * F0 * (1 - e2_2) / Math.pow(1 - e2_2 * sp2 * sp2, 1.5);
  const eta2 = nu / rho - 1;

  const dphi = phi2 - phi0, sphi = phi2 + phi0;
  const M = b2 * F0 * (
    (1 + nn + 1.25 * nn * nn + 1.25 * nn ** 3) * dphi
    - (3 * nn + 3 * nn * nn + 2.625 * nn ** 3) * Math.sin(dphi) * Math.cos(sphi)
    + (1.875 * nn * nn + 1.875 * nn ** 3) * Math.sin(2 * dphi) * Math.cos(2 * sphi)
    - (35 / 24) * nn ** 3 * Math.sin(3 * dphi) * Math.cos(3 * sphi)
  );

  const I = M + N0;
  const II = nu / 2 * sp2 * cp2;
  const III = nu / 24 * sp2 * cp2 ** 3 * (5 - tp2 ** 2 + 9 * eta2);
  const IIIA = nu / 720 * sp2 * cp2 ** 5 * (61 - 58 * tp2 ** 2 + tp2 ** 4);
  const IV = nu * cp2;
  const V = nu / 6 * cp2 ** 3 * (nu / rho - tp2 ** 2);
  const VI = nu / 120 * cp2 ** 5 * (5 - 18 * tp2 ** 2 + tp2 ** 4 + 14 * eta2 - 58 * tp2 ** 2 * eta2);

  const dl = lam2 - lam0;
  const N = I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6;
  const E = E0 + IV * dl + V * dl ** 3 + VI * dl ** 5;
  return { E, N };
  }
}

// Full pipeline: WGS84 lat/lon -> National Grid E/N.
function wgs84ToOsgb36(lat, lon, h = 0) {
  const g = wgs84ToAiry(lat, lon, h);
  return airyToGrid(g.lat, g.lon);
}

// National Grid numeric E/N -> two-letter 100km square + within-square offsets.
// Standard OS lettering: 5x5 blocks of 500km, then 5x5 of 100km, 'I' skipped.
function gridRef(E, N) {
  const e100 = Math.floor(E / 100000), n100 = Math.floor(N / 100000);
  let l1 = (19 - n100) - ((19 - n100) % 5) + Math.floor((e100 + 10) / 5);
  let l2 = ((19 - n100) * 5) % 25 + (e100 % 5);
  if (l1 > 7) l1++;   // skip 'I'
  if (l2 > 7) l2++;
  const square = String.fromCharCode(l1 + 65, l2 + 65);
  return { square, e: E - e100 * 100000, n: N - n100 * 100000 };
}

// ---- inverse: National Grid E/N -> WGS84 lat/lon ----------------------

// National Grid E/N -> Airy 1830 geodetic (iterative meridional arc).
function gridToAiry(E, N) {
  const a = 6377563.396, f = 1 / 299.3249646, b = a * (1 - f);
  const e2 = 2 * f - f * f;
  const F0 = 0.9996012717, phi0 = 49 * deg, lam0 = -2 * deg;
  const N0 = -100000, E0 = 400000;
  const n = (a - b) / (a + b);

  let phi = phi0, M = 0;
  for (let i = 0; i < 20; i++) {
    phi = (N - N0 - M) / (a * F0) + phi;
    const dphi = phi - phi0, sphi = phi + phi0;
    M = b * F0 * (
      (1 + n + 1.25 * n * n + 1.25 * n ** 3) * dphi
      - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dphi) * Math.cos(sphi)
      + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dphi) * Math.cos(2 * sphi)
      - (35 / 24) * n ** 3 * Math.sin(3 * dphi) * Math.cos(3 * sphi));
    if (Math.abs(N - N0 - M) < 1e-5) break;
  }

  const sp = Math.sin(phi), cp = Math.cos(phi), tp = Math.tan(phi);
  const nu = a * F0 / Math.sqrt(1 - e2 * sp * sp);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sp * sp, 1.5);
  const eta2 = nu / rho - 1;
  const t2 = tp * tp, t4 = t2 * t2, t6 = t4 * t2;

  const VII = tp / (2 * rho * nu);
  const VIII = tp / (24 * rho * nu ** 3) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = tp / (720 * rho * nu ** 5) * (61 + 90 * t2 + 45 * t4);
  const X = 1 / (cp * nu);
  const XI = 1 / (cp * 6 * nu ** 3) * (nu / rho + 2 * t2);
  const XII = 1 / (cp * 120 * nu ** 5) * (5 + 28 * t2 + 24 * t4);
  const XIIA = 1 / (cp * 5040 * nu ** 7) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);

  const dE = E - E0;
  const lat = phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lon = lam0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  return { lat: lat / deg, lon: lon / deg };
}

// Airy 1830 geodetic -> WGS84 geodetic (Helmert, reverse sign of the forward).
function airyToWgs84(latDeg, lonDeg, h = 0) {
  const a1 = 6377563.396, f1 = 1 / 299.3249646;
  const e2_1 = 2 * f1 - f1 * f1;
  const phi = latDeg * deg, lam = lonDeg * deg;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const nu1 = a1 / Math.sqrt(1 - e2_1 * sp * sp);
  const x1 = (nu1 + h) * cp * Math.cos(lam);
  const y1 = (nu1 + h) * cp * Math.sin(lam);
  const z1 = ((1 - e2_1) * nu1 + h) * sp;

  const tx = 446.448, ty = -125.157, tz = 542.060;
  const s = -20.4894e-6;
  const rx = 0.1502 / 3600 * deg, ry = 0.2470 / 3600 * deg, rz = 0.8421 / 3600 * deg;
  const x2 = tx + x1 * (1 + s) - y1 * rz + z1 * ry;
  const y2 = ty + x1 * rz + y1 * (1 + s) - z1 * rx;
  const z2 = tz - x1 * ry + y1 * rx + z1 * (1 + s);

  const a2 = 6378137.0, f2 = 1 / 298.257223563;
  const e2_2 = 2 * f2 - f2 * f2;
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let phi2 = Math.atan2(z2, p * (1 - e2_2)), nu2;
  for (let i = 0; i < 10; i++) {
    nu2 = a2 / Math.sqrt(1 - e2_2 * Math.sin(phi2) ** 2);
    phi2 = Math.atan2(z2 + e2_2 * nu2 * Math.sin(phi2), p);
  }
  return { lat: phi2 / deg, lon: Math.atan2(y2, x2) / deg };
}

const osgb36ToWgs84 = (E, N) => { const g = gridToAiry(E, N); return airyToWgs84(g.lat, g.lon); };

module.exports = { wgs84ToOsgb36, wgs84ToAiry, airyToGrid, gridRef,
                   gridToAiry, airyToWgs84, osgb36ToWgs84 };

if (require.main === module) {
  // --- Test 1: projection alone, against the official OS worked example.
  // Caister water tower, OSGB36 lat/lon 52°39'27.2531"N 1°43'04.5177"E
  // -> E 651409.903, N 313177.270 (TG 51409 13177).
  const oLat = 52 + 39 / 60 + 27.2531 / 3600;
  const oLon = 1 + 43 / 60 + 4.5177 / 3600;
  const p = airyToGrid(oLat, oLon);
  const dE = p.E - 651409.903, dN = p.N - 313177.270;
  console.log(`T1 projection : E ${p.E.toFixed(3)} N ${p.N.toFixed(3)}` +
    `  err ${dE.toFixed(3)}m / ${dN.toFixed(3)}m  ${gridRef(p.E, p.N).square}` +
    `  ${Math.hypot(dE, dN) < 0.01 ? 'PASS' : 'FAIL'}`);

  // --- Test 2: datum shift magnitude. WGS84->OSGB36 in the UK is ~70-130m.
  const sh = wgs84ToAiry(53.9037901, -1.486536);
  const shiftM = Math.hypot(
    (sh.lat - 53.9037901) * 111320,
    (sh.lon - (-1.486536)) * 111320 * Math.cos(53.9 * Math.PI / 180));
  console.log(`T2 datum shift: ${shiftM.toFixed(1)}m ` +
    `${shiftM > 50 && shiftM < 150 ? 'PASS (plausible for UK)' : 'FAIL'}`);

  const bbox = {
    latMin: 53.9037675, latMax: 53.9081496,
    lonMin: -1.4931503, lonMax: -1.4862952,
  };
  const corners = [
    ['SW', bbox.latMin, bbox.lonMin], ['NW', bbox.latMax, bbox.lonMin],
    ['SE', bbox.latMin, bbox.lonMax], ['NE', bbox.latMax, bbox.lonMax],
  ];
  console.log('\nCourse bounding box in OSGB36:');
  let Emin = Infinity, Emax = -Infinity, Nmin = Infinity, Nmax = -Infinity;
  for (const [tag, la, lo] of corners) {
    const { E, N } = wgs84ToOsgb36(la, lo);
    Emin = Math.min(Emin, E); Emax = Math.max(Emax, E);
    Nmin = Math.min(Nmin, N); Nmax = Math.max(Nmax, N);
    console.log(` ${tag}  E ${E.toFixed(1)}  N ${N.toFixed(1)}  ${JSON.stringify(gridRef(E, N))}`);
  }
  console.log(`\n extent: E ${Emin.toFixed(0)}-${Emax.toFixed(0)} (${(Emax - Emin).toFixed(0)}m)` +
              `  N ${Nmin.toFixed(0)}-${Nmax.toFixed(0)} (${(Nmax - Nmin).toFixed(0)}m)`);
  const s = gridRef(Emin, Nmin);
  console.log(` 100km square: ${s.square}`);
  console.log(` 10km tile(s): ${s.square}${Math.floor(s.e / 10000)}${Math.floor(s.n / 10000)}`);
  const startEN = wgs84ToOsgb36(53.9037901, -1.486536);
  console.log(`\n start line: E ${startEN.E.toFixed(1)} N ${startEN.N.toFixed(1)}`);
}
