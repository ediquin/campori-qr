// App de evaluacion: escanea las fichas con la camara y arma el puntaje por club.

import { CAMPORI, REGLAS, TOPE_FISICO, TOPE_ESPIRITUAL, etiquetaTipo } from './catalogo.js';
import { CLUBES, buscarClub } from './clubes.js';
import { leerQr } from './codigo.js';
import { calcular, ESTADOS } from './puntaje.js';
import { Escaner, VERSION_LECTOR, pitido, vibrar, activarSonido } from './escaner.js?v=5';
import { aXlsx, aCsv, descargar } from './exportar.js';
import * as sheets from './sheets.js';
import * as almacen from './almacen.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const escapar = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hoy = () => new Date().toISOString().slice(0, 10);

const ICONOS = {
  contado: '✅', club: '🏷️', repetido: '🔁', excedente: '🔢',
  serial_repetido: '🔁', serial_ajeno: '🚨',
  desconocido: '❓', invalido: '❌',
};

const estado = {
  vista: 'clubes',
  club: null,           // club en evaluacion
  escaneos: [],         // escaneos del club actual, en orden
  todos: [],            // todos los escaneos de todos los clubes
  fichas: new Map(),
  dispositivo: '',      // quien evalua con este telefono
  // Que sticker uso cada club segun la planilla compartida. Es lo que permite
  // detectar un sticker prestado entre clubes que evaluaron personas distintas:
  // este telefono por si solo nunca lo sabria.
  remotos: new Map(),   // id de sticker -> ids de clubes, traidos de Sheets
  remotosFecha: null,
  conectado: false,
  sincronizando: false,
  pendientes: new Set(),
  temporizadorSync: null,
  intervaloSync: null,
  escaner: null,
  linternaEncendida: false,
};

// ------------------------------------------------------------------ calculo

/**
 * Que stickers ya uso otro club. Es lo que detecta un sticker despegado y reusado.
 *
 * Se arma con dos fuentes: lo que hay en este telefono, y lo que trajimos de la
 * planilla compartida. La segunda es imprescindible cuando cada evaluador tiene sus
 * propios clubes, porque el sticker robado y el club al que se lo robaron pueden
 * estar en telefonos distintos.
 */
function usadosPorOtros(idClubActual) {
  // De la planilla: si el mismo sticker figura en dos o mas clubes, TODOS quedan
  // en conflicto. No elegimos un dueño automaticamente; se resuelve con los
  // directores y se corrige en la planilla final.
  const mapa = sheets.conflictosRemotosParaClub(estado.remotos, idClubActual);

  // De este telefono. Complementa lo remoto y permite detectar el conflicto aunque
  // los dos clubes hayan sido evaluados con el mismo celular.
  for (const e of estado.todos) {
    if (e.idClub === idClubActual) continue;
    const l = leerQr(e.crudo);
    if (l.ok && l.clase === 'sticker') mapa.set(l.id, e.idClub);
  }
  return mapa;
}

function idDeSticker(crudo) {
  const l = leerQr(crudo);
  return l.ok && l.clase === 'sticker' ? l.id : null;
}

function resultadoDe(idClub, escaneos) {
  return calcular(escaneos, {
    usadosPorOtros: usadosPorOtros(idClub),
  });
}

/** Recalcula todos los clubes de una. Se usa en la vista de resultados y al exportar. */
function resultadosDeTodos() {
  const porClub = new Map();
  for (const e of estado.todos) {
    if (!porClub.has(e.idClub)) porClub.set(e.idClub, []);
    porClub.get(e.idClub).push(e);
  }
  return CLUBES.map(club => {
    const escaneos = (porClub.get(club.id) || []).sort((a, b) => a.ts - b.ts);
    return { club, escaneos, resultado: resultadoDe(club.id, escaneos), ficha: estado.fichas.get(club.id) };
  });
}

// ------------------------------------------------------------------ vistas

function mostrarVista(nombre) {
  estado.vista = nombre;
  $$('.vista').forEach(v => v.classList.toggle('activa', v.id === `vista-${nombre}`));
  $$('nav.pestanas button').forEach(b => b.setAttribute('aria-current', String(b.dataset.vista === nombre)));
  window.scrollTo({ top: 0 });
  if (nombre === 'resultados') pintarResultados();
  if (nombre === 'ajustes') pintarDiagnostico();
  if (nombre === 'clubes') pintarClubes();
  // Apagamos la camara al salir: consume bateria y no tiene sentido dejarla viva.
  if (nombre !== 'escaneo') apagarCamara();
}

// ------------------------------------------------------------------ lista de clubes

