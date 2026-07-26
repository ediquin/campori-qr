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
  'https://script.google.com/macros/s/AKfycbxb6XecjnQH5mV2gE1vO-9avtspgWLxJTG8Xu-DEW1sr_i4h5swRY9SUASFW-zE2aRs/exec';
const URLS_PREDETERMINADAS_ANTERIORES = new Set([
  'https://script.google.com/macros/s/AKfycbzNc5k6vQBXXjlnaWsu7Mjdu9QlW7z3oDsXLZUUA3cccYXjbAL_ZIZs17MDm5KBkWEA/exec',
  'https://script.google.com/macros/s/AKfycbyOMhY3Fr-UEjJJVQ66UStBJa4ieeOhBnKfJYFD2hsuud9TvF7w1zu4PYs0o1LWyIuM/exec',
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

function revisionPendienteDe(revisiones, idClub) {
  const revision = Number(revisiones?.get(idClub));
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
}

/**
 * Toma una foto de la revisión local de cada club antes de iniciar un envío.
 * Así una respuesta lenta no puede confirmar cambios que se hicieron después.
 */
export function capturarRevisionesPendientes(revisiones = new Map(), idsClub = []) {
  const captura = new Map();
  for (const idClub of new Set(idsClub || [])) {
    if (idClub) captura.set(idClub, revisionPendienteDe(revisiones, idClub));
  }
  return captura;
}

/**
 * Quita de la cola únicamente los clubes que no cambiaron mientras estaban
 * viajando. Si entró otro QR durante el POST, el club completo queda pendiente
 * para un segundo envío y ninguna de sus celdas se pierde.
 */
export function confirmarPendientesAplicados(
  aplicados = [],
  revisionesEnviadas = new Map(),
  revisionesActuales = new Map(),
  pendientes = new Set(),
  eventosPendientes = new Map()
) {
  const confirmados = [];
  const conservados = [];
  for (const idClub of new Set(aplicados || [])) {
    const fueEnviado = revisionesEnviadas.has(idClub);
    const sinCambiosNuevos = fueEnviado
      && revisionPendienteDe(revisionesActuales, idClub)
        === revisionPendienteDe(revisionesEnviadas, idClub);
    if (!sinCambiosNuevos) {
      conservados.push(idClub);
      continue;
    }
    pendientes.delete(idClub);
    eventosPendientes.delete(idClub);
    revisionesActuales.delete(idClub);
    confirmados.push(idClub);
  }
  return { confirmados, conservados };
}

/** Indica si un cambio nuevo quedó esperando mientras otra sincronización corría. */
export function debeReprogramarSincronizacion(versionInicial, versionActual, cantidadPendientes) {
  return Number(cantidadPendientes) > 0
    && Number(versionInicial) !== Number(versionActual);
}

function puntajeNumerico(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

/** Agrega el detalle calculado a una celda por código de evento. */
export function puntajesDesdeDetalle(detalle = [], codigos = []) {
  const valores = Object.fromEntries((codigos || []).map(codigo => [codigo, 0]));
  for (const fila of detalle || []) {
    const codigo = fila?.evento?.codigo;
    if (codigo && Object.prototype.hasOwnProperty.call(valores, codigo)) {
      valores[codigo] += puntajeNumerico(fila.puntos);
    }
  }
  return valores;
}

/** Total que debe producir la fórmula de Sheets a partir de sus celdas de eventos. */
export function totalDesdeEventos(eventos = {}) {
  const bruto = Object.values(eventos || {})
    .reduce((total, valor) => total + puntajeNumerico(valor), 0);
  return Math.max(0, bruto);
}

/**
 * Compara el cálculo reconstruido desde Detalle con las celdas de Puntajes.
 * Devuelve datos suficientes para mostrar y reparar cada diferencia explícitamente.
 */
export function diferenciasDePuntajes(locales = {}, remotos = {}, codigos = null) {
  const lista = codigos == null
    ? [...new Set([...Object.keys(locales || {}), ...Object.keys(remotos || {})])]
    : [...new Set(codigos || [])];
  return lista
    .filter(Boolean)
    .map(codigo => ({
      codigo,
      local: puntajeNumerico(locales?.[codigo]),
      remoto: puntajeNumerico(remotos?.[codigo]),
    }))
    .filter(diferencia => diferencia.local !== diferencia.remoto);
}

/** Evita que una caída completa de Detalle convierta toda la matriz en ceros. */
export function detalleVacioEsDestructivo(cantidadEscaneos, diferencias = []) {
  return Number(cantidadEscaneos) === 0
    && (diferencias || []).some(d => puntajeNumerico(d?.local) === 0
      && puntajeNumerico(d?.remoto) !== 0);
}

/**
 * Protege la copia local si la respuesta perdió todo Detalle.
 * `cantidadLocal` debe excluir los clubes con cambios pendientes, porque esos se
 * conservan deliberadamente mientras el evaluador decide si subirlos o descartarlos.
 */
export function detalleRemotoVacioEsSospechoso(
  cantidadLocal,
  escaneosRemotos = []
) {
  return Number(cantidadLocal) > 0
    && Array.isArray(escaneosRemotos)
    && escaneosRemotos.length === 0;
}

/**
 * Un GET no puede reemplazar clubes que tienen un cambio pendiente ni aquellos
 * cuya escritura local todavía está en curso y aún no llegó a la cola de envío.
 */
export function clubesProtegidosParaLectura(pendientes = new Set(), mutaciones = new Map()) {
  const protegidos = new Set(pendientes || []);
  const idsEnMutacion = mutaciones instanceof Map ? mutaciones.keys() : (mutaciones || []);
  for (const idClub of idsEnMutacion) {
    if (idClub) protegidos.add(idClub);
  }
  return protegidos;
}

/** Normaliza las huellas de Detalle devueltas por la API v3. */
export function normalizarRevisionesDetalle(revisiones = {}) {
  const mapa = new Map();
  const entradas = revisiones instanceof Map
    ? revisiones
    : Array.isArray(revisiones)
      ? revisiones
      : Object.entries(revisiones || {});
  for (const [idCrudo, revisionCruda] of entradas) {
    const idClub = String(idCrudo || '').trim();
    const revision = String(revisionCruda || '').trim();
    if (idClub && revision) mapa.set(idClub, revision);
  }
  return mapa;
}

/**
 * Adopta las huellas nuevas salvo para clubes con trabajo local pendiente.
 *
 * En esos clubes se conserva la huella que sirvió de base al cambio local. Si otro
 * teléfono ya modificó Detalle, el siguiente POST seguirá chocando en vez de poder
 * reintentar con la huella nueva y reemplazar silenciosamente el snapshot ajeno.
 * Cuando todavía no existe una huella local (por ejemplo, una caché previa a API 3),
 * solo se permite tomar la remota si ese club continúa vacío en Detalle. Si ya hay
 * filas remotas, "Subir" se bloquea porque no existe una base segura para reemplazarlas.
 */
export function combinarRevisionesDetalle(
  actuales = new Map(),
  remotas = new Map(),
  protegidos = new Set(),
  clubesConDetalleRemoto = null
) {
  const base = actuales instanceof Map ? actuales : normalizarRevisionesDetalle(actuales);
  const nuevas = remotas instanceof Map ? remotas : normalizarRevisionesDetalle(remotas);
  const resultado = new Map(nuevas);
  const conDetalle = clubesConDetalleRemoto instanceof Set
    ? clubesConDetalleRemoto
    : null;
  for (const idClub of protegidos || []) {
    if (base.has(idClub)) {
      resultado.set(idClub, base.get(idClub));
    } else if (!conDetalle || conDetalle.has(idClub)) {
      // Una caché anterior a API 3 no sabe de qué snapshot partió. Solo puede
      // adoptar la huella actual si ese club sigue vacío en el servidor; con
      // Detalle remoto se bloquea "Subir" y se exige descartar o revisar.
      resultado.delete(idClub);
    }
  }
  return resultado;
}

/** Empaqueta las huellas con su endpoint para poder restaurarlas tras una recarga. */
export function serializarRevisionesDetalle(url = '', revisiones = new Map()) {
  return {
    url: String(url || '').trim(),
    revisiones: [...normalizarRevisionesDetalle(revisiones)],
  };
}

/** Solo restaura huellas si pertenecen al mismo Apps Script/planilla. */
export function restaurarRevisionesDetalle(guardado, urlActual = '') {
  if (!guardado || typeof guardado !== 'object' || Array.isArray(guardado)) return new Map();
  if (String(guardado.url || '').trim() !== String(urlActual || '').trim()) return new Map();
  return normalizarRevisionesDetalle(guardado.revisiones);
}

/**
 * Una respuesta POST aceptada trae la huella exacta que dejó bajo el bloqueo.
 * Debe avanzar aunque haya entrado otro QR durante el viaje: ese segundo cambio
 * tendrá como base el snapshot que el servidor acaba de confirmar.
 */
export function aplicarRevisionesConfirmadas(
  actuales = new Map(),
  confirmadas = new Map(),
  idsAplicados = []
) {
  const resultado = new Map(
    actuales instanceof Map ? actuales : normalizarRevisionesDetalle(actuales)
  );
  const nuevas = confirmadas instanceof Map
    ? confirmadas
    : normalizarRevisionesDetalle(confirmadas);
  for (const idClub of new Set(idsAplicados || [])) {
    if (nuevas.has(idClub)) resultado.set(idClub, nuevas.get(idClub));
  }
  return resultado;
}

/**
 * La matriz sigue siendo la fuente visible, salvo un conflicto de serial demostrado
 * por el propio Detalle compartido. En ese caso se muestra el cálculo seguro (0 o la
 * suma de los stickers válidos) hasta que la matriz se reconcilie.
 */
export function aplicarConflictosDeSerial(remotos = {}, locales = {}, detalle = []) {
  const visibles = { ...(remotos || {}) };
  const codigos = new Set(
    (detalle || [])
      .filter(fila => fila?.estado === 'serial_ajeno' && fila?.evento?.codigo)
      .map(fila => fila.evento.codigo)
  );
  for (const codigo of codigos) {
    visibles[codigo] = puntajeNumerico(locales?.[codigo]);
  }
  return visibles;
}

/**
 * Manda las hojas a la planilla.
 * @param {{url: string, clave: string, dispositivo?: string}} destino
 * @param {Array<{nombre: string, filas: Array<Array>}>} hojas
 * @returns {Promise<{ok: boolean, hojas?: string[], error?: string}>}
 */
export async function enviar(
  { url, clave, dispositivo = '', clubes = '' },
  hojas,
  campori = '',
  { cambios = [], padron = [], eventos = [] } = {}
) {
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
    cambios,
    padron,
    eventos,
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
 * Prepara la matriz de puntajes en el Apps Script. La llamada es idempotente:
 * conserva los valores existentes por ID y código de evento.
 */
export async function preparar(url, clave, padron = [], eventos = []) {
  return enviar(
    { url, clave },
    [],
    '',
    { cambios: [], padron, eventos }
  );
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

/** Catálogo que el Apps Script detectó en las columnas de la hoja Puntajes. */
export function normalizarEventos(eventos = []) {
  const unicos = new Map();
  for (const fila of Array.isArray(eventos) ? eventos : []) {
    const codigo = String(fila?.codigo || '').trim().toUpperCase();
    if (!/^[A-Z][0-9]{2}$/.test(codigo)) continue;
    unicos.set(codigo, {
      codigo,
      nombre: String(fila?.nombre || codigo).trim() || codigo,
      columna: Number(fila?.columna) || 0,
    });
  }
  return [...unicos.values()];
}

/**
 * Normaliza la matriz de puntajes remota a Map<ID, fila>. Cero es un valor real:
 * significa que el club todavía no realizó ese evento.
 */
export function normalizarPuntajes(filas = [], eventos = []) {
  const codigos = new Set(normalizarEventos(eventos).map(e => e.codigo));
  const mapa = new Map();
  for (const fila of Array.isArray(filas) ? filas : []) {
    const idClub = String(fila?.idClub || '').trim();
    if (!idClub) continue;
    const valores = {};
    for (const codigo of codigos) {
      const n = Number(fila?.eventos?.[codigo]);
      valores[codigo] = Number.isFinite(n) ? n : 0;
    }
    mapa.set(idClub, {
      idClub,
      club: String(fila?.club || '').trim(),
      region: String(fila?.region || '').trim(),
      eventos: valores,
      total: Number.isFinite(Number(fila?.total)) ? Number(fila.total) : 0,
      totalConFormula: fila?.totalConFormula === true,
      revision: Number.isFinite(Number(fila?.revision)) ? Number(fila.revision) : 0,
      actualizado: String(fila?.actualizado || ''),
      evaluador: String(fila?.evaluador || ''),
    });
  }
  return mapa;
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
