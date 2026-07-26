// Ejecuta las funciones críticas de apps-script.gs contra una planilla en memoria.
// No intenta imitar todo Google Sheets: verifica estructura, columnas y parches
// concurrentes, que son las partes donde un error puede pisar puntajes.

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

class Rango {
  constructor(hoja, fila, columna, filas = 1, columnas = 1) {
    this.hoja = hoja;
    this.fila = fila - 1;
    this.columna = columna - 1;
    this.filas = filas;
    this.columnas = columnas;
  }
  getValues() {
    return Array.from({ length: this.filas }, (_, y) =>
      Array.from({ length: this.columnas }, (_, x) =>
        this.hoja.valor(this.fila + y, this.columna + x)
      )
    );
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(matriz) {
    for (let y = 0; y < this.filas; y++) {
      for (let x = 0; x < this.columnas; x++) {
        this.hoja.poner(this.fila + y, this.columna + x, matriz[y][x]);
      }
    }
    return this;
  }
  setValue(valor) { return this.setValues([[valor]]); }
  setFormulasR1C1(matriz) { return this.setValues(matriz); }
  setFormulaR1C1(formula) { return this.setValue(formula); }
  getFormulasR1C1() {
    return this.getValues().map(fila =>
      fila.map(valor => typeof valor === 'string' && valor.startsWith('=') ? valor : '')
    );
  }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
  createFilter() {
    this.hoja.filtro = { remove: () => { this.hoja.filtro = null; } };
    return this.hoja.filtro;
  }
}

class Hoja {
  constructor(nombre) {
    this.nombre = nombre;
    this.celdas = [];
    this.filtro = null;
  }
  valor(fila, columna) { return this.celdas[fila]?.[columna] ?? ''; }
  poner(fila, columna, valor) {
    while (this.celdas.length <= fila) this.celdas.push([]);
    while (this.celdas[fila].length <= columna) this.celdas[fila].push('');
    this.celdas[fila][columna] = valor;
  }
  getLastRow() {
    let ultima = 0;
    this.celdas.forEach((fila, i) => {
      if (fila.some(v => v !== '' && v != null)) ultima = i + 1;
    });
    return ultima;
  }
  getLastColumn() {
    return this.celdas.reduce((max, fila) => {
      let ultima = 0;
      fila.forEach((v, i) => { if (v !== '' && v != null) ultima = i + 1; });
      return Math.max(max, ultima);
    }, 0);
  }
  getRange(fila, columna, filas = 1, columnas = 1) {
    return new Rango(this, fila, columna, filas, columnas);
  }
  appendRow(fila) { this.celdas.push([...fila]); }
  clearContents() { this.celdas = []; }
  setFrozenRows() {}
  setFrozenColumns() {}
  setColumnWidth() {}
  setColumnWidths() {}
  autoResizeColumns() {}
  getFilter() { return this.filtro; }
}

class Libro {
  constructor() { this.hojas = new Map(); }
  getSheetByName(nombre) { return this.hojas.get(nombre) || null; }
  insertSheet(nombre) {
    const hoja = new Hoja(nombre);
    this.hojas.set(nombre, hoja);
    return hoja;
  }
}

let libroActivo = null;
const bloqueo = {
  intentos: 0,
  liberaciones: 0,
  tryLock() { this.intentos++; return true; },
  releaseLock() { this.liberaciones++; },
};
const contexto = vm.createContext({
  console,
  SpreadsheetApp: {
    flush() {},
    getActiveSpreadsheet() { return libroActivo; },
  },
  LockService: { getScriptLock() { return bloqueo; } },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(texto) {
      return {
        texto,
        setMimeType() { return this; },
      };
    },
  },
});
const codigo = fs.readFileSync(path.join(AQUI, 'apps-script.gs'), 'utf8') +
  '\nthis.__api = { asegurarMatrizPuntajes, aplicarCambiosPuntajes, leerPuntajes, ' +
  'asegurarHojaDetalle, leerDetalle, huellaCodigosDetalle, limitarHojasAClubes, ' +
  'doGet, doPost };';