function pintarClubes() {
  const texto = $('#buscar').value.trim().toLowerCase();
  const region = $('#filtro-region').value;
  const filtroEstado = $('#filtro-estado').value;
  const todos = resultadosDeTodos();

  const visibles = todos.filter(({ club, escaneos, resultado, ficha }) => {
    if (region && club.region !== region) return false;
    if (texto && ![club.nombre, club.iglesia, club.region, club.id, club.distrito]
      .some(c => String(c).toLowerCase().includes(texto))) return false;
    if (filtroEstado === 'sin' && escaneos.length) return false;
    if (filtroEstado === 'curso' && (!escaneos.length || ficha?.cerrada)) return false;
    if (filtroEstado === 'cerrada' && !ficha?.cerrada) return false;
    if (filtroEstado === 'alerta' && !resultado.alertas.some(a => a.nivel === 'alerta')) return false;
    return true;
  });

  if (!visibles.length) {
    $('#lista-clubes').innerHTML = '<p class="tenue chico">Ningún club coincide con el filtro.</p>';
    return;
  }

  $('#lista-clubes').innerHTML = visibles.map(({ club, escaneos, resultado, ficha }) => {
    const graves = resultado.alertas.filter(a => a.nivel === 'alerta').length;
    const marcas = [];
    if (ficha?.cerrada) marcas.push('<span class="pastilla ok">terminada</span>');
    else if (escaneos.length) marcas.push('<span class="pastilla info">en curso</span>');
    if (graves) marcas.push(`<span class="pastilla alerta">${graves} alerta${graves === 1 ? '' : 's'}</span>`);
    if (escaneos.length) {
      marcas.push(`<span class="pastilla">F ${resultado.fisico.hechos}/${REGLAS.fisicosQueCuentan}</span>`);
      marcas.push(`<span class="pastilla${resultado.espiritual.faltantes.length ? ' aviso' : ' ok'}">E ${resultado.espiritual.hechos}/${REGLAS.espiritualesObligatorios}</span>`);
    }
    return `<button class="tarjeta-club" data-club="${club.id}">
      <div class="cuerpo">
        <div class="nombre">${escapar(club.nombre)}</div>
        <div class="meta">${escapar(club.region)} · ${escapar(club.iglesia)}</div>
        <div class="marcas">${marcas.join('')}</div>
      </div>
      <div class="total">${resultado.total}<small>puntos</small></div>
    </button>`;
  }).join('');

  $$('.tarjeta-club').forEach(b => b.addEventListener('click', () => abrirClub(b.dataset.club)));
}

// ------------------------------------------------------------------ escaneo

async function abrirClub(idClub) {
  const club = buscarClub(idClub);
  if (!club) return;
  estado.club = club;
  estado.escaneos = await almacen.escaneosDeClub(idClub);
  $('#sin-club').classList.add('oculto');
  $('#zona-escaneo').classList.remove('oculto');
  $('#club-nombre').textContent = club.nombre;
  mostrarVista('escaneo');
  pintarFicha();
  avisar('info', '📋', `Ficha de ${club.nombre}`, 'Encendé la cámara y pasá los stickers uno por uno.');
}

function pintarFicha() {
  if (!estado.club) return;
  const r = resultadoDe(estado.club.id, estado.escaneos);

  $('#club-total').textContent = r.total;

  const marcador = (sel, valor, clase) => {
    const el = $(sel);
    el.querySelector('.valor').textContent = valor;
    el.classList.toggle('completo', clase === 'completo');
    el.classList.toggle('falta', clase === 'falta');
  };
  marcador('#m-fisicos', `${r.fisico.hechos}/${REGLAS.fisicosQueCuentan}`,
    r.fisico.hechos === REGLAS.fisicosQueCuentan ? 'completo' : r.fisico.hechos ? 'falta' : '');
  marcador('#m-espirituales', `${r.espiritual.hechos}/${REGLAS.espiritualesObligatorios}`,
    r.espiritual.faltantes.length === 0 ? 'completo' : r.espiritual.hechos ? 'falta' : '');
  marcador('#m-adicional', r.adicional.puntos, '');
  marcador('#m-total', r.total, r.completo ? 'completo' : '');

  $('#alertas-club').innerHTML = r.alertas.length
    ? r.alertas.map(a => `<div class="aviso-caja ${a.nivel === 'alerta' ? 'alerta' : ''}">${escapar(a.texto)}</div>`).join('')
    : '';

  $('#conteo-escaneos').textContent = r.detalle.length ? `(${r.detalle.length})` : '';
  $('#lista-escaneos').innerHTML = r.detalle.length
    ? [...r.detalle].reverse().map(d => {
        const info = ESTADOS[d.estado];
        const nombre = d.evento ? d.evento.nombre : d.escaneo.crudo;
        const tipo = d.evento ? etiquetaTipo(d.evento.tipo) : '—';
        return `<div class="linea-escaneo">
          <span class="orden">${d.orden}</span>
          <span>${ICONOS[d.estado] || '•'}</span>
          <span class="desc">
            <div class="nom">${escapar(nombre)}</div>
            <div class="por">${tipo} · <span class="${info.nivel === 'ok' ? 'tenue' : ''}">${info.etiqueta}</span>${d.detalleTexto ? ' · ' + escapar(d.detalleTexto) : ''}</div>
          </span>
          <span class="pts">${d.puntos ? '+' + d.puntos : '—'}</span>
          <button class="quitar" data-crudo="${escapar(d.escaneo.crudo)}">quitar</button>
        </div>`;
      }).join('')
    : '<p class="tenue chico">Todavía no escaneaste nada.</p>';

  $$('#lista-escaneos .quitar').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('¿Quitar este escaneo de la ficha?')) return;
    await almacen.borrarEscaneo(estado.club.id, b.dataset.crudo);
    await marcarPendiente(estado.club.id);
    await recargarEscaneos();
  }));

  const ficha = estado.fichas.get(estado.club.id);
  $('#cerrar-ficha').textContent = ficha?.cerrada ? 'Reabrir ficha' : 'Marcar ficha como terminada';
}

