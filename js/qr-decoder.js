// Lector de codigos QR a partir de la imagen de la camara.
//
// Existe por los iPhone: Safari no trae BarcodeDetector, asi que sin esto no podrian
// escanear. En Android y en computadora se sigue usando la API nativa, que esta
// acelerada por hardware; este lector entra solo como respaldo.
//
// El recorrido es el mismo que hace cualquier lector:
//
//   pixeles -> escala de grises -> binarizado adaptativo -> ubicar los tres
//   cuadrados de las esquinas -> corregir la perspectiva -> muestrear la cuadricula
//   -> leer el formato -> quitar la mascara -> desintercalar los bloques ->
//   corregir errores con Reed-Solomon -> leer el texto
//
// Referencia: ISO/IEC 18004.

import { EXP, LOG, mul, div, inv } from './galois.js';
import {
  BLOQUES, ALINEACION, BITS_RESTANTES, JUEGO_ALFANUMERICO, MASCARAS,
  NIVEL_DESDE_BITS, BITS_NIVEL, mapaReservado, recorrerDatos,
  tamanoDeVersion, versionDeTamano,
} from './qr-tablas.js';

// ==================================================================== binarizado

const BLOQUE = 8;          // el binarizado trabaja por bloques de 8x8 pixeles
const CONTRASTE_MINIMO = 24;

/**
 * Umbral adaptativo por bloques. Un umbral global falla apenas hay un reflejo o una
 * sombra sobre el sticker, que es exactamente lo que pasa con un celular en la mano.
 * Cada bloque se compara contra el promedio de su vecindario.
 */
export function binarizar(gris, ancho, alto) {
  const bloquesX = Math.max(1, Math.ceil(ancho / BLOQUE));
  const bloquesY = Math.max(1, Math.ceil(alto / BLOQUE));
  const promedios = new Float32Array(bloquesX * bloquesY);
  // Un bloque es "con borde" si adentro conviven claro y oscuro. Solo esos dicen
  // algo sobre donde esta el limite entre tinta y papel; un bloque de un solo color
  // puede ser papel o puede ser tinta maciza, y por si solo no hay como saberlo.
  const conBorde = new Uint8Array(bloquesX * bloquesY);
  let sumaGlobal = 0, cuantosConBorde = 0;

  for (let by = 0; by < bloquesY; by++) {
    for (let bx = 0; bx < bloquesX; bx++) {
      let suma = 0, cuenta = 0, min = 255, max = 0;
      const y1 = Math.min(alto, (by + 1) * BLOQUE);
      const x1 = Math.min(ancho, (bx + 1) * BLOQUE);
      for (let y = by * BLOQUE; y < y1; y++) {
        for (let x = bx * BLOQUE; x < x1; x++) {
          const v = gris[y * ancho + x];
          suma += v; cuenta++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const b = by * bloquesX + bx;
      promedios[b] = cuenta ? suma / cuenta : 128;
      if (max - min > CONTRASTE_MINIMO) {
        conBorde[b] = 1;
        sumaGlobal += promedios[b];
        cuantosConBorde++;
      }
    }
  }

  // Umbral de reserva para las zonas donde no hay ningun borde cerca.
  const global = cuantosConBorde ? sumaGlobal / cuantosConBorde : 128;

  // Cada bloque toma como umbral el promedio de los bloques CON BORDE de su
  // vecindario. Tomar tambien los uniformes arrastraria el umbral hacia el color
  // del papel y la tinta palida se leeria como blanco.
  const bits = new Uint8Array(ancho * alto);
  for (let by = 0; by < bloquesY; by++) {
    for (let bx = 0; bx < bloquesX; bx++) {
      let suma = 0, cuenta = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const y = by + dy;
        if (y < 0 || y >= bloquesY) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const x = bx + dx;
          if (x < 0 || x >= bloquesX) continue;
          const b = y * bloquesX + x;
          if (!conBorde[b]) continue;
          suma += promedios[b]; cuenta++;
        }
      }
      const umbral = cuenta ? suma / cuenta : global;
      const y1 = Math.min(alto, (by + 1) * BLOQUE);
      const x1 = Math.min(ancho, (bx + 1) * BLOQUE);
      for (let y = by * BLOQUE; y < y1; y++) {
        for (let x = bx * BLOQUE; x < x1; x++) {
          bits[y * ancho + x] = gris[y * ancho + x] <= umbral ? 1 : 0;
        }
      }
    }
  }
  return bits;
}

// ==================================================== patrones de busqueda

// Los tres cuadrados de las esquinas tienen proporcion 1:1:3:1:1 en oscuro y claro.
// Buscamos esa secuencia recorriendo filas, y despues la confirmamos en vertical.

function proporcionValida(tramos) {
  const total = tramos.reduce((a, b) => a + b, 0);
  if (total < 7) return false;
  const modulo = total / 7;
  const margen = modulo * 0.6;   // tolerante: la camara desenfoca y deforma
  return Math.abs(modulo - tramos[0]) < margen
      && Math.abs(modulo - tramos[1]) < margen
      && Math.abs(modulo * 3 - tramos[2]) < margen * 3
      && Math.abs(modulo - tramos[3]) < margen
      && Math.abs(modulo - tramos[4]) < margen;
}

