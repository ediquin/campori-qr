// Formato de los codigos QR, y su firma.
//
// Sticker de evento actual:  F03-7K9M2Q8R
//                            |   +------- identificador aleatorio unico
//                            +----------- codigo del evento
//
// QR de club (va en la cabecera de la ficha):  AV5-CLUB-C012-K7M2
//
// El contenido es corto y se imprime en versión 2 con corrección H. Conservamos el
// patrón de alineación de esa versión porque el lector propio resiste mucho mejor
// cuando el teléfono está inclinado. También se aceptan los QR firmados antiguos.
//
// Los stickers nuevos no llevan firma. Por decisión operativa importa que sean
// pequeños, rápidos de leer y únicos; no se intenta impedir que alguien los copie.

import { CAMPORI } from './catalogo.js';

// ------------------------------------------------------------------ SHA-256

// Implementacion propia en vez de crypto.subtle porque esa API es asincrona y solo
// existe en contextos seguros; asi el generador tambien funciona abriendo el archivo
// directamente desde el disco.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(mensaje) {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const largo = mensaje.length;
  const bits = largo * 8;
  const total = ((largo + 9 + 63) >> 6) << 6;   // multiplo de 64 con lugar para el padding
  const buf = new Uint8Array(total);
  buf.set(mensaje);
  buf[largo] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 4294967296));
  dv.setUint32(total - 4, bits >>> 0);

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const salida = new Uint8Array(32);
  const sdv = new DataView(salida.buffer);
  for (let i = 0; i < 8; i++) sdv.setUint32(i * 4, H[i]);
  return salida;
}

const aBytes = texto => new TextEncoder().encode(texto);

function hmacSha256(clave, mensaje) {
  const BLOQUE = 64;
  let k = aBytes(clave);
  if (k.length > BLOQUE) k = sha256(k);

  const ipad = new Uint8Array(BLOQUE);
  const opad = new Uint8Array(BLOQUE);
  for (let i = 0; i < BLOQUE; i++) {
    const byte = i < k.length ? k[i] : 0;
    ipad[i] = byte ^ 0x36;
    opad[i] = byte ^ 0x5c;
  }

  const m = aBytes(mensaje);
  const interno = new Uint8Array(BLOQUE + m.length);
  interno.set(ipad); interno.set(m, BLOQUE);
  const hInterno = sha256(interno);

  const externo = new Uint8Array(BLOQUE + 32);
  externo.set(opad); externo.set(hInterno, BLOQUE);
  return sha256(externo);
}

// ------------------------------------------------------------------ firma

// Base32 de Crockford: sin I, L, O ni U, para que nadie confunda un 1 con una I
// al leer un codigo a mano. Todos sus caracteres son validos en un QR alfanumerico.
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO_FIRMA = 4;   // 4 x 5 bits = 20 bits: 1 en un millon de acertar al azar

export function firmar(cuerpo) {
  const h = hmacSha256(CAMPORI.clave, cuerpo);
  let firma = '';
  for (let i = 0; i < LARGO_FIRMA; i++) {
    // Tomamos 5 bits por caracter, arrancando desde el bit mas significativo.
    const bit = i * 5;
    const byte = bit >> 3;
    const ventana = (h[byte] << 8) | h[byte + 1];
    firma += ALFABETO[(ventana >> (11 - (bit & 7))) & 0x1f];
  }
  return firma;
}

// Comparacion en tiempo constante. Es exagerado para un campori, pero cuesta nada
// y evita que alguien pueda adivinar la firma caracter por caracter.
function firmasIguales(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// ------------------------------------------------------------------ armado y lectura

export function armarSticker(codigoEvento, puntos, serial) {
  // `puntos` se conserva en la firma de la funcion para no romper las llamadas
  // existentes, pero el valor oficial se toma siempre del catalogo.
  const id = String(serial).toUpperCase().padStart(8, '0');
  return `${codigoEvento}-${id}`;
}

export function armarQrClub(idClub) {
  const cuerpo = `${CAMPORI.prefijo}-CLUB-${idClub}`;
  return `${cuerpo}-${firmar(cuerpo)}`;
}

// leerQr calcula una HMAC por llamada, y la app la invoca sobre miles de escaneos
// cada vez que recalcula. Como es una funcion pura del texto, memorizamos el
// resultado. El limite evita que la cache crezca sin control en una sesion larga.
const cache = new Map();
const CACHE_MAXIMA = 5000;

/**
 * Interpreta el contenido de un QR escaneado.
 * Devuelve siempre un objeto con `ok`; nunca lanza, porque la camara lee
 * cualquier cosa que le pongan adelante y no queremos que eso rompa la app.
 */
export function leerQr(texto) {
  const enCache = cache.get(texto);
  if (enCache) return enCache;
  const resultado = interpretar(texto);
  if (cache.size >= CACHE_MAXIMA) cache.clear();
  cache.set(texto, resultado);
  return resultado;
}

function interpretar(texto) {
  const crudo = String(texto || '').trim().toUpperCase();
  if (!crudo) return { ok: false, motivo: 'vacio', crudo };

  const partes = crudo.split('-');

  // Formato operativo mínimo.
  if (partes.length === 2) {
    const [codigo, serial] = partes;
    if (!/^[A-Z][0-9]{2}$/.test(codigo) || !/^[0-9A-Z]{8}$/.test(serial)) {
      return { ok: false, motivo: 'formato', crudo, detalle: 'Estructura desconocida' };
    }
    return {
      ok: true, clase: 'sticker', codigo, puntos: null, serial,
      id: `${codigo}-${serial}`, crudo,
    };
  }

  if (partes[0] !== CAMPORI.prefijo) {
    return { ok: false, motivo: 'ajeno', crudo, detalle: 'No es un QR de este campori' };
  }

  // Compatibilidad con el primer formato corto usado durante las pruebas.
  if (partes.length === 3) {
    const [, codigo, serial] = partes;
    if (!/^[A-Z][0-9]{2}$/.test(codigo) || !/^[0-9A-Z]{4,10}$/.test(serial)) {
      return { ok: false, motivo: 'formato', crudo, detalle: 'Estructura desconocida' };
    }
    return {
      ok: true, clase: 'sticker', codigo, puntos: null, serial,
      id: `${codigo}-${serial}`, crudo,
    };
  }

  // Compatibilidad con los QR anteriores que sí llevaban firma.
  if (partes.length === 4 || partes.length === 5) {
    const firmaRecibida = partes[partes.length - 1];
    const cuerpo = partes.slice(0, -1).join('-');
    if (!firmasIguales(firmar(cuerpo), firmaRecibida)) {
      return { ok: false, motivo: 'firma', crudo, detalle: 'Firma invalida' };
    }

    if (partes[1] === 'CLUB' && partes.length === 4) {
      return { ok: true, clase: 'club', idClub: partes[2], crudo };
    }

    if (partes.length === 5) {
      const [, codigo, puntos, serial] = partes;
      const n = Number(puntos);
      if (!Number.isInteger(n) || n <= 0) {
        return { ok: false, motivo: 'formato', crudo, detalle: 'Puntaje ilegible' };
      }
      return { ok: true, clase: 'sticker', codigo, puntos: n, serial, id: `${codigo}-${serial}`, crudo };
    }
  }

  return { ok: false, motivo: 'formato', crudo, detalle: 'Estructura desconocida' };
}
