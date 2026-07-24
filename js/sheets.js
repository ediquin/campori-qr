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
// La URL y la clave se guardan EN EL TELEFONO (IndexedDB), nunca en el codigo: este
// repositorio es publico y quien tenga la URL puede escribir en la planilla.

/**
 * Manda las hojas a la planilla.
 * @param {{url: string, clave: string, dispositivo?: string}} destino
 * @param {Array<{nombre: string, filas: Array<Array>}>} hojas
 * @returns {Promise<{ok: boolean, hojas?: string[], error?: string}>}
 */
export async function enviar({ url, clave, dispositivo = '' }, hojas, campori = '') {
  if (!url) return { ok: false, error: 'Falta la dirección del script' };
  if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(url.trim())) {
    return {
      ok: false,
      error: 'La dirección no parece la de un Apps Script publicado. ' +
             'Tiene que empezar con https://script.google.com/ y terminar en /exec',
    };
  }

  const cuerpo = JSON.stringify({ clave, campori, dispositivo, enviado: new Date().toISOString(), hojas });

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
