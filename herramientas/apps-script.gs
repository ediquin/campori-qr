/**
 * Backend de Google Sheets para el evaluador del Campori.
 *
 * MODELO DE DATOS
 * - "Puntajes": una fila por club y una columna por evento. Es la fuente de verdad
 *   de los puntajes que muestra la app.
 * - "Detalle de escaneos": auditoría de los QR y control de stickers repetidos.
 * - "Alertas", "Parámetros" y "Envíos": apoyo operativo.
 *
 * CONCURRENCIA
 * Cada teléfono envía únicamente las celdas de evento que cambió. Bajo un bloqueo
 * global se compara el valor anterior de esas celdas y recién entonces se escribe.
 * Dos teléfonos pueden cambiar clubes distintos sin pisarse. La matriz también
 * protege eventos distintos del mismo club por celda, pero "Detalle de escaneos"
 * se reemplaza como una fotografía completa del club: operativamente se debe usar
 * un solo teléfono por club. Si ambos cambian la misma celda desde un valor viejo,
 * el segundo recibe un conflicto y debe refrescar antes de reintentar.
 */

const VERSION_API = 3;
const CLAVE = 'cambiame-por-una-frase-tuya';
const HOJA_PUNTAJES = 'Puntajes';
const HOJA_DETALLE = 'Detalle de escaneos';

function doPost(peticion) {
  try {
    const datos = JSON.parse(peticion.postData.contents);
    if (datos.clave !== CLAVE) return responder({ ok: false, version: VERSION_API, error: 'Clave incorrecta' });

    const hojas = Array.isArray(datos.hojas) ? datos.hojas : [];
    const cambios = Array.isArray(datos.cambios) ? datos.cambios : [];
    const padron = Array.isArray(datos.padron) ? datos.padron : [];
    const eventos = Array.isArray(datos.eventos) ? datos.eventos : [];
    if (!hojas.length && !cambios.length && (!padron.length || !eventos.length)) {
      return responder({ ok: false, version: VERSION_API, error: 'No vinieron datos para actualizar' });
    }

    const cerrojo = LockService.getScriptLock();
    if (!cerrojo.tryLock(30000)) {
      return responder({
        ok: false,
        version: VERSION_API,
        error: 'Otro teléfono está guardando en este momento. Probá de nuevo en unos segundos.',
      });
    }

    try {
      const libro = SpreadsheetApp.getActiveSpreadsheet();
      const hojaPuntajes = libro.getSheetByName(HOJA_PUNTAJES);
      const esPreparacionExplicita = !hojas.length && !cambios.length;
      if (padron.length && eventos.length
          && (esPreparacionExplicita || !esMatrizPuntajes(hojaPuntajes))) {
        asegurarMatrizPuntajes(libro, padron, eventos);
      }
      if (esPreparacionExplicita) asegurarHojaDetalle(libro);

      // La API 3 exige que cada cliente demuestre qué fotografía de Detalle leyó.
      // Un teléfono con la app antigua se rechaza de forma segura hasta que recargue.
      const cambiosCompatibles = cambios.filter(function (cambio) {
        return cambio && Object.prototype.hasOwnProperty.call(cambio, 'revisionDetalle');
      });
      const conflictosVersion = cambios
        .filter(function (cambio) {
          return !cambio || !Object.prototype.hasOwnProperty.call(cambio, 'revisionDetalle');
        })
        .map(function (cambio) {
          return {
            idClub: String(cambio && cambio.idClub || '').trim(),
            codigo: 'DETALLE',
            error: 'La aplicación del teléfono es anterior a la API 3; recargala antes de enviar',
          };
        });
      const conflictosHojasSinRevision = conflictosDeHojasSinCambioSeguro(
        hojas,
        cambiosCompatibles,
        conflictosVersion
      );
      const resultadoCambios = cambiosCompatibles.length
        ? aplicarCambiosPuntajes(libro, cambiosCompatibles, datos.dispositivo || '')
        : { aplicados: [], conflictos: [] };
      resultadoCambios.conflictos = conflictosVersion
        .concat(conflictosHojasSinRevision, resultadoCambios.conflictos);
      // Si una celda entró en conflicto, tampoco reemplazamos el snapshot auxiliar
      // de ese club. De otro modo podríamos conservar la matriz nueva pero borrar
      // del Detalle los QR que produjo otro teléfono.
      // El filtro se aplica SIEMPRE: un cliente anterior que mande solamente hojas
      // no puede saltarse la huella de API 3 ni vaciar Detalle.
      const hojasAplicables = limitarHojasAClubes(hojas, resultadoCambios.aplicados);
      const resumen = procesarHojasAuxiliares(libro, hojasAplicables);
      // Se devuelve la huella EXACTA que dejó este POST todavía bajo el bloqueo.
      // Si entró otro QR local mientras viajaba el envío, el cliente puede usarla
      // como base del siguiente snapshot sin adoptar a ciegas un GET posterior.
      const revisionesDetalleAplicadas = {};
      if (resultadoCambios.aplicados.length) {
        const detallePosterior = leerDetalle(libro);
        const revisionVaciaPosterior = huellaCodigosDetalle([]);
        resultadoCambios.aplicados.forEach(function (idCrudo) {
          const id = String(idCrudo || '').trim();
          if (!id) return;
          revisionesDetalleAplicadas[id] =
            Object.prototype.hasOwnProperty.call(detallePosterior.revisionesDetalle, id)
              ? detallePosterior.revisionesDetalle[id]
              : revisionVaciaPosterior;
        });
      }

      registrarEnvio(libro, datos, resumen, resultadoCambios);
      const hayConflictos = resultadoCambios.conflictos.length > 0;
      return responder({
        ok: !hayConflictos,
        version: VERSION_API,
        aplicados: resultadoCambios.aplicados,
        conflictos: resultadoCambios.conflictos,
        revisionesDetalle: revisionesDetalleAplicadas,
        hojas: resumen,
        error: hayConflictos
          ? 'Hay cambios más recientes en Google Sheets. Se conservaron y tenés que refrescar antes de reintentar.'
          : undefined,
      });
    } finally {
      cerrojo.releaseLock();
    }
  } catch (error) {
    return responder({ ok: false, version: VERSION_API, error: String(error) });
  }
}

