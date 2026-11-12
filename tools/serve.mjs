// Kleiner statischer Server für die lokale Entwicklung: node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.bin': 'application/octet-stream', '.png': 'image/png', '.json': 'application/json' };
export function serve(port = 8080) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (p.endsWith(path.sep) || p === '/') p = path.join(p, 'index.html');
      const file = path.join(root, p);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { rsp.writeHead(404); rsp.end('404'); return; }
      rsp.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(rsp);
    }).listen(port, () => res(s));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const port = +(process.argv[2] || 8080); serve(port).then(() => console.log(`http://localhost:${port}`)); }