const centroDeTramos = (tramos, finX) =>
  finX - tramos[4] - tramos[3] - tramos[2] / 2;

// Cuanto puede estirarse el tramo central medido en perpendicular respecto del que
// medimos a lo largo. Con el codigo derecho serian iguales; girado, la cuerda que
// atraviesa un cuadrado inclinado se alarga, y por eso hay que dar margen.
const HOLGURA_CRUCE = 2.2;

/** Confirma el patron recorriendo en vertical desde un centro candidato. */
function confirmarVertical(bits, ancho, alto, centroX, centroY, maxCuenta, totalOriginal) {
  const idx = (x, y) => bits[y * ancho + x];
  const tramos = [0, 0, 0, 0, 0];
  let y = centroY;

  while (y >= 0 && idx(centroX, y) && tramos[2] <= maxCuenta) { tramos[2]++; y--; }
  if (y < 0 || tramos[2] > maxCuenta) return null;
  while (y >= 0 && !idx(centroX, y) && tramos[1] <= maxCuenta) { tramos[1]++; y--; }
  if (y < 0 || tramos[1] > maxCuenta) return null;
  while (y >= 0 && idx(centroX, y) && tramos[0] <= maxCuenta) { tramos[0]++; y--; }
  if (tramos[0] > maxCuenta) return null;

  y = centroY + 1;
  while (y < alto && idx(centroX, y) && tramos[2] <= maxCuenta) { tramos[2]++; y++; }
  if (y === alto || tramos[2] > maxCuenta) return null;
  while (y < alto && !idx(centroX, y) && tramos[3] <= maxCuenta) { tramos[3]++; y++; }
  if (y === alto || tramos[3] > maxCuenta) return null;
  while (y < alto && idx(centroX, y) && tramos[4] <= maxCuenta) { tramos[4]++; y++; }
  if (tramos[4] > maxCuenta) return null;

  const total = tramos.reduce((a, b) => a + b, 0);
  // Si el alto y el ancho difieren demasiado no es un cuadrado. El margen es amplio
  // porque un codigo girado da cuerdas mas largas en una direccion que en la otra.
  if (total > totalOriginal * HOLGURA_CRUCE || total * HOLGURA_CRUCE < totalOriginal) return null;
  return proporcionValida(tramos) ? centroDeTramos(tramos, y) : null;
}

/** Confirma en horizontal, ya con el centro vertical ajustado. */
function confirmarHorizontal(bits, ancho, centroX, centroY, maxCuenta, totalOriginal) {
  const idx = (x, y) => bits[y * ancho + x];
  const tramos = [0, 0, 0, 0, 0];
  let x = centroX;

  while (x >= 0 && idx(x, centroY) && tramos[2] <= maxCuenta) { tramos[2]++; x--; }
  if (x < 0 || tramos[2] > maxCuenta) return null;
  while (x >= 0 && !idx(x, centroY) && tramos[1] <= maxCuenta) { tramos[1]++; x--; }
  if (x < 0 || tramos[1] > maxCuenta) return null;
  while (x >= 0 && idx(x, centroY) && tramos[0] <= maxCuenta) { tramos[0]++; x--; }
  if (tramos[0] > maxCuenta) return null;

  x = centroX + 1;
  while (x < ancho && idx(x, centroY) && tramos[2] <= maxCuenta) { tramos[2]++; x++; }
  if (x === ancho || tramos[2] > maxCuenta) return null;
  while (x < ancho && !idx(x, centroY) && tramos[3] <= maxCuenta) { tramos[3]++; x++; }
  if (x === ancho || tramos[3] > maxCuenta) return null;
  while (x < ancho && idx(x, centroY) && tramos[4] <= maxCuenta) { tramos[4]++; x++; }
  if (tramos[4] > maxCuenta) return null;

  const total = tramos.reduce((a, b) => a + b, 0);
  if (total > totalOriginal * HOLGURA_CRUCE || total * HOLGURA_CRUCE < totalOriginal) return null;
  return proporcionValida(tramos) ? centroDeTramos(tramos, x) : null;
}