vm.runInContext(codigo, contexto);
const {
  asegurarMatrizPuntajes,
  aplicarCambiosPuntajes,
  leerPuntajes,
  asegurarHojaDetalle,
  leerDetalle,
  huellaCodigosDetalle,
  limitarHojasAClubes,
  doGet,
  doPost,
} = contexto.__api;

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}

const libro = new Libro();
libroActivo = libro;
const padron = [
  { id: 'C001', nombre: 'Uno', region: 'Región 1' },
  { id: 'C002', nombre: 'Dos', region: 'Región 2' },
  { id: 'C999', nombre: 'Prueba', region: 'PRUEBA' },
];
const eventos = [
  { codigo: 'F01', nombre: 'Físico uno' },
  { codigo: 'E01', nombre: 'Espiritual uno' },
  { codigo: 'A01', nombre: 'Adicional uno' },
  { codigo: 'S01', nombre: 'Sanción uno' },
];

asegurarMatrizPuntajes(libro, padron, eventos);
const hoja = libro.getSheetByName('Puntajes');
comprobar('crea una fila por club oficial y excluye C999', hoja.getLastRow(), 3);
comprobar('crea metadatos, una columna por evento y TOTAL',
  hoja.getRange(1, 1, 1, 11).getValues()[0],
  ['ID', 'Club', 'Región', 'F01 · Físico uno', 'E01 · Espiritual uno',
    'A01 · Adicional uno', 'S01 · Sanción uno', 'TOTAL', 'Revisión', 'Actualizado', 'Evaluador']);
comprobar('inicializa eventos en cero',
  hoja.getRange(2, 4, 2, 4).getValues(),
  [[0, 0, 0, 0], [0, 0, 0, 0]]);

const primero = aplicarCambiosPuntajes(libro, [{
  idClub: 'C001',
  eventos: { F01: 200 },
  anteriores: { F01: 0 },
}], 'Teléfono A');
const segundo = aplicarCambiosPuntajes(libro, [{
  idClub: 'C002',
  eventos: { E01: 200 },
  anteriores: { E01: 0 },
}], 'Teléfono B');
comprobar('dos clubes distintos se aplican sin pisarse',
  [primero.aplicados, segundo.aplicados, hoja.getRange(2, 4, 2, 2).getValues()],
  [['C001'], ['C002'], [[200, 0], [0, 200]]]);

const otraColumna = aplicarCambiosPuntajes(libro, [{
  idClub: 'C001',
  eventos: { A01: 100 },
  anteriores: { A01: 0 },
}], 'Teléfono B');
comprobar('otro evento del mismo club conserva el anterior',
  [otraColumna.conflictos.length, hoja.getRange(2, 4, 1, 3).getValues()[0]],
  [0, [200, 0, 100]]);

const choque = aplicarCambiosPuntajes(libro, [{
  idClub: 'C001',
  eventos: { F01: 100 },
  anteriores: { F01: 0 },
}], 'Teléfono C');
comprobar('la misma celda desactualizada se rechaza y conserva su valor',
  [choque.aplicados, choque.conflictos.map(c => c.codigo), hoja.getRange(2, 4).getValues()[0][0]],
  [[], ['F01'], 200]);

const estado = leerPuntajes(libro);
comprobar('la lectura reconoce el catálogo desde los encabezados',
  estado.eventos.map(e => e.codigo), ['F01', 'E01', 'A01', 'S01']);
comprobar('la lectura devuelve los puntajes por ID',
  estado.puntajes.map(f => [f.idClub, f.eventos.F01, f.eventos.E01]),
  [['C001', 200, 0], ['C002', 0, 200]]);
comprobar('la lectura confirma que TOTAL conserva su fórmula',
  estado.puntajes.map(f => f.totalConFormula), [true, true]);
hoja.getRange(3, 8).setValue(200);
comprobar('detecta un TOTAL escrito a mano aunque el número parezca correcto',
  leerPuntajes(libro).puntajes.find(f => f.idClub === 'C002').totalConFormula, false);
hoja.getRange(3, 8).setFormulaR1C1('=MAX(0,SUM(RC4:RC[-1]))');

