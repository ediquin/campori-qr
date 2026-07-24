// Verificacion del lector de codigos QR.
//
//   node herramientas/pruebas-decoder.mjs
//
// El lector propio existe para los iPhone, que no traen BarcodeDetector. Un lector
// que solo funciona con imagenes perfectas no sirve de nada: en la mano de una persona
// el codigo llega movido, inclinado, con reflejo del sticker y con la sombra del que
// sostiene el telefono.
//
// Por eso aca se generan imagenes sinteticas con esas degradaciones aplicadas a
// proposito, y se exige que el lector las siga leyendo.

import { generarMatriz } from '../js/qr-encoder.js';
import { corregirBloque, decodificarGris } from '../js/qr-decoder.js';
import { calcularRecorteCentral, codigoMasCercano } from '../js/escaner.js';
import { polinomioGenerador, mul } from '../js/galois.js';
import { armarSticker, armarQrClub } from '../js/codigo.js';
import {
  PUNTOS_EVENTO, EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES,
} from '../js/catalogo.js';

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}
const grupo = t => console.log(`\n--- ${t}`);

// ============================================================ Mira central

grupo('La cámara prioriza la mira sin perder los bordes');

{
  const redondear = r => Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, Math.round(v * 10) / 10])
  );
  comprobar(
    'video 16:9 mostrado en 4:3: recorta el centro que realmente se ve',
    redondear(calcularRecorteCentral(1280, 720, 640, 480)),
    { x: 275.2, y: 86.4, ancho: 729.6, alto: 547.2 }
  );
  comprobar(
    'video y pantalla 4:3: la mira ocupa una zona central amplia',
    redondear(calcularRecorteCentral(640, 480, 640, 480)),
    { x: 76.8, y: 57.6, ancho: 486.4, alto: 364.8 }
  );
  comprobar('dimensiones inválidas no producen un recorte', calcularRecorteCentral(0, 0), null);

  const codigos = [
    { rawValue: 'izquierda', boundingBox: { x: 10, y: 40, width: 30, height: 30 } },
    { rawValue: 'centro', boundingBox: { x: 135, y: 85, width: 30, height: 30 } },
    { rawValue: 'derecha', boundingBox: { x: 260, y: 40, width: 30, height: 30 } },
  ];
  comprobar('si ve varios QR elige el más cercano al centro',
    codigoMasCercano(codigos, 150, 100)?.rawValue, 'centro');
}

// Generador de numeros pseudoaleatorios con semilla, para que las pruebas den
// siempre el mismo resultado y un fallo se pueda reproducir.
function aleatorio(semilla) {
  let s = semilla >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ============================================================ Reed-Solomon

grupo('Correccion de errores Reed-Solomon');

{
  // Armamos una palabra de codigo valida y le rompemos bytes a proposito.
  const cantidadEc = 22;                       // version 2 nivel Q
  const g = polinomioGenerador(cantidadEc);
  const datos = Array.from({ length: 22 }, (_, i) => (i * 37 + 11) & 0xff);

  const resto = new Uint8Array(cantidadEc);
  for (const byte of datos) {
    const factor = byte ^ resto[0];
    resto.copyWithin(0, 1);
    resto[cantidadEc - 1] = 0;
    if (factor !== 0) for (let i = 0; i < cantidadEc; i++) resto[i] ^= mul(g[i + 1], factor);
  }
  const original = [...datos, ...resto];

  comprobar('un bloque intacto vuelve igual', corregirBloque(original.slice(), cantidadEc), original);

  const azar = aleatorio(12345);
  for (const cuantos of [1, 2, 5, 10, 11]) {
    let exitos = 0;
    for (let intento = 0; intento < 40; intento++) {
      const roto = original.slice();
      const posiciones = new Set();
      while (posiciones.size < cuantos) posiciones.add(Math.floor(azar() * roto.length));
      for (const p of posiciones) roto[p] ^= 1 + Math.floor(azar() * 255);
      const arreglado = corregirBloque(roto, cantidadEc);
      if (arreglado && JSON.stringify(arreglado) === JSON.stringify(original)) exitos++;
    }
    // Con 22 bytes de correccion se recuperan hasta 11 bytes errados.
    comprobar(`recupera ${cuantos} byte${cuantos === 1 ? '' : 's'} roto${cuantos === 1 ? '' : 's'} (40 de 40)`, exitos, 40);
  }

  // Mas alla del limite tiene que rendirse, no inventar datos.
  let inventados = 0;
  const azar2 = aleatorio(999);
  for (let intento = 0; intento < 60; intento++) {
    const roto = original.slice();
    const posiciones = new Set();
    while (posiciones.size < 16) posiciones.add(Math.floor(azar2() * roto.length));
    for (const p of posiciones) roto[p] ^= 1 + Math.floor(azar2() * 255);
    const arreglado = corregirBloque(roto, cantidadEc);
    if (arreglado && JSON.stringify(arreglado) !== JSON.stringify(original)) inventados++;
  }
  comprobar('con 16 bytes rotos nunca devuelve datos falsos', inventados, 0);
}

// ============================================================ imagenes

/** Dibuja la matriz como imagen en escala de grises, con su zona tranquila. */
function dibujar(matriz, escala, margen = 4) {
  const n = matriz.tamano;
  const lado = (n + margen * 2) * escala;
  const gris = new Uint8Array(lado * lado).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matriz.modulos[y][x]) continue;
      for (let dy = 0; dy < escala; dy++) {
        const py = (y + margen) * escala + dy;
        for (let dx = 0; dx < escala; dx++) {
          gris[py * lado + (x + margen) * escala + dx] = 0;
        }
      }
    }
  }
  return { gris, ancho: lado, alto: lado };
}

