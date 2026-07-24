// Envio de los puntajes a una planilla de Google Sheets.
//
// Es un EXTRA, no una pieza del circuito. La app sigue funcionando igual sin esto:
// los datos viven en el telefono y el Excel se arma ahi mismo. Esto sirve para que,
// cuando vuelva a haber señal, el resultado quede tambien en una planilla compartida
// sin tener que pasar archivos por WhatsApp.
//
// Del otro lado hay un Google Apps Script publicado como aplicacion web; el codigo
// esta en herramientas/apps-script.gs y las instrucciones en LEEME.md.
//
// La URL publica del Apps Script viene preconfigurada para evitar escribirla en cada
// telefono. La clave sigue guardandose solo EN EL TELEFONO (IndexedDB): es la que
// autoriza realmente a leer y escribir en la planilla.

export const URL_PREDETERMINADA =
  'https://script.google.com/macros/s/AKfycbyOMhY3Fr-UEjJJVQ66UStBJa4ieeOhBnKfJYFD2hsuud9TvF7w1zu4PYs0o1LWyIuM/exec';
const URLS_PREDETERMINADAS_ANTERIORES = new Set([
  'https://script.google.com/macros/s/AKfycby2PyREewpwwiTkPXoceYlAUsH2pzDYbMMtZ3c6EVP0Oc_eE-7-otfUdoeSlgGLVCb0/exec',
  'https://script.google.com/macros/s/AKfycbzEND2XJJ0dKOW6EnG8OIfhTs7cwYNHjGKIp5ub9a1VxnLnNY6sgHn42TjncgXs38JN/exec',
]);

/** Actualiza solamente endpoints oficiales anteriores; respeta URLs personalizadas. */
export function migrarUrlPredeterminada(url = '') {
  const actual = String(url || '').trim();
  return !actual || URLS_PREDETERMINADAS_ANTERIORES.has(actual)
    ? URL_PREDETERMINADA
    : actual;
}

/**
 * Manda las hojas a la planilla.
 * @param {{url: string, clave: string, dispositivo?: string}} destino
 * @param {Array<{nombre: string, filas: Array<Array>}>} hojas
 * @returns {Promise<{ok: boolean, hojas?: string[], error?: string}>}
 */
export async function enviar({ url, clave, dispositivo = '', clubes = '' }, hojas, campori = '') {
  if (!url) return { ok: false, error: 'Falta la dirección del script' };
  if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(url.trim())) {
    return {
      ok: false,
      error: 'La dirección no parece la de un Apps Script publicado. ' +
             'Tiene que empezar con https://script.google.com/ y terminar en /exec',
    };
  }

  const cuerpo = JSON.stringify({
    clave, campori, dispositivo, clubes,
    enviado: new Date().toISOString(),
    hojas,
  });

  try {
    const respuesta = await fetch(url.trim(), {
      method: 'POST',
      // A proposito NO usamos application/json: ese tipo obliga al navegador a pedir
      // permiso antes (preflight), y Apps Script no responde esa consulta. Con texto
      // plano el envio sale directo. Del otro lado igual se parsea como JSON.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: cuerpo,
      redirect: 'follow',   // Apps Script contesta con un redireccion a googleusercontent
    });

    if (!respuesta.ok) {
      return { ok: false, error: `El script respondió ${respuesta.status}. ¿Está publicado para "cualquier usuario"?` };
    }

    const texto = await respuesta.text();
    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      // Si Google devuelve HTML es casi siempre una pantalla de permisos.
      return {
        ok: false,
        error: 'El script devolvió una página de Google en vez de datos. ' +
               'Revisá que al implementarlo hayas puesto "Quién tiene acceso: Cualquier usuario".',
      };
    }
    return datos;
  } catch (e) {
    return {
      ok: false,
      error: `No se pudo conectar (${e.message}). Revisá que haya internet y que la dirección sea la correcta.`,
    };
  }
}

/**
 * Trae de la planilla que sticker uso cada club, segun lo que ya cargaron todos
 * los telefonos.
 *
 * Es lo que permite detectar un sticker despegado de una ficha y pegado en otra
 * cuando esos dos clubes los evaluaron personas distintas. Sin esto cada telefono
 * solo conoce lo suyo y esa trampa pasa sin que nadie se entere.
 *
 * @returns {Promise<{ok: boolean, seriales?: Object, clubes?: number, error?: string}>}
 *          seriales es un objeto {
 *            "AV5-F03-200-0147-K7M2": ["C012", "C053"],
 *            ...
 *          }
 *          Se conservan TODOS los clubes de cada QR. Si hay mas de uno, ninguno
 *          recibe el puntaje hasta que el incidente se resuelva manualmente.
 */
