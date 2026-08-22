// Inject course.harewood.json into Tools.html between the asset markers.
// Keeps Tools.html a directly-editable single file while letting the course be
// regenerated whenever the pipeline improves.
const fs = require('fs'), path = require('path');
const target = path.join(__dirname, '..', 'Tools.html');
const asset = path.join(__dirname, process.argv[2] || 'course.harewood.json');
const json = fs.readFileSync(asset, 'utf8');
let html = fs.readFileSync(target, 'utf8');
const re = /\/\*COURSE_ASSET_START\*\/[\s\S]*?\/\*COURSE_ASSET_END\*\//;
if (!re.test(html)) { console.error('markers not found in Tools.html'); process.exit(1); }
html = html.replace(re, '/*COURSE_ASSET_START*/' + json + '/*COURSE_ASSET_END*/');
fs.writeFileSync(target, html);
console.log(`injected ${path.basename(asset)} (${(json.length/1024).toFixed(1)} KB) into Tools.html`);
console.log(`Tools.html now ${(fs.statSync(target).size/1024).toFixed(1)} KB`);