/** Recorre las filas de la imagen buscando el patron. */
function buscarEnFilas(bits, ancho, alto) {
  const encontrados = [];

  // Saltamos filas para ir mas rapido: el patron mide varios pixeles de alto.
  const salto = Math.max(1, Math.floor(alto / 240));

  for (let y = salto - 1; y < alto; y += salto) {
    const tramos = [0, 0, 0, 0, 0];
    let estado = 0;
    for (let x = 0; x < ancho; x++) {
      const oscuro = bits[y * ancho + x];
      if (estado % 2 === (oscuro ? 0 : 1)) {
        // El pixel sigue el color que esperamos en este tramo.
        tramos[estado]++;
      } else if (estado === 4) {
        // Cerramos una secuencia completa de cinco tramos.
        if (proporcionValida(tramos)) {
          const total = tramos.reduce((a, b) => a + b, 0);
          // El tope para los recorridos de confirmacion es el tramo central que
          // acabamos de medir: en un cuadrado, el alto de la banda central tiene
          // que parecerse a su ancho.
          const maxCuenta = tramos[2];
          const cx = centroDeTramos(tramos, x);
          const cy = confirmarVertical(bits, ancho, alto, Math.round(cx), y, maxCuenta, total);
          if (cy !== null) {
            const cx2 = confirmarHorizontal(bits, ancho, Math.round(cx), Math.round(cy), maxCuenta, total);
            if (cx2 !== null) encontrados.push({ x: cx2, y: cy, modulo: total / 7 });
          }
        }
        // Arrancamos una secuencia nueva reutilizando los dos ultimos tramos.
        tramos[0] = tramos[2]; tramos[1] = tramos[3]; tramos[2] = tramos[4];
        tramos[3] = 1; tramos[4] = 0;
        estado = 3;
      } else {
        tramos[++estado]++;
      }
    }
    if (estado === 4 && proporcionValida(tramos)) {
      const total = tramos.reduce((a, b) => a + b, 0);
      const maxCuenta = Math.ceil(tramos[2] * HOLGURA_CRUCE);
      const cx = centroDeTramos(tramos, ancho);
      const cy = confirmarVertical(bits, ancho, alto, Math.round(cx), y, maxCuenta, total);
      if (cy !== null) encontrados.push({ x: cx, y: cy, modulo: total / 7 });
    }
  }
  return encontrados;
}

/**
 * Busca los tres cuadrados de las esquinas.
 *
 * Se recorre la imagen por filas y tambien por columnas. Con el codigo derecho
 * bastarian las filas, pero girado el patron 1:1:3:1:1 solo aparece limpio en las
 * lineas que pasan cerca del centro del cuadrado: mirando en las dos direcciones
 * hay el doble de oportunidades de dar con una.
 */
export function buscarPatrones(bits, ancho, alto) {
  const encontrados = buscarEnFilas(bits, ancho, alto);

  // Segunda pasada sobre la imagen transpuesta; las coordenadas vuelven al derecho.
  const transpuesta = new Uint8Array(bits.length);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) transpuesta[x * alto + y] = bits[y * ancho + x];
  }
  for (const p of buscarEnFilas(transpuesta, alto, ancho)) {
    encontrados.push({ x: p.y, y: p.x, modulo: p.modulo });
  }

  // Agrupamos las detecciones repetidas del mismo cuadrado.
  const grupos = [];
  for (const p of encontrados) {
    const cerca = grupos.find(g =>
      Math.hypot(g.x - p.x, g.y - p.y) < Math.max(g.modulo, p.modulo) * 2.5 &&
      Math.abs(g.modulo - p.modulo) < Math.max(g.modulo, p.modulo) * 0.7);
    if (cerca) {
      cerca.x = (cerca.x * cerca.n + p.x) / (cerca.n + 1);
      cerca.y = (cerca.y * cerca.n + p.y) / (cerca.n + 1);
      cerca.modulo = (cerca.modulo * cerca.n + p.modulo) / (cerca.n + 1);
      cerca.n++;
    } else {
      grupos.push({ ...p, n: 1 });
    }
  }
  // Los grupos con mas detecciones son los mas confiables.
  return grupos.sort((a, b) => b.n - a.n);
}

/**
 * Ordena tres candidatos en esquina superior izquierda, superior derecha e inferior
 * izquierda. La esquina es la que forma el angulo recto: le queda enfrente el lado
 * mas largo del triangulo.
 */
function ordenarEsquinas(p) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lados = [
    { largo: d(p[0], p[1]), opuesto: 2 },
    { largo: d(p[1], p[2]), opuesto: 0 },
    { largo: d(p[0], p[2]), opuesto: 1 },
  ].sort((a, b) => b.largo - a.largo);

  const esquina = p[lados[0].opuesto];
  const otros = p.filter((_, i) => i !== lados[0].opuesto);

  // El producto cruzado dice cual de los dos queda a la derecha del otro.
  const cruz = (otros[0].x - esquina.x) * (otros[1].y - esquina.y)
             - (otros[0].y - esquina.y) * (otros[1].x - esquina.x);
  const [arribaDerecha, abajoIzquierda] = cruz < 0 ? [otros[1], otros[0]] : [otros[0], otros[1]];

  return { esquina, arribaDerecha, abajoIzquierda };
}

// ==================================================== perspectiva

/**
 * Transformacion proyectiva de la cuadricula del codigo a los pixeles de la imagen.
 * Hace falta porque nadie sostiene el celular perfectamente paralelo a la ficha:
 * el codigo llega como un cuadrilatero, no como un cuadrado.
 */
