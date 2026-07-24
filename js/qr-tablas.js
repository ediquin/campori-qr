// Tablas estructurales del estandar QR (ISO/IEC 18004), versiones 1 a 10.
// Las comparten el generador y el lector, para que no puedan quedar desincronizados.

export const NIVELES = ['L', 'M', 'Q', 'H'];

// Los dos bits con que cada nivel de correccion se codifica en la informacion de formato.
export const BITS_NIVEL = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
export const NIVEL_DESDE_BITS = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };

// Codewords totales (datos + correccion) por version.
export const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

// Por [version][nivel]: [codewords de correccion por bloque,
//                        bloques del grupo 1, datos por bloque del grupo 1,
//                        bloques del grupo 2, datos por bloque del grupo 2]
export const BLOQUES = {
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

// Centros de los patrones de alineacion. La version 1 no tiene.
export const ALINEACION = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// Bits sobrantes que se rellenan con ceros al final del area de datos.
export const BITS_RESTANTES = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

export const JUEGO_ALFANUMERICO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// Las ocho mascaras: devuelven true donde hay que invertir el modulo.
export const MASCARAS = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

export const tamanoDeVersion = version => version * 4 + 17;
export const versionDeTamano = tamano => (tamano - 17) / 4;

export function capacidadDatos(version, nivel) {
  const [, b1, d1, b2, d2] = BLOQUES[version][nivel];
  return b1 * d1 + b2 * d2;
}

/**
 * Marca que modulos pertenecen a los patrones fijos (buscadores, sincronismo,
 * alineacion, formato y version). Son los que el relleno de datos tiene que esquivar,
 * tanto al escribir como al leer.
 */
export function mapaReservado(version) {
  const n = tamanoDeVersion(version);
  const r = Array.from({ length: n }, () => new Array(n).fill(false));
  const marcar = (y, x) => { if (y >= 0 && y < n && x >= 0 && x < n) r[y][x] = true; };

  // Buscadores con su separador.
  for (const [fy, fx] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) marcar(fy + dy, fx + dx);
  }
  // Sincronismo.
  for (let i = 0; i < n; i++) { marcar(6, i); marcar(i, 6); }
  // Alineacion, salteando los vertices que ya ocupan los buscadores.
  const centros = ALINEACION[version];
  for (const fila of centros) {
    for (const col of centros) {
      if ((fila <= 8 && col <= 8) || (fila <= 8 && col >= n - 9) || (fila >= n - 9 && col <= 8)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) marcar(fila + dy, col + dx);
    }
  }
  // Informacion de formato y modulo oscuro obligatorio.
  for (let i = 0; i < 9; i++) { marcar(8, i); marcar(i, 8); }
  for (let i = 0; i < 8; i++) { marcar(8, n - 1 - i); marcar(n - 1 - i, 8); }
  marcar(n - 8, 8);
  // Informacion de version.
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) { marcar(i, n - 11 + j); marcar(n - 11 + j, i); }
    }
  }
  return r;
}

/**
 * Recorre el area de datos en zigzag desde abajo a la derecha, que es el orden en
 * que la norma coloca los bits. Llama a `visitar(fila, columna)` en cada modulo.
 */
export function recorrerDatos(version, visitar) {
  const n = tamanoDeVersion(version);
  const reservado = mapaReservado(version);
  for (let derecha = n - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;               // la columna 6 es de sincronismo
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const sube = ((derecha + 1) & 2) === 0;
        const y = sube ? n - 1 - v : v;
        if (!reservado[y][x]) visitar(y, x);
      }
    }
  }
}