/**
 * Crea o migra la matriz sin cambiar ningún ID existente. Los valores se conservan
 * por combinación ID + código de evento, aunque cambie el nombre visible del evento.
 */
function asegurarMatrizPuntajes(libro, padronRecibido, catalogoRecibido) {
  let hoja = libro.getSheetByName(HOJA_PUNTAJES);
  if (!hoja) hoja = libro.insertSheet(HOJA_PUNTAJES);

  const catalogo = [];
  const codigosVistos = {};
  catalogoRecibido.forEach(function (evento) {
    const codigo = String(evento && evento.codigo || '').trim().toUpperCase();
    if (!/^[A-Z][0-9]{2}$/.test(codigo) || codigosVistos[codigo]) return;
    codigosVistos[codigo] = true;
    catalogo.push({ codigo: codigo, nombre: String(evento.nombre || codigo).trim() || codigo });
  });
  if (!catalogo.length) throw new Error('El catálogo no contiene códigos de evento válidos');

  const padron = [];
  const idsVistos = {};
  padronRecibido.forEach(function (club) {
    const id = String(club && (club.id || club.idClub) || '').trim();
    if (!id || id === 'C999' || idsVistos[id]) return;
    idsVistos[id] = true;
    padron.push({
      id: id,
      nombre: String(club.nombre || club.club || '').trim(),
      region: String(club.region || '').trim(),
    });
  });
  if (!padron.length) throw new Error('El padrón no contiene clubes válidos');

  const anteriores = hoja.getLastRow() > 0 && hoja.getLastColumn() > 0
    ? hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues()
    : [];
  const encabezadoAnterior = anteriores.length ? anteriores[0].map(String) : [];
  const columnasAnteriores = indicesPorCodigo(encabezadoAnterior);
  const colIdAnterior = indiceEncabezado(encabezadoAnterior, 'id');
  const porId = {};
  if (colIdAnterior >= 0) {
    anteriores.slice(1).forEach(function (fila) {
      const id = String(fila[colIdAnterior] || '').trim();
      if (id) porId[id] = fila;
    });
  }

  // No se eliminan filas desconocidas: si organización agregó un club directamente
  // en la hoja, se lo conserva al final hasta que el padrón de la app sea actualizado.
  Object.keys(porId).forEach(function (id) {
    if (id === 'C999' || idsVistos[id]) return;
    const fila = porId[id];
    padron.push({
      id: id,
      nombre: String(fila[indiceEncabezado(encabezadoAnterior, 'club')] || '').trim(),
      region: String(fila[indiceEncabezado(encabezadoAnterior, 'region')] || '').trim(),
    });
    idsVistos[id] = true;
  });

  const encabezado = ['ID', 'Club', 'Región']
    .concat(catalogo.map(function (e) { return e.codigo + ' · ' + e.nombre; }))
    .concat(['TOTAL', 'Revisión', 'Actualizado', 'Evaluador']);
  const colTotal = 3 + catalogo.length;
  const colRevision = colTotal + 1;
  const colActualizado = colTotal + 2;
  const colEvaluador = colTotal + 3;

  const filas = padron.map(function (club) {
    const previa = porId[club.id] || [];
    const eventos = catalogo.map(function (e) {
      const col = columnasAnteriores[e.codigo];
      return col == null ? 0 : numero(previa[col]);
    });
    const revisionAnterior = indiceEncabezado(encabezadoAnterior, 'revision');
    const actualizadoAnterior = indiceEncabezado(encabezadoAnterior, 'actualizado');
    const evaluadorAnterior = indiceEncabezado(encabezadoAnterior, 'evaluador');
    return [club.id, club.nombre, club.region]
      .concat(eventos)
      .concat([
        0,
        revisionAnterior >= 0 ? numero(previa[revisionAnterior]) : 0,
        actualizadoAnterior >= 0 ? previa[actualizadoAnterior] || '' : '',
        evaluadorAnterior >= 0 ? previa[evaluadorAnterior] || '' : '',
      ]);
  });

  hoja.clearContents();
  hoja.getRange(1, 1, 1, encabezado.length).setValues([encabezado]);
  if (filas.length) {
    hoja.getRange(2, 1, filas.length, encabezado.length).setValues(filas);
    const formulas = filas.map(function () { return ['=MAX(0,SUM(RC4:RC[-1]))']; });
    hoja.getRange(2, colTotal + 1, filas.length, 1).setFormulasR1C1(formulas);
    hoja.getRange(2, 4, filas.length, catalogo.length + 2).setNumberFormat('0');
  }

  const cabecera = hoja.getRange(1, 1, 1, encabezado.length);
  cabecera.setFontWeight('bold').setFontColor('#ffffff').setBackground('#243447');
  catalogo.forEach(function (evento, i) {
    const color = evento.codigo.charAt(0) === 'F' ? '#1d6f42'
      : evento.codigo.charAt(0) === 'E' ? '#2457a6'
      : evento.codigo.charAt(0) === 'S' ? '#a61b1b'
      : '#7a4e00';
    hoja.getRange(1, 4 + i).setBackground(color);
  });
  hoja.setFrozenRows(1);
  hoja.setFrozenColumns(3);
  hoja.setColumnWidth(1, 65);
  hoja.setColumnWidth(2, 210);
  hoja.setColumnWidth(3, 100);
  if (catalogo.length) hoja.setColumnWidths(4, catalogo.length, 115);
  hoja.setColumnWidth(colTotal + 1, 85);
  hoja.setColumnWidths(colRevision + 1, 3, 125);
  const filtro = hoja.getFilter();
  if (filtro) filtro.remove();
  if (filas.length) hoja.getRange(1, 1, filas.length + 1, encabezado.length).createFilter();
}