async function recargarEscaneos() {
  estado.escaneos = await almacen.escaneosDeClub(estado.club.id);
  estado.todos = await almacen.todosLosEscaneos();
  pintarFicha();
}

function avisar(nivel, icono, titulo, sub) {
  const caja = $('#resultado-escaneo');
  caja.className = nivel;
  caja.innerHTML = `<div class="icono">${icono}</div><div>
    <div class="titulo">${escapar(titulo)}</div>
    <div class="sub">${escapar(sub || '')}</div></div>`;
}

/** Punto unico por donde entra todo codigo leido, venga de la camara o escrito a mano. */
async function procesarCodigo(texto) {
  const lectura = leerQr(texto);

  // El QR de la cabecera de una ficha cambia de club: es la forma mas rapida
  // de pasar de una ficha a la siguiente sin volver a la lista.
  if (lectura.ok && lectura.clase === 'club') {
    const club = buscarClub(lectura.idClub);
    if (!club) {
      pitido('error'); vibrar('error');
      avisar('alerta', '❌', 'Club desconocido', `El QR dice ${lectura.idClub} y ese club no está en el padrón.`);
      return;
    }
    if (estado.club?.id === club.id) {
      avisar('info', '🏷️', `Ya estás en ${club.nombre}`, 'Seguí escaneando los stickers de la ficha.');
      return;
    }
    pitido('ok'); vibrar('ok');
    await abrirClub(club.id);
    avisar('info', '🏷️', `Ficha de ${club.nombre}`, `${club.region} · ${club.iglesia}`);
    return;
  }

  if (!estado.club) {
    pitido('aviso'); vibrar('aviso');
    avisar('aviso', '👆', 'Primero elegí el club', 'Escaneá el QR de la cabecera de la ficha, o elegilo en la lista.');
    return;
  }

  if (!lectura.ok) {
    pitido('error'); vibrar('error');
    avisar('alerta', '❌', 'QR inválido', lectura.detalle || 'No pertenece a este campori.');
    return;
  }

  const guardado = await almacen.agregarEscaneo({
    idClub: estado.club.id,
    crudo: lectura.crudo,
    dispositivo: estado.dispositivo,
  });
  if (guardado === 'duplicado') {
    pitido('aviso'); vibrar('aviso');
    const evento = leerQr(lectura.crudo);
    avisar('aviso', '🔁', 'Este sticker ya estaba cargado',
      `El sticker ${evento.id} ya figura en la ficha de ${estado.club.nombre}.`);
    return;
  }

  await recargarEscaneos();
  await marcarPendiente(estado.club.id);

  // Buscamos como quedo ESTE escaneo dentro del resultado recalculado, para poder
  // avisar exactamente por que se conto o por que no.
  const r = resultadoDe(estado.club.id, estado.escaneos);
  const mio = r.detalle.find(d => d.escaneo.crudo === lectura.crudo);
  if (!mio) return;

  const info = ESTADOS[mio.estado];
  const nombre = mio.evento ? mio.evento.nombre : lectura.crudo;
  if (mio.estado === 'contado') {
    pitido('ok'); vibrar('ok');
    avisar('ok', '✅', `+${mio.puntos} · ${nombre}`,
      `${etiquetaTipo(mio.evento.tipo)} · total del club: ${r.total} pts`);
  } else {
    const grave = info.nivel === 'alerta';
    pitido(grave ? 'error' : 'aviso'); vibrar(grave ? 'error' : 'aviso');
    avisar(info.nivel, ICONOS[mio.estado] || '⚠️', `${info.etiqueta}: ${nombre}`, mio.detalleTexto || '');
  }
}

// ------------------------------------------------------------------ camara

async function encenderCamara() {
  try {
    // Este click es el gesto que iOS exige para poder emitir sonido despues.
    activarSonido();
    $('#mensaje-camara').textContent = 'Pidiendo permiso de cámara…';
    estado.escaner = new Escaner($('#video'), texto => { procesarCodigo(texto); });
    await estado.escaner.iniciar();
    $('#camara-apagada').classList.add('oculto');
    $('#mira').hidden = false;
    $('#apagar').classList.remove('oculto');
    $('#linterna').classList.toggle('oculto', !(await estado.escaner.hayLinterna()));
    const propio = estado.escaner.motor === 'propio';
    avisar('info', '🎥', 'Cámara lista',
      propio ? 'Acercá cada sticker y mantené el celular derecho hasta que suene.'
             : 'Acercá cada sticker hasta que suene.');
  } catch (e) {
    estado.escaner = null;
    const esPermiso = /NotAllowed|Permission/i.test(e.name || '') || /permiso/i.test(e.message);
    $('#mensaje-camara').textContent = esPermiso
      ? 'No diste permiso de cámara. Habilitalo desde el candado de la barra de direcciones y volvé a intentar.'
      : e.message;
    avisar('alerta', '📷', 'No pude abrir la cámara', e.message);
  }
}

function apagarCamara() {
  if (!estado.escaner) return;
  estado.escaner.detener();
  estado.escaner = null;
  estado.linternaEncendida = false;
  $('#camara-apagada')?.classList.remove('oculto');
  $('#mira') && ($('#mira').hidden = true);
  $('#apagar')?.classList.add('oculto');
  $('#linterna')?.classList.add('oculto');
  if ($('#mensaje-camara')) $('#mensaje-camara').textContent = 'La cámara está apagada';
}