const muestrear = (img, x, y) => {
  // Bilineal, para que las transformaciones no queden dentadas.
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const en = (px, py) => (px < 0 || py < 0 || px >= img.ancho || py >= img.alto)
    ? 255 : img.gris[py * img.ancho + px];
  return en(x0, y0) * (1 - fx) * (1 - fy) + en(x0 + 1, y0) * fx * (1 - fy)
       + en(x0, y0 + 1) * (1 - fx) * fy + en(x0 + 1, y0 + 1) * fx * fy;
};

function desenfocar(img, radio) {
  const salida = new Uint8Array(img.gris.length);
  const r = Math.max(1, Math.round(radio));
  for (let y = 0; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) {
      let suma = 0, cuenta = 0;
      for (let dy = -r; dy <= r; dy++) {
        const py = y + dy;
        if (py < 0 || py >= img.alto) continue;
        for (let dx = -r; dx <= r; dx++) {
          const px = x + dx;
          if (px < 0 || px >= img.ancho) continue;
          suma += img.gris[py * img.ancho + px]; cuenta++;
        }
      }
      salida[y * img.ancho + x] = suma / cuenta;
    }
  }
  return { ...img, gris: salida };
}

function rotar(img, grados) {
  const rad = grados * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = img.ancho / 2, cy = img.alto / 2;
  const salida = new Uint8Array(img.gris.length).fill(255);
  for (let y = 0; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) {
      const dx = x - cx, dy = y - cy;
      salida[y * img.ancho + x] = muestrear(img, cx + dx * cos + dy * sin, cy - dx * sin + dy * cos);
    }
  }
  return { ...img, gris: salida };
}

/**
 * Resuelve la homografia que lleva cuatro puntos a otros cuatro, por eliminacion
 * gaussiana. Es a proposito un metodo distinto del que usa el lector: si compartieran
 * implementacion, un error en la formula se cancelaria y la prueba no probaria nada.
 */
function homografia(origen, destino) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = origen[i];
    const { x: X, y: Y } = destino[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  for (let col = 0; col < 8; col++) {
    let mejor = col;
    for (let f = col + 1; f < 8; f++) if (Math.abs(A[f][col]) > Math.abs(A[mejor][col])) mejor = f;
    [A[col], A[mejor]] = [A[mejor], A[col]];
    [b[col], b[mejor]] = [b[mejor], b[col]];
    const pivote = A[col][col];
    for (let f = 0; f < 8; f++) {
      if (f === col || A[f][col] === 0) continue;
      const factor = A[f][col] / pivote;
      for (let c = col; c < 8; c++) A[f][c] -= factor * A[col][c];
      b[f] -= factor * b[col];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return (x, y) => {
    const d = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
  };
}

/**
 * Simula el celular mirando la ficha en angulo: el borde de arriba se aleja y se
 * angosta. Es una perspectiva de verdad, no un estirado cualquiera; si no lo fuera,
 * ninguna correccion de cuatro puntos podria deshacerla y la prueba seria imposible
 * de pasar por construccion.
 */
function inclinar(img, fuerza) {
  const w = img.ancho, h = img.alto;
  const angosto = w * fuerza * 0.5;
  const esquinas = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const inclinadas = [
    { x: angosto, y: h * fuerza * 0.25 }, { x: w - angosto, y: h * fuerza * 0.25 },
    { x: w, y: h }, { x: 0, y: h },
  ];
  // Mapeo inverso: de cada pixel destino a su origen.
  const alOrigen = homografia(inclinadas, esquinas);
  const salida = new Uint8Array(img.gris.length).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = alOrigen(x, y);
      if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) continue;
      salida[y * w + x] = muestrear(img, p.x, p.y);
    }
  }
  return { ...img, gris: salida };
}

