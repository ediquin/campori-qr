// PDF de stickers sin dependencias externas.
//
// Los QR se dibujan como vectores para que sigan midiendo exactamente 15 mm y no
// pierdan nitidez. El usuario puede elegir hoja oficio o carta.

import { generarMatriz } from './qr-encoder.js';

export const FORMATOS_PAPEL = Object.freeze({
  oficio: Object.freeze({
    id: 'oficio',
    nombre: 'Oficio',
    anchoMm: 215,
    altoMm: 330,
    columnas: 12,
    filas: 17,
    capacidad: 12 * 17,
  }),
  carta: Object.freeze({
    id: 'carta',
    nombre: 'Carta',
    anchoMm: 216,
    altoMm: 281.5,
    columnas: 12,
    filas: 14,
    capacidad: 12 * 14,
  }),
});

export const FORMATO_PAPEL_PREDETERMINADO = 'oficio';
export function obtenerFormatoPapel(id = FORMATO_PAPEL_PREDETERMINADO) {
  return FORMATOS_PAPEL[id] || FORMATOS_PAPEL[FORMATO_PAPEL_PREDETERMINADO];
}

// Alias del formato predeterminado, conservados para las comprobaciones de oficio.
export const ANCHO_PAGINA_MM = FORMATOS_PAPEL.oficio.anchoMm;
export const ALTO_PAGINA_MM = FORMATOS_PAPEL.oficio.altoMm;
export const LADO_QR_MM = 15;
export const STICKERS_POR_PAGINA = FORMATOS_PAPEL.oficio.capacidad;

const PUNTOS_POR_MM = 72 / 25.4;
const PASO_X_MM = 16.5;
const PASO_Y_MM = 18;
const ALTO_STICKER_MM = 17.5;
const BAJADA_REJILLA_MM = 13.5;

const pt = mm => mm * PUNTOS_POR_MM;
const numero = n => Number(n.toFixed(3)).toString();

const ESPECIALES_WIN_ANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function bytesWinAnsi(texto) {
  const bytes = [];
  for (const caracter of String(texto)) {
    const codigo = caracter.codePointAt(0);
    if (codigo <= 0xff) bytes.push(codigo);
    else bytes.push(ESPECIALES_WIN_ANSI.get(codigo) ?? 0x3f);
  }
  return bytes;
}

function textoHex(texto) {
  return bytesWinAnsi(texto).map(b => b.toString(16).padStart(2, '0')).join('');
}

function textoPdf(texto, x, y, { fuente = 'F1', tamano = 8 } = {}) {
  return `BT /${fuente} ${numero(tamano)} Tf 1 0 0 1 ${numero(x)} ${numero(y)} Tm <${textoHex(texto)}> Tj ET`;
}

function anchoAproximado(texto, tamano, factor = 0.5) {
  return bytesWinAnsi(texto).length * tamano * factor;
}

/**
 * Llena cada pagina antes de abrir la siguiente. Una pagina puede contener varios
 * eventos y cada aparicion queda registrada como un bloque. Asi no se desperdicia
 * el resto de la hoja y un evento que continua conserva su nombre y rango.
 *
 * Esta funcion se exporta para que la vista previa y el PDF usen exactamente la
 * misma distribucion, y para probar la paginacion sin fabricar cientos de QR.
 */
export function planificarPaginas(grupos = [], formatoPapel = FORMATO_PAPEL_PREDETERMINADO) {
  const formato = obtenerFormatoPapel(formatoPapel);
  const capacidad = formato.capacidad;
  const paginas = [];
  let actual = { stickers: [], bloques: [], formatoPapel: formato.id };

  const cerrarPagina = () => {
    if (!actual.stickers.length) return;
    paginas.push(actual);
    actual = { stickers: [], bloques: [], formatoPapel: formato.id };
  };

  grupos.forEach((grupo, indiceGrupo) => {
    const stickers = Array.isArray(grupo.stickers) ? grupo.stickers : [];
    let desdeEvento = 0;
    let paginaEvento = 0;

    while (desdeEvento < stickers.length) {
      if (actual.stickers.length === capacidad) cerrarPagina();

      const disponibles = capacidad - actual.stickers.length;
      const cantidad = Math.min(disponibles, stickers.length - desdeEvento);
      const tomados = stickers.slice(desdeEvento, desdeEvento + cantidad).map(sticker => ({
        ...sticker,
        codigo: grupo.codigo,
        nombre: grupo.nombre,
        puntos: grupo.puntos,
      }));

      paginaEvento++;
      actual.bloques.push({
        codigo: grupo.codigo,
        nombre: grupo.nombre,
        puntos: grupo.puntos,
        indiceGrupo,
        inicioCelda: actual.stickers.length,
        stickers: tomados,
        desdeEvento,
        hastaEvento: desdeEvento + cantidad,
        totalEvento: stickers.length,
        paginaEvento,
        paginasEvento: 0,
      });
      actual.stickers.push(...tomados);
      desdeEvento += cantidad;
    }
  });
  cerrarPagina();

  const paginasPorGrupo = new Map();
  for (const pagina of paginas) {
    for (const bloque of pagina.bloques) {
      paginasPorGrupo.set(bloque.indiceGrupo, (paginasPorGrupo.get(bloque.indiceGrupo) || 0) + 1);
    }
  }

  paginas.forEach((pagina, i) => {
    pagina.numeroPagina = i + 1;
    pagina.paginasTotal = paginas.length;
    pagina.bloques.forEach(bloque => {
      bloque.paginasEvento = paginasPorGrupo.get(bloque.indiceGrupo) || 1;
    });
  });
  return paginas;
}

