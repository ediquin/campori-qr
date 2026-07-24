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
 * Cada envio REEMPLAZA el contenido de las hojas, no lo agrega al final. Podes
 * mandar los datos las veces que quieras: siempre queda el estado actual, sin
 * filas duplicadas.
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

    const libro = SpreadsheetApp.getActiveSpreadsheet();
    const escritas = [];

    datos.hojas.forEach(function (entrada) {
      const nombre = String(entrada.nombre || 'Datos').slice(0, 90);
      const filas = entrada.filas || [];
      if (!filas.length) return;

      let hoja = libro.getSheetByName(nombre);
      if (!hoja) hoja = libro.insertSheet(nombre);
      hoja.clear();

      // Todas las filas tienen que tener el mismo largo o setValues falla.
      let ancho = 0;
      filas.forEach(function (f) { ancho = Math.max(ancho, f.length); });
      const parejas = filas.map(function (f) {
        const copia = f.slice();
        while (copia.length < ancho) copia.push('');
        return copia.map(function (v) { return (v === null || v === undefined) ? '' : v; });
      });

      hoja.getRange(1, 1, parejas.length, ancho).setValues(parejas);
      hoja.getRange(1, 1, 1, ancho).setFontWeight('bold');
      hoja.setFrozenRows(1);
      hoja.autoResizeColumns(1, Math.min(ancho, 20));

      escritas.push(nombre + ' (' + (parejas.length - 1) + ')');
    });

    // Hoja de control: cuando fue el ultimo envio y desde donde.
    let control = libro.getSheetByName('Última actualización');
    if (!control) control = libro.insertSheet('Última actualización');
    control.clear();
    control.getRange(1, 1, 4, 2).setValues([
      ['Última actualización', new Date()],
      ['Campori', datos.campori || ''],
      ['Enviado desde', datos.dispositivo || 'un teléfono del equipo'],
      ['Hojas actualizadas', escritas.join(' · ')],
    ]);
    control.getRange(1, 1, 4, 1).setFontWeight('bold');
    control.autoResizeColumns(1, 2);

    return responder({ ok: true, hojas: escritas });
  } catch (error) {
    return responder({ ok: false, error: String(error) });
  }
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