/** Crea únicamente el encabezado de auditoría cuando la planilla todavía es nueva. */
function asegurarHojaDetalle(libro) {
  if (libro.getSheetByName(HOJA_DETALLE)) return;
  const hoja = libro.insertSheet(HOJA_DETALLE);
  escribir(hoja, [
    'ID', 'Club', 'Región', 'Orden', 'Código', 'Evento', 'Tipo', 'Estado',
    'Puntos', 'Motivo', 'Evaluador', 'Fecha y hora', 'Código QR', 'Marca de tiempo',
  ], []);
}

/**
 * Aplica parches de celdas, no filas completas. `anteriores` implementa control
 * optimista: solo hay conflicto si cambió la misma celda que el teléfono quiere tocar.
 */
function aplicarCambiosPuntajes(libro, cambios, dispositivo) {
  const hoja = libro.getSheetByName(HOJA_PUNTAJES);
  if (!hoja || hoja.getLastRow() < 2) {
    throw new Error('La hoja Puntajes todavía no está preparada');
  }

  const valores = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues();
  const encabezado = valores[0].map(String);
  const colId = indiceEncabezado(encabezado, 'id');
  const colTotal = indiceEncabezado(encabezado, 'total');
  const colRevision = indiceEncabezado(encabezado, 'revision');
  const colActualizado = indiceEncabezado(encabezado, 'actualizado');
  const colEvaluador = indiceEncabezado(encabezado, 'evaluador');
  const columnasEvento = indicesPorCodigo(encabezado);
  if (colId < 0 || colTotal < 0) throw new Error('La hoja Puntajes no tiene las columnas ID y TOTAL');

  const filaPorId = {};
  for (let i = 1; i < valores.length; i++) {
    const id = String(valores[i][colId] || '').trim();
    if (id) filaPorId[id] = i;
  }

  const requiereRevisionDetalle = cambios.some(function (cambio) {
    return cambio && Object.prototype.hasOwnProperty.call(cambio, 'revisionDetalle');
  });
  const detalleActual = requiereRevisionDetalle ? leerDetalle(libro) : null;
  const revisionesDetalle = detalleActual && detalleActual.revisionesDetalle || {};
  const revisionVacia = huellaCodigosDetalle([]);

  const aplicados = [];
  const conflictos = [];
  cambios.forEach(function (cambio) {
    const id = String(cambio && cambio.idClub || '').trim();
    const indiceFila = filaPorId[id];
    if (indiceFila == null) {
      conflictos.push({ idClub: id, error: 'El club no existe en la hoja Puntajes' });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(cambio, 'revisionDetalle')) {
      if (!detalleActual.disponible) {
        conflictos.push({
          idClub: id,
          codigo: 'DETALLE',
          error: 'La hoja Detalle de escaneos no está disponible',
        });
        return;
      }
      const revisionActual = Object.prototype.hasOwnProperty.call(revisionesDetalle, id)
        ? revisionesDetalle[id]
        : revisionVacia;
      if (String(cambio.revisionDetalle) !== String(revisionActual)) {
        conflictos.push({
          idClub: id,
          codigo: 'DETALLE',
          esperado: String(cambio.revisionDetalle),
          actual: String(revisionActual),
          error: 'Detalle cambió después de la comparación; se rechazó la reparación',
        });
        return;
      }
    }

    const nuevos = cambio.eventos && typeof cambio.eventos === 'object' ? cambio.eventos : {};
    const anteriores = cambio.anteriores && typeof cambio.anteriores === 'object' ? cambio.anteriores : {};
    const conflictosClub = [];
    Object.keys(nuevos).forEach(function (codigoCrudo) {
      const codigo = String(codigoCrudo).trim().toUpperCase();
      const columna = columnasEvento[codigo];
      if (columna == null) {
        conflictosClub.push({ idClub: id, codigo: codigo, error: 'El evento no existe en la hoja' });
        return;
      }
      const actual = numero(valores[indiceFila][columna]);
      const esperado = numero(anteriores[codigo]);
      if (actual !== esperado) {
        conflictosClub.push({
          idClub: id,
          codigo: codigo,
          esperado: esperado,
          actual: actual,
          nuevo: numero(nuevos[codigo]),
        });
      }
    });
    if (conflictosClub.length) {
      conflictos.push.apply(conflictos, conflictosClub);
      return;
    }

    Object.keys(nuevos).forEach(function (codigoCrudo) {
      const codigo = String(codigoCrudo).trim().toUpperCase();
      const columna = columnasEvento[codigo];
      if (columna == null) return;
      const nuevo = numero(nuevos[codigo]);
      hoja.getRange(indiceFila + 1, columna + 1).setValue(nuevo);
      valores[indiceFila][columna] = nuevo;
    });
    if (colRevision >= 0) {
      const revision = numero(valores[indiceFila][colRevision]) + 1;
      hoja.getRange(indiceFila + 1, colRevision + 1).setValue(revision);
      valores[indiceFila][colRevision] = revision;
    }
    if (colActualizado >= 0) hoja.getRange(indiceFila + 1, colActualizado + 1).setValue(new Date());
    if (colEvaluador >= 0) hoja.getRange(indiceFila + 1, colEvaluador + 1).setValue(dispositivo || '');
    // Restaura la fórmula si alguien la borró manualmente.
    hoja.getRange(indiceFila + 1, colTotal + 1).setFormulaR1C1('=MAX(0,SUM(RC4:RC[-1]))');
    aplicados.push(id);
  });

  SpreadsheetApp.flush();
  return { aplicados: aplicados, conflictos: conflictos };
}

