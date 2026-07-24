// Generador de codigos QR. Sin librerias: todo el proyecto tiene que funcionar sin
// internet y sin instalar nada.
//
// Soporta versiones 1 a 10 en modo alfanumerico (0-9, A-Z y unos pocos simbolos),
// que es de sobra para nuestros codigos de 21 caracteres. Los stickers se generan
// como SVG porque es vectorial: la impresora lo saca nitido a cualquier tamaño,
// cosa que un PNG a 25 mm no garantiza.
//
// Referencia: ISO/IEC 18004.

import { mul, polinomioGenerador } from './galois.js';

// ------------------------------------------------------------------ tablas

const NIVELES = { L: 0, M: 1, Q: 2, H: 3 };
const BITS_NIVEL = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

// Codewords totales (datos + correccion) por version, para versiones 1 a 10.
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

// Por [version][nivel]: [codewords de correccion por bloque,
//                        bloques del grupo 1, datos por bloque del grupo 1,
//                        bloques del grupo 2, datos por bloque del grupo 2]
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

// Centros de los patrones de alineacion.
const ALINEACION = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// Bits sobrantes que se rellenan con ceros al final del area de datos.
const BITS_RESTANTES = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

const JUEGO_ALFANUMERICO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// ------------------------------------------------------------------ correccion

function correccion(datos, cantidad) {
  const g = polinomioGenerador(cantidad);
  const resto = new Uint8Array(cantidad);
  for (const byte of datos) {
    const factor = byte ^ resto[0];
    resto.copyWithin(0, 1);
    resto[cantidad - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < cantidad; i++) resto[i] ^= mul(g[i + 1], factor);
    }
  }
  return resto;
}

// ------------------------------------------------------------------ codificacion

class Bits {
  constructor() { this.bits = []; }
  push(valor, cantidad) {
    for (let i = cantidad - 1; i >= 0; i--) this.bits.push((valor >> i) & 1);
  }
  get largo() { return this.bits.length; }
}

function capacidadDatos(version, nivel) {
  const [ec, b1, d1, b2, d2] = BLOQUES[version][nivel];
  return b1 * d1 + b2 * d2;
}

function elegirVersion(texto, nivel, versionMinima = 1) {
  for (let v = versionMinima; v <= 10; v++) {
    const bitsCuenta = v <= 9 ? 9 : 11;
    const bitsDatos = 4 + bitsCuenta + Math.floor(texto.length / 2) * 11 + (texto.length % 2 ? 6 : 0);
    if (bitsDatos <= capacidadDatos(v, nivel) * 8) return v;
  }
  throw new Error(`El texto no entra en un QR version 10 nivel ${nivel}: ${texto.length} caracteres`);
}

function codificarDatos(texto, version, nivel) {
  const bits = new Bits();
  bits.push(0b0010, 4);                       // modo alfanumerico
  bits.push(texto.length, version <= 9 ? 9 : 11);

  for (let i = 0; i + 1 < texto.length; i += 2) {
    const a = JUEGO_ALFANUMERICO.indexOf(texto[i]);
    const b = JUEGO_ALFANUMERICO.indexOf(texto[i + 1]);
    bits.push(a * 45 + b, 11);
  }
  if (texto.length % 2) {
    bits.push(JUEGO_ALFANUMERICO.indexOf(texto[texto.length - 1]), 6);
  }

  const capacidadBits = capacidadDatos(version, nivel) * 8;
  bits.push(0, Math.min(4, capacidadBits - bits.largo));       // terminador
  while (bits.largo % 8) bits.bits.push(0);                    // hasta byte entero

  const codewords = [];
  for (let i = 0; i < bits.largo; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits.bits[i + j];
    codewords.push(byte);
  }
  // Relleno alternado que exige la norma.
  const relleno = [0xec, 0x11];
  for (let i = 0; codewords.length < capacidadDatos(version, nivel); i++) {
    codewords.push(relleno[i % 2]);
  }
  return codewords;
}

// Los bloques no se escriben uno detras del otro sino intercalados, para que una
// mancha en el sticker reparta el daño entre todos y ninguno quede irrecuperable.
function intercalar(codewords, version, nivel) {
  const [cantEc, b1, d1, b2, d2] = BLOQUES[version][nivel];
  const bloques = [];
  let p = 0;
  for (let i = 0; i < b1; i++) { bloques.push(codewords.slice(p, p + d1)); p += d1; }
  for (let i = 0; i < b2; i++) { bloques.push(codewords.slice(p, p + d2)); p += d2; }

  const bloquesEc = bloques.map(b => correccion(b, cantEc));
  const salida = [];
  const maxDatos = Math.max(d1, d2);
  for (let i = 0; i < maxDatos; i++) {
    for (const b of bloques) if (i < b.length) salida.push(b[i]);
  }
  for (let i = 0; i < cantEc; i++) {
    for (const b of bloquesEc) salida.push(b[i]);
  }
  return salida;
}