function rotuloBloque(bloque) {
  const cantidad = bloque.hastaEvento - bloque.desdeEvento;
  const rango = bloque.paginasEvento > 1
    ? ` [${bloque.desdeEvento + 1}-${bloque.hastaEvento} de ${bloque.totalEvento}]`
    : ` [${cantidad}]`;
  return `${bloque.codigo} - ${bloque.nombre}${rango}`;
}

/**
 * Resume los bloques que aparecen en una hoja. En cantidades normales caben los
 * nombres completos; si se eligieron muchos eventos con muy pocos QR, abrevia el
 * final sin ocultar el evento que viene continuado desde la pagina anterior.
 */
export function resumirPagina(pagina, maxCaracteres = 155) {
  const bloques = Array.isArray(pagina?.bloques) ? pagina.bloques : [];
  if (!bloques.length) return '';

  let resumen = '';
  for (let i = 0; i < bloques.length; i++) {
    const parte = rotuloBloque(bloques[i]);
    const candidato = resumen ? `${resumen} | ${parte}` : parte;
    const restantes = bloques.length - i - 1;
    const sufijo = restantes ? ` | +${restantes} evento${restantes === 1 ? '' : 's'}` : '';

    if (candidato.length + sufijo.length <= maxCaracteres || !resumen) {
      resumen = candidato;
      continue;
    }
    return `${resumen} | +${bloques.length - i} evento${bloques.length - i === 1 ? '' : 's'}`;
  }
  return resumen;
}

function qrPdf(texto, xMm, yMm) {
  const { tamano, modulos } = generarMatriz(texto, { nivel: 'H', versionMinima: 2 });
  const margen = 4;
  const total = tamano + margen * 2;
  const modulo = pt(LADO_QR_MM) / total;
  const comandos = [
    `q ${numero(modulo)} 0 0 ${numero(modulo)} ${numero(pt(xMm))} ${numero(pt(yMm))} cm`,
    '0 g',
  ];

  for (let y = 0; y < tamano; y++) {
    let x = 0;
    while (x < tamano) {
      if (!modulos[y][x]) { x++; continue; }
      let fin = x + 1;
      while (fin < tamano && modulos[y][fin]) fin++;
      comandos.push(`${x + margen} ${total - (y + margen + 1)} ${fin - x} 1 re`);
      x = fin;
    }
  }
  comandos.push('f', 'Q');
  return comandos.join('\n');
}

