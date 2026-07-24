// Arma una tanda generica de stickers para ensayar con cualquier club. Ningun QR
// lleva un club: cada uno tiene solamente evento, puntos, serial unico y firma.

import {
  PUNTOS_EVENTO,
  EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES, buscarEvento,
} from './catalogo.js';
import { armarSticker } from './codigo.js';
import { generarMatriz, matrizASvg } from './qr-encoder.js';
import { calcular } from './puntaje.js';

const $ = s => document.querySelector(s);
const escapar = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svgDe = (texto, lado) => matrizASvg(generarMatriz(texto, { nivel: 'Q' }), { lado, margen: 4 });

const AJUSTE_TANDA = 'campori-kit-tanda-v1';

function crearBaseTanda(anterior = null) {
  let numero;
  try {
    const bytes = new Uint16Array(1);
    crypto.getRandomValues(bytes);
    numero = bytes[0];
  } catch {
    numero = Date.now();
  }
  let base = 7000 + (numero % 1500); // 7000–8499: fuera de las tandas normales.
  if (base === anterior) base = 7000 + ((base - 6999) % 1500);
  sessionStorage.setItem(AJUSTE_TANDA, String(base));
  return base;
}

function leerBaseTanda() {
  const guardada = Number(sessionStorage.getItem(AJUSTE_TANDA));
  return guardada >= 7000 && guardada <= 8499 ? guardada : crearBaseTanda();
}

let baseTanda = leerBaseTanda();

// ------------------------------------------------------------------ el guion

// Cada entrada es un sticker del kit. `esperado` es lo que tiene que pasar al
// escanearlo, y se usa tanto para el rotulo impreso como para la comprobacion
// automatica que corre esta misma pagina.
function crearGuion(base) {
  // La tanda es independiente del club. Es el mismo modelo de los stickers reales:
  // cualquiera puede recibirlos, pero cada ejemplar solo puede usarse una vez.
  return [
    ...EVENTOS_FISICOS.slice(0, 8).map((e, i) => ({
      codigo: e.codigo, serial: base + i, grupo: 'Los 8 eventos físicos',
      esperado: 'contado', nota: `+${PUNTOS_EVENTO}`,
    })),
    {
      codigo: 'F03', serial: base + 100, grupo: 'Trampas',
      esperado: 'repetido', nota: 'Evento repetido: no suma',
      explicacion: 'Es otro sticker de un evento que el club ya hizo. La app lo marca en rojo.',
    },
    {
      codigo: 'F09', serial: base + 8, grupo: 'Trampas',
      esperado: 'excedente', nota: 'Noveno físico: no suma',
      explicacion: 'Pasado el cupo de 8, la app avisa y no lo cuenta.',
    },
    ...EVENTOS_ESPIRITUALES.map((e, i) => ({
      codigo: e.codigo, serial: base + i, grupo: 'Los 7 espirituales (obligatorios)',
      esperado: 'contado', nota: `+${PUNTOS_EVENTO}`,
    })),
    {
      codigo: CRITERIOS_ADICIONALES[0].codigo, serial: base,
      grupo: 'Puntaje adicional', esperado: 'contado',
      nota: `+${CRITERIOS_ADICIONALES[0].puntos}`,
    },
  ];
}

let GUION = crearGuion(baseTanda);

// ------------------------------------------------------------------ resultado esperado

// Corremos el guion por el mismo motor que usa la app, para que el resultado
// impreso no sea un numero que escribi a mano y despues quede desactualizado.
function resultadoEsperado() {
  let reloj = Date.now();
  const escaneos = GUION.map(s => ({
    crudo: armarSticker(s.codigo, buscarEvento(s.codigo).puntos ?? PUNTOS_EVENTO, s.serial),
    ts: reloj += 1000,
  }));
  return calcular(escaneos);
}

// ------------------------------------------------------------------ hoja

