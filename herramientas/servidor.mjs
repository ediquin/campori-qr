// Servidor estatico para probar la app en la computadora.
//
//   node herramientas/servidor.mjs [puerto]
//
// Hace falta porque los modulos de JavaScript no cargan abriendo el archivo con
// doble clic (el navegador lo bloquea por seguridad de origen). Para usar la camara
// desde el celular esto no alcanza: ahi se necesita HTTPS, ver LEEME.md.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.argv[2]) || 8080;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  const pedido = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const destino = path.join(RAIZ, pedido === '/' ? 'index.html' : pedido);

  // Nadie puede pedir archivos fuera de la carpeta del proyecto.
  if (!destino.startsWith(RAIZ)) {
    res.writeHead(403).end('Prohibido');
    return;
  }

  fs.readFile(destino, (err, datos) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('No encontrado: ' + pedido);
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(datos);
  });
}).listen(PUERTO, () => {
  console.log(`Sirviendo ${RAIZ}`);
  console.log(`  http://localhost:${PUERTO}/            (menu)`);
  console.log(`  http://localhost:${PUERTO}/generador.html`);
  console.log(`  http://localhost:${PUERTO}/evaluador.html`);
});
