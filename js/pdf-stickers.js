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
// Cada evento arranca su propio bloque con una banda de titulo encima de sus QR.
const ALTO_TITULO_MM = 7;        // alto de la banda de titulo de cada evento
const MARGEN_INFERIOR_MM = 6;    // aire que se deja abajo de la ultima fila

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

// Alto vertical utilizable de una hoja para bloques de eventos (en mm).
function alturaDisponibleMm(formato) {
  return (formato.altoMm - BAJADA_REJILLA_MM) - MARGEN_INFERIOR_MM;
}

// Alto que ocupa un bloque: la banda de titulo mas sus filas de QR.
function altoBloqueMm(filas) {
  return ALTO_TITULO_MM + filas * PASO_Y_MM;
}

/**
 * Agrupa los QR por evento. Cada evento arranca su propio bloque con una banda de
 * titulo encima de sus codigos. Los bloques se apilan de arriba hacia abajo; varios
 * eventos chicos comparten hoja, pero cada uno con su titulo, y un evento que no
 * entra completo continua en la hoja siguiente repitiendo el titulo.
 *
 * Antes se empaquetaba "de corrido" (los eventos fluian sin separacion). Se cambio a
 * bloques con titulo por pedido: al recortar, cada lote queda claramente rotulado.
 *
 * Se exporta para que la vista previa y el PDF usen la misma distribucion, y para
 * poder probar la paginacion sin fabricar cientos de QR.
 */
export function planificarPaginas(grupos = [], formatoPapel = FORMATO_PAPEL_PREDETERMINADO) {
  const formato = obtenerFormatoPapel(formatoPapel);
  const columnas = formato.columnas;
  const disponible = alturaDisponibleMm(formato);
  const paginas = [];
  let pagina = null;
  let usado = 0;   // mm ya ocupados desde el inicio del cuerpo de la hoja

  const nuevaPagina = () => {
    pagina = { stickers: [], bloques: [], formatoPapel: formato.id };
    paginas.push(pagina);
    usado = 0;
  };

  grupos.forEach((grupo, indiceGrupo) => {
    const stickers = Array.isArray(grupo.stickers) ? grupo.stickers : [];
    if (!stickers.length) return;

    let desdeEvento = 0;
    let paginaEvento = 0;

    while (desdeEvento < stickers.length) {
      if (!pagina) nuevaPagina();

      const libre = disponible - usado;
      // Un bloque necesita al menos su titulo y una fila de QR. Si no entra, se
      // pasa a una hoja nueva antes de empezar el evento (o de continuarlo).
      if (libre < altoBloqueMm(1)) { pagina = null; continue; }

      const filasQueEntran = Math.floor((libre - ALTO_TITULO_MM) / PASO_Y_MM);
      const filasQueFaltan = Math.ceil((stickers.length - desdeEvento) / columnas);
      const filas = Math.min(filasQueEntran, filasQueFaltan);
      const cantidad = Math.min(stickers.length - desdeEvento, filas * columnas);

      const tomados = stickers.slice(desdeEvento, desdeEvento + cantidad).map(sticker => ({
        ...sticker,
        codigo: grupo.codigo,
        nombre: grupo.nombre,
        puntos: grupo.puntos,
      }));

      paginaEvento++;
      pagina.bloques.push({
        codigo: grupo.codigo,
        nombre: grupo.nombre,
        puntos: grupo.puntos,
        indiceGrupo,
        stickers: tomados,
        filas,
        desdeEvento,
        hastaEvento: desdeEvento + cantidad,
        totalEvento: stickers.length,
        paginaEvento,
        paginasEvento: 0,
      });
      pagina.stickers.push(...tomados);
      usado += altoBloqueMm(filas);
      desdeEvento += cantidad;

      // Si el evento no entro completo, lo que resta va en una hoja nueva.
      if (desdeEvento < stickers.length) pagina = null;
    }
  });

  const paginasPorGrupo = new Map();
  for (const p of paginas) {
    for (const bloque of p.bloques) {
      paginasPorGrupo.set(bloque.indiceGrupo, (paginasPorGrupo.get(bloque.indiceGrupo) || 0) + 1);
    }
  }

  paginas.forEach((p, i) => {
    p.numeroPagina = i + 1;
    p.paginasTotal = paginas.length;
    p.bloques.forEach(bloque => {
      bloque.paginasEvento = paginasPorGrupo.get(bloque.indiceGrupo) || 1;
    });
  });
  return paginas;
}

/**
 * Titulo de la banda de un evento: "A30 · BOTIQUÍN · 500 pts · 15 QR". Si el evento
 * se parte entre hojas, muestra el rango: "(16-30 de 40)".
 */
