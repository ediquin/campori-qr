// Service worker: deja la app funcionando sin señal.
//
// En un campamento la conexion va y viene. Con esto, una vez que el celular abrio la
// app por primera vez, sigue abriendola aunque no haya internet.
//
// Estrategia: primero la red, y si falla, la copia guardada. Al reves (copia primero)
// seria mas rapido, pero durante el armado del sistema conviene que cada recarga traiga
// la version nueva sin tener que andar limpiando cache a mano.

const CACHE = 'campori-qr-v27';

const ARCHIVOS = [
  './',
  './index.html',
  './generador.html',
  './evaluador.html',
  './prueba-camara.html',
  './kit-prueba.html',
  './manifest.webmanifest',
  './icono.svg',
  './css/estilo.css',
  './css/impresos.css',
  './js/catalogo.js',
  './js/clubes.js',
  './js/codigo.js',
  './js/puntaje.js',
  './js/galois.js',
  './js/identificador.js',
  './js/qr-tablas.js',
  './js/qr-encoder.js',
  './js/qr-encoder.js?v=2',
  './js/qr-decoder.js',
  './js/qr-decoder.js?v=2',
  './js/generador.js',
  './js/generador.js?v=5',
  './js/generador.js?v=6',
  './js/generador.js?v=7',
  './js/generador.js?v=8',
  './js/generador.js?v=9',
  './js/pdf-stickers.js',
  './js/pdf-stickers.js?v=2',
  './js/pdf-stickers.js?v=3',
  './js/pdf-stickers.js?v=4',
  './js/evaluador.js',
  './js/evaluador.js?v=8',
  './js/evaluador.js?v=9',
  './js/evaluador.js?v=10',
  './js/evaluador.js?v=11',
  './js/kit-prueba.js',
  './js/kit-prueba.js?v=7',
  './js/escaner.js',
  './js/escaner.js?v=5',
  './js/almacen.js',
  './js/exportar.js',
  './js/sheets.js',
  './js/sheets.js?v=2',
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    // addAll falla entero si un archivo no esta; los agregamos de a uno para que
    // un descuido en la lista no deje la app sin nada guardado.
    caches.open(CACHE)
      .then(cache => Promise.all(ARCHIVOS.map(a => cache.add(a).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(c => c !== CACHE).map(c => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || !pedido.url.startsWith(self.location.origin)) return;

  evento.respondWith(
    fetch(pedido)
      .then(respuesta => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then(c => c.put(pedido, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(pedido).then(guardada => guardada || caches.match('./index.html')))
  );
});
