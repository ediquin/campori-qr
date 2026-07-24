// Guardado local en IndexedDB.
//
// Todo vive primero en el celular: en un campamento no hay señal confiable y una app
// que dependa de internet se cuelga con las fichas en la mano. Cuando hay conexion,
// cada telefono publica sus resultados y consulta los seriales compartidos en Sheets.
//
// Lo unico que se guarda de cada escaneo es el texto crudo del QR y a que club se le
// cargo. El puntaje NO se guarda: se recalcula siempre con js/puntaje.js. Asi, si hay
// que corregir una regla, alcanza con cambiarla y todos los resultados se rehacen solos.

const BASE = 'campori-qr';
const VERSION = 1;

let db = null;

export function abrir() {
  if (db) return Promise.resolve(db);
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(BASE, VERSION);

    pedido.onupgradeneeded = e => {
      const base = e.target.result;
      if (!base.objectStoreNames.contains('escaneos')) {
        // Clave compuesta club+codigo: escanear dos veces el mismo sticker en la
        // misma ficha no crea dos registros, lo rechaza la base.
        const almacen = base.createObjectStore('escaneos', { keyPath: ['idClub', 'crudo'] });
        almacen.createIndex('idClub', 'idClub');
        almacen.createIndex('crudo', 'crudo');
      }
      if (!base.objectStoreNames.contains('fichas')) {
        base.createObjectStore('fichas', { keyPath: 'idClub' });
      }
      if (!base.objectStoreNames.contains('ajustes')) {
        base.createObjectStore('ajustes', { keyPath: 'clave' });
      }
    };

    pedido.onsuccess = () => { db = pedido.result; resolver(db); };
    pedido.onerror = () => rechazar(pedido.error);
  });
}

function transaccion(almacenes, modo) {
  return db.transaction(almacenes, modo);
}

function esperar(pedido) {
  return new Promise((resolver, rechazar) => {
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

// ------------------------------------------------------------------ escaneos

/**
 * Guarda un escaneo. Devuelve 'guardado' o 'duplicado'.
 * 'duplicado' significa que ese mismo QR ya estaba cargado en la ficha de ese club.
 */
export async function agregarEscaneo({ idClub, crudo, ts = Date.now(), dispositivo = '' }) {
  await abrir();
  const t = transaccion(['escaneos'], 'readwrite');
  const almacen = t.objectStore('escaneos');
  try {
    await esperar(almacen.add({ idClub, crudo, ts, dispositivo }));
    return 'guardado';
  } catch (e) {
    if (e?.name === 'ConstraintError') return 'duplicado';
    throw e;
  }
}

export async function escaneosDeClub(idClub) {
  await abrir();
  const almacen = transaccion(['escaneos'], 'readonly').objectStore('escaneos');
  const lista = await esperar(almacen.index('idClub').getAll(idClub));
  return lista.sort((a, b) => a.ts - b.ts);
}

export async function todosLosEscaneos() {
  await abrir();
  const lista = await esperar(transaccion(['escaneos'], 'readonly').objectStore('escaneos').getAll());
  return lista.sort((a, b) => a.ts - b.ts);
}

export async function borrarEscaneo(idClub, crudo) {
  await abrir();
  return esperar(transaccion(['escaneos'], 'readwrite').objectStore('escaneos').delete([idClub, crudo]));
}

export async function borrarClub(idClub) {
  await abrir();
  const t = transaccion(['escaneos', 'fichas'], 'readwrite');
  const almacen = t.objectStore('escaneos');
  const claves = await esperar(almacen.index('idClub').getAllKeys(idClub));
  for (const clave of claves) almacen.delete(clave);
  t.objectStore('fichas').delete(idClub);
  return new Promise((r, rechazar) => { t.oncomplete = r; t.onerror = () => rechazar(t.error); });
}

/**
 * Reemplaza la copia local con el estado de Google Sheets.
 * Los clubes en `preservarClubes` tienen cambios locales pendientes y no se tocan
 * hasta que terminen de enviarse.
 */
export async function reemplazarEscaneos(escaneosRemotos, preservarClubes = new Set()) {
  await abrir();
  const preservados = new Set(preservarClubes || []);
  const actuales = await todosLosEscaneos();
  const conservar = actuales.filter(e => preservados.has(e.idClub));
  const remotos = (escaneosRemotos || []).filter(e => !preservados.has(e.idClub));

  const t = transaccion(['escaneos'], 'readwrite');
  const almacen = t.objectStore('escaneos');
  almacen.clear();
  for (const e of [...conservar, ...remotos]) {
    almacen.put({
      idClub: e.idClub,
      crudo: e.crudo,
      ts: Number(e.ts) || 0,
      dispositivo: e.dispositivo || '',
    });
  }
  return new Promise((r, rechazar) => {
    t.oncomplete = r;
    t.onerror = () => rechazar(t.error);
    t.onabort = () => rechazar(t.error);
  });
}

// ------------------------------------------------------------------ fichas

export async function marcarFicha(idClub, datos) {
  await abrir();
  const almacen = transaccion(['fichas'], 'readwrite').objectStore('fichas');
  const previo = await esperar(almacen.get(idClub)) || { idClub };
  return esperar(almacen.put({ ...previo, ...datos, idClub, actualizada: Date.now() }));
}

export async function fichas() {
  await abrir();
  const lista = await esperar(transaccion(['fichas'], 'readonly').objectStore('fichas').getAll());
  return new Map(lista.map(f => [f.idClub, f]));
}

// ------------------------------------------------------------------ ajustes

export async function guardarAjuste(clave, valor) {
  await abrir();
  return esperar(transaccion(['ajustes'], 'readwrite').objectStore('ajustes').put({ clave, valor }));
}

export async function leerAjuste(clave, porDefecto = null) {
  await abrir();
  const fila = await esperar(transaccion(['ajustes'], 'readonly').objectStore('ajustes').get(clave));
  return fila ? fila.valor : porDefecto;
}

export async function borrarTodo() {
  await abrir();
  const t = transaccion(['escaneos', 'fichas'], 'readwrite');
  t.objectStore('escaneos').clear();
  t.objectStore('fichas').clear();
  return new Promise((r, rechazar) => { t.oncomplete = r; t.onerror = () => rechazar(t.error); });
}