// ------------------------------------------------------------------ resultados

function pintarResultados() {
  const todos = resultadosDeTodos();
  const conDatos = todos.filter(t => t.escaneos.length);
  const cerradas = todos.filter(t => t.ficha?.cerrada).length;
  const conAlertas = conDatos.filter(t => t.resultado.alertas.some(a => a.nivel === 'alerta')).length;
  const puntos = conDatos.reduce((t, x) => t + x.resultado.total, 0);

  const tarjeta = (valor, rotulo, clase = '') =>
    `<div class="marcador"><div class="valor ${clase}">${valor}</div><div class="rotulo">${rotulo}</div></div>`;
  $('#totales-generales').innerHTML =
    tarjeta(`${conDatos.length}/${CLUBES.length}`, 'clubes con escaneos') +
    tarjeta(cerradas, 'fichas terminadas') +
    tarjeta(conAlertas, 'clubes con alertas', conAlertas ? 'tenue' : '') +
    tarjeta(conDatos.length ? Math.round(puntos / conDatos.length) : 0, 'promedio de puntos');

  const orden = [...todos].sort((a, b) => b.resultado.total - a.resultado.total);
  $('#tabla-resultados tbody').innerHTML = orden.map(({ club, escaneos, resultado, ficha }) => {
    const graves = resultado.alertas.filter(a => a.nivel === 'alerta').length;
    let marca = '<span class="tenue">sin evaluar</span>';
    if (graves) marca = `<span class="pastilla alerta">${graves} alerta${graves === 1 ? '' : 's'}</span>`;
    else if (ficha?.cerrada) marca = '<span class="pastilla ok">terminada</span>';
    else if (escaneos.length) marca = '<span class="pastilla info">en curso</span>';
    return `<tr>
      <td>${escapar(club.nombre)}</td>
      <td class="tenue">${escapar(club.region)}</td>
      <td class="num">${resultado.fisico.puntos}</td>
      <td class="num">${resultado.espiritual.puntos}</td>
      <td class="num">${resultado.adicional.puntos}</td>
      <td class="num"><strong>${resultado.total}</strong></td>
      <td>${marca}</td>
    </tr>`;
  }).join('');
}

/**
 * Arma las hojas del Excel y del envio a Google Sheets.
 *
 * `soloConEscaneos` importa cuando evalua mas de una persona: si un telefono manda
 * los 72 clubes, los que no evaluo irian con cero y pisarian en la planilla el
 * trabajo de otro. Mandando solo lo propio, cada uno actualiza su parte.
 *
 * La columna 0 de cada hoja lleva el ID del club a proposito: es la que usa el
 * script de Google para saber que filas reemplazar y cuales dejar quietas.
 */
function hojasParaExportar({ soloConEscaneos = false, idsClub = null } = {}) {
  const ids = idsClub ? new Set(idsClub) : null;
  const todos = resultadosDeTodos().filter(t =>
    (!ids || ids.has(t.club.id)) && (!soloConEscaneos || t.escaneos.length)
  );
  const fecha = new Date().toLocaleString('es-BO');

  // "Graves" son las que exigen revision humana: trampas y QR invalidos.
  // "Avisos" son cosas normales de una ficha a medio evaluar, como que falten
  // espirituales. Van en columnas separadas para poder filtrar por las primeras.
  const puntajes = [
    ['ID', 'Club', 'Región', 'Iglesia', 'Distrito', 'Director/a',
      'Eventos físicos', 'Puntos físicos', 'Eventos espirituales', 'Puntos espirituales',
      'Puntos adicionales', 'TOTAL', 'Espirituales faltantes',
      'Alertas graves', 'Avisos', 'Estado'],
    ...todos.map(({ club, escaneos, resultado, ficha }) => [
      club.id, club.nombre, club.region, club.iglesia, club.distrito, club.director,
      resultado.fisico.hechos, resultado.fisico.puntos,
      resultado.espiritual.hechos, resultado.espiritual.puntos,
      resultado.adicional.puntos, resultado.total,
      resultado.espiritual.faltantes.map(e => e.nombre).join(', '),
      resultado.alertas.filter(a => a.nivel === 'alerta').length,
      resultado.alertas.filter(a => a.nivel !== 'alerta').length,
      ficha?.cerrada ? 'Terminada' : escaneos.length ? 'En curso' : 'Sin evaluar',
    ]),
  ];

  const detalle = [['ID', 'Club', 'Región', 'Orden', 'Código', 'Evento', 'Tipo', 'Estado', 'Puntos', 'Motivo', 'Evaluador', 'Fecha y hora', 'Código QR', 'Marca de tiempo']];
  const alertas = [['ID', 'Club', 'Región', 'Nivel', 'Alerta']];
  for (const { club, resultado } of todos) {
    for (const d of resultado.detalle) {
      detalle.push([
        club.id, club.nombre, club.region, d.orden,
        d.evento?.codigo || '', d.evento?.nombre || '',
        d.evento ? etiquetaTipo(d.evento.tipo) : '',
        ESTADOS[d.estado].etiqueta, d.puntos, d.detalleTexto || '',
        d.escaneo.dispositivo || '',
        new Date(d.escaneo.ts).toLocaleString('es-BO'), d.escaneo.crudo, d.escaneo.ts,
      ]);
    }
    for (const a of resultado.alertas) {
      alertas.push([club.id, club.nombre, club.region, a.nivel === 'alerta' ? 'Grave' : 'Aviso', a.texto]);
    }
  }

  const parametros = [
    ['Parámetro', 'Valor'],
    ['Campori', CAMPORI.nombre],
    ['Exportado', fecha],
    ['Clubes en el padrón', CLUBES.length],
    ['Puntos por evento', TOPE_FISICO / REGLAS.fisicosQueCuentan],
    ['Eventos físicos que cuentan', `${REGLAS.fisicosQueCuentan} de 14 (valen los primeros escaneados)`],
    ['Máximo físico', TOPE_FISICO],
    ['Eventos espirituales', `${REGLAS.espiritualesObligatorios}, todos obligatorios`],
    ['Máximo espiritual', TOPE_ESPIRITUAL],
    ['Máximo base', TOPE_FISICO + TOPE_ESPIRITUAL],
  ];

  // claveColumna le dice al script de Google por que columna fusionar. Las hojas
  // sin clave (los parametros) se reescriben enteras en cada envio.
  return [
    { nombre: 'Puntajes', filas: puntajes, claveColumna: 0, clubesReemplazar: ids ? [...ids] : undefined, anchos: [7, 26, 11, 20, 18, 26, 13, 13, 15, 15, 14, 10, 40, 13, 8, 12] },
    { nombre: 'Detalle de escaneos', filas: detalle, claveColumna: 0, clubesReemplazar: ids ? [...ids] : undefined, anchos: [7, 24, 11, 7, 8, 34, 11, 22, 8, 40, 16, 19, 24, 16] },
    { nombre: 'Alertas', filas: alertas, claveColumna: 0, clubesReemplazar: ids ? [...ids] : undefined, anchos: [7, 24, 11, 8, 90] },
    { nombre: 'Parámetros', filas: parametros, reemplazar: true, anchos: [30, 50] },
  ];
}