function transformacion(origen, destino) {
  // Cuadrado unitario -> cuadrilatero, para cada lado, y despues se componen.
  const aCuadrilatero = q => {
    const dx3 = q[0].x - q[1].x + q[2].x - q[3].x;
    const dy3 = q[0].y - q[1].y + q[2].y - q[3].y;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      return [q[1].x - q[0].x, q[2].x - q[1].x, q[0].x,
              q[1].y - q[0].y, q[2].y - q[1].y, q[0].y, 0, 0, 1];
    }
    const dx1 = q[1].x - q[2].x, dx2 = q[3].x - q[2].x;
    const dy1 = q[1].y - q[2].y, dy2 = q[3].y - q[2].y;
    const den = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / den;
    const a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [
      q[1].x - q[0].x + a13 * q[1].x, q[3].x - q[0].x + a23 * q[3].x, q[0].x,
      q[1].y - q[0].y + a13 * q[1].y, q[3].y - q[0].y + a23 * q[3].y, q[0].y,
      a13, a23, 1,
    ];
  };

  const invertir = m => [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];

  const multiplicar = (a, b) => [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];

  const m = multiplicar(aCuadrilatero(destino), invertir(aCuadrilatero(origen)));
  return (x, y) => {
    const d = m[6] * x + m[7] * y + m[8];
    return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d };
  };
}

/** Devuelve los tramos de un mismo color a lo largo de una linea. */
function tramosDeLinea(leer, desde, hasta) {
  const tramos = [];
  let inicio = desde;
  let color = leer(desde);
  for (let i = desde + 1; i <= hasta + 1; i++) {
    const c = i <= hasta ? leer(i) : -1;
    if (c !== color) {
      tramos.push({ inicio, largo: i - inicio, oscuro: color });
      inicio = i; color = c;
    }
  }
  return tramos;
}

/**
 * Busca el patron de alineacion cerca de donde deberia estar.
 *
 * Es un cuadrado de 5x5 con un punto en el medio:
 *
 *     #####
 *     #...#
 *     #.#.#     <- por esta fila pasa la busqueda
 *     #...#
 *     #####
 *
 * Lo que buscamos son tres tramos seguidos claro-oscuro-claro de un modulo cada uno.
 * No miramos el anillo exterior a proposito: esos modulos oscuros se pegan con los
 * datos que tienen al lado y su largo deja de ser confiable. En cambio los dos huecos
 * claros y el punto del medio miden siempre un modulo exacto, esten donde esten.
 *
 * Despues se confirma en vertical: un falso positivo aca corre toda la cuadricula.
 */
function buscarAlineacion(bits, ancho, alto, esperadoX, esperadoY, modulo) {
  const radio = Math.max(4, Math.round(modulo * 4));
  const x0 = Math.max(0, Math.round(esperadoX - radio));
  const x1 = Math.min(ancho - 1, Math.round(esperadoX + radio));
  const y0 = Math.max(0, Math.round(esperadoY - radio));
  const y1 = Math.min(alto - 1, Math.round(esperadoY + radio));
  if (x1 - x0 < 5 || y1 - y0 < 5) return null;

  const margen = Math.max(1.2, modulo * 0.65);
  const unModulo = t => Math.abs(t.largo - modulo) <= margen;

  // Devuelve el indice del tramo oscuro central de un claro-oscuro-claro, o -1.
  const centroEn = (tramos, contiene) => {
    for (let i = 1; i + 1 < tramos.length; i++) {
      const t = tramos[i];
      if (!t.oscuro || !unModulo(t)) continue;
      if (tramos[i - 1].oscuro || tramos[i + 1].oscuro) continue;
      if (!unModulo(tramos[i - 1]) || !unModulo(tramos[i + 1])) continue;
      if (contiene !== undefined && !(contiene >= t.inicio && contiene < t.inicio + t.largo)) continue;
      return i;
    }
    return -1;
  };

  let mejor = null;
  for (let y = y0; y <= y1; y++) {
    const fila = tramosDeLinea(x => bits[y * ancho + x], x0, x1);
    for (let i = 1; i + 1 < fila.length; i++) {
      const t = fila[i];
      if (!t.oscuro || !unModulo(t)) continue;
      if (fila[i - 1].oscuro || fila[i + 1].oscuro) continue;
      if (!unModulo(fila[i - 1]) || !unModulo(fila[i + 1])) continue;

      const cx = t.inicio + t.largo / 2;
      const xr = Math.round(cx);
      if (xr < 0 || xr >= ancho) continue;

      // Confirmacion vertical sobre la columna del centro hallado.
      const cy0 = Math.max(0, Math.round(y - modulo * 3));
      const cy1 = Math.min(alto - 1, Math.round(y + modulo * 3));
      const columna = tramosDeLinea(py => bits[py * ancho + xr], cy0, cy1);
      const j = centroEn(columna, y);
      if (j < 0) continue;

      const cyReal = columna[j].inicio + columna[j].largo / 2;
      const distancia = Math.hypot(cx - esperadoX, cyReal - esperadoY);
      if (!mejor || distancia < mejor.distancia) mejor = { x: cx, y: cyReal, distancia };
    }
  }
  return mejor;
}

// ==================================================== Reed-Solomon: correccion

/**
 * Corrige hasta (cantidadEc/2) bytes errados en un bloque.
 * Devuelve el bloque corregido, o null si el daño supera lo recuperable.
 *
 * Berlekamp-Massey para hallar el polinomio localizador, busqueda de Chien para
 * ubicar los errores y Forney para calcular cuanto vale cada uno.
 */