/**
 * Conserva en las hojas auxiliares únicamente los clubes cuya matriz fue aceptada.
 * Los envíos sin clave de club (por ejemplo Parámetros) siguen siendo globales.
 */
function limitarHojasAClubes(hojas, idsPermitidos) {
  const permitidos = {};
  (idsPermitidos || []).forEach(function (id) {
    const limpio = String(id || '').trim();
    if (limpio) permitidos[limpio] = true;
  });

  return (hojas || []).map(function (entradaCruda) {
    const entrada = entradaCruda || {};
    const hojaConocidaPorClub = esHojaConocidaPorClub(entrada.nombre);
    if (entrada.claveColumna == null && !hojaConocidaPorClub) return entrada;
    const copia = {};
    Object.keys(entrada).forEach(function (clave) { copia[clave] = entrada[clave]; });
    const filas = Array.isArray(entrada.filas) ? entrada.filas : [];
    const columna = hojaConocidaPorClub ? 0 : Number(entrada.claveColumna);
    copia.claveColumna = columna;
    // Detalle, Alertas y el resumen legado de Puntajes siempre se fusionan por ID.
    // Nunca se confía en un "reemplazar" enviado por un teléfono desactualizado.
    if (hojaConocidaPorClub) copia.reemplazar = false;
    copia.filas = filas.length
      ? [filas[0]].concat(filas.slice(1).filter(function (fila) {
          return permitidos[String(fila && fila[columna] || '').trim()];
        }))
      : [];
    const clubesReemplazar = Array.isArray(entrada.clubesReemplazar)
      ? entrada.clubesReemplazar
      : [];
    copia.clubesReemplazar = clubesReemplazar.filter(function (id) {
      return permitidos[String(id || '').trim()];
    });
    const tieneFilaPermitida = copia.filas.slice(1).some(function (fila) {
      return permitidos[String(fila && fila[columna] || '').trim()];
    });
    // Si ningún club de esta hoja fue aceptado, ni siquiera se toca su encabezado.
    // Un payload rechazado debe ser una operación completamente nula.
    return copia.clubesReemplazar.length || tieneFilaPermitida ? copia : null;
  }).filter(function (entrada) { return entrada !== null; });
}