export function rotuloBloque(bloque) {
  const cantidad = bloque.hastaEvento - bloque.desdeEvento;
  const rango = bloque.paginasEvento > 1
    ? ` (${bloque.desdeEvento + 1}-${bloque.hastaEvento} de ${bloque.totalEvento})`
    : '';
  const puntos = `${bloque.puntos} pts`;
  return `${bloque.codigo} · ${bloque.nombre} · ${puntos} · ${cantidad} QR${rango}`;
}

/** Lista corta de los eventos que aparecen en una hoja, para el encabezado. */
export function resumirPagina(pagina) {
  const bloques = Array.isArray(pagina?.bloques) ? pagina.bloques : [];
  const nombres = [...new Set(bloques.map(b => b.nombre))];
  if (!nombres.length) return '';
  if (nombres.length <= 3) return nombres.join(' · ');
  return `${nombres.slice(0, 2).join(' · ')} · +${nombres.length - 2} eventos`;
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
  const derecha = `${campori} - ${formato.nombre} - hoja ${pagina.numeroPagina}/${pagina.paginasTotal} - ${pagina.stickers.length} stickers`;
  const izquierdaRejilla = (formato.anchoMm - formato.columnas * PASO_X_MM) / 2;
  const yDetalle = formato.altoMm - 8;
  const yLinea = formato.altoMm - 9.5;
  const derechaPagina = formato.anchoMm - 7;

  // Encabezado minimo: los titulos de cada evento ahora van en el cuerpo.
  comandos.push(textoPdf('Hoja de stickers', pt(7), pt(yDetalle), { fuente: 'F2', tamano: 8.5 }));
  const xDerecha = Math.max(pt(7), pt(derechaPagina) - anchoAproximado(derecha, 7, 0.48));
  comandos.push(textoPdf(derecha, xDerecha, pt(yDetalle), { tamano: 7 }));
  comandos.push(`0 G ${numero(pt(0.3))} w ${numero(pt(7))} ${numero(pt(yLinea))} m ${numero(pt(derechaPagina))} ${numero(pt(yLinea))} l S`);

  // Recorremos los bloques de arriba hacia abajo. `yCursor` es el borde superior del
  // bloque en curso, en mm desde el pie de la hoja (coordenadas del PDF).
  let yCursor = formato.altoMm - BAJADA_REJILLA_MM;

  for (const bloque of pagina.bloques) {
    // Banda de titulo del evento.
    const titulo = rotuloBloque(bloque);
    let tamanoTitulo = 8.5;
    while (tamanoTitulo > 5.5 &&
           anchoAproximado(titulo, tamanoTitulo, 0.52) > pt(formato.anchoMm - 14)) {
      tamanoTitulo -= 0.5;
    }
    const yTexto = yCursor - ALTO_TITULO_MM + 2.2;
    comandos.push(textoPdf(titulo, pt(7), pt(yTexto), { fuente: 'F2', tamano: tamanoTitulo }));
    // Linea fina bajo el titulo, ancho de la rejilla.
    const yBajoTitulo = yCursor - ALTO_TITULO_MM + 0.6;
    comandos.push(`0.6 G ${numero(pt(0.2))} w ${numero(pt(izquierdaRejilla))} ${numero(pt(yBajoTitulo))} m ${numero(pt(izquierdaRejilla + formato.columnas * PASO_X_MM))} ${numero(pt(yBajoTitulo))} l S 0 G`);

    const arribaRejilla = yCursor - ALTO_TITULO_MM;

    // Guias de corte de este bloque.
    comandos.push(`0.75 G ${numero(pt(0.15))} w [${numero(pt(0.6))} ${numero(pt(0.6))}] 0 d`);
    bloque.stickers.forEach((_, i) => {
      const columna = i % formato.columnas;
      const fila = Math.floor(i / formato.columnas);
      const x = izquierdaRejilla + columna * PASO_X_MM;
      const y = arribaRejilla - fila * PASO_Y_MM - ALTO_STICKER_MM;
      comandos.push(`${numero(pt(x))} ${numero(pt(y))} ${numero(pt(LADO_QR_MM))} ${numero(pt(ALTO_STICKER_MM))} re S`);
    });
    comandos.push('[] 0 d 0 G');

    for (let i = 0; i < bloque.stickers.length; i++) {
      const sticker = bloque.stickers[i];
      const columna = i % formato.columnas;
      const fila = Math.floor(i / formato.columnas);
      const x = izquierdaRejilla + columna * PASO_X_MM;
      const arriba = arribaRejilla - fila * PASO_Y_MM;
      const yQr = arriba - LADO_QR_MM;
      comandos.push(qrPdf(sticker.texto, x, yQr));

      const rotulo = `${sticker.codigo}·${sticker.puntos} ${sticker.serial}`;
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

    yCursor -= altoBloqueMm(bloque.filas);
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