// ------------------------------------------------------------------ Google Sheets

function mostrarEstadoSheets(nivel, texto) {
  $('#sheets-estado').innerHTML = `<div class="aviso-caja ${nivel}">${escapar(texto)}</div>`;
}

async function guardarSheets() {
  const url = $('#sheets-url').value.trim();
  const clave = $('#sheets-clave').value;
  await almacen.guardarAjuste('sheetsUrl', url);
  await almacen.guardarAjuste('sheetsClave', clave);
  $('#conexion-url').value = url;
  $('#conexion-clave').value = clave;
  mostrarEstadoSheets('ok', 'Guardado en este teléfono. No se sube al repositorio.');
}

async function guardarPendientes() {
  await almacen.guardarAjuste('clubesPendientes', [...estado.pendientes]);
}

async function marcarPendiente(idClub) {
  if (!idClub) return;
  estado.pendientes.add(idClub);
  await guardarPendientes();
  programarSincronizacion();
}

function programarSincronizacion() {
  clearTimeout(estado.temporizadorSync);
  estado.temporizadorSync = setTimeout(() => sincronizarAutomaticamente(), 900);
}

async function enviarClubes(idsClub, silencioso = false) {
  const ids = [...new Set(idsClub || [])].filter(Boolean);
  if (!ids.length) return { ok: true, hojas: [] };
  const url = $('#sheets-url').value.trim();
  const clave = $('#sheets-clave').value;
  if (!url || !clave) return { ok: false, error: 'Falta conectar la aplicación con Google Sheets.' };

  if (!silencioso) mostrarEstadoSheets('', `Enviando ${ids.length} club${ids.length === 1 ? '' : 'es'}…`);
  const hojas = hojasParaExportar({ idsClub: ids });
  const nombres = resultadosDeTodos()
    .filter(t => ids.includes(t.club.id))
    .map(t => t.club.nombre);

  const r = await sheets.enviar(
    {
      url, clave,
      dispositivo: estado.dispositivo || 'sin nombre',
      clubes: nombres.join(', '),
    },
    hojas.map(h => ({
      nombre: h.nombre,
      filas: h.filas,
      claveColumna: h.claveColumna,
      reemplazar: h.reemplazar,
      clubesReemplazar: h.clubesReemplazar,
    })),
    CAMPORI.nombre
  );

  if (r.ok) {
    ids.forEach(id => estado.pendientes.delete(id));
    await guardarPendientes();
    if (!silencioso) mostrarEstadoSheets('ok', 'Cambios enviados. Actualizando desde la planilla…');
  }
  return r;
}

async function aplicarEstadoRemoto(r) {
  if (!Array.isArray(r.escaneos)) {
    return {
      ok: false,
      error: 'El Apps Script instalado es anterior. Volvé a copiar herramientas/apps-script.gs y publicá una versión nueva.',
    };
  }

  const escaneos = sheets.normalizarEscaneos(r.escaneos);
  await almacen.reemplazarEscaneos(escaneos, estado.pendientes);
  estado.todos = await almacen.todosLosEscaneos();
  if (estado.club) estado.escaneos = await almacen.escaneosDeClub(estado.club.id);

  // Las claves vienen como texto QR; el motor trabaja con el id evento-serial.
  estado.remotos = new Map();
  for (const [crudo, clubes] of sheets.normalizarSeriales(r.seriales || {})) {
    const id = idDeSticker(crudo);
    if (id) estado.remotos.set(id, clubes);
  }
  estado.remotosFecha = Date.now();
  await almacen.guardarAjuste('remotos', [...estado.remotos]);
  await almacen.guardarAjuste('remotosFecha', estado.remotosFecha);

  pintarEstadoRemotos();
  pintarClubes();
  if (estado.club) pintarFicha();
  if (estado.vista === 'resultados') pintarResultados();
  return { ok: true };
}

