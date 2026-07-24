// Generador simple de stickers QR. No crea fichas ni usa inventarios.

import {
  CAMPORI, PUNTOS_EVENTO,
  EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES, buscarEvento,
} from './catalogo.js';
import { armarSticker } from './codigo.js';
import { generarMatriz, matrizASvg } from './qr-encoder.js?v=2';
import { crearIdentificador } from './identificador.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const escapar = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Hoja oficio 215 x 330 mm, con 5 mm de margen: 12 columnas x 17 filas.
const COLUMNAS_POR_HOJA = 12;
const FILAS_POR_HOJA = 17;
const STICKERS_POR_HOJA = COLUMNAS_POR_HOJA * FILAS_POR_HOJA;
const LADO_QR_STICKER = 15;
const CLAVE_SERIALES = `campori-qr-unicos-${CAMPORI.prefijo}`;

// Este registro es interno y automático. No se descarga ni se carga: solamente
// evita repetir en este navegador uno de los identificadores aleatorios ya creados.
const serialesUsados = new Set();
try {
  const guardados = JSON.parse(localStorage.getItem(CLAVE_SERIALES) || '[]');
  if (Array.isArray(guardados)) guardados.forEach(x => serialesUsados.add(String(x)));
} catch { /* la generación sigue aunque el navegador bloquee localStorage */ }

function guardarSeriales() {
  try {
    localStorage.setItem(CLAVE_SERIALES, JSON.stringify([...serialesUsados]));
  } catch { /* los identificadores aleatorios siguen siendo prácticamente únicos */ }
}

function nuevoSerial(codigo) {
  return crearIdentificador(serialesUsados, codigo);
}

function pintarSelectorEventos() {
  const secciones = [
    { titulo: 'Eventos físicos', lista: EVENTOS_FISICOS, puntos: PUNTOS_EVENTO },
    { titulo: 'Eventos espirituales', lista: EVENTOS_ESPIRITUALES, puntos: PUNTOS_EVENTO },
    { titulo: 'Puntaje adicional', lista: CRITERIOS_ADICIONALES, puntos: null },
  ];

  $('#eventos').innerHTML = secciones.map(s => `
    <h3>${s.titulo}
      <button type="button" class="marcar-grupo chico" data-grupo="${escapar(s.titulo)}">alternar todos</button>
    </h3>
    <div class="rejilla" data-grupo="${escapar(s.titulo)}">
      ${s.lista.map(e => `
        <label class="opcion-evento">
          <input type="checkbox" name="evento" value="${e.codigo}" checked>
          <span class="mono">${e.codigo}</span>
          <span class="nombre">${escapar(e.nombre)}</span>
          <span class="pastilla">${s.puntos ?? e.puntos} pts</span>
        </label>`).join('')}
    </div>`).join('');

  $$('.marcar-grupo').forEach(b => b.addEventListener('click', () => {
    const casillas = $$(`.rejilla[data-grupo="${b.dataset.grupo}"] input`);
    const encender = !casillas.every(c => c.checked);
    casillas.forEach(c => { c.checked = encender; });
    actualizarConteo();
  }));
  $$('input[name=evento]').forEach(c => c.addEventListener('change', actualizarConteo));
}

function eventosElegidos() {
  return $$('input[name=evento]:checked').map(c => c.value);
}

function actualizarConteo() {
  const cantidad = Number($('#cantidad').value) || 0;
  const eventos = eventosElegidos();
  const total = eventos.length * cantidad;
  // Cada evento empieza en una hoja nueva para que los tacos no se mezclen.
  const hojas = eventos.length * Math.ceil(cantidad / STICKERS_POR_HOJA);
  $('#conteo-stickers').textContent =
    `${eventos.length} eventos × ${cantidad} = ${total} stickers · ${hojas} hoja${hojas === 1 ? '' : 's'} oficio`;

  const pesado = total > 900;
  $('#aviso-volumen').style.display = pesado ? '' : 'none';
  $('#aviso-volumen').textContent = pesado
    ? `Vas a dibujar ${total} códigos QR. El navegador puede tardar; si querés, generá unos pocos eventos por vez. Cada tanda tendrá identificadores nuevos.`
    : '';
}

