// Arma un ensayo completo del sistema en dos hojas: la ficha de un club y los
// stickers para pegarle. Los stickers no son de relleno: cada uno esta elegido para
// disparar una situacion distinta, incluidas las trampas que el sistema debe cazar.

import {
  CAMPORI, REGLAS, PUNTOS_EVENTO,
  EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES, buscarEvento,
} from './catalogo.js';
import { CLUBES, CLUB_PRUEBA, buscarClub } from './clubes.js';
import { armarSticker, armarQrClub } from './codigo.js';
import { generarMatriz, matrizASvg } from './qr-encoder.js';
import { calcular } from './puntaje.js';

const $ = s => document.querySelector(s);
const escapar = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svgDe = (texto, lado) => matrizASvg(generarMatriz(texto, { nivel: 'Q' }), { lado, margen: 4 });

let club = buscarClub(CLUB_PRUEBA);

// ------------------------------------------------------------------ el guion

// Cada entrada es un sticker del kit. `esperado` es lo que tiene que pasar al
// escanearlo, y se usa tanto para el rotulo impreso como para la comprobacion
// automatica que corre esta misma pagina.
function crearGuion(clubElegido) {
  // El rango 5000–9072 queda reservado para ensayos. El índice del club hace que
  // Aziel, ediquin y cualquier otro reciban stickers diferentes aunque correspondan
  // a los mismos eventos. El QR sigue sin llevar el club: solo cambia su serial.
  const indice = CLUBES.findIndex(c => c.id === clubElegido.id) + 1;
  const base = 5000 + indice;
  return [
    ...EVENTOS_FISICOS.slice(0, 8).map((e, i) => ({
      codigo: e.codigo, serial: base + i, grupo: 'Los 8 eventos físicos',
      esperado: 'contado', nota: `+${PUNTOS_EVENTO}`,
    })),
    {
      codigo: 'F03', serial: 6000 + indice, grupo: 'Trampas',
      esperado: 'repetido', nota: 'Evento repetido: no suma',
      explicacion: 'Es otro sticker de un evento que el club ya hizo. La app lo marca en rojo.',
    },
    {
      codigo: 'F09', serial: base + 8, grupo: 'Trampas',
      esperado: 'excedente', nota: 'Noveno físico: no suma',
      explicacion: 'Pasado el cupo de 8, la app avisa y no lo cuenta.',
    },
    {
      codigo: 'F12', serial: 9000 + indice, grupo: 'Trampas',
      esperado: 'no_inventariado', nota: 'Serial que no imprimimos',
      explicacion: 'Está bien firmado pero su serial no figura en el inventario. Solo se detecta si cargaste el inventario en Ajustes.',
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

let GUION = crearGuion(club);

// El inventario del kit: todo lo que "imprimimos" de verdad. El sticker de serial
// 9876 queda afuera a proposito, que es lo que lo delata.
function crearInventario() {
  return {
    campori: CAMPORI.prefijo,
    generado: new Date().toISOString(),
    clubPrueba: club.id,
    stickers: GUION
      .filter(s => s.esperado !== 'no_inventariado')
      .map(s => `${s.codigo}-${String(s.serial).padStart(4, '0')}`),
  };
}

let inventario = crearInventario();

// ------------------------------------------------------------------ resultado esperado

// Corremos el guion por el mismo motor que usa la app, para que el resultado
// impreso no sea un numero que escribi a mano y despues quede desactualizado.
function resultadoEsperado() {
  let reloj = Date.now();
  const escaneos = GUION.map(s => ({
    crudo: armarSticker(s.codigo, buscarEvento(s.codigo).puntos ?? PUNTOS_EVENTO, s.serial),
    ts: reloj += 1000,
  }));
  return calcular(escaneos, { inventario: new Set(inventario.stickers) });
}

// ------------------------------------------------------------------ hojas

function hojaFicha() {
  const casillasFisicas = Array.from({ length: REGLAS.fisicosQueCuentan }, (_, i) => `
    <div class="casilla">
      <div class="rotulo"><span class="num">Evento ${i + 1} de ${REGLAS.fisicosQueCuentan}</span></div>
      <div class="hueco">pegar sticker</div>
    </div>`).join('');

  const casillasEspirituales = EVENTOS_ESPIRITUALES.map(e => `
    <div class="casilla">
      <div class="rotulo"><span class="num">${e.codigo}</span> ${escapar(e.nombre)}</div>
      <div class="hueco">pegar sticker</div>
    </div>`).join('');

  const casillasAdicionales = CRITERIOS_ADICIONALES.map(e => `
    <div class="casilla">
      <div class="rotulo"><span class="num">${e.codigo} · ${e.puntos} pts</span> ${escapar(e.nombre)}</div>
      <div class="hueco">pegar sticker</div>
    </div>`).join('');

  return `<section class="hoja"><div class="ficha">
    <div class="ficha-cabecera">
      ${svgDe(armarQrClub(club.id), 24)}
      <div class="datos">
        <div class="nombre">${escapar(club.nombre)}</div>
        <div class="meta">${escapar(club.region)} · ${escapar(club.iglesia)}</div>
        <div class="id mono">${club.id}</div>
      </div>
      <div class="evento">
        <strong>${escapar(CAMPORI.nombre)}</strong><br>
        FICHA DE ENSAYO<br>
        Datos de prueba
      </div>
    </div>

    <h3>Eventos físicos
      <span class="regla">Elijan ${REGLAS.fisicosQueCuentan} de los ${EVENTOS_FISICOS.length}. No repitan ninguno. ${PUNTOS_EVENTO} pts cada uno.</span>
    </h3>
    <div class="casillas">${casillasFisicas}</div>

    <h3>Eventos espirituales
      <span class="regla">Los ${REGLAS.espiritualesObligatorios} son obligatorios. ${PUNTOS_EVENTO} pts cada uno.</span>
    </h3>
    <div class="casillas">${casillasEspirituales}</div>

    <h3>Puntaje adicional <span class="regla">Suma aparte del puntaje de eventos.</span></h3>
    <div class="casillas angostas">${casillasAdicionales}</div>

    <div class="ficha-pie">
      <span>El QR de arriba identifica al club. No lo tapen ni lo doblen.</span>
      <span class="firma">Firma del director/a</span>
      <span class="firma">Recibido por</span>
    </div>
  </div></section>`;
}

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
        return `<div class="sticker-kit${trampa ? ' trampa' : ''}">
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
      <strong>Kit de ensayo — stickers para recortar</strong>
      <span>Pegalos en la ficha de la hoja anterior, en el orden en que están acá.</span>
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

function bajarInventario() {
  const blob = new Blob([JSON.stringify(inventario, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inventario-kit-${club.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ arranque

function pintarKit() {
  pintarGuion();
  $('#salida').innerHTML = hojaFicha() + hojaStickers();
  document.querySelectorAll('.club-kit-nombre').forEach(el => {
    el.textContent = club.nombre;
  });
}

$('#club-kit').innerHTML = CLUBES.map(c =>
  `<option value="${c.id}"${c.id === club.id ? ' selected' : ''}>` +
  `${escapar(c.nombre)} · ${escapar(c.region)} (${c.id})</option>`
).join('');

$('#club-kit').addEventListener('change', e => {
  club = buscarClub(e.target.value);
  GUION = crearGuion(club);
  inventario = crearInventario();
  pintarKit();
});

pintarKit();
$('#imprimir').addEventListener('click', () => window.print());
$('#bajar-inventario').addEventListener('click', bajarInventario);
