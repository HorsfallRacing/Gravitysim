// ROAD SNAP — constrain the centreline to the tarmac.
//
// HOW TO RUN: this stage needs to decode aerial imagery tiles, which Node
// cannot do without a JPEG decoder. Serve the repo, open Tools.html, and paste
// this whole file into the browser console. It POSTs snapped_line.json back to
// the dev server (see pipeline/README in PIPELINE_NOTES.md), after which:
//     node buildfromline.js && node buildasset.js && node injectcourse.js
//
// WHY: the centreline is a mean of four GPS traces. GPS error, imagery
// georeferencing and residual smoothing bias together left it up to 5.5 m off
// the road in places -- and the car physically cannot leave the tarmac, so the
// road edge is real information the line should respect.
//
// LIMITS, and they matter:
//  - Tarmac is classified from colour (low saturation, low greenness, not dark).
//    Under tree canopy this FAILS: shaded road is lit by light filtered through
//    leaves and reads greener than sunlit grass. Those stations are detected via
//    a transect-brightness test and left untouched rather than guessed at.
//  - Adjacent tarmac (the farmyard near Orchard) can be mistaken for the course.
//    Guarded by a plausible-width filter and a median filter along the course.
//  - Result on Harewood: off-road stations in good light 145 -> 22, worst
//    excursion 5.5 m -> 1.75 m, and Chippy's apex moved onto the road.
(async () => {
  const Z = 19, TS = 256, S = COURSE.stations, L = COURSE.length_m;
  const lat2py = la => (1 - Math.log(Math.tan(la*Math.PI/180) + 1/Math.cos(la*Math.PI/180))/Math.PI)/2 * 2**Z * TS;
  const lon2px = lo => (lo + 180)/360 * 2**Z * TS;
  const PAD = 0.0006;
  const n = Math.max(...S.lat)+PAD, s = Math.min(...S.lat)-PAD;
  const w = Math.min(...S.lon)-PAD, e = Math.max(...S.lon)+PAD;
  const x0 = Math.floor(lon2px(w)/TS), x1 = Math.floor(lon2px(e)/TS);
  const y0 = Math.floor(lat2py(n)/TS), y1 = Math.floor(lat2py(s)/TS);
  const cv = document.createElement('canvas');
  cv.width = (x1-x0+1)*TS; cv.height = (y1-y0+1)*TS;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const ox = x0*TS, oy = y0*TS, jobs = [];
  for (let i = 0; i <= x1-x0; i++) for (let j = 0; j <= y1-y0; j++) jobs.push(new Promise(r => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { ctx.drawImage(im, i*TS, j*TS); r(); }; im.onerror = r;
    im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y0+j}/${x0+i}`;
  }));
  await Promise.all(jobs);
  const img = ctx.getImageData(0,0,cv.width,cv.height).data, W = cv.width;
  const mpp = 156543.03392 * Math.cos(S.lat[0]*Math.PI/180) / 2**Z;
  const px = (la,lo) => [lon2px(lo)-ox, lat2py(la)-oy];
  const rgb = (x,y) => { const i = ((y|0)*W + (x|0))*4; return [img[i],img[i+1],img[i+2]]; };
  const tarmac = (x,y) => { const [r,g,b] = rgb(x,y); const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    return (mx ? (mx-mn)/mx : 0) < 0.30 && g-(r+b)/2 < 18 && (r+g+b)/3 > 55; };
  const perp = d => { const a = Math.max(0,d-4), b = Math.min(L,d+4);
    const p1 = px(S.lat[a],S.lon[a]), p2 = px(S.lat[b],S.lon[b]);
    const dx = p2[0]-p1[0], dy = p2[1]-p1[1], M = Math.hypot(dx,dy)||1; return [-dy/M, dx/M]; };
  const lit = d => { const c = px(S.lat[d],S.lon[d]), [ux,uy] = perp(d); let t=0,k=0;
    for (let u=-10; u<=10; u+=0.5) { const [r,g,b] = rgb(c[0]+ux*u/mpp, c[1]+uy*u/mpp); t += (r+g+b)/3; k++; }
    return t/k; };
  const band = d => {
    const c = px(S.lat[d],S.lon[d]), [ux,uy] = perp(d), hits = [];
    for (let u=-16; u<=16; u+=0.25) hits.push({u, t: tarmac(c[0]+ux*u/mpp, c[1]+uy*u/mpp)});
    const runs = []; let st = null;
    hits.forEach((h,i) => { if (h.t && st===null) st = h.u;
      if ((!h.t || i===hits.length-1) && st!==null) { runs.push([st, hits[i-1]?hits[i-1].u:h.u]); st = null; } });
    let best = null, bd = 1e9;
    for (const r of runs) { if (r[1]-r[0] < 2) continue;
      const dist = (0>=r[0] && 0<=r[1]) ? 0 : Math.min(Math.abs(r[0]), Math.abs(r[1]));
      if (dist < bd) { bd = dist; best = r; } }
    return best ? {lo:best[0], hi:best[1], width:best[1]-best[0], offRoad:bd} : null;
  };
  const raw = [];
  for (let d = 0; d <= L; d++) { const b = band(d), lt = lit(d);
    raw.push((b && lt >= 75 && b.width >= 3.5 && b.width <= 14) ? b : null); }
  const med = a => { const q = a.slice().sort((x,y)=>x-y); return q[q.length>>1]; };
  const LO = [], HI = [];
  for (let d = 0; d <= L; d++) { const win = [];
    for (let j = Math.max(0,d-12); j <= Math.min(L,d+12); j++) if (raw[j]) win.push(raw[j]);
    if (win.length < 6) { LO.push(null); HI.push(null); continue; }
    LO.push(med(win.map(b=>b.lo))); HI.push(med(win.map(b=>b.hi))); }
  const MARGIN = 2.0, MAXSNAP = 6, corr = new Float64Array(L+1);
  let nOff = 0, worst = 0;
  for (let d = 0; d <= L; d++) {
    if (LO[d] === null) continue;
    const a = LO[d]+MARGIN, b = HI[d]-MARGIN; if (a >= b) continue;
    let c = 0; if (0 < a) c = a; else if (0 > b) c = b;
    if (c !== 0) { nOff++; worst = Math.max(worst, Math.abs(c)); }
    corr[d] = Math.max(-MAXSNAP, Math.min(MAXSNAP, c));
  }
  const sm = new Float64Array(L+1), WIN = 20;      // taper, or the snap kinks the line
  for (let i = 0; i <= L; i++) { let t=0,k=0;
    for (let j = Math.max(0,i-WIN); j <= Math.min(L,i+WIN); j++) { const q = 1-Math.abs(j-i)/(WIN+1); t += corr[j]*q; k += q; }
    sm[i] = k ? t/k : 0; }
  const n2 = 2**Z * TS, out = [];
  for (let d = 0; d <= L; d++) {
    const c = px(S.lat[d],S.lon[d]), [ux,uy] = perp(d);
    const gx = c[0]+ox+ux*sm[d]/mpp, gy = c[1]+oy+uy*sm[d]/mpp;
    out.push([+(Math.atan(Math.sinh(Math.PI*(1-2*gy/n2)))*180/Math.PI).toFixed(8),
              +(gx/n2*360-180).toFixed(8)]);
  }
  await fetch('/save/snapped_line.json', { method:'POST', body: JSON.stringify(out) });
  const nz = [...sm].filter(x => Math.abs(x) > 0.01).map(Math.abs);
  console.log('roadsnap:', { confidentStations: LO.filter(x=>x!==null).length, total: L+1,
    needingMove: nOff, worstNeeded: +worst.toFixed(2),
    applied: { n: nz.length, max: +Math.max(...nz).toFixed(2) } });
  console.log('wrote snapped_line.json — now run: node buildfromline.js && node buildasset.js && node injectcourse.js');
})();
