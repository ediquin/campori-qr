// Generador de stickers imprimibles y de las fichas de evaluacion por club.

import {
  CAMPORI, REGLAS, PUNTOS_EVENTO,
  EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES, buscarEvento,
} from './catalogo.js';
import { CLUBES } from './clubes.js';
import { armarSticker, armarQrClub } from './codigo.js';
import { generarMatriz, matrizASvg } from './qr-encoder.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const escapar = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STICKERS_POR_HOJA = 7 * 9;   // la rejilla es de 7 columnas x 9 filas
const LADO_QR_STICKER = 24;        // mm; tiene que coincidir con css/impresos.css

// Registro acumulado de los seriales generados. El evaluador no necesita este
// registro, pero el generador lo conserva automaticamente para no repetir seriales
// aunque se cierre y se vuelva a abrir la pagina.
const CLAVE_REGISTRO = `campori-qr-seriales-${CAMPORI.prefijo}`;
let inventario = {
  campori: CAMPORI.prefijo,
  generado: new Date().toISOString(),
  stickers: [],       // ids con la forma "F03-0147"
};

function sincronizarRegistroAutomatico() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_REGISTRO) || 'null');
    if (guardado?.campori !== CAMPORI.prefijo || !Array.isArray(guardado.stickers)) return;
    inventario.stickers = [...new Set([...inventario.stickers, ...guardado.stickers])];
  } catch {
    // Si el navegador bloquea el almacenamiento, la generacion sigue funcionando.
  }
}

function guardarRegistroAutomatico() {
  inventario.generado = new Date().toISOString();
  try {
    localStorage.setItem(CLAVE_REGISTRO, JSON.stringify(inventario));
  } catch {
    // El respaldo descargable sigue disponible aunque el almacenamiento este lleno.
  }
}

// ------------------------------------------------------------------ interfaz

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

function pintarSelectorClubes() {
  const porRegion = new Map();
  for (const c of CLUBES) {
    if (!porRegion.has(c.region)) porRegion.set(c.region, []);
    porRegion.get(c.region).push(c);
  }
  $('#clubes').innerHTML = [...porRegion.entries()].map(([region, lista]) => `
    <h3>${escapar(region)} <span class="tenue chico">(${lista.length})</span>
      <button type="button" class="marcar-region chico" data-region="${escapar(region)}">alternar</button>
    </h3>
    <div class="rejilla" data-region="${escapar(region)}">
      ${lista.map(c => `
        <label class="opcion-evento">
          <input type="checkbox" name="club" value="${c.id}" ${c.id === 'C999' ? '' : 'checked'}>
          <span class="mono">${c.id}</span>
          <span class="nombre">${escapar(c.nombre)}</span>
        </label>`).join('')}
    </div>`).join('');

  $$('.marcar-region').forEach(b => b.addEventListener('click', () => {
    const casillas = $$(`.rejilla[data-region="${b.dataset.region}"] input`);
    const encender = !casillas.every(c => c.checked);
    casillas.forEach(c => { c.checked = encender; });
    actualizarConteo();
  }));
  $$('input[name=club]').forEach(c => c.addEventListener('change', actualizarConteo));
}

function eventosElegidos() {
  return $$('input[name=evento]:checked').map(c => c.value);
}
function clubesElegidos() {
  const ids = new Set($$('input[name=club]:checked').map(c => c.value));
  return CLUBES.filter(c => ids.has(c.id));
}

function actualizarConteo() {
  const cantidad = Number($('#cantidad').value) || 0;
  const eventos = eventosElegidos();
  const total = eventos.length * cantidad;
  const hojas = Math.ceil(total / STICKERS_POR_HOJA);
  $('#conteo-stickers').textContent =
    `${eventos.length} eventos × ${cantidad} = ${total} stickers · ${hojas} hoja${hojas === 1 ? '' : 's'} A4`;
  $('#conteo-fichas').textContent = `${clubesElegidos().length} fichas (1 hoja cada una)`;

  const pesado = total > 900;
  $('#aviso-volumen').style.display = pesado ? '' : 'none';
  $('#aviso-volumen').textContent = pesado
    ? `Vas a dibujar ${total} códigos QR de una sola vez. El navegador puede tardar y la vista previa quedar pesada. Conviene imprimir por tandas: elegí unos pocos eventos, imprimí, y seguí con los demás (el contador de seriales sigue solo).`
    : '';
}

