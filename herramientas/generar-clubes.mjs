// Regenera js/clubes.js a partir de "LISTAS GENERALES.xlsx".
//
//   node herramientas/generar-clubes.mjs
//   node herramientas/generar-clubes.mjs --con-directores
//
// El Excel es la planilla de pagos del campori: una fila por comprobante, no por club.
// Este script lo deduplica y normaliza. No usa librerias externas: lee el .xlsx (que es
// un zip) con zlib y parsea el XML con expresiones regulares, que alcanza de sobra para
// una planilla plana como esta.
//
// SOBRE LOS DIRECTORES: por omision NO se incluye el nombre del director o directora.
// El padron termina publicado en internet (GitHub Pages exige repositorio publico en
// las cuentas gratuitas) y son nombres de personas reales; el club se identifica igual
// con su nombre, region e iglesia. Si el sitio va a quedar en una red cerrada y los
// querés en la ficha impresa, corré el script con --con-directores.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const argumentos = process.argv.slice(2);
const CON_DIRECTORES = argumentos.includes('--con-directores');
const XLSX = argumentos.find(a => !a.startsWith('--')) || path.resolve(RAIZ, '..', 'LISTAS GENERALES.xlsx');
const SALIDA = path.join(RAIZ, 'js', 'clubes.js');

// ---------------------------------------------------------------- lectura del zip

function leerZip(archivo) {
  const buf = fs.readFileSync(archivo);
  // Buscamos el End Of Central Directory desde el final: su firma es PK\x05\x06.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No parece un archivo zip/xlsx valido: ' + archivo);

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = new Map();

  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio central corrupto');
    const metodo = buf.readUInt16LE(p + 10);
    const compLen = buf.readUInt32LE(p + 20);
    const nomLen = buf.readUInt16LE(p + 28);
    const extLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nomLen);

    // El header local repite el nombre y los extras, con largos propios.
    const lNomLen = buf.readUInt16LE(offset + 26);
    const lExtLen = buf.readUInt16LE(offset + 28);
    const inicio = offset + 30 + lNomLen + lExtLen;
    const crudo = buf.subarray(inicio, inicio + compLen);

    entradas.set(nombre, metodo === 0 ? crudo : zlib.inflateRawSync(crudo));
    p += 46 + nomLen + extLen + comLen;
  }
  return entradas;
}

// ---------------------------------------------------------------- parseo del xlsx

const desescapar = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

