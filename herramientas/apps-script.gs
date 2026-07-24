/**
 * Recibe los puntajes del evaluador y los escribe en esta planilla.
 *
 * ESTE ARCHIVO NO ES PARTE DE LA APP. Es el codigo que se pega dentro de Google
 * Sheets. Instrucciones completas en LEEME.md, seccion "Enviar a Google Sheets".
 *
 * Resumen:
 *   1. Abri tu planilla de Google Sheets.
 *   2. Extensiones -> Apps Script. Borra lo que haya y pega TODO este archivo.
 *   3. Cambia CLAVE por una frase tuya (la misma que vas a poner en la app).
 *   4. Implementar -> Nueva implementacion -> Aplicacion web:
 *        Ejecutar como:        Yo
 *        Quien tiene acceso:   Cualquier usuario
 *   5. Copia la URL que termina en /exec y pegala en la app, en Ajustes.
 *
 * COMO CONVIVEN VARIOS TELEFONOS
 *
 * Cada envio trae solo los clubes que ese telefono evaluo, y aca se FUSIONAN por
 * club: se reemplazan las filas de esos clubes y se deja intacto todo lo demas.
 * Por eso pueden mandar varios evaluadores a la misma planilla sin pisarse, y
 * cada uno puede reenviar las veces que quiera sin duplicar filas.
 *
 * Lo que esta planilla NO hace es mandar nada de vuelta a los telefonos. Es una
 * vista para compartir, no un lugar donde se sincronizan los datos. La union
 * completa se hace pasando el archivo de datos entre telefonos (Ajustes ->
 * Exportar / Importar), que ademas es lo unico que permite cruzar los stickers
 * entre clubes evaluados por personas distintas.
 */

// Cambiala por una frase tuya. Tiene que coincidir con la que pongas en la app.
// No es para proteger secretos de estado: evita que alguien que descubra la URL
// pueda escribir en tu planilla por accidente o por joda.
const CLAVE = 'cambiame-por-una-frase-tuya';

function doPost(peticion) {
  try {
    // El evaluador manda el cuerpo como texto plano a proposito: con
    // application/json el navegador exige un permiso previo (preflight) que
    // Apps Script no sabe responder, y el envio falla sin explicacion.
    const datos = JSON.parse(peticion.postData.contents);

    if (datos.clave !== CLAVE) {
      return responder({ ok: false, error: 'Clave incorrecta' });
    }
    if (!Array.isArray(datos.hojas) || !datos.hojas.length) {
      return responder({ ok: false, error: 'No vino ninguna hoja de datos' });
    }

    // Bloqueo: si dos evaluadores tocan "enviar" al mismo tiempo, uno espera.
    // Sin esto, los dos leerian la planilla vieja y el ultimo en escribir
    // borraria el trabajo del otro.
    const cerrojo = LockService.getScriptLock();
    if (!cerrojo.tryLock(30000)) {
      return responder({ ok: false, error: 'Otro teléfono está enviando en este momento. Probá de nuevo en unos segundos.' });
    }

    try {
      const libro = SpreadsheetApp.getActiveSpreadsheet();
      const resumen = [];

      datos.hojas.forEach(function (entrada) {
        const nombre = String(entrada.nombre || 'Datos').slice(0, 90);
        const filas = entrada.filas || [];
        if (filas.length < 1) return;

        let hoja = libro.getSheetByName(nombre);
        if (!hoja) hoja = libro.insertSheet(nombre);

        const encabezado = filas[0];
        const nuevas = filas.slice(1);

        let finales;
        if (entrada.reemplazar || entrada.claveColumna == null) {
          // Hojas sin clave de club (parametros, por ejemplo): se reescriben enteras.
          finales = nuevas;
        } else {
          const col = entrada.claveColumna;
          // Que clubes trae este envio. Solo esos se tocan.
          const entrantes = {};
          nuevas.forEach(function (f) { entrantes[String(f[col])] = true; });

          const previas = hoja.getLastRow() > 1
            ? hoja.getRange(2, 1, hoja.getLastRow() - 1, Math.max(1, hoja.getLastColumn())).getValues()
            : [];
          const conservadas = previas.filter(function (f) {
            const clave = String(f[col]);
            return clave !== '' && !entrantes[clave];
          });

          finales = conservadas.concat(nuevas);
          finales.sort(function (a, b) {
            return String(a[col]).localeCompare(String(b[col]));
          });
        }

        escribir(hoja, encabezado, finales);
        resumen.push(nombre + ': ' + nuevas.length);
      });

      registrarEnvio(libro, datos, resumen);
      return responder({ ok: true, hojas: resumen });
    } finally {
      cerrojo.releaseLock();
    }
  } catch (error) {
    return responder({ ok: false, error: String(error) });
  }
}

/** Vuelca encabezado + filas en la hoja, emparejando el ancho de todas. */
function escribir(hoja, encabezado, filas) {
  let ancho = encabezado.length;
  filas.forEach(function (f) { ancho = Math.max(ancho, f.length); });

  const emparejar = function (f) {
    const copia = f.slice();
    while (copia.length < ancho) copia.push('');
    return copia.slice(0, ancho).map(function (v) {
      return (v === null || v === undefined) ? '' : v;
    });
  };

  const todo = [emparejar(encabezado)].concat(filas.map(emparejar));

  hoja.clearContents();
  hoja.getRange(1, 1, todo.length, ancho).setValues(todo);
  hoja.getRange(1, 1, 1, ancho).setFontWeight('bold');
  hoja.setFrozenRows(1);
  if (ancho <= 20) hoja.autoResizeColumns(1, ancho);
}

/** Deja constancia de cada envio, sin borrar los anteriores. */
function registrarEnvio(libro, datos, resumen) {
  let hoja = libro.getSheetByName('Envíos');
  if (!hoja) {
    hoja = libro.insertSheet('Envíos');
    hoja.getRange(1, 1, 1, 4).setValues([['Fecha y hora', 'Desde', 'Clubes enviados', 'Hojas actualizadas']]);
    hoja.getRange(1, 1, 1, 4).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  hoja.appendRow([
    new Date(),
    datos.dispositivo || 'sin nombre',
    datos.clubes || '',
    resumen.join(' · '),
  ]);
}

/** Permite probar la conexion desde el navegador antes de mandar datos. */
function doGet() {
  return responder({ ok: true, mensaje: 'El script está publicado y responde.' });
}

function responder(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
