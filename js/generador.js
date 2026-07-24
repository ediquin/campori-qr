// Generador simple de stickers QR. No crea fichas ni usa inventarios.

import {
  CAMPORI, PUNTOS_EVENTO,
  EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES, buscarEvento,
} from './catalogo.js';
import { armarSticker } from './codigo.js';
import { generarMatriz, matrizASvg } from './qr-encoder.js?v=2';
import { crearIdentificador } from './identificador.js';
import {
  LADO_QR_MM, obtenerFormatoPapel,
  planificarPaginas, resumirPagina, crearPdfStickers,
} from './pdf-stickers.js?v=3';
import { descargar } from './exportar.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const escapar = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// El QR conserva 15 mm tanto en oficio como en carta.
const LADO_QR_STICKER = LADO_QR_MM;
const CLAVE_SERIALES = `campori-qr-unicos-${CAMPORI.prefijo}`;
let ultimaGeneracion = null;

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

function formatoElegido() {
  return obtenerFormatoPapel($('#formato-papel').value);
}

function aplicarFormatoPapel(formato) {
  document.documentElement.style.setProperty('--ancho-hoja-vista', `${formato.anchoMm - 10}mm`);
  document.documentElement.style.setProperty('--alto-hoja-vista', `${formato.altoMm - 10}mm`);
  $('#estilo-papel-impresion').textContent =
    `@media print { @page { size: ${formato.anchoMm}mm ${formato.altoMm}mm; margin: 5mm; } }`;
  $('#detalle-papel').textContent =
    `PDF ${formato.nombre}: ${(formato.anchoMm / 10).toLocaleString('es-BO')} × ` +
    `${(formato.altoMm / 10).toLocaleString('es-BO')} cm · hasta ${formato.capacidad} QR de 1,5 cm.`;
}

function actualizarConteo() {
  const cantidad = Number($('#cantidad').value) || 0;
  const eventos = eventosElegidos();
  const total = eventos.length * cantidad;
  const formato = formatoElegido();
  const hojas = Math.ceil(total / formato.capacidad);
  $('#conteo-stickers').textContent =
    `${eventos.length} eventos × ${cantidad} = ${total} stickers · ` +
    `${hojas} hoja${hojas === 1 ? '' : 's'} ${formato.nombre.toLowerCase()}`;

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
  const gruposPdf = [];
  for (const codigo of codigos) {
    const evento = buscarEvento(codigo);
    const puntos = evento.tipo === 'adicional' ? evento.puntos : PUNTOS_EVENTO;
    const grupoPdf = {
      codigo: evento.codigo,
      nombre: evento.nombre,
      puntos,
      stickers: [],
    };
    for (let i = 0; i < cantidad; i++) {
      const serial = nuevoSerial(codigo);
      const texto = armarSticker(evento.codigo, puntos, serial);
      aImprimir.push({
        evento,
        serial,
        puntos,
        texto,
      });
      grupoPdf.stickers.push({ serial, texto });
    }
    gruposPdf.push(grupoPdf);
  }
  guardarSeriales();

  const barra = $('#progreso');
  barra.style.display = 'block';
  $('#generar-stickers').disabled = true;
  $('#formato-papel').disabled = true;
  $('#descargar-pdf').disabled = true;
  $('#imprimir').disabled = true;
  $('#limpiar').disabled = true;
  let piezas;
  try {
    piezas = await porTandas(aImprimir, 40, ({ evento, serial, puntos, texto }) => {
      return `<div class="sticker">
        ${svgDe(texto, LADO_QR_STICKER)}
        <div class="pie">${evento.codigo}·${puntos}<span class="serial"> ${serial}</span></div>
      </div>`;
    }, (hechos, total) => {
      barra.textContent = `Dibujando códigos QR… ${hechos} de ${total}`;
    });
  } catch (error) {
    console.error(error);
    const disponible = Boolean(ultimaGeneracion);
    $('#descargar-pdf').disabled = !disponible;
    $('#imprimir').disabled = !disponible;
    $('#limpiar').disabled = !disponible;
    alert(`No se pudieron generar los QR: ${error.message}`);
    return;
  } finally {
    barra.style.display = 'none';
    $('#generar-stickers').disabled = false;
    $('#formato-papel').disabled = false;
  }

  let indicePieza = 0;
  gruposPdf.forEach(grupo => {
    grupo.stickers.forEach(sticker => {
      sticker.html = piezas[indicePieza++];
    });
  });

  ultimaGeneracion = {
    campori: CAMPORI.nombre,
    formatoPapel: formatoElegido().id,
    grupos: gruposPdf,
  };
  mostrarGeneracion(ultimaGeneracion);
}