function hojaStickers() {
  const grupos = [];
  for (const s of GUION) {
    let g = grupos.find(x => x.nombre === s.grupo);
    if (!g) { g = { nombre: s.grupo, items: [] }; grupos.push(g); }
    g.items.push(s);
  }

  const bloques = grupos.map(g => `
    <h4 class="grupo-kit">${escapar(g.nombre)}</h4>
    <div class="rejilla-kit">
      ${g.items.map(s => {
        const evento = buscarEvento(s.codigo);
        const puntos = evento.puntos ?? PUNTOS_EVENTO;
        const trampa = s.esperado !== 'contado';
        return `<div class="sticker-kit${trampa ? ' trampa' : ''}"
          role="button" tabindex="0" title="Tocar para ampliar este QR">
          ${svgDe(armarSticker(s.codigo, puntos, s.serial), 24)}
          <div class="rotulo-kit">
            <strong>${s.codigo}</strong> · ${escapar(evento.nombre)}<br>
            <span class="serial-kit">serial ${String(s.serial).padStart(4, '0')}</span><br>
            <span class="${trampa ? 'esperado-trampa' : 'esperado-ok'}">${escapar(s.nota)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');

  return `<section class="hoja"><div class="kit">
    <div class="kit-titulo">
      <strong>Kit de ensayo — QR genéricos y únicos</strong>
      <span>Elegí cualquier club en el evaluador y escanealos en este orden.</span>
    </div>
    ${bloques}
  </div></section>`;
}

// ------------------------------------------------------------------ pantalla

function pintarGuion() {
  const r = resultadoEsperado();
  const graves = r.alertas.filter(a => a.nivel === 'alerta').length;
  const avisos = r.alertas.length - graves;

  $('#esperado').innerHTML = `
    <div class="rejilla" style="margin-bottom:14px">
      ${[[`${r.fisico.puntos}`, `físicos (${r.fisico.hechos}/${r.fisico.cupo})`],
         [`${r.espiritual.puntos}`, `espirituales (${r.espiritual.hechos}/${r.espiritual.cupo})`],
         [`${r.adicional.puntos}`, 'adicional'],
         [`${r.total}`, 'TOTAL'],
         [`${graves}`, 'alertas graves'],
         [`${avisos}`, 'avisos']].map(([v, k]) =>
        `<div class="marcador"><div class="valor">${v}</div><div class="rotulo">${k}</div></div>`).join('')}
    </div>
    <table><thead><tr><th>Al escanear</th><th>Tiene que pasar</th></tr></thead><tbody>
      ${GUION.filter(s => s.explicacion).map(s => {
        const evento = buscarEvento(s.codigo);
        return `<tr><td><span class="mono">${s.codigo}</span> ${escapar(evento.nombre)}
          <span class="tenue chico">serial ${String(s.serial).padStart(4, '0')}</span></td>
          <td><span class="pastilla alerta">${escapar(s.nota)}</span><br>
          <span class="tenue chico">${escapar(s.explicacion)}</span></td></tr>`;
      }).join('')}
      <tr><td colspan="2" class="tenue chico">Los demás stickers se cuentan normalmente.</td></tr>
    </tbody></table>`;

  $('#total-esperado').textContent = r.total;
}

// ------------------------------------------------------------------ arranque

function pintarKit() {
  pintarGuion();
  $('#salida').innerHTML = hojaStickers();
  $('#tanda-kit').textContent = String(baseTanda).padStart(4, '0');
}

$('#nueva-tanda').addEventListener('click', () => {
  baseTanda = crearBaseTanda(baseTanda);
  GUION = crearGuion(baseTanda);
  pintarKit();
});

function ampliarSticker(tarjeta) {
  $('#visor-contenido').innerHTML = tarjeta.innerHTML;
  $('#visor-qr').showModal();
}

$('#salida').addEventListener('click', e => {
  const tarjeta = e.target.closest('.sticker-kit');
  if (tarjeta) ampliarSticker(tarjeta);
});
$('#salida').addEventListener('keydown', e => {
  const tarjeta = e.target.closest('.sticker-kit');
  if (tarjeta && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    ampliarSticker(tarjeta);
  }
});
$('#cerrar-visor').addEventListener('click', () => $('#visor-qr').close());

pintarKit();
$('#imprimir').addEventListener('click', () => window.print());