async function contenidoPagina(pagina, campori, progreso, formato) {
  const comandos = [];
  const izquierda = resumirPagina(pagina);
  const derecha = `${campori} - ${formato.nombre} - hoja ${pagina.numeroPagina}/${pagina.paginasTotal} - ${pagina.stickers.length} stickers`;
  const izquierdaRejilla = (formato.anchoMm - formato.columnas * PASO_X_MM) / 2;
  const arribaRejilla = formato.altoMm - BAJADA_REJILLA_MM;
  const yTitulo = formato.altoMm - 7;
  const yDetalle = formato.altoMm - 10.3;
  const yLinea = formato.altoMm - 11.5;
  const derechaPagina = formato.anchoMm - 7;

  let tamanoTitulo = 8.5;
  while (tamanoTitulo > 5.5 &&
         anchoAproximado(izquierda, tamanoTitulo, 0.52) > pt(formato.anchoMm - 14)) {
    tamanoTitulo -= 0.5;
  }
  comandos.push(textoPdf(izquierda, pt(7), pt(yTitulo), { fuente: 'F2', tamano: tamanoTitulo }));
  const xDerecha = Math.max(pt(7), pt(derechaPagina) - anchoAproximado(derecha, 7, 0.48));
  comandos.push(textoPdf(derecha, xDerecha, pt(yDetalle), { tamano: 7 }));
  comandos.push(`0 G ${numero(pt(0.3))} w ${numero(pt(7))} ${numero(pt(yLinea))} m ${numero(pt(derechaPagina))} ${numero(pt(yLinea))} l S`);

  // Guias de corte. Se dibujan primero para que nunca tapen los modulos del QR.
  comandos.push(`0.75 G ${numero(pt(0.15))} w [${numero(pt(0.6))} ${numero(pt(0.6))}] 0 d`);
  pagina.stickers.forEach((_, i) => {
    const columna = i % formato.columnas;
    const fila = Math.floor(i / formato.columnas);
    const x = izquierdaRejilla + columna * PASO_X_MM;
    const y = arribaRejilla - fila * PASO_Y_MM - ALTO_STICKER_MM;
    comandos.push(`${numero(pt(x))} ${numero(pt(y))} ${numero(pt(LADO_QR_MM))} ${numero(pt(ALTO_STICKER_MM))} re S`);
  });
  comandos.push('[] 0 d 0 G');

  for (let i = 0; i < pagina.stickers.length; i++) {
    const sticker = pagina.stickers[i];
    const columna = i % formato.columnas;
    const fila = Math.floor(i / formato.columnas);
    const x = izquierdaRejilla + columna * PASO_X_MM;
    const arriba = arribaRejilla - fila * PASO_Y_MM;
    const yQr = arriba - LADO_QR_MM;
    comandos.push(qrPdf(sticker.texto, x, yQr));

    const rotulo = `${sticker.codigo}-${sticker.puntos} ${sticker.serial}`;
    const tamano = 4;
    const ancho = anchoAproximado(rotulo, tamano, 0.6);
    const xRotulo = pt(x) + (pt(LADO_QR_MM) - ancho) / 2;
    comandos.push(textoPdf(rotulo, xRotulo, pt(yQr - 1.45), { fuente: 'F3', tamano }));

    progreso.hechos++;
    progreso.alAvanzar?.({
      hechos: progreso.hechos,
      total: progreso.total,
      pagina: progreso.pagina,
      paginas: progreso.paginas,
    });
    if (progreso.cederCada > 0 && progreso.hechos % progreso.cederCada === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return `${comandos.join('\n')}\n`;
}

function armarDocumentoPdf(contenidos, formato) {
  const objetos = [null];
  const idsPaginas = contenidos.map((_, i) => 6 + i * 2);

  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Count ${contenidos.length} /Kids [${idsPaginas.map(id => `${id} 0 R`).join(' ')}] >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objetos[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';

  contenidos.forEach((contenido, i) => {
    const idPagina = 6 + i * 2;
    const idContenido = idPagina + 1;
    objetos[idPagina] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${numero(pt(formato.anchoMm))} ${numero(pt(formato.altoMm))}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${idContenido} 0 R >>`;
    objetos[idContenido] = `<< /Length ${contenido.length} >>\nstream\n${contenido}endstream`;
  });

  let pdf = '%PDF-1.4\n% Campori QR - PDF vectorial\n';
  const posiciones = new Array(objetos.length).fill(0);
  for (let id = 1; id < objetos.length; id++) {
    posiciones[id] = pdf.length;
    pdf += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
  }

  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id < objetos.length; id++) {
    pdf += `${String(posiciones[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;

  return new Blob([pdf], { type: 'application/pdf' });
}

/**
 * Crea un PDF descargable.
 *
 * @param {{campori: string, formatoPapel?: 'oficio'|'carta', grupos: Array}} datos
 * @param {{alAvanzar?: Function, cederCada?: number}} opciones
 */
export async function crearPdfStickers(datos, opciones = {}) {
  const formato = obtenerFormatoPapel(datos?.formatoPapel);
  const paginas = planificarPaginas(datos?.grupos || [], formato.id);
  if (!paginas.length) throw new Error('No hay stickers para crear el PDF.');

  const progreso = {
    hechos: 0,
    total: paginas.reduce((n, pagina) => n + pagina.stickers.length, 0),
    pagina: 0,
    paginas: paginas.length,
    alAvanzar: opciones.alAvanzar,
    cederCada: opciones.cederCada ?? 30,
  };
  const contenidos = [];
  for (let i = 0; i < paginas.length; i++) {
    progreso.pagina = i + 1;
    contenidos.push(await contenidoPagina(paginas[i], datos?.campori || '', progreso, formato));
  }
  return armarDocumentoPdf(contenidos, formato);
}
