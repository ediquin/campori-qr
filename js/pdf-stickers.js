// PDF de stickers sin dependencias externas.
//
// Los QR se dibujan como vectores para que sigan midiendo exactamente 15 mm y no
// pierdan nitidez. El documento usa hoja oficio boliviana: 215 x 330 mm.

import { generarMatriz } from './qr-encoder.js';

export const ANCHO_PAGINA_MM = 215;
export const ALTO_PAGINA_MM = 330;
export const LADO_QR_MM = 15;
export const STICKERS_POR_PAGINA = 12 * 17;

const PUNTOS_POR_MM = 72 / 25.4;
const COLUMNAS = 12;
const PASO_X_MM = 16.5;
const PASO_Y_MM = 18;
const ALTO_STICKER_MM = 17.5;
const IZQUIERDA_REJILLA_MM = 8.5;
const ARRIBA_REJILLA_MM = 316.5;

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
 * Cada evento empieza en una pagina nueva, igual que en la vista previa.
 * Esta funcion se exporta para poder probar la paginacion sin fabricar cientos de QR.
 */
export function planificarPaginas(grupos = []) {
  const paginas = [];
  for (const grupo of grupos) {
    const stickers = Array.isArray(grupo.stickers) ? grupo.stickers : [];
    const total = Math.ceil(stickers.length / STICKERS_POR_PAGINA);
    for (let i = 0; i < stickers.length; i += STICKERS_POR_PAGINA) {
      paginas.push({
        ...grupo,
        stickers: stickers.slice(i, i + STICKERS_POR_PAGINA),
        paginaEvento: Math.floor(i / STICKERS_POR_PAGINA) + 1,
        paginasEvento: total,
      });
    }
  }
  return paginas;
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

async function contenidoPagina(pagina, campori, progreso) {
  const comandos = [];
  const izquierda = `${pagina.codigo} - ${pagina.nombre} - ${pagina.puntos} pts`;
  const derecha = `${campori} - hoja ${pagina.paginaEvento}/${pagina.paginasEvento} - ${pagina.stickers.length} stickers`;

  comandos.push(textoPdf(izquierda, pt(7), pt(323), { fuente: 'F2', tamano: 8.5 }));
  const xDerecha = Math.max(pt(7), pt(208) - anchoAproximado(derecha, 7, 0.48));
  comandos.push(textoPdf(derecha, xDerecha, pt(319.7), { tamano: 7 }));
  comandos.push(`0 G ${numero(pt(0.3))} w ${numero(pt(7))} ${numero(pt(318.5))} m ${numero(pt(208))} ${numero(pt(318.5))} l S`);

  // Guias de corte. Se dibujan primero para que nunca tapen los modulos del QR.
  comandos.push(`0.75 G ${numero(pt(0.15))} w [${numero(pt(0.6))} ${numero(pt(0.6))}] 0 d`);
  pagina.stickers.forEach((_, i) => {
    const columna = i % COLUMNAS;
    const fila = Math.floor(i / COLUMNAS);
    const x = IZQUIERDA_REJILLA_MM + columna * PASO_X_MM;
    const y = ARRIBA_REJILLA_MM - fila * PASO_Y_MM - ALTO_STICKER_MM;
    comandos.push(`${numero(pt(x))} ${numero(pt(y))} ${numero(pt(LADO_QR_MM))} ${numero(pt(ALTO_STICKER_MM))} re S`);
  });
  comandos.push('[] 0 d 0 G');

  for (let i = 0; i < pagina.stickers.length; i++) {
    const sticker = pagina.stickers[i];
    const columna = i % COLUMNAS;
    const fila = Math.floor(i / COLUMNAS);
    const x = IZQUIERDA_REJILLA_MM + columna * PASO_X_MM;
    const arriba = ARRIBA_REJILLA_MM - fila * PASO_Y_MM;
    const yQr = arriba - LADO_QR_MM;
    comandos.push(qrPdf(sticker.texto, x, yQr));

    const rotulo = `${pagina.codigo}-${pagina.puntos} ${sticker.serial}`;
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

function armarDocumentoPdf(contenidos) {
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
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${numero(pt(ANCHO_PAGINA_MM))} ${numero(pt(ALTO_PAGINA_MM))}] ` +
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
 * @param {{campori: string, grupos: Array}} datos
 * @param {{alAvanzar?: Function, cederCada?: number}} opciones
 */
export async function crearPdfStickers(datos, opciones = {}) {
  const paginas = planificarPaginas(datos?.grupos || []);
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
    contenidos.push(await contenidoPagina(paginas[i], datos?.campori || '', progreso));
  }
  return armarDocumentoPdf(contenidos);
}
