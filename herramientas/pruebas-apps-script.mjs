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

const contexto = vm.createContext({
  console,
  SpreadsheetApp: { flush() {} },
});
const codigo = fs.readFileSync(path.join(AQUI, 'apps-script.gs'), 'utf8') +
  '\nthis.__api = { asegurarMatrizPuntajes, aplicarCambiosPuntajes, leerPuntajes };';
vm.runInContext(codigo, contexto);
const { asegurarMatrizPuntajes, aplicarCambiosPuntajes, leerPuntajes } = contexto.__api;

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}

const libro = new Libro();
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

if (fallos.length) {
  fallos.forEach(f => console.error(`FALLA ${f}`));
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