/**
 * Toda hoja con filas por club debe corresponder a un cambio API 3 con huella.
 * Así se rechazan explícitamente los payloads legados que enviaban el snapshot
 * auxiliar sin `cambios`, incluso si omiten `claveColumna` o piden reemplazar.
 */
function conflictosDeHojasSinCambioSeguro(hojas, cambiosCompatibles, conflictosPrevios) {
  const seguros = {};
  (cambiosCompatibles || []).forEach(function (cambio) {
    const id = String(cambio && cambio.idClub || '').trim();
    if (id) seguros[id] = true;
  });
  const yaReportados = {};
  (conflictosPrevios || []).forEach(function (conflicto) {
    const id = String(conflicto && conflicto.idClub || '').trim();
    if (id) yaReportados[id] = true;
  });

  const solicitados = {};
  let hayHojaPorClub = false;
  (hojas || []).forEach(function (entradaCruda) {
    const entrada = entradaCruda || {};
    const conocida = esHojaConocidaPorClub(entrada.nombre);
    if (entrada.claveColumna == null && !conocida) return;
    hayHojaPorClub = true;
    const columna = conocida ? 0 : Number(entrada.claveColumna);
    const clubesReemplazar = Array.isArray(entrada.clubesReemplazar)
      ? entrada.clubesReemplazar
      : [];
    clubesReemplazar.forEach(function (idCrudo) {
      const id = String(idCrudo || '').trim();
      if (id) solicitados[id] = true;
    });
    const filas = Array.isArray(entrada.filas) ? entrada.filas : [];
    filas.slice(1).forEach(function (fila) {
      const id = String(fila && fila[columna] || '').trim();
      if (id) solicitados[id] = true;
    });
  });

  const conflictos = Object.keys(solicitados)
    .filter(function (id) { return !seguros[id] && !yaReportados[id]; })
    .map(function (id) {
      return {
        idClub: id,
        codigo: 'DETALLE',
        error: 'La hoja auxiliar no tiene un cambio API 3 con huella para este club',
      };
    });
  if (hayHojaPorClub && !Object.keys(solicitados).length && !Object.keys(seguros).length) {
    conflictos.push({
      idClub: '',
      codigo: 'DETALLE',
      error: 'Una hoja por club no puede reemplazarse sin cambios API 3 con huella',
    });
  }
  return conflictos;
}

