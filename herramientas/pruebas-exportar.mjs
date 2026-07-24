// Verifica que el .xlsx que generamos sea un archivo valido y que los datos vuelvan
// intactos: acentos, numeros, celdas vacias y textos con caracteres que rompen el XML.
//
//   node herramientas/pruebas-exportar.mjs
//
// Escribe el archivo en herramientas/ejemplo-exportacion.xlsx para poder abrirlo
// con Excel y comprobar a ojo que se ve bien.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { aXlsx, aCsv } from '../js/exportar.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}

// ------------------------------------------------------------------ lector de zip

function leerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no se encontro el fin del directorio central');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = new Map();
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`entrada ${i} del directorio central corrupta`);
    const metodo = buf.readUInt16LE(p + 10);
    const crcEsperado = buf.readUInt32LE(p + 16);
    const compLen = buf.readUInt32LE(p + 20);
    const nomLen = buf.readUInt16LE(p + 28);
    const extLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nomLen);
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`cabecera local de ${nombre} corrupta`);
    const lNomLen = buf.readUInt16LE(offset + 26);
    const lExtLen = buf.readUInt16LE(offset + 28);
    const inicio = offset + 30 + lNomLen + lExtLen;
    const crudo = buf.subarray(inicio, inicio + compLen);
    const datos = metodo === 0 ? crudo : zlib.inflateRawSync(crudo);
    entradas.set(nombre, { datos, crcEsperado });
    p += 46 + nomLen + extLen + comLen;
  }
  return entradas;
}

function crc32(bytes) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; }
  let c = 0xffffffff;
  for (const b of bytes) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ lector del xlsx

function leerHoja(xml) {
  const desescapar = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const colIdx = ref => { const L = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const c of L) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
  const filas = [];
  for (const fm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    for (const cm of fm[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (cm[1].match(/r="([A-Z]+\d+)"/) || [])[1];
      if (!ref) continue;
      const cuerpo = cm[2] || '';
      const inline = cuerpo.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/);
      celdas[colIdx(ref)] = inline ? desescapar(inline[1]) : v ? Number(v[1]) : null;
    }
    filas[Number(fm[1]) - 1] = celdas;
  }
  return filas;
}

// ------------------------------------------------------------------ pruebas

const hojas = [
  {
    nombre: 'Resumen',
    anchos: [10, 28, 12, 10, 10, 10, 10],
    filas: [
      ['ID', 'Club', 'Región', 'Físico', 'Espiritual', 'Adicional', 'Total'],
      ['C001', 'Aziel Calacoto Jr.', 'Región 1', 1600, 1400, 150, 3150],
      ['C017', "Ch'itis Eternal Cam", 'Región 4', 1200, 1400, 0, 2600],
      ['C070', '+ Q VENCEDORES', 'Región 12', 0, 0, 0, 0],
      ['C999', 'ediquin', 'PRUEBA', '', null, undefined, 0],
      ['C066', 'PEQUEÑOS CENTINELAS "A" & <B>', 'Región 10', 800, 600, 50, 1450],
    ],
  },
  {
    nombre: 'Detalle de escaneos',
    filas: [
      ['Club', 'Evento', 'Estado', 'Puntos'],
      ['ediquin', 'Misión espacial', 'Contado', 200],
    ],
  },
];

const blob = aXlsx(hojas);
const buf = Buffer.from(await blob.arrayBuffer());

comprobar('el blob es del tipo zip', blob.type, 'application/zip');
comprobar('empieza con la firma PK', buf.subarray(0, 2).toString('latin1'), 'PK');

const zip = leerZip(buf);
const esperados = [
  '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
  'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
];
comprobar('contiene todas las partes del xlsx', esperados.every(n => zip.has(n)), true);
comprobar('no sobran ni faltan entradas', zip.size, esperados.length);

for (const [nombre, { datos, crcEsperado }] of zip) {
  comprobar(`CRC correcto en ${nombre}`, crc32(datos), crcEsperado);
}

const wb = zip.get('xl/workbook.xml').datos.toString('utf8');
comprobar('declara las dos hojas con su nombre', [...wb.matchAll(/name="([^"]*)"/g)].map(m => m[1]),
  ['Resumen', 'Detalle de escaneos']);

const leidas = leerHoja(zip.get('xl/worksheets/sheet1.xml').datos.toString('utf8'));
comprobar('encabezado intacto', leidas[0], ['ID', 'Club', 'Región', 'Físico', 'Espiritual', 'Adicional', 'Total']);
comprobar('los numeros vuelven como numeros', leidas[1].slice(3), [1600, 1400, 150, 3150]);
comprobar('sobrevive el apostrofo', leidas[2][1], "Ch'itis Eternal Cam");
comprobar('sobrevive el simbolo +', leidas[3][1], '+ Q VENCEDORES');
comprobar('sobreviven la eñe, comillas y signos de XML', leidas[5][1], 'PEQUEÑOS CENTINELAS "A" & <B>');
comprobar('los ceros no se pierden', leidas[3].slice(3), [0, 0, 0, 0]);
comprobar('las celdas vacias quedan vacias', [leidas[4][3], leidas[4][4], leidas[4][5]], [undefined, undefined, undefined]);
comprobar('el encabezado usa el estilo en negrita',
  zip.get('xl/worksheets/sheet1.xml').datos.toString('utf8').includes('<c r="A1" s="1"'), true);
comprobar('la fila de titulos queda congelada',
  zip.get('xl/worksheets/sheet1.xml').datos.toString('utf8').includes('ySplit="1"'), true);

const hoja2 = leerHoja(zip.get('xl/worksheets/sheet2.xml').datos.toString('utf8'));
comprobar('la segunda hoja tambien se lee', hoja2[1], ['ediquin', 'Misión espacial', 'Contado', 200]);

// CSV
const csv = Buffer.from(await aCsv([['Club', 'Total'], ['Ch\'itis; "el" club', 1600]]).arrayBuffer()).toString('utf8');
comprobar('el CSV lleva BOM para que Excel lea los acentos', csv.charCodeAt(0), 0xfeff);
comprobar('el CSV entrecomilla lo que lleva separador', csv.includes('"Ch\'itis; ""el"" club"'), true);

// Dejamos una copia para revisarla con Excel.
const destino = path.join(AQUI, 'ejemplo-exportacion.xlsx');
fs.writeFileSync(destino, buf);
console.log(`Ejemplo guardado en ${path.relative(path.join(AQUI, '..'), destino)} (${buf.length} bytes)`);

console.log('');
if (fallos.length) {
  for (const f of fallos) console.error(`FALLA ${f}`);
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