function ruido(img, sigma, semilla = 7) {
  const azar = aleatorio(semilla);
  const salida = new Uint8Array(img.gris.length);
  for (let i = 0; i < img.gris.length; i++) {
    // Box-Muller para ruido con distribucion normal.
    const u1 = Math.max(1e-9, azar()), u2 = azar();
    const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
    salida[i] = Math.max(0, Math.min(255, img.gris[i] + n));
  }
  return { ...img, gris: salida };
}

/** Baja el contraste: papel gris, tinta que no es negra del todo. */
function contraste(img, factor, base = 128) {
  const salida = new Uint8Array(img.gris.length);
  for (let i = 0; i < img.gris.length; i++) {
    salida[i] = Math.max(0, Math.min(255, base + (img.gris[i] - base) * factor));
  }
  return { ...img, gris: salida };
}

/** Iluminacion despareja: la sombra del que sostiene el telefono. */
function gradiente(img, fuerza) {
  const salida = new Uint8Array(img.gris.length);
  for (let y = 0; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) {
      const f = 1 - fuerza * ((x / img.ancho) * 0.6 + (y / img.alto) * 0.4);
      salida[y * img.ancho + x] = Math.max(0, Math.min(255, img.gris[y * img.ancho + x] * f + (1 - f) * 40));
    }
  }
  return { ...img, gris: salida };
}

/** Reflejo del papel autoadhesivo: una mancha clara que tapa parte del codigo. */
function reflejo(img, cx, cy, radio) {
  const salida = Uint8Array.from(img.gris);
  for (let y = 0; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radio) continue;
      const f = 1 - d / radio;
      const i = y * img.ancho + x;
      salida[i] = Math.min(255, salida[i] + f * 210);
    }
  }
  return { ...img, gris: salida };
}

/** Pega el codigo dentro de una escena mas grande, con basura alrededor. */
function enEscena(img, anchoEscena, altoEscena, px, py, semilla = 3) {
  const azar = aleatorio(semilla);
  const gris = new Uint8Array(anchoEscena * altoEscena);
  for (let i = 0; i < gris.length; i++) gris[i] = 200 + azar() * 40;
  // Unas rayas oscuras, que es lo que aporta el texto de la ficha alrededor.
  for (let r = 0; r < 6; r++) {
    const y0 = Math.floor(azar() * altoEscena);
    const x0 = Math.floor(azar() * anchoEscena * 0.6);
    const largo = 20 + Math.floor(azar() * 80);
    for (let x = x0; x < Math.min(anchoEscena, x0 + largo); x++) {
      for (let dy = 0; dy < 3; dy++) {
        const y = y0 + dy;
        if (y < altoEscena) gris[y * anchoEscena + x] = 40;
      }
    }
  }
  for (let y = 0; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) {
      const dy = py + y, dx = px + x;
      if (dy >= 0 && dy < altoEscena && dx >= 0 && dx < anchoEscena) {
        gris[dy * anchoEscena + dx] = img.gris[y * img.ancho + x];
      }
    }
  }
  return { gris, ancho: anchoEscena, alto: altoEscena };
}

const leer = img => decodificarGris(img.gris, img.ancho, img.alto);

// ============================================================ imagen limpia

grupo('Imagen limpia');

const TEXTO = armarSticker('F03', 200, 147);
const matriz = generarMatriz(TEXTO, { nivel: 'H', versionMinima: 2 });

{
  for (const escala of [3, 4, 6, 8, 12, 20]) {
    const r = leer(dibujar(matriz, escala));
    comprobar(`escala ${escala} px por modulo`, r?.texto, TEXTO);
  }
  const r = leer(dibujar(matriz, 8));
  comprobar('detecta la version', r?.version, 2);
  comprobar('detecta el nivel de correccion', r?.nivel, 'H');
  comprobar('sin errores que corregir', r?.bytesCorregidos, 0);
}