function esHojaConocidaPorClub(nombre) {
  const normalizado = normalizarTexto(nombre);
  return normalizado === normalizarTexto(HOJA_PUNTAJES)
    || normalizado === normalizarTexto(HOJA_DETALLE)
    || normalizado === 'alertas';
}

/**
 * Mantiene las hojas de auditoría compatibles con los teléfonos anteriores. Cuando
 * Puntajes ya es una matriz por eventos, nunca se la reemplaza con el resumen legado.
 */
function procesarHojasAuxiliares(libro, hojas) {
  const resumen = [];
  hojas.forEach(function (entradaCruda) {
    const entrada = entradaCruda || {};
    const nombre = String(entrada.nombre || 'Datos').slice(0, 90);
    const filas = Array.isArray(entrada.filas) ? entrada.filas : [];
    if (!filas.length) return;

    let hoja = libro.getSheetByName(nombre);
    if (!hoja) hoja = libro.insertSheet(nombre);
    if (nombre === HOJA_PUNTAJES && esMatrizPuntajes(hoja)) {
      resumen.push(nombre + ': matriz conservada');
      return;
    }

    const encabezado = filas[0];
    const nuevas = filas.slice(1);
    let finales;
    const hojaConocidaPorClub = esHojaConocidaPorClub(nombre);
    const reemplazar = hojaConocidaPorClub ? false : entrada.reemplazar;
    const claveColumna = hojaConocidaPorClub ? 0 : entrada.claveColumna;
    if (reemplazar || claveColumna == null) {
      finales = nuevas;
    } else {
      const col = claveColumna;
      const entrantes = {};
      (entrada.clubesReemplazar || []).forEach(function (id) {
        if (String(id)) entrantes[String(id)] = true;
      });
      nuevas.forEach(function (fila) { entrantes[String(fila[col])] = true; });

      const previas = hoja.getLastRow() > 1
        ? hoja.getRange(2, 1, hoja.getLastRow() - 1, Math.max(1, hoja.getLastColumn())).getValues()
        : [];
      const conservadas = previas.filter(function (fila) {
        const clave = String(fila[col]);
        return clave !== '' && !entrantes[clave];
      });
      finales = conservadas.concat(nuevas);
      finales.sort(function (a, b) { return String(a[col]).localeCompare(String(b[col])); });
    }
    escribir(hoja, encabezado, finales);
    resumen.push(nombre + ': ' + nuevas.length);
  });
  return resumen;
}

function esMatrizPuntajes(hoja) {
  if (!hoja || hoja.getLastColumn() < 4) return false;
  const encabezado = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String);
  return Object.keys(indicesPorCodigo(encabezado)).length > 0
    && indiceEncabezado(encabezado, 'total') >= 0;
}

function escribir(hoja, encabezado, filas) {
  let ancho = encabezado.length;
  filas.forEach(function (fila) { ancho = Math.max(ancho, fila.length); });
  const emparejar = function (fila) {
    const copia = fila.slice();
    while (copia.length < ancho) copia.push('');
    return copia.slice(0, ancho).map(function (valor) {
      return valor === null || valor === undefined ? '' : valor;
    });
  };
  const todo = [emparejar(encabezado)].concat(filas.map(emparejar));
  hoja.clearContents();
  hoja.getRange(1, 1, todo.length, ancho).setValues(todo);
  hoja.getRange(1, 1, 1, ancho).setFontWeight('bold');
  hoja.setFrozenRows(1);
  if (ancho <= 20) hoja.autoResizeColumns(1, ancho);
}

function registrarEnvio(libro, datos, resumen, resultadoCambios) {
  let hoja = libro.getSheetByName('Envíos');
  if (!hoja) {
    hoja = libro.insertSheet('Envíos');
    hoja.getRange(1, 1, 1, 5).setValues([[
      'Fecha y hora', 'Desde', 'Clubes enviados', 'Hojas actualizadas', 'Resultado',
    ]]);
    hoja.getRange(1, 1, 1, 5).setFontWeight('bold');
    hoja.setFrozenRows(1);
  } else if (hoja.getRange(1, 5).getValue() !== 'Resultado') {
    hoja.getRange(1, 5).setValue('Resultado').setFontWeight('bold');
  }
  hoja.appendRow([
    new Date(),
    datos.dispositivo || 'sin nombre',
    datos.clubes || '',
    resumen.join(' · '),
    resultadoCambios.conflictos.length
      ? 'Conflictos: ' + resultadoCambios.conflictos.length
      : 'Aplicados: ' + resultadoCambios.aplicados.length,
  ]);
}