// ------------------------------------------------------------------ seriales

// El serial arranca donde termino la ultima generacion de ese evento.
function siguienteSerial(codigo) {
  let maximo = 0;
  for (const id of inventario.stickers) {
    if (!id.startsWith(codigo + '-')) continue;
    const n = Number(id.slice(codigo.length + 1));
    if (n > maximo) maximo = n;
  }
  return maximo + 1;
}

// ------------------------------------------------------------------ generacion

function svgDe(texto, lado) {
  return matrizASvg(generarMatriz(texto, { nivel: 'Q' }), { lado, margen: 4 });
}

/** Divide un trabajo largo en tandas para que la pagina no se congele. */
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

  // Volvemos a leer el registro por si otra pestaña genero una tanda desde que se
  // abrio esta pagina. No requiere ningun archivo ni accion del usuario.
  sincronizarRegistroAutomatico();

  // Primero armamos la lista completa de lo que hay que imprimir.
  const aImprimir = [];
  for (const codigo of codigos) {
    const evento = buscarEvento(codigo);
    const desde = siguienteSerial(codigo);
    for (let n = desde; n < desde + cantidad; n++) {
      aImprimir.push({ evento, serial: n, puntos: evento.tipo === 'adicional' ? evento.puntos : PUNTOS_EVENTO });
    }
  }

  const barra = $('#progreso');
  barra.style.display = '';
  const piezas = await porTandas(aImprimir, 40, ({ evento, serial, puntos }) => {
    const texto = armarSticker(evento.codigo, puntos, serial);
    inventario.stickers.push(`${evento.codigo}-${String(serial).padStart(4, '0')}`);
    return `<div class="sticker">
      ${svgDe(texto, LADO_QR_STICKER)}
      <div class="pie">${evento.codigo}·${puntos}<span class="serial"> ${String(serial).padStart(4, '0')}</span></div>
    </div>`;
  }, (hechos, total) => {
    barra.textContent = `Dibujando códigos QR… ${hechos} de ${total}`;
  });
  barra.style.display = 'none';

  // Agrupamos por evento para que cada hoja sea de un solo evento: asi cada juez
  // recibe su taco de stickers sin tener que separarlos a mano.
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

  mostrar(hojas.join(''), `${aImprimir.length} stickers en ${hojas.length} hojas`);
  guardarRegistroAutomatico();
  actualizarResumenInventario();
}

async function generarFichas() {
  const clubes = clubesElegidos();
  if (!clubes.length) { alert('Elegí al menos un club.'); return; }

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

  const barra = $('#progreso');
  barra.style.display = '';
  const hojas = await porTandas(clubes, 10, club => `
    <section class="hoja"><div class="ficha">
      <div class="ficha-cabecera">
        ${svgDe(armarQrClub(club.id), 24)}
        <div class="datos">
          <div class="nombre">${escapar(club.nombre)}</div>
          <div class="meta">${escapar(club.region)} · ${escapar(club.iglesia)} · Distrito ${escapar(club.distrito)}</div>
          <div class="meta">Director/a: ${escapar(club.director || '—')}</div>
          <div class="id mono">${club.id}</div>
        </div>
        <div class="evento">
          <strong>${escapar(CAMPORI.nombre)}</strong><br>
          Ficha de evaluación<br>
          Máximo ${REGLAS.fisicosQueCuentan * PUNTOS_EVENTO + REGLAS.espiritualesObligatorios * PUNTOS_EVENTO} pts
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

      <h3>Puntaje adicional
        <span class="regla">Suma aparte del puntaje de eventos.</span>
      </h3>
      <div class="casillas angostas">${casillasAdicionales}</div>

      <div class="ficha-pie">
        <span>El QR de arriba identifica al club. No lo tapen ni lo doblen.</span>
        <span class="firma">Firma del director/a</span>
        <span class="firma">Recibido por</span>
      </div>
    </div></section>`, (hechos, total) => {
    barra.textContent = `Armando fichas… ${hechos} de ${total}`;
  });
  barra.style.display = 'none';

  mostrar(hojas.join(''), `${clubes.length} fichas`);
}