async function traerDeSheets(silencioso = false) {
  const url = $('#sheets-url').value.trim() || await almacen.leerAjuste('sheetsUrl', '');
  const clave = $('#sheets-clave').value || await almacen.leerAjuste('sheetsClave', '');
  if (!url || !clave) {
    const falta = { ok: false, error: 'Falta la dirección o la clave de Google Sheets.' };
    if (!silencioso) mostrarEstadoSheets('aviso', falta.error);
    return falta;
  }

  const boton = $('#sheets-traer');
  if (!silencioso) { boton.disabled = true; mostrarEstadoSheets('', 'Consultando la planilla…'); }

  const r = await sheets.traerEstado(url, clave);
  if (!silencioso) boton.disabled = false;

  if (!r.ok) {
    if (!silencioso) mostrarEstadoSheets('alerta', r.error || 'No se pudo consultar.');
    return r;
  }

  const aplicada = await aplicarEstadoRemoto(r);
  if (!aplicada.ok) {
    if (!silencioso) mostrarEstadoSheets('alerta', aplicada.error);
    return aplicada;
  }
  if (!silencioso) {
    mostrarEstadoSheets('ok', `Sincronizado: ${estado.todos.length} escaneos de ${r.clubes || 0} clubes. ` +
      'Los cambios manuales de "Detalle de escaneos" ya están reflejados.');
  }
  return r;
}

async function sincronizarAutomaticamente({ forzarEnvio = false } = {}) {
  if (estado.sincronizando || !navigator.onLine) return;
  const url = $('#sheets-url').value.trim();
  const clave = $('#sheets-clave').value;
  if (!url || !clave) return;

  estado.sincronizando = true;
  try {
    const ids = [...estado.pendientes];
    if (ids.length) {
      const enviada = await enviarClubes(ids, !forzarEnvio);
      if (!enviada.ok && forzarEnvio) mostrarEstadoSheets('alerta', enviada.error || 'No se pudo enviar.');
    }
    await traerDeSheets(!forzarEnvio);
  } finally {
    estado.sincronizando = false;
  }
}

async function enviarASheets() {
  await guardarSheets();
  const boton = $('#sheets-enviar');
  boton.disabled = true;
  boton.textContent = 'Sincronizando…';
  await sincronizarAutomaticamente({ forzarEnvio: true });
  boton.disabled = false;
  boton.textContent = 'Sincronizar ahora';
}

function pintarEstadoRemotos() {
  const caja = $('#estado-remotos');
  if (!caja) return;
  if (!estado.remotos.size) {
    caja.className = 'aviso-caja';
    caja.innerHTML = '<strong>Todavía no trajiste lo de los demás.</strong> Hasta que lo hagas, ' +
      'este teléfono no puede detectar un sticker que ya usó un club evaluado por otra persona.';
    return;
  }
  const cuando = new Date(estado.remotosFecha).toLocaleString('es-BO');
  caja.className = 'aviso-caja ok';
  caja.innerHTML = `<strong>${estado.remotos.size} stickers</strong> ya usados por otros clubes, ` +
    `sincronizados el ${escapar(cuando)}. La aplicación revisa la planilla automáticamente.`;
}

async function probarSheets() {
  const boton = $('#sheets-probar');
  boton.disabled = true;
  mostrarEstadoSheets('', 'Probando…');
  const r = await sheets.probar($('#sheets-url').value.trim());
  boton.disabled = false;
  if (r.ok) mostrarEstadoSheets('ok', r.mensaje || 'El script responde correctamente.');
  else mostrarEstadoSheets('alerta', r.error || 'No respondió.');
}

function mostrarEstadoConexion(nivel, texto) {
  $('#conexion-estado').innerHTML =
    `<div class="aviso-caja ${nivel}">${escapar(texto)}</div>`;
}

function iniciarIntervaloSincronizacion() {
  clearInterval(estado.intervaloSync);
  estado.intervaloSync = setInterval(() => sincronizarAutomaticamente(), 20000);
}