function doGet(peticion) {
  try {
    const parametros = peticion && peticion.parameter || {};
    if (parametros.accion !== 'seriales' && parametros.accion !== 'estado') {
      return responder({
        ok: true,
        version: VERSION_API,
        mensaje: 'El script está publicado y responde.',
      });
    }
    if (parametros.clave !== CLAVE) {
      return responder({ ok: false, version: VERSION_API, error: 'Clave incorrecta' });
    }

    // Se usa el mismo bloqueo que doPost: Detalle y Puntajes deben pertenecer a
    // una sola fotografía coherente, nunca a dos momentos distintos del envío.
    const cerrojo = LockService.getScriptLock();
    if (!cerrojo.tryLock(30000)) {
      return responder({
        ok: false,
        version: VERSION_API,
        error: 'Otro teléfono está guardando en este momento. Probá de nuevo en unos segundos.',
      });
    }
    try {
      const libro = SpreadsheetApp.getActiveSpreadsheet();
      const detalle = leerDetalle(libro);
      const puntajes = leerPuntajes(libro);
      const revisionVacia = huellaCodigosDetalle([]);
      puntajes.puntajes.forEach(function (fila) {
        if (!Object.prototype.hasOwnProperty.call(detalle.revisionesDetalle, fila.idClub)) {
          detalle.revisionesDetalle[fila.idClub] = revisionVacia;
        }
      });
      const base = {
        ok: true,
        version: VERSION_API,
        seriales: detalle.seriales,
        clubes: Math.max(detalle.clubes, puntajes.puntajes.length),
        detalleDisponible: detalle.disponible,
        revisionesDetalle: detalle.revisionesDetalle,
        eventos: puntajes.eventos,
        puntajes: puntajes.puntajes,
        revision: new Date().toISOString(),
      };
      if (parametros.accion === 'estado') base.escaneos = detalle.escaneos;
      return responder(base);
    } finally {
      cerrojo.releaseLock();
    }
  } catch (error) {
    return responder({ ok: false, version: VERSION_API, error: String(error) });
  }
}

function leerDetalle(libro) {
  const hoja = libro.getSheetByName(HOJA_DETALLE);
  if (!hoja) {
    return {
      disponible: false,
      seriales: {},
      clubes: 0,
      escaneos: [],
      revisionesDetalle: {},
    };
  }
  if (hoja.getLastRow() < 2) {
    return {
      disponible: true,
      seriales: {},
      clubes: 0,
      escaneos: [],
      revisionesDetalle: {},
    };
  }

  const valores = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues();
  const encabezado = valores[0].map(String);
  const colId = indiceEncabezado(encabezado, 'id');
  const colQr = indiceEncabezado(encabezado, 'codigo qr');
  const colDispositivo = indiceEncabezado(encabezado, 'evaluador');
  const colTs = indiceEncabezado(encabezado, 'marca de tiempo');
  const colOrden = indiceEncabezado(encabezado, 'orden');
  if (colId < 0 || colQr < 0) {
    throw new Error('La hoja "Detalle de escaneos" no tiene las columnas ID y Código QR');
  }

  const seriales = {};
  const clubes = {};
  const codigosPorClub = {};
  const escaneos = [];
  for (let i = 1; i < valores.length; i++) {
    const id = String(valores[i][colId] || '').trim();
    const qr = String(valores[i][colQr] || '').trim().toUpperCase();
    if (!id || !qr) continue;
    if (!seriales[qr]) seriales[qr] = [];
    if (seriales[qr].indexOf(id) < 0) seriales[qr].push(id);
    clubes[id] = true;
    if (!codigosPorClub[id]) codigosPorClub[id] = [];
    codigosPorClub[id].push(qr);
    let ts = colTs >= 0 ? Number(valores[i][colTs]) : 0;
    if (!isFinite(ts) || ts < 0) ts = colOrden >= 0 ? Number(valores[i][colOrden]) : i;
    escaneos.push({
      idClub: id,
      crudo: qr,
      ts: ts,
      dispositivo: colDispositivo >= 0 ? String(valores[i][colDispositivo] || '') : '',
    });
  }
  const revisionesDetalle = {};
  Object.keys(codigosPorClub).forEach(function (id) {
    revisionesDetalle[id] = huellaCodigosDetalle(codigosPorClub[id]);
  });
  return {
    disponible: true,
    seriales: seriales,
    clubes: Object.keys(clubes).length,
    escaneos: escaneos,
    revisionesDetalle: revisionesDetalle,
  };
}

