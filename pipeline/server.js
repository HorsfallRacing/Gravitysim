// Tiny static server for the repo, plus a /save/ endpoint the browser-side
// pipeline stage (roadsnap.js) POSTs its output to.
//   node pipeline/server.js     ->  http://localhost:8137/Tools.html
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'pipeline');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/save/')) {
    const name = path.basename(req.url.slice(6));
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const m = /^data:[^;,]+;base64,/.exec(body);
      const data = m ? Buffer.from(body.slice(m[0].length), 'base64') : Buffer.from(body, 'utf8');
      fs.writeFileSync(path.join(OUT, name), data);
      console.log(`saved pipeline/${name} (${Math.round(data.length / 1024)} KB)`);
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/Tools.html';
  const f = path.resolve(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found: ' + p); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8137, () => console.log('serving ' + ROOT + ' on http://localhost:8137'));