asegurarHojaDetalle(libro);
const detalle = libro.getSheetByName('Detalle de escaneos');
comprobar('la preparación crea el encabezado de Detalle',
  [detalle.getLastRow(), detalle.getRange(1, 1).getValues()[0][0]], [1, 'ID']);
detalle.getRange(1, 1, 2, 4).setValues([
  ['ID', 'Código QR', 'Evaluador', 'Marca de tiempo'],
  ['C001', 'AV5-F01-00000001-ABCD', 'Teléfono A', 1],
]);
const revisionDetalle = leerDetalle(libro).revisionesDetalle.C001;
const conRevision = aplicarCambiosPuntajes(libro, [{
  idClub: 'C001',
  eventos: { E01: 200 },
  anteriores: { E01: 0 },
  revisionDetalle,
}], 'Reconciliador');
comprobar('una reparación con la huella vigente de Detalle se aplica',
  [conRevision.conflictos.length, hoja.getRange(2, 5).getValues()[0][0]],
  [0, 200]);

detalle.getRange(3, 1, 1, 4).setValues([
  ['C001', 'AV5-F02-00000002-EFGH', 'Teléfono B', 2],
]);
const revisionNueva = leerDetalle(libro).revisionesDetalle.C001;
comprobar('la huella cambia cuando aparece otro QR',
  revisionNueva === revisionDetalle, false);
const obsoleta = aplicarCambiosPuntajes(libro, [{
  idClub: 'C001',
  eventos: { S01: -500 },
  anteriores: { S01: 0 },
  revisionDetalle,
}], 'Reconciliador');
comprobar('una reparación obsoleta se rechaza antes de tocar la matriz',
  [
    obsoleta.aplicados,
    obsoleta.conflictos.map(c => c.codigo),
    hoja.getRange(2, 7).getValues()[0][0],
  ],
  [[], ['DETALLE'], 0]);

const auxiliaresFiltradas = limitarHojasAClubes([{
  nombre: 'Detalle de escaneos',
  claveColumna: 0,
  clubesReemplazar: ['C001', 'C002'],
  filas: [
    ['ID', 'Código QR'],
    ['C001', 'F01-AAAA'],
    ['C002', 'F02-BBBB'],
  ],
}], ['C002']);
comprobar('un conflicto de matriz impide reemplazar el Detalle de ese club',
  [
    auxiliaresFiltradas[0].clubesReemplazar,
    auxiliaresFiltradas[0].filas,
  ],
  [['C002'], [['ID', 'Código QR'], ['C002', 'F02-BBBB']]]);

const bloqueosAntes = [bloqueo.intentos, bloqueo.liberaciones];
const respuestaGet = JSON.parse(doGet({
  parameter: { accion: 'estado', clave: 'cambiame-por-una-frase-tuya' },
}).texto);
comprobar('doGet toma y libera el mismo bloqueo de escritura',
  [
    bloqueo.intentos - bloqueosAntes[0],
    bloqueo.liberaciones - bloqueosAntes[1],
    respuestaGet.version,
    respuestaGet.detalleDisponible,
  ],
  [1, 1, 3, true]);

