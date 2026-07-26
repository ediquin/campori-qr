// Simulacion completa de una jornada de evaluacion sobre el club de prueba "ediquin".
//
//   node herramientas/pruebas-escenario.mjs
//
// Recorre una ficha realista, con sus errores y sus trampas, y comprueba que el
// sistema reaccione como corresponde. Ademas imprime un informe legible: sirve para
// mostrarle al equipo, sin tocar codigo, exactamente que va a hacer la app.

import { EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, TOPE_BASE } from '../js/catalogo.js';
import { CLUB_PRUEBA, buscarClub } from '../js/clubes.js';
import { armarSticker, armarQrClub, leerQr } from '../js/codigo.js';
import { calcular, ESTADOS } from '../js/puntaje.js';

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}

const club = buscarClub(CLUB_PRUEBA);
console.log(`Club de prueba: ${club.nombre} (${club.id})\n`);

// ------------------------------------------------------------------ la ficha

let reloj = Date.parse('2026-08-14T09:00:00Z');
const pegar = (codigo, serial) => ({ crudo: armarSticker(codigo, 200, serial), ts: reloj += 60000 });

// Asi queda la ficha que nos entrega el club, en el orden en que la escaneamos.
const ficha = [
  { que: 'QR de la cabecera de la ficha', escaneo: { crudo: armarQrClub(club.id), ts: reloj } },

  { que: 'Aventu acampante', escaneo: pegar('F01', 3) },
  { que: 'El traslado imposible', escaneo: pegar('F02', 11) },
  { que: 'El valde perforado', escaneo: pegar('F03', 7) },
  { que: 'Astronautas concentrados', escaneo: pegar('F04', 21) },

  // Trampa 1: pegan un segundo sticker de un evento que ya hicieron.
  { que: 'TRAMPA: repiten El valde perforado con otro sticker', escaneo: pegar('F03', 8) },

  { que: 'Transportando agua a Marte', escaneo: pegar('F05', 2) },
  { que: 'Mision espacial', escaneo: pegar('F06', 19) },
  { que: 'Entrenamiento de astronautas', escaneo: pegar('F07', 30) },
  { que: 'Estrella espacial', escaneo: pegar('F08', 5) },

  // Ya no existe el tope de ocho: los seis físicos restantes también suman.
  ...EVENTOS_FISICOS.slice(8).map((e, i) => ({
    que: `${e.nombre} (también cuenta)`,
    escaneo: pegar(e.codigo, 40 + i),
  })),

  ...EVENTOS_ESPIRITUALES.map((e, i) => ({ que: e.nombre, escaneo: pegar(e.codigo, i + 1) })),
];

// Trampa 2: el mismo sticker escaneado dos veces (una fotocopia pegada al lado).
const fotocopia = ficha[2].escaneo;
ficha.push({ que: 'TRAMPA: fotocopia del sticker de El traslado imposible', escaneo: { ...fotocopia, ts: reloj += 60000 } });

// Trampa 3: un sticker que otro club ya uso (se lo despegaron de la ficha).
const robado = armarSticker('F11', 200, 33);
ficha.push({ que: 'TRAMPA: sticker despegado de la ficha del club C053', escaneo: { crudo: robado, ts: reloj += 60000 } });
const usadosPorOtros = new Map([[leerQr(robado).id, 'C053']]);

// Trampa 4: un QR generado con el celular que solo dice el puntaje.
ficha.push({ que: 'TRAMPA: QR casero que dice 200', escaneo: { crudo: '200', ts: reloj += 60000 } });

// ------------------------------------------------------------------ evaluacion

const escaneos = ficha.map(f => f.escaneo);
const r = calcular(escaneos, { usadosPorOtros });

console.log('ESCANEO POR ESCANEO');
console.log('-'.repeat(78));
r.detalle.forEach((d, i) => {
  const info = ESTADOS[d.estado];
  const marca = { ok: '  ', info: '  ', aviso: '! ', alerta: '!!' }[info.nivel];
  const puntos = d.puntos ? `+${d.puntos}`.padStart(5) : '    —';
  console.log(`${marca} ${String(d.orden).padStart(2)}. ${ficha[i].que.padEnd(52).slice(0, 52)} ${puntos}  ${info.etiqueta}`);
});

console.log('\nRESULTADO');
console.log('-'.repeat(78));
console.log(`  Eventos fisicos      ${r.fisico.hechos}/${r.fisico.cupo}   ${String(r.fisico.puntos).padStart(5)} pts  (tope ${r.fisico.tope})`);
console.log(`  Eventos espirituales ${r.espiritual.hechos}/${r.espiritual.cupo}   ${String(r.espiritual.puntos).padStart(5)} pts  (tope ${r.espiritual.tope})`);
console.log(`  Puntaje adicional          ${String(r.adicional.puntos).padStart(5)} pts`);
console.log(`  TOTAL                      ${String(r.total).padStart(5)} pts`);

console.log('\nALERTAS PARA EL JURADO');
console.log('-'.repeat(78));
r.alertas.forEach(a => console.log(`  [${a.nivel.toUpperCase()}] ${a.texto}`));

// ------------------------------------------------------------------ comprobaciones

console.log('\nCOMPROBACIONES');
console.log('-'.repeat(78));

comprobar('el QR de club no suma puntos', r.detalle[0].estado, 'club');
comprobar('cuenta los 14 eventos fisicos', r.fisico.hechos, 14);
comprobar('los fisicos dan 2800', r.fisico.puntos, 2800);
comprobar('cuenta los 7 espirituales', r.espiritual.hechos, 7);
comprobar('los espirituales dan 1400', r.espiritual.puntos, 1400);
comprobar('no falta ningun espiritual', r.espiritual.faltantes, []);
comprobar('el total es el maximo posible', r.total, TOPE_BASE);
comprobar('el total es 4200', r.total, 4200);
comprobar('la ficha queda marcada como completa', r.completo, true);

const porEstado = {};
for (const d of r.detalle) porEstado[d.estado] = (porEstado[d.estado] || 0) + 1;
comprobar('detecta el evento repetido', porEstado.repetido, 1);
comprobar('detecta la fotocopia', porEstado.serial_repetido, 1);
comprobar('detecta el sticker de otro club', porEstado.serial_ajeno, 1);
comprobar('detecta el QR casero', porEstado.invalido, 1);
comprobar('cuenta 21 escaneos validos', porEstado.contado, 21);

comprobar('ninguna trampa suma puntos',
  r.detalle.filter(d => d.estado !== 'contado').every(d => d.puntos === 0), true);
// Las cuatro graves: evento repetido, fotocopia, sticker ajeno y QR casero.
comprobar('hay 4 alertas graves para revisar',
  r.alertas.filter(a => a.nivel === 'alerta').length, 4);
comprobar('las alertas graves aparecen antes que los avisos',
  r.alertas.slice(0, 4).every(a => a.nivel === 'alerta'), true);
comprobar('hacer mas de ocho fisicos no agrega avisos',
  r.alertas.filter(a => a.nivel === 'aviso').length, 0);

// Un club que hizo todo bien no debe generar ninguna alerta.
const limpio = calcular([
  ...EVENTOS_FISICOS.map((e, i) => pegar(e.codigo, i + 1)),
  ...EVENTOS_ESPIRITUALES.map((e, i) => pegar(e.codigo, i + 20)),
]);
comprobar('una ficha impecable no genera alertas', limpio.alertas.length, 0);
comprobar('una ficha impecable da 4200', limpio.total, 4200);

console.log('');
if (fallos.length) {
  for (const f of fallos) console.error(`FALLA ${f}`);
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} comprobaciones pasadas.`);