// ------------------------------------------------------------------ matriz

function nuevaMatriz(tamano) {
  return Array.from({ length: tamano }, () => new Array(tamano).fill(null));
}

function ponerBuscador(m, fila, col) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const y = fila + dy, x = col + dx;
      if (y < 0 || y >= m.length || x < 0 || x >= m.length) continue;
      const borde = dy === -1 || dy === 7 || dx === -1 || dx === 7;
      const anillo = (dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6) &&
        (dy === 0 || dy === 6 || dx === 0 || dx === 6);
      const centro = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
      m[y][x] = borde ? 0 : (anillo || centro) ? 1 : 0;
    }
  }
}

function ponerAlineacion(m, fila, col) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      m[fila + dy][col + dx] = (Math.max(Math.abs(dy), Math.abs(dx)) !== 1) ? 1 : 0;
    }
  }
}

function bchFormato(datos) {
  let v = datos << 10;
  for (let i = 14; i >= 10; i--) {
    if ((v >> i) & 1) v ^= 0b10100110111 << (i - 10);
  }
  return ((datos << 10) | v) ^ 0b101010000010010;
}

function bchVersion(version) {
  // Generador BCH(18,6): x^12+x^11+x^10+x^9+x^8+x^5+x^2+1
  let v = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((v >> i) & 1) v ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | v;
}

const MASCARAS = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

// Las cuatro reglas de penalizacion de la norma. Se prueba cada mascara y gana la
// que deja el dibujo mas "desordenado": eso es lo que un lector distingue mejor.
function penalizacion(m) {
  const n = m.length;
  let total = 0;

  // Regla 1: rachas de 5 o mas modulos iguales.
  for (let i = 0; i < n; i++) {
    for (const leerFila of [true, false]) {
      let anterior = -1, racha = 0;
      for (let j = 0; j < n; j++) {
        const v = leerFila ? m[i][j] : m[j][i];
        if (v === anterior) { racha++; } else { anterior = v; racha = 1; }
        if (racha === 5) total += 3;
        else if (racha > 5) total += 1;
      }
    }
  }

  // Regla 2: bloques de 2x2 del mismo color.
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) total += 3;
    }
  }

  // Regla 3: el patron 1:1:3:1:1 seguido de 4 claros, que imita a un buscador.
  const patronA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patronB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j + 11 <= n; j++) {
      for (const leerFila of [true, false]) {
        let coincideA = true, coincideB = true;
        for (let k = 0; k < 11; k++) {
          const v = leerFila ? m[i][j + k] : m[j + k][i];
          if (v !== patronA[k]) coincideA = false;
          if (v !== patronB[k]) coincideB = false;
        }
        if (coincideA) total += 40;
        if (coincideB) total += 40;
      }
    }
  }

  // Regla 4: desbalance entre modulos oscuros y claros.
  let oscuros = 0;
  for (const fila of m) for (const v of fila) if (v) oscuros++;
  const porcentaje = (oscuros * 100) / (n * n);
  total += Math.floor(Math.abs(porcentaje - 50) / 5) * 10;

  return total;
}

/**
 * Arma la matriz de un codigo QR.
 * @returns {{ tamano: number, version: number, modulos: number[][] }}
 */