{
  // Todas las versiones y niveles que soporta el generador.
  let ok = 0, total = 0;
  for (let v = 1; v <= 10; v++) {
    for (const nivel of ['L', 'M', 'Q', 'H']) {
      total++;
      const m = generarMatriz(TEXTO, { nivel, versionMinima: v });
      if (leer(dibujar(m, 6))?.texto === TEXTO) ok++;
    }
  }
  comprobar(`las 10 versiones x 4 niveles se leen (${ok}/${total})`, ok, total);
}

{
  // Los codigos reales del campori.
  const casos = [
    armarSticker('F01', 200, 1), armarSticker('E07', 200, 9999),
    armarSticker('A01', 100, 42), armarQrClub('C999'), armarQrClub('C053'),
  ];
  let ok = 0;
  for (const texto of casos) {
    const nivel = texto.includes('-CLUB-') ? 'Q' : 'H';
    if (leer(dibujar(generarMatriz(texto, { nivel, versionMinima: 2 }), 8))?.texto === texto) ok++;
  }
  comprobar(`los codigos reales se leen (${ok}/${casos.length})`, ok, casos.length);
}

{
  // Garantía previa a imprimir: todos los eventos actuales producen un símbolo
  // que el mismo lector usado por los iPhone puede recuperar por completo.
  const eventos = [...EVENTOS_FISICOS, ...EVENTOS_ESPIRITUALES, ...CRITERIOS_ADICIONALES];
  let ok = 0;
  for (let i = 0; i < eventos.length; i++) {
    const evento = eventos[i];
    const puntos = evento.tipo === 'adicional' ? evento.puntos : PUNTOS_EVENTO;
    const texto = armarSticker(evento.codigo, puntos, 5000 + i);
    if (leer(dibujar(generarMatriz(texto, { nivel: 'H', versionMinima: 2 }), 8))?.texto === texto) ok++;
  }
  comprobar(`todos los QR de eventos actuales se leen (${ok}/${eventos.length})`, ok, eventos.length);
}

// ============================================================ degradaciones

grupo('Degradaciones de una a una');

const base = () => dibujar(matriz, 10);

{
  for (const radio of [1, 2, 3, 4]) {
    const r = leer(desenfocar(base(), radio));
    comprobar(`desenfoque de radio ${radio}px`, r?.texto, TEXTO);
  }
}

{
  for (const grados of [-30, -15, -7, -3, 3, 7, 15, 30, 45]) {
    const r = leer(rotar(base(), grados));
    comprobar(`rotado ${grados}°`, r?.texto, TEXTO);
  }
}

{
  // La "fuerza" es cuanto se angosta el borde lejano. 0,3 equivale a mirar la ficha
  // desde unos 45 grados respecto de la perpendicular, que ya es bastante de costado.
  for (const fuerza of [0.1, 0.2, 0.3]) {
    const r = leer(inclinar(base(), fuerza));
    comprobar(`inclinado (perspectiva ${fuerza})`, r?.texto, TEXTO);
  }

  // Limite conocido. Mas alla de aca hay que enderezar el celular; lo dejamos
  // anotado para que se note si alguna vez mejora o empeora.
  const limite = leer(inclinar(base(), 0.4));
  comprobar('a 0,4 (unos 53 grados) ya no lee: limite conocido', limite, null);
}

{
  for (const sigma of [10, 25, 40]) {
    const r = leer(ruido(base(), sigma));
    comprobar(`ruido sigma ${sigma}`, r?.texto, TEXTO);
  }
}

{
  for (const factor of [0.6, 0.4, 0.25]) {
    const r = leer(contraste(base(), factor));
    comprobar(`contraste al ${Math.round(factor * 100)}%`, r?.texto, TEXTO);
  }
}

{
  for (const fuerza of [0.3, 0.5, 0.7]) {
    const r = leer(gradiente(base(), fuerza));
    comprobar(`iluminacion despareja ${fuerza}`, r?.texto, TEXTO);
  }
}

{
  const img = base();
  for (const radio of [img.ancho * 0.2, img.ancho * 0.3]) {
    const r = leer(reflejo(img, img.ancho * 0.35, img.alto * 0.4, radio));
    comprobar(`reflejo de radio ${Math.round(radio)}px`, r?.texto, TEXTO);
  }
}

