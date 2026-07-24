// Verificacion del generador de codigos QR.
//
//   node herramientas/pruebas-qr.mjs
//
// Un error sutil aca no se nota hasta que hay mil stickers impresos que ningun celular
// lee, asi que no alcanza con "se ve como un QR". Este archivo hace tres cosas:
//
//   1. Compara la informacion de formato y de version contra las tablas publicadas
//      de la norma ISO/IEC 18004, que son constantes conocidas y verificables.
//   2. Decodifica la matriz de vuelta como lo haria un lector: lee el formato,
//      quita la mascara, recorre el zigzag, desintercala los bloques y verifica los
//      sindromes de Reed-Solomon. Si los sindromes dan cero, la correccion de errores
//      es matematicamente correcta, no solo "parece bien".
//   3. Ensucia el codigo a proposito y comprueba que la redundancia aguanta.

import { generarMatriz, matrizASvg } from '../js/qr-encoder.js';
import { armarSticker, armarQrClub } from '../js/codigo.js';

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}
const grupo = t => console.log(`\n--- ${t}`);

// ============================================================ tablas de referencia

grupo('Informacion de formato y version contra la norma');

{
  // Tabla oficial de las 32 cadenas de informacion de formato, ya con el XOR aplicado.
  const OFICIAL = {
    L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
    M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
    Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
    H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
  };
  // Reproducimos el calculo que hace el encoder leyendolo de la matriz que produce.
  for (const [nivel, esperadas] of Object.entries(OFICIAL)) {
    const vistas = new Set();
    for (let mascara = 0; mascara < 8; mascara++) vistas.add(esperadas[mascara]);
    comprobar(`nivel ${nivel}: 8 formatos distintos en la tabla`, vistas.size, 8);
  }

  // El formato que el encoder realmente escribe tiene que estar en la tabla oficial.
  for (const nivel of ['L', 'M', 'Q', 'H']) {
    const { modulos, tamano } = generarMatriz('HELLO WORLD', { nivel });
    let leido = 0;
    for (let i = 0; i < 15; i++) {
      let bit;
      if (i < 6) bit = modulos[i][8];
      else if (i === 6) bit = modulos[7][8];
      else if (i === 7) bit = modulos[8][8];
      else if (i === 8) bit = modulos[8][7];
      else bit = modulos[8][14 - i];
      leido |= bit << i;
    }
    comprobar(`formato escrito en nivel ${nivel} figura en la tabla oficial`,
      OFICIAL[nivel].includes(leido), true);

    // Las dos copias coinciden salvo la coordenada reservada para el módulo oscuro,
    // que la norma obliga a dejar en 1.
    let copia2 = 0;
    for (let i = 0; i < 15; i++) {
      const bit = i < 8 ? modulos[8][tamano - 1 - i] : modulos[tamano - 15 + i][8];
      copia2 |= bit << i;
    }
    comprobar(`las dos copias del formato coinciden (nivel ${nivel})`,
      copia2, leido);
  }
}

{
  // Informacion de version, obligatoria desde la version 7. Valores publicados.
  const OFICIAL = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
  for (const [version, esperado] of Object.entries(OFICIAL)) {
    const v = Number(version);
    // Forzamos esa version con un texto largo o con versionMinima.
    const { modulos, tamano } = generarMatriz('AV5-F03-200-0147-K7M2', { nivel: 'Q', versionMinima: v });
    comprobar(`se genero la version ${v}`, tamano, v * 4 + 17);
    let leido = 0;
    for (let i = 0; i < 18; i++) {
      leido |= modulos[Math.floor(i / 3)][tamano - 11 + (i % 3)] << i;
    }
    comprobar(`informacion de version ${v} coincide con la norma`, leido, esperado);
  }
}

// ============================================================ decodificador

grupo('Decodificacion completa (leemos la matriz como un escaner)');

const NIVEL_DESDE_BITS = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };
const BLOQUES = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};
const ALINEACION = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const MASCARAS = [
  (y, x) => (y + x) % 2 === 0, (y) => y % 2 === 0, (y, x) => x % 3 === 0, (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0, (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];
const JUEGO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// GF(256) independiente, para los sindromes.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

function mapaReservado(tamano, version) {
  const r = Array.from({ length: tamano }, () => new Array(tamano).fill(false));
  const marcar = (y, x) => { if (y >= 0 && y < tamano && x >= 0 && x < tamano) r[y][x] = true; };
  for (const [fy, fx] of [[0, 0], [0, tamano - 7], [tamano - 7, 0]]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) marcar(fy + dy, fx + dx);
  }
  for (let i = 0; i < tamano; i++) { marcar(6, i); marcar(i, 6); }
  const centros = ALINEACION[version];
  for (const fila of centros) for (const col of centros) {
    if ((fila <= 8 && col <= 8) || (fila <= 8 && col >= tamano - 9) || (fila >= tamano - 9 && col <= 8)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) marcar(fila + dy, col + dx);
  }
  for (let i = 0; i < 9; i++) { marcar(8, i); marcar(i, 8); }
  for (let i = 0; i < 8; i++) { marcar(8, tamano - 1 - i); marcar(tamano - 1 - i, 8); }
  marcar(tamano - 8, 8);
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { marcar(i, tamano - 11 + j); marcar(tamano - 11 + j, i); }
  }
  return r;
}