export function corregirBloque(bloque, cantidadEc) {
  const n = bloque.length;

  // Sindromes: el bloque intacto los da todos en cero.
  const sindromes = new Array(cantidadEc).fill(0);
  let hayError = false;
  for (let i = 0; i < cantidadEc; i++) {
    let acumulado = 0;
    for (const byte of bloque) acumulado = mul(acumulado, EXP[i]) ^ byte;
    sindromes[i] = acumulado;
    if (acumulado !== 0) hayError = true;
  }
  if (!hayError) return bloque.slice();

  // --- Berlekamp-Massey. Los polinomios van con el termino independiente primero.
  let localizador = [1];
  let anterior = [1];
  let ultimoDescarte = 1;
  let desplazamiento = 1;
  let grado = 0;

  for (let paso = 0; paso < cantidadEc; paso++) {
    let descarte = sindromes[paso];
    for (let i = 1; i <= grado; i++) {
      descarte ^= mul(localizador[i] || 0, sindromes[paso - i]);
    }

    if (descarte === 0) {
      desplazamiento++;
      continue;
    }

    const factor = div(descarte, ultimoDescarte);
    const ajustado = localizador.slice();
    for (let i = 0; i < anterior.length; i++) {
      const p = i + desplazamiento;
      while (ajustado.length <= p) ajustado.push(0);
      ajustado[p] ^= mul(factor, anterior[i]);
    }

    if (2 * grado <= paso) {
      const previo = localizador;
      localizador = ajustado;
      grado = paso + 1 - grado;
      anterior = previo;
      ultimoDescarte = descarte;
      desplazamiento = 1;
    } else {
      localizador = ajustado;
      desplazamiento++;
    }
  }

  const errores = localizador.length - 1;
  if (errores <= 0 || errores * 2 > cantidadEc) return null;

  // --- Chien: las raices del localizador dicen donde estan los errores.
  // Una posicion p del arreglo corresponde al termino de grado n-1-p.
  const posiciones = [];
  for (let p = 0; p < n; p++) {
    const gradoTermino = n - 1 - p;
    const inverso = EXP[(255 - (gradoTermino % 255)) % 255];
    let valor = 0;
    for (let i = localizador.length - 1; i >= 0; i--) valor = mul(valor, inverso) ^ localizador[i];
    if (valor === 0) posiciones.push(p);
  }
  if (posiciones.length !== errores) return null;

  // --- Forney: cuanto hay que corregir en cada posicion.
  // Omega(x) = S(x) * Localizador(x) truncado al grado de la correccion.
  const omega = new Array(cantidadEc).fill(0);
  for (let i = 0; i < cantidadEc; i++) {
    for (let j = 0; j < localizador.length && j <= i; j++) {
      omega[i] ^= mul(sindromes[i - j], localizador[j]);
    }
  }
  // Derivada formal: en caracteristica 2 solo sobreviven los terminos de grado impar.
  const derivada = [];
  for (let i = 1; i < localizador.length; i += 2) derivada.push(localizador[i]);

  const corregido = bloque.slice();
  for (const p of posiciones) {
    const gradoTermino = n - 1 - p;
    const x = EXP[gradoTermino % 255];
    const xInverso = inv(x);

    let numerador = 0;
    for (let i = omega.length - 1; i >= 0; i--) numerador = mul(numerador, xInverso) ^ omega[i];

    let denominador = 0;
    for (let i = derivada.length - 1; i >= 0; i--) {
      denominador = mul(denominador, mul(xInverso, xInverso)) ^ derivada[i];
    }
    if (denominador === 0) return null;

    corregido[p] ^= mul(x, div(numerador, denominador));
  }

  // Verificamos: si quedo bien, los sindromes ahora dan cero.
  for (let i = 0; i < cantidadEc; i++) {
    let acumulado = 0;
    for (const byte of corregido) acumulado = mul(acumulado, EXP[i]) ^ byte;
    if (acumulado !== 0) return null;
  }
  return corregido;
}

// ==================================================== lectura de la matriz

const FORMATO_XOR = 0b101010000010010;

function bchFormato(datos) {
  let v = datos << 10;
  for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0b10100110111 << (i - 10);
  return ((datos << 10) | v) ^ FORMATO_XOR;
}

// Todas las cadenas de formato validas, precalculadas. Leer el formato es elegir
// la mas parecida a lo que vimos: eso corrige de por si algun modulo mal leido.
const FORMATOS_VALIDOS = (() => {
  const lista = [];
  for (const [nivel, bits] of Object.entries(BITS_NIVEL)) {
    for (let mascara = 0; mascara < 8; mascara++) {
      lista.push({ valor: bchFormato((bits << 3) | mascara), nivel, mascara });
    }
  }
  return lista;
})();

const distanciaHamming = (a, b) => {
  let x = a ^ b, n = 0;
  while (x) { n += x & 1; x >>= 1; }
  return n;
};

