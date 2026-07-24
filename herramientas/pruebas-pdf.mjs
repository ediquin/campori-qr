// Verificacion del PDF descargable de stickers.
//
// Comprueba la geometria fisica, la paginacion y la estructura PDF sin depender de
// un visor externo. La revision visual se hace aparte renderizando una muestra.

import {
  FORMATOS_PAPEL, obtenerFormatoPapel,
  ANCHO_PAGINA_MM, ALTO_PAGINA_MM, LADO_QR_MM, STICKERS_POR_PAGINA,
  planificarPaginas, resumirPagina, crearPdfStickers,
} from '../js/pdf-stickers.js';
import { armarSticker } from '../js/codigo.js';
import { readFile } from 'node:fs/promises';

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}

const sticker = (codigo, serial) => ({
  serial,
  texto: armarSticker(codigo, 100, serial),
});
const muchos = (codigo, cantidad) => Array.from({ length: cantidad }, (_, i) =>
  sticker(codigo, i.toString(32).toUpperCase().padStart(8, '0')));
const grupo = (codigo, cantidad) => ({
  codigo,
  nombre: `Evento ${codigo}`,
  puntos: 100,
  stickers: muchos(codigo, cantidad),
});

console.log('\n--- Geometria y paginacion');
comprobar('ancho oficio en milimetros', ANCHO_PAGINA_MM, 215);
comprobar('alto oficio en milimetros', ALTO_PAGINA_MM, 330);
comprobar('lado fisico del QR en milimetros', LADO_QR_MM, 15);
comprobar('capacidad de una hoja oficio', STICKERS_POR_PAGINA, 204);
comprobar('medidas exactas de una hoja carta',
  [FORMATOS_PAPEL.carta.anchoMm, FORMATOS_PAPEL.carta.altoMm], [216, 281.5]);
comprobar('capacidad de una hoja carta', FORMATOS_PAPEL.carta.capacidad, 168);
comprobar('un formato desconocido vuelve a oficio',
  obtenerFormatoPapel('desconocido').id, 'oficio');

const exacta = planificarPaginas([grupo('A01', 204)]);
comprobar('204 stickers ocupan una hoja', exacta.length, 1);
comprobar('la hoja exacta conserva los 204', exacta[0].stickers.length, 204);
comprobar('la hoja exacta registra un bloque de evento', exacta[0].bloques.length, 1);

const excedida = planificarPaginas([grupo('A01', 205)]);
comprobar('205 stickers ocupan dos hojas', excedida.length, 2);
comprobar('la segunda hoja recibe solamente el excedente',
  excedida.map(p => p.stickers.length), [204, 1]);
comprobar('el nombre del evento se repite cuando continua',
  excedida.map(p => p.bloques[0].nombre), ['Evento A01', 'Evento A01']);
comprobar('los rangos del evento continuado son consecutivos',
  excedida.map(p => [p.bloques[0].desdeEvento, p.bloques[0].hastaEvento]),
  [[0, 204], [204, 205]]);
comprobar('cada cabecera identifica el evento continuado',
  excedida.map(p => resumirPagina(p).includes('A01 - Evento A01')),
  [true, true]);

const dosEventos = planificarPaginas([grupo('A01', 1), grupo('A02', 1)]);
comprobar('dos eventos aprovechan la misma hoja', dosEventos.length, 1);
comprobar('la hoja compartida conserva ambos bloques en orden',
  dosEventos[0].bloques.map(b => b.codigo), ['A01', 'A02']);

const tresTandas = planificarPaginas([
  grupo('A01', 80), grupo('A02', 80), grupo('A03', 80),
]);
comprobar('los eventos llenan la hoja antes de abrir otra',
  tresTandas.map(p => p.stickers.length), [204, 36]);
comprobar('el tercer evento usa el sobrante y continua en la hoja siguiente',
  tresTandas.map(p => p.bloques.filter(b => b.codigo === 'A03').map(b => b.stickers.length)),
  [[44], [36]]);
comprobar('las paginas llevan numeracion global',
  tresTandas.map(p => [p.numeroPagina, p.paginasTotal]), [[1, 2], [2, 2]]);
comprobar('un grupo vacio no crea paginas', planificarPaginas([grupo('A01', 0)]).length, 0);

const cartaExacta = planificarPaginas([grupo('A01', 168)], 'carta');
comprobar('168 stickers ocupan una hoja carta', cartaExacta.map(p => p.stickers.length), [168]);
const cartaExcedida = planificarPaginas([grupo('A01', 169)], 'carta');
comprobar('169 stickers carta se reparten sin recorte',
  cartaExcedida.map(p => p.stickers.length), [168, 1]);
comprobar('carta repite el nombre del evento continuado',
  cartaExcedida.map(p => resumirPagina(p).includes('A01 - Evento A01')), [true, true]);
const tresTandasCarta = planificarPaginas([
  grupo('A01', 80), grupo('A02', 80), grupo('A03', 80),
], 'carta');
comprobar('carta llena 168 posiciones antes de abrir otra hoja',
  tresTandasCarta.map(p => p.stickers.length), [168, 72]);
comprobar('el tercer evento usa 8 espacios carta y continua con 72',
  tresTandasCarta.map(p => p.bloques.filter(b => b.codigo === 'A03').map(b => b.stickers.length)),
  [[8], [72]]);