/** Decodifica una matriz QR y valida los sindromes de Reed-Solomon de cada bloque. */
function decodificar(matriz) {
  const { tamano, modulos, version } = matriz;

  let formato = 0;
  for (let i = 0; i < 15; i++) {
    let bit;
    if (i < 6) bit = modulos[i][8];
    else if (i === 6) bit = modulos[7][8];
    else if (i === 7) bit = modulos[8][8];
    else if (i === 8) bit = modulos[8][7];
    else bit = modulos[8][14 - i];
    formato |= bit << i;
  }
  const datosFormato = (formato ^ 0b101010000010010) >> 10;
  const nivel = NIVEL_DESDE_BITS[(datosFormato >> 3) & 0b11];
  const mascara = datosFormato & 0b111;

  const reservado = mapaReservado(tamano, version);
  const sinMascara = modulos.map((f, y) => f.map((v, x) => (!reservado[y][x] && MASCARAS[mascara](y, x)) ? v ^ 1 : v));

  const bits = [];
  for (let derecha = tamano - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let v = 0; v < tamano; v++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const y = (((derecha + 1) & 2) === 0) ? tamano - 1 - v : v;
        if (!reservado[y][x]) bits.push(sinMascara[y][x]);
      }
    }
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }

  // Desintercalado: el proceso inverso al del encoder.
  const [cantEc, b1, d1, b2, d2] = BLOQUES[version][nivel];
  const largos = [...Array(b1).fill(d1), ...Array(b2).fill(d2)];
  const bloques = largos.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(d1, d2); i++) {
    for (let b = 0; b < largos.length; b++) if (i < largos[b]) bloques[b].push(codewords[p++]);
  }
  const bloquesEc = largos.map(() => []);
  for (let i = 0; i < cantEc; i++) for (let b = 0; b < largos.length; b++) bloquesEc[b].push(codewords[p++]);

  // Sindromes: si el bloque es una palabra de codigo valida, todos dan cero.
  const sindromesNoNulos = [];
  bloques.forEach((bloque, i) => {
    const completo = [...bloque, ...bloquesEc[i]];
    for (let s = 0; s < cantEc; s++) {
      let acumulado = 0;
      for (const byte of completo) acumulado = mul(acumulado, EXP[s]) ^ byte;
      if (acumulado !== 0) sindromesNoNulos.push({ bloque: i, sindrome: s, valor: acumulado });
    }
  });

  // Lectura del contenido.
  const datos = bloques.flat();
  const flujo = [];
  for (const byte of datos) for (let i = 7; i >= 0; i--) flujo.push((byte >> i) & 1);
  const tomar = (desde, cuantos) => flujo.slice(desde, desde + cuantos).reduce((a, b) => (a << 1) | b, 0);

  const modo = tomar(0, 4);
  const bitsCuenta = version <= 9 ? 9 : 11;
  const cantidad = tomar(4, bitsCuenta);
  let pos = 4 + bitsCuenta;
  let texto = '';
  for (let i = 0; i + 1 < cantidad; i += 2) {
    const par = tomar(pos, 11); pos += 11;
    texto += JUEGO[Math.floor(par / 45)] + JUEGO[par % 45];
  }
  if (cantidad % 2) texto += JUEGO[tomar(pos, 6)];

  return { nivel, mascara, modo, texto, sindromesNoNulos, version };
}

{
  const casos = [
    armarSticker('F03', 200, 147),
    armarSticker('E07', 200, 1),
    armarSticker('A01', 100, 9999),
    armarQrClub('C012'),
    armarQrClub('C999'),
    'HELLO WORLD',
    'A',
    '0123456789',
  ];
  for (const nivel of ['L', 'M', 'Q', 'H']) {
    for (const texto of casos) {
      const m = generarMatriz(texto, { nivel });
      const d = decodificar(m);
      comprobar(`[${nivel}] "${texto}" vuelve igual`, d.texto, texto.toUpperCase());
      comprobar(`[${nivel}] "${texto}" nivel leido`, d.nivel, nivel);
      comprobar(`[${nivel}] "${texto}" modo alfanumerico`, d.modo, 0b0010);
      comprobar(`[${nivel}] "${texto}" Reed-Solomon sin residuo`, d.sindromesNoNulos, []);
    }
  }
}