function columnaAIndice(ref) {
  const letras = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function leerHojas(archivo) {
  const zip = leerZip(archivo);
  const texto = nombre => {
    const b = zip.get(nombre);
    if (!b) throw new Error('Falta ' + nombre + ' dentro del xlsx');
    return b.toString('utf8');
  };

  const compartidas = [];
  if (zip.has('xl/sharedStrings.xml')) {
    for (const m of texto('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const partes = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]);
      compartidas.push(desescapar(partes.join('')));
    }
  }

  const wb = texto('xl/workbook.xml');
  const hojas = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g)];
  if (!hojas.length) throw new Error('El libro no declara ninguna hoja');

  const rels = {};
  for (const m of texto('xl/_rels/workbook.xml.rels').matchAll(/Id="([^"]*)"[^>]*Target="([^"]*)"/g)) {
    rels[m[1]] = m[2];
  }
  return hojas.map(function (declarada) {
    let destino = rels[declarada[2]];
    destino = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino;
    const xml = texto(destino);
    const filas = [];
    for (const fm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const celdas = [];
      // Las celdas vacías pueden venir como <c .../>. Si no se las reconoce de
      // forma explícita, una expresión que busca </c> termina atribuyéndoles el
      // contenido de la celda siguiente y desplaza columnas.
      for (const cm of fm[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (cm[1].match(/r="([A-Z]+\d+)"/) || [])[1];
        if (!ref) continue;
        const tipo = (cm[1].match(/t="([^"]*)"/) || [])[1];
        const contenido = cm[2] || '';
        const v = contenido.match(/<v>([\s\S]*?)<\/v>/);
        const inline = contenido.match(/<is>([\s\S]*?)<\/is>/);
        let valor = null;
        if (tipo === 's' && v) valor = compartidas[Number(v[1])];
        else if (tipo === 'inlineStr' && inline) {
          valor = desescapar([...inline[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        } else if (v) valor = desescapar(v[1]);
        if (valor != null && String(valor).trim() !== '') celdas[columnaAIndice(ref)] = String(valor).trim();
      }
      if (celdas.some(Boolean)) filas.push(celdas);
    }
    return { hoja: desescapar(declarada[1]), filas };
  });
}

// ---------------------------------------------------------------- normalizacion

// Clave de comparacion: sin tildes, sin puntuacion, sin dobles espacios, en mayusculas.
// Con esto "Messenger", "MESSENGER" y "Ch'itis Eternal Cam" colapsan como corresponde.
export function claveClub(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// De todas las formas en que se escribio un dato, elegimos la mas presentable.
// El orden importa: la planilla trae filas con las columnas corridas, asi que un
// campo puede venir como "29" donde deberia decir "PURA PURA". Descartar primero
// lo que no tiene letras evita quedarnos con esa basura.
function mejorVariante(variantes) {
  const conteo = new Map();
  for (const v of variantes) conteo.set(v, (conteo.get(v) || 0) + 1);
  return [...conteo.entries()].sort((a, b) => {
    const conLetras = s => /\p{L}/u.test(s);
    if (conLetras(a[0]) !== conLetras(b[0])) return conLetras(a[0]) ? -1 : 1;
    const grita = s => s === s.toUpperCase() && /\p{L}/u.test(s);
    if (grita(a[0]) !== grita(b[0])) return grita(a[0]) ? 1 : -1;
    return b[1] - a[1];
  })[0][0];
}

// Idem con la region: hay al menos una fila con "199" en vez de "Región 5".
// Preferimos siempre una que tenga la forma esperada.
function mejorRegion(regiones) {
  const lista = [...regiones];
  return lista.find(r => /^regi/i.test(r)) || lista[0] || '';
}

const numeroRegion = r => parseInt(String(r).replace(/\D/g, ''), 10) || 99;

// ---------------------------------------------------------------- programa

const hojasLibro = leerHojas(XLSX);
const { hoja, filas } = hojasLibro[0];
const encabezado = filas[0].map(c => (c || '').replace(/\s+/g, ' ').trim().toLowerCase());
const col = frag => encabezado.findIndex(h => h.includes(frag));

const iClub = col('nombre del club');
const iIglesia = col('iglesia');
const iDistrito = col('distrito');
const iRegion = col('regi');
const iDirector = col('nombre completo del direct');
if (iClub < 0) throw new Error('No encontre la columna "Nombre del Club" en la hoja ' + hoja);

const agrupados = new Map();
for (const f of filas.slice(1)) {
  const nombre = f[iClub];
  if (!nombre) continue;
  const clave = claveClub(nombre);
  if (!agrupados.has(clave)) {
    agrupados.set(clave, { nombres: [], iglesias: [], distritos: [], regiones: new Set(), directores: [] });
  }
  const e = agrupados.get(clave);
  e.nombres.push(nombre);
  if (iIglesia >= 0 && f[iIglesia]) e.iglesias.push(f[iIglesia]);
  if (iDistrito >= 0 && f[iDistrito]) e.distritos.push(f[iDistrito]);
  if (iRegion >= 0 && f[iRegion]) e.regiones.add(f[iRegion]);
  if (iDirector >= 0 && f[iDirector]) e.directores.push(f[iDirector]);
}

const conflictos = [...agrupados.entries()].filter(([, e]) => e.regiones.size > 1);
if (conflictos.length) {
  console.warn('AVISO: clubes con mas de una region declarada; se elige la que tiene formato valido:');
  for (const [k, e] of conflictos) {
    console.warn(`  - ${k}: ${[...e.regiones].join(' / ')}  ->  ${mejorRegion(e.regiones)}`);
  }
}

const clubesBase = [...agrupados.entries()].map(([, e]) => ({
  nombre: mejorVariante(e.nombres),
  region: mejorRegion(e.regiones),
  iglesia: e.iglesias.length ? mejorVariante(e.iglesias) : '',
  distrito: e.distritos.length ? mejorVariante(e.distritos) : '',
  director: e.directores.length ? mejorVariante(e.directores) : '',
}));

// La pestaña "LISTA GRAL. DE CLUBES" es el padrón oficial. BASE DE DATOS aporta
// iglesia/distrito, pero puede no tener pagos para todos los clubes confirmados.
const hojaLista = hojasLibro.find(h => claveClub(h.hoja).includes('LISTA GRAL DE CLUBES'));
let clubes = clubesBase;
if (hojaLista) {
  const porClaveBase = new Map(clubesBase.map(c => [claveClub(c.nombre), c]));
  const filaEncabezado = hojaLista.filas.findIndex(f =>
    f.some(c => claveClub(String(c || '')).includes('NOMBRES DE CLUBES'))
  );
  let regionActual = '';
  const padronOficial = [];
  for (const fila of hojaLista.filas.slice(filaEncabezado + 1)) {
    const numero = Number(fila[0]);
    const nombre = String(fila[2] || '').trim();
    if (!Number.isInteger(numero) || !nombre) continue;
    if (fila[1]) {
      const nRegion = parseInt(String(fila[1]).replace(/\D/g, ''), 10);
      regionActual = nRegion ? `Región ${nRegion}` : String(fila[1]).trim();
    }
    const base = porClaveBase.get(claveClub(nombre));
    padronOficial.push(base
      ? { ...base, region: regionActual || base.region }
      : { nombre, region: regionActual, iglesia: '', distrito: '', director: '' }
    );
  }
  if (padronOficial.length) clubes = padronOficial;
}

clubes.sort((a, b) => (numeroRegion(a.region) - numeroRegion(b.region)) || a.nombre.localeCompare(b.nombre, 'es'));

// Los QR de C001-C071 ya fueron entregados: regenerar desde una lista corregida no
// puede desplazar esos ID. Recuperamos el mapeo previo solo para clubes oficiales
// con región; las altas nuevas reciben el primer número libre.
const idsPrevios = new Map();
if (fs.existsSync(SALIDA)) {
  const moduloPrevio = await import(pathToFileURL(SALIDA).href + '?v=' + Date.now());
  for (const club of moduloPrevio.CLUBES || []) {
    if (club.id !== 'C999' && club.region) idsPrevios.set(claveClub(club.nombre), club.id);
  }
}
// Recuperación para un archivo generado incompleto: el primer padrón publicado se
// numeró ordenando los 71 clubes de BASE DE DATOS por región y nombre.
if (idsPrevios.size < clubesBase.length) {
  idsPrevios.clear();
  [...clubesBase]
    .sort((a, b) => (numeroRegion(a.region) - numeroRegion(b.region)) || a.nombre.localeCompare(b.nombre, 'es'))
    .forEach((club, i) => idsPrevios.set(claveClub(club.nombre), 'C' + String(i + 1).padStart(3, '0')));
}
const idsUsados = new Set();
for (const club of clubes) {
  const previo = idsPrevios.get(claveClub(club.nombre));
  if (previo && !idsUsados.has(previo)) {
    club.id = previo;
    idsUsados.add(previo);
  }
}
const siguienteId = () => {
  let numero = 1;
  while (idsUsados.has('C' + String(numero).padStart(3, '0'))) numero++;
  const id = 'C' + String(numero).padStart(3, '0');
  idsUsados.add(id);
  return id;
};
clubes.forEach(c => { if (!c.id) c.id = siguienteId(); });

// Altas confirmadas después de cerrar la planilla de inscripciones. Se agregan al
// final para conservar para siempre los ID C001-C071 que ya fueron impresos en QR.
// La región, iglesia y distrito quedan vacíos hasta que organización los complete.
const clubesExtra = [
  { nombre: 'Tucanes', region: '', iglesia: '', distrito: '', director: '' },
  { nombre: 'Pregoneros', region: '', iglesia: '', distrito: '', director: '' },
];
for (const extra of clubesExtra) {
  extra.id = siguienteId();
  clubes.push(extra);
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const cuerpo = clubes.map(c => {
  const campos = [
    `id: '${c.id}'`, `nombre: '${esc(c.nombre)}'`, `region: '${esc(c.region)}'`,
    `iglesia: '${esc(c.iglesia)}'`, `distrito: '${esc(c.distrito)}'`,
  ];
  if (CON_DIRECTORES) campos.push(`director: '${esc(c.director)}'`);
  return `  { ${campos.join(', ')} },`;
}).join('\n');

const notaDirectores = CON_DIRECTORES
  ? `//
// ATENCION: este padron INCLUYE el nombre de cada director o directora. Son datos de
// personas reales: no lo subas a un repositorio publico. Para regenerarlo sin ellos,
// corré el script sin la opcion --con-directores.`
  : `//
// No incluye el nombre de los directores a proposito: este archivo termina publicado
// y son datos personales. El club se identifica igual con su nombre, region e iglesia.
// Si los necesitás en la ficha impresa:  node herramientas/generar-clubes.mjs --con-directores`;

const js = `// Padron de clubes del Campori de Aventureros.
//
// ARCHIVO GENERADO -- no lo edites a mano.
// Fuente: "LISTAS GENERALES.xlsx", hoja "${hoja}".
// Esa planilla tiene una fila por comprobante de pago (${filas.length - 1} filas), no por club;
// aca ya vienen deduplicados y con el nombre unificado: ${clubes.length} clubes reales.
${notaDirectores}
//
// Para regenerarlo:  node herramientas/generar-clubes.mjs

export const CLUBES = [
${cuerpo}
  // Club de prueba. No participa del campori: sirve para ensayar la app sin ensuciar datos reales.
  { id: 'C999', nombre: 'ediquin', region: 'PRUEBA', iglesia: 'Club de prueba', distrito: 'Pruebas'${CON_DIRECTORES ? ", director: 'Equipo de evaluacion'" : ''} },
];

export const CLUB_PRUEBA = 'C999';

export const REGIONES = [...new Set(CLUBES.map(c => c.region))];

export function buscarClub(id) {
  return CLUBES.find(c => c.id === id) || null;
}
`;

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, js, 'utf8');

console.log(`Hoja leida: "${hoja}" (${filas.length - 1} filas de datos)`);
console.log(`Clubes unicos: ${clubes.length} (+1 de prueba) -> ${path.relative(RAIZ, SALIDA)}`);
const porRegion = new Map();
for (const c of clubes) porRegion.set(c.region, (porRegion.get(c.region) || 0) + 1);
console.log('Por region:', [...porRegion.entries()]
  .sort((a, b) => numeroRegion(a[0]) - numeroRegion(b[0]))
  .map(([r, n]) => `${r}=${n}`).join('  '));