/** Huella estable del conjunto de QR de un club, independiente del orden de filas. */
function huellaCodigosDetalle(codigos) {
  const ordenados = (codigos || []).map(function (codigo) {
    return String(codigo || '').trim().toUpperCase();
  }).filter(String).sort();
  const texto = ordenados.join('\n');
  let hash = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ordenados.length + '-' + (hash >>> 0).toString(16);
}

function leerPuntajes(libro) {
  const hoja = libro.getSheetByName(HOJA_PUNTAJES);
  if (!hoja || hoja.getLastRow() < 1 || hoja.getLastColumn() < 1) {
    return { eventos: [], puntajes: [] };
  }
  const valores = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues();
  const encabezado = valores[0].map(String);
  const columnas = indicesPorCodigo(encabezado);
  const colId = indiceEncabezado(encabezado, 'id');
  const colClub = indiceEncabezado(encabezado, 'club');
  const colRegion = indiceEncabezado(encabezado, 'region');
  const colTotal = indiceEncabezado(encabezado, 'total');
  const colRevision = indiceEncabezado(encabezado, 'revision');
  const colActualizado = indiceEncabezado(encabezado, 'actualizado');
  const colEvaluador = indiceEncabezado(encabezado, 'evaluador');
  if (colId < 0) return { eventos: [], puntajes: [] };
  const formulasTotal = colTotal >= 0 && valores.length > 1
    ? hoja.getRange(2, colTotal + 1, valores.length - 1, 1).getFormulasR1C1()
    : [];

  const eventos = Object.keys(columnas)
    .map(function (codigo) {
      const columna = columnas[codigo];
      return {
        codigo: codigo,
        nombre: nombreEvento(encabezado[columna], codigo),
        columna: columna + 1,
      };
    })
    .sort(function (a, b) { return a.columna - b.columna; });

  const puntajes = [];
  for (let i = 1; i < valores.length; i++) {
    const id = String(valores[i][colId] || '').trim();
    if (!id) continue;
    const porEvento = {};
    eventos.forEach(function (evento) {
      porEvento[evento.codigo] = numero(valores[i][evento.columna - 1]);
    });
    const actualizado = colActualizado >= 0 ? valores[i][colActualizado] : '';
    puntajes.push({
      idClub: id,
      club: colClub >= 0 ? String(valores[i][colClub] || '') : '',
      region: colRegion >= 0 ? String(valores[i][colRegion] || '') : '',
      eventos: porEvento,
      total: colTotal >= 0 ? numero(valores[i][colTotal]) : 0,
      totalConFormula: colTotal >= 0
        && String(formulasTotal[i - 1] && formulasTotal[i - 1][0] || '').toUpperCase()
          === '=MAX(0,SUM(RC4:RC[-1]))',
      revision: colRevision >= 0 ? numero(valores[i][colRevision]) : 0,
      actualizado: actualizado instanceof Date ? actualizado.toISOString() : String(actualizado || ''),
      evaluador: colEvaluador >= 0 ? String(valores[i][colEvaluador] || '') : '',
    });
  }
  return { eventos: eventos, puntajes: puntajes };
}

function indicesPorCodigo(encabezado) {
  const columnas = {};
  encabezado.forEach(function (celda, i) {
    const coincidencia = String(celda || '').trim().toUpperCase().match(/^([A-Z][0-9]{2})(?:\b|\s|·|-)/);
    if (coincidencia && columnas[coincidencia[1]] == null) columnas[coincidencia[1]] = i;
  });
  return columnas;
}

function nombreEvento(encabezado, codigo) {
  return String(encabezado || '')
    .replace(new RegExp('^' + codigo + '\\s*(?:·|-)?\\s*', 'i'), '')
    .trim() || codigo;
}

function indiceEncabezado(encabezado, buscado) {
  const normalizado = normalizarTexto(buscado);
  for (let i = 0; i < encabezado.length; i++) {
    if (normalizarTexto(encabezado[i]) === normalizado) return i;
  }
  return -1;
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function numero(valor) {
  const n = Number(valor);
  return isFinite(n) ? n : 0;
}

function responder(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