function svgDe(texto, lado) {
  return matrizASvg(generarMatriz(texto, { nivel: 'H', versionMinima: 2 }), { lado, margen: 4 });
}

async function porTandas(items, tamano, hacer, alAvanzar) {
  const resultado = [];
  for (let i = 0; i < items.length; i += tamano) {
    for (const item of items.slice(i, i + tamano)) resultado.push(hacer(item));
    alAvanzar?.(Math.min(i + tamano, items.length), items.length);
    await new Promise(r => setTimeout(r, 0));
  }
  return resultado;
}

async function generarStickers() {
  const cantidad = Number($('#cantidad').value) || 0;
  const codigos = eventosElegidos();
  if (!codigos.length || cantidad < 1) {
    alert('Elegí al menos un evento y una cantidad mayor a cero.');
    return;
  }

  const aImprimir = [];
  for (const codigo of codigos) {
    const evento = buscarEvento(codigo);
    for (let i = 0; i < cantidad; i++) {
      aImprimir.push({
        evento,
        serial: nuevoSerial(codigo),
        puntos: evento.tipo === 'adicional' ? evento.puntos : PUNTOS_EVENTO,
      });
    }
  }
  guardarSeriales();

  const barra = $('#progreso');
  barra.style.display = '';
  const piezas = await porTandas(aImprimir, 40, ({ evento, serial, puntos }) => {
    const texto = armarSticker(evento.codigo, puntos, serial);
    return `<div class="sticker">
      ${svgDe(texto, LADO_QR_STICKER)}
      <div class="pie">${evento.codigo}·${puntos}<span class="serial"> ${serial}</span></div>
    </div>`;
  }, (hechos, total) => {
    barra.textContent = `Dibujando códigos QR… ${hechos} de ${total}`;
  });
  barra.style.display = 'none';

  const hojas = [];
  let indice = 0;
  for (const codigo of codigos) {
    const evento = buscarEvento(codigo);
    const delEvento = piezas.slice(indice, indice + cantidad);
    indice += cantidad;
    for (let i = 0; i < delEvento.length; i += STICKERS_POR_HOJA) {
      const tanda = delEvento.slice(i, i + STICKERS_POR_HOJA);
      const pagina = Math.floor(i / STICKERS_POR_HOJA) + 1;
      const paginas = Math.ceil(delEvento.length / STICKERS_POR_HOJA);
      hojas.push(`<section class="hoja">
        <div class="hoja-titulo">
          <span>${evento.codigo} — ${escapar(evento.nombre)} · ${evento.tipo === 'adicional' ? evento.puntos : PUNTOS_EVENTO} pts</span>
          <span class="derecha">${escapar(CAMPORI.nombre)} · hoja ${pagina}/${paginas} · ${tanda.length} stickers</span>
        </div>
        <div class="rejilla-stickers">${tanda.join('')}</div>
      </section>`);
    }
  }

  mostrar(hojas.join(''), `${aImprimir.length} QR únicos en ${hojas.length} hojas`);
}

function mostrar(html, descripcion) {
  $('#salida').innerHTML = html;
  $('#estado-salida').textContent = descripcion;
  $('#barra-impresion').style.display = '';
  $('#salida').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

pintarSelectorEventos();
actualizarConteo();

$('#cantidad').addEventListener('input', actualizarConteo);
$('#generar-stickers').addEventListener('click', generarStickers);
$('#imprimir').addEventListener('click', () => window.print());
$('#limpiar').addEventListener('click', () => {
  $('#salida').innerHTML = '';
  $('#estado-salida').textContent = '';
  $('#barra-impresion').style.display = 'none';
});