export async function traerSeriales(url, clave) {
  if (!url) return { ok: false, error: 'Falta la dirección del script' };
  try {
    const direccion = new URL(url.trim());
    direccion.searchParams.set('accion', 'seriales');
    direccion.searchParams.set('clave', clave || '');
    const respuesta = await fetch(direccion.toString(), { method: 'GET', redirect: 'follow' });
    const texto = await respuesta.text();
    try {
      return JSON.parse(texto);
    } catch {
      return { ok: false, error: 'El script devolvió una página de Google en vez de datos.' };
    }
  } catch (e) {
    return { ok: false, error: `No se pudo consultar: ${e.message}` };
  }
}

/**
 * Trae el estado completo de la hoja "Detalle de escaneos".
 * Google Sheets pasa a ser la fuente central: si una fila se corrige o se borra
 * manualmente, la siguiente sincronizacion reemplaza la copia del telefono.
 */
export async function traerEstado(url, clave) {
  if (!url) return { ok: false, error: 'Falta la dirección del script' };
  try {
    const direccion = new URL(url.trim());
    direccion.searchParams.set('accion', 'estado');
    direccion.searchParams.set('clave', clave || '');
    const respuesta = await fetch(direccion.toString(), { method: 'GET', redirect: 'follow' });
    const texto = await respuesta.text();
    try {
      return JSON.parse(texto);
    } catch {
      return { ok: false, error: 'El script devolvió una página de Google en vez de datos.' };
    }
  } catch (e) {
    return { ok: false, error: `No se pudo sincronizar: ${e.message}` };
  }
}

/** Limpia y deduplica los escaneos recibidos desde Google Sheets. */
export function normalizarEscaneos(escaneos = []) {
  const unicos = new Map();
  for (const fila of Array.isArray(escaneos) ? escaneos : []) {
    const idClub = String(fila?.idClub || '').trim();
    const crudo = String(fila?.crudo || '').trim().toUpperCase();
    if (!idClub || !crudo) continue;
    const ts = Number(fila?.ts);
    unicos.set(`${idClub}\u0000${crudo}`, {
      idClub,
      crudo,
      ts: Number.isFinite(ts) && ts >= 0 ? ts : 0,
      dispositivo: String(fila?.dispositivo || '').trim(),
    });
  }
  return [...unicos.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Convierte la respuesta de Apps Script a un Map estable.
 * Acepta tambien el formato antiguo, que devolvia un solo club como texto.
 */
export function normalizarSeriales(seriales = {}) {
  const mapa = new Map();
  for (const [codigoQr, valor] of Object.entries(seriales || {})) {
    const clubes = (Array.isArray(valor) ? valor : [valor])
      .map(id => String(id || '').trim())
      .filter(Boolean);
    const unicos = [...new Set(clubes)];
    if (unicos.length) mapa.set(codigoQr, unicos);
  }
  return mapa;
}

/**
 * Para un club concreto, devuelve los stickers que tambien aparecen en al menos
 * otro club. El valor es uno de los otros clubes, para nombrarlo en la alerta.
 */
export function conflictosRemotosParaClub(remotos, idClubActual) {
  const conflictos = new Map();
  for (const [idSticker, valor] of remotos || []) {
    const clubes = Array.isArray(valor) ? valor : [valor];
    const otro = clubes.find(id => id && id !== idClubActual);
    if (otro) conflictos.set(idSticker, otro);
  }
  return conflictos;
}

/** Comprueba que el script esté publicado, sin mandar datos. */
export async function probar(url) {
  if (!url) return { ok: false, error: 'Falta la dirección del script' };
  try {
    const respuesta = await fetch(url.trim(), { method: 'GET', redirect: 'follow' });
    const texto = await respuesta.text();
    try {
      return JSON.parse(texto);
    } catch {
      return {
        ok: false,
        error: 'Respondió, pero con una página de Google en vez de datos. ' +
               'Suele ser que falta poner "Quién tiene acceso: Cualquier usuario".',
      };
    }
  } catch (e) {
    return { ok: false, error: `No se pudo conectar: ${e.message}` };
  }
}