{
  const img = base();
  const r = leer(enEscena(img, 640, 480, 210, 90));
  comprobar('codigo chico dentro de una escena con basura alrededor', r?.texto, TEXTO);

  const r2 = leer(enEscena(rotar(img, 12), 640, 480, 60, 40));
  comprobar('codigo rotado y descentrado en la escena', r2?.texto, TEXTO);
}

// ============================================================ combinaciones

grupo('Degradaciones combinadas (lo que pasa de verdad)');

{
  // Celular en la mano: algo de movimiento, algo de inclinacion, luz irregular.
  const casos = [
    ['mano temblorosa', img => ruido(desenfocar(rotar(img, 6), 2), 12)],
    ['telefono inclinado y con sombra', img => gradiente(inclinar(rotar(img, -9), 0.25), 0.45)],
    ['sticker con reflejo y movido', img => {
      const i = desenfocar(rotar(img, 4), 2);
      return reflejo(i, i.ancho * 0.65, i.alto * 0.3, i.ancho * 0.22);
    }],
    ['impresion palida y camara con ruido', img => ruido(contraste(desenfocar(img, 2), 0.45), 18)],
    ['todo junto', img => {
      let i = rotar(img, -11);
      i = inclinar(i, 0.2);
      i = desenfocar(i, 2);
      i = gradiente(i, 0.35);
      i = ruido(i, 14);
      return contraste(i, 0.7);
    }],
  ];
  for (const [nombre, aplicar] of casos) {
    const r = leer(aplicar(base()));
    comprobar(nombre, r?.texto, TEXTO);
  }
}

{
  // Sticker rayado o con una esquina despegada: para eso esta el nivel H.
  const img = base();
  const azar = aleatorio(4242);
  const rayado = { ...img, gris: Uint8Array.from(img.gris) };
  for (let r = 0; r < 3; r++) {
    const y0 = Math.floor(img.alto * (0.25 + azar() * 0.5));
    for (let x = Math.floor(img.ancho * 0.2); x < img.ancho * 0.8; x++) {
      for (let dy = 0; dy < 4; dy++) {
        const y = y0 + dy;
        if (y < img.alto) rayado.gris[y * img.ancho + x] = 255;
      }
    }
  }
  const r = leer(rayado);
  comprobar('sticker con tres rayones blancos', r?.texto, TEXTO);
  if (r) console.log(`      (se corrigieron ${r.bytesCorregidos} bytes)`);
}

// ============================================================ negativos

grupo('No debe inventar lecturas');

{
  const azar = aleatorio(31337);
  const puroRuido = { gris: new Uint8Array(400 * 400), ancho: 400, alto: 400 };
  for (let i = 0; i < puroRuido.gris.length; i++) puroRuido.gris[i] = azar() * 255;
  comprobar('ruido puro no devuelve nada', leer(puroRuido), null);

  const blanco = { gris: new Uint8Array(300 * 300).fill(255), ancho: 300, alto: 300 };
  comprobar('imagen en blanco no devuelve nada', leer(blanco), null);

  const negro = { gris: new Uint8Array(300 * 300).fill(0), ancho: 300, alto: 300 };
  comprobar('imagen negra no devuelve nada', leer(negro), null);

  // Un codigo destruido debe fallar, no devolver texto equivocado.
  const roto = base();
  const azar2 = aleatorio(555);
  for (let i = 0; i < roto.gris.length; i++) if (azar2() < 0.3) roto.gris[i] = 255 - roto.gris[i];
  const r = leer(roto);
  comprobar('un codigo destruido no devuelve texto equivocado', r === null || r.texto === TEXTO, true);
}

// ============================================================ velocidad

grupo('Velocidad');

{
  const escena = enEscena(dibujar(matriz, 7), 480, 360, 150, 60);
  const inicio = process.hrtime.bigint();
  const vueltas = 30;
  for (let i = 0; i < vueltas; i++) leer(escena);
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6 / vueltas;
  console.log(`      ${ms.toFixed(1)} ms por cuadro de 480x360`);
  comprobar('rinde para escanear en vivo (menos de 80 ms por cuadro)', ms < 80, true);
}

console.log('');
if (fallos.length) {
  for (const f of fallos) console.error(`FALLA ${f}`);
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