function mostrarGeneracion(generacion) {
  const formato = obtenerFormatoPapel(generacion.formatoPapel);
  aplicarFormatoPapel(formato);
  const paginas = planificarPaginas(generacion.grupos, formato.id);
  const hojas = paginas.map(pagina => `<section class="hoja">
    <div class="hoja-titulo">
      <span class="eventos-pagina" title="${escapar(resumirPagina(pagina, 1000))}">${escapar(resumirPagina(pagina))}</span>
      <span class="derecha">${escapar(generacion.campori)} · ${formato.nombre} · hoja ${pagina.numeroPagina}/${pagina.paginasTotal} · ${pagina.stickers.length} stickers</span>
    </div>
    <div class="rejilla-stickers">${pagina.stickers.map(sticker => sticker.html).join('')}</div>
  </section>`);

  const total = generacion.grupos.reduce((n, grupo) => n + grupo.stickers.length, 0);
  const descripcion =
    `${total} QR ${total === 1 ? 'único' : 'únicos'} en ` +
    `${hojas.length} hoja${hojas.length === 1 ? '' : 's'} ${formato.nombre.toLowerCase()}`;
  mostrar(hojas.join(''), descripcion);
}

function mostrar(html, descripcion) {
  $('#salida').innerHTML = html;
  $('#estado-salida').textContent = descripcion;
  $('#descargar-pdf').disabled = false;
  $('#imprimir').disabled = false;
  $('#limpiar').disabled = false;
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

async function descargarPdf() {
  if (!ultimaGeneracion) return;
  const generacion = ultimaGeneracion;
  const boton = $('#descargar-pdf');
  boton.disabled = true;
  $('#generar-stickers').disabled = true;
  $('#formato-papel').disabled = true;
  $('#imprimir').disabled = true;
  $('#limpiar').disabled = true;
  $('#estado-salida').textContent = 'Creando PDF vectorial…';
  try {
    const pdf = await crearPdfStickers(generacion, {
      alAvanzar: ({ hechos, total, pagina, paginas }) => {
        $('#estado-salida').textContent =
          `Creando PDF… ${hechos}/${total} QR · hoja ${pagina}/${paginas}`;
      },
    });
    const formato = obtenerFormatoPapel(generacion.formatoPapel);
    descargar(pdf, `stickers-campori-${formato.id}-${hoy()}.pdf`);
    const total = generacion.grupos.reduce((n, grupo) => n + grupo.stickers.length, 0);
    $('#estado-salida').textContent = `PDF ${formato.nombre} descargado · ${total} QR`;
  } catch (error) {
    console.error(error);
    $('#estado-salida').textContent = 'No se pudo crear el PDF';
    alert(`No se pudo crear el PDF: ${error.message}`);
  } finally {
    const disponible = Boolean(ultimaGeneracion);
    $('#generar-stickers').disabled = false;
    $('#formato-papel').disabled = false;
    boton.disabled = !disponible;
    $('#imprimir').disabled = !disponible;
    $('#limpiar').disabled = !disponible;
  }
}

pintarSelectorEventos();
aplicarFormatoPapel(formatoElegido());
actualizarConteo();

$('#cantidad').addEventListener('input', actualizarConteo);
$('#formato-papel').addEventListener('change', () => {
  const formato = formatoElegido();
  aplicarFormatoPapel(formato);
  actualizarConteo();
  if (ultimaGeneracion) {
    ultimaGeneracion.formatoPapel = formato.id;
    mostrarGeneracion(ultimaGeneracion);
  }
});
$('#generar-stickers').addEventListener('click', generarStickers);
$('#descargar-pdf').addEventListener('click', descargarPdf);
$('#imprimir').addEventListener('click', () => window.print());
$('#limpiar').addEventListener('click', () => {
  ultimaGeneracion = null;
  $('#salida').innerHTML = '';
  $('#estado-salida').textContent = 'Primero generá las hojas de stickers';
  $('#descargar-pdf').disabled = true;
  $('#imprimir').disabled = true;
  $('#limpiar').disabled = true;
});