const libroConcurrencia = new Libro();
asegurarMatrizPuntajes(
  libroConcurrencia,
  [{ id: 'C001', nombre: 'Uno', region: 'Región 1' }],
  [{ codigo: 'F01', nombre: 'Físico' }, { codigo: 'E01', nombre: 'Espiritual' }]
);
asegurarHojaDetalle(libroConcurrencia);
libroActivo = libroConcurrencia;
const revisionInicial = huellaCodigosDetalle([]);
const encabezadoDetalle = [
  'ID', 'Club', 'Región', 'Orden', 'Código', 'Evento', 'Tipo', 'Estado',
  'Puntos', 'Motivo', 'Evaluador', 'Fecha y hora', 'Código QR', 'Marca de tiempo',
];
const enviarPost = datos => JSON.parse(doPost({
  postData: {
    contents: JSON.stringify({
      clave: 'cambiame-por-una-frase-tuya',
      dispositivo: datos.dispositivo,
      clubes: 'Uno',
      hojas: [{
        nombre: 'Detalle de escaneos',
        claveColumna: 0,
        clubesReemplazar: ['C001'],
        filas: [encabezadoDetalle, datos.detalle],
      }],
      cambios: [datos.cambio],
      padron: [],
      eventos: [],
    }),
  },
}).texto);
const postA = enviarPost({
  dispositivo: 'Teléfono A',
  detalle: [
    'C001', 'Uno', 'Región 1', 1, 'F01', 'Físico', 'Físico', 'Contado',
    200, '', 'Teléfono A', '', 'AV5-F01-00000001-AAAA', 1,
  ],
  cambio: {
    idClub: 'C001',
    eventos: { F01: 200 },
    anteriores: { F01: 0 },
    revisionDetalle: revisionInicial,
  },
});
const postB = enviarPost({
  dispositivo: 'Teléfono B',
  detalle: [
    'C001', 'Uno', 'Región 1', 1, 'E01', 'Espiritual', 'Espiritual', 'Contado',
    200, '', 'Teléfono B', '', 'AV5-E01-00000002-BBBB', 2,
  ],
  cambio: {
    idClub: 'C001',
    eventos: { E01: 200 },
    anteriores: { E01: 0 },
    revisionDetalle: revisionInicial,
  },
});
const matrizConcurrente = leerPuntajes(libroConcurrencia).puntajes[0];
const detalleConcurrente = leerDetalle(libroConcurrencia).escaneos;
const revisionPostA = leerDetalle(libroConcurrencia).revisionesDetalle.C001;
comprobar('dos teléfonos con la misma foto inicial: el segundo se rechaza completo',
  [
    postA.ok,
    postA.revisionesDetalle.C001,
    postB.ok,
    postB.conflictos.map(c => c.codigo),
    matrizConcurrente.eventos,
    detalleConcurrente.map(e => e.crudo),
  ],
  [
    true,
    revisionPostA,
    false,
    ['DETALLE'],
    { F01: 200, E01: 0 },
    ['AV5-F01-00000001-AAAA'],
  ]);
const postAntiguo = enviarPost({
  dispositivo: 'Teléfono sin actualizar',
  detalle: [
    'C001', 'Uno', 'Región 1', 1, 'E01', 'Espiritual', 'Espiritual', 'Contado',
    200, '', 'Teléfono sin actualizar', '', 'AV5-E01-00000003-CCCC', 3,
  ],
  cambio: {
    idClub: 'C001',
    eventos: { E01: 200 },
    anteriores: { E01: 0 },
  },
});
comprobar('la API 3 rechaza clientes viejos sin huella y conserva Detalle',
  [
    postAntiguo.ok,
    postAntiguo.conflictos.map(c => c.codigo),
    leerPuntajes(libroConcurrencia).puntajes[0].eventos.E01,
    leerDetalle(libroConcurrencia).escaneos.map(e => e.crudo),
  ],
  [false, ['DETALLE'], 0, ['AV5-F01-00000001-AAAA']]);

const encabezadoAntesDelLegado =
  libroConcurrencia.getSheetByName('Detalle de escaneos')
    .getRange(1, 1, 1, encabezadoDetalle.length).getValues()[0];
const postSoloHojaLegada = JSON.parse(doPost({
  postData: {
    contents: JSON.stringify({
      clave: 'cambiame-por-una-frase-tuya',
      dispositivo: 'Teléfono muy antiguo',
      clubes: 'Uno',
      hojas: [{
        nombre: 'Detalle de escaneos',
        reemplazar: true,
        filas: [
          ['ID', 'Encabezado roto'],
          ['C001', 'AV5-E01-00000004-DDDD'],
        ],
      }],
      cambios: [],
      padron: [],
      eventos: [],
    }),
  },
}).texto);
comprobar('un cliente legado no puede reemplazar Detalle enviando solo hojas',
  [
    postSoloHojaLegada.ok,
    postSoloHojaLegada.conflictos.map(c => c.codigo),
    leerDetalle(libroConcurrencia).escaneos.map(e => e.crudo),
    libroConcurrencia.getSheetByName('Detalle de escaneos')
      .getRange(1, 1, 1, encabezadoDetalle.length).getValues()[0],
  ],
  [
    false,
    ['DETALLE'],
    ['AV5-F01-00000001-AAAA'],
    encabezadoAntesDelLegado,
  ]);