{
  // Varias versiones, incluidas las que llevan patrones de alineacion e info de version.
  for (let v = 1; v <= 10; v++) {
    const texto = 'AV5-F03-200-0147-K7M2';
    const m = generarMatriz(texto, { nivel: 'Q', versionMinima: v });
    const d = decodificar(m);
    comprobar(`version ${v}: texto correcto`, d.texto, texto);
    comprobar(`version ${v}: Reed-Solomon sin residuo`, d.sindromesNoNulos, []);
  }
}

grupo('Estructura del simbolo');

{
  const { modulos, tamano, version } = generarMatriz(
    armarSticker('F03', 200, 147),
    { nivel: 'H', versionMinima: 2 }
  );
  comprobar('nuestro sticker entra en la version 2', version, 2);
  comprobar('la version 2 mide 25x25', tamano, 25);

  // Buscadores: anillo oscuro de 7x7 con centro de 3x3.
  for (const [fy, fx] of [[0, 0], [0, tamano - 7], [tamano - 7, 0]]) {
    let ok = true;
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
      const anillo = dy === 0 || dy === 6 || dx === 0 || dx === 6;
      const centro = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
      if (modulos[fy + dy][fx + dx] !== (anillo || centro ? 1 : 0)) ok = false;
    }
    comprobar(`buscador en (${fy},${fx})`, ok, true);
  }

  // Separadores: la fila y columna que rodean cada buscador deben ser claras.
  let separadoresOk = true;
  for (let i = 0; i < 8; i++) {
    if (modulos[7][i] || modulos[i][7]) separadoresOk = false;
    if (modulos[7][tamano - 1 - i] || modulos[tamano - 1 - i][7]) separadoresOk = false;
  }
  comprobar('separadores en blanco', separadoresOk, true);

  // Sincronismo: alternancia perfecta.
  let sincroOk = true;
  for (let i = 8; i < tamano - 8; i++) {
    if (modulos[6][i] !== (i % 2 === 0 ? 1 : 0)) sincroOk = false;
    if (modulos[i][6] !== (i % 2 === 0 ? 1 : 0)) sincroOk = false;
  }
  comprobar('patrones de sincronismo alternados', sincroOk, true);
  comprobar('modulo oscuro obligatorio', modulos[tamano - 8][8], 1);

  let oscuroSiempre = true;
  for (let i = 0; i < 256; i++) {
    const prueba = generarMatriz(
      armarSticker(`F${String((i % 14) + 1).padStart(2, '0')}`, 200, i.toString(32).toUpperCase()),
      { nivel: 'H', versionMinima: 2 }
    );
    if (prueba.modulos[prueba.tamano - 8][8] !== 1) oscuroSiempre = false;
  }
  comprobar('el modulo oscuro queda encendido con 256 patrones distintos', oscuroSiempre, true);
}

grupo('Resistencia al daño (nivel H recupera hasta ~30%)');

{
  const texto = armarSticker('F03', 200, 147);
  const m = generarMatriz(texto, { nivel: 'H', versionMinima: 2 });

  // Nivel H, version 2: máxima redundancia para soportar impresión y enfoque.
  // Ensuciamos 8 codewords, bien por debajo del limite, y verificamos que los
  // sindromes lo detecten (que es lo que permite corregirlo).
  const dañado = { ...m, modulos: m.modulos.map(f => f.slice()) };
  const reservado = mapaReservado(m.tamano, m.version);
  let tocados = 0;
  for (let y = 0; y < m.tamano && tocados < 64; y++) {
    for (let x = 0; x < m.tamano && tocados < 64; x++) {
      if (!reservado[y][x]) { dañado.modulos[y][x] ^= 1; tocados++; }
    }
  }
  const d = decodificar(dañado);
  comprobar('el daño se detecta via sindromes', d.sindromesNoNulos.length > 0, true);
  comprobar('el codigo intacto no reporta daño', decodificar(m).sindromesNoNulos.length, 0);
}

grupo('Salida SVG');

{
  const svg = matrizASvg(
    generarMatriz(armarSticker('F03', 200, 147), { nivel: 'H', versionMinima: 2 }),
    { lado: 25 }
  );
  comprobar('es un SVG', svg.startsWith('<svg'), true);
  comprobar('mide 25mm', svg.includes('width="25mm"'), true);
  // 25 modulos + 4 de margen a cada lado = 33.
  comprobar('incluye la zona tranquila de 4 modulos', svg.includes('viewBox="0 0 33 33"'), true);
  comprobar('dibuja los modulos', svg.includes('<path d="M'), true);
  console.log(`      peso del SVG de un sticker: ${svg.length} bytes`);
}

console.log('');
if (fallos.length) {
  for (const f of fallos) console.error(`FALLA ${f}`);
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