function leerFormato(modulos, tamano) {
  const copias = [0, 0];
  for (let i = 0; i < 15; i++) {
    let bit;
    if (i < 6) bit = modulos[i][8];
    else if (i === 6) bit = modulos[7][8];
    else if (i === 7) bit = modulos[8][8];
    else if (i === 8) bit = modulos[8][7];
    else bit = modulos[8][14 - i];
    copias[0] |= bit << i;

    const bit2 = i < 8 ? modulos[8][tamano - 1 - i] : modulos[tamano - 15 + i][8];
    copias[1] |= bit2 << i;
  }

  let mejor = null;
  for (const copia of copias) {
    for (const f of FORMATOS_VALIDOS) {
      const d = distanciaHamming(copia, f.valor);
      if (!mejor || d < mejor.d) mejor = { d, ...f };
    }
  }
  // Mas de 3 bits de diferencia significa que no leimos un formato, leimos ruido.
  return mejor && mejor.d <= 3 ? mejor : null;
}

function leerContenido(modulos, version, nivel, mascara) {
  const tamano = tamanoDeVersion(version);
  const bits = [];
  recorrerDatos(version, (y, x) => {
    const v = modulos[y][x];
    bits.push(MASCARAS[mascara](y, x) ? v ^ 1 : v);
  });

  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }

  // Desintercalado.
  const [cantEc, b1, d1, b2, d2] = BLOQUES[version][nivel];
  const largos = [...Array(b1).fill(d1), ...Array(b2).fill(d2)];
  const bloques = largos.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(d1, d2); i++) {
    for (let b = 0; b < largos.length; b++) if (i < largos[b]) bloques[b].push(codewords[p++]);
  }
  const bloquesEc = largos.map(() => []);
  for (let i = 0; i < cantEc; i++) for (let b = 0; b < largos.length; b++) bloquesEc[b].push(codewords[p++]);

  // Correccion de errores bloque por bloque.
  const datos = [];
  let bytesCorregidos = 0;
  for (let b = 0; b < bloques.length; b++) {
    const completo = [...bloques[b], ...bloquesEc[b]];
    const corregido = corregirBloque(completo, cantEc);
    if (!corregido) return null;                     // daño irrecuperable
    for (let i = 0; i < largos[b]; i++) {
      if (corregido[i] !== completo[i]) bytesCorregidos++;
      datos.push(corregido[i]);
    }
  }

  return { datos, bytesCorregidos };
}

function leerTexto(datos, version) {
  const flujo = [];
  for (const byte of datos) for (let i = 7; i >= 0; i--) flujo.push((byte >> i) & 1);

  let pos = 0;
  const tomar = n => {
    if (pos + n > flujo.length) throw new Error('se acabaron los bits');
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | flujo[pos++];
    return v;
  };

  let texto = '';
  // Un codigo puede traer varios segmentos encadenados con modos distintos.
  for (let vuelta = 0; vuelta < 8; vuelta++) {
    if (pos + 4 > flujo.length) break;
    const modo = tomar(4);
    if (modo === 0) break;                       // terminador

    if (modo === 0b0001) {                       // numerico
      const cantidad = tomar(version <= 9 ? 10 : 12);
      for (let i = 0; i < cantidad;) {
        const quedan = cantidad - i;
        if (quedan >= 3) { texto += String(tomar(10)).padStart(3, '0'); i += 3; }
        else if (quedan === 2) { texto += String(tomar(7)).padStart(2, '0'); i += 2; }
        else { texto += String(tomar(4)); i += 1; }
      }
    } else if (modo === 0b0010) {                // alfanumerico, el que usamos
      const cantidad = tomar(version <= 9 ? 9 : 11);
      for (let i = 0; i + 1 < cantidad; i += 2) {
        const par = tomar(11);
        texto += JUEGO_ALFANUMERICO[Math.floor(par / 45)] + JUEGO_ALFANUMERICO[par % 45];
      }
      if (cantidad % 2) texto += JUEGO_ALFANUMERICO[tomar(6)];
    } else if (modo === 0b0100) {                // bytes
      const cantidad = tomar(version <= 9 ? 8 : 16);
      const bytes = [];
      for (let i = 0; i < cantidad; i++) bytes.push(tomar(8));
      texto += new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } else if (modo === 0b0111) {                // ECI: nos alcanza con saltearlo
      const primero = tomar(8);
      if (primero >= 0b11000000) tomar(16);
      else if (primero >= 0b10000000) tomar(8);
    } else {
      break;                                     // modo que no manejamos
    }
  }
  return texto;
}

// ==================================================== interfaz publica

/**
 * Intenta leer un codigo QR de una imagen.
 *
 * @param {Uint8ClampedArray} rgba  pixeles en formato RGBA, como los da un canvas
 * @param {number} ancho
 * @param {number} alto
 * @returns {{texto: string, version: number, nivel: string, bytesCorregidos: number} | null}
 */
