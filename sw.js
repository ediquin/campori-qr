// Service worker: deja la app funcionando sin señal.
//
// En un campamento la conexion va y viene. Con esto, una vez que el celular abrio la
// app por primera vez, sigue abriendola aunque no haya internet.
//
// Estrategia: primero la red, y si falla, la copia guardada. Al reves (copia primero)
// seria mas rapido, pero durante el armado del sistema conviene que cada recarga traiga
// la version nueva sin tener que andar limpiando cache a mano.

const CACHE = 'campori-qr-v8';

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
  './js/qr-tablas.js',
  './js/qr-encoder.js',
  './js/qr-decoder.js',
  './js/generador.js',
  './js/evaluador.js',
  './js/kit-prueba.js',
  './js/escaner.js',
  './js/almacen.js',
  './js/exportar.js',
  './js/sheets.js',
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