console.log('\n--- Botones visibles del generador');
const htmlGenerador = await readFile(new URL('../generador.html', import.meta.url), 'utf8');
const jsGenerador = await readFile(new URL('../js/generador.js', import.meta.url), 'utf8');
const cssBarra = htmlGenerador.match(/#barra-impresion\s*\{([^}]*)\}/)?.[1] || '';
comprobar('Descargar PDF existe desde la carga inicial',
  htmlGenerador.includes('id="descargar-pdf" disabled>Descargar PDF</button>'), true);
comprobar('la barra que contiene la descarga nace visible',
  /display:\s*flex/.test(cssBarra), true);
comprobar('Imprimir se mantiene como accion separada',
  htmlGenerador.includes('id="imprimir" disabled>Imprimir</button>'), true);
comprobar('el usuario puede elegir oficio o carta',
  htmlGenerador.includes('id="formato-papel"') &&
  htmlGenerador.includes('<option value="oficio">') &&
  htmlGenerador.includes('<option value="carta">'), true);
comprobar('la impresion recibe el tamano elegido',
  htmlGenerador.includes('id="estilo-papel-impresion"'), true);
comprobar('el boton usa el generador PDF real',
  jsGenerador.includes("$('#descargar-pdf').addEventListener('click', descargarPdf)"), true);
comprobar('vista previa y PDF comparten el planificador',
  jsGenerador.includes('const paginas = planificarPaginas(generacion.grupos, formato.id);'), true);
comprobar('cambiar papel reutiliza la generacion sin crear nuevos QR',
  jsGenerador.includes('ultimaGeneracion.formatoPapel = formato.id;') &&
  jsGenerador.includes('mostrarGeneracion(ultimaGeneracion);'), true);

console.log('\n--- Documento PDF real');
let ultimoProgreso = null;
const blob = await crearPdfStickers({
  campori: 'Campori de Aventureros',
  grupos: [grupo('A01', 1), grupo('A02', 1)],
}, {
  cederCada: 0,
  alAvanzar: estado => { ultimoProgreso = estado; },
});
const texto = Buffer.from(await blob.arrayBuffer()).toString('latin1');

comprobar('el Blob lleva el tipo PDF', blob.type, 'application/pdf');
comprobar('firma PDF 1.4', texto.startsWith('%PDF-1.4\n'), true);
comprobar('dos eventos pequeños comparten un solo objeto Page',
  (texto.match(/\/Type \/Page\b/g) || []).length, 1);

const cajas = [...texto.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
comprobar('cada pagina declara su MediaBox', cajas.length, 1);
const PUNTOS_POR_MM = 72 / 25.4;
comprobar('el MediaBox vuelve a 215 mm de ancho',
  Math.abs(Number(cajas[0][1]) / PUNTOS_POR_MM - 215) < 0.001, true);
comprobar('el MediaBox vuelve a 330 mm de alto',
  Math.abs(Number(cajas[0][2]) / PUNTOS_POR_MM - 330) < 0.001, true);
comprobar('los QR son vectores, no imagenes incrustadas',
  texto.includes('/Subtype /Image'), false);

const inicioXref = Number(texto.match(/startxref\n(\d+)\n/)[1]);
comprobar('startxref apunta a la tabla xref', texto.slice(inicioXref, inicioXref + 4), 'xref');

const entradasXref = [...texto.matchAll(/^(\d{10}) 00000 n /gm)];
comprobar('cada offset xref apunta a su objeto',
  entradasXref.every((entrada, i) =>
    texto.slice(Number(entrada[1])).startsWith(`${i + 1} 0 obj`)), true);

const flujos = [...texto.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g)];
comprobar('hay un flujo de contenido por pagina', flujos.length, 1);
comprobar('la longitud declarada de cada flujo es exacta',
  flujos.every(flujo => Number(flujo[1]) === Buffer.byteLength(flujo[2], 'latin1')), true);
comprobar('el progreso termina en el ultimo QR',
  [ultimoProgreso.hechos, ultimoProgreso.total, ultimoProgreso.pagina, ultimoProgreso.paginas],
  [2, 2, 1, 1]);

const blobCarta = await crearPdfStickers({
  campori: 'Campori de Aventureros',
  formatoPapel: 'carta',
  grupos: [grupo('A01', 1)],
}, { cederCada: 0 });
const textoCarta = Buffer.from(await blobCarta.arrayBuffer()).toString('latin1');
const cajaCarta = textoCarta.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
comprobar('el PDF carta declara 216 mm de ancho',
  Math.abs(Number(cajaCarta[1]) / PUNTOS_POR_MM - 216) < 0.001, true);
comprobar('el PDF carta declara 281,5 mm de alto',
  Math.abs(Number(cajaCarta[2]) / PUNTOS_POR_MM - 281.5) < 0.001, true);
comprobar('el PDF carta mantiene los QR vectoriales',
  textoCarta.includes('/Subtype /Image'), false);

let rechazoVacio = false;
try {
  await crearPdfStickers({ campori: 'Campori', grupos: [] }, { cederCada: 0 });
} catch {
  rechazoVacio = true;
}
comprobar('se rechaza descargar un PDF vacio', rechazoVacio, true);

console.log('');
if (fallos.length) {
  for (const fallo of fallos) console.error(`FALLA ${fallo}`);
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
