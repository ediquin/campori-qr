// Servidor estatico para probar la app en la computadora.
//
//   node herramientas/servidor.mjs [puerto] [--subruta=/campori-qr]
//
// Hace falta porque los modulos de JavaScript no cargan abriendo el archivo con
// doble clic (el navegador lo bloquea por seguridad de origen). Para usar la camara
// desde el celular esto no alcanza: ahi se necesita HTTPS, ver LEEME.md.
//
// La opcion --subruta imita a GitHub Pages, que no sirve el sitio en la raiz sino en
// https://usuario.github.io/NOMBRE-DEL-REPO/. Sirve para comprobar antes de publicar
// que ningun enlace quedo apuntando a una ruta absoluta.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argumentos = process.argv.slice(2);
const PUERTO = Number(argumentos.find(a => /^\d+$/.test(a))) || 8080;
// Aceptamos "campori-qr", "/campori-qr" y "/campori-qr/" por igual. Git Bash en
// Windows convierte los argumentos que empiezan con barra en rutas del sistema, asi
// que la forma sin barra suele ser la unica que llega intacta.
const SUBRUTA = (() => {
  const crudo = argumentos.find(a => a.startsWith('--subruta='))?.slice(10) || '';
  const limpio = crudo.replace(/^.*[/\\]([^/\\]+)[/\\]?$/, '$1').replace(/^\/+|\/+$/g, '');
  return limpio ? '/' + limpio : '';
})();

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
  let pedido = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (SUBRUTA) {
    if (pedido === SUBRUTA) {
      // GitHub Pages redirige /repo a /repo/, y esa barra final es la que hace que
      // las rutas relativas resuelvan bien. Si no la imitamos, la prueba miente.
      res.writeHead(301, { location: SUBRUTA + '/' }).end();
      return;
    }
    if (!pedido.startsWith(SUBRUTA + '/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Fuera de la subruta. Probá en http://localhost:${PUERTO}${SUBRUTA}/`);
      return;
    }
    pedido = pedido.slice(SUBRUTA.length);
  }

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
  const base = `http://localhost:${PUERTO}${SUBRUTA}`;
  console.log(`Sirviendo ${RAIZ}`);
  if (SUBRUTA) console.log(`Imitando a GitHub Pages en la subruta ${SUBRUTA}/`);
  console.log(`  ${base}/                  (menu)`);
  console.log(`  ${base}/generador.html`);
  console.log(`  ${base}/evaluador.html`);
  console.log(`  ${base}/kit-prueba.html`);
  console.log(`  ${base}/prueba-camara.html`);
});