export function generarMatriz(texto, { nivel = 'Q', versionMinima = 1 } = {}) {
  const limpio = String(texto).toUpperCase();
  for (const ch of limpio) {
    if (JUEGO_ALFANUMERICO.indexOf(ch) < 0) {
      throw new Error(`Caracter "${ch}" fuera del juego alfanumerico QR`);
    }
  }
  if (!(nivel in NIVELES)) throw new Error(`Nivel de correccion desconocido: ${nivel}`);

  const version = elegirVersion(limpio, nivel, versionMinima);
  const tamano = version * 4 + 17;
  const datos = intercalar(codificarDatos(limpio, version, nivel), version, nivel);

  // --- estructura fija
  const base = nuevaMatriz(tamano);
  ponerBuscador(base, 0, 0);
  ponerBuscador(base, 0, tamano - 7);
  ponerBuscador(base, tamano - 7, 0);

  const centros = ALINEACION[version];
  for (const fila of centros) {
    for (const col of centros) {
      // Los tres vertices los ocupan los buscadores.
      if ((fila <= 8 && col <= 8) || (fila <= 8 && col >= tamano - 9) || (fila >= tamano - 9 && col <= 8)) continue;
      ponerAlineacion(base, fila, col);
    }
  }

  for (let i = 8; i < tamano - 8; i++) {
    base[6][i] = base[i][6] = i % 2 === 0 ? 1 : 0;   // patrones de sincronismo
  }
  base[tamano - 8][8] = 1;                            // modulo oscuro obligatorio

  // Reservamos las areas de formato y version para que el relleno de datos las esquive.
  const reservado = Array.from({ length: tamano }, () => new Array(tamano).fill(false));
  for (let i = 0; i < tamano; i++) {
    for (let j = 0; j < tamano; j++) if (base[i][j] !== null) reservado[i][j] = true;
  }
  const reservar = (y, x) => { reservado[y][x] = true; if (base[y][x] === null) base[y][x] = 0; };
  for (let i = 0; i < 9; i++) { reservar(8, i); reservar(i, 8); }
  for (let i = 0; i < 8; i++) { reservar(8, tamano - 1 - i); reservar(tamano - 1 - i, 8); }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) { reservar(i, tamano - 11 + j); reservar(tamano - 11 + j, i); }
    }
  }

  // --- datos en zigzag desde abajo a la derecha
  const bits = [];
  for (const byte of datos) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  for (let i = 0; i < BITS_RESTANTES[version - 1]; i++) bits.push(0);

  let k = 0;
  for (let derecha = tamano - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;               // la columna 6 es de sincronismo
    for (let v = 0; v < tamano; v++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const sube = ((derecha + 1) & 2) === 0;
        const y = sube ? tamano - 1 - v : v;
        if (!reservado[y][x] && k < bits.length) base[y][x] = bits[k++];
      }
    }
  }

  // --- probamos las 8 mascaras y nos quedamos con la mejor
  let mejor = null;
  for (let mascara = 0; mascara < 8; mascara++) {
    const m = base.map(f => f.slice());
    for (let y = 0; y < tamano; y++) {
      for (let x = 0; x < tamano; x++) {
        if (!reservado[y][x] && MASCARAS[mascara](y, x)) m[y][x] ^= 1;
      }
    }

    const formato = bchFormato((BITS_NIVEL[nivel] << 3) | mascara);
    for (let i = 0; i < 15; i++) {
      const bit = (formato >> i) & 1;
      // Copia 1, alrededor del buscador superior izquierdo.
      if (i < 6) m[8][i] = bit;
      else if (i === 6) m[8][7] = bit;
      else if (i === 7) m[8][8] = bit;
      else if (i === 8) m[7][8] = bit;
      else m[14 - i][8] = bit;
      // Copia 2, repartida entre los otros dos buscadores.
      if (i < 8) m[tamano - 1 - i][8] = bit;
      else m[8][tamano - 15 + i] = bit;
    }
    // El módulo oscuro fijo comparte coordenada con la zona donde se copia el
    // formato. La norma exige que quede siempre encendido, independientemente de
    // la máscara elegida. Reafirmarlo acá evita QR que algunos lectores rechazan.
    m[tamano - 8][8] = 1;

    if (version >= 7) {
      const info = bchVersion(version);
      for (let i = 0; i < 18; i++) {
        const bit = (info >> i) & 1;
        m[Math.floor(i / 3)][tamano - 11 + (i % 3)] = bit;
        m[tamano - 11 + (i % 3)][Math.floor(i / 3)] = bit;
      }
    }

    const p = penalizacion(m);
    if (!mejor || p < mejor.p) mejor = { p, m };
  }

  return { tamano, version, modulos: mejor.m };
}

/**
 * Dibuja la matriz como SVG. El margen va en modulos: la norma pide 4 como minimo
 * ("zona tranquila") y sin el los lectores fallan aunque el codigo este perfecto.
 */
export function matrizASvg(matriz, { lado = 25, margen = 4, color = '#000', fondo = '#fff' } = {}) {
  const { tamano, modulos } = matriz;
  const total = tamano + margen * 2;

  // Un solo path con todos los modulos, agrupando los oscuros consecutivos de cada
  // fila en un rectangulo. Un <rect> por modulo, o un tramo por modulo, multiplica
  // por tres el peso del archivo, y una hoja lleva 56 stickers.
  let d = '';
  for (let y = 0; y < tamano; y++) {
    let x = 0;
    while (x < tamano) {
      if (!modulos[y][x]) { x++; continue; }
      let fin = x;
      while (fin < tamano && modulos[y][fin]) fin++;
      const ancho = fin - x;
      d += `M${x + margen} ${y + margen}h${ancho}v1h-${ancho}z`;
      x = fin;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="${lado}mm" height="${lado}mm" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${fondo}"/>` +
    `<path d="${d}" fill="${color}"/></svg>`;
}

/** Atajo: texto -> SVG. */
export function textoASvg(texto, opciones = {}) {
  return matrizASvg(generarMatriz(texto, opciones), opciones);
}