export function decodificar(rgba, ancho, alto) {
  // A escala de grises con los pesos de luminancia habituales.
  const gris = new Uint8Array(ancho * alto);
  for (let i = 0, p = 0; i < gris.length; i++, p += 4) {
    gris[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return decodificarGris(gris, ancho, alto);
}

/** Igual que decodificar, pero recibiendo la imagen ya en escala de grises. */
export function decodificarGris(gris, ancho, alto) {
  diagnostico.intentos = [];

  const primera = unaPasada(gris, ancho, alto);
  if (primera.resultado) return primera.resultado;

  // Los patrones de las esquinas se buscan recorriendo filas y columnas, asi que un
  // codigo a 45 grados cae justo en el peor angulo para las dos. Si vimos algo que
  // parecia una esquina pero no llegamos a armar las tres, damos una segunda vuelta
  // con la imagen girada. No se paga en los cuadros vacios, que son la mayoria.
  if (primera.candidatos > 0) {
    const g = girar45(gris, ancho, alto);
    return unaPasada(g.gris, g.ancho, g.alto).resultado;
  }
  return null;
}

function unaPasada(gris, ancho, alto) {
  const bits = binarizar(gris, ancho, alto);
  const candidatos = buscarPatrones(bits, ancho, alto);
  if (candidatos.length < 3) return { resultado: null, candidatos: candidatos.length };

  // Probamos las combinaciones mas prometedoras: si hay basura alrededor puede
  // haber falsos positivos, y la combinacion correcta no siempre es la primera.
  const combinaciones = [];
  const tope = Math.min(candidatos.length, 6);
  for (let a = 0; a < tope; a++) {
    for (let b = a + 1; b < tope; b++) {
      for (let c = b + 1; c < tope; c++) combinaciones.push([candidatos[a], candidatos[b], candidatos[c]]);
    }
  }

  for (const trio of combinaciones.slice(0, 10)) {
    const resultado = intentar(bits, ancho, alto, trio);
    if (resultado) return { resultado, candidatos: candidatos.length };
  }
  return { resultado: null, candidatos: candidatos.length };
}

/** Gira la imagen 45 grados. Solo interesa el texto, no hace falta volver atras. */
function girar45(gris, ancho, alto) {
  const cos = Math.SQRT1_2, sin = Math.SQRT1_2;
  const nuevoAncho = Math.ceil((ancho + alto) * cos);
  const nuevoAlto = nuevoAncho;
  const salida = new Uint8Array(nuevoAncho * nuevoAlto).fill(255);
  const cx = ancho / 2, cy = alto / 2;
  const ncx = nuevoAncho / 2, ncy = nuevoAlto / 2;

  for (let y = 0; y < nuevoAlto; y++) {
    for (let x = 0; x < nuevoAncho; x++) {
      const dx = x - ncx, dy = y - ncy;
      const sx = cx + dx * cos + dy * sin;
      const sy = cy - dx * sin + dy * cos;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= ancho || y0 + 1 >= alto) continue;
      const fx = sx - x0, fy = sy - y0;
      salida[y * nuevoAncho + x] =
        gris[y0 * ancho + x0] * (1 - fx) * (1 - fy) + gris[y0 * ancho + x0 + 1] * fx * (1 - fy) +
        gris[(y0 + 1) * ancho + x0] * (1 - fx) * fy + gris[(y0 + 1) * ancho + x0 + 1] * fx * fy;
    }
  }
  return { gris: salida, ancho: nuevoAncho, alto: nuevoAlto };
}

// Deja anotado hasta donde llego el ultimo intento. Sirve para la pantalla de
// diagnostico de la app y para depurar por que un codigo no entra.
export const diagnostico = { intentos: [], etapa: null, version: null, nivel: null, mascara: null, modulos: null };

const TAMANOS_VALIDOS = Array.from({ length: 10 }, (_, i) => tamanoDeVersion(i + 1));

function intentar(bits, ancho, alto, trio) {
  const { esquina, arribaDerecha, abajoIzquierda } = ordenarEsquinas(trio);
  const modulo = (esquina.modulo + arribaDerecha.modulo + abajoIzquierda.modulo) / 3;
  if (!(modulo > 0.8)) return null;

  const distancia = (Math.hypot(esquina.x - arribaDerecha.x, esquina.y - arribaDerecha.y) +
                     Math.hypot(esquina.x - abajoIzquierda.x, esquina.y - abajoIzquierda.y)) / 2;

  // El tamaño se estima con la distancia entre buscadores dividida el ancho de un
  // modulo. Pero si el codigo llega girado o inclinado, los tramos que medimos por
  // filas salen estirados y la estimacion se corre de version. En vez de afinar la
  // cuenta, probamos los tamaños candidatos en orden de cercania: cada uno se valida
  // despues contra el patron de sincronismo, que no admite ambiguedad.
  const estimado = Math.round(distancia / modulo) + 7;
  const candidatos = [...TAMANOS_VALIDOS].sort((a, b) => Math.abs(a - estimado) - Math.abs(b - estimado));

  for (const tamano of candidatos) {
    const r = intentarConTamano(bits, ancho, alto, { esquina, arribaDerecha, abajoIzquierda }, tamano, modulo);
    if (r) return r;
  }
  return null;
}

function intentarConTamano(bits, ancho, alto, { esquina, arribaDerecha, abajoIzquierda }, tamano, modulo) {
  const paso = { etapa: 'esquinas', tamano };
  diagnostico.intentos.push(paso);
  const marcar = etapa => { diagnostico.etapa = etapa; paso.etapa = etapa; };
  try {
    const version = versionDeTamano(tamano);

    // Cuarto punto: el patron de alineacion de abajo a la derecha. Sin el, la
    // correccion de perspectiva no puede compensar la inclinacion del celular.
    const centros = ALINEACION[version];
    let cuartoOrigen = { x: tamano - 3.5, y: tamano - 3.5 };
    let cuartoDestino = {
      x: arribaDerecha.x + abajoIzquierda.x - esquina.x,
      y: arribaDerecha.y + abajoIzquierda.y - esquina.y,
    };

    if (centros.length) {
      const centro = centros[centros.length - 1];   // el de abajo a la derecha

      // Transformacion preliminar con el cuarto punto estimado como paralelogramo.
      // Sirve para dos cosas: predecir donde cae el patron de alineacion, y medir
      // cuanto mide un modulo ALLI. Con el celular en angulo el lado lejano tiene
      // modulos mas chicos, y buscar con el promedio general no lo encuentra.
      const previa = transformacion(
        [{ x: 3.5, y: 3.5 }, { x: tamano - 3.5, y: 3.5 },
         { x: tamano - 3.5, y: tamano - 3.5 }, { x: 3.5, y: tamano - 3.5 }],
        [{ x: esquina.x, y: esquina.y }, { x: arribaDerecha.x, y: arribaDerecha.y },
         cuartoDestino, { x: abajoIzquierda.x, y: abajoIzquierda.y }]
      );
      const esperado = previa(centro + 0.5, centro + 0.5);
      const vecino = previa(centro + 1.5, centro + 0.5);
      const moduloLocal = Math.hypot(vecino.x - esperado.x, vecino.y - esperado.y);
      const moduloBusqueda = Number.isFinite(moduloLocal) && moduloLocal > 1
        ? moduloLocal : modulo;

      if (Number.isFinite(esperado.x) && Number.isFinite(esperado.y)) {
        const hallado = buscarAlineacion(bits, ancho, alto, esperado.x, esperado.y, moduloBusqueda);
        if (hallado) {
          cuartoOrigen = { x: centro + 0.5, y: centro + 0.5 };
          cuartoDestino = { x: hallado.x, y: hallado.y };
        }
      }
    }

    const mapear = transformacion(
      [{ x: 3.5, y: 3.5 }, { x: tamano - 3.5, y: 3.5 }, cuartoOrigen, { x: 3.5, y: tamano - 3.5 }],
      [{ x: esquina.x, y: esquina.y }, { x: arribaDerecha.x, y: arribaDerecha.y },
       cuartoDestino, { x: abajoIzquierda.x, y: abajoIzquierda.y }]
    );

    // Muestreo: el centro de cada modulo, con voto de 5 puntos para aguantar el ruido.
    const modulos = [];
    for (let fila = 0; fila < tamano; fila++) {
      const linea = [];
      for (let col = 0; col < tamano; col++) {
        let votos = 0, validos = 0;
        for (const [dx, dy] of [[0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25]]) {
          const p = mapear(col + 0.5 + dx, fila + 0.5 + dy);
          const x = Math.round(p.x), y = Math.round(p.y);
          if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
          votos += bits[y * ancho + x];
          validos++;
        }
        if (!validos) return null;
        linea.push(votos * 2 > validos ? 1 : 0);
      }
      modulos.push(linea);
    }
    marcar('muestreado');
    diagnostico.version = version;
    diagnostico.modulos = modulos;
    paso.version = version;
    paso.modulos = modulos;

    // Validacion del tamaño: el patron de sincronismo alterna oscuro y claro sin
    // excepcion. Si muestreamos con la cuadricula equivocada, esa alternancia se
    // rompe enseguida. Es un filtro barato que descarta los tamaños incorrectos
    // antes de gastar tiempo en la correccion de errores.
    const largoSincro = tamano - 16;
    if (largoSincro > 0) {
      let fallos = 0;
      for (let i = 8; i < tamano - 8; i++) {
        const esperado = i % 2 === 0 ? 1 : 0;
        if (modulos[6][i] !== esperado) fallos++;
        if (modulos[i][6] !== esperado) fallos++;
      }
      if (fallos > largoSincro * 0.4) return null;
      paso.fallosSincronismo = fallos;
    }
    marcar('sincronismo');

    const formato = leerFormato(modulos, tamano);
    if (!formato) return null;
    marcar('formato');
    diagnostico.nivel = formato.nivel;
    diagnostico.mascara = formato.mascara;

    const contenido = leerContenido(modulos, version, formato.nivel, formato.mascara);
    if (!contenido) return null;
    marcar('corregido');

    const texto = leerTexto(contenido.datos, version);
    if (!texto) return null;
    marcar('leido');

    return {
      texto, version, nivel: formato.nivel, mascara: formato.mascara,
      bytesCorregidos: contenido.bytesCorregidos,
    };
  } catch {
    return null;   // cualquier tropiezo con esta combinacion: probamos la siguiente
  }
}