const libroA36 = new Libro();
asegurarMatrizPuntajes(
  libroA36,
  [{ id: 'C001', nombre: 'Uno', region: 'Región 1' }],
  [{ codigo: 'A36', nombre: 'Puntos extra' }]
);
asegurarHojaDetalle(libroA36);
libroActivo = libroA36;
const enviarA36 = (dispositivo, qr, revision) => JSON.parse(doPost({
  postData: {
    contents: JSON.stringify({
      clave: 'cambiame-por-una-frase-tuya',
      dispositivo,
      clubes: 'Uno',
      hojas: [{
        nombre: 'Detalle de escaneos',
        claveColumna: 0,
        clubesReemplazar: ['C001'],
        filas: [
          encabezadoDetalle,
          [
            'C001', 'Uno', 'Región 1', 1, 'A36', 'Puntos extra', 'Adicional', 'Contado',
            50, '', dispositivo, '', qr, 1,
          ],
        ],
      }],
      cambios: [{
        idClub: 'C001',
        eventos: { A36: 50 },
        anteriores: { A36: 0 },
        revisionDetalle: revision,
      }],
      padron: [],
      eventos: [],
    }),
  },
}).texto);
const a36A = enviarA36('Teléfono A', 'AV5-A36-00000001-AAAA', revisionInicial);
const a36B = enviarA36('Teléfono B', 'AV5-A36-00000002-BBBB', revisionInicial);
const a36BReintento = enviarA36('Teléfono B', 'AV5-A36-00000002-BBBB', revisionInicial);
comprobar('Puntos extra concurrente no se pierde ni siquiera tras un reintento obsoleto',
  [
    a36A.ok,
    a36A.revisionesDetalle.C001,
    a36B.ok,
    a36BReintento.ok,
    a36BReintento.conflictos.map(c => c.codigo),
    leerPuntajes(libroA36).puntajes[0].eventos.A36,
    leerDetalle(libroA36).escaneos.map(e => e.crudo),
  ],
  [
    true,
    leerDetalle(libroA36).revisionesDetalle.C001,
    false,
    false,
    ['DETALLE'],
    50,
    ['AV5-A36-00000001-AAAA'],
  ]);
libroActivo = libro;

const libroFisicos = new Libro();
const catorceFisicos = Array.from({ length: 14 }, (_, i) => {
  const codigo = `F${String(i + 1).padStart(2, '0')}`;
  return { codigo, nombre: `Físico ${i + 1}` };
});
asegurarMatrizPuntajes(
  libroFisicos,
  [{ id: 'C024', nombre: 'Central', region: 'Región 5' }],
  catorceFisicos
);
const hojaFisicos = libroFisicos.getSheetByName('Puntajes');
const parcheFisicos = Object.fromEntries(catorceFisicos.map(e => [e.codigo, 200]));
const cerosFisicos = Object.fromEntries(catorceFisicos.map(e => [e.codigo, 0]));
const fisicosAplicados = aplicarCambiosPuntajes(libroFisicos, [{
  idClub: 'C024',
  eventos: parcheFisicos,
  anteriores: cerosFisicos,
}], 'Control QA');
const estadoFisicos = leerPuntajes(libroFisicos);
comprobar('Apps Script acepta y conserva las catorce columnas físicas',
  [
    fisicosAplicados.conflictos.length,
    Object.values(estadoFisicos.puntajes[0].eventos).filter(v => v === 200).length,
  ],
  [0, 14]);
comprobar('TOTAL abarca desde F01 hasta la última columna de evento',
  hojaFisicos.getRange(2, 18).getValues()[0][0],
  '=MAX(0,SUM(RC4:RC[-1]))');

if (fallos.length) {
  fallos.forEach(f => console.error(`FALLA ${f}`));
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