function mostrar(html, descripcion) {
  $('#salida').innerHTML = html;
  $('#estado-salida').textContent = descripcion;
  $('#barra-impresion').style.display = '';
  $('#salida').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------------ inventario

function actualizarResumenInventario() {
  const total = inventario.stickers.length;
  $('#resumen-inventario').innerHTML = total === 0
    ? '<span class="tenue">Todavía no generaste ningún sticker en este navegador.</span>'
    : `<strong>${total}</strong> seriales recordados automáticamente en este navegador.<br>` + resumenPorEvento();
  $('#bajar-inventario').disabled = total === 0;
}

function resumenPorEvento() {
  const porEvento = new Map();
  for (const id of inventario.stickers) {
    const codigo = id.slice(0, id.indexOf('-'));
    const n = Number(id.slice(codigo.length + 1));
    const r = porEvento.get(codigo) || { min: Infinity, max: 0, total: 0 };
    r.min = Math.min(r.min, n); r.max = Math.max(r.max, n); r.total++;
    porEvento.set(codigo, r);
  }
  return `<div class="chico tenue" style="margin-top:6px">` + [...porEvento.entries()]
    .map(([c, r]) => `${c}: ${String(r.min).padStart(4, '0')}–${String(r.max).padStart(4, '0')} (${r.total})`)
    .join(' · ') + '</div>';
}

function bajarInventario() {
  inventario.generado = new Date().toISOString();
  const blob = new Blob([JSON.stringify(inventario, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inventario-stickers-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function cargarInventario(archivo) {
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const datos = JSON.parse(lector.result);
      if (datos.campori !== CAMPORI.prefijo) {
        alert(`Ese inventario es del campori "${datos.campori}" y este es "${CAMPORI.prefijo}". No lo cargo.`);
        return;
      }
      if (!Array.isArray(datos.stickers)) { alert('El archivo no tiene la lista de stickers.'); return; }
      // Unimos sin duplicar: se puede cargar el inventario de varias tandas.
      const juntos = new Set([...inventario.stickers, ...datos.stickers]);
      const nuevos = juntos.size - inventario.stickers.length;
      inventario.stickers = [...juntos];
      guardarRegistroAutomatico();
      actualizarResumenInventario();
      alert(`Inventario cargado: ${nuevos} seriales nuevos, ${inventario.stickers.length} en total.\n` +
            `Los stickers que generes ahora siguen la numeración desde donde quedó.`);
    } catch (e) {
      alert('No pude leer el archivo: ' + e.message);
    }
  };
  lector.readAsText(archivo);
}

// ------------------------------------------------------------------ arranque

sincronizarRegistroAutomatico();
pintarSelectorEventos();
pintarSelectorClubes();
actualizarConteo();
actualizarResumenInventario();

$('#cantidad').addEventListener('input', actualizarConteo);
$('#generar-stickers').addEventListener('click', generarStickers);
$('#generar-fichas').addEventListener('click', generarFichas);
$('#imprimir').addEventListener('click', () => window.print());
$('#bajar-inventario').addEventListener('click', bajarInventario);
$('#subir-inventario').addEventListener('change', e => {
  if (e.target.files[0]) cargarInventario(e.target.files[0]);
  e.target.value = '';
});
$('#limpiar').addEventListener('click', () => {
  $('#salida').innerHTML = '';
  $('#estado-salida').textContent = '';
  $('#barra-impresion').style.display = 'none';
});
