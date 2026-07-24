// Aritmetica del campo de Galois GF(256), que es donde vive Reed-Solomon.
//
// La comparten el generador de codigos QR (que calcula la redundancia) y el lector
// (que la usa para corregir errores). Polinomio primitivo 0x11D, el que fija la norma
// para codigos QR.
//
// La idea: en GF(256) cada byte distinto de cero es una potencia de a=2. Guardando
// las tablas de potencias y logaritmos, multiplicar es sumar logaritmos, que es
// muchisimo mas rapido que multiplicar polinomios bit a bit.

export const EXP = new Uint8Array(512);
export const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // Duplicamos la tabla para poder sumar dos logaritmos sin tener que hacer el
  // modulo 255 en cada multiplicacion.
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

export const div = (a, b) => {
  if (b === 0) throw new Error('division por cero en GF(256)');
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
};

export const inv = a => {
  if (a === 0) throw new Error('el cero no tiene inverso en GF(256)');
  return EXP[255 - LOG[a]];
};

/** Evalua un polinomio (coeficientes de mayor a menor grado) en x, por Horner. */
export function evaluar(polinomio, x) {
  let y = 0;
  for (const c of polinomio) y = mul(y, x) ^ c;
  return y;
}

/** Multiplica dos polinomios. Coeficientes de mayor a menor grado. */
export function multiplicarPolinomios(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) r[i + j] ^= mul(a[i], b[j]);
  }
  return r;
}

/**
 * Producto de (x - a^0)(x - a^1)...(x - a^(grado-1)).
 * El coeficiente de mayor grado siempre queda en 1.
 */
export function polinomioGenerador(grado) {
  let g = [1];
  for (let i = 0; i < grado; i++) g = multiplicarPolinomios(g, [1, EXP[i]]);
  return g;
}
