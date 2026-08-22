// Build a standalone Leaflet page showing the smoothed centreline over
// satellite imagery, with the raw driven runs underneath for comparison.
const fs = require('fs');
const { osgb36ToWgs84, wgs84ToOsgb36 } = require('./osgb');

const profile = JSON.parse(fs.readFileSync('course_profile.json', 'utf8'));
const src = fs.readFileSync(require('path').join(__dirname,'..','GpxBenchmark.html'), 'utf8');
const grab = n => JSON.parse(new RegExp(`const ${n} = (\\[.*?\\]);`, 's').exec(src)[1]);

// smoothed centreline back to WGS84
const centre = profile.map(p => {
  const g = osgb36ToWgs84(p.E, p.N);
  return [+g.lat.toFixed(7), +g.lon.toFixed(7), p.d, p.ele];
});

const RUNS = [
  ['13:31', 'routePoints'], ['09:31', 'run2Points'], ['11:37', 'run3Points'],
  ['12:17', 'run4Points'], ['12:49', 'run5Points'],
];
const runs = RUNS.map(([label, name]) => ({
  label, excluded: name === 'run4Points',
  pts: grab(name).map(p => [+p.lat.toFixed(7), +p.lon.toFixed(7)]),
}));

const CORNERS = [
  ['Quarry', 30, 29.5, 'left'], ['Farmhouse/Croisdale', 370, 27.0, 'right'],
  ['Orchard', 541, 20.8, 'left'], ['Willow', 755, 37.0, 'left'],
  ['Country', 859, 25.8, 'right'], ["Chippy's", 1022, 22.2, 'left'],
].map(([name, d, R, dir]) => {
  const p = profile[d];
  const g = osgb36ToWgs84(p.E, p.N);
  return { name, d, R, dir, lat: +g.lat.toFixed(7), lon: +g.lon.toFixed(7), ele: p.ele };
});

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Harewood — smoothed centreline</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body{margin:0;height:100%;background:#111;font:13px/1.4 system-ui,sans-serif;color:#eee}
  #map{height:100%}
  .panel{position:absolute;top:10px;right:10px;z-index:1000;background:rgba(18,18,20,.92);
    padding:12px 14px;border-radius:8px;max-width:250px;box-shadow:0 2px 12px rgba(0,0,0,.5)}
  .panel h3{margin:0 0 8px;font-size:13px;letter-spacing:.02em}
  .key{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px}
  .sw{width:22px;height:0;border-top-width:3px;border-top-style:solid;flex:none}
  table{border-collapse:collapse;margin-top:10px;font-size:11px;width:100%}
  td{padding:2px 4px;border-top:1px solid #333}
  td:nth-child(2),td:nth-child(3){text-align:right;font-variant-numeric:tabular-nums}
  .muted{color:#999;font-size:11px;margin-top:8px}
</style></head><body>
<div id="map"></div>
<div class="panel">
  <h3>Harewood centreline</h3>
  <div class="key"><span class="sw" style="border-color:#00E5FF"></span>smoothed centreline</div>
  <div class="key"><span class="sw" style="border-color:#FF9800;opacity:.75"></span>driven runs (4 used)</div>
  <div class="key"><span class="sw" style="border-color:#F44336;border-top-style:dashed"></span>12:17 (excluded)</div>
  <table><tr><td><b>corner</b></td><td><b>d</b></td><td><b>R</b></td></tr>
  ${CORNERS.map(c => `<tr><td>${c.name}</td><td>${c.d}</td><td>${c.R.toFixed(1)}</td></tr>`).join('')}
  </table>
  <div class="muted">Centreline 1061 m, elevation from EA 1 m LIDAR (±15 cm).</div>
</div>
<script>
const CENTRE = ${JSON.stringify(centre)};
const RUNS = ${JSON.stringify(runs)};
const CORNERS = ${JSON.stringify(CORNERS)};

const map = L.map('map',{zoomControl:true});
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:21,maxNativeZoom:19,attribution:'Esri World Imagery'}).addTo(map);

RUNS.forEach(r=>{
  L.polyline(r.pts,{color:r.excluded?'#F44336':'#FF9800',weight:r.excluded?2:2.5,
    opacity:r.excluded?.85:.6,dashArray:r.excluded?'6,5':null}).addTo(map)
    .bindTooltip(r.label+(r.excluded?' (excluded)':''));
});

const line = CENTRE.map(p=>[p[0],p[1]]);
L.polyline(line,{color:'#000',weight:7,opacity:.5}).addTo(map);
const cl = L.polyline(line,{color:'#00E5FF',weight:3.5,opacity:1}).addTo(map);

CORNERS.forEach(c=>{
  L.circleMarker([c.lat,c.lon],{radius:6,color:'#fff',weight:2,fillColor:'#00E5FF',fillOpacity:1})
    .addTo(map)
    .bindTooltip(c.name+'<br>d='+c.d+' m, R='+c.R.toFixed(1)+' m, '+c.dir+'<br>ele '+c.ele.toFixed(1)+' m',
      {direction:'top'});
});
// start / finish
L.circleMarker([CENTRE[0][0],CENTRE[0][1]],{radius:7,color:'#fff',weight:2,fillColor:'#4CAF50',fillOpacity:1})
  .addTo(map).bindTooltip('Start — '+CENTRE[0][3].toFixed(1)+' m',{permanent:false});
const last=CENTRE[CENTRE.length-1];
L.circleMarker([last[0],last[1]],{radius:7,color:'#fff',weight:2,fillColor:'#E91E63',fillOpacity:1})
  .addTo(map).bindTooltip('End of centreline — d='+last[2]+' m, '+last[3].toFixed(1)+' m');

map.fitBounds(cl.getBounds(),{padding:[40,40]});
</script></body></html>`;

fs.writeFileSync(require('path').join(__dirname,'..','_preview_centreline.html'), html);
console.log('wrote centreline_map.html');
console.log(`centreline ${centre.length} points, start ${centre[0][0]},${centre[0][1]}`);
console.log(`corners: ${CORNERS.map(c => c.name + '@' + c.d).join(', ')}`);
