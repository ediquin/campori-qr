// Pruebas del nucleo: firma de los QR y motor de puntaje.
//
//   node herramientas/pruebas-nucleo.mjs
//
// No usa framework de testing a proposito: el proyecto no tiene dependencias y
// tiene que poder correrse en cualquier maquina con node, sin instalar nada.

import crypto from 'crypto';
import {
  CAMPORI, PUNTOS_EVENTO, TOPE_BASE,
  EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES,
} from '../js/catalogo.js';
import { firmar, armarSticker, armarQrClub, leerQr } from '../js/codigo.js';
import { calcular } from '../js/puntaje.js';
import { crearIdentificador } from '../js/identificador.js';

let pasadas = 0;
const fallos = [];

function comprobar(nombre, obtenido, esperado) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${a}\n      esperado: ${b}`);
}

function grupo(titulo) { console.log(`\n--- ${titulo}`); }

// Genera escaneos con seriales distintos para cada llamada.
let siguienteSerial = 0;
const sticker = (codigo, puntos = PUNTOS_EVENTO, serial = ++siguienteSerial) =>
  ({ crudo: armarSticker(codigo, puntos, serial), ts: Date.now() });

// ============================================================ firma de los QR

grupo('Firma y formato de los codigos QR');

{
  // La firma propia tiene que coincidir con HMAC-SHA256 del modulo crypto de node.
  const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const referencia = cuerpo => {
    const h = crypto.createHmac('sha256', CAMPORI.clave).update(cuerpo).digest();
    let out = '';
    for (let i = 0; i < 4; i++) {
      const bit = i * 5, byte = bit >> 3;
      out += ALFABETO[(((h[byte] << 8) | h[byte + 1]) >> (11 - (bit & 7))) & 0x1f];
    }
    return out;
  };
  for (const cuerpo of ['AV5-F03-200-0147', 'AV5-CLUB-C012', '', 'x'.repeat(200)]) {
    comprobar(`firma coincide con HMAC-SHA256 ("${cuerpo.slice(0, 20)}")`, firmar(cuerpo), referencia(cuerpo));
  }
}

{
  const s = armarSticker('F03', 200, 147);
  comprobar('sticker: formato corto', s, 'F03-00000147');
  comprobar('sticker: solo tiene 12 caracteres', s.length, 12);
  comprobar('sticker: solo caracteres alfanumericos QR', /^[0-9A-Z\-]+$/.test(s), true);

  const l = leerQr(s);
  comprobar('sticker: se relee entero', [l.clase, l.codigo, l.puntos, l.serial, l.id],
    ['sticker', 'F03', null, '00000147', 'F03-00000147']);

  const c = armarQrClub('C012');
  comprobar('club: se relee entero', [leerQr(c).clase, leerQr(c).idClub], ['club', 'C012']);

  comprobar('rechaza texto vacio', leerQr('').motivo, 'vacio');
  comprobar('rechaza un QR ajeno', leerQr('https://ejemplo.com').motivo, 'ajeno');
  comprobar('rechaza firma inventada', leerQr('AV5-F03-200-0147-ZZZZ').motivo, 'firma');
  comprobar('acepta un identificador corto válido sin firma', leerQr('F09-ABCD1234').ok, true);
  comprobar('rechaza identificador con largo incorrecto', leerQr('F09-ABC123').motivo, 'formato');
  comprobar('tolera minusculas y espacios', leerQr(`  ${s.toLowerCase()} \n`).clase, 'sticker');
}

// ============================================================ motor de puntaje

grupo('Club que hace todo bien');

{
  const escaneos = [
    ...['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08'].map(c => sticker(c)),
    ...['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07'].map(c => sticker(c)),
  ];
  const r = calcular(escaneos);
  comprobar('8 fisicos suman 1600', r.fisico.puntos, 1600);
  comprobar('7 espirituales suman 1400', r.espiritual.puntos, 1400);
  comprobar('el total es el tope base', r.total, TOPE_BASE);
  comprobar('el total base es 3000', r.total, 3000);
  comprobar('queda marcado como completo', r.completo, true);
  comprobar('sin alertas', r.alertas.length, 0);
}

grupo('Modo operativo sin inventario');

{
  const usados = new Set();
  const ids = Array.from({ length: 5000 }, () => crearIdentificador(usados, 'F01'));
  comprobar('5000 identificadores generados son distintos', new Set(ids).size, 5000);
  comprobar('todos tienen ocho caracteres QR legibles',
    ids.every(id => /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(id)), true);

  const eventos = [...EVENTOS_FISICOS, ...EVENTOS_ESPIRITUALES, ...CRITERIOS_ADICIONALES];
  const estados = eventos.map((evento, i) => {
    const puntos = evento.tipo === 'adicional' ? evento.puntos : PUNTOS_EVENTO;
    return calcular([sticker(evento.codigo, puntos, 6000 + i)]).detalle[0].estado;
  });
  comprobar('todos los QR actuales se aceptan sin inventario',
    estados.every(estado => estado === 'contado'), true);

  const uno = sticker('F01', PUNTOS_EVENTO, 6999);
  comprobar('el sticker idéntico repetido se bloquea',
    calcular([uno, { ...uno }]).detalle[1].estado, 'serial_repetido');
}

grupo('Regla de los 8 eventos fisicos');

{
  // Pegan 10 fisicos: valen los 8 primeros escaneados, no los 8 "mejores"
  // (no hay mejores: todos valen igual).
  const escaneos = ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10'].map(c => sticker(c));
  const r = calcular(escaneos);
  comprobar('el tope se respeta', r.fisico.puntos, 1600);
  comprobar('cuenta 8 eventos', r.fisico.hechos, 8);
  comprobar('reporta 2 excedentes', r.fisico.excedentes, 2);
  comprobar('los descartados son los 2 ultimos escaneados',
    r.detalle.filter(d => d.estado === 'excedente').map(d => d.evento.codigo), ['F09', 'F10']);
  comprobar('avisa del exceso',
    r.alertas.some(a => a.texto.includes('10 eventos físicos')), true);
}

{
  // Un evento repetido no debe gastar uno de los 8 cupos.
  const escaneos = [
    sticker('F01'), sticker('F01'),  // el segundo es repetido, con OTRO serial
    ...['F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08'].map(c => sticker(c)),
  ];
  const r = calcular(escaneos);
  comprobar('el repetido no ocupa cupo: llega a 8 eventos', r.fisico.hechos, 8);
  comprobar('el repetido no suma puntos', r.fisico.puntos, 1600);
  comprobar('marca el repetido', r.detalle.filter(d => d.estado === 'repetido').length, 1);
}

grupo('Deteccion de trampas');

{
  // El mismo sticker fisico escaneado dos veces.
  const uno = sticker('F01');
  const r = calcular([uno, { ...uno }]);
  comprobar('detecta el mismo sticker dos veces', r.detalle[1].estado, 'serial_repetido');
  comprobar('solo cuenta una vez', r.fisico.puntos, PUNTOS_EVENTO);
}

{
  // Distinto evento, mismo numero de serial: son stickers distintos, ambos validos.
  const r = calcular([sticker('F01', PUNTOS_EVENTO, 7), sticker('F02', PUNTOS_EVENTO, 7)]);
  comprobar('serial repetido entre eventos distintos es valido', r.fisico.hechos, 2);
}

{
  // Un sticker que ya aparecio en la ficha de otro club.
  const s = sticker('F05');
  const id = leerQr(s.crudo).id;
  const r = calcular([s], { usadosPorOtros: new Map([[id, 'C012']]) });
  comprobar('detecta sticker de otro club', r.detalle[0].estado, 'serial_ajeno');
  comprobar('no suma', r.total, 0);
  comprobar('nombra al club que lo uso', r.alertas[0].texto.includes('C012'), true);
}

{
  // QR fabricado por fuera con un generador cualquiera.
  const r = calcular([{ crudo: 'AV5-F01-200-0001-AAAA', ts: 0 }, { crudo: '200', ts: 0 }]);
  comprobar('rechaza firma falsa', r.detalle[0].estado, 'invalido');
  comprobar('rechaza un QR que solo dice el puntaje', r.detalle[1].estado, 'invalido');
  comprobar('no suma nada', r.total, 0);
}

grupo('Eventos espirituales obligatorios');

{
  const r = calcular(['E01', 'E02', 'E03', 'E04', 'E05'].map(c => sticker(c)));
  comprobar('suma los que hizo', r.espiritual.puntos, 1000);
  comprobar('no queda completo', r.completo, false);
  comprobar('lista los faltantes', r.espiritual.faltantes.map(e => e.codigo), ['E06', 'E07']);
  comprobar('avisa cuantos faltan', r.alertas.some(a => a.texto.includes('Faltan 2')), true);
}

grupo('Puntaje adicional');

{
  const r = calcular([sticker('A01', 100), sticker('A04', 100)]);
  comprobar('suma los adicionales', r.adicional.puntos, 200);
  comprobar('queda fuera del puntaje base', r.totalBase, 0);
  comprobar('entra en el total', r.total, 200);
}

{
  // Cada evento adicional cuenta una sola vez por club.
  const r = calcular([sticker('A01', 100), sticker('A01', 100)]);
  comprobar('el mismo evento adicional suma una sola vez', r.adicional.puntos, 100);
  comprobar('el adicional repetido queda marcado', r.detalle[1].estado, 'repetido');
}

{
  comprobar('hay 35 eventos adicionales', CRITERIOS_ADICIONALES.length, 35);
  comprobar('los adicionales A01-A29 valen 100 puntos',
    CRITERIOS_ADICIONALES.slice(0, 29).every(evento => evento.puntos === 100), true);

  const porCod = Object.fromEntries(CRITERIOS_ADICIONALES.map(e => [e.codigo, e]));
  comprobar('los tres niveles de Botiquin valen 500/450/250',
    [porCod.A30.puntos, porCod.A34.puntos, porCod.A35.puntos], [500, 450, 250]);
  comprobar('los tres niveles comparten la misma rubrica',
    [porCod.A30.rubrica, porCod.A34.rubrica, porCod.A35.rubrica],
    ['botiquin', 'botiquin', 'botiquin']);
  comprobar('Plaza/Seguridad/Limpieza valen 200',
    [porCod.A31.puntos, porCod.A32.puntos, porCod.A33.puntos], [200, 200, 200]);

  // Un adicional de 500 lee su puntaje del catalogo, no el fijo de 200.
  comprobar('Botiquin y Personal (A30) suma 500', calcular([sticker('A30')]).adicional.puntos, 500);
  comprobar('Plaza (A31) suma 200', calcular([sticker('A31')]).adicional.puntos, 200);
}

grupo('Rúbrica de Botiquín: mutuamente excluyente');

{
  const cod = d => leerQr(d.escaneo.crudo).codigo;

  // Dos niveles del mismo grupo: cuenta solo el mayor, sin importar el orden.
  const r = calcular([sticker('A35'), sticker('A30')]);   // Solo(250) y luego Personal(500)
  comprobar('cuenta solo el nivel mas alto', r.adicional.puntos, 500);
  comprobar('el nivel menor queda desplazado',
    r.detalle.find(d => cod(d) === 'A35').estado, 'desplazado');
  comprobar('el desplazado no suma', r.detalle.find(d => cod(d) === 'A35').puntos, 0);
  comprobar('avisa del cruce como alerta grave',
    r.alertas.some(a => a.nivel === 'alerta' && a.texto.includes('rúbrica')), true);

  const alReves = calcular([sticker('A30'), sticker('A35')]);
  comprobar('el mayor gana aunque se escanee primero', alReves.adicional.puntos, 500);

  // Un solo nivel: cuenta normal, sin aviso.
  const uno = calcular([sticker('A34')]);
  comprobar('un solo nivel cuenta normal', uno.adicional.puntos, 450);
  comprobar('con un solo nivel no hay aviso de rubrica',
    uno.alertas.some(a => a.texto.includes('rúbrica')), false);

  // Los tres niveles: cuenta 500, desplaza dos.
  const tres = calcular([sticker('A35'), sticker('A34'), sticker('A30')]);
  comprobar('con los tres niveles cuenta solo 500', tres.adicional.puntos, 500);
  comprobar('quedan dos niveles desplazados',
    tres.detalle.filter(d => d.estado === 'desplazado').length, 2);
}

grupo('Sanciones');

{
  // Una sancion resta del total.
  const r = calcular([
    ...['F01', 'F02', 'F03', 'F04', 'F05'].map(c => sticker(c)),   // 1000
    sticker('S02'),                                                 // -500
  ]);
  comprobar('la sancion resta del total', r.total, 500);
  comprobar('el bucket de sancion es negativo', r.sancion.puntos, -500);
  comprobar('cuenta la sancion aplicada', r.sancion.cantidad, 1);
  comprobar('la sancion aparece como alerta grave',
    r.alertas.some(a => a.nivel === 'alerta' && a.texto.includes('No clasificar')), true);
}

{
  // Piso en cero: la sancion no deja el total negativo.
  const r = calcular([sticker('F01'), sticker('S01')]);   // 200 - 2000
  comprobar('el total nunca baja de cero', r.total, 0);
  comprobar('pero el total bruto conserva la resta real', r.totalBruto, -1800);
}

{
  // Repetible: dos stickers DISTINTOS de la misma sancion restan las dos veces.
  const r = calcular([
    ...['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08'].map(c => sticker(c)), // 1600
    ...['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07'].map(c => sticker(c)),         // 1400 -> 3000
    sticker('S02', -500, 100),
    sticker('S02', -500, 200),
  ]);
  comprobar('dos sanciones del mismo tipo restan dos veces', r.sancion.puntos, -1000);
  comprobar('cuenta las dos sanciones', r.sancion.cantidad, 2);
  comprobar('el total refleja las dos', r.total, 2000);
}

{
  // Pero el MISMO sticker de sancion escaneado dos veces resta una sola vez.
  const s = sticker('S02', -500, 77);
  const r = calcular([sticker('F01'), s, { ...s }]);
  comprobar('el mismo sticker de sancion no resta dos veces', r.sancion.puntos, -500);
  comprobar('el segundo escaneo del mismo sticker queda marcado', r.detalle[2].estado, 'serial_repetido');
}

grupo('Casos borde');

{
  comprobar('sin escaneos da cero', calcular([]).total, 0);
  comprobar('sin escaneos avisa de los 7 espirituales', calcular([]).espiritual.faltantes.length, 7);

  const conClub = calcular([{ crudo: armarQrClub('C001'), ts: 0 }, sticker('F01')]);
  comprobar('el QR de club no suma puntos', conClub.total, PUNTOS_EVENTO);
  comprobar('el QR de club se identifica', conClub.detalle[0].estado, 'club');

  const desconocido = calcular([sticker('F99')]);
  comprobar('rechaza un codigo fuera del catalogo', desconocido.detalle[0].estado, 'desconocido');

  // Sticker impreso con un puntaje que ya no coincide con el catalogo.
  const cuerpoViejo = 'AV5-F01-150-0147';
  const viejo = calcular([{ crudo: `${cuerpoViejo}-${firmar(cuerpoViejo)}`, ts: 0 }]);
  comprobar('usa el puntaje del catalogo, no el del sticker', viejo.fisico.puntos, PUNTOS_EVENTO);
  comprobar('avisa de la diferencia', viejo.alertas.some(a => a.texto.includes('150')), true);
}

// ============================================================ resultado

console.log('');
if (fallos.length) {
  for (const f of fallos) console.error(`FALLA ${f}`);
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