async function conectarInicial() {
  const boton = $('#conexion-conectar');
  const url = $('#conexion-url').value.trim();
  const clave = $('#conexion-clave').value;
  const dispositivo = $('#conexion-dispositivo').value.trim();
  if (!url || !clave) {
    mostrarEstadoConexion('alerta', 'Pegá la dirección del Apps Script y escribí la clave.');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Conectando…';
  mostrarEstadoConexion('', 'Leyendo el estado de Google Sheets…');

  $('#sheets-url').value = url;
  $('#sheets-clave').value = clave;
  $('#nombre-dispositivo').value = dispositivo;
  estado.dispositivo = dispositivo;
  await almacen.guardarAjuste('sheetsUrl', url);
  await almacen.guardarAjuste('sheetsClave', clave);
  await almacen.guardarAjuste('dispositivo', dispositivo);

  // En la primera actualización de esta versión conservamos los datos locales y
  // los enviamos una vez. Después, Google Sheets queda como fuente central.
  const preparada = await almacen.leerAjuste('sincronizacionBidireccional', false);
  if (!preparada) {
    estado.todos.forEach(e => estado.pendientes.add(e.idClub));
    await guardarPendientes();
  }

  const remota = await traerDeSheets(true);
  if (!remota?.ok) {
    boton.disabled = false;
    boton.textContent = 'Conectar y sincronizar';
    mostrarEstadoConexion('alerta', remota?.error || 'No se pudo leer la planilla.');
    return;
  }

  if (estado.pendientes.size) {
    mostrarEstadoConexion('', 'Enviando los cambios que estaban guardados en este teléfono…');
    const enviada = await enviarClubes([...estado.pendientes], true);
    if (!enviada.ok) {
      boton.disabled = false;
      boton.textContent = 'Conectar y sincronizar';
      mostrarEstadoConexion('alerta', enviada.error || 'No se pudieron enviar los datos locales.');
      return;
    }
    await traerDeSheets(true);
  }

  await almacen.guardarAjuste('sincronizacionBidireccional', true);
  estado.conectado = true;
  iniciarIntervaloSincronizacion();
  $('#conexion-inicial').classList.add('oculto');
  mostrarEstadoSheets('ok', 'Conectado. La planilla se revisa automáticamente cada 20 segundos.');
  boton.disabled = false;
  boton.textContent = 'Conectar y sincronizar';
}

// ------------------------------------------------------------------ ajustes

async function pintarDiagnostico() {
  const seguro = window.isSecureContext;
  const todos = resultadosDeTodos();
  const lineas = [
    ['✅', 'Lectura de QR con la cámara',
      `Lector ${VERSION_LECTOR} · ${await Escaner.descripcionMotor()}`],
    [seguro ? '✅' : '❌', 'Contexto seguro (HTTPS)',
      seguro ? 'Sí, la cámara puede abrirse' : 'No. Sin HTTPS el navegador bloquea la cámara.'],
    ['📋', 'Clubes en el padrón', String(CLUBES.length)],
    [estado.remotos.size ? '✅' : '⚠️', 'Stickers usados por otros clubes',
      estado.remotos.size
        ? `${estado.remotos.size}, traídos el ${new Date(estado.remotosFecha).toLocaleString('es-BO')}`
        : 'Sin traer. No se detectan stickers prestados entre clubes de otros evaluadores.'],
    [estado.conectado ? '✅' : '⚠️', 'Google Sheets',
      estado.conectado ? 'Conectado · actualización automática cada 20 segundos' : 'Sin conexión automática'],
    ['🔢', 'Escaneos guardados', String(estado.todos.length)],
    ['🏁', 'Fichas terminadas', String(todos.filter(t => t.ficha?.cerrada).length)],
    ['🔑', 'Prefijo de los QR', CAMPORI.prefijo],
  ];
  $('#diagnostico').innerHTML = `<table><tbody>${lineas.map(([i, k, v]) =>
    `<tr><td style="width:24px">${i}</td><td>${escapar(k)}</td><td class="tenue">${escapar(v)}</td></tr>`).join('')}</tbody></table>`;
}

// ------------------------------------------------------------------ arranque

async function iniciar() {
  await almacen.abrir();
  estado.todos = await almacen.todosLosEscaneos();
  estado.fichas = await almacen.fichas();

  estado.dispositivo = await almacen.leerAjuste('dispositivo', '') || '';
  $('#nombre-dispositivo').value = estado.dispositivo;
  // La direccion oficial ya viene lista. Un valor guardado permite reemplazarla si
  // alguna vez se publica una implementacion nueva con otra URL.
  $('#sheets-url').value =
    await almacen.leerAjuste('sheetsUrl', '') || sheets.URL_PREDETERMINADA;
  $('#sheets-clave').value = await almacen.leerAjuste('sheetsClave', '') || '';
  $('#conexion-url').value = $('#sheets-url').value;
  $('#conexion-clave').value = $('#sheets-clave').value;
  $('#conexion-dispositivo').value = estado.dispositivo;

  const pendientes = await almacen.leerAjuste('clubesPendientes', []);
  if (Array.isArray(pendientes)) estado.pendientes = new Set(pendientes);

  const remotos = await almacen.leerAjuste('remotos', null);
  if (Array.isArray(remotos)) estado.remotos = new Map(remotos);
  estado.remotosFecha = await almacen.leerAjuste('remotosFecha', null);

  $('#filtro-region').innerHTML = '<option value="">Todas las regiones</option>' +
    [...new Set(CLUBES.map(c => c.region))].map(r => `<option>${escapar(r)}</option>`).join('');

  $('#m-fisicos .valor').textContent = `0/${REGLAS.fisicosQueCuentan}`;
  $('#m-espirituales .valor').textContent = `0/${REGLAS.espiritualesObligatorios}`;

  pintarEstadoRemotos();
  pintarClubes();

  if (estado.dispositivo) {
    $('#estado-cabecera').textContent = `Evaluando como: ${estado.dispositivo}`;
  } else {
    $('#estado-cabecera').textContent =
      'Ponele nombre a este teléfono en Ajustes, sobre todo si evalúan entre varios.';
  }

  if (!window.isSecureContext) {
    $('#estado-cabecera').textContent =
      'Sin HTTPS: la cámara no va a poder abrirse. Ver el diagnóstico en Ajustes.';
  }
}

// --- navegacion
$$('nav.pestanas button').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
$('#volver').addEventListener('click', () => mostrarVista('clubes'));
$('#ir-a-clubes').addEventListener('click', () => mostrarVista('clubes'));

// --- lista
let temporizadorBusqueda;
$('#buscar').addEventListener('input', () => {
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(pintarClubes, 150);
});
$('#filtro-region').addEventListener('change', pintarClubes);
$('#filtro-estado').addEventListener('change', pintarClubes);

// --- camara
$('#encender').addEventListener('click', encenderCamara);
$('#apagar').addEventListener('click', apagarCamara);
$('#linterna').addEventListener('click', async () => {
  estado.linternaEncendida = !estado.linternaEncendida;
  const ok = await estado.escaner?.linterna(estado.linternaEncendida);
  $('#linterna').textContent = ok && estado.linternaEncendida ? 'Apagar linterna' : 'Linterna';
});
$('#manual').addEventListener('click', () => {
  const texto = prompt('Escribí el código tal como figura debajo del QR, por ejemplo AV5-F03-200-0147-K7M2:');
  if (texto) procesarCodigo(texto.trim());
});

// --- ficha
$('#cerrar-ficha').addEventListener('click', async () => {
  const ficha = estado.fichas.get(estado.club.id);
  await almacen.marcarFicha(estado.club.id, { cerrada: !ficha?.cerrada });
  await marcarPendiente(estado.club.id);
  estado.fichas = await almacen.fichas();
  pintarFicha();
  const ahoraCerrada = estado.fichas.get(estado.club.id)?.cerrada;
  avisar(ahoraCerrada ? 'ok' : 'info', ahoraCerrada ? '🏁' : '📋',
    ahoraCerrada ? 'Ficha terminada' : 'Ficha reabierta',
    ahoraCerrada ? 'Podés pasar al siguiente club.' : 'Podés seguir escaneando.');
});
$('#borrar-ficha').addEventListener('click', async () => {
  if (!confirm(`¿Borrar TODOS los escaneos de ${estado.club.nombre}? No se puede deshacer.`)) return;
  await almacen.borrarClub(estado.club.id);
  await marcarPendiente(estado.club.id);
  estado.fichas = await almacen.fichas();
  await recargarEscaneos();
  avisar('info', '🗑️', 'Ficha vaciada', 'Podés empezar de nuevo.');
});

// --- exportacion
$('#exportar-excel').addEventListener('click', () => {
  descargar(aXlsx(hojasParaExportar()), `puntajes-campori-${hoy()}.xlsx`);
});
$('#exportar-csv').addEventListener('click', () => {
  descargar(aCsv(hojasParaExportar()[0].filas), `puntajes-campori-${hoy()}.csv`);
});

// --- este telefono
$('#guardar-dispositivo').addEventListener('click', async () => {
  estado.dispositivo = $('#nombre-dispositivo').value.trim();
  $('#conexion-dispositivo').value = estado.dispositivo;
  await almacen.guardarAjuste('dispositivo', estado.dispositivo);
  $('#estado-cabecera').textContent = estado.dispositivo
    ? `Evaluando como: ${estado.dispositivo}`
    : `${CAMPORI.nombre} · De vuelta a casa`;
  alert(estado.dispositivo
    ? `Listo. Los escaneos de este teléfono quedan a nombre de "${estado.dispositivo}".`
    : 'Nombre borrado.');
});

// --- Google Sheets
$('#sheets-guardar').addEventListener('click', guardarSheets);
$('#sheets-probar').addEventListener('click', probarSheets);
$('#sheets-enviar').addEventListener('click', enviarASheets);
$('#sheets-traer').addEventListener('click', () => traerDeSheets(false));
$('#conexion-conectar').addEventListener('click', conectarInicial);
$('#conexion-omitir').addEventListener('click', () => {
  estado.conectado = false;
  $('#conexion-inicial').classList.add('oculto');
  mostrarEstadoSheets('aviso', 'Trabajando sin conexión. Podés conectarte desde Ajustes.');
});

$('#borrar-todo').addEventListener('click', async () => {
  if (!confirm('¿Borrar TODOS los datos de TODOS los clubes de este teléfono?')) return;
  if (!confirm('Esto no se puede deshacer. ¿Seguro?')) return;
  const idsConDatos = [...new Set(estado.todos.map(e => e.idClub))];
  await almacen.borrarTodo();
  estado.todos = []; estado.fichas = new Map(); estado.escaneos = [];
  for (const id of idsConDatos) estado.pendientes.add(id);
  await guardarPendientes();
  programarSincronizacion();
  pintarClubes(); pintarDiagnostico();
  alert('Listo, no quedan datos.');
});

// La camara se apaga sola si la app pasa a segundo plano.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) apagarCamara();
  else if (estado.conectado) sincronizarAutomaticamente();
});
window.addEventListener('online', () => {
  if (estado.conectado) sincronizarAutomaticamente();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin service worker anda igual, solo que no offline */ });
}

iniciar();
